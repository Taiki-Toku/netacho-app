// 読了バー(仕様 4 章-5):上のバーの下端に、ページをどこまで読んだかを横の線で出す。
// 幅は style で書かず、<progress> の値で表す(あとで厳しい CSP を入れるため、インラインの style を使わない)
import { useEffect, useState } from 'react'
import styles from './ReadingProgress.module.css'

/** 読んだ割合(0〜1)。スクロールできない短いページは 0 */
function readRatio(): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight
  if (scrollable <= 0) return 0
  return Math.min(1, Math.max(0, window.scrollY / scrollable))
}

export function ReadingProgress() {
  const [ratio, setRatio] = useState(0)

  useEffect(() => {
    // スクロールのたびに描き直さず、次の描画の前に1回だけ読む
    let frame = 0
    function update() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setRatio(readRatio())
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // 見た目の手がかりなので読み上げない(スクロールのたびに値が変わり、読み上げがうるさくなる)
  return <progress className={styles.bar} max={1} value={ratio} aria-hidden="true" />
}
