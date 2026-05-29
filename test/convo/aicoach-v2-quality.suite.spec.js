/**
 * Elfie AI Coach V2 — Quality Validation Suite
 * Linear: ELF-24578 — [AI Coach v2] Layer 2 Intelligence, Orchestration & Communication V2
 *
 * Validates the V2 architecture requirements against staging using an AI judge
 * (AI_RESPONSE_ASSERTER). Each scenario maps to a specific V2 principle:
 *
 *   v2_01  Emotional Handling          — Personality Layer + Emotional Handling principle
 *          Bot validates feelings before pivoting to action (no cold data-first response)
 *
 *   v2_02  Non-Repetitive Flow         — Conversational Intelligence Engine (CIE)
 *          Multi-item session uses varied natural language, not templated acknowledgments
 *
 *   v2_03  Dual-Mode Arbitration       — Arbitration Layer
 *          Single message with emotional content + health data handled by both pathways
 *
 *   v2_04  Time Horizon Awareness      — Time Horizon Awareness principle
 *          Immediate concern and long-term goal both addressed in one turn
 *
 *   v2_05  Coaching Behavior Support   — Coaching & Behavior Support Plugin
 *          Streak/pattern recognised with progression coaching, not just a data save
 *
 *   v2_06  Safety Escalation           — Governance, Safety & Escalation Plugin
 *          Worsening cardiac symptoms trigger medical escalation, not symptom tracking
 *
 *   v2_07  Mode Switching E2E          — Arbitration Layer (multi-turn)
 *          Data log → advice seek → data log: each turn routed to correct mode
 *
 *   v2_08  Context Retention           — User 360 Data + Layer 3 Knowledge Taxonomy
 *          Bot recalls specific logged values later in the same session to give personalised insight
 *
 *   v2_09  Clarification & Exploration — Clarification & Exploration Plugin
 *          Vague symptom probed with open-ended empathetic question; follow-up synthesised
 *
 *   v2_10  User Resistance             — Personality Layer + Coaching & Behavior Support
 *          User declines lifestyle advice; bot respects boundary without becoming cold
 *
 *   v2_11  Medication Safety           — Governance, Safety & Escalation Plugin (alt trigger)
 *          Accidental double dose escalated to pharmacist/doctor, not logged as routine entry
 *
 * Run:
 *   npx mocha test/convo/aicoach-v2-quality.suite.spec.js --timeout 120000
 *
 * Environment variables (loaded from .env automatically):
 *   ELFIE_ENV         – staging (default) | prod
 *   ELFIE_API_KEY     – x-api-key header value
 *   ANTHROPIC_API_KEY – Claude judge key (AI_RESPONSE_ASSERTER)
 */

require('dotenv').config()

const fs   = require('fs')
const path = require('path')
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
          turn.ai_judge = cause.failures.map(f => ({
            criterion: f.criterion,
            verdict:   f.verdict,
            reason:    f.reason
          }))
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

