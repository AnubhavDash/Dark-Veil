'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { LogLine } from '@/lib/types'

const levelColor: Record<LogLine['level'], string> = {
  info: 'text-muted-foreground',
  ok: 'text-primary',
  warn: 'text-chart-4',
  error: 'text-destructive',
}

const levelTag: Record<LogLine['level'], string> = {
  info: 'INFO',
  ok: ' OK ',
  warn: 'WARN',
  error: 'FAIL',
}

export function StatusLog({ lines }: { lines: LogLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll the log's own box, not the document. `scrollIntoView` walks up every scrollable
  // ancestor, which yanked the whole page down to the footer as soon as the first line landed.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || lines.length === 0) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-destructive/80" />
        <span className="h-2 w-2 rounded-full bg-chart-4/80" />
        <span className="h-2 w-2 rounded-full bg-primary/80" />
        <span className="ml-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          system.log
        </span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground/60">awaiting input_</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/50">
                {new Date(l.t).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={cn('shrink-0 font-bold', levelColor[l.level])}>[{levelTag[l.level]}]</span>
              <span className={cn('break-all', l.level === 'error' ? 'text-destructive' : 'text-foreground/90')}>
                {l.msg}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
