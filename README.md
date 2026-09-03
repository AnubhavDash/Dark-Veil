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
| Face scan input | Webcam or dropped file → an escalating detector cascade, eye-aspect-ratio blink liveness, landmarks, a 128-d descriptor, and a padded crop — all in the browser | `lib/face.ts`, `components/facenet/scanner.tsx` |
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
| 01 | Capture | TinyFaceDetector at 224px drives a ~10 fps HUD; the shutter is a button, or eye-aspect-ratio blink detection if you switch it on; the captured still goes through the detection cascade below, with landmarks and descriptors for every face |
| 02 | Encode | The 128-d embedding is drawn as a 16×8 heatmap; hover a cell to read that dimension's exact value. Two photos of the same person produce visibly similar tiles |
| 03 | Search | The crop — and only the crop — goes to Google Lens for a real reverse image lookup; results are cached in Neon by sha256 of the image so repeat runs cost nothing. Google fetches the crop itself, so this needs a public origin |
| 04 | Anchor | Record → canonical JSON → keccak256 → Sepolia calldata; the tamper button edits one field and re-verifies so you can watch the check fail |
| 05 | Proof | Every anchor gets a permanent page that re-reads the chain on each visit, with a QR code so another device can confirm it independently |

### When the first pass misses

TinyFaceDetector at 416px is fast and handles an ordinary well-lit photo, but it gives up on
grain, dim light, low contrast, backlighting and faces that sit small in a wide frame. Rather
than answer "no face detected" there, `detectFaces()` escalates — seven passes, cheapest first,
stopping at the first that finds something, so a photo that works immediately pays nothing for
the rest:

| # | Pass | For |
|---|------|-----|
| 1 | TinyFaceDetector, 416px, score ≥ 0.4 | ordinary photos — the only pass most images touch |
| 2 | TinyFaceDetector, 800px, score ≥ 0.25 | faces that are small in frame, or slightly washed out |
| 3 | TinyFaceDetector at 800px over a shadow-lifted copy (γ 1.8) | backlit faces — nothing to download, so it goes before the heavy passes |
| 4 | SSD MobileNet v1, confidence ≥ 0.25 | grain, dim light, off-angle heads — 5.6 MB, fetched once and only if needed |
| 5 | SSD MobileNet v1 at 0.2 over a contrast-stretched copy | frames using a fraction of the brightness range |
| 6 | SSD MobileNet v1 at 0.2 over a denoised, contrast-stretched copy | dim *and* grainy webcam frames, where stretching alone amplifies the noise |
| 7 | SSD MobileNet v1 at 0.2 over six overlapping windows | a face too small a part of the frame to survive the detector's own downscale |

Pass 3 exists because passes 5 and 6 cannot help a backlit face. A contrast stretch only has
something to give when the histogram has unused room at both ends, and a bright wall behind
someone's head fills the top of it: on the webcam frame that prompted this, p1 was 6 and p99
was 237, so the stretch worked out to a gain of 1.10 — a no-op — while the face itself sat at
mean 34/255. Gamma needs no headroom, because it remaps every value through `255·(v/255)^(1/γ)`
and the shadows come up on their own. That frame is undetectable raw *and* stretched at every
input size tried (224, 320, 416, 512, 608, 800); at γ 1.8 it scores 0.50 at 800px.

Pass 7 exists because none of the six before it change the one thing that matters when a face is
only a few percent of the frame. Every one of them hands the detector the whole frame, and the
detector's first move is to shrink that frame to its own fixed input — so a head at 4% of a
1600px still arrives about 20px across, with nothing left in it to find. A larger `inputSize`
cannot fix a ratio: on the poster that prompted this pass, all six returned nothing, and the tiny
detector pushed to 1024px only scraped the face at 0.101. Cutting the frame into six overlapping
640×600 windows raises the ratio instead — the same head is 8% of a window, where SSD scores it
0.405 with an eye span of 0.610, and the other five windows return nothing at all. Boxes and
landmarks are shifted back into frame coordinates and a face caught by two windows is
deduplicated, so nothing downstream learns this happened. Six windows are six more chances to
invent a face, so it was checked the other way too: over four images containing no face at all —
three app screenshots and a share card, 24 windows — it produced not one box.

The status log names the pass that succeeded. Measured against the same face crop degraded
five ways, one real frame from a laptop webcam, and one near-black film poster — a single pass
at 416px versus the cascade:

| Frame | Single 416px pass | Cascade |
|-------|-------------------|---------|
| unmodified | found | found · pass 1 |
| dimmed to 60%, light grain | found | found · pass 1 |
| dimmed to 45%, medium grain | found | found · pass 1 |
| dimmed to 28% | **missed** | found · pass 2 |
| black and white, contrast squeezed to a 76-value band | **missed** | found · pass 5 |
| face at 14% of a 1600px frame | **missed** | found · pass 2 |
| real backlit webcam frame, face at mean luminance 34/255 | **missed** | found · pass 3 |
| film poster: side profile, face 3.8% of the frame, 97% of pixels ≤ 8/255 | **missed** | found · pass 7 |
| dimmed to 30% *and* heavy grain (mean luminance 18/255) | **missed** | **missed** |

The last row is the honest floor: at that point the noise is as large as the signal, and a
detector that claims a face there is guessing. Dropping the threshold to 0.1 does produce
"detections" — five of them on a clean single-face crop, which is what fitting noise looks
like — so the cascade stops rather than invent one.

### Why a detection can still be thrown away

