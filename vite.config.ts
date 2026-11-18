import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'
import { shortCommit } from './src/lib/buildInfo.ts'

// Vite(ビルド・開発サーバー)と Vitest(試験)の設定を1つにまとめている。
// vitest/config の defineConfig は Vite の設定に test の項目を足したもの。
export default defineConfig(({ mode }) => {
  // 版の表示に使うコミット。Cloudflare Pages のビルドでは CF_PAGES_COMMIT_SHA が入る(手元では無いので local)。
  // 第3引数で CF_PAGES_ で始まる名前だけに絞る(ほかの環境変数は読まない)
  const commit = shortCommit(loadEnv(mode, '.', 'CF_PAGES_').CF_PAGES_COMMIT_SHA)

  return {
    // ハッシュで画面を切り替えるため、相対パスで配れる(置き場所を選ばない)
    base: './',
    plugins: [react()],
    // ビルドのときに、コードの中の名前を値(JSON の文字列)に置き換える。型は src/vite-env.d.ts
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __APP_COMMIT__: JSON.stringify(commit),
    },
    test: {
      // 画面の部品を試験するため、ブラウザーの DOM を模した jsdom で動かす
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // 試験では CSS を読み込まない(空になる)のが既定。重なる順(z-index)・スクロールの余白・「先頭へ戻る」の出し入れ・画像の押す操作・
      // 左メニューの選択中の文字の試験で使うファイルだけ通す
      css: {
        include: [
          /src\/styles\/(tokens|global)\.css/,
          /src\/components\/(TopBar|ReadingProgress|ScrollTopButton|ArticleRow|Sidebar)\.module\.css/,
          /src\/screens\/HomeScreen\.module\.css/,
        ],
      },
    },
  }
})
