import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForPool = globalThis as unknown as { __fnPool?: Pool }

/**
 * `new Pool()` does not connect, so an absent DATABASE_URL is not an error here —
 * it becomes one on the first query, where pg falls back to its own defaults and
 * reports a local-socket failure that names nothing useful. Checking at module
 * scope instead would fail the build, since pages importing this are prerendered.
 * So the check is deferred to the moment a query is about to run, matching how
 * `lib/chain.ts` names its variables from inside its getters.
 */
function assertDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it in Project Settings → Vars.')
  }
}

const basePool =
  globalForPool.__fnPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })

if (process.env.NODE_ENV !== 'production') globalForPool.__fnPool = basePool

export const pool = new Proxy(basePool, {
  get(target, prop, receiver) {
    if (prop === 'query' || prop === 'connect') assertDatabaseUrl()
    return Reflect.get(target, prop, receiver)
  },
})

export const db = drizzle(pool, { schema })

/**
 * Drizzle wraps every driver failure in a DrizzleQueryError whose own message is
 * the SQL that failed, so the actual reason — including the notice above — is
 * only reachable through the cause chain. Route handlers use this so a
 * deployment missing its variables says which one rather than printing a query.
 */
export function dbErrorMessage(err: unknown, fallback: string): string {
  let cur: unknown = err
  while (cur instanceof Error) {
    if (cur.message.includes('is not set.')) return cur.message
    cur = cur.cause
  }
  return fallback
}
