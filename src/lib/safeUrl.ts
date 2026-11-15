// 外から来た URL を、リンクにしてよいか判定する(CLAUDE.md セキュリティ規約:https: だけをリンクにする)。
//
// 文字列の先頭を見るのではなく、ブラウザーと同じ URL の解釈(new URL)に任せる。
// 理由:URL の解釈には「先頭の空白や制御文字を捨てる」「大文字小文字を同一視する」などの癖があり、
// 自前の正規表現だと "  javascript:" や "JAVASCRIPT:" のような書き方を見落としやすい。
// 解釈した結果の protocol が https: のときだけ、整えた形(href)を返す。それ以外は null。

/** リンクにしてよい URL なら整えた href を、そうでなければ null を返す */
export function httpsHref(value: string): string | null {
  if (value === '') return null
  let url: URL
  try {
    // 相対 URL を許さないため、基準の URL は渡さない("example.com" は失敗して null になる)
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  // ユーザー名:パスワード@ の形は、見た目で別のサイトに見せかける手口に使われるため、リンクにしない
  if (url.username !== '' || url.password !== '') return null
  if (url.hostname === '') return null
  return url.href
}

/** 表示用のホスト名(例:example.com)。リンクにできない URL は空文字 */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname
  } catch {
    return ''
  }
}
