// コーナー名(slot)の札。テロップの上に載る傾いた札。値は決まっていないのでそのまま表示する
import styles from './SlotTag.module.css'

interface SlotTagProps {
  slot: string
  muted?: boolean
}

export function SlotTag({ slot, muted = false }: SlotTagProps) {
  if (slot === '') return null
  return (
    <span className={muted ? `${styles.tag} ${styles.muted}` : styles.tag}>
      <span className={styles.text}>{slot}</span>
    </span>
  )
}
