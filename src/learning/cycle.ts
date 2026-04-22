import { bulkUpsert, finishAgentRun, startAgentRun } from '../knowledge/repository.js'
import { categorize } from '../knowledge/categorizer.js'
import { summarize } from '../knowledge/summarizer.js'
import { childLogger } from '../shared/logger.js'
import { orchestratorEvents } from '../shared/events.js'
import { collectLearningFeeds } from './rss-learning.js'

const log = childLogger('learning-cycle')

export interface LearningCycleResult {
  collected: number
  stored: number
  blocked: number
  blockedSources: { source: string; url: string; reason: string }[]
}

export async function runLearningCycle(): Promise<LearningCycleResult> {
  const agentName = 'learning-rss'
  const runId = startAgentRun(agentName)
  orchestratorEvents.emit('agent', { name: agentName, status: 'running' })

  try {
    const { items, blocked } = await collectLearningFeeds()
    const processed = await Promise.all(items.map(async (item) => ({
      ...item,
      summary: item.summary ?? await summarize(item.title, item.content),
      category: item.category === 'uncategorized'
        ? await categorize(item.title, item.content)
        : item.category,
    })))

    const stored = bulkUpsert(processed)
    finishAgentRun(runId, stored)
    orchestratorEvents.emit('agent', { name: agentName, status: 'completed', count: stored, blocked: blocked.length })
    log.info({ collected: items.length, stored, blocked: blocked.length }, 'Learning cycle complete')

    return {
      collected: items.length,
      stored,
      blocked: blocked.length,
      blockedSources: blocked,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    finishAgentRun(runId, 0, message)
    orchestratorEvents.emit('agent', { name: agentName, status: 'failed', error: message })
    log.error({ err }, 'Learning cycle failed')
    throw err
  }
}
