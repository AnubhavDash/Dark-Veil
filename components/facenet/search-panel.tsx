'use client'

import { Loader2, Search, Sparkles, Telescope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MatchResults } from '@/components/facenet/match-results'
import { cn } from '@/lib/utils'
import type { SearchProvider, SearchResult, Source } from '@/lib/types'

const PROVIDERS: { id: SearchProvider; label: string; hint: string }[] = [
  { id: 'gemini', label: 'Gemini + Search', hint: 'Vision model with Google Search grounding' },
  { id: 'google_lens', label: 'Google Lens', hint: 'True reverse image search via SerpAPI' },
]

type SearchPanelProps = {
  crop: string | null
  provider: SearchProvider
  onProvider: (p: SearchProvider) => void
  searching: boolean
  result: SearchResult | null
  selected: Source | null
  onSelect: (s: Source) => void
  locked: boolean
  failed: boolean
  onRun: () => void
}

export function SearchPanel({
  crop,
  provider,
  onProvider,
  searching,
  result,
  selected,
  onSelect,
  locked,
  failed,
  onRun,
}: SearchPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Reverse search provider"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {PROVIDERS.map((p) => {
          const active = provider === p.id
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={active}
              disabled={searching || locked}
              onClick={() => onProvider(p.id)}
              className={cn(
                'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {p.id === 'gemini' ? (
                  <Sparkles className="h-3.5 w-3.5" />
                ) : (
                  <Telescope className="h-3.5 w-3.5" />
                )}
                {p.label}
              </span>
              <span className="text-xs text-muted-foreground/80">{p.hint}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
        {crop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={crop}
            alt="Detected face crop used as the search query"
            className="h-16 w-16 shrink-0 rounded-lg border border-primary/40 object-cover shadow-glow-cyan"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border font-mono text-[10px] uppercase text-muted-foreground/60">
            no face
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            query image
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {!crop
              ? 'Capture a face in chapter 01 to unlock the reverse search.'
              : failed
                ? 'The last search failed — check the system log and try again.'
                : result
                  ? `${result.sources.length} source${result.sources.length === 1 ? '' : 's'} returned${
                      result.cached ? ' · served from cache' : ''
                    }`
                  : 'Face crop ready. Run the search to query the live web.'}
          </p>
        </div>
        <Button onClick={onRun} disabled={!crop || searching || locked} className="shrink-0" size="lg">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {searching ? 'searching' : result ? 're-run' : 'search'}
        </Button>
      </div>

      {result && (
        <MatchResults result={result} selected={selected} onSelect={onSelect} locked={locked} />
      )}


    </div>
  )
}
