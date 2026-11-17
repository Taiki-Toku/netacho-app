// ログアウトの関数を画面に配る。Supabase モードでログインしているときだけ値があり、それ以外は null(ボタンを出さない)
import { createContext, useContext } from 'react'

export const SignOutContext = createContext<(() => void) | null>(null)

export function useSignOut(): (() => void) | null {
  return useContext(SignOutContext)
}
