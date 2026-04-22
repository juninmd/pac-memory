import { listKnowledge, countKnowledge, insertEvolutionLog, updateEvolutionStatus } from '../knowledge/repository.js'
import { childLogger } from '../shared/logger.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { cfg } from '../shared/config.js'
import { generateText } from '../llm/client.js'

const log = childLogger('gap-analyzer')

function loadGapPrompt(): string {
  const p = join(cfg.promptsDir, 'gap-analysis.prompt.json')
  if (existsSync(p)) {
    return (JSON.parse(readFileSync(p, 'utf-8')) as { template: string }).template
  }
  return `You are an AI system self-improvement analyst. Analyze the current knowledge base and identify gaps.

Current knowledge summary:
{summary}

Task: Identify 1-3 specific new data collectors or features that would expand this system's knowledge.
For each suggestion, provide:
1. Feature name (short, snake_case)
2. What data it would collect
3. Why it's valuable
4. Rough implementation approach (TypeScript, Node.js)

Format your response as JSON array: [{"name":"...","description":"...","value":"...","approach":"..."}]
Reply ONLY with the JSON array, no markdown.`
}

export interface GapSuggestion {
  name: string
  description: string
  value: string
  approach: string
}

export async function analyzeGaps(): Promise<GapSuggestion[]> {
  log.info('Running gap analysis')

  const totalCount = countKnowledge()
  const recent = listKnowledge(undefined, 30).map(k => `[${k.category}] ${k.title}`).join('\n')
  const summary = `Total knowledge entries: ${totalCount}\n\nRecent entries:\n${recent}`

  const prompt = loadGapPrompt().replace('{summary}', summary)

  const runId = insertEvolutionLog({
    trigger_reason: `gap-analysis: ${totalCount} knowledge items`,
    generated_file: '',
    status: 'pending',
    gemini_prompt: prompt.slice(0, 2000),
  })

  try {
    const raw = await generateText(prompt)
    // Extract JSON from response (may have surrounding text)
    const jsonMatch = raw.content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      log.warn('Gap analysis returned no JSON array')
      updateEvolutionStatus(runId, 'failed')
      return []
    }
    const suggestions = JSON.parse(jsonMatch[0]) as GapSuggestion[]
    log.info({ count: suggestions.length }, 'Gap suggestions found')
    updateEvolutionStatus(runId, 'compiled')
    return suggestions
  } catch (err) {
    log.error({ err }, 'Gap analysis failed')
    updateEvolutionStatus(runId, 'failed')
    return []
  }
}
