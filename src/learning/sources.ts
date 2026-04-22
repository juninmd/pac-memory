import { cfg } from '../shared/config.js'
import { listActiveRssSources } from '../knowledge/repository.js'

export interface LearningSource {
  name: string
  url: string
  category: string
}

const DEFAULT_SOURCES: LearningSource[] = [
  { name: 'Anthropic Blog', url: 'https://www.anthropic.com/rss.xml', category: 'ai-ml' },
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', category: 'ai-ml' },
  { name: 'VSCode Updates', url: 'https://code.visualstudio.com/updates/rss', category: 'tools' },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', category: 'tools' },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', category: 'ai-ml' },
  { name: 'Google Developers', url: 'https://developers.googleblog.com/feeds/posts/default', category: 'programming' },
  { name: 'Google ADK Releases', url: 'https://github.com/google/adk-js/releases.atom', category: 'ai-ml' },
]

export function getLearningSources(): LearningSource[] {
  if (!cfg.learningRssSources.trim()) {
    const configuredSources = listActiveRssSources().map((source) => ({
      name: source.name,
      url: source.url ?? '',
      category: typeof source.config.category === 'string' ? source.config.category : 'uncategorized',
    })).filter((source) => source.url)

    return configuredSources.length ? configuredSources : DEFAULT_SOURCES
  }

  return cfg.learningRssSources
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({
      name: new URL(url).hostname.replace(/^www\./, ''),
      url,
      category: 'uncategorized',
    }))
}

export function getAllowedLearningDomains(): Set<string> {
  const configured = cfg.learningAllowedDomains
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean)

  if (configured.length) {
    return new Set(configured)
  }

  return new Set(DEFAULT_SOURCES.map((source) => new URL(source.url).hostname.replace(/^www\./, '')))
}
