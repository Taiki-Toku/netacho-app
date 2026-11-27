// ネタの詳細(仕様 4 章 5、詳細設計 5.5.3):ジャンル名、見出し、出典と日付、保存ボタン、画像(無ければ出典の横に小さな札)、リード、要点、
// 本文(points と summary の両方があるとき)、AI がまとめたことの注記、元記事の抜粋、出典と元記事へのリンク、評価4つ、メモ(自動保存)、前後のニュース。
// 上のバーの下端に読了バー。「試してみる/確かめること」「気をつけること」は出さない。
// 依頼書(docs/beta_brief.md)にあった指標・情報の確かさ・分類・扱いは「このニュースについて」の欄に残す。前後の移動はボタンと左右スワイプ
import { useEffect, useRef } from 'react'
import { hrefFor, navigate, type ItemFrom, type Route } from '../app/router.ts'
import { itemInitial } from '../components/ArticleRow.tsx'
import { Icon } from '../components/Icon.tsx'
import { ReadingProgress } from '../components/ReadingProgress.tsx'
import { SaveButton } from '../components/SaveButton.tsx'
import { SourceBadge } from '../components/SourceBadge.tsx'
import { SourceLink } from '../components/SourceLink.tsx'
import { StarMeter } from '../components/StarMeter.tsx'
import { Thumb, useThumb } from '../components/Thumb.tsx'
import { RATING_CHOICES, RATING_LABELS, STAR_AXES, STATUS_LABELS } from '../data/labels.ts'
import { findItem, genreLabelMap, genreLabelOf, latestDate, neighbors } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { itemSourceName } from '../data/sourceName.ts'
import type { Item, Rating } from '../data/types.ts'
import { useUserState, useUserStore } from '../data/userStore.ts'
import { formatDateLong, formatPublishedDate } from '../lib/format.ts'
import { useSwipe } from '../lib/useSwipe.ts'
import pageStyles from '../components/page.module.css'
import styles from './ItemScreen.module.css'

interface ItemScreenProps {
  data: LoadedData
  id: string
  /** どの一覧から開いたか(URL の ?from=)。前後のニュースと戻り先をその一覧で決める */
  from?: ItemFrom
}

/**
 * 戻り先:ジャンルから開いたらそのジャンル、保存から開いたら保存、バックナンバーから開いたらその日のバックナンバー。
 * 無ければ今朝のネタはトップ、前の日のネタはそのジャンル
 */
function backRoute(items: readonly Item[], item: Item, from: ItemFrom | undefined): Route {
  if (from?.kind === 'genre') return { name: 'genre', id: from.id, kind: 'all' }
  if (from?.kind === 'saved') return { name: 'saved' }
  // 記事の配信日と from の日付が違うときは、前後(neighbors)と同じく from なしの戻り先にそろえる
  if (from?.kind === 'archive' && item.date === from.date) return { name: 'archive', date: from.date }
  return item.date === latestDate(items) || item.genre === null ? { name: 'home' } : { name: 'genre', id: item.genre, kind: 'all' }
}

