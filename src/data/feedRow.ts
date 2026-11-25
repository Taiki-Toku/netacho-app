// Supabase の feed_entries 表の1行を、今の公式フィードの型(FeedEntry)に変える(詳細設計 5.2.1)。
// 行の中身は信用しないデータとして扱い、JSON のときと同じ parseFeedEntry で形を確かめる(形にならない行は捨てる)。
import { parseFeed, parseFeedEntry } from './parse.ts'
import type { FeedEntry } from './types.ts'

/** 画面が使う列だけを取る。訳は見出しの訳と翻訳の状態だけ。summary・summary_ja は今の画面で使わないので読まない(詳細設計 5.3.1) */
export const FEED_COLUMNS = 'id,kind,vendor,product,title,url,published_at,sort_at,severity,cvss,cve_ids,status,title_ja,translate_status'

/** PostgREST が numeric を文字列で返す場合に備えて、文字列は Number に直す(範囲の検査は parseFeedEntry)。空の文字列は値なし */
function cvssValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value.trim() === '' ? null : Number(value)
}

/** 行の列名を、JSON の公式フィードの項目名に置き換える(値の検査は parseFeedEntry に任せる) */
function rowToJson(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  return {
    id: r.id,
    kind: r.kind,
    vendor: r.vendor,
    product: r.product,
    title: r.title,
    // 公開日。null は空文字(「公開日不明」と出す。取った時刻を公開日として出さない)
    publishedAt: r.published_at ?? '',
    // 並びの日時(公開日、無ければ最初に取った時刻)。null・列なしは空文字にして、publishedAt で代えずに捨てる
    sortAt: r.sort_at ?? '',
    // null は空文字(リンクを出さない)。URL の検査は表示の直前
    url: r.url ?? '',
    // null は空文字(「未評価」)
    severity: r.severity ?? '',
    // 今の型は CVE が1つなので最初の値だけ。2つ目以降は出さない
    cve: Array.isArray(r.cve_ids) ? (r.cve_ids as unknown[])[0] : '',
    cvss: cvssValue(r.cvss),
    status: r.status,
    // 訳は翻訳が済んだ行(translate_status が done)のときだけ渡す。pending・failed などに残った title_ja は使わない。
    // 文字列か・空でないか・長さの検査は parseFeedEntry
    titleJa: r.translate_status === 'done' ? r.title_ja : undefined,
  }
}

/** 1行を変える。形にならない行(id が無い、kind が違う、日時が読めないなど)は null */
export function rowToFeedEntry(row: unknown): FeedEntry | null {
  return parseFeedEntry(rowToJson(row))
}

/** 行の一覧を変える。形にならない行は捨て、同じ id が重なったら先のものを残す */
export function rowsToFeed(rows: unknown): FeedEntry[] {
  return Array.isArray(rows) ? parseFeed(rows.map(rowToJson)) : []
}
