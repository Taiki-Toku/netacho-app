import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vite(ビルド・開発サーバー)と Vitest(試験)の設定を1つにまとめている。
// vitest/config の defineConfig は Vite の設定に test の項目を足したもの。
export default defineConfig({
  // ハッシュで画面を切り替えるため、相対パスで配れる(置き場所を選ばない)
  base: './',
  plugins: [react()],
  test: {
    // 画面の部品を試験するため、ブラウザーの DOM を模した jsdom で動かす
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
