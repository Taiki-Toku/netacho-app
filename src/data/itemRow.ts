// Supabase の items 表の1行を、今のネタの型(Item)に変える。
// 行の中身は信用しないデータとして扱い、JSON のときと同じ parseItem で形を確かめる(型が合わない項目は空にする)。
import { parseItem, parseItems } from './parse.ts'
import type { Item } from './types.ts'

/** 画面が使う列だけを取る(supabase/migrations/0001_init.sql の items) */
export const ITEM_COLUMNS =
  'id,date,sort_order,slot,genre,title,lead,summary,points,excerpt,tryit,caution,categories,projects,tags,source_url,source_title,trust,star_hot,star_use,star_fun'

/** 行の列名を、JSON のネタの項目名に置き換える(値の検査は parseItem に任せる) */
function rowToJson(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  return {
    id: r.id,
    date: r.date,
    order: r.sort_order,
    slot: r.slot,
    genre: r.genre,
    title: r.title,
    lead: r.lead,
    summary: r.summary,
    points: r.points,
    excerpt: r.excerpt,
    tryit: r.tryit,
    caution: r.caution,
    categories: r.categories,
    projects: r.projects,
    tags: r.tags,
    // source_url は https 以外を同期が null にしている。null は空文字(出典のリンクを出さない)
    sourceUrl: r.source_url ?? '',
    sourceTitle: r.source_title,
    trust: r.trust,
    stars: { hot: r.star_hot, use: r.star_use, fun: r.star_fun },
    // 評価・状態・メモは item_feedback に分けた(フェーズ1では読まない)
    rating: '',
    status: '',
    memo: '',
  }
}

/** 1行を変える。形にならない行(id・date が無いなど)は null */
export function rowToItem(row: unknown): Item | null {
  return parseItem(rowToJson(row))
}

/** 行の一覧を変える。形にならない行は捨て、同じ id が重なったら先のものを残す */
export function rowsToItems(rows: unknown): Item[] {
  return Array.isArray(rows) ? parseItems(rows.map(rowToJson)) : []
}
