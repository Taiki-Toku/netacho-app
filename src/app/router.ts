// URL のハッシュ(#/...)で画面を切り替える小さなルーター。
// 依存パッケージを増やさないため自前で持つ(docs/adr/002-app-structure.md)。
// 画面の状態(どのジャンル、どの絞り込み、検索語)を URL に持たせ、再読み込み・戻る・共有で同じ表示に戻れるようにする(仕様 7 章)。
import { useMemo, useSyncExternalStore } from 'react'
import type { NeighborsFrom } from '../data/queries.ts'
import { FEED_KINDS, SEVERITIES, type FeedKind, type Severity } from '../data/types.ts'
import { isCalendarDate } from '../lib/format.ts'

/** 公式のお知らせの絞り込み。all はすべて */
export type FeedFilter = 'all' | FeedKind
/** 脆弱性の絞り込み。all はすべて */
export type SeverityFilter = 'all' | Exclude<Severity, ''>

/** 詳細をどの一覧から開いたか({ kind: 'genre'; id } | { kind: 'saved' })。前後のニュースと戻り先をその一覧で決める(仕様 4 章 5) */
export type ItemFrom = NeighborsFrom

export type Route =
  | { name: 'home' }
  | { name: 'genre'; id: string; kind: FeedFilter }
  | { name: 'feed'; kind: FeedFilter }
  | { name: 'vuln'; severity: SeverityFilter }
  /**
   * 脆弱性の詳細。severity は一覧で絞っていた深刻度(URL の ?sev=。前後の移り先と戻り先をその絞りの中で決める)。
   * 無ければ「すべて」(item の from と同じく、「すべて」のときは鍵ごと付けない。トップ・さがすから開いたとき)
   */
  | { name: 'vuln-detail'; id: string; severity?: SeverityFilter }
  | { name: 'item'; id: string; from?: ItemFrom }
  | { name: 'saved' }
  /** バックナンバー。date は配信日。null は日付なし(#/archive)、'' は形の違う・暦に無い日付(空の状態を出す) */
  | { name: 'archive'; date: string | null }
  | { name: 'search'; q: string }
  | { name: 'settings' }

const HOME: Route = { name: 'home' }

function asFeedFilter(value: string | null): FeedFilter {
  // 脆弱性は別の画面なので、お知らせの絞り込みには出てこない。知らない値は「すべて」
  return value !== null && value !== 'vuln' && (FEED_KINDS as readonly string[]).includes(value) ? (value as FeedKind) : 'all'
}

function asSeverityFilter(value: string | null): SeverityFilter {
  return value !== null && value !== '' && (SEVERITIES as readonly string[]).includes(value) ? (value as SeverityFilter) : 'all'
}

/** from=genre:<id> / from=saved / from=archive:<YYYY-MM-DD> を読む。形が違う・知らない値は undefined(from なし) */
function asItemFrom(value: string | null): ItemFrom | undefined {
  if (value === 'saved') return { kind: 'saved' }
  if (value?.startsWith('archive:') === true) {
    const date = value.slice('archive:'.length)
    // 暦に実在する日付だけ。それ以外は from なし(詳細設計 5.4.3)
    return isCalendarDate(date) ? { kind: 'archive', date } : undefined
  }
  if (value?.startsWith('genre:') === true) {
    const id = value.slice('genre:'.length)
    if (id !== '') return { kind: 'genre', id }
  }
  return undefined
}

function fromParam(from: ItemFrom): string {
  switch (from.kind) {
    case 'saved':
      return 'saved'
    case 'archive':
      return `archive:${from.date}`
    case 'genre':
      return `genre:${from.id}`
  }
}

/** #/archive/<x> の x を読む。無ければ null(最新の過去日に置き換える)、暦に無い・形が違う日付は ''(空の状態) */
function asArchiveDate(value: string | undefined): string | null {
  if (value === undefined) return null
  return isCalendarDate(value) ? value : ''
}

