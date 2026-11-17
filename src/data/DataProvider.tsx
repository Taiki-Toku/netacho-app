// 読み込んだデータをアプリ全体に配る。読み込みは起動時に1回だけ(失敗したときは「もう一度読み込む」で読み直せる)。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadData, type LoadedData } from './source.ts'

export type DataState =
  | { status: 'loading' }
  /** loadedAt:読み込みに成功した時刻(設定の画面に出す。端末には保存しない) */
  | { status: 'ready'; data: LoadedData; loadedAt: Date }
  | { status: 'error'; message: string }

const DataContext = createContext<DataState>({ status: 'loading' })
const ReloadContext = createContext<() => void>(() => undefined)

interface DataProviderProps {
  children: ReactNode
  /** 試験で差し替えるため。既定は loadData */
  load?: () => Promise<LoadedData>
}

export function DataProvider({ children, load = loadData }: DataProviderProps) {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  // 読み直すたびに 1 増やし、下の effect をもう一度走らせる
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data, loadedAt: new Date() })
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
  }, [load, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  return (
    <DataContext value={state}>
      <ReloadContext value={reload}>{children}</ReloadContext>
    </DataContext>
  )
}

export function useData(): DataState {
  return useContext(DataContext)
}

/** データを読み直す(通信エラーのあとに使う) */
export function useReloadData(): () => void {
  return useContext(ReloadContext)
}
