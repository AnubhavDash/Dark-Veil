# Dark Veil

Detect a face in the browser, find real public matches on the live web, then anchor the
result to Ethereum Sepolia and re-verify it byte for byte.

Nothing here is a mockup: detection runs locally with `face-api`, the reverse search is a real
Google Lens lookup, and the anchor is a real 0-value Sepolia transaction whose calldata **is**
the keccak256 digest of the record. Verification reads that calldata back and re-hashes the
record independently.

```
photo/webcam ──► face-api (in browser) ──► 128-d embedding
                                   │
                                   └──► Google Lens (SearchApi / SerpApi)
                                                    │  real URLs
                                                    ▼
                                        Gemini vision names the face ──► chosen match
                                                                              │
             canonical JSON ──► keccak256 ──► Sepolia tx calldata ◄────────────┘
                                                   │
                          re-read calldata ──► compare ──► /proof/<txHash>
```

Citations come from Lens, never from the model. That ordering is the point: a model shown a
face will guess a name and then look for pages that agree with its guess, which is how
confident fabrications about real people get made. Lens matches the pixels, so the URLs exist
before any model sees them.

## The five chapters

| # | Chapter | What actually happens |
|---|---------|----------------------|
| 01 | Capture | TinyFaceDetector at 224px drives a ~10 fps HUD; eye-aspect-ratio blink detection fires the shutter; the captured still gets a full 416px pass with landmarks and descriptors for every face |
| 02 | Encode | The 128-d embedding is drawn as a 16×8 heatmap; enrol it in Neon and match later faces against the gallery by Euclidean distance (threshold 0.6) |
| 03 | Search | The crop — and only the crop — goes to Google Lens for a real reverse image lookup, then Gemini reads the crop plus those pages and names the person; results are cached in Neon by sha256 of the image so repeat runs cost nothing |
| 04 | Anchor | Record → canonical JSON → keccak256 → Sepolia calldata; the tamper button edits one field and re-verifies so you can watch the check fail |
| 05 | Proof | Every anchor gets a permanent page that re-reads the chain on each visit, with a QR code so another device can confirm it independently |

## Requirements

- Node 20+ and pnpm (or npm)
- A Neon Postgres database
- A Google AI Studio API key
- A Sepolia RPC URL and a throwaway wallet with a little Sepolia ETH
- For real citations: a SearchApi.io key, a SerpApi key, or both

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
| `GEMINI_API_KEY` | yes | [Google AI Studio](https://aistudio.google.com/apikey) key. Names the face. Grounding is a **paid** feature on Gemini 3.x — the free tier lists it as "Not available" — so the route probes once, logs the fallback and continues ungrounded. Enabling billing later needs no code change. |
| `SEPOLIA_RPC_URL` | yes | Any Sepolia JSON-RPC endpoint. `https://ethereum-sepolia-rpc.publicnode.com` is free and needs no signup; Infura or Alchemy are steadier under load. Used for reads *and* for broadcasting anchors. |
| `WALLET_PRIVATE_KEY` | yes | Private key of a **throwaway** wallet with a little Sepolia ETH. It signs the anchor transactions. Never point this at a key holding real funds. `npm run wallet:new` generates one into `.env.local` without printing it, then fund the address it shows from the [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) — unlike Alchemy's and Chainstack's, it does not require a mainnet ETH balance. |
| `SEARCHAPI_KEY` | no | [SearchApi.io](https://www.searchapi.io/) key — 100 credits, one time. First choice for the Lens lookup. |
| `SERPAPI_KEY` | no | [SerpApi](https://serpapi.com/) key — 250 searches/month, resets. Used when SearchApi is missing or errors, so one exhausted vendor does not take chapter 03 down. |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for Open Graph image URLs. Inferred on Vercel; set it for a custom domain or self-hosting. |

Missing keys fail readably rather than silently: every route that needs a variable returns a
JSON error naming it, and the message surfaces in the status log. Detection and
encoding never leave the browser, so chapter 01 works with no keys at all and chapter 02 needs
only `DATABASE_URL`.

### Where citations come from, and when there are none

Chapter 03 reports which of three modes produced a result, because they are not equally
trustworthy:

| Mode | Citations | When |
|------|-----------|------|
| `evidence` | Real Lens URLs | A public origin with at least one Lens key — the normal path |
| `grounded` | Gemini's own Search citations | Only if the Gemini key has billing enabled |
| `vision` | **None** | No Lens key, or a loopback origin |

Google fetches the crop from `/api/img/<hash>` itself, so **Lens cannot work on `localhost`** —
`/api/lens` returns 409 naming the unreachable URL before spending a credit, and `/api/search`
drops to `vision`. In that mode the model is told it has no web access and must emit no URLs,
so you get a name with nothing to click. That also means chapter 04 has no match URL to anchor
locally. Deploy, or run a tunnel, to exercise 03 through 05 end to end.

### 3. Database

With `DATABASE_URL` in place, create the four tables:

```bash
npm run db:setup
```

It is idempotent — every statement is `IF NOT EXISTS`, so re-running just reports the row
counts. If you would rather not run a script, paste this into the Neon SQL editor instead:

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

`lens_images` is a short-lived public host: Google Lens fetches crops by URL, so the bytes are
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
| `POST /api/search` | Lens supplies the URLs, Gemini names the face; caches by sha256 of the crop |
| `POST /api/lens` | Raw Google Lens reverse image search — SearchApi first, SerpApi as fallback |
| `GET /api/img/[hash]` | Serves a stored crop so Google Lens can fetch it by URL |
| `POST /api/enroll` | Store a name + 128-d descriptor + 160px thumbnail |
| `POST /api/match` | Rank the gallery against a descriptor by Euclidean distance |
| `POST /api/anchor` | Hash the record, broadcast the Sepolia tx, persist the anchor |
| `POST /api/verify` | Re-read calldata and compare against a re-hash of the record |
| `GET /api/proof/[txHash]` | Everything a proof page needs, verified server-side |
| `GET /api/registry` | Recent anchors for the registry list |
| `GET /api/block` | Latest Sepolia block for the header ticker |

## Notes for anyone editing this

- **The type scale lives in `@theme` in `app/globals.css`**, including two steps below
  `text-xs` (`text-2xs`, `text-3xs`) for the mono HUD labels. Use those tokens rather than
  arbitrary `text-[11px]` values — the whole scale was once ~70 hardcoded pixel sizes that
  could not be retuned together. Tailwind's line-heights are unitless ratios, so leading
  follows the size automatically. Do not scale type by changing the root font size: Tailwind's
  spacing scale is rem-based too, so that resizes every padding and gap along with it.
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


