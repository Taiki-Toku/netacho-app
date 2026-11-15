// 読み込んだデータをアプリ全体に配る。読み込みは起動時に1回だけ。
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadData, type LoadedData } from './source.ts'

export type DataState =
  | { status: 'loading' }
  | { status: 'ready'; data: LoadedData }
  | { status: 'error'; message: string }

const DataContext = createContext<DataState>({ status: 'loading' })

interface DataProviderProps {
  children: ReactNode
  /** 試験で差し替えるため。既定は loadData */
  load?: () => Promise<LoadedData>
}

export function DataProvider({ children, load = loadData }: DataProviderProps) {
  const [state, setState] = useState<DataState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data })
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
  }, [load])

  return <DataContext value={state}>{children}</DataContext>
}

export function useData(): DataState {
  return useContext(DataContext)
}
