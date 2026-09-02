import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { lensImages, searchCache } from '@/lib/db/schema'
import { configuredVendors, isLoopback, lensSearch } from '@/lib/lens'
import type { LensMatch, Source } from '@/lib/types'

export const maxDuration = 60

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })

// Newest first, falling back when a model is rate-limited or unavailable. Verified present on
// a current API key — the 2.5 family that used to head this list now answers "no longer
// available to new users" and is scheduled to shut down entirely in October 2026.
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash']

/**
 * Whether this key may use Search grounding, discovered once per server process.
 *
 * Grounding is a paid feature on Gemini 3.x — the free tier is not merely limited, the
 * pricing table lists it as "Not available", so a grounded call 429s on the first attempt.
 * Rather than hardcode that, the first request probes it and caches the answer, so enabling
 * billing later starts working on its own without a code change. A transient 429 can also
 * latch this to false for the life of the process, which is a fair trade against re-probing
 * on every single search.
 */
let grounding: boolean | null = null

function parseField(text: string, key: string): string {
  const m = text.match(new RegExp(`${key}:\\s*(.+)`, 'i'))
  return m ? m[1].trim() : ''
}

/** A 429/permission/billing error on a grounded call means the tool, not the model, is gated. */
function isGroundingGate(msg: string): boolean {
  return /quota|rate.?limit|429|resource_exhausted|permission|billing|not enabled/i.test(msg)
}

/** Errors worth retrying against the next model rather than giving up on. */
function isTransient(msg: string): boolean {
  return /quota|rate|429|5\d\d|not found|permission|unavailable|overloaded|capacity/i.test(msg)
}

/**
 * Three prompts, because the model's evidence differs and the instruction has to match it.
 * The one thing all three share: never invent a URL. That is the failure mode this whole
 * chapter exists to avoid, since an invented citation about a real person is a libel machine.
 */
function buildPrompt(mode: 'grounded' | 'evidence' | 'vision', matches: LensMatch[]): string {
  const format = [
    '',
    'Respond in EXACTLY this format (no markdown, no extra prose):',
    'IDENTITY: <best guess of the person, or "Unidentified">',
    'CONFIDENCE: <High | Medium | Low>',
    'SUMMARY: <one or two sentences describing who they are and where they appear online>',
  ]

  if (mode === 'grounded') {
    return [
      'You are a facial reverse-search analyst. A cropped face image is attached.',
      'Use Google Search to find REAL, publicly available web pages and social media profiles',
      'that show this same person. Only report a match if the person is a public figure or',
      'otherwise clearly identifiable from public sources. Never invent a name or URL.',
      ...format,
    ].join('\n')
  }

  if (mode === 'evidence') {
    return [
      'You are a facial reverse-search analyst. A cropped face image is attached.',
      '',
      'Google Lens found these real pages containing this exact image:',
      ...matches.map((m, i) => `${i + 1}. ${m.title} — ${m.source} — ${m.url}`),
      '',
      'Identify the person using the crop together with those pages. The page titles and',
      'domains are your evidence; weigh them over your own recollection where they disagree.',
      'Do not output any URL that is not in the list above, and do not invent a name — answer',
      '"Unidentified" if the pages do not actually establish who this is.',
      ...format,
    ].join('\n')
  }

  return [
    'You are a facial reverse-search analyst. A cropped face image is attached.',
    '',
    'You have NO web access on this request. Identify the person from the image alone, using',
    'only what you already know. Answer "Unidentified" unless you genuinely recognise them —',
    'a wrong name attached to a real face is worse than no name. Output no URLs whatsoever,',
    'and set CONFIDENCE to at most Medium, since nothing here has been checked against the web.',
    ...format,
  ].join('\n')
}

/**
 * Runs one model, preferring grounded search and stepping down to the ungrounded call when
 * the tool turns out to be gated. Returns null when even the ungrounded call fails, so the
 * caller can move to the next model.
 */
async function ask(
  modelId: string,
  bytes: Buffer,
  mediaType: string,
  matches: LensMatch[],
): Promise<{ text: string; sources: Source[]; mode: 'grounded' | 'evidence' | 'vision' } | null> {
  const wantGrounded = grounding !== false && matches.length === 0

  if (wantGrounded) {
    try {
      const r = await generateText({
        model: google(modelId),
        tools: { google_search: google.tools.googleSearch({}) },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt('grounded', matches) },
              { type: 'image', image: bytes, mediaType },
            ],
          },
        ],
      })
      grounding = true
      const seen = new Set<string>()
      const sources: Source[] = []
      for (const s of r.sources ?? []) {
        if (s.sourceType !== 'url' || !s.url || seen.has(s.url)) continue
        seen.add(s.url)
        sources.push({ url: s.url, title: s.title || new URL(s.url).hostname })
      }
      return { text: r.text, sources, mode: 'grounded' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isGroundingGate(msg)) throw err
      grounding = false
      console.warn(`[search] grounding unavailable on this key, continuing ungrounded — ${msg}`)
    }
  }

  const mode = matches.length > 0 ? 'evidence' : 'vision'
  const r = await generateText({
    model: google(modelId),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(mode, matches) },
          { type: 'image', image: bytes, mediaType },
        ],
      },
    ],
  })
  // Citations come from Lens, never from the model — see buildPrompt.
  const sources: Source[] = matches.map((m) => ({
    url: m.url,
    title: m.title,
    thumbnail: m.thumbnail,
    source: m.source,
  }))
  return { text: r.text, sources, mode }
}

