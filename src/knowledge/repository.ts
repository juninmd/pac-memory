import type { AgentRun, EvolutionLog, Knowledge, KnowledgeInput, Source, SourceInput } from '../shared/types.js'
import { getDb } from './database.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('repository')

function safeJsonParse(raw: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return fallback }
}

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

  return rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata) }))
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
    .map(r => ({ ...r, metadata: safeJsonParse(r.metadata) }))
}

export function listKnowledgeBySource(source: string, limit = 200): Knowledge[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM knowledge
    WHERE source=?
    ORDER BY
      COALESCE(json_extract(metadata, '$.published'), json_extract(metadata, '$.updated'), updated_at) DESC,
      title ASC
    LIMIT ?
  `).all(source, limit) as (Omit<Knowledge, 'metadata'> & { metadata: string })[]

  return rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata) }))
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

export function listConfiguredSources(type?: Source['type']): Source[] {
  const db = getDb()
  const rows = type
    ? db.prepare('SELECT * FROM sources WHERE type=? ORDER BY name ASC').all(type)
    : db.prepare('SELECT * FROM sources ORDER BY type ASC, name ASC').all()

  return (rows as (Omit<Source, 'config' | 'is_active'> & { config: string; is_active: number })[])
    .map((row) => ({
      ...row,
      config: safeJsonParse(row.config),
      is_active: row.is_active === 1,
    }))
}

export function listActiveRssSources(): Source[] {
  return listConfiguredSources('rss').filter((source) => source.is_active && source.url)
}

export function createSource(source: SourceInput): number {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO sources (name, type, url, config, last_checked, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    source.name,
    source.type,
    source.url ?? null,
    JSON.stringify(source.config),
    source.last_checked ?? null,
    source.is_active ? 1 : 0
  )
  return result.lastInsertRowid as number
}

export function updateSource(id: number, patch: Partial<SourceInput>) {
  const current = listConfiguredSources().find((source) => source.id === id)
  if (!current) {
    throw new Error(`Source not found: ${id}`)
  }

  const next = { ...current, ...patch }
  const db = getDb()
  db.prepare(`
    UPDATE sources
    SET name=?, type=?, url=?, config=?, last_checked=?, is_active=?
    WHERE id=?
  `).run(
    next.name,
    next.type,
    next.url ?? null,
    JSON.stringify(next.config),
    next.last_checked ?? null,
    next.is_active ? 1 : 0,
    id
  )
}

export function deleteSource(id: number) {
  const db = getDb()
  db.prepare('DELETE FROM sources WHERE id=?').run(id)
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

export function deleteKnowledge(id: number): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM knowledge WHERE id=?').run(id)
  return result.changes > 0
}

export function countKnowledgeByCategory(): { category: string; count: number }[] {
  const db = getDb()
  return db.prepare('SELECT category, COUNT(*) as count FROM knowledge GROUP BY category ORDER BY count DESC').all() as { category: string; count: number }[]
}

export function searchKnowledgePaginated(query: string, limit = 20, offset = 0): { items: Knowledge[]; total: number } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT k.* FROM knowledge k
    JOIN knowledge_fts ON knowledge_fts.rowid = k.id
    WHERE knowledge_fts MATCH ?
    ORDER BY bm25(knowledge_fts)
    LIMIT ? OFFSET ?
  `).all(query, limit, offset) as (Omit<Knowledge, 'metadata'> & { metadata: string })[]

  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM knowledge k
    JOIN knowledge_fts ON knowledge_fts.rowid = k.id
    WHERE knowledge_fts MATCH ?
  `).get(query) as { count: number }

  return {
    items: rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata) })),
    total: countRow.count,
  }
}

export function updateKnowledge(id: number, patch: Partial<Omit<KnowledgeInput, 'summary'>> & { summary?: string }) {
  const current = getKnowledgeById(id)
  if (!current) throw new Error(`Knowledge entry not found: ${id}`)

  const db = getDb()
  const next = {
    title: patch.title ?? current.title,
    content: patch.content ?? current.content,
    summary: patch.summary ?? current.summary,
    category: patch.category ?? current.category,
    source: patch.source ?? current.source,
    metadata: patch.metadata ? JSON.stringify(patch.metadata) : JSON.stringify(current.metadata),
    importance_score: patch.importance_score ?? current.importance_score,
  }

  db.prepare(`
    UPDATE knowledge
    SET title=?, content=?, summary=?, category=?, source=?, metadata=?, importance_score=?, updated_at=datetime('now')
    WHERE id=?
  `).run(next.title, next.content, next.summary, next.category, next.source, next.metadata, next.importance_score, id)
}

export function getStaleKnowledge(daysOld = 30): Knowledge[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM knowledge
    WHERE updated_at < datetime('now', '-' || ? || ' days')
    ORDER BY updated_at ASC
  `).all(daysOld) as (Omit<Knowledge, 'metadata'> & { metadata: string })[]
  return rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata) }))
}

export function getKnowledgeCountBySource(): { source: string; count: number }[] {
  const db = getDb()
  return db.prepare('SELECT source, COUNT(*) as count FROM knowledge GROUP BY source ORDER BY count DESC').all() as { source: string; count: number }[]
}

export function deleteKnowledgeBulk(ids: number[]): number {
  if (!ids.length) return 0
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const result = db.prepare(`DELETE FROM knowledge WHERE id IN (${placeholders})`).run(...ids)
  return result.changes
}

export function reScoreKnowledge(id: number, score: number): void {
  const db = getDb()
  db.prepare('UPDATE knowledge SET importance_score=?, updated_at=datetime(\'now\') WHERE id=?').run(Math.max(0, Math.min(1, score)), id)
}

export interface MetricsSnapshot {
  id: number
  captured_at: string
  total: number
  avg_importance: number
  stale_count: number
  category_count: number
  source_count: number
  embedded_count: number
}

export function captureMetricsSnapshot(): void {
  const db = getDb()
  const staleThreshold = 14
  const stats = db.transaction(() => {
    const { total } = db.prepare('SELECT COUNT(*) as total FROM knowledge').get() as { total: number }
    const { avg_importance } = db.prepare('SELECT COALESCE(AVG(importance_score), 0) as avg_importance FROM knowledge').get() as { avg_importance: number }
    const { stale_count } = db.prepare(
      `SELECT COUNT(*) as stale_count FROM knowledge WHERE updated_at < datetime('now', '-' || ? || ' days')`
    ).get(staleThreshold) as { stale_count: number }
    const { category_count } = db.prepare('SELECT COUNT(DISTINCT category) as category_count FROM knowledge').get() as { category_count: number }
    const { source_count } = db.prepare('SELECT COUNT(DISTINCT source) as source_count FROM knowledge').get() as { source_count: number }
    const { embedded_count } = db.prepare('SELECT COUNT(*) as embedded_count FROM knowledge_embeddings').get() as { embedded_count: number }
    return { total, avg_importance, stale_count, category_count, source_count, embedded_count }
  })()

  db.prepare(`
    INSERT INTO knowledge_metrics_snapshots (total, avg_importance, stale_count, category_count, source_count, embedded_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(stats.total, stats.avg_importance, stats.stale_count, stats.category_count, stats.source_count, stats.embedded_count)
}

export function getMetricsHistory(days = 30): MetricsSnapshot[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM knowledge_metrics_snapshots
    WHERE captured_at >= datetime('now', '-' || ? || ' days')
    ORDER BY captured_at ASC
  `).all(days) as MetricsSnapshot[]
}
