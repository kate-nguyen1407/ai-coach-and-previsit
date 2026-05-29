const https = require('https')
const fs = require('fs')

async function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = https.request({
      hostname: 'care.stg.elfie.co', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': '', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { resolve({ message: `[PARSE ERROR] ${d}` }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function createSession(lang) {
  const res = await post('/api/v1/ai-chat/create-session', {
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
  return res.sessionId
}

async function chat(sessionId, message, lang) {
  const res = await post('/api/v1/ai-chat/chat', {
    sessionId, message, languageCode: lang, userId: 'botium-test'
  })
  return res.message || res.error || '[NO RESPONSE]'
}

async function runScenario(name, lang, steps) {
  const sessionId = await createSession(lang)
  const turns = []
  for (const [label, msg] of steps) {
    const botMsg = await chat(sessionId, msg, lang)
    turns.push({ label, user: msg, bot: botMsg })
  }
  return { name, lang, sessionId, turns }
}

// ─── Scenario definitions ─────────────────────────────────────────────────────

const SCENARIOS = {
  en: [
    { name: '01_opening', steps: [
      ['open', 'start conversation']
    ]},
    { name: '02_identity', steps: [
      ['open', 'start conversation'], ['name', 'Sarah Test'], ['age', 'I am 32 years old'], ['gender', 'Female']
    ]},
    { name: '03_visit_context', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '28'], ['gender', 'Male'],
      ['complaint', 'I have been having lower back pain for three days']
    ]},
    { name: '04_symptoms', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '35'], ['gender', 'Female'],
      ['complaint', 'I have stomach cramps every day for two weeks'],
      ['detail', 'The pain is sharp mostly on the left side and I feel nauseous sometimes'],
      ['severity', 'Maybe a 6 out of 10'], ['onset', 'It started two weeks ago']
    ]},
    { name: '05_medical_history', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '40'], ['gender', 'Male'],
      ['complaint', 'I have been feeling tired all the time for a month'],
      ['conditions', 'No chronic conditions'], ['surgeries', 'No surgeries'],
      ['family', 'My father had heart disease']
    ]},
    { name: '06_medication', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '35'], ['gender', 'Female'],
      ['complaint', 'I have been having headaches for a week'],
      ['conditions', 'No chronic conditions'], ['surgeries', 'No surgeries'],
      ['family', 'No family history'],
      ['medication', 'I take ibuprofen occasionally for pain'],
      ['allergy', 'I am allergic to penicillin']
    ]},
    { name: '07_lifestyle', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '33'], ['gender', 'Female'],
      ['complaint', 'I have been getting dizzy spells for a week'],
      ['smoking', "I don't smoke"], ['drinking', 'I drink socially, maybe once a week'],
      ['exercise', 'I walk about 30 minutes every day'],
      ['diet', 'I eat normally, cook at home most days'],
      ['sleep', 'About 7 hours a night'], ['stress', 'Moderate stress from work']
    ]},
    { name: '08_mental_emotional', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '27'], ['gender', 'Female'],
      ['complaint', 'I have been feeling unwell for a few weeks'],
      ['mental', 'I have been feeling quite anxious and low lately']
    ]},
    { name: '09_closing', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '45'], ['gender', 'Male'],
      ['complaint', 'I have a rash on my arm that has been there for five days'],
      ['conditions', 'No chronic conditions'], ['surgeries', 'No surgeries'],
      ['family', 'No family history'], ['medication', "I don't take any medications"],
      ['allergy', 'No allergies'], ['smoking', "I don't smoke"], ['drinking', "I don't drink"],
      ['exercise', 'I exercise twice a week'], ['diet', 'Normal diet'],
      ['sleep', 'Seven hours sleep'], ['stress', 'Low stress'],
      ['mental', 'I have been feeling fine mentally'], ['travel', 'No travel'],
      ['caregiver', 'No caregiver'], ['consent', 'Yes I consent'],
      ['doctors', 'No other doctors'], ['goal', 'I want to know if this needs treatment']
    ]},
    { name: '10_uncertain_answers', steps: [
      ['open', 'start conversation'], ['name', 'Test User'],
      ['age_refuse', 'I prefer not to say'],
      ['visit_uncertain', 'I am not sure what is wrong, I just feel off'],
      ['pain_cant_describe', "I don't know how to describe the pain"],
      ['pain_score', 'Maybe a 5 out of 10'],
      ['back_injury', 'I think I had a back injury a few years ago but was never diagnosed'],
      ['family_unsure', 'Not sure about anyone else in my family'],
      ['alcohol_unsure', "I'm not sure, sometimes maybe a glass of wine"],
      ['exercise_unsure', 'I think I exercise once or twice a week'],
      ['diet_unsure', "I can't really remember the last time I ate properly"],
      ['sleep_unsure', "Maybe 5 or 6 hours, not sure if it's stress or something else"],
      ['stress_high', 'Pretty high I think, mostly work']
    ]},
    { name: '11_post_summary', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '38'], ['gender', 'Female'],
      ['complaint', 'I have been having knee pain for two weeks'],
      ['conditions', 'No chronic conditions'], ['surgeries', 'No surgeries'],
      ['family', 'No family history'], ['medication', "I don't take any medications"],
      ['allergy', 'No allergies'], ['smoking', "I don't smoke"], ['drinking', "I don't drink"],
      ['exercise', 'I walk daily'], ['diet', 'Normal diet'], ['sleep', 'Seven hours sleep'],
      ['stress', 'Low stress'], ['mental', 'I feel fine mentally'], ['travel', 'No travel'],
      ['caregiver', 'No caregiver'], ['consent', 'Yes I consent'],
      ['doctors', 'No other doctors'],
      ['goal', 'I just want to know what is causing the pain'],
      ['new_info', 'Oh I forgot to mention I have been using a knee brace']
    ]}
  ],
  fr: [
    { name: '01_opening', steps: [['open', 'start conversation']]},
    { name: '02_identity', steps: [
      ['open', 'start conversation'], ['name', 'Sarah Test'], ['age', '32'], ['gender', 'Femme']
    ]},
    { name: '03_visit_context', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '28'], ['gender', 'Homme'],
      ['complaint', "J'ai mal dans le bas du dos depuis trois jours"]
    ]},
    { name: '04_symptoms', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '35'], ['gender', 'Femme'],
      ['complaint', "J'ai des crampes à l'estomac tous les jours depuis deux semaines"],
      ['detail', "La douleur est aiguë surtout sur le côté gauche et je me sens parfois nauséeuse"],
      ['severity', 'Peut-être un 6 sur 10'], ['onset', "Cela a commencé il y a deux semaines"]
    ]},
    { name: '05_medical_history', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '40'], ['gender', 'Homme'],
      ['complaint', 'Je me sens fatigué tout le temps depuis un mois'],
      ['conditions', 'Pas de maladies chroniques'], ['surgeries', 'Pas de chirurgies'],
      ['family', 'Mon père avait une maladie cardiaque']
    ]},
    { name: '06_medication', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '35'], ['gender', 'Femme'],
      ['complaint', "J'ai des maux de tête depuis une semaine"],
      ['conditions', 'Pas de maladies chroniques'], ['surgeries', 'Pas de chirurgies'],
      ['family', "Pas d'antécédents familiaux"],
      ['medication', "Je prends de l'ibuprofène occasionnellement"],
      ['allergy', 'Je suis allergique à la pénicilline']
    ]},
    { name: '07_lifestyle', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '33'], ['gender', 'Femme'],
      ['complaint', "J'ai des vertiges depuis une semaine"],
      ['smoking', 'Je ne fume pas'],
      ['drinking', 'Je bois occasionnellement, peut-être une fois par semaine'],
      ['exercise', 'Je marche environ 30 minutes tous les jours'],
      ['diet', 'Je mange normalement, je cuisine à la maison la plupart du temps'],
      ['sleep', 'Environ 7 heures par nuit'], ['stress', 'Stress modéré au travail']
    ]},
    { name: '08_mental_emotional', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '27'], ['gender', 'Femme'],
      ['complaint', 'Je me sens mal depuis quelques semaines'],
      ['mental', 'Je me sens assez anxieuse et déprimée ces derniers temps']
    ]},
    { name: '09_closing', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '45'], ['gender', 'Homme'],
      ['complaint', "J'ai une éruption sur le bras depuis cinq jours"],
      ['conditions', 'Pas de maladies chroniques'], ['surgeries', 'Pas de chirurgies'],
      ['family', "Pas d'antécédents familiaux"], ['medication', 'Je ne prends pas de médicaments'],
      ['allergy', "Pas d'allergies"], ['smoking', 'Je ne fume pas'], ['drinking', 'Je ne bois pas'],
      ['exercise', "Je fais de l'exercice deux fois par semaine"], ['diet', 'Alimentation normale'],
      ['sleep', 'Sept heures de sommeil'], ['stress', 'Faible stress'],
      ['mental', 'Je me suis senti bien mentalement'], ['travel', 'Pas de voyage'],
      ['caregiver', "Pas d'aidant"], ['consent', 'Oui je consens'],
      ['doctors', "Pas d'autres médecins"],
      ['goal', 'Je veux savoir si cela nécessite un traitement']
    ]},
    { name: '10_uncertain_answers', steps: [
      ['open', 'start conversation'], ['name', 'Test User'],
      ['age_refuse', 'Je préfère ne pas répondre'],
      ['visit_uncertain', 'Je ne sais pas ce qui ne va pas, je me sens juste mal'],
      ['pain_cant_describe', 'Je ne sais pas comment décrire la douleur'],
      ['pain_score', 'Peut-être 5 sur 10'],
      ['back_injury', 'Je pense avoir eu une blessure au dos il y a quelques années mais sans diagnostic'],
      ['family_unsure', 'Pas sûr pour les autres membres de ma famille'],
      ['alcohol_unsure', 'Je ne suis pas sûr, parfois un verre de vin'],
      ['exercise_unsure', "Je pense faire de l'exercice une ou deux fois par semaine"],
      ['diet_unsure', "Je ne me souviens vraiment pas de la dernière fois que j'ai bien mangé"],
      ['sleep_unsure', "Peut-être 5 ou 6 heures, pas sûr si c'est le stress ou autre chose"],
      ['stress_high', 'Assez élevé je pense, surtout à cause du travail']
    ]},
    { name: '11_post_summary', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '38'], ['gender', 'Femme'],
      ['complaint', "J'ai eu des douleurs au genou pendant deux semaines"],
      ['conditions', 'Pas de maladies chroniques'], ['surgeries', 'Pas de chirurgies'],
      ['family', "Pas d'antécédents familiaux"], ['medication', 'Je ne prends pas de médicaments'],
      ['allergy', "Pas d'allergies"], ['smoking', 'Je ne fume pas'], ['drinking', 'Je ne bois pas'],
      ['exercise', 'Je marche tous les jours'], ['diet', 'Alimentation normale'],
      ['sleep', 'Sept heures de sommeil'], ['stress', 'Faible stress'],
      ['mental', 'Je me sens bien mentalement'], ['travel', 'Pas de voyage'],
      ['caregiver', "Pas d'aidant"], ['consent', 'Oui je consens'],
      ['doctors', "Pas d'autres médecins"],
      ['goal', 'Je veux juste savoir ce qui cause la douleur'],
      ['new_info', "Oh j'ai oublié de mentionner que j'utilise une genouillère"]
    ]}
  ],
  vi: [
    { name: '01_opening', steps: [['open', 'start conversation']]},
    { name: '02_identity', steps: [
      ['open', 'start conversation'], ['name', 'Sarah Test'], ['age', '32'], ['gender', 'Nữ']
    ]},
    { name: '03_visit_context', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '28'], ['gender', 'Nam'],
      ['complaint', 'Tôi bị đau lưng dưới ba ngày nay']
    ]},
    { name: '04_symptoms', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '35'], ['gender', 'Nữ'],
      ['complaint', 'Tôi bị chuột rút dạ dày mỗi ngày trong hai tuần'],
      ['detail', 'Cơn đau nhói chủ yếu ở bên trái và đôi khi tôi cảm thấy buồn nôn'],
      ['severity', 'Khoảng 6 trên 10'], ['onset', 'Nó bắt đầu từ hai tuần trước']
    ]},
    { name: '05_medical_history', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '40'], ['gender', 'Nam'],
      ['complaint', 'Tôi cảm thấy mệt mỏi suốt một tháng nay'],
      ['conditions', 'Không có bệnh mãn tính'], ['surgeries', 'Không có phẫu thuật'],
      ['family', 'Bố tôi bị bệnh tim']
    ]},
    { name: '06_medication', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '35'], ['gender', 'Nữ'],
      ['complaint', 'Tôi bị đau đầu một tuần nay'],
      ['conditions', 'Không có bệnh mãn tính'], ['surgeries', 'Không có phẫu thuật'],
      ['family', 'Không có tiền sử gia đình'],
      ['medication', 'Tôi thỉnh thoảng uống ibuprofen'],
      ['allergy', 'Tôi bị dị ứng penicillin']
    ]},
    { name: '07_lifestyle', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '33'], ['gender', 'Nữ'],
      ['complaint', 'Tôi bị chóng mặt một tuần nay'],
      ['smoking', 'Tôi không hút thuốc'],
      ['drinking', 'Tôi uống rượu xã giao, khoảng một lần mỗi tuần'],
      ['exercise', 'Tôi đi bộ khoảng 30 phút mỗi ngày'],
      ['diet', 'Tôi ăn uống bình thường, tự nấu ăn hầu hết'],
      ['sleep', 'Khoảng 7 tiếng mỗi đêm'], ['stress', 'Căng thẳng vừa phải do công việc']
    ]},
    { name: '08_mental_emotional', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '27'], ['gender', 'Nữ'],
      ['complaint', 'Tôi cảm thấy không khỏe trong vài tuần'],
      ['mental', 'Tôi cảm thấy khá lo lắng và buồn dạo này']
    ]},
    { name: '09_closing', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '45'], ['gender', 'Nam'],
      ['complaint', 'Tôi bị phát ban trên cánh tay năm ngày nay'],
      ['conditions', 'Không có bệnh mãn tính'], ['surgeries', 'Không có phẫu thuật'],
      ['family', 'Không có tiền sử gia đình'], ['medication', 'Tôi không uống thuốc'],
      ['allergy', 'Không có dị ứng'], ['smoking', 'Tôi không hút thuốc'], ['drinking', 'Tôi không uống rượu'],
      ['exercise', 'Tôi tập thể dục hai lần mỗi tuần'], ['diet', 'Chế độ ăn bình thường'],
      ['sleep', 'Bảy tiếng ngủ'], ['stress', 'Ít căng thẳng'],
      ['mental', 'Tôi cảm thấy tốt về mặt tinh thần'], ['travel', 'Không đi du lịch'],
      ['caregiver', 'Không có người chăm sóc'], ['consent', 'Vâng tôi đồng ý'],
      ['doctors', 'Không có bác sĩ khác'],
      ['goal', 'Tôi muốn biết có cần điều trị không']
    ]},
    { name: '10_uncertain_answers', steps: [
      ['open', 'start conversation'], ['name', 'Test User'],
      ['age_refuse', 'Tôi không muốn nói'],
      ['visit_uncertain', 'Tôi không chắc điều gì không ổn, tôi chỉ cảm thấy không được'],
      ['pain_cant_describe', 'Tôi không biết cách mô tả cơn đau'],
      ['pain_score', 'Có thể là 5 trên 10'],
      ['back_injury', 'Tôi nghĩ mình đã bị chấn thương lưng vài năm trước nhưng chưa được chẩn đoán'],
      ['family_unsure', 'Không chắc về những người khác trong gia đình tôi'],
      ['alcohol_unsure', 'Tôi không chắc, đôi khi một ly rượu'],
      ['exercise_unsure', 'Tôi nghĩ tôi tập thể dục một hoặc hai lần một tuần'],
      ['diet_unsure', 'Tôi thực sự không nhớ lần cuối tôi ăn uống đúng cách'],
      ['sleep_unsure', 'Có thể 5 hoặc 6 tiếng, không chắc có phải do căng thẳng không'],
      ['stress_high', 'Khá cao tôi nghĩ, chủ yếu là do công việc']
    ]},
    { name: '11_post_summary', steps: [
      ['open', 'start conversation'], ['name', 'Test User'], ['age', '38'], ['gender', 'Nữ'],
      ['complaint', 'Tôi bị đau gối hai tuần nay'],
      ['conditions', 'Không có bệnh mãn tính'], ['surgeries', 'Không có phẫu thuật'],
      ['family', 'Không có tiền sử gia đình'], ['medication', 'Tôi không uống thuốc'],
      ['allergy', 'Không có dị ứng'], ['smoking', 'Tôi không hút thuốc'], ['drinking', 'Tôi không uống rượu'],
      ['exercise', 'Tôi đi bộ hàng ngày'], ['diet', 'Chế độ ăn bình thường'],
      ['sleep', 'Bảy tiếng ngủ'], ['stress', 'Ít căng thẳng'],
      ['mental', 'Tôi cảm thấy tốt về mặt tinh thần'], ['travel', 'Không đi du lịch'],
      ['caregiver', 'Không có người chăm sóc'], ['consent', 'Vâng tôi đồng ý'],
      ['doctors', 'Không có bác sĩ khác'],
      ['goal', 'Tôi chỉ muốn biết điều gì đang gây ra cơn đau'],
      ['new_info', 'Ồ tôi quên đề cập tôi đang dùng đai gối']
    ]}
  ]
}

