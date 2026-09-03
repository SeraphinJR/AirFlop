export const GRID_SIZE = 40
export const FRAME_BLOCKS = GRID_SIZE * GRID_SIZE
export const PAYLOAD_BLOCKS_PER_FRAME = 1576
export const BYTES_PER_FRAME = PAYLOAD_BLOCKS_PER_FRAME / 4

/** Converts each byte to its four most-significant-bit-first 2-bit color values. */
export function bytesToColorIndices(chunk: Uint8Array): number[] {
  const indices: number[] = []

  for (const byte of chunk) {
    indices.push((byte >> 6) & 3, (byte >> 4) & 3, (byte >> 2) & 3, byte & 3)
  }

  return indices
}

/** Builds one 40 × 40 optical frame with finder markers, calibration, and a 32-bit ID. */
export function buildFrame(payloadIndices: number[], frameId: number): number[] {
  const frame = new Array<number>(FRAME_BLOCKS).fill(0)
  const cell = (row: number, column: number) => row * GRID_SIZE + column

  // Corner anchors: coral, mint, yellow, coral.
  frame[cell(0, 0)] = 1
  frame[cell(0, GRID_SIZE - 1)] = 2
  frame[cell(GRID_SIZE - 1, GRID_SIZE - 1)] = 3
  frame[cell(GRID_SIZE - 1, 0)] = 1

  // Calibration strip, then the unsigned 32-bit sequence identifier on row zero.
  frame[1] = 0
  frame[2] = 1
  frame[3] = 2
  frame[4] = 3
  const unsignedFrameId = frameId >>> 0
  for (let pairIndex = 0; pairIndex < 16; pairIndex += 1) {
    frame[5 + pairIndex] = (unsignedFrameId >>> (30 - pairIndex * 2)) & 3
  }

  let payloadPosition = 0
  for (let index = 0; index < FRAME_BLOCKS; index += 1) {
    if (index <= 20 || index === GRID_SIZE - 1 || index === FRAME_BLOCKS - GRID_SIZE || index === FRAME_BLOCKS - 1) {
      continue
    }
    frame[index] = payloadIndices[payloadPosition] ?? 0
    payloadPosition += 1
  }

  return frame
}

export function buildFrames(data: Uint8Array): number[][] {
  const frames: number[][] = []
  for (let offset = 0; offset < data.length; offset += BYTES_PER_FRAME) {
    frames.push(buildFrame(bytesToColorIndices(data.slice(offset, offset + BYTES_PER_FRAME)), frames.length))
  }
  return frames
}
