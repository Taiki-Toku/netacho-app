# 依頼 17-1:ニュースの詳細から星の指標を外す(K-073。REQ-F-03 v1.3、詳細設計 5.8)

## 目的
一般向けのニュース(要件 Q-12)に星3つ(話題度・実用度・遊べる度)は要らないので、詳細の画面から外す。データの stars は残す。設計は末尾の付録(netacho-infra の詳細設計 v0.15、2026-11-28)。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 変える:`src/screens/ItemScreen.tsx`、`src/screens/ItemScreen.module.css`、`src/screens/ItemScreen.test.tsx`、`src/data/labels.ts`
- 消す:`src/components/StarMeter.tsx`、`src/components/StarMeter.module.css`(`git rm`。ほかに StarMeter を使う所が無いことを grep で確かめてから)
- この依頼文 `docs/requests/17-1_no-stars.md`
- 変えないもの:`src/data/types.ts`・`parse.ts`・`itemRow.ts` とその試験(星の読み込みと丸めは残す)、`docs/design_spec.md`、`sync/`、`supabase/`、`public/`、`.github/`、依存パッケージ
- 期待値を変えてよい既存の試験:ItemScreen.test.tsx の「このニュースについて」の試験から星3つの行(`getAllByRole('img', { name: /\d\/5$/ })` の toHaveLength(3))と、試験「星の指標を「話題度 3/5」のように読み上げる」を消す。ほかの期待値は変えない

## 作り方の決まり
- ItemScreen.tsx:`.meters` の div、StarMeter と STAR_AXES の import を消す。先頭のコメントの「星3つ」を消す。「このニュースについて」の dl と並びは変えない
- ItemScreen.module.css:`.meters` を消す。ほかの規則は変えない
- labels.ts:STAR_AXES を消す。`Stars` の import が使われなくなったら消す
- 見た目は「このニュースについて」の下の余白が無くなるだけ。新しい余白・規則は足さない

## 試験
付録の TST-DETAIL-05(名前に ID を入れる。見本 `2026-01-02-01` は stars に値があるので、それで「話題度」「実用度」「遊べる度」の文字と `/\d\/5$/` の img が無いことを確かめる)。TST-DETAIL-01 はそのまま通ること。

## 確かめること
1. CI と同じ検査:型チェック・lint・vitest 全部・ビルド・`npm audit --omit=dev --audit-level=high`
2. `grep -rn "StarMeter\|STAR_AXES" src` が 0 件
3. 見た目が変わるので design-check で詳細の画面を点検する(コードを読む形でよい)
4. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、reviewer に見せる。変わったのが上のファイルだけであること

## 報告
- 構造とデータの流れ(どこを消し、何を残したか)、試験で確かめた内容
- 試験・design-check・reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本番の iPhone で「このニュースについて」の下が崩れていないこと。TST-SCREEN-02 で確かめる)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「ニュースの詳細から星の指標を外す(K-073、依頼 17-1)」

## 付録:詳細設計 v0.15 の 5.8

### 5.8.1 画面
- 詳細の「このニュースについて」から星3つ(`.meters` の div)を消す。残りの欄(コーナー・情報の確かさ・カテゴリ・タグ)と並びは変えない
- 消すもの(使う所が無くなる):components/StarMeter.tsx・StarMeter.module.css、labels.ts の STAR_AXES、ItemScreen.module.css の `.meters`、星の読み上げの試験
- 消さないもの:types.ts の Stars と NetaItem.stars、parse.ts・itemRow.ts の星の読み込みと丸め(その試験も)。データの形を変えないため

### 5.8.2 変えないもの
- 配信の指示文の stars、sync の schema の stars の検査、DB の star_hot・star_use・star_fun
- Supabase の問い合わせ、_headers・CSP、sync/

### 5.8.3 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-DETAIL-05 | 詳細に星の指標(「話題度」「実用度」「遊べる度」の文字と「n/5」の読み上げ)が出ない(stars に値がある見本でも) | vitest(ItemScreen) |
| TST-SCREEN-02 | 本番:詳細に星が無く、「このニュースについて」の下が詰まって崩れていない。CSP の違反 0 件 | 設計のチャットとオーナー(この依頼の範囲外) |
