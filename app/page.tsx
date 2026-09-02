'use client'

import dynamic from 'next/dynamic'
import { ArrowDown, Cpu, ScrollText } from 'lucide-react'
import DecryptedText from '@/components/DecryptedText'
import ShinyText from '@/components/ShinyText'
import { BlockTicker } from '@/components/facenet/block-ticker'
import { ChainPanel } from '@/components/facenet/chain-panel'
import { Chapter } from '@/components/facenet/chapter'
import { EmbeddingHeatmap } from '@/components/facenet/embedding-heatmap'
import { EnrollMatch } from '@/components/facenet/enroll-match'
import { HudPanel } from '@/components/facenet/hud-panel'
import { Registry } from '@/components/facenet/registry'
import { Reveal } from '@/components/facenet/reveal'
import { SearchPanel } from '@/components/facenet/search-panel'
import { StatusLog } from '@/components/facenet/status-log'
import { Stepper } from '@/components/facenet/stepper'
import { scrollToSection, useActiveSection } from '@/lib/hooks'
import { usePipeline } from '@/lib/use-pipeline'
import { cn } from '@/lib/utils'

// face-api pulls in a TF.js runtime that cannot be evaluated during prerender,
// so the scanner is loaded only once there is a real browser.
const Scanner = dynamic(() => import('@/components/facenet/scanner').then((m) => m.Scanner), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-border bg-black/30 font-mono text-xs uppercase tracking-widest text-muted-foreground">
      loading detector…
    </div>
  ),
})

const CHAPTERS = [
  { id: 'capture', label: 'capture' },
  { id: 'encode', label: 'encode' },
  { id: 'search', label: 'search' },
  { id: 'anchor', label: 'anchor' },
  { id: 'proof', label: 'proof' },
] as const

