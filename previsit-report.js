#!/usr/bin/env node
/**
 * Pre-Visit Agent — Detailed Test Report
 * Shows every API request and response for all 10 scenarios.
 * Usage: ELFIE_API_KEY=<key> node previsit-report.js [staging|prod] [en|fr|vi]
 */
const https = require('https')
const fs    = require('fs')
const path  = require('path')

const ENV     = (process.argv[2] || process.env.ELFIE_ENV || 'staging').toLowerCase()
const LANG    = (process.argv[3] || process.env.TEST_LANGUAGE || 'en').toLowerCase()
const API_KEY = process.env.ELFIE_API_KEY || ''

const ENVS = {
  staging: { host: 'api.stg.elfie.co' },
  prod:    { host: 'api.elfie.co' }
}
const { host: API_HOST } = ENVS[ENV] || ENVS.staging
const CONVO_DIR = path.join(__dirname, 'test/convo/previsit', LANG)

// ─── Per-scenario domain configuration ───────────────────────────────────────
const ALL_DOMAINS = [
  'Visit Context','Symptoms & Complaint','Medical History','Medication & Treatment',
  'Monitoring & Metrics','Lifestyle & Behavior','Mental & Emotional','Exposure Risk','Administrative'
]
const SCENARIO_DOMAINS = {
  '01_opening':         ['Visit Context'],
  '02_identity':        ['Visit Context'],
  '03_visit_context':   ['Visit Context'],
  '04_symptoms':        ['Visit Context','Symptoms & Complaint'],
  '05_medical_history': ['Visit Context','Medical History'],
  '06_medication':      ['Visit Context','Medication & Treatment'],
  '07_lifestyle':       ['Visit Context','Lifestyle & Behavior'],
  '08_mental_emotional':['Visit Context','Mental & Emotional'],
  '09_closing':         ALL_DOMAINS,
  '10_uncertain_answers':['Visit Context','Symptoms & Complaint'],
}

