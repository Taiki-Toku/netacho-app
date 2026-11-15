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
