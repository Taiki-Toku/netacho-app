// 画面で使うアイコン。絵文字は使わず、線の太さをそろえた SVG を自前で持つ(形は docs/design_reference/nodal-prototype.html から)
import type { SVGProps } from 'react'
import styles from './Icon.module.css'

export type IconName = 'search' | 'back' | 'bookmark' | 'home' | 'feed' | 'shield' | 'close' | 'up' | 'gear'

const PATHS: Record<IconName, string> = {
  // さがす:虫めがね
  search: 'M17.6 10.8a6.8 6.8 0 1 1-13.6 0 6.8 6.8 0 0 1 13.6 0Zm-1.6 5.2 5 5',
  // 戻る:左向きの山形
  back: 'm15 18-6-6 6-6',
  // 保存:しおり
  bookmark: 'M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z',
  // ホーム:家
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z',
  // 公式情報:配信(RSS)の弧
  feed: 'M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8M7.5 18a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  // 脆弱性:盾
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z',
  // 閉じる
  close: 'M6 6l12 12M18 6 6 18',
  // 先頭へ戻る:上向きの山形(「戻る」を回したもの)
  up: 'm6 15 6-6 6 6',
  // 設定:歯車(外側の歯と、中の丸)
  gear: 'M10.3 3h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.9 8.5l1.7-2.9 2.3.8 1.7-1ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** 塗りつぶす(保存済みのしおりなど) */
  filled?: boolean
}

export function Icon({ name, filled = false, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={[styles.icon, filled ? styles.filled : '', className ?? ''].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
