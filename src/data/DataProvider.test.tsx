import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../components/Toast.tsx'
import { baseSample } from '../test/sampleData.ts'
import { DataProvider, STALE_AFTER_MS, useData, useRefreshData, type RefreshResult } from './DataProvider.tsx'
import type { LoadedData } from './source.ts'

// 読み込むたびに中身が分かるよう、ネタの1本目の見出しだけを変えた見本(架空)
function dataNamed(title: string): LoadedData {
  const [first, ...rest] = baseSample.items
  if (first === undefined) throw new Error('見本のネタがありません')
  return { ...baseSample, items: [{ ...first, title }, ...rest] }
}

/** 外から解決・失敗を決められる約束 */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((ok, ng) => {
    resolve = ok
    reject = ng
  })
  return { promise, resolve, reject }
}

let lastRefresh: Promise<RefreshResult> | null = null

/** 今の状態を文字で出す。ボタンで refresh を呼ぶ */
function Probe() {
  const state = useData()
  const refresh = useRefreshData()
  return (
    <div>
      <p data-testid="state">
        {state.status === 'ready'
          ? `ready:${state.data.items[0]?.title ?? ''}:${state.loadedAt.getTime()}:${state.refreshing ? 'refreshing' : 'idle'}`
          : state.status}
      </p>
      <button
        type="button"
        onClick={() => {
          lastRefresh = refresh()
        }}
      >
        refresh
      </button>
    </div>
  )
}

let visibility: DocumentVisibilityState = 'visible'
const START = Date.UTC(2026, 10, 27, 0, 0, 0)
let clock = START

function setup(loads: (() => Promise<LoadedData>)[]) {
  let calls = 0
  const load = () => {
    const next = loads[calls] ?? loads[loads.length - 1]
    calls += 1
    if (next === undefined) throw new Error('読み込みの見本がありません')
    return next()
  }
  render(
    <ToastProvider>
      <DataProvider load={load} now={() => new Date(clock)}>
        <Probe />
      </DataProvider>
    </ToastProvider>,
  )
  return { calls: () => calls }
}

function stateText(): string {
  return screen.getByTestId('state').textContent
}

async function becomeVisible() {
  visibility = 'hidden'
  fireEvent(document, new Event('visibilitychange'))
  visibility = 'visible'
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'))
    await Promise.resolve()
  })
}

async function pageShow(persisted: boolean) {
  const event = new Event('pageshow')
  Object.defineProperty(event, 'persisted', { value: persisted })
  await act(async () => {
    window.dispatchEvent(event)
    await Promise.resolve()
  })
}

