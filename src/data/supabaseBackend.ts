// Supabase のクライアントを作る所(アプリの中でここ1か所だけ)。画面は Backend の関数だけを使い、クライアントには触れない。
// 使う鍵は publishable キー(ブラウザーに配ってよい鍵)だけ。読める行は Supabase 側の RLS が決める(items は許可ユーザーだけ)。
import { createClient } from '@supabase/supabase-js'
import { classifyAuthError, safeErrorCode, supabaseConfigFrom, type AuthResult, type Backend, type SupabaseConfig } from './backend.ts'
import { ITEM_COLUMNS, rowsToItems } from './itemRow.ts'

const MAX_ITEMS = 1000

/** 環境変数が2つともあれば Supabase の Backend を作り、無ければ undefined(今までどおり local-data → fixtures)。作り方は試験で差し替える */
export function backendFromEnv(
  env: Parameters<typeof supabaseConfigFrom>[0],
  create: (config: SupabaseConfig) => Backend = createSupabaseBackend,
): Backend | undefined {
  const config = supabaseConfigFrom(env)
  return config === null ? undefined : create(config)
}

export function createSupabaseBackend(config: SupabaseConfig): Backend {
  // セッションは supabase-js の既定のまま(端末の localStorage に保存し、期限の前に自動で更新する)。
  // detectSessionInUrl だけ切る:ログインはメールのコードで行い、URL からトークンを受け取る経路を使わないため
  const client = createClient(config.url, config.publishableKey, {
    auth: { detectSessionInUrl: false },
  })

  async function call(run: () => Promise<{ error: unknown }>): Promise<AuthResult> {
    try {
      const { error } = await run()
      return error === null ? { ok: true } : classifyAuthError(error)
    } catch (error: unknown) {
      return classifyAuthError(error)
    }
  }

  return {
    auth: {
      watchSession(onChange) {
        // 登録すると INITIAL_SESSION で今の状態が届く。中で await しない(supabase-js の注意書きのとおり)
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          onChange(session !== null)
        })
        return () => {
          data.subscription.unsubscribe()
        }
      },
      sendCode: (email) => call(() => client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })),
      verifyCode: (email, token) => call(() => client.auth.verifyOtp({ email, token, type: 'email' })),
      async signOut() {
        // 既定(global)はサーバーの側でもセッションを無効にする。ただし通信に失敗すると、例外を投げずに error を返し、
        // 端末のセッションを消さない。そのときは端末だけのログアウト(local)で、端末のセッションを確実に消す
        try {
          const { error } = await client.auth.signOut()
          if (error === null) return
        } catch {
          // 下で端末のセッションを消す
        }
        try {
          await client.auth.signOut({ scope: 'local' })
        } catch {
          // local は通信しないので、ここには来ない想定
        }
      },
    },
    async loadItems() {
      const { data, error } = await client
        .from('items')
        .select(ITEM_COLUMNS)
        .order('date', { ascending: false })
        .order('sort_order', { ascending: true })
        .limit(MAX_ITEMS)
      if (error !== null) {
        // 画面に出すのは code だけ(サーバーの文言は出さない)
        const code = safeErrorCode(error.code)
        throw new Error(code === undefined ? 'ニュースを読み込めませんでした' : `ニュースを読み込めませんでした(${code})`)
      }
      return rowsToItems(data)
    },
  }
}
