'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useRevealed } from '@/lib/hooks'

/** Fades and lifts its children the first time they scroll into view. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const [ref, revealed] = useRevealed<HTMLDivElement>()

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-[opacity,transform,filter] duration-700 ease-out motion-reduce:transition-none',
        revealed ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-8 opacity-0 blur-[3px]',
        className,
      )}
    >
      {children}
    </div>
  )
}
