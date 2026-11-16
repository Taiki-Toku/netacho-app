// ネタ1本の形(docs/beta_brief.md 2.2 と同じ)

export const RATINGS = ['hot', 'good', 'meh', 'no', ''] as const
export type Rating = (typeof RATINGS)[number]

export const STATUSES = ['interest', 'plan', 'tried', 'adopted', 'skip', ''] as const
export type Status = (typeof STATUSES)[number]

export interface Stars {
  hot: number
  use: number
  fun: number
}

export interface Item {
  id: string
  date: string
  order: number
  slot: string
  genre: string | null
  title: string
  lead: string
  summary: string
  tryit: string
  caution: string
  categories: string[]
  projects: string[]
  tags: string[]
  sourceUrl: string
  sourceTitle: string
  trust: string
  stars: Stars
  rating: Rating
  status: Status
  memo: string
}

export interface Genre {
  id: string
  label: string
  sortOrder: number
}

// 公式フィード1本の形(.tmp/request2.md 2章)。ネタとは別の種類のデータで、公式の発表をそのまま時系列で並べる
export const FEED_KINDS = ['release', 'eol', 'change', 'exam', 'vuln', 'outage'] as const
export type FeedKind = (typeof FEED_KINDS)[number]

export const SEVERITIES = ['critical', 'high', 'medium', 'low', ''] as const
export type Severity = (typeof SEVERITIES)[number]

export interface FeedEntry {
  id: string
  kind: FeedKind
  product: string
  vendor: string
  title: string
  /** 公開日時(ISO 8601、UTC)。表示は日本時間にする */
  publishedAt: string
  url: string
  /** kind が vuln のときだけ。それ以外は空 */
  severity: Severity
  /** kind が outage のときだけ(「調査中」「復旧済み」など、自由な文字列)。それ以外は空 */
  status: string
}
