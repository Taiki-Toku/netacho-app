// 外から来た JSON(信用しないデータ)を、Item / Genre / FeedEntry の形に整える。
// 方針:型が合わない項目は捨てるか空にする。例外は投げない。文字列の中身は一切解釈しない(表示側でテキストとして出す)。
import {
  FEED_KINDS,
  RATINGS,
  SEVERITIES,
  STATUSES,
  type FeedEntry,
  type FeedKind,
  type Genre,
  type Item,
  type Rating,
  type Severity,
  type Status,
} from './types.ts'

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

/** CVSS の基本値。0〜10 の数だけを通し、小数第1位に丸める。それ以外は null */
function asCvss(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) return null
  return Math.round(value * 10) / 10
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
  const imageUrl = asString(value.imageUrl)

  return {
    id,
    date,
    order,
    slot: asString(value.slot),
    genre: typeof value.genre === 'string' && value.genre !== '' ? value.genre : null,
    title: asString(value.title),
    lead: asString(value.lead),
    summary: asString(value.summary),
    // 空白だけの箇条は、空の行が出るだけなので捨てる
    points: asStringList(value.points).filter((point) => point.trim() !== ''),
    excerpt: asString(value.excerpt),
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
    // 画像は無いことが普通なので、空のときは項目ごと持たない。URL の中身はここでは見ない(表示の直前に imageHref で検査する)
    ...(imageUrl !== '' ? { imageUrl } : {}),
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

function asFeedKind(value: unknown): FeedKind | null {
  return typeof value === 'string' && (FEED_KINDS as readonly string[]).includes(value) ? (value as FeedKind) : null
}

function asSeverity(value: unknown): Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : ''
}

/**
 * 公式フィード1本を整える。id・kind・sortAt が形になっていなければ null(その1本は捨てる)。
 * publishedAt は空(公開日不明)か、読める日時だけ。それ以外の値なら捨てる
 */
export function parseFeedEntry(value: unknown): FeedEntry | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const kind = asFeedKind(value.kind)
  const publishedAt = asString(value.publishedAt)
  // 見本・local-data は sortAt を持たないので、publishedAt を並びにも使う
  const sortAt = value.sortAt === undefined ? publishedAt : asString(value.sortAt)
  if (id === '' || kind === null || Number.isNaN(Date.parse(sortAt))) return null
  // publishedAt は無い(null)・空・読める日時だけ。文字列でない値や読めない日時の行は捨てる
  const rawPublishedAt = value.publishedAt
  if (rawPublishedAt !== undefined && rawPublishedAt !== null && typeof rawPublishedAt !== 'string') return null
  if (publishedAt !== '' && Number.isNaN(Date.parse(publishedAt))) return null
  const isVuln = kind === 'vuln'
  return {
    id,
    kind,
    product: asString(value.product),
    vendor: asString(value.vendor),
    title: asString(value.title),
    publishedAt,
    sortAt,
    url: asString(value.url),
    // severity・cve・cvss は vuln のとき、status は outage と vuln のときだけ持つ。それ以外の種類に付いていても捨てる
    severity: isVuln ? asSeverity(value.severity) : '',
    status: isVuln || kind === 'outage' ? asString(value.status) : '',
    cve: isVuln ? asString(value.cve) : '',
    cvss: isVuln ? asCvss(value.cvss) : null,
  }
}

/** 配列でなければ空。形の崩れた要素は捨てる。同じ id が重なったら先のものを残す */
export function parseFeed(value: unknown): FeedEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const entries: FeedEntry[] = []
  for (const raw of value) {
    const entry = parseFeedEntry(raw)
    if (entry === null || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
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
