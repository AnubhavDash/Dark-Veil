'use client'

import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepId, StepState } from '@/lib/types'

const STEPS: { id: StepId; label: string; hint: string }[] = [
  { id: 'scan', label: 'Capture', hint: 'Upload or webcam' },
  { id: 'detect', label: 'Detect', hint: 'Face encoding' },
  { id: 'search', label: 'Web Search', hint: 'Gemini + grounding' },
  { id: 'anchor', label: 'Anchor', hint: 'Write to Sepolia' },
  { id: 'verify', label: 'Verify', hint: 'Re-read from chain' },
]

export function Stepper({ states }: { states: Record<StepId, StepState> }) {
  return (
    <ol className="flex flex-col gap-1">
      {STEPS.map((step, i) => {
        const state = states[step.id]
        return (
          <li key={step.id} className="flex items-stretch gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg border font-mono text-sm transition-colors',
                  state === 'idle' && 'border-border text-muted-foreground/60',
                  state === 'active' && 'border-primary text-primary shadow-glow-cyan',
                  state === 'done' && 'border-primary bg-primary/15 text-primary',
                  state === 'error' && 'border-destructive text-destructive',
                )}
              >
                {state === 'active' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : state === 'done' ? (
                  <Check className="h-4 w-4" />
                ) : state === 'error' ? (
                  <X className="h-4 w-4" />
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    'my-1 w-px flex-1',
                    state === 'done' ? 'bg-primary/50' : 'bg-border',
                  )}
                />
              )}
            </div>
            <div className="pb-4 pt-1">
              <p
                className={cn(
                  'text-sm font-semibold leading-none',
                  state === 'idle' ? 'text-muted-foreground/70' : 'text-foreground',
                )}
              >
                {step.label}
              </p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
                {step.hint}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
