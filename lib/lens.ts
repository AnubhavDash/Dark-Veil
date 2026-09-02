import type { LensMatch } from '@/lib/types'

/**
 * Reverse image search against Google Lens, through whichever scraper vendor has a key.
 *
 * Two vendors rather than one because their free tiers fail differently: SearchApi grants a
 * fixed 100 lifetime credits, SerpApi 250 per month that reset. Exhausting one should not
 * take the chapter down, so the caller gets whichever still answers.
 *
 * Both need Google to fetch the crop from a public URL, which is why every entry point here
 * takes an already-hosted `imageUrl` rather than image bytes.
 */

export type LensVendor = 'searchapi' | 'serpapi'

export type LensLookup =
  | { ok: true; vendor: LensVendor; matches: LensMatch[] }
  | { ok: false; status: number; error: string }

/** Vendors with a key present, in preference order: fixed credits first, monthly last. */
export function configuredVendors(): LensVendor[] {
  const out: LensVendor[] = []
  if (process.env.SEARCHAPI_KEY) out.push('searchapi')
  if (process.env.SERPAPI_KEY) out.push('serpapi')
  return out
}

/** True when Google could not possibly reach us, so a Lens call is guaranteed to be wasted. */
export function isLoopback(host: string | null): boolean {
  return /^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(host ?? '')
}

/**
 * Normalises either vendor's match array. Both expose `link`/`title`/`source`, and both put
 * the thumbnail in a slightly different place, so the shapes converge here rather than at
 * two call sites.
 */
function collect(raw: unknown[], limit = 12): LensMatch[] {
  const seen = new Set<string>()
  const out: LensMatch[] = []
  for (const item of raw) {
    const m = item as Record<string, unknown>
    const url = typeof m.link === 'string' ? m.link : null
    if (!url || seen.has(url)) continue
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      continue // a match whose link will not parse is not a citation
    }
    seen.add(url)
    const image = m.image as Record<string, unknown> | undefined
    out.push({
      title: (typeof m.title === 'string' && m.title) || (typeof m.source === 'string' && m.source) || host,
      url,
      source: typeof m.source === 'string' ? m.source : host,
      thumbnail:
        (typeof m.thumbnail === 'string' && m.thumbnail) ||
        (typeof image?.link === 'string' ? image.link : undefined) ||
        undefined,
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * SearchApi.io. Auth goes in a Bearer header rather than `?api_key=` so the key stays out of
 * request URLs and any proxy log. An empty result set arrives as HTTP 200 carrying an `error`
 * string, which is not a failure — only a non-2xx is.
 */
async function viaSearchApi(imageUrl: string, key: string): Promise<LensLookup> {
  const params = new URLSearchParams({ engine: 'google_lens', search_type: 'all', url: imageUrl, hl: 'en' })
  const res = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}) as Record<string, unknown>)
  const err = typeof data.error === 'string' ? data.error : null
  const empty = !!err && /no results|didn't return/i.test(err)
  if (!res.ok || (err && !empty)) {
    return { ok: false, status: res.status === 200 ? 502 : res.status, error: err ?? res.statusText }
  }
  // exact_matches first: a page carrying this identical image is a stronger claim about a face
  // than "looks similar to". search_type=all only fills visual_matches, so this is often empty.
  const raw = [...((data.exact_matches as unknown[]) ?? []), ...((data.visual_matches as unknown[]) ?? [])]
  return { ok: true, vendor: 'searchapi', matches: collect(raw) }
}

/**
 * SerpApi. Only accepts the key as a query parameter, so unlike SearchApi it cannot be kept
 * out of the URL — it is still never logged by us, and the request goes out over TLS.
 */
async function viaSerpApi(imageUrl: string, key: string): Promise<LensLookup> {
  const params = new URLSearchParams({ engine: 'google_lens', url: imageUrl, hl: 'en', api_key: key })
  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}) as Record<string, unknown>)
  const err = typeof data.error === 'string' ? data.error : null
  // SerpApi also reports "hasn't returned any results" as a 200 with an error string.
  const empty = !!err && /no results|hasn't returned|not found/i.test(err)
  if (!res.ok || (err && !empty)) {
    return { ok: false, status: res.status === 200 ? 502 : res.status, error: err ?? res.statusText }
  }
  const raw = [...((data.exact_matches as unknown[]) ?? []), ...((data.visual_matches as unknown[]) ?? [])]
  return { ok: true, vendor: 'serpapi', matches: collect(raw) }
}

/**
 * Tries each configured vendor in turn. A vendor that errors is stepped over — that is the
 * whole point of having two — but a vendor that succeeds with zero matches is believed, since
 * "Google has never seen this image" is a real and common answer for an ordinary face.
 */
export async function lensSearch(imageUrl: string): Promise<LensLookup> {
  const vendors = configuredVendors()
  if (vendors.length === 0) {
    return {
      ok: false,
      status: 500,
      error: 'No reverse-image key set. Add SEARCHAPI_KEY or SERPAPI_KEY in Project Settings → Vars.',
    }
  }

  const failures: string[] = []
  for (const vendor of vendors) {
    const key = vendor === 'searchapi' ? process.env.SEARCHAPI_KEY! : process.env.SERPAPI_KEY!
    try {
      const out = vendor === 'searchapi' ? await viaSearchApi(imageUrl, key) : await viaSerpApi(imageUrl, key)
      if (out.ok) return out
      failures.push(`${vendor}: ${out.error}`)
    } catch (err) {
      failures.push(`${vendor}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { ok: false, status: 502, error: `Lens search failed — ${failures.join('; ')}` }
}
