import { describe, expect, it } from 'vitest'
import { FEED_COLUMNS, rowsToFeed, rowToFeedEntry } from './feedRow.ts'

// 架空の行(本物の feed_entries のデータではない)
const vulnRow = {
  id: 'vuln-1',
  kind: 'vuln',
  vendor: '架空ベンダー',
  product: '架空製品',
  title: '架空の脆弱性',
  url: 'https://example.com/advisory/1',
  published_at: '2026-11-18T09:00:00+00:00',
  sort_at: '2026-11-19T03:04:05.123456+00:00',
  severity: 'high',
  cvss: 8.1,
  cve_ids: ['CVE-2099-0001', 'CVE-2099-0002'],
  status: '修正版あり',
}

describe('feed_entries の行の変換', () => {
  it('TST-FEEDUI-01 列名を FeedEntry に置き換える(published_at → publishedAt、sort_at → sortAt、cve_ids は最初の値)', () => {
    expect(rowToFeedEntry(vulnRow)).toEqual({
      id: 'vuln-1',
      kind: 'vuln',
      vendor: '架空ベンダー',
      product: '架空製品',
      title: '架空の脆弱性',
      publishedAt: '2026-11-18T09:00:00+00:00',
      sortAt: '2026-11-19T03:04:05.123456+00:00',
      url: 'https://example.com/advisory/1',
      severity: 'high',
      status: '修正版あり',
      cve: 'CVE-2099-0001',
      cvss: 8.1,
    })
  })

  it('TST-FEEDUI-08 published_at が null なら publishedAt は空(sort_at で代えない)。sortAt はそのまま', () => {
    expect(rowToFeedEntry({ ...vulnRow, published_at: null })).toMatchObject({ publishedAt: '', sortAt: '2026-11-19T03:04:05.123456+00:00' })
  })

  it('TST-FEEDUI-01 null の url・severity は空、cve_ids が空・null なら cve は空', () => {
    expect(rowToFeedEntry({ ...vulnRow, url: null, severity: null, cve_ids: [] })).toMatchObject({ url: '', severity: '', cve: '' })
    expect(rowToFeedEntry({ ...vulnRow, cve_ids: null })).toMatchObject({ cve: '' })
  })

  it('TST-FEEDUI-01 cvss は数値・文字列のどちらでも読み、範囲外・読めない値・null は null', () => {
    expect(rowToFeedEntry({ ...vulnRow, cvss: 9.8 })?.cvss).toBe(9.8)
    expect(rowToFeedEntry({ ...vulnRow, cvss: '7.5' })?.cvss).toBe(7.5)
    expect(rowToFeedEntry({ ...vulnRow, cvss: '10.0' })?.cvss).toBe(10)
    expect(rowToFeedEntry({ ...vulnRow, cvss: 10.1 })?.cvss).toBeNull()
    expect(rowToFeedEntry({ ...vulnRow, cvss: '11' })?.cvss).toBeNull()
    expect(rowToFeedEntry({ ...vulnRow, cvss: -1 })?.cvss).toBeNull()
    expect(rowToFeedEntry({ ...vulnRow, cvss: 'abc' })?.cvss).toBeNull()
    // 空の文字列を 0 点にしない
    expect(rowToFeedEntry({ ...vulnRow, cvss: '' })?.cvss).toBeNull()
    expect(rowToFeedEntry({ ...vulnRow, cvss: null })?.cvss).toBeNull()
  })

  it('TST-FEEDUI-01 脆弱性でない行は、深刻度・CVE・CVSS を持たない(今の parseFeedEntry の扱い)', () => {
    expect(rowToFeedEntry({ ...vulnRow, kind: 'release' })).toMatchObject({ kind: 'release', severity: '', cve: '', cvss: null, status: '' })
  })

  it('TST-FEEDUI-06 形の崩れた行(id が無い、kind が違う、日時が読めない)は捨て、ほかは出る', () => {
    const rows = [
      { ...vulnRow, id: null },
      { ...vulnRow, id: 'bad-kind', kind: 'unknown' },
      { ...vulnRow, id: 'bad-date', sort_at: 'not-a-date' },
      { ...vulnRow, id: 'no-date', sort_at: null },
      // sort_at が無ければ、published_at があっても代わりにしない
      { ...vulnRow, id: 'no-sort-column', sort_at: undefined },
      { ...vulnRow, id: 'bad-published', published_at: 'いつか' },
      null,
      'row',
      ['vuln-x'],
      { ...vulnRow, id: 'ok-1' },
      { ...vulnRow, id: 'ok-2', kind: 'outage' },
      // 同じ id は先のものを残す
      { ...vulnRow, id: 'ok-1', title: '後の行' },
    ]
    const entries = rowsToFeed(rows)
    expect(entries.map((entry) => entry.id)).toEqual(['ok-1', 'ok-2'])
    expect(entries[0]?.title).toBe('架空の脆弱性')
  })

  it('配列でなければ空', () => {
    expect(rowsToFeed(null)).toEqual([])
    expect(rowsToFeed({ id: 'x' })).toEqual([])
  })

  it('TST-TRUI-02 読む列は決まった 14 列だけ(訳は title_ja と translate_status だけ。summary・summary_ja は読まない)', () => {
    expect(FEED_COLUMNS.split(',')).toEqual([
      'id',
      'kind',
      'vendor',
      'product',
      'title',
      'url',
      'published_at',
      'sort_at',
      'severity',
      'cvss',
      'cve_ids',
      'status',
      'title_ja',
      'translate_status',
    ])
    expect(FEED_COLUMNS).not.toContain('summary')
  })
})

describe('feed_entries の行の訳(詳細設計 5.3.1)', () => {
  it('TST-TRUI-01 translate_status が done で title_ja が空でない文字列のときだけ titleJa が入る', () => {
    expect(rowToFeedEntry({ ...vulnRow, title_ja: '架空の訳', translate_status: 'done' })?.titleJa).toBe('架空の訳')
  })

  it('TST-TRUI-01 pending・failed・状態なしでは、title_ja があっても titleJa を作らない', () => {
    for (const translate_status of ['pending', 'failed', null, undefined, 'DONE', '']) {
      const entry = rowToFeedEntry({ ...vulnRow, title_ja: '架空の訳', translate_status })
      expect(entry).not.toBeNull()
      expect(entry).not.toHaveProperty('titleJa')
    }
  })

  it('TST-TRUI-01 done でも、空・空白だけ・null・文字列でない・1,000 字超えの title_ja は titleJa を作らない(行は残す)', () => {
    for (const title_ja of ['', '   ', null, undefined, 123, ['架空'], { text: '架空' }, 'あ'.repeat(1001)]) {
      const entry = rowToFeedEntry({ ...vulnRow, title_ja, translate_status: 'done' })
      expect(entry?.id).toBe('vuln-1')
      expect(entry).not.toHaveProperty('titleJa')
    }
    // ちょうど 1,000 字は入る
    expect(rowToFeedEntry({ ...vulnRow, title_ja: 'あ'.repeat(1000), translate_status: 'done' })?.titleJa).toHaveLength(1000)
  })
})
