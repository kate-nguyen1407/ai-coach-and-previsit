const { fetch } = require('undici')
const debug = require('debug')('botium:core:ai:AIClient')

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_API_VERSION = '2023-06-01'
const DEFAULT_MODEL_ANTHROPIC = 'claude-haiku-4-5-20251001'
const DEFAULT_MODEL_OPENAI = 'llama-3.3-70b-versatile'
const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TIMEOUT_MS = 30000

/**
 * Thin HTTP wrapper for AI judge APIs.
 * Supports Anthropic Messages API and any OpenAI-compatible API
 * (OpenAI, Groq, Ollama, etc.).
 *
 * Capabilities:
 *   AI_JUDGE_API_KEY    – API key (required for Anthropic/Groq/OpenAI; use "ollama" for local Ollama)
 *   AI_JUDGE_MODEL      – model id
 *   AI_JUDGE_BASE_URL   – set to use OpenAI-compatible API
 *                         e.g. "https://api.groq.com/openai/v1"  (Groq)
 *                              "http://localhost:11434/v1"         (Ollama)
 *                              "https://api.openai.com/v1"        (OpenAI)
 *                         Omit to use Anthropic API (default).
 *   AI_JUDGE_MAX_TOKENS – max tokens in response (default: 1024)
 *   AI_JUDGE_TIMEOUT    – request timeout in ms (default: 30000)
 */
class AIClient {
  constructor (caps = {}) {
    this.baseUrl = caps.AI_JUDGE_BASE_URL || process.env.AI_JUDGE_BASE_URL || null
    this.isOpenAICompat = !!this.baseUrl

    this.apiKey = caps.AI_JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.AI_JUDGE_API_KEY
    this.model = caps.AI_JUDGE_MODEL || (this.isOpenAICompat ? DEFAULT_MODEL_OPENAI : DEFAULT_MODEL_ANTHROPIC)
    this.maxTokens = caps.AI_JUDGE_MAX_TOKENS || DEFAULT_MAX_TOKENS
    this.timeoutMs = caps.AI_JUDGE_TIMEOUT || DEFAULT_TIMEOUT_MS

    if (!this.apiKey && !this.isOpenAICompat) {
      throw new Error('AIClient: API key is required. Set capability AI_JUDGE_API_KEY or env var ANTHROPIC_API_KEY.')
    }
  }

  async chat (systemPrompt, userPrompt) {
    return this.isOpenAICompat
      ? this._chatOpenAI(systemPrompt, userPrompt)
      : this._chatAnthropic(systemPrompt, userPrompt)
  }

  async _chatAnthropic (systemPrompt, userPrompt) {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    }

    debug('POST %s model=%s (anthropic)', ANTHROPIC_API_URL, this.model)

    const response = await this._fetch(ANTHROPIC_API_URL, {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION
    }, body)

    const text = response?.content?.[0]?.text
    if (!text) throw new Error('AIClient: unexpected Anthropic response shape – no content[0].text')
    return text
  }

  async _chatOpenAI (systemPrompt, userPrompt) {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }

    const headers = { 'content-type': 'application/json' }
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`

    debug('POST %s model=%s (openai-compat)', url, this.model)

    const response = await this._fetch(url, headers, body)

    const text = response?.choices?.[0]?.message?.content
    if (!text) throw new Error('AIClient: unexpected OpenAI response shape – no choices[0].message.content')
    return text
  }

  async _fetch (url, headers, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`AIClient: request timed out after ${this.timeoutMs}ms`)
      throw new Error(`AIClient: network error – ${err.message}`)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AIClient: API responded ${response.status} – ${text}`)
    }

    return response.json()
  }
}

module.exports = AIClient
