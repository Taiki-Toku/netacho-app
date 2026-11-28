// 引っぱって更新(詳細設計 5.5.2 の始め方、5.7.2 の iOS の形)。スマホ(タッチ)だけ。PC はタッチのイベントが来ないので何も変わらない。
// - ページの一番上(window.scrollY === 0)で、下へ引いたときだけ始める。最初の約 10px で縦か横かを決め、
//   横・上向きなら何もしない(詳細の左右のスワイプ useSwipe と取り合わない)。入力欄の中では始めない
// - 引いている間は touchmove の preventDefault で、iPhone の標準の引っぱり(ページの弾み)と重ねない。
//   止めるのは引っぱりを始めたあとだけ(ふだんのスクロールは止めない)。そのため touchmove は passive: false で登録する
// - 指の動きに重さを付けた「表示の量」(pullDistance)を、動かす枠(App の .pullArea)の CSS 変数 --pull-y に入れ、
//   data-pull で引っぱり中(pulling)・更新中(refreshing)を示す。transform は CSS 側で data-pull があるときだけ付ける
//   (ADR-004 の --swipe-x と同じ方法)。更新中は --pull-y を var(--sp-13)(画面を止める高さ)にする
// - 表示の量 64px 以上で離すと onRefresh を呼び、終わるまで 'refreshing'。届かなければ戻す
// - 動きを減らす設定(prefers-reduced-motion)では --pull-y も data-pull も付けない(画面を動かさない)
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing'

/** 縦か横かを決めるまでの距離(px)。useSwipe と同じ */
const AXIS_LOCK = 10
/** 重さの式の R(px)。表示の量はこの値に近づくが越えない */
export const PULL_RESISTANCE = 200
/** 離すと更新する表示の量(px) */
export const PULL_THRESHOLD = 64
/** 更新中に画面を止める高さ(design_spec の --sp-13) */
const REFRESHING_OFFSET = 'var(--sp-13)'

/** 表示の量 = R ×(1 − 1 /(1 + 引いた量 / R))。引くほど重くなる(詳細設計 5.7.2) */
export function pullDistance(dragged: number): number {
  const amount = Math.max(dragged, 0)
  return PULL_RESISTANCE * (1 - 1 / (1 + amount / PULL_RESISTANCE))
}

export interface PullState {
  phase: PullPhase
  /** いまの表示の量(px)。引っぱり中だけ 0 より大きい(更新中・戻したあとは 0) */
  distance: number
}

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

const IDLE: PullState = { phase: 'idle', distance: 0 }

/** ref:指に付けて動かす枠(App の .pullArea) */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, { enabled, onRefresh }: PullOptions): PullState {
  const [state, setState] = useState<PullState>(IDLE)
  // イベントの処理から今の値を見るため(登録し直さずに済むよう、ref に置く)
  const options = useRef({ enabled, onRefresh })
  const busy = useRef(false)
  // 描画の直後(画面に出る前)に入れ替える。useEffect だと、読み込みが終わって画面が出てから少しの間、前の値(enabled: false)のままになる
  useLayoutEffect(() => {
    options.current = { enabled, onRefresh }
  }, [enabled, onRefresh])

  useEffect(() => {
    let gesture: Gesture | null = null
    let mounted = true

    function place(offset: string, mode: 'pulling' | 'refreshing') {
      ref.current?.style.setProperty('--pull-y', offset)
      ref.current?.setAttribute('data-pull', mode)
    }
    function clear() {
      ref.current?.style.removeProperty('--pull-y')
      ref.current?.removeAttribute('data-pull')
    }
    function reset() {
      const wasPulling = gesture?.axis === 'pull'
      gesture = null
      // 引っぱり中だけ戻す(更新中の高さは、更新が終わるまで残す)
      if (!wasPulling) return
      clear()
      setState(IDLE)
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
      const distance = pullDistance(dy)
      current.distance = distance
      if (!current.reducedMotion) place(`${distance}px`, 'pulling')
      setState({ phase: distance >= PULL_THRESHOLD ? 'armed' : 'pulling', distance })
    }

    function handleEnd() {
      const current = gesture
      gesture = null
      if (current?.axis !== 'pull') return
      if (current.distance < PULL_THRESHOLD) {
        clear()
        setState(IDLE)
        return
      }
      busy.current = true
      // 更新中は決まった高さで止める(動きを減らす設定では動かさない)
      if (current.reducedMotion) clear()
      else place(REFRESHING_OFFSET, 'refreshing')
      setState({ phase: 'refreshing', distance: 0 })
      void options.current
        .onRefresh()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false
          // 外したあと(画面の切り替え)には触らない
          if (!mounted) return
          clear()
          setState(IDLE)
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

  return state
}
