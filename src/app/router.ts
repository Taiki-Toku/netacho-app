// URL のハッシュ(#/...)で画面を切り替える小さなルーター。
// 依存パッケージを増やさないため自前で持つ(docs/adr/002-app-structure.md)。
// 画面の状態(どのジャンル、どの絞り込み、検索語)を URL に持たせ、再読み込み・戻る・共有で同じ表示に戻れるようにする(仕様 7 章)。
import { useMemo, useSyncExternalStore } from 'react'
import { FEED_KINDS, SEVERITIES, type FeedKind, type Severity } from '../data/types.ts'

/** 公式のお知らせの絞り込み。all はすべて */
export type FeedFilter = 'all' | FeedKind
/** 脆弱性の絞り込み。all はすべて */
export type SeverityFilter = 'all' | Exclude<Severity, ''>

export type Route =
  | { name: 'home' }
  | { name: 'genre'; id: string; kind: FeedFilter }
  | { name: 'feed'; kind: FeedFilter }
  | { name: 'vuln'; severity: SeverityFilter }
  | { name: 'vuln-detail'; id: string }
  | { name: 'item'; id: string }
  | { name: 'saved' }
  | { name: 'search'; q: string }

const HOME: Route = { name: 'home' }

function asFeedFilter(value: string | null): FeedFilter {
  // 脆弱性は別の画面なので、お知らせの絞り込みには出てこない。知らない値は「すべて」
  return value !== null && value !== 'vuln' && (FEED_KINDS as readonly string[]).includes(value) ? (value as FeedKind) : 'all'
}

function asSeverityFilter(value: string | null): SeverityFilter {
  return value !== null && value !== '' && (SEVERITIES as readonly string[]).includes(value) ? (value as SeverityFilter) : 'all'
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
    case 'vuln':
      return second !== undefined ? { name: 'vuln-detail', id: second } : { name: 'vuln', severity: asSeverityFilter(query.get('sev')) }
    case 'item':
      return second !== undefined ? { name: 'item', id: second } : HOME
    case 'saved':
      return { name: 'saved' }
    case 'search':
      return { name: 'search', q: (query.get('q') ?? '').trim() }
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
      return `#/vuln/${encodeURIComponent(route.id)}`
    case 'item':
      return `#/item/${encodeURIComponent(route.id)}`
    case 'saved':
      return '#/saved'
    case 'search':
      return withQuery('#/search', { q: route.q })
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

function subscribe(onChange: () => void): () => void {
  function handle() {
    redirectLegacyHash()
    onChange()
  }
  window.addEventListener('hashchange', handle)
  // 最初の表示が #/today のとき(ブックマークなど)
  if (redirectLegacyHash()) onChange()
  return () => {
    window.removeEventListener('hashchange', handle)
  }
}

function getHash(): string {
  return window.location.hash
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '')
  return useMemo(() => parseHash(hash), [hash])
}
