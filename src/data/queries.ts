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

/**
 * バックナンバーで選べる配信日(新しい順、重複なし)。今日(日本時間)とそれより後の日は入れない。
 * 公開日ではなく配信日(items.date)で分ける(詳細設計 5.4.2、2026-11-25 オーナー決定)
 */
export function archiveDates(items: readonly Item[], today: string): string[] {
  return broadcastDates(items).filter((date) => date < today)
}

/** 前後を決める一覧。router の ItemFrom はこの型を使う(data から app へ依存しないよう、ここで定める) */
export type NeighborsFrom = { kind: 'genre'; id: string } | { kind: 'saved' } | { kind: 'archive'; date: string }

/**
 * 前後のネタを返す。詳細の画面の前後移動に使う(仕様 4 章 5)。
 * from がジャンルで記事がそのジャンルなら itemsInGenre の並び、保存で記事が保存の一覧にあれば保存の一覧の並び、
 * バックナンバーで記事がその配信日のものならその日の並び。
 * どちらでもなければ同じ放送日の進行表の中で決める
 */
export function neighbors(items: readonly Item[], item: Item, from?: NeighborsFrom, saved: readonly string[] = []): Neighbors {
  let list = itemsOnDate(items, item.date)
  if (from?.kind === 'genre' && item.genre === from.id) {
    list = itemsInGenre(items, from.id)
  } else if (from?.kind === 'saved') {
    const savedList = savedItems(items, saved)
    if (savedList.some((candidate) => candidate.id === item.id)) list = savedList
  } else if (from?.kind === 'archive' && item.date === from.date) {
    // バックナンバーの一覧と同じ並び(その日の sort_order 順)
    list = itemsOnDate(items, from.date)
  }
  const index = list.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) return { position: 1, total: 1, prev: null, next: null }
  return {
    position: index + 1,
    total: list.length,
    prev: list[index - 1] ?? null,
    next: list[index + 1] ?? null,
  }
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

/** 保存の画面用:保存した id の一覧(保存した順)から、新しく保存した順にネタを並べる。見つからない id は除く */
export function savedItems(items: readonly Item[], saved: readonly string[]): Item[] {
  return [...saved]
    .reverse()
    .map((id) => findItem(items, id))
    .filter((item) => item !== null)
}

/** 公式フィードから、指定した種類だけを新しい順(sortAt。公開日不明のものも並べられる)に取り出す */
export function feedOfKinds(feed: readonly FeedEntry[], kinds: readonly FeedKind[]): FeedEntry[] {
  return feed
    .filter((entry) => kinds.includes(entry.kind))
    .sort((a, b) => Date.parse(b.sortAt) - Date.parse(a.sortAt) || a.id.localeCompare(b.id))
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

export interface VulnNeighbors {
  /** 一覧の中での位置(1 から) */
  position: number
  total: number
  prev: FeedEntry | null
  next: FeedEntry | null
}

/**
 * 脆弱性の詳細の前後(詳細設計 5.6.2)。脆弱性の一覧と同じ並び(vulnerabilities() の新しい順)で、
 * 深刻度で絞っていたときはその絞りの中で決める。id がその一覧に無ければ null(前後を出さない)
 */
export function vulnNeighbors(feed: readonly FeedEntry[], id: string, severity: 'all' | Severity = 'all'): VulnNeighbors | null {
  const list = vulnerabilities(feed, severity)
  const index = list.findIndex((entry) => entry.id === id)
  if (index === -1) return null
  return { position: index + 1, total: list.length, prev: list[index - 1] ?? null, next: list[index + 1] ?? null }
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

/** ネタの検索(見出し・リード・要約・タグ・カテゴリ・出典名・ジャンル名)。新しい順。取り組み(projects)は画面に出さないので探さない(詳細設計 5.7.1) */
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

/** 公式フィードの検索(製品名・ベンダー・見出し・見出しの訳・CVE 番号)。渡した一覧の順は保つ */
export function searchFeed(entries: readonly FeedEntry[], query: string): FeedEntry[] {
  return entries.filter((entry) => matches([entry.product, entry.vendor, entry.title, entry.titleJa ?? '', entry.cve], query))
}

