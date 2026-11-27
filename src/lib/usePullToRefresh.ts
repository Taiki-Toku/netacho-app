// 引っぱって更新(詳細設計 5.5.2)。スマホ(タッチ)だけ。PC はタッチのイベントが来ないので何も変わらない。
// - ページの一番上(window.scrollY === 0)で、下へ引いたときだけ始める。最初の約 10px で縦か横かを決め、
//   横・上向きなら何もしない(詳細の左右のスワイプ useSwipe と取り合わない)
// - 引いている間は touchmove の preventDefault で、iPhone の標準の引っぱり(ページの弾み)と重ねない。
//   止めるのは引っぱりを始めたあとだけ(ふだんのスクロールは止めない)。そのため touchmove は passive: false で登録する
// - 引いた量(最大 80px)は CSS 変数 --pull-y に入れ、見た目は CSS 側に書く(ADR-004 の --swipe-x と同じ方法)
// - 64px 以上で離すと onRefresh を呼び、終わるまで 'refreshing'。届かなければ戻す
// - 動きを減らす設定(prefers-reduced-motion)では --pull-y を付けない(表示を動かさず、文言だけを出す)
import { useEffect, useRef, useState, type RefObject } from 'react'

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing'

/** 縦か横かを決めるまでの距離(px)。useSwipe と同じ */
const AXIS_LOCK = 10
/** 表示を引き出せる最大の量(px)。design_spec の --sp-20 と同じ */
export const PULL_MAX = 80
/** 離すと更新する量(px) */
export const PULL_THRESHOLD = 64

interface Gesture {
  startX: number
  startY: number
  axis: 'undecided' | 'pull'
  distance: number
  reducedMotion: boolean
}

interface PullOptions {
  /** false の間は受けない(読み込み中・エラーの画面) */
  enabled: boolean
  /** 64px 以上引いて離したときに呼ぶ。返した約束が終わるまで 'refreshing' */
  onRefresh: () => Promise<unknown>
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** ref:引いた量に合わせて動かす表示の要素 */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, { enabled, onRefresh }: PullOptions): PullPhase {
  const [phase, setPhase] = useState<PullPhase>('idle')
  // イベントの処理から今の値を見るため(登録し直さずに済むよう、ref に置く)
  const options = useRef({ enabled, onRefresh })
  const busy = useRef(false)
  useEffect(() => {
    options.current = { enabled, onRefresh }
  }, [enabled, onRefresh])

  useEffect(() => {
    let gesture: Gesture | null = null
    let mounted = true

    function place(distance: number) {
      ref.current?.style.setProperty('--pull-y', `${distance}px`)
    }
    function clear() {
      ref.current?.style.removeProperty('--pull-y')
    }
    function reset() {
      const wasPulling = gesture?.axis === 'pull'
      gesture = null
      clear()
      if (wasPulling) setPhase('idle')
    }

    function handleStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        // 2本目の指(拡大など)が来たらやめる
        reset()
        return
      }
      gesture = null
      const touch = event.touches[0]
      if (touch === undefined || !options.current.enabled || busy.current || window.scrollY !== 0) return
      // 入力欄の中では、文字の選択やカーソルの移動を優先する(useSwipe と同じ)
      if (event.target instanceof Element && event.target.closest('textarea, input, select') !== null) return
      gesture = { startX: touch.clientX, startY: touch.clientY, axis: 'undecided', distance: 0, reducedMotion: prefersReducedMotion() }
    }

    function handleMove(event: TouchEvent) {
      const current = gesture
      const touch = event.touches[0]
      if (current === null || touch === undefined) return
      if (event.touches.length > 1) {
        reset()
        return
      }
      const dx = touch.clientX - current.startX
      const dy = touch.clientY - current.startY
      if (current.axis === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        // 下向きで、横より縦が大きいときだけ引っぱり。ほかは指を離すまで何もしない(スクロールとスワイプに任せる)
        if (dy <= 0 || Math.abs(dx) >= Math.abs(dy)) {
          gesture = null
          return
        }
        current.axis = 'pull'
      }
      // 引っぱりの間だけ、ブラウザーのスクロールと弾みを止める
      if (event.cancelable) event.preventDefault()
      const distance = Math.min(Math.max(dy, 0), PULL_MAX)
      current.distance = distance
      if (!current.reducedMotion) place(distance)
      setPhase(distance >= PULL_THRESHOLD ? 'armed' : 'pulling')
    }

    function handleEnd() {
      const current = gesture
      gesture = null
      if (current?.axis !== 'pull') return
      clear()
      if (current.distance < PULL_THRESHOLD) {
        setPhase('idle')
        return
      }
      busy.current = true
      setPhase('refreshing')
      void options.current
        .onRefresh()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false
          if (mounted) setPhase('idle')
        })
    }

    window.addEventListener('touchstart', handleStart, { passive: true })
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleEnd)
    window.addEventListener('touchcancel', reset)
    return () => {
      mounted = false
      window.removeEventListener('touchstart', handleStart)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', reset)
      clear()
    }
  }, [ref])

  return phase
}
