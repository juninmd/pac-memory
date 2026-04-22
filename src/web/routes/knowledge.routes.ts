import type { FastifyInstance } from 'fastify'
import { searchKnowledge, listKnowledge, countKnowledge } from '../../knowledge/repository.js'
import { generateText } from '../../llm/client.js'
import { childLogger } from '../../shared/logger.js'

const log = childLogger('knowledge-routes')

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/knowledge', async (req, reply) => {
    const { category, limit = '50', offset = '0' } = req.query as Record<string, string>
    const items = listKnowledge(category, Number(limit), Number(offset))
    const total = countKnowledge()
    return reply.send({ items, total, limit: Number(limit), offset: Number(offset) })
  })

  app.post('/search', async (req, reply) => {
    const { query, limit = 20 } = req.body as { query: string; limit?: number }
    if (!query || typeof query !== 'string' || query.length > 500) {
      return reply.status(400).send({ error: 'query must be a non-empty string under 500 chars' })
    }
    const safeQuery = query.replace(/['"*:()^~]/g, ' ').trim()
    if (!safeQuery) return reply.send({ items: [] })
    const items = searchKnowledge(safeQuery, Number(limit))
    return reply.send({ items, query: safeQuery })
  })

  app.post('/qa', async (req, reply) => {
    const { question, limit = 5 } = req.body as { question: string; limit?: number }
    if (!question || typeof question !== 'string' || question.length > 500) {
      return reply.status(400).send({ error: 'question must be a non-empty string under 500 chars' })
    }

    const safeQuestion = question.replace(/['"*:()^~]/g, ' ').trim()
    if (!safeQuestion) return reply.send({ answer: 'Nenhuma pergunta válida enviada.', sources: [] })

    const results = searchKnowledge(safeQuestion, Number(limit))
    if (!results.length) {
      return reply.send({ answer: 'Nenhum conhecimento relevante encontrado para essa pergunta.', sources: [] })
    }

    const sourceText = results
      .map((item, index) => `Fonte ${index + 1}: [${item.category}] ${item.title}\n${item.content}`)
      .join('\n\n')

    const prompt = `Você é um assistente técnico que responde usando apenas os dados coletados pelo sistema PAC-MEMORY. Não invente fatos.\n\nDados de contexto:\n${sourceText}\n\nPergunta: ${safeQuestion}\n\nResposta:`

    try {
      const response = await generateText(prompt)
      return reply.send({
        answer: response.content.trim(),
        sources: results.map((item) => ({ title: item.title, category: item.category, source: item.source })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao chamar Ollama.'
      log.error({ err, question: safeQuestion }, 'QA request failed')

      const fallbackSources = results
        .map((item, index) => `Fonte ${index + 1}: [${item.category}] ${item.title}\n${item.content}`)
        .join('\n\n')

      if (message.includes('LiteLLM') || message.includes('Ollama') || message.includes('timed out') || message.includes('abort')) {
        return reply.send({
          answer: `Não foi possível usar o LLM configurado. Resposta baseada nas fontes locais:\n\n${fallbackSources}`,
          sources: results.map((item) => ({ title: item.title, category: item.category, source: item.source })),
          warning: message,
        })
      }

      return reply.status(500).send({ error: message })
    }
  })

  app.get('/knowledge/stats', async (_req, reply) => {
    const total = countKnowledge()
    return reply.send({ total })
  })
}
