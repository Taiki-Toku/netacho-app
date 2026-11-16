// 案1「生放送」:放送の画面そのもの。縁取りテロップ、L字の帯、チャンネル番号
import { NAV_LABELS, orderLabel, ratingLabel, sourceHref, statusLabel, type LabModel, type LabProps } from './labData.ts'
import type { Item } from '../../data/types.ts'
import { STAR_AXES } from '../../data/labels.ts'
import styles from './ProposalLive.module.css'

type Props = LabProps & { model: LabModel }

export function ProposalLive({ screen, theme, model, onOpen, onBack }: Props) {
  const [first, ...rest] = model.list
  return (
    <div className={styles.root} data-theme={theme} data-screen={screen}>
      <header className={styles.top}>
        <span className={styles.logo}>
          <span className={styles.logoText}>AIネタ帳</span>
        </span>
        <span className={styles.live}>
          <span className={styles.liveDot} aria-hidden="true" />生
        </span>
        <span className={styles.date}>
          <span className={styles.dateDay}>
            {model.parts.month}.{model.parts.day}
          </span>
          <span className={styles.dateWeek}>{model.parts.weekday}</span>
        </span>
        <span className={styles.count}>
          {model.list.length}本 済{model.ratedCount}
        </span>
      </header>

      <div className={styles.stage}>
        <section className={styles.rundown} aria-labelledby="live-today">
          <h2 id="live-today" className={styles.corner}>
            今日の放送
          </h2>
          {first !== undefined ? (
            <button
              type="button"
              className={styles.hero}
              aria-current={screen === 'item' && model.current.id === first.id ? 'true' : undefined}
              onClick={() => {
                onOpen(first.id)
              }}
            >
              <span className={styles.heroSlot}>
                <span className={styles.skewBack}>{first.slot}</span>
              </span>
              <span className={styles.telop}>{first.title}</span>
              {first.lead !== '' ? <span className={styles.heroLead}>{first.lead}</span> : null}
              {first.rating !== '' ? <Stamp /> : null}
            </button>
          ) : null}
          <h3 className={styles.after}>この後</h3>
          <ol className={styles.list} aria-label="この後のネタ">
            {rest.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.row}
                  aria-current={screen === 'item' && model.current.id === item.id ? 'true' : undefined}
                  onClick={() => {
                    onOpen(item.id)
                  }}
                >
                  <span className={styles.rowNo}>{orderLabel(item.order)}</span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowSlot}>{item.slot}</span>
                    <span className={item.rating !== '' ? styles.rowTitleDone : styles.rowTitle}>{item.title}</span>
                  </span>
                  {item.rating !== '' ? <Stamp /> : null}
                </button>
              </li>
            ))}
          </ol>
        </section>

        <Detail model={model} onOpen={onOpen} onBack={onBack} />
      </div>

      <nav className={styles.channels} aria-label="画面の切り替え">
        {NAV_LABELS.map((label, index) => (
          <button key={label} type="button" className={styles.channel} aria-current={index === 0 ? 'page' : undefined}>
            <span className={styles.channelNo}>{index + 1}</span>
            <span className={styles.channelLabel}>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function Stamp() {
  return (
    <span className={styles.stamp} role="img" aria-label="評価済み">
      済
    </span>
  )
}

function Detail({ model, onOpen, onBack }: { model: LabModel; onOpen: (id: string) => void; onBack: () => void }) {
  const item: Item = model.current
  const href = sourceHref(item)
  return (
    <article key={item.id} className={styles.detail} aria-labelledby="live-item-title">
      <div className={styles.detailBar}>
        <button type="button" className={styles.back} onClick={onBack}>
          進行表へ
        </button>
        <span className={styles.position}>
          {model.index + 1}/{model.list.length}
        </span>
      </div>
      <header className={styles.detailTelop}>
        <span className={styles.heroSlot}>
          <span className={styles.skewBack}>{item.slot}</span>
        </span>
        <h2 id="live-item-title" className={styles.telopLarge}>
          {item.title}
        </h2>
        {item.lead !== '' ? <p className={styles.detailLead}>{item.lead}</p> : null}
      </header>

      {item.summary !== '' ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <span className={styles.skewBack}>要約</span>
          </h3>
          <p className={styles.body}>{item.summary}</p>
        </section>
      ) : null}
      {item.tryit !== '' ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>
            <span className={styles.skewBack}>試すなら</span>
          </h3>
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

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          <span className={styles.skewBack}>指標</span>
        </h3>
        <div className={styles.meters}>
          {STAR_AXES.map((axis) => {
            const level = item.stars[axis.key]
            return (
              <div key={axis.key} className={styles.meter}>
                <span aria-hidden="true">{axis.label}</span>
                <span className={styles.cells} role="img" aria-label={`${axis.label} ${level}/5`}>
                  {[0, 1, 2, 3, 4].map((cell) => (
                    <span key={cell} className={cell < level ? styles.cellOn : styles.cellOff} />
                  ))}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          <span className={styles.skewBack}>出典</span>
        </h3>
        <p className={styles.trust}>{item.trust}</p>
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

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          <span className={styles.skewBack}>分類</span>
        </h3>
        <ul className={styles.tags} aria-label="分類">
          <li className={styles.tagGenre}>{model.genreLabel(item)}</li>
          {[...item.categories, ...item.projects, ...item.tags].map((tag, index) => (
            <li key={`${index}-${tag}`} className={styles.tag}>
              {tag}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>
          <span className={styles.skewBack}>評価・扱い</span>
        </h3>
        <p className={styles.verdict}>
          <span className={item.rating !== '' ? styles.verdictHot : styles.verdictNone}>{ratingLabel(item)}</span>
          <span className={styles.verdictStatus}>{statusLabel(item)}</span>
        </p>
        {item.memo !== '' ? <p className={styles.memo}>{item.memo}</p> : null}
      </section>

      <nav className={styles.pager} aria-label="前後のネタ">
        <button
          type="button"
          className={styles.pagerButton}
          disabled={model.prev === null}
          onClick={() => {
            if (model.prev !== null) onOpen(model.prev.id)
          }}
        >
          前のネタ
        </button>
        <button
          type="button"
          className={styles.pagerButtonMain}
          disabled={model.next === null}
          onClick={() => {
            if (model.next !== null) onOpen(model.next.id)
          }}
        >
          次のネタ
        </button>
      </nav>
    </article>
  )
}
