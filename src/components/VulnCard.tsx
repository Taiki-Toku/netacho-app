// 脆弱性のカード:深刻度、公開日、CVE 番号(詳細へのリンク)、製品、CVSS、状況(仕様 4 章 4)
import { hrefFor } from '../app/router.ts'
import { PUBLISHED_UNKNOWN } from '../data/labels.ts'
import type { FeedEntry } from '../data/types.ts'
import { formatCvss, formatJstDate } from '../lib/format.ts'
import { SeverityPill } from './SeverityPill.tsx'
import styles from './VulnCard.module.css'

export function vulnName(entry: FeedEntry): string {
  return entry.cve !== '' ? entry.cve : 'CVE番号なし'
}

interface VulnCardProps {
  entry: FeedEntry
  /** 見出しの段階。h1 の直下に並ぶ一覧では 2、h2 の区切りの下では 3 */
  headingLevel?: 2 | 3
}

export function VulnCard({ entry, headingLevel = 3 }: VulnCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <li className={styles.card}>
      <div className={styles.top}>
        <SeverityPill severity={entry.severity} />
        {/* 公開日が分からないときは「公開 」を付けずに「公開日不明」だけ */}
        <span>{entry.publishedAt === '' ? PUBLISHED_UNKNOWN : `公開 ${formatJstDate(entry.publishedAt)}`}</span>
      </div>
      <div className={styles.main}>
        <div className={styles.body}>
          <Heading className={styles.id}>
            <a className={styles.link} href={hrefFor({ name: 'vuln-detail', id: entry.id })}>
              {vulnName(entry)}
            </a>
          </Heading>
          <p className={styles.product}>
            {entry.product}
            {entry.vendor !== '' ? `(${entry.vendor})` : ''}
          </p>
          <p className={styles.summary}>{entry.title}</p>
        </div>
        <div className={styles.score}>
          <strong>{formatCvss(entry.cvss)}</strong>
          <span>CVSS</span>
        </div>
      </div>
      {entry.status !== '' ? (
        <div className={styles.tags}>
          <span className={styles.tag}>{entry.status}</span>
        </div>
      ) : null}
    </li>
  )
}
