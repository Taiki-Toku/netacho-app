import { describe, expect, it } from 'vitest'
import { SCROLL_MEMORY_LIMIT, ScrollMemory } from './useScrollMemory.ts'

describe('ScrollMemory(戻ったら元の位置へ。詳細設計 5.7.3)', () => {
  it('TST-BACK-01 ハッシュ全体ごとに覚え、上限 50 件を越えたら古いものから捨てる。覚え直したものは新しい側へ', () => {
    expect(SCROLL_MEMORY_LIMIT).toBe(50)
    const memory = new ScrollMemory()
    for (let index = 0; index < SCROLL_MEMORY_LIMIT; index += 1) memory.remember(`#/search?q=${index}`, index)
    expect(memory.size).toBe(50)
    // 0 番を覚え直すと新しい側へ移り、次に捨てられるのは 1 番
    memory.remember('#/search?q=0', 999)
    memory.remember('#/home', 10)
    expect(memory.size).toBe(50)
    expect(memory.recall('#/search?q=0')).toBe(999)
    expect(memory.recall('#/search?q=1')).toBeUndefined()
    expect(memory.recall('#/search?q=2')).toBe(2)
    expect(memory.recall('#/home')).toBe(10)
    // 絞り込みが違えば別のもの
    memory.remember('#/genre/product', 100)
    memory.remember('#/genre/product?kind=release', 200)
    expect(memory.recall('#/genre/product')).toBe(100)
    expect(memory.recall('#/genre/product?kind=release')).toBe(200)
  })
})
