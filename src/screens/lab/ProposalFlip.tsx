// 案2「朝刊フリップ」:出演者が持つフリップボード。新聞の切り抜き、明朝の見出し、縦書きの短冊、赤マーカー、判子
import { NAV_LABELS, orderLabel, ratingLabel, sourceHref, statusLabel, type LabModel, type LabProps } from './labData.ts'
import type { Item } from '../../data/types.ts'
import { STAR_AXES } from '../../data/labels.ts'
import styles from './ProposalFlip.module.css'

type Props = LabProps & { model: LabModel }

export function ProposalFlip({ screen, theme, model, onOpen, onBack }: Props) {
  return (
    <div className={styles.root} data-theme={theme}>
      <header className={styles.top}>
        <div className={styles.masthead}>
          <span className={styles.wordmark}>AIネタ帳</span>
          <span className={styles.edition}>
            {model.list.length}本 済{model.ratedCount}
          </span>
        </div>
        <p className={styles.dateTanzaku}>
          <span className={styles.dateText}>
            {model.parts.month}月{model.parts.day}日 {model.parts.weekday}
          </span>
        </p>
      </header>

      {screen === 'today' ? (
        <section className={styles.board} aria-labelledby="flip-today">
          <h2 id="flip-today" className={styles.boardTitle}>
            今日の放送
          </h2>
          <ol className={styles.clips} aria-label="進行表">
            {model.list.map((item, index) => (
              <li key={item.id} className={index === 0 ? styles.clipTop : styles.clip}>
                <span className={styles.tape} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.clipButton}
                  onClick={() => {
                    onOpen(item.id)
                  }}
                >
                  <span className={styles.tanzaku}>
                    <span className={styles.tanzakuText}>{item.slot}</span>
                  </span>
                  <span className={styles.clipMain}>
                    <span className={styles.clipNo}>{orderLabel(item.order)}</span>
                    <span className={item.rating !== '' ? styles.headlineDone : styles.headline}>{item.title}</span>
                    {index === 0 && item.lead !== '' ? <span className={styles.clipLead}>{item.lead}</span> : null}
                    <span className={styles.clipMeta}>
                      {item.trust !== '' ? <span>{item.trust}</span> : null}
                      <span>{model.genreLabel(item)}</span>
                    </span>
                  </span>
                  {item.rating !== '' ? <Hanko /> : null}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <Detail model={model} onOpen={onOpen} onBack={onBack} />
      )}

      <nav className={styles.tabs} aria-label="画面の切り替え">
        {NAV_LABELS.map((label, index) => (
          <button key={label} type="button" className={styles.tab} aria-current={index === 0 ? 'page' : undefined}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Hanko() {
  return (
    <span className={styles.hanko} role="img" aria-label="評価済み">
      済
    </span>
  )
}

function Detail({ model, onOpen, onBack }: { model: LabModel; onOpen: (id: string) => void; onBack: () => void }) {
  const item: Item = model.current
  const href = sourceHref(item)
  return (
    <article key={item.id} className={styles.flip} aria-labelledby="flip-item-title">
      <div className={styles.flipBar}>
        <button type="button" className={styles.back} onClick={onBack}>
          フリップ一覧へ
        </button>
        <span className={styles.position}>
          {model.index + 1}枚目/{model.list.length}枚
        </span>
      </div>

      <div className={styles.sheet}>
        <span className={styles.tape} aria-hidden="true" />
        <header className={styles.sheetHead}>
          <span className={styles.tanzaku}>
            <span className={styles.tanzakuText}>{item.slot}</span>
          </span>
          <div className={styles.sheetHeadMain}>
            <h2 id="flip-item-title" className={styles.headlineLarge}>
              <span className={styles.marker}>{item.title}</span>
            </h2>
            {item.lead !== '' ? <p className={styles.sheetLead}>{item.lead}</p> : null}
          </div>
          {item.rating !== '' ? <Hanko /> : null}
        </header>

        <div className={styles.columns}>
          <div className={styles.mainCol}>
            {item.summary !== '' ? (
              <section className={styles.para}>
                <h3 className={styles.paraTitle}>要約</h3>
                <p className={styles.body}>{item.summary}</p>
              </section>
            ) : null}
            {item.tryit !== '' ? (
              <section className={styles.para}>
                <h3 className={styles.paraTitle}>試すなら</h3>
                <p className={styles.body}>{item.tryit}</p>
              </section>
            ) : null}
            {item.caution !== '' ? (
              <aside className={styles.sticky} aria-label="注意点">
                <span className={styles.stickyTag} aria-hidden="true">
                  注意
                </span>
                <p className={styles.stickyBody}>{item.caution}</p>
              </aside>
            ) : null}
          </div>

          <div className={styles.sideCol}>
            <section className={styles.para}>
              <h3 className={styles.paraTitle}>指標</h3>
              <ul className={styles.meters}>
                {STAR_AXES.map((axis) => {
                  const level = item.stars[axis.key]
                  return (
                    <li key={axis.key} className={styles.meter}>
                      <span aria-hidden="true">{axis.label}</span>
                      <span className={styles.dots} role="img" aria-label={`${axis.label} ${level}/5`}>
                        {[0, 1, 2, 3, 4].map((cell) => (
                          <span key={cell} className={cell < level ? styles.dotOn : styles.dotOff} />
                        ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className={styles.para}>
              <h3 className={styles.paraTitle}>出典</h3>
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

            <section className={styles.para}>
              <h3 className={styles.paraTitle}>分類</h3>
              <ul className={styles.labels} aria-label="分類">
                <li className={styles.labelGenre}>{model.genreLabel(item)}</li>
                {[...item.categories, ...item.projects, ...item.tags].map((tag, index) => (
                  <li key={`${index}-${tag}`} className={styles.label}>
                    {tag}
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.para}>
              <h3 className={styles.paraTitle}>評価・扱い</h3>
              <p className={styles.verdict}>
                <span className={item.rating !== '' ? styles.verdictMark : styles.verdictNone}>{ratingLabel(item)}</span>
                <span className={styles.verdictStatus}>{statusLabel(item)}</span>
              </p>
              {item.memo !== '' ? <p className={styles.memo}>{item.memo}</p> : null}
            </section>
          </div>
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
          前の1枚
        </button>
        <button
          type="button"
          className={styles.pagerButtonMain}
          disabled={model.next === null}
          onClick={() => {
            if (model.next !== null) onOpen(model.next.id)
          }}
        >
          次の1枚をめくる
        </button>
      </nav>
    </article>
  )
}
