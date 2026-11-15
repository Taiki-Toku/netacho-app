import { describe, expect, it } from 'vitest'
import { dateParts, formatDateLong, parseIsoDate } from './format.ts'

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
})
