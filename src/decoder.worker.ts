import { ReedSolomonErasure } from './lib/reedSolomon'
import reedSolomonWasmUrl from '@subspace/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm?url'

// Keep this in sync with opticalFrame.ts. This low-density mode makes each cell
// much easier for phone cameras to resolve while the protocol is being tested.
const GRID_SIZE = 24
const BYTES_PER_FRAME = (GRID_SIZE * GRID_SIZE - 24) / 4
const DATA_SHARDS = 4
const PARITY_SHARDS = 1
const SHARDS_PER_GROUP = DATA_SHARDS + PARITY_SHARDS
const REFERENCE_COLORS: readonly Rgb[] = [
  [0, 0, 0], // black
  [255, 23, 68], // red
  [0, 217, 181], // cyan-green
  [255, 221, 0], // yellow
]

type Rgb = readonly [number, number, number]
type Point = { x: number; y: number }
type Homography = readonly [number, number, number, number, number, number, number, number]
type Manifest = { fileSize: number; payloadFrameCount: number; extension: string }
type FrameMessage = { pixels: Uint8ClampedArray; width?: number; height?: number }
type DecoderMessage = FrameMessage | { type: 'RESET' }

const receivedFrames = new Map<number, Uint8Array>()
let manifest: Manifest | null = null
let decoding = false
let complete = false
let inspectedFrames = 0
let lastRejection = ''
let reedSolomonPromise: Promise<ReedSolomonErasure> | undefined

self.onmessage = (event: MessageEvent<DecoderMessage>) => {
  if ('type' in event.data && event.data.type === 'RESET') {
    receivedFrames.clear()
    manifest = null
    decoding = false
    complete = false
    inspectedFrames = 0
    lastRejection = ''
    return
  }
  if ('pixels' in event.data) void processFrame(event.data)
}

async function processFrame({ pixels, width = 400, height = 400 }: FrameMessage) {
  if (decoding || complete) return
  inspectedFrames += 1
  if (inspectedFrames % 30 === 0) {
    self.postMessage({ type: 'DEBUG', status: lastRejection || `Analysed ${inspectedFrames} camera frames; searching for the grid` })
  }
  if (pixels.length !== width * height * 4) return reportRejection('Invalid camera frame dimensions')

  const anchors = findAnchors(pixels, width, height)
  if (!anchors) return reportRejection('Finder markers not recognised — centre and fill the guide')
  const transform = createHomography(
    // Finder markers occupy cells, so map their centres (0.5 and 39.5), not
    // the grid's outer edges. Mapping 0..40 puts top-row samples on a boundary.
    [{ x: 0.5, y: 0.5 }, { x: GRID_SIZE - 0.5, y: 0.5 }, { x: GRID_SIZE - 0.5, y: GRID_SIZE - 0.5 }, { x: 0.5, y: GRID_SIZE - 0.5 }],
    anchors,
  )
  if (!transform) return reportRejection('Grid perspective could not be calculated')

  const sampleCell = (column: number, row: number) => sampleRgb(pixels, width, height, project(transform, column + 0.5, row + 0.5))
  const calibration = [0, 1, 2, 3].map(column => sampleCell(column + 1, 0))
  if (calibration.some(color => color === null)) return reportRejection('Calibration strip is outside the camera frame')
  const palette = calibration as Rgb[]

  // Column 21 is the sender's frame-clock cell. A color between palette values means
  // that the camera observed a display refresh midway through an update.
  const clock = sampleCell(21, 0)
  if (!clock || isBlurred(clock, palette)) return reportRejection('Image is blurred or a display refresh is in progress')

  let frameId = 0
  for (let column = 5; column <= 20; column += 1) {
    const color = sampleCell(column, 0)
    if (!color) return reportRejection('Frame ID is outside the camera frame')
    const symbol = classify(color, palette)
    if (symbol === null) return reportRejection('Frame ID colours are not distinct enough')
    frameId = (frameId * 4 + symbol) >>> 0
  }

  const payload = new Uint8Array(BYTES_PER_FRAME)
  let symbolIndex = 0
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      if (isReservedCell(row, column)) continue
      const color = sampleCell(column, row)
      if (!color) return reportRejection('Payload is outside the camera frame')
      const symbol = classify(color, palette)
      if (symbol === null) return reportRejection('Payload colours are not distinct enough')
      payload[symbolIndex >> 2] |= symbol << (6 - (symbolIndex & 3) * 2)
      symbolIndex += 1
    }
  }

  if (frameId === 0) {
    const nextManifest = parseManifest(payload)
    if (!nextManifest) return
    if (!manifest || !sameManifest(manifest, nextManifest)) {
      receivedFrames.clear()
      manifest = nextManifest
      self.postMessage({ type: 'MANIFEST', totalFrames: nextManifest.payloadFrameCount + 1 })
    }
    if (receivedFrames.has(0)) return
    receivedFrames.set(0, payload)
    postProgress()
    await tryComplete()
    return
  }

  if (!manifest || frameId > manifest.payloadFrameCount || receivedFrames.has(frameId)) return
  receivedFrames.set(frameId, payload)
  postProgress()

  const requiredDataFrames = (manifest.payloadFrameCount / SHARDS_PER_GROUP) * DATA_SHARDS + 1
  if (receivedFrames.size >= requiredDataFrames) await tryComplete()
}

