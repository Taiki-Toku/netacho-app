// 上のバーの検索欄と、入力中の候補(仕様 4 章 7、7 章)。
// ARIA は APG の combobox(入力欄)+ listbox(分類ごとに group)の形。フォーカスは入力欄に置いたまま、
// 選んでいる候補は aria-activedescendant で伝える。↑↓ で移り、Enter で開き、Esc で閉じる。
// 候補を選ばずに Enter なら、検索語を URL(#/search?q=)に入れて結果の画面へ移る。
// スマホでは虫めがねのボタンを押すと欄が開く(仕様 3 章・7 章)
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { navigate, type Route } from '../app/router.ts'
import type { LoadedData } from '../data/source.ts'
import { buildSuggestions, type SuggestOption } from '../data/suggest.ts'
import { Icon } from './Icon.tsx'
import styles from './SearchBox.module.css'

interface SearchBoxProps {
  route: Route
  /** 読み込み中・通信エラーのときは null(候補は出さず、送信だけできる) */
  data: LoadedData | null
}

export function SearchBox({ route, data }: SearchBoxProps) {
  const routeQuery = route.name === 'search' ? route.q : ''
  const [query, setQuery] = useState(routeQuery)
  const [seenRouteQuery, setSeenRouteQuery] = useState(routeQuery)
  /** スマホで欄を開いているか */
  const [open, setOpen] = useState(false)
  /** 候補の一覧を出してよいか(入力すると true、Esc・選択・フォーカスが外れると false) */
  const [listOpen, setListOpen] = useState(false)
  /** 選んでいる候補の番号(全分類を通した番号)。-1 は選んでいない */
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()
  const listId = `${baseId}-list`

  // URL の検索語が変わったら(戻る・再読み込み)、欄の中身もそろえる(描画の中で前回の値と見比べて直す)
  if (seenRouteQuery !== routeQuery) {
    setSeenRouteQuery(routeQuery)
    setQuery(routeQuery)
  }

  const groups = useMemo(() => (data === null ? [] : buildSuggestions(data, query)), [data, query])
  const options = useMemo(() => groups.flatMap((group) => group.options), [groups])
  /** 各分類の最初の候補が、全分類を通して何番目か */
  const starts = useMemo(() => groups.map((_, at) => groups.slice(0, at).reduce((sum, group) => sum + group.options.length, 0)), [groups])
  const expanded = listOpen && options.length > 0
  const activeIndex = expanded && active < options.length ? active : -1
  const optionId = (index: number) => `${baseId}-opt-${String(index)}`

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // 選んでいる候補が一覧の外に隠れていたら、一覧の中だけをスクロールして見せる。
  // scrollIntoView は一覧の外(ページ)までスクロールさせるため使わない(上のバーは sticky なので、ページが動くだけで候補は見えない)
  useEffect(() => {
    const list = listRef.current
    if (activeIndex < 0 || list === null) return
    const element = document.getElementById(optionId(activeIndex))
    if (element === null) return
    // 分類の最初の候補なら、分類の見出しごと見せる(一覧の最初の候補なら一覧の上の余白も)
    const group = element.parentElement
    const firstInGroup = element.previousElementSibling?.getAttribute('role') === 'presentation'
    const top = activeIndex === 0 ? 0 : firstInGroup && group !== null ? group.offsetTop : element.offsetTop
    const bottom = element.offsetTop + element.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
    // optionId は baseId だけで決まる(group の offsetTop も一覧から測る。.list は position: relative)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  function closeList() {
    setListOpen(false)
    setActive(-1)
  }

  /** スマホで開いた欄を閉じる。欄が消えてフォーカスが行き場を失わないよう、虫めがねのボタンに返す */
  function closeField() {
    if (!open) return
    setOpen(false)
    toggleRef.current?.focus()
  }

  function openOption(option: SuggestOption) {
    closeList()
    closeField()
    // 結果の画面へ移るとき以外は、欄を空にする(開いた記事の画面に検索語を残さない)
    setQuery(option.route.name === 'search' ? option.route.q : '')
    navigate(option.route)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (q === '') return
    closeList()
    navigate({ name: 'search', q })
    closeField()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 日本語の変換中のキー(↑↓で変換候補を選ぶ、Enter で確定、Esc で取り消す)は IME に任せる。
    // Safari は確定の Enter で isComposing が false になることがあるため、変換中を表す keyCode 229 も見る
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (options.length === 0) return
        event.preventDefault()
        const last = options.length - 1
        setListOpen(true)
        if (event.key === 'ArrowDown') setActive(activeIndex >= last ? 0 : activeIndex + 1)
        else setActive(activeIndex <= 0 ? last : activeIndex - 1)
        return
      }
      case 'Enter': {
        const option = activeIndex >= 0 ? options[activeIndex] : undefined
        if (option === undefined) return // 候補を選んでいなければ、ふつうの送信(submit)
        event.preventDefault()
        openOption(option)
        return
      }
      case 'Escape':
        // type="search" の Esc で中身が消える既定の動きは止める
        event.preventDefault()
        if (expanded) {
          closeList()
        } else {
          closeField()
        }
        return
    }
  }

  const status = !listOpen || query.trim() === '' || data === null ? '' : options.length === 0 ? '候補はありません' : `候補 ${String(options.length)}件`

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={styles.toggle}
        aria-label={open ? '検索欄を閉じる' : '検索欄を開く'}
        aria-expanded={open}
        aria-controls={`${baseId}-form`}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        <Icon name="search" />
      </button>
      <form id={`${baseId}-form`} className={open ? styles.searchOpen : styles.search} role="search" onSubmit={submit}>
        <Icon name="search" />
        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          role="combobox"
          placeholder="ニュース・CVE をさがす"
          aria-label="検索語"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setListOpen(true)
            setActive(-1)
          }}
          onFocus={() => {
            setListOpen(true)
          }}
          onBlur={closeList}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" className={styles.submit}>
          さがす
        </button>
        <button
          type="button"
          className={styles.close}
          aria-label="検索を閉じる"
          onClick={() => {
            closeList()
            setOpen(false)
          }}
        >
          <Icon name="close" />
        </button>
        {/* 一覧のどこを押しても(候補・見出し・案内・スクロールバー)フォーカスを入力欄に残す。外れると一覧が閉じ、click が届かない */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className={styles.popup}
          hidden={!expanded}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
        >
          <div ref={listRef} id={listId} role="listbox" aria-label="候補" className={styles.list}>
            {groups.map((group, groupAt) => {
              const headId = `${baseId}-${group.kind}`
              return (
                <div key={group.kind} role="group" aria-labelledby={headId} className={styles.group}>
                  <div id={headId} role="presentation" className={styles.groupLabel}>
                    {group.label}
                  </div>
                  {group.options.map((option, at) => {
                    const own = (starts[groupAt] ?? 0) + at
                    return (
                      // キーボードの操作は入力欄(combobox)が受け持つ。候補にはフォーカスを移さない(APG の aria-activedescendant の形)
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                      <div
                        key={option.key}
                        id={optionId(own)}
                        role="option"
                        tabIndex={-1}
                        aria-selected={own === activeIndex}
                        className={styles.option}
                        onClick={() => {
                          openOption(option)
                        }}
                      >
                        <span className={styles.optionLabel}>{option.label}</span>
                        {option.note !== '' ? <span className={styles.optionNote}>{option.note}</span> : null}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {/* キーボードの案内は PC だけ(仕様 4 章 7)。読み上げは combobox の決まりで操作が伝わるので出さない */}
          <p className={styles.hint} aria-hidden="true">
            ↑↓ で選ぶ / Enter で開く / Esc で閉じる
          </p>
        </div>
        <p className="visually-hidden" role="status">
          {status}
        </p>
      </form>
    </>
  )
}
