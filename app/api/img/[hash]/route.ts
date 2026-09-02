import { eq } from 'drizzle-orm'
import { db, dbErrorMessage } from '@/lib/db'
import { lensImages } from '@/lib/db/schema'

/** Serves a stored face crop so third-party reverse image search can fetch it by URL. */
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response('Not found', { status: 404 })

  try {
    const [row] = await db.select().from(lensImages).where(eq(lensImages.imageHash, hash)).limit(1)
    if (!row) return new Response('Not found', { status: 404 })

    return new Response(Buffer.from(row.data, 'base64'), {
      headers: {
        'Content-Type': row.mime,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    // Google follows this URL, so the body is plain text rather than JSON — but it
    // still has to say which variable is missing instead of returning nothing.
    return new Response(dbErrorMessage(err, 'Could not read the image.'), {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
