import * as faceapi from '@vladmandic/face-api'

// Model weights are served from a CDN so nothing needs to be bundled/hosted.
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model'

let loadPromise: Promise<void> | null = null

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

/** Full-quality pass: 416px input, used once on the frame the user actually captures. */
const detectOptions = (inputSize: number, scoreThreshold: number) =>
  new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold })

const area = (b: { width: number; height: number }) => b.width * b.height

/**
 * Detect every face in an image, biggest first, each with landmarks and a 128-d descriptor.
 * Used for the capture pass and for multi-face selection.
 */
export async function detectFaces(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
): Promise<FaceResult[]> {
  await loadFaceModels()

  const detections = await faceapi
    .detectAllFaces(input, detectOptions(416, 0.4))
    .withFaceLandmarks()
    .withFaceDescriptors()

  return detections
    .map((d) => ({
      box: { x: d.detection.box.x, y: d.detection.box.y, width: d.detection.box.width, height: d.detection.box.height },
      landmarks: d.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      descriptor: Array.from(d.descriptor),
      score: d.detection.score,
    }))
    .sort((a, b) => area(b.box) - area(a.box))
}

/**
 * Cheap pass for the live webcam HUD: 224px input, landmarks but no descriptor.
 * Fast enough to run ~10x a second on a laptop CPU.
 */
export async function trackFaces(
  input: HTMLVideoElement | HTMLCanvasElement,
): Promise<TrackedFace[]> {
  await loadFaceModels()

  const detections = await faceapi
    .detectAllFaces(input, detectOptions(224, 0.35))
    .withFaceLandmarks()

  return detections
    .map((d) => ({
      box: { x: d.detection.box.x, y: d.detection.box.y, width: d.detection.box.width, height: d.detection.box.height },
      landmarks: d.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      score: d.detection.score,
    }))
    .sort((a, b) => area(b.box) - area(a.box))
}

/**
 * Detect the most prominent face in an image element.
 * Returns bounding box, 68 landmarks and the 128-d face descriptor.
 */
export async function detectFace(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
): Promise<FaceResult | null> {
  const faces = await detectFaces(input)
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
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  maxSize = 512,
): string {
  const sw = 'naturalWidth' in source ? source.naturalWidth : (source as HTMLVideoElement).videoWidth || source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight : (source as HTMLVideoElement).videoHeight || source.height

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
