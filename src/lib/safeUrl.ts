// 外から来た URL を、リンクや画像にしてよいか判定する(CLAUDE.md セキュリティ規約:https: だけをリンクにする)。
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

/**
 * 画像のホスト名が IP アドレスか localhost なら true(K-056)。
 * og:image に IP アドレスが入ることはまず無く、プライベートの範囲の表を持つより漏れが少ないので、IP アドレスはすべて止める。
 * DNS 名の先がプライベートの宛先の場合は、ブラウザでは判定できない(詳細設計 5.1.2)。
 * hostname は new URL が正規化した後のもの("2130706433"・"0x7f.1"・"127.1" は "127.0.0.1" に直っている)。
 */
function isLocalOrIpHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true
  if (host.startsWith('[')) return true
  return host === 'localhost' || host.endsWith('.localhost')
}

/**
 * 画像の src にしてよい URL なら整えた href を、そうでなければ null を返す。
 * 通すのは、https: の URL(httpsHref と同じ条件)と、同じオリジンに解決される相対パス(見本の画像 fixtures/images/ など)だけ。
 * https: の URL でも、ホスト名が IP アドレス(IPv4・IPv6)、localhost、*.localhost のものは通さない(isLocalOrIpHost)。
 * "//evil.example/x.png" のような形は別のオリジンに解決されるので通らない。javascript: や data: はオリジンが無いので通らない。
 */
export function imageHref(value: string): string | null {
  if (value === '') return null
  const https = httpsHref(value)
  if (https !== null) return isLocalOrIpHost(new URL(https).hostname) ? null : https
  let url: URL
  let base: URL
  try {
    base = new URL(document.baseURI)
    url = new URL(value, base)
  } catch {
    return null
  }
  if (url.username !== '' || url.password !== '') return null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.origin === 'null' || url.origin !== base.origin) return null
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
