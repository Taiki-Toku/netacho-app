// 公式のお知らせの行。ベンダーのロゴは使わず、製品名の頭文字の札(仕様 4 章 3)。
// 見出しは https: の URL のときだけリンク(新しいタブ)。それ以外は文字のまま
import { FEED_KIND_LABELS } from '../data/labels.ts'
import { initialOf } from '../data/queries.ts'
import type { FeedEntry } from '../data/types.ts'
import { formatJstDateTime } from '../lib/format.ts'
import { httpsHref } from '../lib/safeUrl.ts'
import { PlainPill } from './SeverityPill.tsx'
import styles from './FeedRow.module.css'

export function FeedRow({ entry }: { entry: FeedEntry }) {
  const href = httpsHref(entry.url)
  const kindLabel = entry.status !== '' ? `${FEED_KIND_LABELS[entry.kind]} ${entry.status}` : FEED_KIND_LABELS[entry.kind]
  const title = entry.title !== '' ? entry.title : '(見出しなし)'
  return (
    <li className={styles.row}>
      <div className={styles.badge} aria-hidden="true">
        {initialOf(entry.product)}
      </div>
      <div className={styles.body}>
        <div className={styles.top}>
          <strong>{entry.product}</strong>
          <PlainPill>{kindLabel}</PlainPill>
          <span className={styles.when}>{formatJstDateTime(entry.publishedAt)}</span>
        </div>
        <p className={styles.title}>
          {href === null ? (
            title
          ) : (
            <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
              {title}
              <span className="visually-hidden">(新しいタブで開く)</span>
            </a>
          )}
        </p>
      </div>
    </li>
  )
}
