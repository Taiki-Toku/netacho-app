import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { App } from '../App.tsx'
import type { LoadedData } from '../data/source.ts'
import { pullDistance } from '../lib/usePullToRefresh.ts'
import { freshUserStore, waitForHeading } from '../test/renderApp.tsx'
import { baseSample } from '../test/sampleData.ts'
import { SPINNER_LINES, visibleLines } from './PullIndicator.tsx'
import { readRepoText } from '../test/repoFiles.ts'
import tokensCss from '../styles/tokens.css?raw'

// 試験では部品の CSS を読み込まない設定(vite.config.ts)なので、中身はファイルから読む
const indicatorCss = await readRepoText('src/components/PullIndicator.module.css')
const appCss = await readRepoText('src/App.module.css')

// 1本目(2026-01-02-01)の見出しだけを変えた見本(架空)。読み直したことが画面で分かる
function dataNamed(title: string): LoadedData {
  return { ...baseSample, items: baseSample.items.map((item) => (item.id === '2026-01-02-01' ? { ...item, title } : item)) }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((ok, ng) => {
    resolve = ok
    reject = ng
  })
  return { promise, resolve, reject }
}

function touch(type: 'touchstart' | 'touchmove' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: type === 'touchmove' })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [point] })
  Object.defineProperty(event, 'changedTouches', { value: [point] })
  fireEvent(document.body, event)
}

/** 一番上で、指を dy だけ下へ引く(まだ離さない) */
function pull(dy: number) {
  touch('touchstart', 200, 100)
  touch('touchmove', 200, 100 + dy / 2)
  touch('touchmove', 200, 100 + dy)
}

// 表示の量が 64px を越える指の量(R = 200 で 94.1…px)
const ENOUGH = 95

function renderWith(loads: (() => Promise<LoadedData>)[], hash = '#/item/2026-01-02-01') {
  window.location.hash = hash
  let calls = 0
  const load = () => {
    const next = loads[Math.min(calls, loads.length - 1)]
    calls += 1
    if (next === undefined) throw new Error('読み込みの見本がありません')
    return next()
  }
  render(<App load={load} userStore={freshUserStore()} />)
  return { calls: () => calls }
}

/** 引っぱって更新の印(data-phase を持つ。読み上げからは隠す) */
function indicator(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-phase]')
  if (found === null) throw new Error('引っぱって更新の印がありません')
  return found
}

/** 印の読み上げ用の欄(見えない文字。印の直前に置く) */
function spoken(): HTMLElement {
  const found = indicator().previousElementSibling
  if (!(found instanceof HTMLElement)) throw new Error('読み上げの欄がありません')
  return found
}

/** 指に付けて動かす枠(.pullArea)。印はその中の先頭 */
function pullArea(): HTMLElement {
  const found = indicator().parentElement
  if (found === null) throw new Error('.pullArea がありません')
  return found
}

function lines(): number {
  return indicator().querySelectorAll('svg line').length
}

/** トーストの欄(role="status"、aria-live="polite"。引っぱって更新の欄ではないもの) */
function toast(): HTMLElement {
  const found = screen.getAllByRole('status').find((element) => element !== spoken() && !pullArea().contains(element))
  if (found === undefined) throw new Error('トーストの欄がありません')
  return found
}

