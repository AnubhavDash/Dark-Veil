import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { db, dbErrorMessage } from '@/lib/db'
import { anchors } from '@/lib/db/schema'
import { EXPLORER } from '@/lib/chain'

export async function GET() {
  try {
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
  } catch (err) {
    // Without this the registry answers a bare 500 with an empty body, which is
    // the least diagnosable failure in the app on a deployment missing its vars.
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Could not read the registry.') },
      { status: 500 },
    )
  }
}
