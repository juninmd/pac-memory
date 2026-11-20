import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb } from '../src/knowledge/database.js'
import { getKnowledgeById, upsertKnowledge } from '../src/knowledge/repository.js'
import { knowledgeRoutes } from '../src/web/routes/knowledge.routes.js'
import * as embedder from '../src/knowledge/embedder.js'

vi.mock('../src/knowledge/embedder.js', () => ({ semanticSearch: vi.fn() }))

describe('POST /search mode=hybrid paging', () => {
  beforeEach(() => {
    getDb(':memory:')
    for (let i = 1; i <= 6; i++) {
      upsertKnowledge({ title: `rust note ${i}`, content: 'rust', category: 'tech', source: 's', metadata: {}, importance_score: 0.5 })
    }
    upsertKnowledge({ title: 'memory safety', content: 'borrow checker', category: 'tech', source: 's', metadata: {}, importance_score: 0.5 })
    // semantic ranking: entry 7 (no FTS hit) first, then 1..6 in reverse
    vi.mocked(embedder.semanticSearch).mockImplementation(async (_q, limit = 10) =>
      [7, 6, 5, 4, 3, 2, 1].slice(0, limit).map((id, i) => ({ ...getKnowledgeById(id)!, similarity: 0.9 - i * 0.1 })))
  })
  afterEach(() => closeDb())

  async function page(offset: number) {
    const app = Fastify()
    await app.register(knowledgeRoutes)
    const res = await app.inject({ method: 'POST', url: '/search', payload: { query: 'rust', mode: 'hybrid', limit: 3, offset } })
    await app.close()
    return res.json() as { items: { id: number }[]; total: number }
  }

  it('pages through the merged ranking without repeating or losing entries', async () => {
    const pages = [await page(0), await page(3), await page(6)]
    const ids = pages.flatMap((p) => p.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pages[0].total).toBe(7)
  })
})
