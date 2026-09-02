import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lensImages, searchCache } from '@/lib/db/schema'
import { configuredVendors, isLoopback, lensSearch } from '@/lib/lens'

export const maxDuration = 60

/**
 * Optional path: true reverse image search via Google Lens, through SearchApi.io with SerpApi
 * as the fallback. Works on any face that appears on the public web — no "public figure"
 * policy gate, and no hallucination surface, since the URLs come from Google rather than a
 * model. The crop is hosted briefly at /api/img/[hash] so Lens can fetch it by URL.
 */
export async function POST(req: Request) {
  if (configuredVendors().length === 0) {
    return NextResponse.json(
      { error: 'No reverse-image key set. Add SEARCHAPI_KEY or SERPAPI_KEY in Project Settings → Vars.' },
      { status: 500 },
    )
  }

  let image: string | undefined
  try {
    image = (await req.json()).image
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!image || !image.startsWith('data:image/')) {
    return NextResponse.json({ error: 'A base64 data URL image is required.' }, { status: 400 })
  }

  const [meta, base64] = image.split(',')
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg'
  const imageHash = createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')

  // Cache hit → zero vendor credits burned.
  try {
    const [hit] = await db
      .select({ result: searchCache.result })
      .from(searchCache)
      .where(eq(searchCache.imageHash, `lens:${imageHash}`))
      .limit(1)
    if (hit) return NextResponse.json({ ...hit.result, cached: true })
  } catch (err) {
    console.error('[lens] cache read failed', err)
  }

  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const imageUrl = `${proto}://${host}/api/img/${imageHash}`

  // Google fetches the crop itself, so a loopback origin can never work. Say so plainly, and
  // before spending a credit, instead of letting it come back as an unexplained "no results".
  if (isLoopback(host)) {
    return NextResponse.json(
      {
        error:
          `Google Lens has to fetch the crop from ${imageUrl}, which is not reachable from the ` +
          `internet. Deploy the app, or expose it with a tunnel, to use the Lens provider.`,
      },
      { status: 409 },
    )
  }

  // Host the crop so Lens can pull it.
  await db.insert(lensImages).values({ imageHash, mime, data: base64 }).onConflictDoNothing()

  const lookup = await lensSearch(imageUrl)
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status })
  }

  const payload = {
    provider: 'google_lens' as const,
    vendor: lookup.vendor,
    identity: lookup.matches.length ? 'Visual matches found' : 'No visual matches',
    matches: lookup.matches,
    imageUrl,
  }

  try {
    await db
      .insert(searchCache)
      .values({ imageHash: `lens:${imageHash}`, provider: 'google_lens', result: payload })
      .onConflictDoNothing()
  } catch (err) {
    console.error('[lens] cache write failed', err)
  }

  return NextResponse.json({ ...payload, cached: false })
}
