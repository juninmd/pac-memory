import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { DDL } from './schema.js'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'

const log = childLogger('database')

let instance: Database.Database | null = null

export function getDb(): Database.Database {
  if (instance) return instance

  mkdirSync(dirname(cfg.dbPath), { recursive: true })

  const db = new Database(cfg.dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  db.exec(DDL)

  log.info({ path: cfg.dbPath }, 'SQLite connected')
  instance = db
  return db
}

export function closeDb() {
  instance?.close()
  instance = null
  log.info('SQLite closed')
}
