/**
 * Bug evidence generator
 * Captures full API request + response for each of the 3 confirmed bugs.
 * Output: bug-evidence.txt
 */
const https = require('https')
const fs = require('fs')

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiCall(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body, null, 2)
    const req = https.request({
      hostname: 'care.stg.elfie.co',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch (e) { parsed = { raw: data } }
        resolve({
          request: {
            method: 'POST',
            url: `https://care.stg.elfie.co${path}`,
            headers: { 'Content-Type': 'application/json', 'x-api-key': '(redacted)' },
            body
          },
          response: {
            status: res.statusCode,
            body: parsed
          }
        })
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function createSession(lang) {
  const result = await apiCall('/api/v1/ai-chat/create-session', {
    userId: 'botium-test',
    languageCode: lang,
    config: {
      patient_info: { name: 'Test User' },
      use_case: 'pre-visit',
      domains: [],
      doctorLanguageCode: lang,
      clinicName: '',
      slug: 'kate-practice-2f3h'
    }
  })
  return { sessionId: result.response.body.sessionId, createSessionCall: result }
}

async function chatTurn(sessionId, message, lang) {
  return apiCall('/api/v1/ai-chat/chat', {
    sessionId,
    message,
    languageCode: lang,
    userId: 'botium-test'
  })
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const LINE = '─'.repeat(100)
const THICK = '═'.repeat(100)

function formatCall(label, call) {
  const lines = []
  lines.push(`  ┌─ ${label} `)
  lines.push(`  │  REQUEST`)
  lines.push(`  │    ${call.request.method} ${call.request.url}`)
  lines.push(`  │    Headers: Content-Type: application/json`)
  lines.push(`  │    Body:`)
  JSON.stringify(call.request.body, null, 2).split('\n').forEach(l => lines.push(`  │      ${l}`))
  lines.push(`  │`)
  lines.push(`  │  RESPONSE  [HTTP ${call.response.status}]`)
  JSON.stringify(call.response.body, null, 2).split('\n').forEach(l => lines.push(`  │      ${l}`))
  lines.push(`  └${'─'.repeat(97)}`)
  return lines.join('\n')
}

// ─── Bug 1: Translation artifact in French ───────────────────────────────────
// The "completed/download" system message is never native French.
// Instead the LLM wraps it: "Voici la traduction en français : «...»"
// Reproduce: FR session → name → age → gender → complaint → observe response

async function evidenceBug1() {
  const lines = []
  lines.push(THICK)
  lines.push('BUG #1 — TRANSLATION ARTIFACT IN FRENCH "COMPLETED" MESSAGE')
  lines.push(THICK)
  lines.push('')
  lines.push('Description:')
  lines.push('  When the bot finishes collecting the visit complaint in a French session,')
  lines.push('  it should return a native French message. Instead, it outputs a translation')
  lines.push('  wrapper: "Voici la traduction en français : «Vous avez rempli toutes les')
  lines.push('  informations, téléchargez le résumé.»"')
  lines.push('  English and Vietnamese sessions return the message directly in their language.')
  lines.push('')
  lines.push('Expected: Native French "completed" message (e.g. "Vous avez complété...")')
  lines.push('Actual  : "Voici la traduction en français : «...»" (meta-translation wrapper)')
  lines.push('')

  // Run EN for comparison
  lines.push('── Comparison: ENGLISH session (correct behaviour) ─────────────────────────')
  const en = await createSession('en')
  lines.push(formatCall('POST /api/v1/ai-chat/create-session [EN]', en.createSessionCall))
  const enSteps = [
    ['start conversation', 'en', 'INIT'],
    ['Test User', 'en', 'NAME'],
    ['35', 'en', 'AGE'],
    ['Female', 'en', 'GENDER'],
    ['I have been having lower back pain for three days', 'en', 'COMPLAINT']
  ]
  for (const [msg, lang, label] of enSteps) {
    const call = await chatTurn(en.sessionId, msg, lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [EN] — step: ${label}`, call))
  }

  lines.push('')
  lines.push('── Bug reproduction: FRENCH session ────────────────────────────────────────')
  const fr = await createSession('fr')
  lines.push(formatCall('POST /api/v1/ai-chat/create-session [FR]', fr.createSessionCall))
  const frSteps = [
    ['start conversation', 'fr', 'INIT'],
    ['Test User', 'fr', 'NAME'],
    ['35', 'fr', 'AGE'],
    ['Femme', 'fr', 'GENDER'],
    ["J'ai mal dans le bas du dos depuis trois jours", 'fr', 'COMPLAINT ← BUG APPEARS HERE']
  ]
  for (const [msg, lang, label] of frSteps) {
    const call = await chatTurn(fr.sessionId, msg, lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [FR] — step: ${label}`, call))
  }

  return lines.join('\n')
}

// ─── Bug 2: Premature flow completion in FR and VI ────────────────────────────
// After the first complaint message, the bot marks the intake as "completed"
// without asking about medical history, medications, or lifestyle.
// English continues correctly.

async function evidenceBug2() {
  const lines = []
  lines.push(THICK)
  lines.push('BUG #2 — PREMATURE FLOW COMPLETION AFTER FIRST COMPLAINT (FR + VI)')
  lines.push(THICK)
  lines.push('')
  lines.push('Description:')
  lines.push('  In English, after the user provides their visit complaint, the bot continues')
  lines.push('  the intake by asking about medical conditions, surgeries, family history,')
  lines.push('  medications, lifestyle, etc.')
  lines.push('  In French and Vietnamese, the bot immediately says "completed / download')
  lines.push('  summary" after the FIRST complaint message, skipping the entire medical')
  lines.push('  intake section. The patient record is incomplete.')
  lines.push('')
  lines.push('Expected: Bot continues intake after complaint (asks conditions, medications...)')
  lines.push('Actual  : Bot ends session immediately after complaint with "completed" message')
  lines.push('')

  // EN — correct: bot continues past complaint
  lines.push('── Comparison: ENGLISH session — correct continuation after complaint ────────')
  const en = await createSession('en')
  lines.push(formatCall('POST /api/v1/ai-chat/create-session [EN]', en.createSessionCall))
  for (const [msg, lang, label] of [
    ['start conversation', 'en', 'INIT'],
    ['Test User', 'en', 'NAME'],
    ['45', 'en', 'AGE'],
    ['Male', 'en', 'GENDER'],
    ['I have a rash on my arm for five days', 'en', 'COMPLAINT'],
    ['No chronic conditions', 'en', 'CONDITIONS — bot continues ✓'],
    ['No surgeries', 'en', 'SURGERIES — bot continues ✓']
  ]) {
    const call = await chatTurn(en.sessionId, msg, lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [EN] — ${label}`, call))
  }

  lines.push('')
  lines.push('── Bug reproduction: FRENCH session — premature completion ──────────────────')
  const fr = await createSession('fr')
  lines.push(formatCall('POST /api/v1/ai-chat/create-session [FR]', fr.createSessionCall))
  for (const [msg, lang, label] of [
    ['start conversation', 'fr', 'INIT'],
    ['Test User', 'fr', 'NAME'],
    ['45', 'fr', 'AGE'],
    ['Homme', 'fr', 'GENDER'],
    ["J'ai une éruption sur le bras depuis cinq jours", 'fr', 'COMPLAINT ← bot says completed here (BUG)'],
    ['Pas de maladies chroniques', 'fr', 'CONDITIONS — should continue but may not']
  ]) {
    const call = await chatTurn(fr.sessionId, msg, lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [FR] — ${label}`, call))
  }

  lines.push('')
  lines.push('── Bug reproduction: VIETNAMESE session — premature completion ───────────────')
  const vi = await createSession('vi')
  lines.push(formatCall('POST /api/v1/ai-chat/create-session [VI]', vi.createSessionCall))
  for (const [msg, lang, label] of [
    ['start conversation', 'vi', 'INIT'],
    ['Test User', 'vi', 'NAME'],
    ['45', 'vi', 'AGE'],
    ['Nam', 'vi', 'GENDER'],
    ['Tôi bị phát ban trên cánh tay năm ngày nay', 'vi', 'COMPLAINT ← bot says completed here (BUG)'],
    ['Không có bệnh mãn tính', 'vi', 'CONDITIONS — should continue but may not']
  ]) {
    const call = await chatTurn(vi.sessionId, msg, lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [VI] — ${label}`, call))
  }

  return lines.join('\n')
}

// ─── Bug 3: Age step skipped in Vietnamese ────────────────────────────────────
// After giving name, Vietnamese bot sometimes skips asking age and jumps to gender,
// or merges both into one question. EN and FR always ask them sequentially.

async function evidenceBug3() {
  const lines = []
  lines.push(THICK)
  lines.push('BUG #3 — AGE STEP SKIPPED / MERGED IN VIETNAMESE')
  lines.push(THICK)
  lines.push('')
  lines.push('Description:')
  lines.push('  In English and French, after the user provides their name, the bot asks')
  lines.push('  for age as a separate step, then gender as a separate step.')
  lines.push('  In Vietnamese, the bot sometimes skips the age question entirely and jumps')
  lines.push('  straight to asking for gender, or merges "age + gender" into one question.')
  lines.push('  This results in incomplete demographic data in the patient record.')
  lines.push('')
  lines.push('Expected: Bot asks age separately, then gender separately')
  lines.push('Actual  : Bot skips age or combines age+gender in a single question')
  lines.push('')

  // Run all 3 languages through name step only to compare the response
  for (const [lang, nameMsg, label] of [
    ['en', 'Sarah Test', 'ENGLISH'],
    ['fr', 'Sarah Test', 'FRENCH'],
    ['vi', 'Sarah Test', 'VIETNAMESE']
  ]) {
    lines.push(`── ${label} session ─────────────────────────────────────────────────────────`)
    const sess = await createSession(lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/create-session [${lang.toUpperCase()}]`, sess.createSessionCall))
    const initCall = await chatTurn(sess.sessionId, 'start conversation', lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [${lang.toUpperCase()}] — INIT`, initCall))
    const nameCall = await chatTurn(sess.sessionId, nameMsg, lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [${lang.toUpperCase()}] — NAME → observe bot's next question`, nameCall))
    const ageCall = await chatTurn(sess.sessionId, lang === 'vi' ? '32' : '32', lang)
    lines.push(formatCall(`POST /api/v1/ai-chat/chat [${lang.toUpperCase()}] — AGE (user types "32") → observe bot's next question`, ageCall))
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ts = new Date().toISOString()
  const header = [
    THICK,
    'ELFIE CARE — PRE-VISIT CHATBOT: BUG EVIDENCE REPORT',
    `Generated : ${ts}`,
    `API host  : https://care.stg.elfie.co`,
    `Note      : All requests are live HTTPS calls to the staging API.`,
    `            No mocking. Session IDs are real server-side session objects.`,
    `            Each "POST /api/v1/ai-chat/chat" body and response is shown verbatim.`,
    THICK,
    ''
  ].join('\n')

  console.log('Collecting evidence for Bug #1...')
  const b1 = await evidenceBug1()
  console.log('Collecting evidence for Bug #2...')
  const b2 = await evidenceBug2()
  console.log('Collecting evidence for Bug #3...')
  const b3 = await evidenceBug3()

  const report = [header, b1, '', b2, '', b3].join('\n')
  fs.writeFileSync('bug-evidence.txt', report, 'utf8')
  console.log('\nDone. Report saved to: bug-evidence.txt')
  console.log(`Size: ${(Buffer.byteLength(report) / 1024).toFixed(1)} KB`)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