function reportRejection(reason: string) {
  if (reason === lastRejection) return
  lastRejection = reason
  self.postMessage({ type: 'DEBUG', status: reason })
}

function postProgress() {
  if (!manifest) return
  self.postMessage({
    type: 'PROGRESS',
    received: receivedFrames.size,
    total: manifest.payloadFrameCount + 1,
  })
}

function isReservedCell(row: number, column: number) {
  return (row === 0 && column <= 20) ||
    (row === 0 && column === GRID_SIZE - 1) ||
    (row === GRID_SIZE - 1 && column === 0) ||
    (row === GRID_SIZE - 1 && column === GRID_SIZE - 1)
}

function parseManifest(payload: Uint8Array): Manifest | null {
  if (payload[0] !== 0x41 || payload[1] !== 0x49 || payload[2] !== 0x52 || payload[3] !== 0x46) return null
  const extensionLength = payload[10]
  if (extensionLength > BYTES_PER_FRAME - 11) return null
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const payloadFrameCount = view.getUint16(8, false)
  if (payloadFrameCount % SHARDS_PER_GROUP !== 0) return null
  const maximumFileSize = (payloadFrameCount / SHARDS_PER_GROUP) * DATA_SHARDS * BYTES_PER_FRAME
  if (view.getUint32(4, false) > maximumFileSize) return null
  return {
    fileSize: view.getUint32(4, false),
    payloadFrameCount,
    extension: new TextDecoder().decode(payload.subarray(11, 11 + extensionLength)),
  }
}

async function tryComplete() {
  if (!manifest || decoding) return
  const groupCount = manifest.payloadFrameCount / SHARDS_PER_GROUP
  for (let group = 0; group < groupCount; group += 1) {
    let available = 0
    for (let shard = 0; shard < SHARDS_PER_GROUP; shard += 1) if (receivedFrames.has(group * SHARDS_PER_GROUP + shard + 1)) available += 1
    if (available < DATA_SHARDS) return
  }

  decoding = true
  try {
    const result = new Uint8Array(groupCount * DATA_SHARDS * BYTES_PER_FRAME)
    const reedSolomon = await getReedSolomon()
    for (let group = 0; group < groupCount; group += 1) {
      const shards = new Uint8Array(SHARDS_PER_GROUP * BYTES_PER_FRAME)
      const available: boolean[] = []
      for (let shard = 0; shard < SHARDS_PER_GROUP; shard += 1) {
        const frame = receivedFrames.get(group * SHARDS_PER_GROUP + shard + 1)
        available.push(Boolean(frame))
        if (frame) shards.set(frame, shard * BYTES_PER_FRAME)
      }
      if (reedSolomon.reconstruct(shards, DATA_SHARDS, PARITY_SHARDS, available) !== ReedSolomonErasure.RESULT_OK) return
      result.set(shards.subarray(0, DATA_SHARDS * BYTES_PER_FRAME), group * DATA_SHARDS * BYTES_PER_FRAME)
    }
    const blob = new Blob([result.slice(0, manifest.fileSize)], { type: mimeTypeFor(manifest.extension) })
    const extension = manifest.extension.trim().replace(/^\.+/, '')
    complete = true
    self.postMessage({
      type: 'COMPLETE',
      blobUrl: URL.createObjectURL(blob),
      filename: extension ? `reconstructed.${extension}` : 'reconstructed',
    })
  } finally {
    decoding = false
  }
}

