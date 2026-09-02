'use client'

import { useMemo, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { cn } from '@/lib/utils'

const COLS = 16

/** Diverging, symmetric around zero: cyan for positive weights, magenta for negative. */
function cellColor(value: number, max: number): string {
  const t = Math.min(1, Math.abs(value) / (max || 1))
  const alpha = (0.08 + 0.92 * t).toFixed(3)
  return value >= 0
    ? `oklch(0.82 0.15 195 / ${alpha})`
    : `oklch(0.7 0.22 330 / ${alpha})`
}

/**
 * The raw 128-d face embedding, drawn as a 16x8 tile. Two photos of the same
 * person produce visibly similar tiles — that similarity is what /api/match scores.
 */
export function EmbeddingHeatmap({
  descriptor,
  className,
}: {
  descriptor: number[]
  className?: string
}) {
  const [hover, setHover] = useState<number | null>(null)

  const stats = useMemo(() => {
    const max = descriptor.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const norm = Math.sqrt(descriptor.reduce((s, v) => s + v * v, 0))
    return {
      max,
      norm,
      min: Math.min(...descriptor),
      peak: Math.max(...descriptor),
      mean: descriptor.reduce((s, v) => s + v, 0) / (descriptor.length || 1),
    }
  }, [descriptor])

  const shown = hover !== null ? descriptor[hover] : null

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <Fingerprint className="h-3.5 w-3.5 text-primary" />
          {descriptor.length}-d embedding
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground/80 tabular-nums">
          {hover !== null ? (
            <>
              dim <span className="text-primary">{String(hover).padStart(3, '0')}</span> ={' '}
              <span className={shown! >= 0 ? 'text-primary' : 'text-accent'}>
                {shown!.toFixed(5)}
              </span>
            </>
          ) : (
            <>L2 norm {stats.norm.toFixed(4)}</>
          )}
        </span>
      </div>

      <div
        role="img"
        aria-label={`128-dimensional face embedding heatmap. Values range from ${stats.min.toFixed(3)} to ${stats.peak.toFixed(3)}.`}
        onMouseLeave={() => setHover(null)}
        className="grid gap-[3px] rounded-lg border border-border bg-black/30 p-3"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {descriptor.map((value, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            title={`dim ${i} · ${value.toFixed(5)}`}
            style={{
              background: cellColor(value, stats.max),
              animationDelay: `${i * 4}ms`,
            }}
            className={cn(
              'aspect-square rounded-[2px] outline-none ring-inset transition-[box-shadow,transform] duration-150',
              'animate-[cell-in_320ms_ease-out_backwards] motion-reduce:animate-none',
              hover === i && 'scale-[1.35] ring-1 ring-foreground/70',
            )}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            −{stats.max.toFixed(2)}
          </span>
          <span
            aria-hidden
            className="h-2 w-28 rounded-full"
            style={{
              background:
                'linear-gradient(to right, oklch(0.7 0.22 330), oklch(0.7 0.22 330 / 0.08), oklch(0.82 0.15 195 / 0.08), oklch(0.82 0.15 195))',
            }}
          />
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            +{stats.max.toFixed(2)}
          </span>
        </div>
        <dl className="ml-auto flex gap-4 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground/60">min</dt>
            <dd className="tabular-nums text-foreground/80">{stats.min.toFixed(3)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground/60">max</dt>
            <dd className="tabular-nums text-foreground/80">{stats.peak.toFixed(3)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground/60">mean</dt>
            <dd className="tabular-nums text-foreground/80">{stats.mean.toFixed(3)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
