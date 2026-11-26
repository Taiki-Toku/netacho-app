# 依頼 13-1:バックナンバーと公開日(フロントの例外②③。K-013・K-048。詳細設計 5.4)

## 目的
詳細設計 5.4(netacho-infra の docs/03_詳細設計書.md v0.7、2026-11-25)を作る。本文は末尾の付録に写した。見た目の正本は netacho-app の docs/design_spec.md(v3.9。12-5 で入る)の 3-1・4-1・4-2・4-5・4-6・4-8。付録や design_spec と食い違う作り方が必要になったら、作らずに止まって報告する。12-5 がマージされた後に流す。

## 変えるファイル(目安。要るものだけ)
- データ:`src/data/types.ts`(Item に publishedAt)、`src/data/parse.ts`、`src/data/itemRow.ts`(ITEM_COLUMNS に published_at)、`src/data/queries.ts`(配信日の一覧、その日の並び、archive の前後)、`src/lib/format.ts`(日付だけの値の整形)
- 道:`src/app/router.ts`(archive の Route、ItemFrom に archive)
- 画面:`src/screens/ArchiveScreen.tsx`(新規)と CSS モジュール、`src/screens/ItemScreen.tsx`・`HomeScreen.tsx`・`SavedScreen.tsx`・`GenreScreen.tsx`・`SearchScreen.tsx`、`src/components/ArticleRow.tsx`・`Sidebar.tsx`、画面の切り替え(App.tsx など、archive を足す所)
- 試験:上の既存の試験に足す。新しい画面の試験
- この依頼文 `docs/requests/13-1_archive-published.md`
- 変えないもの:`public/_headers`、`vite.config.ts`、`package.json`、`supabase/`、`sync/`、下のメニュー(MobileNav)、`src/styles/tokens.css`(新しいトークンは足さない)。既存の試験の期待値は変えない(足すだけ)

## 作り方の決まり
- 公開日は日付だけの文字列として扱い、Date に変えない(前後の日にずれないため)
- URL の日付は `^\d{4}-\d{2}-\d{2}$` の形で、実在する日付だけを通す。違えば空の状態か from なし
- 外のデータは React の標準の描画だけで出す。リンクは今の safeUrl の決まりのまま
- 色・大きさ・余白はトークンだけ。直接の値を書かない

## 試験
付録 5.4.5 の TST-PUB-01・02、TST-ARC-01〜06(名前に ID を入れる)。TST-ARC-07 は Claude とオーナーが本番で確かめる。

## 確かめること
1. `npm run lint`
2. `npm test -- --run`
3. `npm run build`
4. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが要るファイルだけであること
5. Supabase の問い合わせの列を変えるので、pr-reviewer にレビューさせる。重大は直して再レビュー、中は直すか理由を報告に書く
6. 見た目が変わるので、design-check でバックナンバーの画面・公開日の表示・入口の3か所を点検する

## 報告
- 変えた所ごとに、何をしているかと、なぜ安全か(CLAUDE.md の説明のルール)
- 試験の結果、pr-reviewer・design-check の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の配信のデータでの日付の一覧、iPhone での前後と戻り)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「バックナンバーと公開日の表示(K-013・K-048 の②③、依頼 13-1)」

## 付録:詳細設計 5.4
### 5.4 バックナンバーと公開日(②③の公開日。REQ-F-03・F-05、基本設計 8.3、K-013・K-048。v0.7 2026-11-25)
今の状態(2026-11-25、netacho-app の main d2866cb で確認):items には published_at(date)の列が 0001 からあり、同期は配信データの publishedAt をその列に書いている(詳細設計 2章の項目の表)。画面は ITEM_COLUMNS に published_at を入れておらず、Item 型にも公開日が無い。バックナンバーの画面と URL は無い。見た目は design_spec v3.9(drafts/design/design_spec_v3.9.md。12-5 で netacho-app に入る)の 3-1・4-1・4-2・4-5・4-6・4-8 に従う。

#### 5.4.1 公開日(③)
- ITEM_COLUMNS に `published_at` を足す。Item に `publishedAt: string` を足す(`YYYY-MM-DD`、無ければ空の文字列)。parseItem は空か `YYYY-MM-DD` の形だけを通し、それ以外は空にする(行は捨てない。公開日はおまけの情報のため)。見本・local-data の JSON の publishedAt も同じ規則で読む
- 日付だけの値なので、Date に変えずに文字列から月と日を取り出して出す(タイムゾーンで前後の日にずれないため。v3.9 の 3-1)
- 文言:`公開 11月17日`。空なら `公開日不明`。配信日(items.date)とは別の値で、取得日・配信日で代わりにしない
- 出す場所:ニュース一覧の行(トップ・ジャンル・保存・さがす・バックナンバー)の出典と同じメタ情報の並び、詳細の見出しの下の出典と並ぶ行
- 新しいトークンは使わない(メタ情報の既存の色・大きさ)

