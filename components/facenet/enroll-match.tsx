'use client'

import { useCallback, useEffect, useState } from 'react'
import { Database, Loader2, ScanSearch, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Enrollment, LogLevel, MatchResult } from '@/lib/types'

/** Distance axis for the bars: 0 is identical, 1.2 is "nothing alike". */
const AXIS = 1.2

type EnrollMatchProps = {
  descriptor: number[] | null
  crop: string | null
  log: (level: LogLevel, msg: string) => void
  disabled?: boolean
}

/** Re-encodes the crop small enough for the 120 KB thumbnail column. */
async function thumbnail(dataUrl: string, size = 160): Promise<string | null> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

export function EnrollMatch({ descriptor, crop, log, disabled }: EnrollMatchProps) {
  const [gallery, setGallery] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [links, setLinks] = useState('')
  const [saving, setSaving] = useState(false)
  const [matching, setMatching] = useState(false)
  const [match, setMatch] = useState<MatchResult | null>(null)

  const loadGallery = useCallback(async () => {
    try {
      const res = await fetch('/api/enroll', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'could not read the gallery')
      setGallery(data.enrollments ?? [])
    } catch (err) {
      log('warn', `gallery unavailable: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [log])

  useEffect(() => {
    loadGallery()
  }, [loadGallery])

  const enroll = useCallback(async () => {
    if (!descriptor || !name.trim()) return
    setSaving(true)
    try {
      const thumb = crop ? await thumbnail(crop) : null
      const res = await fetch('/api/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          links: links
            .split(/[\n,]/)
            .map((l) => l.trim())
            .filter(Boolean),
          descriptor,
          thumb,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'enrollment failed')
      log('ok', `enrolled "${data.name}" · 128-d descriptor stored in Neon`)
      setName('')
      setLinks('')
      setMatch(null)
      await loadGallery()
    } catch (err) {
      log('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [crop, descriptor, links, loadGallery, log, name])

  const runMatch = useCallback(async () => {
    if (!descriptor) return
    setMatching(true)
    setMatch(null)
    log('info', `comparing the captured descriptor against ${gallery.length} enrolled face(s)…`)
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor }),
      })
      const data: MatchResult = await res.json()
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || 'match failed')
      setMatch(data)
      log(
        data.best ? 'ok' : 'warn',
        data.best
          ? `identified as "${data.best.name}" · distance ${data.best.distance} (< ${data.threshold})`
          : `no gallery face within the ${data.threshold} threshold`,
      )
    } catch (err) {
      log('error', err instanceof Error ? err.message : String(err))
    } finally {
      setMatching(false)
    }
  }, [descriptor, gallery.length, log])

  const ready = !!descriptor && !disabled

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-black/20 p-4">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <UserPlus className="h-3.5 w-3.5 text-primary" /> enroll this face
        </h3>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!ready || saving}
            placeholder="Ada Lovelace"
            maxLength={80}
            className="rounded-lg border border-border bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            links · one per line, optional
          </span>
          <textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            disabled={!ready || saving}
            rows={2}
            placeholder="https://en.wikipedia.org/wiki/Ada_Lovelace"
            className="resize-none rounded-lg border border-border bg-black/30 px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary disabled:opacity-50"
          />
        </label>
        <div className="flex gap-2">
          <Button onClick={enroll} disabled={!ready || saving || !name.trim()} className="flex-1" size="lg">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            enroll
          </Button>
          <Button
            onClick={runMatch}
            disabled={!ready || matching || gallery.length === 0}
            variant="outline"
            className="flex-1"
            size="lg"
          >
            {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            match
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {!descriptor
            ? 'Capture a face first — enrollment stores its 128-d descriptor, never the photo.'
            : gallery.length === 0
              ? 'The gallery is empty. Enroll this face, then capture another photo of the same person and hit match.'
              : `Matching compares Euclidean distance against ${gallery.length} enrolled descriptor(s).`}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-black/20 p-4">
        <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-primary" />
          {match ? 'closest gallery faces' : `gallery · ${gallery.length}`}
        </h3>

        {match ? (
          <ul className="flex flex-col gap-2">
            {match.matches.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-2',
                  c.isMatch ? 'border-primary/50 bg-primary/5' : 'border-border',
                )}
              >
                {c.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.thumb}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span className="h-11 w-11 shrink-0 rounded-md border border-dashed border-border" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm text-foreground">{c.name}</span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 font-mono text-[11px] tabular-nums',
                        c.isMatch ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      d {c.distance.toFixed(3)} · {c.similarity}%
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/50">
                    <div
                      className={cn('h-full rounded-full', c.isMatch ? 'bg-primary' : 'bg-muted-foreground/50')}
                      style={{ width: `${Math.min(100, (c.distance / AXIS) * 100)}%` }}
                    />
                    <span
                      aria-hidden
                      title={`match threshold ${match.threshold}`}
                      className="absolute inset-y-0 w-px bg-chart-4"
                      style={{ left: `${(match.threshold / AXIS) * 100}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {loading ? (
              <p className="py-6 text-center font-mono text-xs text-muted-foreground">
                reading gallery…
              </p>
            ) : gallery.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No faces enrolled yet.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {gallery.map((e) => (
                  <li
                    key={e.id}
                    title={`${e.name} · enrolled ${new Date(e.createdAt).toLocaleString()}`}
                    className="flex w-[calc(50%-0.25rem)] items-center gap-2 rounded-lg border border-border p-2"
                  >
                    {e.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.thumb}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-border" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{e.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {match && (
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-px bg-chart-4" /> threshold {match.threshold}
            </span>
            <span>gallery {match.gallerySize}</span>
            <button onClick={() => setMatch(null)} className="ml-auto text-primary hover:underline">
              show gallery
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
