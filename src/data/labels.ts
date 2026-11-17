// 決まった値(rating / status / stars の軸、フィードの種類・深刻度)の、画面に出す日本語。値の定義は types.ts、名前はここ。
// 文言は docs/design_spec.md と docs/design_reference/nodal-prototype.html に合わせる
import type { FeedKind, Rating, Severity, Stars, Status } from './types.ts'

export const FEED_KIND_LABELS: Record<FeedKind, string> = {
  release: 'リリース',
  eol: 'サポート終了',
  change: '変更',
  exam: '試験',
  vuln: '脆弱性',
  outage: '障害',
}

/** 公式のお知らせの絞り込みに出す種類(仕様 4 章:すべて/リリース/サポート終了/試験/障害)。脆弱性は別の画面に一本化する */
export const FEED_FILTER_KINDS: readonly FeedKind[] = ['release', 'eol', 'exam', 'outage']

/** 公式のお知らせの画面に並べる種類(脆弱性以外のすべて) */
export const ANNOUNCEMENT_KINDS: readonly FeedKind[] = ['release', 'eol', 'change', 'exam', 'outage']

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  '': '不明',
}

/** 深刻度の順(件数のカードの並びと、脆弱性ウォッチで先頭に出す順) */
export const SEVERITY_ORDER: readonly Exclude<Severity, ''>[] = ['critical', 'high', 'medium', 'low']

export const RATING_LABELS: Record<Rating, string> = {
  hot: '熱い',
  good: '良い',
  meh: 'ふつう',
  no: 'いまいち',
  '': '未評価',
}

/** 評価のボタンに出す順(空は「未評価」で、ボタンにはしない) */
export const RATING_CHOICES: readonly Exclude<Rating, ''>[] = ['hot', 'good', 'meh', 'no']

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

/** 「試してみる」の見出し。セキュリティニュースとプロダクトでは「確かめること」(仕様 4 章 5) */
export function tryitHeading(genre: string | null): string {
  return genre === 'security-news' || genre === 'product' ? '確かめること' : '試してみる'
}
