import Parser from 'rss-parser'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { assertSafeFetchUrl } from '../security/url-policy.js'

const log = childLogger('learning:arxiv-papers')
const ARXIV_API_BASE = 'https://export.arxiv.org/api/query'

interface ArxivFeedItem {
  title?: string
  link?: string
  content?: string
  contentSnippet?: string
  summary?: string
  isoDate?: string
  pubDate?: string
  id?: string
  creator?: string
  author?: string
  categories?: string[]
  links?: { href?: string; type?: string; rel?: string; title?: string }[]
}

export interface PaperRecord {
  paperId: string
  title: string
  abstract: string
  authors: string[]
  published: string
  updated: string
  url: string
  pdfUrl: string
  categories: string[]
}

export async function collectAiPapers(): Promise<KnowledgeInput[]> {
  if (!cfg.paperAggregatorEnabled) {
    log.info('Paper aggregator disabled')
    return []
  }

  const apiUrl = buildArxivQueryUrl(cfg.paperAggregatorQuery, cfg.paperAggregatorMaxItems)
  const safeUrl = await assertSafeFetchUrl(apiUrl, {
    allowedDomains: new Set(['export.arxiv.org']),
    allowHttp: false,
  })
  const xml = await fetchText(safeUrl)
  const feed = await new Parser({ customFields: { item: ['id', 'updated'] } }).parseString(xml)
  const now = new Date().toISOString()

  const items = (feed.items ?? [])
    .map((entry) => normalizeArxivItem(entry as ArxivFeedItem))
    .filter((paper): paper is PaperRecord => paper !== null)
    .filter(isRelevantAiPaper)
    .map((paper) => paperToKnowledgeInput(paper, now))

  log.info({ count: items.length }, 'AI papers collected from arXiv')
  return items
}

export function buildArxivQueryUrl(searchQuery: string, maxResults: number): string {
  const url = new URL(ARXIV_API_BASE)
  url.searchParams.set('search_query', searchQuery)
  url.searchParams.set('sortBy', 'submittedDate')
  url.searchParams.set('sortOrder', 'descending')
  url.searchParams.set('max_results', String(Math.max(1, Math.min(maxResults, 200))))
  return url.toString()
}

export function normalizeArxivItem(entry: ArxivFeedItem): PaperRecord | null {
  const url = entry.id ?? entry.link ?? ''
  const paperId = extractArxivId(url)
  const title = cleanText(entry.title ?? '')
  const abstract = cleanText(entry.contentSnippet ?? entry.content ?? entry.summary ?? '')

  if (!paperId || !title || !abstract) return null

  return {
    paperId,
    title,
    abstract,
    authors: extractAuthors(entry),
    published: entry.isoDate ?? entry.pubDate ?? '',
    updated: typeof (entry as Record<string, unknown>).updated === 'string'
      ? (entry as Record<string, string>).updated
      : '',
    url: `https://arxiv.org/abs/${paperId}`,
    pdfUrl: findPdfUrl(entry, paperId),
    categories: Array.isArray(entry.categories) ? entry.categories : [],
  }
}

export function paperToKnowledgeInput(paper: PaperRecord, learnedAt: string): KnowledgeInput {
  return {
    title: `[arXiv] ${paper.title}`,
    content: [
      paper.abstract,
      '',
      `Authors: ${paper.authors.join(', ') || 'unknown'}`,
      `arXiv: ${paper.paperId}`,
      `Categories: ${paper.categories.join(', ') || 'unknown'}`,
      `URL: ${paper.url}`,
      `PDF: ${paper.pdfUrl}`,
      `Published: ${paper.published}`,
      `Updated: ${paper.updated}`,
    ].join('\n'),
    category: 'ai-papers',
    source: 'paper-aggregator',
    summary: paper.abstract.slice(0, 700),
    importance_score: scorePaper(paper),
    metadata: {
      sourceType: 'paper',
      provider: 'arxiv',
      paperId: paper.paperId,
      authors: paper.authors,
      url: paper.url,
      pdfUrl: paper.pdfUrl,
      published: paper.published,
      updated: paper.updated,
      categories: paper.categories,
      learnedAt,
      freshness: paper.published ? 'dated' : 'unknown',
      confidence: 0.9,
    },
  }
}

function isRelevantAiPaper(paper: PaperRecord): boolean {
  const text = `${paper.title} ${paper.abstract} ${paper.categories.join(' ')}`.toLowerCase()
  return [
    'large language model',
    'language model',
    'llm',
    'agent',
    'transformer',
    'retrieval',
    'rag',
    'reasoning',
    'alignment',
    'generative',
    'multimodal',
    'reinforcement learning',
    'machine learning',
    'artificial intelligence',
    'cs.ai',
    'cs.cl',
    'cs.lg',
    'stat.ml',
  ].some((term) => text.includes(term))
}

function scorePaper(paper: PaperRecord): number {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase()
  let score = 0.78
  if (text.includes('large language model') || text.includes('llm')) score += 0.08
  if (text.includes('agent') || text.includes('reasoning')) score += 0.05
  if (paper.categories.some((category) => ['cs.CL', 'cs.AI', 'cs.LG', 'stat.ML'].includes(category))) score += 0.04
  return Math.min(score, 0.95)
}

function extractArxivId(url: string): string {
  const match = url.match(/(?:abs|pdf)\/([^/?#]+)(?:\.pdf)?/)
    ?? url.match(/arxiv\.org\/([^/?#]+)$/)
  return match?.[1]?.replace(/v\d+$/, '') ?? ''
}

function extractAuthors(entry: ArxivFeedItem): string[] {
  const raw = entry.creator ?? entry.author ?? ''
  return raw
    .split(/,\s*|\s+and\s+/)
    .map((author) => cleanText(author))
    .filter(Boolean)
}

function findPdfUrl(entry: ArxivFeedItem, paperId: string): string {
  const link = entry.links?.find((candidate) =>
    candidate.type === 'application/pdf' || candidate.title === 'pdf' || candidate.href?.includes('/pdf/')
  )
  return link?.href ?? `https://arxiv.org/pdf/${paperId}.pdf`
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.learningFetchTimeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'pac-memory-paper-aggregator/1.0 (https://github.com/juninmd/pac-memory)',
        accept: 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      },
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const text = await response.text()
    if (text.length > cfg.learningMaxBytes) {
      throw new Error(`Response too large: ${text.length} bytes`)
    }

    return text
  } finally {
    clearTimeout(timer)
  }
}
