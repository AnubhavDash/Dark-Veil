'use client'

import { useEffect, useState } from 'react'
import { scrollParentOf } from '@/lib/hooks'

/**
 * A pre-rendered turntable bound to page scroll: the head starts with its back
 * to you and has turned a full 180° to face you by the bottom of the page.
 *
 * Frames are baked, not live 3D. The site already ships one WebGL context for
 * the backdrop and a TF.js runtime for the detector; a second renderer would
 * compete with both for the GPU while the camera is running, and the path
 * tracer buys soft shadows and subsurface scattering that a real-time shader
 * cannot match anyway. 48 stills at 727x620 come to 891 KB — less than a mesh
 * plus a loader — and scrubbing them is a `drawImage` per changed frame.
 *
 * Deliberately drawn to one canvas rather than stacked <img> layers: the swap
 * has to be hard, since a crossfade between two turntable steps reads as a
 * double exposure.
 */
const FRAMES = 48
// Frame size is the union of the per-frame alpha boxes over the whole turn, not
// a round number: the snout sweeps a wide arc, so the sequence needs a landscape
// box even though any single pose is portrait. Cropping to one fixed box rather
// than per-frame boxes is what keeps the head from jittering between frames.
const W = 727
const H = 620

/** Pose used when motion is suppressed: ~153°, the strongest three-quarter. */
const STILL = 40

/** Share of the gap closed per tick. Low enough that a wheel flick reads as a
 *  turn rather than a jump cut, high enough not to lag behind a drag. */
const DAMP = 0.12

/** Fraction of the scroll the turn is spread over. Short of 1 on purpose: the
 *  face-on pose is the point of the sequence, and mapping the last degree onto
 *  the final pixel of the document hands it to nobody — the bottom of a page is
 *  where people stop early, and a page that grows as panels fill would otherwise
 *  keep walking the target backwards. It holds at 180° through the remainder. */
const SCRUB_END = 0.9

const frameSrc = (i: number) => `/venom/f${String(i).padStart(3, '0')}.webp`

export function VenomTurn() {
  // Desktop only, and this gates the fetch as well as the paint — 48 frames is
  // not a payload to hand a phone for an ornament it never shows.
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return wide ? <Turntable /> : null
}

function Turntable() {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d')
    const scroller = scrollParentOf(host)
    if (!ctx || !scroller) return

    const frames: (HTMLImageElement | null)[] = new Array(FRAMES).fill(null)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let alive = true
    let drawn = -1

    const draw = (i: number) => {
      const img = frames[i]
      if (!img || drawn === i) return
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(img, 0, 0, W, H)
      drawn = i
      host.style.opacity = '1'
    }

    const load = (i: number) =>
      new Promise<void>((resolve) => {
        const img = new Image()
        // Resolve either way: a missing frame should leave a gap in the turn,
        // not hang the rest of the sequence behind an unsettled promise.
        img.onerror = () => resolve()
        img.onload = () => {
          if (alive) {
            frames[i] = img
            // First arrival wins the canvas, so something is on screen before
            // the whole sequence has landed.
            if (drawn < 0) draw(i)
          }
          resolve()
        }
        img.src = frameSrc(i)
      })

    if (still) {
      void load(STILL)
      return () => {
        alive = false
      }
    }

    const progress = () => {
      const max = (scroller.scrollHeight - scroller.clientHeight) * SCRUB_END
      return max <= 0 ? 0 : Math.min(1, Math.max(0, scroller.scrollTop / max))
    }

    let raf = 0
    let cur = progress() * (FRAMES - 1)
    const tick = () => {
      const target = progress() * (FRAMES - 1)
      cur += (target - cur) * DAMP
      if (Math.abs(target - cur) < 0.01) cur = target
      draw(Math.round(cur))
      raf = requestAnimationFrame(tick)
    }

    // The pose the page opens on first, then the rest — otherwise the reveal
    // starts on whichever frame the network happened to return first.
    void load(Math.round(cur)).then(() => {
      if (!alive) return
      raf = requestAnimationFrame(tick)
      for (let i = 0; i < FRAMES; i++) if (!frames[i]) void load(i)
    })

    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [host, canvas])

  return (
    // Left gutter, not right, and that is a rendering constraint rather than a
    // taste call: the turn carries the snout out to the viewer's right, so with
    // the head cropped against the right edge the muzzle would be sliced off
    // through the middle third of the scroll. On the left the crop only ever
    // eats the back of the cranium, which has nothing in it.
    //
    // Whether it also sits under the copy is arithmetic, not preference. The
    // head is min(46vh, 520px) tall and 1.17x as wide; the gutter beside a
    // max-w-7xl column is (vw - 1280) / 2. Those cross over at about 2440px, so
    // below that width the head is under the text at every scroll position and
    // there is no placement that avoids it — at 1440 the gutter is 80px and the
    // head is 436px. Hence two regimes rather than one: faint and defocused
    // where it shares space with prose, full strength where it does not.
    <div
      ref={setHost}
      aria-hidden
      className="pointer-events-none fixed top-1/2 left-[-2.5rem] -z-[5] -translate-y-1/2 opacity-0 transition-opacity duration-700 min-[2440px]:left-[-1rem]"
    >
      <canvas
        ref={setCanvas}
        width={W}
        height={H}
        // Measured inside the boxes where copy overlaps the head: at 46vh and
        // opacity-60 the profile frames took body text down to 2.6:1 on a 1440
        // frame, against 5.7:1 with the head hidden. The blur is doing as much
        // work as the alpha — it flattens the specular on the lit cheek, which
        // is the pixel the percentile actually lands on, and it reads as depth
        // of field rather than as a dimmed object.
        className="h-[46vh] max-h-[520px] w-auto opacity-25 blur-[2px] min-[2440px]:opacity-60 min-[2440px]:blur-none"
      />
    </div>
  )
}
