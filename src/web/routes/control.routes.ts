import type { FastifyInstance } from 'fastify'
import { runEvolutionCycle, runFullCollection } from '../../agents/orchestrator.agent.js'
import { runLearningCycle } from '../../learning/cycle.js'
import { childLogger } from '../../shared/logger.js'
import { requireControlToken } from '../auth.js'

const log = childLogger('control-routes')

let collectRunning = false
let evolveRunning = false
let learnRunning = false

export async function controlRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireControlToken)

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

  app.post('/control/learn', async (_req, reply) => {
    if (learnRunning) {
      return reply.status(409).send({ error: 'learning is already running' })
    }

    learnRunning = true
    void runLearningCycle()
      .catch((err) => log.error({ err }, 'Manual learning failed'))
      .finally(() => { learnRunning = false })

    return reply.status(202).send({ accepted: true, task: 'learn' })
  })

  app.get('/control/status', async (_req, reply) => {
    return reply.send({ collectRunning, evolveRunning, learnRunning })
  })
}
