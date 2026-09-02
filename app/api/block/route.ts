import { NextResponse } from 'next/server'
import { getProvider } from '@/lib/chain'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const provider = getProvider()
    const block = await provider.getBlock('latest')
    return NextResponse.json({
      number: block?.number ?? null,
      timestamp: block?.timestamp ?? null,
      txCount: block?.transactions.length ?? 0,
      gasUsed: block?.gasUsed.toString() ?? '0',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
