import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getDb } from '../knowledge/database.js'
import {
  searchKnowledge,
  getKnowledgeById,
  listKnowledge,
  listCategories,
  countKnowledge,
} from '../knowledge/repository.js'
import { findRelatedKnowledge } from '../knowledge/insights.js'
import { semanticSearch } from '../knowledge/embedder.js'
import { generateTextWithRetry } from '../llm/client.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('mcp')

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'pac-memory',
    version: '1.0.0',
  })

  // ── search_knowledge ──────────────────────────────────────────────────────

  server.registerTool('search_knowledge', {
    title:       'Search Knowledge Base',
    description: 'Full-text search through the PAC-MEMORY knowledge base. Returns relevant entries ranked by relevance.',
    inputSchema: z.object({
      query:    z.string().describe('Search query'),
      limit:    z.number().int().min(1).max(50).default(10).describe('Max results'),
      category: z.string().optional().describe('Filter by category (e.g. ai-ml, devops, security)'),
    }),
  }, async ({ query, limit, category }) => {
    const results = searchKnowledge(query, limit)
    const filtered = category ? results.filter(r => r.category === category) : results
    return {
      content: [{
        type:  'text',
        text:  JSON.stringify({
          total:   filtered.length,
          results: filtered.map(r => ({
            id:               r.id,
            title:            r.title,
            category:         r.category,
            source:           r.source,
            summary:          r.summary || r.content.slice(0, 300),
            importance_score: r.importance_score,
            updated_at:       r.updated_at,
          })),
        }, null, 2),
      }],
    }
  })

  // ── semantic_search ───────────────────────────────────────────────────────

  server.registerTool('semantic_search', {
    title:       'Semantic Knowledge Search',
    description: 'Finds knowledge entries semantically similar to the query using vector embeddings. More accurate than keyword search for conceptual queries.',
    inputSchema: z.object({
      query: z.string().describe('Natural language query'),
      limit: z.number().int().min(1).max(30).default(8).describe('Max results'),
    }),
  }, async ({ query, limit }) => {
    try {
      const results = await semanticSearch(query, limit)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total:   results.length,
            results: results.map(r => ({
              id:         r.id,
              title:      r.title,
              category:   r.category,
              source:     r.source,
              summary:    r.summary || r.content.slice(0, 300),
              similarity: Math.round(r.similarity * 1000) / 1000,
              updated_at: r.updated_at,
            })),
          }, null, 2),
        }],
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Semantic search failed: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  })

  // ── get_knowledge ─────────────────────────────────────────────────────────

  server.registerTool('get_knowledge', {
    title:       'Get Knowledge Entry',
    description: 'Retrieve a specific knowledge entry by its ID including full content.',
    inputSchema: z.object({
      id: z.number().int().positive().describe('Knowledge entry ID'),
    }),
  }, ({ id }) => {
    const entry = getKnowledgeById(id)
    if (!entry) {
      return {
        isError: true,
        content: [{ type: 'text', text: `No knowledge entry found with id=${id}` }],
      }
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(entry, null, 2),
      }],
    }
  })

  // ── get_related ───────────────────────────────────────────────────────────

  server.registerTool('get_related', {
    title:       'Get Related Knowledge',
    description: 'Find knowledge entries related to a given entry using embeddings (if available) and FTS fallback.',
    inputSchema: z.object({
      id:    z.number().int().positive().describe('Knowledge entry ID to find relations for'),
      limit: z.number().int().min(1).max(20).default(6).describe('Max related entries'),
    }),
  }, async ({ id, limit }) => {
    const related = await findRelatedKnowledge(id, limit)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          for_id:  id,
          total:   related.length,
          related: related.map(r => ({
            id:               r.id,
            title:            r.title,
            category:         r.category,
            summary:          r.summary || r.content.slice(0, 300),
            importance_score: r.importance_score,
          })),
        }, null, 2),
      }],
    }
  })

  // ── qa ────────────────────────────────────────────────────────────────────

  server.registerTool('qa', {
    title:       'Ask the Knowledge Base',
    description: 'Answer a question using the PAC-MEMORY knowledge base with LLM synthesis. Combines FTS search and LLM to produce a grounded answer.',
    inputSchema: z.object({
      question:  z.string().describe('Question to answer'),
      limit:     z.number().int().min(1).max(10).default(5).describe('Max knowledge sources to include'),
      use_semantic: z.boolean().default(false).describe('Use semantic search instead of FTS'),
    }),
  }, async ({ question, limit, use_semantic }) => {
    try {
      const sources = use_semantic
        ? await semanticSearch(question, limit)
        : searchKnowledge(question, limit)

      if (!sources.length) {
        return {
          content: [{ type: 'text', text: 'No relevant knowledge found for this question.' }],
        }
      }

      const context = sources
        .map((s, i) => `[${i + 1}] ${s.title}\n${(s.summary || s.content).slice(0, 600)}`)
        .join('\n\n')

      const prompt = `You are a technical assistant. Answer using ONLY the knowledge below. Do not add information not present in the sources.\n\nKnowledge:\n${context}\n\nQuestion: ${question}\n\nAnswer:`
      const response = await generateTextWithRetry(prompt, 2)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            answer:  response.content.trim(),
            sources: sources.map(s => ({ id: s.id, title: s.title, category: s.category, source: s.source })),
            model:   response.model,
          }, null, 2),
        }],
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `QA failed: ${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  })

  // ── list_knowledge ────────────────────────────────────────────────────────

  server.registerTool('list_knowledge', {
    title:       'List Knowledge Entries',
    description: 'List knowledge entries, optionally filtered by category.',
    inputSchema: z.object({
      category: z.string().optional().describe('Category filter'),
      limit:    z.number().int().min(1).max(100).default(20).describe('Max results'),
      offset:   z.number().int().min(0).default(0).describe('Pagination offset'),
    }),
  }, ({ category, limit, offset }) => {
    const items = listKnowledge(category, limit, offset)
    const total = countKnowledge()
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total,
          returned: items.length,
          items: items.map(r => ({
            id:               r.id,
            title:            r.title,
            category:         r.category,
            source:           r.source,
            importance_score: r.importance_score,
            updated_at:       r.updated_at,
          })),
        }, null, 2),
      }],
    }
  })

  // ── get_categories ────────────────────────────────────────────────────────

  server.registerTool('get_categories', {
    title:       'Get Knowledge Categories',
    description: 'List all knowledge categories with entry counts and average importance scores.',
    inputSchema: z.object({}),
  }, () => {
    const categories = listCategories()
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ categories }, null, 2),
      }],
    }
  })

  return server
}

export async function startMcpServer(): Promise<void> {
  log.info('Starting PAC-MEMORY MCP server (stdio)')
  getDb()

  const server    = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)

  log.info('MCP server connected and listening via stdio')

  process.on('SIGINT', async () => {
    await server.close()
    process.exit(0)
  })
}
