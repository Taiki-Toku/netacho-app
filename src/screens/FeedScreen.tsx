// 公式のお知らせ:RSS をそのまま並べる。「AIによる要約はしていません」と明記(仕様 4 章 3)
import type { FeedFilter } from '../app/router.ts'
import { EmptyState } from '../components/EmptyState.tsx'
import { FeedRow } from '../components/FeedRow.tsx'
import { FilterChips } from '../components/FilterChips.tsx'
import { announcements } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import pageStyles from '../components/page.module.css'

interface FeedScreenProps {
  data: LoadedData
  kind: FeedFilter
}

export function FeedScreen({ data, kind }: FeedScreenProps) {
  const entries = announcements(data.feed, kind)
  return (
    <section aria-labelledby="feed-title">
      <h1 id="feed-title" className={pageStyles.heading} tabIndex={-1}>
        公式のお知らせ
      </h1>
      <p className={pageStyles.subtitle}>各社の公式の配信(RSS)を、そのまま並べています。AIによる要約はしていません。</p>
      <div className={pageStyles.toolbar}>
        <FilterChips current={kind} routeFor={(next) => ({ name: 'feed', kind: next })} />
        <span className={pageStyles.caption}>{entries.length}件</span>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="該当するお知らせがありません" text={kind === 'all' ? '配信が届くと、ここに並びます。' : '別の種類を選んでください。'} />
      ) : (
        <ul className={pageStyles.list} aria-label="公式のお知らせ">
          {entries.map((entry) => (
            <FeedRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}
