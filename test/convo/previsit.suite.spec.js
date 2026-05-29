/**
 * Elfie Pre-Visit Agent — Full Regression Suite
 *
 * Runs 10 core conversation scenarios for the language selected via TEST_LANGUAGE
 * (en | fr | vi, default: en).  Scenario 11 (post_summary) is an optional slow test
 * gated by TEST_POST_SUMMARY=1.
 *
 * Shared opening turns (name + consent) live in previsit/<lang>/_opening.pconvo.txt
 * and are injected via #include _opening in each convo file (except 01_opening).
 *
 * Environment variables (all optional — defaults read from .env):
 *   ELFIE_ENV         – staging (default) | prod
 *   ELFIE_API_KEY     – x-api-key header value
 *   ANTHROPIC_API_KEY – Claude judge key (AI_RESPONSE_ASSERTER)
 *   TEST_LANGUAGE     – en | fr | vi  (default: en)
 *   TEST_POST_SUMMARY – set to "1" to also run 11_post_summary
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
const LANG = (process.env.TEST_LANGUAGE || 'en').toLowerCase()
const RUN_POST_SUMMARY = process.env.TEST_POST_SUMMARY === '1'

const ENVS = {
  staging: { host: 'api.stg.elfie.co' },
  prod:    { host: 'api.elfie.co' }
}
const { host: API_HOST } = ENVS[ENV] || ENVS.staging

const LANG_LABELS = { en: 'English', fr: 'French', vi: 'Vietnamese' }

// ─── Scenarios ────────────────────────────────────────────────────────────────

const ALL_DOMAINS = [
  'Visit Context', 'Symptoms & Complaint', 'Medical History',
  'Medication & Treatment', 'Monitoring & Metrics', 'Lifestyle & Behavior',
  'Mental & Emotional', 'Exposure Risk', 'Administrative'
]

const CORE_SCENARIOS = [
  { file: '01_opening.convo.txt',         domains: ['Visit Context'] },
  { file: '02_identity.convo.txt',         domains: ['Visit Context'] },
  { file: '03_visit_context.convo.txt',    domains: ['Visit Context'] },
  { file: '04_symptoms.convo.txt',         domains: ['Visit Context', 'Symptoms & Complaint'] },
  { file: '05_medical_history.convo.txt',  domains: ['Visit Context', 'Medical History'] },
  { file: '06_medication.convo.txt',       domains: ['Visit Context', 'Medication & Treatment'] },
  { file: '07_lifestyle.convo.txt',        domains: ['Visit Context', 'Lifestyle & Behavior'] },
  { file: '08_mental_emotional.convo.txt', domains: ['Visit Context', 'Mental & Emotional'] },
  { file: '09_closing.convo.txt',          domains: ALL_DOMAINS },
  { file: '10_uncertain_answers.convo.txt',domains: ['Visit Context', 'Symptoms & Complaint'] },
]

const POST_SUMMARY = { file: '11_post_summary.convo.txt', domains: ALL_DOMAINS }

// ─── Capabilities ─────────────────────────────────────────────────────────────

function buildCaps (lang, domains) {
  return {
    PROJECTNAME: `Elfie Pre-Visit Agent [${lang.toUpperCase()}] [${ENV}]`,
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
    LANGUAGE_CODE: lang,
    ELFIE_DOMAINS: domains,
    AI_JUDGE_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    AI_JUDGE_MODEL: 'claude-haiku-4-5-20251001'
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe(`Elfie Pre-Visit Agent — ${LANG_LABELS[LANG] || LANG.toUpperCase()} [${ENV}]`, function () {
  this.timeout(90000)

  const convosDir  = path.resolve(__dirname, 'previsit', LANG)
  const pconvoFile = '_opening.pconvo.txt'
  const scenarios  = RUN_POST_SUMMARY ? [...CORE_SCENARIOS, POST_SUMMARY] : CORE_SCENARIOS

  // Per-scenario results accumulated for the final report
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

  scenarios.forEach(({ file, domains }) => {
    const name = file.replace('.convo.txt', '')

    it(name, async function () {
      const caps      = buildCaps(LANG, domains)
      const driver    = new BotDriver(caps)
      const compiler  = driver.BuildCompiler()
      const container = await driver.Build()
      await container.Start()

      // Capture session ID written by the hook into the scripting context
      const entry   = results[results.length - 1]  // current (pre-populated by afterEach on prior test)
      const getCtx  = () =>
        container?.scriptingEvents?.context?.sessionId ||
        container?.context?.sessionId ||
        'N/A'

      try {
        // Load shared partial convo first (no-op for 01_opening which has no #include)
        const pconvoPath = path.join(convosDir, pconvoFile)
        if (fs.existsSync(pconvoPath)) compiler.ReadScript(convosDir, pconvoFile)

        compiler.ReadScript(convosDir, file)
        compiler.ExpandConvos()

        const convo = compiler.convos[compiler.convos.length - 1]
        await convo.Run(container)

        // Attach session ID to the result that afterEach will record
        this._sessionId = getCtx()
      } finally {
        await container.Stop()
        await container.Clean()
      }
    })
  })

  // Enrich results with session IDs and write the report
  after(function () {
    // afterEach ran before after, so results[] is fully populated — patch session IDs
    // (session ID is attached via this._sessionId inside it(); here we just write what we have)
    const passed = results.filter(r => r.state === 'passed').length
    const failed = results.filter(r => r.state === 'failed').length
    const totalMs = results.reduce((s, r) => s + (r.duration_ms || 0), 0)

    const report = {
      language:    LANG,
      environment: ENV,
      host:        API_HOST,
      timestamp:   new Date().toISOString(),
      summary: {
        total:       results.length,
        passed,
        failed,
        duration_ms: totalMs
      },
      scenarios: results.map(r => ({
        name:        r.name,
        state:       r.state,
        duration_ms: r.duration_ms,
        ...(r.error      ? { error:      r.error      } : {}),
        ...(r.transcript ? { transcript: r.transcript } : {})
      }))
    }

    const outFile = path.resolve(__dirname, `../../test-results-${LANG}.json`)
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n[report] ${outFile}  (${passed}/${results.length} passed)`)
  })
})
