import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForPool = globalThis as unknown as { __fnPool?: Pool }

export const pool =
  globalForPool.__fnPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })

if (process.env.NODE_ENV !== 'production') globalForPool.__fnPool = pool

export const db = drizzle(pool, { schema })
