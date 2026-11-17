// 「先頭へ戻る」ボタン。1画面分(画面の高さ)より下までスクロールしたときだけ出す(仕様 4 章の共通)
import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'
import styles from './ScrollTopButton.module.css'

function scrolledPastOneScreen(): boolean {
  return window.scrollY > window.innerHeight
}

export function ScrollTopButton() {
  const [visible, setVisible] = useState(scrolledPastOneScreen)

  useEffect(() => {
    function update() {
      setVisible(scrolledPastOneScreen())
    }
    // passive:スクロールを止めない(読み取るだけ)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (!visible) return null

  function scrollToTop() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    // キーボードの人が先頭から読み直せるよう、本文に焦点を移す(移すときにスクロールさせない)
    document.getElementById('main')?.focus({ preventScroll: true })
  }

  return (
    <button type="button" className={styles.button} aria-label="先頭へ戻る" onClick={scrollToTop}>
      <Icon name="up" />
    </button>
  )
}
