import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { PULL_MAX, PULL_THRESHOLD, usePullToRefresh } from './usePullToRefresh.ts'

type TouchType = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'

/** jsdom は Touch を持たないため、素の Event に touches を付けて流す。touchmove は止められる(cancelable)ようにする */
function touch(target: Element, type: TouchType, x: number, y: number, fingers = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'touchmove' })
  const point = { clientX: x, clientY: y }
  const touches = type === 'touchstart' || type === 'touchmove' ? Array.from({ length: fingers }, () => point) : []
  Object.defineProperty(event, 'touches', { value: touches })
  Object.defineProperty(event, 'changedTouches', { value: [point] })
  fireEvent(target, event)
  return event
}

/** (0, 0) 起点で、指を置いて (dx, dy) まで2回に分けて動かす。touchmove の2回目のイベントを返す */
function drag(target: Element, dx: number, dy: number): Event {
  touch(target, 'touchstart', 200, 100)
  touch(target, 'touchmove', 200 + dx / 2, 100 + dy / 2)
  return touch(target, 'touchmove', 200 + dx, 100 + dy)
}

function lift(target: Element) {
  touch(target, 'touchend', 0, 0)
}

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true, writable: true })
}

function Harness({ onRefresh, enabled = true }: { onRefresh: () => Promise<unknown>; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const phase = usePullToRefresh(ref, { enabled, onRefresh })
  return (
    <div>
      <div ref={ref} data-testid="indicator" data-phase={phase} />
      <p data-testid="page">ページ</p>
      <textarea aria-label="メモ" />
    </div>
  )
}

function indicator(): HTMLElement {
  return screen.getByTestId('indicator')
}

function page(): HTMLElement {
  return screen.getByTestId('page')
}

describe('usePullToRefresh(依頼 13-2、詳細設計 5.5.2)', () => {
  beforeEach(() => {
    setScrollY(0)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setScrollY(0)
  })

  it(`TST-RF-03 一番上で ${PULL_THRESHOLD}px 以上引いて離すと onRefresh を呼び、終わるまで refreshing`, async () => {
    let finish: () => void = () => undefined
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<Harness onRefresh={onRefresh} />)
    const move = drag(page(), 0, PULL_THRESHOLD)
    // 引いている間は、iPhone の弾みと重ねないよう touchmove を止める
    expect(move.defaultPrevented).toBe(true)
    expect(indicator()).toHaveAttribute('data-phase', 'armed')
    expect(indicator().style.getPropertyValue('--pull-y')).toBe(`${PULL_THRESHOLD}px`)
    lift(page())
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(indicator()).toHaveAttribute('data-phase', 'refreshing')
    // 離したら位置の指定は残さない(高さは CSS が決める)
    expect(indicator().style.getPropertyValue('--pull-y')).toBe('')
    // 更新中にもう一度引いても、2回目は呼ばない
    drag(page(), 0, PULL_MAX)
    lift(page())
    expect(onRefresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
  })

  it(`TST-RF-03 引いた量は最大 ${PULL_MAX}px。届かないうちは pulling`, () => {
    render(<Harness onRefresh={vi.fn(() => Promise.resolve())} />)
    drag(page(), 0, 30)
    expect(indicator()).toHaveAttribute('data-phase', 'pulling')
    expect(indicator().style.getPropertyValue('--pull-y')).toBe('30px')
    touch(page(), 'touchmove', 200, 100 + 300)
    expect(indicator().style.getPropertyValue('--pull-y')).toBe(`${PULL_MAX}px`)
    touch(page(), 'touchcancel', 0, 0)
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
    expect(indicator().style.getPropertyValue('--pull-y')).toBe('')
  })

  it(`TST-RF-03 ${PULL_THRESHOLD}px 未満で離したら呼ばずに戻す`, () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    drag(page(), 0, PULL_THRESHOLD - 1)
    lift(page())
    expect(onRefresh).not.toHaveBeenCalled()
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
    expect(indicator().style.getPropertyValue('--pull-y')).toBe('')
  })

  it('TST-RF-03 一番上でないときは始めない(ふだんのスクロールを止めない)', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    setScrollY(1)
    const move = drag(page(), 0, PULL_MAX)
    expect(move.defaultPrevented).toBe(false)
    lift(page())
    expect(onRefresh).not.toHaveBeenCalled()
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
  })

  it('TST-RF-03 横向き(詳細の左右のスワイプ)・上向きの動きでは何もしない', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    // 最初の約 10px で横と決まったら、そのあと下へ引いても始めない
    touch(page(), 'touchstart', 200, 100)
    const first = touch(page(), 'touchmove', 200 - 20, 100 + 5)
    const later = touch(page(), 'touchmove', 200 - 20, 100 + PULL_MAX)
    lift(page())
    expect(first.defaultPrevented).toBe(false)
    expect(later.defaultPrevented).toBe(false)
    // 上向き(ページを下へ送る)
    const up = drag(page(), 0, -PULL_MAX)
    lift(page())
    expect(up.defaultPrevented).toBe(false)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(indicator()).toHaveAttribute('data-phase', 'idle')
  })

  it('TST-RF-03 縦か横か決まる前(10px 未満)は止めない。2本の指・入力欄の中・enabled が false では始めない', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    const { rerender } = render(<Harness onRefresh={onRefresh} />)
    touch(page(), 'touchstart', 200, 100)
    expect(touch(page(), 'touchmove', 200, 105).defaultPrevented).toBe(false)
    lift(page())

    touch(page(), 'touchstart', 200, 100, 2)
    expect(touch(page(), 'touchmove', 200, 100 + PULL_MAX, 2).defaultPrevented).toBe(false)
    lift(page())

    const memo = screen.getByLabelText('メモ')
    expect(drag(memo, 0, PULL_MAX).defaultPrevented).toBe(false)
    lift(memo)

    rerender(<Harness onRefresh={onRefresh} enabled={false} />)
    expect(drag(page(), 0, PULL_MAX).defaultPrevented).toBe(false)
    lift(page())
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('TST-RF-03 touchmove は passive: false で登録し、外すときに必ず解除する', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Harness onRefresh={vi.fn(() => Promise.resolve())} />)
    const moveCall = add.mock.calls.find(([type]) => type === 'touchmove')
    expect(moveCall?.[2]).toEqual({ passive: false })
    const handler = moveCall?.[1]
    unmount()
    expect(remove.mock.calls.some(([type, listener]) => type === 'touchmove' && listener === handler)).toBe(true)
    for (const type of ['touchstart', 'touchend', 'touchcancel']) {
      const added = add.mock.calls.find(([name]) => name === type)?.[1]
      expect(remove.mock.calls.some(([name, listener]) => name === type && listener === added)).toBe(true)
    }
    add.mockRestore()
    remove.mockRestore()
  })

  it('TST-RF-04 動きを減らす設定では、表示を動かさない(--pull-y を付けない)。引いて離せば更新はできる', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    const move = drag(page(), 0, PULL_MAX)
    expect(move.defaultPrevented).toBe(true)
    expect(indicator()).toHaveAttribute('data-phase', 'armed')
    expect(indicator().style.getPropertyValue('--pull-y')).toBe('')
    lift(page())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
