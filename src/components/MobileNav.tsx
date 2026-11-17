// スマホ(767px 以下)の下のメニュー:ホーム / 公式情報 / 脆弱性 / 保存
import { hrefFor, type Route } from '../app/router.ts'
import { Icon, type IconName } from './Icon.tsx'
import { isCurrent } from './Sidebar.tsx'
import styles from './MobileNav.module.css'

const ITEMS: { label: string; icon: IconName; target: Route }[] = [
  { label: 'ホーム', icon: 'home', target: { name: 'home' } },
  { label: '公式情報', icon: 'feed', target: { name: 'feed', kind: 'all' } },
  { label: '脆弱性', icon: 'shield', target: { name: 'vuln', severity: 'all' } },
  { label: '保存', icon: 'bookmark', target: { name: 'saved' } },
]

export function MobileNav({ route }: { route: Route }) {
  return (
    <nav className={styles.nav} aria-label="画面の切り替え">
      {ITEMS.map((item) => {
        const current = isCurrent(route, item.target)
        return (
          <a key={item.label} className={current ? styles.itemOn : styles.item} href={hrefFor(item.target)} aria-current={current ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
