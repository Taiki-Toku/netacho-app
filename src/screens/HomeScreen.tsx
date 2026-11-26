// トップ(ホーム):日付の導線(今日の日付とバックナンバーへのリンク。v3.9)→ トップ(画像 + 文章の大きな枠)→ 脆弱性ウォッチの帯 → ニュース一覧(全件、配信の順)(仕様 4 章 1)。
// 見出し「今日のニュース」は画面に出さず、読み上げ用の h1 としてだけ置く(日付は上のバー、件数は一覧の見出しの横にあるため)
import { hrefFor } from '../app/router.ts'
import { ArticleRow, itemInitial } from '../components/ArticleRow.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { SaveButton } from '../components/SaveButton.tsx'
import { SourceBadge } from '../components/SourceBadge.tsx'
import { Thumb, useThumb } from '../components/Thumb.tsx'
import { vulnName } from '../components/VulnCard.tsx'
import { countBySeverity, genreLabelMap, genreLabelOf, itemsOnDate, latestDate, vulnerabilities } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import { itemSourceName } from '../data/sourceName.ts'
import type { FeedEntry, Item } from '../data/types.ts'
import { formatCvss, formatDateHeader, tokyoToday } from '../lib/format.ts'
import pageStyles from '../components/page.module.css'
import styles from './HomeScreen.module.css'

interface HomeScreenProps {
  data: LoadedData
  /** 登場アニメを付けるか(トップの最初の表示だけ true。App が決める) */
  intro: boolean
}

export function HomeScreen({ data, intro }: HomeScreenProps) {
  const { items, genres, feed } = data
  const date = latestDate(items)
  const list = date === null ? [] : itemsOnDate(items, date)
  const labels = genreLabelMap(genres)
  const top = list[0]
  // 登場アニメは枠ごとに少しずらす(クラスが無ければ動かない)
  const step = (n: 1 | 2 | 3) => (intro ? styles[`intro${n}`] : undefined)

  return (
    <>
      {/* 日付の導線(design_spec v3.9 の 4-1):今日の日付(日本時間)と、バックナンバーへのリンクを1行で。上のバーの日付(配信日)とは別。
          トップの枠より上に置くため、番組の並び(h1 → 枠 → 帯 → 一覧)を持つ section の外の前に置く */}
      <nav className={styles.dateGuide} aria-label="日付">
        <span className={styles.dateGuideToday}>{formatDateHeader(tokyoToday(new Date()))}</span>
        <a className={`${pageStyles.textLink} ${styles.dateGuideLink}`} href={hrefFor({ name: 'archive', date: null })}>
          バックナンバー
        </a>
      </nav>
      <section aria-labelledby="home-title">
        <h1 id="home-title" className="visually-hidden" tabIndex={-1}>
          今日のニュース
        </h1>

        {top === undefined ? (
          <EmptyState title="今日のニュースはまだありません" text="配信が届くと、ここに並びます。" spaced />
        ) : (
          // key:トップの記事が替わったら、画像の読み込み失敗の記録を持ち越さない
          <Feature key={top.id} item={top} genreLabel={genreLabelOf(top, labels)} introClass={step(1)} />
        )}

        <div className={step(2)}>
          <VulnBand feed={feed} />
        </div>

        {top !== undefined ? (
          <div className={step(3)}>
            <div className={pageStyles.sectionHead}>
              <h2 className={pageStyles.sectionTitle}>ニュース一覧</h2>
              <span className={pageStyles.caption}>全{list.length}本</span>
            </div>
            <ol className={pageStyles.list} aria-label="ニュース一覧">
              {list.map((item) => (
                <ArticleRow key={item.id} item={item} genreLabel={genreLabelOf(item, labels)} order={item.order} oneLineLead />
              ))}
            </ol>
          </div>
        ) : null}
        {data.source === 'fixtures' ? <p className={pageStyles.sampleNote}>表示しているのは、すべて見本用の架空データです。</p> : null}
      </section>
    </>
  )
}

interface FeatureProps {
  item: Item
  genreLabel: string
  /** 登場アニメのクラス(付けないときは undefined) */
  introClass: string | undefined
}

/**
 * トップの大きな枠。画像が無い・危ない・読み込みに失敗したときは、画像の場所を取らず、文章だけで全幅にする(仕様 5 章)。
 * 押せる範囲は、見出しのリンクの ::after で枠全体に広げる。保存ボタンはリンクの外に置き、その上に出す(仕様 7 章。記事の行と同じ作り)
 */
function Feature({ item, genreLabel, introClass }: FeatureProps) {
  const thumb = useThumb(item.imageUrl)
  return (
    <article
      className={[thumb.shown ? styles.feature : styles.featureTextOnly, introClass].filter(Boolean).join(' ')}
      aria-labelledby="feature-title"
    >
      <div className={styles.featureCopy}>
        <span className={pageStyles.label}>トップ</span>
        <h2 id="feature-title" className={styles.featureTitle}>
          <a className={styles.featureLink} href={hrefFor({ name: 'item', id: item.id })}>
            {item.title !== '' ? item.title : '(見出しなし)'}
          </a>
        </h2>
        {item.lead !== '' ? <p className={styles.featureDesc}>{item.lead}</p> : null}
        <div className={styles.metaRow}>
          <span className={pageStyles.label}>{genreLabel}</span>
          {thumb.shown ? null : <SourceBadge initial={itemInitial(item, genreLabel)} />}
          <span>{itemSourceName(item, genreLabel)}</span>
          <span className={styles.metaSave}>
            <SaveButton id={item.id} />
          </span>
        </div>
      </div>
      {thumb.shown ? (
        <div className={styles.featureImage}>
          <Thumb url={item.imageUrl} eager onFail={thumb.onFail} />
        </div>
      ) : null}
    </article>
  )
}

/** 脆弱性ウォッチの帯1本:緊急の件数、いちばん新しい CVE と CVSS。0件でも帯は消さない */
function VulnBand({ feed }: { feed: readonly FeedEntry[] }) {
  const vulns = vulnerabilities(feed)
  const latest = vulns[0]
  if (latest === undefined) {
    return <EmptyState title="公式情報はまだありません" text="脆弱性ウォッチ:配信が届くと、Critical の件数と最新の CVE をここに出します。" band />
  }
  const critical = countBySeverity(vulns).critical
  return (
    <a
      className={styles.band}
      href={hrefFor({ name: 'vuln', severity: 'all' })}
      // 見た目の文字はつながって読まれるため、区切りを入れた名前を付ける(見える文字で始める)
      aria-label={`脆弱性ウォッチ。Critical ${critical}件。最新:${vulnName(latest)} ${latest.product}、CVSS ${formatCvss(latest.cvss)}`}
    >
      <span className={styles.bandBody}>
        <strong className={styles.bandTitle}>
          脆弱性ウォッチ<span className={styles.bandCount}>Critical {critical}件</span>
        </strong>
        <small className={styles.bandText}>
          最新:{vulnName(latest)} {latest.product}
        </small>
      </span>
      <span className={styles.bandScore}>
        <span className={styles.bandScoreLabel}>CVSS</span>
        {formatCvss(latest.cvss)}
      </span>
    </a>
  )
}
