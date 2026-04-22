import { childLogger } from '../shared/logger.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { cfg } from '../shared/config.js'
import type { GapSuggestion } from './gap-analyzer.js'
import { generateText } from '../llm/client.js'

const log = childLogger('code-generator')

function loadCodeGenPrompt(): string {
  const p = join(cfg.promptsDir, 'code-gen.prompt.json')
  if (existsSync(p)) {
    return (JSON.parse(readFileSync(p, 'utf-8')) as { template: string }).template
  }
  return `You are a TypeScript expert. Generate a new data collector module for the pac-memory autonomous knowledge system.

Feature to implement:
Name: {name}
Description: {description}
Value: {value}
Approach: {approach}

Requirements:
- TypeScript with strict mode
- Export a main async function: collect{PascalName}(): Promise<KnowledgeInput[]>
- Import KnowledgeInput from '../shared/types.js'
- Import childLogger from '../shared/logger.js'
- Handle all errors gracefully (never throw, always return partial results)
- Do NOT use eval(), Function(), or dynamic code execution
- Do NOT make network requests to unapproved domains
- Use only built-in Node.js modules or these packages: systeminformation, @octokit/rest, rss-parser, dotenv
- Include a JSDoc comment explaining what this collector does

Return ONLY the TypeScript code, no markdown code fences, no explanation.`
}

function toPascalCase(name: string): string {
  return name.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

export async function generateCollector(suggestion: GapSuggestion): Promise<string> {
  log.info({ name: suggestion.name }, 'Generating collector code')

  const pascalName = toPascalCase(suggestion.name)
  const prompt = loadCodeGenPrompt()
    .replace('{name}', suggestion.name)
    .replace('{description}', suggestion.description)
    .replace('{value}', suggestion.value)
    .replace('{approach}', suggestion.approach)
    .replace('{PascalName}', pascalName)

  const result = await generateText(prompt)
  return result.content
}
