#!/usr/bin/env node
/**
 * Push the five runtime secrets from .env.local into Vercel, for all three
 * environments, without ever putting a value on a command line or in a log.
 *
 *   npx vercel login          # once, interactive
 *   node scripts/vercel-env-push.mjs
 *
 * `vercel env add` reads the value from stdin when stdin is not a TTY, so each
 * secret goes straight from this process into the CLI. Nothing is printed but
 * the variable name, the target, and the value's length.
 *
 * NEXT_PUBLIC_SITE_URL is deliberately absent: it only feeds the OG/Twitter
 * metadata base in app/layout.tsx, and Vercel already sets
 * VERCEL_PROJECT_PRODUCTION_URL for that. The public origin Lens needs comes
 * from the request headers instead (app/api/lens/route.ts).
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const VARS = [
  ['DATABASE_URL', 'chapters 02 and 05 — enrol, match, registry'],
  ['SEPOLIA_RPC_URL', 'chapters 04 and 05 — read and write the chain'],
  ['WALLET_PRIVATE_KEY', 'chapter 04 — signs the anchor transaction'],
  ['SEARCHAPI_KEY', 'chapter 03 — Google Lens, the reason a public origin matters'],
  ['SERPAPI_KEY', 'chapter 03 — the fallback behind SearchApi'],
]

const TARGETS = ['production', 'preview', 'development']

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

function vercel(args, input) {
  return spawnSync('npx', ['--yes', 'vercel@latest', ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

const who = vercel(['whoami'])
if (who.status !== 0) {
  console.error('\n  Not signed in to Vercel. Run this first, then re-run me:\n')
  console.error('    npx vercel login\n')
  process.exit(1)
}
console.log(`\n  vercel account: ${who.stdout.trim()}`)

const link = vercel(['link', '--yes'])
if (link.status !== 0) {
  console.error(`\n  could not link this directory to a Vercel project:\n${link.stderr.trim()}\n`)
  process.exit(1)
}

const env = envFromFile(new URL('../.env.local', import.meta.url))

// Named variables only, when asked for: `npm run vercel:env -- SEARCHAPI_KEY`.
// DATABASE_URL is normally injected by the Vercel Neon integration, so pushing
// the whole set blindly would fight it.
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const wanted = only.length ? VARS.filter(([n]) => only.includes(n)) : VARS
const unknown = only.filter((n) => !VARS.some(([v]) => v === n))
if (unknown.length) {
  console.error(`\n  not a variable this app reads: ${unknown.join(', ')}\n`)
  process.exit(1)
}

const missing = wanted.filter(([name]) => !env[name]).map(([name]) => name)
if (missing.length === wanted.length) {
  console.error(`\n  .env.local has no value for: ${missing.join(', ')}. Nothing to push.\n`)
  process.exit(1)
}

let pushed = 0
for (const [name, why] of wanted) {
  const value = env[name]
  if (!value) {
    console.log(`\n  skip   ${name} — not set in .env.local (${why})`)
    continue
  }
  console.log(`\n  ${name}  (${value.length} chars) — ${why}`)
  for (const target of TARGETS) {
    // Remove first so a re-run updates rather than colliding with the existing value.
    vercel(['env', 'rm', name, target, '--yes'])
    const add = vercel(['env', 'add', name, target], value)
    if (add.status === 0) {
      console.log(`    set    ${target}`)
      pushed++
    } else {
      const detail = (add.stderr || add.stdout || '').trim().split('\n').pop()
      console.log(`    FAILED ${target} — ${detail}`)
      process.exitCode = 1
    }
  }
}

console.log(`\n  ${pushed} of ${wanted.length * TARGETS.length} values set.`)
console.log('  Deploy them with:  npx vercel --prod\n')
