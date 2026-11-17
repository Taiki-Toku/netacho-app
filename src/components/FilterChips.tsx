// 公式のお知らせの種類の絞り込み。選んだ種類は URL に残す(リンクで切り替える)
import { hrefFor, type FeedFilter, type Route } from '../app/router.ts'
import { FEED_FILTER_KINDS, FEED_KIND_LABELS } from '../data/labels.ts'
import styles from './FilterChips.module.css'

interface FilterChipsProps {
  current: FeedFilter
  /** 絞り込みを変えたときの行き先を作る */
  routeFor: (kind: FeedFilter) => Route
}

export function FilterChips({ current, routeFor }: FilterChipsProps) {
  const choices: { kind: FeedFilter; label: string }[] = [
    { kind: 'all', label: 'すべて' },
    ...FEED_FILTER_KINDS.map((kind) => ({ kind, label: FEED_KIND_LABELS[kind] })),
  ]
  return (
    <nav className={styles.chips} aria-label="お知らせの種類">
      {choices.map(({ kind, label }) => (
        <a
          key={kind}
          className={kind === current ? styles.chipOn : styles.chip}
          href={hrefFor(routeFor(kind))}
          aria-current={kind === current ? 'true' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  )
}
