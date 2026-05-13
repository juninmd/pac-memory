import { generateText as aiGenerateText, embed as aiEmbed } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel, EmbeddingModel } from 'ai'
import { cfg, type LlmProvider } from '../shared/config.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('llm-client')

// ── Circuit Breaker ───────────────────────────────────────────────────────────

interface CircuitState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

const circuitBreaker: CircuitState = { failures: 0, lastFailure: 0, state: 'closed' }

const CIRCUIT_THRESHOLD = 5
const CIRCUIT_RESET_MS  = 60_000
const RETRY_DELAYS      = [500, 1500, 4000]

function isTransientError(message: string): boolean {
  return ['timed out', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
    'network', '503', '502', '429'].some(s => message.includes(s))
}

function updateCircuit(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  if (!isTransientError(msg)) { circuitBreaker.failures = 0; return }
  circuitBreaker.failures++
  circuitBreaker.lastFailure = Date.now()
  if (circuitBreaker.failures >= CIRCUIT_THRESHOLD) {
    circuitBreaker.state = 'open'
    log.warn({ failures: circuitBreaker.failures }, 'Circuit breaker OPEN')
  }
}

function canAttempt(): boolean {
  if (circuitBreaker.state !== 'open') return true
  if (Date.now() - circuitBreaker.lastFailure > CIRCUIT_RESET_MS) {
    circuitBreaker.state = 'half-open'
    log.info('Circuit breaker half-open, allowing test request')
    return true
  }
  return false
}

function recordSuccess(): void {
  circuitBreaker.failures = 0
  circuitBreaker.state = 'closed'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Model Factory ─────────────────────────────────────────────────────────────

/**
 * Builds a LanguageModel from the configured provider.
 * Ollama uses its OpenAI-compatible endpoint (/v1) via @ai-sdk/openai.
 * LiteLLM also exposes OpenAI-compatible endpoints.
 */
export function buildLanguageModel(
  provider: LlmProvider = cfg.llmProvider,
  model: string        = cfg.llmModel,
  baseUrl: string      = cfg.llmBaseUrl,
  apiKey: string       = cfg.llmApiKey,
): LanguageModel {
  switch (provider) {
    case 'ollama': {
      // Ollama exposes an OpenAI-compatible API at /v1
      const client = createOpenAI({ baseURL: `${baseUrl}/v1`, apiKey: apiKey || 'ollama' })
      return client(model)
    }
    case 'openai': {
      const client = createOpenAI({ apiKey })
      return client(model)
    }
    case 'anthropic': {
      const client = createAnthropic({ apiKey })
      return client(model)
    }
    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey })
      return client(model)
    }
    case 'openrouter': {
      const client = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        headers: { 'HTTP-Referer': 'https://github.com/pac-memory', 'X-Title': 'pac-memory' },
      })
      return client(model)
    }
    case 'litellm':
    default: {
      const client = createOpenAI({ baseURL: `${baseUrl}/v1`, apiKey: apiKey || 'placeholder' })
      return client(model)
    }
  }
}

/**
 * Builds an embedding model from the configured provider.
 * Falls back to the openai-compatible embedding endpoint for ollama/litellm.
 */
export function buildEmbeddingModel(): EmbeddingModel {
  const embedModel = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'

  switch (cfg.llmProvider) {
    case 'ollama': {
      const client = createOpenAI({ baseURL: `${cfg.llmBaseUrl}/v1`, apiKey: cfg.llmApiKey || 'ollama' })
      return client.embedding(embedModel)
    }
    case 'openai': {
      const client = createOpenAI({ apiKey: cfg.llmApiKey })
      return client.embedding('text-embedding-3-small')
    }
    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey: cfg.llmApiKey })
      return client.textEmbeddingModel('text-embedding-004')
    }
    case 'openrouter':
      // OpenRouter has no embedding API; fall back to local ollama
    case 'anthropic':
      log.warn(`${cfg.llmProvider} has no embedding API; falling back to ollama nomic-embed-text`)
      // falls through to litellm
    case 'litellm':
    default: {
      const client = createOpenAI({
        baseURL: `${cfg.llmBaseUrl}/v1`,
        apiKey: cfg.llmApiKey || 'placeholder',
      })
      return client.embedding(process.env.LITELLM_EMBED_MODEL ?? 'nomic-embed-text')
    }
  }
}

