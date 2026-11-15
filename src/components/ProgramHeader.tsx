// 番組ヘッダー。番組名と、最新の放送日を大きな数字で出す
import { useData } from '../data/DataProvider.tsx'
import { latestDate } from '../data/queries.ts'
import { dateParts, formatDateLong } from '../lib/format.ts'
import styles from './ProgramHeader.module.css'

export function ProgramHeader() {
  const state = useData()
  const date = state.status === 'ready' ? latestDate(state.data.items) : null
  const parts = date === null ? null : dateParts(date)
  const isSample = state.status === 'ready' && state.data.source === 'fixtures'

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>AIネタ帳</span>
          {isSample ? <span className={styles.note}>見本データ</span> : null}
        </div>
        {date !== null && parts !== null ? (
          <p className={styles.date}>
            <span className="visually-hidden">放送日 {formatDateLong(date)}</span>
            <span className={styles.year} aria-hidden="true">
              {parts.year}
            </span>
            <span className={styles.day} aria-hidden="true">
              {parts.month}.{parts.day}
            </span>
            <span className={styles.weekday} aria-hidden="true">
              <span>{parts.weekday}</span>
            </span>
          </p>
        ) : date !== null ? (
          <p className={styles.date}>
            <span className={styles.year}>{date}</span>
          </p>
        ) : null}
      </div>
    </header>
  )
}
