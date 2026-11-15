// すべての試験の前に読み込まれる設定。
// - jest-dom:toBeInTheDocument() などの DOM 向けの検証を使えるようにする
// - cleanup:試験ごとに描画した画面を片付ける(vitest の globals を使わないため、明示する)
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom はスクロールを実装していない(呼ぶと「未実装」の警告が出る)ため、何もしない関数に置き換える
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })

afterEach(() => {
  cleanup()
})
