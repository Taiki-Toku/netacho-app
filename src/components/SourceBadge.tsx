// 画像が無い記事の、小さな頭文字の札。出典(媒体名)の横に置く(仕様 4 章-5、5 章)。詳細・トップの枠・一覧の行で共通。
// 飾りなので読み上げない(媒体名は隣に文字で出ている)
import styles from './SourceBadge.module.css'

export function SourceBadge({ initial }: { initial: string }) {
  return (
    <span className={styles.badge} aria-hidden="true">
      {initial}
    </span>
  )
}
