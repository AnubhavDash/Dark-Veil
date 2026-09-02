export type SearchProvider = 'gemini' | 'google_lens'

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
  cached?: boolean
  imageHash?: string
}

export type LensMatch = { title: string; url: string; source: string; thumbnail?: string }
export type LensResult = {
  provider: 'google_lens'
  identity: string
  matches: LensMatch[]
  imageUrl: string
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
