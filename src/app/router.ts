// URL のハッシュ(#/...)で画面を切り替える小さなルーター。
// 依存パッケージを増やさないため自前で持つ(docs/adr/002-app-structure.md)。
// 画面の状態(どのタブ、どのネタ)を URL に持たせ、戻る・再訪・共有ができるようにする。
import { useMemo, useSyncExternalStore } from 'react'

export type Route =
  | { name: 'today' }
  | { name: 'item'; id: string }
  | { name: 'archive' }
  | { name: 'archive-date'; date: string }
  | { name: 'search' }
  | { name: 'settings' }

const TODAY: Route = { name: 'today' }

/** "#/item/2026-01-02-01" のようなハッシュを Route にする。読めないものは「今日」に落とす */
export function parseHash(hash: string): Route {
  let parts: string[]
  try {
    parts = hash
      .replace(/^#/, '')
      .split('/')
      .filter((part) => part !== '')
      .map((part) => decodeURIComponent(part))
  } catch {
    return TODAY
  }
  const [head, second] = parts
  switch (head) {
    case undefined:
    case 'today':
      return TODAY
    case 'item':
      return second !== undefined ? { name: 'item', id: second } : TODAY
    case 'archive':
      return second !== undefined ? { name: 'archive-date', date: second } : { name: 'archive' }
    case 'search':
      return { name: 'search' }
    case 'settings':
      return { name: 'settings' }
    default:
      return TODAY
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'today':
      return '#/today'
    case 'item':
      return `#/item/${encodeURIComponent(route.id)}`
    case 'archive':
      return '#/archive'
    case 'archive-date':
      return `#/archive/${encodeURIComponent(route.date)}`
    case 'search':
      return '#/search'
    case 'settings':
      return '#/settings'
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
  }
}

function getHash(): string {
  return window.location.hash
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '')
  return useMemo(() => parseHash(hash), [hash])
}
