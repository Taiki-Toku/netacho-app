// ネタの詳細(REQ-F-03、F-04、F-07、F-08)。
// 番組の文法:テロップ(コーナー札+見出しの帯)→ リード → 要約 → 試すなら → 注意(黄色のテロップ)
// → メーター → 情報の確かさ・出典 → 分類 → 評価・扱い・メモ。前後の移動は下に固定のボタンと左右スワイプ。
import { useEffect, useRef } from 'react'
import { hrefFor, type Route } from '../app/router.ts'
import { Icon } from '../components/Icon.tsx'
import { SourceLink } from '../components/SourceLink.tsx'
import { StarMeter } from '../components/StarMeter.tsx'
import { useData } from '../data/DataProvider.tsx'
import { RATING_LABELS, STAR_AXES, STATUS_LABELS } from '../data/labels.ts'
import { findItem, genreLabelMap, latestDate, neighbors } from '../data/queries.ts'
import type { Item } from '../data/types.ts'
import { formatDateLong } from '../lib/format.ts'
import { useSwipe } from '../lib/useSwipe.ts'
import styles from './ItemScreen.module.css'

interface ItemScreenProps {
  id: string
}

function go(route: Route) {
  window.location.hash = hrefFor(route)
}

export function ItemScreen({ id }: ItemScreenProps) {
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
  const item = findItem(items, id)
  if (item === null) {
    return (
      <section className={styles.notFound} aria-labelledby="item-title">
        <h1 id="item-title" className={styles.notFoundTitle}>
          このネタは見つかりません
        </h1>
        <p className={styles.muted}>削除されたか、アドレスが違うようです。</p>
        <a className={styles.backLink} href={hrefFor({ name: 'today' })}>
          今日の放送へ
        </a>
      </section>
    )
  }

  const genreLabel = item.genre === null ? '未分類' : (genreLabelMap(genres).get(item.genre) ?? item.genre)
  const back: Route = item.date === latestDate(items) ? { name: 'today' } : { name: 'archive-date', date: item.date }

  return <ItemView key={item.id} item={item} genreLabel={genreLabel} back={back} nav={neighbors(items, item)} />
}

interface ItemViewProps {
  item: Item
  genreLabel: string
  back: Route
  nav: ReturnType<typeof neighbors>
}

