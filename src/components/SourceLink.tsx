// 出典の表示。https: の URL だけをリンクにし、それ以外は文字のまま出す(CLAUDE.md セキュリティ規約)
import { hostOf, httpsHref } from '../lib/safeUrl.ts'
import styles from './SourceLink.module.css'

interface SourceLinkProps {
  url: string
  title: string
}

export function SourceLink({ url, title }: SourceLinkProps) {
  if (url === '' && title === '') {
    return <p className={styles.none}>出典なし</p>
  }

  const href = httpsHref(url)
  const label = title !== '' ? title : url

  if (href === null) {
    // リンクにできない URL は、文字として出すだけ。href には絶対に入れない
    return (
      <div className={styles.block}>
        <p className={styles.text}>{label}</p>
        {url !== '' && title !== '' ? <p className={styles.url}>{url}</p> : null}
        {url !== '' ? <p className={styles.note}>この出典はリンクにしていません(https ではない形のため)</p> : null}
      </div>
    )
  }

  return (
    <div className={styles.block}>
      {/* 別タブで開く。rel で、開いた先からこの画面を操作されないようにする */}
      <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
        <span className={styles.text}>{label}</span>
        <span className={styles.url}>
          {hostOf(href)}
          <span className="visually-hidden">(新しいタブで開く)</span>
        </span>
      </a>
    </div>
  )
}
