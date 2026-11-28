// 決まった値(フィードの種類・深刻度)の、画面に出す日本語。値の定義は types.ts、名前はここ。
// rating / status は画面に出さない(詳細設計 5.7.1)ので名前を持たない。
// 文言は docs/design_spec.md と docs/design_reference/nodal-prototype.html に合わせる
import type { FeedKind, Severity } from './types.ts'

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
  // 深刻度の無いもの(KEV だけにあるものなど)
  '': '未評価',
}

/** 公式フィードの公開日が分からないとき(publishedAt が空)。取った時刻を公開日として出さない */
export const PUBLISHED_UNKNOWN = '公開日不明'

/** 深刻度の順(件数のカードの並びと、脆弱性ウォッチで先頭に出す順) */
export const SEVERITY_ORDER: readonly Exclude<Severity, ''>[] = ['critical', 'high', 'medium', 'low']
