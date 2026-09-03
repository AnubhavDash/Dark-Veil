'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Reveal } from '@/components/facenet/reveal'

/** One numbered act of the scroll narrative. */
export function Chapter({
  id,
  index,
  title,
  kicker,
  blurb,
  children,
  className,
}: {
  id: string
  index: string
  title: string
  kicker: string
  blurb?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      className={cn('chapter-seam scroll-mt-24 py-16 sm:py-24', className)}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal>
          <div className="mb-8 flex items-end gap-4 sm:gap-6">
            <span
              aria-hidden
              className="font-mono text-5xl font-bold leading-none text-primary/20 sm:text-7xl"
            >
              {index}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-2xs uppercase tracking-[0.35em] text-primary/70 sm:text-xs">
                {kicker}
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-4xl">{title}</h2>
            </div>
          </div>
          {blurb && (
            <p className="mb-8 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
              {blurb}
            </p>
          )}
        </Reveal>
        {children}
      </div>
    </section>
  )
}
