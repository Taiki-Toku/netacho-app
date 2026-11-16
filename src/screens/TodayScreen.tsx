// 今日:見出し「今朝のネタ」、今朝のトップ(文章 + 画像の大きな枠)、今朝のラインナップ(放送順の番号つきの行)(仕様 4 章 1)
import { hrefFor } from '../app/router.ts'
import { ArticleRow, itemInitial } from '../components/ArticleRow.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { SaveButton } from '../components/SaveButton.tsx'
import { Thumb } from '../components/Thumb.tsx'
import { genreLabelMap, itemsOnDate, latestDate, topVulnerability } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import type { Item } from '../data/types.ts'
import { formatCvss, formatDateHeader } from '../lib/format.ts'
import { vulnName } from '../components/VulnCard.tsx'
import pageStyles from '../components/page.module.css'
import styles from './TodayScreen.module.css'

export function genreLabelOf(item: Item, labels: ReadonlyMap<string, string>): string {
  return item.genre === null ? '未分類' : (labels.get(item.genre) ?? item.genre)
}

export function TodayScreen({ data }: { data: LoadedData }) {
  const { items, genres, feed } = data
  const date = latestDate(items)
  const list = date === null ? [] : itemsOnDate(items, date)
  const labels = genreLabelMap(genres)
  const [top, ...rest] = list
  const watch = topVulnerability(feed)

  return (
    <section aria-labelledby="today-title">
      <h1 id="today-title" className={pageStyles.heading}>
        今朝のネタ
      </h1>
      {date !== null ? (
        <p className={pageStyles.subtitle}>
          {formatDateHeader(date)}。全{list.length}本、放送の順に並んでいます。
        </p>
      ) : null}

      {top === undefined ? (
        <EmptyState title="今朝のネタはまだありません" text="配信が届くと、ここに並びます。" spaced />
      ) : (
        <>
          <article className={styles.feature} aria-labelledby="feature-title">
            <div className={styles.featureCopy}>
              <span className={pageStyles.label}>今朝のトップ</span>
              <h2 id="feature-title" className={styles.featureTitle}>
                <a className={styles.featureLink} href={hrefFor({ name: 'item', id: top.id })}>
                  {top.title !== '' ? top.title : '(見出しなし)'}
                </a>
              </h2>
              {top.lead !== '' ? <p className={styles.featureDesc}>{top.lead}</p> : null}
              <div className={styles.metaRow}>
                <span className={pageStyles.label}>{genreLabelOf(top, labels)}</span>
                {top.sourceTitle !== '' ? <span>{top.sourceTitle}</span> : null}
                <span className={styles.metaSave}>
                  <SaveButton id={top.id} />
                </span>
              </div>
            </div>
            <div className={styles.featureImage}>
              <Thumb url={top.imageUrl} initial={itemInitial(top, genreLabelOf(top, labels))} eager />
            </div>
          </article>

          {/* 768〜1100px では右の列が無いので、脆弱性ウォッチの帯をここに出す(CSS でその幅だけ表示) */}
          {watch !== null ? (
            <a className={styles.promo} href={hrefFor({ name: 'vuln-detail', id: watch.id })}>
              <span>
                <strong className={styles.promoTitle}>脆弱性ウォッチ</strong>
                <small className={styles.promoText}>
                  {vulnName(watch)} {watch.product}
                </small>
              </span>
              <span className={styles.promoScore}>{formatCvss(watch.cvss)}</span>
            </a>
          ) : null}

          <div className={pageStyles.sectionHead}>
            <h2 className={pageStyles.sectionTitle}>今朝のラインナップ</h2>
            <span className={pageStyles.caption}>あと{rest.length}本</span>
          </div>
          {rest.length === 0 ? (
            <EmptyState title="今朝はトップの1本だけです" text="ほかのネタは、ジャンルや「さがす」から見られます。" />
          ) : (
            <ol className={pageStyles.list} aria-label="今朝のラインナップ">
              {rest.map((item) => (
                <ArticleRow key={item.id} item={item} genreLabel={genreLabelOf(item, labels)} order={item.order} />
              ))}
            </ol>
          )}
        </>
      )}
      {data.source === 'fixtures' ? <p className={pageStyles.sampleNote}>表示しているのは、すべて見本用の架空データです。</p> : null}
    </section>
  )
}