/** "#/genre/product?kind=release" のようなハッシュを Route にする。読めないものはトップ(ホーム)に落とす */
export function parseHash(hash: string): Route {
  const withoutMark = hash.replace(/^#/, '')
  const queryStart = withoutMark.indexOf('?')
  const path = queryStart === -1 ? withoutMark : withoutMark.slice(0, queryStart)
  const query = new URLSearchParams(queryStart === -1 ? '' : withoutMark.slice(queryStart + 1))
  let parts: string[]
  try {
    parts = path
      .split('/')
      .filter((part) => part !== '')
      .map((part) => decodeURIComponent(part))
  } catch {
    return HOME
  }
  const [head, second] = parts
  switch (head) {
    case undefined:
    case 'home':
    case 'today': // 旧アドレス。URL は redirectLegacyHash で #/home に置き換える
      return HOME
    case 'genre':
      return second !== undefined ? { name: 'genre', id: second, kind: asFeedFilter(query.get('kind')) } : HOME
    case 'feed':
      return { name: 'feed', kind: asFeedFilter(query.get('kind')) }
    case 'vuln': {
      // 形の違う sev は「すべて」
      const severity = asSeverityFilter(query.get('sev'))
      if (second === undefined) return { name: 'vuln', severity }
      return severity === 'all' ? { name: 'vuln-detail', id: second } : { name: 'vuln-detail', id: second, severity }
    }
    case 'item': {
      if (second === undefined) return HOME
      const from = asItemFrom(query.get('from'))
      // from が無いときは鍵ごと付けない(今までの Route と同じ形にする)
      return from === undefined ? { name: 'item', id: second } : { name: 'item', id: second, from }
    }
    case 'saved':
      return { name: 'saved' }
    case 'archive':
      return { name: 'archive', date: asArchiveDate(second) }
    case 'search':
      return { name: 'search', q: (query.get('q') ?? '').trim() }
    case 'settings':
      return { name: 'settings' }
    default:
      return HOME
  }
}

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== '' && value !== 'all') query.set(key, value)
  const text = query.toString()
  return text === '' ? path : `${path}?${text}`
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/home'
    case 'genre':
      return withQuery(`#/genre/${encodeURIComponent(route.id)}`, { kind: route.kind })
    case 'feed':
      return withQuery('#/feed', { kind: route.kind })
    case 'vuln':
      return withQuery('#/vuln', { sev: route.severity })
    case 'vuln-detail':
      return withQuery(`#/vuln/${encodeURIComponent(route.id)}`, { sev: route.severity ?? 'all' })
    case 'item':
      return withQuery(`#/item/${encodeURIComponent(route.id)}`, route.from === undefined ? {} : { from: fromParam(route.from) })
    case 'saved':
      return '#/saved'
    case 'archive':
      // date は parseHash を通った値(実在する日付・''・null)だけ。'' と null は日付なしのアドレス
      return route.date === null || route.date === '' ? '#/archive' : `#/archive/${encodeURIComponent(route.date)}`
    case 'search':
      return withQuery('#/search', { q: route.q })
    case 'settings':
      return '#/settings'
  }
}

/** 画面を切り替える(履歴に残る。「戻る」で前の表示に戻れる) */
export function navigate(route: Route) {
  window.location.hash = hrefFor(route)
}

/** 画面の「種類」を表す鍵。これが変わったときだけ先頭にスクロールする(絞り込みの変更ではしない) */
export function screenKey(route: Route): string {
  switch (route.name) {
    case 'genre':
    case 'item':
    case 'vuln-detail':
      return `${route.name}:${route.id}`
    case 'search':
      return `search:${route.q}`
    default:
      return route.name
  }
}

/**
 * 旧アドレス #/today を #/home に転送する。転送したら true。
 * 履歴に積まずに置き換える(積むと「戻る」で #/today に戻り、また転送されて先へ戻れなくなる)。
 * replaceState は hashchange を起こさないので、呼んだ側が画面に知らせる
 */
export function redirectLegacyHash(): boolean {
  if (!/^#\/today(?:[/?]|$)/.test(window.location.hash)) return false
  window.history.replaceState(window.history.state, '', hrefFor({ name: 'home' }))
  return true
}

/** replaceRoute で URL を変えたことを useRoute に知らせる先(replaceState は hashchange を起こさないため) */
const replaceListeners = new Set<() => void>()

/**
 * 今の履歴の項目を置き換えて画面を切り替える(履歴に積まない)。
 * #/archive を最新の過去日に置き換えるときに使う(積むと「戻る」で #/archive に戻り、また置き換わって先へ戻れなくなる)
 */
export function replaceRoute(route: Route) {
  window.history.replaceState(window.history.state, '', hrefFor(route))
  for (const listener of replaceListeners) listener()
}

function subscribe(onChange: () => void): () => void {
  function handle() {
    redirectLegacyHash()
    onChange()
  }
  window.addEventListener('hashchange', handle)
  replaceListeners.add(onChange)
  // 最初の表示が #/today のとき(ブックマークなど)
  if (redirectLegacyHash()) onChange()
  return () => {
    window.removeEventListener('hashchange', handle)
    replaceListeners.delete(onChange)
  }
}

function getHash(): string {
  return window.location.hash
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '')
  return useMemo(() => parseHash(hash), [hash])
}
