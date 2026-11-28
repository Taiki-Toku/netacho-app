# 依頼 15-1:記事の詳細の整理・引っぱって更新の形・戻る位置・ジャンルの画像(K-072・K-071・4-4。詳細設計 5.7、REQ-F-02・F-03・F-07・F-09・F-17)

## 目的
詳細設計 5.7(netacho-infra の docs/03_詳細設計書.md v0.13、2026-11-28)を作る。本文は末尾の付録に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 変える:`src/screens/ItemScreen.tsx`・`.module.css`(扱い・取り組み・評価・メモを消す)、`src/components/ArticleRow.tsx`(評価済みを消す)、`src/data/queries.ts`(isRated を消す、検索から projects を外す)、`src/data/userStore.ts`(setRating・setMemo を消す。countUserData は保存と「前の版の評価・メモ」の件数に)、`src/data/labels.ts`(使わなくなる RATING_*・STATUS_LABELS など)、`src/screens/SettingsScreen.tsx`(件数の行と確認文)、`src/lib/usePullToRefresh.ts`・`src/components/PullIndicator.tsx`・`.module.css`(iOS の形)、`src/App.tsx`・`App.module.css`(`.pullArea` の枠、戻る位置)、`src/components/Thumb.tsx`・`HomeScreen.tsx`・`ItemScreen.tsx`(ジャンルの画像)、`src/styles/tokens.css`(`--duration-spin: 800ms` だけ足す)、`docs/design_spec.md`(下の「design_spec の直し」)
- 足す:`src/data/genreImages.ts`(表は空でよい。画像のファイルは設計のチャットが後で同じブランチに足す)、戻る位置のフック(例 `src/lib/useScrollMemory.ts`)、それぞれの試験、`docs/credits.md`(見出しと「ジャンルの画像の出典」の空の表だけ)
- この依頼文 `docs/requests/15-1_screen-tidy.md`
- 変えないもの:`src/data/supabaseBackend.ts` と問い合わせ、`public/_headers`・`src/lib/securityHeaders.ts`、`sync/`、`supabase/`、`.github/`、依存パッケージ、`public/icons/`・`public/logo/`
- 期待値を変えてよい既存の試験:ItemScreen(評価・メモ・扱い・取り組み)、ArticleRow を使う画面の「評価済み」、SettingsScreen(件数・確認文)、userStore(setRating・setMemo)、queries(isRated・projects の検索)、labels、PullIndicator と usePullToRefresh(TST-RF-03・04 を TST-PTR に置き換え。文言・最大 80px・成功のトースト)、App(画面が変わったら先頭、の試験を TST-BACK-01 に合わせる)。ほかの期待値は変えない

## 作り方の決まり
- 新しいパッケージを入れない。足してよいトークンは `--duration-spin` だけ
- 文字は React の標準の描画だけ。印の SVG も JSX で描く
- transform は `.pullArea` に、引っぱり中と更新中だけ付ける(付けない間は transform のプロパティ自体を無しに)
- touchmove の登録・解除は今のまま(`passive: false`、外すときに解除)
- 端末の nodal-user の feedback は読み込み・書き戻しの形を変えない(消すのは「すべて削除」だけ)
- ジャンルの画像のパスは表(genreImages.ts)からだけ作る。データの値をパスにつながない

## design_spec の直し(v3.10 の続き。版の行に「v3.10(依頼15-1):詳細の評価・メモ・扱い・取り組みを外す、引っぱって更新を iOS の形に、ジャンルの画像」を足す)
- 4-5 の1行目:「評価4つ、メモ、」を消す
- 設定の THIS DEVICE / 02:件数は「保存」だけ。前の版の評価・メモが残っているときだけ「前の版の評価・メモ n件(画面では使っていません)」の行。確認文は「この端末の NODAL のデータ(保存と、前の版の評価・メモ)をすべて削除します。元に戻せません。」
- 7章の「メモは自動保存し、「メモを保存しました」と出す。」を消す。8章の「メモ欄の右下のつまみや」を消す
- 1章の動きのトークンに `--duration-spin: 800ms`(引っぱって更新の印の1周)
- 5章のジャンルの画像の行:「8ジャンル(アイデアラボを含む)に1枚ずつ。`public/genres/<id>.jpg`、1560×920px、300KB 以下。トップの枠と詳細で、元記事の画像が無い・読めないときに出し、右下に札「イメージ」。出典は docs/credits.md」に置き換える
- 8-1 を付録 5.7.2 の内容で書き直す(帯と文言の記述を消す)

