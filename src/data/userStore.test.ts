import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalUserStore } from './userStore.ts'

describe('userStore(保存・評価・メモの置き場。いまは localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('保存の付け外しと、評価・メモを持ち、localStorage に書く', () => {
    const store = createLocalUserStore(window.localStorage)
    expect(store.getState()).toEqual({ saved: [], feedback: {} })
    expect(store.toggleSaved('a')).toBe(true)
    expect(store.toggleSaved('b')).toBe(true)
    expect(store.toggleSaved('a')).toBe(false)
    store.setRating('b', 'good')
    store.setMemo('b', 'めも')
    store.setRating('b', '')
    expect(store.getState()).toEqual({ saved: ['b'], feedback: { b: { rating: '', memo: 'めも' } } })
    // 別のインスタンスでも同じ中身を読める(再読み込み相当)
    expect(createLocalUserStore(window.localStorage).getState()).toEqual(store.getState())
  })

  it('変わるたびに購読者に知らせ、状態のオブジェクトは変わったときだけ入れ替わる', () => {
    const store = createLocalUserStore(window.localStorage)
    let count = 0
    const stop = store.subscribe(() => {
      count += 1
    })
    const before = store.getState()
    store.toggleSaved('a')
    expect(count).toBe(1)
    expect(store.getState()).not.toBe(before)
    expect(store.getState()).toBe(store.getState())
    stop()
    store.toggleSaved('a')
    expect(count).toBe(1)
  })

  it('壊れた・形の合わない保存データは捨てて空から始める。知らない評価は捨てる', () => {
    window.localStorage.setItem('nodal-user', '{oops')
    expect(createLocalUserStore(window.localStorage).getState()).toEqual({ saved: [], feedback: {} })
    window.localStorage.setItem(
      'nodal-user',
      JSON.stringify({ saved: ['a', 7, 'a'], feedback: { a: { rating: 'love', memo: 3 }, b: 'x', c: { rating: 'hot' } } }),
    )
    expect(createLocalUserStore(window.localStorage).getState()).toEqual({ saved: ['a'], feedback: { a: {}, c: { rating: 'hot' } } })
    // オブジェクトの仕組みに使われる名前の id は捨てる
    window.localStorage.setItem('nodal-user', '{"feedback":{"__proto__":{"memo":"x"},"constructor":{"memo":"y"}}}')
    const state = createLocalUserStore(window.localStorage).getState()
    expect(Object.keys(state.feedback)).toEqual([])
    expect(Object.getPrototypeOf(state.feedback)).toBe(Object.prototype)
  })

  it('localStorage が無くても落ちない(画面の中だけで持つ)', () => {
    const store = createLocalUserStore(null)
    expect(store.toggleSaved('a')).toBe(true)
    expect(store.getState().saved).toEqual(['a'])
  })
})
