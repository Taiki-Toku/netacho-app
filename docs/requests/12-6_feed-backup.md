# 依頼 12-6:公式フィードのバックアップと戻し(feed-backup・feed-restore。詳細設計 3.14、REQ-N-16)

## 目的
詳細設計 3.14(netacho-infra の docs/03_詳細設計書.md v0.7、2026-11-25)のコードの部分(3.14.1〜3.14.3)を作る。ワークフロー(3.14.4)は netacho-sync に置くので、この依頼では作らない。本文は末尾の付録に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 足す:`sync/nodal_sync/feedbackup.py`、`sync/tests/test_feed_backup.py`
- 変える:`sync/nodal_sync/__main__.py`(feed-backup・feed-restore と終了コード)、`sync/nodal_sync/report.py`(要約)、`sync/README.md`
- この依頼文 `docs/requests/12-6_feed-backup.md`
- 変えないもの:`requirements*.txt`(依存を足さない)、`supabase/migrations/`、`.github/`、`src/`、ほかの sync のファイル。既存の試験の期待値は変えない(足すだけ)

## 作り方の決まり
- 標準ライブラリと psycopg だけ。git の操作はこのコードではしない(ワークフローが行う)
- SQL は psycopg の sql.SQL と値の引数で組み、列の名前はコードの中の固定の一覧から作る
- ファイルの書き込みは --out の下の feed/ と usage.jsonl だけ。パスは固定の形(`feed/YYYY-MM.jsonl`)で作り、外から来た値でパスを作らない
- ログと要約に行の中身を出さない(数と、不正のときのファイル名・行番号だけ)

## 試験
付録 3.14.5 の TST-BK-01〜06(名前に ID を入れる)。DB の試験は既存の conftest の作り。

## 確かめること
1. `cd sync && python -m pytest`(この VM で動かせない試験は、飛ばした数を報告に書く)
2. `npm run lint` と `npm run build`
3. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
4. DB の書き込みと、ワークフローが動かすコードに触れるので、pr-reviewer にレビューさせる

## 報告
- 部品ごとに、何をしているかと、なぜ安全か(feedbackup.py は行ごと)
- 試験と pr-reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の backup ブランチと git の履歴での日付の選び方、本番の件数での時間)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「公式フィードのバックアップと戻し(REQ-N-16、依頼 12-6)」

## 付録:詳細設計 3.14
#### 3.14 バックアップと戻し(backup・restore-feed。基本設計 6.7、REQ-N-16。v0.7 2026-11-25)
公式フィードの行は Supabase にしか無い(RSS は新しい記事しか持たず、取り直せない)ので、毎日 netacho-sync の backup ブランチに書き出す。

##### 3.14.1 部品
- コード(netacho-app の sync/):`python -m nodal_sync feed-backup --out <フォルダ> --ca <CA>` と `python -m nodal_sync feed-restore --in <フォルダ> --ca <CA> [--dry-run]`。新しいファイル `sync/nodal_sync/feedbackup.py`。依存は足さない
- 接続は `FEED_DB_URL`(netacho_feed。3.6 と同じ形、`application_name=nodal-backup`)。netacho_feed は feed の3表の select・insert・update だけで、削除はできない(0002)

##### 3.14.2 書き出し(feed-backup)
- 読むもの:feed_entries の全部の列(生成列の sort_at を除く)と、feed_translate_usage の全部の行。feed_source_state は書き出さない(ETag などで、無くなっても次の取得で作り直せる)
- ファイル:`feed/YYYY-MM.jsonl`(first_seen_at の日本時間の月で分ける)と `usage.jsonl`。1行に1件の JSON。キーは列の名前の順で固定、行は id の順(同じ中身なら同じファイルになり、変わったファイルだけがコミットされる)。時刻は UTC の ISO 8601、numeric は文字列
- 毎回すべての月を書き出す(古い月の行も、翻訳や exploited で変わるため)。書き出す前にフォルダの feed/ を空にしてから書く(消えた月が残らないように。行は DB から消えないので、ふだんは起きない)
- 要約:月ごとの行数と合計。行の中身は出さない

