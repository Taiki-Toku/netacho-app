// 上のバー:印と名前(ホームへのリンク)、日付、さがす(欄と候補は SearchBox)
import type { Route } from '../app/router.ts'
import { hrefFor } from '../app/router.ts'
import type { LoadedData } from '../data/source.ts'
import { BrandMark } from './BrandMark.tsx'
import { SearchBox } from './SearchBox.tsx'
import styles from './TopBar.module.css'

interface TopBarProps {
  route: Route
  /** 「1月2日 金曜日」。データが無いうちは空 */
  dateLabel: string
  /** 検索の候補を作るため。読み込み中・通信エラーのときは null */
  data: LoadedData | null
}

export function TopBar({ route, dateLabel, data }: TopBarProps) {
  return (
    <header className={styles.topbar}>
      <a className={styles.brand} href={hrefFor({ name: 'home' })} aria-label="NODAL ホーム">
        <BrandMark />
        <span className={styles.brandName}>NODAL</span>
      </a>
      <div className={styles.right}>
        {dateLabel !== '' ? <span className={styles.date}>{dateLabel}</span> : null}
        <SearchBox route={route} data={data} />
      </div>
    </header>
  )
}
