/**
 * AI Coach test runner
 * Captures every request/response turn, checks assertions, detects bugs.
 * Output: aicoach-report.txt + aicoach-results.json
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const CONVO_BASE = path.join(__dirname, 'test/convo/aiCoach')
const RUNS = parseInt(process.argv[2] || '1', 10)
const ENV = (process.argv[3] || process.env.ELFIE_ENV || 'staging').toLowerCase()
const API_KEY = process.env.ELFIE_API_KEY || ''
const API_TIMEOUT_MS = 90000

const ENVS = {
  staging: { host: 'api.stg.elfie.co' },
  prod:    { host: 'api.elfie.co' }
}
const { host: API_HOST } = ENVS[ENV] || ENVS.staging

const CONVO_FILES = [
  '01_greeting.convo.txt',
  '02_blood_sugar.convo.txt',
  '03_blood_pressure.convo.txt',
  '04_hydration.convo.txt',
  '05_weight.convo.txt',
  '06_exercise.convo.txt',
  '07_medication.convo.txt',
  '08_symptom.convo.txt',
  '09_cholesterol.convo.txt',
  '10_general_advice.convo.txt'
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
  return pattern.split('|').some(p => new RegExp(p.trim(), 'i').test(response))
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function apiCall(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const t0 = Date.now()
    const req = https.request({
      hostname: API_HOST,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(payload)
      }
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
  const requestBody = { user_id: 'botium-test', language_code: lang }
  const r = await apiCall('/agent/api/v1/ai-coach/create-session', requestBody)
  return { sessionId: r.body.sessionId || r.body.session_id, elapsed: r.elapsed, requestBody, responseBody: r.body }
}

async function chat(sessionId, message, lang) {
  const requestBody = { session_id: sessionId, message, language_code: lang, user_id: 'botium-test' }
  const r = await apiCall('/agent/api/v1/ai-coach/chat', requestBody)
  // medication returns { code, payload } instead of { message, suggestActions }
  const response = (r.body.message || r.body.code || '').trim()
  return {
    response,
    suggestActions: r.body.suggestActions || [],
    elapsed: r.elapsed,
    status: r.status,
    requestBody,
    responseBody: r.body
  }
}

// ─── Bug detectors ────────────────────────────────────────────────────────────

function detectBugs(response, suggestActions, responseBody) {
  const bugs = []
  // backend search intent is a valid non-message response shape — not a bug
  if (!response && !responseBody?.code) { bugs.push('EMPTY_RESPONSE'); return bugs }
  if (response && response.length < 10 && !responseBody?.code) bugs.push('SUSPICIOUSLY_SHORT_RESPONSE')

  // Check for untranslated / mixed-language artifacts
  if (/voici la traduction/i.test(response)) bugs.push('TRANSLATION_ARTIFACT')

  // Check for repeated onboarding prompt (bot stuck in loop)
  if (/main health goal|area you.re focusing/i.test(response)) bugs.push('STUCK_IN_ONBOARDING')

  // Check for action extraction mismatch (bot says it logged but no suggestAction returned)
  const logKeywords = /recorded|logged|noted|updated|saved|added/i
  if (logKeywords.test(response) && suggestActions.length === 0) {
    bugs.push('CLAIMED_LOG_NO_ACTION_RETURNED')
  }

  // Check for error bleed-through
  if (/error|exception|traceback|500|internal server/i.test(response)) bugs.push('ERROR_IN_RESPONSE')

  return bugs
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

async function runScenario(lang, turns, runNum, convoName) {
  const session = await createSession(lang)
  const sessionId = session.sessionId

  const turnResults = []
  const bugEvents = []
  let assertionFails = 0

  let i = 0
  let turnNum = 1

  while (i < turns.length) {
    const t = turns[i]
    if (t.type !== 'me') { i++; continue }

    const requestBody = { session_id: sessionId, message: t.content, language_code: lang, user_id: 'botium-test' }
    let cr
    try {
      cr = await chat(sessionId, t.content, lang)
    } catch (e) {
      bugEvents.push({ turn: turnNum, type: 'API_ERROR', actual: e.message })
      turnResults.push({
        turn: turnNum, userMsg: t.content, botResp: '', elapsed: 0, passed: false,
        requestBody, responseBody: null, assertion: null, suggestActions: []
      })
      i++; turnNum++; assertionFails++; continue
    }

    const nextBot = turns[i + 1]?.type === 'bot' ? turns[i + 1] : null
    const passed = nextBot ? matchAssertion(cr.response, nextBot.content) : true

    if (!passed) {
      assertionFails++
      bugEvents.push({
        turn: turnNum, type: 'ASSERTION_FAIL',
        assertion: nextBot.content, actual: cr.response
      })
    }

    detectBugs(cr.response, cr.suggestActions, cr.responseBody).forEach(b =>
      bugEvents.push({ turn: turnNum, type: b, actual: cr.response.substring(0, 300) }))

    turnResults.push({
      turn: turnNum,
      userMsg: t.content,
      botResp: cr.response,
      elapsed: cr.elapsed,
      passed,
      assertion: nextBot ? nextBot.content : null,
      requestBody: cr.requestBody,
      responseBody: cr.responseBody,
      suggestActions: cr.suggestActions
    })

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
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0
  }
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(allResults, totalRuns) {
  const W = 120
  const THICK = '═'.repeat(W)
  const THIN  = '─'.repeat(W)
  const lines = []

  lines.push(THICK)
  lines.push('ELFIE CARE — AI COACH TEST REPORT')
  lines.push(`Generated : ${new Date().toISOString()}`)
  lines.push(`API host  : https://${API_HOST}  [${ENV}]`)
  lines.push(`Scenarios : ${CONVO_FILES.length}  |  Runs : ${totalRuns}`)
  lines.push(THICK)
  lines.push('')

  // ── Pass/fail summary ──
  lines.push('PASS / FAIL SUMMARY')
  lines.push(THIN)
  lines.push(`${'Scenario'.padEnd(40)} ${'Result'.padEnd(12)} ${'Avg resp (ms)'.padEnd(18)} Bugs`)
  lines.push(THIN)

  let totalPass = 0
  for (const file of CONVO_FILES) {
    const name = file.replace('.convo.txt', '')
    const runs = allResults[name] || []
    const pass = runs.filter(r => r.passed).length
    totalPass += pass
    const avgMs = runs.length
      ? Math.round(runs.flatMap(r => r.turns.map(t => t.elapsed).filter(e => e > 0)).reduce((a, b) => a + b, 0) /
          runs.flatMap(r => r.turns.map(t => t.elapsed).filter(e => e > 0)).length || 0)
      : 0
    const bugCount = runs.reduce((n, r) => n + (r.bugs || []).filter(b => b.type !== 'ASSERTION_FAIL').length, 0)
    const resultStr = `${pass}/${runs.length} ${pass === runs.length ? '✓' : '✗'}`
    lines.push(`${name.padEnd(40)} ${resultStr.padEnd(12)} ${(avgMs + 'ms').padEnd(18)} ${bugCount > 0 ? bugCount + ' bug(s)' : '-'}`)
  }
  lines.push(THIN)
  lines.push(`${'OVERALL'.padEnd(40)} ${totalPass}/${CONVO_FILES.length * totalRuns}`)
  lines.push('')

  // ── Full turn-by-turn transcript ──
  lines.push(THICK)
  lines.push('FULL TRANSCRIPT — REQUEST & RESPONSE PER TURN')
  lines.push(THICK)

  for (const file of CONVO_FILES) {
    const name = file.replace('.convo.txt', '')
    const runs = allResults[name] || []

    for (const run of runs) {
      lines.push('')
      lines.push(`┌${'─'.repeat(W - 2)}┐`)
      lines.push(`│ SCENARIO: ${name.padEnd(W - 14)}│`)
      lines.push(`│ Session : ${String(run.sessionId).padEnd(W - 14)}│`)
      lines.push(`│ Result  : ${(run.passed ? '✓ PASSED' : '✗ FAILED').padEnd(W - 14)}│`)
      lines.push(`└${'─'.repeat(W - 2)}┘`)

      for (const turn of run.turns) {
        lines.push('')
        lines.push(`  ── Turn ${turn.turn} ${'─'.repeat(W - 12)}`)
        lines.push(`  REQUEST  → ${turn.userMsg}`)
        lines.push(`  RESPONSE ← ${turn.botResp || '(empty)'}`)
        if (turn.suggestActions && turn.suggestActions.length > 0) {
          lines.push(`  ACTIONS  : ${turn.suggestActions.map(a => `[${a.type}] ${JSON.stringify(a.extractedData)}`).join(' | ')}`)
        }
        lines.push(`  TIMING   : ${turn.elapsed}ms`)
        if (turn.assertion) {
          lines.push(`  ASSERT   : ${turn.passed ? '✓' : '✗'} pattern: ${turn.assertion}`)
        }
        if (!turn.passed && turn.assertion) {
          lines.push(`  !! FAIL  : Response did not match assertion`)
        }
      }

      if (run.bugs && run.bugs.filter(b => b.type !== 'ASSERTION_FAIL').length > 0) {
        lines.push('')
        lines.push(`  POTENTIAL BUGS:`)
        for (const bug of run.bugs.filter(b => b.type !== 'ASSERTION_FAIL')) {
          lines.push(`  ⚠ [${bug.type}] Turn ${bug.turn}: ${(bug.actual || '').substring(0, 200)}`)
        }
      }
    }
  }

  // ── Bug summary ──
  lines.push('')
  lines.push(THICK)
  lines.push('POTENTIAL BUGS SUMMARY')
  lines.push(THICK)

  const bugCounts = {}
  const bugsByScenario = {}
  for (const file of CONVO_FILES) {
    const name = file.replace('.convo.txt', '')
    const runs = allResults[name] || []
    for (const run of runs) {
      for (const bug of (run.bugs || [])) {
        if (bug.type === 'ASSERTION_FAIL') continue
        bugCounts[bug.type] = (bugCounts[bug.type] || 0) + 1
        if (!bugsByScenario[name]) bugsByScenario[name] = {}
        bugsByScenario[name][bug.type] = (bugsByScenario[name][bug.type] || 0) + 1
      }
    }
  }

  const totalBugs = Object.values(bugCounts).reduce((a, b) => a + b, 0)
  if (totalBugs === 0) {
    lines.push('No potential bugs detected.')
  } else {
    lines.push(`${totalBugs} potential bug event(s) detected:`)
    lines.push('')
    lines.push(`${'Bug type'.padEnd(40)} ${'Count'.padEnd(10)} Affected scenarios`)
    lines.push(THIN)
    for (const [type, count] of Object.entries(bugCounts)) {
      const affected = Object.entries(bugsByScenario)
        .filter(([, v]) => v[type])
        .map(([k]) => k)
        .join(', ')
      lines.push(`${type.padEnd(40)} ${String(count).padEnd(10)} ${affected}`)
    }

    lines.push('')
    lines.push('CLAIMED_LOG_NO_ACTION_RETURNED explanation:')
    lines.push('  Bot said it recorded/logged data but no suggestAction was returned in the response.')
    lines.push('  This may indicate the extraction pipeline did not detect structured data from the message.')
  }

  lines.push('')
  lines.push(THICK)
  lines.push('END OF REPORT')
  lines.push(THICK)
  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Elfie Care — AI Coach Test Runner  (${RUNS} run(s))`)
  console.log(`Live HTTPS → ${API_HOST}  [${ENV}]\n`)

  if (!API_KEY) {
    console.error('ERROR: ELFIE_API_KEY is not set')
    process.exit(1)
  }

  const allResults = {}

  for (const file of CONVO_FILES) {
    const convoPath = path.join(CONVO_BASE, 'en', file)
    if (!fs.existsSync(convoPath)) {
      console.log(`  SKIP (not found): ${file}`)
      continue
    }
    const turns = parseConvo(convoPath)
    const name = file.replace('.convo.txt', '')
    allResults[name] = []

    process.stdout.write(`  ${name.padEnd(36)} `)
    for (let r = 1; r <= RUNS; r++) {
      try {
        const run = await runScenario('en', turns, r, name)
        allResults[name].push(run)
        process.stdout.write(run.passed ? '✓' : '✗')
      } catch (e) {
        allResults[name].push({
          runNum: r, passed: false, turns: [], bugs: [{ turn: 0, type: 'FATAL', actual: e.message }], avgMs: 0
        })
        process.stdout.write('E')
      }
    }
    const pass = allResults[name].filter(r => r.passed).length
    console.log(`  ${pass}/${RUNS}`)
  }

  const report = buildReport(allResults, RUNS)
  fs.writeFileSync('aicoach-report.txt', report, 'utf8')
  fs.writeFileSync('aicoach-results.json', JSON.stringify(allResults, null, 2), 'utf8')

  console.log(`\nReport saved → aicoach-report.txt`)
  console.log(`JSON saved   → aicoach-results.json`)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
