// 外から来た JSON(信用しないデータ)を、Item / Genre の形に整える。
// 方針:型が合わない項目は捨てるか空にする。例外は投げない。文字列の中身は一切解釈しない(表示側でテキストとして出す)。
import { RATINGS, STATUSES, type Genre, type Item, type Rating, type Status } from './types.ts'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function asStar(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(5, Math.max(0, Math.round(value)))
}

function asRating(value: unknown): Rating {
  return typeof value === 'string' && (RATINGS as readonly string[]).includes(value) ? (value as Rating) : ''
}

function asStatus(value: unknown): Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value) ? (value as Status) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 1本を整える。id と date が形になっていなければ null(その1本は捨てる) */
export function parseItem(value: unknown): Item | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const date = asString(value.date)
  if (id === '' || !DATE_PATTERN.test(date)) return null

  const stars = isRecord(value.stars) ? value.stars : {}
  const order = typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : Number.MAX_SAFE_INTEGER

  return {
    id,
    date,
    order,
    slot: asString(value.slot),
    genre: typeof value.genre === 'string' && value.genre !== '' ? value.genre : null,
    title: asString(value.title),
    lead: asString(value.lead),
    summary: asString(value.summary),
    tryit: asString(value.tryit),
    caution: asString(value.caution),
    categories: asStringList(value.categories),
    projects: asStringList(value.projects),
    tags: asStringList(value.tags),
    sourceUrl: asString(value.sourceUrl),
    sourceTitle: asString(value.sourceTitle),
    trust: asString(value.trust),
    stars: { hot: asStar(stars.hot), use: asStar(stars.use), fun: asStar(stars.fun) },
    rating: asRating(value.rating),
    status: asStatus(value.status),
    memo: asString(value.memo),
  }
}

/** 配列でなければ空。形の崩れた要素は捨てる。同じ id が重なったら先のものを残す */
export function parseItems(value: unknown): Item[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: Item[] = []
  for (const raw of value) {
    const item = parseItem(raw)
    if (item === null || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return items
}

export function parseGenres(value: unknown): Genre[] {
  if (!Array.isArray(value)) return []
  const genres: Genre[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const id = asString(raw.id)
    const label = asString(raw.label)
    if (id === '' || label === '') continue
    const sortOrder = typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? raw.sortOrder : Number.MAX_SAFE_INTEGER
    genres.push({ id, label, sortOrder })
  }
  return genres.sort((a, b) => a.sortOrder - b.sortOrder)
}
