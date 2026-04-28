import { cfg } from '../shared/config.js'
import { listActiveRssSources } from '../knowledge/repository.js'

export interface LearningSource {
  name: string
  url: string
  category: string
  /** Expected importance weight (0-1). High-signal sources score higher. */
  weight?: number
}

const DEFAULT_SOURCES: LearningSource[] = [
  // ── AI / ML ─────────────────────────────────────────────────────────────────
  { name: 'Anthropic Blog',        url: 'https://www.anthropic.com/rss.xml',                    category: 'ai-ml',       weight: 0.9 },
  { name: 'OpenAI Blog',           url: 'https://openai.com/blog/rss.xml',                      category: 'ai-ml',       weight: 0.9 },
  { name: 'Google AI Blog',        url: 'https://blog.google/technology/ai/rss/',               category: 'ai-ml',       weight: 0.85 },
  { name: 'Google ADK Releases',   url: 'https://github.com/google/adk-js/releases.atom',      category: 'ai-ml',       weight: 0.8 },
  { name: 'HuggingFace Blog',      url: 'https://huggingface.co/blog/feed.xml',                 category: 'ai-ml',       weight: 0.85 },
  { name: 'LangChain Blog',        url: 'https://blog.langchain.dev/rss/',                      category: 'ai-ml',       weight: 0.8 },
  { name: 'DeepMind Research',     url: 'https://deepmind.google/discover/blog/rss.xml',        category: 'ai-ml',       weight: 0.85 },
  { name: 'Meta AI Research',      url: 'https://ai.meta.com/blog/rss/',                        category: 'ai-ml',       weight: 0.8 },
  { name: 'Mistral AI Blog',       url: 'https://mistral.ai/rss/news.xml',                      category: 'ai-ml',       weight: 0.8 },
  { name: 'Together AI Blog',      url: 'https://www.together.ai/blog/rss.xml',                 category: 'ai-ml',       weight: 0.75 },
  { name: 'Cohere Blog',           url: 'https://cohere.com/blog/rss',                          category: 'ai-ml',       weight: 0.75 },

  // ── Programming & Language ─────────────────────────────────────────────────
  { name: 'Google Developers',     url: 'https://developers.googleblog.com/feeds/posts/default', category: 'programming', weight: 0.75 },
  { name: 'Stack Overflow Blog',   url: 'https://stackoverflow.blog/feed/',                     category: 'programming', weight: 0.8 },
  { name: 'InfoQ',                 url: 'https://www.infoq.com/feed/',                          category: 'programming', weight: 0.75 },
  { name: 'Lobsters',              url: 'https://lobste.rs/rss',                                category: 'programming', weight: 0.7 },
  { name: 'Hacker News Best',      url: 'https://hnrss.org/best',                               category: 'programming', weight: 0.75 },
  { name: 'DEV.to',                url: 'https://dev.to/feed',                                  category: 'programming', weight: 0.65 },
  { name: 'Rust Blog',             url: 'https://blog.rust-lang.org/feed.xml',                  category: 'programming', weight: 0.85 },
  { name: 'This Week in Rust',     url: 'https://this-week-in-rust.org/rss.xml',                category: 'programming', weight: 0.8 },
  { name: 'The Changelog',         url: 'https://changelog.com/news/feed',                      category: 'programming', weight: 0.7 },

  // ── JavaScript / TypeScript ────────────────────────────────────────────────
  { name: 'Node.js Blog',          url: 'https://nodejs.org/en/feed/blog.xml',                  category: 'programming', weight: 0.8 },
  { name: 'Deno Blog',             url: 'https://deno.com/blog/feed.xml',                       category: 'programming', weight: 0.8 },
  { name: 'Bun Blog',              url: 'https://bun.sh/blog/rss.xml',                          category: 'programming', weight: 0.8 },

  // ── Tools & IDEs ──────────────────────────────────────────────────────────
  { name: 'VSCode Updates',        url: 'https://code.visualstudio.com/updates/rss',            category: 'tools',       weight: 0.8 },
  { name: 'GitHub Blog',           url: 'https://github.blog/feed/',                            category: 'tools',       weight: 0.85 },
  { name: 'JetBrains Blog',        url: 'https://blog.jetbrains.com/feed/',                     category: 'tools',       weight: 0.75 },

  // ── DevOps / Cloud ────────────────────────────────────────────────────────
  { name: 'Kubernetes Blog',       url: 'https://kubernetes.io/feed.xml',                       category: 'devops',      weight: 0.85 },
  { name: 'Docker Blog',           url: 'https://www.docker.com/blog/feed/',                    category: 'devops',      weight: 0.8 },
  { name: 'CNCF Blog',             url: 'https://www.cncf.io/blog/feed/',                       category: 'devops',      weight: 0.8 },
  { name: 'HashiCorp Blog',        url: 'https://www.hashicorp.com/blog/feed.xml',              category: 'devops',      weight: 0.75 },
  { name: 'AWS News Blog',         url: 'https://aws.amazon.com/blogs/aws/feed/',               category: 'devops',      weight: 0.8 },

  // ── Security ──────────────────────────────────────────────────────────────
  { name: 'Krebs on Security',     url: 'https://krebsonsecurity.com/feed/',                    category: 'security',    weight: 0.85 },
  { name: 'The Hacker News',       url: 'https://thehackernews.com/feeds/posts/default',        category: 'security',    weight: 0.8 },
  { name: 'Google Project Zero',   url: 'https://googleprojectzero.blogspot.com/feeds/posts/default', category: 'security', weight: 0.9 },
  { name: 'Schneier on Security',  url: 'https://www.schneier.com/feed/atom/',                  category: 'security',    weight: 0.85 },
]

export function getLearningSources(): LearningSource[] {
  // If env-configured URLs, use those as additions to defaults
  const envSources = cfg.learningRssSources
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({
      name:     new URL(url).hostname.replace(/^www\./, ''),
      url,
      category: 'uncategorized',
      weight:   0.7,
    }))

  if (envSources.length) {
    return [...DEFAULT_SOURCES, ...envSources]
  }

  // Use DB-configured sources if any, merged with defaults
  const dbSources = listActiveRssSources()
    .map((source) => ({
      name:     source.name,
      url:      source.url ?? '',
      category: typeof source.config.category === 'string' ? source.config.category : 'uncategorized',
      weight:   0.7,
    }))
    .filter((s) => s.url)

  return dbSources.length ? [...DEFAULT_SOURCES, ...dbSources] : DEFAULT_SOURCES
}

export function getAllowedLearningDomains(): Set<string> {
  const configured = cfg.learningAllowedDomains
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean)

  if (configured.length) {
    // User-configured domains are merged with all default source domains
    const defaults = DEFAULT_SOURCES.map((s) => new URL(s.url).hostname.replace(/^www\./, ''))
    return new Set([...defaults, ...configured])
  }

  return new Set(DEFAULT_SOURCES.map((s) => new URL(s.url).hostname.replace(/^www\./, '')))
}
