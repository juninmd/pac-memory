import { childLogger } from '../shared/logger.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { cfg } from '../shared/config.js'
import { generateText } from '../llm/client.js'

const log = childLogger('categorizer')

const KNOWN_CATEGORIES = [
  'hardware', 'software', 'network', 'security',
  'ai-ml', 'devops', 'programming', 'github',
  'environment', 'system-info', 'news', 'updates',
  'tools', 'performance', 'configuration'
]

function loadPrompt(): string {
  const promptPath = join(cfg.promptsDir, 'categorize.prompt.json')
  if (existsSync(promptPath)) {
    const data = JSON.parse(readFileSync(promptPath, 'utf-8')) as { template: string }
    return data.template
  }
  return `Classify the following knowledge entry into exactly ONE of these categories: ${KNOWN_CATEGORIES.join(', ')}.
Reply with ONLY the category name, nothing else.
Title: {title}
Content: {content}`
}

export async function categorize(title: string, content: string): Promise<string> {
  try {
    const template = loadPrompt()
    const prompt = template.replace('{title}', title).replace('{content}', content.slice(0, 500))
    const result = await generateText(prompt)
    const cat = result.content.trim().toLowerCase().replace(/[^a-z-]/g, '')
    return KNOWN_CATEGORIES.includes(cat) ? cat : 'uncategorized'
  } catch (err) {
    log.warn({ err, title }, 'Categorization failed, using uncategorized')
    return 'uncategorized'
  }
}