function ItemView({ item, genreLabel, back, nav }: ItemViewProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const swipe = useSwipe({
    onLeft: () => {
      if (nav.next !== null) go({ name: 'item', id: nav.next.id })
    },
    onRight: () => {
      if (nav.prev !== null) go({ name: 'item', id: nav.prev.id })
    },
  })

  // ネタが切り替わったら、先頭に戻して見出しに焦点を移す(読み上げにも「新しいネタに移った」と伝わる)
  useEffect(() => {
    window.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
  }, [item.id])

  const dateLabel = formatDateLong(item.date)

  return (
    <>
      <article className={styles.article} aria-labelledby="item-title" onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd}>
        <nav className={styles.crumb} aria-label="進行表の位置">
          <a className={styles.backLink} href={hrefFor(back)}>
            <Icon name="back" className={styles.backIcon} />
            進行表へ
          </a>
          <span className={styles.position}>
            <span>{dateLabel}</span>
            <span>
              {nav.position}/{nav.total}本目
            </span>
          </span>
        </nav>

        <header className={styles.telop}>
          {item.slot !== '' ? (
            <p className={styles.corner}>
              <span className={styles.cornerText}>{item.slot}</span>
            </p>
          ) : null}
          <h1 id="item-title" ref={titleRef} className={styles.band} tabIndex={-1}>
            {item.title !== '' ? item.title : '(見出しなし)'}
          </h1>
          {item.lead !== '' ? <p className={styles.lead}>{item.lead}</p> : null}
        </header>

        {item.summary !== '' ? (
          <section className={styles.section}>
            <h2 className={styles.heading}>要約</h2>
            <p className={styles.body}>{item.summary}</p>
          </section>
        ) : null}

        {item.tryit !== '' ? (
          <section className={styles.section}>
            <h2 className={styles.heading}>試すなら</h2>
            <p className={styles.body}>{item.tryit}</p>
          </section>
        ) : null}

        {item.caution !== '' ? (
          <aside className={styles.caution} aria-label="注意点">
            <span className={styles.cautionTag} aria-hidden="true">
              注意
            </span>
            <p className={styles.cautionBody}>{item.caution}</p>
          </aside>
        ) : null}

        <section className={styles.section}>
          <h2 className={styles.heading}>指標</h2>
          <div className={styles.meters}>
            {STAR_AXES.map((axis) => (
              <StarMeter key={axis.key} label={axis.label} value={item.stars[axis.key]} />
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.heading}>出典</h2>
          {item.trust !== '' ? (
            <p className={styles.trust}>
              <span className={styles.trustLabel}>情報の確かさ</span>
              <span className={styles.trustValue}>{item.trust}</span>
            </p>
          ) : null}
          <SourceLink url={item.sourceUrl} title={item.sourceTitle} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.heading}>分類</h2>
          <dl className={styles.facts}>
            <dt>ジャンル</dt>
            <dd>{genreLabel}</dd>
            {item.categories.length > 0 ? (
              <>
                <dt>カテゴリ</dt>
                <dd>
                  <TagList values={item.categories} />
                </dd>
              </>
            ) : null}
            {item.projects.length > 0 ? (
              <>
                <dt>取り組み</dt>
                <dd>
                  <TagList values={item.projects} />
                </dd>
              </>
            ) : null}
            {item.tags.length > 0 ? (
              <>
                <dt>タグ</dt>
                <dd>
                  <TagList values={item.tags} />
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className={styles.section}>
          <h2 className={styles.heading}>評価・扱い</h2>
          <dl className={styles.facts}>
            <dt>評価</dt>
            <dd>
              <Badge label={RATING_LABELS[item.rating]} tone={item.rating === '' ? 'unset' : 'accent'} />
            </dd>
            <dt>扱い</dt>
            <dd>
              <Badge label={STATUS_LABELS[item.status]} tone={item.status === '' ? 'unset' : 'band'} />
            </dd>
          </dl>
          {item.memo !== '' ? (
            <div className={styles.memo}>
              <h3 className={styles.memoHeading}>メモ</h3>
              <p className={styles.body}>{item.memo}</p>
            </div>
          ) : null}
          <p className={styles.muted}>評価・扱い・メモの書き込みは、ベータ版では行いません。</p>
        </section>
      </article>

      <nav className={styles.pager} aria-label="前後のネタ">
        {nav.prev !== null ? (
          <a className={styles.pagerQuiet} href={hrefFor({ name: 'item', id: nav.prev.id })} rel="prev">
            前のネタ
          </a>
        ) : (
          <span className={styles.pagerDisabled}>前のネタ</span>
        )}
        <span className={styles.pagerPosition} aria-hidden="true">
          {nav.position}/{nav.total}
        </span>
        {nav.next !== null ? (
          <a className={styles.pagerPrimary} href={hrefFor({ name: 'item', id: nav.next.id })} rel="next">
            次のネタ
          </a>
        ) : (
          <a className={styles.pagerQuiet} href={hrefFor(back)}>
            進行表へ
          </a>
        )}
      </nav>
    </>
  )
}

/** 評価・扱いの札。傾いた札の中で文字だけ元に戻す(SlotTag と同じ作り) */
function Badge({ label, tone }: { label: string; tone: 'accent' | 'band' | 'unset' }) {
  if (tone === 'unset') return <span className={styles.unset}>{label}</span>
  return (
    <span className={tone === 'accent' ? styles.badgeAccent : styles.badgeBand}>
      <span className={styles.badgeText}>{label}</span>
    </span>
  )
}

function TagList({ values }: { values: string[] }) {
  return (
    <ul className={styles.tags}>
      {values.map((value, index) => (
        <li key={`${index}-${value}`} className={styles.tag}>
          {value}
        </li>
      ))}
    </ul>
  )
}
