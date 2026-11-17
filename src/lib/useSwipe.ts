// 左右のスワイプ(詳細の画面で前後のニュースへ移る。仕様 7 章)。
// - 記事を指の動きに合わせて横に動かす。最初の約 10px で縦か横かを決め、縦ならスワイプにしない(縦のスクロールはブラウザーに任せる)
// - 離したとき、画面幅の 25% 以上動かしたか、速く払っていれば、記事を画面の外へ送り出してから移る。届かなければ元の位置へ戻す
// - 移る先が無い向き(最初・最後の記事)は、重い手ごたえで少しだけ動き、離すと戻る
// - 動きを減らす設定(prefers-reduced-motion)では記事を動かさず、離した時点で切り替える
// 位置は CSS 変数 --swipe-x に入れ、transform と transition は CSS 側(ItemScreen.module.css)に書く(docs/adr/004-swipe.md)
import { useEffect, useLayoutEffect, useRef, type RefObject, type TouchEvent } from 'react'

interface SwipeOptions {
  /** 左へ払った先(次)があるか */
  canLeft: boolean
  /** 右へ払った先(前)があるか */
  canRight: boolean
  /** 左へ払った(次へ) */
  onLeft: () => void
  /** 右へ払った(前へ) */
  onRight: () => void
}

/** 触る範囲の要素(記事の全体)に付ける */
interface SwipeHandlers {
  onTouchStart: (event: TouchEvent) => void
  onTouchMove: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
  onTouchCancel: () => void
}

interface Gesture {
  startX: number
  startY: number
  /** undecided:まだ縦か横か決まっていない。y に決まったら、指を離すまで何もしない */
  axis: 'undecided' | 'x' | 'y'
  dx: number
  lastX: number
  lastTime: number
  /** 直近の横の速さ(px/ms。右が正) */
  velocity: number
  reducedMotion: boolean
}

/** 縦か横かを決めるまでの距離(px) */
const AXIS_LOCK = 10
/** 移るのに必要な距離(画面幅に対する割合) */
const DISTANCE_RATIO = 0.25
/** 「速く払った」とみなす速さ(px/ms) */
const FLICK_VELOCITY = 0.5
/** 「速く払った」とみなすのに必要な最小の距離(px)。小さな横ぶれで移らないようにする */
const FLICK_MIN_DISTANCE = 30
/** 指を止めてからこの時間(ms)がたって離したら、払ったとはみなさない */
const FLICK_STALE = 100
/** 移る先が無い向きに引いたときの、指に対する動きの割合 */
const EDGE_RESISTANCE = 0.3
/** transitionend が来ないとき(動きが打ち切られたなど)に、後始末をするまでの時間(ms)。CSS の --duration より長くする */
const SETTLE_FALLBACK = 400

