import { bulkUpsert, finishAgentRun, startAgentRun } from '../knowledge/repository.js'
import { categorize } from '../knowledge/categorizer.js'
import { summarize } from '../knowledge/summarizer.js'
import { childLogger } from '../shared/logger.js'
import { orchestratorEvents } from '../shared/events.js'
import { collectLearningFeeds } from './rss-learning.js'
import { collectFastNews } from './fast-news-reader.js'
import { collectAiPapers } from './arxiv-papers.js'
import { cfg } from '../shared/config.js'
import { publishIaKnowPapers } from '../publishers/ia-know.js'

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
    const [{ items: rssItems, blocked }, fastNewsItems, paperItems] = await Promise.all([
      collectLearningFeeds(),
      collectFastNews(24),
      collectAiPapers(),
    ])
    const items = [...rssItems, ...fastNewsItems, ...paperItems]
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

    if (cfg.iaKnowAutoPublish) {
      const publishResult = await publishIaKnowPapers()
      log.info(publishResult, 'IA Know paper dataset publish complete')
    }

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
