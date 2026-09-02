/** Canvas helpers for the scanner HUD: bracket boxes, landmark clouds, eye rings. */

export const HUD_CYAN = 'oklch(0.82 0.15 195)'
export const HUD_MAGENTA = 'oklch(0.7 0.22 330)'
export const HUD_DIM = 'oklch(0.68 0.03 250)'

export type Box = { x: number; y: number; width: number; height: number }
export type Pt = { x: number; y: number }

/** Maps source-pixel coordinates onto destination-pixel coordinates. */
export type Fit = { scale: number; dx: number; dy: number }

export const IDENTITY_FIT: Fit = { scale: 1, dx: 0, dy: 0 }

/** Transform for a source painted with `object-fit: cover` into a destination box. */
export function coverFit(sw: number, sh: number, dw: number, dh: number): Fit {
  const scale = Math.max(dw / sw, dh / sh)
  return { scale, dx: (dw - sw * scale) / 2, dy: (dh - sh * scale) / 2 }
}

const tx = (fit: Fit, x: number) => x * fit.scale + fit.dx
const ty = (fit: Fit, y: number) => y * fit.scale + fit.dy

/** Scanner-style bounding box: thin full rect plus heavy corner brackets. */
export function drawBrackets(
  ctx: CanvasRenderingContext2D,
  box: Box,
  fit: Fit,
  color: string,
  weight: number,
  primary: boolean,
) {
  const x = tx(fit, box.x)
  const y = ty(fit, box.y)
  const w = box.width * fit.scale
  const h = box.height * fit.scale

  ctx.save()
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = primary ? 16 : 6
  ctx.lineWidth = Math.max(1, weight * (primary ? 1 : 0.6))
  ctx.globalAlpha = primary ? 1 : 0.55
  ctx.strokeRect(x, y, w, h)

  const c = Math.min(w, h) * 0.2
  ctx.lineWidth = Math.max(2, weight * (primary ? 1.9 : 1.1))
  ctx.beginPath()
  const corners: [number, number, number, number][] = [
    [x, y + c, x, y],
    [x, y, x + c, y],
    [x + w - c, y, x + w, y],
    [x + w, y, x + w, y + c],
    [x, y + h - c, x, y + h],
    [x, y + h, x + c, y + h],
    [x + w - c, y + h, x + w, y + h],
    [x + w, y + h - c, x + w, y + h],
  ]
  for (const [ax, ay, bx, by] of corners) {
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  fit: Fit,
  color: string,
  radius: number,
) {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 6
  for (const p of points) {
    ctx.beginPath()
    ctx.arc(tx(fit, p.x), ty(fit, p.y), radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Outlines one 6-point eye ring so the liveness check is visible, not just a number. */
export function drawEyeRing(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  ring: number[],
  fit: Fit,
  color: string,
  weight: number,
) {
  if (points.length < 48) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.lineWidth = Math.max(1.2, weight)
  ctx.beginPath()
  ring.forEach((i, n) => {
    const p = points[i]
    if (n === 0) ctx.moveTo(tx(fit, p.x), ty(fit, p.y))
    else ctx.lineTo(tx(fit, p.x), ty(fit, p.y))
  })
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

export const LEFT_EYE_RING = [36, 37, 38, 39, 40, 41]
export const RIGHT_EYE_RING = [42, 43, 44, 45, 46, 47]

/** Label chip drawn above a tracked face. */
export function drawTag(
  ctx: CanvasRenderingContext2D,
  box: Box,
  fit: Fit,
  text: string,
  color: string,
) {
  const x = tx(fit, box.x)
  const y = ty(fit, box.y)
  ctx.save()
  ctx.font = '600 11px ui-monospace, monospace'
  const padding = 5
  const width = ctx.measureText(text).width + padding * 2
  ctx.fillStyle = 'rgba(6, 10, 20, 0.72)'
  ctx.fillRect(x, Math.max(0, y - 18), width, 16)
  ctx.fillStyle = color
  ctx.fillText(text, x + padding, Math.max(11, y - 6))
  ctx.restore()
}
