// 記事の画像。URL が安全(imageHref)で読み込めたときだけ出す。
// 無い・危ない・読み込みに失敗したときは、ジャンルの画像を渡されていればそれを出し(トップの枠と詳細だけ。詳細設計 5.7.4)、
// それも無い・失敗したときは、呼ぶ側が画像の場所ごと出さず、出典の横に小さな札(SourceBadge)を出す(仕様 4〜5 章)
import { useState } from 'react'
import { imageHref } from '../lib/safeUrl.ts'
import styles from './Thumb.module.css'

/** いま出す画像:元記事の画像(article)、ジャンルの画像(genre)、出さない(null) */
export interface ThumbState {
  shown: boolean
  src: string | null
  kind: 'article' | 'genre' | null
  /** 読み込みに失敗したとき(Thumb から呼ぶ)。元記事の画像ならジャンルの画像へ、ジャンルの画像なら出さないへ進む */
  onFail: () => void
}

interface ThumbProps {
  thumb: ThumbState
  /** 先頭の大きな画像は lazy にしない(画面に入った時点で読むため) */
  eager?: boolean
}

// img の width / height は比率の手がかり(枠の大きさは CSS で決める)。見本の画像と同じ 780×460
const WIDTH = 780
const HEIGHT = 460

/**
 * 出す画像を決める。url は外から来た画像の URL(無いこともある)、genreImage はジャンルの画像のパス
 * (genreImages.ts の表の値だけ。渡さなければジャンルの画像は出さない。一覧・バックナンバーの行)
 */
export function useThumb(url: string | undefined, genreImage: string | null = null): ThumbState {
  const [articleFailed, setArticleFailed] = useState(false)
  const [genreFailed, setGenreFailed] = useState(false)
  const articleHref = url === undefined ? null : imageHref(url)
  const genreHref = genreImage === null ? null : imageHref(genreImage)
  if (articleHref !== null && !articleFailed) {
    return { shown: true, src: articleHref, kind: 'article', onFail: () => setArticleFailed(true) }
  }
  if (genreHref !== null && !genreFailed) {
    return { shown: true, src: genreHref, kind: 'genre', onFail: () => setGenreFailed(true) }
  }
  return { shown: false, src: null, kind: null, onFail: () => undefined }
}

export function Thumb({ thumb, eager = false }: ThumbProps) {
  if (thumb.src === null) return null
  const image = (
    <img
      // 画像が替わったら別の img として作り直す(前の画像の読み込みの結果を持ち越さない)
      key={thumb.src}
      className={styles.image}
      src={thumb.src}
      alt=""
      width={WIDTH}
      height={HEIGHT}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // 外部の画像の配信元に、このアプリの URL(Referer)を渡さない
      referrerPolicy="no-referrer"
      onError={thumb.onFail}
    />
  )
  if (thumb.kind !== 'genre') return image
  // ジャンルの画像は元記事の写真ではないことを、画像の右下の札で示す(取り違えないため)。
  // 札を重ねる基準の枠をここで持つ(呼ぶ側の枠の CSS を変えずに済む)
  return (
    <span className={styles.genreFrame}>
      {image}
      <span className={styles.genreTag}>イメージ</span>
    </span>
  )
}
