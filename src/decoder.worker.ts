import { ReedSolomonErasure } from './lib/reedSolomon'
import reedSolomonWasmUrl from '@subspace/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm?url'
import { ANCHOR_PALETTE, BYTES_PER_FRAME, CALIBRATION_COLUMNS, DATA_SHARDS_PER_GROUP, FINDER_CENTRES, FRAME_CLOCK_COLUMN, FRAME_ID_COLUMNS, GRID_SIZE, HEADER_ROW, isReservedCell, PARITY_SHARDS_PER_GROUP, type Rgb } from './lib/opticalFrame'

type Point = { x: number; y: number }
type Homography = readonly [number, number, number, number, number, number, number, number]
type Manifest = { fileSize: number; payloadFrameCount: number; extension: string }
type FrameMessage = { pixels: Uint8ClampedArray; width?: number; height?: number }
type DecoderMessage = FrameMessage | { type: 'RESET' }
type Rejection = 'invalid dimensions' | 'no anchors' | 'invalid quadrilateral' | 'calibration failure' | 'ambiguous clock' | 'frame ID failure' | 'payload failure'

const receivedFrames = new Map<number, Uint8Array>()
const counters: Record<Rejection | 'accepted unique frame', number> = { 'invalid dimensions': 0, 'no anchors': 0, 'invalid quadrilateral': 0, 'calibration failure': 0, 'ambiguous clock': 0, 'frame ID failure': 0, 'payload failure': 0, 'accepted unique frame': 0 }
let manifest: Manifest | null = null, decoding = false, complete = false, scanned = 0, detectedFrames = 0, pending: { id: number; payload: Uint8Array } | null = null
let rsPromise: Promise<ReedSolomonErasure> | undefined

self.onmessage = event => {
  const data = event.data as DecoderMessage
  if ('type' in data) { receivedFrames.clear(); manifest = null; decoding = complete = false; scanned = detectedFrames = 0; pending = null; Object.keys(counters).forEach(key => { counters[key as keyof typeof counters] = 0 }); return }
  void processFrame(data)
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
  const sample = (column: number, row: number) => samplePatch(pixels, width, height, project(h, column + .5, row + .5), anchors)
  const palette = CALIBRATION_COLUMNS.map(column => sample(column, HEADER_ROW))
  if (palette.some(value => !value) || !distinct(palette as Rgb[])) return reject('calibration failure', anchors)
  const localPalette = palette as Rgb[]
  const clock = sample(FRAME_CLOCK_COLUMN, HEADER_ROW)
  if (!clock || classify(clock, localPalette) === null) return reject('ambiguous clock')
  let id = 0
  for (const column of FRAME_ID_COLUMNS) { const symbol = sample(column, HEADER_ROW); const value = symbol && classify(symbol, localPalette); if (value === null || value === undefined) return reject('frame ID failure'); id = (id * 4 + value) & 0xffff }
  const payload = new Uint8Array(BYTES_PER_FRAME); let position = 0
  for (let row = 0; row < GRID_SIZE; row += 1) for (let column = 0; column < GRID_SIZE; column += 1) if (!isReservedCell(row, column)) {
    const color = sample(column, row); const value = color && classify(color, localPalette)
    if (value === null || value === undefined) return reject('payload failure')
    payload[position >> 2] |= value << (6 - (position & 3) * 2); position += 1
  }
  detectedFrames += 1
  postDebug('Anchors and calibration detected', anchors)
  // A repeat proves that the camera did not sample a refresh transition. Payload is
  // intentionally decoded only after the same frame ID appears twice consecutively.
  if (!pending || pending.id !== id) { pending = { id, payload }; postDebug(); return }
  pending = null
  await accept(id, payload)
}

