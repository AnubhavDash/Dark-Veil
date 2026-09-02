import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lensImages, searchCache } from '@/lib/db/schema'

export const maxDuration = 60

type LensMatch = { title: string; url: string; source: string; thumbnail?: string }

/**
 * Optional path: true reverse image search via Google Lens (SerpAPI).
 * Works on any face that appears on the public web — no "public figure" policy gate.
 * The crop is hosted briefly at /api/img/[hash] so Lens can fetch it by URL.
 */
export async function POST(req: Request) {
  const key = process.env.SERPAPI_KEY
  if (!key) {
    return NextResponse.json({ error: 'SERPAPI_KEY is not set. Add it in Project Settings → Vars.' }, { status: 500 })
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

  // Cache hit → zero SerpAPI credits burned.
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

  // Host the crop so Lens can pull it.
  await db.insert(lensImages).values({ imageHash, mime, data: base64 }).onConflictDoNothing()

  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const imageUrl = `${proto}://${host}/api/img/${imageHash}`

  const params = new URLSearchParams({ engine: 'google_lens', url: imageUrl, hl: 'en', api_key: key })
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { cache: 'no-store' })
  const data = await res.json()

  if (!res.ok || data.error) {
    return NextResponse.json({ error: `Lens search failed: ${data.error ?? res.statusText}` }, { status: 502 })
  }

  const seen = new Set<string>()
  const matches: LensMatch[] = []
  for (const m of data.visual_matches ?? []) {
    if (!m.link || seen.has(m.link)) continue
    seen.add(m.link)
    matches.push({
      title: m.title ?? m.source ?? m.link,
      url: m.link,
      source: m.source ?? new URL(m.link).hostname,
      thumbnail: m.thumbnail,
    })
    if (matches.length >= 12) break
  }

  const payload = {
    provider: 'google_lens',
    identity: data.knowledge_graph?.[0]?.title ?? (matches.length ? 'Visual matches found' : 'No visual matches'),
    matches,
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
