// 左右のスワイプを検出する(詳細の画面で前後のネタへ移る)。
// 触り始めと離した位置の差を見るだけの単純な作り。縦の動き(スクロール)が大きいときは無視する。
import { useRef, type TouchEvent } from 'react'

interface SwipeHandlers {
  onTouchStart: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
}

interface SwipeOptions {
  /** 左へ払った(次へ) */
  onLeft: () => void
  /** 右へ払った(前へ) */
  onRight: () => void
}

/** 横に動いた最小の距離(px)。これより小さい動きは、押し間違いとして無視する */
const MIN_DISTANCE = 56

export function useSwipe({ onLeft, onRight }: SwipeOptions): SwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null)

  return {
    onTouchStart: (event) => {
      const touch = event.changedTouches[0]
      start.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY }
    },
    onTouchEnd: (event) => {
      const touch = event.changedTouches[0]
      const from = start.current
      start.current = null
      if (touch === undefined || from === null) return
      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dy) > Math.abs(dx) / 2) return
      if (dx < 0) onLeft()
      else onRight()
    },
  }
}
