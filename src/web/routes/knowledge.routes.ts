import type { FastifyInstance } from 'fastify'
import {
  searchKnowledge,
  searchKnowledgePaginated,
  listKnowledge,
  countKnowledge,
  getKnowledgeById,
  deleteKnowledge,
  countKnowledgeByCategory,
  listCategories,
  updateKnowledge,
  ftsMatchingIds,
} from '../../knowledge/repository.js'
import { semanticSearch } from '../../knowledge/embedder.js'
import { generateTextWithRetry } from '../../llm/client.js'
import { childLogger } from '../../shared/logger.js'
import { bodyObject, boundedInt } from '../query-params.js'
import type { Knowledge } from '../../shared/types.js'

const log = childLogger('knowledge-routes')

const BODY_ERROR = { error: 'corpo deve ser um objeto JSON' }

function sanitizeQuery(raw: string): string {
  return raw.replace(/['"*:()^~]/g, ' ').trim()
}

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/knowledge', async (req, reply) => {
    const { category, limit, offset, sort = 'updated' } = req.query as Record<string, string>
    const lim = boundedInt(limit, 50, 1, 200)
    const off = boundedInt(offset, 0, 0, Number.MAX_SAFE_INTEGER)
    const items = listKnowledge(category || undefined, lim, off)
    // total must follow the filter, otherwise pagination over a category never ends where the list does
    const total = countKnowledge(category || undefined)
    return reply.send({ items, total, limit: lim, offset: off, sort })
  })

  app.get('/knowledge/stats', async (_req, reply) => {
    const total = countKnowledge()
    const byCategory = countKnowledgeByCategory()
    return reply.send({ total, byCategory })
  })

  app.get('/knowledge/categories', async (_req, reply) => {
    return reply.send({ categories: listCategories() })
  })

  app.get('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id deve ser um inteiro positivo' })
    }
    const item = getKnowledgeById(numericId)
    if (!item) return reply.status(404).send({ error: `Conhecimento #${id} não encontrado` })
    return reply.send({ item })
  })

  app.patch('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id deve ser um inteiro positivo' })
    }
    const existing = getKnowledgeById(numericId)
    if (!existing) return reply.status(404).send({ error: `Conhecimento #${id} não encontrado` })

    const patch = bodyObject(req.body)
    if (!patch) return reply.status(400).send(BODY_ERROR)
    const allowed = ['title', 'content', 'summary', 'category', 'importance_score', 'metadata']
    const filtered: Record<string, unknown> = {}
    for (const key of allowed) {
      if (patch[key] !== undefined) filtered[key] = patch[key]
    }

    if (Object.keys(filtered).length === 0) {
      return reply.status(400).send({ error: 'Nenhum campo válido fornecido para atualização' })
    }

    if (filtered.title !== undefined && typeof filtered.title !== 'string') {
      return reply.status(400).send({ error: 'title deve ser string' })
    }
    if (filtered.content !== undefined && typeof filtered.content !== 'string') {
      return reply.status(400).send({ error: 'content deve ser string' })
    }
    if (filtered.category !== undefined && typeof filtered.category !== 'string') {
      return reply.status(400).send({ error: 'category deve ser string' })
    }
    if (filtered.summary !== undefined && typeof filtered.summary !== 'string') {
      return reply.status(400).send({ error: 'summary deve ser string' })
    }
    if (filtered.importance_score !== undefined && typeof filtered.importance_score !== 'number') {
      return reply.status(400).send({ error: 'importance_score deve ser número' })
    }

    try {
      updateKnowledge(numericId, filtered as Parameters<typeof updateKnowledge>[1])
      const updated = getKnowledgeById(numericId)
      log.info({ id: numericId, fields: Object.keys(filtered) }, 'Knowledge entry updated')
      return reply.send({ item: updated })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar'
      return reply.status(500).send({ error: msg })
    }
  })

  app.delete('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const numericId = Number(id)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return reply.status(400).send({ error: 'id deve ser um inteiro positivo' })
    }
    const deleted = deleteKnowledge(numericId)
    if (!deleted) return reply.status(404).send({ error: `Conhecimento #${id} não encontrado` })
    log.info({ id: numericId }, 'Knowledge entry deleted')
    return reply.send({ deleted: true, id: numericId })
  })

  app.post('/search', async (req, reply) => {
    const body = bodyObject(req.body)
    if (!body) return reply.status(400).send(BODY_ERROR)
    const { query, limit = 20, offset = 0, mode } = body as { query: unknown; limit?: unknown; offset?: unknown; mode?: unknown }
    if (!query || typeof query !== 'string') {
      return reply.status(400).send({ error: 'query é obrigatória' })
    }
    if (query.length > 500) {
      return reply.status(400).send({ error: 'query deve ter menos de 500 caracteres' })
    }
    const safeQuery = sanitizeQuery(query)
    if (!safeQuery) return reply.send({ items: [], total: 0, query: '' })
    const lim = boundedInt(limit, 20, 1, 100)
    const off = boundedInt(offset, 0, 0, Number.MAX_SAFE_INTEGER)

    if (mode === 'hybrid') {
      // rank the first off+lim of both sources and slice, so later pages neither repeat semantic hits nor skip FTS ones
      const window = off + lim
      const ftsResult = searchKnowledgePaginated(safeQuery, window, 0)
      let semanticItems: (Knowledge & { similarity: number })[] = []
      try {
        semanticItems = await semanticSearch(safeQuery, window)
      } catch {
        // embedding unavailable — proceed with FTS only
      }

      const seen = new Set<number>()
      const merged: (Knowledge & { score: number })[] = []

      for (const item of semanticItems) {
        seen.add(item.id)
        merged.push({ ...item, score: item.similarity * 0.6 + 0.4 })
      }
      for (const item of ftsResult.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id)
          merged.push({ ...item, score: 0.4 })
        }
      }
      merged.sort((a, b) => b.score - a.score)

      // semantic hits that FTS never matches add to the FTS total; the rest are already counted there
      const ftsHits = ftsMatchingIds(safeQuery, semanticItems.map((item) => item.id))
      const total = ftsResult.total + semanticItems.filter((item) => !ftsHits.has(item.id)).length
      return reply.send({ items: merged.slice(off, window), total, query: safeQuery, mode: 'hybrid' })
    }

    const result = searchKnowledgePaginated(safeQuery, lim, off)
    return reply.send({ ...result, query: safeQuery })
  })

  app.post('/search/semantic', async (req, reply) => {
    const body = bodyObject(req.body)
    if (!body) return reply.status(400).send(BODY_ERROR)
    const { query, limit = 10 } = body as { query: unknown; limit?: unknown }
    if (!query || typeof query !== 'string') {
      return reply.status(400).send({ error: 'query é obrigatória' })
    }
    if (query.length > 500) {
      return reply.status(400).send({ error: 'query deve ter menos de 500 caracteres' })
    }
    const safeQuery = sanitizeQuery(query)
    if (!safeQuery) return reply.send({ items: [], query: '' })
    const lim = boundedInt(limit, 10, 1, 50)
    try {
      const items = await semanticSearch(safeQuery, lim)
      return reply.send({ items, query: safeQuery })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(503).send({ error: 'Embedding model unavailable', detail: message, code: 'LLM_UNAVAILABLE' })
    }
  })

  app.post('/qa', async (req, reply) => {
    const body = bodyObject(req.body)
    if (!body) return reply.status(400).send(BODY_ERROR)
    const { question, limit = 5 } = body as { question: unknown; limit?: unknown }
    if (!question || typeof question !== 'string') {
      return reply.status(400).send({ error: 'question é obrigatória' })
    }
    if (question.length > 500) {
      return reply.status(400).send({ error: 'question deve ter menos de 500 caracteres' })
    }

    const safeQuestion = sanitizeQuery(question)
    if (!safeQuestion) return reply.send({ answer: 'Nenhuma pergunta válida enviada.', sources: [] })

    const results = searchKnowledge(safeQuestion, boundedInt(limit, 5, 1, 10))
    if (!results.length) {
      return reply.send({ answer: 'Nenhum conhecimento relevante encontrado para essa pergunta.', sources: [], llmUsed: false })
    }

    const sourceText = results
      .map((item, index) => `Fonte ${index + 1}: [${item.category}] ${item.title}\n${item.content}`)
      .join('\n\n')

    const prompt = `Você é um assistente técnico que responde usando apenas os dados coletados pelo sistema PAC-MEMORY. Não invente fatos.\n\nDados de contexto:\n${sourceText}\n\nPergunta: ${safeQuestion}\n\nResposta:`

    try {
      const response = await generateTextWithRetry(prompt, 2)
      return reply.send({
        answer: response.content.trim(),
        sources: results.map((item) => ({ id: item.id, title: item.title, category: item.category, source: item.source })),
        llmUsed: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao chamar Ollama.'
      log.warn({ err, question: safeQuestion }, 'QA LLM failed, falling back to local sources')

      const isLlmUnavailable = message.includes('LiteLLM') || message.includes('Ollama') ||
        message.includes('timed out') || message.includes('abort') || message.includes('ECONNREFUSED') ||
        message.includes('Circuit breaker')

      if (isLlmUnavailable) {
        const fallbackText = results
          .map((item, i) => `[${i + 1}] ${item.title}\n${item.content.slice(0, 400)}`)
          .join('\n\n')
        return reply.send({
          answer: fallbackText,
          sources: results.map((item) => ({ id: item.id, title: item.title, category: item.category, source: item.source })),
          warning: 'LLM indisponível — resposta baseada em fontes locais sem processamento.',
          llmUsed: false,
        })
      }

      log.error({ err, question: safeQuestion }, 'QA request failed with unexpected error')
      return reply.status(500).send({ error: `Erro ao processar pergunta: ${message}` })
    }
  })
}
