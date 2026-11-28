// アプリの骨組み(仕様 3 章):上のバー + 左メニュー(PC)/ジャンルのタブ(スマホ)+ 中央 + 右の列(PC)+ 下のメニュー(スマホ)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate, parseHash, screenKey, useRoute, type Route } from './app/router.ts'
import { AccountContext, type Account } from './app/session.ts'
import { EmptyState } from './components/EmptyState.tsx'
import { ErrorState } from './components/ErrorState.tsx'
import { GenreTabs } from './components/GenreTabs.tsx'
import { LoadingState } from './components/LoadingState.tsx'
import { MobileNav } from './components/MobileNav.tsx'
import { PullIndicator } from './components/PullIndicator.tsx'
import { RightRail } from './components/RightRail.tsx'
import { ScrollTopButton } from './components/ScrollTopButton.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { TopBar } from './components/TopBar.tsx'
import { DataProvider, useData, useReloadData } from './data/DataProvider.tsx'
import { feedErrorMessage, type Backend } from './data/backend.ts'
import { latestDate, vulnerabilities } from './data/queries.ts'
import { supabaseData, type LoadedData } from './data/source.ts'
import { createDefaultUserStore, UserStoreProvider, useUserState, type UserStore } from './data/userStore.ts'
import { formatDateHeader, tokyoToday } from './lib/format.ts'
import { useScrollMemory } from './lib/useScrollMemory.ts'
import { ArchiveScreen } from './screens/ArchiveScreen.tsx'
import { FeedScreen } from './screens/FeedScreen.tsx'
import { GenreScreen } from './screens/GenreScreen.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { ItemScreen } from './screens/ItemScreen.tsx'
import { LoginScreen } from './screens/LoginScreen.tsx'
import { SavedScreen } from './screens/SavedScreen.tsx'
import { SearchScreen } from './screens/SearchScreen.tsx'
import { SettingsScreen } from './screens/SettingsScreen.tsx'
import { VulnDetailScreen } from './screens/VulnDetailScreen.tsx'
import { VulnScreen } from './screens/VulnScreen.tsx'
import styles from './App.module.css'

function screenFor(route: Route, data: LoadedData, loadedAt: Date, homeIntro: boolean) {
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
      return <VulnDetailScreen data={data} id={route.id} severity={route.severity ?? 'all'} />
    case 'item':
      return <ItemScreen data={data} id={route.id} from={route.from} />
    case 'saved':
      return <SavedScreen data={data} />
    case 'archive':
      // 「今日」は日本時間で決める(端末のタイムゾーンに依らない)。表示のたびに今の時刻から作る
      return <ArchiveScreen data={data} date={route.date} today={tokyoToday(new Date())} />
    case 'search':
      return <SearchScreen data={data} q={route.q} />
    case 'settings':
      return <SettingsScreen data={data} loadedAt={loadedAt} />
  }
}

/**
 * 戻ったときに前の位置へ戻す一覧の画面(詳細設計 5.7.3):トップ・ジャンル・保存・バックナンバー・さがす・公式情報・脆弱性の一覧。
 * 詳細(ニュース・脆弱性)と設定は入れない(いつも先頭)
 */
function isListHash(hash: string): boolean {
  switch (parseHash(hash).name) {
    case 'home':
    case 'genre':
    case 'saved':
    case 'archive':
    case 'search':
    case 'feed':
    case 'vuln':
      return true
    case 'item':
    case 'vuln-detail':
    case 'settings':
      return false
  }
}

/** 右の列を出す画面(詳細と脆弱性の一覧では出さない) */
function hasRail(route: Route): boolean {
  return (
    route.name === 'home' ||
    route.name === 'genre' ||
    route.name === 'feed' ||
    route.name === 'saved' ||
    route.name === 'archive' ||
    route.name === 'search'
  )
}

