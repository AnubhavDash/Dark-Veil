import * as faceapi from '@vladmandic/face-api'

// Model weights are served from a CDN so nothing needs to be bundled/hosted.
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model'

let loadPromise: Promise<void> | null = null
let fallbackPromise: Promise<void> | null = null

export function loadFaceModels(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
  })()
  return loadPromise
}

/**
 * SSD MobileNet v1 — 5.6 MB, and far steadier than the tiny detector on grain, dim
 * light, off-angle heads and low-contrast scans. Fetched only once the tiny passes
 * have already come up empty, so a photo that works first time never waits for it.
 */
export function loadFallbackDetector(): Promise<void> {
  if (fallbackPromise) return fallbackPromise
  fallbackPromise = faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL)
  return fallbackPromise
}

/** Anything that can be drawn into a canvas — `createImageBitmap` output included. */
export type ImageSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap

/** Intrinsic pixel size, which lives under a different property on each of these. */
function sizeOf(source: ImageSource): { w: number; h: number } {
  const anyish = source as HTMLImageElement & HTMLVideoElement & HTMLCanvasElement
  return {
    w: anyish.naturalWidth || anyish.videoWidth || anyish.width,
    h: anyish.naturalHeight || anyish.videoHeight || anyish.height,
  }
}

/**
 * Draw a source into a canvas no larger than `maxSize` on its long edge.
 *
 * A 12-megapixel phone photo has to become a tensor before anything can look at it,
 * which costs seconds, and it detects no better than a 1600px copy — every pass below
 * resizes to 800px or less anyway. This is where "upload is slow" came from.
 */
export function prepareStill(source: ImageSource, maxSize = 1600): HTMLCanvasElement {
  const { w, h } = sizeOf(source)
  const scale = Math.min(1, maxSize / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Linear histogram stretch, clipping the darkest and brightest 1% so that a handful of
 * blown-out or dead pixels cannot flatten the result.
 *
 * A frame shot in a dim room often uses barely a third of the available brightness
 * range, and a scanned black-and-white photo can be narrower still — the detector reads
 * that compressed range as texture-less noise. Pulling it back to full range is the
 * single most effective thing that can be done to such a frame before detection.
 *
 * `blurPx` blurs first. Sensor grain is what makes a dim webcam frame hard: stretching
 * a noisy image amplifies the noise along with the signal, and a sub-pixel blur removes
 * the grain while leaving the facial structure the detector is looking for.
 */
export function stretchContrast(source: ImageSource, blurPx = 0): HTMLCanvasElement {
  const { w, h } = sizeOf(source)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(source, 0, 0, w, h)
  ctx.filter = 'none'

  const frame = ctx.getImageData(0, 0, w, h)
  const px = frame.data

  const histogram = new Uint32Array(256)
  for (let i = 0; i < px.length; i += 4) {
    histogram[(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0]++
  }

  const clip = (w * h) / 100
  let lo = 0
  let hi = 255
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += histogram[v]
    if (acc > clip) {
      lo = v
      break
    }
  }
  for (let v = 255, acc = 0; v >= 0; v--) {
    acc += histogram[v]
    if (acc > clip) {
      hi = v
      break
    }
  }

  // Already full-range, or so flat that stretching it would only amplify noise.
  if (hi - lo < 8) return canvas

  const gain = 255 / (hi - lo)
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.min(255, Math.max(0, Math.round((v - lo) * gain)))
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]]
    px[i + 1] = lut[px[i + 1]]
    px[i + 2] = lut[px[i + 2]]
  }
  ctx.putImageData(frame, 0, 0)
  return canvas
}

/**
 * Per-channel gamma lift: raises shadows hard while barely moving the highlights.
 *
 * `stretchContrast` can only help a frame whose histogram has unused room at both ends.
 * A backlit face has the opposite problem — a bright wall behind the head fills the top of
 * the histogram, so the frame already spans the full range and the stretch is a no-op while
 * the face itself stays black. Measured on the webcam frame that failed in production:
 * p1=6, p99=237, so a gain of 1.10, with the face patch sitting at mean 34. Gamma needs no
 * headroom — it remaps every value through `255·(v/255)^(1/g)` — so the shadows come up on
 * their own. At g=1.8 that frame goes from undetectable at every input size tried
 * (224/320/416/512/608/800, raw and stretched alike) to a 0.50 detection at 800px.
 */
export function gammaLift(source: ImageSource, g: number, blurPx = 0): HTMLCanvasElement {
  const { w, h } = sizeOf(source)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(source, 0, 0, w, h)
  ctx.filter = 'none'

  const frame = ctx.getImageData(0, 0, w, h)
  const px = frame.data
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, 1 / g))
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]]
    px[i + 1] = lut[px[i + 1]]
    px[i + 2] = lut[px[i + 2]]
  }
  ctx.putImageData(frame, 0, 0)
  return canvas
}

