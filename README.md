# FACENET

Detect a face in the browser, find real public matches on the live web, then anchor the
result to Ethereum Sepolia and re-verify it byte for byte.

Nothing here is a mockup: detection runs locally with `face-api`, the reverse search hits
Gemini with Google Search grounding (or Google Lens via SerpAPI), and the anchor is a real
0-value Sepolia transaction whose calldata **is** the keccak256 digest of the record.
Verification reads that calldata back and re-hashes the record independently.

```
photo/webcam ──► face-api (in browser) ──► 128-d embedding
                                   │
                                   ├──► Gemini + Search grounding  ─┐
                                   └──► Google Lens (SerpAPI)       ├──► chosen match
                                                                    │
             canonical JSON ──► keccak256 ──► Sepolia tx calldata ◄──┘
                                                   │
                          re-read calldata ──► compare ──► /proof/<txHash>
```

## The five chapters

| # | Chapter | What actually happens |
|---|---------|----------------------|
| 01 | Capture | TinyFaceDetector at 224px drives a ~10 fps HUD; eye-aspect-ratio blink detection fires the shutter; the captured still gets a full 416px pass with landmarks and descriptors for every face |
| 02 | Encode | The 128-d embedding is drawn as a 16×8 heatmap; enrol it in Neon and match later faces against the gallery by Euclidean distance (threshold 0.6) |
| 03 | Search | The crop — and only the crop — is sent to Gemini or Lens; results are cached in Neon by sha256 of the image so repeat runs cost nothing |
| 04 | Anchor | Record → canonical JSON → keccak256 → Sepolia calldata; the tamper button edits one field and re-verifies so you can watch the check fail |
| 05 | Proof | Every anchor gets a permanent page that re-reads the chain on each visit, with a QR code so another device can confirm it independently |

## Requirements

- Node 20+ and pnpm (or npm)
- A Neon Postgres database
- A Google AI Studio API key
- A Sepolia RPC URL and a throwaway wallet with a little Sepolia ETH
- Optional: a SerpAPI key for the Google Lens path

## Setup

### 1. Install

```bash
npm install        # or pnpm install
```

### 2. Environment

Copy the template and fill it in — `.env.local` is git-ignored, `.env.example` holds no values.

```bash
cp .env.example .env.local
```

