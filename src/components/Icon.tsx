// 画面で使うアイコン。絵文字は使わず、線の太さをそろえた SVG を自前で持つ
import type { SVGProps } from 'react'

export type IconName = 'rundown' | 'archive' | 'search' | 'settings' | 'back'

const PATHS: Record<IconName, string> = {
  // 戻る:左向きの山形
  back: 'M15 5l-7 7 7 7',
  // 進行表:番号つきの行
  rundown: 'M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11',
  // バックナンバー:めくるカレンダー
  archive: 'M4 7h16v13H4zM4 11h16M8 4v4M16 4v4',
  // 探す:虫めがね
  search: 'M15.5 15.5 20 20M4 10.5a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0z',
  // 設定:つまみ
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 4.5v5M7 14.5v5',
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
}

export function Icon({ name, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
