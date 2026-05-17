import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  runEvolutionCycle,
  runFullCollection,
  runCollector,
} from '../../agents/orchestrator.agent.js'
import { runLearningCycle } from '../../learning/cycle.js'
import { generateDailyDigest } from '../../daily/digest-generator.js'
import { collectSystemInfo } from '../../agents/system.agent.js'
import { collectNetworkInfo } from '../../agents/network.agent.js'
import { collectGithubInfo } from '../../agents/github.agent.js'
import { collectEnvVars } from '../../agents/env.agent.js'
import { collectWebMonitor } from '../../agents/web-monitor.agent.js'
import { childLogger } from '../../shared/logger.js'
import { requireControlToken } from '../auth.js'

const log = childLogger('control-routes')

const running: Record<string, boolean> = {}

function makeJobHandler(key: string, fn: () => Promise<unknown>) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    if (running[key]) return reply.status(409).send({ error: `${key} already running` })
    running[key] = true
    void fn()
      .catch(err => log.error({ err, job: key }, 'Job failed'))
      .finally(() => { running[key] = false })
    return reply.status(202).send({ accepted: true, task: key })
  }
}

export async function controlRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireControlToken)

  // ── Full collection ───────────────────────────────────────────────────────
  app.post('/control/collect', makeJobHandler('collect', runFullCollection))

  // ── Individual agents — each maps to one k8s CronJob ─────────────────────
  app.post('/control/collect/system',  makeJobHandler('system',  () => runCollector('system',      collectSystemInfo)))
  app.post('/control/collect/network', makeJobHandler('network', () => runCollector('network',     collectNetworkInfo)))
  app.post('/control/collect/env',     makeJobHandler('env',     () => runCollector('env',         () => Promise.resolve(collectEnvVars()))))
  app.post('/control/collect/github',  makeJobHandler('github',  () => runCollector('github',      collectGithubInfo)))
  app.post('/control/collect/web',     makeJobHandler('web',     () => runCollector('web-monitor', collectWebMonitor)))

  // ── Learning, evolution, digest ───────────────────────────────────────────
  app.post('/control/learn',  makeJobHandler('learn',  runLearningCycle))
  app.post('/control/evolve', makeJobHandler('evolve', runEvolutionCycle))
  app.post('/control/digest', makeJobHandler('digest', generateDailyDigest))

  app.get('/control/status', async (_req, reply) => {
    return reply.send({ running })
  })
}
