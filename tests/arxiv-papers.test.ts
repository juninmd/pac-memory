import { describe, expect, it } from 'vitest'
import { buildArxivQueryUrl, normalizeArxivItem, paperToKnowledgeInput } from '../src/learning/arxiv-papers.js'

describe('arXiv paper aggregation', () => {
  it('builds a bounded arXiv API query URL', () => {
    const url = new URL(buildArxivQueryUrl('cat:cs.CL', 500))

    expect(url.hostname).toBe('export.arxiv.org')
    expect(url.searchParams.get('search_query')).toBe('cat:cs.CL')
    expect(url.searchParams.get('sortBy')).toBe('submittedDate')
    expect(url.searchParams.get('sortOrder')).toBe('descending')
    expect(url.searchParams.get('max_results')).toBe('200')
  })

  it('normalizes arXiv Atom entries into paper metadata', () => {
    const paper = normalizeArxivItem({
      id: 'https://arxiv.org/abs/2601.12345v2',
      title: '  Better Large Language Model Agents  ',
      contentSnippet: '  We study reliable LLM agents. ',
      creator: 'Ada Lovelace, Alan Turing',
      isoDate: '2026-01-01T00:00:00Z',
      categories: ['cs.CL', 'cs.AI'],
    })

    expect(paper).toMatchObject({
      paperId: '2601.12345',
      title: 'Better Large Language Model Agents',
      abstract: 'We study reliable LLM agents.',
      authors: ['Ada Lovelace', 'Alan Turing'],
      url: 'https://arxiv.org/abs/2601.12345',
      pdfUrl: 'https://arxiv.org/pdf/2601.12345.pdf',
      categories: ['cs.CL', 'cs.AI'],
    })
  })

  it('maps papers to knowledge records with provenance', () => {
    const paper = normalizeArxivItem({
      id: 'https://arxiv.org/abs/2601.12345',
      title: 'Large Language Model Reasoning',
      contentSnippet: 'A benchmark for LLM reasoning.',
      creator: 'Researcher One',
      categories: ['cs.CL'],
    })

    expect(paper).not.toBeNull()
    const item = paperToKnowledgeInput(paper!, '2026-05-17T00:00:00.000Z')

    expect(item.source).toBe('paper-aggregator')
    expect(item.category).toBe('ai-papers')
    expect(item.importance_score).toBeGreaterThan(0.8)
    expect(item.metadata).toMatchObject({
      sourceType: 'paper',
      provider: 'arxiv',
      paperId: '2601.12345',
      learnedAt: '2026-05-17T00:00:00.000Z',
    })
  })
})
