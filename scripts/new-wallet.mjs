#!/usr/bin/env node
/**
 * Generate a throwaway Sepolia wallet and write its key straight into .env.local.
 *
 *   npm run wallet:new
 *
 * The private key is never printed — only the address, which is what you paste into a
 * faucet. Refuses to clobber an existing key unless you pass --force, so a funded burner
 * cannot be lost by re-running this.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Wallet } from 'ethers'

const ENV_PATH = new URL('../.env.local', import.meta.url)
const KEY = 'WALLET_PRIVATE_KEY'
const force = process.argv.includes('--force')

let env = ''
try {
  env = readFileSync(ENV_PATH, 'utf8')
} catch {
  console.error('\n  .env.local does not exist. Copy .env.example to .env.local first.\n')
  process.exit(1)
}

// `[ \t]*` rather than `\s*`: \s spans newlines, so a blank `WALLET_PRIVATE_KEY=` would
// swallow the line break and capture the next line as if it were a value.
const LINE = new RegExp(`^[ \\t]*${KEY}[ \\t]*=[ \\t]*(.*)$`, 'm')

const existing = LINE.exec(env)
if (existing && existing[1].trim() && !force) {
  console.error(`\n  ${KEY} already has a value in .env.local.`)
  console.error('  That wallet may hold test ETH. Re-run with --force to replace it.\n')
  process.exit(1)
}

const wallet = Wallet.createRandom()
const line = `${KEY}=${wallet.privateKey}`

env = LINE.test(env) ? env.replace(LINE, line) : `${env.replace(/\n*$/, '')}\n${line}\n`

writeFileSync(ENV_PATH, env, { mode: 0o600 })

console.log(`\n  new burner wallet written to .env.local`)
console.log(`\n  address   ${wallet.address}`)
console.log(`\n  Fund that address with Sepolia test ETH, then run npm run dev.`)
console.log(`  Google Cloud faucet needs no mainnet balance, just a Google account:`)
console.log(`  https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n`)
console.log(`  The private key stays in .env.local and was not printed. It is git-ignored.`)
console.log(`  This is a throwaway key for a test network — never send real funds to it.\n`)
