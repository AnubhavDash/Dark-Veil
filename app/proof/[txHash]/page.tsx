import type { Metadata } from 'next'
import { ProofView } from '@/components/facenet/proof-view'

type Params = { params: Promise<{ txHash: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { txHash } = await params
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`
  return {
    title: `Proof ${short} // Dark Veil`,
    description: `Independently verifiable proof for Sepolia transaction ${txHash}: the anchored record, its canonical JSON, and the keccak256 digest read back from the chain.`,
    robots: { index: false, follow: true },
  }
}

export default async function ProofPage({ params }: Params) {
  const { txHash } = await params

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.35em] text-primary/70">
          dark veil // public proof
        </span>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Anchor verification</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          This page re-reads the transaction from Sepolia every time it loads and re-hashes the
          stored record. Nothing here is cached, and nothing is taken on trust.
        </p>
      </header>

      <ProofView txHash={txHash} />
    </main>
  )
}