/** The lift used by every recovery pass — chosen by measurement, see `gammaLift`. */
const SHADOW_LIFT = 1.8

export type Landmark = { x: number; y: number }

export type FaceResult = {
  box: { x: number; y: number; width: number; height: number }
  landmarks: Landmark[]
  descriptor: number[]
  score: number
}

/** A face from the live pre-capture loop: no 128-d descriptor, so it stays cheap. */
export type TrackedFace = {
  box: { x: number; y: number; width: number; height: number }
  landmarks: Landmark[]
  score: number
}

/** TinyFaceDetector options. `inputSize` must be a multiple of 32. */
const detectOptions = (inputSize: number, scoreThreshold: number) =>
  new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold })

const area = (b: { width: number; height: number }) => b.width * b.height

/** A confident detection is taken at its word, whatever its shape. */
const CONFIDENT_SCORE = 0.45
/** Below that, a box under this many pixels wide is too small to recognise anyone from. */
const MIN_BOX_PX = 40
/** …and its outer eye corners have to be this far apart, as a fraction of the box width. */
const MIN_EYE_SPAN = 0.38
const MAX_EYE_SPAN = 0.85

/**
 * Could this detection be a face?
 *
 * The low thresholds the recovery passes need for reach are also what lets junk through. On
 * a near-black film poster the detector boxed the lit head of a hammer, and the pipeline
 * dutifully cropped it, embedded it and sent it off to be reverse-searched — a wrong answer
 * presented with exactly as much confidence as a right one.
 *
 * Eye span is what separates the two. Measured across every frame that has failed here, each
 * false box put its outer eye corners under 0.34 of the box width — 0.23 on the hammer, 0.08
 * and 0.13 on the junk the tiled pass turns up — while every true detection of those same
 * faces ran 0.40 to 0.61, at scores as low as 0.10. Both bounds below sit clear of anything
 * measured on a real face.
 *
 * The size floor is absolute rather than a share of the frame. An earlier version demanded 12%
 * of the long edge, which does reject the hammer at 5.6% — but it also rejects Thor's actual
 * head, which is 3.8% of that poster and 7.8% of the window the tiled pass finds it in. What
 * a share of the frame really measures is how far away the subject stood, and that is no
 * evidence at all. Pixels are: below roughly 40 of them there is nothing left to recognise
 * anyone from, and the smallest true face measured here was 50 across.
 *
 * Only the straining passes get second-guessed. A missed face is the worse failure of the
 * two, so a detection that scores well is never thrown away on geometry.
 */
function plausible(face: {
  box: { width: number }
  landmarks: Landmark[]
  score: number
}): boolean {
  if (face.score >= CONFIDENT_SCORE) return true
  if (face.box.width < MIN_BOX_PX) return false
  const left = face.landmarks[36]
  const right = face.landmarks[45]
  if (!left || !right) return true // no landmarks to judge by — give it the benefit
  const span = Math.hypot(left.x - right.x, left.y - right.y) / face.box.width
  return span >= MIN_EYE_SPAN && span <= MAX_EYE_SPAN
}

/** Which of the escalating passes below actually found something. */
export type DetectPass =
  | 'tiny 416'
  | 'tiny 800'
  | 'tiny 800 + shadow lift'
  | 'ssd'
  | 'ssd + contrast'
  | 'ssd + denoise'
  | 'ssd tiles'

type Detectable = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement

/**
 * One detection attempt, with landmarks and 128-d descriptors, biggest face first.
 * Anything that fails `plausible` is dropped here, so no caller has to know it exists.
 */
async function runPass(
  input: Detectable,
  options: faceapi.TinyFaceDetectorOptions | faceapi.SsdMobilenetv1Options,
  note?: (msg: string) => void,
): Promise<FaceResult[]> {
  const detections = await faceapi
    .detectAllFaces(input, options)
    .withFaceLandmarks()
    .withFaceDescriptors()

  const found = detections
    .map((d) => ({
      box: {
        x: d.detection.box.x,
        y: d.detection.box.y,
        width: d.detection.box.width,
        height: d.detection.box.height,
      },
      landmarks: d.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      descriptor: Array.from(d.descriptor),
      score: d.detection.score,
    }))
    .sort((a, b) => area(b.box) - area(a.box))

  const faces = found.filter((f) => plausible(f))
  const dropped = found.length - faces.length
  if (dropped > 0) {
    note?.(`ignored ${dropped} detection${dropped > 1 ? 's' : ''} too small or misshapen to be a face`)
  }
  return faces
}

