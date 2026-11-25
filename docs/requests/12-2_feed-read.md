# 依頼 12-2:公式フィードを Supabase から読む(フロントの例外④。K-040・K-048)

## 目的
詳細設計 5.2(netacho-infra の docs/03_詳細設計書.md v0.5、2026-11-20)を作る。本文は末尾の「付録:詳細設計 5.2」に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。
今は Supabase モードで `supabaseData(items)`(src/data/source.ts)が feed を空にしている。feed_entries を読んで画面に渡す。見た目は変えない(文言1か所と、失敗のときの1行だけ)。

## 変えるファイル
- 足す:`src/data/feedRow.ts`、`src/data/feedRow.test.ts`
- 変える:`src/data/backend.ts`(Backend に loadFeed)、`src/data/supabaseBackend.ts`、`src/data/source.ts`(LoadedData に feedError、supabaseData の引数)、`src/App.tsx`(load をネタと公式フィードの2つにする)、`src/data/labels.ts`(SEVERITY_LABELS の '' を「未評価」)、`src/screens/FeedScreen.tsx`・`src/screens/VulnScreen.tsx`(feedError の1行)
- 試験:上のファイルの既存の試験に足す。Backend のモックを使う既存の試験は、loadFeed を足す分だけ直してよい。「不明」を期待している既存の試験は「未評価」に変えてよい(この2つのほかは、既存の試験の期待値を変えない)
- この依頼文 `docs/requests/12-2_feed-read.md`
- 変えないもの:CSS とデザイントークン、`public/_headers`、`vite.config.ts`、`package.json`、`supabase/`、`sync/`、fixtures

## 作り方の決まり
- 問い合わせは supabaseBackend.ts の中だけ(クライアントはここ1か所)。列は付録 5.2.1 の FEED_COLUMNS だけ。select('*') にしない
- 90 日前の時刻は、呼ぶときの時刻から作る(試験では時刻を差し替えられる形にする)
- 行の中身は信用しないデータとして扱い、検査は今の parseFeedEntry に任せる。表示は React の標準の描画だけ
- エラーの文言は safeErrorCode の code だけを添える(サーバーの文言を出さない)
- feedError の1行は、既存の caption のクラスと role="status" を使う。新しい色・余白の値を書かない

## 試験
付録 5.2.5 の TST-FEEDUI-01〜06(名前に ID を入れる)。07 は Claude が Preview と本番で確かめる。

## 確かめること
1. `npm run lint`
2. `npm test -- --run`
3. `npm run build`
4. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
5. Supabase の問い合わせに触れるので、pr-reviewer にレビューさせる。重大は直して再レビュー、中は直すか理由を報告に書く
6. design-check で、失敗の1行(公式のお知らせと脆弱性の画面)だけを点検する

## 報告
- 変えた行ごとに、何をしているかと、なぜ安全か(CLAUDE.md の説明のルール)
- 試験の結果、pr-reviewer・design-check の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の feed_entries の行での表示は、依頼 12-1 と本番の初回の取得の後/PostgREST が numeric をどちらの型で返すか)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く(何をしたか/なぜ/危ない点/試験とレビューの結果/テストが保証していないこと)。題は「公式フィードを Supabase から読む(K-040・K-048 の④、依頼 12-2)」

## 付録:詳細設計 5.2
### 5.2 公式フィードを Supabase から読む(④。REQ-F-13〜15・REQ-S-02、基本設計 4.8・8.3)
今の状態(2026-11-20、netacho-app の main で確認):Supabase モードでは `supabaseData(items)`(src/data/source.ts)が feed を空の配列にしている。画面(公式のお知らせ・脆弱性・トップの右の欄・さがす)は data.feed を使う作りができている。見た目は変えない。

