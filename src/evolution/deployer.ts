import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { validateTypeScript } from './validator.js'
import { updateEvolutionStatus, insertEvolutionLog } from '../knowledge/repository.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import type { GapSuggestion } from './gap-analyzer.js'

const log = childLogger('deployer')

export async function deployCollector(
  suggestion: GapSuggestion,
  code: string,
  evolutionLogId?: number
): Promise<{ success: boolean; filePath: string }> {
  mkdirSync(cfg.generatedDir, { recursive: true })

  const fileName = `${suggestion.name}.agent.ts`
  const filePath = join(cfg.generatedDir, fileName)

  // Write the generated file
  writeFileSync(filePath, code, 'utf-8')
  log.info({ filePath }, 'Generated file written')

  // Validate before deploying
  const { valid, errors } = await validateTypeScript(filePath)

  const logId = evolutionLogId ?? insertEvolutionLog({
    trigger_reason: `auto-generated: ${suggestion.name}`,
    generated_file: filePath,
    status: 'pending',
    gemini_prompt: suggestion.approach,
  })

  if (!valid) {
    log.error({ filePath, errors }, 'Generated code failed TypeScript validation — NOT deployed')
    updateEvolutionStatus(logId, 'failed', filePath)
    return { success: false, filePath }
  }

  updateEvolutionStatus(logId, 'deployed', filePath)
  log.info({ filePath }, 'Collector deployed successfully')
  return { success: true, filePath }
}
