// 脆弱性:深刻度ごとの件数カードが、そのまま絞り込み(もう一度押すと解除)。選んだ深刻度は URL に残す(仕様 4 章 4、7 章)
import { hrefFor, type SeverityFilter } from '../app/router.ts'
import { EmptyState } from '../components/EmptyState.tsx'
import { VulnCard } from '../components/VulnCard.tsx'
import { SEVERITY_LABELS, SEVERITY_ORDER } from '../data/labels.ts'
import { countBySeverity, vulnerabilities } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import type { Severity } from '../data/types.ts'
import pageStyles from '../components/page.module.css'
import styles from './VulnScreen.module.css'

interface VulnScreenProps {
  data: LoadedData
  severity: SeverityFilter
}

const STAT_CLASS: Record<Exclude<Severity, ''>, { off: string | undefined; on: string | undefined }> = {
  critical: { off: styles.statCritical, on: styles.statCriticalOn },
  high: { off: styles.statHigh, on: styles.statHighOn },
  medium: { off: styles.statMedium, on: styles.statMediumOn },
  low: { off: styles.statLow, on: styles.statLowOn },
}

export function VulnScreen({ data, severity }: VulnScreenProps) {
  const all = vulnerabilities(data.feed)
  const counts = countBySeverity(all)
  const list = severity === 'all' ? all : vulnerabilities(data.feed, severity)

  return (
    <section aria-labelledby="vuln-title">
      <h1 id="vuln-title" className={pageStyles.heading} tabIndex={-1}>
        脆弱性
      </h1>
      <p className={pageStyles.subtitle}>深刻度と、修正の状況から確かめます。</p>
      <nav className={styles.stats} aria-label="深刻度で絞り込む">
        {SEVERITY_ORDER.map((level) => {
          const on = severity === level
          return (
            <a
              key={level}
              className={on ? STAT_CLASS[level].on : STAT_CLASS[level].off}
              // もう一度押すと解除(すべてに戻る)
              href={hrefFor({ name: 'vuln', severity: on ? 'all' : level })}
              aria-current={on ? 'true' : undefined}
            >
              <span className={styles.statLabel}>{SEVERITY_LABELS[level]}</span>
              <strong className={styles.statCount}>{counts[level]}</strong>
            </a>
          )
        })}
      </nav>
      <div className={pageStyles.toolbar}>
        <span className={pageStyles.caption} role="status">
          {severity === 'all' ? 'すべて' : `${SEVERITY_LABELS[severity]}だけ`}を表示中。{list.length}件(新しい順)
        </span>
        {severity !== 'all' ? (
          <a className={styles.clear} href={hrefFor({ name: 'vuln', severity: 'all' })}>
            絞り込みを外す
          </a>
        ) : null}
      </div>
      {list.length === 0 ? (
        // 全体が 0 件(公式フィードがまだ無い)なら、絞り込みに関係なくトップの帯と同じ文言にする
        <EmptyState
          title={all.length === 0 ? '公式情報はまだありません' : '該当する脆弱性がありません'}
          text={all.length === 0 ? '配信が届くと、ここに並びます。' : '別の深刻度を選ぶか、絞り込みを外してください。'}
        />
      ) : (
        <ul className={styles.cards} aria-label="脆弱性の一覧">
          {list.map((entry) => (
            <VulnCard key={entry.id} entry={entry} headingLevel={2} />
          ))}
        </ul>
      )}
      {data.source === 'fixtures' ? <p className={pageStyles.sampleNote}>CVE番号と点数は、画面を確かめるための架空のものです。</p> : null}
    </section>
  )
}
