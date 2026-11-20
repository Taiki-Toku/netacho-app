# 依頼 11-1:DB の画像の URL を画面に渡し、IP アドレスと localhost の画像を出さない(K-042・K-056)

## 目的
詳細設計 5.1(netacho-infra の docs/03_詳細設計書.md、2026-11-20)。フロントの例外③のうち画像だけを作る(K-048)。
画面の部品(Thumb・useThumb・imageHref)はできている。足りないのは次の2つだけ。
1. Supabase の items の image_url を画面の imageUrl に渡す処理
2. imageHref が、https なら IP アドレスや localhost の画像も通してしまう(K-056)

## 変えるファイル
- `src/data/itemRow.ts`、`src/lib/safeUrl.ts`
- 試験:`src/data/itemRow.test.ts`、`src/data/supabaseBackend.test.ts`、`src/lib/safeUrl.test.ts`、画面の試験(`src/screens/` のどれか1つ)
- この依頼文 `docs/requests/11-1_image-display.md`
- ほかのファイル(Thumb、CSS、_headers、マイグレーション、package.json)は変えない。既存の試験の期待値は変えない(足すだけ)

## 直すこと
### 1. 受け渡し(src/data/itemRow.ts)
- `ITEM_COLUMNS` の末尾に `image_url` を足す(authenticated は items 全体に select の権限があるので、権限の変更は要らない)
- `rowToJson` に `imageUrl: r.image_url ?? ''` を足し、短いコメントで「null は空文字 → parseItem で項目なし。URL の検査は表示の直前の imageHref」と書く

### 2. 表示の条件(src/lib/safeUrl.ts の imageHref)
- 外部の https の URL(httpsHref が null でないとき)について、`new URL` が正規化した後の hostname を、末尾の `.` を1つ除いて小文字にし、次に当たれば null を返す
  - IPv4:`/^\d+\.\d+\.\d+\.\d+$/`(`2130706433`・`0x7f.1`・`127.1` は new URL が `127.0.0.1` に直すので、これで捕まる)
  - IPv6:`[` で始まる
  - `localhost` と、`.localhost` で終わるもの
- 判定は小さな関数(例:`isLocalOrIpHost(hostname: string): boolean`)に分け、コメントに理由を書く:og:image に IP アドレスが入ることはまず無く、プライベートの範囲の表を持つより漏れが少ない。DNS 名の先がプライベートの宛先の場合はブラウザでは判定できない(詳細設計 5.1.2)
- `httpsHref`(リンク)は変えない。同じオリジンの相対パス(fixtures/images/)の扱いも変えない
- 関数の先頭のコメントに、この条件を足す

## 試験(足す)
| ID | 内容 | 置き場 |
|---|---|---|
| TST-IMG-01 | 行の image_url が値なら imageUrl になり、null・空文字なら imageUrl の項目が無い | itemRow.test.ts |
| TST-IMG-02 | items の問い合わせの select に渡す列に image_url が入っている(ITEM_COLUMNS を見るか、既存の差し替えの仕組みで select の引数を見る) | supabaseBackend.test.ts か itemRow.test.ts |
| TST-IMG-03 | imageHref が null:`https://127.0.0.1/a.png`、`https://10.0.0.1/a.png`、`https://192.168.1.1/a.png`、`https://2130706433/a.png`、`https://0x7f.1/a.png`、`https://127.1/a.png`、`https://[::1]/a.png`、`https://[::ffff:10.0.0.1]/a.png`、`https://localhost/a.png`、`https://LOCALHOST./a.png`、`https://a.localhost/a.png` | safeUrl.test.ts |
| TST-IMG-04 | imageHref が通す:`https://example.com/a.png`、`https://localhost.example.com/a.png`、見本の `fixtures/images/desk.svg`。httpsHref は `https://127.0.0.1/` を今までどおり通す | safeUrl.test.ts |
| TST-IMG-05 | 既存の画面の試験(危ない URL・読み込みの失敗で画像の場所を取らない)がそのまま通る | 既存 |
| TST-IMG-06 | image_url の入った DB の行の形の見本を rowsToItems に通して画面に渡すと、img の src がその URL、referrerpolicy が no-referrer。image_url が `https://127.0.0.1/a.png` の行は img が出ない | 画面の試験1つ |

試験の名前に TST-IMG-xx を入れる。

## 確かめること
1. `npm run lint`
2. `npm test -- --run`
3. `npm run build`
4. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
5. Supabase の問い合わせと外部の URL の表示に触れるので、pr-reviewer にレビューさせる。重大は直して再レビュー、中は直すか理由を報告に書く
6. 見た目は変わらないので design-check は要らない

## 報告
- 変えた行ごとに、何をしているかと、なぜ安全か(CLAUDE.md の説明のルール)
- 試験の結果、pr-reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の DB に image_url が入った行での確認は K-051 の最初の同期の後、DNS 名の先のプライベートの宛先は判定できない)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く(何をしたか/なぜ/危ない点/試験とレビューの結果/テストが保証していないこと)。題は「DB の画像の URL を画面に渡し IP アドレスと localhost の画像を出さない(K-042・K-056、依頼 11-1)」