function reject(reason: Rejection, anchors?: Point[]) { counters[reason] += 1; if (scanned % 10 === 0) postDebug(reason, anchors) }
function postDebug(status = 'Searching for a calibrated finder quadrilateral', anchors?: Point[]) { self.postMessage({ type: 'DEBUG', status, detectedFrames, anchors, rejectionSummary: Object.entries(counters).filter(([, count]) => count).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${count} x ${name}`).join(' | ') }) }
async function accept(id: number, payload: Uint8Array) {
  if (id === 0) { const next = parseManifest(payload); if (!next) return; if (!manifest || !sameManifest(manifest, next)) { receivedFrames.clear(); manifest = next; self.postMessage({ type: 'MANIFEST', totalFrames: next.payloadFrameCount + 1 }) } }
  if (!manifest || id > manifest.payloadFrameCount || receivedFrames.has(id)) return
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
  const shardsPerGroup = DATA_SHARDS_PER_GROUP + PARITY_SHARDS_PER_GROUP, groups = manifest.payloadFrameCount / shardsPerGroup
  for (let group = 0; group < groups; group += 1) { let count = 0; for (let shard = 0; shard < shardsPerGroup; shard += 1) if (receivedFrames.has(group * shardsPerGroup + shard + 1)) count += 1; if (count < DATA_SHARDS_PER_GROUP) return }
  decoding = true
  try { const output = new Uint8Array(groups * DATA_SHARDS_PER_GROUP * BYTES_PER_FRAME), rs = await getRs(); for (let group = 0; group < groups; group += 1) { const shards = new Uint8Array(shardsPerGroup * BYTES_PER_FRAME), available: boolean[] = []; for (let shard = 0; shard < shardsPerGroup; shard += 1) { const frame = receivedFrames.get(group * shardsPerGroup + shard + 1); available.push(Boolean(frame)); if (frame) shards.set(frame, shard * BYTES_PER_FRAME) } if (rs.reconstruct(shards, DATA_SHARDS_PER_GROUP, PARITY_SHARDS_PER_GROUP, available) !== ReedSolomonErasure.RESULT_OK) return; output.set(shards.subarray(0, DATA_SHARDS_PER_GROUP * BYTES_PER_FRAME), group * DATA_SHARDS_PER_GROUP * BYTES_PER_FRAME) } complete = true; self.postMessage({ type: 'COMPLETE', blobUrl: URL.createObjectURL(new Blob([output.slice(0, manifest.fileSize)])), filename: manifest.extension ? `reconstructed.${manifest.extension.replace(/^\\.+/, '')}` : 'reconstructed' }) } finally { decoding = false }
}
function getRs() { rsPromise ??= ReedSolomonErasure.fromResponse(fetch(reedSolomonWasmUrl)); return rsPromise }
function sameManifest(a: Manifest, b: Manifest) { return a.fileSize === b.fileSize && a.payloadFrameCount === b.payloadFrameCount && a.extension === b.extension }

function findAnchors(p: Uint8ClampedArray, w: number, h: number): [Point, Point, Point, Point] | null {
  const blobs = [0, 1, 2, 3].map(colour => components(p, w, h, colour))
  const red = blobs[0]; const teal = blobs[1]; const yellow = blobs[2]
  const bottomLeft = blobs[3]
  if (!red.length || !teal.length || !yellow.length || !bottomLeft.length) return null
  let best: [Point, Point, Point, Point] | null = null, bestScore = -Infinity
  for (const tl of red) for (const bl of bottomLeft) for (const tr of teal) for (const br of yellow) {
    const q: [Point, Point, Point, Point] = [tl, tr, br, bl]
    if (!validQuad(q)) continue
    const score = quadScore(q)
    if (score > bestScore) { bestScore = score; best = q }
  }
  return best
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
function components(p: Uint8ClampedArray, w: number, h: number, colour: number) {
  const step = 2, cw = Math.ceil(w / step), ch = Math.ceil(h / step), hit = new Uint8Array(cw * ch), seen = new Uint8Array(cw * ch), result: (Point & { area: number })[] = []
  for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) { const i = (y * step * w + x * step) * 4; if (matches([p[i], p[i + 1], p[i + 2]], ANCHOR_PALETTE[colour])) hit[y * cw + x] = 1 }
  for (let start = 0; start < hit.length; start += 1) if (hit[start] && !seen[start]) { const queue = [start]; seen[start] = 1; let count = 0, sx = 0, sy = 0; while (queue.length) { const n = queue.pop()!; const x = n % cw, y = Math.floor(n / cw); count += 1; sx += x * step; sy += y * step; for (const d of [-1, 1, -cw, cw]) { const next = n + d, nx = next % cw; if (next >= 0 && next < hit.length && Math.abs(nx - x) <= 1 && hit[next] && !seen[next]) { seen[next] = 1; queue.push(next) } } } if (count >= 8) result.push({ x: sx / count, y: sy / count, area: count }) }
  return result
}
function matches(c: Rgb, target: Rgb) {
  const [red, green, blue] = c
  const maximum = Math.max(...c)
  const minimum = Math.min(...c)
  if (target[0] === 255 && target[1] === 255) return minimum > 150 && maximum - minimum < 70
  if (target[0] === 0 && target[1] === 0 && target[2] === 0) return maximum < 70 && maximum - minimum < 35
  if (target[0] === 255) return red > green * 1.8 && red > blue * 1.8 && red > 70
  return blue > red * 1.8 && blue > green * 1.35 && blue > 70
}
function chromaDistance(a: Rgb, b: Rgb) {
  const an = Math.max(...a, 1), bn = Math.max(...b, 1)
  return Math.hypot(a[0] / an - b[0] / bn, a[1] / an - b[1] / bn, a[2] / an - b[2] / bn)
}
function validQuad(q: Point[]) { const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); const area = Math.abs(cross(q[0], q[1], q[2])) + Math.abs(cross(q[0], q[2], q[3])); return area > 900 && cross(q[0],q[1],q[2]) * cross(q[0],q[2],q[3]) > 0 }
function samplePatch(p: Uint8ClampedArray, w: number, h: number, c: Point, anchors: Point[]): Rgb | null { const cellSize = Math.min(Math.hypot(anchors[1].x-anchors[0].x, anchors[1].y-anchors[0].y), Math.hypot(anchors[3].x-anchors[0].x, anchors[3].y-anchors[0].y)) / GRID_SIZE; const size = Math.floor(cellSize / 4); let r=0,g=0,b=0,n=0; for (let dy=-size;dy<=size;dy+=1) for (let dx=-size;dx<=size;dx+=1) { const x=Math.round(c.x+dx), y=Math.round(c.y+dy); if(x<0||y<0||x>=w||y>=h) continue; const i=(y*w+x)*4; r+=p[i];g+=p[i+1];b+=p[i+2];n++ } return n?[r/n,g/n,b/n]:null }
function distinct(palette: Rgb[]) { return palette.every((a, i) => palette.every((b, j) => i === j || chromaDistance(a,b) > .04)) }
function classify(c: Rgb, palette: Rgb[]) { let winner=0,best=Infinity,second=Infinity; palette.forEach((p,i)=>{const d=chromaDistance(c,p);if(d<best){second=best;best=d;winner=i}else if(d<second)second=d}); return best < .5 && second-best > .005 ? winner : null }
function homography(source: Point[], destination: Point[]): Homography | null { const m:number[][]=[]; for(let i=0;i<4;i++){const {x,y}=source[i],{x:u,y:v}=destination[i];m.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v])} for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;if(Math.abs(m[p][c])<1e-8)return null;[m[c],m[p]]=[m[p],m[c]];const d=m[c][c];for(let k=c;k<9;k++)m[c][k]/=d;for(let r=0;r<8;r++)if(r!==c){const f=m[r][c];for(let k=c;k<9;k++)m[r][k]-=f*m[c][k]}} return m.map(row=>row[8]) as unknown as Homography }
function project(h: Homography,x:number,y:number):Point { const d=h[6]*x+h[7]*y+1;return{x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d} }