/** 3 across, 2 down, each window 40% of the width and 60% of the height — so they overlap. */
const TILE_COLS = 3
const TILE_ROWS = 2
const TILE_W = 0.4
const TILE_H = 0.6

/** One box is a repeat of another if its centre sits inside it, or the other way round. */
function overlaps(a: FaceResult['box'], b: FaceResult['box']): boolean {
  const inside = (p: FaceResult['box'], q: FaceResult['box']) => {
    const cx = p.x + p.width / 2
    const cy = p.y + p.height / 2
    return cx >= q.x && cx <= q.x + q.width && cy >= q.y && cy <= q.y + q.height
  }
  return inside(a, b) || inside(b, a)
}

/**
 * Search the frame window by window instead of all at once, best score first.
 *
 * Every pass above hands the detector the whole frame, and the detector immediately shrinks
 * it: SSD works at 512px square, so a head that is 4% of a 1600px-wide poster arrives about
 * 20px across and there is nothing there to find. No threshold, gamma or `inputSize` fixes
 * that — measured on the poster this pass exists for, the tiny detector at 1024px scraped the
 * face at 0.101 and every other full-frame attempt, six app passes included, returned nothing.
 *
 * Cropping is what changes, because it raises the face's share of what the detector sees. The
 * same head in a 640x600 window is 8% of it, and SSD scores it 0.405 — a real detection, from
 * a frame that had refused every other approach. Windows overlap on both axes so a face
 * landing on a seam still falls whole inside a neighbour.
 *
 * Boxes and landmarks come back in window coordinates and are shifted home, so callers never
 * learn this happened. A face caught in two windows arrives twice; the weaker copy is dropped.
 */
async function runTiledPass(input: Detectable, note?: (msg: string) => void): Promise<FaceResult[]> {
  const { w, h } = sizeOf(input)
  const tw = Math.round(w * TILE_W)
  const th = Math.round(h * TILE_H)
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 })

  const hits: FaceResult[] = []
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const ox = Math.round((col * (w - tw)) / (TILE_COLS - 1))
      const oy = Math.round((row * (h - th)) / (TILE_ROWS - 1))
      const tile = document.createElement('canvas')
      tile.width = tw
      tile.height = th
      tile.getContext('2d')!.drawImage(input, ox, oy, tw, th, 0, 0, tw, th)
      // No `note` here: six windows of rejection chatter would bury the one line that matters.
      for (const face of await runPass(tile, options)) {
        hits.push({
          ...face,
          box: { ...face.box, x: face.box.x + ox, y: face.box.y + oy },
          landmarks: face.landmarks.map((p) => ({ x: p.x + ox, y: p.y + oy })),
        })
      }
    }
  }

  const faces: FaceResult[] = []
  for (const face of hits.sort((a, b) => b.score - a.score)) {
    if (!faces.some((kept) => overlaps(face.box, kept.box))) faces.push(face)
  }
  if (faces.length) {
    note?.(`found ${faces.length} face${faces.length > 1 ? 's' : ''} in a window the whole frame hid`)
  }
  return faces
}

/**
 * Detect every face in an image, biggest first, each with landmarks and a 128-d descriptor.
 *
 * Seven passes, cheapest first, stopping at the first that finds anything — so a well-lit
 * front-facing photo costs exactly what it always did, and only the frames that used to
 * fail outright pay for the slower attempts. `note` reports the escalation, because a
 * 5.6 MB model download deserves an explanation in the log rather than a silent stall.
 *
 * The last pass searches window by window and returns its faces best-scoring first rather
 * than biggest first, since by then a big box is more likely to be a big mistake.
 */