// ── Public Interfaces ─────────────────────────────────────────────────────────

export interface LlmTextResponse {
  content: string
  provider: LlmProvider
  model: string
  raw: string
}

export interface OllamaModel {
  name: string
  modified_at: string
  size: number
  details?: { family?: string; parameter_size?: string; quantization_level?: string }
}

export interface LlmHealthStatus {
  ok: boolean
  provider: LlmProvider
  baseUrl: string
  model: string
  models?: OllamaModel[]
  error?: string
  latencyMs?: number
  circuitState?: string
}

// ── Core calls ────────────────────────────────────────────────────────────────

export async function generateText(prompt: string): Promise<LlmTextResponse> {
  const model = buildLanguageModel()
  const displayModel = cfg.llmModel.startsWith('ollama/') ? cfg.llmModel.slice(7) : cfg.llmModel
  try {
    const { text, response } = await aiGenerateText({
      model,
      prompt,
      abortSignal: AbortSignal.timeout(cfg.llmTimeoutMs),
    })
    return { content: text, provider: cfg.llmProvider, model: displayModel, raw: JSON.stringify(response) }
  } catch (err) {
    log.warn({ err, model: displayModel, provider: cfg.llmProvider }, 'LLM generation failed')
    throw err
  }
}

export async function generateTextWithRetry(prompt: string, maxRetries = 3): Promise<LlmTextResponse> {
  if (!canAttempt()) {
    const wait = CIRCUIT_RESET_MS - (Date.now() - circuitBreaker.lastFailure)
    throw new Error(`Circuit breaker is open. Retry in ${Math.ceil(wait / 1000)}s`)
  }

  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await generateText(prompt)
      recordSuccess()
      return result
    } catch (err) {
      lastErr = err
      updateCircuit(err)
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < maxRetries && isTransientError(msg)) {
        const delay = RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]
        log.info({ attempt: attempt + 1, delay, msg }, 'Retrying LLM call')
        await sleep(delay)
        continue
      }
      break
    }
  }
  throw lastErr
}

export async function embedText(text: string): Promise<number[]> {
  const model = buildEmbeddingModel()
  const result = await aiEmbed({ model, value: text })
  return result.embedding
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function checkLlmHealth(): Promise<LlmHealthStatus> {
  const start = Date.now()
  const displayModel = cfg.llmModel.startsWith('ollama/') ? cfg.llmModel.slice(7) : cfg.llmModel
  const base: Omit<LlmHealthStatus, 'ok'> = {
    provider:  cfg.llmProvider,
    baseUrl:   cfg.llmBaseUrl || '(cloud)',
    model:     displayModel,
  }

  try {
    if (cfg.llmProvider === 'ollama') {
      const resp = await fetch(new URL('/api/tags', cfg.llmBaseUrl), {
        signal:  AbortSignal.timeout(8000),
        headers: cfg.llmApiKey ? { authorization: `Bearer ${cfg.llmApiKey}` } : {},
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json() as { models?: OllamaModel[] }
      return { ...base, ok: true, models: data.models ?? [], latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
    }

    if (cfg.llmProvider === 'openrouter') {
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${cfg.llmApiKey}` },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return { ...base, ok: true, latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
    }

    if (cfg.llmProvider === 'litellm') {
      const resp = await fetch(new URL('/health', cfg.llmBaseUrl), {
        signal:  AbortSignal.timeout(8000),
        headers: cfg.llmApiKey ? { authorization: `Bearer ${cfg.llmApiKey}` } : {},
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return { ...base, ok: true, latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
    }

    // Cloud providers: minimal test generation
    const { text } = await aiGenerateText({
      model:       buildLanguageModel(),
      prompt:      'Reply with "ok".',
      maxOutputTokens: 5,
      abortSignal: AbortSignal.timeout(8000),
    })
    return { ...base, ok: !!text, latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.warn({ err, provider: cfg.llmProvider }, 'LLM health check failed')
    return { ...base, ok: false, error, latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
  }
}
