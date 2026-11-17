// 星の指標(話題度・実用度・遊べる度)を5段階のメーターで出す。読み上げには「話題度 3/5」と伝える
import styles from './StarMeter.module.css'

interface StarMeterProps {
  label: string
  value: number
}

const CELLS = [0, 1, 2, 3, 4] as const

export function StarMeter({ label, value }: StarMeterProps) {
  const level = Math.min(5, Math.max(0, Math.round(value)))
  return (
    <div className={styles.meter}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <span className={styles.cells} role="img" aria-label={`${label} ${level}/5`}>
        {CELLS.map((index) => (
          <span key={index} className={index < level ? styles.on : styles.off} />
        ))}
      </span>
      <span className={styles.value} aria-hidden="true">
        {level}/5
      </span>
    </div>
  )
}
