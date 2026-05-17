import type { FastifyInstance } from 'fastify'
import { countKnowledge } from '../../knowledge/repository.js'

export async function healthRoutes(app: FastifyInstance) {
  // Liveness — sem dependência de DB; k8s reinicia se falhar
  app.get('/health/live', async (_req, reply) => {
    return reply.send({ alive: true })
  })

  // Readiness — valida que o DB está acessível antes de receber tráfego
  app.get('/health/ready', async (_req, reply) => {
    try {
      countKnowledge()
      return reply.send({ ready: true, checks: { db: true } })
    } catch {
      return reply.status(503).send({ ready: false, checks: { db: false } })
    }
  })
}
