import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'

const log = childLogger('learning:fast-news')

interface FastNewsArticle {
  id: string
  title: string
  summary?: string
  url: string
  source?: string
  category?: string
  published_at?: string
  importance_score?: number
}

interface FastNewsResponse {
  articles?: FastNewsArticle[]
  data?: FastNewsArticle[]
}

export async function collectFastNews(sinceHours = 24): Promise<KnowledgeInput[]> {
  if (!cfg.fastNewsApiUrl) {
    log.debug('FAST_NEWS_API_URL not set — skipping')
    return []
  }

  const url = new URL('/api/news', cfg.fastNewsApiUrl)
  url.searchParams.set('limit', '50')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.learningFetchTimeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'pac-memory/1.0', accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const body = await res.json() as FastNewsResponse
    const articles: FastNewsArticle[] = body.articles ?? body.data ?? []

    const cutoff = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString()
    const fresh = articles.filter(a => !a.published_at || a.published_at >= cutoff)

    log.info({ total: articles.length, fresh: fresh.length }, 'fast-news articles fetched')

    return fresh.map((a): KnowledgeInput => ({
      title: `[fast-news] ${a.title}`,
      content: `${a.summary ?? a.title}\n\nSource: ${a.source ?? 'fast-news'}\nURL: ${a.url}\nPublished: ${a.published_at ?? ''}`,
      category: a.category ?? 'tech',
      source: 'fast-news',
      summary: a.summary,
      importance_score: a.importance_score ?? 0.75,
      metadata: {
        feed: a.source ?? 'fast-news',
        url: a.url,
        pubDate: a.published_at ?? '',
        sourceType: 'fast-news-api',
        learnedAt: new Date().toISOString(),
        freshness: a.published_at ? 'dated' : 'unknown',
        confidence: 0.8,
      },
    }))
  } catch (err) {
    log.warn({ err, url: url.toString() }, 'fast-news fetch failed — skipping')
    return []
  } finally {
    clearTimeout(timer)
  }
}
