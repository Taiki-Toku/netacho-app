# 依頼 16-1:同期の reset_baseline に expected_head を足す(K-068。詳細設計 2.4・2.6、REQ-S-08)

## 目的
`--reset-baseline` は履歴の検査(書き換え・作者)を飛ばすので、オーナーが確かめた HEAD のときだけ基準を付け直せるようにする。確かめた SHA を `--expected-head` で渡させ、checkout した HEAD と違えば何も書かずに止める。設計は末尾の付録(netacho-infra の詳細設計 v0.14、2026-11-28)。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 変える:`sync/nodal_sync/__main__.py`、`sync/tests/test_db.py`、`sync/tests/test_tree_check.py`
- 足してよい:試験のファイル(引数の試験を置く所が既存に無ければ、例 `sync/tests/test_expected_head.py`)
- この依頼文 `docs/requests/16-1_expected-head.md`
- 変えないもの:`sync/nodal_sync/` のほかのファイル(source.py・db.py・report.py など)、`sync/requirements.txt`、`src/`、`public/`、`supabase/`、`.github/`、依存パッケージ
- 期待値を変えてよい既存の試験:`--reset-baseline` を渡している試験(TST-SYNC-12・21・22)は、一致する `--expected-head <HEAD の SHA>` を足すだけ。確かめる内容は変えない。ほかの期待値は変えない

## 作り方の決まり
- 引数の検査は、今の `select_days` の検査と同じ所(main の run の分岐、`_run` を呼ぶ前)で行い、DB に接続しない・設定も読まない
- SHA の形は `re.fullmatch(r"[0-9a-f]{40}", value)` で調べる(大文字・短縮・前後の空白は不正。strip しない)
- 照合は `source.head_commit(args.data_dir)` の直後、`check_clean` より前。違えば `Stop("E-HEAD-MISMATCH")`
- メッセージは MESSAGES の決まった文だけ。SHA の値(期待した方・HEAD の方とも)をログ・要約に出さない
- 初回(基準が無いとき)の動きは変えない。`--reset-baseline` が無いときの動きも変えない

## 試験
付録の TST-SYNC-12(改)・TST-SYNC-24・TST-SYNC-25(名前に ID を入れる)。

## 確かめること
1. sync の試験を全部(`sync/` の pytest。DB の試験を含む)と、ruff などの sync の CI と同じ検査
2. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、pr-reviewer に見せる(同期は危ない場所)。重大の指摘は直して再レビュー。変わったのが上のファイルだけであること

## 報告
- 変えた行ごとに、何をしているかと、なぜ安全か
- 試験・pr-reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:netacho-sync のワークフローの入力から値が正しく渡ること。これは本番の手動起動で確かめる)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「同期の reset_baseline に expected_head を足す(K-068、依頼 16-1)」

## 付録:詳細設計 v0.14 の変更分

### 2.4 sync の処理(足す所)
- 引数 `--expected-head <SHA>`。次のときは DB に接続する前に `E-ARGS-EXPECTED-HEAD`(「--expected-head が無いか、40 桁の小文字の SHA ではありません」)で終了コード 2:①`--reset-baseline` があるのに無い ②`^[0-9a-f]{40}$` に合わない ③`--reset-baseline` が無いのに有る
- `--reset-baseline` のときは、HEAD を読んだ直後に `--expected-head` と比べ、違えば `E-HEAD-MISMATCH`(「HEAD が --expected-head と違います(何も書いていない)」)で終了コード 2。ファイルの検査・書き込み・基準の記録より前なので、items と sync_state は変わらない。メッセージと要約に SHA の値は出さない(どの SHA だったかはワークフローの checkout のログで見る)
- 初回(基準が無いとき)は今のまま(expected_head を求めない。2026-11-28 オーナー決定)

### 2.6 止まったときの戻し方(直す所)
- 要約で書き換え・作者を確かめる → 正しければ、ai-netacho の main の先頭の SHA(40 桁)を写し、手動の起動で `reset_baseline` に印を付け、`expected_head` にその SHA を入れて流す。正しくなければ、基本設計 6.3 の R-08・R-09

### 2.14 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-SYNC-12(改) | reset_baseline と、HEAD と一致する expected_head で、検査を飛ばして基準が付け直される | pytest(DB) |
| TST-SYNC-24 | reset_baseline で expected_head が HEAD と違えば終了コード 2・E-HEAD-MISMATCH。items と sync_state が変わらない。出力と要約に両方の SHA が出ない | pytest(DB) |
| TST-SYNC-25 | ①reset_baseline だけ ②expected_head が短縮・大文字・前後に空白 ③expected_head だけ、のどれも終了コード 2・E-ARGS-EXPECTED-HEAD で、DB に接続しない | pytest(接続を差し替えて呼ばれないことを確かめる) |
