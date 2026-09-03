import { useEffect, useRef, useState } from 'react';

type DecoderWorkerMessage = MessageEvent<unknown>
type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

export function useCameraReceiver(onWorkerMessage: (event: DecoderWorkerMessage) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const animationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderWorkerRef = useRef<Worker | null>(null)
  const onWorkerMessageRef = useRef(onWorkerMessage)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)

  // We use a small offscreen canvas to avoid massive memory allocations
  // 400x400 is enough resolution to read a 40x40 grid cleanly.
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
    decoderWorker.onmessage = event => onWorkerMessageRef.current(event)
    decoderWorker.onerror = event => console.error('[Decoder] Worker error.', event)
    decoderWorkerRef.current = decoderWorker
    return decoderWorker
  }

  const startCapture = async () => {
    if (!videoRef.current) {
      console.warn('[Camera] Cannot start: video element is not mounted.');
      return;
    }

    try {
      const wakeLock = (navigator as WakeLockNavigator).wakeLock
      if (wakeLock) wakeLockRef.current = await wakeLock.request('screen')
    } catch (error) {
      // A Wake Lock is a best-effort enhancement; camera capture still works without it.
      console.warn('[Camera] Screen Wake Lock was not granted.', error)
    }

    try {
      console.info('[Camera] Requesting rear camera access...');
      // Attempt 1: Try to lock manual focus (often rejected by Android Chrome)
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Force rear camera
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: 'manual' } as MediaTrackConstraintSet & { focusMode: string }]
        },
        audio: false,
      });
    } catch (err) {
      console.warn('[Camera] Manual focus rejected; falling back to standard constraints.', err);
      // Attempt 2: Standard rear camera
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (fallbackError) {
        console.error('[Camera] Unable to access the camera.', fallbackError);
        const wakeLock = wakeLockRef.current
        wakeLockRef.current = null
        if (wakeLock) void wakeLock.release().catch(() => undefined)
        return;
      }
    }

    ensureDecoderWorker().postMessage({ type: 'RESET' })

    videoRef.current.srcObject = streamRef.current;
    videoRef.current.onloadedmetadata = () => {
      console.info('[Camera] Video metadata ready.', {
        width: videoRef.current?.videoWidth,
        height: videoRef.current?.videoHeight,
      });
    };
    await videoRef.current.play();
    console.info('[Camera] Video playback started.');
    setIsCapturing(true);

    // Start the extraction loop
    captureLoop();
  };

  const stopCapture = () => {
    setIsCapturing(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    const wakeLock = wakeLockRef.current
    wakeLockRef.current = null
    if (wakeLock) void wakeLock.release().catch(error => console.warn('[Camera] Failed to release Wake Lock.', error))
  };

  const captureLoop = () => {
    if (!streamRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (ctx) {
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

  return { videoRef, isCapturing, startCapture, stopCapture };
}
