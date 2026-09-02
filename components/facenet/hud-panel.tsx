import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HudPanelProps = {
  children: ReactNode
  className?: string
  glow?: 'cyan' | 'magenta' | 'none'
}

export function HudPanel({ children, className, glow = 'cyan' }: HudPanelProps) {
  return (
    <div
      className={cn(
        'glass relative rounded-xl border',
        glow === 'cyan' && 'shadow-glow-cyan',
        glow === 'magenta' && 'shadow-glow-magenta',
        className,
      )}
    >
      {/* corner ticks */}
      <span className="pointer-events-none absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-primary/70" />
      <span className="pointer-events-none absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-primary/70" />
      <span className="pointer-events-none absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-primary/70" />
      <span className="pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-primary/70" />
      {children}
    </div>
  )
}
