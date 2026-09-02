import { NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { EXPLORER, getWallet, hashRecord } from '@/lib/chain'
import { db } from '@/lib/db'
import { anchors } from '@/lib/db/schema'

export const maxDuration = 60

export async function POST(req: Request) {
  let record: unknown
  try {
    const body = await req.json()
    record = body.record
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!record || typeof record !== 'object') {
    return NextResponse.json({ error: 'A `record` object is required.' }, { status: 400 })
  }

  try {
    const wallet = getWallet()
    const hash = hashRecord(record)

    // Anchor: send a 0-value tx to self whose calldata IS the record hash.
    // The 32-byte hash lives permanently in the transaction's input data.
    const tx = await wallet.sendTransaction({
      to: wallet.address,
      value: BigInt(0),
      data: hash,
    })

    const receipt = await tx.wait(1)

    // Public proof registry — powers /registry and /proof/[txHash].
    const rec = record as Record<string, unknown>
    const matchUrl =
      rec.match && typeof rec.match === 'object' && typeof (rec.match as { url?: unknown }).url === 'string'
        ? ((rec.match as { url: string }).url as string)
        : null
    try {
      await db
        .insert(anchors)
        .values({
          txHash: tx.hash,
          recordHash: hash,
          record: rec,
          identity: typeof rec.identity === 'string' ? rec.identity : 'Unidentified',
          matchUrl,
          fromAddress: wallet.address,
          blockNumber: receipt?.blockNumber ?? null,
          network: 'sepolia',
        })
        .onConflictDoNothing()
    } catch (err) {
      console.error('[anchor] registry write failed', err)
    }

    return NextResponse.json({
      txHash: tx.hash,
      hash,
      from: wallet.address,
      blockNumber: receipt?.blockNumber ?? null,
      network: 'sepolia',
      explorerUrl: `${EXPLORER}/tx/${tx.hash}`,
      anchoredAt: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    let hint = msg
    if (/insufficient funds/i.test(msg)) {
      hint = 'The wallet has no Sepolia ETH. Fund it from a Sepolia faucet and try again.'
    } else if (ethers.isError(err as ethers.EthersError, 'INVALID_ARGUMENT')) {
      hint = 'WALLET_PRIVATE_KEY appears invalid. Check it in Project Settings → Vars.'
    }
    return NextResponse.json({ error: `Anchoring failed: ${hint}` }, { status: 502 })
  }
}
