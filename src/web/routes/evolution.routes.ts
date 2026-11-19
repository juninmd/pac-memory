import type { FastifyInstance } from 'fastify'
import { listEvolutionLog } from '../../knowledge/repository.js'
import { boundedInt } from '../query-params.js'

export async function evolutionRoutes(app: FastifyInstance) {
  app.get('/evolution/log', async (req, reply) => {
    const { limit } = req.query as Record<string, string>
    const log = listEvolutionLog(boundedInt(limit, 20, 1, 200))
    return reply.send({ log })
  })
}
