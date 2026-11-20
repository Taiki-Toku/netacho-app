import { describe, expect, it } from 'vitest'
import { hrefFor, parseHash, screenKey } from './router.ts'

describe('router(ハッシュの読み書き)', () => {
  it('ハッシュを画面に対応づける', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
    expect(parseHash('#/today')).toEqual({ name: 'home' })
    expect(parseHash('#/item/2026-01-02-01')).toEqual({ name: 'item', id: '2026-01-02-01' })
    expect(parseHash('#/genre/product')).toEqual({ name: 'genre', id: 'product', kind: 'all' })
    expect(parseHash('#/feed')).toEqual({ name: 'feed', kind: 'all' })
    expect(parseHash('#/vuln')).toEqual({ name: 'vuln', severity: 'all' })
    expect(parseHash('#/vuln/feed-007')).toEqual({ name: 'vuln-detail', id: 'feed-007' })
    expect(parseHash('#/saved')).toEqual({ name: 'saved' })
    expect(parseHash('#/settings')).toEqual({ name: 'settings' })
    expect(hrefFor({ name: 'settings' })).toBe('#/settings')
    expect(parseHash('#/search')).toEqual({ name: 'search', q: '' })
  })

  it('絞り込みと検索語は、ハッシュの ?… から読む(再読み込み・戻るで同じ表示に戻れる)', () => {
    expect(parseHash('#/genre/product?kind=release')).toEqual({ name: 'genre', id: 'product', kind: 'release' })
    expect(parseHash('#/feed?kind=outage')).toEqual({ name: 'feed', kind: 'outage' })
    expect(parseHash('#/vuln?sev=critical')).toEqual({ name: 'vuln', severity: 'critical' })
    expect(parseHash('#/search?q=%E8%84%86%E5%BC%B1%E6%80%A7%20CVE')).toEqual({ name: 'search', q: '脆弱性 CVE' })
  })

  it('知らない絞り込みの値は「すべて」に落とす。脆弱性はお知らせの絞り込みにならない', () => {
    expect(parseHash('#/feed?kind=rumor')).toEqual({ name: 'feed', kind: 'all' })
    expect(parseHash('#/feed?kind=vuln')).toEqual({ name: 'feed', kind: 'all' })
    expect(parseHash('#/vuln?sev=apocalyptic')).toEqual({ name: 'vuln', severity: 'all' })
    expect(parseHash('#/vuln?sev=')).toEqual({ name: 'vuln', severity: 'all' })
  })

  it('読めないハッシュ(昔の画面を含む)はトップ(ホーム)に落とす', () => {
    expect(parseHash('#/nowhere')).toEqual({ name: 'home' })
    expect(parseHash('#/item')).toEqual({ name: 'home' })
    expect(parseHash('#/genre')).toEqual({ name: 'home' })
    expect(parseHash('#/item/%E0%A4%A')).toEqual({ name: 'home' })
    expect(parseHash('#/preferences')).toEqual({ name: 'home' })
    expect(parseHash('#/archive/2026-01-01')).toEqual({ name: 'home' })
    expect(parseHash('#/design-lab')).toEqual({ name: 'home' })
  })

  it('hrefFor と parseHash は往復する。「すべて」は ?… を付けない', () => {
    const id = 'a/b c?#'
    expect(parseHash(hrefFor({ name: 'item', id }))).toEqual({ name: 'item', id })
    expect(parseHash(hrefFor({ name: 'genre', id: 'product', kind: 'eol' }))).toEqual({ name: 'genre', id: 'product', kind: 'eol' })
    expect(hrefFor({ name: 'genre', id: 'product', kind: 'all' })).toBe('#/genre/product')
    expect(hrefFor({ name: 'feed', kind: 'release' })).toBe('#/feed?kind=release')
    expect(hrefFor({ name: 'vuln', severity: 'high' })).toBe('#/vuln?sev=high')
    expect(hrefFor({ name: 'vuln', severity: 'all' })).toBe('#/vuln')
    expect(parseHash(hrefFor({ name: 'vuln-detail', id }))).toEqual({ name: 'vuln-detail', id })
    expect(parseHash(hrefFor({ name: 'search', q: 'a&b=c' }))).toEqual({ name: 'search', q: 'a&b=c' })
    expect(hrefFor({ name: 'search', q: '' })).toBe('#/search')
  })

  it('詳細はどの一覧から開いたか(?from=)を読み、hrefFor と往復する', () => {
    expect(parseHash('#/item/a?from=genre:security')).toEqual({ name: 'item', id: 'a', from: { kind: 'genre', id: 'security' } })
    expect(parseHash('#/item/a?from=saved')).toEqual({ name: 'item', id: 'a', from: { kind: 'saved' } })
    const fromGenre = { name: 'item', id: 'a', from: { kind: 'genre', id: 'security-news' } } as const
    expect(parseHash(hrefFor(fromGenre))).toEqual(fromGenre)
    expect(parseHash(hrefFor({ name: 'item', id: 'a', from: { kind: 'saved' } }))).toEqual({ name: 'item', id: 'a', from: { kind: 'saved' } })
    expect(hrefFor({ name: 'item', id: 'a', from: { kind: 'saved' } })).toBe('#/item/a?from=saved')
    // from が無ければ ?… を付けない
    expect(hrefFor({ name: 'item', id: 'a' })).toBe('#/item/a')
  })

  it('形の違う・知らない from は無視する(from なし)', () => {
    expect(parseHash('#/item/a?from=foo')).toEqual({ name: 'item', id: 'a' })
    expect(parseHash('#/item/a?from=genre:')).toEqual({ name: 'item', id: 'a' })
    expect(parseHash('#/item/a?from=')).toEqual({ name: 'item', id: 'a' })
    expect(parseHash('#/item/a')).toEqual({ name: 'item', id: 'a' })
  })

  it('screenKey は詳細の from では変わらない(id だけ)', () => {
    expect(screenKey({ name: 'item', id: 'a', from: { kind: 'saved' } })).toBe(screenKey({ name: 'item', id: 'a' }))
  })

  it('screenKey は絞り込みの違いでは変わらない(先頭にスクロールしない)', () => {
    expect(screenKey({ name: 'vuln', severity: 'all' })).toBe(screenKey({ name: 'vuln', severity: 'high' }))
    expect(screenKey({ name: 'genre', id: 'a', kind: 'all' })).not.toBe(screenKey({ name: 'genre', id: 'b', kind: 'all' }))
  })
})
