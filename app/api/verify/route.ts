import { NextResponse } from 'next/server'
import { EXPLORER, getProvider, hashRecord } from '@/lib/chain'

export const maxDuration = 60

export async function POST(req: Request) {
  let txHash: string | undefined
  let record: unknown
  try {
    const body = await req.json()
    txHash = body.txHash
    record = body.record
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!txHash || !record) {
    return NextResponse.json({ error: '`txHash` and `record` are required.' }, { status: 400 })
  }

  try {
    const provider = getProvider()
    const tx = await provider.getTransaction(txHash)

    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found on Sepolia.' }, { status: 404 })
    }

    const receipt = await provider.getTransactionReceipt(txHash)

    // The hash we independently recompute from the record we hold locally.
    const computedHash = hashRecord(record)
    // The hash that was actually written to the chain (the tx calldata).
    const onChainHash = tx.data
    const match = computedHash.toLowerCase() === onChainHash.toLowerCase()

    return NextResponse.json({
      match,
      computedHash,
      onChainHash,
      txHash,
      from: tx.from,
      blockNumber: tx.blockNumber ?? null,
      confirmations: await tx.confirmations(),
      status: receipt?.status === 1 ? 'success' : 'pending',
      explorerUrl: `${EXPLORER}/tx/${txHash}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Verification failed: ${msg}` }, { status: 502 })
  }
}
