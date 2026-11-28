import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { PULL_RESISTANCE, PULL_THRESHOLD, pullDistance, usePullToRefresh } from './usePullToRefresh.ts'

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

/** 指を置いて (dx, dy) まで2回に分けて動かす。touchmove の2回目のイベントを返す */
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

// 表示の量が 64px になる指の量は 94.1…px(R = 200)。その前後の整数
const BELOW = 94
const ABOVE = 95

function Harness({ onRefresh, enabled = true }: { onRefresh: () => Promise<unknown>; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const { phase, distance } = usePullToRefresh(ref, { enabled, onRefresh })
  return (
    <div ref={ref} data-testid="area">
      <p data-testid="state" data-phase={phase} data-distance={distance} />
      <p data-testid="page">ページ</p>
      <textarea aria-label="入力欄" />
    </div>
  )
}

function area(): HTMLElement {
  return screen.getByTestId('area')
}

function state(): HTMLElement {
  return screen.getByTestId('state')
}

function page(): HTMLElement {
  return screen.getByTestId('page')
}

/** .pullArea の --pull-y と data-pull */
function pull(): { y: string; mode: string | null } {
  return { y: area().style.getPropertyValue('--pull-y'), mode: area().getAttribute('data-pull') }
}

describe('usePullToRefresh(依頼 15-1、詳細設計 5.7.2。始め方は 5.5.2)', () => {
  beforeEach(() => {
    setScrollY(0)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setScrollY(0)
  })

  it('TST-PTR-01 重さの式:表示の量 = R ×(1 − 1 /(1 + 引いた量 / R))、R = 200px。越えない', () => {
    expect(PULL_RESISTANCE).toBe(200)
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(-30)).toBe(0)
    expect(pullDistance(200)).toBeCloseTo(100)
    expect(pullDistance(600)).toBeCloseTo(150)
    expect(pullDistance(BELOW)).toBeLessThan(PULL_THRESHOLD)
    expect(pullDistance(ABOVE)).toBeGreaterThanOrEqual(PULL_THRESHOLD)
    expect(pullDistance(100000)).toBeLessThan(PULL_RESISTANCE)
  })

  it(`TST-PTR-01 表示の量 ${PULL_THRESHOLD}px 以上で離すと onRefresh を呼び、終わるまで refreshing。--pull-y は引っぱり中・更新中だけ付く`, async () => {
    let finish: () => void = () => undefined
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<Harness onRefresh={onRefresh} />)
    // 引く前は何も付けない(transform の元が無い)
    expect(pull()).toEqual({ y: '', mode: null })
    const move = drag(page(), 0, ABOVE)
    // 引いている間は、iPhone の弾みと重ねないよう touchmove を止める
    expect(move.defaultPrevented).toBe(true)
    expect(state()).toHaveAttribute('data-phase', 'armed')
    expect(pull()).toEqual({ y: `${pullDistance(ABOVE)}px`, mode: 'pulling' })
    lift(page())
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(state()).toHaveAttribute('data-phase', 'refreshing')
    // 更新中は --sp-13 の高さで止める
    expect(pull()).toEqual({ y: 'var(--sp-13)', mode: 'refreshing' })
    // 更新中にもう一度引いても、2回目は呼ばない。止めた高さもそのまま
    drag(page(), 0, ABOVE * 2)
    lift(page())
    touch(page(), 'touchcancel', 0, 0)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(pull()).toEqual({ y: 'var(--sp-13)', mode: 'refreshing' })
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(state()).toHaveAttribute('data-phase', 'idle')
    expect(pull()).toEqual({ y: '', mode: null })
  })

  it('TST-PTR-01 届かないうちは pulling。指を戻せば量も戻る。touchcancel で外す', () => {
    render(<Harness onRefresh={vi.fn(() => Promise.resolve())} />)
    drag(page(), 0, 40)
    expect(state()).toHaveAttribute('data-phase', 'pulling')
    expect(Number(state().getAttribute('data-distance'))).toBeCloseTo(pullDistance(40))
    expect(pull().mode).toBe('pulling')
    touch(page(), 'touchmove', 200, 100 + 400)
    expect(state()).toHaveAttribute('data-phase', 'armed')
    touch(page(), 'touchmove', 200, 100 + 20)
    expect(state()).toHaveAttribute('data-phase', 'pulling')
    touch(page(), 'touchcancel', 0, 0)
    expect(state()).toHaveAttribute('data-phase', 'idle')
    expect(pull()).toEqual({ y: '', mode: null })
  })

  it(`TST-PTR-01 表示の量 ${PULL_THRESHOLD}px 未満で離したら呼ばずに戻す`, () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    drag(page(), 0, BELOW)
    expect(state()).toHaveAttribute('data-phase', 'pulling')
    lift(page())
    expect(onRefresh).not.toHaveBeenCalled()
    expect(state()).toHaveAttribute('data-phase', 'idle')
    expect(pull()).toEqual({ y: '', mode: null })
  })

  it('TST-PTR-01 一番上でないときは始めない(ふだんのスクロールを止めない)', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    setScrollY(1)
    const move = drag(page(), 0, ABOVE * 2)
    expect(move.defaultPrevented).toBe(false)
    lift(page())
    expect(onRefresh).not.toHaveBeenCalled()
    expect(state()).toHaveAttribute('data-phase', 'idle')
    expect(pull()).toEqual({ y: '', mode: null })
  })

  it('TST-PTR-01 横向き(詳細の左右のスワイプ)・上向きの動きでは呼ばない', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    render(<Harness onRefresh={onRefresh} />)
    // 最初の約 10px で横と決まったら、そのあと下へ引いても始めない
    touch(page(), 'touchstart', 200, 100)
    const first = touch(page(), 'touchmove', 200 - 20, 100 + 5)
    const later = touch(page(), 'touchmove', 200 - 20, 100 + ABOVE * 2)
    lift(page())
    expect(first.defaultPrevented).toBe(false)
    expect(later.defaultPrevented).toBe(false)
    // 上向き(ページを下へ送る)
    const up = drag(page(), 0, -ABOVE)
    lift(page())
    expect(up.defaultPrevented).toBe(false)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(state()).toHaveAttribute('data-phase', 'idle')
    expect(pull()).toEqual({ y: '', mode: null })
  })

  it('TST-PTR-01 縦か横か決まる前(10px 未満)は止めない。2本の指・入力欄の中・enabled が false では始めない', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    const { rerender } = render(<Harness onRefresh={onRefresh} />)
    touch(page(), 'touchstart', 200, 100)
    expect(touch(page(), 'touchmove', 200, 105).defaultPrevented).toBe(false)
    lift(page())

    touch(page(), 'touchstart', 200, 100, 2)
    expect(touch(page(), 'touchmove', 200, 100 + ABOVE, 2).defaultPrevented).toBe(false)
    lift(page())

    const input = screen.getByLabelText('入力欄')
    expect(drag(input, 0, ABOVE).defaultPrevented).toBe(false)
    lift(input)

    rerender(<Harness onRefresh={onRefresh} enabled={false} />)
    expect(drag(page(), 0, ABOVE).defaultPrevented).toBe(false)
    lift(page())
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('TST-PTR-01 touchmove は passive: false で登録し、外すときに必ず解除する', () => {
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

  it('TST-PTR-03 動きを減らす設定では、画面を動かさない(--pull-y も data-pull も付けない)。量は数え、引いて離せば更新はできる', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    let finish: () => void = () => undefined
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<Harness onRefresh={onRefresh} />)
    const move = drag(page(), 0, ABOVE)
    expect(move.defaultPrevented).toBe(true)
    expect(state()).toHaveAttribute('data-phase', 'armed')
    expect(Number(state().getAttribute('data-distance'))).toBeCloseTo(pullDistance(ABOVE))
    expect(pull()).toEqual({ y: '', mode: null })
    lift(page())
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(state()).toHaveAttribute('data-phase', 'refreshing')
    expect(pull()).toEqual({ y: '', mode: null })
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(state()).toHaveAttribute('data-phase', 'idle')
  })
})