describe('DataProvider の開き直しの読み直し(依頼 13-2、詳細設計 5.5.1)', () => {
  beforeEach(() => {
    visibility = 'visible'
    clock = START
    lastRefresh = null
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  })
  afterEach(() => {
    // jsdom の既定(visibilityState は prototype の getter)に戻す
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('TST-RF-01 表示に戻ったとき、loadedAt から 30 分以上なら裏で読み直し、未満なら読まない', async () => {
    const probe = setup([() => Promise.resolve(dataNamed('一回目')), () => Promise.resolve(dataNamed('二回目'))])
    await screen.findByText(`ready:一回目:${START}:idle`)
    expect(probe.calls()).toBe(1)

    // 29 分 59 秒:まだ読まない
    clock = START + STALE_AFTER_MS - 1000
    await becomeVisible()
    expect(probe.calls()).toBe(1)

    // 30 分ちょうど:読み直す。成功したら loadedAt も今の時刻になる
    clock = START + STALE_AFTER_MS
    await becomeVisible()
    expect(probe.calls()).toBe(2)
    await screen.findByText(`ready:二回目:${START + STALE_AFTER_MS}:idle`)
  })

  it('TST-RF-01 非表示になっただけ(visible に戻らない)では読まない', async () => {
    const probe = setup([() => Promise.resolve(dataNamed('一回目'))])
    await screen.findByText(`ready:一回目:${START}:idle`)
    clock = START + STALE_AFTER_MS * 3
    visibility = 'hidden'
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(probe.calls()).toBe(1)
  })

  it('TST-RF-01 pageshow の persisted が true で 30 分以上なら読み直す。persisted が false・30 分未満なら読まない', async () => {
    const probe = setup([() => Promise.resolve(dataNamed('一回目')), () => Promise.resolve(dataNamed('二回目'))])
    await screen.findByText(`ready:一回目:${START}:idle`)

    clock = START + STALE_AFTER_MS
    await pageShow(false)
    expect(probe.calls()).toBe(1)

    clock = START + STALE_AFTER_MS - 1
    await pageShow(true)
    expect(probe.calls()).toBe(1)

    clock = START + STALE_AFTER_MS
    await pageShow(true)
    expect(probe.calls()).toBe(2)
    await screen.findByText(`ready:二回目:${START + STALE_AFTER_MS}:idle`)
  })

  it('TST-RF-01 読み込み中・エラーの間は、表示に戻っても読み直さない', async () => {
    const first = deferred<LoadedData>()
    const probe = setup([() => first.promise])
    clock = START + STALE_AFTER_MS * 2
    await becomeVisible()
    expect(stateText()).toBe('loading')
    expect(probe.calls()).toBe(1)
  })

  it('TST-RF-02 裏の読み直しの間も今のデータが出たまま(読み込み中にならない)。読み直し中の2回目は始まらない', async () => {
    const second = deferred<LoadedData>()
    const probe = setup([() => Promise.resolve(dataNamed('一回目')), () => second.promise])
    await screen.findByText(`ready:一回目:${START}:idle`)

    clock = START + STALE_AFTER_MS
    await becomeVisible()
    expect(probe.calls()).toBe(2)
    // 今のデータのまま、refreshing だけが立つ
    expect(stateText()).toBe(`ready:一回目:${START}:refreshing`)

    // もう一度表示に戻っても、ボタン(引っぱって更新と同じ refresh)を押しても、2本目は始めない
    await becomeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(probe.calls()).toBe(2)

    clock = START + STALE_AFTER_MS + 5000
    await act(async () => {
      second.resolve(dataNamed('二回目'))
      await second.promise
    })
    expect(stateText()).toBe(`ready:二回目:${START + STALE_AFTER_MS + 5000}:idle`)
    // 2回目に呼んだ側も、同じ1本の結果を受け取る
    await expect(lastRefresh).resolves.toBe('updated')
  })

  it('TST-RF-02 失敗したら今のデータのまま、トースト「最新に更新できませんでした」', async () => {
    const probe = setup([() => Promise.resolve(dataNamed('一回目')), () => Promise.reject(new Error('Failed to fetch'))])
    await screen.findByText(`ready:一回目:${START}:idle`)
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await act(async () => {
      await lastRefresh
    })
    await expect(lastRefresh).resolves.toBe('failed')
    expect(probe.calls()).toBe(2)
    // データも loadedAt も変わらない
    expect(stateText()).toBe(`ready:一回目:${START}:idle`)
    expect(screen.getByRole('status')).toHaveTextContent('最新に更新できませんでした')
    // 失敗のあとは、次の読み直しを始められる
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(probe.calls()).toBe(3)
    await act(async () => {
      await lastRefresh
    })
  })

  it('TST-RF-02 refresh で成功したら、データと loadedAt を差し替える(30 分の判定は refresh には無い)', async () => {
    setup([() => Promise.resolve(dataNamed('一回目')), () => Promise.resolve(dataNamed('二回目'))])
    await screen.findByText(`ready:一回目:${START}:idle`)
    clock = START + 1000
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await act(async () => {
      await lastRefresh
    })
    expect(stateText()).toBe(`ready:二回目:${START + 1000}:idle`)
  })
})
