// 脆弱性の個別の画面:CVE 番号、深刻度、CVSS、概要、対象の製品、ベンダー、公開日、修正の状況、情報源、前後の脆弱性。
// 前後は脆弱性の一覧の順(新しい順)で、一覧で深刻度を絞っていたときはその絞りの中(URL の ?sev=。詳細設計 5.6.2)。
// 移り方はニュースの詳細と同じ:左右のスワイプ(useSwipe)と、下の「前の脆弱性/次の脆弱性」のリンク
import { useEffect, useRef } from 'react'
import { hrefFor, navigate, type Route, type SeverityFilter } from '../app/router.ts'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { SeverityPill } from '../components/SeverityPill.tsx'
import { TranslationLine } from '../components/TranslationLine.tsx'
import { vulnName } from '../components/VulnCard.tsx'
import { PUBLISHED_UNKNOWN } from '../data/labels.ts'
import { findFeedEntry, vulnNeighbors, type VulnNeighbors } from '../data/queries.ts'
import type { LoadedData } from '../data/source.ts'
import type { FeedEntry } from '../data/types.ts'
import { formatCvss, formatJstDate } from '../lib/format.ts'
import { hostOf, httpsHref } from '../lib/safeUrl.ts'
import { useSwipe } from '../lib/useSwipe.ts'
import pageStyles from '../components/page.module.css'
import styles from './VulnDetailScreen.module.css'

interface VulnDetailScreenProps {
  data: LoadedData
  id: string
  /** 一覧で絞っていた深刻度。前後と戻り先をこの絞りの中で決める */
  severity: SeverityFilter
}

export function VulnDetailScreen({ data, id, severity }: VulnDetailScreenProps) {
  const entry = findFeedEntry(data.feed, id)
  // 戻り先は、絞りを付けた一覧
  const backHref = hrefFor({ name: 'vuln', severity })
  // 脆弱性でない id・絞りに入らない id は、前後を作らず「見つからない」
  const nav = entry?.kind === 'vuln' ? vulnNeighbors(data.feed, entry.id, severity) : null

  if (entry === null || nav === null) {
    return (
      <section className={styles.detail} aria-labelledby="vuln-detail-title">
        <h1 id="vuln-detail-title" className={pageStyles.heading} tabIndex={-1}>
          この脆弱性は見つかりません
        </h1>
        <EmptyState title="削除されたか、アドレスが違うようです" text="一覧から選び直してください。" spaced />
        <a className={styles.back} href={backHref}>
          <Icon name="back" />
          脆弱性の一覧に戻る
        </a>
      </section>
    )
  }

  return <VulnView key={entry.id} entry={entry} nav={nav} severity={severity} backHref={backHref} />
}

interface VulnViewProps {
  entry: FeedEntry
  nav: VulnNeighbors
  severity: SeverityFilter
  backHref: string
}

function VulnView({ entry, nav, severity, backHref }: VulnViewProps) {
  // 前後のリンク・スワイプの移り先にも同じ絞りを付ける(移っても同じ絞りの中で進む)
  const routeOf = (target: FeedEntry): Route => ({ name: 'vuln-detail', id: target.id, severity })
  const titleRef = useRef<HTMLHeadingElement>(null)
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

  // 脆弱性が切り替わったら、見出しに焦点を移す(ニュースの詳細と同じ。読み上げにも移ったことが伝わる)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [entry.id])

  const href = httpsHref(entry.url)
  const fields: { label: string; value: string }[] = [
    { label: '対象の製品', value: entry.product },
    { label: 'ベンダー', value: entry.vendor },
    { label: '公開日', value: entry.publishedAt === '' ? PUBLISHED_UNKNOWN : formatJstDate(entry.publishedAt) },
    { label: '修正の状況', value: entry.status !== '' ? entry.status : '不明' },
  ]

  return (
    <article className={styles.detail} aria-labelledby="vuln-detail-title" {...swipeHandlers}>
      <div ref={swipeRef} className={styles.swipe}>
        <a className={styles.back} href={backHref}>
          <Icon name="back" />
          脆弱性の一覧に戻る
        </a>
        <h1 id="vuln-detail-title" ref={titleRef} className={styles.title} tabIndex={-1}>
          {vulnName(entry)}
        </h1>
        <div className={styles.head}>
          <SeverityPill severity={entry.severity} />
          <div className={styles.score}>
            <strong>{formatCvss(entry.cvss)}</strong>
            <span>CVSS</span>
          </div>
        </div>
        {/* 訳があるときは、原文(英日の翻訳の元)に lang="en" を付ける */}
        <p className={styles.summary} lang={entry.title !== '' && entry.titleJa !== undefined ? 'en' : undefined}>
          {entry.title}
        </p>
        {/* 識別情報(CVE 番号・深刻度)の後、原文の直下に訳を1行で(design_spec v3.9 の 4-4)。訳が無ければ何も出さない */}
        <TranslationLine original={entry.title} translation={entry.titleJa} />
        <dl className={styles.fields}>
          {fields
            .filter((field) => field.value !== '')
            .map((field) => (
              <div key={field.label} className={styles.field}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          <div className={styles.field}>
            <dt>情報源</dt>
            <dd>
              {href === null ? (
                entry.url !== '' ? (
                  <span>{entry.url}(リンクにしていません)</span>
                ) : (
                  '不明'
                )
              ) : (
                <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
                  {hostOf(href)}
                  <span className="visually-hidden">(新しいタブで開く)</span>
                </a>
              )}
            </dd>
          </div>
        </dl>

        {/* 前後の脆弱性。端では押せない文字(ニュースの詳細の pager と同じ見た目) */}
        <nav className={styles.pager} aria-label="前後の脆弱性">
          {nav.prev !== null ? (
            <a className={styles.pagerLink} href={hrefFor(routeOf(nav.prev))} rel="prev">
              前の脆弱性
            </a>
          ) : (
            <span className={styles.pagerDisabled}>前の脆弱性</span>
          )}
          <span className={styles.pagerPosition}>
            {nav.position} / {nav.total}
          </span>
          {nav.next !== null ? (
            <a className={styles.pagerLink} href={hrefFor(routeOf(nav.next))} rel="next">
              次の脆弱性
            </a>
          ) : (
            <span className={styles.pagerDisabled}>次の脆弱性</span>
          )}
        </nav>
      </div>
    </article>
  )
}
