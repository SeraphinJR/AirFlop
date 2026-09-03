import { useEffect, useRef, useState } from 'react';

// 00=Black, 01=Red, 10=Green, 11=Blue
const COLOR_MAP = ['#000000', '#FF0000', '#00FF00', '#0000FF'];
const GRID_SIZE = 40;
const FPS = 20;
const FRAME_TIME = 1000 / FPS;

export function useOpticalTransmitter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const animationRef = useRef<number>(0);
  const lastDrawTime = useRef<number>(0);

  // Mock payload for testing: Array of integers 0-3 representing the 2-bit colors
  const payloadRef = useRef<Uint8Array>(new Uint8Array(GRID_SIZE * GRID_SIZE).fill(0));

  const startTransmission = (binaryData: Uint8Array) => {
    // In production, binaryData gets chunked and fed to payloadRef frame by frame
    payloadRef.current = binaryData;
    setIsTransmitting(true);
    lastDrawTime.current = performance.now();
    renderLoop(performance.now());
  };

  const stopTransmission = () => {
    setIsTransmitting(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  };

  const renderLoop = (timestamp: number) => {
    if (!isTransmitting || !canvasRef.current) return;

    const elapsed = timestamp - lastDrawTime.current;

    // Throttle to 20 FPS (50ms)
    if (elapsed > FRAME_TIME) {
      const ctx = canvasRef.current.getContext('2d', { alpha: false });
      if (ctx) {
        drawGrid(ctx, canvasRef.current.width, canvasRef.current.height);
      }
      // Adjust lastDrawTime to maintain consistent pacing, accounting for jitter
      lastDrawTime.current = timestamp - (elapsed % FRAME_TIME);
    }

    animationRef.current = requestAnimationFrame(renderLoop);
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const blockW = width / GRID_SIZE;
    const blockH = height / GRID_SIZE;
    const data = payloadRef.current;

    // Randomize for testing if no actual data is being processed yet
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const i = row * GRID_SIZE + col;
        // Grab color index (0-3). Math.random is just to simulate visual noise for now.
        const colorIndex = isTransmitting ? Math.floor(Math.random() * 4) : data[i]; 
        
        ctx.fillStyle = COLOR_MAP[colorIndex];
        ctx.fillRect(col * blockW, row * blockH, Math.ceil(blockW), Math.ceil(blockH));
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return { canvasRef, isTransmitting, startTransmission, stopTransmission };
}