import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb, closeDb } from '../src/knowledge/database.js'
import { upsertKnowledge, searchKnowledge, bulkUpsert, countKnowledge } from '../src/knowledge/repository.js'
import type { KnowledgeInput } from '../src/shared/types.js'
import { mkdirSync } from 'fs'

process.env.DB_PATH = 'data/test-pac-memory.db'

const sample: KnowledgeInput = {
  title: 'Test Knowledge Entry',
  content: 'This is a test content for FTS5 search verification',
  category: 'testing',
  source: 'test-suite',
  metadata: { test: true },
  importance_score: 0.5,
}

describe('Knowledge Repository', () => {
  beforeEach(() => {
    mkdirSync('data', { recursive: true })
    const db = getDb()
    // Truncate all tables for a clean state each test
    db.exec("DELETE FROM knowledge; DELETE FROM knowledge_fts; DELETE FROM agent_runs; DELETE FROM evolution_log;")
    db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')")
  })

  afterEach(() => {
    closeDb()
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

  it('returns empty array for no FTS5 match', () => {
    upsertKnowledge(sample)
    const results = searchKnowledge('xyznotexist987')
    expect(results.length).toBe(0)
  })
})
