// 0件のときの案内。何が無いかと、次に何をすればよいかを書く
import styles from './page.module.css'

interface EmptyStateProps {
  title: string
  text: string
  /** 上の見出しから少し離す */
  spaced?: boolean
}

export function EmptyState({ title, text, spaced = false }: EmptyStateProps) {
  return (
    <div className={spaced ? styles.emptySpaced : styles.empty}>
      <strong className={styles.emptyTitle}>{title}</strong>
      <p className={styles.emptyText}>{text}</p>
    </div>
  )
}
