'use client'

import { ExternalLink, Globe, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchResult, Source } from '@/lib/types'

const confidenceColor = (c: string) => {
  const v = c.toLowerCase()
  if (v.includes('high')) return 'text-primary border-primary/40 bg-primary/10'
  if (v.includes('medium')) return 'text-chart-4 border-chart-4/40 bg-chart-4/10'
  if (v.includes('visual')) return 'text-chart-3 border-chart-3/40 bg-chart-3/10'
  return 'text-muted-foreground border-border bg-muted/40'
}

export function MatchResults({
  result,
  selected,
  onSelect,
  locked,
}: {
  result: SearchResult
  selected: Source | null
  onSelect: (s: Source) => void
  locked: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Identity
          </p>
          <p className="text-lg font-semibold text-foreground text-glow-cyan">{result.identity}</p>
        </div>
        <span
          className={cn(
            'ml-auto rounded-md border px-2.5 py-1 font-mono text-xs uppercase tracking-wider',
            confidenceColor(result.confidence),
          )}
        >
          {result.confidence} confidence
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{result.summary}</p>

      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Globe className="h-3.5 w-3.5 text-primary" />
        {result.sources.length} {result.provider === 'google_lens' ? 'visual' : 'grounded web'} source
        {result.sources.length === 1 ? '' : 's'}
        {result.cached && (
          <span className="rounded border border-border px-1.5 py-px text-3xs text-muted-foreground/70">
            cached
          </span>
        )}
        <span className="ml-auto normal-case tracking-normal text-muted-foreground/60">
          via {result.model}
        </span>
      </div>

      {result.sources.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          No public web matches were returned for this face. Try a public figure with an online
          presence.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.sources.map((s, i) => {
            const isSel = selected?.url === s.url
            let host = s.source ?? s.url
            try {
              host = s.source ?? new URL(s.url).hostname.replace(/^www\./, '')
            } catch {
              /* keep raw */
            }
            return (
              <li
                key={i}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border pr-3 transition-colors',
                  isSel
                    ? 'border-primary bg-primary/10 shadow-glow-cyan'
                    : 'border-border hover:border-primary/50 hover:bg-primary/5',
                  locked && !isSel && 'opacity-50',
                )}
              >
                <button
                  disabled={locked}
                  onClick={() => onSelect(s)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-l-lg px-3 py-2.5 text-left"
                >
                  {s.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.thumbnail}
                      alt=""
                      loading="lazy"
                      className={cn(
                        'h-10 w-10 shrink-0 rounded-md border object-cover',
                        isSel ? 'border-primary/60' : 'border-border',
                      )}
                    />
                  ) : (
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs',
                        isSel ? 'border-primary text-primary' : 'border-border text-muted-foreground',
                      )}
                    >
                      {isSel ? (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      ) : (
                        String(i + 1).padStart(2, '0')
                      )}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{s.title}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {host}
                    </span>
                  </span>
                </button>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                  aria-label={`Open ${host} in a new tab`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
