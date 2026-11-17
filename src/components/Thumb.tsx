// 記事の画像。URL が安全(imageHref)で読み込めたときだけ出す。
// 無い・危ない・読み込みに失敗したときは、呼ぶ側が画像の場所ごと出さず、出典の横に小さな札(SourceBadge)を出す(仕様 4〜5 章)
import { useState } from 'react'
import { imageHref } from '../lib/safeUrl.ts'
import styles from './Thumb.module.css'

interface ThumbProps {
  /** 外から来た画像の URL(無いこともある) */
  url: string | undefined
  /** 先頭の大きな画像は lazy にしない(画面に入った時点で読むため) */
  eager?: boolean
  /** 読み込みに失敗したとき */
  onFail: () => void
}

// img の width / height は比率の手がかり(枠の大きさは CSS で決める)。見本の画像と同じ 780×460
const WIDTH = 780
const HEIGHT = 460

/** 画像を出せるか(URL が安全で、読み込みに失敗していない)と、失敗したときに Thumb から呼ぶ関数 */
export function useThumb(url: string | undefined): { shown: boolean; onFail: () => void } {
  const [failed, setFailed] = useState(false)
  return {
    shown: url !== undefined && imageHref(url) !== null && !failed,
    onFail: () => {
      setFailed(true)
    },
  }
}

export function Thumb({ url, eager = false, onFail }: ThumbProps) {
  const href = url === undefined ? null : imageHref(url)
  if (href === null) return null
  return (
    <img
      className={styles.image}
      src={href}
      alt=""
      width={WIDTH}
      height={HEIGHT}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // 外部の画像の配信元に、このアプリの URL(Referer)を渡さない
      referrerPolicy="no-referrer"
      onError={onFail}
    />
  )
}
