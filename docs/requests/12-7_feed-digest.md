# 依頼 12-7:翌朝のニュースへの受け渡し(feed-digest。詳細設計 3.15、REQ-D-06、K-037)

## 目的
詳細設計 3.15(netacho-infra の docs/03_詳細設計書.md v0.8、2026-11-25)のコードの部分(3.15.1〜3.15.3・3.15.5)を作る。ワークフロー(3.15.4)は netacho-sync に置くので、この依頼では作らない。本文は末尾の付録に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 足す:`sync/nodal_sync/feeddigest.py`、`sync/tests/test_feed_digest.py`
- 変える:`sync/nodal_sync/__main__.py`(feed-digest・feed-digest-backlog と終了コード)、`sync/nodal_sync/report.py`(要約)、`sync/README.md`
- この依頼文 `docs/requests/12-7_feed-digest.md`
- 変えないもの:`requirements*.txt`、`supabase/migrations/`、`.github/`、`src/`、watch のコード(watch.py。2・3 の見張りは作り済み)。既存の試験の期待値は変えない(足すだけ)

## 作り方の決まり
- 標準ライブラリと psycopg だけ。git の操作はしない(ワークフローが行う)
- 書くのは --data-dir の下の `feed_digest/YYYY-MM-DD.json` だけ。パスは日付の形(`^\d{4}-\d{2}-\d{2}$` の実在する日付)から作る
- 一覧に載せるのは 3.15.2 の鍵だけ(題・本文・訳を入れない)
- SQL は psycopg の sql.SQL と値の引数で組む。ログと要約に行の中身を出さない(件数と番号だけ)

## 試験
付録 3.15.6 の TST-DG-01〜07(名前に ID を入れる)。

## 確かめること
1. `cd sync && python -m pytest`(この VM で動かせない試験は、飛ばした数を報告に書く)
2. `npm run lint` と `npm run build`
3. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
4. DB の書き込みと、ai-netacho に書くワークフローが動かすコードなので、pr-reviewer にレビューさせる

## 報告
- 部品ごとに、何をしているかと、なぜ安全か(feeddigest.py は行ごと)
- 試験と pr-reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の ai-netacho への push と、配信タスクが一覧を読めるか。TST-DG-08)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「翌朝のニュースへの受け渡し(REQ-D-06・K-037、依頼 12-7)」

## 付録:詳細設計 3.15
#### 3.15 翌朝のニュースへの受け渡し(feed-digest。基本設計 4.10、REQ-D-06、K-037。v0.8 2026-11-25)
公式フィードに出たものを、翌朝の配信タスク(AI)が記事にできるよう、毎朝の一覧を ai-netacho に置く。配信タスクの指示文の直し(K-037)と、見張り(2.x の watch の 2・3。作り済み、feed_checks で有効にする)と組で動く。

##### 3.15.1 部品
- コード(netacho-app の sync/):`python -m nodal_sync feed-digest --data-dir <ai-netacho の clone> --ca <CA> [--dry-run]` と `feed-digest-backlog --before YYYY-MM-DD`(3.15.5)。新しいファイル `sync/nodal_sync/feeddigest.py`
- DB は `FEED_DB_URL`(netacho_feed。digest_date を書けるのは netacho_feed だけ)。ai-netacho への書き込みは、新しい書き込みのデプロイキー(3.15.4)でワークフローが行う。コードは git を操作しない(ファイルを書くだけ)

##### 3.15.2 一覧の作り方
- 対象:`digest_date is null` かつ `first_seen_at` が今から7日以内の行(5:35 の回が落ちても次の回が拾う。基本設計 4.10)。7日より古い null の行は入れずに数え、要約に出す(E-DIGEST-OLD。ふだんは起きない)
- ファイル:`feed_digest/YYYY-MM-DD.json`(日本時間の今日)。形:
  ```json
  {"version": 1, "date": "2026-12-01", "entries": [
    {"id": "<32桁>", "kind": "outage", "vendor": "GitHub", "product": "GitHub", "cve_ids": [], "url": "https://…", "published_at": "2026-11-30T21:10:00Z", "status": "復旧済み"}
  ]}
  ```
  - 載せるのは id・kind・vendor・product・cve_ids・url・published_at・status だけ。題・本文・訳は入れない(外の文章を配信タスクの AI に渡す量を増やさない。基本設計 4.10)。url が null の行は null のまま
  - 並びは sort_at の新しい順。0件でもファイルを書く(entries は空の配列。watch の「一覧の取りこぼし」を誤って起こさないため)
  - 同じ日にもう一度動いたら、その日のファイルを、今日の digest_date の行と、新しい null の行を合わせた一覧で書き直す(二重の記事にしないため、日をまたいで同じ行を2回載せない)
