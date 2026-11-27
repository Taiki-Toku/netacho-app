// 読み込んだデータをアプリ全体に配る(詳細設計 5.5.1)。
// - 起動時に1回読む。失敗したときは「もう一度読み込む」(reload。画面を読み込み中にする)で読み直せる
// - 開き直したとき(visibilitychange で表示に戻った・pageshow の persisted)、前の読み込みから 30 分以上たっていれば、
//   裏で読み直す(refresh。画面は読み込み中にせず、今のデータを出したまま読む)。引っぱって更新も refresh を使う
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '../components/Toast.tsx'
import { loadData, type LoadedData } from './source.ts'

export type DataState =
  | { status: 'loading' }
  /**
   * loadedAt:読み込みに成功した時刻(設定の画面に出す。端末には保存しない)。
   * refreshing:裏で読み直している最中か(その間も data は前のまま出す)
   */
  | { status: 'ready'; data: LoadedData; loadedAt: Date; refreshing: boolean }
  | { status: 'error'; message: string }

/** 裏の読み直しの結果。updated:差し替えた、failed:失敗して今のまま、skipped:読める状態でない(読み込み中・エラー) */
export type RefreshResult = 'updated' | 'failed' | 'skipped'

/** この時間(ms)より前に読んだデータなら、開き直したときに読み直す */
export const STALE_AFTER_MS = 30 * 60 * 1000

export const REFRESH_FAILED_MESSAGE = '最新に更新できませんでした'

const DataContext = createContext<DataState>({ status: 'loading' })
const ReloadContext = createContext<() => void>(() => undefined)
const RefreshContext = createContext<() => Promise<RefreshResult>>(() => Promise.resolve('skipped'))

interface DataProviderProps {
  children: ReactNode
  /** 試験で差し替えるため。既定は loadData */
  load?: () => Promise<LoadedData>
  /** 今の時刻。試験で差し替えるため(30 分の判定と loadedAt) */
  now?: () => Date
}

function currentTime(): Date {
  return new Date()
}

export function DataProvider({ children, load = loadData, now = currentTime }: DataProviderProps) {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  // 読み直すたびに 1 増やし、下の effect をもう一度走らせる
  const [attempt, setAttempt] = useState(0)
  const toast = useToast()

  // イベントの処理の中から今の状態を見るため(effect の中でだけ書き換える)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // 裏の読み直しの最中なら、その約束(2本目は始めず、同じ結果を待たせる)
  const inFlight = useRef<Promise<RefreshResult> | null>(null)
  // reload(やり直し)や画面を外したあとに届いた裏の読み直しの結果を捨てるための番号
  const generation = useRef(0)

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data, loadedAt: now(), refreshing: false })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'データを読み込めませんでした' })
        }
      },
    )
    return () => {
      cancelled = true
    }
    // now は時刻を取るだけなので、変わっても読み直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, attempt])

  // 画面を外したら、届いた結果を捨てる
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )

  const reload = useCallback(() => {
    generation.current += 1
    inFlight.current = null
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  const refresh = useCallback((): Promise<RefreshResult> => {
    if (inFlight.current !== null) return inFlight.current
    if (stateRef.current.status !== 'ready') return Promise.resolve('skipped')
    const started = generation.current
    setState((previous) => (previous.status === 'ready' ? { ...previous, refreshing: true } : previous))
    const task = load().then(
      (data): RefreshResult => {
        if (generation.current !== started) return 'skipped'
        // 画面・URL・スクロールの位置は変えない(データと時刻だけを差し替える)
        setState({ status: 'ready', data, loadedAt: now(), refreshing: false })
        return 'updated'
      },
      (): RefreshResult => {
        if (generation.current !== started) return 'skipped'
        setState((previous) => (previous.status === 'ready' ? { ...previous, refreshing: false } : previous))
        toast.show(REFRESH_FAILED_MESSAGE)
        return 'failed'
      },
    )
    const tracked = task.finally(() => {
      if (inFlight.current === tracked) inFlight.current = null
    })
    inFlight.current = tracked
    return tracked
  }, [load, now, toast])

  // 開き直したときの読み直し。前の読み込みから 30 分以上たっているときだけ
  useEffect(() => {
    function refreshIfStale() {
      const current = stateRef.current
      if (current.status !== 'ready') return
      if (now().getTime() - current.loadedAt.getTime() >= STALE_AFTER_MS) void refresh()
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') refreshIfStale()
    }
    function handlePageShow(event: PageTransitionEvent) {
      // persisted:止めておいたページ(bfcache)から戻ったとき。最初の表示では false
      if (event.persisted) refreshIfStale()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [now, refresh])

  return (
    <DataContext value={state}>
      <ReloadContext value={reload}>
        <RefreshContext value={refresh}>{children}</RefreshContext>
      </ReloadContext>
    </DataContext>
  )
}

export function useData(): DataState {
  return useContext(DataContext)
}

/** データを読み直す(通信エラーのあとに使う。画面を読み込み中にする) */
export function useReloadData(): () => void {
  return useContext(ReloadContext)
}

/** 裏でデータを読み直す(今のデータを出したまま。失敗したらトーストで知らせる) */
export function useRefreshData(): () => Promise<RefreshResult> {
  return useContext(RefreshContext)
}
