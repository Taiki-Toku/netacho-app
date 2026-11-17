// NODAL の印(public/logo/nodal-mark.svg と同じ形)。上のバーでは --ink と --accent で描く(仕様 6 章)
import styles from './BrandMark.module.css'

export function BrandMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 190 150" aria-hidden="true" focusable="false">
      <g className={styles.ink}>
        <polygon points="4,4 70,4 186,112 186,146 122,146 4,40" />
        <polygon points="4,74 62,128 62,146 4,146" />
      </g>
      <polygon className={styles.accent} points="122,4 186,4 186,86 122,26" />
    </svg>
  )
}
