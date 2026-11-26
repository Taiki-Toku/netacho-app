import { describe, expect, it, vi } from 'vitest'
import {
  dateParts,
  formatCvss,
  formatDateHeader,
  formatDateLong,
  formatDateOnlyLong,
  formatDateShort,
  formatJstDate,
  formatJstDateTime,
  formatPublishedDate,
  isCalendarDate,
  parseIsoDate,
  tokyoToday,
} from './format.ts'

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

  it('TST-PUB-02 公開日は「公開 11月17日」。空・形の違う値・暦に無い日付は「公開日不明」', () => {
    expect(formatPublishedDate('2026-11-17')).toBe('公開 11月17日')
    expect(formatPublishedDate('2026-01-05')).toBe('公開 1月5日')
    for (const bad of ['', '2026-11-17T09:00:00Z', '2026/11/17', '2026-02-30', 'きのう']) {
      expect(formatPublishedDate(bad)).toBe('公開日不明')
    }
  })

  it('TST-PUB-02 日付だけの値は、UTC の日付の変わり目の前後のどの時刻でも、端末のタイムゾーンでもずれない', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        // 端末のタイムゾーン(Node は TZ を変えるとその場で Date の時差が変わる)
        vi.stubEnv('TZ', tz)
        for (const now of ['2026-11-16T23:59:59Z', '2026-11-17T00:00:00Z', '2026-11-17T14:59:59Z', '2026-11-17T15:00:00Z']) {
          vi.setSystemTime(new Date(now))
          expect(formatPublishedDate('2026-11-17')).toBe('公開 11月17日')
          // バックナンバーの日付の一覧の形(日付の文字列から作る)も、前後の日にずれない
          expect(formatDateOnlyLong('2026-11-24')).toBe('2026年11月24日(火)')
        }
      }
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })

  it('formatDateOnlyLong は「2026年1月2日(金)」。暦に無い・読めない値は元のまま', () => {
    expect(formatDateOnlyLong('2026-01-02')).toBe('2026年1月2日(金)')
    expect(formatDateOnlyLong('2026-02-30')).toBe('2026-02-30')
    expect(formatDateOnlyLong('bad')).toBe('bad')
  })

  it('isCalendarDate は暦に実在する YYYY-MM-DD だけ true(うるう年を含む)', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2000-02-29')).toBe(true)
    expect(isCalendarDate('1900-02-29')).toBe(false)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(isCalendarDate('2026-00-10')).toBe(false)
    expect(isCalendarDate('2026-12-00')).toBe(false)
    expect(isCalendarDate('2026-12-31')).toBe(true)
    expect(isCalendarDate(' 2026-12-31')).toBe(false)
  })

  it('TST-ARC-01 今日の日付は日本時間で決める(UTC 14:59 はまだその日、15:00 で翌日)', () => {
    expect(tokyoToday(new Date('2026-11-24T14:59:59Z'))).toBe('2026-11-24')
    expect(tokyoToday(new Date('2026-11-24T15:00:00Z'))).toBe('2026-11-25')
    expect(tokyoToday(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
  })

  it('CVSS は小数第1位まで。無ければ「－」', () => {
    expect(formatCvss(9.8)).toBe('9.8')
    expect(formatCvss(10)).toBe('10.0')
    expect(formatCvss(null)).toBe('－')
  })
})
