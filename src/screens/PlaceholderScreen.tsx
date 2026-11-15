// まだ作っていない画面の仮の表示(進め方の次の区切りで置き換える)
import styles from './PlaceholderScreen.module.css'

interface PlaceholderScreenProps {
  title: string
}

export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <section className={styles.wrap} aria-labelledby="placeholder-title">
      <h1 id="placeholder-title" className={styles.title}>
        {title}
      </h1>
      <p className={styles.note}>この画面は、次の区切りで作ります。</p>
    </section>
  )
}
