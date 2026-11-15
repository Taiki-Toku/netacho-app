// すべての試験の前に読み込まれる設定。
// - jest-dom:toBeInTheDocument() などの DOM 向けの検証を使えるようにする
// - cleanup:試験ごとに描画した画面を片付ける(vitest の globals を使わないため、明示する)
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
