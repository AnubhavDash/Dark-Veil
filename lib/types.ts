/**
 * One path only: a real Google Lens reverse image lookup. There used to be a second
 * provider that put a vision model in front of these citations, which meant the panel
 * offered a choice between "URLs Google found" and "URLs Google found, plus a name a
 * model guessed" — and the second one could answer with no citations at all.
 */
export type SearchProvider = 'google_lens'

export type Source = {
  url: string
  title: string
  /** Present on Google Lens results. */
  thumbnail?: string
  /** Publisher name, present on Google Lens results. */
  source?: string
}

export type SearchResult = {
  model: string
  identity: string
  confidence: string
  summary: string
  raw: string
  sources: Source[]
  provider?: SearchProvider
  /** sha256 of the crop that was searched — anchored so the record binds both ends. */
  imageHash?: string
  cached?: boolean
}

export type LensMatch = { title: string; url: string; source: string; thumbnail?: string }
export type LensResult = {
  provider: 'google_lens'
  /** Which scraper vendor actually answered — they are tried in order until one does. */
  vendor?: 'searchapi' | 'serpapi'
  identity: string
  matches: LensMatch[]
  imageUrl: string
  /** sha256 of the exact crop bytes Lens was pointed at. */
  imageHash: string
  cached?: boolean
}

export type Enrollment = {
  id: number
  name: string
  links: string[]
  thumb: string | null
  createdAt: string
}

export type MatchCandidate = Enrollment & {
  distance: number
  similarity: number
  isMatch: boolean
}

export type MatchResult = {
  threshold: number
  gallerySize: number
  matches: MatchCandidate[]
  best: MatchCandidate | null
}

export type AnchorResult = {
  txHash: string
  hash: string
  from: string
  blockNumber: number | null
  network: string
  explorerUrl: string
  anchoredAt: string
}

export type VerifyResult = {
  match: boolean
  computedHash: string
  onChainHash: string
  txHash: string
  from: string
  blockNumber: number | null
  confirmations: number
  status: string
  explorerUrl: string
}

export type RegistryEntry = {
  id: number
  txHash: string
  recordHash: string
  identity: string
  matchUrl: string | null
  fromAddress: string
  blockNumber: number | null
  network: string
  createdAt: string
  explorerUrl: string
}

export type Proof = {
  version: number
  network: string
  txHash: string
  explorerUrl: string
  from: string
  blockNumber: number | null
  confirmations: number
  anchoredAt: string
  identity: string
  record: Record<string, unknown>
  canonical: string
  algorithm: string
  storedHash: string
  computedHash: string
  onChainHash: string | null
  match: boolean | null
  chainError: string | null
}

/** Latest Sepolia block, polled for the header ticker. */
export type BlockInfo = {
  number: number | null
  timestamp: number | null
  txCount: number
  gasUsed: string
}

/** Which record a verification ran against — the real one, or a deliberately edited copy. */
export type VerifyMode = 'original' | 'tampered'

export type TamperInfo = { field: string; from: string; to: string }

export type LogLevel = 'info' | 'ok' | 'warn' | 'error'
export type LogLine = { t: number; level: LogLevel; msg: string }

export type StepId = 'scan' | 'detect' | 'search' | 'anchor' | 'verify'
export type StepState = 'idle' | 'active' | 'done' | 'error'
