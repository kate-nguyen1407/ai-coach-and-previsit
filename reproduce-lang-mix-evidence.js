#!/usr/bin/env node
/**
 * Language-mixing bug evidence capture
 *
 * Same logic as reproduce-lang-mix.js but records full HTTP
 * request + response for every session so the backend team has
 * concrete evidence to attach to the bug report.
 *
 * Usage: ELFIE_API_KEY=<key> node reproduce-lang-mix-evidence.js [rounds] [concurrency]
 * Output: lang-mix-evidence-<timestamp>.json
 */

const https = require('https')
const fs    = require('fs')

const API_KEY     = process.env.ELFIE_API_KEY || ''
const API_HOST    = 'api.stg.elfie.co'
const ROUNDS      = parseInt(process.argv[2] || '10')
const CONCURRENCY = parseInt(process.argv[3] || '5')

if (!API_KEY) { console.error('ERROR: ELFIE_API_KEY env var not set'); process.exit(1) }

// ─── HTTP helper (records full req/res) ──────────────────────────────────────
function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const startMs = Date.now()
    const req = https.request({
      hostname: API_HOST, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        const durationMs = Date.now() - startMs
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({
          request: {
            method: 'POST',
            url: `https://${API_HOST}${path}`,
            headers: { 'Content-Type': 'application/json', 'x-api-key': '***' },
            body
          },
          response: {
            status: res.statusCode,
            body: parsed,
            durationMs
          }
        })
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ─── Language fingerprints ────────────────────────────────────────────────────
const VI_EXCLUSIVE = /[ăắằẳẵặơớờởỡợưứừửữựđ]|Chào|Cảm ơn|thăm khám|bạn ơi|khẩn cấp|thông thường/i
const FR_EXCLUSIVE = /Bonjour|Merci|votre nom|prénom|accompagner|Pourriez-vous|s'il vous plaît|êtes-vous/i
const EN_EXCLUSIVE = /Hello|Hi there|your name|welcome|What brings you|How are you feeling/i

function detectLang(text) {
  if (!text || text.trim() === '') return 'empty'
  if (VI_EXCLUSIVE.test(text)) return 'vi'
  if (FR_EXCLUSIVE.test(text)) return 'fr'
  if (EN_EXCLUSIVE.test(text)) return 'en'
  return 'unknown'
}

// ─── Single session probe (records all steps) ────────────────────────────────
async function probe(expectedLang, batchNum, pairIndex) {
  const sessionLabel = `batch${batchNum}-pair${pairIndex}-${expectedLang}`
  const steps = []

  // Step 1 — create session
  const createBody = {
    user_id: 'lang-test',
    language_code: expectedLang,
    config: {
      patient_info: { name: 'Test User' },
      use_case: 'pre-visit',
      domains: ['Visit Context'],
      doctor_language_code: expectedLang,
      clinic_name: ''
    }
  }
  const createStep = await postJSON('/agent/api/v1/ai-coach/create-session', createBody)
  steps.push({ step: 'create-session', ...createStep })

  const sessionId = createStep.response.body.sessionId || createStep.response.body.session_id
  if (!sessionId) {
    return { sessionLabel, expectedLang, sessionId: null, detectedLang: 'error', contaminated: false, steps }
  }

  // Step 2 — init chat
  const initBody = { session_id: sessionId, user_id: 'lang-test', message: 'start conversation', language_code: expectedLang }
  const initStep = await postJSON('/agent/api/v1/ai-coach/chat', initBody)
  steps.push({ step: 'chat-init', ...initStep })
  const initMsg = initStep.response.body.message || ''

  // Step 3 — send name (where contamination most often appears)
  const nameBody = { session_id: sessionId, user_id: 'lang-test', message: 'Test User', language_code: expectedLang }
  const nameStep = await postJSON('/agent/api/v1/ai-coach/chat', nameBody)
  steps.push({ step: 'chat-name', ...nameStep })
  const nameMsg = nameStep.response.body.message || ''

  const botReply    = nameMsg || initMsg
  const detectedLang = detectLang(botReply)
  const contaminated = detectedLang !== 'empty' && detectedLang !== 'unknown' && detectedLang !== expectedLang

  return { sessionLabel, expectedLang, sessionId, detectedLang, contaminated, botReply, steps }
}

// ─── Run one batch ────────────────────────────────────────────────────────────
async function runBatch(batchNum) {
  const tasks = []
  for (let i = 0; i < CONCURRENCY; i++) {
    tasks.push(probe('fr', batchNum, i))
    tasks.push(probe('vi', batchNum, i))
  }
  const results = await Promise.all(tasks)
  const contaminated = results.filter(r => r.contaminated)
  return { batchNum, results, contaminated }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile   = `lang-mix-evidence-${timestamp}.json`

  console.log(`Language-mixing bug evidence capture`)
  console.log(`API    : ${API_HOST}`)
  console.log(`Rounds : ${ROUNDS}  |  Concurrency: ${CONCURRENCY} FR + ${CONCURRENCY} VI = ${CONCURRENCY * 2} parallel sessions/batch`)
  console.log(`Total sessions: ${ROUNDS * CONCURRENCY * 2}`)
  console.log(`Output : ${outFile}\n`)

  const report = {
    meta: {
      api: `https://${API_HOST}`,
      rounds: ROUNDS,
      concurrencyPerLang: CONCURRENCY,
      totalSessions: ROUNDS * CONCURRENCY * 2,
      runAt: new Date().toISOString()
    },
    batches: [],
    summary: { totalSessions: 0, contaminated: 0, contaminatedSessions: [] }
  }

  for (let r = 1; r <= ROUNDS; r++) {
    process.stdout.write(`  Batch ${String(r).padStart(2)}/${ROUNDS} ... `)
    const batch = await runBatch(r)
    report.batches.push(batch)
    report.summary.totalSessions += batch.results.length

    if (batch.contaminated.length > 0) {
      console.log(`CONTAMINATED (${batch.contaminated.length})`)
      for (const c of batch.contaminated) {
        console.log(`    session ${c.sessionId}: expected=${c.expectedLang} got=${c.detectedLang}`)
        console.log(`    reply  : "${c.botReply}"`)
        report.summary.contaminatedSessions.push({
          batch: r, sessionId: c.sessionId,
          expectedLang: c.expectedLang, detectedLang: c.detectedLang,
          botReply: c.botReply, steps: c.steps
        })
      }
      report.summary.contaminated += batch.contaminated.length
    } else {
      console.log('clean')
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

  console.log(`\n${'='.repeat(60)}`)
  console.log(`RESULT : ${report.summary.contaminated} contaminated / ${report.summary.totalSessions} sessions`)
  console.log(`Rate   : ${(report.summary.contaminated / report.summary.totalSessions * 100).toFixed(1)}%`)
  console.log(`Evidence saved to: ${outFile}`)
  console.log('='.repeat(60))
})()
