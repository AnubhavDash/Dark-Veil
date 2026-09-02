import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lensImages, searchCache } from '@/lib/db/schema'

export const maxDuration = 60

type LensMatch = { title: string; url: string; source: string; thumbnail?: string }

/**
 * Optional path: true reverse image search via Google Lens, through SearchApi.io.
 * Works on any face that appears on the public web — no "public figure" policy gate,
 * and no hallucination surface, since the URLs come from Google rather than a model.
 * The crop is hosted briefly at /api/img/[hash] so Lens can fetch it by URL.
 */
export async function POST(req: Request) {
  const key = process.env.SEARCHAPI_KEY
  if (!key) {
    return NextResponse.json({ error: 'SEARCHAPI_KEY is not set. Add it in Project Settings → Vars.' }, { status: 500 })
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

  // Cache hit → zero SearchApi credits burned.
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

  // Google fetches the crop itself, so a loopback origin can never work. Say so plainly
  // instead of letting it come back as an unexplained "no results".
  if (/^(localhost|127\.|\[?::1)/i.test(host ?? '')) {
    return NextResponse.json(
      {
        error:
          `Google Lens has to fetch the crop from ${imageUrl}, which is not reachable from the ` +
          `internet. Deploy the app, or expose it with a tunnel, to use the Lens provider.`,
      },
      { status: 409 },
    )
  }

  // Bearer rather than ?api_key= so the key stays out of URLs and any proxy log.
  const params = new URLSearchParams({ engine: 'google_lens', search_type: 'all', url: imageUrl, hl: 'en' })
  const res = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  const data = await res.json()

  // "didn't return any results" arrives as HTTP 200 with an `error` string. That is an empty
  // result set, not a failure — only a non-2xx is worth surfacing as one.
  const empty = typeof data.error === 'string' && /no results|didn't return/i.test(data.error)
  if (!res.ok || (data.error && !empty)) {
    return NextResponse.json({ error: `Lens search failed: ${data.error ?? res.statusText}` }, { status: 502 })
  }

  // exact_matches first: pages carrying this identical image are a stronger claim about a
  // face than "looks similar to". `all` only fills visual_matches, so this is usually empty.
  const seen = new Set<string>()
  const matches: LensMatch[] = []
  for (const m of [...(data.exact_matches ?? []), ...(data.visual_matches ?? [])]) {
    if (!m.link || seen.has(m.link)) continue
    seen.add(m.link)
    matches.push({
      title: m.title ?? m.source ?? m.link,
      url: m.link,
      source: m.source ?? new URL(m.link).hostname,
      thumbnail: m.thumbnail ?? m.image?.link,
    })
    if (matches.length >= 12) break
  }

  const payload = {
    provider: 'google_lens',
    identity: matches.length ? 'Visual matches found' : 'No visual matches',
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
