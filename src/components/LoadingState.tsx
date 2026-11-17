// 読み込み中のスケルトン:見出しと記事の行の形だけを先に出す。
// 形は飾りなので読み上げから外し、「読み込み中」だけを伝える
import styles from './LoadingState.module.css'

const ROWS = 4

export function LoadingState() {
  return (
    <div className={styles.loading} role="status">
      <span className="visually-hidden">読み込み中</span>
      <div aria-hidden="true">
        <div className={styles.heading} />
        <div className={styles.subtitle} />
        <ul className={styles.rows}>
          {Array.from({ length: ROWS }, (_, index) => (
            <li key={index} className={styles.row}>
              <div className={styles.text}>
                <div className={styles.label} />
                <div className={styles.title} />
                <div className={styles.titleShort} />
              </div>
              <div className={styles.thumb} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
