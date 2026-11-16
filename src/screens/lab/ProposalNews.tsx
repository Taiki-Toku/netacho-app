// 案4「ニュースアプリ型」:上に横並びのジャンルのタブ、先頭に大きな1本、続いて密度の高い一覧。
// 写真の代わりに「ジャンルの色の版」「話題度の5マス」「番組の順番の番号(今日だけ)」で見分ける。
// 「今日」のタブだけが番組(コーナーの札が主役)、ジャンルのタブは分野ごとの新着(ジャンルが主役)。
// 公式フィードは、セキュリティニュース(障害)・プロダクト(発表)・脆弱性(深刻さ)の各タブに別の枠で出す。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { NAV_LABELS, orderLabel, ratingLabel, sourceHref, statusLabel, type LabProps } from './labData.ts'
import type { LoadedData } from '../../data/source.ts'
import type { FeedEntry, FeedKind, Item } from '../../data/types.ts'
import { FEED_KIND_LABELS, SEVERITY_LABELS, STAR_AXES } from '../../data/labels.ts'
import { feedOfKinds, feedProducts, findItem, genreLabelMap, itemsInGenre, itemsOnDate, latestDate } from '../../data/queries.ts'
import { dateParts, formatDateLong, formatDateShort, formatJstDateTime } from '../../lib/format.ts'
import { httpsHref } from '../../lib/safeUrl.ts'
import { useSwipe } from '../../lib/useSwipe.ts'
import styles from './ProposalNews.module.css'

type Props = LabProps & { data: LoadedData }

const TODAY_TAB = 'today'

/** タブごとの公式フィードの枠(追加依頼 2026-11-16 のタブとデータの対応)。genre の id は fixtures/genres.json のもの */
const FEED_FRAMES: Record<string, { title: string; kinds: readonly FeedKind[]; byProduct: boolean; first: boolean }> = {
  'security-news': { title: '障害情報', kinds: ['outage'], byProduct: false, first: false },
  product: { title: '公式の発表', kinds: ['release', 'eol', 'change', 'exam'], byProduct: true, first: false },
  vuln: { title: '脆弱性の公式情報', kinds: ['vuln'], byProduct: false, first: true },
}

