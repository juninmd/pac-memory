import { config } from 'dotenv'
import { existsSync } from 'fs'

if (existsSync('.env')) config()

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export const cfg = {
  githubToken: optional('GITHUB_TOKEN', ''),
  githubUsername: optional('GITHUB_USERNAME', ''),
  controlApiToken: optional('CONTROL_API_TOKEN', ''),
  litellmBaseUrl: optional('LITELLM_BASE_URL', 'http://127.0.0.1:4000'),
  litellmApiKey: optional('LITELLM_API_KEY', ''),
  litellmModel: optional('LITELLM_MODEL', `ollama/${optional('OLLAMA_MODEL', 'llama3.1:8b')}`),
  litellmTimeoutMs: Number(optional('LITELLM_TIMEOUT_MS', optional('OLLAMA_TIMEOUT_MS', '60000'))),
  ollamaBaseUrl: optional('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
  ollamaModel: optional('OLLAMA_MODEL', 'llama3.1:8b'),
  ollamaTimeoutMs: Number(optional('OLLAMA_TIMEOUT_MS', '60000')),
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
