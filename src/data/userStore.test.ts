import { beforeEach, describe, expect, it } from 'vitest'
import { countUserData, createLocalUserStore } from './userStore.ts'

/** 前の版で付けた評価・メモが残っている端末(架空の値) */
function seedLegacyFeedback() {
  window.localStorage.setItem('nodal-user', JSON.stringify({ saved: [], feedback: { b: { rating: 'good', memo: '架空のめも' } } }))
}

describe('userStore(保存と、前の版の評価・メモの置き場。いまは localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('保存の付け外しを localStorage に書く。評価・メモを付ける関数は無い', () => {
    const store = createLocalUserStore(window.localStorage)
    expect(store.getState()).toEqual({ saved: [], feedback: {} })
    expect(store.toggleSaved('a')).toBe(true)
    expect(store.toggleSaved('b')).toBe(true)
    expect(store.toggleSaved('a')).toBe(false)
    expect(store.getState()).toEqual({ saved: ['b'], feedback: {} })
    // 別のインスタンスでも同じ中身を読める(再読み込み相当)
    expect(createLocalUserStore(window.localStorage).getState()).toEqual(store.getState())
    expect(Object.keys(store)).not.toContain('setRating')
    expect(Object.keys(store)).not.toContain('setMemo')
  })

  it('TST-DETAIL-03 保存の付け外しの後も、前の版の評価・メモ(feedback)が端末に残る', () => {
    seedLegacyFeedback()
    const store = createLocalUserStore(window.localStorage)
    store.toggleSaved('a')
    store.toggleSaved('a')
    store.toggleSaved('c')
    const written = JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}') as unknown
    expect(written).toEqual({ saved: ['c'], feedback: { b: { rating: 'good', memo: '架空のめも' } } })
    expect(createLocalUserStore(window.localStorage).getState().feedback).toEqual({ b: { rating: 'good', memo: '架空のめも' } })
  })

  it('TST-DETAIL-03 件数は保存と、前の版の評価・メモ(外した評価・空白だけのメモは数えない)', () => {
    expect(
      countUserData({
        saved: ['a', 'b'],
        feedback: { a: { rating: 'hot', memo: '架空' }, b: { rating: '' }, c: { memo: '  ' }, d: { memo: '架空' } },
      }),
    ).toEqual({ saved: 2, legacyFeedback: 3 })
    expect(countUserData({ saved: [], feedback: { a: { rating: '' } } })).toEqual({ saved: 0, legacyFeedback: 0 })
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
  it('clear で保存と前の版の評価・メモを空にし、このアプリのキー(nodal-user)だけを消して購読者に知らせる', () => {
    window.localStorage.setItem('sb-example-auth-token', 'session')
    seedLegacyFeedback()
    const store = createLocalUserStore(window.localStorage)
    store.toggleSaved('a')
    expect(countUserData(store.getState())).toEqual({ saved: 1, legacyFeedback: 2 })
    let count = 0
    store.subscribe(() => {
      count += 1
    })
    store.clear()
    expect(count).toBe(1)
    expect(store.getState()).toEqual({ saved: [], feedback: {} })
    expect(countUserData(store.getState())).toEqual({ saved: 0, legacyFeedback: 0 })
    expect(window.localStorage.getItem('nodal-user')).toBeNull()
    expect(window.localStorage.getItem('sb-example-auth-token')).toBe('session')
  })
})
