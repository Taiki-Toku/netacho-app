// 決まった値(rating / status / stars の軸)の、画面に出す日本語。値の定義は types.ts、名前はここ
import type { Rating, Stars, Status } from './types.ts'

export const RATING_LABELS: Record<Rating, string> = {
  hot: '刺さった',
  good: 'いいね',
  meh: '微妙',
  no: 'いらない',
  '': '未評価',
}

export const STATUS_LABELS: Record<Status, string> = {
  interest: '気になる',
  plan: '試す予定',
  tried: '試した',
  adopted: '採用',
  skip: '見送り',
  '': '未設定',
}

export const STAR_AXES: readonly { key: keyof Stars; label: string }[] = [
  { key: 'hot', label: '話題度' },
  { key: 'use', label: '実用度' },
  { key: 'fun', label: '遊べる度' },
]
