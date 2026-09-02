'use client'

import { useCallback, useState } from 'react'
import type { FaceResult } from '@/lib/face'
import type {
  AnchorResult,
  LensResult,
  LogLevel,
  LogLine,
  SearchProvider,
  SearchResult,
  Source,
  StepId,
  StepState,
  TamperInfo,
  VerifyMode,
  VerifyResult,
} from '@/lib/types'

export type Detected = { face: FaceResult; crop: string; total: number; index: number }

const initialSteps: Record<StepId, StepState> = {
  scan: 'idle',
  detect: 'idle',
  search: 'idle',
  anchor: 'idle',
  verify: 'idle',
}

/** Reshapes a Google Lens payload into the same view model the Gemini panel renders. */
function lensToSearch(r: LensResult): SearchResult {
  return {
    model: `google lens · ${r.vendor ?? 'searchapi'}`,
    identity: r.identity,
    confidence: r.matches.length ? 'Visual' : 'Low',
    summary: `Reverse image search returned ${r.matches.length} visual match${
      r.matches.length === 1 ? '' : 'es'
    } for this crop. Lens matches pages that contain the image itself, so it works on anyone who appears on the public web — not only public figures.`,
    raw: JSON.stringify(r.matches, null, 2),
    sources: r.matches.map((m) => ({
      url: m.url,
      title: m.title,
      thumbnail: m.thumbnail,
      source: m.source,
    })),
    provider: 'google_lens',
    mode: 'evidence',
    cached: r.cached,
  }
}

/** The tamper demo edits exactly one field of the record that was hashed. */
function tamperRecord(record: Record<string, unknown>): {
  record: Record<string, unknown>
  info: TamperInfo
} {
  const from = typeof record.identity === 'string' ? record.identity : String(record.identity)
  const to = from === 'Unidentified' ? 'Someone Else' : `Not ${from}`
  return { record: { ...record, identity: to }, info: { field: 'identity', from, to } }
}

/**
 * Every piece of pipeline state, in one place: capture → encode → search → anchor →
 * verify. The page is then only layout.
 */
