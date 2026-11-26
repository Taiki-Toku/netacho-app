// 記事の行(今朝のラインナップ、ジャンル、保存、さがすで共通)。
// 見出しが本物のリンク(a)。行全体をクリックにはしない。保存ボタンはリンクの外(仕様 7 章)。
// 押せる範囲は、リンクの疑似要素(::after)で行全体に広げ、保存ボタンだけをその上に出す(CSS 側)
import { hrefFor, type ItemFrom } from '../app/router.ts'
import { isRated } from '../data/queries.ts'
import { itemSourceName, sourceInitial } from '../data/sourceName.ts'
import type { Item } from '../data/types.ts'
import { formatPublishedDate } from '../lib/format.ts'
import { SaveButton } from './SaveButton.tsx'
import { SourceBadge } from './SourceBadge.tsx'
import { Thumb, useThumb } from './Thumb.tsx'
import pageStyles from './page.module.css'
import styles from './ArticleRow.module.css'

interface ArticleRowProps {
  item: Item
  genreLabel: string
  /** 放送順の番号(今朝のラインナップだけ)。無ければ番号の列を出さない */
  order?: number
  /** 見出しの段階。h1 の直下に並ぶ一覧では 2、h2 の区切りの下では 3(段階を飛ばさないため) */
  headingLevel?: 2 | 3
  /** リードを1行に詰め、スマホでも出す(今朝のラインナップ。仕様 4 章 1) */
  oneLineLead?: boolean
  /** どの一覧の行か(ジャンル・保存・バックナンバーだけ)。リンクに付け、詳細の前後と戻り先をその一覧で決める(仕様 4 章 5) */
  from?: ItemFrom
}

/** 画像の無いネタの札に出す頭文字。画面に出す媒体名(URL が無ければジャンル名)の最初の1文字を大文字で(仕様 4〜5 章) */
export function itemInitial(item: Item, genreLabel: string): string {
  return sourceInitial(itemSourceName(item, genreLabel))
}

export function ArticleRow({ item, genreLabel, order, headingLevel = 3, oneLineLead = false, from }: ArticleRowProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  // 画像が無い・危ない・読み込みに失敗したときは、画像の場所を取らず、出典の横に小さな札を出す(仕様 5 章)
  const thumb = useThumb(item.imageUrl)
  return (
    // value:読み上げの番号を、見える放送順の番号(order)にそろえる(欠番があっても食い違わない)
    <li className={styles.row} value={order}>
      {order !== undefined ? (
        <span className={styles.order} aria-hidden="true">
          {order}
        </span>
      ) : null}
      <div className={styles.body}>
        <span className={pageStyles.label}>{genreLabel}</span>
        <Heading className={styles.title}>
          <a className={styles.link} href={hrefFor({ name: 'item', id: item.id, from })}>
            {item.title !== '' ? item.title : '(見出しなし)'}
          </a>
        </Heading>
        {item.lead !== '' ? <p className={oneLineLead ? styles.summaryOneLine : styles.summary}>{item.lead}</p> : null}
        <div className={styles.meta}>
          {thumb.shown ? null : <SourceBadge initial={itemInitial(item, genreLabel)} />}
          <span>{itemSourceName(item, genreLabel)}</span>
          {/* 公開日は出典と同じ補助情報の並びに(design_spec v3.9 の 3-1)。配信日では代わりにしない */}
          <span>{formatPublishedDate(item.publishedAt)}</span>
          {isRated(item) ? <span>評価済み</span> : null}
          <span className={styles.save}>
            <SaveButton id={item.id} />
          </span>
        </div>
      </div>
      {thumb.shown ? (
        <div className={styles.thumb}>
          <Thumb url={item.imageUrl} onFail={thumb.onFail} />
        </div>
      ) : null}
    </li>
  )
}
