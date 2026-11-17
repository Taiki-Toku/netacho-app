// さがす:ネタ、公式のお知らせ、脆弱性を分けて表示(仕様 4 章 7)。検索語は URL(#/search?q=)から読む
import { ArticleRow } from '../components/ArticleRow.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { FeedRow } from '../components/FeedRow.tsx'
import { VulnCard } from '../components/VulnCard.tsx'
import { announcements, genreLabelMap, genreLabelOf, searchFeed, searchItems, vulnerabilities } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import pageStyles from '../components/page.module.css'
import styles from './SearchScreen.module.css'

interface SearchScreenProps {
  data: LoadedData
  q: string
}

export function SearchScreen({ data, q }: SearchScreenProps) {
  if (q === '') {
    return (
      <section aria-labelledby="search-title">
        <h1 id="search-title" className={pageStyles.heading}>
          さがす
        </h1>
        <EmptyState title="上の欄に言葉を入れてください" text="ニュースの見出し、製品名、CVE番号で探せます。" spaced />
      </section>
    )
  }

  const labels = genreLabelMap(data.genres)
  const items = searchItems(data.items, data.genres, q)
  const feed = searchFeed(announcements(data.feed), q)
  const vulns = searchFeed(vulnerabilities(data.feed), q)

  return (
    <section aria-labelledby="search-title">
      <h1 id="search-title" className={pageStyles.heading}>
        「{q}」の結果
      </h1>
      <div className={pageStyles.sectionHead}>
        <h2 className={pageStyles.sectionTitle}>ニュース</h2>
        <span className={pageStyles.caption}>{items.length}件</span>
      </div>
      {items.length === 0 ? (
        <EmptyState title="一致するニュースがありません" text="別の言葉で試してください。" />
      ) : (
        <ol className={pageStyles.list} aria-label="一致するニュース">
          {items.map((item) => (
            <ArticleRow key={item.id} item={item} genreLabel={genreLabelOf(item, labels)} />
          ))}
        </ol>
      )}
      <div className={pageStyles.sectionHead}>
        <h2 className={pageStyles.sectionTitle}>公式のお知らせ</h2>
        <span className={pageStyles.caption}>{feed.length}件</span>
      </div>
      {feed.length === 0 ? (
        <EmptyState title="一致するお知らせがありません" text="製品名でも探せます。" />
      ) : (
        <ul className={pageStyles.list} aria-label="一致するお知らせ">
          {feed.map((entry) => (
            <FeedRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      <div className={pageStyles.sectionHead}>
        <h2 className={pageStyles.sectionTitle}>脆弱性</h2>
        <span className={pageStyles.caption}>{vulns.length}件</span>
      </div>
      {vulns.length === 0 ? (
        <EmptyState title="一致する脆弱性がありません" text="CVE番号や製品名でも探せます。" />
      ) : (
        <ul className={styles.cards} aria-label="一致する脆弱性">
          {vulns.map((entry) => (
            <VulnCard key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}
