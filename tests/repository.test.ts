import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, closeDb } from '../src/knowledge/database.js'
import {
  bulkUpsert,
  countKnowledge,
  createSource,
  listActiveRssSources,
  listConfiguredSources,
  searchKnowledge,
  searchKnowledgePaginated,
  updateSource,
  upsertKnowledge,
} from '../src/knowledge/repository.js'
import type { KnowledgeInput } from '../src/shared/types.js'
import { mkdirSync } from 'fs'

process.env.DB_PATH = 'data/test-pac-memory.db'

const sample: KnowledgeInput = {
  title: 'Test Knowledge Entry',
  content: 'This is a test content for FTS5 search verification',
  summary: 'Concise summary of test content',
  category: 'testing',
  source: 'test-suite',
  metadata: { test: true },
  importance_score: 0.5,
}

describe('Knowledge Repository', () => {
  beforeEach(() => {
    const db = getDb(':memory:')
    // Truncate all tables for a clean state each test
    db.exec("DELETE FROM knowledge; DELETE FROM knowledge_fts; DELETE FROM agent_runs; DELETE FROM evolution_log; DELETE FROM sources;")
    db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')")
  })

  afterEach(() => {
    closeDb()
  })

  it('upserts and retrieves a knowledge entry with summary', () => {
    const id = upsertKnowledge(sample)
    expect(id).toBeGreaterThan(0)
    const db = getDb()
    const row = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as any
    expect(row.summary).toBe(sample.summary)
    expect(countKnowledge()).toBe(1)
  })

  it('updates summary on re-upsert', () => {
    upsertKnowledge(sample)
    const updatedSummary = 'Updated concise summary'
    upsertKnowledge({ ...sample, summary: updatedSummary })
    const db = getDb()
    const row = db.prepare('SELECT summary FROM knowledge WHERE title = ? AND source = ?').get(sample.title, sample.source) as any
    expect(row.summary).toBe(updatedSummary)
  })

  it('upserts and retrieves a knowledge entry', () => {
    const id = upsertKnowledge(sample)
    expect(id).toBeGreaterThan(0)
    expect(countKnowledge()).toBe(1)
  })

  it('deduplicates on same title+source', () => {
    upsertKnowledge(sample)
    upsertKnowledge({ ...sample, content: 'Updated content' })
    expect(countKnowledge()).toBe(1)
  })

  it('bulk inserts multiple items', () => {
    const items: KnowledgeInput[] = [
      { ...sample, title: 'Item A' },
      { ...sample, title: 'Item B' },
      { ...sample, title: 'Item C' },
    ]
    bulkUpsert(items)
    expect(countKnowledge()).toBe(3)
  })

  it('searches via FTS5', () => {
    upsertKnowledge(sample)
    const results = searchKnowledge('FTS5 search')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.title === 'Test Knowledge Entry')).toBe(true)
  })

  it('searches text with FTS5 punctuation and operators without throwing', () => {
    upsertKnowledge({ ...sample, title: 'Runtime notes', content: 'node.js C++ R&D e-mail 50% estado! rollout NOT done' })
    for (const q of ['node.js', 'C++', 'R&D', '50%', 'estado!', 'e-mail', 'rollout NOT', '"unbalanced', 'a:b (x']) {
      expect(() => searchKnowledge(q)).not.toThrow()
    }
    expect(searchKnowledge('node.js').map(r => r.title)).toContain('Runtime notes')
    expect(searchKnowledge('e-mail').map(r => r.title)).toContain('Runtime notes')
    expect(searchKnowledgePaginated('C++').total).toBe(1)
  })

  it('returns no results for a query made only of punctuation or spaces', () => {
    upsertKnowledge(sample)
    expect(searchKnowledge('   ')).toEqual([])
    expect(searchKnowledgePaginated('"').total).toBe(0)
  })

  it('returns empty array for no FTS5 match', () => {
    upsertKnowledge(sample)
    const results = searchKnowledge('xyznotexist987')
    expect(results.length).toBe(0)
  })

  it('creates and updates configured RSS sources', () => {
    const id = createSource({
      name: 'Example Feed',
      type: 'rss',
      url: 'https://example.com/feed.xml',
      config: { category: 'programming' },
      is_active: true,
    })

    expect(listConfiguredSources('rss')).toHaveLength(1)
    expect(listActiveRssSources()[0]?.config.category).toBe('programming')

    updateSource(id, { is_active: false })

    expect(listActiveRssSources()).toHaveLength(0)
  })
})
