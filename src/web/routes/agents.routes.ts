import type { FastifyInstance } from 'fastify'
import { listAgentRuns } from '../../knowledge/repository.js'

export async function agentRoutes(app: FastifyInstance) {
  app.get('/agents/status', async (_req, reply) => {
    const runs = listAgentRuns(20)
    return reply.send({ runs })
  })
}
