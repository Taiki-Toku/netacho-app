// 出典の媒体名(仕様 4 章末「共通」:出典は媒体名だけを短く出す)。
// sourceTitle は記事の題名であることが多く、媒体名を取り出せないため、元記事の URL のホスト名から作る(オーナーの判断:依頼 5-2b の案 d)。
// URL は外から来たデータなので、リンクにしてよい URL(httpsHref が通すもの)だけを使う。それ以外はジャンル名に落とす
import { httpsHref } from '../lib/safeUrl.ts'
import type { Item } from './types.ts'

/** よく出るホストの表示名。ここに無いホストは、ホスト名をそのまま出す */
// Map にするのは、「constructor」のようなオブジェクトの仕組みの名前を、表の中身と取り違えないため
const SOURCE_NAMES: ReadonlyMap<string, string> = new Map([
  ['zenn.dev', 'Zenn'],
  ['qiita.com', 'Qiita'],
  ['github.com', 'GitHub'],
  ['gigazine.net', 'GIGAZINE'],
  ['news.ycombinator.com', 'Hacker News'],
  ['note.com', 'note'],
])

/** URL から媒体名を作る。先頭の「www.」は外す。リンクにできない URL なら null */
export function sourceNameOf(url: string): string | null {
  const href = httpsHref(url)
  if (href === null) return null
  const host = new URL(href).hostname.replace(/^www\./, '')
  return SOURCE_NAMES.get(host) ?? host
}

/** 画面に出す媒体名。URL から作れなければジャンル名 */
export function itemSourceName(item: Item, genreLabel: string): string {
  return sourceNameOf(item.sourceUrl) ?? genreLabel
}
