'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CircleDot, Eye, RotateCcw, ScanFace, Upload, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  EAR_CLOSED,
  EAR_OPEN,
  cropFace,
  detectFaces,
  eyeAspectRatio,
  loadFaceModels,
  prepareStill,
  trackFaces,
  type FaceResult,
  type ImageSource,
  type TrackedFace,
} from '@/lib/face'
import {
  HUD_CYAN,
  HUD_DIM,
  HUD_MAGENTA,
  IDENTITY_FIT,
  LEFT_EYE_RING,
  RIGHT_EYE_RING,
  coverFit,
  drawBrackets,
  drawEyeRing,
  drawLandmarks,
  drawTag,
} from '@/lib/hud'
import type { LogLevel } from '@/lib/types'

type ScannerProps = {
  log: (level: LogLevel, msg: string) => void
  onDetected: (data: { face: FaceResult; crop: string; total: number; index: number }) => void
  onReset: () => void
  disabled?: boolean
}

type Mode = 'upload' | 'webcam'
type EyePhase = 'open' | 'closed'

/** ~10 detections a second: smooth enough to feel live, cheap enough for a laptop CPU. */
const TRACK_MS = 100

/**
 * getUserMedia rejects with a handful of distinct DOMExceptions that mean very
 * different things — no camera attached, another app holding it, a permission the
 * browser remembered as blocked — and the fix is different for each. Collapsing
 * them into one "denied or unavailable" line meant the panel could not tell you
 * which had happened.
 */
function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'camera blocked — Chrome is remembering a "Block" for this site. Click the camera icon in the address bar, allow it, then reload.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no camera found — the browser sees no video input on this machine. A browser running inside WSL cannot reach a Windows webcam; open the page in Windows Chrome instead.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'camera is busy — another app (Zoom, Teams, OBS) is holding it. Close that and try again.'
    case 'OverconstrainedError':
      return 'no camera matched the requested constraints.'
    case 'SecurityError':
      return 'camera blocked by the page security policy.'
    default:
      return `camera unavailable${name ? ` (${name})` : ''}: ${
        err instanceof Error ? err.message : String(err)
      }`
  }
}

