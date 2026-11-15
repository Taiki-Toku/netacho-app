import { describe, expect, it } from 'vitest'
import { parseGenres, parseItem, parseItems } from './parse.ts'
import sampleItems from '../../fixtures/sample-items.json'
import genresJson from '../../fixtures/genres.json'

describe('parseItems(信用しないデータの整形)', () => {
  it('見本データは全件そのまま読める', () => {
    const items = parseItems(sampleItems)
    expect(items).toHaveLength(9)
    expect(items[0]?.title).toBe('架空:手順書の差分チェックを半自動にする')
    expect(items[0]?.stars).toEqual({ hot: 3, use: 5, fun: 2 })
  })

  it('配列でないもの、id や date が無いものは捨てる', () => {
    expect(parseItems(null)).toEqual([])
    expect(parseItems({ id: 'x' })).toEqual([])
    expect(parseItems([{ id: 'a' }, { date: '2026-01-01' }, 'text', 42])).toEqual([])
    expect(parseItems([{ id: 'a', date: '2026/01/01' }])).toEqual([])
  })

  it('項目の型が合わないときは空にし、星は 0〜5 の整数に丸める', () => {
    const item = parseItem({
      id: 'a',
      date: '2026-01-01',
      order: 'first',
      title: 123,
      tags: ['ok', 7, null],
      genre: '',
      stars: { hot: 9, use: -1, fun: 2.6 },
      rating: 'love',
      status: 'adopted',
    })
    expect(item).not.toBeNull()
    expect(item?.order).toBe(Number.MAX_SAFE_INTEGER)
    expect(item?.title).toBe('')
    expect(item?.tags).toEqual(['ok'])
    expect(item?.genre).toBeNull()
    expect(item?.stars).toEqual({ hot: 5, use: 0, fun: 3 })
    expect(item?.rating).toBe('')
    expect(item?.status).toBe('adopted')
  })

  it('同じ id は先のものを残す', () => {
    const items = parseItems([
      { id: 'a', date: '2026-01-01', title: '先' },
      { id: 'a', date: '2026-01-01', title: '後' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('先')
  })

  it('HTML や javascript: の文字列は、解釈せずそのまま持つ', () => {
    const item = parseItem({ id: 'a', date: '2026-01-01', title: '<b>x</b>', sourceUrl: 'javascript:alert(1)' })
    expect(item?.title).toBe('<b>x</b>')
    expect(item?.sourceUrl).toBe('javascript:alert(1)')
  })
})

describe('parseGenres', () => {
  it('fixtures のジャンルを sortOrder 順に読む', () => {
    const genres = parseGenres(genresJson)
    expect(genres.map((g) => g.id)).toEqual([
      'work',
      'agent',
      'local-llm',
      'security-news',
      'product',
      'vuln',
      'creative',
      'tools',
    ])
  })

  it('id か label が無いものは捨てる', () => {
    expect(parseGenres([{ id: 'x' }, { label: 'y' }, { id: 'z', label: 'Z', sortOrder: 1 }])).toEqual([
      { id: 'z', label: 'Z', sortOrder: 1 },
    ])
  })
})
