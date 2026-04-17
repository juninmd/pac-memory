import { config } from 'dotenv'
import { existsSync } from 'fs'

if (existsSync('.env')) config()

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export const cfg = {
  geminiApiKey: optional('GEMINI_API_KEY', ''),
  githubToken: optional('GITHUB_TOKEN', ''),
  githubUsername: optional('GITHUB_USERNAME', ''),
  port: Number(optional('PORT', '3000')),
  logLevel: optional('LOG_LEVEL', 'info'),
  evolutionIntervalHours: Number(optional('EVOLUTION_INTERVAL_HOURS', '24')),
  dbPath: optional('DB_PATH', 'data/pac-memory.db'),
  generatedDir: optional('GENERATED_DIR', 'generated'),
  promptsDir: optional('PROMPTS_DIR', 'prompts'),
  geminiModel: optional('GEMINI_MODEL', 'gemini-1.5-flash'),
}
