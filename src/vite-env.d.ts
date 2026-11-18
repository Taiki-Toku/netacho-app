/// <reference types="vite/client" />

// アプリが読む環境変数(.env.local に書く。.env.example を参照)。2つとも値があるときだけ Supabase モードになる
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// vite.config.ts の define がビルドのときに埋め込む値(設定の画面の「版」)
/** package.json の version */
declare const __APP_VERSION__: string
/** 配信のときのコミットの先頭7文字。手元では local */
declare const __APP_COMMIT__: string
