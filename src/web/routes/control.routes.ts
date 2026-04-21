import type { FastifyInstance } from 'fastify'
import { runEvolutionCycle, runFullCollection } from '../../agents/orchestrator.agent.js'
import { childLogger } from '../../shared/logger.js'

const log = childLogger('control-routes')

let collectRunning = false
let evolveRunning = false

export async function controlRoutes(app: FastifyInstance) {
  app.post('/control/collect', async (_req, reply) => {
    if (collectRunning) {
      return reply.status(409).send({ error: 'collection is already running' })
    }

    collectRunning = true
    void runFullCollection()
      .catch((err) => log.error({ err }, 'Manual collection failed'))
      .finally(() => { collectRunning = false })

    return reply.status(202).send({ accepted: true, task: 'collect' })
  })

  app.post('/control/evolve', async (_req, reply) => {
    if (evolveRunning) {
      return reply.status(409).send({ error: 'evolution is already running' })
    }

    evolveRunning = true
    void runEvolutionCycle()
      .catch((err) => log.error({ err }, 'Manual evolution failed'))
      .finally(() => { evolveRunning = false })

    return reply.status(202).send({ accepted: true, task: 'evolve' })
  })

  app.get('/control/status', async (_req, reply) => {
    return reply.send({ collectRunning, evolveRunning })
  })
}
