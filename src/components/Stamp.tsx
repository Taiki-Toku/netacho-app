// 「済」の検印。評価済みのネタに押す
import styles from './Stamp.module.css'

export function Stamp() {
  return (
    <span className={styles.stamp} role="img" aria-label="評価済み">
      済
    </span>
  )
}
