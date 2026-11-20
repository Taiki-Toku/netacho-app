// Cloudflare Pages に読ませる dist/_headers の中身を作る(要件 REQ-S-03)。
// vite.config.ts のビルド用プラグインから呼ぶ。ビルドの中で動くので、node の API は使わない。

// Supabase の URL として許す形。プロジェクトの識別子(英小文字と数字)だけを受け付け、
// パス・ポート・空白・改行・セミコロンなど、ヘッダーや CSP を書き換えうる文字を通さない
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9]+\.supabase\.co$/

// Cloudflare Pages の _headers は、1行 2,000 文字までしか読まない
const MAX_LINE_LENGTH = 2000

export function securityHeaders(supabaseUrl: string | undefined): string {
  const url = supabaseUrl?.trim() ?? ''
  if (url !== '' && !SUPABASE_URL_PATTERN.test(url)) {
    // 値そのものはメッセージに入れない(ビルドのログに残さないため)
    throw new Error('VITE_SUPABASE_URL の形が違います(https://<英小文字と数字>.supabase.co)')
  }
  const connectSrc = url === '' ? "connect-src 'self'" : `connect-src 'self' ${url}`

  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https:",
    "font-src 'self'",
    connectSrc,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

  const lines = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  X-Robots-Tag: noindex',
  ]
  for (const line of lines) {
    if (line.length > MAX_LINE_LENGTH) {
      throw new Error(`_headers の行が ${MAX_LINE_LENGTH} 文字を超えています`)
    }
  }
  return `${lines.join('\n')}\n`
}
