'use client'

import { useEffect, useState } from 'react'
import { scrollParentOf } from '@/lib/hooks'

/**
 * The mark, surfacing with the scroll: a smudge you might have imagined at the
 * top of the page, resolved and unmistakable by the bottom.
 *
 * One flat two-tone stencil, drawn white-on-transparent, rather than a lit 3D
 * object. That is what makes the legibility budget a single number: a rendered
 * head has to be measured pose by pose, because the pixel the contrast
 * percentile lands on is a specular highlight that moves. A flat fill has one
 * brightness at one alpha, so PEAK below can be derived and then confirmed,
 * and the blur is free to be purely cosmetic.
 *
 * Centred, which is the whole point and also the constraint: unlike a gutter
 * ornament there is no width at which it clears the copy, so alpha is the only
 * lever there is.
 */
const SRC = '/venom/mark.webp'

/** Where it starts. Present, but only just — a shading of the backdrop rather
 *  than a shape you could name. Set by eye rather than by the gate, because the
 *  floor turns out to be free: the binding measurement is at the bottom of the
 *  page, where alpha is PEAK whatever the floor is, and sweeping the floor from
 *  0.02 to 0.04 left the worst reading unmoved. So the only question is where
 *  faint stops being absent, and that has to be judged in the hero, whose own
 *  bloom is the brightest part of the backdrop. With the copy on top, 0.02 and
 *  0.03 could not be seen at all and 0.05 was plainly a face. */
const FAINT = 0.04

/** Where it ends up, and the reason it ends up there. The gate is the page's
 *  dimmest body copy — `text-muted-foreground`, rgb(139,154,171), luminance
 *  0.315 — holding 4.5:1 against the brightest pixel behind it, which allows the
 *  background a luminance of 0.031.
 *
 *  The stencil is filled with a cool white, rgb(229,242,255), not pure white:
 *  luminance weights green at 0.7152 and blue at 0.0722, so pulling the fill
 *  towards blue costs 12.6% of its luminance and almost none of its whiteness.
 *  Over the page's own rgb(3,6,13) that fill could reach 0.185 before it spent
 *  the budget by itself.
 *
 *  It cannot, because the background is not bare: where copy crosses the mark the
 *  backdrop's bloom has already taken it to 5.4–6.8:1 before the mark adds
 *  anything. Measured at four viewports and four scroll depths, inside the
 *  rectangles where copy actually overlaps the stencil, 0.08 lands at 4.60:1 and
 *  0.09 at 4.47:1. This is the last step of 0.01 that clears the gate. */
const PEAK = 0.08

/** Blur at the faint end, in px, easing to none. Cosmetic, unlike on a lit
 *  object: blurring a flat fill leaves its interior brightness alone, so this
 *  buys the apparition and costs nothing at the gate. Confirmed channel by
 *  channel rather than assumed — at 1440-late the brightest pixel under the copy
 *  reads (43,18,9) with the mark hidden and (55,33,25) with it on, which is
 *  exactly rgb(229,242,255) at the alpha the ramp had reached. */
const BLUR = 7

/** Scale at the faint end, settling to 1 — so it reads as approaching rather
 *  than as growing. */
const RISE = 1.09

/** Share of the scroll the reveal is spread over. Short of 1 on purpose: the
 *  bottom pixel of a document that grows as panels fill is not where you put
 *  the payoff, and it is where people stop early. It holds at full through the
 *  remainder. */
const SCRUB_END = 0.85

/** Share of the gap closed per tick, so a wheel flick blooms rather than cuts. */
const DAMP = 0.14

/** Held when motion is suppressed: two thirds up the ramp, which is legible as
 *  a face without any scrolling having happened. Unlike the scrubbed ramp this
 *  really is one flat alpha at every scroll position, so it was measured that way
 *  — 0.057 everywhere reads 4.70:1 at worst, better than the ramp's own bottom
 *  end because it never reaches full strength. */
const STILL = 0.66

export function VenomMark() {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!host || !img) return
    const scroller = scrollParentOf(host)
    if (!scroller) return

    let last = -1
    const paint = (p: number) => {
      if (Math.abs(p - last) < 0.0005) return
      last = p
      // Squared, so the mark stays a rumour through the first half of the page
      // and does most of its arriving over the last third.
      const e = p * p
      img.style.opacity = (FAINT + (PEAK - FAINT) * e).toFixed(4)
      img.style.filter = `blur(${(BLUR * (1 - e)).toFixed(2)}px)`
      img.style.transform = `scale(${(RISE - (RISE - 1) * e).toFixed(4)})`
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint(STILL)
      return
    }

    const progress = () => {
      const max = (scroller.scrollHeight - scroller.clientHeight) * SCRUB_END
      return max <= 0 ? 0 : Math.min(1, Math.max(0, scroller.scrollTop / max))
    }

    // Read scrollTop in the frame loop rather than on a scroll event: the damped
    // approach needs a tick even when the scroller is still, and this way there
    // is no listener to throttle. Once cur has caught its target, paint() bails
    // on the first line and no style is touched at all.
    let raf = 0
    let cur = progress()
    paint(cur)
    const tick = () => {
      const target = progress()
      cur += (target - cur) * DAMP
      if (Math.abs(target - cur) < 0.0005) cur = target
      paint(cur)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [host, img])

  return (
    <div
      ref={setHost}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-[5] grid place-items-center overflow-hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={setImg}
        src={SRC}
        alt=""
        decoding="async"
        // Decorative, and it must not race the face detector's weights for
        // bandwidth on first load.
        fetchPriority="low"
        // Opacity, blur and scale are written straight to style by the loop
        // above, so nothing is set here beyond the size. It starts fully
        // transparent so a slow network cannot flash it at full strength before
        // the first tick lands. max-w with object-contain is what keeps it whole
        // on a phone, where 86vh of a 0.59 aspect is wider than the viewport.
        className="h-[86vh] max-h-[880px] w-auto max-w-[92vw] object-contain opacity-0"
      />
    </div>
  )
}
