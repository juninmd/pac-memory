import { LlmAgent, FunctionTool } from '@google/adk'
import { z } from 'zod'
import cron from 'node-cron'
import { collectSystemInfo } from './system.agent.js'
import { collectNetworkInfo } from './network.agent.js'
import { collectGithubInfo } from './github.agent.js'
import { collectEnvVars } from './env.agent.js'
import { collectWebMonitor } from './web-monitor.agent.js'
import { bulkUpsert, startAgentRun, finishAgentRun } from '../knowledge/repository.js'
import { categorize } from '../knowledge/categorizer.js'
import { summarize } from '../knowledge/summarizer.js'
import { analyzeGaps } from '../evolution/gap-analyzer.js'
import { generateCollector } from '../evolution/code-generator.js'
import { deployCollector } from '../evolution/deployer.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { orchestratorEvents } from '../shared/events.js'
import { runLearningCycle } from '../learning/cycle.js'
import type { KnowledgeInput } from '../shared/types.js'
import { scheduleBackfillEmbeddings } from '../knowledge/embedder.js'
import { LiteLlmAdk } from '../llm/litellm-adk.js'

const log = childLogger('orchestrator')

// ── Tools ─────────────────────────────────────────────────────────────────

const collectSystemTool = new FunctionTool({
  name: 'collect_system_info',
  description: 'Collects hardware and OS information from the local machine',
  parameters: z.object({}),
  execute: async () => {
    const items = await runCollector('system', collectSystemInfo)
    return { collected: items.length }
  },
})

const collectNetworkTool = new FunctionTool({
  name: 'collect_network_info',
  description: 'Collects network interfaces, public IP and geo data',
  parameters: z.object({}),
  execute: async () => {
    const items = await runCollector('network', collectNetworkInfo)
    return { collected: items.length }
  },
})

const collectGithubTool = new FunctionTool({
  name: 'collect_github_info',
  description: 'Collects GitHub repos, stars, languages and activity',
  parameters: z.object({}),
  execute: async () => {
    const items = await runCollector('github', collectGithubInfo)
    return { collected: items.length }
  },
})

const collectEnvTool = new FunctionTool({
  name: 'collect_env_vars',
  description: 'Collects safe (non-sensitive) environment variables',
  parameters: z.object({}),
  execute: async () => {
    const items = await runCollector('env', () => Promise.resolve(collectEnvVars()))
    return { collected: items.length }
  },
})

const collectWebTool = new FunctionTool({
  name: 'collect_web_monitor',
  description: 'Collects latest articles from Claude, OpenAI, VSCode, GitHub and Google AI blogs',
  parameters: z.object({}),
  execute: async () => {
    const items = await runCollector('web-monitor', collectWebMonitor)
    return { collected: items.length }
  },
})

const runEvolutionTool = new FunctionTool({
  name: 'run_evolution',
  description: 'Analyzes knowledge gaps and generates new collector code to expand capabilities',
  parameters: z.object({}),
  execute: () => runEvolutionCycle(),
})

// ── Coordinator Agent ─────────────────────────────────────────────────────
// LiteLlmAdk (Google ADK adapter) works with any OpenAI-compatible endpoint.
// For cloud-only providers (anthropic/google/openai without a local proxy),
// the coordinator is created without an ADK model and falls back to direct tool execution.

// LiteLlmAdk works with any OpenAI-compatible endpoint (ollama/litellm).
// For cloud-only providers (anthropic/google/openai without a local proxy) the
// coordinator is null and collections run via direct tool execution instead.
const supportsAdkCoordinator = cfg.llmProvider === 'ollama' || cfg.llmProvider === 'litellm'

export const coordinator: LlmAgent | null = supportsAdkCoordinator
  ? new LlmAgent({
    name: 'pac_memory_coordinator',
    model: new LiteLlmAdk(),
    description: 'Orchestrates all knowledge collection agents and self-evolution',
    instruction: `You are the coordinator of pac-memory, an autonomous knowledge system.
You have access to tools that collect information about the local machine, GitHub repos, environment, and AI news.
When asked to collect all information, use all collection tools.
When asked to evolve, use the run_evolution tool.
Always report how many items were collected from each source.`,
    tools: [collectSystemTool, collectNetworkTool, collectGithubTool, collectEnvTool, collectWebTool, runEvolutionTool],
  })
  : null

