import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera,
  FileUp,
  Laptop,
  Lightbulb,
  Play,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Square,
  Zap,
} from 'lucide-react'
import { useOpticalTransmitter } from './hooks/useOpticalTransmitter'
import { useCameraReceiver } from './hooks/useCameraReceiver'
import { buildTransmissionFrames, GRID_SIZE, TRANSMISSION_FPS } from './lib/opticalFrame'

export default function Page() {
  const [mode, setMode] = useState<'send' | 'catch'>('send')
  const [progress, setProgress] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [frames, setFrames] = useState<number[][]>([])
  const [totalFrames, setTotalFrames] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [receivedFrames, setReceivedFrames] = useState(0)
  const [transferComplete, setTransferComplete] = useState(false)
  const stopCaptureRef = useRef<() => void>(() => undefined)
  const { canvasRef, isTransmitting, currentFrame, startTransmission, stopTransmission, clearGrid, showCalibration } = useOpticalTransmitter()
  const handleDecoderMessage = useCallback((event: MessageEvent<unknown>) => {
    const message = event.data as { type?: string; totalFrames?: number; received?: number; total?: number; blobUrl?: string; filename?: string }
    if (message.type === 'MANIFEST' && message.totalFrames !== undefined) {
      setTotalFrames(message.totalFrames)
      setReceivedFrames(0)
      setProgress(0)
      setTransferComplete(false)
    }
    if (message.type === 'PROGRESS' && message.total !== undefined && message.received !== undefined) {
      setTotalFrames(message.total)
      setReceivedFrames(message.received)
      setProgress(Math.min(100, (message.received / message.total) * 100))
    }
    if (message.type === 'COMPLETE' && message.blobUrl) {
      stopCaptureRef.current()
      const download = document.createElement('a')
      download.href = message.blobUrl
      download.download = message.filename || 'reconstructed'
      download.hidden = true
      document.body.append(download)
      download.click()
      download.remove()
      window.setTimeout(() => URL.revokeObjectURL(message.blobUrl!), 1_000)
      setProgress(100)
      setTransferComplete(true)
    }
  }, [])
  const { videoRef, isCapturing, startCapture, stopCapture, debug: receiverDebug } = useCameraReceiver(handleDecoderMessage);
  const isStreaming = isTransmitting || isCapturing;

  useEffect(() => {
    stopCaptureRef.current = stopCapture
  }, [stopCapture])

  const expectedTime = totalFrames / TRANSMISSION_FPS
  const timeRemaining = Math.max(0, (totalFrames - currentFrame) / TRANSMISSION_FPS)
  const transmissionProgress = totalFrames > 0 ? Math.min(100, ((currentFrame + 1) / totalFrames) * 100) : 0

  useEffect(() => {
    if (countdown === null) return
    const timeout = window.setTimeout(() => {
      if (countdown === 1) {
        startTransmission(frames)
        setCountdown(null)
      } else {
        setCountdown(countdown - 1)
      }
    }, 1000)
    return () => window.clearTimeout(timeout)
  }, [countdown, frames, startTransmission])

  async function handleFileChange(nextFile: File | null) {
    setFile(nextFile)
    setCountdown(null)
    setProgress(0)
    if (!nextFile) {
      setFrames([])
      setTotalFrames(0)
      return
    }
    const data = new Uint8Array(await nextFile.arrayBuffer())
    const extensionStart = nextFile.name.lastIndexOf('.')
    const extension = extensionStart > 0 ? nextFile.name.slice(extensionStart + 1) : ''
    const nextFrames = await buildTransmissionFrames(data, extension)
    setFrames(nextFrames)
    setTotalFrames(nextFrames.length)
  }

  function handleModeChange(nextMode: 'send' | 'catch') {
    if (nextMode === 'send') {
      stopCapture()
      setFile(null)
      setFrames([])
      setTotalFrames(0)
      setCountdown(null)
      setProgress(0)
    }
    setMode(nextMode)
  }

  async function handleToggleBeam() {
    if (isTransmitting) {
      stopTransmission()
      return
    }

    if (!file) return
    if (!frames.length) return
    setProgress(0)
    showCalibration()
    setCountdown(3)
  }

  function handleToggleCapture() {
    if (isCapturing) {
      stopCapture()
      return
    }

    setTransferComplete(false)
    setReceivedFrames(0)
    setProgress(0)
    void startCapture()
  }

  function handleReset() {
    stopTransmission()
    stopCapture()
    clearGrid()
    setProgress(0)
    setFile(null)
    setFrames([])
    setTotalFrames(0)
    setCountdown(null)
    setReceivedFrames(0)
    setTransferComplete(false)
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-4 px-5 py-4 md:px-8 lg:px-12">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Lightbulb size={19} />
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Optical Data
            </p>
            <p className="text-base font-bold tracking-tight">Bridge</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold shadow-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-mint" /> System Ready
        </div>
      </header>

      <section className="mx-auto max-w-[90rem] px-5 pb-0 md:px-8 lg:px-12">
        <div
          className="mx-auto flex max-w-fit items-center gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-sm"
          role="tablist"
          aria-label="Bridge mode"
        >
          <button
            onClick={() => handleModeChange('send')}
            disabled={isStreaming}
            role="tab"
            aria-selected={mode === 'send'}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-95 ${
              mode === 'send'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Laptop size={16} /> Send File
          </button>
          <button
            onClick={() => handleModeChange('catch')}
            disabled={isStreaming}
            role="tab"
            aria-selected={mode === 'catch'}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-95 ${
              mode === 'catch'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <Smartphone size={16} /> Catch File
          </button>
        </div>

        <div className="mt-4 grid items-center gap-6 lg:grid-cols-[1fr_1.5fr] lg:gap-10">
          <div>
            <AnimatePresence mode="wait">
              {mode === 'send' ? (
                <motion.div
                  key="send"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                >
                  <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.18em] text-coral">
                    Laptop transmitter
                  </p>
                  <h1 className="max-w-xl text-balance text-5xl font-black leading-[0.98] tracking-[-0.06em] md:text-7xl">
                    Send files through{' '}
                    <span className="relative inline-block">
                      light.
                      <span className="absolute -bottom-1 left-1 right-0 h-3 -rotate-2 rounded-full bg-yellow/70" />
                    </span>
                  </h1>
                  <p className="mt-4 max-w-md text-pretty text-base leading-7 text-muted-foreground">
                    A tiny, private light show for moving files from your screen to
                    any phone camera. No cloud. No cables. Just color.
                  </p>
                  <label className="mt-5 flex cursor-pointer items-center gap-4 rounded-3xl border-2 border-dashed border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-muted">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow/40 text-primary">
                      <FileUp size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">
                        {file ? file.name : 'Drop a file to start the light show.'}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-muted-foreground">
                        {file
                          ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${totalFrames} frames · ~${expectedTime.toFixed(1)}s`
                          : 'or click to browse your laptop'}
                      </span>
                    </span>
                    <input
                      className="sr-only"
                      type="file"
                      onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {file && (
                    <div className="mt-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className="h-full rounded-full bg-coral"
                          animate={{ width: `${isTransmitting ? transmissionProgress : 0}%` }}
                        />
                      </div>
                      <p className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {isTransmitting ? `${Math.round(transmissionProgress)}% transmitted` : `${totalFrames} frames staged`}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={handleToggleBeam}
                    disabled={!file || !frames.length || countdown !== null}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-[0_5px_0_hsl(var(--primary-shadow))] transition-all hover:-translate-y-0.5 active:translate-y-1 disabled:opacity-60"
                  >
                    {isTransmitting ? (
                      <>
                        <Square size={17} fill="currentColor" /> Stop Beaming
                      </>
                    ) : countdown !== null ? (
                      <>Starting in {countdown}...</>
                    ) : (
                      <>
                        <Play size={17} fill="currentColor" /> Start Beaming{' '}
                        <Zap size={16} />
                      </>
                    )}
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="catch"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                >
                  <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.18em] text-mint-dark">
                    Phone receiver
                  </p>
                  <h1 className="max-w-xl text-balance text-5xl font-black leading-[0.98] tracking-[-0.06em] md:text-7xl">
                    Catch the <span className="text-mint-dark">light.</span>
                  </h1>
                  <p className="mt-4 max-w-md text-pretty text-base leading-7 text-muted-foreground">
                    Point your camera at the sender's grid and let Bridge rebuild
                    your file, one colorful frame at a time.
                  </p>
                  <button
                    onClick={handleToggleCapture}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-[0_5px_0_hsl(var(--primary-shadow))] transition-all hover:-translate-y-0.5 active:translate-y-1"
                  >
                    <Camera size={17} /> {isCapturing ? 'Close Camera' : 'Open Camera'}
                  </button>
                  <div className="mt-5 rounded-3xl border border-border bg-card p-4 shadow-sm">
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className="h-full rounded-full bg-mint-dark"
                        animate={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      {transferComplete
                        ? 'File Received! Check your downloads.'
                        : totalFrames
                          ? `Caught ${receivedFrames} / ${totalFrames} chunks`
                          : 'Waiting for a signal...'}
                    </p>
                  </div>
                  <details className="mt-3 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-xs">
                    <summary className="cursor-pointer font-mono font-bold text-foreground">
                      Receiver diagnostics (phone-friendly)
                    </summary>
                    <dl className="mt-3 grid gap-2 break-words font-mono text-[11px] leading-5 text-muted-foreground">
                      <div><dt className="inline text-foreground">Status: </dt><dd className="inline">{receiverDebug.status}</dd></div>
                      <div><dt className="inline text-foreground">Video: </dt><dd className="inline">{receiverDebug.metadata}</dd></div>
                      <div><dt className="inline text-foreground">Track: </dt><dd className="inline">{receiverDebug.track}</dd></div>
                      <div><dt className="inline text-foreground">Frames scanned: </dt><dd className="inline">{receiverDebug.framesScanned}</dd></div>
                      <div><dt className="inline text-foreground">Detected frames: </dt><dd className="inline">{receiverDebug.detectedFrames}</dd></div>
                      <div><dt className="inline text-foreground">Decoder: </dt><dd className="inline">{receiverDebug.decoder}</dd></div>
                          <div><dt className="inline text-foreground">Anchors: </dt><dd className="inline">{receiverDebug.anchors.length} / 4 detected</dd></div>
                      {receiverDebug.error && <div className="text-coral"><dt className="inline text-foreground">Error: </dt><dd className="inline">{receiverDebug.error}</dd></div>}
                    </dl>
                  </details>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-5 flex items-start gap-3 rounded-2xl bg-yellow/25 p-4 text-xs leading-5 text-foreground">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-coral" />
              <p>
                <strong>Photosensitivity notice:</strong> This app uses rapidly
                flashing colors. Do not use if you are sensitive to flashing lights
                or have photosensitive epilepsy.
              </p>
            </div>
          </div>

          <div className="relative rounded-[2rem] border border-border bg-card p-4 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.25)] md:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {mode === 'send' ? 'Live transmission' : 'Live receiver'}
                </p>
                <p className="mt-1 text-sm font-bold">
                  {mode === 'send'
                    ? isTransmitting
                      ? `Transmitting data payload · ${timeRemaining.toFixed(1)}s remaining`
                      : 'Ready to beam'
                    : isCapturing
                      ? 'Scanning for data payload...'
                      : 'Ready to receive'}
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 font-mono text-[10px] font-bold">
                <span
                  className={`h-2 w-2 rounded-full ${
                    (mode === 'send' ? isTransmitting : isCapturing)
                      ? 'animate-ping bg-coral'
                      : 'bg-mint-dark'
                  }`}
                />{' '}
                {(mode === 'send' ? isTransmitting : isCapturing) ? 'ACTIVE' : 'IDLE'}
              </div>
            </div>

            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border-4 border-primary/10 bg-black lg:h-[calc(100vh-19rem)] lg:aspect-auto">
              {mode === 'send' ? (
                <>
                  <canvas
                    ref={canvasRef}
                    width={800}
                    height={800}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                  {countdown !== null ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/10 font-mono text-primary">
                      <span className="text-xs font-bold uppercase tracking-[0.3em]">Beam starts in</span>
                      <span className="mt-2 text-8xl font-black text-yellow">{countdown}</span>
                    </div>
                  ) : !isTransmitting && (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/50 font-mono text-sm">
                      GRID STANDBY
                    </div>
                  )}
                </>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full rounded-2xl object-cover transition-opacity duration-300 ${
                      isCapturing ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                    <div className="relative h-full w-full rounded-xl border-2 border-mint-dark/60">
                      {[
                        ['top-left', 'left-[8.33%] top-[8.33%] bg-coral'],
                        ['top-right', 'right-[8.33%] top-[8.33%] bg-mint-dark'],
                        ['bottom-right', 'right-[8.33%] bottom-[8.33%] bg-yellow'],
                        ['bottom-left', 'left-[8.33%] bottom-[8.33%] bg-coral'],
                      ].map(([label, className]) => (
                        <span key={label} className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 shadow-sm ${className}`} />
                      ))}
                      {receiverDebug.anchors.map((anchor, index) => (
                        <span
                          key={`detected-${index}`}
                          className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_2px_hsl(var(--primary))]"
                          style={{ left: `${(anchor.x / 400) * 100}%`, top: `${(anchor.y / 400) * 100}%` }}
                        />
                      ))}
                    </div>
                  </div>
                  {!isCapturing && (
                    <div className="absolute inset-0 flex items-center justify-center font-mono text-sm text-muted-foreground/70">
                      CAMERA READY
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-coral" />
                {mode === 'send' ? `${GRID_SIZE} × ${GRID_SIZE} color grid` : 'Camera frame scanner'}
              </span>
              <button
                onClick={handleReset}
                className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 font-bold shadow-sm transition-colors hover:bg-muted hover:text-foreground"
              >
                <RotateCcw size={13} /> Reset bridge
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