## 試験
付録 5.7.7 の TST-DETAIL-01〜04・TST-PTR-01〜05・TST-BACK-01・TST-GIMG-01〜02・TST-ICON-01(名前に ID を入れる)。TST-GIMG-01 は試験の中で表を差し替えて確かめる。TST-SCREEN-01 はオーナーと Claude が本番で行う。

## 確かめること
1. `npm run lint`、`npm test -- --run`、`npm run build`
2. 見た目が変わるので design-check で点検する(詳細、設定、引っぱって更新の印と画面の動き、狭い画面 375px)
3. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、reviewer に見せる。変わったのが上のファイルだけであること

## 報告
- 部品ごとに、構造、データの流れ、試験で確かめた内容
- 試験・design-check・reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:iPhone で画面全体が指に付いて動くか、iPhone の弾みと重ならないか、position: fixed の部品が引っぱり中にずれないか、ホーム画面のアプリで左端からのスワイプの戻るが動くか。TST-SCREEN-01)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「記事の詳細の整理・引っぱって更新の形・戻る位置・ジャンルの画像(K-072・K-071・4-4、依頼 15-1)」

## 付録:詳細設計 5.7

### 5.7 記事の詳細の整理・引っぱって更新の形・画面の小物(K-072・K-071・4-4。REQ-F-03・F-07・F-17、基本設計 8.3、K-048 の例外8。v0.13 2026-11-28)
今の状態(2026-11-28、netacho-app の main 6edbe27 で確認):詳細(ItemScreen.tsx)に「扱い」「取り組み」の行、評価4つ、メモの欄がある。一覧の行(ArticleRow.tsx)はネタの rating に値があると「評価済み」を出す(Supabase から読むときは rating を空にしているので本番では出ない)。設定は保存・評価・メモの件数を出す。引っぱって更新(5.5.2)は上のバーを止めたまま、その下に文字の帯を出す。画面の種類が変わると必ず先頭へスクロールする(App.tsx)。ジャンルの画像を出すコードは無い。アイコン・ロゴは仮の画像。
方針は 2026-11-28 にオーナーと選択式で決めた(動きを減らす設定は印だけ、成功のトーストは出さない、4-4 は ①③④、「このニュースについて」の残りの欄は全部残す)。

#### 5.7.1 記事の詳細から外す(K-072)
- 詳細:「このニュースについて」の「扱い」「取り組み」の行、「このニュース、どうでしたか」(評価4つ)、「メモ」の欄と「メモを保存しました」を消す。残す:コーナー・情報の確かさ・カテゴリ・タグ・星3つ(星は REQ-F-03)
- 一覧の行の「評価済み」を消し、queries.ts の isRated を消す(使う所が無くなる)
- 設定「この端末のデータ」:行は「保存」と「ニュースの読み込み元」。前の版で付けた評価・メモが端末に残っているときだけ「前の版の評価・メモ n件(画面では使っていません)」を1行出す(メモには会社の情報が入りうるため、残っていることが見えて消せるように。REQ-F-17)。削除の確認文は「この端末の NODAL のデータ(保存と、前の版の評価・メモ)をすべて削除します。元に戻せません。」
- さがす:projects を検索の対象から外す(画面に出ない語で当たらないように)
- 消さないもの:端末の nodal-user の feedback(読み込み・書き戻しの形はそのまま。保存の付け外しで一緒に書き戻され、消えない)、データの projects・status・rating・memo と型・parse
- 消すもの:userStore の setRating・setMemo、labels.ts の RATING_*・STATUS_LABELS など、使う所が無くなるもの
- design_spec:4章の詳細・設定、7章のメモ、8章のメモ欄の記述を直す(v3.10)

