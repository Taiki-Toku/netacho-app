// 上のバー:印と名前(ホームへのリンク)、放送日、さがす。
// スマホでは虫めがねのボタンを押すと欄が開く(仕様 7 章)。検索語は送信時に URL(#/search?q=)に入れる
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { hrefFor, navigate, type Route } from '../app/router.ts'
import { BrandMark } from './BrandMark.tsx'
import { Icon } from './Icon.tsx'
import styles from './TopBar.module.css'

interface TopBarProps {
  route: Route
  /** 「1月2日 金曜日」。データが無いうちは空 */
  dateLabel: string
}

export function TopBar({ route, dateLabel }: TopBarProps) {
  const routeQuery = route.name === 'search' ? route.q : ''
  const [query, setQuery] = useState(routeQuery)
  const [seenRouteQuery, setSeenRouteQuery] = useState(routeQuery)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // URL の検索語が変わったら(戻る・再読み込み)、欄の中身もそろえる(描画の中で前回の値と見比べて直す)
  if (seenRouteQuery !== routeQuery) {
    setSeenRouteQuery(routeQuery)
    setQuery(routeQuery)
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function submit(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (q === '') return
    navigate({ name: 'search', q })
    setOpen(false)
  }

  return (
    <header className={styles.topbar}>
      <a className={styles.brand} href={hrefFor({ name: 'today' })} aria-label="NODAL ホーム">
        <BrandMark />
        <span className={styles.brandName}>NODAL</span>
      </a>
      <div className={styles.right}>
        {dateLabel !== '' ? <span className={styles.date}>{dateLabel}</span> : null}
        <button
          type="button"
          className={styles.searchToggle}
          aria-label={open ? '検索欄を閉じる' : '検索欄を開く'}
          aria-expanded={open}
          aria-controls="search-form"
          onClick={() => {
            setOpen((value) => !value)
          }}
        >
          <Icon name="search" />
        </button>
        <form id="search-form" className={open ? styles.searchOpen : styles.search} role="search" onSubmit={submit}>
          <Icon name="search" />
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            placeholder="ネタ・製品・CVEをさがす"
            aria-label="検索語"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <button type="submit" className={styles.submit}>
            さがす
          </button>
          <button
            type="button"
            className={styles.close}
            aria-label="検索を閉じる"
            onClick={() => {
              setOpen(false)
            }}
          >
            <Icon name="close" />
          </button>
        </form>
      </div>
    </header>
  )
}