| Variable | Required | What it is |
|----------|----------|------------|
| `DATABASE_URL` | yes | Neon **pooled** connection string. Enrollments, the anchor registry, the search cache and the Lens image host all live here. |
| `GEMINI_API_KEY` | yes | [Google AI Studio](https://aistudio.google.com/apikey) key. Drives the vision pass and the Search-grounded reverse lookup. |
| `SEPOLIA_RPC_URL` | yes | Any Sepolia JSON-RPC endpoint (Infura, Alchemy, a public node). Used for reads *and* for broadcasting anchors. |
| `WALLET_PRIVATE_KEY` | yes | Private key of a **throwaway** wallet with a little Sepolia ETH. It signs the anchor transactions. Never point this at a key holding real funds. Get test ETH from [sepoliafaucet.com](https://sepoliafaucet.com). |
| `SERPAPI_KEY` | no | Enables the Google Lens provider. Without it the app runs Gemini-only and the Lens toggle reports the missing key. |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for Open Graph image URLs. Inferred on Vercel; set it for a custom domain or self-hosting. |

Missing keys fail readably rather than silently: the chain and search routes return a JSON
error naming the variable they need, and the message surfaces in the status log. Detection and
encoding never leave the browser, so chapter 01 works with no keys at all and chapter 02 needs
only `DATABASE_URL`.

### 3. Database

The four tables have no migration runner — paste this into the Neon SQL editor once:

```sql
CREATE TABLE IF NOT EXISTS enrollments (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  links       jsonb NOT NULL DEFAULT '[]'::jsonb,
  descriptor  jsonb NOT NULL,
  thumb       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anchors (
  id            serial PRIMARY KEY,
  tx_hash       text NOT NULL UNIQUE,
  record_hash   text NOT NULL,
  record        jsonb NOT NULL,
  identity      text NOT NULL,
  match_url     text,
  from_address  text NOT NULL,
  block_number  bigint,
  network       text NOT NULL DEFAULT 'sepolia',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lens_images (
  image_hash  text PRIMARY KEY,
  mime        text NOT NULL DEFAULT 'image/jpeg',
  data        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_cache (
  image_hash  text PRIMARY KEY,
  provider    text NOT NULL DEFAULT 'gemini',
  result      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

`lens_images` is a short-lived public host: SerpAPI fetches crops by URL, so the bytes are
served from `/api/img/<hash>`. Prune it on whatever schedule suits you — nothing depends on
old rows.

### 4. Run

```bash
npm run dev        # http://localhost:3000
npm run build      # typechecked production build
npm start
```

The webcam needs a secure context. `localhost` counts; a LAN IP does not — use HTTPS or a
tunnel if you want to test the blink capture from a phone.

## How the proof works

The anchored record is a plain object:

```json
{
  "v": 1,
  "identity": "…",
  "confidence": "…",
  "provider": "gemini",
  "match": { "title": "…", "url": "https://…" },
  "faceScore": 0.98,
  "capturedAt": "2026-01-01T00:00:00.000Z"
}
```

`canonicalize()` in `lib/chain.ts` serialises it with sorted keys so the same record always
produces the same bytes, then `keccak256(toUtf8Bytes(...))` gives a 32-byte digest. That
digest is sent as the **calldata** of a 0-value transaction from the signer to itself — no
contract, no storage slot, nothing to deploy. The chain timestamps it for you.

Verification (`/api/verify`, and every visit to a proof page) does the reverse: fetch the
transaction, read `tx.data`, re-hash the stored record locally, compare the two. Three hashes
are shown side by side — the one recorded at anchor time, the one recomputed now, and the one
living in calldata. All three must agree.

The **tamper demo** edits exactly one field (`identity`) and re-verifies. The hash no longer
matches, the check fails, and *that failure is the passing outcome* — the UI and the log
invert their success semantics in tamper mode so a mismatch reads as green.

## API surface

| Route | Purpose |
|-------|---------|
| `POST /api/search` | Gemini vision + Google Search grounding; caches by sha256 of the crop |
| `POST /api/lens` | Google Lens reverse image search via SerpAPI (needs `SERPAPI_KEY`) |
| `GET /api/img/[hash]` | Serves a stored crop so SerpAPI can fetch it by URL |
| `POST /api/enroll` | Store a name + 128-d descriptor + 160px thumbnail |
| `POST /api/match` | Rank the gallery against a descriptor by Euclidean distance |
| `POST /api/anchor` | Hash the record, broadcast the Sepolia tx, persist the anchor |
| `POST /api/verify` | Re-read calldata and compare against a re-hash of the record |
| `GET /api/proof/[txHash]` | Everything a proof page needs, verified server-side |
| `GET /api/registry` | Recent anchors for the registry list |
| `GET /api/block` | Latest Sepolia block for the header ticker |

## Notes for anyone editing this

- **`Scanner` must stay behind `next/dynamic` with `ssr: false`.** `@vladmandic/face-api`
  bundles a TF.js runtime that cannot be evaluated in Node; a static import breaks the
  prerender of `/` with `this.util.TextEncoder is not a constructor`. Type-only imports from
  `lib/face.ts` are fine — they are erased at compile time.
- **CSP allows `'unsafe-inline'` for scripts** (see `next.config.mjs`). Next.js injects inline
  bootstrap scripts, and `'unsafe-eval'` is additionally allowed in development for the
  Turbopack refresh runtime. Tightening this means adopting nonces. `connect-src` is limited
  to self, jsDelivr (face-api weights) and Vercel vitals.
- Model weights are fetched from jsDelivr at runtime. Vendor them into `public/` if you need
  the app to work offline.

## Please read this part

This exists to show how thin the wall between a photograph and a name has become. Point it at
yourself, at public figures, or at images you have permission to search. Identities that reach
the registry are real people, so proof pages are served `noindex`. Anchors are immutable by
design — a Sepolia transaction cannot be recalled once it is mined.


