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

describe('request bodies that are not JSON objects', () => {
  beforeEach(() => {
    getDb(':memory:')
    upsertKnowledge(entry(1, 'alpha'))
  })
  afterEach(() => closeDb())

  async function send(method: 'POST' | 'PATCH', url: string, payload?: string) {
    const app = Fastify()
    await app.register(knowledgeRoutes)
    const res = await app.inject({ method, url, payload, headers: payload === undefined ? {} : { 'content-type': 'application/json' } })
    await app.close()
    return res.statusCode
  }

  it.each([
    ['POST', '/search'],
    ['POST', '/search/semantic'],
    ['POST', '/qa'],
    ['PATCH', '/knowledge/1'],
  ] as const)('%s %s answers 400, not 500, for a missing, null, array or scalar body', async (method, url) => {
    for (const payload of [undefined, 'null', '[1]', '"x"', '42']) {
      expect(await send(method, url, payload), `${method} ${url} ${payload}`).toBe(400)
    }
  })
})

describe('PATCH /knowledge/:id field validation', () => {
  beforeEach(() => {
    getDb(':memory:')
    upsertKnowledge(entry(1, 'alpha'))
  })
  afterEach(() => closeDb())

  async function patch(body: unknown) {
    const app = Fastify()
    await app.register(knowledgeRoutes)
    const res = await app.inject({ method: 'PATCH', url: '/knowledge/1', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    await app.close()
    return { status: res.statusCode, body: res.json() }
  }

  it.each([
    [{ importance_score: 5 }],
    [{ importance_score: -0.1 }],
    [{ metadata: 'oops' }],
    [{ metadata: [1, 2] }],
    [{ title: '   ' }],
    [{ category: '' }],
  ])('rejects %j with 400 and keeps the entry intact', async (body) => {
    const res = await patch(body)
    expect(res.status).toBe(400)
    const { body: after } = await patch({ summary: 'probe' })
    expect(after.item.importance_score).toBe(0.5)
    expect(after.item.metadata).toEqual({})
    expect(after.item.title).toBe('Entry 1')
    expect(after.item.category).toBe('alpha')
  })

  it('accepts the bounds of importance_score and an object metadata', async () => {
    expect((await patch({ importance_score: 0 })).body.item.importance_score).toBe(0)
    const res = await patch({ importance_score: 1, metadata: { tag: 'x' } })
    expect(res.status).toBe(200)
    expect(res.body.item.importance_score).toBe(1)
    expect(res.body.item.metadata).toEqual({ tag: 'x' })
  })
})

describe('POST /search with punctuation', () => {
  beforeEach(() => {
    getDb(':memory:')
    upsertKnowledge({ ...entry(1, 'alpha'), content: 'deploy node.js on C++ hosts' })
  })
  afterEach(() => closeDb())

  it('answers 200 with matches instead of a 500 from FTS5 syntax', async () => {
    const app = Fastify()
    await app.register(knowledgeRoutes)
    const res = await app.inject({ method: 'POST', url: '/search', payload: { query: 'node.js' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(1)
  })
})
