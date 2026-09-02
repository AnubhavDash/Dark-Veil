'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, FileSearch, Loader2, RefreshCw, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RegistryEntry } from '@/lib/types'

/** Public list of every record this deployment has anchored to Sepolia. */
export function Registry({
  version = 0,
  limit,
  className,
}: {
  version?: number
  limit?: number
  className?: string
}) {
  const [rows, setRows] = useState<RegistryEntry[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/registry', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'registry unavailable')
      setRows(limit ? data.anchors.slice(0, limit) : data.anchors)
      setCount(data.count ?? 0)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    load()
  }, [load, version])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <ScrollText className="h-3.5 w-3.5 text-primary" /> proof registry
          {count > 0 && <span className="text-primary">{count}</span>}
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          refresh
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 font-mono text-xs text-destructive">
          {error}
        </p>
      ) : loading && rows.length === 0 ? (
        <p className="py-8 text-center font-mono text-xs text-muted-foreground">reading Neon…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing anchored yet. Complete a run and the transaction will appear here — and stay
          verifiable by anyone, forever.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{r.identity}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {r.txHash.slice(0, 18)}…{r.txHash.slice(-8)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                <span className="tabular-nums" title="Sepolia block">
                  {r.blockNumber ? `#${r.blockNumber.toLocaleString()}` : 'pending'}
                </span>
                <span className="tabular-nums" title={new Date(r.createdAt).toLocaleString()}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
                <a
                  href={`/proof/${r.txHash}`}
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <FileSearch className="h-3.5 w-3.5" /> proof
                </a>
                <a
                  href={r.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground transition-colors hover:text-primary"
                  aria-label="Open on Etherscan"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </li>
          ))}

        </ul>
      )}

    </div>
  )
}
