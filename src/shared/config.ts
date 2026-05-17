import { config } from 'dotenv'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'

if (existsSync('.env')) config()

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export type LlmProvider = 'ollama' | 'openai' | 'anthropic' | 'google' | 'litellm' | 'openrouter'

const llmProvider = optional('LLM_PROVIDER', 'ollama') as LlmProvider

// Individual provider settings kept for backward compat
const ollamaBaseUrl  = optional('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
const ollamaModel    = optional('OLLAMA_MODEL', 'llama3.2:3b')
const ollamaApiKey   = optional('OLLAMA_API_KEY', '')
const litellmBaseUrl    = optional('LITELLM_BASE_URL', 'http://127.0.0.1:4000')
const litellmModel      = optional('LITELLM_MODEL', `ollama/${ollamaModel}`)
const litellmApiKey     = optional('LITELLM_API_KEY', '')
const openrouterApiKey  = optional('OPENROUTER_API_KEY', '')
const openrouterModel   = optional('OPENROUTER_MODEL', 'google/gemini-2.0-flash-lite-001')

function resolveBaseUrl(): string {
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL
  if (llmProvider === 'ollama')      return ollamaBaseUrl
  if (llmProvider === 'litellm')     return litellmBaseUrl
  if (llmProvider === 'openrouter')  return 'https://openrouter.ai/api'
  return ''
}

function resolveModel(): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL
  switch (llmProvider) {
    case 'ollama':      return ollamaModel
    case 'litellm':     return litellmModel
    case 'openai':      return optional('OPENAI_MODEL', 'gpt-4o-mini')
    case 'anthropic':   return optional('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001')
    case 'google':      return optional('GOOGLE_MODEL', 'gemini-2.0-flash')
    case 'openrouter':  return openrouterModel
    default:            return ollamaModel
  }
}

function resolveApiKey(): string {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY
  switch (llmProvider) {
    case 'ollama':      return ollamaApiKey
    case 'litellm':     return litellmApiKey
    case 'openai':      return optional('OPENAI_API_KEY', '')
    case 'anthropic':   return optional('ANTHROPIC_API_KEY', '')
    case 'google':      return optional('GOOGLE_GENERATIVE_AI_API_KEY', '')
    case 'openrouter':  return openrouterApiKey
    default:            return ''
  }
}

const timeoutMs = Number(optional('LLM_TIMEOUT_MS', optional('LITELLM_TIMEOUT_MS', optional('OLLAMA_TIMEOUT_MS', '60000'))))

function resolveControlToken(): string {
  const fromEnv = optional('CONTROL_API_TOKEN', '')
  if (fromEnv) return fromEnv
  const ephemeral = randomBytes(16).toString('hex')
  console.warn(`[pac-memory] CONTROL_API_TOKEN not set — using ephemeral token: ${ephemeral}`)
  return ephemeral
}

export const cfg = {
  githubToken: optional('GITHUB_TOKEN', ''),
  githubUsername: optional('GITHUB_USERNAME', ''),
  controlApiToken: resolveControlToken(),

  llmProvider,
  llmBaseUrl:   resolveBaseUrl(),
  llmModel:     resolveModel(),
  llmApiKey:    resolveApiKey(),
  llmTimeoutMs: timeoutMs,

  // Backward compat aliases
  litellmBaseUrl,
  litellmApiKey,
  litellmModel,
  litellmTimeoutMs: timeoutMs,
  ollamaBaseUrl,
  ollamaModel,
  ollamaTimeoutMs: timeoutMs,

  port: Number(optional('PORT', '3000')),
  host: optional('HOST', '127.0.0.1'),
  logLevel: optional('LOG_LEVEL', 'info'),
  evolutionIntervalHours: Number(optional('EVOLUTION_INTERVAL_HOURS', '24')),
  learningIntervalHours: Number(optional('LEARNING_INTERVAL_HOURS', '6')),
  learningAllowedDomains: optional('LEARNING_ALLOWED_DOMAINS', ''),
  learningRssSources: optional('LEARNING_RSS_SOURCES', ''),
  learningAllowHttp: optional('LEARNING_ALLOW_HTTP', 'false') === 'true',
  learningFetchTimeoutMs: Number(optional('LEARNING_FETCH_TIMEOUT_MS', '15000')),
  learningMaxBytes: Number(optional('LEARNING_MAX_BYTES', '1048576')),
  learningMaxItemsPerSource: Number(optional('LEARNING_MAX_ITEMS_PER_SOURCE', '20')),
  dbPath: optional('DB_PATH', 'data/pac-memory.db'),
  generatedDir: optional('GENERATED_DIR', 'generated'),
  promptsDir: optional('PROMPTS_DIR', 'prompts'),
  fastNewsApiUrl: optional('FAST_NEWS_API_URL', ''),
  dailyDigestHour: Number(optional('DAILY_DIGEST_HOUR', '7')),

  llmFallbackChain: parseFallbackChain(),
}

export interface FallbackProvider {
  provider: LlmProvider
  model: string
  apiKey: string
}

function parseFallbackChain(): FallbackProvider[] {
  const raw = optional('LLM_FALLBACK_CHAIN', '')
  if (!raw.trim()) return []
  return raw.split(',').map((entry, idx) => {
    const [provider, ...modelParts] = entry.trim().split(':')
    const model = modelParts.join(':')
    const apiKey = optional(`FALLBACK_${idx}_API_KEY`, '')
    return { provider: provider as LlmProvider, model, apiKey }
  }).filter(e => e.provider && e.model)
}
