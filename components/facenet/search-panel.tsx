'use client'

import { Loader2, Search, Telescope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MatchResults } from '@/components/facenet/match-results'
import type { SearchResult, Source } from '@/lib/types'

type SearchPanelProps = {
  crop: string | null
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
      {/*
       * This was a two-option provider picker: Google Lens, or a vision model reading the
       * crop alongside the Lens citations. The model could also answer with no citations at
       * all, which is the one thing this chapter is supposed to rule out — so only Lens is
       * left, and the header states what runs instead of offering a decision.
       */}
      <div className="flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-primary">
          <Telescope className="h-3.5 w-3.5" /> google lens
        </span>
        <span className="text-xs text-muted-foreground/80">
          Raw reverse image search. Every result below is a page Google itself found carrying
          this image — no model in the loop, so there is nothing to invent.
        </span>
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
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border font-mono text-2xs uppercase text-muted-foreground/60">
            no face
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
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
