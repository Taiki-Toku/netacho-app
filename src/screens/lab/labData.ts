// デザイン案の見比べで、3案が共通に使うデータの取り出し。見本のデータ(fixtures)をそのまま使う
import { RATING_LABELS, STATUS_LABELS } from '../../data/labels.ts'
import { genreLabelMap, itemsOnDate, latestDate } from '../../data/queries.ts'
import type { Genre, Item } from '../../data/types.ts'
import { dateParts, formatDateLong } from '../../lib/format.ts'
import { httpsHref } from '../../lib/safeUrl.ts'

export type LabScreen = 'today' | 'item'
export type LabTheme = 'light' | 'dark'

export interface LabProps {
  screen: LabScreen
  theme: LabTheme
  /** 詳細で見せるネタ。無ければ1本目 */
  itemId: string | null
  /** 一覧の行や前後ボタンを押したとき */
  onOpen: (id: string) => void
  /** 一覧に戻るとき */
  onBack: () => void
}

export interface LabModel {
  date: string
  dateLong: string
  parts: { year: string; month: string; day: string; weekday: string }
  list: Item[]
  current: Item
  index: number
  prev: Item | null
  next: Item | null
  ratedCount: number
  genreLabel: (item: Item) => string
}

export function buildModel(items: readonly Item[], genres: readonly Genre[], itemId: string | null): LabModel | null {
  const date = latestDate(items)
  if (date === null) return null
  const list = itemsOnDate(items, date)
  if (list.length === 0) return null
  const found = itemId === null ? -1 : list.findIndex((item) => item.id === itemId)
  const index = found === -1 ? 0 : found
  const labels = genreLabelMap(genres)
  const parts = dateParts(date) ?? { year: date.slice(0, 4), month: date.slice(5, 7), day: date.slice(8, 10), weekday: '' }
  return {
    date,
    dateLong: formatDateLong(date),
    parts,
    list,
    current: list[index]!,
    index,
    prev: list[index - 1] ?? null,
    next: list[index + 1] ?? null,
    ratedCount: list.filter((item) => item.rating !== '').length,
    genreLabel: (item) => (item.genre === null ? '未分類' : (labels.get(item.genre) ?? item.genre)),
  }
}

export function ratingLabel(item: Item): string {
  return RATING_LABELS[item.rating]
}

export function statusLabel(item: Item): string {
  return STATUS_LABELS[item.status]
}

/** 出典。リンクにしてよい href か null(既存の httpsHref をそのまま使う。安全性の判定は変えない) */
export function sourceHref(item: Item): string | null {
  return httpsHref(item.sourceUrl)
}

export function orderLabel(order: number): string {
  return Number.isSafeInteger(order) && order >= 0 && order < 100 ? String(order).padStart(2, '0') : '--'
}

export const NAV_LABELS = ['今日', 'バックナンバー', '探す', '設定'] as const
