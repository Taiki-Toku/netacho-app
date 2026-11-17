import { describe, expect, it } from 'vitest'
import { buildSuggestions, SUGGEST_LIMIT } from './suggest.ts'
import { fullSample as sample } from '../test/sampleData.ts'

describe('検索の候補', () => {
  it('分類は ニュース/公式のお知らせ/脆弱性/ジャンル の順で、分類ごとに上限まで', () => {
    const groups = buildSuggestions(sample, 'サンプル')
    expect(groups.map((group) => group.label)).toEqual(['ニュース', '公式のお知らせ', '脆弱性'])
    for (const group of groups) expect(group.options.length).toBeLessThanOrEqual(SUGGEST_LIMIT)
    expect(buildSuggestions(sample, 'サンプル', 1).map((group) => group.options.length)).toEqual([1, 1, 1])
  })

  it('4つの分類がそろうときは、この順に出す。開く先は記事・結果の画面・脆弱性の詳細・ジャンル', () => {
    const data = {
      ...sample,
      genres: [...sample.genres, { id: 'osnews', label: 'サンプルOS 情報', sortOrder: 90 }],
    }
    expect(buildSuggestions(data, 'サンプルOS').map((group) => group.kind)).toEqual(['feed', 'vuln', 'genre'])
    const all = buildSuggestions(data, 'サンプル')
    expect(all.map((group) => group.label)).toEqual(['ニュース', '公式のお知らせ', '脆弱性', 'ジャンル'])
    const [item, feed, vuln, genre] = all.map((group) => group.options[0]?.route)
    expect(item).toEqual({ name: 'item', id: '2026-01-03-01' })
    // お知らせには詳細の画面が無いので、外部リンクではなく結果の画面へ移す
    expect(feed).toEqual({ name: 'search', q: 'サンプル' })
    expect(vuln).toEqual({ name: 'vuln-detail', id: 'feed-007' })
    expect(genre).toEqual({ name: 'genre', id: 'osnews', kind: 'all' })
  })

  it('0件の分類は出さない。全部0件、空の検索語なら空。メニューに出さない「脆弱性」のジャンルは候補にしない', () => {
    expect(buildSuggestions(sample, 'エージェント').map((group) => group.kind)).toEqual(['item', 'genre'])
    expect(buildSuggestions(sample, 'zzzz')).toEqual([])
    expect(buildSuggestions(sample, '   ')).toEqual([])
    expect(buildSuggestions(sample, '脆弱性').some((group) => group.kind === 'genre')).toBe(false)
  })
})