function Shell() {
  const route = useRoute()
  const state = useData()
  const reload = useReloadData()
  const data = state.status === 'ready' ? state.data : null
  const genres = useMemo(() => (data === null ? [] : data.genres), [data])
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

  // 画面の種類が変わったら、一覧なら前にいた位置へ、それ以外は先頭へ(絞り込みを変えただけのときは動かさない。詳細設計 5.7.3)
  useScrollMemory({ screenKey: screenKey(route), ready: data !== null, isList: isListHash })

  // 引っぱって更新で指に付けて動かす枠(上のバー・ジャンルのタブ・本文)。下のメニュー・「先頭へ戻る」・トーストはこの外
  const pullRef = useRef<HTMLDivElement>(null)

  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#main">
        本文へ移動
      </a>
      <div ref={pullRef} className={styles.pullArea}>
        {/* 引っぱって更新(スマホのタッチだけ)。データを読めているときだけ受ける */}
        <PullIndicator targetRef={pullRef} enabled={state.status === 'ready'} />
        <TopBar route={route} dateLabel={date === null ? '' : formatDateHeader(date)} data={data} />
        <GenreTabs route={route} genres={genres} />
        <div className={styles.workspace}>
          <Sidebar route={route} genres={genres} vulnCount={vulnCount} savedCount={savedCount} />
          <main id="main" className={styles.main} tabIndex={-1}>
            {state.status === 'loading' ? (
              <LoadingState />
            ) : state.status === 'error' ? (
              <ErrorState detail={state.message} onRetry={reload} />
            ) : state.data.source === 'supabase' && state.data.items.length === 0 && route.name !== 'settings' ? (
              // Supabase から1本も読めないとき。RLS で許可ユーザー以外は 0 行になる(エラーにはならない)。
              // 設定の画面だけは出す(ログアウトのボタンがあるため)
              <EmptyState title="表示できるニュースがありません" text="(許可ユーザーに登録されていない可能性があります)" spaced />
            ) : (
              <div className={hasRail(route) ? styles.contentGrid : route.name === 'item' ? styles.contentDetail : styles.contentSingle}>
                <section className={styles.mainColumn}>{screenFor(route, state.data, state.loadedAt, !homeIntroPlayed)}</section>
                {hasRail(route) ? <RightRail data={state.data} /> : null}
              </div>
            )}
          </main>
        </div>
      </div>
      <ScrollTopButton />
      <MobileNav route={route} />
    </div>
  )
}

type SessionState = 'checking' | 'signedOut' | 'signedIn'

/** Supabase モード:セッションが無ければログインだけを出し、あればネタを Supabase から読んで画面を出す */
function SupabaseRoot({ backend }: { backend: Backend }) {
  const [session, setSession] = useState<SessionState>('checking')
  // ログイン中の人のメールアドレス(設定の画面に出す)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(
    () =>
      backend.auth.watchSession((signedIn, sessionEmail) => {
        setSession(signedIn ? 'signedIn' : 'signedOut')
        setEmail(signedIn ? sessionEmail : null)
      }),
    [backend],
  )

  // ネタと公式フィードを並べて読む。ネタの失敗は画面全体のエラー(例外のまま)。
  // 公式フィードだけの失敗は、feed を空にして文を添え、ネタは出す(見本のフィードに切り替えない)
  const load = useCallback(async () => {
    const [items, feed] = await Promise.all([
      backend.loadItems(),
      backend.loadFeed().then(
        (entries) => ({ entries, error: null }),
        (error: unknown) => ({ entries: [], error: feedErrorMessage(error) }),
      ),
    ])
    return supabaseData(items, feed.entries, feed.error)
  }, [backend])

  const onSignedIn = useCallback(() => {
    // ログインしたらホームから始める(前にログアウトした画面に戻らない)
    navigate({ name: 'home' })
    setSession('signedIn')
  }, [])

  // ログアウト:すぐに DataProvider ごと外して、読み込んだネタを手放す(終わるまでは読み込み中の表示。ボタンも消える)
  const signOut = useCallback(() => {
    setSession('checking')
    void backend.auth.signOut().finally(() => {
      setSession('signedOut')
      // 通信の失敗でログアウトの知らせが来ないときも、メールアドレスを手放す
      setEmail(null)
    })
  }, [backend])

  const account = useMemo<Account>(() => ({ email, signOut }), [email, signOut])

  if (session === 'checking') {
    return (
      <main id="main" className={styles.main}>
        <LoadingState />
      </main>
    )
  }
  if (session === 'signedOut') return <LoginScreen auth={backend.auth} onSignedIn={onSignedIn} />
  return (
    <AccountContext value={account}>
      <DataProvider load={load}>
        <Shell />
      </DataProvider>
    </AccountContext>
  )
}

interface AppProps {
  /** 試験で差し替えるため */
  load?: () => Promise<LoadedData>
  /** 保存(と前の版の評価・メモ)の置き場。試験で差し替えるため。既定は端末の localStorage */
  userStore?: UserStore
  /** Supabase モードのときだけ渡す(main.tsx が環境変数を見て決める)。無ければ今までどおり local-data → fixtures */
  backend?: Backend
}

export function App({ load, userStore, backend }: AppProps) {
  const store = useMemo(() => userStore ?? createDefaultUserStore(), [userStore])
  return (
    <UserStoreProvider value={store}>
      <ToastProvider>
        {backend === undefined ? (
          <DataProvider load={load}>
            <Shell />
          </DataProvider>
        ) : (
          <SupabaseRoot backend={backend} />
        )}
      </ToastProvider>
    </UserStoreProvider>
  )
}
