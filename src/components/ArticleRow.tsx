// 記事の行(今朝のラインナップ、ジャンル、保存、さがすで共通)。
// 見出しが本物のリンク(a)。行全体をクリックにはしない。保存ボタンはリンクの外(仕様 7 章)
import { hrefFor } from '../app/router.ts'
import { initialOf, isRated } from '../data/queries.ts'
import type { Item } from '../data/types.ts'
import { SaveButton } from './SaveButton.tsx'
import { Thumb } from './Thumb.tsx'
import pageStyles from './page.module.css'
import styles from './ArticleRow.module.css'

interface ArticleRowProps {
  item: Item
  genreLabel: string
  /** 放送順の番号(今朝のラインナップだけ)。無ければ番号の列を出さない */
  order?: number
  /** 見出しの段階。h1 の直下に並ぶ一覧では 2、h2 の区切りの下では 3(段階を飛ばさないため) */
  headingLevel?: 2 | 3
}

export function itemInitial(item: Item, genreLabel: string): string {
  return initialOf(genreLabel !== '' ? genreLabel : item.title)
}

export function ArticleRow({ item, genreLabel, order, headingLevel = 3 }: ArticleRowProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <li className={order === undefined ? styles.rowNoOrder : styles.row}>
      {order !== undefined ? (
        <span className={styles.order} aria-hidden="true">
          {order}
        </span>
      ) : null}
      <div className={styles.body}>
        <span className={pageStyles.label}>{genreLabel}</span>
        <Heading className={styles.title}>
          <a className={styles.link} href={hrefFor({ name: 'item', id: item.id })}>
            {item.title !== '' ? item.title : '(見出しなし)'}
          </a>
        </Heading>
        {item.lead !== '' ? <p className={styles.summary}>{item.lead}</p> : null}
        <div className={styles.meta}>
          {item.sourceTitle !== '' ? <span>{item.sourceTitle}</span> : null}
          {isRated(item) ? <span>評価済み</span> : null}
          <span className={styles.save}>
            <SaveButton id={item.id} />
          </span>
        </div>
      </div>
      <div className={styles.thumb}>
        <Thumb url={item.imageUrl} initial={itemInitial(item, genreLabel)} />
      </div>
    </li>
  )
}
