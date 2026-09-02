#!/usr/bin/env node
/**
 * Create the four tables Dark Veil needs, idempotently.
 *
 *   npm run db:setup
 *
 * Reads DATABASE_URL from the environment, falling back to .env.local — the same value
 * Next.js uses at runtime. Every statement is IF NOT EXISTS, so re-running is a no-op.
 */
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'

const DDL = [
  [
    'enrollments',
    `CREATE TABLE IF NOT EXISTS enrollments (
       id          serial PRIMARY KEY,
       name        text NOT NULL,
       links       jsonb NOT NULL DEFAULT '[]'::jsonb,
       descriptor  jsonb NOT NULL,
       thumb       text,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
  ],
  [
    'anchors',
    `CREATE TABLE IF NOT EXISTS anchors (
       id            serial PRIMARY KEY,
       tx_hash       text NOT NULL UNIQUE,
       record_hash   text NOT NULL,
       record        jsonb NOT NULL,
       identity      text NOT NULL,
       match_url     text,
       from_address  text NOT NULL,
       block_number  bigint,
       network       text NOT NULL DEFAULT 'sepolia',
       created_at    timestamptz NOT NULL DEFAULT now()
     )`,
  ],
  [
    'lens_images',
    `CREATE TABLE IF NOT EXISTS lens_images (
       image_hash  text PRIMARY KEY,
       mime        text NOT NULL DEFAULT 'image/jpeg',
       data        text NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
  ],
  [
    'search_cache',
    `CREATE TABLE IF NOT EXISTS search_cache (
       image_hash  text PRIMARY KEY,
       provider    text NOT NULL DEFAULT 'google_lens',
       result      jsonb NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
  ],
]

/** Minimal .env parser — enough for KEY=value, ignoring comments and quotes. */
function envFromFile(path) {
  try {
    const out = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

const fileEnv = envFromFile(new URL('../.env.local', import.meta.url))
const connectionString = process.env.DATABASE_URL?.trim() || fileEnv.DATABASE_URL?.trim()

if (!connectionString) {
  console.error('\n  DATABASE_URL is not set.\n')
  console.error('  Put a Postgres connection string in .env.local, then re-run:\n')
  console.error('    DATABASE_URL=postgres://user:pass@host/db?sslmode=require\n')
  console.error('  Neon: dashboard → your project → Connection Details → Pooled connection.\n')
  process.exit(1)
}

const pool = new Pool({ connectionString, max: 1 })

try {
  const { rows } = await pool.query('SELECT current_database() AS db, version() AS version')
  const server = rows[0].version.split(' ').slice(0, 2).join(' ')
  console.log(`\n  connected to "${rows[0].db}" (${server})\n`)

  for (const [name, sql] of DDL) {
    await pool.query(sql)
    const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM ${name}`)
    console.log(`  ready  ${name.padEnd(13)} ${count[0].n} row${count[0].n === 1 ? '' : 's'}`)
  }

  console.log('\n  all four tables are in place.\n')
} catch (err) {
  console.error(`\n  failed: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
