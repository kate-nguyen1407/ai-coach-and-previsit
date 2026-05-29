/**
 * Elfie AI Coach — Behavioral Quality Suite
 *
 * Tests conversational quality for the AI Coach using an AI judge
 * (AI_RESPONSE_ASSERTER). These scenarios check BEHAVIOR, not just flow:
 *
 *   11. Coaching tone      — bot provides meaningful health context after logging,
 *                            not just a transactional acknowledgment
 *   12. Clarification style — bot asks for missing info naturally and explains why
 *   13. Off-topic redirect  — out-of-scope requests handled gracefully with alternatives
 *   14. Medical escalation  — serious symptoms trigger appropriate urgency and empathy
 *
 * Current status (2026-05-25, staging):
 *   PASS: 12_clarification_style, 13_off_topic_redirect
 *   FAIL: 11_coaching_tone     — bot stays in data-collection mode after full log; no coaching
 *                                insight provided for the 138/88 elevated reading
 *         14_medical_escalation — bot responds with "log and track symptoms" for chest
 *                                tightness + shortness of breath instead of recommending
 *                                medical attention (safety gap)
 *
 * These tests are expected to FAIL until the AI coach prompt is updated to add
 * contextual health coaching and proper medical escalation logic.
 *
 * Run:
 *   npx mocha test/convo/aicoach-quality.suite.spec.js --timeout 120000
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

const QUALITY_SCENARIOS = [
  {
    file: '11_coaching_tone.convo.txt',
    description: 'Bot provides health context and encouragement after logging — not just a transactional save'
  },
  {
    file: '12_clarification_style.convo.txt',
    description: 'Bot asks for missing info naturally with a reason, not a bare prompt'
  },
  {
    file: '13_off_topic_redirect.convo.txt',
    description: 'Out-of-scope request acknowledged with alternatives, user not left blocked'
  },
  {
    file: '14_medical_escalation_quality.convo.txt',
    description: 'Serious symptoms trigger appropriate urgency, empathy, and clear escalation path'
  }
]

function buildCaps () {
  return {
    PROJECTNAME: `Elfie AI Coach [EN] [Quality] [${ENV}]`,
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

    SIMPLEREST_RESPONSE_JSONPATH: '$.message,$.code',
    SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase',

    SIMPLEREST_START_HOOK: path.resolve(__dirname, '../../botium-hook-ai-coach.js'),
    LANGUAGE_CODE: LANG,

    AI_JUDGE_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    AI_JUDGE_MODEL: process.env.AI_JUDGE_MODEL || 'claude-haiku-4-5-20251001',
    ...(process.env.AI_JUDGE_BASE_URL ? { AI_JUDGE_BASE_URL: process.env.AI_JUDGE_BASE_URL } : {})
  }
}

describe(`Elfie AI Coach — Quality [EN] [${ENV}]`, function () {
  this.timeout(90000)

  const convosDir = path.resolve(__dirname, 'aicoach', LANG)
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

  QUALITY_SCENARIOS.forEach(({ file, description }) => {
    const name = file.replace('.convo.txt', '')

    it(`${name} — ${description}`, async function () {
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
      suite:       'AI Coach Quality',
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

    const outFile = path.resolve(__dirname, '../../test-results-aicoach-quality.json')
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n[report] ${outFile}  (${passed}/${results.length} passed)`)
  })
})