/**
 * Real citations for the model to reason over, reusing whatever /api/lens already paid for.
 * The two routes share the `lens:` cache namespace deliberately: running both providers on
 * one face should cost one credit, not two.
 */
async function gatherEvidence(imageHash: string, mime: string, base64: string, host: string | null) {
  try {
    const [hit] = await db
      .select({ result: searchCache.result })
      .from(searchCache)
      .where(eq(searchCache.imageHash, `lens:${imageHash}`))
      .limit(1)
    const cached = hit?.result as { matches?: LensMatch[] } | undefined
    if (cached?.matches) return cached.matches
  } catch (err) {
    console.error('[search] lens cache read failed', err)
  }

  const proto = 'https'
  const imageUrl = `${proto}://${host}/api/img/${imageHash}`
  try {
    await db.insert(lensImages).values({ imageHash, mime, data: base64 }).onConflictDoNothing()
    const lookup = await lensSearch(imageUrl)
    if (!lookup.ok) {
      console.warn(`[search] lens evidence unavailable, falling back to vision only — ${lookup.error}`)
      return []
    }
    await db
      .insert(searchCache)
      .values({
        imageHash: `lens:${imageHash}`,
        provider: 'google_lens',
        result: {
          provider: 'google_lens',
          vendor: lookup.vendor,
          identity: lookup.matches.length ? 'Visual matches found' : 'No visual matches',
          matches: lookup.matches,
          imageUrl,
        },
      })
      .onConflictDoNothing()
    return lookup.matches
  } catch (err) {
    console.error('[search] lens evidence failed', err)
    return []
  }
}

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not set. Add it in Project Settings → Vars.' },
      { status: 500 },
    )
  }

  let image: string | undefined
  try {
    image = (await req.json()).image
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!image || !image.startsWith('data:')) {
    return NextResponse.json({ error: 'A base64 data URL image is required.' }, { status: 400 })
  }

  const [meta, base64] = image.split(',')
  const mediaType = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg'
  const bytes = Buffer.from(base64, 'base64')
  const imageHash = createHash('sha256').update(bytes).digest('hex')

  // Whether real citations are even reachable decides the cache namespace, so that a
  // vision-only answer produced on localhost never gets served as the cited one in production.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const canCite = configuredVendors().length > 0 && !isLoopback(host)
  const cacheKey = canCite ? imageHash : `vision:${imageHash}`

  // Quota protection: identical crops re-run during a demo come from Neon, not Gemini.
  try {
    const [hit] = await db
      .select({ result: searchCache.result })
      .from(searchCache)
      .where(eq(searchCache.imageHash, cacheKey))
      .limit(1)
    if (hit) return NextResponse.json({ ...hit.result, cached: true, imageHash })
  } catch (err) {
    console.error('[search] cache read failed', err)
  }

  const matches = canCite ? await gatherEvidence(imageHash, mediaType, base64, host) : []

  let lastError = ''
  for (const modelId of MODELS) {
    try {
      const out = await ask(modelId, bytes, mediaType, matches)
      if (!out) continue

      const payload = {
        model: out.mode === 'grounded' ? `${modelId} · search grounding` : `${modelId} · ${out.mode}`,
        mode: out.mode,
        identity: parseField(out.text, 'IDENTITY') || 'Unidentified',
        confidence: parseField(out.text, 'CONFIDENCE') || 'Low',
        summary: parseField(out.text, 'SUMMARY') || out.text.trim(),
        raw: out.text.trim(),
        sources: out.sources,
      }

      try {
        await db
          .insert(searchCache)
          .values({ imageHash: cacheKey, provider: 'gemini', result: payload })
          .onConflictDoNothing()
      } catch (err) {
        console.error('[search] cache write failed', err)
      }

      return NextResponse.json({ ...payload, cached: false, imageHash })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (isTransient(lastError)) continue
      break
    }
  }

  return NextResponse.json(
    { error: `Gemini search failed: ${lastError || 'unknown error'}` },
    { status: 502 },
  )
}