export async function detectFaces(
  input: Detectable,
  note?: (msg: string) => void,
): Promise<{ faces: FaceResult[]; pass: DetectPass | null }> {
  await loadFaceModels()

  // 1 — the fast path, and the only one most photos ever touch.
  let faces = await runPass(input, detectOptions(416, 0.4), note)
  if (faces.length) return { faces, pass: 'tiny 416' }

  // 2 — same detector, ~4x the input pixels and a laxer threshold. This is what finds
  // a face that sits small in a wide frame, which no amount of retrying at 416 will.
  // 0.25 rather than 0.2: measured on a dim frame, 0.2 added a spurious second box
  // beside the real 0.27 detection, and 0.3 lost the real one too.
  note?.('nothing at 416px — retrying at 800px with a lower threshold…')
  faces = await runPass(input, detectOptions(800, 0.25), note)
  if (faces.length) return { faces, pass: 'tiny 800' }

  // 3 — lift the shadows and ask the same detector again. This is the pass for a backlit
  // face: a bright background leaves the histogram already full-range, so the contrast
  // stretch below cannot help it, and the face stays a dark smudge the detector reads as
  // texture. It goes before the heavy passes because it needs nothing downloaded, and on
  // the frame that prompted it, it is the only thing in this whole cascade that works.
  note?.('still nothing — lifting the shadows and detecting again…')
  faces = await runPass(gammaLift(input, SHADOW_LIFT), detectOptions(800, 0.25), note)
  if (faces.length) return { faces, pass: 'tiny 800 + shadow lift' }

  // 4 — a different, heavier detector. TinyFaceDetector is a speed trade first and an
  // accuracy one second; grain, dim light and off-angle heads are exactly where it quits.
  // A CDN failure here must not turn "no face in this photo" into an opaque crash, so the
  // three heavy passes degrade to the same empty answer the light ones gave.
  try {
    note?.('fetching the SSD MobileNet detector (5.6 MB, once per session)…')
    await loadFallbackDetector()
    faces = await runPass(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }), note)
    if (faces.length) return { faces, pass: 'ssd' }

    // 5 — pull the histogram back to full range and ask again. A dark webcam frame or a
    // scanned black-and-white print can hold a perfectly findable face inside a 40-value
    // brightness band.
    note?.('normalising contrast and detecting again…')
    faces = await runPass(
      stretchContrast(input),
      new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }),
      note,
    )
    if (faces.length) return { faces, pass: 'ssd + contrast' }

    // 6 — blur the grain out before stretching. This is the pass that gets a dim, noisy
    // laptop webcam, where stretching alone only amplifies the noise. The crop sent onward
    // is always cut from the untouched still, so only the embedding sees this.
    note?.('removing grain, then normalising contrast…')
    faces = await runPass(
      stretchContrast(input, 1.5),
      new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }),
      note,
    )
    if (faces.length) return { faces, pass: 'ssd + denoise' }

    // 7 — stop showing the detector the whole frame. Every pass above has now failed on a
    // frame where the face may simply be too small a part of it to survive the detector's
    // own downscale; six overlapping windows give the same face several times the pixels.
    // Last because it is six detections rather than one, and it is only ever reached when
    // the alternative is telling the user there is no face in a photo that plainly has one.
    note?.('nothing in the whole frame — searching it window by window…')
    faces = await runTiledPass(input, note)
    return { faces, pass: faces.length ? 'ssd tiles' : null }
  } catch (err) {
    fallbackPromise = null // a failed load must not be cached as "already tried"
    note?.(`fallback detector unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return { faces: [], pass: null }
  }
}

/**
 * Cheap pass for the live webcam HUD: 224px input, landmarks but no descriptor.
 * Fast enough to run ~10x a second on a laptop CPU.
 *
 * `boosted` keeps the same 224px input — measured, the backlit frame is found there and
 * not at 320, 416 or 512 — and spends its extra time on a shadow lift and a threshold low
 * enough to accept what that leaves: 0.28 on the frame the cheap pass scores nothing on.
 * The loop turns it on only after the cheap pass has missed several frames in a row,
 * which is what a dim or backlit camera looks like from here.
 */
export async function trackFaces(
  input: HTMLVideoElement | HTMLCanvasElement,
  boosted = false,
): Promise<TrackedFace[]> {
  await loadFaceModels()

  const detections = await faceapi
    .detectAllFaces(
      boosted ? gammaLift(input, SHADOW_LIFT) : input,
      boosted ? detectOptions(224, 0.2) : detectOptions(224, 0.35),
    )
    .withFaceLandmarks()

  return detections
    .map((d) => ({
      box: { x: d.detection.box.x, y: d.detection.box.y, width: d.detection.box.width, height: d.detection.box.height },
      landmarks: d.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      score: d.detection.score,
    }))
    .filter((f) => plausible(f))
    .sort((a, b) => area(b.box) - area(a.box))
}

/**
 * Detect the most prominent face in an image element.
 * Returns bounding box, 68 landmarks and the 128-d face descriptor.
 */
export async function detectFace(input: Detectable): Promise<FaceResult | null> {
  const { faces } = await detectFaces(input)
  return faces[0] ?? null
}

/**
 * Crop the detected face (with padding) out of the source into a data URL,
 * downscaled to keep the payload small for the vision request.
 */
export function cropFace(
  source: Detectable,
  box: { x: number; y: number; width: number; height: number },
  maxSize = 512,
): string {
  const { w: sw, h: sh } = sizeOf(source)

  const pad = 0.35
  const px = box.width * pad
  const py = box.height * pad
  const x = Math.max(0, box.x - px)
  const y = Math.max(0, box.y - py)
  const w = Math.min(sw - x, box.width + px * 2)
  const h = Math.min(sh - y, box.height + py * 2)

  const scale = Math.min(1, maxSize / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}
