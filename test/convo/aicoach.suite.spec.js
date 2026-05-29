/**
 * AI Coach — Backend Regression Suite
 *
 * Tests 10 core conversation scenarios against the AI Coach API.
 * Scenarios cover food logging, fatigue, exercise, hydration, sleep,
 * stress, goal-setting, dietary advice, nutrition queries, and medical escalation.
 *
 * Environment variables:
 *   ELFIE_ENV           – staging (default) | prod
 *   AI_COACH_TOKEN      – Bearer token for Authorization header
 *   AI_COACH_PROGRAM_ID – program/template ID passed to create-session (default: 11)
 *   TEST_LANGUAGE       – en (default; only English scenarios exist today)
 *   ANTHROPIC_API_KEY   – used by AI judge for semantic assertions
 */

require('dotenv').config()

const path = require('path')
const BotDriver = require('../../').BotDriver

// ─── Environment ──────────────────────────────────────────────────────────────

const ENV = (process.env.ELFIE_ENV || 'staging').toLowerCase()
const LANG = (process.env.TEST_LANGUAGE || 'en').toLowerCase()

const ENVS = {
  staging: { host: 'api.stg.elfie.co' },
  prod:    { host: 'api.elfie.co' }
}
const { host: API_HOST } = ENVS[ENV] || ENVS.staging

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = [
  '01_food_logging.convo.txt',
  '02_calorie_query.convo.txt',
  '03_fatigue_report.convo.txt',
  '04_exercise_logging.convo.txt',
  '05_hydration_tracking.convo.txt',
  '06_sleep_concern.convo.txt',
  '07_stress_emotional.convo.txt',
  '08_goal_setting.convo.txt',
  '09_dietary_advice.convo.txt',
  '10_medical_concern.convo.txt'
]

// ─── Capabilities ─────────────────────────────────────────────────────────────

function buildCaps (lang) {
  return {
    PROJECTNAME: `AI Coach [${lang.toUpperCase()}] [${ENV}]`,
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
      message: '{{msg.messageText}}',
      language_code: '{{context.languageCode}}',
      user_id: '{{context.userId}}'
    },

    SIMPLEREST_RESPONSE_JSONPATH: '$.message,$.code',
    SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase',

    SIMPLEREST_START_HOOK: path.resolve(__dirname, '../../botium-hook-ai-coach.js'),
    LANGUAGE_CODE: lang,

    AI_JUDGE_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    AI_JUDGE_MODEL: 'claude-haiku-4-5-20251001'
  }
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe(`AI Coach [${LANG.toUpperCase()}] [${ENV}]`, function () {
  this.timeout(90000)

  const convosDir = path.resolve(__dirname, 'aicoach', LANG)

  SCENARIOS.forEach((file) => {
    const name = file.replace('.convo.txt', '')

    it(name, async function () {
      const caps = buildCaps(LANG)
      const driver = new BotDriver(caps)
      const compiler = driver.BuildCompiler()
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
    const fs = require('fs')
    const outFile = path.resolve(__dirname, `../../test-results-aicoach-${LANG}.json`)
    const summary = {
      language: LANG,
      environment: ENV,
      host: API_HOST,
      scenarios: SCENARIOS.map(f => f.replace('.convo.txt', '')),
      timestamp: new Date().toISOString()
    }
    fs.writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8')
  })
})
