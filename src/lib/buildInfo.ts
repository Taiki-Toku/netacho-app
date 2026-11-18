// 版の表示(設定の画面の ABOUT)。vite.config.ts がビルドのときに呼び、結果を __APP_COMMIT__ として埋め込む。

/**
 * 配信のときのコミット(Cloudflare Pages の CF_PAGES_COMMIT_SHA)の先頭7文字。
 * コミットの形(16進の 7〜64 文字)でないもの・無いものは local(手元のビルド)
 */
export function shortCommit(sha: unknown): string {
  return typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : 'local'
}
