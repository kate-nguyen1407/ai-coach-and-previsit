const https = require('https')
const fs    = require('fs')
const os    = require('os')
const path  = require('path')

const SESSION_STATE_FILE = path.join(os.tmpdir(), 'botium-care-previsit-session.json')

const ENVS = {
  staging: { host: 'care.stg.elfie.co' },
  prod:    { host: 'care.elfie.co' }
}
const { host: CARE_HOST } = ENVS[(process.env.ELFIE_ENV || 'staging').toLowerCase()] || ENVS.staging

module.exports = async (view) => {
  const containerCaps = view.container && view.container.caps
  const lang  = (containerCaps && containerCaps.LANGUAGE_CODE)       || 'en'
  const slug  = (containerCaps && containerCaps.CARE_PREVISIT_SLUG)  || process.env.CARE_PREVISIT_SLUG || 'jk-clinic-4k2q'
  const ALL_DOMAINS = [
    'visitContext', 'symptomsComplaint', 'medicalHistory',
    'medicationTreatment', 'monitoringMetrics', 'lifestyleBehavior',
    'mentalEmotional', 'exposureRisk', 'administrative'
  ]
  const domains = (containerCaps && containerCaps.ELFIE_DOMAINS) || ALL_DOMAINS

  const userId = `botium-test-${Date.now()}`

  const body = JSON.stringify({
    userId,
    languageCode: lang,
    config: {
      patient_info: { name: 'Test User' },
      use_case: 'pre-visit',
      slug,
      domains,
      clinicName: '',
      doctorLanguageCode: lang
    }
  })

  const sessionId = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: CARE_HOST,
      path: '/api/v1/ai-chat/create-session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          console.log('[care-previsit-hook] create-session response:', parsed)
          const id = parsed.sessionId || parsed.session_id
          if (id) resolve(id)
          else reject(new Error(`No sessionId in response: ${data}`))
        } catch (e) {
          reject(new Error(`Failed to parse create-session response: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })

  view.context.sessionId = sessionId
  view.context.languageCode = lang
  view.context.userId = userId
  fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify({ sessionId, userId, lang, slug, host: CARE_HOST }))
  console.log('[care-previsit-hook] Session created:', sessionId, '| lang:', lang, '| slug:', slug)
}

module.exports.SESSION_STATE_FILE = SESSION_STATE_FILE
