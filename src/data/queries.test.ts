import { describe, expect, it } from 'vitest'
import { broadcastDates, feedOfKinds, feedProducts, findItem, itemsInGenre, itemsOnDate, latestDate, neighbors } from './queries.ts'
import { parseItems } from './parse.ts'
import { fixtureData } from './source.ts'
import sampleItems from '../../fixtures/sample-items.json'

// 基本の見本(9 本)。日付・順番の試験は、この小さな組で読みやすく書く
const items = parseItems(sampleItems)
// 追加の見本とフィードを含む一式(15 本 + 13 本)。ジャンルとフィードの試験に使う
const all = fixtureData()

describe('queries', () => {
  it('最新の放送日を返す。空なら null', () => {
    expect(latestDate(items)).toBe('2026-01-02')
    expect(latestDate(all.items)).toBe('2026-01-03')
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
    expect(broadcastDates(all.items)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01'])
  })

  it('ジャンルのネタを新しい順(同じ日は order 順)に返す。無いジャンルは空', () => {
    expect(itemsInGenre(all.items, 'security-news').map((i) => i.id)).toEqual([
      '2026-01-03-01',
      '2026-01-03-02',
      '2026-01-03-03',
      '2026-01-03-04',
      '2026-01-02-06',
    ])
    expect(itemsInGenre(all.items, 'work').map((i) => i.id)).toEqual(['2026-01-03-06', '2026-01-02-01', '2026-01-01-01'])
    expect(itemsInGenre(all.items, 'vuln')).toEqual([])
  })

  it('フィードを種類で絞り、新しい順に返す', () => {
    expect(feedOfKinds(all.feed, ['outage']).map((e) => e.id)).toEqual(['feed-011', 'feed-012', 'feed-013'])
    expect(feedOfKinds(all.feed, ['vuln']).map((e) => e.id)).toEqual(['feed-007', 'feed-008', 'feed-009', 'feed-010'])
    expect(feedOfKinds(all.feed, ['release', 'eol', 'change', 'exam']).map((e) => e.id)).toEqual([
      'feed-001',
      'feed-002',
      'feed-003',
      'feed-004',
      'feed-005',
      'feed-006',
    ])
  })

  it('フィードの製品名を重複なく名前順で返す', () => {
    const products = feedProducts(feedOfKinds(all.feed, ['release', 'eol', 'change', 'exam']))
    expect(products).toHaveLength(5)
    expect(new Set(products).size).toBe(5)
    expect(products).toContain('サンプルOS Server')
    expect(feedProducts([])).toEqual([])
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