describe('引っぱって更新の印(依頼 15-1、詳細設計 5.7.2)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.location.hash = ''
  })

  it('TST-PTR-02 線の本数は表示の量に合う(64px で8本)', () => {
    expect(SPINNER_LINES).toBe(8)
    expect(visibleLines(0)).toBe(0)
    expect(visibleLines(7.9)).toBe(0)
    expect(visibleLines(8)).toBe(1)
    expect(visibleLines(32)).toBe(4)
    expect(visibleLines(63.9)).toBe(7)
    expect(visibleLines(64)).toBe(8)
    expect(visibleLines(150)).toBe(8)
  })

  it('TST-PTR-02 引くと線が増え、8本そろうと「離すと更新」、更新中は回る印と「更新しています」。文字は見えず、印は読み上げない', async () => {
    const second = deferred<LoadedData>()
    const app = renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => second.promise])
    await waitForHeading('架空:一回目の見出し')
    expect(indicator()).toHaveAttribute('aria-hidden', 'true')
    expect(indicator()).toHaveTextContent(/^$/)
    expect(spoken()).toHaveClass('visually-hidden')
    expect(spoken()).toHaveAttribute('aria-live', 'polite')
    expect(spoken()).toHaveTextContent(/^$/)
    expect(lines()).toBe(0)

    pull(40)
    expect(lines()).toBe(visibleLines(pullDistance(40)))
    expect(lines()).toBeGreaterThan(0)
    expect(lines()).toBeLessThan(8)
    expect(spoken()).toHaveTextContent(/^$/)
    pull(ENOUGH)
    expect(lines()).toBe(8)
    expect(spoken()).toHaveTextContent('離すと更新')
    // 印は SVG の線で描き、文字は入れない
    expect(indicator()).toHaveTextContent(/^$/)
    touch('touchend', 0, 0)
    expect(spoken()).toHaveTextContent('更新しています')
    expect(indicator()).toHaveAttribute('data-phase', 'refreshing')
    expect(lines()).toBe(8)
    expect(app.calls()).toBe(2)

    // TST-RF-02 更新中も今の画面・URL のまま(読み込み中にしない)
    expect(screen.getByRole('heading', { level: 1, name: '架空:一回目の見出し' })).toBeInTheDocument()
    expect(screen.queryByText('読み込み中')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/item/2026-01-02-01')

    await act(async () => {
      second.resolve(dataNamed('架空:二回目の見出し'))
      await second.promise
    })
    expect(await waitForHeading('架空:二回目の見出し')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/item/2026-01-02-01')
    expect(spoken()).toHaveTextContent(/^$/)
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
    // TST-PTR-04 成功ではトーストを出さない
    expect(toast()).toHaveTextContent(/^$/)
    expect(screen.queryByText('最新に更新しました')).not.toBeInTheDocument()
  })

  it('TST-PTR-02 回る印は 8段で1周 --duration-spin(800ms)。色・大きさはトークン', () => {
    expect(tokensCss).toMatch(/--duration-spin: 800ms;/)
    expect(indicatorCss).toMatch(/animation: spin var\(--duration-spin\) steps\(8\) infinite;/)
    expect(indicatorCss).toMatch(/stroke: var\(--muted\);/)
    expect(indicatorCss).toMatch(/width: var\(--sp-7\);/)
    expect(indicatorCss).toMatch(/background: var\(--bg\);/)
  })

  it('TST-PTR-01 .pullArea の transform は data-pull があるとき(引っぱり中・更新中)だけ', async () => {
    const second = deferred<LoadedData>()
    renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => second.promise])
    await waitForHeading('架空:一回目の見出し')
    expect(pullArea()).not.toHaveAttribute('data-pull')
    expect(pullArea().style.getPropertyValue('--pull-y')).toBe('')
    pull(ENOUGH)
    expect(indicator()).toHaveAttribute('data-phase', 'armed')
    expect(pullArea()).toHaveAttribute('data-pull', 'pulling')
    expect(pullArea().style.getPropertyValue('--pull-y')).toBe(`${pullDistance(ENOUGH)}px`)
    touch('touchend', 0, 0)
    expect(pullArea()).toHaveAttribute('data-pull', 'refreshing')
    expect(pullArea().style.getPropertyValue('--pull-y')).toBe('var(--sp-13)')
    await act(async () => {
      second.resolve(dataNamed('架空:二回目の見出し'))
      await second.promise
    })
    await waitForHeading('架空:二回目の見出し')
    expect(pullArea()).not.toHaveAttribute('data-pull')
    expect(pullArea().style.getPropertyValue('--pull-y')).toBe('')
    // CSS:transform は [data-pull] のときだけ。素の .pullArea には transform を書かない
    const base = /\.pullArea \{([^}]*)\}/.exec(appCss)?.[1] ?? ''
    expect(base).not.toMatch(/transform:/)
    expect(appCss).toMatch(/\.pullArea\[data-pull\] \{\s*transform: translateY\(var\(--pull-y\)\);/)
  })

  it('TST-PTR-03 動きを減らす設定では --pull-y を付けず、上のバーのすぐ下に回らない印を出す', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    const second = deferred<LoadedData>()
    renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => second.promise])
    await waitForHeading('架空:一回目の見出し')
    pull(40)
    expect(pullArea().style.getPropertyValue('--pull-y')).toBe('')
    expect(pullArea()).not.toHaveAttribute('data-pull')
    // 線は引いた量に合わせて現れる
    expect(lines()).toBe(visibleLines(pullDistance(40)))
    pull(ENOUGH)
    expect(lines()).toBe(8)
    touch('touchend', 0, 0)
    // 更新中は8本のまま(回さないのは CSS の @media)
    expect(indicator()).toHaveAttribute('data-phase', 'refreshing')
    expect(lines()).toBe(8)
    expect(pullArea().style.getPropertyValue('--pull-y')).toBe('')
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(indicatorCss)?.[1] ?? ''
    expect(reduced).toMatch(/position: fixed;/)
    expect(reduced).toMatch(/top: var\(--topbar-h\);/)
    expect(reduced).toMatch(/\.spinnerSpinning \{\s*animation: none;/)
    await act(async () => {
      second.resolve(dataNamed('架空:二回目の見出し'))
      await second.promise
    })
  })

  it('TST-PTR-04 引っぱって更新に失敗したら、今のデータのままトースト「最新に更新できませんでした」', async () => {
    renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => Promise.reject(new Error('Failed to fetch'))])
    await waitForHeading('架空:一回目の見出し')
    pull(ENOUGH)
    await act(async () => {
      touch('touchend', 0, 0)
      await Promise.resolve()
    })
    expect(await screen.findByText('最新に更新できませんでした')).toBe(toast())
    expect(toast()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('heading', { level: 1, name: '架空:一回目の見出し' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('TST-PTR-05 下のメニュー・「先頭へ戻る」・トーストは .pullArea の外。上のバー・ジャンルのタブ・本文は中', async () => {
    renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し'))], '#/home')
    await waitForHeading('今日のニュース')
    const area = pullArea()
    expect(area.contains(screen.getByRole('navigation', { name: '画面の切り替え' }))).toBe(false)
    expect(area.contains(document.querySelector('button[aria-label="先頭へ戻る"]'))).toBe(false)
    expect(area.contains(toast())).toBe(false)
    expect(area.contains(document.querySelector('header'))).toBe(true)
    expect(area.contains(screen.getByRole('navigation', { name: 'ジャンルのタブ' }))).toBe(true)
    expect(area.contains(screen.getByRole('main'))).toBe(true)
  })

  it('TST-RF-02 開き直し(30 分以上)の裏の読み直しでも、画面を読み込み中にせず、成功でデータを差し替える。印は出さない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-27T00:00:00Z'))
    const second = deferred<LoadedData>()
    const app = renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => second.promise])
    await waitForHeading('架空:一回目の見出し')
    vi.setSystemTime(new Date('2026-11-27T00:31:00Z'))
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(app.calls()).toBe(2)
    expect(screen.getByRole('heading', { level: 1, name: '架空:一回目の見出し' })).toBeInTheDocument()
    expect(screen.queryByText('読み込み中')).not.toBeInTheDocument()
    // 裏の読み直しでは印も読み上げも出さない(引っぱったときだけ)
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
    expect(spoken()).toHaveTextContent(/^$/)
    await act(async () => {
      second.resolve(dataNamed('架空:二回目の見出し'))
      await second.promise
    })
    expect(await waitForHeading('架空:二回目の見出し')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/item/2026-01-02-01')
  })

  it('読み込み中・エラーの画面では、引いても何もしない', async () => {
    const app = renderWith([() => Promise.reject(new Error('Failed to fetch'))], '#/home')
    await screen.findByRole('alert')
    pull(ENOUGH)
    touch('touchend', 0, 0)
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
    expect(spoken()).toHaveTextContent(/^$/)
    expect(app.calls()).toBe(1)
  })
})
