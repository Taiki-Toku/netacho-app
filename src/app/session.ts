// ログイン中のアカウント(メールアドレスとログアウトの関数)を画面に配る。
// Supabase モードでログインしているときだけ値があり、それ以外(見本のデータ)は null(ログアウトのボタンを出さない)
import { createContext, useContext } from 'react'

export interface Account {
  /** ログイン中の人のメールアドレス。セッションに無ければ null */
  email: string | null
  signOut: () => void
}

export const AccountContext = createContext<Account | null>(null)

export function useAccount(): Account | null {
  return useContext(AccountContext)
}
