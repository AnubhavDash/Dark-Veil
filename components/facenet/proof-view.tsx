'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import { HashReveal } from '@/components/facenet/hash-reveal'
import { HudPanel } from '@/components/facenet/hud-panel'
import { cn } from '@/lib/utils'
import type { Proof } from '@/lib/types'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="break-all font-mono text-xs text-foreground/90">{value}</span>
    </div>
  )
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(url).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'copied' : 'copy link'}
    </button>
  )
}

export function ProofView({ txHash }: { txHash: string }) {
  const [proof, setProof] = useState<Proof | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  useEffect(() => {
    setUrl(window.location.href)
    let alive = true
    fetch(`/api/proof/${txHash}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json()
        if (!alive) return
        if (!res.ok) throw new Error(data.error || 'proof unavailable')
        setProof(data)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [txHash])

  if (error) {
    return (
      <HudPanel className="p-6" glow="none">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" />
          <span className="font-semibold">No proof for this transaction</span>
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{error}</p>
      </HudPanel>
    )
  }

  if (!proof) {
    return (
      <div className="flex items-center gap-2 py-16 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" /> reading record and chain…
      </div>
    )
  }

  const verdict =
    proof.match === null ? 'unknown' : proof.match ? 'verified' : 'mismatch'

  return (
    <div className="flex flex-col gap-4">
      <HudPanel
        className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
        glow={verdict === 'verified' ? 'cyan' : 'none'}
      >
        <div
          className={cn(
            'flex items-center gap-3',
            verdict === 'verified'
              ? 'text-primary'
              : verdict === 'mismatch'
                ? 'text-destructive'
                : 'text-chart-4',
          )}
        >
          {verdict === 'verified' ? (
            <ShieldCheck className="h-8 w-8 shrink-0" />
          ) : verdict === 'mismatch' ? (
            <ShieldAlert className="h-8 w-8 shrink-0" />
          ) : (
            <ShieldQuestion className="h-8 w-8 shrink-0" />
          )}
          <div>
            <p className="text-lg font-bold leading-tight">
              {verdict === 'verified'
                ? 'Verified on Sepolia'
                : verdict === 'mismatch'
                  ? 'Hash mismatch'
                  : 'Chain unreachable'}
            </p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {verdict === 'verified'
                ? 'record digest equals the transaction calldata'
                : verdict === 'mismatch'
                  ? 'the stored record no longer hashes to the anchored digest'
                  : (proof.chainError ?? 'could not read the transaction')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <CopyLink url={url} />
          <a
            href={proof.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/10"
          >
            etherscan <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </HudPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HudPanel className="flex flex-col gap-3 p-5 lg:col-span-2" glow="none">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            anchored record
          </h2>
          <Row label="Identity" value={proof.identity} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Row label="Network" value={proof.network} />
            <Row label="Block" value={proof.blockNumber ? `#${proof.blockNumber}` : 'pending'} />
            <Row label="Confirmations" value={String(proof.confirmations)} />
            <Row label="Anchored" value={new Date(proof.anchoredAt).toLocaleString()} />
          </div>
          <Row label="Signer" value={proof.from} />
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Tx hash
            </span>
            <HashReveal value={proof.txHash} />
          </div>
        </HudPanel>

        <HudPanel className="flex flex-col items-center justify-center gap-3 p-5" glow="none">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={url || proof.explorerUrl} size={132} level="M" marginSize={0} />
          </div>
          <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            scan to re-verify
          </p>
        </HudPanel>
      </div>

      <HudPanel className="flex flex-col gap-4 p-5" glow="none">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            hash comparison
          </h2>
          <code className="font-mono text-[10px] text-primary/80">{proof.algorithm}</code>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              stored at anchor time
            </span>
            <HashReveal value={proof.storedHash} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              recomputed from record
            </span>
            <HashReveal value={proof.computedHash} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              read from tx calldata
            </span>
            {proof.onChainHash ? (
              <HashReveal value={proof.onChainHash} />
            ) : (
              <span className="font-mono text-xs text-chart-4">unavailable</span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          All three columns are derived independently: one from the database row, one by hashing the
          record again in this request, and one straight from the Ethereum transaction. Anyone can
          repeat the third step with a public RPC and no trust in this site.
        </p>
      </HudPanel>

      <HudPanel className="flex flex-col gap-3 p-5" glow="none">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          canonical json · the exact bytes that were hashed
        </h2>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/85">
          {proof.canonical}
        </pre>
      </HudPanel>

      <a
        href="/"
        className="flex items-center gap-1.5 self-start font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> back to dark veil
      </a>




    </div>
  )
}