const V2_SCENARIOS = [
  {
    file:        'v2_01_emotional_handling.convo.txt',
    principle:   'Emotional Handling + Personality Layer',
    description: 'Validates feelings before pivoting to action — no cold data-first response'
  },
  {
    file:        'v2_02_non_repetitive_flow.convo.txt',
    principle:   'Conversational Intelligence Engine (CIE)',
    description: 'Multi-item session uses varied natural language, not templated acknowledgments'
  },
  {
    file:        'v2_03_dual_mode_arbitration.convo.txt',
    principle:   'Arbitration Layer',
    description: 'Emotional content + health data in one message handled by both pathways'
  },
  {
    file:        'v2_04_time_horizon_awareness.convo.txt',
    principle:   'Time Horizon Awareness',
    description: 'Immediate concern and long-term goal both addressed in a single turn'
  },
  {
    file:        'v2_05_coaching_behavior_support.convo.txt',
    principle:   'Coaching & Behavior Support Plugin',
    description: 'Streak/pattern recognised with progression coaching, not just a data save'
  },
  {
    file:        'v2_06_safety_escalation.convo.txt',
    principle:   'Governance, Safety & Escalation Plugin',
    description: 'Worsening cardiac symptoms trigger medical escalation, not symptom tracking'
  },
  {
    file:        'v2_07_mode_switching.convo.txt',
    principle:   'Arbitration Layer (multi-turn E2E)',
    description: 'Data log → advice seek → data log: each turn routed to the correct mode'
  },
  {
    file:        'v2_08_context_retention.convo.txt',
    principle:   'User 360 Data + Layer 3 Knowledge Taxonomy',
    description: 'Bot recalls specific logged values later in session to give personalised insight'
  },
  {
    file:        'v2_09_clarification_exploration.convo.txt',
    principle:   'Clarification & Exploration Plugin',
    description: 'Vague symptom probed with open-ended empathetic question; follow-up synthesised'
  },
  {
    file:        'v2_10_user_resistance.convo.txt',
    principle:   'Personality Layer + Coaching & Behavior Support',
    description: 'User declines lifestyle advice; bot respects boundary without becoming cold'
  },
  {
    file:        'v2_11_medication_safety.convo.txt',
    principle:   'Governance, Safety & Escalation Plugin (alt trigger)',
    description: 'Accidental double dose escalated to pharmacist/doctor, not logged as routine entry'
  }
]

function buildCaps () {
  return {
    PROJECTNAME: `Elfie AI Coach [EN] [V2 Quality] [${ENV}]`,
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
      session_id:    '{{context.sessionId}}',
      user_id:       '{{context.userId}}',
      message:       '{{msg.messageText}}',
      language_code: '{{context.languageCode}}'
    },

    SIMPLEREST_RESPONSE_JSONPATH: '$.message,$.code',
    SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase',

    SIMPLEREST_START_HOOK: path.resolve(__dirname, '../../botium-hook-ai-coach.js'),
    LANGUAGE_CODE: LANG,

    AI_JUDGE_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    AI_JUDGE_MODEL:   process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001',
    ...(process.env.AI_JUDGE_BASE_URL ? { AI_JUDGE_BASE_URL: process.env.AI_JUDGE_BASE_URL } : {})
  }
}

describe(`Elfie AI Coach V2 — Quality [ELF-24578] [EN] [${ENV}]`, function () {
  this.timeout(90000)

  const convosDir = path.resolve(__dirname, 'aicoach', LANG)
  const results   = []

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

  V2_SCENARIOS.forEach(({ file, principle, description }) => {
    const name = file.replace('.convo.txt', '')

    it(`${name} [${principle}] — ${description}`, async function () {
      const caps      = buildCaps()
      const driver    = new BotDriver(caps)
      const compiler  = driver.BuildCompiler()
      const container = await driver.Build()
      await container.Start()

      try {
        compiler.ReadScript(convosDir, file)
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
      suite:       'AI Coach V2 Quality — ELF-24578',
      language:    LANG,
      environment: ENV,
      host:        API_HOST,
      timestamp:   new Date().toISOString(),
      ai_judge:    process.env.AI_JUDGE_BASE_URL
        ? `${process.env.AI_JUDGE_BASE_URL} / ${process.env.AI_JUDGE_MODEL || 'default'}`
        : `anthropic / ${process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001'}`,
      summary: {
        total:  results.length,
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

    const outFile = path.resolve(__dirname, '../../test-results-aicoach-v2-quality.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n[report] ${outFile}  (${passed}/${results.length} passed, ${failed} failed)`)

    if (failed > 0) {
      console.log('\n[v2-quality] FAILING SCENARIOS (map to V2 requirements not yet met):')
      results.filter(r => r.state === 'failed').forEach(r => {
        console.log(`  ✗ ${r.name}`)
        if (r.transcript) {
          r.transcript
            .filter(t => t.ai_judge)
            .forEach(t => t.ai_judge
              .filter(j => j.verdict === 'FAIL')
              .forEach(j => console.log(`      [FAIL] ${j.criterion}\n             ${j.reason}`))
            )
        }
      })
    }
  })
})
