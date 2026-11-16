// スマホ(767px 以下)の、横に流れるジャンルのタブ。今日 + ジャンル
import { hrefFor, type Route } from '../app/router.ts'
import type { Genre } from '../data/types.ts'
import { isCurrent } from './Sidebar.tsx'
import styles from './GenreTabs.module.css'

interface GenreTabsProps {
  route: Route
  genres: readonly Genre[]
}

export function GenreTabs({ route, genres }: GenreTabsProps) {
  const targets: { route: Route; label: string }[] = [{ route: { name: 'today' }, label: '今日' }]
  for (const genre of genres) targets.push({ route: { name: 'genre', id: genre.id, kind: 'all' }, label: genre.label })
  return (
    <nav className={styles.tabs} aria-label="ジャンルのタブ">
      {targets.map((target) => {
        const current = isCurrent(route, target.route)
        return (
          <a key={target.label} className={current ? styles.tabOn : styles.tab} href={hrefFor(target.route)} aria-current={current ? 'page' : undefined}>
            {target.label}
          </a>
        )
      })}
    </nav>
  )
}
