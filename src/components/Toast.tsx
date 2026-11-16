// 操作の結果を短く知らせる(「保存しました」など)。通知は aria-live="polite" で読み上げに伝える(仕様 7 章)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './Toast.module.css'

interface ToastApi {
  show: (message: string) => void
}

const ToastContext = createContext<ToastApi>({ show: () => undefined })

/** 表示しておく長さ(ms) */
const DURATION = 1800

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((next: string) => {
    setMessage(next)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setMessage('')
      timer.current = null
    }, DURATION)
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastContext value={api}>
      {children}
      {/* 領域は常に置いておき、文だけを入れ替える(入れ替えが読み上げの合図になる) */}
      <div className={message === '' ? styles.toast : styles.toastShown} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext>
  )
}

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
