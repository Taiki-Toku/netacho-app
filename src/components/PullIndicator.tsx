// 引っぱって更新の表示(詳細設計 5.5.2、design_spec 8 章)。上のバーのすぐ下に出す。
// 引いている間「離すと更新」、更新中「更新中…」(aria-live="polite")。成功したらトースト「最新に更新しました」。
// 失敗のトーストは DataProvider が出す(開き直しの読み直しと同じ文)
import { useCallback, useRef } from 'react'
import { useRefreshData } from '../data/DataProvider.tsx'
import { usePullToRefresh, type PullPhase } from '../lib/usePullToRefresh.ts'
import { useToast } from './Toast.tsx'
import styles from './PullIndicator.module.css'

export const REFRESH_DONE_MESSAGE = '最新に更新しました'

const TEXT: Record<PullPhase, string> = {
  idle: '',
  pulling: '離すと更新',
  armed: '離すと更新',
  refreshing: '更新中…',
}

export function PullIndicator({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const refresh = useRefreshData()
  const toast = useToast()
  const onRefresh = useCallback(async () => {
    if ((await refresh()) === 'updated') toast.show(REFRESH_DONE_MESSAGE)
  }, [refresh, toast])
  const phase = usePullToRefresh(ref, { enabled, onRefresh })

  return (
    <div ref={ref} className={styles.indicator} data-phase={phase} role="status" aria-live="polite">
      <span className={styles.text}>{TEXT[phase]}</span>
    </div>
  )
}