// ── Helpers ───────────────────────────────────────────────────────────────

async function runCollector(
  name: string,
  fn: () => Promise<KnowledgeInput[]>
): Promise<KnowledgeInput[]> {
  const runId = startAgentRun(name)
  orchestratorEvents.emit('agent', { name, status: 'running' })
  try {
    const items = await fn()

    // Process items: summarize and categorize via configured LLM when available.
    const processed = await Promise.all(
      items.map(async (item) => {
        if (!item.summary) {
          item.summary = await summarize(item.title, item.content)
        }
        if (item.category === 'uncategorized') {
          item.category = await categorize(item.title, item.content)
        }
        return item
      })
    )

    bulkUpsert(processed)
    scheduleBackfillEmbeddings()
    finishAgentRun(runId, processed.length)
    orchestratorEvents.emit('agent', { name, status: 'completed', count: processed.length })
    log.info({ agent: name, count: processed.length }, 'Collection complete')
    return processed
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishAgentRun(runId, 0, msg)
    orchestratorEvents.emit('agent', { name, status: 'failed', error: msg })
    log.error({ agent: name, err }, 'Collection failed')
    return []
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────

export function startScheduler() {
  log.info('Starting cron scheduler')

  // System + network: every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await runCollector('system', collectSystemInfo)
    await runCollector('network', collectNetworkInfo)
  })

  // Env vars: every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    runCollector('env', () => Promise.resolve(collectEnvVars()))
  })

  // GitHub: every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    await runCollector('github', collectGithubInfo)
  })

  // Web monitor: every hour
  cron.schedule('0 * * * *', async () => {
    await runCollector('web-monitor', collectWebMonitor)
  })

  // Autonomous learning: configurable (default 6h)
  const learningHours = cfg.learningIntervalHours
  cron.schedule(`0 */${learningHours} * * *`, async () => {
    log.info('Starting scheduled learning cycle')
    await runLearningCycle()
  })

  // Evolution: configurable (default 24h)
  const evolutionHours = cfg.evolutionIntervalHours
  cron.schedule(`0 */${evolutionHours} * * *`, async () => {
    log.info('Starting scheduled evolution cycle')
    orchestratorEvents.emit('evolution', { phase: 'start', status: 'scheduled' })
    const suggestions = await analyzeGaps()
    for (const s of suggestions.slice(0, 2)) {
      try {
        const code = await generateCollector(s)
        await deployCollector(s, code)
      } catch (err) {
        log.error({ err, name: s.name }, 'Scheduled evolution failed')
      }
    }
  })

  log.info({ learningHours, evolutionHours }, 'Scheduler started')
}

export async function runEvolutionCycle(): Promise<{ result: string; suggestions: number }> {
  log.info('Running evolution cycle')
  orchestratorEvents.emit('evolution', { phase: 'gap-analysis', status: 'started' })

  const suggestions = await analyzeGaps()
  if (suggestions.length === 0) {
    orchestratorEvents.emit('evolution', { phase: 'gap-analysis', status: 'no-gaps' })
    return { result: 'No gaps found in this cycle', suggestions: 0 }
  }

  const results: string[] = []
  for (const s of suggestions.slice(0, 2)) {
    try {
      orchestratorEvents.emit('evolution', { phase: 'code-gen', feature: s.name, status: 'started' })
      const code = await generateCollector(s)
      const { success, filePath } = await deployCollector(s, code)
      const status = success ? 'deployed' : 'failed'
      orchestratorEvents.emit('evolution', { phase: 'deploy', feature: s.name, status, filePath })
      results.push(`${s.name}: ${status}`)
    } catch (err) {
      log.error({ err, name: s.name }, 'Evolution step failed')
      orchestratorEvents.emit('evolution', { phase: 'deploy', feature: s.name, status: 'failed' })
      results.push(`${s.name}: error`)
    }
  }

  return { result: results.join(', '), suggestions: suggestions.length }
}

// ── One-shot full collection ───────────────────────────────────────────────

export async function runFullCollection() {
  log.info('Running full collection cycle')
  await Promise.allSettled([
    runCollector('system', collectSystemInfo),
    runCollector('network', collectNetworkInfo),
    runCollector('env', () => Promise.resolve(collectEnvVars())),
  ])
  await runCollector('github', collectGithubInfo)
  await runCollector('web-monitor', collectWebMonitor)
  log.info('Full collection cycle complete')
}