##### 3.14.3 戻し(feed-restore)
- 入力:backup ブランチを checkout したフォルダ(どの時点に戻すかは、ワークフローの入力の日付で、その日の終わりより前の最後のコミットを選ぶ。3.14.4)
- 検査:各行が 0002 の列の型と CHECK に合うこと(id の形、kind、url は https、文字数)を先に全部確かめ、1行でも合わなければ何も書かずに終了コード 2(E-RESTORE-ROW。行番号とファイル名だけを出す)
- 書き込み:1つのトランザクションで feed_entries に upsert(同じ id は上書き。DB にあって backup に無い行は残す=消さない)。上書きは、列の値が DB の行と違う行だけにする(`on conflict (id) do update … where (列の並び) is distinct from (excluded の列の並び)`。比べる列に updated_at は入れない)。同じ行まで上書きすると、0002 の feed_entries_guard が全部の行の updated_at を今の時刻にし、次の書き出しで全部の月のファイルが変わるため(2026-11-25 追加)。DB にある行の first_seen_at は feed_entries_guard が変えさせない(backup の値にも戻らない)。exploited は true から false に戻らない。feed_translate_usage は月ごとに、DB と backup の大きいほうを残す(数え直しで少なくならないように)
- `--dry-run`:検査と件数の数えだけで、書かない
- 要約:読んだ行・追加・上書き・変わらない(上の where で上書きしなかった行)、の数

##### 3.14.4 ワークフロー(netacho-sync)
| 項目 | backup.yml | restore-feed.yml |
|---|---|---|
| 起動 | cron `5 21 * * *`(日本時間 6:05)と workflow_dispatch | workflow_dispatch だけ(入力 date:YYYY-MM-DD、dry_run:既定 true) |
| permissions | `contents: write`(このワークフローだけ。基本設計 3.5 の例外) | `contents: read` |
| concurrency | group `nodal-feed`(feed と同時に動かさない) | group `nodal-feed` |
| timeout-minutes | 10 | 10 |
| 手順 | 自分を checkout → app-ref.txt の形を確かめる → netacho-app をその SHA で checkout → setup-python・pip(sync と同じ)→ backup ブランチを別のフォルダに checkout(無ければ空の orphan のブランチを作る)→ `feed-backup --out` → 変わったファイルだけを add → 変わりがあればコミットして `git push origin HEAD:refs/heads/backup` | 自分を checkout → netacho-app → setup-python・pip → backup ブランチを全部の履歴で checkout → 入力の日付の形を確かめ、`git rev-list -1 --before="<date> 23:59:59 +0900" backup` のコミットに切り替える(無ければ終了コード 2)→ `feed-restore --in`(dry_run なら `--dry-run`) |
- push 先は backup ブランチだけで、main には書かない。コミットの作者は `nodal-backup <noreply>`(固定の値。オーナーのメールアドレスを使わない)
- アクションは feed.yml と同じ SHA で固定。入力は env で渡す。`FEED_DB_URL` は python の step にだけ渡す。書き出しは鍵の無い step で行い、`GITHUB_TOKEN` は最後の commit・push の step にだけ env で渡す(git の http.extraheader で使い、.git の設定に残さない。どの checkout も persist-credentials: false)
- 置き場:netacho-infra の drafts/netacho-sync/.github/workflows/。オーナーが netacho-sync に写す(設定手順書に足す)

##### 3.14.5 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-BK-01 | 書き出しのファイルの分け方(日本時間の月の境目)、キーと行の順、同じ中身なら同じバイト列 | pytest(DB) |
| TST-BK-02 | 生成列と feed_source_state を書き出さない。要約に行の中身が出ない | pytest(DB) |
| TST-BK-03 | 戻しの検査:1行でも不正なら何も書かず終了コード 2 | pytest(DB) |
| TST-BK-04 | 戻しの upsert:上書き、同じ中身の行は上書きしない(updated_at が変わらない)、backup に無い行は残る、first_seen_at・exploited が守られる、usage は大きいほう | pytest(DB) |
| TST-BK-05 | 書き出し → 空の DB に戻す → もう一度書き出すと、同じファイルになる(往復) | pytest(DB) |
| TST-BK-06 | dry-run は書かない | pytest(DB) |
| TST-BK-07 | 本番:backup の定時の回が成功し、backup ブランチにファイルができる。VM のローカル Supabase に戻して件数が合う(基本設計 12.4) | 構築と結合テストで |

##### 3.14.6 依頼
- 依頼 12-6(netacho-app の docs/requests/12-6_feed-backup.md)1本。DB と、push をするワークフローが動かすコードなので pr-reviewer を付ける
- 12-4(翻訳)の後に流す(feed_entries の列がそろってから)