// ─── Bug detection ─────────────────────────────────────────────────────────────

function detectBugs(results) {
  const bugs = []

  // Characters exclusive to Vietnamese (not in French): đ, ơ, ư, and their toned variants
  const VI_ONLY = /[đơướờợởỡưứừựửữ]/i

  // Exact "end of intake" completion phrases from the API
  const COMPLETION_PHRASES = [
    'bạn đã hoàn tất việc cung cấp thông tin',   // VI completed
    'hãy tải xuống bản tóm tắt',                  // VI download
    'vous avez rempli toutes les informations',    // FR completed
    'téléchargez le résumé',                      // FR download
    "you've completed",                           // EN completed
    'download the summary'                        // EN download
  ]

  // Steps that come before the visit complaint — "completed" here is definitely premature
  const PRE_COMPLAINT_STEPS = new Set(['open', 'name', 'age', 'gender'])

  for (const r of results) {
    for (const turn of r.turns) {
      const botText = String(turn.bot || '')
      const botLower = botText.toLowerCase()

      // Bug: wrong language in response (Vietnamese in a French session)
      if (r.lang === 'fr' && VI_ONLY.test(botText)) {
        bugs.push({
          scenario: r.name, lang: r.lang, step: turn.label,
          type: 'WRONG_LANGUAGE',
          detail: 'French session returned Vietnamese-specific characters (đ/ơ/ư)',
          botResponse: botText
        })
      }

      // Bug: French text in a Vietnamese session (detect French-only words without VI chars)
      if (r.lang === 'vi') {
        const frenchWords = /\b(bonjour|merci beaucoup|votre|préoccupations|médecin)\b/i.test(botText)
        const hasVI = VI_ONLY.test(botText)
        if (frenchWords && !hasVI) {
          bugs.push({
            scenario: r.name, lang: r.lang, step: turn.label,
            type: 'WRONG_LANGUAGE',
            detail: 'Vietnamese session returned French text without Vietnamese characters',
            botResponse: botText
          })
        }
      }

      // Bug: English text in FR or VI session
      if ((r.lang === 'fr' || r.lang === 'vi') && /\byour (name|visit|doctor|symptoms)\b/i.test(botText)) {
        bugs.push({
          scenario: r.name, lang: r.lang, step: turn.label,
          type: 'WRONG_LANGUAGE',
          detail: `${r.lang.toUpperCase()} session returned English text`,
          botResponse: botText
        })
      }

      // Bug: premature completion — "completed/download" phrases before the complaint is collected
      const isPreComplaint = PRE_COMPLAINT_STEPS.has(turn.label)
      const triggeredCompletion = COMPLETION_PHRASES.some(p => botLower.includes(p))
      if (isPreComplaint && triggeredCompletion) {
        bugs.push({
          scenario: r.name, lang: r.lang, step: turn.label,
          type: 'PREMATURE_COMPLETION',
          detail: `Flow ended at step "${turn.label}" before visit complaint was collected`,
          botResponse: botText
        })
      }
    }
  }
  return bugs
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatReport(allResults, bugs) {
  const divider = '═'.repeat(100)
  const thinDiv = '─'.repeat(100)
  const lines = []
  const ts = new Date().toISOString()

  lines.push(divider)
  lines.push('ELFIE CARE — PRE-VISIT AI CHATBOT: MULTILINGUAL TEST REPORT')
  lines.push(`Generated: ${ts}`)
  lines.push(`Environment: https://care.stg.elfie.co (staging)`)
  lines.push(`Transport: Live HTTPS API  |  No mocks  |  Each turn = real POST /api/v1/ai-chat/chat`)
  lines.push(`Languages tested: English (en), French (fr), Vietnamese (vi)`)
  lines.push(`Scenarios: 11 per language  |  Total sessions: ${allResults.length}`)
  lines.push(divider)

  // Bug summary up top
  if (bugs.length > 0) {
    lines.push('')
    lines.push('⚠  DETECTED BUGS / ANOMALIES')
    lines.push(thinDiv)
    bugs.forEach((b, i) => {
      lines.push(`Bug #${i + 1}: [${b.type}]`)
      lines.push(`  Scenario : ${b.scenario}  |  Language: ${b.lang}  |  Step: ${b.step}`)
      lines.push(`  Detail   : ${b.detail}`)
      lines.push(`  Response : ${b.botResponse.replace(/\n/g, ' ').substring(0, 300)}`)
      lines.push('')
    })
    lines.push(divider)
  } else {
    lines.push('')
    lines.push('✓  No bugs automatically detected.')
    lines.push(divider)
  }

  // Full conversations grouped by scenario
  const scenarioNames = [...new Set(allResults.map(r => r.name))]
  for (const scenName of scenarioNames) {
    lines.push('')
    lines.push(`╔══ SCENARIO: ${scenName} ${'═'.repeat(Math.max(0, 80 - scenName.length))}`)
    lines.push('')

    const forScenario = allResults.filter(r => r.name === scenName)
    for (const result of forScenario) {
      const langLabel = { en: 'ENGLISH', fr: 'FRENCH', vi: 'VIETNAMESE' }[result.lang]
      lines.push(`  ┌── ${langLabel} (sessionId: ${result.sessionId}) ──────────────────────────────────`)
      for (const turn of result.turns) {
        lines.push(`  │`)
        lines.push(`  │  [${turn.label.toUpperCase().padEnd(20)}]  USER : ${turn.user}`)
        const botLines = String(turn.bot || '').split('\n')
        lines.push(`  │                            BOT  : ${botLines[0]}`)
        for (let i = 1; i < botLines.length; i++) {
          if (botLines[i].trim()) lines.push(`  │                                   ${botLines[i]}`)
        }
      }
      lines.push(`  └─────────────────────────────────────────────────────────────────────────────`)
      lines.push('')
    }
    lines.push(thinDiv)
  }

  lines.push('')
  lines.push('END OF REPORT')
  lines.push(divider)
  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const langs = ['en', 'fr', 'vi']
  const allResults = []
  let total = 0
  const scenCount = SCENARIOS.en.length
  console.log(`Running ${langs.length} languages × ${scenCount} scenarios = ${langs.length * scenCount} sessions against live API...\n`)

  for (const lang of langs) {
    console.log(`[${lang.toUpperCase()}] Starting...`)
    for (const scenario of SCENARIOS[lang]) {
      process.stdout.write(`  ${scenario.name} ... `)
      try {
        const result = await runScenario(scenario.name, lang, scenario.steps)
        allResults.push(result)
        total++
        console.log(`done (${result.turns.length} turns)`)
      } catch (e) {
        console.log(`ERROR: ${e.message}`)
        allResults.push({ name: scenario.name, lang, sessionId: 'ERROR', turns: [{ label: 'error', user: '', bot: e.message }] })
      }
    }
    console.log('')
  }

  const bugs = detectBugs(allResults)
  const report = formatReport(allResults, bugs)

  const outFile = 'bug-report-multilang.txt'
  fs.writeFileSync(outFile, report, 'utf8')

  console.log(`\n✓ ${total} sessions completed`)
  console.log(`⚠ ${bugs.length} bug(s) detected`)
  console.log(`\nReport saved to: ${outFile}`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
