// ジャンル:そのジャンルのネタの一覧。プロダクトだけ、下に公式のお知らせと種類の絞り込み(仕様 4 章 2)
import type { FeedFilter } from '../app/router.ts'
import { ArticleRow } from '../components/ArticleRow.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { FeedRow } from '../components/FeedRow.tsx'
import { FilterChips } from '../components/FilterChips.tsx'
import { announcements, genreLabelMap, itemsInGenre } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import pageStyles from '../components/page.module.css'
import styles from './GenreScreen.module.css'

interface GenreScreenProps {
  data: LoadedData
  id: string
  kind: FeedFilter
}

/** 公式のお知らせを併せて出すジャンル */
const GENRE_WITH_FEED = 'product'

export function GenreScreen({ data, id, kind }: GenreScreenProps) {
  const labels = genreLabelMap(data.genres)
  const label = labels.get(id)

  if (label === undefined) {
    return (
      <section aria-labelledby="genre-title">
        <h1 id="genre-title" className={pageStyles.heading} tabIndex={-1}>
          ジャンル
        </h1>
        <EmptyState title="このジャンルはありません" text="メニューからジャンルを選んでください。" spaced />
      </section>
    )
  }

  const list = itemsInGenre(data.items, id)
  const withFeed = id === GENRE_WITH_FEED
  const entries = withFeed ? announcements(data.feed, kind) : []

  return (
    <section aria-labelledby="genre-title">
      <h1 id="genre-title" className={pageStyles.heading} tabIndex={-1}>
        {label}
      </h1>
      <p className={pageStyles.subtitle}>
        {list.length}本のニュース{withFeed ? 'と、公式のお知らせ' : ''}
      </p>
      {list.length === 0 ? (
        <EmptyState title="今日はこのジャンルのニュースがありません" text="過去のニュースは「さがす」から探せます。" spaced />
      ) : (
        <ol className={pageStyles.listSpaced} aria-label={`${label}のニュース`}>
          {list.map((item) => (
            <ArticleRow key={item.id} item={item} genreLabel={label} headingLevel={2} />
          ))}
        </ol>
      )}
      {withFeed ? (
        <>
          <div className={pageStyles.sectionHead}>
            <h2 className={pageStyles.sectionTitle}>公式のお知らせ</h2>
            <span className={pageStyles.caption}>{entries.length}件</span>
          </div>
          <div className={styles.chips}>
            <FilterChips current={kind} routeFor={(next) => ({ name: 'genre', id, kind: next })} />
          </div>
          {entries.length === 0 ? (
            <EmptyState title="該当するお知らせがありません" text="別の種類を選んでください。" />
          ) : (
            <ul aria-label="公式のお知らせ">
              {entries.map((entry) => (
                <FeedRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  )
}
