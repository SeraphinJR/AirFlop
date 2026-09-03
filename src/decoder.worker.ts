import { ReedSolomonErasure } from './lib/reedSolomon'
import reedSolomonWasmUrl from '@subspace/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm?url'
import { BYTES_PER_FRAME, CALIBRATION_COLUMNS, DATA_SHARDS_PER_GROUP, FINDER_CENTRES, FRAME_CLOCK_COLUMN, FRAME_ID_COLUMNS, GRID_SIZE, HEADER_ROW, isReservedCell, PARITY_SHARDS_PER_GROUP, type Rgb } from './lib/opticalFrame'

type Point = { x: number; y: number }
type Homography = readonly [number, number, number, number, number, number, number, number]
type Manifest = { fileSize: number; payloadFrameCount: number; extension: string }
type FrameMessage = { pixels: Uint8ClampedArray; width?: number; height?: number }
type DecoderMessage = FrameMessage | { type: 'RESET' }
type Rejection = 'invalid dimensions' | 'no anchors' | 'invalid quadrilateral' | 'calibration failure' | 'ambiguous clock' | 'frame ID failure' | 'payload failure'

const receivedFrames = new Map<number, Uint8Array>()
const foundFrameIds = new Set<number>()
const counters: Record<Rejection | 'accepted unique frame', number> = { 'invalid dimensions': 0, 'no anchors': 0, 'invalid quadrilateral': 0, 'calibration failure': 0, 'ambiguous clock': 0, 'frame ID failure': 0, 'payload failure': 0, 'accepted unique frame': 0 }
let manifest: Manifest | null = null, decoding = false, complete = false, scanned = 0, detectedFrames = 0, pending: { id: number; payload: Uint8Array } | null = null
let frameQueue: FrameMessage[] = [], processingQueue = false
let rsPromise: Promise<ReedSolomonErasure> | undefined

self.onmessage = event => {
  const data = event.data as DecoderMessage
  if ('type' in data) { receivedFrames.clear(); foundFrameIds.clear(); manifest = null; decoding = complete = false; scanned = detectedFrames = 0; pending = null; frameQueue = []; Object.keys(counters).forEach(key => { counters[key as keyof typeof counters] = 0 }); return }
  frameQueue.push(data)
  void processQueue()
}

async function processQueue() {
  if (processingQueue) return
  processingQueue = true
  while (frameQueue.length && !complete) await processFrame(frameQueue.shift()!)
  processingQueue = false
}

async function processFrame({ pixels, width = 400, height = 400 }: FrameMessage) {
  if (decoding || complete) return
  scanned += 1
  if (pixels.length !== width * height * 4) return reject('invalid dimensions')
  const anchors = findAnchors(pixels, width, height)
  if (!anchors) return reject('no anchors')
  postDebug('Anchors detected', anchors)
  if (!validQuad(anchors)) return reject('invalid quadrilateral')
  const h = homography(FINDER_CENTRES as unknown as Point[], anchors)
  if (!h) return reject('invalid quadrilateral')
  const sample = (column: number, row: number) => sampleCell(pixels, width, height, h, column, row)
  const palette = CALIBRATION_COLUMNS.map(column => sample(column, HEADER_ROW))
  if (palette.some(value => !value) || !distinct(palette as Rgb[])) return reject('calibration failure', anchors)
  const localPalette = palette as Rgb[]
  const clock = sample(FRAME_CLOCK_COLUMN, HEADER_ROW)
  if (!clock || classify(clock, localPalette) === null) return reject('ambiguous clock')
  let id = 0
  for (const column of FRAME_ID_COLUMNS) { const symbol = sample(column, HEADER_ROW); const value = symbol && classify(symbol, localPalette); if (value === null || value === undefined) return reject('frame ID failure'); id = (id * 4 + value) & 0xffff }
  const payload = new Uint8Array(BYTES_PER_FRAME); let position = 0
  for (let row = 0; row < GRID_SIZE; row += 1) for (let column = 0; column < GRID_SIZE; column += 1) if (!isReservedCell(row, column)) {
    const color = sample(column, row); const value = color && classify(color, localPalette, false, 1.2)
    if (value === null || value === undefined) { postDebug(`Payload failure at column ${column}, row ${row}`, anchors); return reject('payload failure', anchors) }
    payload[position >> 2] |= value << (6 - (position & 3) * 2); position += 1
  }
  detectedFrames += 1
  postDebug('Anchors and calibration detected', anchors)
  // A repeat proves that the camera did not sample a refresh transition. Payload is
  // accepted from the second read because camera noise can change borderline payload
  // colors even when the display is still showing the same frame.
  if (!pending || pending.id !== id) { pending = { id, payload }; postDebug(); return }
  pending = null
  if (manifest && (id < 0 || id > manifest.payloadFrameCount)) {
    postDebug(`Discarded out-of-range frame ID ${id}`, anchors)
    return
  }
  foundFrameIds.add(id)
  await accept(id, payload)
}

