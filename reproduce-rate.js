/**
 * Bug reproduction rate tracker — runs each bug scenario 5× and reports hit rate.
 */
const https = require('https')
const fs = require('fs')

async function apiCall(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request({
      hostname: 'care.stg.elfie.co', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': '', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch (e) { resolve({ status: res.statusCode, body: { raw: data } }) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function createSession(lang) {
  const r = await apiCall('/api/v1/ai-chat/create-session', {
    userId: 'botium-test', languageCode: lang,
    config: { patient_info: { name: 'Test User' }, use_case: 'pre-visit', domains: [], doctorLanguageCode: lang, clinicName: '', slug: 'kate-practice-2f3h' }
  })
  return r.body.sessionId
}

async function chat(sessionId, message, lang) {
  const r = await apiCall('/api/v1/ai-chat/chat', { sessionId, message, languageCode: lang, userId: 'botium-test' })
  return r.body.message || ''
}

// ─── Bug 1: FR "Voici la traduction" wrapper on completed message ─────────────
// Trigger: FR session → name → age → gender → complaint
async function runBug1(run) {
  const sid = await createSession('fr')
  await chat(sid, 'start conversation', 'fr')
  await chat(sid, 'Test User', 'fr')
  await chat(sid, '35', 'fr')
  await chat(sid, 'Femme', 'fr')
  const response = await chat(sid, "J'ai mal dans le bas du dos depuis trois jours", 'fr')
  const triggered = response.includes('Voici la traduction') || response.includes('traduction en français')
  return { run, sessionId: sid, triggered, response }
}

// ─── Bug 2a: FR premature completion — "completed" fires before full intake ───
// Trigger: FR session → name → age → gender → complaint → check response
// Also checks if bot responds to follow-up (conditions) showing session is still alive
async function runBug2FR(run) {
  const sid = await createSession('fr')
  await chat(sid, 'start conversation', 'fr')
  await chat(sid, 'Test User', 'fr')
  await chat(sid, '45', 'fr')
  await chat(sid, 'Homme', 'fr')
  const complaintResp = await chat(sid, "J'ai une éruption sur le bras depuis cinq jours", 'fr')
  const completedPhrase = 'vous avez rempli toutes les informations'
  const downloadPhrase = 'téléchargez le résumé'
  const triggered = complaintResp.toLowerCase().includes(completedPhrase) ||
                    complaintResp.toLowerCase().includes(downloadPhrase)
  return { run, sessionId: sid, triggered, response: complaintResp }
}

// ─── Bug 2b: VI premature completion ─────────────────────────────────────────
async function runBug2VI(run) {
  const sid = await createSession('vi')
  await chat(sid, 'start conversation', 'vi')
  await chat(sid, 'Test User', 'vi')
  await chat(sid, '45', 'vi')
  await chat(sid, 'Nam', 'vi')
  const complaintResp = await chat(sid, 'Tôi bị phát ban trên cánh tay năm ngày nay', 'vi')
  const triggered = complaintResp.includes('hoàn tất') || complaintResp.includes('tải xuống')
  return { run, sessionId: sid, triggered, response: complaintResp }
}

// ─── Bug 3: VI age step skipped — bot asks gender immediately after name ──────
// The bug: in Vietnamese, the bot response to the NAME message sometimes already
// asks for gender ("giới tính"), meaning it skipped the age collection step.
// In English and French the bot says "thanks" after name and waits for age first.
// Control: run the same check on EN and FR to confirm they don't skip age.
async function runBug3(run) {
  // EN control — should NOT skip age
  const enSid = await createSession('en')
  await chat(enSid, 'start conversation', 'en')
  const enAfterName = await chat(enSid, 'Sarah Test', 'en')
  const enSkipsAge = /\bgender\b/i.test(enAfterName)

  // FR control — should NOT skip age
  const frSid = await createSession('fr')
  await chat(frSid, 'start conversation', 'fr')
  const frAfterName = await chat(frSid, 'Sarah Test', 'fr')
  const frSkipsAge = /\bgenre\b/i.test(frAfterName)

  // VI — this is where the bug appears
  const viSid = await createSession('vi')
  await chat(viSid, 'start conversation', 'vi')
  const viAfterName = await chat(viSid, 'Sarah Test', 'vi')
  const viSkipsAge = /giới tính/i.test(viAfterName)

  // Triggered = VI skips age (asks gender in name response) while EN/FR do not
  const triggered = viSkipsAge
  return {
    run,
    triggered,
    en: { sessionId: enSid, skipsAge: enSkipsAge, afterName: enAfterName.split('\n')[0].substring(0, 120) },
    fr: { sessionId: frSid, skipsAge: frSkipsAge, afterName: frAfterName.split('\n')[0].substring(0, 120) },
    vi: { sessionId: viSid, skipsAge: viSkipsAge, afterName: viAfterName.substring(0, 200) }
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runN(label, fn, n = 5) {
  console.log(`\n  Running ${label} × ${n}...`)
  const results = []
  for (let i = 1; i <= n; i++) {
    process.stdout.write(`    Run ${i}/${n} ... `)
    const r = await fn(i)
    results.push(r)
    console.log(r.triggered ? '⚠  TRIGGERED' : '✓  clean')
  }
  const hits = results.filter(r => r.triggered).length
  return { label, results, hits, total: n, rate: `${hits}/${n} (${Math.round(hits/n*100)}%)` }
}

// ─── Report formatter ─────────────────────────────────────────────────────────

function formatReport(groups) {
  const THICK = '═'.repeat(100)
  const THIN = '─'.repeat(100)
  const lines = []

  lines.push(THICK)
  lines.push('ELFIE CARE — BUG REPRODUCTION RATE REPORT')
  lines.push(`Generated : ${new Date().toISOString()}`)
  lines.push(`API host  : https://care.stg.elfie.co (staging) — all calls are live HTTPS`)
  lines.push(`Runs each : 5`)
  lines.push(THICK)
  lines.push('')

  // Summary table
  lines.push('REPRODUCTION RATE SUMMARY')
  lines.push(THIN)
  lines.push(`${'Bug'.padEnd(55)} ${'Reproduced'.padEnd(15)} Rate`)
  lines.push(THIN)
  for (const g of groups) {
    lines.push(`${g.label.padEnd(55)} ${String(g.hits + '/' + g.total).padEnd(15)} ${Math.round(g.hits/g.total*100)}%`)
  }
  lines.push(THIN)
  lines.push('')

  // Detailed results per bug
  for (const g of groups) {
    lines.push(THICK)
    lines.push(`${g.label}   [${g.rate}]`)
    lines.push(THICK)
    lines.push('')
    for (const r of g.results) {
      const status = r.triggered ? '⚠  TRIGGERED' : '✓  NOT triggered'
      lines.push(`  Run ${r.run}  ${status}  (sessionId: ${r.sessionId})`)
      if (r.response) {
        lines.push(`  Bot response:`)
        r.response.split('\n').forEach(l => { if (l.trim()) lines.push(`    ${l}`) })
      }
      if (r.en) {
        lines.push(`  EN (sessionId: ${r.en.sessionId})  skips age? ${r.en.skipsAge}`)
        lines.push(`    After NAME: ${r.en.afterName}`)
        lines.push(`  FR (sessionId: ${r.fr.sessionId})  skips age? ${r.fr.skipsAge}`)
        lines.push(`    After NAME: ${r.fr.afterName}`)
        lines.push(`  VI (sessionId: ${r.vi.sessionId})  skips age? ${r.vi.skipsAge}  ← BUG if true`)
        lines.push(`    After NAME: ${r.vi.afterName}`)
      }
      lines.push('')
    }
  }

  lines.push(THICK)
  lines.push('END OF REPORT')
  lines.push(THICK)
  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Elfie Care — Bug Reproduction Rate')
  console.log('Each scenario runs 5× against live staging API\n')

  const groups = []
  groups.push(await runN('Bug 1 — FR translation artifact on completed message', runBug1))
  groups.push(await runN('Bug 2a — FR premature completion after first complaint', runBug2FR))
  groups.push(await runN('Bug 2b — VI premature completion after first complaint', runBug2VI))
  groups.push(await runN('Bug 3  — VI age step skipped or merged after name', runBug3))

  const report = formatReport(groups)
  const outFile = 'bug-reproduction-rate.txt'
  fs.writeFileSync(outFile, report, 'utf8')

  console.log('\n' + '═'.repeat(60))
  console.log('RESULTS SUMMARY')
  console.log('═'.repeat(60))
  for (const g of groups) {
    console.log(`  ${g.rate.padStart(12)}  ${g.label}`)
  }
  console.log('\nFull report: ' + outFile)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
