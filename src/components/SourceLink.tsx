// 出典の表示。https: の URL だけをリンクにし、それ以外は文字のまま出す(CLAUDE.md セキュリティ規約)
import { hostOf, httpsHref } from '../lib/safeUrl.ts'
import styles from './SourceLink.module.css'

interface SourceLinkProps {
  url: string
  title: string
  /** リンクの文字。既定は「元の記事を読む」 */
  linkLabel?: string
}

export function SourceLink({ url, title, linkLabel = '元の記事を読む' }: SourceLinkProps) {
  if (url === '' && title === '') {
    return (
      <div className={styles.source}>
        <div>
          <span className={styles.label}>出典</span>
          <p className={styles.text}>出典なし</p>
        </div>
      </div>
    )
  }

  const href = httpsHref(url)
  const label = title !== '' ? title : url

  if (href === null) {
    // リンクにできない URL は、文字として出すだけ。href には絶対に入れない
    return (
      <div className={styles.source}>
        <div>
          <span className={styles.label}>出典</span>
          <p className={styles.text}>{label}</p>
          {url !== '' && title !== '' ? <p className={styles.url}>{url}</p> : null}
          {url !== '' ? <p className={styles.note}>この出典はリンクにしていません(https ではない形のため)</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.source}>
      <div>
        <span className={styles.label}>出典</span>
        <p className={styles.text}>{label}</p>
        <p className={styles.url}>{hostOf(href)}</p>
      </div>
      {/* 別タブで開く。rel で、開いた先からこの画面を操作されないようにする */}
      <a className={styles.action} href={href} target="_blank" rel="noopener noreferrer">
        {linkLabel}
        <span className="visually-hidden">(新しいタブで開く)</span>
      </a>
    </div>
  )
}
