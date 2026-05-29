const { BotiumError } = require('../../BotiumError')
const AIClient = require('../../../ai/AIClient')

const SYSTEM_PROMPT = `You are a strict quality-assurance judge evaluating chatbot responses.
You will receive:
  - USER MESSAGE: what the human said
  - BOT RESPONSE: what the chatbot replied
  - CRITERIA: one or more acceptance criteria the bot response must satisfy

For EACH criterion, decide independently: PASS or FAIL.
Reply with ONLY a JSON object in this exact shape — no prose, no markdown:
{
  "overall": "PASS" | "FAIL",
  "results": [
    { "criterion": "<criterion text>", "verdict": "PASS" | "FAIL", "reason": "<one sentence>" }
  ]
}
"overall" is "PASS" only when every criterion passes.`

/**
 * AI-powered asserter that uses Claude as a judge to evaluate bot responses.
 *
 * Usage in .convo.txt:
 *   #bot
 *   AI_RESPONSE_ASSERTER: answer must mention the refund policy
 *
 * Multiple criteria (pipe-separated):
 *   AI_RESPONSE_ASSERTER: answer must be polite|answer must not contain prices
 *
 * Capabilities:
 *   AI_JUDGE_API_KEY   – Anthropic key (or env ANTHROPIC_API_KEY)
 *   AI_JUDGE_MODEL     – model to use (default: claude-sonnet-4-6)
 *   AI_JUDGE_TIMEOUT   – timeout ms (default: 30000)
 *   AI_JUDGE_MAX_TOKENS – max response tokens (default: 1024)
 */
module.exports = class AIResponseAsserter {
  constructor (context, caps = {}) {
    this.context = context
    this.caps = caps
    this.name = 'AI Response Asserter'
  }

  async assertConvoStep ({ convo, convoStep, args, botMsg }) {
    if (!args || args.length === 0) {
      throw new BotiumError(
        `${convoStep.stepTag}: ${this.name} requires at least one criterion argument`,
        { type: 'asserter', subtype: 'wrong parameters', source: this.name, cause: { args } }
      )
    }

    const criteria = args.flatMap(a => a.split('|').map(s => s.trim())).filter(Boolean)
    if (criteria.length === 0) {
      throw new BotiumError(
        `${convoStep.stepTag}: ${this.name} criteria list is empty after parsing`,
        { type: 'asserter', subtype: 'wrong parameters', source: this.name, cause: { args } }
      )
    }

    const userText = this._resolveUserText(convo, convoStep)
    const botText = botMsg && botMsg.messageText ? botMsg.messageText : ''
    const tag = convoStep.stepTag

    if (this.caps.AI_JUDGE_MOCK || process.env.AI_JUDGE_MOCK) {
      console.log(`[AI-judge] ${tag} MOCK MODE — skipping API call`)
      criteria.forEach(c => {
        console.log(`[AI-judge] ${tag} ~ MOCK  "${c}"`)
        console.log(`           → mock mode: criterion not evaluated against real bot response`)
      })
      return
    }

    let client
    try {
      client = new AIClient(this.caps)
    } catch (err) {
      throw new BotiumError(
        `${convoStep.stepTag}: ${this.name} could not initialise AI client – ${err.message}`,
        { type: 'asserter', source: this.name, cause: { initError: err.message } }
      )
    }

    const userPrompt = [
      `USER MESSAGE:\n${userText || '(none)'}`,
      `BOT RESPONSE:\n${botText || '(empty)'}`,
      `CRITERIA:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    ].join('\n\n')

    let raw
    try {
      raw = await client.chat(SYSTEM_PROMPT, userPrompt)
    } catch (err) {
      throw new BotiumError(
        `${convoStep.stepTag}: ${this.name} AI call failed – ${err.message}`,
        { type: 'asserter', source: this.name, cause: { apiError: err.message } }
      )
    }

    let judgment
    try {
      judgment = JSON.parse(raw)
    } catch (_) {
      throw new BotiumError(
        `${convoStep.stepTag}: ${this.name} could not parse AI response as JSON: ${raw}`,
        { type: 'asserter', source: this.name, cause: { rawResponse: raw } }
      )
    }

    ;(judgment.results || []).forEach(r => {
      const icon = r.verdict === 'PASS' ? '✔' : '✘'
      console.log(`[AI-judge] ${tag} ${icon} ${r.verdict}  "${r.criterion}"`)
      console.log(`           → ${r.reason}`)
    })

    if (judgment.overall === 'PASS') {
      return
    }

    const failures = (judgment.results || []).filter(r => r.verdict === 'FAIL')
    const summary = failures.map(r => `"${r.criterion}" – ${r.reason}`).join('; ')

    throw new BotiumError(
      `${tag}: ${this.name} FAILED – ${summary}`,
      {
        type: 'asserter',
        source: this.name,
        context: { params: { args } },
        cause: {
          expected: criteria,
          actual: botText,
          failures: judgment.results
        }
      }
    )
  }

  // Walk back through the convo steps to find the last #me message
  _resolveUserText (convo, convoStep) {
    if (!convo || !convo.conversation) return ''
    const steps = convo.conversation
    const idx = steps.indexOf(convoStep)
    for (let i = (idx >= 0 ? idx : steps.length) - 1; i >= 0; i--) {
      if (steps[i].sender === 'me' && steps[i].messageText) {
        return steps[i].messageText
      }
    }
    return ''
  }
}
