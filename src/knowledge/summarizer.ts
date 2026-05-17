import { childLogger } from '../shared/logger.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { cfg } from '../shared/config.js'
import { generateTextWithFallback } from '../llm/client.js'

const log = childLogger('summarizer')

function loadPrompt(): string {
  const promptPath = join(cfg.promptsDir, 'summarize.prompt.json')
  if (existsSync(promptPath)) {
    const data = JSON.parse(readFileSync(promptPath, 'utf-8')) as { template: string }
    return data.template
  }
  return 'Resuma a seguinte informação técnica de forma concisa.\n\nTítulo: {title}\nConteúdo: {content}'
}

export async function summarize(title: string, content: string): Promise<string> {
  try {
    const template = loadPrompt()
    const prompt = template.replace('{title}', title).replace('{content}', content.slice(0, 1000))
    const result = await generateTextWithFallback(prompt)
    return result.content.trim()
  } catch (err) {
    log.warn({ err, title }, 'Summarization failed, returning empty summary')
    return ''
  }
}
