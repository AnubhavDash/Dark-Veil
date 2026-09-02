import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { enrollments } from '@/lib/db/schema'
import { MATCH_THRESHOLD, euclid, similarity } from '@/lib/match'

export async function POST(req: Request) {
  let descriptor: unknown
  try {
    descriptor = (await req.json()).descriptor
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    return NextResponse.json({ error: 'A 128-d face descriptor is required.' }, { status: 400 })
  }
  const q = descriptor.map(Number)

  const rows = await db
    .select({
      id: enrollments.id,
      name: enrollments.name,
      links: enrollments.links,
      thumb: enrollments.thumb,
      descriptor: enrollments.descriptor,
      createdAt: enrollments.createdAt,
    })
    .from(enrollments)

  const scored = rows
    .map((r) => {
      const distance = euclid(q, r.descriptor)
      return {
        id: r.id,
        name: r.name,
        links: r.links,
        thumb: r.thumb,
        createdAt: r.createdAt,
        distance: Number(distance.toFixed(4)),
        similarity: similarity(distance),
        isMatch: distance < MATCH_THRESHOLD,
      }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)

  return NextResponse.json({
    threshold: MATCH_THRESHOLD,
    gallerySize: rows.length,
    matches: scored,
    best: scored[0]?.isMatch ? scored[0] : null,
  })
}