const SCENARIOS = [
  '01_opening','02_identity','03_visit_context','04_symptoms','05_medical_history',
  '06_medication','07_lifestyle','08_mental_emotional','09_closing','10_uncertain_answers'
]

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request({
      hostname: API_HOST, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ─── Convo file parser ────────────────────────────────────────────────────────
function parseConvo(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const turns = []
  let type = null, buf = []

  const flush = () => {
    const content = buf.join('\n').trim()
    if (type && content) turns.push({ type, content })
    buf = []
  }

  let title = ''
  for (const [i, line] of lines.entries()) {
    if (i === 0) { title = line.trim(); continue }
    if (line.trim() === '#bot') { flush(); type = 'bot' }
    else if (line.trim() === '#me') { flush(); type = 'me' }
    else buf.push(line)
  }
  flush()
  return { title, turns }
}

// ─── Pattern matcher (same logic as Botium regexpIgnoreCase) ─────────────────
function matches(pattern, text) {
  try { return new RegExp(pattern, 'i').test(text) }
  catch { return text.toLowerCase().includes(pattern.toLowerCase()) }
}

// ─── Run one scenario ─────────────────────────────────────────────────────────
async function runScenario(name) {
  const domains  = SCENARIO_DOMAINS[name] || ALL_DOMAINS
  const convoFile = path.join(CONVO_DIR, `${name}.convo.txt`)
  const { title, turns } = parseConvo(convoFile)

  const result = { name, title, domains, turns: [], passed: true, error: null }

  // ── Create session ──
  const createBody = {
    user_id: 'botium-test-user', language_code: LANG,
    config: {
      patient_info: { name: 'Test User' }, use_case: 'pre-visit',
      domains, doctor_language_code: LANG, clinic_name: ''
    }
  }
  const createResp = await postJSON('/agent/api/v1/ai-coach/create-session', createBody)
  const sessionId = createResp.body.sessionId || createResp.body.session_id

  result.createSession = {
    request:  { url: `https://${API_HOST}/agent/api/v1/ai-coach/create-session`, body: createBody },
    response: { status: createResp.status, body: createResp.body }
  }

  if (!sessionId) {
    result.passed = false
    result.error = `No sessionId in create-session response: ${JSON.stringify(createResp.body)}`
    return result
  }

  // ── Init: "start conversation" ──
  const initBody = { session_id: sessionId, user_id: 'botium-test-user', message: 'start conversation', language_code: LANG }
  const initResp = await postJSON('/agent/api/v1/ai-coach/chat', initBody)
  const initMsg  = initResp.body.message || ''

  result.turns.push({
    step: 0, me: 'start conversation',
    request: { url: `https://${API_HOST}/agent/api/v1/ai-coach/chat`, body: initBody },
    response: { status: initResp.status, body: initResp.body },
    botMessage: initMsg, expectedPattern: null, matched: true
  })

  // ── Walk convo turns ──
  let botBuffer = initMsg  // first bot message from init
  let stepNum   = 1

  for (const turn of turns) {
    if (turn.type === 'bot') {
      // Check the buffered bot message against the expected pattern
      const expectedPattern = turn.content
      const ok = botBuffer !== null ? matches(expectedPattern, botBuffer) : true
      if (!ok && !result.error) {
        result.passed = false
        result.error  = `Step ${stepNum}: expected pattern "${expectedPattern}" but got "${botBuffer}"`
      }
      // tag the last turn entry with this expectation check
      if (result.turns.length) {
        const last = result.turns[result.turns.length - 1]
        last.expectedPattern = expectedPattern
        last.matched = ok
      }
      botBuffer = null
    } else {
      // Send user message
      const userMsg  = turn.content
      const chatBody = { session_id: sessionId, user_id: 'botium-test-user', message: userMsg, language_code: LANG }
      const chatResp = await postJSON('/agent/api/v1/ai-coach/chat', chatBody)
      const botMsg   = chatResp.body.message || ''

      result.turns.push({
        step: stepNum++, me: userMsg,
        request: { url: `https://${API_HOST}/agent/api/v1/ai-coach/chat`, body: chatBody },
        response: { status: chatResp.status, body: chatResp.body },
        botMessage: botMsg, expectedPattern: null, matched: true
      })
      botBuffer = botMsg
    }
  }

  return result
}

// ─── Render report ────────────────────────────────────────────────────────────
function renderReport(results) {
  const now    = new Date().toISOString()
  const passed = results.filter(r => r.passed).length
  const total  = results.length
  const lines  = []

  const hr = (ch = '─', n = 80) => ch.repeat(n)

  lines.push(hr('═'))
  lines.push(`  PRE-VISIT AGENT — DETAILED TEST REPORT`)
  lines.push(`  Environment : ${ENV.toUpperCase()}  (${API_HOST})`)
  lines.push(`  Language    : ${LANG.toUpperCase()}`)
  lines.push(`  Timestamp   : ${now}`)
  lines.push(`  Result      : ${passed}/${total} PASSED`)
  lines.push(hr('═'))

  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL'
    lines.push('')
    lines.push(hr('─'))
    lines.push(`${status}  ${r.name}  —  ${r.title}`)
    lines.push(`Domains : ${r.domains.join(', ')}`)
    lines.push(hr('─'))

    // Create-session exchange
    lines.push('')
    lines.push('  [CREATE SESSION]')
    lines.push(`  POST ${r.createSession.request.url}`)
    lines.push('  REQUEST BODY:')
    lines.push(JSON.stringify(r.createSession.request.body, null, 4).split('\n').map(l => '    ' + l).join('\n'))
    lines.push(`  RESPONSE ${r.createSession.response.status}:`)
    lines.push(JSON.stringify(r.createSession.response.body, null, 4).split('\n').map(l => '    ' + l).join('\n'))

    // Chat turns
    for (const t of r.turns) {
      lines.push('')
      lines.push(`  ── Step ${t.step} ──`)
      lines.push(`  POST ${t.request.url}`)
      lines.push('  REQUEST BODY:')
      lines.push(JSON.stringify(t.request.body, null, 4).split('\n').map(l => '    ' + l).join('\n'))
      lines.push(`  RESPONSE ${t.response.status}:`)
      lines.push(JSON.stringify(t.response.body, null, 4).split('\n').map(l => '    ' + l).join('\n'))
      lines.push(`  BOT MESSAGE : ${t.botMessage || '(empty)'}`)
      if (t.expectedPattern !== null) {
        const tag = t.matched ? '✅' : '❌'
        lines.push(`  EXPECTED    : ${tag} matches /${t.expectedPattern}/i`)
      }
    }

    if (r.error) {
      lines.push('')
      lines.push(`  ⚠ FAILURE: ${r.error}`)
    }
  }

  lines.push('')
  lines.push(hr('═'))
  lines.push(`  SUMMARY: ${passed}/${total} scenarios passed`)
  lines.push(hr('═'))
  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  console.log(`Running Pre-Visit Agent tests against ${ENV} (${API_HOST})…\n`)

  const results = []
  for (const name of SCENARIOS) {
    process.stdout.write(`  ${name}… `)
    try {
      const r = await runScenario(name)
      results.push(r)
      console.log(r.passed ? '✅' : `❌  ${r.error}`)
    } catch (err) {
      console.log(`💥  ${err.message}`)
      results.push({ name, title: name, domains: [], turns: [], createSession: { request: {}, response: {} }, passed: false, error: err.message })
    }
  }

  const report = renderReport(results)
  const outFile = path.join(__dirname, `previsit-test-report-${LANG}.txt`)
  fs.writeFileSync(outFile, report, 'utf8')

  console.log(`\nReport saved → ${outFile}`)
  console.log(report)
})()
