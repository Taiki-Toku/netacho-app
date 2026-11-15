# ADR-002 画面の切り替え・状態の持ち方・スタイルの方式

- 日付:2026-11-15
- 状態:採用(ベータ版)

## 背景
6つの画面(今日・詳細・ジャンルのタブ・バックナンバー・探す・設定)を、依存パッケージを増やさず、iPhone の片手操作と PC の両方で動かす。
データは1か所で読み、あとで Supabase に差し替える(依頼書 2.1)。

## 決定

| 項目 | 決定 | 理由と代わりの案 |
|---|---|---|
| 画面の切り替え | URL のハッシュ(`#/today`、`#/item/<id>`、`#/archive/<date>`、`#/search`、`#/settings`)を自前の小さなルーター(`src/app/router.ts`)で読む | react-router を入れずに済む(依存は最小限)。ハッシュなら Cloudflare Pages でもサーバー側の設定が要らない。画面とタブの状態が URL に残り、戻る・再訪ができる。本番で Supabase の認証リダイレクトと衝突するなら、そのとき履歴 API 方式に見直す |
| データの持ち方 | `loadData()`(`src/data/source.ts`)が起動時に1回読み、`DataProvider`(React の Context)で全画面に配る。画面は純粋な関数(`src/data/queries.ts`)で必要な形に取り出す | 状態管理ライブラリは入れない。読み書きが増える本番で足りなくなったら見直す |
| 外から来たデータ | `parseItems()` が JSON を Item の形に整え、型の合わない項目は空にする。文字列の中身は解釈しない | 表示側は React の標準の描画だけを使う(規約)。入口でも形を保証し、画面のコードが未定義や null を気にしないようにする |
| スタイル | CSS Modules + デザイントークン(`src/styles/tokens.css`)。値はトークンだけを使う | 依頼書と CLAUDE.md の決まり。あとで厳しい CSP を入れるため、インラインの style は使わない |
| テーマ | `<html data-theme="dark|light|system">`。既定は dark(2026-11-15 の承認:ダークを主)。`system` のときだけ `prefers-color-scheme` を見る | 設定画面(進め方 6)で切り替えて保存する。トークンの定義は `tokens.css` の1か所 |
| 本物のデータの扱い | `local-data/items.json` は import せず、実行時に fetch する。ビルド後に `scripts/check-dist-clean.mjs` が dist に本物の文章が無いことを確かめる(`npm run build` に含む) | import すると Vite が dist に取り込んでしまう。fetch なら dist には入らず、開発サーバーだけが配る |
