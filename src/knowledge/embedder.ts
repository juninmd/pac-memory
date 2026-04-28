import { embedText } from '../llm/client.js'
import { getDb } from './database.js'
import { getKnowledgeById, listKnowledge } from './repository.js'
import { childLogger } from '../shared/logger.js'
import type { Knowledge } from '../shared/types.js'

const log = childLogger('embedder')

interface EmbeddingRow {
  knowledge_id: number
  vector:       string
  model:        string
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function saveEmbedding(knowledgeId: number, vector: number[], model: string): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO knowledge_embeddings (knowledge_id, vector, model)
    VALUES (?, ?, ?)
    ON CONFLICT (knowledge_id) DO UPDATE SET vector=excluded.vector, model=excluded.model, created_at=datetime('now')
  `).run(knowledgeId, JSON.stringify(vector), model)
}

export function getEmbedding(knowledgeId: number): number[] | null {
  const db  = getDb()
  const row = db.prepare('SELECT vector FROM knowledge_embeddings WHERE knowledge_id=?').get(knowledgeId) as Pick<EmbeddingRow, 'vector'> | undefined
  if (!row) return null
  return JSON.parse(row.vector) as number[]
}

export function getEmbeddedIds(): Set<number> {
  const db   = getDb()
  const rows = db.prepare('SELECT knowledge_id FROM knowledge_embeddings').all() as { knowledge_id: number }[]
  return new Set(rows.map(r => r.knowledge_id))
}

/** Find knowledge entries related to `id` using cosine similarity on stored embeddings. */
export async function findRelatedByEmbedding(id: number, limit = 5): Promise<Knowledge[]> {
  const targetVec = getEmbedding(id)
  if (!targetVec) return []

  const db   = getDb()
  const rows = db.prepare(`
    SELECT ke.knowledge_id, ke.vector
    FROM knowledge_embeddings ke
    WHERE ke.knowledge_id != ?
  `).all(id) as { knowledge_id: number; vector: string }[]

  const scored = rows
    .map(row => ({
      id:    row.knowledge_id,
      score: cosineSimilarity(targetVec, JSON.parse(row.vector) as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const results: Knowledge[] = []
  for (const { id: kid } of scored) {
    const entry = getKnowledgeById(kid)
    if (entry) results.push(entry)
  }
  return results
}

/** Generate and persist embeddings for a list of knowledge IDs. Runs best-effort (errors are logged but not thrown). */
export async function generateEmbeddingsForIds(ids: number[]): Promise<void> {
  const embedded = getEmbeddedIds()
  const toEmbed  = ids.filter(id => !embedded.has(id))
  if (!toEmbed.length) return

  log.info({ count: toEmbed.length }, 'Generating embeddings')

  for (const id of toEmbed) {
    try {
      const entry = getKnowledgeById(id)
      if (!entry) continue
      const text   = `${entry.title}\n${entry.summary || entry.content.slice(0, 500)}`
      const vector = await embedText(text)
      saveEmbedding(id, vector, 'ai-sdk')
    } catch (err) {
      log.warn({ err, id }, 'Failed to generate embedding, skipping')
    }
  }

  log.info({ count: toEmbed.length }, 'Embeddings generated')
}

/** Background task: embed all knowledge entries that lack embeddings. */
export function scheduleBackfillEmbeddings(): void {
  const db            = getDb()
  const missingRows   = db.prepare(`
    SELECT k.id FROM knowledge k
    LEFT JOIN knowledge_embeddings ke ON ke.knowledge_id = k.id
    WHERE ke.knowledge_id IS NULL
    LIMIT 100
  `).all() as { id: number }[]

  if (!missingRows.length) return

  const ids = missingRows.map(r => r.id)
  log.info({ count: ids.length }, 'Scheduling embedding backfill')

  // Run async without blocking caller
  generateEmbeddingsForIds(ids).catch(err => {
    log.warn({ err }, 'Embedding backfill error')
  })
}

/** Generate embeddings for the N most recent entries without embeddings. */
export async function embedRecentKnowledge(batchSize = 50): Promise<number> {
  const db   = getDb()
  const rows = db.prepare(`
    SELECT k.id FROM knowledge k
    LEFT JOIN knowledge_embeddings ke ON ke.knowledge_id = k.id
    WHERE ke.knowledge_id IS NULL
    ORDER BY k.created_at DESC
    LIMIT ?
  `).all(batchSize) as { id: number }[]

  if (!rows.length) return 0

  await generateEmbeddingsForIds(rows.map(r => r.id))
  return rows.length
}

/** Return all knowledge entries with existing embeddings, for bulk similarity ops. */
export function getAllEmbeddings(): { id: number; vector: number[] }[] {
  const db   = getDb()
  const rows = db.prepare('SELECT knowledge_id, vector FROM knowledge_embeddings').all() as EmbeddingRow[]
  return rows.map(r => ({ id: r.knowledge_id, vector: JSON.parse(r.vector) as number[] }))
}

/** Given a free-text query, embed it and find the most similar knowledge entries. */
export async function semanticSearch(query: string, limit = 10): Promise<(Knowledge & { similarity: number })[]> {
  const queryVec  = await embedText(query)
  const allEmbeds = getAllEmbeddings()

  const scored = allEmbeds
    .map(({ id, vector }) => ({ id, score: cosineSimilarity(queryVec, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const results: (Knowledge & { similarity: number })[] = []
  for (const { id, score } of scored) {
    const entry = getKnowledgeById(id)
    if (entry) results.push({ ...entry, similarity: score })
  }
  return results
}
