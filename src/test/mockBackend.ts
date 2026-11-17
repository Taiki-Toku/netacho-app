// Supabase モードの試験用の Backend。通信はせず、ログインの状態とネタの一覧を手元で持つ
import { vi } from 'vitest'
import type { AuthApi, AuthResult, Backend } from '../data/backend.ts'
import type { Item } from '../data/types.ts'

interface MockOptions {
  signedIn?: boolean
  loadItems?: () => Promise<Item[]>
  verifyResult?: AuthResult
}

export function mockBackend({ signedIn = false, loadItems = () => Promise.resolve([]), verifyResult = { ok: true } }: MockOptions = {}) {
  let current = signedIn
  let listener: ((signedIn: boolean) => void) | undefined
  function set(value: boolean) {
    current = value
    listener?.(value)
  }
  const backend = {
    auth: {
      watchSession: vi.fn((onChange: (signedIn: boolean) => void) => {
        listener = onChange
        onChange(current)
        return () => {
          listener = undefined
        }
      }),
      sendCode: vi.fn<AuthApi['sendCode']>(() => Promise.resolve({ ok: true })),
      verifyCode: vi.fn<AuthApi['verifyCode']>(() => {
        if (verifyResult.ok) set(true)
        return Promise.resolve(verifyResult)
      }),
      signOut: vi.fn((): Promise<void> => {
        set(false)
        return Promise.resolve()
      }),
    },
    loadItems: vi.fn(loadItems),
  } satisfies Backend
  return backend
}