export function ProposalNews({ screen, theme, itemId, data, onOpen, onBack }: Props) {
  const [tab, setTab] = useState<string>(TODAY_TAB)
  const { items, genres, feed } = data
  const labels = genreLabelMap(genres)
  const genreLabel = (item: Item) => (item.genre === null ? '未分類' : (labels.get(item.genre) ?? item.genre))

  const today = latestDate(items)
  const tabs = [{ id: TODAY_TAB, label: '今日' }, ...genres.map((genre) => ({ id: genre.id, label: genre.label }))]
  const tabIndex = Math.max(
    0,
    tabs.findIndex((candidate) => candidate.id === tab),
  )
  const list = tab === TODAY_TAB ? (today === null ? [] : itemsOnDate(items, today)) : itemsInGenre(items, tab)

  const moveTab = (delta: number) => {
    const next = tabs[tabIndex + delta]
    if (next !== undefined) setTab(next.id)
  }

  // 詳細:開いたネタ。無ければ今のタブの1本目。前後は今のタブの一覧の中で移る
  const opened = itemId === null ? null : findItem(items, itemId)
  const current = opened ?? list[0] ?? null
  const currentIndex = current === null ? -1 : list.findIndex((candidate) => candidate.id === current.id)

  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.top}>
        <span className={styles.wordmark}>AIネタ帳</span>
        {today !== null ? <DateBadge date={today} /> : null}
        {screen === 'today' || current === null ? <span className={styles.topCount}>{list.length}本</span> : null}
      </header>

      {screen === 'today' || current === null ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label="ジャンル">
            {tabs.map((candidate, index) => (
              <TabButton
                key={candidate.id}
                id={candidate.id}
                label={candidate.label}
                selected={index === tabIndex}
                onSelect={() => {
                  setTab(candidate.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    moveTab(1)
                  } else if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    moveTab(-1)
                  }
                }}
              />
            ))}
          </div>
          <TabPanel
            key={tab}
            tab={tab}
            tabLabel={tabs[tabIndex]?.label ?? '今日'}
            list={list}
            feed={feed}
            today={today}
            genreLabel={genreLabel}
            onOpen={onOpen}
            onSwipeLeft={() => {
              moveTab(1)
            }}
            onSwipeRight={() => {
              moveTab(-1)
            }}
          />
        </>
      ) : (
        <Detail
          key={current.id}
          item={current}
          tabLabel={tabs[tabIndex]?.label ?? '今日'}
          position={currentIndex === -1 ? null : { index: currentIndex, total: list.length }}
          prev={currentIndex > 0 ? (list[currentIndex - 1] ?? null) : null}
          next={currentIndex === -1 ? null : (list[currentIndex + 1] ?? null)}
          genreLabel={genreLabel(current)}
          onOpen={onOpen}
          onBack={onBack}
        />
      )}

      <nav className={styles.channels} aria-label="画面の切り替え">
        {NAV_LABELS.map((label, index) => (
          <button key={label} type="button" className={styles.channel} aria-current={index === 0 ? 'page' : undefined}>
            <span className={styles.channelNo} aria-hidden="true">
              {index + 1}
            </span>
            <span className={styles.channelLabel}>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function DateBadge({ date }: { date: string }) {
  const parts = dateParts(date)
  if (parts === null) return <span className={styles.topDate}>{date}</span>
  return (
    <span className={styles.topDate}>
      <span className="visually-hidden">放送日 {formatDateLong(date)}</span>
      <span aria-hidden="true">
        {parts.month}.{parts.day}
        <span className={styles.topWeek}>{parts.weekday}</span>
      </span>
    </span>
  )
}

interface TabButtonProps {
  id: string
  label: string
  selected: boolean
  onSelect: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

function TabButton({ id, label, selected, onSelect, onKeyDown }: TabButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  // 選んだタブが画面の外にあれば、見える所まで横に送る(jsdom には無い関数なので、有るときだけ)
  useEffect(() => {
    if (selected && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
  }, [selected])
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`news-tab-${id}`}
      className={styles.tab}
      data-genre={id}
      aria-selected={selected}
      aria-controls={`news-panel-${id}`}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      {label}
    </button>
  )
}

interface TabPanelProps {
  tab: string
  tabLabel: string
  list: Item[]
  feed: FeedEntry[]
  today: string | null
  genreLabel: (item: Item) => string
  onOpen: (id: string) => void
  onSwipeLeft: () => void
  onSwipeRight: () => void
}

function TabPanel({ tab, tabLabel, list, feed, today, genreLabel, onOpen, onSwipeLeft, onSwipeRight }: TabPanelProps) {
  const swipe = useSwipe({ onLeft: onSwipeLeft, onRight: onSwipeRight })
  const isToday = tab === TODAY_TAB
  const [first, ...rest] = list
  const frame = FEED_FRAMES[tab]
  const feedSection =
    frame === undefined ? null : <FeedFrame title={frame.title} entries={feedOfKinds(feed, frame.kinds)} byProduct={frame.byProduct} />

  return (
    <div
      id={`news-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`news-tab-${tab}`}
      className={styles.panel}
      data-genre={tab}
      onTouchStart={swipe.onTouchStart}
      onTouchEnd={swipe.onTouchEnd}
    >
      <div className={styles.column}>
        {frame?.first === true ? feedSection : null}

        {first === undefined ? (
          <p className={styles.empty}>{isToday ? '今日の放送はまだありません。' : 'このジャンルのネタはまだありません。'}</p>
        ) : (
          <button
            type="button"
            className={styles.hero}
            data-genre={isToday ? TODAY_TAB : (first.genre ?? '')}
            onClick={() => {
              onOpen(first.id)
            }}
          >
            <span className={styles.heroHead}>
              {isToday ? (
                <>
                  <span className={styles.heroNo}>{orderLabel(first.order)}</span>
                  <span className={styles.heroSlot}>{first.slot}</span>
                </>
              ) : (
                <>
                  <span className={styles.heroGenre}>{genreLabel(first)}</span>
                  <span className={styles.heroDate}>{formatDateShort(first.date)}</span>
                </>
              )}
              {first.rating !== '' ? <Done /> : null}
            </span>
            <span className={styles.heroTitle}>{first.title !== '' ? first.title : '(見出しなし)'}</span>
            {first.lead !== '' ? <span className={styles.heroLead}>{first.lead}</span> : null}
            <span className={styles.heroFoot}>
              <HotMeter value={first.stars.hot} />
              {first.trust !== '' ? <span className={styles.heroTrust}>{first.trust}</span> : null}
            </span>
          </button>
        )}

        {rest.length > 0 ? (
          isToday ? (
            <ol className={styles.rows} aria-label="この後のネタ">
              {rest.map((item) => (
                <li key={item.id}>
                  <Row item={item} today genreLabel={genreLabel(item)} onOpen={onOpen} />
                </li>
              ))}
            </ol>
          ) : (
            <ul className={styles.rows} aria-label={`${tabLabel}の新着`}>
              {rest.map((item) => (
                <li key={item.id}>
                  <Row item={item} today={false} genreLabel={genreLabel(item)} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {isToday && today !== null && list.length > 0 ? (
          <p className={styles.endNote}>{formatDateLong(today)}の放送は以上です。</p>
        ) : null}
      </div>

      {frame !== undefined && !frame.first ? <div className={styles.side}>{feedSection}</div> : null}
    </div>
  )
}

interface RowProps {
  item: Item
  today: boolean
  genreLabel: string
  onOpen: (id: string) => void
}

function Row({ item, today, genreLabel, onOpen }: RowProps) {
  return (
    <button
      type="button"
      className={today ? styles.rowToday : styles.row}
      data-genre={item.genre ?? ''}
      onClick={() => {
        onOpen(item.id)
      }}
    >
      {today ? <span className={styles.rowNo}>{orderLabel(item.order)}</span> : null}
      <span className={styles.rowMain}>
        <span className={item.rating !== '' ? styles.rowTitleDone : styles.rowTitle}>
          {item.title !== '' ? item.title : '(見出しなし)'}
        </span>
        <span className={styles.rowMeta}>
          {today ? (
            <>
              {item.slot !== '' ? <span className={styles.rowSlot}>{item.slot}</span> : null}
              <span className={styles.rowGenre}>{genreLabel}</span>
            </>
          ) : (
            <>
              <span className={styles.rowSource}>{item.sourceTitle !== '' ? item.sourceTitle : item.trust}</span>
              <span>{formatDateShort(item.date)}</span>
            </>
          )}
        </span>
      </span>
      <span className={styles.rowEnd}>
        {item.rating !== '' ? <Done /> : null}
        <HotMeter value={item.stars.hot} />
      </span>
    </button>
  )
}

/** 話題度の5マス。写真の代わりに行の「熱」を見せる */
function HotMeter({ value }: { value: number }) {
  return (
    <span className={styles.hot} role="img" aria-label={`話題度 ${value}/5`}>
      {[0, 1, 2, 3, 4].map((cell) => (
        <span key={cell} className={cell < value ? styles.hotOn : styles.hotOff} />
      ))}
    </span>
  )
}

function Done() {
  return (
    <span className={styles.done} role="img" aria-label="評価済み">
      済
    </span>
  )
}

interface FeedFrameProps {
  title: string
  entries: FeedEntry[]
  byProduct: boolean
}

/** 公式フィードの枠。ネタとは別の種類のデータなので、色版も星も付けず、公式の発表を時系列で並べる */
function FeedFrame({ title, entries, byProduct }: FeedFrameProps) {
  const [product, setProduct] = useState<string>('')
  const products = byProduct ? feedProducts(entries) : []
  const shown = product === '' ? entries : entries.filter((entry) => entry.product === product)
  const headingId = `news-feed-${title}`
  return (
    <section className={styles.feed} aria-labelledby={headingId}>
      {/* タブの中には h2 が無いので、枠の見出しを h2 にして h1(見比べ画面)→ h2 の順を守る */}
      <h2 id={headingId} className={styles.feedTitle}>
        {title}
        <span className={styles.feedCount}>{shown.length}件</span>
      </h2>
      {products.length > 0 ? (
        <div className={styles.chips} role="group" aria-label="製品で絞り込む">
          <button
            type="button"
            className={styles.chip}
            aria-pressed={product === ''}
            onClick={() => {
              setProduct('')
            }}
          >
            すべて
          </button>
          {products.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={styles.chip}
              aria-pressed={product === candidate}
              onClick={() => {
                setProduct(candidate)
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className={styles.empty}>公式の情報はまだありません。</p>
      ) : (
        <ul className={styles.feedList}>
          {shown.map((entry) => (
            <li key={entry.id} className={styles.feedRow}>
              <FeedMark entry={entry} />
              <span className={styles.feedMain}>
                <span className={styles.feedProduct}>{entry.product !== '' ? entry.product : entry.vendor}</span>
                <FeedTitle entry={entry} />
                <span className={styles.feedMeta}>
                  {entry.vendor !== '' && entry.product !== '' ? <span>{entry.vendor}</span> : null}
                  <span>{formatJstDateTime(entry.publishedAt)}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 行の左の札:障害は状態、脆弱性は深刻さ、それ以外は種類 */
function FeedMark({ entry }: { entry: FeedEntry }) {
  if (entry.kind === 'outage') {
    const active = entry.status !== '' && !entry.status.includes('復旧')
    return <span className={active ? styles.markActive : styles.markQuiet}>{entry.status !== '' ? entry.status : '障害'}</span>
  }
  if (entry.kind === 'vuln') {
    return (
      <span className={styles.markSeverity} data-severity={entry.severity}>
        <span className="visually-hidden">深刻さ </span>
        {SEVERITY_LABELS[entry.severity]}
      </span>
    )
  }
  return <span className={styles.markKind}>{FEED_KIND_LABELS[entry.kind]}</span>
}

/** 見出し。https: の URL だけリンクにする(httpsHref)。それ以外は文字のまま */
function FeedTitle({ entry }: { entry: FeedEntry }) {
  const href = httpsHref(entry.url)
  const title = entry.title !== '' ? entry.title : entry.url
  if (href !== null) {
    return (
      <a className={styles.feedLink} href={href} target="_blank" rel="noopener noreferrer">
        {title}
        <span className="visually-hidden">(新しいタブで開く)</span>
      </a>
    )
  }
  return (
    <span className={styles.feedText}>
      {entry.title}
      {entry.url !== '' ? <span className={styles.feedUrl}>{entry.url}</span> : null}
    </span>
  )
}

interface DetailProps {
  item: Item
  tabLabel: string
  position: { index: number; total: number } | null
  prev: Item | null
  next: Item | null
  genreLabel: string
  onOpen: (id: string) => void
  onBack: () => void
}

function Detail({ item, tabLabel, position, prev, next, genreLabel, onOpen, onBack }: DetailProps) {
  const href = sourceHref(item)
  const swipe = useSwipe({
    onLeft: () => {
      if (next !== null) onOpen(next.id)
    },
    onRight: () => {
      if (prev !== null) onOpen(prev.id)
    },
  })
  return (
    <article
      className={styles.article}
      data-genre={item.genre ?? ''}
      aria-labelledby="news-item-title"
      onTouchStart={swipe.onTouchStart}
      onTouchEnd={swipe.onTouchEnd}
    >
      <div className={styles.articleBar}>
        <button type="button" className={styles.back} onClick={onBack}>
          {tabLabel}の一覧へ
        </button>
        {position !== null ? (
          <span className={styles.position}>
            <span className="visually-hidden">{tabLabel}の</span>
            {position.index + 1}/{position.total}
            <span className="visually-hidden">本目</span>
          </span>
        ) : null}
      </div>

      <header className={styles.articleHead}>
        <p className={styles.articleMeta}>
          <span className={styles.articleGenre}>{genreLabel}</span>
          <span>{formatDateLong(item.date)}</span>
          {item.slot !== '' ? <span className={styles.articleSlot}>{item.slot}</span> : null}
        </p>
        <h2 id="news-item-title" className={styles.articleTitle}>
          {item.title !== '' ? item.title : '(見出しなし)'}
        </h2>
        {item.lead !== '' ? <p className={styles.articleLead}>{item.lead}</p> : null}
      </header>

      <div className={styles.articleGrid}>
        <div className={styles.articleMain}>
          {item.summary !== '' ? (
            <section className={styles.sec}>
              <h3 className={styles.secTitle}>要約</h3>
              <p className={styles.body}>{item.summary}</p>
            </section>
          ) : null}
          {item.tryit !== '' ? (
            <section className={styles.sec}>
              <h3 className={styles.secTitle}>試すなら</h3>
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
        </div>

        <div className={styles.articleSide}>
          <section className={styles.sec}>
            <h3 className={styles.secTitle}>指標</h3>
            <ul className={styles.meters}>
              {STAR_AXES.map((axis) => {
                const level = item.stars[axis.key]
                return (
                  <li key={axis.key} className={styles.meter}>
                    <span aria-hidden="true">{axis.label}</span>
                    <span className={styles.meterCells} role="img" aria-label={`${axis.label} ${level}/5`}>
                      {[0, 1, 2, 3, 4].map((cell) => (
                        <span key={cell} className={cell < level ? styles.cellOn : styles.cellOff} />
                      ))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className={styles.sec}>
            <h3 className={styles.secTitle}>出典</h3>
            {item.trust !== '' ? <p className={styles.trust}>{item.trust}</p> : null}
            {href !== null ? (
              <a className={styles.source} href={href} target="_blank" rel="noopener noreferrer">
                {item.sourceTitle !== '' ? item.sourceTitle : item.sourceUrl}
                <span className="visually-hidden">(新しいタブで開く)</span>
              </a>
            ) : item.sourceUrl !== '' || item.sourceTitle !== '' ? (
              <p className={styles.sourceText}>
                {item.sourceTitle}
                {item.sourceUrl !== '' ? <span className={styles.sourceUrl}>{item.sourceUrl}</span> : null}
              </p>
            ) : (
              <p className={styles.sourceText}>出典なし</p>
            )}
          </section>

          <section className={styles.sec}>
            <h3 className={styles.secTitle}>分類</h3>
            <ul className={styles.tags} aria-label="分類">
              {[...item.categories, ...item.projects, ...item.tags].map((tag, index) => (
                <li key={`${index}-${tag}`} className={styles.tag}>
                  {tag}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.sec}>
            <h3 className={styles.secTitle}>評価・扱い</h3>
            <p className={styles.verdict}>
              <span className={item.rating !== '' ? styles.verdictOn : styles.verdictNone}>{ratingLabel(item)}</span>
              <span className={styles.verdictStatus}>{statusLabel(item)}</span>
            </p>
            {item.memo !== '' ? <p className={styles.memo}>{item.memo}</p> : null}
          </section>
        </div>
      </div>

      <nav className={styles.pager} aria-label="前後のネタ">
        <button
          type="button"
          className={styles.pagerButton}
          disabled={prev === null}
          onClick={() => {
            if (prev !== null) onOpen(prev.id)
          }}
        >
          前のネタ
        </button>
        <button
          type="button"
          className={styles.pagerButtonMain}
          disabled={next === null}
          onClick={() => {
            if (next !== null) onOpen(next.id)
          }}
        >
          次のネタ
        </button>
      </nav>
    </article>
  )
}
