/**
 * Elfie Pre-Visit Agent — BE-337 Quality Validation Suite
 *
 * Validates the conversational quality improvements specified in Linear issue BE-337:
 * "Probabilistic Conversation Agent Prompt"
 *
 * These tests check BEHAVIOR, not just flow:
 *   12. Broad grouped prompts — bot asks ONE question covering description + onset + severity
 *   13. Natural transitions  — bot acknowledges previous area before introducing the next
 *   14. Submission format    — closing message is collaborative (clinic summary + patient
 *                              copy + next steps), not transactional
 *   15. Patient redirect     — off-topic question handled gracefully with choice offered
 *
 * These tests are expected to FAIL against the current backend (old robotic prompt) and
 * PASS once the BE-337 prompt improvement is deployed to staging.
 *
 * Run:
 *   ELFIE_API_KEY=<key> npx mocha test/convo/previsit-quality.suite.spec.js --timeout 120000
 *
 * Environment variables:
 *   ELFIE_ENV     – staging (default) | prod
 *   ELFIE_API_KEY – x-api-key header value
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

const ENV  = (process.env.ELFIE_ENV || 'staging').toLowerCase()
const LANG = 'en'

const ENVS = { staging: { host: 'api.stg.elfie.co' }, prod: { host: 'api.elfie.co' } }
const { host: API_HOST } = ENVS[ENV] || ENVS.staging

const VISITS_SYMPTOMS = ['Visit Context', 'Symptoms & Complaint']

const QUALITY_SCENARIOS = [
  {
    file: '12_broad_symptom_prompt.convo.txt',
    domains: VISITS_SYMPTOMS,
    description: 'Bot asks ONE broad grouped symptom question covering description + onset + severity'
  },
  {
    file: '13_natural_transition.convo.txt',
    domains: ['Visit Context', 'Symptoms & Complaint', 'Medical History'],
    description: 'Bot transitions between focus areas with acknowledgment and context'
  },
  {
    file: '14_submission_format.convo.txt',
    domains: VISITS_SYMPTOMS,
    description: 'Closing message is collaborative: clinic summary + patient copy + next steps'
  },
  {
    file: '15_patient_redirect.convo.txt',
    domains: VISITS_SYMPTOMS,
    description: 'Off-topic patient request handled gracefully with choice offered'
  },
]

function buildCaps (domains) {
  return {
    PROJECTNAME: `Elfie Pre-Visit Agent [EN] [BE-337 Quality] [${ENV}]`,
    CONTAINERMODE: 'simplerest',
    SECURITY_ALLOW_UNSAFE: true,

    SIMPLEREST_URL: `https://${API_HOST}/agent/api/v1/ai-coach/chat`,
    SIMPLEREST_METHOD: 'POST',
    SIMPLEREST_TIMEOUT: 90000,

    SIMPLEREST_HEADERS_TEMPLATE: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ELFIE_API_KEY || ''
    },

    SIMPLEREST_BODY_TEMPLATE: {
      session_id: '{{context.sessionId}}',
      user_id: 'botium-test-user',
      message: '{{msg.messageText}}',
      language_code: '{{context.languageCode}}'
    },

    SIMPLEREST_RESPONSE_JSONPATH: '$.message',
    SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase',

    SIMPLEREST_INIT_TEXT: 'start conversation',
    SIMPLEREST_INIT_PROCESS_RESPONSE: true,

    SIMPLEREST_START_HOOK: path.resolve(__dirname, '../../botium-hook-previsit.js'),
    LANGUAGE_CODE: LANG,
    ELFIE_DOMAINS: domains,

    AI_JUDGE_API_KEY: process.env.AI_JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY || 'ollama',
    AI_JUDGE_MODEL: process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001',
    ...(process.env.AI_JUDGE_BASE_URL ? { AI_JUDGE_BASE_URL: process.env.AI_JUDGE_BASE_URL } : {})
  }
}

describe('Elfie Pre-Visit Agent — BE-337 Quality [EN] [staging]', function () {
  this.timeout(90000)

  const convosDir  = path.resolve(__dirname, 'previsit', LANG)
  const pconvoFile = '_opening.pconvo.txt'

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

  QUALITY_SCENARIOS.forEach(({ file, domains, description }) => {
    const name = file.replace('.convo.txt', '')

    it(`${name} — ${description}`, async function () {
      const caps      = buildCaps(domains)
      const driver    = new BotDriver(caps)
      const compiler  = driver.BuildCompiler()
      const container = await driver.Build()
      await container.Start()

      try {
        const pconvoPath = path.join(convosDir, pconvoFile)
        if (fs.existsSync(pconvoPath)) compiler.ReadScript(convosDir, pconvoFile)

        compiler.ReadScript(convosDir, file)
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
      suite:       'BE-337 Quality',
      language:    LANG,
      environment: ENV,
      host:        API_HOST,
      timestamp:   new Date().toISOString(),
      ai_judge:    process.env.AI_JUDGE_BASE_URL
        ? `${process.env.AI_JUDGE_BASE_URL} / ${process.env.AI_JUDGE_MODEL || 'default'}`
        : `anthropic / ${process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001'}`,
      summary: { total: results.length, passed, failed, duration_ms: totalMs },
      scenarios: results.map(r => ({
        name:        r.name,
        state:       r.state,
        duration_ms: r.duration_ms,
        ...(r.error      ? { error:      r.error      } : {}),
        ...(r.transcript ? { transcript: r.transcript } : {})
      }))
    }

    const outFile = path.resolve(__dirname, '../../test-results-quality.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n[report] ${outFile}  (${passed}/${results.length} passed)`)
  })
})
