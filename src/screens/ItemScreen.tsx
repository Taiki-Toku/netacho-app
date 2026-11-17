// ネタの詳細(仕様 4 章 5):ジャンル名、見出し、出典と日付、保存ボタン、画像、要点(AIがまとめたと明記)、
// 試してみる(確かめること)、気をつけること、出典と元記事へのリンク、評価4つ、メモ(自動保存)。
// 依頼書(docs/beta_brief.md)にあった指標・情報の確かさ・分類・扱いは「このニュースについて」の欄に残す。前後の移動はボタンと左右スワイプ
import { useEffect, useRef } from 'react'
import { hrefFor, navigate, type Route } from '../app/router.ts'
import { itemInitial } from '../components/ArticleRow.tsx'
import { Icon } from '../components/Icon.tsx'
import { SaveButton } from '../components/SaveButton.tsx'
import { SourceLink } from '../components/SourceLink.tsx'
import { StarMeter } from '../components/StarMeter.tsx'
import { Thumb } from '../components/Thumb.tsx'
import { RATING_CHOICES, RATING_LABELS, STAR_AXES, STATUS_LABELS, tryitHeading } from '../data/labels.ts'
import { findItem, genreLabelMap, genreLabelOf, latestDate, neighbors } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { itemSourceName } from '../data/sourceName.ts'
import type { Item, Rating } from '../data/types.ts'
import { useUserState, useUserStore } from '../data/userStore.ts'
import { formatDateLong } from '../lib/format.ts'
import { useSwipe } from '../lib/useSwipe.ts'
import pageStyles from '../components/page.module.css'
import styles from './ItemScreen.module.css'

interface ItemScreenProps {
  data: LoadedData
  id: string
}

