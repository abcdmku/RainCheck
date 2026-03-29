import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolveWorkspacePath } from '../lib/paths'
import {
  conversationsTable,
  messagesTable,
  providerCredentialsTable,
  settingsTable,
} from './schema'

export type RainCheckDb = ReturnType<typeof createDb>['db']

function resolveDbPath(dbUrl: string) {
  if (dbUrl === ':memory:' || dbUrl.startsWith('file:')) {
    return dbUrl
  }

  return resolveWorkspacePath(dbUrl)
}

export function createDb(dbUrl: string) {
  const resolvedDbUrl = resolveDbPath(dbUrl)

  if (resolvedDbUrl !== ':memory:' && !resolvedDbUrl.startsWith('file:')) {
    fs.mkdirSync(path.dirname(resolvedDbUrl), {
      recursive: true,
    })
  }

  const sqlite = new Database(resolvedDbUrl)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      artifacts_json TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      transport TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_credentials (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'api-key',
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  // Migrations for existing databases
  try {
    sqlite.exec(
      `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    )
  } catch {
    // Column already exists — ignore
  }

  try {
    sqlite.exec(
      `ALTER TABLE provider_credentials ADD COLUMN mode TEXT NOT NULL DEFAULT 'api-key'`,
    )
  } catch {
    // Column already exists â€” ignore
  }

  try {
    sqlite.exec(`ALTER TABLE provider_credentials ADD COLUMN model TEXT`)
  } catch {
    // Column already exists â€” ignore
  }

  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN transport TEXT`)
  } catch {
    // Column already exists — ignore
  }

  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN source TEXT`)
  } catch {
    // Column already exists — ignore
  }

  return {
    sqlite,
    db: drizzle(sqlite, {
      schema: {
        conversationsTable,
        messagesTable,
        settingsTable,
        providerCredentialsTable,
      },
    }),
  }
}
