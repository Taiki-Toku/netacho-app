// 案3「スタジオの時計」:画面の隅の時計と「この後」の横の予定表。時刻が主役
import { useEffect, useState } from 'react'
import { NAV_LABELS, orderLabel, ratingLabel, sourceHref, statusLabel, type LabModel, type LabProps } from './labData.ts'
import type { Item } from '../../data/types.ts'
import { STAR_AXES } from '../../data/labels.ts'
import styles from './ProposalClock.module.css'

type Props = LabProps & { model: LabModel }

export function ProposalClock({ screen, theme, model, onOpen, onBack }: Props) {
  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.deck}>
        <Clock />
        <div className={styles.deckMeta}>
          <span className={styles.wordmark}>AIネタ帳</span>
          <span className={styles.deckDate}>
            {model.parts.month}.{model.parts.day} <span className={styles.deckWeek}>{model.parts.weekday}</span>
          </span>
          <span className={styles.deckCount}>
            {model.list.length}本 済{model.ratedCount}
          </span>
        </div>
      </header>

      {screen === 'today' ? (
        <section className={styles.today} aria-labelledby="clock-today">
          <div className={styles.todayHead}>
            <h2 id="clock-today" className={styles.todayTitle}>
              この後の予定
            </h2>
            <p className={styles.todayHint}>横に送る</p>
          </div>
          <ol className={styles.strip} aria-label="進行表">
            {model.list.map((item) => (
              <li key={item.id} className={styles.card}>
                <button
                  type="button"
                  className={styles.cardButton}
                  onClick={() => {
                    onOpen(item.id)
                  }}
                >
                  <span className={styles.cardTop}>
                    <span className={styles.cardNo}>{orderLabel(item.order)}</span>
                    {item.rating !== '' ? <Done /> : null}
                  </span>
                  <span className={styles.cardSlot}>{item.slot}</span>
                  <span className={item.rating !== '' ? styles.cardTitleDone : styles.cardTitle}>{item.title}</span>
                  {item.lead !== '' ? <span className={styles.cardLead}>{item.lead}</span> : null}
                  <span className={styles.cardMeta}>
                    {item.trust !== '' ? <span>{item.trust}</span> : null}
                    <span>{model.genreLabel(item)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <ol className={styles.rail} aria-label="順番">
            {model.list.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.rating !== '' ? styles.railDone : styles.railButton}
                  onClick={() => {
                    onOpen(item.id)
                  }}
                >
                  {orderLabel(item.order)}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <Detail model={model} onOpen={onOpen} onBack={onBack} />
      )}

      <nav className={styles.words} aria-label="画面の切り替え">
        {NAV_LABELS.map((label, index) => (
          <button key={label} type="button" className={styles.word} aria-current={index === 0 ? 'page' : undefined}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

const timeFormatter = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function clockParts(now: Date): { hour: string; minute: string; second: string } {
  const parts = timeFormatter.formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '--'
  return { hour: pick('hour'), minute: pick('minute'), second: pick('second') }
}

/** 本物の時計。1秒ごとに進む。コロンの点滅は動きを減らす設定で止まる */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])
  const { hour, minute, second } = clockParts(now)
  return (
    <p className={styles.clock}>
      <span className="visually-hidden">
        現在 {hour}時{minute}分
      </span>
      <span className={styles.clockMain} aria-hidden="true">
        {hour}
        <span className={styles.colon}>:</span>
        {minute}
      </span>
      <span className={styles.clockSec} aria-hidden="true">
        {second}
      </span>
    </p>
  )
}

function Done() {
  return (
    <span className={styles.done} role="img" aria-label="評価済み">
      済
    </span>
  )
}

function Detail({ model, onOpen, onBack }: { model: LabModel; onOpen: (id: string) => void; onBack: () => void }) {
  const item: Item = model.current
  const href = sourceHref(item)
  return (
    <article key={item.id} className={styles.article} aria-labelledby="clock-item-title">
      <div className={styles.articleBar}>
        <button type="button" className={styles.back} onClick={onBack}>
          予定に戻る
        </button>
        <span className={styles.position}>
          {model.index + 1} / {model.list.length}
        </span>
      </div>

      <header className={styles.articleHead}>
        <span className={styles.bigNo}>{orderLabel(item.order)}</span>
        <div className={styles.articleHeadMain}>
          <p className={styles.articleSlot}>{item.slot}</p>
          <h2 id="clock-item-title" className={styles.articleTitle}>
            {item.title}
          </h2>
          {item.lead !== '' ? <p className={styles.articleLead}>{item.lead}</p> : null}
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.main}>
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

        <div className={styles.side}>
          <section className={styles.sec}>
            <h3 className={styles.secTitle}>指標</h3>
            <ul className={styles.meters}>
              {STAR_AXES.map((axis) => {
                const level = item.stars[axis.key]
                return (
                  <li key={axis.key} className={styles.meter}>
                    <span aria-hidden="true">{axis.label}</span>
                    <span className={styles.bar} role="img" aria-label={`${axis.label} ${level}/5`}>
                      {[0, 1, 2, 3, 4].map((cell) => (
                        <span key={cell} className={cell < level ? styles.barOn : styles.barOff} />
                      ))}
                    </span>
                    <span className={styles.meterValue} aria-hidden="true">
                      {level}
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
            <ul className={styles.chips} aria-label="分類">
              <li className={styles.chipGenre}>{model.genreLabel(item)}</li>
              {[...item.categories, ...item.projects, ...item.tags].map((tag, index) => (
                <li key={`${index}-${tag}`} className={styles.chip}>
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
          disabled={model.prev === null}
          onClick={() => {
            if (model.prev !== null) onOpen(model.prev.id)
          }}
        >
          <span className={styles.pagerNo}>{model.prev === null ? '--' : orderLabel(model.prev.order)}</span>
          前の1本
        </button>
        <button
          type="button"
          className={styles.pagerButtonMain}
          disabled={model.next === null}
          onClick={() => {
            if (model.next !== null) onOpen(model.next.id)
          }}
        >
          次の1本
          <span className={styles.pagerNo}>{model.next === null ? '--' : orderLabel(model.next.order)}</span>
        </button>
      </nav>
    </article>
  )
}
