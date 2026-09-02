import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { HudPanel } from '@/components/facenet/hud-panel'
import { Registry } from '@/components/facenet/registry'

export const metadata: Metadata = {
  title: 'Proof registry // Dark Veil',
  description:
    'Every face-match record Dark Veil has anchored to Ethereum Sepolia, each one re-verifiable from its own proof page.',
}

export default function RegistryPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.35em] text-primary/70">
          dark veil // registry
        </span>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Anchored records</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every record this deployment has written to Sepolia. Open any row to re-verify its hash
          against the live chain.
        </p>
      </header>

      <HudPanel className="p-5">
        <Registry />
      </HudPanel>

      <a
        href="/"
        className="flex items-center gap-1.5 self-start font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> back to dark veil
      </a>
    </main>
  )
}
