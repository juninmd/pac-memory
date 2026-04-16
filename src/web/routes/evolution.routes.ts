import type { FastifyInstance } from 'fastify'
import { listEvolutionLog } from '../../knowledge/repository.js'

export async function evolutionRoutes(app: FastifyInstance) {
  app.get('/evolution/log', async (req, reply) => {
    const { limit = '20' } = req.query as Record<string, string>
    const log = listEvolutionLog(Number(limit))
    return reply.send({ log })
  })
}
