import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../src/knowledge/database.js'
import { upsertKnowledge } from '../src/knowledge/repository.js'
import { knowledgeRoutes } from '../src/web/routes/knowledge.routes.js'
import { boundedInt } from '../src/web/query-params.js'

const entry = (n: number, category: string) => ({
  title: `Entry ${n}`,
  content: `content ${n}`,
  category,
  source: 'test',
  metadata: {},
  importance_score: 0.5,
})

describe('boundedInt', () => {
  it('clamps, floors and falls back on junk', () => {
    expect(boundedInt('25', 50, 1, 200)).toBe(25)
    expect(boundedInt('9999', 50, 1, 200)).toBe(200)
    expect(boundedInt('-1', 50, 1, 200)).toBe(1)
    expect(boundedInt('2.9', 50, 1, 200)).toBe(2)
    expect(boundedInt('abc', 50, 1, 200)).toBe(50)
    expect(boundedInt('', 50, 1, 200)).toBe(50)
    expect(boundedInt(undefined, 50, 1, 200)).toBe(50)
    expect(boundedInt('Infinity', 50, 1, 200)).toBe(50)
  })
})

describe('GET /knowledge', () => {
  beforeEach(() => {
    getDb(':memory:')
    for (let i = 0; i < 5; i++) upsertKnowledge(entry(i, 'alpha'))
    for (let i = 5; i < 7; i++) upsertKnowledge(entry(i, 'beta'))
  })
  afterEach(() => closeDb())

  async function get(url: string) {
    const app = Fastify()
    await app.register(knowledgeRoutes)
    const res = await app.inject({ method: 'GET', url })
    await app.close()
    return { status: res.statusCode, body: res.json() }
  }

  it('reports the total of the filtered category, not of the whole table', async () => {
    const { body } = await get('/knowledge?category=beta')
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('does not fail or return an unbounded page on junk or negative limit/offset', async () => {
    const junk = await get('/knowledge?limit=abc&offset=xyz')
    expect(junk.status).toBe(200)
    expect(junk.body.limit).toBe(50)
    expect(junk.body.offset).toBe(0)
    const negative = await get('/knowledge?limit=-1')
    expect(negative.body.limit).toBe(1)
    expect(negative.body.items).toHaveLength(1)
  })
})
