// 画面の下に固定する「チャンネル切り替え」。片手で届く位置に主な移動を置く(REQ-N-03)
import { hrefFor, type Route } from '../app/router.ts'
import { Icon, type IconName } from './Icon.tsx'
import styles from './BottomNav.module.css'

interface NavItem {
  label: string
  icon: IconName
  route: Route
  matches: (route: Route) => boolean
}

const ITEMS: NavItem[] = [
  { label: '今日', icon: 'rundown', route: { name: 'today' }, matches: (r) => r.name === 'today' || r.name === 'item' },
  {
    label: 'バックナンバー',
    icon: 'archive',
    route: { name: 'archive' },
    matches: (r) => r.name === 'archive' || r.name === 'archive-date',
  },
  { label: '探す', icon: 'search', route: { name: 'search' }, matches: (r) => r.name === 'search' },
  { label: '設定', icon: 'settings', route: { name: 'settings' }, matches: (r) => r.name === 'settings' },
]

interface BottomNavProps {
  route: Route
}

export function BottomNav({ route }: BottomNavProps) {
  return (
    <nav className={styles.nav} aria-label="画面の切り替え">
      <ul className={styles.list}>
        {ITEMS.map((item) => {
          const current = item.matches(route)
          return (
            <li key={item.label}>
              <a className={styles.item} href={hrefFor(item.route)} aria-current={current ? 'page' : undefined}>
                <Icon name={item.icon} className={styles.icon} />
                <span className={styles.label}>{item.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
