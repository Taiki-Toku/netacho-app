import { describe, expect, it } from 'vitest'
import { dateParts, formatCvss, formatDateHeader, formatDateLong, formatDateShort, formatJstDate, formatJstDateTime, parseIsoDate } from './format.ts'

describe('format(日付)', () => {
  it('YYYY-MM-DD を読む。無い日付は null', () => {
    expect(parseIsoDate('2026-01-02')?.getDate()).toBe(2)
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('2026/01/02')).toBeNull()
    expect(parseIsoDate('')).toBeNull()
  })

  it('年・月・日・曜日に分ける', () => {
    expect(dateParts('2026-01-02')).toEqual({ year: '2026', month: '1', day: '2', weekday: '金' })
    expect(dateParts('bad')).toBeNull()
  })

  it('長い形は「2026年1月2日(金)」。読めなければ元のまま', () => {
    expect(formatDateLong('2026-01-02')).toBe('2026年1月2日(金)')
    expect(formatDateLong('bad')).toBe('bad')
  })

  it('短い形は「1/2」', () => {
    expect(formatDateShort('2026-01-02')).toBe('1/2')
    expect(formatDateShort('bad')).toBe('bad')
  })

  it('上のバー用は「1月2日 金曜日」', () => {
    expect(formatDateHeader('2026-01-02')).toBe('1月2日 金曜日')
    expect(formatDateHeader('2026-11-16')).toBe('11月16日 月曜日')
    expect(formatDateHeader('bad')).toBe('bad')
  })

  it('フィードの公開日時(UTC)は日本時間で出す。読めなければ空', () => {
    expect(formatJstDateTime('2026-01-03T02:00:00Z')).toBe('1/3 11:00')
    // 日付をまたぐ(UTC 22:00 → 翌日 7:00)
    expect(formatJstDateTime('2026-01-02T22:00:00Z')).toBe('1/3 07:00')
    expect(formatJstDateTime('いつか')).toBe('')
    expect(formatJstDate('2026-01-02T22:00:00Z')).toBe('1月3日')
    expect(formatJstDate('いつか')).toBe('')
  })

  it('CVSS は小数第1位まで。無ければ「－」', () => {
    expect(formatCvss(9.8)).toBe('9.8')
    expect(formatCvss(10)).toBe('10.0')
    expect(formatCvss(null)).toBe('－')
  })
})
