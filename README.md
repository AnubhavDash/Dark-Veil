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
                                             chosen match
                                                    │
             canonical JSON ──► keccak256 ──► Sepolia tx calldata ◄┘
                                                   │
                          re-read calldata ──► compare ──► /proof/<txHash>
```

Citations come from Lens, never from a model. That ordering is the point: a model shown a
face will guess a name and then look for pages that agree with its guess, which is how
confident fabrications about real people get made. Lens matches the pixels, so the URLs are
pages Google found carrying this image — there is no step where a name gets invented.

## Where each stage lives

| Stage | What actually runs | Code |
|-------|--------------------|------|
| Face scan input | Webcam or dropped file → TinyFaceDetector, eye-aspect-ratio blink liveness, landmarks, a 128-d descriptor, and a padded crop — all in the browser | `lib/face.ts`, `components/facenet/scanner.tsx` |
| Web / social search | The crop is hosted at a public URL, then Google Lens is queried through SearchApi with SerpApi behind it. Every result is a URL Google returned for those pixels | `lib/lens.ts`, `app/api/lens/route.ts`, `app/api/img/[hash]/route.ts` |
| Blockchain record | Chosen match → canonical JSON → keccak256 → the calldata of a real 0-value Sepolia transaction | `lib/chain.ts`, `app/api/anchor/route.ts` |
| Re-verification | Re-read that calldata from the chain, re-hash the stored record locally, compare all three hashes | `app/api/verify/route.ts`, `app/api/proof/[txHash]/route.ts` |

Which chain and why calldata: [Which blockchain](#which-blockchain). What this cannot do:
[Known limitations](#known-limitations).

### A real anchor, if you would rather not run anything

Sepolia transaction
[`0x16b9043f…6316c7`](https://sepolia.etherscan.io/tx/0x16b9043fa3844ed31526ad912879a3799cde5d4fb4f490ba8b4bf5b21b6316c7),
block 11622395. Its calldata is
`0x591afbe640a9b481fd40e811ab2dd05c9512d00623efeb6ff24e59c5726805ee` — the keccak256 of the
canonical JSON of a record whose match came back from a live Lens lookup that returned 12 real
URLs. Open
[`/proof/0x16b9043f…`](https://dark-veil.vercel.app/proof/0x16b9043fa3844ed31526ad912879a3799cde5d4fb4f490ba8b4bf5b21b6316c7)
and the page re-reads the chain, re-hashes the record and shows all three hashes agreeing. No
install, no keys.

## The five chapters

| # | Chapter | What actually happens |
|---|---------|----------------------|
| 01 | Capture | TinyFaceDetector at 224px drives a ~10 fps HUD; eye-aspect-ratio blink detection fires the shutter; the captured still gets a full 416px pass with landmarks and descriptors for every face |
| 02 | Encode | The 128-d embedding is drawn as a 16×8 heatmap; hover a cell to read that dimension's exact value. Two photos of the same person produce visibly similar tiles |
| 03 | Search | The crop — and only the crop — goes to Google Lens for a real reverse image lookup; results are cached in Neon by sha256 of the image so repeat runs cost nothing. Google fetches the crop itself, so this needs a public origin |
| 04 | Anchor | Record → canonical JSON → keccak256 → Sepolia calldata; the tamper button edits one field and re-verifies so you can watch the check fail |
| 05 | Proof | Every anchor gets a permanent page that re-reads the chain on each visit, with a QR code so another device can confirm it independently |

## Requirements

- Node 20+ and pnpm (or npm)
- A Neon Postgres database
- A Sepolia RPC URL and a throwaway wallet with a little Sepolia ETH
- A SearchApi.io key, a SerpApi key, or both — chapter 03 does not run without one

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
| `SEPOLIA_RPC_URL` | yes | Any Sepolia JSON-RPC endpoint. `https://ethereum-sepolia-rpc.publicnode.com` is free and needs no signup; Infura or Alchemy are steadier under load. Used for reads *and* for broadcasting anchors. |
| `WALLET_PRIVATE_KEY` | yes | Private key of a **throwaway** wallet with a little Sepolia ETH. It signs the anchor transactions. Never point this at a key holding real funds. `npm run wallet:new` generates one into `.env.local` without printing it, then fund the address it shows from the [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) — unlike Alchemy's and Chainstack's, it does not require a mainnet ETH balance. |
| `SEARCHAPI_KEY` | one of these two | [SearchApi.io](https://www.searchapi.io/) key — 100 credits, one time. First choice for the Lens lookup. |
| `SERPAPI_KEY` | one of these two | [SerpApi](https://serpapi.com/) key — 250 searches/month, resets. Used when SearchApi is missing or errors, so one exhausted vendor does not take chapter 03 down. |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for Open Graph image URLs. Inferred on Vercel; set it for a custom domain or self-hosting. |

Missing keys fail readably rather than silently: every route that needs a variable returns a
JSON error naming it, and the message surfaces in the status log. Detection and
encoding never leave the browser, so chapter 01 works with no keys at all and chapter 02 needs
only `DATABASE_URL`.

### Why chapter 03 needs a deployed origin

Google fetches the crop from `/api/img/<hash>` itself, so **Lens cannot work on `localhost`** —
`/api/lens` returns 409 naming the unreachable URL before spending a credit, and the status log
shows that message. That also means chapter 04 has no match URL to anchor locally. Deploy, or
run a tunnel, to exercise 03 through 05 end to end.

A Lens lookup that succeeds with zero matches is believed rather than papered over: "Google has
never indexed this image" is the ordinary answer for an ordinary face, and the panel says so
instead of producing a name from nowhere.

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
  provider    text NOT NULL DEFAULT 'google_lens',
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

## Which blockchain

**Ethereum Sepolia** — the public proof-of-stake testnet, chain ID 11155111. Reads and writes
both go through `SEPOLIA_RPC_URL`, transactions are signed locally from `WALLET_PRIVATE_KEY`,
and every anchor is visible on [sepolia.etherscan.io](https://sepolia.etherscan.io).

No contract is deployed and nothing is stored on chain but the digest. An anchor is a 0-value
transaction from the signing wallet to its own address whose **calldata** is the 32-byte
keccak256 hash — the cheapest write on Ethereum that is still permanent, publicly readable and
timestamped by consensus. A faucet drip covers hundreds of runs.

Sepolia rather than mainnet because the demonstration is byte-for-byte identical and the ETH is
free; pointing the same code at mainnet is one environment variable. What that choice costs is
in [Known limitations](#known-limitations).

## How the proof works

The anchored record is a plain object:

```json
{
  "v": 1,
  "identity": "…",
  "confidence": "…",
  "provider": "google_lens",
  "match": { "title": "…", "url": "https://…" },
  "faceScore": 0.98,
  "imageHash": "e3b0c44298fc1c14…",
  "capturedAt": "2026-01-01T00:00:00.000Z"
}
```

`imageHash` is the sha256 of the exact crop bytes that were searched — the same hash the crop
was hosted under at `/api/img/<hash>`. It is what makes the anchor bind *both* ends of the
pipeline: without it the digest only commits to the page that was found, and nothing ties that
page back to the face that went looking for it.

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
| `POST /api/lens` | Google Lens reverse image search — SearchApi first, SerpApi as fallback; caches by sha256 of the crop |
| `GET /api/img/[hash]` | Serves a stored crop so Google Lens can fetch it by URL |
| `POST /api/enroll` | Store a name + 128-d descriptor + 160px thumbnail — kept, but no longer called by the page |
| `POST /api/match` | Rank the gallery against a descriptor by Euclidean distance — kept, but no longer called by the page |
| `POST /api/anchor` | Hash the record, broadcast the Sepolia tx, persist the anchor |
| `POST /api/verify` | Re-read calldata and compare against a re-hash of the record |
| `GET /api/proof/[txHash]` | Everything a proof page needs, verified server-side |
| `GET /api/registry` | Recent anchors for the registry list |
| `GET /api/block` | Latest Sepolia block for the header ticker |

## Known limitations

- **Chapter 03 cannot run on `localhost`.** Google fetches the crop from `/api/img/<hash>`
  itself, so the origin has to be reachable from the internet. `/api/lens` returns 409 naming
  the URL it could not reach rather than spending a vendor credit. Deploy, or tunnel.
- **Lens only finds images Google has already indexed.** A face that has never been posted
  publicly comes back with zero matches, and that is the ordinary outcome rather than a
  failure — nothing is invented to fill the gap. It does mean chapter 04 has no URL to anchor
  for such a face.
- **Results are web pages, not specifically social media posts.** Whatever Lens returns is what
  you get; there is no domain filter and no per-platform ranking, so a run can come back with
  news, blog or stock-photo pages and no social profile among them.
- **Nothing here asserts a name.** `identity` in the record is a status — `Visual matches
  found` or `No visual matches`. Any actual name lives in the matched page's own title, put
  there by whoever published it. There is deliberately no step that infers who someone is.
- **The anchor proves integrity, not truth.** It shows this record existed in exactly this form
  at this block height, signed by this key. It says nothing about whether the match is the
  right person, and anyone can anchor anything.
- **One wallet signs every anchor.** Whoever holds `WALLET_PRIVATE_KEY` can write records
  indistinguishable from the app's own. Use a throwaway key with nothing but faucet ETH.
- **Sepolia is a testnet.** Its history carries no guarantee as long-lived as mainnet's —
  testnets do get deprecated. The permanence claim is only as strong as the network you point
  the code at.
- **Detection is tuned for speed.** TinyFaceDetector at 224px for the live HUD and 416px for
  the still misses profile views, heavy occlusion and low light. Error rates for face
  embeddings are also known to vary across demographic groups; nothing here corrects for that.
- **Blink liveness stops a photograph, not a replay.** Holding up a still image fails the
  eye-aspect-ratio check. Playing a video of someone blinking does not.
- **The enrol/match gallery is not part of the pipeline.** `/api/enroll` and `/api/match` still
  work and still rank descriptors by Euclidean distance at 0.6, but nothing on the page calls
  them: that gallery only ever held faces you enrolled yourself, so it could not identify a
  stranger, and chapters 03–05 never read from it. Chapter 02 is the embedding and nothing
  else. Called directly, enrollment stores a 160px thumbnail alongside the descriptor.
- **Searches are cached by image sha256.** Re-running an identical crop returns the stored
  answer instead of a fresh lookup — cheap, but it means the cache and not Google is what
  answered. Delete the `search_cache` row to force a real search.
- **Model weights load from jsDelivr at runtime.** No network on first load means no detection.
  Vendor them into `public/` for offline use.

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


