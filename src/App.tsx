// アプリの骨組み(仕様 3 章):上のバー + 左メニュー(PC)/ジャンルのタブ(スマホ)+ 中央 + 右の列(PC)+ 下のメニュー(スマホ)
import { useEffect, useMemo, useState } from 'react'
import { screenKey, useRoute, type Route } from './app/router.ts'
import { ErrorState } from './components/ErrorState.tsx'
import { GenreTabs } from './components/GenreTabs.tsx'
import { LoadingState } from './components/LoadingState.tsx'
import { MobileNav } from './components/MobileNav.tsx'
import { RightRail } from './components/RightRail.tsx'
import { ScrollTopButton } from './components/ScrollTopButton.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { DataProvider, useData, useReloadData } from './data/DataProvider.tsx'
import { latestDate, menuGenres, vulnerabilities } from './data/queries.ts'
import type { LoadedData } from './data/source.ts'
import { createDefaultUserStore, UserStoreProvider, useUserState, type UserStore } from './data/userStore.ts'
import { formatDateHeader } from './lib/format.ts'
import { FeedScreen } from './screens/FeedScreen.tsx'
import { GenreScreen } from './screens/GenreScreen.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { ItemScreen } from './screens/ItemScreen.tsx'
import { SavedScreen } from './screens/SavedScreen.tsx'
import { SearchScreen } from './screens/SearchScreen.tsx'
import { VulnDetailScreen } from './screens/VulnDetailScreen.tsx'
import { VulnScreen } from './screens/VulnScreen.tsx'
import styles from './App.module.css'

function screenFor(route: Route, data: LoadedData, homeIntro: boolean) {
  switch (route.name) {
    case 'home':
      return <HomeScreen data={data} intro={homeIntro} />
    case 'genre':
      return <GenreScreen data={data} id={route.id} kind={route.kind} />
    case 'feed':
      return <FeedScreen data={data} kind={route.kind} />
    case 'vuln':
      return <VulnScreen data={data} severity={route.severity} />
    case 'vuln-detail':
      return <VulnDetailScreen data={data} id={route.id} />
    case 'item':
      return <ItemScreen data={data} id={route.id} />
    case 'saved':
      return <SavedScreen data={data} />
    case 'search':
      return <SearchScreen data={data} q={route.q} />
  }
}

/** 右の列を出す画面(詳細と脆弱性の一覧では出さない) */
function hasRail(route: Route): boolean {
  return route.name === 'home' || route.name === 'genre' || route.name === 'feed' || route.name === 'saved' || route.name === 'search'
}

function Shell() {
  const route = useRoute()
  const state = useData()
  const reload = useReloadData()
  const data = state.status === 'ready' ? state.data : null
  const genres = useMemo(() => (data === null ? [] : menuGenres(data.genres)), [data])
  const savedCount = useUserState().saved.length
  const vulnCount = data === null ? 0 : vulnerabilities(data.feed).length
  const date = data === null ? null : latestDate(data.items)

  // トップの登場アニメは最初の表示だけ:トップを表示したあとで別の画面に移ったら、以後は付けない。
  // 描画中に前の画面と比べて state を直す(React の推奨する形。StrictMode の2回の mount でも途中で切れない)
  const [homeIntroPlayed, setHomeIntroPlayed] = useState(false)
  const [shownScreen, setShownScreen] = useState(route.name)
  if (shownScreen !== route.name) {
    setShownScreen(route.name)
    if (shownScreen === 'home' && data !== null) setHomeIntroPlayed(true)
  }

  // 画面の種類が変わったら先頭に戻す(絞り込みを変えただけのときは動かさない)
  const key = screenKey(route)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [key])

  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#main">
        本文へ移動
      </a>
      <TopBar route={route} dateLabel={date === null ? '' : formatDateHeader(date)} data={data} />
      <GenreTabs route={route} genres={genres} />
      <div className={styles.workspace}>
        <Sidebar route={route} genres={genres} vulnCount={vulnCount} savedCount={savedCount} />
        <main id="main" className={styles.main} tabIndex={-1}>
          {state.status === 'loading' ? (
            <LoadingState />
          ) : state.status === 'error' ? (
            <ErrorState detail={state.message} onRetry={reload} />
          ) : (
            <div className={hasRail(route) ? styles.contentGrid : route.name === 'item' ? styles.contentDetail : styles.contentSingle}>
              <section className={styles.mainColumn}>{screenFor(route, state.data, !homeIntroPlayed)}</section>
              {hasRail(route) ? <RightRail data={state.data} /> : null}
            </div>
          )}
        </main>
      </div>
      <ScrollTopButton />
      <MobileNav route={route} />
    </div>
  )
}

interface AppProps {
  /** 試験で差し替えるため */
  load?: () => Promise<LoadedData>
  /** 保存・評価・メモの置き場。試験で差し替えるため。既定は端末の localStorage */
  userStore?: UserStore
}

export function App({ load, userStore }: AppProps) {
  const store = useMemo(() => userStore ?? createDefaultUserStore(), [userStore])
  return (
    <DataProvider load={load}>
      <UserStoreProvider value={store}>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </UserStoreProvider>
    </DataProvider>
  )
}
