import { writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'fs'
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
  const tmpPath  = `${filePath}.tmp`

  const logId = evolutionLogId ?? insertEvolutionLog({
    trigger_reason: `auto-generated: ${suggestion.name}`,
    generated_file: filePath,
    status: 'pending',
    gemini_prompt: suggestion.approach,
  })

  writeFileSync(tmpPath, code, 'utf-8')
  log.info({ tmpPath }, 'Generated file written to temp path')

  const validation = await validateTypeScript(tmpPath).catch(err => ({ valid: false, errors: String(err) }))

  if (!validation.valid) {
    if (existsSync(tmpPath)) unlinkSync(tmpPath)
    log.error({ filePath, errors: validation.errors }, 'Generated code failed TypeScript validation — NOT deployed, temp file removed')
    updateEvolutionStatus(logId, 'failed', filePath)
    return { success: false, filePath }
  }

  renameSync(tmpPath, filePath)
  updateEvolutionStatus(logId, 'deployed', filePath)
  log.info({ filePath }, 'Collector deployed successfully')
  return { success: true, filePath }
}
