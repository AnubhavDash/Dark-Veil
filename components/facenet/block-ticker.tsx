'use client'

import { useEffect, useRef, useState } from 'react'
import { Blocks, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BlockInfo } from '@/lib/types'

/** Sepolia averages a block every ~12s, so that is the poll interval. */
const POLL_MS = 12_000

export function BlockTicker({
  onBlock,
  className,
}: {
  onBlock?: (info: BlockInfo) => void
  className?: string
}) {
  const [info, setInfo] = useState<BlockInfo | null>(null)
  const [offline, setOffline] = useState(false)
  const onBlockRef = useRef(onBlock)
  onBlockRef.current = onBlock

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const res = await fetch('/api/block', { cache: 'no-store' })
        const data = await res.json()
        if (!alive) return
        if (!res.ok || typeof data.number !== 'number') {
          setOffline(true)
        } else {
          setOffline(false)
          setInfo((prev) => {
            if (prev?.number !== data.number) onBlockRef.current?.(data)
            return data
          })
        }
      } catch {
        if (alive) setOffline(true)
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }

    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  if (offline || !info?.number) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70',
          className,
        )}
        title={offline ? 'SEPOLIA_RPC_URL is missing or unreachable' : 'connecting…'}
      >
        <WifiOff className="h-3 w-3" />
        {offline ? 'chain offline' : 'syncing…'}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary',
        className,
      )}
      title={`${info.txCount} transactions · ${Number(info.gasUsed).toLocaleString()} gas used`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      <Blocks className="h-3 w-3" />
      <span className="hidden sm:inline">sepolia</span>
      <span key={info.number} className="animate-[block-flash_900ms_ease-out] tabular-nums">
        #{info.number.toLocaleString()}
      </span>
      <span className="hidden text-primary/60 md:inline">· {info.txCount} tx</span>
    </div>
  )
}
