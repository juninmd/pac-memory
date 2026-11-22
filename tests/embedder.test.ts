import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../src/knowledge/database.js'
import { findRelatedByEmbedding, saveEmbedding } from '../src/knowledge/embedder.js'
import { upsertKnowledge } from '../src/knowledge/repository.js'

const entry = (n: number) => ({
  title: `Entry ${n}`, content: `content ${n}`, category: 'c', source: 'test', metadata: {}, importance_score: 0.5,
})

describe('findRelatedByEmbedding', () => {
  beforeEach(() => { getDb(':memory:') })
  afterEach(() => closeDb())

  it('returns the most similar entries first, excluding the entry itself', async () => {
    const [a, b, c, d] = [1, 2, 3, 4].map((n) => upsertKnowledge(entry(n)))
    saveEmbedding(a, [1, 0, 0], 't')
    saveEmbedding(b, [0, 1, 0], 't')
    saveEmbedding(c, [0.9, 0.1, 0], 't')
    saveEmbedding(d, [0.5, 0.5, 0], 't')

    const related = await findRelatedByEmbedding(a, 2)

    expect(related.map((k) => k.id)).toEqual([c, d])
  })

  it('returns nothing for an entry without embedding', async () => {
    expect(await findRelatedByEmbedding(upsertKnowledge(entry(9)))).toEqual([])
  })
})