- 文字の検査:vendor・product・status は 3.5 で整えた値。JSON は json.dumps(ensure_ascii=False、キーの順は固定)

##### 3.15.3 書く順番
1. 一覧を作り、`--data-dir` の下の `feed_digest/YYYY-MM-DD.json` に書く(ほかのパスには書かない)
2. ワークフローが commit・push する(3.15.4)。push が失敗したら、DB は変えずにジョブを失敗にする(次の回が同じ行を拾う)
3. push が成功した後に、同じコマンドの2回目の呼び出し `feed-digest --commit-db --date YYYY-MM-DD` が、その日のファイルに載った id の行の digest_date を、その日にする(1つのトランザクション。ファイルを読み、id の形を確かめてから)
- 2 と 3 の間で止まったとき:ファイルはあるが digest_date が null のまま。次の回(同じ日なら同じファイルを書き直す、翌日なら翌日のファイルに入る)で拾う。翌日に入った場合は2日の一覧に同じ速報が出るが、watch の「一覧の取りこぼし」(null のまま 24 時間)で気づける

##### 3.15.4 ワークフロー(feed.yml の変更。drafts の feed.yml を、12-7 のマージの後にこの形に替える)
- feed の step の後に、日本時間 5 時台の回と、手動で入力 digest を true にしたときだけ動く step を足す:
  1. ai-netacho を checkout(`ssh-key` に新しい Secret `AI_NETACHO_DIGEST_KEY`。persist-credentials: true はこの checkout だけ。path は別のフォルダ)
  2. `feed-digest --data-dir`(FEED_DB_URL を渡す)
  3. 変わりがあれば commit(作者 `nodal-digest <nodal-digest@users.noreply.github.com>`、メッセージ `feed_digest YYYY-MM-DD`)して `git push origin HEAD:main`
  4. `feed-digest --commit-db --date`
- デプロイキーは書き込みあり(ai-netacho の Deploy keys で Allow write access)。読むだけの AI_NETACHO_DEPLOY_KEY(sync・watch 用)とは別の鍵にする(漏れたときに作り直す範囲を分けるため)。書く場所は鍵では絞れない(基本設計 4.10。同期の履歴の検査が data/items/ の想定外の変更を見つける)
- 同期の authors(config/sync.json)に nodal-digest は足さない(feed_digest/ だけを変えるコミットは、同期の作者の検査の対象外。2.x の検査は data/items/ を変えたコミットだけを見る)

##### 3.15.5 始めるときの1回だけの作業
受け渡しを始める前に貯まった行(取得を始めた日からの null の行)を、一覧に入れないための印を付ける。
- `feed-digest-backlog --before YYYY-MM-DD`:first_seen_at がその日(日本時間)より前で digest_date が null の行の digest_date を、first_seen_at の日本時間の日付にする(どの日の一覧にも載らないが、watch の「一覧の取りこぼし」に当たらなくなる。watch の「載せ忘れ」は今日の digest_date だけを見るので当たらない)
- 手動のワークフローの入力 backlog_before で1回だけ流す。そのあと config/sync.json の feed_checks を true にする(watch の 2・3 が動き出す)

##### 3.15.6 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-DG-01 | 対象の選び方(null・7日以内・古い行は数えるだけ)と並び | pytest(DB) |
| TST-DG-02 | ファイルの形(載せる鍵だけ、題・本文・訳が無い、0件でも書く、キーの順が固定) | pytest(DB) |
| TST-DG-03 | 同じ日の2回目は、その日の行と新しい行を合わせて書き直す。前の日に載った行は入らない | pytest(DB) |
| TST-DG-04 | --commit-db はファイルの id の行だけを、その日にする。id の形が違えば何も書かずに終了コード 2 | pytest(DB) |
| TST-DG-05 | --data-dir の下の feed_digest/ のほかに書かない(パスは日付の形から作る) | pytest |
| TST-DG-06 | feed-digest-backlog の印の付け方と、watch の 2・3 に当たらなくなること | pytest(DB) |
| TST-DG-07 | dry-run はファイルも DB も変えない | pytest(DB) |
| TST-DG-08 | 本番:5:35 の回で ai-netacho に一覧ができ、配信タスクがその日の記事に related_feed_ids を入れ、昼の watch が通る | 結合テスト(12.3 の正常2) |

##### 3.15.7 依頼と順番
- 依頼 12-7(netacho-app の docs/requests/12-7_feed-digest.md)1本。DB と、ai-netacho に書くワークフローが動かすコードなので pr-reviewer を付ける
- 順番:12-6 の後 → オーナーが書き込みのデプロイキーを作る(設定手順書に足す)→ feed.yml を替える → backlog を1回 → feed_checks を true。配信タスクの指示文(K-037)は、一覧を読み記事に related_feed_ids を入れる形に、同じ時期に直す(オーナー)
