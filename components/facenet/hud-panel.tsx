import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HudPanelProps = {
  children: ReactNode
  className?: string
}

/**
 * Every panel on the site carries the same violet edge. It used to be a `glow`
 * prop with cyan, magenta and none, which meant the border colour changed from
 * panel to panel for no reason a reader could see — chapter 03 was magenta,
 * chapter 01 cyan, and everything holding a list had no edge at all.
 *
 * The cyan `shadow-glow-cyan` is still used, but only where it means something:
 * the active pipeline step, a selected match, a selected chain row.
 */
export function HudPanel({ children, className }: HudPanelProps) {
  return (
    <div className={cn('glass relative rounded-xl border shadow-glow-magenta', className)}>
      {/* corner ticks */}
      <span className="pointer-events-none absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-primary/70" />
      <span className="pointer-events-none absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-primary/70" />
      <span className="pointer-events-none absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-primary/70" />
      <span className="pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-primary/70" />
      {children}
    </div>
  )
}
