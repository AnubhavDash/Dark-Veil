import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { anchors } from '@/lib/db/schema'
import { EXPLORER, canonicalize, getProvider, hashRecord } from '@/lib/chain'

export const maxDuration = 30

/**
 * Public, independently-verifiable proof. Returns the stored record, the hash we
 * recompute from it, and the hash actually read back from Sepolia calldata.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await ctx.params
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'Invalid transaction hash.' }, { status: 400 })
  }

  const [row] = await db.select().from(anchors).where(eq(anchors.txHash, txHash)).limit(1)
  if (!row) return NextResponse.json({ error: 'No anchor found for this tx.' }, { status: 404 })

  const computedHash = hashRecord(row.record)
  let onChainHash: string | null = null
  let blockNumber: number | null = row.blockNumber
  let confirmations = 0
  let chainError: string | null = null

  try {
    const provider = getProvider()
    const tx = await provider.getTransaction(txHash)
    if (tx) {
      onChainHash = tx.data
      blockNumber = tx.blockNumber ?? blockNumber
      confirmations = await tx.confirmations()
    } else {
      chainError = 'Transaction not found on Sepolia.'
    }
  } catch (err) {
    chainError = err instanceof Error ? err.message : String(err)
  }

  const match = onChainHash ? onChainHash.toLowerCase() === computedHash.toLowerCase() : null

  return NextResponse.json({
    version: 1,
    network: row.network,
    txHash,
    explorerUrl: `${EXPLORER}/tx/${txHash}`,
    from: row.fromAddress,
    blockNumber,
    confirmations,
    anchoredAt: row.createdAt,
    identity: row.identity,
    record: row.record,
    canonical: canonicalize(row.record),
    algorithm: 'keccak256(utf8(canonicalJSON(record)))',
    storedHash: row.recordHash,
    computedHash,
    onChainHash,
    match,
    chainError,
  })
}
