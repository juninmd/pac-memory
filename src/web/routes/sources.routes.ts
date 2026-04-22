import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireControlToken } from '../auth.js'
import {
  createSource,
  deleteSource,
  listConfiguredSources,
  updateSource,
} from '../../knowledge/repository.js'

const createSourceSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['rss', 'scrape', 'system', 'github', 'env']).default('rss'),
  url: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  is_active: z.boolean().default(true),
})

const updateSourceSchema = createSourceSchema.partial()

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/sources', async (_req, reply) => {
    return reply.send({ sources: listConfiguredSources() })
  })

  app.post('/sources', { preHandler: requireControlToken }, async (req, reply) => {
    const parsed = createSourceSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }

    const id = createSource(parsed.data)
    return reply.status(201).send({ id })
  })

  app.patch('/sources/:id', { preHandler: requireControlToken }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id must be a positive integer' })
    }

    const parsed = updateSourceSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }

    updateSource(numericId, parsed.data)
    return reply.send({ updated: true })
  })

  app.delete('/sources/:id', { preHandler: requireControlToken }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id must be a positive integer' })
    }

    deleteSource(numericId)
    return reply.send({ deleted: true })
  })
}
