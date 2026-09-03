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
/** Below that, a face has to be at least this share of the frame's long edge. */
const MIN_FRAME_SHARE = 0.12
/** …and its outer eye corners this far apart, as a fraction of the box width. */
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
 * Measured over the two frames that actually failed: every false box was 5–6% of the frame's
 * long edge, with an eye span under 0.34 of its own width and a score of 0.10–0.24. Every
 * true detection of the same face — at four gammas and three input sizes — was 34–55% of the
 * frame, eye span 0.42–0.57, scoring up to 0.50. So the two are separable on geometry, and
 * both bounds here sit clear of anything measured on a real face.
 *
 * Only the straining passes get second-guessed. A missed face is the worse failure of the
 * two, so a detection that scores well is never thrown away on geometry.
 */
function plausible(
  face: { box: { width: number }; landmarks: Landmark[]; score: number },
  frameLong: number,
): boolean {
  if (face.score >= CONFIDENT_SCORE) return true
  if (face.box.width < frameLong * MIN_FRAME_SHARE) return false
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

  const { w, h } = sizeOf(input)
  const faces = found.filter((f) => plausible(f, Math.max(w, h)))
  const dropped = found.length - faces.length
  if (dropped > 0) {
    note?.(`ignored ${dropped} detection${dropped > 1 ? 's' : ''} too small or misshapen to be a face`)
  }
  return faces
}

/**
 * Detect every face in an image, biggest first, each with landmarks and a 128-d descriptor.
 *
 * Six passes, cheapest first, stopping at the first that finds anything — so a well-lit
 * front-facing photo costs exactly what it always did, and only the frames that used to
 * fail outright pay for the slower attempts. `note` reports the escalation, because a
 * 5.6 MB model download deserves an explanation in the log rather than a silent stall.
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

    // 6 — last resort: blur the grain out before stretching. This is the pass that gets a
    // dim, noisy laptop webcam, where stretching alone only amplifies the noise. The crop
    // sent onward is always cut from the untouched still, so only the embedding sees this.
    note?.('last pass: removing grain, then normalising contrast…')
    faces = await runPass(
      stretchContrast(input, 1.5),
      new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }),
      note,
    )
    return { faces, pass: faces.length ? 'ssd + denoise' : null }
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

  const { w, h } = sizeOf(input)
  return detections
    .map((d) => ({
      box: { x: d.detection.box.x, y: d.detection.box.y, width: d.detection.box.width, height: d.detection.box.height },
      landmarks: d.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      score: d.detection.score,
    }))
    .filter((f) => plausible(f, Math.max(w, h)))
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

/* ------------------------------------------------------------------ liveness */

// 68-point landmark model: eyes are contiguous 6-point rings.
const LEFT_EYE = [36, 37, 38, 39, 40, 41]
const RIGHT_EYE = [42, 43, 44, 45, 46, 47]

/** Eye closed below this ratio. */
export const EAR_CLOSED = 0.2
/** Eye open again above this ratio — the gap is hysteresis, so noise can't fake a blink. */
export const EAR_OPEN = 0.26

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)

function ringEar(pts: Landmark[], ring: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = ring.map((i) => pts[i])
  const horizontal = dist(p1, p4)
  if (horizontal === 0) return 0
  return (dist(p2, p6) + dist(p3, p5)) / (2 * horizontal)
}

/**
 * Eye Aspect Ratio (Soukupová & Čech). Height-over-width of the eye opening:
 * ~0.3 wide open, collapses toward 0 during a blink.
 */
export function eyeAspectRatio(landmarks: Landmark[]): { left: number; right: number; avg: number } | null {
  if (landmarks.length < 48) return null
  const left = ringEar(landmarks, LEFT_EYE)
  const right = ringEar(landmarks, RIGHT_EYE)
  return { left, right, avg: (left + right) / 2 }
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
