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

/** 外す先頭の部分(仕様 4 章末「共通」)。外したあとに「.」が残らない(docs.com → com)ときは外さない */
const HOST_PREFIX = /^(?:www|docs|blog|news)\.(?=[^.]+\..)/

/** 国の区分だけのホスト名(co.jp、ne.jp、or.jp、ac.jp、go.jp、co.uk、com.au など)。媒体の名前の部分が無い */
const COUNTRY_CATEGORY = /^(?:co|ne|or|ac|go|ad|ed|gr|lg|com|net|org|gov|edu)\.[a-z]{2}$/

/** 先頭の www./docs./blog./news. を外す。外したあとが国の区分だけになるとき(docs.co.jp → co.jp)は外さない */
function shortHost(host: string): string {
  const short = host.replace(HOST_PREFIX, '')
  return COUNTRY_CATEGORY.test(short) ? host : short
}

/** URL から媒体名を作る。先頭の www./docs./blog./news. は外す(shortHost)。リンクにできない URL なら null */
export function sourceNameOf(url: string): string | null {
  const href = httpsHref(url)
  if (href === null) return null
  const host = new URL(href).hostname
  const short = shortHost(host)
  // 表は外す前のホストを先に見る(news.ycombinator.com は ycombinator.com ではなく Hacker News)
  return SOURCE_NAMES.get(host) ?? SOURCE_NAMES.get(short) ?? short
}

/** 画面に出す媒体名。URL から作れなければジャンル名 */
export function itemSourceName(item: Item, genreLabel: string): string {
  return sourceNameOf(item.sourceUrl) ?? genreLabel
}

/** 頭文字の札:媒体名の最初の1文字を大文字にする(ollama.com → O) */
export function sourceInitial(name: string): string {
  const [first = ''] = [...name.trim()]
  return first.toUpperCase()
}
