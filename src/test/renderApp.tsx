// 画面の試験の共通の準備:ハッシュを決めて App を描画する。保存・評価・メモは試験ごとに新しい localStorage から始める
import { render, screen } from '@testing-library/react'
import { App } from '../App.tsx'
import type { LoadedData } from '../data/source.ts'
import { createLocalUserStore, type UserStore } from '../data/userStore.ts'

export function freshUserStore(): UserStore {
  window.localStorage.clear()
  return createLocalUserStore(window.localStorage)
}

export function renderApp(hash: string, data: LoadedData, userStore: UserStore = freshUserStore()) {
  window.location.hash = hash
  render(<App load={() => Promise.resolve(data)} userStore={userStore} />)
  return userStore
}

/**
 * リンクをたどる(href のハッシュに移る)。
 * jsdom はリンクのクリックによる移動を非同期に行い、次の試験の描画のあとに届いてしまうことがあるため、同期的にハッシュを変える
 */
export function follow(link: HTMLElement) {
  const href = link.getAttribute('href')
  if (!href?.startsWith('#')) throw new Error(`ハッシュのリンクではありません: ${href ?? '(なし)'}`)
  window.location.hash = href
}

/** 読み込みが終わり、指定した見出しが出るまで待つ */
export async function waitForHeading(name: string | RegExp) {
  return screen.findByRole('heading', { level: 1, name })
}

/** 戻る(-1)/進む(1)。jsdom の履歴の移動は非同期なので、hashchange が届くまで待つ */
export function goHistory(delta: -1 | 1): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener(
      'hashchange',
      () => {
        resolve()
      },
      { once: true },
    )
    window.history.go(delta)
  })
}
