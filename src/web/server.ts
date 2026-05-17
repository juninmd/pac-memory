import Fastify, { type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { orchestratorEvents } from '../shared/events.js'
import { knowledgeRoutes } from './routes/knowledge.routes.js'
import { agentRoutes } from './routes/agents.routes.js'
import { evolutionRoutes } from './routes/evolution.routes.js'
import { intelligenceRoutes } from './routes/intelligence.routes.js'
import { controlRoutes } from './routes/control.routes.js'
import { sourcesRoutes } from './routes/sources.routes.js'
import { llmRoutes } from './routes/llm.routes.js'
import { healthRoutes } from './routes/health.routes.js'
import { closeDb } from '../knowledge/database.js'
type WebSocket = { readyState: number; send: (data: string) => void; on: (event: string, cb: () => void) => void; close?: () => void }

const log = childLogger('web-server')
const __dirname = dirname(fileURLToPath(import.meta.url))

const activeClients = new Set<WebSocket>()

function broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data, ts: new Date().toISOString() })
  for (const ws of activeClients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(msg)
    }
  }
}

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception')
  broadcast('system', { type: 'crash', message: err.message })
  closeDb()
  setTimeout(() => process.exit(1), 1000)
})

process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'Unhandled rejection')
})

export async function startWebServer() {
  const app = Fastify({ logger: false })

  app.setErrorHandler((error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode ?? 500
    const errObj = error instanceof Error ? error : new Error(String(error))
    const message = status < 500 ? errObj.message : 'Erro interno do servidor'
    log.warn({ status, err: errObj.message, url: req.url, method: req.method }, 'Request error')
    reply.status(status).send({ error: message })
  })

  app.addHook('onClose', () => {
    log.info('Fastify server closing')
    for (const ws of activeClients) {
      try { if (ws.close) ws.close() } catch { /* ignore */ }
    }
    activeClients.clear()
  })

  await app.register(fastifyWebsocket)
  await app.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/',
  })

  app.get('/ws', { websocket: true }, (socket) => {
    activeClients.add(socket)
    log.debug('WebSocket client connected')
    socket.send(JSON.stringify({ event: 'connected', data: { message: 'pac-memory live feed' }, ts: new Date().toISOString() }))

    socket.on('close', () => {
      activeClients.delete(socket)
      log.debug('WebSocket client disconnected')
    })
    socket.on('error', (err: unknown) => {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'WebSocket error')
      activeClients.delete(socket)
    })
  })

  orchestratorEvents.on('agent', (data) => broadcast('agent', data))
  orchestratorEvents.on('evolution', (data) => broadcast('evolution', data))

  await app.register(healthRoutes)  // sem prefixo — probes k8s chamam /health/live e /health/ready
  await app.register(knowledgeRoutes, { prefix: '/api' })
  await app.register(agentRoutes, { prefix: '/api' })
  await app.register(evolutionRoutes, { prefix: '/api' })
  await app.register(intelligenceRoutes, { prefix: '/api' })
  await app.register(sourcesRoutes, { prefix: '/api' })
  await app.register(controlRoutes, { prefix: '/api' })
  await app.register(llmRoutes, { prefix: '/api' })

  await app.listen({ port: cfg.port, host: cfg.host })
  log.info({ host: cfg.host, port: cfg.port }, `Web dashboard: http://${cfg.host}:${cfg.port}`)
  return app
}
