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
  trackFaces,
  type FaceResult,
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

export function Scanner({ log, onDetected, onReset, disabled }: ScannerProps) {
  const [mode, setMode] = useState<Mode>('upload')
  const [hasStill, setHasStill] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [camActive, setCamActive] = useState(false)

  const [faces, setFaces] = useState<FaceResult[]>([])
  const [crops, setCrops] = useState<string[]>([])
  const [selected, setSelected] = useState(0)

  const [livenessOn, setLivenessOn] = useState(true)
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

  /** Runs the full 416px pass over a captured still and hands the pick upstream. */
  const process = useCallback(
    async (dataUrl: string) => {
      setBusy(true)
      onReset()
      setFaces([])
      setCrops([])
      setSelected(0)
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = dataUrl
        await img.decode()

        const still = document.createElement('canvas')
        still.width = img.naturalWidth
        still.height = img.naturalHeight
        still.getContext('2d')!.drawImage(img, 0, 0)
        stillRef.current = still
        setHasStill(true)

        log('info', `running full detection pass on ${still.width}x${still.height} frame…`)
        const found = await detectFaces(still)
        renderStill(found, 0)

        if (found.length === 0) {
          log('error', 'no face detected — try a clearer, front-facing photo')
          return
        }

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
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        log('error', 'unsupported file — please drop an image')
        return
      }
      const reader = new FileReader()
      reader.onload = () => process(reader.result as string)
      reader.readAsDataURL(file)
    },
    [log, process],
  )

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const frame = document.createElement('canvas')
    frame.width = video.videoWidth
    frame.height = video.videoHeight
    frame.getContext('2d')!.drawImage(video, 0, 0)
    stopCam()
    process(frame.toDataURL('image/jpeg', 0.92))
  }, [process, stopCam])

  captureRef.current = capture

  const startCam = useCallback(async () => {
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
      log('ok', livenessOn ? 'camera live · blink to capture' : 'camera live')
    } catch {
      log('error', 'camera permission denied or unavailable')
    }
  }, [livenessOn, log])

  armedRef.current = livenessOn && camActive && !busy && !hasStill

  // Live pre-capture loop: detect, draw the HUD, and watch the eyes for a blink.
  useEffect(() => {
    if (!camActive) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

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
          const found = await trackFaces(video)
          if (cancelled) return

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

  const reset = useCallback(() => {
    stillRef.current = null
    setHasStill(false)
    setFaces([])
    setCrops([])
    setSelected(0)
    setBlinks(0)
    eyePhaseRef.current = 'open'
    stopCam()
    onReset()
    log('info', 'scanner reset')
  }, [log, onReset, stopCam])

  const earPct = track.ear === null ? 0 : Math.min(100, (track.ear / 0.45) * 100)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {(['upload', 'webcam'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m)
              if (m === 'upload') stopCam()
            }}
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

      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-black/40 bg-grid">
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Camera className="h-12 w-12 text-primary/70" />
                <p className="font-mono text-xs text-muted-foreground">camera offline</p>
              </div>
            ) : (
              <>
                <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-md border border-primary/30 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
                  <Users className="h-3 w-3" />
                  {track.count} face{track.count === 1 ? '' : 's'}
                </span>
                <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-primary/30 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  tracking · 10 fps
                </span>
                {track.count === 0 && (
                  <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
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

      {mode === 'webcam' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" /> liveness · eye aspect ratio
            </span>
            <button
              onClick={() => setLivenessOn((v) => !v)}
              disabled={disabled}
              className={cn(
                'rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                livenessOn
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {livenessOn ? 'blink to capture' : 'manual capture'}
            </button>
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

          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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
                      : 'live'}
            </span>
          </div>
        </div>
      )}

      {faces.length > 1 && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
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
                <span className="absolute inset-x-0 bottom-0 bg-black/75 font-mono text-[9px] tabular-nums text-primary">
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
              start camera
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
