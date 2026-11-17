/// <reference types="vite/client" />

// アプリが読む環境変数(.env.local に書く。.env.example を参照)。2つとも値があるときだけ Supabase モードになる
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
