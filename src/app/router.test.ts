import { describe, expect, it } from 'vitest'
import { hrefFor, parseHash } from './router.ts'

describe('router(ハッシュの読み書き)', () => {
  it('ハッシュを画面に対応づける', () => {
    expect(parseHash('')).toEqual({ name: 'today' })
    expect(parseHash('#/')).toEqual({ name: 'today' })
    expect(parseHash('#/today')).toEqual({ name: 'today' })
    expect(parseHash('#/item/2026-01-02-01')).toEqual({ name: 'item', id: '2026-01-02-01' })
    expect(parseHash('#/archive')).toEqual({ name: 'archive' })
    expect(parseHash('#/archive/2026-01-01')).toEqual({ name: 'archive-date', date: '2026-01-01' })
    expect(parseHash('#/search')).toEqual({ name: 'search' })
    expect(parseHash('#/settings')).toEqual({ name: 'settings' })
  })

  it('読めないハッシュは「今日」に落とす', () => {
    expect(parseHash('#/nowhere')).toEqual({ name: 'today' })
    expect(parseHash('#/item')).toEqual({ name: 'today' })
    expect(parseHash('#/item/%E0%A4%A')).toEqual({ name: 'today' })
  })

  it('hrefFor と parseHash は往復する', () => {
    const id = 'a/b c?#'
    expect(parseHash(hrefFor({ name: 'item', id }))).toEqual({ name: 'item', id })
    expect(parseHash(hrefFor({ name: 'archive-date', date: '2026-01-01' }))).toEqual({
      name: 'archive-date',
      date: '2026-01-01',
    })
  })
})
