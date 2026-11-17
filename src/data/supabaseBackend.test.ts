// supabaseBackend の試験。supabase-js の createClient を偽物に差し替え、通信はしない
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signOut } }),
}))

const { createSupabaseBackend } = await import('./supabaseBackend.ts')

describe('ログアウト', () => {
  beforeEach(() => {
    signOut.mockReset()
  })

  it('ふつうは既定(global)の1回で終わる', async () => {
    signOut.mockResolvedValue({ error: null })
    await createSupabaseBackend({ url: 'https://example.supabase.co', publishableKey: 'k' }).auth.signOut()
    expect(signOut.mock.calls).toEqual([[]])
  })

  it('通信に失敗して error が返ったら、端末だけのログアウト(local)で端末のセッションを消す', async () => {
    signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', status: 0 } }).mockResolvedValueOnce({ error: null })
    await createSupabaseBackend({ url: 'https://example.supabase.co', publishableKey: 'k' }).auth.signOut()
    expect(signOut.mock.calls).toEqual([[], [{ scope: 'local' }]])
  })

  it('例外が出ても local で消し、呼んだ側には例外を投げない', async () => {
    signOut.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ error: null })
    await expect(createSupabaseBackend({ url: 'https://example.supabase.co', publishableKey: 'k' }).auth.signOut()).resolves.toBeUndefined()
    expect(signOut.mock.calls).toEqual([[], [{ scope: 'local' }]])
  })
})
