import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const conversationsTable = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const messagesTable = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversationsTable.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  partsJson: text('parts_json').notNull().default('[]'),
  citationsJson: text('citations_json').notNull().default('[]'),
  artifactsJson: text('artifacts_json').notNull().default('[]'),
  provider: text('provider'),
  model: text('model'),
  transport: text('transport'),
  source: text('source'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const settingsTable = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  settingsJson: text('settings_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const providerCredentialsTable = sqliteTable('provider_credentials', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  mode: text('mode').notNull().default('api-key'),
  model: text('model'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})
