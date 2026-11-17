// 通信エラーの表示:何が起きたかと、次にできること(読み直す)を出す
import styles from './page.module.css'

interface ErrorStateProps {
  /** 読み込みで起きたことの説明(試験と原因の調べのため、小さく添える) */
  detail?: string
  onRetry: () => void
}

export function ErrorState({ detail, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.emptySpaced}>
      {/* 読み上げで知らせるのは文だけ(ボタンの名前まで一度に読ませない) */}
      <div role="alert">
        <strong className={styles.emptyTitle}>データを読み込めませんでした</strong>
        <p className={styles.emptyText}>通信の状態を確かめて、もう一度読み込んでください。</p>
        {detail !== undefined && detail !== '' ? <p className={styles.caption}>{detail}</p> : null}
      </div>
      <button type="button" className={styles.retry} onClick={onRetry}>
        もう一度読み込む
      </button>
    </div>
  )
}
