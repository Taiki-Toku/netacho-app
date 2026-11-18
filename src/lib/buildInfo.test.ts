import { describe, expect, it } from 'vitest'
import { shortCommit } from './buildInfo.ts'

describe('shortCommit(版に添えるコミット)', () => {
  it('コミットの形なら先頭7文字(小文字)', () => {
    expect(shortCommit('0123456789ABCDEF0123456789abcdef01234567')).toBe('0123456')
    expect(shortCommit('abcdef0')).toBe('abcdef0')
  })

  it('無い・コミットの形でないときは local', () => {
    expect(shortCommit(undefined)).toBe('local')
    expect(shortCommit('')).toBe('local')
    expect(shortCommit('abc123')).toBe('local')
    expect(shortCommit('main<script>')).toBe('local')
    expect(shortCommit('g123456789')).toBe('local')
  })
})