export function ItemScreen({ data, id, from }: ItemScreenProps) {
  const { items, genres } = data
  const saved = useUserState().saved
  const item = findItem(items, id)
  if (item === null) {
    return (
      <section className={styles.detail} aria-labelledby="item-title">
        <h1 id="item-title" className={pageStyles.heading} tabIndex={-1}>
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

  return (
    <ItemView
      key={item.id}
      item={item}
      genreLabel={genreLabel}
      back={backRoute(items, item, from)}
      nav={neighbors(items, item, from, saved)}
      from={from}
    />
  )
}

interface ItemViewProps {
  item: Item
  genreLabel: string
  back: Route
  nav: ReturnType<typeof neighbors>
  /** 前後のリンク・スワイプの移り先にも同じ from を付ける(移っても同じ一覧の中で進む) */
  from: ItemFrom | undefined
}

function ItemView({ item, genreLabel, back, nav, from }: ItemViewProps) {
  const routeOf = (target: Item): Route => ({ name: 'item', id: target.id, from })
  const titleRef = useRef<HTMLHeadingElement>(null)
  const store = useUserStore()
  const feedback = useUserState().feedback[item.id] ?? {}
  // 自分で付けた評価・メモがあればそれを、無ければネタに元から付いているものを出す
  const rating: Rating = feedback.rating ?? item.rating
  const memo = feedback.memo ?? item.memo
  const memoSaved = feedback.memo !== undefined
  // 画像が無い・危ない・読み込みに失敗したときは、大きな枠を出さずに出典の横へ小さな札を出す(仕様 4 章-5、5 章)
  const thumb = useThumb(item.imageUrl)
  const body = item.points.length > 0 ? bodyParagraphs(item.summary) : []

  // 左右のスワイプで前後のニュースへ(仕様 7 章)。移り方は下の「前後のニュース」のリンクと同じ(URL が変わり、「戻る」で戻れる)
  const swipeRef = useRef<HTMLDivElement>(null)
  const swipeHandlers = useSwipe(swipeRef, {
    canLeft: nav.next !== null,
    canRight: nav.prev !== null,
    onLeft: () => {
      if (nav.next !== null) navigate(routeOf(nav.next))
    },
    onRight: () => {
      if (nav.prev !== null) navigate(routeOf(nav.prev))
    },
  })

  // ネタが切り替わったら、見出しに焦点を移す(読み上げにも「新しいネタに移った」と伝わる)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [item.id])

  const backLabel = '一覧に戻る'

  return (
    <article className={styles.detail} aria-labelledby="item-title" {...swipeHandlers}>
      {/* 読了バーは画面に固定するため、スワイプで動く枠の外に置く(中に置くと、記事と一緒に動く) */}
      <ReadingProgress />
      <div ref={swipeRef} className={styles.swipe}>
        {/* 戻るリンクは1行に独立させ、ジャンル名はその下の行(仕様 4 章-5) */}
        <a className={styles.back} href={hrefFor(back)}>
          <Icon name="back" />
          {backLabel}
        </a>
        <span className={pageStyles.label}>{genreLabel}</span>
        <h1 id="item-title" ref={titleRef} className={styles.title} tabIndex={-1}>
          {item.title !== '' ? item.title : '(見出しなし)'}
        </h1>
        <div className={styles.metaRow}>
          {thumb.shown ? null : <SourceBadge initial={itemInitial(item, genreLabel)} />}
          <span>{itemSourceName(item, genreLabel)}</span>
          {/* 元記事の公開日(無ければ「公開日不明」)。その右の日付は今までどおり配信日 */}
          <span>{formatPublishedDate(item.publishedAt)}</span>
          <span>{formatDateLong(item.date)}</span>
          <span>
            {nav.position} / {nav.total}
          </span>
        </div>
        <div className={styles.actions}>
          <SaveButton id={item.id} labelled />
        </div>
        {thumb.shown ? (
          <div className={styles.hero}>
            <Thumb url={item.imageUrl} eager onFail={thumb.onFail} />
          </div>
        ) : null}

        {item.lead !== '' ? <p className={styles.lead}>{item.lead}</p> : null}

        {item.points.length > 0 || item.summary !== '' ? (
          // 本文が続くときは、箱の下を本文までの間にする。続かないときは、すぐ下の AI の注記に寄せる
          <section className={body.length > 0 ? styles.box : styles.boxBeforeNote} aria-labelledby="item-points">
            <h2 id="item-points" className={pageStyles.label}>
              要点
            </h2>
            {/* 箇条のデータ(points)があれば箇条、無ければ summary を段落のまま。文を切って箇条を作らない */}
            {item.points.length > 0 ? (
              <ul className={styles.points}>
                {item.points.map((point, index) => (
                  // 同じ文の箇条が重なることがあるため、順番を鍵にする(並びは変わらない)
                  <li key={index}>{point}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.boxText}>{item.summary}</p>
            )}
          </section>
        ) : null}

        {/* 本文:points と summary の両方があるときだけ、summary を段落に分けて出す(points が無いときは上の要点の欄に出すので、2回出さない) */}
        {body.length > 0 ? (
          <section className={styles.body} aria-labelledby="item-body">
            <h2 id="item-body" className={pageStyles.label}>
              本文
            </h2>
            {body.map((paragraph, index) => (
              // 同じ文の段落が重なることがあるため、順番を鍵にする(並びは変わらない)
              <p key={index} className={styles.bodyParagraph}>
                {paragraph}
              </p>
            ))}
          </section>
        ) : null}

        {/* AI の注記は、本文の後(本文が無ければ要点の後) */}
        {item.points.length > 0 || item.summary !== '' ? <p className={styles.aiNoteBlock}>要点と本文は、元の記事をもとにAIがまとめたものです。</p> : null}

        {item.excerpt !== '' ? (
          <section className={styles.excerpt} aria-labelledby="item-excerpt">
            <h2 id="item-excerpt" className={pageStyles.label}>
              元記事の抜粋
            </h2>
            {/* 原文を手を加えずに引用する。文字のまま出す(HTML として解釈しない) */}
            <blockquote className={styles.quote}>{item.excerpt}</blockquote>
          </section>
        ) : null}

        {/* 「試してみる/確かめること」「気をつけること」は出さない(データの tryit・caution は消さず、画面で使わないだけ。詳細設計 5.5.3) */}
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
            <a className={styles.pagerLink} href={hrefFor(routeOf(nav.prev))} rel="prev">
              前のニュース
            </a>
          ) : (
            <span className={styles.pagerDisabled}>前のニュース</span>
          )}
          <span className={styles.pagerPosition} aria-hidden="true">
            {nav.position} / {nav.total}
          </span>
          {nav.next !== null ? (
            <a className={styles.pagerLink} href={hrefFor(routeOf(nav.next))} rel="next">
              次のニュース
            </a>
          ) : (
            <a className={styles.pagerLink} href={hrefFor(back)}>
              {backLabel}
            </a>
          )}
        </nav>
      </div>
    </article>
  )
}

/** 本文の段落:summary を改行(1つ以上)で分け、空白だけの段落は捨てる。文字のまま(HTML として解釈しない) */
function bodyParagraphs(summary: string): string[] {
  return summary
    .split(/[\r\n]+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