The low thresholds those recovery passes need for reach are also what lets junk through. Given
a near-black film poster, the detector boxed the lit head of a hammer, and the pipeline did
what it was told: cropped it, embedded it, and sent it off to be reverse-searched — a wrong
answer presented with exactly as much confidence as a right one.

So a detection that did not score well has to also look like a face, and what tells the two
apart is eye span. Every false box across every frame that has failed here put its outer eye
corners under 0.34 of the box width — 0.23 on the hammer, 0.08 and 0.13 on the junk the windowed
pass turns up — while every true detection of those same faces ran 0.40 to 0.61, at scores as
low as 0.10. Below a score of 0.45, `plausible()` in `lib/face.ts` requires an eye span between
0.38 and 0.85 of the box width, and the log says how many boxes it discarded. A detection that
scores well is never thrown away on geometry — a missed face is the worse failure of the two.

The size floor beside it is 40 pixels of box width, not a share of the frame. An earlier version
demanded 12% of the long edge, which does reject the hammer at 5.6% — and would also have
rejected Thor's actual head, at 3.8% of that same poster. What a share of the frame really
measures is how far away the subject stood, and that is no evidence about whether they are a
face. Pixels are: below roughly 40 of them there is nothing left to recognise anyone from. The
smallest true face measured here is 50 across.

The live webcam loop escalates too, on the same principle: it runs at 224px, and if it finds
nothing for half a second it lifts the shadows and drops its threshold to 0.2. It stays at
224px because that is where the measurement pointed — the backlit frame is found there at 0.28
and at none of 320, 416 or 512.

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
tunnel if you want to test camera capture from a phone.

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
- **Detection has a floor.** The cascade in [When the first pass misses](#when-the-first-pass-misses)
  recovers dim, low-contrast, backlit, black-and-white, small-in-frame and side-profile faces
  that a single pass drops, but a frame that is both very dark and heavily grained stays
  undetected, and so does heavy occlusion. Error rates for face embeddings are also known to vary
  across demographic groups; nothing here corrects for that.
- **Detecting a face is not the same as finding it on the web.** The windowed pass recovers a
  face by cutting a small crop out of a big frame, and small is exactly what Lens has least to
  work with: the poster it was built for yields a 50×92 near-black side profile. The pipeline
  will run end to end on that crop and anchor whatever comes back, including no matches at all.
  A bright, front-facing, reasonably large face is still the only input that reliably reaches
  chapter 04 with a URL.
- **The plausibility filter can discard a real face.** A detection scoring under 0.45 is kept
  only if its box is at least 40px wide and its eyes sit where a face's eyes go. That is what
  stops a bright blob on a dark poster from being cropped and searched as a person, but a
  steeply turned head can fail the eye-span check and be dropped with it. The log says when
  this happens.
- **A recovered face gets a worse embedding.** Passes 3, 5 and 6 detect on a shadow-lifted or
  contrast-stretched (and, in pass 6, blurred) copy, so the 128-d vector for such a face is
  computed from processed pixels. The crop sent to Lens is always cut from the untouched still,
  so only chapter 02 is affected — but two photos of the same person will land further apart if
  one of them needed the fallback.
- **Blink liveness stops a photograph, not a replay.** It is also off until you turn it on —
  the shutter is a button by default. With it on, holding up a still image fails the
  eye-aspect-ratio check; playing a video of someone blinking does not.
- **The enrol/match gallery is not part of the pipeline.** `/api/enroll` and `/api/match` still
  work and still rank descriptors by Euclidean distance at 0.6, but nothing on the page calls
  them: that gallery only ever held faces you enrolled yourself, so it could not identify a
  stranger, and chapters 03–05 never read from it. Chapter 02 is the embedding and nothing
  else. Called directly, enrollment stores a 160px thumbnail alongside the descriptor.
- **Searches are cached by image sha256.** Re-running an identical crop returns the stored
  answer instead of a fresh lookup — cheap, but it means the cache and not Google is what
  answered. Delete the `search_cache` row to force a real search.
- **Model weights load from jsDelivr at runtime.** No network on first load means no detection.
  The three core models are ~7 MB and the fallback detector another 5.6 MB, fetched only the
  first time a photo needs it. Vendor them into `public/` for offline use.

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
- **Captured stills are capped at 1600px on the long edge** by `prepareStill()` before anything
  looks at them. A 12-megapixel phone photo is 12.2M pixels to turn into a tensor and detects
  no better than the 1.9M-pixel copy, because every pass resizes to 800px or less anyway. Files
  go through `createImageBitmap` rather than a `FileReader` base64 round trip, and the webcam
  shutter copies the frame straight into a canvas instead of encoding a full-resolution JPEG.
  Boxes, crops and the on-screen stage all share the capped canvas's coordinate space, so
  raising the cap is fine but detecting on one size and cropping from another is not.
- **Chapters are joined by `.chapter-seam`, not a `border-t`.** A full-width 1px rule read as a
  hard line slicing the page into stacked boxes and cut straight across the backdrop; the
  utility in `app/globals.css` draws a hairline that fades to nothing before either edge plus a
  very faint bloom below it. Both layers sit inside the section's 4rem top padding, so neither
  can wash over the text. `#log` and the footer use it too.
- Model weights are fetched from jsDelivr at runtime. Vendor them into `public/` if you need
  the app to work offline.

## Please read this part

This exists to show how thin the wall between a photograph and a name has become. Point it at
yourself, at public figures, or at images you have permission to search. Identities that reach
the registry are real people, so proof pages are served `noindex`. Anchors are immutable by
design — a Sepolia transaction cannot be recalled once it is mined.


