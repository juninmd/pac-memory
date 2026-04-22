import type { FastifyReply, FastifyRequest } from 'fastify'
import { cfg } from '../shared/config.js'

export async function requireControlToken(req: FastifyRequest, reply: FastifyReply) {
  if (!cfg.controlApiToken) return

  const header = req.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const explicit = typeof req.headers['x-pac-memory-token'] === 'string'
    ? req.headers['x-pac-memory-token']
    : ''

  if (bearer === cfg.controlApiToken || explicit === cfg.controlApiToken) {
    return
  }

  return reply.status(401).send({ error: 'missing or invalid control token' })
}
