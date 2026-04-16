import Parser from 'rss-parser'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('agent:web-monitor')

// Whitelisted domains only (no SSRF)
const SOURCES = [
  { name: 'Anthropic Blog', url: 'https://www.anthropic.com/rss.xml', category: 'ai-ml' },
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', category: 'ai-ml' },
  { name: 'VSCode Updates', url: 'https://code.visualstudio.com/updates/rss', category: 'tools' },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', category: 'tools' },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', category: 'ai-ml' },
  { name: 'Google Developers', url: 'https://developers.googleblog.com/feeds/posts/default', category: 'programming' },
  { name: 'Google ADK Releases', url: 'https://github.com/google/adk-js/releases.atom', category: 'ai-ml' },
]

const ALLOWED_DOMAINS = new Set([
  'anthropic.com', 'openai.com', 'code.visualstudio.com',
  'github.blog', 'blog.google', 'developers.googleblog.com', 'github.com',
])

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^www\./, '')
    return ALLOWED_DOMAINS.has(hostname)
  } catch {
    return false
  }
}

export async function collectWebMonitor(): Promise<KnowledgeInput[]> {
  log.info('Collecting RSS/web monitor data')
  const parser = new Parser({ timeout: 15_000 })
  const items: KnowledgeInput[] = []

  for (const source of SOURCES) {
    if (!isAllowedUrl(source.url)) {
      log.warn({ url: source.url }, 'URL not in allowlist, skipping')
      continue
    }
    try {
      const feed = await parser.parseURL(source.url)
      const entries = (feed.items ?? []).slice(0, 20)

      for (const entry of entries) {
        const title = entry.title ?? 'Untitled'
        const content = entry.contentSnippet ?? entry.content ?? entry.summary ?? 'No content'
        const link = entry.link ?? ''
        const pubDate = entry.isoDate ?? entry.pubDate ?? ''

        items.push({
          title: `[${source.name}] ${title}`,
          content: `${content.slice(0, 1000)}\n\nSource: ${source.name}\nURL: ${link}\nPublished: ${pubDate}`,
          category: source.category,
          source: 'web-monitor-agent',
          metadata: { feed: source.name, url: link, pubDate },
          importance_score: 0.7,
        })
      }

      log.debug({ source: source.name, count: entries.length }, 'Feed parsed')
    } catch (err) {
      log.warn({ err, source: source.name }, 'Failed to parse feed')
    }
  }

  log.info({ count: items.length }, 'Web monitor collected')
  return items
}
