import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lensImages } from '@/lib/db/schema'

/** Serves a stored face crop so third-party reverse image search can fetch it by URL. */
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response('Not found', { status: 404 })

  const [row] = await db.select().from(lensImages).where(eq(lensImages.imageHash, hash)).limit(1)
  if (!row) return new Response('Not found', { status: 404 })

  return new Response(Buffer.from(row.data, 'base64'), {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
