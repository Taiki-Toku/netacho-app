import { describe, expect, it, vi } from 'vitest'
import { classifyAuthError, supabaseConfigFrom } from './backend.ts'
import { backendFromEnv } from './supabaseBackend.ts'
import { mockBackend } from '../test/mockBackend.ts'

describe('Supabase モードの切り替え', () => {
  it('URL と publishable キーが両方あるときだけ Supabase モード(前後の空白は除く)', () => {
    expect(supabaseConfigFrom({ VITE_SUPABASE_URL: ' https://example.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_x',
    })
    expect(supabaseConfigFrom({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toBeNull()
    expect(supabaseConfigFrom({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toBeNull()
    expect(supabaseConfigFrom({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '  ' })).toBeNull()
    expect(supabaseConfigFrom({})).toBeNull()
  })

  it('環境変数が無ければ Backend を作らず(今までどおり)、あれば作る', () => {
    const backend = mockBackend()
    const create = vi.fn(() => backend)
    expect(backendFromEnv({}, create)).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
    expect(backendFromEnv({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }, create)).toBe(backend)
    expect(create).toHaveBeenCalledWith({ url: 'https://example.supabase.co', publishableKey: 'k' })
  })
})

describe('認証エラーの分類', () => {
  it('code と status から、画面の文言の種類に分ける', () => {
    expect(classifyAuthError({ name: 'AuthApiError', code: 'otp_expired', status: 403 }).reason).toBe('invalid-code')
    expect(classifyAuthError({ name: 'AuthApiError', code: 'over_email_send_rate_limit', status: 429 }).reason).toBe('rate-limit')
    expect(classifyAuthError({ name: 'AuthApiError', status: 429 }).reason).toBe('rate-limit')
    expect(classifyAuthError({ name: 'AuthApiError', code: 'otp_disabled', status: 422 }).reason).toBe('not-allowed')
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 }).reason).toBe('network')
    expect(classifyAuthError(new TypeError('Failed to fetch'))).toEqual({ ok: false, reason: 'unknown', code: undefined })
  })

  it('分からないエラーは code だけを残し、code の形が怪しければ捨てる', () => {
    expect(classifyAuthError({ code: 'unexpected_failure', status: 500 })).toEqual({ ok: false, reason: 'unknown', code: 'unexpected_failure' })
    expect(classifyAuthError({ code: '<img src=x>', status: 500 })).toEqual({ ok: false, reason: 'unknown', code: undefined })
  })
})
