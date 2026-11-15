// ビルドの成果物(dist/)に、本物のデータ(local-data/)が入っていないことを確かめる。
// npm run build の最後に実行する。local-data が無い環境(CI など)では、パスの混入だけを確かめて通す。
// 本物のデータの中身は、画面にもログにも出さない(件数とファイル名だけ)。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const LOCAL = join('local-data', 'items.json')
const MIN_NEEDLE_LENGTH = 12

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

if (!existsSync(DIST)) {
  console.error('check:dist 失敗。dist/ がありません。先に vite build を実行してください')
  process.exit(1)
}

const files = walk(DIST)
const leakedPaths = files.filter((path) => path.includes('local-data'))
if (leakedPaths.length > 0) {
  console.error(`check:dist 失敗。dist の中に local-data のパスがあります: ${leakedPaths.join(', ')}`)
  process.exit(1)
}

if (!existsSync(LOCAL)) {
  console.log(`check:dist OK。local-data が無いため、パスの混入だけを確認(dist ${files.length} ファイル)`)
  process.exit(0)
}

let items
try {
  items = JSON.parse(readFileSync(LOCAL, 'utf8'))
} catch {
  console.error('check:dist 失敗。local-data/items.json を JSON として読めません')
  process.exit(1)
}
if (!Array.isArray(items)) {
  console.error('check:dist 失敗。local-data/items.json が配列ではありません')
  process.exit(1)
}

// 本物のデータに含まれる文章(見出し・リード・要約・メモ)を手がかりにする。id や URL は見本と重なりうるので使わない
const needles = new Set()
for (const item of items) {
  if (typeof item !== 'object' || item === null) continue
  for (const key of ['title', 'lead', 'summary', 'memo']) {
    const value = item[key]
    if (typeof value === 'string' && value.length >= MIN_NEEDLE_LENGTH) needles.add(value)
  }
}

const textFiles = files.filter((path) => /\.(js|css|html|json|txt|map)$/.test(path))
const hits = []
for (const path of textFiles) {
  const text = readFileSync(path, 'utf8')
  let count = 0
  for (const needle of needles) if (text.includes(needle)) count += 1
  if (count > 0) hits.push({ path, count })
}

if (hits.length > 0) {
  console.error('check:dist 失敗。本物のデータの文章が dist に含まれています(中身は表示しません):')
  for (const hit of hits) console.error(`  ${hit.path}: ${hit.count} 件`)
  process.exit(1)
}

console.log(
  `check:dist OK。本物のデータ ${items.length} 本(手がかり ${needles.size} 件)は、dist ${textFiles.length} ファイルのどれにも含まれていません`,
)
