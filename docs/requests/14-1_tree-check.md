# 依頼 14-1:同期の「ファイルの形の検査」(K-063。詳細設計 2.4 の3・2.9、v0.10)

## 目的
配信タスク(Web を読む無人の AI)が ai-netacho の CLAUDE.md・.claude/・tools/ などを書き換えたことに、同期で気づいて止める。作者は偽れるので、ファイルの形と、netacho-sync の一覧(config/ai_netacho_files.json)で判定する。詳細設計の本文は末尾の付録に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 変える:`sync/nodal_sync/source.py`(検査の関数)、`sync/nodal_sync/config.py`(ai_netacho_files.json を読む)、`sync/nodal_sync/__main__.py`(run の 3 から呼ぶ。check_history・check_clean の後、list_items の前。初回と --reset-baseline では今の木だけ)、`sync/nodal_sync/report.py`(パスの出し方)、`sync/README.md`
- 足す:`sync/tests/test_tree_check.py`
- この依頼文 `docs/requests/14-1_tree-check.md`
- 変えないもの:`requirements*.txt`、`supabase/migrations/`、`.github/`、`src/`。既存の試験の期待値は変えない。ただし、run を呼ぶ既存の試験の一時の config フォルダには、空でない正しい ai_netacho_files.json を置く必要がある(置き方は helpers.py にまとめてよい)

## 作り方の決まり
- 標準ライブラリだけ。git は既存の `_git` を使い、`-z` の出力を bytes のまま区切ってから UTF-8 で読む(読めないパスは違反)
- 一覧の場所は `--config` と同じフォルダの `ai_netacho_files.json`。無ければ E-CONFIG-FILES(fail-closed)
- 要約とログに出すのはパスだけ(制御文字は `?`、1つ 200 字、20 件まで)。ファイルの中身・SHA は出さない
- 止まったときの終了コードは 2、コードは E-SRC-TREE(既存の Stop の流れに乗せ、何も書かない)。メッセージは「ai-netacho に想定外のファイルがあります」

## 試験
付録の TST-SYNC-21〜23(名前に ID を入れる)。一時の git リポジトリは既存の helpers を使う。

## 確かめること
1. `cd sync && python -m pytest`(この VM で動かせない試験は、飛ばした数を報告に書く)
2. `npm run lint` と `npm run build`
3. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
4. 同期(危ない場所)なので、pr-reviewer にレビューさせる

## 報告
- source.py・config.py の変更は行ごとに、何をしているかと、なぜ安全か
- 試験と pr-reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の ai-netacho の木で誤検知しないか。設定手順書 4-7 の手順5で確かめる)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「同期のファイルの形の検査(K-063、依頼 14-1)」

## 付録:詳細設計 2.4 の3(抜き出し)・2.9・2.14
   - **ファイルの形の検査**(v0.10。K-063):配信タスクは Web を読む無人の AI で、ai-netacho のどのファイルも書ける。CLAUDE.md・.claude/ などを書かれると、翌朝のタスクがそれを指示として読む。作者は偽れるので、作者ではなくファイルの中身で判定する。どれかに当たれば、何も書かずに終了コード 2(E-SRC-TREE。要約にはパスだけを、制御文字を `?` に置き換え、200 字・20 件まで出す。中身は出さない)。初回と `--reset-baseline` でも行う。
     1. 今の木:`git ls-tree -r -z --full-tree HEAD` の全行を見る。種類が blob でモードが 100644 でないもの(シンボリックリンク・実行ファイル・サブモジュール)は違反。パスが下の「データの形」に合うものは通す。合わないものは、`config/ai_netacho_files.json` の files に同じパスがあり、オブジェクト ID(blob の SHA)が一致すれば通す。どちらでもなければ違反(足されたファイルも違反)。files にあるのに木に無いパスも違反(消された印)
     2. 履歴:`git log --full-history -m --name-only -z --format= <last_commit>..HEAD` で、その間に変わったパスを全部取る。データの形にも files にも無いパスが1つでもあれば違反(足して消す、の消し跡を拾うため)。初回と `--reset-baseline` は 1 だけ
     3. データの形(正規表現。パスの全体に当てる):`^data/items/\d{4}-\d{2}-\d{2}-\d{2}\.json$`/`^feed_digest/\d{4}-\d{2}-\d{2}\.json$`/`^ネタ/\d{4}-\d{2}-\d{2}-\d{2}( [^/]*)?\.md$`/`^放送/\d{4}-\d{2}-\d{2}\.md$`(どれも日付で始まるので、CLAUDE.md などの名前は合わない)
     - files にあるファイル(tools/export.py など)の中身を変えて戻すことは、2 では止まらない(files にあるパスなので)。配信タスクが自分で export.py を書き換えて動かすのは、そのタスクの中でコードを動かすのと同じで、ネットワークが Full の環境では防げない(漏れて困るものを置かないことで受ける。概要 5章)
     - feed_digest/ は形だけを見る(配信タスクに書き換えられても、記事が増えるだけで、昼の watch で気づける。2026-11-27 に受け入れ)
     - オーナーが tools/ などを直したら、netacho-sync の files を同じ PR で直す(設定手順書 4-7)。直さないと次の同期が E-SRC-TREE で止まる。ファイルを消したときは、一覧から消したうえで、そのあと1回だけ手動の sync を `--reset-baseline` で流す(履歴に消したパスが残り、2 で止まるため)

- **config/ai_netacho_files.json**(v0.10。K-063):`{"files": {"<パス>": "<blob の SHA(40 桁)>", …}}`。ai-netacho の、データの形(2.4 の3)に合わないファイルを全部並べる。置き場は `--config` と同じフォルダ(ワークフローは変えない)。作り方は設定手順書 4-7(オーナーが PC の ai-netacho で `git ls-tree` を流して作る)。無い・形がおかしい(パスが 300 字を超える、SHA が 40 桁の小文字の16進でない、500 件を超える、データの形に合うパスが入っている)ときは、何も書かずに終了コード 2(E-CONFIG-FILES。1 の設定の検査)。配信タスクは netacho-sync に書けないので、この一覧を書き換えられない

| ID | 確かめること | 方法 |
|---|---|---|
| TST-SYNC-21 | ファイルの形の検査(今の木):CLAUDE.md・`.claude/settings.json`・`data/items/CLAUDE.md`・`ネタ/x.md`・実行ファイル・シンボリックリンク・files と中身の違う tools/export.py・files にあって消されたファイルのどれでも、何も書かずに終了コード 2。データの形のファイルと files に一致するファイルだけなら通る。作者を config の authors にしても止まる | pytest(一時の git リポジトリ) |
| TST-SYNC-22 | ファイルの形の検査(履歴):CLAUDE.md を足して次のコミットで消した場合も終了コード 2。tools/export.py を files どおりに直したコミットは通る。初回と reset_baseline では履歴を見ない | pytest(一時の git リポジトリ) |
| TST-SYNC-23 | 要約に出るパスは制御文字が `?` になり、200 字・20 件で切られ、ファイルの中身は出ない | pytest(出力を調べる) |
