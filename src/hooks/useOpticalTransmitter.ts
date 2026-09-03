import { useCallback, useEffect, useRef, useState } from 'react'
import { GRID_SIZE } from '../lib/opticalFrame'

const COLOR_MAP = ['#000000', '#FF1744', '#00D9B5', '#FFDD00']
const FPS = 20;
const FRAME_TIME = 1000 / FPS;

export function useOpticalTransmitter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const animationRef = useRef<number>(0)
  const lastDrawTime = useRef(0)
  const framesRef = useRef<number[][]>([])
  const frameIndexRef = useRef(0)
  const activeRef = useRef(false)
  const renderLoopRef = useRef<(timestamp: number) => void>(() => {})
  const [currentFrame, setCurrentFrame] = useState(0)

  const showCalibration = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  const drawGrid = useCallback((frame: number[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const blockW = canvas.width / GRID_SIZE
    const blockH = canvas.height / GRID_SIZE
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let col = 0; col < GRID_SIZE; col += 1) {
        ctx.fillStyle = COLOR_MAP[frame[row * GRID_SIZE + col] ?? 0]
        ctx.fillRect(col * blockW, row * blockH, Math.ceil(blockW), Math.ceil(blockH))
      }
    }
  }, [])

  const clearGrid = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const stopTransmission = useCallback(() => {
    activeRef.current = false
    setIsTransmitting(false)
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
  }, [])

  const renderLoop = useCallback((timestamp: number) => {
    if (!activeRef.current) return
    if (timestamp - lastDrawTime.current >= FRAME_TIME) {
      const nextIndex = frameIndexRef.current + 1
      if (nextIndex >= framesRef.current.length) {
        stopTransmission()
        return
      }
      frameIndexRef.current = nextIndex
      setCurrentFrame(nextIndex)
      drawGrid(framesRef.current[nextIndex])
      lastDrawTime.current = timestamp - ((timestamp - lastDrawTime.current) % FRAME_TIME)
    }
    animationRef.current = requestAnimationFrame(renderLoopRef.current)
  }, [drawGrid, stopTransmission])

  useEffect(() => {
    renderLoopRef.current = renderLoop
  }, [renderLoop])

  const startTransmission = useCallback((frames: number[][]) => {
    if (!frames.length) return
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    framesRef.current = frames
    frameIndexRef.current = 0
    setCurrentFrame(0)
    drawGrid(frames[0])
    lastDrawTime.current = performance.now()
    activeRef.current = true
    setIsTransmitting(true)
    animationRef.current = requestAnimationFrame(renderLoop)
  }, [drawGrid, renderLoop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    };
  }, []);

  return { canvasRef, isTransmitting, currentFrame, startTransmission, stopTransmission, clearGrid, showCalibration }
}
