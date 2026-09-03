import { useEffect, useRef, useState } from 'react';
import { TRANSMISSION_FPS } from '../lib/opticalFrame'

type DecoderWorkerMessage = MessageEvent<unknown>
type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}
type ReceiverDebug = {
  status: string
  uniqueFrameIds: number[]
  totalFrameCount: number | null
  framesScanned: number
  detectedFrames: number
  decoder: string
  error: string
  anchors: { x: number; y: number }[]
}

export function useCameraReceiver(onWorkerMessage: (event: DecoderWorkerMessage) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const animationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderWorkerRef = useRef<Worker | null>(null)
  const onWorkerMessageRef = useRef(onWorkerMessage)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const scanningRef = useRef(false)
  const scannedFramesRef = useRef(0)
  const lastFrameSentAtRef = useRef(0)
  const [debug, setDebug] = useState<ReceiverDebug>({
    status: 'Camera is idle', uniqueFrameIds: [], totalFrameCount: null, framesScanned: 0, detectedFrames: 0, decoder: 'Waiting', error: '', anchors: [],
  })

  // We use a small offscreen canvas to avoid massive memory allocations
  // 400x400 gives the low-density 24x24 grid generous sampling room.
  const captureSize = 400; 
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));

  useEffect(() => {
    canvasRef.current.width = captureSize;
    canvasRef.current.height = captureSize;
  }, []);

  useEffect(() => {
    onWorkerMessageRef.current = onWorkerMessage
  }, [onWorkerMessage])

  const ensureDecoderWorker = () => {
    if (decoderWorkerRef.current) return decoderWorkerRef.current

    const decoderWorker = new Worker(new URL('../decoder.worker.ts', import.meta.url), { type: 'module' })
    decoderWorker.onmessage = event => {
      const message = event.data as { type?: string; status?: string; detectedFrames?: number; anchors?: { x: number; y: number }[]; foundFrameIds?: number[]; totalFrameCount?: number | null }
      setDebug(current => ({
        ...current,
        detectedFrames: message.detectedFrames ?? current.detectedFrames,
        anchors: message.type === 'DEBUG' ? message.anchors ?? [] : current.anchors,
        uniqueFrameIds: message.foundFrameIds ?? current.uniqueFrameIds,
        totalFrameCount: message.totalFrameCount ?? current.totalFrameCount,
        decoder: message.status
          ? `${message.status}${'rejectionSummary' in message && message.rejectionSummary ? ` · ${message.rejectionSummary}` : ''}`
          : (message.type ? `Received ${message.type}` : 'Received an unrecognised message'),
      }))
      onWorkerMessageRef.current(event)
    }
    decoderWorker.onerror = event => {
      const error = event.message || 'Decoder worker failed.'
      console.error('[Decoder] Worker error.', event)
      setDebug(current => ({ ...current, status: 'Decoder error', error }))
    }
    decoderWorkerRef.current = decoderWorker
    return decoderWorker
  }

  const startCapture = async () => {
    if (!videoRef.current) {
      console.warn('[Camera] Cannot start: video element is not mounted.');
      setDebug(current => ({ ...current, status: 'Camera element unavailable', error: 'The camera preview is not mounted.' }))
      return;
    }

    scannedFramesRef.current = 0
    lastFrameSentAtRef.current = 0
    setDebug({ status: 'Requesting camera permission…', uniqueFrameIds: [], totalFrameCount: null, framesScanned: 0, detectedFrames: 0, decoder: 'Waiting', error: '', anchors: [] })

    try {
      const wakeLock = (navigator as WakeLockNavigator).wakeLock
      if (wakeLock) wakeLockRef.current = await wakeLock.request('screen')
    } catch (error) {
      // A Wake Lock is a best-effort enhancement; camera capture still works without it.
      console.warn('[Camera] Screen Wake Lock was not granted.', error)
    }

    try {
      console.info('[Camera] Requesting rear camera access...');
      // Keep autofocus active. Manual focus can leave a display permanently out of focus.
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    } catch (err) {
      console.warn('[Camera] Preferred rear-camera constraints were rejected; falling back.', err);
      // Attempt 2: Standard rear camera
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (fallbackError) {
        console.error('[Camera] Unable to access the camera.', fallbackError);
        setDebug(current => ({ ...current, status: 'Camera unavailable', error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }))
        const wakeLock = wakeLockRef.current
        wakeLockRef.current = null
        if (wakeLock) void wakeLock.release().catch(() => undefined)
        return;
      }
    }

    ensureDecoderWorker().postMessage({ type: 'RESET' })

    videoRef.current.srcObject = streamRef.current;
    const startScanning = () => {
      const video = videoRef.current
      if (!video || !streamRef.current || !video.videoWidth || !video.videoHeight || scanningRef.current) return
      scanningRef.current = true
      setIsCapturing(true)
      setDebug(current => ({ ...current, status: 'Scanning optical frames' }))
      captureLoop()
    }
    videoRef.current.onloadedmetadata = () => {
      const video = videoRef.current
      console.info('[Camera] Video metadata ready.', {
        width: video?.videoWidth,
        height: video?.videoHeight,
      });
      setDebug(current => ({ ...current, status: 'Video metadata received' }))
      startScanning()
    };
    await videoRef.current.play();
    console.info('[Camera] Video playback started.');
    // Some mobile browsers expose dimensions only after play(), while others fire
    // loadedmetadata first. This covers both without drawing invalid 0 × 0 frames.
    startScanning()
  };

  const stopCapture = () => {
    setIsCapturing(false);
    scanningRef.current = false
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null
    const wakeLock = wakeLockRef.current
    wakeLockRef.current = null
    if (wakeLock) void wakeLock.release().catch(error => console.warn('[Camera] Failed to release Wake Lock.', error))
    setDebug(current => ({ ...current, status: 'Camera stopped' }))
  };

  const captureLoop = () => {
    if (!scanningRef.current || !streamRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    // The worker does substantial pixel analysis. Pacing input to the sender's
    // 20fps prevents a backlog of stale frames on mobile devices.
    const now = performance.now()
    if (ctx && now - lastFrameSentAtRef.current >= 1000 / TRANSMISSION_FPS) {
      // Draw the center square of the video frame to our offscreen canvas
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      const minDim = Math.min(vw, vh);
      const startX = (vw - minDim) / 2;
      const startY = (vh - minDim) / 2;

      ctx.drawImage(
        videoRef.current,
        startX, startY, minDim, minDim, // Source crop (center square)
        0, 0, captureSize, captureSize  // Destination (400x400)
      );

      // Extract the raw pixel buffer (R,G,B,A for every pixel)
      const frameData = ctx.getImageData(0, 0, captureSize, captureSize);
      
      // Transfer ownership so the main thread never copies the 400 x 400 RGBA buffer.
      ensureDecoderWorker().postMessage(
        { pixels: frameData.data, width: captureSize, height: captureSize },
        [frameData.data.buffer],
      )
      lastFrameSentAtRef.current = now
      scannedFramesRef.current += 1
      if (scannedFramesRef.current % 15 === 0) {
        setDebug(current => ({ ...current, framesScanned: scannedFramesRef.current }))
      }
    }

    animationRef.current = requestAnimationFrame(captureLoop);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
      const wakeLock = wakeLockRef.current
      wakeLockRef.current = null
      if (wakeLock) void wakeLock.release().catch(() => undefined)
      decoderWorkerRef.current?.terminate()
      decoderWorkerRef.current = null
    };
  }, []);

  return { videoRef, isCapturing, startCapture, stopCapture, debug };
}
