import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { searchCache } from '@/lib/db/schema'

export const maxDuration = 60

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
})

// Prefer the model the user confirmed has Search grounding, fall back if rate-limited.
const MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-pro']

type Source = { url: string; title: string }

function parseField(text: string, key: string): string {
  const re = new RegExp(`${key}:\\s*(.+)`, 'i')
  const m = text.match(re)
  return m ? m[1].trim() : ''
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
    const body = await req.json()
    image = body.image
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

  // Quota protection: identical crops re-run during a demo come from Neon, not Gemini.
  try {
    const [hit] = await db
      .select({ result: searchCache.result })
      .from(searchCache)
      .where(eq(searchCache.imageHash, imageHash))
      .limit(1)
    if (hit) return NextResponse.json({ ...hit.result, cached: true, imageHash })
  } catch (err) {
    console.error('[search] cache read failed', err)
  }

  const prompt = [
    'You are a facial reverse-search analyst. A cropped face image is attached.',
    'Use Google Search to find REAL, publicly available web pages and social media profiles',
    'that show this same person. Only report a match if the person is a public figure or',
    'otherwise clearly identifiable from public sources. Never invent a name or URL.',
    '',
    'Respond in EXACTLY this format (no markdown, no extra prose):',
    'IDENTITY: <best guess of the person, or "Unidentified">',
    'CONFIDENCE: <High | Medium | Low>',
    'SUMMARY: <one or two sentences describing who they are and where they appear online>',
  ].join('\n')

  let lastError = ''
  for (const modelId of MODELS) {
    try {
      const result = await generateText({
        model: google(modelId),
        tools: { google_search: google.tools.googleSearch({}) },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: bytes, mediaType },
            ],
          },
        ],
      })

      // Grounded citations returned by Search grounding.
      const seen = new Set<string>()
      const sources: Source[] = []
      for (const s of result.sources ?? []) {
        if (s.sourceType !== 'url' || !s.url || seen.has(s.url)) continue
        seen.add(s.url)
        sources.push({ url: s.url, title: s.title || new URL(s.url).hostname })
      }

      const payload = {
        model: modelId,
        identity: parseField(result.text, 'IDENTITY') || 'Unidentified',
        confidence: parseField(result.text, 'CONFIDENCE') || 'Low',
        summary: parseField(result.text, 'SUMMARY') || result.text.trim(),
        raw: result.text.trim(),
        sources,
      }

      try {
        await db
          .insert(searchCache)
          .values({ imageHash, provider: 'gemini', result: payload })
          .onConflictDoNothing()
      } catch (err) {
        console.error('[search] cache write failed', err)
      }

      return NextResponse.json({ ...payload, cached: false, imageHash })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // Try the next model on rate-limit / availability errors.
      if (/quota|rate|429|not found|permission|unavailable/i.test(lastError)) continue
      break
    }
  }

  return NextResponse.json(
    { error: `Gemini search failed: ${lastError || 'unknown error'}` },
    { status: 502 },
  )
}
