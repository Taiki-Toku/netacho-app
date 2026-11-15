// 今日の放送:最新日のネタを番組の順番に並べた進行表(REQ-F-02、F-07)
import { hrefFor } from '../app/router.ts'
import { SlotTag } from '../components/SlotTag.tsx'
import { Stamp } from '../components/Stamp.tsx'
import { useData } from '../data/DataProvider.tsx'
import { genreLabelMap, isRated, itemsOnDate, latestDate } from '../data/queries.ts'
import type { Item } from '../data/types.ts'
import { formatDateLong } from '../lib/format.ts'
import styles from './TodayScreen.module.css'

export function TodayScreen() {
  const state = useData()

  if (state.status === 'loading') {
    return (
      <p className={styles.status} role="status">
        読み込み中…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <p className={styles.status} role="alert">
        データを読み込めませんでした。{state.message}
      </p>
    )
  }

  const { items, genres } = state.data
  const date = latestDate(items)
  const list = date === null ? [] : itemsOnDate(items, date)
  const ratedCount = list.filter(isRated).length
  const genreLabels = genreLabelMap(genres)

  return (
    <section aria-labelledby="today-title">
      <div className={styles.corner}>
        <h1 id="today-title" className={styles.title}>
          今日の放送
        </h1>
        {date !== null ? (
          <p className={styles.meta}>
            <span>{formatDateLong(date)}</span>
            <span>{list.length}本</span>
            <span>済 {ratedCount}</span>
          </p>
        ) : null}
      </div>
      {list.length === 0 ? (
        <p className={styles.empty}>今日の放送はまだありません。</p>
      ) : (
        <ol className={styles.rundown} aria-label="進行表">
          {list.map((item, index) => (
            <RundownRow
              key={item.id}
              item={item}
              featured={index === 0}
              genreLabel={item.genre === null ? '未分類' : (genreLabels.get(item.genre) ?? item.genre)}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

interface RundownRowProps {
  item: Item
  featured: boolean
  genreLabel: string
}

function orderLabel(order: number): string {
  return Number.isSafeInteger(order) && order >= 0 && order < 1000 ? String(order).padStart(2, '0') : '--'
}

function RundownRow({ item, featured, genreLabel }: RundownRowProps) {
  const rated = isRated(item)
  const classes = [styles.row, rated ? styles.done : '', featured ? styles.featured : ''].filter(Boolean).join(' ')
  return (
    <li className={classes}>
      <a className={styles.link} href={hrefFor({ name: 'item', id: item.id })}>
        <span className={styles.no} aria-hidden="true">
          {orderLabel(item.order)}
        </span>
        <span className={styles.main}>
          <SlotTag slot={item.slot} muted={rated} />
          <span className={styles.ttl}>{item.title !== '' ? item.title : '(見出しなし)'}</span>
          {featured && item.lead !== '' ? <span className={styles.lead}>{item.lead}</span> : null}
          <span className={styles.sub}>
            {item.trust !== '' ? <span>{item.trust}</span> : null}
            <span>{genreLabel}</span>
          </span>
        </span>
        {rated ? <Stamp /> : null}
      </a>
    </li>
  )
}
