import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { orchestratorEvents } from '../agents/orchestrator.agent.js'
import { knowledgeRoutes } from './routes/knowledge.routes.js'
import { agentRoutes } from './routes/agents.routes.js'
import { evolutionRoutes } from './routes/evolution.routes.js'
import { intelligenceRoutes } from './routes/intelligence.routes.js'
import { controlRoutes } from './routes/control.routes.js'
// WebSocket type from @fastify/websocket
type WebSocket = { readyState: number; send: (data: string) => void; on: (event: string, cb: () => void) => void }

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

export async function startWebServer() {
  const app = Fastify({ logger: false })

  await app.register(fastifyWebsocket)
  await app.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/',
  })

  // WebSocket live feed
  app.get('/ws', { websocket: true }, (socket) => {
    activeClients.add(socket)
    log.debug('WebSocket client connected')
    socket.send(JSON.stringify({ event: 'connected', data: { message: 'pac-memory live feed' }, ts: new Date().toISOString() }))

    socket.on('close', () => {
      activeClients.delete(socket)
      log.debug('WebSocket client disconnected')
    })
  })

  // Wire orchestrator events → WS broadcast
  orchestratorEvents.on('agent', (data) => broadcast('agent', data))
  orchestratorEvents.on('evolution', (data) => broadcast('evolution', data))

  // API routes
  await app.register(knowledgeRoutes, { prefix: '/api' })
  await app.register(agentRoutes, { prefix: '/api' })
  await app.register(evolutionRoutes, { prefix: '/api' })
  await app.register(intelligenceRoutes, { prefix: '/api' })
  await app.register(controlRoutes, { prefix: '/api' })

  await app.listen({ port: cfg.port, host: cfg.host })
  log.info({ host: cfg.host, port: cfg.port }, `Web dashboard: http://${cfg.host}:${cfg.port}`)
  return app
}