#### 5.7.2 引っぱって更新を iOS の形に(K-071。5.5.2 の表示を置き換え)
- 始め方は 5.5.2 のまま(タッチだけ、scrollY が 0、最初の約 10px で縦横、入力欄の中は除く、引っぱり中だけ touchmove を止める、PC は変えない)
- 動く範囲:上のバー・ジャンルのタブ・本文を、App の新しい枠 `.pullArea` ごと指に付けて下げる(`transform: translateY(var(--pull-y))`)。下のメニュー・「先頭へ戻る」・トーストは `.pullArea` の外に置き、動かさない。transform は引っぱり中と更新中だけ付ける(付けたままにすると、中の position: fixed の部品(読了バー)の基準が変わるため)
- 重さ:表示の量 = R ×(1 − 1 /(1 + 引いた量 / R))、R = 200px
- 印:空いた上の所(地は `--bg`)の中央に、iOS と同じ形の回る印(8本の線。色 `--muted`、大きさ `--sp-7`)。引くにつれて線が1本ずつ現れ、表示の量 64px で8本そろう(離すと更新)。文字は出さない
- 離したとき:表示の量 64px 以上なら `refresh`。印は8段で回り(1周 `--duration-spin`。新しいトークン 800ms)、画面は `--sp-13` の高さで止まる。終わったら `--duration`/`--ease` で戻る。64px 未満は戻すだけ
- 知らせ:成功は何も出さない(トースト「最新に更新しました」をやめる)。失敗は今のまま「最新に更新できませんでした」(DataProvider)
- 読み上げ:見えない文字(visually-hidden、aria-live="polite")で、8本そろったら「離すと更新」、更新中「更新しています」、終わったら空。印は aria-hidden
- 動きを減らす設定:画面は動かさない(`--pull-y` を付けない)。上のバーのすぐ下に回らない印を出す(線は引いた量に合わせて現れ、更新中は8本のまま止める)
- 印は SVG を JSX で描く(線の位置は計算。HTML の文字列は使わない)。色・大きさ・時間はトークン

#### 5.7.3 戻ったら元の位置へ(4-4 の①)
- 一覧の画面(トップ・ジャンル・保存・バックナンバー・さがす・公式情報・脆弱性の一覧)は、離れるときのスクロールの位置を、URL のハッシュ全体ごとに覚える(メモリだけ。最大 50 件、古いものから捨てる)。覚えるのは hashchange のとき(oldURL のハッシュに、その時点の scrollY)
- その一覧にまた来たら(ブラウザの戻る・左端からのスワイプ・「一覧に戻る」のリンクのどれでも)、描画の後に覚えた位置へ移す。覚えていなければ先頭。詳細・設定は今までどおり先頭
- 絞り込みの変更(replaceRoute)では今までどおり動かさない
- `history.scrollRestoration = 'manual'`(ブラウザの自動の戻しと二重にしない)
- データの読み込み中は移さず、読めた後に移す。ページが短くなっていたら届く所まで

#### 5.7.4 ジャンルの画像(4-4 の④。5.1.3、design_spec 5章、B-13)
- 置き場所:`public/genres/<ジャンルの id>.jpg`(work・agent・local-llm・security-news・product・creative・tools・idea の8枚)。1560×920px(画像の枠 780×460 の2倍)、1枚 300KB 以下。写真は Unsplash から Claude が選ぶ(2026-11-28 オーナーが一任)。出典(写真の URL・撮影者)は netacho-app の docs/credits.md
- 使う所:トップの大きな枠と詳細だけ。元記事の画像が無い・危ない・読み込みに失敗したときに、そのジャンルの画像。ジャンルの画像も失敗したら今のとおり場所を取らず札。一覧・バックナンバーの行は変えない
- id → パスの表(src/data/genreImages.ts)を持ち、ファイルがあるジャンルだけ載せる。表に無いジャンル・ジャンルが null のときは今のまま
- 色調は記事の画像と同じ filter。alt=""。ジャンルの画像のときは画像の右下に札「イメージ」を出す(元記事の写真と取り違えないため)
- CSP は変えない(同じオリジンの画像は今の img-src で通る)

