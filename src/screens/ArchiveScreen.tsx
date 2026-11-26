// バックナンバー(詳細設計 5.4.2、design_spec v3.9 の 4-8):過去の配信日を選んで、その日のニュースを配信の順に読む。
// ページ見出し(h1)→ 日付の選び方(前の日・次の日・日付の一覧)→ その日のニュースの一覧。
// 日付は配信日(items.date)で分け、今日(日本時間)とそれより後の日は出さない。公式のお知らせと脆弱性は出さない
import { useEffect } from 'react'
import { hrefFor, navigate, replaceRoute } from '../app/router.ts'
import { ArticleRow } from '../components/ArticleRow.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { archiveDates, genreLabelMap, genreLabelOf, itemsOnDate } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { formatDateOnlyLong } from '../lib/format.ts'
import pageStyles from '../components/page.module.css'
import styles from './ArchiveScreen.module.css'

interface ArchiveScreenProps {
  data: LoadedData
  /** URL の日付。null は日付なし(#/archive)、'' は形の違う・暦に無い日付 */
  date: string | null
  /** 今日の日付(日本時間の "YYYY-MM-DD")。App が決める(試験で差し替えられるように) */
  today: string
}

export function ArchiveScreen({ data, date, today }: ArchiveScreenProps) {
  const dates = archiveDates(data.items, today)
  const latest = dates[0] ?? null

  // 日付なしで開いたら、記事がある最も新しい過去日の URL に置き換える(履歴に積まない)
  useEffect(() => {
    if (date === null && latest !== null) replaceRoute({ name: 'archive', date: latest })
  }, [date, latest])

  // 置き換えが届くまでの間も、その日を出しておく(ちらつかせない)
  const selected = date ?? latest
  const known = selected !== null && dates.includes(selected)
  const list = known ? itemsOnDate(data.items, selected) : []
  const labels = genreLabelMap(data.genres)

  // dates は新しい順。前の日 = 選んだ日より古い中で最も新しい日、次の日 = 選んだ日より新しい中で最も古い日
  const valid = selected !== null && selected !== ''
  const prev = valid ? (dates.find((candidate) => candidate < selected) ?? null) : null
  const next = valid ? (dates.findLast((candidate) => candidate > selected) ?? null) : null

  return (
    <section aria-labelledby="archive-title">
      <h1 id="archive-title" className={pageStyles.heading} tabIndex={-1}>
        バックナンバー
      </h1>
      <p className={pageStyles.subtitle}>過去の日に配信されたニュースを、日付を選んで読めます。</p>

      {latest === null ? (
        <EmptyState title="まだバックナンバーはありません" text="前の日の配信が届くと、ここで読めます。" spaced />
      ) : (
        <>
          <nav className={styles.picker} aria-label="配信日を選ぶ">
            <DayLink date={prev} label="前の日" />
            <label className="visually-hidden" htmlFor="archive-date">
              配信日
            </label>
            <select
              id="archive-date"
              className={styles.select}
              value={known ? selected : ''}
              onChange={(event) => {
                if (event.target.value !== '') navigate({ name: 'archive', date: event.target.value })
              }}
            >
              {known ? null : (
                <option value="" disabled>
                  日付を選ぶ
                </option>
              )}
              {dates.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {formatDateOnlyLong(candidate)}
                </option>
              ))}
            </select>
            <DayLink date={next} label="次の日" />
          </nav>

          {known ? (
            <>
              <div className={pageStyles.sectionHead}>
                <h2 className={pageStyles.sectionTitle}>{formatDateOnlyLong(selected)}のニュース</h2>
                <span className={pageStyles.caption}>全{list.length}本</span>
              </div>
              <ol className={pageStyles.list} aria-label={`${formatDateOnlyLong(selected)}のニュース`}>
                {list.map((item) => (
                  <ArticleRow
                    key={item.id}
                    item={item}
                    genreLabel={genreLabelOf(item, labels)}
                    order={item.order}
                    oneLineLead
                    from={{ kind: 'archive', date: selected }}
                  />
                ))}
              </ol>
            </>
          ) : (
            <>
              <EmptyState title="この日のニュースはありません" text="別の日付を選んでください。" spaced />
              <a className={`${pageStyles.textLink} ${styles.latestLink}`} href={hrefFor({ name: 'archive', date: latest })}>
                {formatDateOnlyLong(latest)}のニュースを見る
              </a>
            </>
          )}
        </>
      )}
      {data.source === 'fixtures' ? <p className={pageStyles.sampleNote}>表示しているのは、すべて見本用の架空データです。</p> : null}
    </section>
  )
}

/** 前の日・次の日。記事がある日だけを辿る。端では押せない文字にする */
function DayLink({ date, label }: { date: string | null; label: string }) {
  if (date === null) {
    return (
      <span className={styles.dayDisabled}>{label}</span>
    )
  }
  return (
    <a className={styles.dayLink} href={hrefFor({ name: 'archive', date })} aria-label={`${label}(${formatDateOnlyLong(date)})`}>
      {label}
    </a>
  )
}
