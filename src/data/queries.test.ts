import { describe, expect, it } from 'vitest'
import {
  announcements,
  broadcastDates,
  countBySeverity,
  feedOfKinds,
  feedProducts,
  findFeedEntry,
  findItem,
  itemsInGenre,
  itemsOnDate,
  latestDate,
  neighbors,
  savedItems,
  searchFeed,
  searchItems,
  topVulnerability,
  vulnerabilities,
} from './queries.ts'
import { parseItems } from './parse.ts'
import { fixtureData } from './source.ts'
import sampleItems from '../../fixtures/sample-items.json'

// 基本の見本(9 本)。日付・順番の試験は、この小さな組で読みやすく書く
const items = parseItems(sampleItems)
// 追加の見本とフィードを含む一式(15 本 + 14 本)。ジャンルとフィードの試験に使う
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

  it('ジャンルの一覧(fixtures/genres.json)に「脆弱性」(vuln)は無い。脆弱性は公式情報の画面に一本化した', () => {
    expect(all.genres.map((g) => g.id)).toEqual(['work', 'agent', 'local-llm', 'security-news', 'product', 'creative', 'tools', 'idea'])
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
    expect(itemsInGenre(all.items, 'nowhere')).toEqual([])
  })

  it('フィードを種類で絞り、新しい順に返す', () => {
    expect(feedOfKinds(all.feed, ['outage']).map((e) => e.id)).toEqual(['feed-011', 'feed-012', 'feed-013'])
    expect(feedOfKinds(all.feed, ['vuln']).map((e) => e.id)).toEqual(['feed-007', 'feed-008', 'feed-009', 'feed-010', 'feed-014'])
    expect(feedOfKinds(all.feed, ['release', 'eol', 'change', 'exam']).map((e) => e.id)).toEqual([
      'feed-001',
      'feed-002',
      'feed-003',
      'feed-004',
      'feed-005',
      'feed-006',
    ])
  })

  it('公式のお知らせは脆弱性以外。種類を渡すとその種類だけ', () => {
    expect(announcements(all.feed).map((e) => e.id)).toEqual([
      'feed-011',
      'feed-001',
      'feed-002',
      'feed-003',
      'feed-012',
      'feed-004',
      'feed-005',
      'feed-013',
      'feed-006',
    ])
    expect(announcements(all.feed, 'eol').map((e) => e.id)).toEqual(['feed-002'])
  })

  it('脆弱性は深刻度で絞れ、件数と、ウォッチに出す1件(いちばん高い深刻度の中でいちばん新しいもの)を返す', () => {
    expect(vulnerabilities(all.feed, 'critical').map((e) => e.id)).toEqual(['feed-007', 'feed-009'])
    expect(countBySeverity(vulnerabilities(all.feed))).toEqual({ critical: 2, high: 1, medium: 1, low: 1, '': 0 })
    expect(topVulnerability(all.feed)?.id).toBe('feed-007')
    expect(topVulnerability([])).toBeNull()
    expect(findFeedEntry(all.feed, 'feed-014')?.cve).toBe('CVE-2026-90005')
    expect(findFeedEntry(all.feed, 'nowhere')).toBeNull()
  })

  it('フィードの製品名を重複なく名前順で返す', () => {
    const products = feedProducts(feedOfKinds(all.feed, ['release', 'eol', 'change', 'exam']))
    expect(products).toHaveLength(5)
    expect(new Set(products).size).toBe(5)
    expect(products).toContain('サンプルOS Server')
    expect(feedProducts([])).toEqual([])
  })

  it('検索:語を空白で区切り、全部含むものだけ。大文字小文字は区別しない。空の語は何も返さない', () => {
    expect(searchItems(all.items, all.genres, '手順書').map((i) => i.id)).toEqual(['2026-01-03-06', '2026-01-02-01', '2026-01-02-03'])
    expect(searchItems(all.items, all.genres, '手順書 差分').map((i) => i.id)).toEqual(['2026-01-02-01'])
    // ジャンル名でも探せる
    expect(searchItems(all.items, all.genres, 'ローカルllm').map((i) => i.id)).toEqual(['2026-01-02-05'])
    expect(searchItems(all.items, all.genres, '   ')).toEqual([])
    expect(searchFeed(all.feed, 'cve-2026-90002').map((e) => e.id)).toEqual(['feed-008'])
    expect(searchFeed(all.feed, '見本ソフト').map((e) => e.id)).toEqual(['feed-001', 'feed-002', 'feed-005', 'feed-008'])
  })

  it('TST-TRUI-04 公式フィードの検索は見出しの訳でも当たる(原文と訳のどちらかに当たれば出す)', () => {
    const feed = all.feed.map((entry) => (entry.id === 'feed-001' ? { ...entry, titleJa: '架空のかやくご飯' } : entry))
    expect(searchFeed(feed, 'かやくご飯').map((e) => e.id)).toEqual(['feed-001'])
    // 訳の語と原文の語を混ぜても当たる
    expect(searchFeed(feed, 'かやくご飯 見本ソフト').map((e) => e.id)).toEqual(['feed-001'])
    expect(searchFeed(all.feed, 'かやくご飯')).toEqual([])
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

  it('ジャンルの一覧から開いたら、そのジャンルの一覧(itemsInGenre の順)の中で前後を決める', () => {
    const from = { kind: 'genre', id: 'security-news' } as const
    const genreIds = itemsInGenre(all.items, 'security-news').map((i) => i.id)
    // 先頭から次へたどると、itemsInGenre の並びそのもの(別のジャンルの記事が入らない)
    const walked: string[] = []
    let current = findItem(all.items, genreIds[0]!)
    while (current !== null) {
      walked.push(current.id)
      current = neighbors(all.items, current, from).next
    }
    expect(walked).toEqual(genreIds)
    const middle = findItem(all.items, '2026-01-03-02')!
    expect(neighbors(all.items, middle, from)).toMatchObject({ position: 2, total: 5 })
    expect(neighbors(all.items, middle, from).prev?.id).toBe('2026-01-03-01')
    expect(neighbors(all.items, middle, from).next?.id).toBe('2026-01-03-03')
    // 同じ日の全ジャンルなら次は別のジャンルの記事になるところ
    expect(neighbors(all.items, findItem(all.items, '2026-01-03-04')!).next?.genre).not.toBe('security-news')
  })

  it('記事のジャンルと from のジャンルが違うときは、同じ放送日の中で決める(今の動き)', () => {
    const item = findItem(items, '2026-01-02-04')!
    expect(neighbors(items, item, { kind: 'genre', id: 'work' })).toEqual(neighbors(items, item))
  })

  it('保存の一覧から開いたら、保存の一覧(新しく保存した順)の中で前後を決める。一覧に無い記事は今の動き', () => {
    const saved = ['2026-01-02-01', '2026-01-03-06', '2026-01-02-05', 'nowhere']
    expect(savedItems(all.items, saved).map((i) => i.id)).toEqual(['2026-01-02-05', '2026-01-03-06', '2026-01-02-01'])
    const from = { kind: 'saved' } as const
    const middle = findItem(all.items, '2026-01-03-06')!
    expect(neighbors(all.items, middle, from, saved)).toMatchObject({ position: 2, total: 3 })
    expect(neighbors(all.items, middle, from, saved).prev?.id).toBe('2026-01-02-05')
    expect(neighbors(all.items, middle, from, saved).next?.id).toBe('2026-01-02-01')
    expect(neighbors(all.items, findItem(all.items, '2026-01-02-01')!, from, saved).next).toBeNull()
    const notSaved = findItem(all.items, '2026-01-02-03')!
    expect(neighbors(all.items, notSaved, from, saved)).toEqual(neighbors(all.items, notSaved))
  })
})
