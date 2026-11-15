import { describe, expect, it } from 'vitest'
import { hostOf, httpsHref } from './safeUrl.ts'

describe('httpsHref(リンクにしてよい URL の判定)', () => {
  it('https: の URL だけを通す', () => {
    expect(httpsHref('https://example.com/a')).toBe('https://example.com/a')
    expect(httpsHref('https://example.com/path?q=1#x')).toBe('https://example.com/path?q=1#x')
    // 大文字の書き方も https として整える
    expect(httpsHref('HTTPS://Example.COM/A')).toBe('https://example.com/A')
  })

  it('https: 以外の方式はリンクにしない', () => {
    expect(httpsHref('http://example.com/not-https')).toBeNull()
    expect(httpsHref('javascript:alert(1)')).toBeNull()
    expect(httpsHref('JavaScript:alert(1)')).toBeNull()
    expect(httpsHref('  javascript:alert(1)')).toBeNull()
    expect(httpsHref('java\nscript:alert(1)')).toBeNull()
    expect(httpsHref('\tjavascript:alert(1)')).toBeNull()
    // URL の解釈はタブ・改行を捨てる。途中に挟んでも https として整う(方式のすり替えにはならない)
    expect(httpsHref('ht\ttps://exa\nmple.com/a')).toBe('https://example.com/a')
    expect(httpsHref('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(httpsHref('vbscript:msgbox(1)')).toBeNull()
    expect(httpsHref('file:///etc/passwd')).toBeNull()
    expect(httpsHref('ftp://example.com/')).toBeNull()
    expect(httpsHref('mailto:a@example.com')).toBeNull()
  })

  it('URL として読めないもの・相対・空はリンクにしない', () => {
    expect(httpsHref('')).toBeNull()
    expect(httpsHref('example.com')).toBeNull()
    expect(httpsHref('/relative/path')).toBeNull()
    expect(httpsHref('//example.com/protocol-relative')).toBeNull()
    expect(httpsHref('https://')).toBeNull()
    expect(httpsHref('not a url')).toBeNull()
  })

  it('ユーザー名やパスワードを含む URL はリンクにしない(別のサイトに見せかける手口)', () => {
    expect(httpsHref('https://example.com@evil.example/')).toBeNull()
    expect(httpsHref('https://user:pass@example.com/')).toBeNull()
  })
})

describe('hostOf', () => {
  it('ホスト名を返す。読めなければ空', () => {
    expect(hostOf('https://example.com/a/b')).toBe('example.com')
    expect(hostOf('nonsense')).toBe('')
  })
})
