// 保存:保存したネタの一覧(新しく保存した順)。名前は全ジャンル共通で「保存」(仕様 4 章 6)。
// ログアウトは設定の画面にある(v3.8 で移した)
import { ArticleRow } from '../components/ArticleRow.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { findItem, genreLabelMap, genreLabelOf } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { useUserState } from '../data/userStore.ts'
import pageStyles from '../components/page.module.css'

export function SavedScreen({ data }: { data: LoadedData }) {
  const labels = genreLabelMap(data.genres)
  const list = [...useUserState().saved]
    .reverse()
    .map((id) => findItem(data.items, id))
    .filter((item) => item !== null)

  return (
    <section aria-labelledby="saved-title">
      <h1 id="saved-title" className={pageStyles.heading} tabIndex={-1}>
        保存したニュース
      </h1>
      <p className={pageStyles.subtitle}>気になったニュースを、ここにためておきます。</p>
      {list.length === 0 ? (
        <EmptyState title="まだ何も入っていません" text="ニュースの右下にある、しおりの印を押すと入ります。" spaced />
      ) : (
        <ol className={pageStyles.listSpaced} aria-label="保存したニュース">
          {list.map((item) => (
            <ArticleRow key={item.id} item={item} genreLabel={genreLabelOf(item, labels)} headingLevel={2} />
          ))}
        </ol>
      )}
    </section>
  )
}
