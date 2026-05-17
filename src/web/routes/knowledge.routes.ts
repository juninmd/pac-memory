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
} from '../../knowledge/repository.js'
import { semanticSearch } from '../../knowledge/embedder.js'
import { generateTextWithRetry } from '../../llm/client.js'
import { childLogger } from '../../shared/logger.js'
import type { Knowledge } from '../../shared/types.js'

const log = childLogger('knowledge-routes')

function sanitizeQuery(raw: string): string {
  return raw.replace(/['"*:()^~]/g, ' ').trim()
}

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/knowledge', async (req, reply) => {
    const { category, limit = '50', offset = '0', sort = 'updated' } = req.query as Record<string, string>
    const lim = Math.min(Math.max(1, Number(limit)), 200)
    const off = Math.max(0, Number(offset))
    const items = listKnowledge(category || undefined, lim, off)
    const total = countKnowledge()
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

    const patch = req.body as Record<string, unknown>
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
    const { query, limit = 20, offset = 0, mode } = req.body as { query: string; limit?: number; offset?: number; mode?: string }
    if (!query || typeof query !== 'string') {
      return reply.status(400).send({ error: 'query é obrigatória' })
    }
    if (query.length > 500) {
      return reply.status(400).send({ error: 'query deve ter menos de 500 caracteres' })
    }
    const safeQuery = sanitizeQuery(query)
    if (!safeQuery) return reply.send({ items: [], total: 0, query: '' })
    const lim = Math.min(Math.max(1, Number(limit)), 100)
    const off = Math.max(0, Number(offset))

    if (mode === 'hybrid') {
      const ftsResult = searchKnowledgePaginated(safeQuery, lim, off)
      let semanticItems: (Knowledge & { similarity: number })[] = []
      try {
        semanticItems = await semanticSearch(safeQuery, lim)
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

      return reply.send({ items: merged.slice(0, lim), total: merged.length, query: safeQuery, mode: 'hybrid' })
    }

    const result = searchKnowledgePaginated(safeQuery, lim, off)
    return reply.send({ ...result, query: safeQuery })
  })

  app.post('/search/semantic', async (req, reply) => {
    const { query, limit = 10 } = req.body as { query: string; limit?: number }
    if (!query || typeof query !== 'string') {
      return reply.status(400).send({ error: 'query é obrigatória' })
    }
    if (query.length > 500) {
      return reply.status(400).send({ error: 'query deve ter menos de 500 caracteres' })
    }
    const safeQuery = sanitizeQuery(query)
    if (!safeQuery) return reply.send({ items: [], query: '' })
    const lim = Math.min(Math.max(1, Number(limit)), 50)
    try {
      const items = await semanticSearch(safeQuery, lim)
      return reply.send({ items, query: safeQuery })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(503).send({ error: 'Embedding model unavailable', detail: message, code: 'LLM_UNAVAILABLE' })
    }
  })

  app.post('/qa', async (req, reply) => {
    const { question, limit = 5 } = req.body as { question: string; limit?: number }
    if (!question || typeof question !== 'string') {
      return reply.status(400).send({ error: 'question é obrigatória' })
    }
    if (question.length > 500) {
      return reply.status(400).send({ error: 'question deve ter menos de 500 caracteres' })
    }

    const safeQuestion = sanitizeQuery(question)
    if (!safeQuestion) return reply.send({ answer: 'Nenhuma pergunta válida enviada.', sources: [] })

    const results = searchKnowledge(safeQuestion, Math.min(Number(limit), 10))
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
