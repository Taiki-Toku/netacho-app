// 読み込んだネタの一覧から、画面が使う形に取り出す純粋な関数
import type { Genre, Item } from './types.ts'

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

export function isRated(item: Item): boolean {
  return item.rating !== ''
}

export function genreLabelMap(genres: readonly Genre[]): ReadonlyMap<string, string> {
  return new Map(genres.map((genre) => [genre.id, genre.label]))
}
