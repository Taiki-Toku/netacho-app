import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { App } from '../App.tsx'
import type { LoadedData } from '../data/source.ts'
import { freshUserStore, waitForHeading } from '../test/renderApp.tsx'
import { baseSample } from '../test/sampleData.ts'

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

/** 一番上で dy だけ下へ引く(まだ離さない) */
function pull(dy: number) {
  touch('touchstart', 200, 100)
  touch('touchmove', 200, 100 + dy / 2)
  touch('touchmove', 200, 100 + dy)
}

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

/** 引っぱって更新の表示(role="status" のうち、トーストではないもの) */
function indicator(): HTMLElement {
  const found = screen.getAllByRole('status').find((element) => element.hasAttribute('data-phase'))
  if (found === undefined) throw new Error('引っぱって更新の表示がありません')
  return found
}

/** トーストの文が出るまで待ち、その領域(role="status"、aria-live="polite")を返す */
async function toastWith(text: string): Promise<HTMLElement> {
  const element = await screen.findByText(text)
  expect(element).toHaveAttribute('role', 'status')
  expect(element).toHaveAttribute('aria-live', 'polite')
  expect(element).not.toHaveAttribute('data-phase')
  return element
}

describe('引っぱって更新の表示(依頼 13-2、詳細設計 5.5.2)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.location.hash = ''
  })

  it('TST-RF-03 引いている間「離すと更新」、更新中「更新中…」(aria-live="polite")。成功のトースト「最新に更新しました」', async () => {
    const second = deferred<LoadedData>()
    const app = renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => second.promise])
    await waitForHeading('架空:一回目の見出し')
    expect(indicator()).toHaveAttribute('aria-live', 'polite')
    expect(indicator()).toHaveTextContent(/^$/)

    pull(30)
    expect(indicator()).toHaveTextContent('離すと更新')
    pull(80)
    expect(indicator()).toHaveTextContent('離すと更新')
    touch('touchend', 0, 0)
    expect(indicator()).toHaveTextContent('更新中…')
    expect(app.calls()).toBe(2)

    // TST-RF-02 更新中も今の画面・URL のまま(読み込み中にしない)
    expect(screen.getByRole('heading', { level: 1, name: '架空:一回目の見出し' })).toBeInTheDocument()
    expect(screen.queryByText('読み込み中')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/item/2026-01-02-01')

    await act(async () => {
      second.resolve(dataNamed('架空:二回目の見出し'))
      await second.promise
    })
    // 同じ画面・同じ URL のまま、データだけが差し替わる
    expect(await waitForHeading('架空:二回目の見出し')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/item/2026-01-02-01')
    await toastWith('最新に更新しました')
    expect(indicator()).toHaveTextContent(/^$/)
  })

  it('TST-RF-02 引っぱって更新に失敗したら、今のデータのままトースト「最新に更新できませんでした」', async () => {
    renderWith([() => Promise.resolve(dataNamed('架空:一回目の見出し')), () => Promise.reject(new Error('Failed to fetch'))])
    await waitForHeading('架空:一回目の見出し')
    pull(80)
    await act(async () => {
      touch('touchend', 0, 0)
      await Promise.resolve()
    })
    await toastWith('最新に更新できませんでした')
    expect(screen.getByRole('heading', { level: 1, name: '架空:一回目の見出し' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('TST-RF-02 開き直し(30 分以上)の裏の読み直しでも、画面を読み込み中にせず、成功でデータを差し替える', async () => {
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
    // 裏の読み直しでは「更新中…」を出さない(引っぱったときだけ)
    expect(indicator()).toHaveTextContent(/^$/)
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
    pull(80)
    touch('touchend', 0, 0)
    expect(indicator()).toHaveTextContent(/^$/)
    expect(app.calls()).toBe(1)
  })
})
