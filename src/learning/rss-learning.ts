import Parser from 'rss-parser'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { assertSafeFetchUrl } from '../security/url-policy.js'
import { getAllowedLearningDomains, getLearningSources } from './sources.js'
import type { LearningSource } from './sources.js'

const log = childLogger('learning:rss')

export interface RssLearningResult {
  items:   KnowledgeInput[]
  blocked: { source: string; url: string; reason: string }[]
}

export async function collectLearningFeeds(): Promise<RssLearningResult> {
  const allowedDomains = getAllowedLearningDomains()
  const sources = getLearningSources()

  // Fetch all feeds concurrently
  const results = await Promise.allSettled(
    sources.map((source) => fetchOneFeed(source, allowedDomains))
  )

  const items:   KnowledgeInput[]                                  = []
  const blocked: RssLearningResult['blocked']                      = []
  const seenUrls = new Set<string>()

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const source = sources[i]

    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      blocked.push({ source: source.name, url: source.url, reason })
      log.warn({ source: source.name, url: source.url, reason }, 'Learning source skipped')
      continue
    }

    for (const item of result.value) {
      const itemUrl = (item.metadata as Record<string, unknown>)?.url as string | undefined
      if (itemUrl && seenUrls.has(itemUrl)) continue
      if (itemUrl) seenUrls.add(itemUrl)
      items.push(item)
    }
  }

  log.info({ total: items.length, blocked: blocked.length, sources: sources.length }, 'Feeds collected')
  return { items, blocked }
}

async function fetchOneFeed(source: LearningSource, allowedDomains: Set<string>): Promise<KnowledgeInput[]> {
  const safeUrl = await assertSafeFetchUrl(source.url, {
    allowedDomains,
    allowHttp: cfg.learningAllowHttp,
  })
  const xml  = await fetchText(safeUrl)
  const feed = await new Parser().parseString(xml)

  const now = new Date().toISOString()
  return (feed.items ?? [])
    .slice(0, cfg.learningMaxItemsPerSource)
    .filter((entry) => {
      const content = entry.contentSnippet ?? entry.content ?? entry.summary ?? ''
      return content.trim().length > 0
    })
    .map((entry) => {
      const title   = entry.title ?? 'Untitled'
      const link    = entry.link ?? source.url
      const pubDate = entry.isoDate ?? entry.pubDate ?? ''
      const content = (entry.contentSnippet ?? entry.content ?? entry.summary ?? '').slice(0, 2000)

      return {
        title:            `[${source.name}] ${title}`,
        content:          `${content}\n\nSource: ${source.name}\nURL: ${link}\nPublished: ${pubDate}`,
        category:         source.category,
        source:           'learning-rss',
        summary:          undefined,
        importance_score: source.weight ?? 0.7,
        metadata: {
          feed:       source.name,
          url:        link,
          pubDate,
          sourceType: 'rss',
          learnedAt:  now,
          freshness:  pubDate ? 'dated' : 'unknown',
          confidence: 0.75,
        },
      } satisfies KnowledgeInput
    })
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.learningFetchTimeoutMs)

  try {
    const response = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'user-agent': 'pac-memory-learning-bot/1.0',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      },
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (contentLength > cfg.learningMaxBytes) {
      throw new Error(`Response too large: ${contentLength} bytes`)
    }

    const text = await response.text()
    if (text.length > cfg.learningMaxBytes) {
      throw new Error(`Response too large: ${text.length} bytes`)
    }

    return text
  } finally {
    clearTimeout(timer)
  }
}
