// 引っぱって更新の印(詳細設計 5.7.2、design_spec 8-1)。App の .pullArea(指に付けて動かす枠)の中の先頭に置き、
// 枠が下がって空いた上の所の中央に、iOS と同じ形の回る印(8本の線)を出す。文字は出さない。
// - 線は表示の量に合わせて1本ずつ現れ、64px で8本そろう。更新中は8本で回る(1周 --duration-spin、8段)
// - 読み上げは見えない文字(aria-live="polite"):8本そろったら「離すと更新」、更新中「更新しています」、終わったら空。印は aria-hidden
// - 成功は何も知らせない。失敗のトースト「最新に更新できませんでした」は DataProvider が出す(開き直しの読み直しと同じ文)
// - 動きを減らす設定の置き場所と、回さないことは CSS(@media)で決める
import { useCallback, type RefObject } from 'react'
import { useRefreshData } from '../data/DataProvider.tsx'
import { PULL_THRESHOLD, usePullToRefresh, type PullPhase } from '../lib/usePullToRefresh.ts'
import styles from './PullIndicator.module.css'

/** 印の線の本数 */
export const SPINNER_LINES = 8

const SPOKEN: Record<PullPhase, string> = {
  idle: '',
  pulling: '',
  armed: '離すと更新',
  refreshing: '更新しています',
}

/** 表示の量に合う線の本数(0〜8)。64px で8本 */
export function visibleLines(distance: number): number {
  return Math.min(SPINNER_LINES, Math.max(0, Math.floor((distance / PULL_THRESHOLD) * SPINNER_LINES)))
}

// 線の位置(SVG の座標。28×28 の中心から外へ)。描画のたびに計算しないよう、先に作っておく
const CENTER = 14
const INNER = 5.5
const OUTER = 12
const LINES = Array.from({ length: SPINNER_LINES }, (_, index) => {
  const angle = (index * 2 * Math.PI) / SPINNER_LINES
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  return {
    x1: CENTER + INNER * sin,
    y1: CENTER - INNER * cos,
    x2: CENTER + OUTER * sin,
    y2: CENTER - OUTER * cos,
    // 回っている間は、先頭の線から順に薄くして、回る向きが分かるようにする(iOS と同じ)
    fade: 1 - index / SPINNER_LINES,
  }
})

interface PullIndicatorProps {
  /** 指に付けて動かす枠(App の .pullArea) */
  targetRef: RefObject<HTMLElement | null>
  /** データを読めているときだけ受ける */
  enabled: boolean
}

export function PullIndicator({ targetRef, enabled }: PullIndicatorProps) {
  const refresh = useRefreshData()
  const onRefresh = useCallback(() => refresh(), [refresh])
  const { phase, distance } = usePullToRefresh(targetRef, { enabled, onRefresh })
  const spinning = phase === 'refreshing'
  const count = spinning ? SPINNER_LINES : visibleLines(distance)

  return (
    <>
      {/* 読み上げの欄は最初から置き、文言だけを入れる(後から欄を足すと読み上げられないことがある)。印を隠しても消えないよう、印の外に置く */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {SPOKEN[phase]}
      </span>
      <div className={styles.indicator} data-phase={phase} aria-hidden="true">
        <svg className={spinning ? styles.spinnerSpinning : styles.spinner} viewBox="0 0 28 28" focusable="false" data-lines={count}>
          {LINES.slice(0, count).map((line, index) => (
            <line
              // 線の並びは変わらないので、順番を鍵にする
              key={index}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              strokeWidth={2.5}
              strokeLinecap="round"
              opacity={spinning ? line.fade : 1}
            />
          ))}
        </svg>
      </div>
    </>
  )
}
