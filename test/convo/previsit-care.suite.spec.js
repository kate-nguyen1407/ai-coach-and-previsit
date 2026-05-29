/**
 * Elfie Pre-Visit Agent — Care UI — End-to-End Regression Suite
 *
 * Tests the pre-visit agent through the care.elfie.co frontend API with ALL
 * domains enabled, mirroring how a real patient experiences the conversation:
 * one session, one continuous flow covering visit context → symptoms →
 * medical history → medications → monitoring → lifestyle → mental health →
 * exposure → administrative.
 *
 * Each scenario is a full end-to-end convo file. The suite checks for a
 * care-specific override under test/convo/previsit-care/<lang>/ first,
 * then falls back to test/convo/previsit/<lang>/.
 *
 * After each scenario, the captured summary (from suggestActions at the
 * completion turn) is validated against per-scenario expected fields.
 *
 * Environment variables (all optional — defaults read from .env):
 *   ELFIE_ENV           – staging (default) | prod
 *   CARE_PREVISIT_SLUG  – clinic slug (default: jk-clinic-4k2q)
 *   ANTHROPIC_API_KEY   – Claude judge key
 *
 * Run:
 *   npx mocha test/convo/previsit-care.suite.spec.js --timeout 180000
 */

const assert = require('assert')
const fs   = require('fs')
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })
const BotDriver = require('../../').BotDriver
const { SUMMARY_STATE_FILE } = require('../../botium-hook-care-response.js')

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

// ─── End-to-End Scenarios ─────────────────────────────────────────────────────
//
// Each scenario is one complete patient journey covering all domains.
// `expect` fields are validated against the summary captured from suggestActions
// at the conversation's completion turn. All checks are case-insensitive substring
// matches against the JSON-stringified summary so they are robust to phrasing changes.

const E2E_SCENARIOS = [
  {
    name:  'james-nguyen-knee-pain-en',
    label: 'James Nguyen — Right Knee Pain (EN)',
    lang:  'en',
    file:  '20_live_regression.convo.txt',
    expect: {
      // Keys are human-readable labels; values are substrings that must appear
      // somewhere in JSON.stringify(summary) (case-insensitive).
      'patient name contains James':           'james',
      'complaint mentions knee':               'knee',
      'medications mention ibuprofen':         'ibuprofen',
      'patient questions mention ligament or MRI or physio': ['ligament', 'mri', 'physio']
    }
  },
  {
    name:  'sarah-johnson-migraines-en',
    label: 'Sarah Johnson — Recurring Migraines (EN)',
    lang:  'en',
    file:  '21_e2e_migraines.convo.txt',
    expect: {
      'patient name contains Sarah':           'sarah',
      'complaint mentions migraine or headache': ['migraine', 'headache'],
      'medications mention sumatriptan':       'sumatriptan',
      'allergies mention penicillin':          'penicillin',
      'patient questions mention neurologist or preventive': ['neurologist', 'preventive']
    }
  }
]

// ─── Capabilities ─────────────────────────────────────────────────────────────

function buildCaps (lang) {
  return {
    PROJECTNAME: `Elfie Pre-Visit Agent [Care UI] [E2E] [${ENV}]`,
    CONTAINERMODE: 'simplerest',
    SECURITY_ALLOW_UNSAFE: true,

    SIMPLEREST_URL: CARE_URL,
    SIMPLEREST_METHOD: 'POST',
    SIMPLEREST_TIMEOUT: 90000,

    SIMPLEREST_HEADERS_TEMPLATE: {
      'Content-Type': 'application/json'
    },

    SIMPLEREST_BODY_TEMPLATE: {
      sessionId:    '{{context.sessionId}}',
      userId:       '{{context.userId}}',
      message:      '{{msg.messageText}}',
      languageCode: '{{context.languageCode}}'
    },

    SIMPLEREST_RESPONSE_JSONPATH: '$.message',
    SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase',

    SIMPLEREST_INIT_TEXT: 'start conversation',
    SIMPLEREST_INIT_PROCESS_RESPONSE: true,

    SIMPLEREST_START_HOOK:    path.resolve(__dirname, '../../botium-hook-care-previsit.js'),
    SIMPLEREST_RESPONSE_HOOK: path.resolve(__dirname, '../../botium-hook-care-response.js'),
    LANGUAGE_CODE: lang,
    ELFIE_DOMAINS: ALL_DOMAINS,
    CARE_PREVISIT_SLUG: SLUG,

    AI_JUDGE_API_KEY: process.env.AI_JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY || 'ollama',
    AI_JUDGE_MODEL: process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001',
    ...(process.env.AI_JUDGE_BASE_URL ? { AI_JUDGE_BASE_URL: process.env.AI_JUDGE_BASE_URL } : {})
  }
}

