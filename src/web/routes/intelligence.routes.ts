import type { FastifyInstance } from 'fastify'
import { buildKnowledgeDigest, exportDigestMarkdown, findRelatedKnowledge } from '../../knowledge/insights.js'
import { getMetricsHistory, listKnowledge } from '../../knowledge/repository.js'
import { semanticSearch, embedRecentKnowledge } from '../../knowledge/embedder.js'
import { generateDailyDigest, getLatestDigest } from '../../daily/digest-generator.js'
import { boundedInt } from '../query-params.js'

export async function intelligenceRoutes(app: FastifyInstance) {
  app.get('/intelligence/digest', async (_req, reply) => {
    return reply.send(buildKnowledgeDigest())
  })

  // Daily digest — GET latest saved, POST to generate now
  app.get('/intelligence/daily-digest', async (_req, reply) => {
    const digest = getLatestDigest()
    if (!digest) return reply.status(404).send({ error: 'No daily digest yet' })
    return reply.send(digest)
  })

  app.post('/intelligence/daily-digest/generate', async (_req, reply) => {
    const result = await generateDailyDigest()
    return reply.send(result)
  })

  app.get('/knowledge/:id/related', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { limit } = req.query as Record<string, string>
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id must be a positive integer' })
    }

    const items = await findRelatedKnowledge(numericId, boundedInt(limit, 8, 1, 50))
    return reply.send({ items })
  })

  // Semantic search via embeddings
  app.get('/intelligence/semantic', async (req, reply) => {
    const { q, limit } = req.query as Record<string, string>
    if (!q?.trim()) return reply.status(400).send({ error: 'q param required' })
    try {
      const results = await semanticSearch(q.trim(), boundedInt(limit, 10, 1, 50))
      return reply.send({ items: results, query: q.trim() })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(503).send({ error: `Semantic search unavailable: ${message}` })
    }
  })

  // Trigger embedding backfill for recent entries
  app.post('/intelligence/embed', async (_req, reply) => {
    const { batchSize = '50' } = _req.query as Record<string, string>
    try {
      const count = await embedRecentKnowledge(Math.min(Number(batchSize), 200))
      return reply.send({ embedded: count })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(503).send({ error: `Embedding failed: ${message}` })
    }
  })

  app.get('/intelligence/metrics-history', async (req, reply) => {
    const { days = '30' } = req.query as Record<string, string>
    const d = Math.min(Math.max(1, Number(days)), 365)
    return reply.send({ snapshots: getMetricsHistory(d), days: d })
  })

  app.get('/export/digest', async (req, reply) => {
    const { format = 'markdown' } = req.query as Record<string, string>
    const digest = buildKnowledgeDigest()

    if (format === 'json') {
      return reply
        .header('content-disposition', 'attachment; filename="pac-memory-digest.json"')
        .send(digest)
    }

    return reply
      .type('text/markdown; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pac-memory-digest.md"')
      .send(exportDigestMarkdown(digest))
  })

  app.get('/export/knowledge', async (req, reply) => {
    const { format = 'csv' } = req.query as Record<string, string>
    const { limit, offset } = req.query as Record<string, string>
    const lim = boundedInt(limit, 5000, 1, 5000)
    const off = boundedInt(offset, 0, 0, Number.MAX_SAFE_INTEGER)

    const items = listKnowledge(undefined, lim, off)

    if (format === 'json') {
      return reply
        .header('content-disposition', 'attachment; filename="pac-memory-export.json"')
        .send({ items, total: items.length })
    }

    const escapeCsv = (val: unknown) => {
      if (val == null) return ''
      const str = String(val).replace(/"/g, '""')
      return str.includes(',') || str.includes('\n') || str.includes('"') ? `"${str}"` : str
    }

    const header = 'id,title,category,source,importance_score,created_at,updated_at,summary'
    const rows = items.map(i =>
      [i.id, escapeCsv(i.title), escapeCsv(i.category), escapeCsv(i.source),
       i.importance_score, i.created_at, i.updated_at, escapeCsv(i.summary)].join(',')
    )
    const csv = [header, ...rows].join('\n')

    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pac-memory-export.csv"')
      .send(csv)
  })
}
