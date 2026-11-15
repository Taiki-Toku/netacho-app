import { describe, expect, it } from 'vitest'
import { broadcastDates, itemsOnDate, latestDate } from './queries.ts'
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
})
