// public/logo/nodal-icon.svg から、favicon(SVG)と PWA のアイコン(PNG)を作る。
//   node scripts/make-icons.mjs
// 外部のツール(ImageMagick など)を入れずに済むよう、アイコンの形(角丸の四角 + 3つの多角形)だけを自前で描く。
// 元の SVG から <rect> と <polygon> と transform を読み、変えたら作り直せるようにしている。
// 出力:public/favicon.svg(元の SVG から c2pa のメタデータを除いたもの)、public/icons/*.png
import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = join('public', 'logo', 'nodal-icon.svg')
const OUT_DIR = join('public', 'icons')
const FAVICON = join('public', 'favicon.svg')
const SIZES = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-512-maskable.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]
/** 1画素あたりの標本数(縦横)。縁をなめらかにする */
const SUPERSAMPLE = 4

const svg = readFileSync(SOURCE, 'utf8')

// --- SVG から形を読む(この SVG の作りに合わせた最小限の読み方) ---
const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
if (viewBox === null) throw new Error('viewBox が読めません')
const BASE = Number(viewBox[1])

const rect = /<rect width="(\d+)" height="(\d+)" rx="(\d+)" fill="(#[0-9A-Fa-f]{6})"\/>/.exec(svg)
if (rect === null) throw new Error('<rect> が読めません')
const bg = { rx: Number(rect[3]), color: hex(rect[4]) }

const transform = /transform="translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\)"/.exec(svg)
if (transform === null) throw new Error('transform が読めません')
const tx = Number(transform[1])
const ty = Number(transform[2])
const scale = Number(transform[3])

const strokeWidth = Number(/stroke-width="(\d+)"/.exec(svg)?.[1] ?? '0')

const polygons = []
for (const match of svg.matchAll(/<polygon points="([^"]+)" fill="(#[0-9A-Fa-f]{6})"/g)) {
  const points = match[1]
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .map(([x, y]) => [tx + x * scale, ty + y * scale])
  polygons.push({ points, color: hex(match[2]) })
}
if (polygons.length === 0) throw new Error('<polygon> が読めません')
// 線(stroke)は塗りと同じ色で、角が丸い。塗りを線の半分の幅だけ外側に広げた形として描く
const halfStroke = (strokeWidth * scale) / 2

function hex(value) {
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
}

// --- 幾何 ---
function insidePolygon(points, x, y) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distanceToEdges(points, x, y) {
  let best = Infinity
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [x1, y1] = points[j]
    const [x2, y2] = points[i]
    const dx = x2 - x1
    const dy = y2 - y1
    const length2 = dx * dx + dy * dy
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2))
    const px = x1 + t * dx
    const py = y1 + t * dy
    best = Math.min(best, Math.hypot(x - px, y - py))
  }
  return best
}

function insideRoundedRect(x, y) {
  const r = bg.rx
  const cx = Math.max(r, Math.min(BASE - r, x))
  const cy = Math.max(r, Math.min(BASE - r, y))
  return Math.hypot(x - cx, y - cy) <= r
}

/** 元の座標(0〜BASE)の1点の色。透明なら null */
function colorAt(x, y) {
  let color = null
  if (insideRoundedRect(x, y)) color = bg.color
  for (const polygon of polygons) {
    if (insidePolygon(polygon.points, x, y) || distanceToEdges(polygon.points, x, y) <= halfStroke) color = polygon.color
  }
  return color
}

// --- 描画(RGBA) ---
function render(size) {
  const pixels = new Uint8Array(size * size * 4)
  const step = BASE / size / SUPERSAMPLE
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step
          const y = (py * SUPERSAMPLE + sy + 0.5) * step
          const color = colorAt(x, y)
          if (color === null) continue
          r += color[0]
          g += color[1]
          b += color[2]
          a += 1
        }
      }
      const offset = (py * size + px) * 4
      if (a > 0) {
        pixels[offset] = Math.round(r / a)
        pixels[offset + 1] = Math.round(g / a)
        pixels[offset + 2] = Math.round(b / a)
        pixels[offset + 3] = Math.round((255 * a) / samples)
      }
    }
  }
  return pixels
}

// --- PNG の書き出し ---
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

function png(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // 1色 8 ビット
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // フィルターなし
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const { name, size } of SIZES) {
  writeFileSync(join(OUT_DIR, name), png(size, render(size)))
  console.log(`${join(OUT_DIR, name)} (${size}x${size})`)
}

// favicon は元の SVG から、来歴のメタデータ(<metadata>…)だけを除いて軽くする
const favicon = svg.replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/\s+xmlns:c2pa="[^"]*"/, '')
writeFileSync(FAVICON, favicon)
console.log(`${FAVICON} (${favicon.length} bytes)`)
