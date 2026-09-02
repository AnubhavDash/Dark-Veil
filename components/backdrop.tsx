'use client'

import dynamic from 'next/dynamic'

// WebGL CPPN backdrop — client only, and never server-rendered. `ssr: false` is
// not allowed in a Server Component, which is the reason this wrapper exists:
// the layout is a server component and cannot hold the dynamic import itself.
const DarkVeil = dynamic(() => import('@/components/DarkVeil'), { ssr: false })

/**
 * The site backdrop, mounted once in the root layout so /registry and
 * /proof/<txHash> sit on the same field the home page does instead of on flat
 * background.
 *
 * Two separate things used to confine the flame to the top of the screen.
 *
 * The scrim was a vertical gradient ending at a fully opaque `background`, and
 * because this layer is fixed that opaque end sat at the bottom of the viewport
 * at *every* scroll position — so the veil could only ever be seen in the upper
 * part of the screen no matter how far down the page you were. On a 1440x1000
 * frame it took the top three tenths from 21/55/40% lit pixels to 2.2/0/0.6%.
 * It is a flat wash now, tuned so the dimmest text colour still clears 4.5:1
 * against the 98th-percentile backdrop pixel (measured 5.7:1).
 *
 * The other half is that the network is not uniformly interesting. Sampled over
 * a window twice the stock size, everything it lights sits in one blob around
 * x∈[-0.7,1.1] y∈[-1.2,-0.2], and the stock framing put that blob in the top
 * 40% of the canvas with flat black under it. zoom/center crop to the blob, which
 * flattens the vertical profile from a 250x top-to-bottom falloff to about 4x.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <DarkVeil
        hueShift={220}
        noiseIntensity={0.02}
        scanlineIntensity={0.06}
        speed={0.4}
        warpAmount={0.6}
        zoom={2}
        centerX={0.5}
        centerY={-0.7}
      />
      <div className="absolute inset-0 bg-background/70" />
    </div>
  )
}
