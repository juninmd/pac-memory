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
import EventEmitter from 'events'
import type { KnowledgeInput } from '../shared/types.js'

const log = childLogger('orchestrator')
export const orchestratorEvents = new EventEmitter()

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
  execute: async () => {
    log.info('Running evolution cycle')
    orchestratorEvents.emit('evolution', { phase: 'gap-analysis', status: 'started' })

    const suggestions = await analyzeGaps()
    if (suggestions.length === 0) {
      return { result: 'No gaps found in this cycle' }
    }

    const results: string[] = []
    for (const s of suggestions.slice(0, 2)) { // max 2 per cycle
      try {
        orchestratorEvents.emit('evolution', { phase: 'code-gen', feature: s.name, status: 'started' })
        const code = await generateCollector(s)
        const { success, filePath } = await deployCollector(s, code)
        const status = success ? 'deployed' : 'failed'
        orchestratorEvents.emit('evolution', { phase: 'deploy', feature: s.name, status, filePath })
        results.push(`${s.name}: ${status}`)
      } catch (err) {
        log.error({ err, name: s.name }, 'Evolution step failed')
        results.push(`${s.name}: error`)
      }
    }
    return { result: results.join(', ') }
  },
})

// ── Coordinator Agent ─────────────────────────────────────────────────────

export const coordinator = new LlmAgent({
  name: 'pac_memory_coordinator',
  model: 'gemini-2.5-flash',
  description: 'Orchestrates all knowledge collection agents and self-evolution',
  instruction: `You are the coordinator of pac-memory, an autonomous knowledge system.
You have access to tools that collect information about the local machine, GitHub repos, environment, and AI news.
When asked to collect all information, use all collection tools.
When asked to evolve, use the run_evolution tool.
Always report how many items were collected from each source.`,
  tools: [collectSystemTool, collectNetworkTool, collectGithubTool, collectEnvTool, collectWebTool, runEvolutionTool],
})

// ── Helpers ───────────────────────────────────────────────────────────────

async function runCollector(
  name: string,
  fn: () => Promise<KnowledgeInput[]>
): Promise<KnowledgeInput[]> {
  const runId = startAgentRun(name)
  orchestratorEvents.emit('agent', { name, status: 'running' })
  try {
    const items = await fn()

    // Process items: summarize and categorize via Gemini if available
    const processed = await Promise.all(
      items.map(async (item) => {
        if (cfg.geminiApiKey) {
          // Generate summary if missing
          if (!item.summary) {
            item.summary = await summarize(item.title, item.content)
          }
          // Categorize if uncategorized
          if (item.category === 'uncategorized') {
            item.category = await categorize(item.title, item.content)
          }
        }
        return item
      })
    )

    bulkUpsert(processed)
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

  log.info('Scheduler started: system/net=5min, env/github=30min, web=1h, evolution=${evolutionHours}h')
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
