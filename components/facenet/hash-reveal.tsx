'use client'

import DecryptedText from '@/components/DecryptedText'
import { cn } from '@/lib/utils'

/**
 * Scrambles a hex digest into place. Keyed on the value so a new hash always
 * re-runs the animation instead of silently swapping characters.
 */
export function HashReveal({
  value,
  className,
  speed = 10,
}: {
  value: string
  className?: string
  speed?: number
}) {
  return (
    <DecryptedText
      key={value}
      text={value}
      animateOn="view"
      sequential
      speed={speed}
      characters="0123456789abcdef"
      parentClassName={cn('break-all font-mono text-xs', className)}
      className="text-foreground/90"
      encryptedClassName="text-primary/45"
    />
  )
}
