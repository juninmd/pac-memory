import { describe, expect, it } from 'vitest'
import type { Knowledge } from '../src/shared/types.js'
import { buildIaKnowPaperDataset, renderIaKnowPaperMarkdown } from '../src/publishers/ia-know.js'

function paper(overrides: Partial<Knowledge> = {}): Knowledge {
  return {
    id: 1,
    title: '[arXiv] Large Language Model Agents',
    content: 'Agentic LLM systems for tool use.\n\nAuthors: A',
    summary: 'Agentic LLM systems for tool use.',
    category: 'ai-papers',
    source: 'paper-aggregator',
    importance_score: 0.91,
    created_at: '2026-05-17 00:00:00',
    updated_at: '2026-05-17 00:00:00',
    metadata: {
      paperId: '2601.12345',
      authors: ['Ada Lovelace'],
      categories: ['cs.CL'],
      published: '2026-01-01T00:00:00Z',
      updated: '2026-01-02T00:00:00Z',
      url: 'https://arxiv.org/abs/2601.12345',
      pdfUrl: 'https://arxiv.org/pdf/2601.12345.pdf',
    },
    ...overrides,
  }
}

describe('IA Know paper publisher', () => {
  it('builds a deterministic JSON-ready dataset', () => {
    const dataset = buildIaKnowPaperDataset([
      paper({ id: 2, title: '[arXiv] Older Paper', importance_score: 0.99, metadata: { published: '2025-01-01T00:00:00Z' } }),
      paper(),
    ], '2026-05-17T00:00:00.000Z')

    expect(dataset).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-05-17T00:00:00.000Z',
      source: 'pac-memory paper-aggregator',
      total: 2,
    })
    expect(dataset.papers[0].title).toBe('Large Language Model Agents')
    expect(dataset.papers[0].id).toBe('2601.12345')
  })

  it('renders VitePress markdown with paper links', () => {
    const markdown = renderIaKnowPaperMarkdown([paper()], '2026-05-17T00:00:00.000Z')

    expect(markdown).toContain('# Papers de IA e LLMs')
    expect(markdown).toContain('Total de papers: 1')
    expect(markdown).toContain('### Large Language Model Agents')
    expect(markdown).toContain('[Resumo](https://arxiv.org/abs/2601.12345)')
    expect(markdown).toContain('[PDF](https://arxiv.org/pdf/2601.12345.pdf)')
  })
})
