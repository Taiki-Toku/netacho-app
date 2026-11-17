// 左メニュー(1101px 以上):ジャンル(トップ + ジャンル)、公式情報(公式のお知らせ、脆弱性)、自分用(保存)
import { hrefFor, type Route } from '../app/router.ts'
import type { Genre } from '../data/types.ts'
import { Icon, type IconName } from './Icon.tsx'
import styles from './Sidebar.module.css'

interface SidebarProps {
  route: Route
  genres: readonly Genre[]
  vulnCount: number
  savedCount: number
}

/** いまの画面がこのメニューに当たるか */
export function isCurrent(route: Route, target: Route): boolean {
  switch (target.name) {
    case 'home':
      return route.name === 'home'
    case 'genre':
      return route.name === 'genre' && route.id === target.id
    case 'feed':
      return route.name === 'feed'
    case 'vuln':
      return route.name === 'vuln' || route.name === 'vuln-detail'
    case 'saved':
      return route.name === 'saved'
    default:
      return route.name === target.name
  }
}

interface NavLinkProps {
  route: Route
  target: Route
  label: string
  icon?: IconName
  count?: number
}

function NavLink({ route, target, label, icon, count }: NavLinkProps) {
  const current = isCurrent(route, target)
  return (
    <a className={current ? styles.linkOn : styles.link} href={hrefFor(target)} aria-current={current ? 'page' : undefined}>
      {icon !== undefined ? <Icon name={icon} /> : null}
      {label}
      {count !== undefined ? <span className={styles.count}>{count}</span> : null}
    </a>
  )
}

export function Sidebar({ route, genres, vulnCount, savedCount }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <p className={styles.groupLabel} id="side-genres">
        GENRES
      </p>
      <nav className={styles.group} aria-labelledby="side-genres">
        <NavLink route={route} target={{ name: 'home' }} label="トップ" />
        {genres.map((genre) => (
          <NavLink key={genre.id} route={route} target={{ name: 'genre', id: genre.id, kind: 'all' }} label={genre.label} />
        ))}
      </nav>
      <p className={styles.groupLabel} id="side-official">
        OFFICIAL
      </p>
      <nav className={styles.group} aria-labelledby="side-official">
        <NavLink route={route} target={{ name: 'feed', kind: 'all' }} label="公式のお知らせ" icon="feed" />
        <NavLink route={route} target={{ name: 'vuln', severity: 'all' }} label="脆弱性" icon="shield" count={vulnCount} />
      </nav>
      <p className={styles.groupLabel} id="side-mine">
        LIBRARY
      </p>
      <nav className={styles.group} aria-labelledby="side-mine">
        <NavLink route={route} target={{ name: 'saved' }} label="保存" icon="bookmark" count={savedCount} />
      </nav>
    </aside>
  )
}
