// ネタ1本の形(docs/beta_brief.md 2.2 に imageUrl を足したもの)

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
  /** 要点の箇条(依頼 5-3 でオーナーが決めた項目)。空なら要点は summary を段落で出す */
  points: string[]
  /** 元記事の抜粋(依頼 5-3 でオーナーが決めた項目)。手を加えずに引用する。空なら欄を出さない */
  excerpt: string
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
  /** 記事の画像。無いことがある。表示の前に imageHref(src/lib/safeUrl.ts)で検査する */
  imageUrl?: string
}

export interface Genre {
  id: string
  label: string
  sortOrder: number
}

// 公式フィード1本の形(オーナーの追加依頼 2026-11-16 の形に、脆弱性の項目を足したもの)。
// ネタとは別の種類のデータで、公式の発表をそのまま時系列で並べる
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
  /** 公開日時(ISO 8601、UTC)。表示は日本時間にする。分からないときは空(「公開日不明」と出す。取った時刻を代わりに出さない) */
  publishedAt: string
  /** 並びに使う日時(ISO 8601)。公開日、無ければ最初に取った時刻。見本・local-data で無いときは publishedAt と同じ */
  sortAt: string
  url: string
  /** kind が vuln のときだけ。それ以外は空 */
  severity: Severity
  /** kind が outage(「調査中」「復旧済み」など)と vuln(「修正版あり」など)のとき。自由な文字列。それ以外は空 */
  status: string
  /** kind が vuln のときだけ。CVE 番号(無いこともある)。それ以外は空 */
  cve: string
  /** kind が vuln のときだけ。CVSS の基本値(0〜10)。無ければ null */
  cvss: number | null
}
