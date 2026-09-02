'use client'

import {
  ExternalLink,
  FileSearch,
  Fingerprint,
  Link2,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BroadcastPulse } from '@/components/facenet/broadcast-pulse'
import { HashReveal } from '@/components/facenet/hash-reveal'
import { cn } from '@/lib/utils'
import type { AnchorResult, TamperInfo, VerifyMode, VerifyResult } from '@/lib/types'

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className={cn('break-all text-xs text-foreground/90', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

function HashField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <HashReveal value={value} />
    </div>
  )
}

type ChainPanelProps = {
  anchor: AnchorResult | null
  verify: VerifyResult | null
  anchoring: boolean
  verifying: boolean
  verifyMode: VerifyMode
  tamper: TamperInfo | null
  onAnchor: () => void
  onVerify: (mode?: VerifyMode) => void
  canAnchor: boolean
}

export function ChainPanel({
  anchor,
  verify,
  anchoring,
  verifying,
  verifyMode,
  tamper,
  onAnchor,
  onVerify,
  canAnchor,
}: ChainPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      {!anchor ? (
        <>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <Fingerprint className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              The selected match is serialised to canonical JSON, hashed with{' '}
              <span className="text-foreground">keccak256</span>, and the 32-byte digest is written
              as the calldata of a real Ethereum <span className="text-foreground">Sepolia</span>{' '}
              transaction — a timestamped anchor nobody can edit after the fact.
            </p>
          </div>
          {anchoring ? (
            <BroadcastPulse active />
          ) : (
            <Button onClick={onAnchor} disabled={!canAnchor} size="lg">
              <Link2 className="h-4 w-4" /> anchor match on-chain
            </Button>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-primary">
            <Link2 className="h-4 w-4" />
            <span className="font-mono text-xs uppercase tracking-widest">anchored · sepolia</span>
            <a
              href={anchor.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              etherscan <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <HashField label="Tx hash" value={anchor.txHash} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Block" value={anchor.blockNumber ? `#${anchor.blockNumber}` : 'pending'} />
            <Field label="Signer" value={`${anchor.from.slice(0, 10)}…${anchor.from.slice(-6)}`} />
          </div>
          <HashField label="Record hash (in calldata)" value={anchor.hash} />
          <a
            href={`/proof/${anchor.txHash}`}
            className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-primary hover:underline"
          >
            <FileSearch className="h-3.5 w-3.5" /> open public proof page
          </a>
        </div>
      )}

      {anchor && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => onVerify('original')}
            disabled={verifying}
            variant={verify && verifyMode === 'original' ? 'outline' : 'default'}
            className="flex-1"
            size="lg"
          >
            {verifying && verifyMode === 'original' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {verify && verifyMode === 'original' ? 're-verify' : 'verify against chain'}
          </Button>
          <Button
            onClick={() => onVerify('tampered')}
            disabled={verifying}
            variant="destructive"
            className="flex-1"
            size="lg"
            title="Edit one field of the anchored record and verify again — the hash should stop matching"
          >
            {verifying && verifyMode === 'tampered' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            tamper demo
          </Button>
        </div>
      )}

      {tamper && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-chart-4/40 bg-chart-4/5 p-3 font-mono text-xs">
          <span className="uppercase tracking-widest text-chart-4">record edited</span>
          <span className="text-muted-foreground">{tamper.field}:</span>
          <span className="text-muted-foreground line-through">{tamper.from}</span>
          <span className="text-chart-4">→ {tamper.to}</span>
          <button
            onClick={() => onVerify('original')}
            disabled={verifying}
            className="ml-auto flex items-center gap-1 uppercase tracking-wider text-primary hover:underline disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" /> restore &amp; re-verify
          </button>
        </div>
      )}

      {verify && (() => {
        // In tamper mode a mismatch is the outcome we are hoping for.
        const expected = verifyMode === 'tampered' ? !verify.match : verify.match
        return (
          <div
            className={cn(
              'flex flex-col gap-3 rounded-lg border p-4',
              expected
                ? 'border-primary/40 bg-primary/5 shadow-glow-cyan'
                : 'border-destructive/50 bg-destructive/5',
            )}
          >
            <div className={cn('flex items-center gap-2', expected ? 'text-primary' : 'text-destructive')}>
              {expected ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              <span className="font-semibold">
                {verifyMode === 'tampered'
                  ? verify.match
                    ? 'Unexpected — the edited record still matches'
                    : 'Tamper detected — hashes no longer agree'
                  : verify.match
                    ? 'Verified — record matches the chain'
                    : 'Mismatch — this record was not what got anchored'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Confirmations" value={String(verify.confirmations)} />
              <Field label="Tx status" value={verify.status} />
            </div>
            <HashField label="Computed locally" value={verify.computedHash} />
            <HashField label="Read from chain" value={verify.onChainHash} />
            <p className="text-xs text-muted-foreground">
              {verify.match
                ? 'Both digests are identical, so the record you are looking at is byte-for-byte the one that was anchored.'
                : 'The digests differ, so the record has changed since it was anchored — the chain copy is the authority.'}
            </p>
          </div>
        )
      })()}
    </div>
  )
}



