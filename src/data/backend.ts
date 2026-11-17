// Supabase モードで画面が使う関数の形(ログインの関数と、ネタの一覧を返す関数)。
// 本物は supabaseBackend.ts が作る。試験ではこの形のモックを渡す(ネットワークを使わない)。
// このファイルは supabase-js を import しない(モードの判定とエラーの分類を、通信なしで試験するため)。
import type { Item } from './types.ts'

export type AuthFailure = 'invalid-code' | 'rate-limit' | 'not-allowed' | 'network' | 'unknown'

export type AuthResult = { ok: true } | { ok: false; reason: AuthFailure; code?: string }

export interface AuthApi {
  /** ログインの状態を見張る。登録した直後に今の状態を1回知らせ、以後は変わるたびに知らせる。戻り値で見張りをやめる */
  watchSession(onChange: (signedIn: boolean) => void): () => void
  /** メールに6桁のコードを送る(新しい利用者は作らない) */
  sendCode(email: string): Promise<AuthResult>
  /** 届いたコードでログインする */
  verifyCode(email: string, token: string): Promise<AuthResult>
  /** ログアウトする。失敗しても例外は投げない(端末のセッションは消える) */
  signOut(): Promise<void>
}

export interface Backend {
  auth: AuthApi
  /** ネタの一覧(新しい順・最大 1000 件)。読めなければ例外を投げる */
  loadItems(): Promise<Item[]>
}

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

/** 環境変数から接続先を作る。2つとも値があるときだけ返し、どちらかが無ければ null(今までどおり local-data → fixtures) */
export function supabaseConfigFrom(env: { VITE_SUPABASE_URL?: unknown; VITE_SUPABASE_PUBLISHABLE_KEY?: unknown }): SupabaseConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : ''
  const publishableKey = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string' ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim() : ''
  if (url === '' || publishableKey === '') return null
  return { url, publishableKey }
}

const ERROR_CODE_PATTERN = /^[A-Za-z0-9_]{1,64}$/

/** エラーの code(認証は otp_expired、表の読み込みは PGRST301 など)を、画面に添えてよい形(英数字と _ だけ、64 文字まで)のときだけ返す */
export function safeErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : undefined
}

const INVALID_CODE = new Set(['otp_expired', 'invalid_credentials'])
const RATE_LIMIT = new Set(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit'])
// shouldCreateUser: false で、登録されていないメールアドレスに送ったとき(新規登録の無効も含む)
const NOT_ALLOWED = new Set(['otp_disabled', 'signup_disabled', 'user_not_found', 'email_address_not_authorized', 'email_address_invalid'])

/** supabase-js の認証エラー(name・code・status を持つ)を、画面の文言の種類に分ける */
export function classifyAuthError(error: unknown): AuthResult & { ok: false } {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const code = safeErrorCode(record.code)
  // 通信そのものが失敗した(supabase-js は AuthRetryableFetchError を返す。status は 0 のことがある)
  if (record.name === 'AuthRetryableFetchError' || record.status === 0) return { ok: false, reason: 'network', code }
  if (code !== undefined && INVALID_CODE.has(code)) return { ok: false, reason: 'invalid-code', code }
  if ((code !== undefined && RATE_LIMIT.has(code)) || record.status === 429) return { ok: false, reason: 'rate-limit', code }
  if (code !== undefined && NOT_ALLOWED.has(code)) return { ok: false, reason: 'not-allowed', code }
  return { ok: false, reason: 'unknown', code }
}
