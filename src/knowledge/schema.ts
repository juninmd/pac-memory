export const DDL = `
CREATE TABLE IF NOT EXISTS knowledge (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT 'uncategorized',
  source          TEXT    NOT NULL,
  metadata        TEXT    NOT NULL DEFAULT '{}',
  importance_score REAL   NOT NULL DEFAULT 0.5,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title, content,
  content='knowledge',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO knowledge_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TABLE IF NOT EXISTS sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  type         TEXT    NOT NULL,
  url          TEXT,
  config       TEXT    NOT NULL DEFAULT '{}',
  last_checked TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS evolution_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_reason  TEXT NOT NULL,
  generated_file  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  gemini_prompt   TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  items_collected INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);
`
