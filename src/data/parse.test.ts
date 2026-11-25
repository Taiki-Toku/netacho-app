import { describe, expect, it } from 'vitest'
import { parseFeed, parseFeedEntry, parseGenres, parseItem, parseItems } from './parse.ts'
import sampleItems from '../../fixtures/sample-items.json'
import sampleItemsExtra from '../../fixtures/sample-items-extra.json'
import sampleFeed from '../../fixtures/sample-feed.json'
import genresJson from '../../fixtures/genres.json'

describe('parseItems(信用しないデータの整形)', () => {
  it('見本データは全件そのまま読める(基本 9 本 + 追加 6 本)', () => {
    const items = parseItems(sampleItems)
    expect(items).toHaveLength(9)
    expect(items[0]?.title).toBe('架空:手順書の差分チェックを半自動にする')
    expect(items[0]?.stars).toEqual({ hot: 3, use: 5, fun: 2 })
    expect(parseItems(sampleItemsExtra)).toHaveLength(6)
    expect(parseItems([...sampleItems, ...sampleItemsExtra])).toHaveLength(15)
  })

  it('imageUrl は文字列のときだけ持ち、無い・空・文字列でないときは項目ごと無い。中身は解釈しない', () => {
    const items = parseItems(sampleItems)
    expect(items[0]?.imageUrl).toBe('fixtures/images/desk.svg')
    // 02-03 は画像なし
    expect(items[2]).not.toHaveProperty('imageUrl')
    expect(parseItem({ id: 'a', date: '2026-01-01', imageUrl: '' })).not.toHaveProperty('imageUrl')
    expect(parseItem({ id: 'a', date: '2026-01-01', imageUrl: 42 })).not.toHaveProperty('imageUrl')
    expect(parseItem({ id: 'a', date: '2026-01-01', imageUrl: 'javascript:alert(1)' })?.imageUrl).toBe('javascript:alert(1)')
  })

  it('points は文字列の配列だけを持ち、文字列でない要素と空白だけの要素は捨てる。excerpt は文字列だけ。無ければ空', () => {
    const base = { id: 'x', date: '2026-01-01' }
    expect(parseItem({ ...base, points: ['一', 2, '  ', '三'], excerpt: '抜粋' })).toMatchObject({ points: ['一', '三'], excerpt: '抜粋' })
    expect(parseItem({ ...base, points: '一つの文字列', excerpt: ['配列'] })).toMatchObject({ points: [], excerpt: '' })
    expect(parseItem(base)).toMatchObject({ points: [], excerpt: '' })
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

describe('parseFeed(公式フィードの整形)', () => {
  it('見本のフィードは全件読める。severity・cve・cvss は vuln、status は outage と vuln のときだけ持つ', () => {
    const feed = parseFeed(sampleFeed)
    expect(feed).toHaveLength(14)
    expect(feed.find((e) => e.id === 'feed-007')).toMatchObject({
      kind: 'vuln',
      severity: 'critical',
      cve: 'CVE-2026-90001',
      cvss: 9.8,
      status: '修正版 7.4.3 あり',
    })
    expect(feed.find((e) => e.id === 'feed-011')).toMatchObject({ kind: 'outage', status: '調査中', severity: '', cve: '', cvss: null })
    expect(feed.find((e) => e.id === 'feed-001')).toMatchObject({ kind: 'release', severity: '', status: '', cve: '', cvss: null })
  })

  it('id・kind・publishedAt が形になっていないものは捨てる。知らない kind も捨てる', () => {
    expect(parseFeed(null)).toEqual([])
    expect(parseFeed([{ kind: 'release', publishedAt: '2026-01-01T00:00:00Z' }])).toEqual([])
    expect(parseFeed([{ id: 'a', kind: 'rumor', publishedAt: '2026-01-01T00:00:00Z' }])).toEqual([])
    expect(parseFeed([{ id: 'a', kind: 'release', publishedAt: 'いつか' }])).toEqual([])
    expect(parseFeed([{ id: 'a', kind: 'release', publishedAt: '2026-01-01T00:00:00Z' }])).toHaveLength(1)
  })

  it('sortAt が無い(見本・local-data)ときは publishedAt を sortAt にする', () => {
    expect(parseFeedEntry({ id: 'a', kind: 'release', publishedAt: '2026-01-01T00:00:00Z' })).toMatchObject({
      publishedAt: '2026-01-01T00:00:00Z',
      sortAt: '2026-01-01T00:00:00Z',
    })
  })

  it('sortAt が読めなければ捨てる。publishedAt は空(公開日不明)か読める日時だけ通す', () => {
    const base = { id: 'a', kind: 'release', sortAt: '2026-01-02T00:00:00Z' }
    expect(parseFeedEntry({ ...base, publishedAt: '' })).toMatchObject({ publishedAt: '', sortAt: '2026-01-02T00:00:00Z' })
    expect(parseFeedEntry({ ...base, publishedAt: null })?.publishedAt).toBe('')
    expect(parseFeedEntry({ ...base, publishedAt: '2026-01-01T00:00:00Z' })?.publishedAt).toBe('2026-01-01T00:00:00Z')
    expect(parseFeedEntry({ ...base, publishedAt: 'いつか' })).toBeNull()
    expect(parseFeedEntry({ ...base, publishedAt: 20260101 })).toBeNull()
    expect(parseFeedEntry({ ...base, sortAt: 'いつか', publishedAt: '2026-01-01T00:00:00Z' })).toBeNull()
    expect(parseFeedEntry({ ...base, sortAt: null, publishedAt: '2026-01-01T00:00:00Z' })).toBeNull()
  })

  it('種類に合わない severity / status / cve / cvss は捨て、知らない severity は空にする', () => {
    expect(
      parseFeedEntry({
        id: 'a',
        kind: 'release',
        publishedAt: '2026-01-01T00:00:00Z',
        severity: 'critical',
        status: '調査中',
        cve: 'CVE-1',
        cvss: 9,
      }),
    ).toMatchObject({ severity: '', status: '', cve: '', cvss: null })
    expect(parseFeedEntry({ id: 'a', kind: 'vuln', publishedAt: '2026-01-01T00:00:00Z', severity: 'apocalyptic' })?.severity).toBe('')
  })

  it('cvss は 0〜10 の数だけを通し、小数第1位に丸める', () => {
    const at = (cvss: unknown) => parseFeedEntry({ id: 'a', kind: 'vuln', publishedAt: '2026-01-01T00:00:00Z', cvss })?.cvss
    expect(at(9.84)).toBe(9.8)
    expect(at(0)).toBe(0)
    expect(at(10)).toBe(10)
    expect(at(11)).toBeNull()
    expect(at(-1)).toBeNull()
    expect(at('9.8')).toBeNull()
    expect(at(undefined)).toBeNull()
    expect(at(Number.NaN)).toBeNull()
  })

  it('同じ id は先のものを残し、URL や見出しの中身は解釈しない', () => {
    const feed = parseFeed([
      { id: 'a', kind: 'outage', publishedAt: '2026-01-01T00:00:00Z', title: '<b>先</b>', url: 'javascript:alert(1)' },
      { id: 'a', kind: 'outage', publishedAt: '2026-01-01T00:00:00Z', title: '後' },
    ])
    expect(feed).toHaveLength(1)
    expect(feed[0]?.title).toBe('<b>先</b>')
    expect(feed[0]?.url).toBe('javascript:alert(1)')
  })

  it('TST-TRUI-01 titleJa は空白だけでない 1,000 字以内の文字列だけ通す。それ以外は項目を作らず、行は残す', () => {
    const base = { id: 'a', kind: 'release', publishedAt: '2026-01-01T00:00:00Z', title: 'Fictional title' }
    expect(parseFeedEntry({ ...base, titleJa: '架空の訳' })?.titleJa).toBe('架空の訳')
    expect(parseFeedEntry({ ...base, titleJa: 'あ'.repeat(1000) })?.titleJa).toHaveLength(1000)
    // サロゲートペアの字は1字と数える
    expect(parseFeedEntry({ ...base, titleJa: '𠮷'.repeat(1000) })?.titleJa).toBe('𠮷'.repeat(1000))
    for (const titleJa of [undefined, null, '', ' \n ', 1, true, ['架空'], { ja: '架空' }, 'あ'.repeat(1001), '𠮷'.repeat(1001)]) {
      const entry = parseFeedEntry({ ...base, titleJa })
      expect(entry?.id).toBe('a')
      expect(entry).not.toHaveProperty('titleJa')
    }
  })

  it('TST-TRUI-05 titleJa の中身は解釈しない(HTML の文字もそのまま)', () => {
    const base = { id: 'a', kind: 'release', publishedAt: '2026-01-01T00:00:00Z', title: 'Fictional title' }
    expect(parseFeedEntry({ ...base, titleJa: '<script>alert(1)</script>' })?.titleJa).toBe('<script>alert(1)</script>')
  })
})

describe('parseGenres', () => {
  it('fixtures のジャンルを sortOrder 順に読む(「脆弱性」vuln は廃止済みで無い)', () => {
    const genres = parseGenres(genresJson)
    expect(genres.map((g) => g.id)).toEqual([
      'work',
      'agent',
      'local-llm',
      'security-news',
      'product',
      'creative',
      'tools',
      'idea',
    ])
  })

  it('id か label が無いものは捨てる', () => {
    expect(parseGenres([{ id: 'x' }, { label: 'y' }, { id: 'z', label: 'Z', sortOrder: 1 }])).toEqual([
      { id: 'z', label: 'Z', sortOrder: 1 },
    ])
  })
})