#### 5.7.5 アイコンとロゴ(4-4 の③)
- 正式な元画像ができたら、public/icons/ の PNG 4つ(180・192・512・512-maskable。maskable は大事な部分を中央の 80% に収める)、public/logo/ の SVG 4つ、favicon.svg を入れ替える。ファイル名と manifest は変えない
- 元画像はまだ無い(2026-11-28)。依頼 15-1 では TST-ICON-01(今のファイルの検査)だけを入れ、入れ替えは元画像が来たときに Claude が行う
- 入れ替えの後、iPhone はホーム画面のアイコンを置き直さないと変わらないことがある【推測】

#### 5.7.6 変えないもの
- Supabase の問い合わせ、_headers・CSP、sync/、保存の動き、詳細の左右のスワイプ、開き直しの読み直し(5.5.1)

#### 5.7.7 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-DETAIL-01 | 詳細に扱い・取り組み・評価・メモが無い。コーナー・情報の確かさ・カテゴリ・タグ・星は出る | vitest(ItemScreen) |
| TST-DETAIL-02 | 一覧の行に「評価済み」が出ない(rating に値がある見本でも) | vitest(ArticleRow・HomeScreen) |
| TST-DETAIL-03 | 設定の件数は保存だけ。前の版の評価・メモがあるときだけその行が出て、削除で消える。保存の付け外しの後も feedback が端末に残る | vitest(SettingsScreen・userStore) |
| TST-DETAIL-04 | projects にだけある語で、さがすに当たらない | vitest(queries) |
| TST-PTR-01 | 重さの式。表示の量 64px で更新できる状態になる。未満・一番上でない・横向きでは呼ばない。`.pullArea` の `--pull-y` は引っぱり中・更新中だけ付く(TST-RF-03 を置き換え) | vitest |
| TST-PTR-02 | 印の線の本数が表示の量に合う。更新中は回る印。文字は見えず、読み上げ用の文言が出る | vitest |
| TST-PTR-03 | 動きを減らす設定で `--pull-y` が付かず、回らない印が出る(TST-RF-04 を置き換え) | vitest |
| TST-PTR-04 | 成功でトーストが出ない。失敗でトーストが出る | vitest(PullIndicator・App) |
| TST-PTR-05 | 下のメニュー・「先頭へ戻る」・トーストが `.pullArea` の外にある | vitest(App) |
| TST-BACK-01 | 一覧 → 詳細 → 戻るで元の scrollY に移る。詳細・設定は先頭。絞り込みの変更では動かない。50 件の上限 | vitest(App。scrollTo を差し替える) |
| TST-GIMG-01 | 元記事の画像が無いとき、トップと詳細でジャンルの画像と札「イメージ」、行では出ない。表に無いジャンル・null は今のまま。両方失敗で札 | vitest |
| TST-GIMG-02 | 表のパスのファイルがすべてあり、300KB 以下 | vitest(node:fs) |
| TST-ICON-01 | manifest のアイコンがすべてあり、PNG の大きさが名前どおり | vitest(PNG の頭を読む) |
| TST-SCREEN-01 | 本番:iPhone で引っぱりが IMG_3208 の形(画面全体が下がり、上に回る印、離すと更新して戻る)、動きを減らす設定の形、戻るで元の位置、ジャンルの画像、CSP の違反 0 件 | オーナー(iPhone)、Claude が内蔵ブラウザで CSP |

#### 5.7.8 依頼
- 依頼 15-1(netacho-app の docs/requests/15-1_screen-tidy.md)1本。見た目が変わるので design-check を付ける。危ない場所に触れないので pr-reviewer は付けず、reviewer だけ。design_spec(v3.10)は設計のチャットが先に直す。ジャンルの画像のファイルは設計のチャットが同じブランチに足す
