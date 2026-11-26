import { describe, expect, it } from 'vitest'
import { ITEM_COLUMNS, rowsToItems, rowToItem } from './itemRow.ts'

const row = {
  id: '2026-11-17-01',
  date: '2026-11-17',
  sort_order: 3,
  slot: 'トップ',
  genre: 'agent',
  title: '架空の見出し',
  lead: 'リード',
  summary: '要約',
  points: ['要点1', '要点2'],
  excerpt: '抜粋',
  tryit: '試す',
  caution: '注意',
  categories: ['c'],
  projects: ['p'],
  tags: ['t'],
  source_url: 'https://example.com/a',
  source_title: '出典',
  trust: '一次情報',
  star_hot: 4,
  star_use: 2,
  star_fun: 5,
}

describe('items の行の変換', () => {
  it('列名を今のネタの型に置き換え、評価・状態・メモは空にする', () => {
    expect(rowToItem(row)).toEqual({
      id: '2026-11-17-01',
      date: '2026-11-17',
      order: 3,
      slot: 'トップ',
      genre: 'agent',
      title: '架空の見出し',
      lead: 'リード',
      summary: '要約',
      points: ['要点1', '要点2'],
      excerpt: '抜粋',
      tryit: '試す',
      caution: '注意',
      categories: ['c'],
      projects: ['p'],
      tags: ['t'],
      sourceUrl: 'https://example.com/a',
      sourceTitle: '出典',
      trust: '一次情報',
      stars: { hot: 4, use: 2, fun: 5 },
      rating: '',
      status: '',
      memo: '',
      // 依頼 13-1 で足した項目(published_at の無い行は公開日不明 = 空)
      publishedAt: '',
    })
  })

  it('source_url が null なら空文字、points が空なら空の配列、genre が null なら未分類(null)', () => {
    const item = rowToItem({ ...row, source_url: null, points: [], genre: null })
    expect(item?.sourceUrl).toBe('')
    expect(item?.points).toEqual([])
    expect(item?.genre).toBeNull()
  })

  it('形にならない行は捨て、同じ id は先の行を残す', () => {
    const items = rowsToItems([row, { ...row, title: '重複' }, { ...row, id: '2026-11-17-02', date: null }, 'x'])
    expect(items.map((i) => i.title)).toEqual(['架空の見出し'])
    expect(rowsToItems(null)).toEqual([])
  })

  it('TST-IMG-01 image_url が値なら imageUrl になり、null・空文字なら imageUrl の項目が無い', () => {
    expect(rowToItem({ ...row, image_url: 'https://example.com/a.png' })?.imageUrl).toBe('https://example.com/a.png')
    expect(rowToItem({ ...row, image_url: null })).not.toHaveProperty('imageUrl')
    expect(rowToItem({ ...row, image_url: '' })).not.toHaveProperty('imageUrl')
  })

  it('TST-IMG-02 items の問い合わせの select に渡す列に image_url が入っている', () => {
    expect(ITEM_COLUMNS.split(',')).toContain('image_url')
  })

  it('TST-PUB-01 published_at が YYYY-MM-DD なら publishedAt になり、null・空・形の違う値は空(行は捨てない)', () => {
    expect(rowToItem({ ...row, published_at: '2026-11-17' })?.publishedAt).toBe('2026-11-17')
    for (const bad of [null, undefined, '', '2026-11-17T09:00:00Z', '2026/11/17', '2026-02-30', '2026-13-01', 20261117]) {
      const item = rowToItem({ ...row, published_at: bad })
      expect(item?.id).toBe('2026-11-17-01')
      expect(item?.publishedAt).toBe('')
    }
  })

  it('TST-PUB-01 items の問い合わせの select に渡す列に published_at が入っている', () => {
    expect(ITEM_COLUMNS.split(',')).toContain('published_at')
  })
})
