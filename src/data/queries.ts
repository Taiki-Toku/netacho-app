// 読み込んだネタ・公式フィードの一覧から、画面が使う形に取り出す純粋な関数
import { ANNOUNCEMENT_KINDS, SEVERITY_ORDER } from './labels.ts'
import type { FeedEntry, FeedKind, Genre, Item, Severity } from './types.ts'

/** 最新の放送日(YYYY-MM-DD は文字列の比較で日付順になる) */
export function latestDate(items: readonly Item[]): string | null {
  let latest: string | null = null
  for (const item of items) {
    if (latest === null || item.date > latest) latest = item.date
  }
  return latest
}

/** その日のネタを番組の順番(order)に並べる。order が同じなら id 順 */
export function itemsOnDate(items: readonly Item[], date: string): Item[] {
  return items
    .filter((item) => item.date === date)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** 放送日の一覧(新しい順、重複なし) */
export function broadcastDates(items: readonly Item[]): string[] {
  return [...new Set(items.map((item) => item.date))].sort((a, b) => b.localeCompare(a))
}

export function findItem(items: readonly Item[], id: string): Item | null {
  return items.find((item) => item.id === id) ?? null
}

export interface Neighbors {
  /** 同じ放送日の進行表の中での位置(1 から) */
  position: number
  /** 同じ放送日の本数 */
  total: number
  prev: Item | null
  next: Item | null
}

/** 同じ放送日の進行表の中で、前後のネタを返す。詳細の画面の前後移動に使う */
export function neighbors(items: readonly Item[], item: Item): Neighbors {
  const list = itemsOnDate(items, item.date)
  const index = list.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) return { position: 1, total: 1, prev: null, next: null }
  return {
    position: index + 1,
    total: list.length,
    prev: list[index - 1] ?? null,
    next: list[index + 1] ?? null,
  }
}

export function isRated(item: Item): boolean {
  return item.rating !== ''
}

export function genreLabelMap(genres: readonly Genre[]): ReadonlyMap<string, string> {
  return new Map(genres.map((genre) => [genre.id, genre.label]))
}

export function genreLabelOf(item: Item, labels: ReadonlyMap<string, string>): string {
  return item.genre === null ? '未分類' : (labels.get(item.genre) ?? item.genre)
}

/** ジャンルの画面用:その genre のネタを新しい順(日付の新しい順、同じ日なら order 順)に並べる */
export function itemsInGenre(items: readonly Item[], genre: string): Item[] {
  return items
    .filter((item) => item.genre === genre)
    .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order || a.id.localeCompare(b.id))
}

/** 公式フィードから、指定した種類だけを新しい順に取り出す */
export function feedOfKinds(feed: readonly FeedEntry[], kinds: readonly FeedKind[]): FeedEntry[] {
  return feed
    .filter((entry) => kinds.includes(entry.kind))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id))
}

/** 公式のお知らせ(脆弱性以外)。kind を渡すとその種類だけ */
export function announcements(feed: readonly FeedEntry[], kind: 'all' | FeedKind = 'all'): FeedEntry[] {
  return feedOfKinds(feed, kind === 'all' ? ANNOUNCEMENT_KINDS : [kind])
}

/** 脆弱性(kind が vuln)を新しい順に。severity を渡すとその深刻度だけ */
export function vulnerabilities(feed: readonly FeedEntry[], severity: 'all' | Severity = 'all'): FeedEntry[] {
  const list = feedOfKinds(feed, ['vuln'])
  return severity === 'all' ? list : list.filter((entry) => entry.severity === severity)
}

export function findFeedEntry(feed: readonly FeedEntry[], id: string): FeedEntry | null {
  return feed.find((entry) => entry.id === id) ?? null
}

/** 深刻度ごとの件数(カードの数字) */
export function countBySeverity(vulns: readonly FeedEntry[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, '': 0 }
  for (const entry of vulns) counts[entry.severity] += 1
  return counts
}

/** 脆弱性ウォッチに出す1件:深刻度がいちばん高いものの中で、いちばん新しいもの */
export function topVulnerability(feed: readonly FeedEntry[]): FeedEntry | null {
  const list = vulnerabilities(feed)
  const rank = (severity: Severity) => {
    const index = (SEVERITY_ORDER as readonly Severity[]).indexOf(severity)
    return index === -1 ? SEVERITY_ORDER.length : index
  }
  let best: FeedEntry | null = null
  for (const entry of list) {
    if (best === null || rank(entry.severity) < rank(best.severity)) best = entry
  }
  return best
}

/** フィードに出てくる製品名(重複なし、名前順) */
export function feedProducts(feed: readonly FeedEntry[]): string[] {
  return [...new Set(feed.map((entry) => entry.product).filter((product) => product !== ''))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  )
}

/** 検索語の正規化。空白で区切った語をすべて含むものを探す(大文字小文字は区別しない) */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '')
}

function matches(haystack: readonly string[], query: string): boolean {
  const words = terms(query)
  if (words.length === 0) return false
  const text = haystack.join('\n').toLowerCase()
  return words.every((word) => text.includes(word))
}

/** ネタの検索(見出し・リード・要約・タグ・カテゴリ・取り組み・出典名・ジャンル名)。新しい順 */
export function searchItems(items: readonly Item[], genres: readonly Genre[], query: string): Item[] {
  const labels = genreLabelMap(genres)
  return items
    .filter((item) =>
      matches(
        [
          item.title,
          item.lead,
          item.summary,
          item.sourceTitle,
          item.genre === null ? '' : (labels.get(item.genre) ?? item.genre),
          ...item.tags,
          ...item.categories,
          ...item.projects,
        ],
        query,
      ),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order || a.id.localeCompare(b.id))
}

/** ジャンルの検索(表示名と id)。渡した一覧の順は保つ */
export function searchGenres(genres: readonly Genre[], query: string): Genre[] {
  return genres.filter((genre) => matches([genre.label, genre.id], query))
}

/** 公式フィードの検索(製品名・ベンダー・見出し・CVE 番号)。渡した一覧の順は保つ */
export function searchFeed(entries: readonly FeedEntry[], query: string): FeedEntry[] {
  return entries.filter((entry) => matches([entry.product, entry.vendor, entry.title, entry.cve], query))
}