export function Scanner({ log, onDetected, onReset, disabled }: ScannerProps) {
  const [mode, setMode] = useState<Mode>('upload')
  const [hasStill, setHasStill] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [camActive, setCamActive] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)

  const [faces, setFaces] = useState<FaceResult[]>([])
  const [crops, setCrops] = useState<string[]>([])
  const [selected, setSelected] = useState(0)

  // Manual by default. Blink liveness is the more interesting proof and it stays one tap away,
  // but a shutter that fires on its own — and only once it is satisfied — is the wrong thing to
  // hand someone the first time they open a camera.
  const [livenessOn, setLivenessOn] = useState(false)
  const [blinks, setBlinks] = useState(0)
  const [track, setTrack] = useState<{ count: number; ear: number | null; score: number }>({
    count: 0,
    ear: null,
    score: 0,
  })

  const stillRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLCanvasElement>(null)
  const trackCanvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const eyePhaseRef = useRef<EyePhase>('open')
  const armedRef = useRef(false)
  const captureRef = useRef<() => void>(() => {})

  // Warm up the models as soon as the component mounts.
  useEffect(() => {
    loadFaceModels()
      .then(() => log('info', 'face-api models loaded (tiny_detector + landmark68 + recognition)'))
      .catch(() => log('warn', 'face model preload deferred'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamActive(false)
    setTrack({ count: 0, ear: null, score: 0 })
  }, [])

  useEffect(() => () => stopCam(), [stopCam])

  /** Repaints the captured still with a box on every face and the pick highlighted. */
  const renderStill = useCallback((found: FaceResult[], pick: number) => {
    const still = stillRef.current
    const stage = stageRef.current
    if (!still || !stage) return

    stage.width = still.width
    stage.height = still.height
    const ctx = stage.getContext('2d')
    if (!ctx) return
    ctx.drawImage(still, 0, 0)

    const weight = Math.max(2, stage.width / 300)
    found.forEach((face, i) => {
      const isPick = i === pick
      drawBrackets(ctx, face.box, IDENTITY_FIT, isPick ? HUD_CYAN : HUD_DIM, weight, isPick)
      if (isPick) {
        drawLandmarks(ctx, face.landmarks, IDENTITY_FIT, HUD_MAGENTA, Math.max(1.2, stage.width / 600))
      }
      if (found.length > 1) {
        drawTag(
          ctx,
          face.box,
          IDENTITY_FIT,
          `${String(i + 1).padStart(2, '0')} ${(face.score * 100).toFixed(0)}%`,
          isPick ? HUD_CYAN : HUD_DIM,
        )
      }
    })
  }, [])

  /** Runs the escalating detection cascade over a captured still and hands the pick upstream. */
  const process = useCallback(
    async (source: ImageSource, label: string) => {
      setBusy(true)
      onReset()
      setFaces([])
      setCrops([])
      setSelected(0)
      try {
        // Capped at 1600px: a 12-megapixel photo detects no better than this and costs
        // seconds to turn into a tensor, which is most of what "upload is slow" was.
        const still = prepareStill(source)
        stillRef.current = still
        setHasStill(true)
        log('info', `${label} · detecting on a ${still.width}x${still.height} frame…`)

        // Let React mount the stage canvas so the photo is on screen while the cascade
        // runs, instead of the panel sitting empty until detection finishes.
        await new Promise((r) => setTimeout(r, 0))
        renderStill([], 0)

        const { faces: found, pass } = await detectFaces(still, (msg) => log('info', msg))
        renderStill(found, 0)

        if (found.length === 0) {
          log(
            'error',
            'no face found after seven passes — more light, a straighter angle, or a photo where the face is turned toward the camera will all help',
          )
          return
        }
        if (pass && pass !== 'tiny 416') log('warn', `found it on the fallback pass: ${pass}`)

        const nextCrops = found.map((f) => cropFace(still, f.box))
        setFaces(found)
        setCrops(nextCrops)
        setSelected(0)
        log(
          'ok',
          found.length > 1
            ? `${found.length} faces detected · largest selected · 128-d encoding captured`
            : `face detected · score ${(found[0].score * 100).toFixed(1)}% · 128-d encoding captured`,
        )
        onDetected({ face: found[0], crop: nextCrops[0], total: found.length, index: 0 })
      } catch (err) {
        log('error', `detection error: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [log, onDetected, onReset, renderStill],
  )

  /** Switch which of several detected faces drives the rest of the pipeline. */
  const pickFace = useCallback(
    (index: number) => {
      if (index === selected || !faces[index] || !crops[index]) return
      setSelected(index)
      renderStill(faces, index)
      onReset()
      log('info', `face ${String(index + 1).padStart(2, '0')} selected — downstream results cleared`)
      onDetected({ face: faces[index], crop: crops[index], total: faces.length, index })
    },
    [crops, faces, log, onDetected, onReset, renderStill, selected],
  )

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        log('error', 'unsupported file — please drop an image')
        return
      }
      const label = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`
      try {
        // createImageBitmap decodes off the main thread and skips the base64 round trip
        // a FileReader forces. On an 8 MB phone photo that detour was seconds of the wait.
        const bitmap = await createImageBitmap(file)
        try {
          await process(bitmap, label)
        } finally {
          bitmap.close()
        }
      } catch {
        // Older Safari has no createImageBitmap for a Blob; the slow path still works.
        const url = URL.createObjectURL(file)
        try {
          const img = new Image()
          img.src = url
          await img.decode()
          await process(img, label)
        } finally {
          URL.revokeObjectURL(url)
        }
      }
    },
    [log, process],
  )

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // Snapshot synchronously — the stream is torn down on the next line.
    const frame = prepareStill(video)
    stopCam()
    process(frame, 'webcam frame')
  }, [process, stopCam])

  captureRef.current = capture

  const startCam = useCallback(async () => {
    setCamError(null)
    // A camera needs a secure context, so `mediaDevices` is simply absent over
    // plain http on anything but localhost — worth saying before asking for it.
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = window.isSecureContext
        ? 'this browser exposes no camera API'
        : `insecure origin (${window.location.protocol}//${window.location.host}) — a camera needs https or localhost`
      setCamError(msg)
      log('error', msg)
      return
    }
    try {
      log('info', 'requesting camera access…')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setHasStill(false)
      setFaces([])
      setCrops([])
      setBlinks(0)
      eyePhaseRef.current = 'open'
      setCamActive(true)
      log('ok', livenessOn ? 'camera live · blink to capture' : 'camera live · press capture when ready')
    } catch (err) {
      const msg = cameraErrorMessage(err)
      setCamError(msg)
      log('error', msg)
    }
  }, [livenessOn, log])

  armedRef.current = livenessOn && camActive && !busy && !hasStill

  // Live pre-capture loop: detect, draw the HUD, and watch the eyes for a blink.
  useEffect(() => {
    if (!camActive) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let misses = 0
    let boosted = false

    const paint = (found: TrackedFace[], ear: number | null, closed: boolean) => {
      const video = videoRef.current
      const canvas = trackCanvasRef.current
      if (!video || !canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cw = canvas.clientWidth
      const ch = canvas.clientHeight
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr
        canvas.height = ch * dpr
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)

      // The video is painted with object-cover, so detections need the same transform.
      const fit = coverFit(video.videoWidth || 1, video.videoHeight || 1, cw, ch)
      found.forEach((face, i) => {
        const primary = i === 0
        const accent = closed ? HUD_MAGENTA : HUD_CYAN
        drawBrackets(ctx, face.box, fit, primary ? accent : HUD_DIM, 2, primary)
        drawLandmarks(ctx, face.landmarks, fit, primary ? HUD_MAGENTA : HUD_DIM, primary ? 1.4 : 1)
        if (primary) {
          drawEyeRing(ctx, face.landmarks, LEFT_EYE_RING, fit, accent, 1.6)
          drawEyeRing(ctx, face.landmarks, RIGHT_EYE_RING, fit, accent, 1.6)
        }
        drawTag(
          ctx,
          face.box,
          fit,
          primary && ear !== null ? `EAR ${ear.toFixed(3)}` : `${(face.score * 100).toFixed(0)}%`,
          primary ? accent : HUD_DIM,
        )
      })
    }

    const loop = async () => {
      if (cancelled) return
      const started = performance.now()
      const video = videoRef.current

      if (video && video.readyState >= 2 && video.videoWidth) {
        try {
          const found = await trackFaces(video, boosted)
          if (cancelled) return

          // Half a second of empty frames means the cheap pass is not going to find this
          // face: a dim or backlit one needs its shadows lifted before anything shows up.
          if (found.length === 0) {
            misses += 1
            if (misses === 5 && !boosted) {
              boosted = true
              log('info', 'no face yet — lifting the shadows on the live pass')
            }
          } else {
            misses = 0
          }

          const ear = found[0] ? eyeAspectRatio(found[0].landmarks)?.avg ?? null : null
          let closed = eyePhaseRef.current === 'closed'

          if (ear !== null) {
            if (eyePhaseRef.current === 'open' && ear < EAR_CLOSED) {
              eyePhaseRef.current = 'closed'
              closed = true
            } else if (eyePhaseRef.current === 'closed' && ear > EAR_OPEN) {
              // A full close-then-open cycle is one blink — a still photo can never do this.
              eyePhaseRef.current = 'open'
              closed = false
              setBlinks((b) => b + 1)
              if (armedRef.current) {
                log('ok', `blink detected (EAR ${ear.toFixed(3)}) — liveness confirmed, capturing`)
                cancelled = true
                captureRef.current()
                return
              }
            }
          }

          setTrack({ count: found.length, ear, score: found[0]?.score ?? 0 })
          paint(found, ear, closed)
        } catch {
          /* a dropped frame is fine, the next one is 100ms away */
        }
      }

      if (cancelled) return
      timer = setTimeout(loop, Math.max(0, TRACK_MS - (performance.now() - started)))
    }


    loop()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [camActive, log])

  /** Throw away the captured frame and everything derived from it. */
  const clearStill = useCallback(() => {
    stillRef.current = null
    setHasStill(false)
    setFaces([])
    setCrops([])
    setSelected(0)
    setBlinks(0)
    eyePhaseRef.current = 'open'
    onReset()
  }, [onReset])

  const reset = useCallback(() => {
    clearStill()
    setCamError(null)
    stopCam()
    log('info', 'scanner reset')
  }, [clearStill, log, stopCam])

  /**
   * Changing capture mode starts over. A still left on the stage from the other tab read
   * as a frame this tab had already captured, and the encoding and search below it still
   * described that old frame — so the whole pipeline had to be cleared with it.
   */
  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return
      setMode(next)
      setCamError(null)
      stopCam()
      if (!hasStill && faces.length === 0) return
      clearStill()
      log('info', `switched to ${next} — the previous frame and its results were cleared`)
    },
    [clearStill, faces.length, hasStill, log, mode, stopCam],
  )

  const earPct = track.ear === null ? 0 : Math.min(100, (track.ear / 0.45) * 100)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {(['upload', 'webcam'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            disabled={disabled}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors',
              mode === m
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {m === 'upload' ? <Upload className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
            {m}
          </button>
        ))}
      </div>

      {/*
        Capped rather than `w-full`: at this column width an aspect-square stage
        was ~730px tall, which pushed the liveness readout and the start-camera
        button below the fold and left the pipeline panel beside it mostly empty.
      */}
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-xl border border-border bg-black/40 bg-grid">
        {hasStill ? (
          <canvas ref={stageRef} className="h-full w-full object-contain" />
        ) : mode === 'upload' ? (
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) handleFile(f)
            }}
            className={cn(
              'flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 text-center transition-colors',
              dragOver && 'bg-primary/5',
            )}
          >
            <ScanFace className={cn('h-12 w-12 text-primary/70', dragOver && 'text-primary')} />
            <div>
              <p className="text-sm text-foreground">Drop a face photo</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">or click to browse</p>
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
          </label>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className={cn('h-full w-full object-cover', !camActive && 'opacity-0')}
            />
            <canvas
              ref={trackCanvasRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {!camActive ? (
              // The placeholder is the button: the one below it is easy to miss, and
              // Chrome only prompts for the camera on a real click.
              <button
                type="button"
                onClick={startCam}
                disabled={disabled}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 transition-colors hover:bg-primary/5 disabled:cursor-not-allowed"
              >
                <Camera className="h-12 w-12 text-primary/70" />
                <span className="font-mono text-xs uppercase tracking-widest text-primary">
                  click to start the camera
                </span>
                <span className="font-mono text-2xs text-muted-foreground">
                  chrome will ask for permission
                </span>
              </button>
            ) : (
              <>
                <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-md border border-primary/30 bg-black/60 px-2 py-1 font-mono text-2xs uppercase tracking-widest text-primary">
                  <Users className="h-3 w-3" />
                  {track.count} face{track.count === 1 ? '' : 's'}
                </span>
                <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-primary/30 bg-black/60 px-2 py-1 font-mono text-2xs uppercase tracking-widest text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  tracking · 10 fps
                </span>
                {track.count === 0 && (
                  <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center font-mono text-2xs uppercase tracking-widest text-muted-foreground">
                    searching for a face…
                  </p>
                )}
              </>
            )}

          </>
        )}

        {busy && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-x-0 h-24 animate-[scan-sweep_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-primary/25 to-transparent" />
          </div>
        )}
      </div>

      {mode === 'webcam' && camError && (
        // The status log sits at the very bottom of the page, so a camera failure
        // has to be legible right here or it reads as the button doing nothing.
        <p
          role="status"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
        >
          {camError}
        </p>
      )}

      {mode === 'webcam' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" /> liveness · eye aspect ratio
            </span>
            {/*
              Two visible options with the live one lit, rather than one button captioned
              with the state it is already in — that read as a label, so nobody realised
              the shutter trigger could be changed at all.
            */}
            <div
              role="group"
              aria-label="Shutter trigger"
              className="flex items-center gap-0.5 rounded-md border border-border bg-black/40 p-0.5"
            >
              {([true, false] as const).map((on) => (
                <button
                  key={String(on)}
                  onClick={() => setLivenessOn(on)}
                  disabled={disabled}
                  aria-pressed={livenessOn === on}
                  title={
                    on
                      ? 'A real blink fires the shutter'
                      : 'Press the button below to fire the shutter'
                  }
                  className={cn(
                    'rounded px-2 py-0.5 font-mono text-2xs uppercase tracking-wider transition-colors',
                    livenessOn === on
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {on ? 'blink' : 'manual'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/40">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-100"
              style={{ width: `${earPct}%` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-destructive/80"
              style={{ left: `${(EAR_CLOSED / 0.45) * 100}%` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-chart-4/80"
              style={{ left: `${(EAR_OPEN / 0.45) * 100}%` }}
            />
          </div>

          <div className="flex items-center justify-between font-mono text-2xs uppercase tracking-wider text-muted-foreground">
            <span className="tabular-nums">EAR {track.ear === null ? '—' : track.ear.toFixed(3)}</span>
            <span className="tabular-nums">
              {blinks} blink{blinks === 1 ? '' : 's'}
            </span>
            <span className={track.ear !== null && track.ear < EAR_CLOSED ? 'text-accent' : 'text-primary'}>
              {!camActive
                ? 'offline'
                : track.ear === null
                  ? 'no eyes tracked'
                  : track.ear < EAR_CLOSED
                    ? 'eyes closed'
                    : livenessOn
                      ? 'awaiting blink'
                      : 'manual shutter'}
            </span>
          </div>
        </div>
      )}

      {faces.length > 1 && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {faces.length} faces in frame · pick the subject
          </p>
          <div className="flex flex-wrap gap-2">
            {crops.map((crop, i) => (
              <button
                key={i}
                onClick={() => pickFace(i)}
                disabled={disabled || busy}
                aria-pressed={i === selected}
                className={cn(
                  'relative h-16 w-16 overflow-hidden rounded-lg border transition-all',
                  i === selected
                    ? 'border-primary ring-2 ring-primary/40'
                    : 'border-border opacity-55 hover:opacity-100',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={crop} alt={`Face ${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/75 font-mono text-3xs tabular-nums text-primary">
                  {String(i + 1).padStart(2, '0')} · {(faces[i].score * 100).toFixed(0)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {mode === 'webcam' &&
          !hasStill &&
          (camActive ? (
            <Button onClick={capture} disabled={disabled || busy} className="flex-1" size="lg">
              <CircleDot className="h-4 w-4" />
              {livenessOn ? 'capture now (skip blink)' : 'capture frame'}
            </Button>
          ) : (
            <Button onClick={startCam} disabled={disabled} className="flex-1" size="lg">
              <Camera className="h-4 w-4" />
              {camError ? 'try again' : 'start camera'}
            </Button>
          ))}
        {hasStill && (
          <Button
            onClick={reset}
            variant="outline"
            disabled={disabled || busy}
            className="flex-1"
            size="lg"
          >
            <RotateCcw className="h-4 w-4" />
            new scan
          </Button>
        )}
      </div>
    </div>
  )
}
