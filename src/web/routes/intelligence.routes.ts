import type { FastifyInstance } from 'fastify'
import { buildKnowledgeDigest, exportDigestMarkdown, findRelatedKnowledge } from '../../knowledge/insights.js'

export async function intelligenceRoutes(app: FastifyInstance) {
  app.get('/intelligence/digest', async (_req, reply) => {
    return reply.send(buildKnowledgeDigest())
  })

  app.get('/knowledge/:id/related', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { limit = '8' } = req.query as Record<string, string>
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id must be a positive integer' })
    }

    return reply.send({ items: findRelatedKnowledge(numericId, Number(limit)) })
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
}
