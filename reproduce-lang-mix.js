#!/usr/bin/env node
/**
 * Language-mixing bug reproduction script
 *
 * Bug: When FR and VI sessions are created concurrently, the bot sometimes
 * responds in the wrong language — a FR session gets a Vietnamese reply
 * or vice versa.
 *
 * Method: fire CONCURRENCY FR + CONCURRENCY VI session pairs simultaneously,
 * then send name to each and check the response language.
 *
 * Usage: ELFIE_API_KEY=<key> node reproduce-lang-mix.js [rounds] [concurrency]
 *   rounds       – how many parallel batches to run (default 10)
 *   concurrency  – FR+VI pairs per batch (default 5)
 */

const https = require('https')

const API_KEY     = process.env.ELFIE_API_KEY || ''
const API_HOST    = 'api.stg.elfie.co'
const ROUNDS      = parseInt(process.argv[2] || '10')
const CONCURRENCY = parseInt(process.argv[3] || '5')

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request({
      hostname: API_HOST, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY,
                 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
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

// ─── Language fingerprints ────────────────────────────────────────────────────
// Vietnamese-EXCLUSIVE characters: ă ơ ư đ and their toned variants.
// These do NOT appear in French, Spanish, or most other Latin-script languages.
const VI_EXCLUSIVE = /[ăắằẳẵặơớờởỡợưứừửữựđ]|Chào|Cảm ơn|thăm khám|bạn ơi|khẩn cấp|thông thường/i
// French words that cannot appear in Vietnamese or English
const FR_EXCLUSIVE = /Bonjour|Merci|votre nom|prénom|accompagner|Pourriez-vous|s'il vous plaît|êtes-vous/i
// English markers
const EN_EXCLUSIVE = /Hello|Hi there|your name|welcome|What brings you|How are you feeling/i

function detectLang(text) {
  if (!text || text.trim() === '') return 'empty'
  if (VI_EXCLUSIVE.test(text)) return 'vi'
  if (FR_EXCLUSIVE.test(text)) return 'fr'
  if (EN_EXCLUSIVE.test(text)) return 'en'
  return 'unknown'
}

// ─── Single session probe ─────────────────────────────────────────────────────
async function probe(expectedLang) {
  const domains = ['Visit Context']
  const createBody = {
    user_id: 'lang-test', language_code: expectedLang,
    config: { patient_info: { name: 'Test User' }, use_case: 'pre-visit',
              domains, doctor_language_code: expectedLang, clinic_name: '' }
  }
  const createResp = await postJSON('/agent/api/v1/ai-coach/create-session', createBody)
  const sessionId = createResp.body.sessionId || createResp.body.session_id

  if (!sessionId) return { expectedLang, sessionId: null, detectedLang: 'error', botReply: JSON.stringify(createResp.body) }

  // init
  const initResp = await postJSON('/agent/api/v1/ai-coach/chat',
    { session_id: sessionId, user_id: 'lang-test', message: 'start conversation', language_code: expectedLang })
  const initMsg = initResp.body.message || ''

  // send name — this is where the wrong-language reply appeared
  const nameResp = await postJSON('/agent/api/v1/ai-coach/chat',
    { session_id: sessionId, user_id: 'lang-test', message: 'Test User', language_code: expectedLang })
  const nameMsg = nameResp.body.message || ''

  const botReply = nameMsg || initMsg
  const detectedLang = detectLang(botReply)
  const contaminated = detectedLang !== 'empty' && detectedLang !== 'unknown' && detectedLang !== expectedLang

  return { expectedLang, sessionId, detectedLang, contaminated, botReply: botReply.replace(/\n/g, ' ').substring(0, 150) }
}

// ─── Run one batch: CONCURRENCY FR + CONCURRENCY VI fired simultaneously ──────
async function runBatch(batchNum) {
  const tasks = []
  for (let i = 0; i < CONCURRENCY; i++) {
    tasks.push(probe('fr'))
    tasks.push(probe('vi'))
  }
  const results = await Promise.all(tasks)
  const contaminated = results.filter(r => r.contaminated)
  return { batchNum, results, contaminated }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  console.log(`Language-mixing bug reproduction`)
  console.log(`API    : ${API_HOST}`)
  console.log(`Rounds : ${ROUNDS}  |  Concurrency per round: ${CONCURRENCY} FR + ${CONCURRENCY} VI = ${CONCURRENCY * 2} parallel sessions`)
  console.log(`Total sessions: ${ROUNDS * CONCURRENCY * 2}\n`)

  const allContaminated = []
  let totalSessions = 0

  for (let r = 1; r <= ROUNDS; r++) {
    process.stdout.write(`  Batch ${String(r).padStart(2)}/${ROUNDS} ... `)
    const batch = await runBatch(r)
    totalSessions += batch.results.length

    if (batch.contaminated.length > 0) {
      console.log(`⚠  ${batch.contaminated.length} CONTAMINATED`)
      for (const c of batch.contaminated) {
        console.log(`       session ${c.sessionId}: expected=${c.expectedLang} got=${c.detectedLang}`)
        console.log(`       reply: "${c.botReply}"`)
        allContaminated.push({ batch: r, ...c })
      }
    } else {
      console.log('✓  clean')
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`RESULT: ${allContaminated.length} contaminated out of ${totalSessions} sessions`)
  console.log(`Reproduction rate: ${allContaminated.length}/${totalSessions} (${(allContaminated.length/totalSessions*100).toFixed(1)}%)`)

  if (allContaminated.length === 0) {
    console.log('\n✅ Bug NOT reproduced in this run. Try increasing rounds/concurrency.')
    console.log('   e.g.  node reproduce-lang-mix.js 20 10')
  } else {
    console.log('\n❌ Bug CONFIRMED — session(s) responded in wrong language under concurrent load.')
    console.log('\nContaminated sessions:')
    for (const c of allContaminated) {
      console.log(`  Batch ${c.batch} | session ${c.sessionId} | expected ${c.expectedLang} → got ${c.detectedLang}`)
      console.log(`  Reply: "${c.botReply}"`)
    }
  }
  console.log('═'.repeat(60))
})()
