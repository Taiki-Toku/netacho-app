import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'
import { shortCommit } from './src/lib/buildInfo.ts'
import { securityHeaders } from './src/lib/securityHeaders.ts'

// Vite(ビルド・開発サーバー)と Vitest(試験)の設定を1つにまとめている。
// vitest/config の defineConfig は Vite の設定に test の項目を足したもの。
// このファイルと、ここから読み込むファイル(src/lib/buildInfo.ts・src/lib/securityHeaders.ts)は、ci.yml の workflow-guard の対象。
// ここで読み込むファイルを増やしたら、workflow-guard の対象にも足す
export default defineConfig(({ mode }) => {
  // 版の表示に使うコミット。Cloudflare Pages のビルドでは CF_PAGES_COMMIT_SHA が入る(手元では無いので local)。
  // 第3引数で CF_PAGES_ で始まる名前だけに絞る(ほかの環境変数は読まない)
  const commit = shortCommit(loadEnv(mode, '.', 'CF_PAGES_').CF_PAGES_COMMIT_SHA)
  // CSP の通信先。アプリが import.meta.env で読むのと同じ仕組みで読むので、アプリがつなぐ先と必ずそろう。
  // 第3引数でこの名前だけに絞る。値は表示しない
  const supabaseUrl = loadEnv(mode, '.', 'VITE_SUPABASE_URL').VITE_SUPABASE_URL

  return {
    // ハッシュで画面を切り替えるため、相対パスで配れる(置き場所を選ばない)
    base: './',
    plugins: [
      react(),
      // ビルドのときだけ、Cloudflare Pages に読ませるセキュリティヘッダー(dist/_headers)を出力に足す。
      // URL の形が違えば securityHeaders が投げてビルドが失敗し、本番は前の配信のまま残る
      {
        name: 'netacho-security-headers',
        apply: 'build',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: '_headers', source: securityHeaders(supabaseUrl) })
        },
      },
    ],
    build: {
      // 小さな画像・フォントを data: の URL にして埋め込むのを止める(埋め込むと CSP に data: を足すことになる)
      assetsInlineLimit: 0,
    },
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
