// 自分の操作(保存)の置き場。いまは端末の中(localStorage)に保存する。
// 読み書きはこのモジュールにまとめ、あとで Supabase に差し替えられるようにする(UserStore の形を守れば画面は変えなくてよい)。
// 前の版で付けた評価・メモ(feedback)は画面では使わないが、読み込み・書き戻しの形はそのまま残す
// (保存の付け外しで一緒に書き戻され、消えない。消すのは「すべて削除」だけ。詳細設計 5.7.1)。
//
// 注意:メモには会社の情報が入りうる。ここに置いたものを、ログや画面の外(通信)に出さない。
import { createContext, useContext, useSyncExternalStore } from 'react'
import { RATINGS, type Rating } from './types.ts'

/** 前の版で付けた評価・メモ(いまの画面では付けられない。端末に残っているものを消さずに持つ) */
export interface Feedback {
  rating?: Rating
  memo?: string
}

export interface UserState {
  /** 保存したネタの id(保存した順) */
  saved: readonly string[]
  feedback: Readonly<Record<string, Feedback>>
}

// 関数は this を使わない(切り離して渡せる)ため、プロパティの形で宣言する
export interface UserStore {
  getState: () => UserState
  subscribe: (listener: () => void) => () => void
  /** 保存の付け外し。付けたあとの状態(true = 保存した)を返す */
  toggleSaved: (id: string) => boolean
  /** 保存と前の版の評価・メモをすべて消す(この端末の置き場ごと消す。設定の画面の「すべて削除」) */
  clear: () => void
}

const STORAGE_KEY = 'nodal-user'
const EMPTY: UserState = { saved: [], feedback: {} }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 保存してあった JSON を形に合わせて読む。壊れていたら空から始める(例外は投げない) */
function parseState(raw: string | null): UserState {
  if (raw === null) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (!isRecord(value)) return EMPTY
  const saved = Array.isArray(value.saved) ? value.saved.filter((id): id is string => typeof id === 'string') : []
  const feedback: Record<string, Feedback> = {}
  if (isRecord(value.feedback)) {
    for (const [id, entry] of Object.entries(value.feedback)) {
      // オブジェクトの仕組みに使われる名前は、ネタの id としてあり得ないので捨てる(prototype の差し替えを防ぐ)
      if (!isRecord(entry) || id === '__proto__' || id === 'constructor' || id === 'prototype') continue
      const item: Feedback = {}
      if (typeof entry.rating === 'string' && (RATINGS as readonly string[]).includes(entry.rating)) item.rating = entry.rating as Rating
      if (typeof entry.memo === 'string') item.memo = entry.memo
      feedback[id] = item
    }
  }
  return { saved: [...new Set(saved)], feedback }
}

/**
 * 設定の画面に出す件数:保存と、端末に残っている前の版の評価・メモ(評価とメモを別々に数えて足す)。
 * 外した評価('')と空白だけのメモは数えない
 */
export function countUserData(state: UserState): { saved: number; legacyFeedback: number } {
  const entries = Object.values(state.feedback)
  const ratings = entries.filter((entry) => entry.rating !== undefined && entry.rating !== '').length
  const memos = entries.filter((entry) => entry.memo !== undefined && entry.memo.trim() !== '').length
  return { saved: state.saved.length, legacyFeedback: ratings + memos }
}

/** localStorage が使えない環境(無効化、容量切れ)でも落ちないよう、読み書きは try で包む */
export function createLocalUserStore(storage: Storage | null): UserStore {
  let state: UserState = EMPTY
  try {
    state = parseState(storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    state = EMPTY
  }
  const listeners = new Set<() => void>()

  function commit(next: UserState) {
    state = next
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 保存できなくても、画面の中では反映しておく
    }
    for (const listener of listeners) listener()
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    toggleSaved(id) {
      const saved = state.saved.includes(id)
      commit({ ...state, saved: saved ? state.saved.filter((other) => other !== id) : [...state.saved, id] })
      return !saved
    },
    clear() {
      // 空の値を書くのではなく、キーごと消す。消すのはこのアプリのキー(nodal-user)だけ
      state = EMPTY
      try {
        storage?.removeItem(STORAGE_KEY)
      } catch {
        // 消せなくても、画面の中では空にしておく
      }
      for (const listener of listeners) listener()
    },
  }
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** アプリで使う既定の置き場(端末の localStorage) */
export function createDefaultUserStore(): UserStore {
  return createLocalUserStore(defaultStorage())
}

const UserStoreContext = createContext<UserStore | null>(null)
export const UserStoreProvider = UserStoreContext.Provider

export function useUserStore(): UserStore {
  const store = useContext(UserStoreContext)
  if (store === null) throw new Error('UserStoreProvider の中で使ってください')
  return store
}

/** 保存(と前の版の評価・メモ)の現在の状態。変わると再描画される */
export function useUserState(): UserState {
  const store = useUserStore()
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
