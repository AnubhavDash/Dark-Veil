import { ethers } from 'ethers'

export const EXPLORER = 'https://sepolia.etherscan.io'

/** Deterministic stringify so the same record always hashes to the same value. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** keccak256 hash of the canonical record -> 0x-prefixed 32 byte hex string. */
export function hashRecord(record: unknown): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalize(record)))
}

export function getProvider(): ethers.JsonRpcProvider {
  const rpc = process.env.SEPOLIA_RPC_URL
  if (!rpc) throw new Error('SEPOLIA_RPC_URL is not set. Add it in Project Settings → Vars.')
  return new ethers.JsonRpcProvider(rpc)
}

export function getWallet(): ethers.Wallet {
  const pk = process.env.WALLET_PRIVATE_KEY
  if (!pk) throw new Error('WALLET_PRIVATE_KEY is not set. Add it in Project Settings → Vars.')
  const normalized = pk.startsWith('0x') ? pk : `0x${pk}`
  return new ethers.Wallet(normalized, getProvider())
}
