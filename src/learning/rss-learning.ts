import Parser from 'rss-parser'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { assertSafeFetchUrl } from '../security/url-policy.js'
import { getAllowedLearningDomains, getLearningSources } from './sources.js'

const log = childLogger('learning:rss')

export interface RssLearningResult {
  items: KnowledgeInput[]
  blocked: { source: string; url: string; reason: string }[]
}

export async function collectLearningFeeds(): Promise<RssLearningResult> {
  const parser = new Parser()
  const allowedDomains = getAllowedLearningDomains()
  const items: KnowledgeInput[] = []
  const blocked: RssLearningResult['blocked'] = []

  for (const source of getLearningSources()) {
    try {
      const safeUrl = await assertSafeFetchUrl(source.url, {
        allowedDomains,
        allowHttp: cfg.learningAllowHttp,
      })
      const xml = await fetchText(safeUrl)
      const feed = await parser.parseString(xml)

      for (const entry of (feed.items ?? []).slice(0, cfg.learningMaxItemsPerSource)) {
        const title = entry.title ?? 'Untitled'
        const link = entry.link ?? source.url
        const pubDate = entry.isoDate ?? entry.pubDate ?? ''
        const content = entry.contentSnippet ?? entry.content ?? entry.summary ?? ''

        if (!content.trim()) continue

        items.push({
          title: `[${source.name}] ${title}`,
          content: `${content.slice(0, 2000)}\n\nSource: ${source.name}\nURL: ${link}\nPublished: ${pubDate}`,
          category: source.category,
          source: 'learning-rss',
          summary: undefined,
          metadata: {
            feed: source.name,
            url: link,
            pubDate,
            sourceType: 'rss',
            learnedAt: new Date().toISOString(),
            freshness: pubDate ? 'dated' : 'unknown',
            confidence: 0.75,
          },
          importance_score: 0.7,
        })
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      blocked.push({ source: source.name, url: source.url, reason })
      log.warn({ err, source: source.name, url: source.url }, 'Learning source skipped')
    }
  }

  return { items, blocked }
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.learningFetchTimeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'pac-memory-learning-bot/1.0',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

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