export function usePipeline() {
  const [log, setLog] = useState<LogLine[]>([])
  const [steps, setSteps] = useState<Record<StepId, StepState>>(initialSteps)

  const [detected, setDetected] = useState<Detected | null>(null)

  const [provider, setProvider] = useState<SearchProvider>('gemini')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [selected, setSelected] = useState<Source | null>(null)

  const [anchoring, setAnchoring] = useState(false)
  const [anchor, setAnchor] = useState<AnchorResult | null>(null)
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)

  const [verifying, setVerifying] = useState(false)
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [verifyMode, setVerifyMode] = useState<VerifyMode>('original')
  const [tamper, setTamper] = useState<TamperInfo | null>(null)

  /** Bumped after every successful anchor so the registry refetches. */
  const [registryVersion, setRegistryVersion] = useState(0)

  const addLog = useCallback((level: LogLevel, msg: string) => {
    setLog((prev) => [...prev, { t: Date.now(), level, msg }])
  }, [])

  const setStep = useCallback((id: StepId, state: StepState) => {
    setSteps((prev) => ({ ...prev, [id]: state }))
  }, [])

  const resetDownstream = useCallback(() => {
    setDetected(null)
    setResult(null)
    setSelected(null)
    setAnchor(null)
    setRecord(null)
    setVerify(null)
    setVerifyMode('original')
    setTamper(null)
    setSteps(initialSteps)
  }, [])

  const onDetected = useCallback(
    (data: Detected) => {
      setDetected(data)
      setStep('scan', 'done')
      setStep('detect', 'done')
    },
    [setStep],
  )

  /** Reverse-search the crop with whichever provider is selected. */
  const runSearch = useCallback(async () => {
    if (!detected) return
    const lens = provider === 'google_lens'
    setSearching(true)
    setStep('search', 'active')
    setResult(null)
    setSelected(null)
    addLog(
      'info',
      lens
        ? 'uploading crop and querying Google Lens for visual matches…'
        : 'querying Gemini vision, with Google Lens supplying the citations…',
    )
    try {
      const res = await fetch(lens ? '/api/lens' : '/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: detected.crop }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'search failed')

      const next: SearchResult = lens ? lensToSearch(data as LensResult) : { ...data, provider: 'gemini' }
      setResult(next)
      setStep('search', 'done')
      if (next.cached) addLog('info', 'cache hit — served from Neon, no API credits spent')
      addLog('ok', `${next.identity} · ${next.confidence} · ${next.sources.length} sources`)
      if (next.sources.length > 0) {
        setSelected(next.sources[0])
        addLog('info', `auto-selected top source: ${next.sources[0].url}`)
      } else if (next.mode === 'vision') {
        // Nothing was fabricated to fill the gap, which is the point — but it does mean
        // chapter 04 has no URL to anchor, so say why rather than leaving it looking broken.
        addLog(
          'warn',
          'no citations: this origin cannot be reached by Google, so the answer is from the crop alone',
        )
      } else {
        addLog('warn', 'no public web sources returned for this face')
      }
    } catch (err) {
      setStep('search', 'error')
      addLog('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }, [addLog, detected, provider, setStep])

  /** Hash the chosen match and write the digest into Sepolia calldata. */
  const runAnchor = useCallback(async () => {
    if (!result || !selected || !detected) return
    setAnchoring(true)
    setStep('anchor', 'active')
    setVerify(null)
    setVerifyMode('original')
    setTamper(null)
    setStep('verify', 'idle')

    const next = {
      v: 1,
      identity: result.identity,
      confidence: result.confidence,
      provider: result.provider ?? 'gemini',
      match: { title: selected.title, url: selected.url },
      faceScore: Number(detected.face.score.toFixed(4)),
      capturedAt: new Date().toISOString(),
    }

    addLog('info', 'hashing record (keccak256 over canonical JSON) and broadcasting…')
    try {
      const res = await fetch('/api/anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'anchor failed')
      setAnchor(data)
      setRecord(next)
      setStep('anchor', 'done')
      setRegistryVersion((v) => v + 1)
      addLog('ok', `anchored · tx ${data.txHash}`)
      addLog('info', `block #${data.blockNumber} · hash ${data.hash.slice(0, 18)}…`)
    } catch (err) {
      setStep('anchor', 'error')
      addLog('error', err instanceof Error ? err.message : String(err))
    } finally {
      setAnchoring(false)
    }
  }, [addLog, detected, result, selected, setStep])

  /**
   * Re-reads the transaction calldata and recomputes the hash locally. In
   * `tampered` mode one field of the record is edited first, which is what makes
   * the mismatch demonstrable rather than just claimed.
   */
  const runVerify = useCallback(
    async (mode: VerifyMode = 'original') => {
      if (!anchor || !record) return
      const payload = mode === 'tampered' ? tamperRecord(record) : null
      const target = payload ? payload.record : record

      setVerifying(true)
      setVerifyMode(mode)
      setTamper(payload?.info ?? null)
      setStep('verify', 'active')

      if (payload) {
        addLog(
          'warn',
          `tamper demo: ${payload.info.field} "${payload.info.from}" → "${payload.info.to}" — re-verifying`,
        )
      } else {
        addLog('info', 're-reading tx calldata from Sepolia and recomputing hash…')
      }

      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: anchor.txHash, record: target }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'verify failed')
        setVerify(data)

        if (mode === 'tampered') {
          // A mismatch here is the expected, successful outcome of the demo.
          setStep('verify', data.match ? 'error' : 'done')
          addLog(
            data.match ? 'error' : 'ok',
            data.match
              ? 'unexpected: the edited record still hashed to the on-chain value'
              : 'HASH MISMATCH — the edit was detected, exactly as it should be',
          )
        } else {
          setStep('verify', data.match ? 'done' : 'error')
          addLog(
            data.match ? 'ok' : 'error',
            data.match ? 'HASH MATCH — record is authentic' : 'HASH MISMATCH',
          )
        }
      } catch (err) {
        setStep('verify', 'error')
        addLog('error', err instanceof Error ? err.message : String(err))
      } finally {
        setVerifying(false)
      }
    },
    [addLog, anchor, record, setStep],
  )

  const busy = searching || anchoring || verifying

  return {
    // capture
    log,
    addLog,
    steps,
    detected,
    onDetected,
    resetDownstream,
    // search
    provider,
    setProvider,
    searching,
    result,
    selected,
    setSelected,
    runSearch,
    // chain
    anchoring,
    anchor,
    record,
    runAnchor,
    verifying,
    verify,
    verifyMode,
    tamper,
    runVerify,
    // misc
    registryVersion,
    busy,
  }
}

export type Pipeline = ReturnType<typeof usePipeline>





