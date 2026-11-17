// 検索欄の候補(仕様 4 章 7)。分類は ニュース/公式のお知らせ/脆弱性/ジャンル の4つで、0件の分類は出さない。
// 開く先は Route で持つ(画面の部品はこれを navigate に渡すだけ)。
// 公式のお知らせには詳細の画面が無いため、外部リンクにはせず、その検索語の結果の画面へ移す(オーナーの回答 2026-11-17)
import type { Route } from '../app/router.ts'
import { announcements, genreLabelMap, genreLabelOf, searchFeed, searchGenres, searchItems, vulnerabilities } from './queries.ts'
import type { LoadedData } from './source.ts'

export type SuggestKind = 'item' | 'feed' | 'vuln' | 'genre'

export const SUGGEST_GROUP_LABELS: Record<SuggestKind, string> = {
  item: 'ニュース',
  feed: '公式のお知らせ',
  vuln: '脆弱性',
  genre: 'ジャンル',
}

/** 分類ごとに出す候補の上限(オーナーの回答 2026-11-17) */
export const SUGGEST_LIMIT = 3

export interface SuggestOption {
  /** 一覧の中で重ならない鍵(DOM の id の材料にもする) */
  key: string
  label: string
  /** 添え書き(ジャンル名、製品名、CVSS など)。無ければ空 */
  note: string
  route: Route
}

export interface SuggestGroup {
  kind: SuggestKind
  label: string
  options: SuggestOption[]
}

export function buildSuggestions(data: LoadedData, query: string, limit: number = SUGGEST_LIMIT): SuggestGroup[] {
  const q = query.trim()
  if (q === '') return []
  const labels = genreLabelMap(data.genres)
  const toResults: Route = { name: 'search', q }

  const items: SuggestOption[] = searchItems(data.items, data.genres, q)
    .slice(0, limit)
    .map((item) => ({
      key: `item-${item.id}`,
      label: item.title !== '' ? item.title : '(見出しなし)',
      note: genreLabelOf(item, labels),
      route: { name: 'item', id: item.id },
    }))
  const feed: SuggestOption[] = searchFeed(announcements(data.feed), q)
    .slice(0, limit)
    .map((entry) => ({
      key: `feed-${entry.id}`,
      label: entry.title !== '' ? entry.title : '(見出しなし)',
      note: entry.product,
      route: toResults,
    }))
  const vulns: SuggestOption[] = searchFeed(vulnerabilities(data.feed), q)
    .slice(0, limit)
    .map((entry) => ({
      key: `vuln-${entry.id}`,
      label: entry.cve !== '' ? entry.cve : 'CVE番号なし',
      note: entry.product,
      route: { name: 'vuln-detail', id: entry.id },
    }))
  const genres: SuggestOption[] = searchGenres(data.genres, q)
    .slice(0, limit)
    .map((genre) => ({
      key: `genre-${genre.id}`,
      label: genre.label,
      note: '',
      route: { name: 'genre', id: genre.id, kind: 'all' },
    }))

  const groups: SuggestGroup[] = [
    { kind: 'item', label: SUGGEST_GROUP_LABELS.item, options: items },
    { kind: 'feed', label: SUGGEST_GROUP_LABELS.feed, options: feed },
    { kind: 'vuln', label: SUGGEST_GROUP_LABELS.vuln, options: vulns },
    { kind: 'genre', label: SUGGEST_GROUP_LABELS.genre, options: genres },
  ]
  return groups.filter((group) => group.options.length > 0)
}