#### 5.2.1 読み込み(src/data/backend.ts・supabaseBackend.ts・新しい feedRow.ts)
- Backend に `loadFeed(): Promise<FeedEntry[]>` を足す。問い合わせ:`feed_entries` から FEED_COLUMNS を、`sort_at` が今から 90 日前以後、`sort_at` の新しい順、最大 1,000 件
- FEED_COLUMNS:`id,kind,vendor,product,title,url,sort_at,severity,cvss,cve_ids,status`。summary と訳の列はまだ読まない(画面で使わない。訳の表示①のときに足す)
- 行の変換(feedRow.ts。itemRow.ts と同じ作り。値の検査は parseFeedEntry に任せる)
  - publishedAt ← sort_at(公開日、無ければ最初に取った時刻。並びと同じ値)
  - url ← url ?? ''(空ならリンクを出さない。今の画面の扱い)
  - severity ← severity ?? ''(空は「未評価」)
  - cve ← cve_ids の最初の値、無ければ ''。2つ目以降は今の画面には出さない(型が1つの CVE のため。フェーズ2で見直す)
  - cvss ← 数値ならそのまま、文字列なら Number に直す(PostgREST が numeric を文字列で返す場合に備える)。範囲の検査は parseFeedEntry(asCvss)
  - status ← status
- 権限の変更は要らない(authenticated は feed_entries の select だけ。is_app_user() の行だけ見える。0002)

#### 5.2.2 失敗のとき(基本設計 4.8「見本に切り替えない」)
- App の load を、ネタと公式フィードを並べて読む形にする。ネタの失敗は今までどおり画面全体のエラー。**公式フィードだけの失敗は、feed を空にして続ける**(ネタは読める)
- LoadedData に `feedError: string | null` を足す。失敗したら「公式フィードを読み込めませんでした」(エラーの code があれば括弧で添える。safeErrorCode。サーバーの文言は出さない)
- 公式のお知らせと脆弱性の画面は、feedError があるとき、説明の行の下に1行でその文を出す(role="status"。既存の caption のスタイル。新しい色・値は使わない)。local・fixtures のモードでは常に null

#### 5.2.3 文言
- SEVERITY_LABELS の '' を「不明」から「未評価」に変える(基本設計 4.5・4.8。KEV だけにあり深刻度の無いもの)

#### 5.2.4 変えないもの
- 見本(fixtures)と local-data の読み方、画面の見た目、CSP(connect-src は Supabase の URL のまま)、さがすの対象(読み込んだ分を探す)

#### 5.2.5 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-FEEDUI-01 | 行が 5.2.1 のとおりに FeedEntry になる(sort_at → publishedAt、null の url・severity は空、cve_ids の最初、cvss の数値・文字列・範囲外) | vitest(feedRow) |
| TST-FEEDUI-02 | 問い合わせの表・列・90 日の条件・並び・1,000 件 | vitest(supabaseBackend。問い合わせを差し替える) |
| TST-FEEDUI-03 | 公式フィードだけ失敗:ネタは出て、公式のお知らせ・脆弱性の画面に失敗の1行が出る。見本のフィードは出ない | vitest(画面) |
| TST-FEEDUI-04 | ネタが失敗:今までどおり画面全体のエラー | vitest(画面。既存) |
| TST-FEEDUI-05 | severity が空の脆弱性は「未評価」 | vitest(画面) |
| TST-FEEDUI-06 | 形の崩れた行(id が無い、kind が違う、日時が読めない)は捨て、ほかは出る | vitest(feedRow) |
| TST-FEEDUI-07 | Preview と本番で CSP の違反 0 件、feed_entries の問い合わせが 200 | Claude が内蔵ブラウザで(本物の行は TST-FEED-20 の後) |

#### 5.2.6 依頼と確認
- 依頼 A2 は1本(netacho-app の docs/requests/12-2_feed-read.md)。Supabase の問い合わせに触れるので pr-reviewer を付ける。文言の1か所と失敗の1行のほかは見た目を変えないので、design-check は失敗の1行の表示だけで行う
- A1 と A2 は別の部品なので、どちらを先にマージしてもよい。本物の行が画面に出ることの確認は、両方と TST-FEED-20 の後