function getReedSolomon() {
  reedSolomonPromise ??= ReedSolomonErasure.fromResponse(fetch(reedSolomonWasmUrl))
  return reedSolomonPromise
}

function sameManifest(left: Manifest, right: Manifest) {
  return left.fileSize === right.fileSize && left.payloadFrameCount === right.payloadFrameCount && left.extension === right.extension
}

function mimeTypeFor(extension: string) {
  const known: Record<string, string> = { txt: 'text/plain', json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' }
  return known[extension.toLowerCase()] ?? 'application/octet-stream'
}

function findAnchors(pixels: Uint8ClampedArray, width: number, height: number): [Point, Point, Point, Point] | null {
  const targets: readonly [Rgb, (x: number, y: number) => number][] = [
    [REFERENCE_COLORS[1], (x, y) => x + y],
    [REFERENCE_COLORS[2], (x, y) => -x + y],
    [REFERENCE_COLORS[3], (x, y) => -x - y],
    [REFERENCE_COLORS[1], (x, y) => x - y],
  ]
  const anchors: Point[] = []
  for (const [target, edgeScore] of targets) {
    let best: Point | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4
      const distance = rgbDistance([pixels[offset], pixels[offset + 1], pixels[offset + 2]], target)
      const score = distance * 4 + edgeScore(x, y)
      if (score < bestScore) { bestScore = score; best = { x, y } }
    }
    if (!best || bestScore > 800) return null
    anchors.push(best)
  }
  return anchors as [Point, Point, Point, Point]
}

function createHomography(source: Point[], destination: Point[]): Homography | null {
  const matrix: number[][] = []
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = source[index]
    const { x: u, y: v } = destination[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let column = 0; column < 8; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 8; row += 1) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    if (Math.abs(matrix[pivot][column]) < 1e-8) return null
    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
    const divisor = matrix[column][column]
    for (let item = column; item <= 8; item += 1) matrix[column][item] /= divisor
    for (let row = 0; row < 8; row += 1) if (row !== column) {
      const factor = matrix[row][column]
      for (let item = column; item <= 8; item += 1) matrix[row][item] -= factor * matrix[column][item]
    }
  }
  return matrix.map(row => row[8]) as unknown as Homography
}

function project(transform: Homography, x: number, y: number): Point {
  const denominator = transform[6] * x + transform[7] * y + 1
  return { x: (transform[0] * x + transform[1] * y + transform[2]) / denominator, y: (transform[3] * x + transform[4] * y + transform[5]) / denominator }
}

function sampleRgb(pixels: Uint8ClampedArray, width: number, height: number, point: Point): Rgb | null {
  const x = Math.round(point.x)
  const y = Math.round(point.y)
  if (x < 0 || x >= width || y < 0 || y >= height) return null
  const offset = (y * width + x) * 4
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
}

function classify(color: Rgb, palette: Rgb[]) {
  let winner = 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < palette.length; index += 1) {
    const distance = rgbDistance(color, palette[index])
    if (distance < best) { best = distance; winner = index }
  }
  return best <= paletteSeparation(palette) * 0.8 ? winner : null
}

function isBlurred(color: Rgb, palette: Rgb[]) {
  const distances = palette.map(candidate => rgbDistance(color, candidate)).sort((a, b) => a - b)
  const separation = paletteSeparation(palette)
  return distances[0] > separation * 0.7 || distances[1] - distances[0] < separation * 0.03
}

function paletteSeparation(palette: Rgb[]) {
  let minimum = Number.POSITIVE_INFINITY
  for (let first = 0; first < palette.length; first += 1) for (let second = first + 1; second < palette.length; second += 1) minimum = Math.min(minimum, rgbDistance(palette[first], palette[second]))
  return minimum
}

function rgbDistance(left: Rgb, right: Rgb) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}
