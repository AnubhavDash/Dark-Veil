'use client'

import { Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Radar pulse shown while a transaction is in flight to the Sepolia mempool. */
export function BroadcastPulse({
  active,
  label = 'broadcasting to sepolia',
  className,
}: {
  active: boolean
  label?: string
  className?: string
}) {
  if (!active) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-primary/30 bg-primary/5 py-8',
        className,
      )}
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            style={{ animationDelay: `${i * 600}ms` }}
            className="absolute inset-0 rounded-full border border-primary/60 animate-[ring-pulse_1.8s_ease-out_infinite] motion-reduce:hidden"
          />
        ))}
        <span className="absolute inset-6 rounded-full bg-primary/20 blur-md" />
        <Radio className="relative h-7 w-7 text-primary" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">{label}</p>
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        Waiting for the first confirmation. This takes one Sepolia block, roughly 12 seconds.
      </p>
    </div>
  )
}
