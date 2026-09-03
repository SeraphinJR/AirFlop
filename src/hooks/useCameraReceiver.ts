import { useEffect, useRef, useState } from 'react';

export function useCameraReceiver(onFrameCaptured: (imageData: Uint8ClampedArray) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const animationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // We use a small offscreen canvas to avoid massive memory allocations
  // 400x400 is enough resolution to read a 40x40 grid cleanly.
  const captureSize = 400; 
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));

  useEffect(() => {
    canvasRef.current.width = captureSize;
    canvasRef.current.height = captureSize;
  }, []);

  const startCapture = async () => {
    if (!videoRef.current) return;

    try {
      // Attempt 1: Try to lock manual focus (often rejected by Android Chrome)
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Force rear camera
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: 'manual' } as any] 
        },
        audio: false,
      });
    } catch (err) {
      console.warn("Manual focus rejected, falling back to standard constraints...", err);
      // Attempt 2: Standard rear camera
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    }

    videoRef.current.srcObject = streamRef.current;
    await videoRef.current.play();
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
  };

  const captureLoop = () => {
    if (!isCapturing || !videoRef.current) return;

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
      
      // Fire it up to the orchestrator (which will hand it to the Web Worker)
      onFrameCaptured(frameData.data);
    }

    animationRef.current = requestAnimationFrame(captureLoop);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopCapture();
  }, [isCapturing]);

  return { videoRef, isCapturing, startCapture, stopCapture };
}