// 記事の画像。URL が安全(imageHref)で読み込めたときだけ img を出し、無い・危ない・読み込みに失敗したときは頭文字の札にする(仕様 4〜5 章)
import { useState } from 'react'
import { imageHref } from '../lib/safeUrl.ts'
import styles from './Thumb.module.css'

interface ThumbProps {
  /** 外から来た画像の URL(無いこともある) */
  url: string | undefined
  /** 札に出す頭文字 */
  initial: string
  /** 先頭の大きな画像は lazy にしない(画面に入った時点で読むため) */
  eager?: boolean
}

// img の width / height は比率の手がかり(枠の大きさは CSS で決める)。見本の画像と同じ 780×460
const WIDTH = 780
const HEIGHT = 460

export function Thumb({ url, initial, eager = false }: ThumbProps) {
  const [failed, setFailed] = useState(false)
  const href = url === undefined ? null : imageHref(url)

  if (href === null || failed) {
    return (
      <div className={styles.initial} aria-hidden="true">
        {initial}
      </div>
    )
  }
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
      onError={() => {
        setFailed(true)
      }}
    />
  )
}
