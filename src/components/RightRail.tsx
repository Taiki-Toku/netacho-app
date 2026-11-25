// 右の列(1101px 以上):脆弱性ウォッチ、公式のお知らせ(最新3件)、保存したネタ(最新3件)
import { hrefFor } from '../app/router.ts'
import { PUBLISHED_UNKNOWN } from '../data/labels.ts'
import { announcements, findItem, genreLabelMap, genreLabelOf, topVulnerability } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { itemSourceName } from '../data/sourceName.ts'
import { useUserState } from '../data/userStore.ts'
import { formatCvss, formatJstDateTime } from '../lib/format.ts'
import { SeverityPill } from './SeverityPill.tsx'
import { vulnName } from './VulnCard.tsx'
import pageStyles from './page.module.css'
import styles from './RightRail.module.css'

const RAIL_COUNT = 3

export function RightRail({ data }: { data: LoadedData }) {
  const top = topVulnerability(data.feed)
  const latest = announcements(data.feed).slice(0, RAIL_COUNT)
  const savedIds = useUserState().saved
  const saved = [...savedIds]
    .reverse()
    .map((id) => findItem(data.items, id))
    .filter((item) => item !== null)
    .slice(0, RAIL_COUNT)
  const labels = genreLabelMap(data.genres)

  return (
    <aside className={styles.rail} aria-label="補助の情報">
      <section className={styles.card} aria-labelledby="rail-vuln">
        <div className={styles.head}>
          <h3 id="rail-vuln" className={styles.title}>
            脆弱性ウォッチ
          </h3>
          {top !== null ? <SeverityPill severity={top.severity} /> : null}
        </div>
        {top === null ? (
          <p className={styles.desc}>いま出ている脆弱性の情報はありません。</p>
        ) : (
          <>
            <div className={styles.score}>
              <strong>{formatCvss(top.cvss)}</strong>
              <span>CVSS</span>
            </div>
            <a className={styles.cve} href={hrefFor({ name: 'vuln-detail', id: top.id })}>
              {vulnName(top)}
            </a>
            <p className={styles.desc}>
              {top.product}
              {top.status !== '' ? (
                <>
                  <br />
                  {top.status}
                </>
              ) : null}
            </p>
          </>
        )}
        <div className={styles.divider} />
        <a className={pageStyles.textLink} href={hrefFor({ name: 'vuln', severity: 'all' })}>
          脆弱性をすべて見る
        </a>
      </section>

      <section className={styles.card} aria-labelledby="rail-feed">
        <h3 id="rail-feed" className={styles.title}>
          公式のお知らせ
        </h3>
        {latest.length === 0 ? (
          <p className={styles.desc}>お知らせはまだありません。</p>
        ) : (
          <ul className={styles.miniList}>
            {latest.map((entry) => (
              <li key={entry.id} className={styles.miniItem}>
                <strong>
                  {entry.product}:{entry.title}
                </strong>
                <span>{entry.publishedAt === '' ? PUBLISHED_UNKNOWN : formatJstDateTime(entry.publishedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.divider} />
        <a className={pageStyles.textLink} href={hrefFor({ name: 'feed', kind: 'all' })}>
          お知らせをすべて見る
        </a>
      </section>

      <section className={styles.card} aria-labelledby="rail-saved">
        <h3 id="rail-saved" className={styles.title}>
          保存したニュース
        </h3>
        {saved.length === 0 ? (
          <p className={styles.desc}>しおりの印を押すと、ここに並びます。</p>
        ) : (
          <ul className={styles.miniList}>
            {saved.map((item) => (
              <li key={item.id} className={styles.miniItem}>
                <a className={styles.miniLink} href={hrefFor({ name: 'item', id: item.id })}>
                  <strong>{item.title !== '' ? item.title : '(見出しなし)'}</strong>
                  <span>{itemSourceName(item, genreLabelOf(item, labels))}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
