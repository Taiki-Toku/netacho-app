import { describe, expect, it } from 'vitest'
import { broadcastDates, findItem, itemsOnDate, latestDate, neighbors } from './queries.ts'
import { parseItems } from './parse.ts'
import sampleItems from '../../fixtures/sample-items.json'

const items = parseItems(sampleItems)

describe('queries', () => {
  it('最新の放送日を返す。空なら null', () => {
    expect(latestDate(items)).toBe('2026-01-02')
    expect(latestDate([])).toBeNull()
  })

  it('その日のネタを order 順に並べる', () => {
    expect(itemsOnDate(items, '2026-01-02').map((i) => i.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(itemsOnDate(items, '2026-01-01').map((i) => i.id)).toEqual(['2026-01-01-01', '2026-01-01-02'])
    expect(itemsOnDate(items, '2025-12-31')).toEqual([])
  })

  it('order が同じなら id 順', () => {
    const same = parseItems([
      { id: 'b', date: '2026-01-01', order: 1 },
      { id: 'a', date: '2026-01-01', order: 1 },
    ])
    expect(itemsOnDate(same, '2026-01-01').map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('放送日の一覧は新しい順', () => {
    expect(broadcastDates(items)).toEqual(['2026-01-02', '2026-01-01'])
  })

  it('id でネタを探す。無ければ null', () => {
    expect(findItem(items, '2026-01-02-03')?.order).toBe(3)
    expect(findItem(items, 'nowhere')).toBeNull()
  })

  it('同じ放送日の中で前後のネタを返す', () => {
    const first = findItem(items, '2026-01-02-01')!
    const middle = findItem(items, '2026-01-02-04')!
    const last = findItem(items, '2026-01-02-07')!
    expect(neighbors(items, first)).toMatchObject({ position: 1, total: 7, prev: null })
    expect(neighbors(items, first).next?.id).toBe('2026-01-02-02')
    expect(neighbors(items, middle).prev?.id).toBe('2026-01-02-03')
    expect(neighbors(items, middle).next?.id).toBe('2026-01-02-05')
    expect(neighbors(items, last)).toMatchObject({ position: 7, total: 7, next: null })
    // 前の日には進まない
    expect(neighbors(items, findItem(items, '2026-01-01-02')!).next).toBeNull()
  })
})
