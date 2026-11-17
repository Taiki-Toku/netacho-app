import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 書体はアプリに同梱する(外部の配信元を読まない)。Noto Sans JP は使う太さ(400 / 600 / 700)だけを読む。
// fontsource の 400.css などは、文字の範囲ごとに小さく分けた @font-face の集まりで、ブラウザーは画面に出る文字の分だけを取りに行く
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/noto-sans-jp/400.css'
import '@fontsource/noto-sans-jp/600.css'
import '@fontsource/noto-sans-jp/700.css'
import '@fontsource/space-grotesk/600.css'
import './styles/tokens.css'
import './styles/global.css'
import { App } from './App.tsx'
import { backendFromEnv } from './data/supabaseBackend.ts'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('index.html に id="root" の要素がありません')
}

// 環境変数が2つともあれば Supabase モード(ログイン → Supabase のネタ)。無ければ今までどおり
const backend = backendFromEnv(import.meta.env)

createRoot(rootElement).render(
  <StrictMode>
    <App backend={backend} />
  </StrictMode>,
)
