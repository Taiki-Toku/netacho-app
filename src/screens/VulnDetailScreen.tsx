// 脆弱性の個別の画面:CVE 番号、深刻度、CVSS、概要、対象の製品、ベンダー、公開日、修正の状況、情報源、確かめること
import { hrefFor } from '../app/router.ts'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { SeverityPill } from '../components/SeverityPill.tsx'
import { vulnName } from '../components/VulnCard.tsx'
import { findFeedEntry } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { formatCvss, formatJstDate } from '../lib/format.ts'
import { hostOf, httpsHref } from '../lib/safeUrl.ts'
import pageStyles from '../components/page.module.css'
import styles from './VulnDetailScreen.module.css'

interface VulnDetailScreenProps {
  data: LoadedData
  id: string
}

export function VulnDetailScreen({ data, id }: VulnDetailScreenProps) {
  const entry = findFeedEntry(data.feed, id)
  const backHref = hrefFor({ name: 'vuln', severity: 'all' })

  if (entry?.kind !== 'vuln') {
    return (
      <section className={styles.detail} aria-labelledby="vuln-detail-title">
        <h1 id="vuln-detail-title" className={pageStyles.heading} tabIndex={-1}>
          この脆弱性は見つかりません
        </h1>
        <EmptyState title="削除されたか、アドレスが違うようです" text="一覧から選び直してください。" spaced />
        <a className={styles.back} href={backHref}>
          <Icon name="back" />
          脆弱性の一覧に戻る
        </a>
      </section>
    )
  }

  const href = httpsHref(entry.url)
  const fields: { label: string; value: string }[] = [
    { label: '対象の製品', value: entry.product },
    { label: 'ベンダー', value: entry.vendor },
    { label: '公開日', value: formatJstDate(entry.publishedAt) },
    { label: '修正の状況', value: entry.status !== '' ? entry.status : '不明' },
  ]

  return (
    <article className={styles.detail} aria-labelledby="vuln-detail-title">
      <a className={styles.back} href={backHref}>
        <Icon name="back" />
        脆弱性の一覧に戻る
      </a>
      <h1 id="vuln-detail-title" className={styles.title} tabIndex={-1}>
        {vulnName(entry)}
      </h1>
      <div className={styles.head}>
        <SeverityPill severity={entry.severity} />
        <div className={styles.score}>
          <strong>{formatCvss(entry.cvss)}</strong>
          <span>CVSS</span>
        </div>
      </div>
      <p className={styles.summary}>{entry.title}</p>
      <dl className={styles.fields}>
        {fields
          .filter((field) => field.value !== '')
          .map((field) => (
            <div key={field.label} className={styles.field}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        <div className={styles.field}>
          <dt>情報源</dt>
          <dd>
            {href === null ? (
              entry.url !== '' ? (
                <span>{entry.url}(リンクにしていません)</span>
              ) : (
                '不明'
              )
            ) : (
              <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
                {hostOf(href)}
                <span className="visually-hidden">(新しいタブで開く)</span>
              </a>
            )}
          </dd>
        </div>
      </dl>
      <div className={styles.body}>
        <h2 className={styles.bodyHeading}>確かめること</h2>
        <p className={styles.bodyText}>
          使っている版が対象に入るかを確かめ、ベンダーの公式の修正情報を読んでください。急ぐかどうかは、一次情報と実際の構成から判断します。
        </p>
      </div>
    </article>
  )
}