export default function Page() {
  const p = usePipeline()
  const active = useActiveSection([...CHAPTERS.map((c) => c.id), 'log'])
  const descriptor = p.detected?.face.descriptor ?? null

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-primary/10 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={() => scrollToSection('top')}
            className="font-mono text-sm font-bold uppercase tracking-[0.3em] text-wordmark transition-colors hover:text-foreground"
          >
            dark veil
          </button>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {CHAPTERS.map((c, i) => (
              <button
                key={c.id}
                onClick={() => scrollToSection(c.id)}
                className={cn(
                  'rounded-md px-2 py-1 font-mono text-2xs uppercase tracking-widest transition-colors',
                  active === c.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="text-primary/50">{String(i + 1).padStart(2, '0')}</span> {c.label}
              </button>
            ))}
          </nav>
          <BlockTicker className="ml-auto md:ml-0" />
        </div>
      </header>

      <section
        id="top"
        className="mx-auto flex min-h-[78vh] max-w-7xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6"
      >
        <span className="mb-4 flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-xs uppercase tracking-widest text-primary">
          <Cpu className="h-3.5 w-3.5" /> face → web → chain
        </span>
        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          <DecryptedText
            text="DARK VEIL"
            animateOn="view"
            sequential
            speed={45}
            parentClassName="text-wordmark"
            encryptedClassName="text-muted-foreground/60"
          />
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-sm sm:text-base">
          <ShinyText
            text="Detect a face in the browser, find real public matches on the live web, then anchor the result to Ethereum Sepolia — and prove, byte for byte, that nobody edited it afterwards."
            speed={4}
            color="oklch(0.68 0.03 250)"
            shineColor="oklch(0.9 0.02 240)"
          />
        </p>
        <dl className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['in-browser', 'no photo goes to a server for detection'],
            ['128 dims', 'face embedding compared at 0.6'],
            ['on-chain', 'keccak256 digest in tx calldata'],
          ].map(([term, hint]) => (
            <div key={term} className="rounded-lg border border-border bg-black/20 px-3 py-2.5">
              <dt className="font-mono text-xs uppercase tracking-widest text-primary">{term}</dt>
              <dd className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</dd>
            </div>
          ))}
        </dl>
        <button
          onClick={() => scrollToSection('capture')}
          className="mt-12 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowDown className="h-3.5 w-3.5 animate-bounce motion-reduce:animate-none" /> begin
        </button>
      </section>

      <Chapter
        id="capture"
        index="01"
        kicker="chapter one"
        title="Capture a face"
        blurb="Drop a photo or open the webcam. Detection, landmarks and the 128-dimension embedding all run locally with face-api — the image never leaves the browser at this stage. With liveness on, a real blink is what triggers the shutter, which a printed photo cannot fake."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <HudPanel className="p-5 lg:col-span-7">
            <Scanner
              log={p.addLog}
              onDetected={p.onDetected}
              onReset={p.resetDownstream}
              disabled={p.busy}
            />
          </HudPanel>
          <HudPanel className="p-5 lg:col-span-5">
            <h3 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              pipeline
            </h3>
            <Stepper states={p.steps} />
          </HudPanel>
        </div>
      </Chapter>

      <Chapter
        id="encode"
        index="02"
        kicker="chapter two"
        title="Turn the face into numbers"
        blurb="The recognition network reduces the crop to 128 floating-point values. Two photos of the same person land close together in that space; different people land far apart. Enrol the embedding and you can identify the same face again later without keeping a single photograph."
      >
        {descriptor ? (
          <div className="flex flex-col gap-4">
            <Reveal>
              <HudPanel className="p-5">
                <EmbeddingHeatmap descriptor={descriptor} />
              </HudPanel>
            </Reveal>
            <Reveal delay={80}>
              <EnrollMatch
                descriptor={descriptor}
                crop={p.detected?.crop ?? null}
                log={p.addLog}
                disabled={p.busy}
              />
            </Reveal>
          </div>
        ) : (
          <HudPanel className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Capture a face in chapter 01 and its embedding appears here.
            </p>
          </HudPanel>
        )}
      </Chapter>

      <Chapter
        id="search"
        index="03"
        kicker="chapter three"
        title="Find them on the live web"
        blurb="Only now does the crop leave the browser. Google Lens does the actual looking — a reverse image search that finds pages containing this exact face, not only well-known people — and Gemini reads the crop alongside those pages to put a name to it. The citations are Google's, not the model's, so there is nothing for it to invent."
      >
        <HudPanel className="p-5">
          <SearchPanel
            crop={p.detected?.crop ?? null}
            provider={p.provider}
            onProvider={p.setProvider}
            searching={p.searching}
            result={p.result}
            selected={p.selected}
            onSelect={p.setSelected}
            locked={!!p.anchor}
            failed={p.steps.search === 'error'}
            onRun={p.runSearch}
          />
        </HudPanel>
      </Chapter>

      <Chapter
        id="anchor"
        index="04"
        kicker="chapter four"
        title="Anchor it, then try to break it"
        blurb="The chosen match is serialised to canonical JSON and hashed. That digest becomes the calldata of a real Sepolia transaction, so the claim is timestamped by a public chain. Verification reads the calldata back and re-hashes locally — and the tamper button edits one field to show the check actually fails when it should."
      >
        {p.result && p.result.sources.length > 0 ? (
          <HudPanel className="p-5">
            <ChainPanel
              anchor={p.anchor}
              verify={p.verify}
              anchoring={p.anchoring}
              verifying={p.verifying}
              verifyMode={p.verifyMode}
              tamper={p.tamper}
              onAnchor={p.runAnchor}
              onVerify={p.runVerify}
              canAnchor={!!p.selected}
            />
          </HudPanel>
        ) : (
          <HudPanel className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Run the search in chapter 03 and pick a source to unlock anchoring.
            </p>
          </HudPanel>
        )}
      </Chapter>

      <Chapter
        id="proof"
        index="05"
        kicker="chapter five"
        title="Anyone can check the receipt"
        blurb="Every anchor gets a permanent page that re-reads Sepolia on each visit and shows the exact bytes that were hashed. Scan the QR from another device and it verifies there too — the proof does not depend on this site staying online, only on the transaction existing."
      >
        <HudPanel className="p-5">
          <Registry version={p.registryVersion} limit={12} />
          <a
            href="/registry"
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-primary hover:underline"
          >
            <ScrollText className="h-3.5 w-3.5" /> open the full registry
          </a>
        </HudPanel>
      </Chapter>
      <section id="log" className="scroll-mt-24 border-t border-primary/10 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <HudPanel className="h-64 overflow-hidden p-0">
            <StatusLog lines={p.log} />
          </HudPanel>
        </div>
      </section>

      <footer className="border-t border-primary/10 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 text-center sm:px-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60">
            face-api in-browser · google lens · gemini vision · ethereum sepolia
          </p>
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground/50">
            A demonstration of how little friction stands between a photograph and a name. Use it
            on yourself, on public figures, or on images you have permission to search.
          </p>
        </div>
      </footer>
    </>
  )
}
