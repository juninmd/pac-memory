import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../src/knowledge/database.js'
import { buildKnowledgeDigest, exportDigestMarkdown, findRelatedKnowledge } from '../src/knowledge/insights.js'
import { bulkUpsert } from '../src/knowledge/repository.js'
import type { KnowledgeInput } from '../src/shared/types.js'

const baseItem: KnowledgeInput = {
  title: 'Node Runtime Telemetry',
  content: 'Node.js process metrics, event loop delay and memory usage for production diagnostics',
  summary: 'Runtime metrics for Node.js services',
  category: 'performance',
  source: 'test-suite',
  metadata: { test: true },
  importance_score: 0.9,
}

describe('Knowledge Insights', () => {
  beforeEach(() => {
    const db = getDb(':memory:')
    db.exec("DELETE FROM knowledge; DELETE FROM knowledge_fts; DELETE FROM agent_runs; DELETE FROM evolution_log;")
    db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')")
  })

  afterEach(() => {
    closeDb()
  })

  it('builds a digest with categories, sources and intelligence signals', () => {
    bulkUpsert([
      baseItem,
      {
        ...baseItem,
        title: 'GitHub Repository Health',
        content: 'Repository stars, workflow status and pull request activity',
        category: 'github',
        importance_score: 0.7,
      },
    ])

    const digest = buildKnowledgeDigest()

    expect(digest.total).toBe(2)
    expect(digest.categories.map((category) => category.category)).toContain('performance')
    expect(digest.sources[0]?.source).toBe('test-suite')
    expect(digest.topKnowledge[0]?.title).toBe('Node Runtime Telemetry')
    expect(digest.insights.length).toBeGreaterThan(0)
  })

  it('finds related knowledge using search and category fallback', () => {
    bulkUpsert([
      baseItem,
      {
        ...baseItem,
        title: 'Node Memory Pressure',
        content: 'Memory diagnostics and heap snapshots for Node.js runtime issues',
        summary: 'Node memory diagnostics',
      },
      {
        ...baseItem,
        title: 'Unrelated Security Feed',
        content: 'Security advisory unrelated to runtime telemetry',
        category: 'security',
      },
    ])

    const related = findRelatedKnowledge(1)

    expect(related.some((item) => item.title === 'Node Memory Pressure')).toBe(true)
    expect(related.every((item) => item.id !== 1)).toBe(true)
  })

  it('exports a markdown digest', () => {
    bulkUpsert([baseItem])

    const markdown = exportDigestMarkdown()

    expect(markdown).toContain('# PAC-MEMORY Digest')
    expect(markdown).toContain('Node Runtime Telemetry')
    expect(markdown).toContain('## Intelligence Signals')
  })

  it('handles legacy entries without summaries', () => {
    bulkUpsert([{ ...baseItem, title: 'Legacy Entry', summary: undefined }])

    const digest = buildKnowledgeDigest()

    expect(digest.total).toBe(1)
    expect(digest.insights.some((insight) => insight.id === 'missing-summaries')).toBe(true)
  })
})
