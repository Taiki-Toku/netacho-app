import { describe, expect, it } from 'vitest'
import { securityHeaders } from './securityHeaders.ts'

// 期待する中身は、関数の出力から作らず、そのまま書く
const PRODUCTION = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https:; font-src 'self'; connect-src 'self' https://igkelhluqhfmlmiihumg.supabase.co; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  X-Robots-Tag: noindex
`

const NO_URL = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https:; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  X-Robots-Tag: noindex
`

const PRODUCTION_URL = 'https://igkelhluqhfmlmiihumg.supabase.co'

describe('securityHeaders(_headers の中身)', () => {
  it('URL が無いときは connect-src が self だけ', () => {
    for (const value of [undefined, '', '   ']) {
      const out = securityHeaders(value)
      expect(out).toContain("connect-src 'self';")
      expect(out).not.toContain('supabase')
      expect(out).toBe(NO_URL)
    }
  })

  it('本番の URL なら、決めた中身と完全に一致する(前後の空白・改行は除く)', () => {
    expect(securityHeaders(PRODUCTION_URL)).toBe(PRODUCTION)
    expect(securityHeaders(`  ${PRODUCTION_URL}\n`)).toBe(PRODUCTION)
    expect(securityHeaders(`\t${PRODUCTION_URL} \r\n`)).toBe(PRODUCTION)
  })

  it('形の違う URL ではエラーを投げる', () => {
    const bad = [
      'http://igkelhluqhfmlmiihumg.supabase.co',
      'https://evil.example.com',
      'https://abc.supabase.co.evil.com',
      'https://abc.supabase.co/',
      'https://abc.supabase.co; script-src *',
      'https://abc.supabase.co\nX-Test: 1',
      'https://ABC.supabase.co',
      'https://.supabase.co',
    ]
    for (const value of bad) {
      expect(() => securityHeaders(value)).toThrow(Error)
    }
  })

  it('エラーのメッセージに値そのものを入れない', () => {
    expect(() => securityHeaders('https://evil.example.com')).toThrow(/^(?!.*evil).*$/s)
  })

  it('1行目は /*、ヘッダーの行は空白2つで始まり、最後は改行。どの行も 2,000 文字以下', () => {
    for (const value of [undefined, PRODUCTION_URL]) {
      const out = securityHeaders(value)
      expect(out.endsWith('\n')).toBe(true)
      const lines = out.slice(0, -1).split('\n')
      expect(lines[0]).toBe('/*')
      for (const line of lines.slice(1)) {
        expect(line).toMatch(/^ {2}\S/)
      }
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(2000)
      }
    }
  })

  it('CSP に unsafe-inline・unsafe-eval・data:・* が無い', () => {
    for (const value of [undefined, PRODUCTION_URL]) {
      const csp = securityHeaders(value)
        .split('\n')
        .find((line) => line.startsWith('  Content-Security-Policy: '))
      expect(csp).toBeDefined()
      expect(csp).not.toContain("'unsafe-inline'")
      expect(csp).not.toContain("'unsafe-eval'")
      expect(csp).not.toContain('data:')
      expect(csp).not.toContain('*')
    }
  })
})
