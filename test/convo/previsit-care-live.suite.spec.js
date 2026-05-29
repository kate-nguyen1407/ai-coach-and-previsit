/**
 * Elfie Pre-Visit Agent — Care UI — Live Regression Suite
 *
 * Runs the full end-to-end live regression scenario (James Nguyen, knee pain)
 * through the Care UI frontend API at care.stg.elfie.co.
 *
 * Two tests:
 *   flow    — verifies the conversation follows the expected turns end-to-end
 *   quality — adds AI judge criteria on key turns to evaluate response quality
 *
 * Environment variables (all optional — defaults read from .env):
 *   ELFIE_ENV           – staging (default) | prod
 *   CARE_PREVISIT_SLUG  – clinic slug (default: jk-clinic-4k2q)
 *   ANTHROPIC_API_KEY   – Claude judge key
 *
 * Run:
 *   npx mocha test/convo/previsit-care-live.suite.spec.js --timeout 180000
 */

const fs   = require('fs')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })
const BotDriver = require('../../').BotDriver

function extractTranscript (err) {
  if (!err || !err.transcript || !err.transcript.steps) return null
  return err.transcript.steps
    .filter(s => s.actual && s.actual.messageText)
    .map(s => {
      const role = s.expected && s.expected.sender === 'me' ? 'user' : 'bot'
      const turn = { role, text: s.actual.messageText }
      if (role === 'bot' && s.err) {
        const cause = s.err.context && s.err.context.cause
        if (cause && cause.failures) {
          turn.ai_judge = cause.failures.map(f => ({ criterion: f.criterion, verdict: f.verdict, reason: f.reason }))
        } else {
          turn.failed = true
          if (s.expected && s.expected.messageText) turn.expected_pattern = s.expected.messageText
        }
      }
      return turn
    })
}

// ─── Environment ──────────────────────────────────────────────────────────────

const ENV  = (process.env.ELFIE_ENV || 'staging').toLowerCase()
const SLUG = process.env.CARE_PREVISIT_SLUG || 'jk-clinic-4k2q'
const LANG = 'en'

const ENVS = {
  staging: { host: 'care.stg.elfie.co' },
  prod:    { host: 'care.elfie.co' }
}
const { host: CARE_HOST } = ENVS[ENV] || ENVS.staging
const CARE_URL = `https://${CARE_HOST}/api/v1/ai-chat/chat`

const ALL_DOMAINS = [
  'visitContext', 'symptomsComplaint', 'medicalHistory',
  'medicationTreatment', 'monitoringMetrics', 'lifestyleBehavior',
  'mentalEmotional', 'exposureRisk', 'administrative'
]

// ─── Capabilities ─────────────────────────────────────────────────────────────

function buildCaps () {
  return {
    PROJECTNAME: `Elfie Pre-Visit Agent [Care UI] [Live Regression] [${ENV}]`,
    CONTAINERMODE: 'simplerest',
    SECURITY_ALLOW_UNSAFE: true,

    SIMPLEREST_URL: CARE_URL,
    SIMPLEREST_METHOD: 'POST',
    SIMPLEREST_TIMEOUT: 90000,

    SIMPLEREST_HEADERS_TEMPLATE: {
      'Content-Type': 'application/json'
    },

    SIMPLEREST_BODY_TEMPLATE: {
      sessionId: '{{context.sessionId}}',
      userId: '{{context.userId}}',
      message: '{{msg.messageText}}',
      languageCode: '{{context.languageCode}}'
    },

    SIMPLEREST_RESPONSE_JSONPATH: '$.message',
    SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase',

    SIMPLEREST_INIT_TEXT: 'start conversation',
    SIMPLEREST_INIT_PROCESS_RESPONSE: true,

    SIMPLEREST_START_HOOK: path.resolve(__dirname, '../../botium-hook-care-previsit.js'),
    LANGUAGE_CODE: LANG,
    ELFIE_DOMAINS: ALL_DOMAINS,
    CARE_PREVISIT_SLUG: SLUG,

    AI_JUDGE_API_KEY: process.env.AI_JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY || 'ollama',
    AI_JUDGE_MODEL: process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001',
    ...(process.env.AI_JUDGE_BASE_URL ? { AI_JUDGE_BASE_URL: process.env.AI_JUDGE_BASE_URL } : {})
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe(`Elfie Pre-Visit Agent — Care UI — Live Regression [${ENV}] [${SLUG}]`, function () {
  this.timeout(180000)

  const convosDir     = path.resolve(__dirname, 'previsit', LANG)
  const careConvosDir = path.resolve(__dirname, 'previsit-care', LANG)

  const SCENARIOS = [
    { name: 'flow',    file: '20_live_regression.convo.txt' },
    { name: 'quality', file: '20_live_regression_quality.convo.txt' }
  ]

  const results = []

  afterEach(function () {
    const t = this.currentTest
    results.push({
      name:        t.title,
      state:       t.state,
      duration_ms: t.duration ?? 0,
      error:       t.err ? t.err.message : null,
      ...(t.err ? { transcript: extractTranscript(t.err) } : {})
    })
  })

  SCENARIOS.forEach(({ name, file }) => {
    it(name, async function () {
      const caps      = buildCaps()
      const driver    = new BotDriver(caps)
      const compiler  = driver.BuildCompiler()
      const container = await driver.Build()
      await container.Start()

      try {
        const careOverridePath = path.join(careConvosDir, file)
        const scriptDir = fs.existsSync(careOverridePath) ? careConvosDir : convosDir
        compiler.ReadScript(scriptDir, file)
        compiler.ExpandConvos()

        const convo = compiler.convos[compiler.convos.length - 1]
        await convo.Run(container)
      } finally {
        await container.Stop()
        await container.Clean()
      }
    })
  })

  after(function () {
    const passed  = results.filter(r => r.state === 'passed').length
    const failed  = results.filter(r => r.state === 'failed').length
    const totalMs = results.reduce((s, r) => s + (r.duration_ms || 0), 0)

    const report = {
      suite:       'Care UI Live Regression',
      scenario:    'James Nguyen — Right Knee Pain (post-football injury)',
      language:    LANG,
      environment: ENV,
      slug:        SLUG,
      host:        CARE_HOST,
      timestamp:   new Date().toISOString(),
      ai_judge:    process.env.AI_JUDGE_BASE_URL
        ? `${process.env.AI_JUDGE_BASE_URL} / ${process.env.AI_JUDGE_MODEL || 'default'}`
        : `anthropic / ${process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001'}`,
      summary:  { total: results.length, passed, failed, duration_ms: totalMs },
      scenarios: results.map(r => ({
        name:        r.name,
        state:       r.state,
        duration_ms: r.duration_ms,
        ...(r.error      ? { error:      r.error      } : {}),
        ...(r.transcript ? { transcript: r.transcript } : {})
      }))
    }

    const outFile = path.resolve(__dirname, '../../test-results-care-live.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n[report] ${outFile}  (${passed}/${results.length} passed)`)
  })
})