export function ItemScreen({ data, id }: ItemScreenProps) {
  const { items, genres } = data
  const item = findItem(items, id)
  if (item === null) {
    return (
      <section className={styles.detail} aria-labelledby="item-title">
        <h1 id="item-title" className={pageStyles.heading}>
          このニュースは見つかりません
        </h1>
        <p className={pageStyles.subtitle}>削除されたか、アドレスが違うようです。</p>
        <a className={styles.back} href={hrefFor({ name: 'home' })}>
          <Icon name="back" />
          今日のニュースへ
        </a>
      </section>
    )
  }

  const genreLabel = genreLabelOf(item, genreLabelMap(genres))
  // 戻り先:今朝のネタならトップ、前の日のネタならそのジャンル(ジャンルが無ければトップ)
  const back: Route =
    item.date === latestDate(items) || item.genre === null ? { name: 'home' } : { name: 'genre', id: item.genre, kind: 'all' }

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
  const store = useUserStore()
  const feedback = useUserState().feedback[item.id] ?? {}
  // 自分で付けた評価・メモがあればそれを、無ければネタに元から付いているものを出す
  const rating: Rating = feedback.rating ?? item.rating
  const memo = feedback.memo ?? item.memo
  const memoSaved = feedback.memo !== undefined

  const swipe = useSwipe({
    onLeft: () => {
      if (nav.next !== null) navigate({ name: 'item', id: nav.next.id })
    },
    onRight: () => {
      if (nav.prev !== null) navigate({ name: 'item', id: nav.prev.id })
    },
  })

  // ネタが切り替わったら、見出しに焦点を移す(読み上げにも「新しいネタに移った」と伝わる)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [item.id])

  const backLabel = '一覧に戻る'

  return (
    <article className={styles.detail} aria-labelledby="item-title" onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd}>
      <a className={styles.back} href={hrefFor(back)}>
        <Icon name="back" />
        {backLabel}
      </a>
      <span className={pageStyles.label}>{genreLabel}</span>
      <h1 id="item-title" ref={titleRef} className={styles.title} tabIndex={-1}>
        {item.title !== '' ? item.title : '(見出しなし)'}
      </h1>
      <div className={styles.metaRow}>
        <span>{itemSourceName(item, genreLabel)}</span>
        <span>{formatDateLong(item.date)}</span>
        <span>
          {nav.position} / {nav.total}
        </span>
      </div>
      <div className={styles.actions}>
        <SaveButton id={item.id} labelled />
      </div>
      <div className={styles.hero}>
        <Thumb url={item.imageUrl} initial={itemInitial(item, genreLabel)} eager />
      </div>

      {item.lead !== '' ? <p className={styles.lead}>{item.lead}</p> : null}

      {item.summary !== '' ? (
        <section className={styles.box} aria-labelledby="item-points">
          <h2 id="item-points" className={pageStyles.label}>
            要点
          </h2>
          <p className={styles.boxText}>{item.summary}</p>
          <p className={styles.aiNote}>この要点は、元の記事をもとにAIがまとめたものです。</p>
        </section>
      ) : null}

      {item.tryit !== '' ? (
        <section className={styles.box} aria-labelledby="item-tryit">
          <h2 id="item-tryit" className={pageStyles.label}>
            {tryitHeading(item.genre)}
          </h2>
          <p className={styles.boxText}>{item.tryit}</p>
        </section>
      ) : null}

      {item.caution !== '' ? (
        <section aria-labelledby="item-caution">
          <h2 id="item-caution" className={styles.bodyHeading}>
            気をつけること
          </h2>
          <p className={styles.bodyText}>{item.caution}</p>
        </section>
      ) : null}

      <SourceLink url={item.sourceUrl} title={item.sourceTitle} />

      <section aria-labelledby="item-about">
        <h2 id="item-about" className={styles.bodyHeading}>
          このニュースについて
        </h2>
        <dl className={styles.fields}>
          {item.slot !== '' ? <Field label="コーナー" value={item.slot} /> : null}
          {item.trust !== '' ? <Field label="情報の確かさ" value={item.trust} /> : null}
          <Field label="扱い" value={STATUS_LABELS[item.status]} />
          {item.categories.length > 0 ? <Field label="カテゴリ" value={item.categories.join('、')} /> : null}
          {item.projects.length > 0 ? <Field label="取り組み" value={item.projects.join('、')} /> : null}
          {item.tags.length > 0 ? <Field label="タグ" value={item.tags.join('、')} /> : null}
        </dl>
        <div className={styles.meters}>
          {STAR_AXES.map((axis) => (
            <StarMeter key={axis.key} label={axis.label} value={item.stars[axis.key]} />
          ))}
        </div>
      </section>

      <div className={pageStyles.sectionHead}>
        <h2 id="item-rating" className={pageStyles.sectionTitle}>
          このニュース、どうでしたか
        </h2>
        <span className={pageStyles.caption}>{rating === '' ? '未評価' : `評価:${RATING_LABELS[rating]}`}</span>
      </div>
      <div className={styles.rate} role="group" aria-labelledby="item-rating">
        {RATING_CHOICES.map((choice) => {
          const on = rating === choice
          return (
            <button
              key={choice}
              type="button"
              className={on ? styles.rateOn : styles.rateButton}
              aria-pressed={on}
              onClick={() => {
                // もう一度押すと外す
                store.setRating(item.id, on ? '' : choice)
              }}
            >
              {RATING_LABELS[choice]}
            </button>
          )
        })}
      </div>

      <div className={pageStyles.sectionHead}>
        <label className={pageStyles.sectionTitle} htmlFor="item-memo">
          メモ
        </label>
      </div>
      <textarea
        id="item-memo"
        className={styles.memo}
        rows={3}
        placeholder="試した結果や、思いついたことを書く"
        value={memo}
        onChange={(event) => {
          store.setMemo(item.id, event.target.value)
        }}
      />
      <p className={styles.aiNote} aria-live="polite">
        {memoSaved ? 'メモを保存しました' : ''}
      </p>

      <nav className={styles.pager} aria-label="前後のニュース">
        {nav.prev !== null ? (
          <a className={styles.pagerLink} href={hrefFor({ name: 'item', id: nav.prev.id })} rel="prev">
            前のニュース
          </a>
        ) : (
          <span className={styles.pagerDisabled}>前のニュース</span>
        )}
        <span className={styles.pagerPosition} aria-hidden="true">
          {nav.position} / {nav.total}
        </span>
        {nav.next !== null ? (
          <a className={styles.pagerLink} href={hrefFor({ name: 'item', id: nav.next.id })} rel="next">
            次のニュース
          </a>
        ) : (
          <a className={styles.pagerLink} href={hrefFor(back)}>
            {backLabel}
          </a>
        )}
      </nav>
    </article>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
