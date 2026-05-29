const https = require('https')

const ENVS = {
  staging: { host: 'api.stg.elfie.co' },
  prod:    { host: 'api.elfie.co' }
}
const { host: API_HOST } = ENVS[(process.env.ELFIE_ENV || 'staging').toLowerCase()] || ENVS.staging

module.exports = async (view) => {
  const containerCaps = view.container && view.container.caps
  const lang = (containerCaps && containerCaps.LANGUAGE_CODE) || 'en'

  // Unique per test run — prevents accumulated user history on staging from
  // affecting safety/routing behaviour across runs (seen suppressing v2_06).
  const userId = `botium-test-${Date.now()}`

  const body = JSON.stringify({
    user_id: userId,
    language_code: lang
  })

  const sessionId = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path: '/agent/api/v1/ai-coach/create-session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ELFIE_API_KEY || '',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          console.log('[ai-coach-hook] create-session response:', parsed)
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
  console.log('[ai-coach-hook] Session created:', sessionId, '| user:', userId, '| lang:', lang)
}
