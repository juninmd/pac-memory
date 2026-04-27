import { cfg } from '../shared/config.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('llm-client')

interface CircuitState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

const circuitBreaker: CircuitState = {
  failures: 0,
  lastFailure: 0,
  state: 'closed',
}

const CIRCUIT_THRESHOLD = 5
const CIRCUIT_RESET_MS = 60_000
const RETRY_DELAYS = [500, 1500, 4000]

function isTransientError(message: string): boolean {
  return message.includes('timed out') || message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') || message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET') || message.includes('network') ||
    message.includes('503') || message.includes('502') || message.includes('429')
}

function updateCircuit(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  if (!isTransientError(msg)) {
    circuitBreaker.failures = 0
    return
  }
  circuitBreaker.failures++
  circuitBreaker.lastFailure = Date.now()
  if (circuitBreaker.failures >= CIRCUIT_THRESHOLD) {
    circuitBreaker.state = 'open'
    log.warn({ failures: circuitBreaker.failures, threshold: CIRCUIT_THRESHOLD }, 'Circuit breaker OPEN')
  }
}

function canAttempt(): boolean {
  if (circuitBreaker.state === 'closed') return true
  if (circuitBreaker.state === 'half-open') return true
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

export interface LlmTextResponse {
  content: string
  provider: 'ollama' | 'litellm'
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
  provider: 'ollama' | 'litellm'
  baseUrl: string
  model: string
  models?: OllamaModel[]
  error?: string
  latencyMs?: number
  circuitState?: string
}

export async function generateText(prompt: string): Promise<LlmTextResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.llmTimeoutMs)

  const displayModel = cfg.llmModel.startsWith('ollama/') ? cfg.llmModel.slice(7) : cfg.llmModel

  try {
    const response = await fetch(new URL('/v1/chat/completions', cfg.llmBaseUrl), {
      method: 'POST',
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        model: displayModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`LLM returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>
      error?: { message?: string } | string
    }
    if (data.error) {
      const message = typeof data.error === 'string' ? data.error : data.error.message
      throw new Error(message ?? 'LLM returned an unknown error')
    }

    return {
      content: (data.choices?.[0]?.message?.content ?? '').trim(),
      provider: cfg.llmProvider,
      model: displayModel,
      raw: JSON.stringify(data),
    }
  } catch (err) {
    log.warn({ err, model: displayModel, baseUrl: cfg.llmBaseUrl, provider: cfg.llmProvider }, 'LLM generation failed')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function checkLlmHealth(): Promise<LlmHealthStatus> {
  const start = Date.now()
  const base: Omit<LlmHealthStatus, 'ok'> = {
    provider: cfg.llmProvider,
    baseUrl: cfg.llmBaseUrl,
    model: cfg.llmModel.startsWith('ollama/') ? cfg.llmModel.slice(7) : cfg.llmModel,
  }

  try {
    if (cfg.llmProvider === 'ollama') {
      const resp = await fetch(new URL('/api/tags', cfg.llmBaseUrl), {
        signal: AbortSignal.timeout(8000),
        headers: buildHeaders(),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json() as { models?: OllamaModel[] }
      return { ...base, ok: true, models: data.models ?? [], latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
    }

    const resp = await fetch(new URL('/health', cfg.llmBaseUrl), {
      signal: AbortSignal.timeout(8000),
      headers: buildHeaders(),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return { ...base, ok: true, latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.warn({ err, provider: cfg.llmProvider, baseUrl: cfg.llmBaseUrl }, 'LLM health check failed')
    return { ...base, ok: false, error, latencyMs: Date.now() - start, circuitState: circuitBreaker.state }
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cfg.llmApiKey) headers.authorization = `Bearer ${cfg.llmApiKey}`
  return headers
}
