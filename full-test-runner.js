/**
 * Full test runner — 3 languages × 11 scenarios × configurable runs
 * Measures response times, checks assertions, detects bugs.
 * Saves raw JSON so results can be accumulated across runs.
 * Output: full-test-report.txt + full-test-results.json
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const CONVO_BASE = path.join(__dirname, 'test/convo/previsit')
const RUNS = parseInt(process.argv[2] || '5', 10)
const ENV = (process.argv[3] || process.env.ELFIE_ENV || 'staging').toLowerCase()
const JSON_FILE = `full-test-results-${ENV}.json`
const API_TIMEOUT_MS = 90000

const ENVS = {
  staging: { host: 'api.stg.elfie.co' },
  prod:    { host: 'api.elfie.co' }
}
const { host: API_HOST } = ENVS[ENV] || ENVS.staging
const API_KEY = process.env.ELFIE_API_KEY || ''

const CONVO_FILES = [
  '01_opening.convo.txt', '02_identity.convo.txt', '03_visit_context.convo.txt',
  '04_symptoms.convo.txt', '05_medical_history.convo.txt', '06_medication.convo.txt',
  '07_lifestyle.convo.txt', '08_mental_emotional.convo.txt', '09_closing.convo.txt',
  '10_uncertain_answers.convo.txt', '11_post_summary.convo.txt'
]

const LANGUAGES = [
  { code: 'en', label: 'English',    dir: path.join(CONVO_BASE, 'en') },
  { code: 'fr', label: 'French',     dir: path.join(CONVO_BASE, 'fr') },
  { code: 'vi', label: 'Vietnamese', dir: path.join(CONVO_BASE, 'vi') }
]

// ─── Convo parser ─────────────────────────────────────────────────────────────

function parseConvo(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  const turns = []
  let type = null, buf = []

  function flush() {
    const content = buf.join('\n').trim()
    if (type && content) turns.push({ type, content })
  }

  for (const line of lines) {
    if (line.trim() === '#bot') { flush(); type = 'bot'; buf = [] }
    else if (line.trim() === '#me') { flush(); type = 'me'; buf = [] }
    else if (type) buf.push(line)
  }
  flush()
  return turns
}

function matchAssertion(response, pattern) {
  try {
    return new RegExp(pattern, 'i').test(response)
  } catch {
    return pattern.split('|').some(p => { try { return new RegExp(p.trim(), 'i').test(response) } catch { return false } })
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function apiCall(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const t0 = Date.now()
    const req = https.request({
      hostname: API_HOST, path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY,
                 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { raw: data } }
        resolve({ status: res.statusCode, body: parsed, elapsed: Date.now() - t0 })
      })
    })
    req.on('error', reject)
    req.setTimeout(API_TIMEOUT_MS, () => req.destroy(new Error('timeout')))
    req.write(payload)
    req.end()
  })
}

async function createSession(lang) {
  const r = await apiCall('/agent/api/v1/ai-coach/create-session', {
    user_id: 'botium-test', language_code: lang,
    config: { patient_info: { name: 'Test User' }, use_case: 'pre-visit',
              domains: [], doctor_language_code: lang, clinic_name: '' }
  })
  return { sessionId: r.body.sessionId || r.body.session_id, elapsed: r.elapsed }
}

async function chat(sessionId, message, lang) {
  const r = await apiCall('/agent/api/v1/ai-coach/chat', {
    session_id: sessionId, message, language_code: lang, user_id: 'botium-test'
  })
  return { response: (r.body.message || '').trim(), elapsed: r.elapsed, status: r.status }
}

// ─── Bug detectors ────────────────────────────────────────────────────────────

// English-dominant phrases unlikely to appear in FR/VI responses
const EN_LEAK_RE = /\b(I understand|I see|thank you|please|your name|how old|what is your|let me|let's|you mentioned|it sounds like|feel free|don't hesitate|let's start|let's also|let's go through|brings you in)\b/i
// French-dominant phrases unlikely to appear in EN/VI responses
const FR_LEAK_RE = /\b(je comprends|merci|bonjour|votre|nous avons|pouvez-vous|s'il vous|médecin|douleur|veuillez)\b/i
// Vietnamese-dominant phrases unlikely to appear in EN/FR responses
const VI_LEAK_RE = /\b(xin chào|cảm ơn|bạn|chúng tôi|bác sĩ|tôi hiểu|vui lòng)\b/i

function detectBugs(response, lang) {
  const bugs = []
  if (!response) { bugs.push('EMPTY_RESPONSE'); return bugs }

  if (lang === 'fr' && /voici la traduction/i.test(response))
    bugs.push('FR_TRANSLATION_ARTIFACT')

  // English words leaking into FR or VI responses
  if (lang === 'fr' && EN_LEAK_RE.test(response))
    bugs.push('MIXED_LANG_EN_IN_FR')
  if (lang === 'vi' && EN_LEAK_RE.test(response))
    bugs.push('MIXED_LANG_EN_IN_VI')

  // French words leaking into EN or VI responses
  if (lang === 'en' && FR_LEAK_RE.test(response))
    bugs.push('MIXED_LANG_FR_IN_EN')
  if (lang === 'vi' && FR_LEAK_RE.test(response))
    bugs.push('MIXED_LANG_FR_IN_VI')

  // Vietnamese words leaking into EN or FR responses
  if (lang === 'en' && VI_LEAK_RE.test(response))
    bugs.push('MIXED_LANG_VI_IN_EN')
  if (lang === 'fr' && VI_LEAK_RE.test(response))
    bugs.push('MIXED_LANG_VI_IN_FR')

  return bugs
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

async function runScenario(lang, turns, runNum) {
  const session = await createSession(lang)
  const sessionId = session.sessionId

  const turnResults = []
  const bugEvents = []
  let assertionFails = 0

  // INIT
  const init = await chat(sessionId, 'start conversation', lang)
  const initAssertion = turns[0]?.type === 'bot' ? turns[0].content : null
  const initPassed = initAssertion ? matchAssertion(init.response, initAssertion) : true
  if (!initPassed) {
    assertionFails++
    bugEvents.push({ turn: 0, type: 'ASSERTION_FAIL', assertion: initAssertion,
                     actual: init.response.substring(0, 200) })
  }
  detectBugs(init.response, lang).forEach(b =>
    bugEvents.push({ turn: 0, type: b, actual: init.response.substring(0, 200) }))
  turnResults.push({ turn: 0, userMsg: 'start conversation', botResp: init.response,
                     elapsed: init.elapsed, passed: initPassed })

  let i = 1, turnNum = 1
  while (i < turns.length) {
    const t = turns[i]
    if (t.type !== 'me') { i++; continue }

    let cr
    try {
      cr = await chat(sessionId, t.content, lang)
    } catch (e) {
      bugEvents.push({ turn: turnNum, type: 'API_ERROR', actual: e.message })
      turnResults.push({ turn: turnNum, userMsg: t.content, botResp: '', elapsed: 0, passed: false })
      i++; turnNum++; assertionFails++; continue
    }

    const nextBot = turns[i + 1]?.type === 'bot' ? turns[i + 1] : null
    const passed = nextBot ? matchAssertion(cr.response, nextBot.content) : true
    if (!passed) {
      assertionFails++
      bugEvents.push({ turn: turnNum, type: 'ASSERTION_FAIL',
                       assertion: nextBot.content, actual: cr.response.substring(0, 300) })
    }
    detectBugs(cr.response, lang).forEach(b =>
      bugEvents.push({ turn: turnNum, type: b, actual: cr.response.substring(0, 200) }))

    turnResults.push({ turn: turnNum, userMsg: t.content, botResp: cr.response,
                       elapsed: cr.elapsed, passed })
    if (nextBot) i++
    i++; turnNum++
  }

  const times = turnResults.map(r => r.elapsed).filter(e => e > 0)
  return {
    runNum, sessionId,
    passed: assertionFails === 0,
    assertionFails,
    turns: turnResults,
    bugs: bugEvents,
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    totalMs: times.reduce((a, b) => a + b, 0)
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function stats(values) {
  if (!values.length) return { min: 0, avg: 0, max: 0, p95: 0, count: 0 }
  const s = [...values].sort((a, b) => a - b)
  return {
    min: s[0],
    avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    max: s[s.length - 1],
    p95: s[Math.min(Math.floor(s.length * 0.95), s.length - 1)],
    count: s.length
  }
}

// ─── JSON accumulator ─────────────────────────────────────────────────────────

function loadPrevious() {
  if (!fs.existsSync(JSON_FILE)) return null
  try { return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')) } catch { return null }
}

function mergeResults(prev, curr) {
  if (!prev) return curr
  const merged = { batches: [...(prev.batches || [prev.results].filter(Boolean)), curr.results] }
  // Also carry a flat merged view for each lang/scenario
  merged.results = {}
  for (const lang of Object.keys(curr.results)) {
    merged.results[lang] = {}
    for (const name of Object.keys(curr.results[lang])) {
      const prevRuns = prev.results?.[lang]?.[name] || []
      const currRuns = curr.results[lang][name] || []
      // Re-number runs across batches
      const combined = [...prevRuns, ...currRuns].map((r, idx) => ({ ...r, runNum: idx + 1 }))
      merged.results[lang][name] = combined
    }
  }
  return merged
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(combined, newRuns, previousRuns) {
  const W = 118
  const THICK = '═'.repeat(W)
  const THIN  = '─'.repeat(W)
  const lines = []
  const totalRuns = newRuns + previousRuns
  const allResults = combined.results

  lines.push(THICK)
  lines.push('ELFIE CARE — ACCUMULATED TEST REPORT')
  lines.push(`Generated       : ${new Date().toISOString()}`)
  lines.push(`API host        : https://${API_HOST}  [${ENV}]`)
  lines.push(`Languages       : English · French · Vietnamese  |  Scenarios : 11 per language`)
  lines.push(`Previous runs   : ${previousRuns}  |  New runs this session : ${newRuns}  |  Total accumulated : ${totalRuns} runs`)
  lines.push(THICK)
  lines.push('')

  // ── Pass-rate table ──
  lines.push(`PASS RATE SUMMARY — ${totalRuns} ACCUMULATED RUNS`)
  lines.push(THIN)
  lines.push(`${'Scenario'.padEnd(42)} ${'EN'.padEnd(18)} ${'FR'.padEnd(18)} ${'VI'.padEnd(18)}`)
  lines.push(THIN)

  let totalPass = 0, totalTotal = 0
  for (const file of CONVO_FILES) {
    const name = file.replace('.convo.txt', '')
    const row = [name.padEnd(42)]
    for (const lang of ['en', 'fr', 'vi']) {
      const runs = allResults[lang]?.[name] || []
      const pass = runs.filter(r => r.passed).length
      totalPass += pass; totalTotal += runs.length
      const pct = runs.length ? Math.round(pass / runs.length * 100) : 0
      row.push(`${pass}/${runs.length} (${pct}%)`.padEnd(18))
    }
    lines.push(row.join(' '))
  }
  lines.push(THIN)
  lines.push(`${'OVERALL'.padEnd(42)} ${`${totalPass}/${totalTotal} (${Math.round(totalPass/totalTotal*100)}%)`.padEnd(54)}`)
  lines.push('')

  // ── Response time by language ──
  lines.push(`RESPONSE TIME PER LANGUAGE — ${totalRuns} RUNS COMBINED (ms, all turns)`)
  lines.push(THIN)
  lines.push(`${'Language'.padEnd(16)} ${'Turns'.padEnd(10)} ${'Min'.padEnd(10)} ${'Avg'.padEnd(10)} ${'Max'.padEnd(10)} ${'P95'.padEnd(10)} Note`)
  lines.push(THIN)
  for (const lang of LANGUAGES) {
    const times = []
    for (const runs of Object.values(allResults[lang.code] || {}))
      for (const r of runs) for (const t of r.turns) if (t.elapsed > 0) times.push(t.elapsed)
    const s = stats(times)
    lines.push(`${lang.label.padEnd(16)} ${String(s.count).padEnd(10)} ${(s.min+'ms').padEnd(10)} ${(s.avg+'ms').padEnd(10)} ${(s.max+'ms').padEnd(10)} ${(s.p95+'ms').padEnd(10)}`)
  }
  lines.push('')

  // ── Comparison: previous vs new ──
  lines.push('RESPONSE TIME COMPARISON — PREVIOUS 5 RUNS vs NEW 10 RUNS')
  lines.push(THIN)
  lines.push(`${'Language'.padEnd(16)} ${'Prev avg (5 runs)'.padEnd(22)} ${'New avg (10 runs)'.padEnd(22)} ${'Delta'}`)
  lines.push(THIN)
  // Previous 5: hardcoded from prior report (EN:156, FR:169, VI:163)
  const prevAvg = { en: 156, fr: 169, vi: 163 }
  for (const lang of LANGUAGES) {
    const newRuns10 = []
    const allRns = allResults[lang.code] || {}
    for (const runs of Object.values(allRns))
      for (const r of runs.slice(previousRuns)) // only new runs
        for (const t of r.turns) if (t.elapsed > 0) newRuns10.push(t.elapsed)
    const ns = stats(newRuns10)
    const delta = ns.avg - prevAvg[lang.code]
    const deltaStr = (delta >= 0 ? '+' : '') + delta + 'ms'
    lines.push(`${lang.label.padEnd(16)} ${(prevAvg[lang.code]+'ms').padEnd(22)} ${(ns.avg+'ms').padEnd(22)} ${deltaStr}`)
  }
  lines.push('')

  // ── Per-scenario timing ──
  lines.push(`RESPONSE TIME BY SCENARIO — ${totalRuns} RUNS`)
  lines.push(THIN)
  lines.push(`${'Scenario'.padEnd(38)} ${'Lang'.padEnd(6)} ${'Turns'.padEnd(8)} ${'Min'.padEnd(10)} ${'Avg'.padEnd(10)} ${'Max'.padEnd(10)} P95`)
  lines.push(THIN)
  for (const file of CONVO_FILES) {
    const name = file.replace('.convo.txt', '')
    for (const lang of LANGUAGES) {
      const runs = allResults[lang.code]?.[name] || []
      const times = runs.flatMap(r => r.turns.map(t => t.elapsed).filter(e => e > 0))
      if (!times.length) continue
      const s = stats(times)
      lines.push(`${name.padEnd(38)} ${lang.code.toUpperCase().padEnd(6)} ${String(s.count).padEnd(8)} ${(s.min+'ms').padEnd(10)} ${(s.avg+'ms').padEnd(10)} ${(s.max+'ms').padEnd(10)} ${s.p95}ms`)
    }
    lines.push('')
  }

  // ── Bug summary ──
  lines.push(THICK)
  lines.push(`POTENTIAL BUGS — ${totalRuns} ACCUMULATED RUNS`)
  lines.push(THICK)

  for (const lang of LANGUAGES) {
    const bugCounts = {}
    const affected = new Set()

    for (const file of CONVO_FILES) {
      const name = file.replace('.convo.txt', '')
      const runs = allResults[lang.code]?.[name] || []
      for (const run of runs) {
        for (const bug of (run.bugs || [])) {
          if (bug.type === 'ASSERTION_FAIL') continue
          bugCounts[bug.type] = (bugCounts[bug.type] || 0) + 1
          affected.add(name)
        }
      }
    }

    const total = Object.values(bugCounts).reduce((a, b) => a + b, 0)
    if (total === 0) {
      lines.push(`\n${lang.label.toUpperCase()}: No bugs detected across all ${totalRuns} runs`)
    } else {
      lines.push(`\n${lang.label.toUpperCase()} — ${total} bug events across ${totalRuns} runs:`)
      for (const [type, count] of Object.entries(bugCounts)) {
        const rate = Math.round(count / totalRuns * 100)
        lines.push(`  ${type.padEnd(35)} ${count} events  (${rate}% of runs)`)
      }
      lines.push(`  Affected scenarios: ${[...affected].join(', ')}`)

      // Detail: per-scenario bug rate
      lines.push(`\n  Per-scenario breakdown:`)
      lines.push(`  ${'Scenario'.padEnd(38)} ${'Bug type'.padEnd(30)} ${'Hits'.padEnd(8)} Rate`)
      lines.push(`  ${'─'.repeat(90)}`)
      for (const file of CONVO_FILES) {
        const name = file.replace('.convo.txt', '')
        const runs = allResults[lang.code]?.[name] || []
        const bugMap = {}
        for (const run of runs)
          for (const b of (run.bugs || []))
            if (b.type !== 'ASSERTION_FAIL') bugMap[b.type] = (bugMap[b.type] || 0) + 1
        for (const [type, count] of Object.entries(bugMap)) {
          const runsWithBug = runs.filter(r => r.bugs.some(b => b.type === type)).length
          lines.push(`  ${name.padEnd(38)} ${type.padEnd(30)} ${String(count).padEnd(8)} ${runsWithBug}/${runs.length} runs (${Math.round(runsWithBug/runs.length*100)}%)`)
        }
      }

      // Full log of individual events
      lines.push(`\n  Full event log:`)
      for (const file of CONVO_FILES) {
        const name = file.replace('.convo.txt', '')
        const runs = allResults[lang.code]?.[name] || []
        for (const run of runs) {
          for (const bug of (run.bugs || [])) {
            if (bug.type === 'ASSERTION_FAIL') continue
            lines.push(`  ⚠ ${name} Run ${run.runNum} Turn ${bug.turn} [${bug.type}]`)
            if (bug.actual) lines.push(`      ${bug.actual.replace(/\n/g, ' ').substring(0, 120)}`)
          }
        }
      }
    }
  }

  lines.push('')
  lines.push(THIN)
  const total = (() => {
    let n = 0
    for (const lang of LANGUAGES)
      for (const runs of Object.values(allResults[lang.code] || {}))
        for (const r of runs) n += (r.bugs || []).filter(b => b.type !== 'ASSERTION_FAIL').length
    return n
  })()
  lines.push(`Total bug events: ${total}`)
  lines.push(THIN)
  lines.push('')
  lines.push(THICK)
  lines.push('END OF REPORT')
  lines.push(THICK)
  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Elfie Care — Full Test Runner  (${RUNS} new runs)`)
  console.log(`Live HTTPS → ${API_HOST}  [${ENV}]\n`)

  const newResults = {}
  for (const lang of LANGUAGES) {
    newResults[lang.code] = {}
    console.log(`\n${'═'.repeat(60)}\n  ${lang.label.toUpperCase()}\n${'═'.repeat(60)}`)
    for (const file of CONVO_FILES) {
      const convoPath = path.join(lang.dir, file)
      if (!fs.existsSync(convoPath)) continue
      const turns = parseConvo(convoPath)
      const name = file.replace('.convo.txt', '')
      const scenarioRuns = []
      process.stdout.write(`  ${name.padEnd(34)} (${turns.filter(t=>t.type==='me').length+1}t)  `)
      for (let r = 1; r <= RUNS; r++) {
        try {
          const run = await runScenario(lang.code, turns, r)
          scenarioRuns.push(run)
          process.stdout.write(run.passed ? '✓' : '✗')
        } catch (e) {
          scenarioRuns.push({ runNum: r, passed: false, turns: [], bugs: [{ turn: 0, type: 'FATAL', actual: e.message }], avgMs: 0, totalMs: 0 })
          process.stdout.write('E')
        }
      }
      const pass = scenarioRuns.filter(r => r.passed).length
      const times = scenarioRuns.flatMap(r => r.turns.map(t => t.elapsed).filter(e => e > 0))
      const avgMs = times.length ? Math.round(times.reduce((a,b)=>a+b,0)/times.length) : 0
      console.log(`  ${pass}/${RUNS}  avg ${avgMs}ms/turn`)
      newResults[lang.code][name] = scenarioRuns
    }
  }

  // Accumulate with previous
  const prev = loadPrevious()
  const previousRuns = prev ? (prev.runCount || 5) : 0
  const combined = mergeResults(prev, { results: newResults })
  combined.runCount = previousRuns + RUNS

  // Save updated JSON
  fs.writeFileSync(JSON_FILE, JSON.stringify(combined, null, 2), 'utf8')
  console.log(`\nResults saved → ${JSON_FILE}`)

  // Build report
  const report = buildReport(combined, RUNS, previousRuns)
  const outFile = 'full-test-report.txt'
  fs.writeFileSync(outFile, report, 'utf8')
  console.log(`Report saved  → ${outFile}  (${(Buffer.byteLength(report)/1024).toFixed(1)} KB)`)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
