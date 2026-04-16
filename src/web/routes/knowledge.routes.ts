import type { FastifyInstance } from 'fastify'
import { searchKnowledge, listKnowledge, countKnowledge } from '../../knowledge/repository.js'

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/knowledge', async (req, reply) => {
    const { category, limit = '50', offset = '0' } = req.query as Record<string, string>
    const items = listKnowledge(category, Number(limit), Number(offset))
    const total = countKnowledge()
    return reply.send({ items, total, limit: Number(limit), offset: Number(offset) })
  })

  app.post('/search', async (req, reply) => {
    const { query, limit = 20 } = req.body as { query: string; limit?: number }
    if (!query || typeof query !== 'string' || query.length > 500) {
      return reply.status(400).send({ error: 'query must be a non-empty string under 500 chars' })
    }
    // Sanitize query: remove FTS5 special chars that could cause injection
    const safeQuery = query.replace(/['"*:()^~]/g, ' ').trim()
    if (!safeQuery) return reply.send({ items: [] })
    const items = searchKnowledge(safeQuery, Number(limit))
    return reply.send({ items, query: safeQuery })
  })

  app.get('/knowledge/stats', async (_req, reply) => {
    const total = countKnowledge()
    return reply.send({ total })
  })
}