#### 5.4.2 バックナンバーの画面(②)
- URL:`#/archive`(日付なし)と `#/archive/YYYY-MM-DD`。日付なしのときは、今日(日本時間)より前で記事がある最も新しい配信日の URL に置き換える(履歴に残さない置き換え)。その日が無ければ空の状態
- 対象:読み込んだ items(最大 1,000 件。基本設計 8.3)の配信日(items.date)。公開日では分けない(2026-11-25 オーナー決定)
- 画面の作り:ページ見出し「バックナンバー」(h1)→ 日付の選び方 → その日のニュースの一覧
  - 日付の選び方:「前の日」「次の日」(記事がある日だけを辿る。端では押せない文字)と、記事がある日の一覧から選ぶ select(新しい順。`2026年11月24日(火)` の形。Intl.DateTimeFormat('ja-JP')、日付の文字列から作る)。選ぶと URL を `#/archive/<日付>` にする(履歴に残す)
  - 一覧:その日のニュースを sort_order の順に、トップのニュース一覧と同じ番号つきの行で出す(題・リード・出典・公開日・ジャンル名)
  - 空の状態:URL の日付に記事が無い・形が違う日付 →「この日のニュースはありません」と、記事がある最も新しい日へのリンク
  - 読み込み中・通信エラーは、今の画面と同じ部品(LoadingState・ErrorState)
- 公式のお知らせと脆弱性は出さない(v3.9 の 4-8)

#### 5.4.3 入口と戻り先
- PC の左メニュー:LIBRARY に「バックナンバー」を足す(保存の下)。下のメニュー(スマホ)は変えない
- トップ:日付の導線(v3.9 の 4-1)。トップの大きな枠の上に、今日の日付の文字と「バックナンバー」へのリンクを1行で置く(上のバーの日付とは別。押せる範囲は 44px 以上)
- 保存の画面:一覧の下に「バックナンバー」へのリンク(スマホの入口を兼ねる)
- 詳細の戻り先と前後:バックナンバーから開いたときは `#/item/<id>?from=archive:YYYY-MM-DD`。router の ItemFrom に `{ kind: 'archive'; date: string }` を足す(日付の形が違えば from なし)。前後はその日の一覧の並び、「一覧に戻る」は `#/archive/<日付>`

#### 5.4.4 変えないもの
- 下のメニューの4つ、ほかの画面の並びと見た目、CSP、Supabase の問い合わせの件数と並び(items は今のまま date の新しい順・最大 1,000 件)、同期のコード(sync/)

#### 5.4.5 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-PUB-01 | published_at が `YYYY-MM-DD` なら publishedAt になり、null・空・形の違う値は空(行は捨てない)。ITEM_COLUMNS に published_at がある | vitest(itemRow・parse) |
| TST-PUB-02 | 一覧の行と詳細に `公開 11月17日`、空なら `公開日不明`。日付だけの値がタイムゾーンでずれない(UTC の前後の時刻で試す) | vitest(画面・format) |
| TST-ARC-01 | `#/archive` は今日より前で記事がある最も新しい日に置き換わる。`#/archive/<日付>` の読み書き。形の違う日付 | vitest(router・画面) |
| TST-ARC-02 | その日のニュースが sort_order の順に、番号つきで出る。今日の分・公式フィードは出ない | vitest(画面・queries) |
| TST-ARC-03 | 前の日・次の日が記事のある日だけを辿り、端では押せない。select で選ぶと URL が変わる | vitest(画面) |
| TST-ARC-04 | 記事の無い日は「この日のニュースはありません」とリンク | vitest(画面) |
| TST-ARC-05 | 詳細の from=archive の前後と「一覧に戻る」。形の違う from は無視 | vitest(router・ItemScreen) |
| TST-ARC-06 | 入口:左メニューの LIBRARY、トップの日付の導線、保存の画面のリンク。下のメニューは4つのまま | vitest(画面) |
| TST-ARC-07 | 本番:iPhone でトップと保存から入れて、前後と戻りが動く。CSP の違反 0 件 | Claude が内蔵ブラウザで、iPhone はオーナー |

#### 5.4.6 依頼
- 依頼 13-1(netacho-app の docs/requests/13-1_archive-published.md)1本。見た目が変わるので design-check、Supabase の問い合わせの列を変えるので pr-reviewer を付ける
- 12-5(v3.9 を netacho-app に入れる)の後に流す(design_spec を先に入れるため)
