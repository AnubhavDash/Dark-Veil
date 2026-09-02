import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { enrollments } from '@/lib/db/schema'

const MAX_THUMB = 120_000 // ~120 KB data URL cap

function isDescriptor(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 128 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

export async function GET() {
  const rows = await db
    .select({
      id: enrollments.id,
      name: enrollments.name,
      links: enrollments.links,
      thumb: enrollments.thumb,
      createdAt: enrollments.createdAt,
    })
    .from(enrollments)
    .orderBy(desc(enrollments.createdAt))
    .limit(100)
  return NextResponse.json({ enrollments: rows })
}

export async function POST(req: Request) {
  let body: { name?: unknown; links?: unknown; descriptor?: unknown; thumb?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  if (!isDescriptor(body.descriptor)) {
    return NextResponse.json({ error: 'A 128-d face descriptor is required.' }, { status: 400 })
  }

  const links = Array.isArray(body.links)
    ? body.links
        .filter((l): l is string => typeof l === 'string')
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l))
        .slice(0, 5)
    : []

  const thumb =
    typeof body.thumb === 'string' && body.thumb.startsWith('data:image/') && body.thumb.length <= MAX_THUMB
      ? body.thumb
      : null

  const [row] = await db
    .insert(enrollments)
    .values({ name, links, descriptor: body.descriptor.map((n) => Number(n.toFixed(6))), thumb })
    .returning({ id: enrollments.id, name: enrollments.name, createdAt: enrollments.createdAt })

  return NextResponse.json(row)
}