// ─── Summary Validation ───────────────────────────────────────────────────────

function validateSummary (scenario) {
  if (!fs.existsSync(SUMMARY_STATE_FILE)) {
    console.warn('[summary-validate] No summary file found — conversation may not have reached completion')
    return { captured: false, checks: [] }
  }

  const state   = JSON.parse(fs.readFileSync(SUMMARY_STATE_FILE, 'utf8'))
  const summary = state.summary
  const raw     = JSON.stringify(summary).toLowerCase()

  console.log('[summary-validate] Summary for session', state.sessionId, ':\n', JSON.stringify(summary, null, 2))

  const checks = []
  for (const [label, expectation] of Object.entries(scenario.expect)) {
    const terms   = Array.isArray(expectation) ? expectation : [expectation]
    const matched = terms.some(t => raw.includes(t.toLowerCase()))
    checks.push({ label, terms, matched })
    if (matched) {
      console.log(`  [PASS] ${label}`)
    } else {
      console.warn(`  [FAIL] ${label} — expected one of: ${terms.join(', ')}`)
    }
  }

  return { captured: true, sessionId: state.sessionId, summary, checks }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe(`Elfie Pre-Visit Agent — Care UI — E2E [${ENV}] [${SLUG}]`, function () {
  this.timeout(180000)

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

  E2E_SCENARIOS.forEach(scenario => {
    const { name, label, lang, file } = scenario

    it(label, async function () {
      // Clear any stale summary from a previous run
      if (fs.existsSync(SUMMARY_STATE_FILE)) fs.unlinkSync(SUMMARY_STATE_FILE)

      const caps      = buildCaps(lang)
      const driver    = new BotDriver(caps)
      const compiler  = driver.BuildCompiler()
      const container = await driver.Build()
      await container.Start()

      try {
        const convosDir     = path.resolve(__dirname, 'previsit', lang)
        const careConvosDir = path.resolve(__dirname, 'previsit-care', lang)
        const careOverride  = path.join(careConvosDir, file)
        const scriptDir     = fs.existsSync(careOverride) ? careConvosDir : convosDir

        compiler.ReadScript(scriptDir, file)
        compiler.ExpandConvos()

        const convo = compiler.convos[compiler.convos.length - 1]
        await convo.Run(container)
      } finally {
        await container.Stop()
        await container.Clean()
      }

      // Validate the summary captured by the response hook
      const validation = validateSummary(scenario)
      const lastResult = results[results.length - 1]
      if (lastResult) lastResult.summary_validation = validation

      if (validation.captured) {
        const failed = validation.checks.filter(c => !c.matched)
        if (failed.length > 0) {
          const msg = failed.map(c => `"${c.label}": expected one of [${c.terms.join(', ')}] in summary`).join('\n')
          throw new Error(`Summary validation failed:\n${msg}`)
        }
      }
    })
  })

  after(function () {
    const passed  = results.filter(r => r.state === 'passed').length
    const failed  = results.filter(r => r.state === 'failed').length
    const totalMs = results.reduce((s, r) => s + (r.duration_ms || 0), 0)

    const report = {
      suite:       'Care UI End-to-End Regression',
      environment: ENV,
      slug:        SLUG,
      host:        CARE_HOST,
      timestamp:   new Date().toISOString(),
      ai_judge:    process.env.AI_JUDGE_BASE_URL
        ? `${process.env.AI_JUDGE_BASE_URL} / ${process.env.AI_JUDGE_MODEL || 'default'}`
        : `anthropic / ${process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001'}`,
      summary:     { total: results.length, passed, failed, duration_ms: totalMs },
      scenarios:   results.map(r => ({
        name:              r.name,
        state:             r.state,
        duration_ms:       r.duration_ms,
        ...(r.error              ? { error:              r.error              } : {}),
        ...(r.transcript         ? { transcript:         r.transcript         } : {}),
        ...(r.summary_validation ? { summary_validation: r.summary_validation } : {})
      }))
    }

    const outFile = path.resolve(__dirname, '../../test-results-care-e2e.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n[report] ${outFile}  (${passed}/${results.length} passed)`)
  })
})
