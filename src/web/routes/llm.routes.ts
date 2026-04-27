import type { FastifyInstance } from 'fastify'
import { checkLlmHealth } from '../../llm/client.js'
import { cfg } from '../../shared/config.js'

export async function llmRoutes(app: FastifyInstance) {
  app.get('/llm/health', async (_req, reply) => {
    const status = await checkLlmHealth()
    return reply.status(status.ok ? 200 : 503).send(status)
  })

  app.get('/llm/config', async (_req, reply) => {
    return reply.send({
      provider: cfg.llmProvider,
      baseUrl: cfg.llmBaseUrl,
      model: cfg.llmModel.startsWith('ollama/') ? cfg.llmModel.slice(7) : cfg.llmModel,
      timeoutMs: cfg.llmTimeoutMs,
      hasApiKey: !!cfg.llmApiKey,
    })
  })
}