/** スワイプで移った直後の記事を、どちらから入れるか。移る前の記事が書き、移った先の記事が読んで消す */
let pendingEnter: 'left' | 'right' | null = null

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** ref:指に合わせて動かす要素 */
export function useSwipe(ref: RefObject<HTMLElement | null>, { canLeft, canRight, onLeft, onRight }: SwipeOptions): SwipeHandlers {
  const gesture = useRef<Gesture | null>(null)
  /** 戻る・送り出す動きの途中なら、その打ち切り方。動きの途中は新しいスワイプを受けない */
  const cancelSettle = useRef<(() => void) | null>(null)

  // スワイプで移ってきた記事は、反対側から入れる。動きが終わったら印を外す(transform を残さない)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    if (pendingEnter !== null) element.setAttribute('data-swipe-enter', pendingEnter)
    pendingEnter = null
    const handleEnd = (event: Event) => {
      // 中の部品の animation も伝わってくるため、この要素のものだけを見る
      if (event.target === element) element.removeAttribute('data-swipe-enter')
    }
    element.addEventListener('animationend', handleEnd)
    return () => {
      element.removeEventListener('animationend', handleEnd)
    }
  }, [ref])

  // 画面を離れるときに、待っているタイマーを止める
  useEffect(
    () => () => {
      cancelSettle.current?.()
    },
    [],
  )

  function place(element: HTMLElement, x: number, mode: 'drag' | 'settle') {
    element.setAttribute('data-swipe', mode)
    element.style.setProperty('--swipe-x', `${x}px`)
  }

  function release(element: HTMLElement) {
    element.removeAttribute('data-swipe')
    element.style.removeProperty('--swipe-x')
  }

  /** x の位置までなめらかに動かし、終わったら done を呼ぶ */
  function settle(element: HTMLElement, x: number, done: () => void) {
    function stop() {
      window.clearTimeout(timer)
      element.removeEventListener('transitionend', handleEnd)
      cancelSettle.current = null
    }
    function finish() {
      stop()
      done()
    }
    function handleEnd(event: Event) {
      // 中のボタンなどの transition も伝わってくるため、この要素のものだけを見る
      if (event.target === element) finish()
    }
    element.addEventListener('transitionend', handleEnd)
    const timer = window.setTimeout(finish, SETTLE_FALLBACK)
    cancelSettle.current = stop
    place(element, x, 'settle')
  }

  /** 元の位置へ戻す。戻る・送り出す動きの途中なら、その動きに任せる(二重に動かさない) */
  function settleBack() {
    const element = ref.current
    if (!element?.hasAttribute('data-swipe') || cancelSettle.current !== null) return
    // すでに元の位置にあれば、動きを待たずに印を外す(動かないと transitionend が来ない)
    if (element.style.getPropertyValue('--swipe-x') === '0px') {
      release(element)
      return
    }
    settle(element, 0, () => {
      release(element)
    })
  }

  return {
    onTouchStart: (event) => {
      gesture.current = null
      const touch = event.touches[0]
      // 2本目の指が来たら(拡大など)、スワイプをやめて戻す
      if (event.touches.length > 1) {
        settleBack()
        return
      }
      if (touch === undefined || cancelSettle.current !== null) return
      // メモの欄の中では、文字の選択やカーソルの移動を優先する
      if (event.target instanceof Element && event.target.closest('textarea, input, select') !== null) return
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        axis: 'undecided',
        dx: 0,
        lastX: touch.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
        reducedMotion: prefersReducedMotion(),
      }
    },
    onTouchMove: (event) => {
      const current = gesture.current
      const touch = event.touches[0]
      if (current === null || touch === undefined) return
      if (event.touches.length > 1) {
        gesture.current = null
        settleBack()
        return
      }
      const dx = touch.clientX - current.startX
      const dy = touch.clientY - current.startY
      if (current.axis === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (current.axis === 'y') return
      const elapsed = event.timeStamp - current.lastTime
      if (elapsed > 0) current.velocity = (touch.clientX - current.lastX) / elapsed
      current.dx = dx
      current.lastX = touch.clientX
      current.lastTime = event.timeStamp
      const element = ref.current
      if (element === null || current.reducedMotion) return
      const blocked = dx < 0 ? !canLeft : !canRight
      place(element, blocked ? dx * EDGE_RESISTANCE : dx, 'drag')
    },
    onTouchEnd: (event) => {
      const current = gesture.current
      gesture.current = null
      if (current?.axis !== 'x') return
      const { dx } = current
      const toLeft = dx < 0
      const far = Math.abs(dx) >= window.innerWidth * DISTANCE_RATIO
      const flicked =
        Math.abs(dx) >= FLICK_MIN_DISTANCE &&
        event.timeStamp - current.lastTime <= FLICK_STALE &&
        Math.abs(current.velocity) >= FLICK_VELOCITY &&
        current.velocity < 0 === toLeft
      const go = dx !== 0 && (far || flicked) && (toLeft ? canLeft : canRight)
      const move = toLeft ? onLeft : onRight
      const element = ref.current
      if (element === null || current.reducedMotion) {
        if (go) move()
        return
      }
      if (!go) {
        settleBack()
        return
      }
      // 画面の外まで送り出してから移る。記事は外に置いたまま、移った先の記事に差し替わる
      settle(element, toLeft ? -window.innerWidth : window.innerWidth, () => {
        pendingEnter = toLeft ? 'right' : 'left'
        move()
      })
    },
    onTouchCancel: () => {
      gesture.current = null
      settleBack()
    },
  }
}
