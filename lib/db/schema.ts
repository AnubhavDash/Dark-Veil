import { bigint, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

/** Locally-enrolled faces: 128-d descriptors matched by Euclidean distance. */
export const enrollments = pgTable('enrollments', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  links: jsonb('links').$type<string[]>().notNull().default([]),
  descriptor: jsonb('descriptor').$type<number[]>().notNull(),
  thumb: text('thumb'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Public proof registry: every record anchored to Sepolia. */
export const anchors = pgTable('anchors', {
  id: serial('id').primaryKey(),
  txHash: text('tx_hash').notNull().unique(),
  recordHash: text('record_hash').notNull(),
  record: jsonb('record').$type<Record<string, unknown>>().notNull(),
  identity: text('identity').notNull(),
  matchUrl: text('match_url'),
  fromAddress: text('from_address').notNull(),
  blockNumber: bigint('block_number', { mode: 'number' }),
  network: text('network').notNull().default('sepolia'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Short-lived public hosting for face crops so Google Lens can fetch them by URL. */
export const lensImages = pgTable('lens_images', {
  imageHash: text('image_hash').primaryKey(),
  mime: text('mime').notNull().default('image/jpeg'),
  data: text('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Gemini / Lens result cache keyed by sha256 of the query image. */
export const searchCache = pgTable('search_cache', {
  imageHash: text('image_hash').primaryKey(),
  provider: text('provider').notNull().default('gemini'),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