function reject(reason: Rejection, anchors?: Point[]) { counters[reason] += 1; if (scanned % 10 === 0) postDebug(reason, anchors) }
function postDebug(status = 'Searching for a calibrated finder quadrilateral', anchors?: Point[]) { self.postMessage({ type: 'DEBUG', status, detectedFrames, anchors, foundFrameIds: [...foundFrameIds].sort((a, b) => a - b), totalFrameCount: manifest ? manifest.payloadFrameCount + 1 : null, rejectionSummary: Object.entries(counters).filter(([, count]) => count).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${count} x ${name}`).join(' | ') }) }
async function accept(id: number, payload: Uint8Array) {
  if (id === 0) {
    const next = parseManifest(payload)
    if (!next) { postDebug('Frame 0 received but manifest is invalid'); return }
    if (!manifest || !sameManifest(manifest, next)) {
      receivedFrames.clear()
      manifest = next
      const totalFrameCount = next.payloadFrameCount + 1
      self.postMessage({ type: 'MANIFEST', totalFrames: totalFrameCount, totalFrameCount, frameId: id })
      postDebug(`Manifest captured: ${totalFrameCount} total frames`)
    }
  }
  if (!manifest || id < 0 || id > manifest.payloadFrameCount) return
  if (receivedFrames.has(id)) {
    await tryComplete()
    return
  }
  receivedFrames.set(id, payload); counters['accepted unique frame'] += 1
  self.postMessage({ type: 'PROGRESS', received: receivedFrames.size, total: manifest.payloadFrameCount + 1, detectedFrames })
  await tryComplete()
}
function parseManifest(payload: Uint8Array): Manifest | null {
  if (payload[0] !== 0x41 || payload[1] !== 0x49 || payload[2] !== 0x52 || payload[3] !== 0x46) return null
  const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength), payloadFrameCount = v.getUint16(8, false), extensionLength = payload[10]
  if (extensionLength > BYTES_PER_FRAME - 11 || payloadFrameCount % (DATA_SHARDS_PER_GROUP + PARITY_SHARDS_PER_GROUP)) return null
  return { fileSize: v.getUint32(4, false), payloadFrameCount, extension: new TextDecoder().decode(payload.subarray(11, 11 + extensionLength)) }
}
async function tryComplete() {
  if (!manifest || decoding) return
  if (receivedFrames.size !== manifest.payloadFrameCount + 1) return
  const shardsPerGroup = DATA_SHARDS_PER_GROUP + PARITY_SHARDS_PER_GROUP, groups = manifest.payloadFrameCount / shardsPerGroup
  for (let group = 0; group < groups; group += 1) { let count = 0; for (let shard = 0; shard < shardsPerGroup; shard += 1) if (receivedFrames.has(group * shardsPerGroup + shard + 1)) count += 1; if (count < DATA_SHARDS_PER_GROUP) return }
  decoding = true
  try {
    const output = new Uint8Array(groups * DATA_SHARDS_PER_GROUP * BYTES_PER_FRAME), rs = await getRs()
    for (let group = 0; group < groups; group += 1) {
      const shards = new Uint8Array(shardsPerGroup * BYTES_PER_FRAME), available: boolean[] = []
      for (let shard = 0; shard < shardsPerGroup; shard += 1) {
        const frame = receivedFrames.get(group * shardsPerGroup + shard + 1)
        available.push(Boolean(frame))
        if (frame) shards.set(frame, shard * BYTES_PER_FRAME)
      }
      if (rs.reconstruct(shards, DATA_SHARDS_PER_GROUP, PARITY_SHARDS_PER_GROUP, available) !== ReedSolomonErasure.RESULT_OK) {
        throw new Error(`Reconstruction failed for group ${group + 1}.`)
      }
      output.set(shards.subarray(0, DATA_SHARDS_PER_GROUP * BYTES_PER_FRAME), group * DATA_SHARDS_PER_GROUP * BYTES_PER_FRAME)
    }
    complete = true
    self.postMessage({ type: 'COMPLETE', blobUrl: URL.createObjectURL(new Blob([output.slice(0, manifest.fileSize)])), filename: manifest.extension ? `reconstructed.${manifest.extension.replace(/^\\.+/, '')}` : 'reconstructed' })
  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error instanceof Error ? error.message : 'File reconstruction failed.' })
  } finally {
    decoding = false
  }
}
function getRs() { rsPromise ??= ReedSolomonErasure.fromResponse(fetch(reedSolomonWasmUrl)); return rsPromise }
function sameManifest(a: Manifest, b: Manifest) { return a.fileSize === b.fileSize && a.payloadFrameCount === b.payloadFrameCount && a.extension === b.extension }

function findAnchors(p: Uint8ClampedArray, w: number, h: number): [Point, Point, Point, Point] | null {
  const candidates = components(p, w, h)
  if (candidates.length < 4) return null
  let best: [Point, Point, Point, Point] | null = null, bestScore = -Infinity
  for (let first = 0; first < candidates.length - 3; first += 1) for (let second = first + 1; second < candidates.length - 2; second += 1) for (let third = second + 1; third < candidates.length - 1; third += 1) for (let fourth = third + 1; fourth < candidates.length; fourth += 1) {
    const q = orderQuad([candidates[first], candidates[second], candidates[third], candidates[fourth]])
    if (!validQuad(q)) continue
    const score = quadScore(q)
    if (score > bestScore) { bestScore = score; best = q }
  }
  return best
}
function orderQuad(points: (Point & { area: number })[]): [Point, Point, Point, Point] {
  const topLeft = points.reduce((best, point) => point.x + point.y < best.x + best.y ? point : best)
  const bottomRight = points.reduce((best, point) => point.x + point.y > best.x + best.y ? point : best)
  const topRight = points.reduce((best, point) => point.x - point.y > best.x - best.y ? point : best)
  const bottomLeft = points.find(point => point !== topLeft && point !== bottomRight && point !== topRight)!
  return [topLeft, topRight, bottomRight, bottomLeft]
}
function quadScore(q: [Point, Point, Point, Point]) {
  const areas = q.map(point => (point as Point & { area: number }).area)
  const minimumArea = Math.min(...areas), maximumArea = Math.max(...areas)
  const balance = minimumArea / maximumArea
  const side = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const horizontalBalance = Math.min(side(q[0], q[1]), side(q[3], q[2])) / Math.max(side(q[0], q[1]), side(q[3], q[2]))
  const verticalBalance = Math.min(side(q[0], q[3]), side(q[1], q[2])) / Math.max(side(q[0], q[3]), side(q[1], q[2]))
  if (balance < .55 || horizontalBalance < .65 || verticalBalance < .65) return -Infinity
  return minimumArea * balance * horizontalBalance * verticalBalance
}
function components(p: Uint8ClampedArray, w: number, h: number) {
  const step = 2, cw = Math.ceil(w / step), ch = Math.ceil(h / step), hit = new Uint8Array(cw * ch), seen = new Uint8Array(cw * ch), result: (Point & { area: number })[] = []
  for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) { const i = (y * step * w + x * step) * 4; if (matches([p[i], p[i + 1], p[i + 2]])) hit[y * cw + x] = 1 }
  const maximumAnchorArea = cw * ch * .1
  for (let start = 0; start < hit.length; start += 1) if (hit[start] && !seen[start]) { const queue = [start]; seen[start] = 1; let count = 0, sx = 0, sy = 0; while (queue.length) { const n = queue.pop()!; const x = n % cw, y = Math.floor(n / cw); count += 1; sx += x * step; sy += y * step; for (const d of [-1, 1, -cw, cw]) { const next = n + d, nx = next % cw; if (next >= 0 && next < hit.length && Math.abs(nx - x) <= 1 && hit[next] && !seen[next]) { seen[next] = 1; queue.push(next) } } } if (count >= 8 && count <= maximumAnchorArea) result.push({ x: sx / count, y: sy / count, area: count }) }
  return result
}
function matches(c: Rgb) {
  const maximum = Math.max(...c)
  const minimum = Math.min(...c)
  return minimum > 150 && maximum - minimum < 70
}
function chromaDistance(a: Rgb, b: Rgb) {
  const an = Math.max(...a, 1), bn = Math.max(...b, 1)
  return Math.hypot(a[0] / an - b[0] / bn, a[1] / an - b[1] / bn, a[2] / an - b[2] / bn)
}
function validQuad(q: Point[]) { const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); const area = Math.abs(cross(q[0], q[1], q[2])) + Math.abs(cross(q[0], q[2], q[3])); return area > 900 && cross(q[0],q[1],q[2]) * cross(q[0],q[2],q[3]) > 0 }
function sampleCell(p: Uint8ClampedArray, w: number, height: number, h: Homography, column: number, row: number): Rgb | null {
  const red: number[] = [], green: number[] = [], blue: number[] = []
  for (let sampleRow = 0; sampleRow < 3; sampleRow += 1) for (let sampleColumn = 0; sampleColumn < 3; sampleColumn += 1) {
    const point = project(h, column + .3 + sampleColumn * .2, row + .3 + sampleRow * .2)
    const x = Math.round(point.x), y = Math.round(point.y)
    if (x < 0 || y < 0 || x >= w || y >= height) continue
    const i = (y * w + x) * 4
    red.push(p[i]); green.push(p[i + 1]); blue.push(p[i + 2])
  }
  if (!red.length) return null
  const middle = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  return [middle(red), middle(green), middle(blue)]
}
function distinct(palette: Rgb[]) { return palette.every((a, i) => palette.every((b, j) => i === j || chromaDistance(a,b) > .04)) }
function classify(c: Rgb, palette: Rgb[], requireSeparation = true, maximumDistance = .5) { let winner=0,best=Infinity,second=Infinity; palette.forEach((p,i)=>{const d=chromaDistance(c,p);if(d<best){second=best;best=d;winner=i}else if(d<second)second=d}); return best < maximumDistance && (!requireSeparation || second-best > .005) ? winner : null }
function homography(source: Point[], destination: Point[]): Homography | null { const m:number[][]=[]; for(let i=0;i<4;i++){const {x,y}=source[i],{x:u,y:v}=destination[i];m.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v])} for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;if(Math.abs(m[p][c])<1e-8)return null;[m[c],m[p]]=[m[p],m[c]];const d=m[c][c];for(let k=c;k<9;k++)m[c][k]/=d;for(let r=0;r<8;r++)if(r!==c){const f=m[r][c];for(let k=c;k<9;k++)m[r][k]-=f*m[c][k]}} return m.map(row=>row[8]) as unknown as Homography }
function project(h: Homography,x:number,y:number):Point { const d=h[6]*x+h[7]*y+1;return{x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d} }
