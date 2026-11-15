// アプリの骨組み:番組ヘッダー + 画面 + 下の切り替え
import { useRoute, type Route } from './app/router.ts'
import { BottomNav } from './components/BottomNav.tsx'
import { ProgramHeader } from './components/ProgramHeader.tsx'
import { DataProvider } from './data/DataProvider.tsx'
import type { LoadedData } from './data/source.ts'
import { PlaceholderScreen } from './screens/PlaceholderScreen.tsx'
import { TodayScreen } from './screens/TodayScreen.tsx'
import styles from './App.module.css'

function screenFor(route: Route) {
  switch (route.name) {
    case 'today':
      return <TodayScreen />
    case 'item':
      return <PlaceholderScreen title="ネタの詳細" />
    case 'archive':
    case 'archive-date':
      return <PlaceholderScreen title="バックナンバー" />
    case 'search':
      return <PlaceholderScreen title="探す" />
    case 'settings':
      return <PlaceholderScreen title="設定" />
  }
}

function Shell() {
  const route = useRoute()
  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#main">
        本文へ移動
      </a>
      <ProgramHeader />
      <main id="main" className={styles.main} tabIndex={-1}>
        {screenFor(route)}
      </main>
      <BottomNav route={route} />
    </div>
  )
}

interface AppProps {
  /** 試験で差し替えるため */
  load?: () => Promise<LoadedData>
}

export function App({ load }: AppProps) {
  return (
    <DataProvider load={load}>
      <Shell />
    </DataProvider>
  )
}
