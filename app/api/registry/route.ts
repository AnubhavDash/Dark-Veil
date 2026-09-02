import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { anchors } from '@/lib/db/schema'
import { EXPLORER } from '@/lib/chain'

export async function GET() {
  const rows = await db
    .select({
      id: anchors.id,
      txHash: anchors.txHash,
      recordHash: anchors.recordHash,
      identity: anchors.identity,
      matchUrl: anchors.matchUrl,
      fromAddress: anchors.fromAddress,
      blockNumber: anchors.blockNumber,
      network: anchors.network,
      createdAt: anchors.createdAt,
    })
    .from(anchors)
    .orderBy(desc(anchors.createdAt))
    .limit(200)

  return NextResponse.json({
    count: rows.length,
    anchors: rows.map((r) => ({ ...r, explorerUrl: `${EXPLORER}/tx/${r.txHash}` })),
  })
}
