export type Rgb = readonly [number, number, number]
export const OPTICAL_PALETTE: readonly Rgb[] = [[139, 92, 246], [244, 63, 94], [20, 184, 166], [250, 204, 21]]
export const OPTICAL_PALETTE_CSS = OPTICAL_PALETTE.map(([r, g, b]) => `rgb(${r} ${g} ${b})`)
export const ANCHOR_PALETTE: readonly Rgb[] = [[255, 255, 255]]
export const ANCHOR_PALETTE_CSS = ANCHOR_PALETTE.map(([r, g, b]) => `rgb(${r} ${g} ${b})`)
export const GRID_SIZE = 24
export const TRANSMISSION_FPS = 6
export const FRAME_BLOCKS = GRID_SIZE * GRID_SIZE
export const HEADER_ROW = 8
export const CALIBRATION_COLUMNS = [1, 2, 3, 4] as const
export const FRAME_ID_COLUMNS = Array.from({ length: 8 }, (_, index) => index + 5)
export const FRAME_CLOCK_COLUMN = 13
export const FINDER_SIZE = 2
export const FINDER_QUIET_SIZE = 2
export const FINDERS = {
  topLeft: { row: 0, column: 0, colour: 0 }, topRight: { row: 0, column: GRID_SIZE - FINDER_SIZE, colour: 0 },
  bottomRight: { row: GRID_SIZE - FINDER_SIZE, column: GRID_SIZE - FINDER_SIZE, colour: 0 }, bottomLeft: { row: GRID_SIZE - FINDER_SIZE, column: 0, colour: 0 },
} as const
export const FINDER_CENTRES = [
  { x: FINDERS.topLeft.column + FINDER_SIZE / 2, y: FINDERS.topLeft.row + FINDER_SIZE / 2 }, { x: FINDERS.topRight.column + FINDER_SIZE / 2, y: FINDERS.topRight.row + FINDER_SIZE / 2 },
  { x: FINDERS.bottomRight.column + FINDER_SIZE / 2, y: FINDERS.bottomRight.row + FINDER_SIZE / 2 }, { x: FINDERS.bottomLeft.column + FINDER_SIZE / 2, y: FINDERS.bottomLeft.row + FINDER_SIZE / 2 },
] as const
export function isReservedCell(row: number, column: number) {
  if (row === HEADER_ROW || row === 0 || row === GRID_SIZE - 1 || column === 0 || column === GRID_SIZE - 1) return true
  return (row < FINDER_QUIET_SIZE || row >= GRID_SIZE - FINDER_QUIET_SIZE) && (column < FINDER_QUIET_SIZE || column >= GRID_SIZE - FINDER_QUIET_SIZE)
}
export const PAYLOAD_BLOCKS_PER_FRAME = Array.from({ length: FRAME_BLOCKS }, (_, index) => index).filter(index => !isReservedCell(Math.floor(index / GRID_SIZE), index % GRID_SIZE)).length
export const BYTES_PER_FRAME = Math.floor(PAYLOAD_BLOCKS_PER_FRAME / 4)
export function bytesToColorIndices(chunk: Uint8Array): number[] { const indices: number[] = []; for (const byte of chunk) indices.push((byte >> 6) & 3, (byte >> 4) & 3, (byte >> 2) & 3, byte & 3); return indices }
export function buildFrame(payloadIndices: number[], frameId: number): number[] {
  const frame = new Array<number>(FRAME_BLOCKS).fill(0); const cell = (row: number, column: number) => row * GRID_SIZE + column
  for (const finder of Object.values(FINDERS)) for (let row = finder.row; row < finder.row + FINDER_SIZE; row += 1) for (let column = finder.column; column < finder.column + FINDER_SIZE; column += 1) frame[cell(row, column)] = finder.colour
  CALIBRATION_COLUMNS.forEach((column, colour) => { frame[cell(HEADER_ROW, column)] = colour })
  const unsignedFrameId = frameId & 0xffff
  FRAME_ID_COLUMNS.forEach((column, pairIndex) => { frame[cell(HEADER_ROW, column)] = (unsignedFrameId >>> (14 - pairIndex * 2)) & 3 }); frame[cell(HEADER_ROW, FRAME_CLOCK_COLUMN)] = unsignedFrameId & 1
  let payloadPosition = 0
  for (let row = 0; row < GRID_SIZE; row += 1) for (let column = 0; column < GRID_SIZE; column += 1) if (!isReservedCell(row, column)) frame[cell(row, column)] = payloadIndices[payloadPosition++] ?? 0
  return frame
}
function buildManifest(fileSize: number, payloadFrameCount: number, extension: string): Uint8Array {
  const manifest = new Uint8Array(BYTES_PER_FRAME); const extensionBytes = new TextEncoder().encode(extension)
  if (extensionBytes.length > BYTES_PER_FRAME - 11) throw new Error('File extension is too long for the transmission manifest.')
  const view = new DataView(manifest.buffer); manifest.set([0x41, 0x49, 0x52, 0x46]); view.setUint32(4, fileSize, false); view.setUint16(8, payloadFrameCount, false); manifest[10] = extensionBytes.length; manifest.set(extensionBytes, 11); return manifest
}
export async function buildTransmissionFrames(data: Uint8Array, extension: string): Promise<number[][]> {
  const dataFrameCount = Math.ceil(data.length / BYTES_PER_FRAME); const payloadFrameCount = dataFrameCount
  if (payloadFrameCount > 0xffff) throw new Error('File is too large for the 16-bit payload frame count.')
  const frames = [buildFrame(bytesToColorIndices(buildManifest(data.length, payloadFrameCount, extension)), 0)]
  for (let frameIndex = 0; frameIndex < dataFrameCount; frameIndex += 1) {
    frames.push(buildFrame(bytesToColorIndices(data.subarray(frameIndex * BYTES_PER_FRAME, (frameIndex + 1) * BYTES_PER_FRAME)), frames.length))
  }
  return frames
}
