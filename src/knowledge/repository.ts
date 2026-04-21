import type { Knowledge, KnowledgeInput, AgentRun, EvolutionLog } from '../shared/types.js'
import { getDb } from './database.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('repository')

export function upsertKnowledge(item: KnowledgeInput): number {
  const db = getDb()
  const existing = db.prepare(
    'SELECT id FROM knowledge WHERE title = ? AND source = ?'
  ).get(item.title, item.source) as { id: number } | undefined

  if (existing) {
    db.prepare(`
      UPDATE knowledge SET content=?, summary=?, category=?, metadata=?, importance_score=?, updated_at=datetime('now')
      WHERE id=?
    `).run(item.content, item.summary ?? '', item.category, JSON.stringify(item.metadata), item.importance_score, existing.id)
    return existing.id
  }

  const result = db.prepare(`
    INSERT INTO knowledge (title, content, summary, category, source, metadata, importance_score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(item.title, item.content, item.summary ?? '', item.category, item.source, JSON.stringify(item.metadata), item.importance_score)

  return result.lastInsertRowid as number
}

export function bulkUpsert(items: KnowledgeInput[]): number {
  const db = getDb()
  const tx = db.transaction(() => items.forEach(upsertKnowledge))
  tx()
  log.debug({ count: items.length }, 'Bulk upsert complete')
  return items.length
}

export function searchKnowledge(query: string, limit = 20): Knowledge[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT k.* FROM knowledge k
    JOIN knowledge_fts ON knowledge_fts.rowid = k.id
    WHERE knowledge_fts MATCH ?
    ORDER BY bm25(knowledge_fts)
    LIMIT ?
  `).all(query, limit) as (Omit<Knowledge, 'metadata'> & { metadata: string })[]

  return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }))
}

export function getKnowledgeById(id: number): Knowledge | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM knowledge WHERE id=?').get(id) as (Omit<Knowledge, 'metadata'> & { metadata: string }) | undefined
  if (!row) return undefined
  return { ...row, metadata: JSON.parse(row.metadata) }
}

export function listKnowledge(category?: string, limit = 50, offset = 0): Knowledge[] {
  const db = getDb()
  const rows = category
    ? db.prepare('SELECT * FROM knowledge WHERE category=? ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(category, limit, offset)
    : db.prepare('SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset)

  return (rows as (Omit<Knowledge, 'metadata'> & { metadata: string })[])
    .map(r => ({ ...r, metadata: JSON.parse(r.metadata) }))
}

export function countKnowledge(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as { count: number }
  return row.count
}

export function listCategories(): { category: string; count: number; avg_importance: number; latest_update: string }[] {
  const db = getDb()
  return db.prepare(`
    SELECT category, COUNT(*) as count, AVG(importance_score) as avg_importance, MAX(updated_at) as latest_update
    FROM knowledge
    GROUP BY category
    ORDER BY count DESC, category ASC
  `).all() as { category: string; count: number; avg_importance: number; latest_update: string }[]
}

export function listSources(): { source: string; count: number; latest_update: string }[] {
  const db = getDb()
  return db.prepare(`
    SELECT source, COUNT(*) as count, MAX(updated_at) as latest_update
    FROM knowledge
    GROUP BY source
    ORDER BY count DESC, source ASC
  `).all() as { source: string; count: number; latest_update: string }[]
}

export function startAgentRun(agentName: string): number {
  const db = getDb()
  const result = db.prepare(
    "INSERT INTO agent_runs (agent_name, status) VALUES (?, 'running')"
  ).run(agentName)
  return result.lastInsertRowid as number
}

export function finishAgentRun(runId: number, itemsCollected: number, error?: string) {
  const db = getDb()
  db.prepare(`
    UPDATE agent_runs SET status=?, items_collected=?, error=?, finished_at=datetime('now') WHERE id=?
  `).run(error ? 'failed' : 'completed', itemsCollected, error ?? null, runId)
}

export function listAgentRuns(limit = 10): AgentRun[] {
  const db = getDb()
  return db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?').all(limit) as AgentRun[]
}

export function insertEvolutionLog(entry: Omit<EvolutionLog, 'id' | 'created_at'>): number {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO evolution_log (trigger_reason, generated_file, status, gemini_prompt)
    VALUES (?, ?, ?, ?)
  `).run(entry.trigger_reason, entry.generated_file, entry.status, entry.gemini_prompt)
  return result.lastInsertRowid as number
}

export function updateEvolutionStatus(id: number, status: EvolutionLog['status'], file?: string) {
  const db = getDb()
  if (file) {
    db.prepare('UPDATE evolution_log SET status=?, generated_file=? WHERE id=?').run(status, file, id)
  } else {
    db.prepare('UPDATE evolution_log SET status=? WHERE id=?').run(status, id)
  }
}

export function listEvolutionLog(limit = 20): EvolutionLog[] {
  const db = getDb()
  return db.prepare('SELECT * FROM evolution_log ORDER BY created_at DESC LIMIT ?').all(limit) as EvolutionLog[]
}
