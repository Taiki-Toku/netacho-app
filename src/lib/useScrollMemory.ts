// 戻ったら元の位置へ(詳細設計 5.7.3)。
// - 一覧の画面を離れるとき(hashchange)に、離れた URL のハッシュ全体ごとに、離れる直前の scrollY を覚える(メモリだけ。最大 50 件、古いものから捨てる)
// - 画面の種類(screenKey)が変わったら、描画の後に、一覧なら覚えた位置へ、覚えていない・一覧でない(詳細・設定)なら先頭へ移す。
//   絞り込みの変更(screenKey が変わらない。replaceRoute もここに入る)では動かさない
// - データの読み込み中は移さず、読めた後に移す。ページが短くなっていたら、ブラウザーが届く所まで(scrollTo は端で止まる)
// - history.scrollRestoration = 'manual'(ブラウザーの自動の戻しと二重にしない)
import { useEffect, useRef, useState } from 'react'

/** 覚えておく件数の上限 */
export const SCROLL_MEMORY_LIMIT = 50

/** ハッシュ → scrollY。上限を越えたら、いちばん前に覚えたものから捨てる */
export class ScrollMemory {
  private readonly positions = new Map<string, number>()

  constructor(private readonly limit = SCROLL_MEMORY_LIMIT) {}

  remember(hash: string, y: number) {
    // 覚え直したものは新しい側へ移す(Map は入れた順を保つ)
    this.positions.delete(hash)
    this.positions.set(hash, y)
    while (this.positions.size > this.limit) {
      const oldest = this.positions.keys().next()
      if (oldest.done === true) break
      this.positions.delete(oldest.value)
    }
  }

  recall(hash: string): number | undefined {
    return this.positions.get(hash)
  }

  get size(): number {
    return this.positions.size
  }
}

function hashOf(url: string): string {
  try {
    return new URL(url).hash
  } catch {
    return ''
  }
}

interface ScrollMemoryOptions {
  /** 画面の種類の鍵(router の screenKey)。変わったときだけ位置を移す */
  screenKey: string
  /** データを読めているか。読めるまでは移さない */
  ready: boolean
  /** そのハッシュが一覧の画面か(一覧だけ位置を覚え、戻す) */
  isList: (hash: string) => boolean
}

export function useScrollMemory({ screenKey, ready, isList }: ScrollMemoryOptions) {
  // 画面(App)ごとに1つ。作り直さない
  const [memory] = useState(() => new ScrollMemory())
  // 最後に位置を移した画面の鍵(同じ画面で読み込みをやり直したときに、もう一度移さない)
  const applied = useRef<string | null>(null)
  const isListRef = useRef(isList)
  useEffect(() => {
    isListRef.current = isList
  }, [isList])

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    // 前の画面での位置は、scroll のたびに控えておいた値を使う。hashchange の時点の window.scrollY は使わない
    // (ルーターの hashchange の処理が先に動き、React が次の画面を描いて scrollTo したり、短くなったページで位置が切り詰められたりした後のことがあるため。
    //  scroll のイベントは次の描画の時に届くので、この控えはまだ前の画面の位置のまま)
    let lastY = window.scrollY
    function handleScroll() {
      lastY = window.scrollY
    }
    function handleHashChange(event: HashChangeEvent) {
      const hash = hashOf(event.oldURL)
      if (isListRef.current(hash)) memory.remember(hash, lastY)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    // capture:同じ window に付いたルーターの処理より先に受ける
    window.addEventListener('hashchange', handleHashChange, { capture: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('hashchange', handleHashChange, { capture: true })
    }
  }, [memory])

  useEffect(() => {
    if (!ready || applied.current === screenKey) return
    applied.current = screenKey
    const hash = window.location.hash
    const y = isListRef.current(hash) ? (memory.recall(hash) ?? 0) : 0
    window.scrollTo(0, y)
  }, [memory, screenKey, ready])
}
