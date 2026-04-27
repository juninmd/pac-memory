import { config } from 'dotenv'
import { existsSync } from 'fs'

if (existsSync('.env')) config()

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

// LLM_PROVIDER=ollama → direct Ollama API (OLLAMA_BASE_URL + OLLAMA_MODEL)
// LLM_PROVIDER=litellm (default) → LiteLLM proxy (LITELLM_BASE_URL + LITELLM_MODEL)
const llmProvider = optional('LLM_PROVIDER', 'litellm') as 'ollama' | 'litellm'
const ollamaBaseUrl = optional('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
const ollamaModel   = optional('OLLAMA_MODEL', 'llama3.2:3b')
const litellmBaseUrl = optional('LITELLM_BASE_URL', 'http://127.0.0.1:4000')
const litellmModel   = optional('LITELLM_MODEL', `ollama/${ollamaModel}`)
const litellmApiKey  = optional('LITELLM_API_KEY', '')
const ollamaApiKey   = optional('OLLAMA_API_KEY', '')
const timeoutMs      = Number(optional('LLM_TIMEOUT_MS', optional('LITELLM_TIMEOUT_MS', optional('OLLAMA_TIMEOUT_MS', '60000'))))

export const cfg = {
  githubToken: optional('GITHUB_TOKEN', ''),
  githubUsername: optional('GITHUB_USERNAME', ''),
  controlApiToken: optional('CONTROL_API_TOKEN', ''),

  // Unified LLM settings — use these in all LLM code
  llmProvider,
  llmBaseUrl:  llmProvider === 'ollama' ? ollamaBaseUrl : litellmBaseUrl,
  llmModel:    llmProvider === 'ollama' ? ollamaModel   : litellmModel,
  llmApiKey:   llmProvider === 'ollama' ? ollamaApiKey  : litellmApiKey,
  llmTimeoutMs: timeoutMs,

  // Legacy aliases kept for backward compat
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
}
