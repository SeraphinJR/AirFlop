import { ReedSolomonErasure } from './reedSolomon'
import reedSolomonWasmUrl from '@subspace/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm?url'

export const GRID_SIZE = 40
export const FRAME_BLOCKS = GRID_SIZE * GRID_SIZE
export const PAYLOAD_BLOCKS_PER_FRAME = 1576
export const BYTES_PER_FRAME = PAYLOAD_BLOCKS_PER_FRAME / 4
export const DATA_SHARDS_PER_GROUP = 4
export const PARITY_SHARDS_PER_GROUP = 1

let reedSolomonPromise: Promise<ReedSolomonErasure> | undefined

function getReedSolomon(): Promise<ReedSolomonErasure> {
  reedSolomonPromise ??= ReedSolomonErasure.fromResponse(fetch(reedSolomonWasmUrl))
  return reedSolomonPromise
}

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

/** Creates Frame 0's fixed-width manifest payload. */
function buildManifest(fileSize: number, payloadFrameCount: number, extension: string): Uint8Array {
  const manifest = new Uint8Array(BYTES_PER_FRAME)
  const extensionBytes = new TextEncoder().encode(extension)

  if (extensionBytes.length > BYTES_PER_FRAME - 11) {
    throw new Error('File extension is too long for the transmission manifest.')
  }

  const view = new DataView(manifest.buffer)
  manifest.set([0x41, 0x49, 0x52, 0x46]) // AIRF
  view.setUint32(4, fileSize, false)
  view.setUint16(8, payloadFrameCount, false)
  manifest[10] = extensionBytes.length
  manifest.set(extensionBytes, 11)

  return manifest
}

/**
 * Builds a manifest frame followed by 4+1 Reed-Solomon data/parity groups.
 * The final data group is padded with zero-valued shards so every group has
 * a consistent layout for recovery on the receiver.
 */
export async function buildTransmissionFrames(data: Uint8Array, extension: string): Promise<number[][]> {
  const dataFrameCount = Math.ceil(data.length / BYTES_PER_FRAME)
  const groupCount = Math.ceil(dataFrameCount / DATA_SHARDS_PER_GROUP)
  const payloadFrameCount = groupCount * (DATA_SHARDS_PER_GROUP + PARITY_SHARDS_PER_GROUP)

  if (payloadFrameCount > 0xffff) {
    throw new Error('File is too large for the 16-bit payload frame count.')
  }

  const frames = [buildFrame(bytesToColorIndices(buildManifest(data.length, payloadFrameCount, extension)), 0)]
  if (groupCount === 0) return frames

  const reedSolomon = await getReedSolomon()
  const shardsPerGroup = DATA_SHARDS_PER_GROUP + PARITY_SHARDS_PER_GROUP

  for (let group = 0; group < groupCount; group += 1) {
    const shards = new Uint8Array(BYTES_PER_FRAME * shardsPerGroup)

    for (let shard = 0; shard < DATA_SHARDS_PER_GROUP; shard += 1) {
      const start = (group * DATA_SHARDS_PER_GROUP + shard) * BYTES_PER_FRAME
      shards.set(data.subarray(start, start + BYTES_PER_FRAME), shard * BYTES_PER_FRAME)
    }

    const result = reedSolomon.encode(shards, DATA_SHARDS_PER_GROUP, PARITY_SHARDS_PER_GROUP)
    if (result !== ReedSolomonErasure.RESULT_OK) {
      throw new Error(`Reed-Solomon encoding failed with result code ${result}.`)
    }

    for (let shard = 0; shard < shardsPerGroup; shard += 1) {
      const start = shard * BYTES_PER_FRAME
      frames.push(buildFrame(bytesToColorIndices(shards.subarray(start, start + BYTES_PER_FRAME)), frames.length))
    }
  }

  return frames
}
