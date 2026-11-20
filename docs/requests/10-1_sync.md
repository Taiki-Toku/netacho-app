# 依頼 10-1:同期のコード(sync/)、CI の sync ジョブ、マイグレーション 0002・0003

- 対象:このリポジトリ(netacho-app)。DEV-VM01 のヘッドレス実行(nodal のジョブ)で行う
- もとの設計:netacho-infra の詳細設計 2章(v0.1)。netacho-infra はここからは読めないので、要る内容はこの依頼に全部書いた。ほかの文書は読まない(CLAUDE.md と、下の表のファイルだけ)
- 危ない場所(同期・Supabase のマイグレーション・`.github/`・依存の追加)に触れるので、`pr-reviewer` を必ず通す(9章)
- 依存の追加(psycopg・pytest など)は、オーナーが 2026-11-20 に承認済み(承認の材料は 8章。PR の本文にも貼る)

## 0. 前提(この VM で分かっていること)
- サンドボックスは PyPI に出られない。Docker も使えない。だから **このジョブの中では、依存のインストール・pytest・DB の試験は動かせない**。試験は CI の `sync` ジョブで初めて走る。ここでは `python3 -m compileall -q sync` と、`python3 -m pytest` がたまたま動けば DB を使わない試験だけを流す(動かなければ「未実行」と報告。インストールはしない)
- コードは Python 3.12 で動くこと(CI は 3.12)。標準ライブラリと psycopg 3 だけを使う
- 本物のネタのデータ・メールアドレス・秘密の値は、コード・試験・コミットに入れない。試験のデータは架空の見本だけ

## 1. 目的
毎朝の配信(ai-netacho の `data/items/<id>.json`)を Supabase の items に入れる同期の部品を作る。ワークフロー(netacho-sync、非公開)は別の作業で、ここではコードと試験と CI だけを作る。

## 2. 触るファイル
この表の外は触らない。必要になったら、実装せずに止まって報告する。

| ファイル | すること |
|---|---|
| `sync/README.md` | 新規。使い方(引数・環境変数・終了コード)、試験の流し方、この依頼への参照 |
| `sync/requirements.in`・`requirements.txt`・`requirements-dev.txt` | 新規。**付録 A の内容と1文字も違わないこと** |
| `sync/pytest.ini` | 新規。`[pytest]` に `testpaths = tests` だけ |
| `sync/nodal_sync/__init__.py`・`__main__.py`・`config.py`・`source.py`・`schema.py`・`db.py`・`ogimage.py`・`ghapi.py`・`watch.py`・`report.py` | 新規(4章) |
| `sync/tests/` | 新規。試験(6章)、見本のデータ、`sql/supabase_mock.sql`(付録 B と同じ) |
| `supabase/migrations/0002_feed_and_items.sql`・`0003_sync_state.sql` | 新規。**付録 C・D と1文字も違わないこと**(本番への適用はしない) |
| `.github/workflows/ci.yml` | `sync` ジョブを足し、workflow-guard の対象に `sync/requirements` を足す(7章)。ほかは変えない |
| `docs/requests/10-1_sync.md` | この依頼文(区切りの行 `=== REQUEST END ===` より前の部分)をそのまま保存する |

`package.json`・`package-lock.json`・`src/` は変えない。

## 3. 入力の JSON と検査(schema.py)
1ファイル=1本。UTF-8 の JSON のオブジェクト。ファイル名は `<id>.json`。

| JSON の項目 | DB の列 | 型 | 必須 | 検査(1つでも外れたら、その日は不正) |
|---|---|---|---|---|
| id | id | 文字列 | ○ | `^\d{4}-\d{2}-\d{2}-\d{2}$`。ファイル名と同じ |
| date | date | 文字列 | ○ | `YYYY-MM-DD` の実在の日付。id の先頭と同じ。日本時間の明日より後は不可 |
| order | sort_order | 整数 | ○ | 0〜999 |
| slot | slot | 文字列 | ○ | 設定の slots のどれか |
| genre | genre | 文字列 | ○ | DB の genres にある id。mode が all のときだけ null を許す |
| title | title | 文字列 | ○ | 1〜200 字 |
| lead | lead | 文字列 | | 0〜400 字 |
| summary | summary | 文字列 | | 0〜4000 字 |
| points | points | 文字列の配列 | | 0 個か 3 個。各 1〜300 字 |
| excerpt | excerpt | 文字列 | | 0〜1000 字 |
| tryit / caution | tryit / caution | 文字列 | | 0〜2000 字 |
| categories / projects / tags | 同じ名前 | 文字列の配列 | | 0〜20 個。各 1〜50 字 |
| sourceUrl | source_url | 文字列 | | 空なら null。空でなければ `https://` で始まり、ホストがあり、空白を含まず、2000 字以内 |
| sourceTitle | source_title | 文字列 | | 0〜300 字 |
| trust | trust | 文字列 | | 0〜40 字 |
| stars | star_hot / star_use / star_fun | `{hot, use, fun}` の整数 | | 各 0〜5(真偽値は不可。キーが無いものは 0) |
| publishedAt | published_at | 文字列 | | `YYYY-MM-DD`。date より後は不可 |
| relatedFeedIds | related_feed_ids | 文字列の配列 | | 0〜50 個。各 `^[0-9a-f]{32}$` |
| relatedItemIds | related_item_ids | 文字列の配列 | | 0〜10 個。各 id の形 |

- 任意の項目が無いときは、DB の既定値(文字列は ''、配列は空、stars は 0、source_url・published_at は null)にする
- 文字数は Unicode のコードポイントで数える(Python の len)。文字列に NUL と、改行・タブ以外の制御文字(Unicode の Cc)は入れない
- genre が idea のときは、tags に「AI提案」があり、relatedItemIds が1つ以上あること
- 型が違う値は、その日を不正にする。値を直して入れることはしない(bool は整数として扱わない)
- 表に無い項目は読まずに捨て、件数だけを要約に出す。rating・status・memo・userUpdatedAt も読まない(値をどこにも残さない)
- 1ファイル 64 KB まで。1日 30 本まで。どちらかを超えたら、その日は不正
- JSON の NaN・Infinity は不正(`parse_constant` で拒む)。同じキーが2回出たら不正(`object_pairs_hook`)。最上位がオブジェクトでなければ不正。UTF-8 で読めなければ不正
- 同じ日の中で order やタイトルが重なっても不正にしない。要約に「重なり」として件数を出す
- 不正には決まりの番号を付ける(例 `E-URL-SCHEME`、`E-TITLE-LEN`、`E-DUP-KEY`、`E-IDEA-TAG`)。番号の一覧は schema.py の先頭に定数で置き、README にも載せる
- 結果は「正しい行(DB の列名の dict)」と「(id か ファイル名, 決まりの番号)の一覧」。値そのものは結果に入れない

## 4. 処理

### 4.1 起動(`__main__.py`)
`python -m nodal_sync run|watch`。引数:

| 引数 | 値 | 意味 |
|---|---|---|
| `--config` | パス(必須) | netacho-sync の `config/sync.json` |
| `--data-dir` | パス(必須) | ai-netacho を checkout した場所(git のリポジトリ) |
| `--ca` | パス | DB の CA 証明書(4.5)。localhost 以外につなぐときは必須 |
| `--mode` | recent(既定)/range/all | recent は日本時間の今日を含む直近 3 日。range は `--from`・`--to`(どちらも YYYY-MM-DD、from ≦ to、最大 400 日)。all は全件 |
| `--reset-baseline` | 付けるか付けないか | 4.2 の 3 を飛ばして基準を付け直す |

- 環境変数:`SYNC_DB_URL`(接続文字列。表示しない)、`GITHUB_STEP_SUMMARY`(あれば要約を追記。無ければ標準出力)、`GITHUB_TOKEN`(watch の 4 だけ)
- 引数の値は argparse の後に形を確かめる(日付の形、範囲)。おかしければ終了コード 2
- 日本時間は `timezone(timedelta(hours=9))`(tzdata に頼らない)。「今日」は試験から差し替えられるようにする

### 4.2 run の手順(番号の順。止まったら、それより後は行わない)
1. **設定を読む**(config.py):4.6 の形を確かめる。おかしければ終了コード 2
2. **接続**:DB に入り(4.5)、genres の id の一覧と、sync_state の last_commit(source = 'ai-netacho')を読む
3. **履歴の検査**(source.py):
   - last_commit が無い(初回)→ 検査を飛ばし、6 で今の HEAD を記録する
   - last_commit があり、`git merge-base --is-ancestor <last_commit> HEAD` の終了コードが 0 以外(1 も 128 も)→ 書き換えとみなし、何も書かずに終了コード 2(要約に「履歴の書き換え」)
   - `git log --full-history -m --format=%H%x00%ae%x00%ce <last_commit>..HEAD -- data/items/` で、data/items/ を変えたコミットをマージコミットも含めて全部取る。作者(%ae)とコミットした人(%ce)の両方が設定の authors に無ければ、何も書かずに終了コード 2(どちらか一方でも authors に無ければ止める)
   - `--reset-baseline` のときは、この 3 を飛ばす(要約に「基準を付け直した」)
   - git は `subprocess.run([...], cwd=data_dir, capture_output=True, timeout=60, check=False)` の配列で呼ぶ。シェルは使わない。last_commit は呼ぶ前に `^[0-9a-f]{40}$` を確かめる。`-c core.hooksPath=/dev/null` は不要(読むだけ)
4. **日ごとの検査**:範囲の日の `data/items/*.json` を、ファイル名の日付で日ごとに分け、3章で調べる。ファイル名が id の形でないファイル(`.json` 以外も含む。サブフォルダは見ない)は、どの日にも入れず、件数だけを要約に出して終了コードを 1 にする。シンボリックリンクは読まずに不正なファイルとして数える
5. **日ごとの書き込み**(db.py):正しい日だけ、日ごとに1つのトランザクションで 4.4 の upsert を行う。失敗したらその日を取り消し、次の日へ進む(終了コード 1)
6. **基準の記録**:3 を通った(または飛ばした)ら、5 の結果によらず、sync_state に今の HEAD を upsert する
7. **画像**(ogimage.py):image_url が null で source_url がある行のうち、範囲の日の分を新しい順に最大 30 件、og:image を取る(4.7)。取れなくても終了コードは変えない
8. **要約**(report.py):日ごとの読んだ件数・追加・更新・変化なし・不正(決まりの番号ごとの件数)、画像の取れた件数・取れなかった件数、DB にあって JSON に無い id の件数(範囲の日だけ。消さない)、捨てた項目の件数、重なりの件数

終了コード:0=全部正しい/1=不正な日、書き込みの失敗、不正なファイル名のどれかがある(正しい日は書いた)/2=引数・設定・接続・履歴の検査で止まった(何も書いていない)。

### 4.3 sync_state(0003)
- 読む:`select last_commit from public.sync_state where source = 'ai-netacho'`
- 書く:`insert into public.sync_state (source, last_commit) values ('ai-netacho', %s) on conflict (source) do update set last_commit = excluded.last_commit, updated_at = now()`

### 4.4 items への書き込み(netacho_sync で)
- `insert … on conflict (id) do update set <列> = excluded.<列>, …, synced_at = now() where (items の今の値の組) is distinct from (excluded の値の組) returning (xmax = 0) as inserted`。値が同じ行は更新しない(返る行が無い=変化なし)
- 更新の対象の列は 3章の表の DB の列と synced_at。image_url は `case when items.source_url is distinct from excluded.source_url then null else items.image_url end`(出典が変わったときだけ null に戻す)。それ以外は image_url に触れない
- 画像の書き込みは `update public.items set image_url = %s where id = %s and image_url is null and source_url = %s`
- トランザクションごとに `set local statement_timeout = '30s'`。値はすべてプレースホルダで渡す。列の名前はコードの中の固定の一覧から作り、入力から作らない
- 配列は text[]、日付は `datetime.date` で渡す

### 4.5 接続と TLS(db.py)
- `SYNC_DB_URL` を `psycopg.conninfo.conninfo_to_dict` で読む。host が `localhost`・`127.0.0.1`・`::1` のどれでもなければ、`sslmode=verify-full`・`sslrootcert=<--ca のパス>` で上書きする(URL の中の sslmode は使わない)。`--ca` が無い・ファイルが無いときは終了コード 2
- どちらの場合も `connect_timeout=10`、`application_name=nodal-sync` を付ける。autocommit は使わず、日ごとに `with conn.transaction():`
- 接続と SQL の失敗は、psycopg の例外のメッセージを出さず、決まった文(例「DB に接続できませんでした(E-DB-CONNECT)」)に置き換える。接続文字列を表示しない
- `import psycopg` は db.py の中だけ(schema・source などの試験が psycopg なしでも動くように)

### 4.6 設定(config.py)
```json
{
  "slots": ["取り組みに効く", "新着"],
  "authors": ["bot@example.invalid"],
  "owner_login": "Taiki-Toku",
  "app_repo": "Taiki-Toku/netacho-app",
  "feed_checks": false
}
```
- 上は形の見本(本物の値は netacho-sync にだけ置く)。キーはこの5つだけ(多くても少なくても不正)。slots は 1〜20 個の 1〜40 字の文字列、authors は 1〜10 個のメールアドレスの形(`^[^@\s]+@[^@\s]+$`)、owner_login は GitHub のログイン名の形、app_repo は `owner/name` の形、feed_checks は真偽値
- authors の照合は大文字・小文字を区別しない

### 4.7 画像(ogimage.py。SSRF の入口として作る)
source_url は無人の AI が書く値。
- 転送(3xx)は自分で処理する(urllib の自動の転送は使わない)。3回まで(4回目は使わない)。1回ごとに全部確かめる:https であること、ポートが 443(省略を含む)であること、ホスト名を `socket.getaddrinfo` で名前解決した宛先が **すべて** 公開のアドレスであること(`ipaddress` の `is_global` が真。IPv6 の `ipv4_mapped` があれば IPv4 に戻してから確かめる)。ホストが IP アドレスそのものでも同じ検査
- 確かめた IP アドレスのどれか1つに直接つなぐ。TLS の SNI・証明書の確認・Host のヘッダーにはホスト名を使う(`http.client.HTTPSConnection` を継承して `connect()` で確かめた IP に `socket.create_connection` し、`ssl.create_default_context().wrap_socket(sock, server_hostname=host)`)
- 打ち切りの時刻は自分で持つ:1件は接続から読み終わりまで計 5 秒、1回の起動で合わせて 60 秒。ソケットの timeout は残り時間にし、少しずつ読みながら時刻を超えたら止める。読むのは先頭の 256 KB まで。Content-Type が text/html でなければ捨てる
- `<meta property="og:image">`、無ければ `<meta name="twitter:image">` の content を `html.parser` で読む。相対の URL は最後に読んだページの URL を基準に `urljoin` で直す。結果は https で、ホストがあり、空白を含まず、2000 字以内のときだけ使う。画像そのものは取りに行かない
- User-Agent は `NODAL-sync/1 (+https://github.com/Taiki-Toku/netacho-app)`。ページの中の文章は使わず、ログにも出さない
- 取りに行く部品(名前解決・接続)は差し替えられる形にして、試験ではネットワークに出ない
- 画像はすべての日の書き込みが終わった後に取る

### 4.8 watch(watch.py・ghapi.py)
ワークフローは `run --mode recent` の後に `watch` を流す。watch は次を調べ、1つでも当てはまれば終了コード 1(引数・設定・接続の失敗は 2)。
1. **未着**:items に date = 日本時間の今日の行が1つも無い
2. **載せ忘れ**(feed_checks が true のときだけ):feed_entries の digest_date が今日の行のうち、今日の items のどの related_feed_ids にも入っていない行がある
3. **一覧の取りこぼし**(feed_checks が true のときだけ):`--data-dir` に今日の `feed_digest/YYYY-MM-DD.json` が無い。または feed_entries に digest_date が null のまま first_seen_at から 24 時間を超えた行がある
4. **main の確認**:GitHub の REST API(`https://api.github.com`、urllib、`Authorization: Bearer <GITHUB_TOKEN>`、`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`、timeout 10 秒)で、app_repo の main の先頭のコミット S(`GET /repos/{app_repo}/commits/main` の sha)を取り、`GET /repos/{app_repo}/commits/{S}/pulls` の中に、merged_at があり、merge_commit_sha が S で、base.ref が main の PR があること。その PR を `GET /repos/{app_repo}/pulls/{n}` で読み、merged_by.login が owner_login であること(大文字・小文字を区別しない)。どれかが違えば当てはまり。API の失敗(5xx・時間切れ・接続の失敗)は1回だけやり直し、それでも失敗なら当てはまり。4xx はやり直さずに当てはまり。応答は 1 MB まで読み、JSON として形を確かめる
- 要約には、当てはまった項目と件数・id だけを出す(タイトルや PR の本文は出さない)
- watch の DB の接続も netacho_sync(feed_entries は select できる)

### 4.9 ログと秘密(report.py・__main__.py)
- `__main__` で全部の例外を受け、トレースバックは出さずに、決まった文と決まりの番号だけを出す(終了コード 2)
- 出力の最初に `::stop-commands::<secrets.token_hex(16)>` を出し、終わりに `::<同じ値>::` を出して戻す
- ログと要約に、JSON とページの値(タイトル・本文・URL)を出さない。出すのは件数、形を確かめた id、項目の名前(3章の表にある名前だけ。表に無い項目は名前も出さず件数だけ)、決まりの番号だけ
- 接続文字列・トークンは表示しない

## 5. 表の対応
DB の表と列は付録 C・D と、今の `supabase/migrations/0001_init.sql` にある。items の CHECK(例:id と date の食い違い、points は 5 個まで)は DB でも止まるが、検査は 3章で先に行う。

## 6. 試験(sync/tests/。pytest)
- DB を使う試験は環境変数 `NODAL_TEST_ADMIN_URL`(postgres。表の準備と後片付け)と `NODAL_TEST_SYNC_URL`(netacho_sync。同期の本体はこちらでつなぐ)を使う。無ければ skip。ただし `NODAL_REQUIRE_DB=1` のときに無ければ失敗にする(CI で skip のまま緑にならないように)。psycopg が import できないときも同じ(`NODAL_REQUIRE_DB=1` なら失敗、無ければ skip)
- 各 DB の試験の前に、admin で `delete from public.items` と `delete from public.sync_state`(item_feedback と feed_entries も空にする)をして始める
- git の試験は `tmp_path` に一時のリポジトリを作る(`git init`・`git -c user.email=… -c user.name=… commit`。作者とコミットした人は `GIT_AUTHOR_EMAIL`・`GIT_COMMITTER_EMAIL` の env で変える)。グローバルの git の設定に頼らない
- ネットワークに出ない(ogimage・ghapi は部品を差し替える)

| ID | 確かめること |
|---|---|
| TST-SYNC-01 | 3章の各決まりに外れた値(項目ごとに1つ)で、その日が不正になり、決まりの番号が出る |
| TST-SYNC-02 | 正しい見本の1日分がそのまま行の値になる(項目名の対応、空の sourceUrl は null、無い項目は既定値) |
| TST-SYNC-03 | idea で「AI提案」が無い・relatedItemIds が空なら不正 |
| TST-SYNC-04 | 表に無い項目と rating・memo は読まれず、件数だけが出る(値が出力に出ない) |
| TST-SYNC-05 | 3日のうち1日だけ不正なら、ほかの2日は書かれ、終了コードは 1 |
| TST-SYNC-06 | 2回流しても結果が同じ(2回目は追加0・更新0、synced_at も変わらない) |
| TST-SYNC-07 | 書き込みの途中で失敗した日は、その日の行が1つも変わらない(わざと DB の CHECK に掛かる行を最後に置く。検査をすり抜ける形にするため、試験では schema を通さずに db の関数を直接呼んでよい) |
| TST-SYNC-08 | 本文だけ変えても image_url は残り、source_url を変えると null に戻る |
| TST-SYNC-09 | 初回は検査を飛ばして HEAD を記録する |
| TST-SYNC-10 | 履歴を書き換えて前回のコミットが HEAD の祖先でなくなったら、何も書かずに終了コード 2 |
| TST-SYNC-11 | authors に無い作者、または authors に無いコミットした人が data/items/ を変えたら終了コード 2。マージコミットで変えた場合も止まる。feed_digest/ だけなら通る。last_commit が見つからないとき(128)も止まる |
| TST-SYNC-12 | reset_baseline で検査を飛ばし、基準が付け直される |
| TST-SYNC-13 | recent・range・all の範囲の選び方、400 日を超える range・from > to・形の違う日付は拒否 |
| TST-SYNC-14 | og:image:http の URL、443 以外のポート、プライベート・ループバック・リンクローカル・`::ffff:` で埋め込んだプライベートの宛先、名前解決の結果に1つでも非公開が混ざる、転送先が http・プライベート、4回目の転送、5 秒を超えて少しずつ届くページ、256 KB を超えるページ、text/html でないものは使わない。確かめた IP にだけつなぐ。相対の URL は直る。twitter:image に落ちる |
| TST-SYNC-15 | ログと要約に、見本の値(タイトル・URL・`::` で始まる文を入れた見本)が1つも出ない。想定外の例外でもトレースバックが出ず、終了コード 2。stop-commands の行が最初と最後にある |
| TST-SYNC-16 | watch:今日の行が無いと 1、あれば 0 |
| TST-SYNC-17 | watch:feed_checks が true で、載せ忘れ・一覧の取りこぼしがあると 1。false なら調べない |
| TST-SYNC-18 | watch:main の先頭が、オーナーがマージした PR でなければ 1(PR が無い、merge_commit_sha が違う、base が main でない、merged_by が違う)。5xx が2回続いても 1、1回目だけなら成功 |
| TST-SYNC-19 | sync_state:anon・authenticated・netacho_feed は読めず書けない/netacho_sync は upsert できるが delete できない/source が ai-netacho 以外、last_commit が 40 桁の16進でない行は入らない/0003 を2回流すと2回目は失敗し、何も変わらない(2回目は admin で、別のトランザクションで流す) |

試験の名前か docstring に TST-SYNC-xx を入れる(対応が grep で分かるように)。

## 7. CI(`.github/workflows/ci.yml`)
1. `jobs:` の `secrets:` の後(`workflow-guard:` の前)に、付録 E のジョブをそのまま足す
2. workflow-guard の grep の正規表現の末尾 `public/(_headers|_redirects|_routes\.json)$` の後に `|sync/requirements[^/]*$` を足す(依存の変更を赤にするため。package.json と同じ扱い)
3. ほかの行は変えない。違う書き方にしたいときは、理由を報告する

## 8. 依存の承認の材料(2026-11-20 に調べた値。PR の本文に貼る)
| 名前 | 版 | 用途 | 週間ダウンロード | 最終更新(この版の公開) | 代わりの手段 |
|---|---|---|---|---|---|
| psycopg | 3.3.9 | PostgreSQL への接続(本番の依存) | 約 5,706 万 | 2026-11-12 | psycopg2(古い世代)、asyncpg(非同期だけ)。標準ライブラリには無い |
| psycopg-binary | 3.3.9 | psycopg の C 実装と libpq を同梱した wheel(本番の依存) | 約 5,597 万 | 2026-11-12 | libpq を apt で入れて psycopg の純 Python 版を使う |
| typing-extensions | 4.16.0 | psycopg の依存(Python 3.12 のとき) | 約 4 億 2,349 万 | 2026-07-02 | なし(psycopg が要求) |
| pytest | 9.2.0 | 試験(開発の依存) | 約 2 億 4,198 万 | 2026-10-27 | 標準の unittest |
| iniconfig・packaging・pluggy・pygments | 2.3.1・26.3・1.7.0・2.21.0 | pytest の依存 | 約 2.4 億・4.6 億・3.2 億・2.9 億 | 2026-10-06・08-04・10-15・08-17 | なし(pytest が要求) |
- 出典:PyPI の JSON API(版・公開日・SHA-256)、pypistats.org の API(直近1週間)
- インストールは `--require-hashes --only-binary :all: --no-deps` で、ハッシュの合う wheel だけを入れる(付録 A)

## 9. 確かめること(コミットの前)
1. `python3 -m compileall -q sync` が通る
2. `python3 -m pytest` が動く環境なら `sync` で流す(DB の試験は skip になる)。動かなければ「未実行」
3. 付録 A〜D のファイルが付録と同じであること(`git diff --cached --stat` と目視)
4. 2章の表のファイルだけを `git add <ファイル>` で足し(ほかのファイルが現れていたら足さずに報告)、`git diff --cached main --output=.tmp/review.diff` を保存して、サブエージェント `pr-reviewer` にレビューさせる。重大は直して、もう一度 1〜4 を通す。中は直すか、直さない理由を報告に書く

## 10. コミットと報告
- ブランチは main から `claude/10-1-sync`。コミットは1つ。メッセージは日本語で1行、要件 ID(REQ-F-11・REQ-S-04)を入れる。記号(? など)を避け、`-m` は1つ
- 報告は日本語で、`.tmp/report-10-1.md` にも保存する:
  1. Step 0 の MCP の道具の一覧と判定
  2. 作ったファイルと構造(モジュールごとの役割、データの流れ)。危ない場所(db.py・source.py・ogimage.py・ghapi.py・__main__.py・ci.yml・マイグレーション)は、要所ごとに「何をしているか/なぜ安全か」
  3. 9章の結果
  4. pr-reviewer の指摘と対応
  5. 依頼と違う実装にした所と理由(無ければ「なし」)
  6. **テストが保証していないこと**(少なくとも:本物の Supabase のプーラーで verify-full が通ること、本物の GitHub API の応答の形、本物の配信データの形、CI の外のネットワークでの og:image の取得)
- PR の本文(pr-body の印の間):先頭に「.github/workflows/ci.yml を変えた。依存(Python)を足した」。見出しは 何をしたか/なぜ/危ない点/依存の承認の材料(8章の表)/試験とレビューの結果/テストが保証していないこと

## 11. やらないこと
- 本番・共有の DB への接続、`supabase` のコマンド、外部への通信(git の操作を除く)
- 依存のインストール(pip・npm)。付録 A に無いパッケージを使わない
- 2章の表の外のファイルを変える

## 12. オーナー向けのメモ(エージェントは読まなくてよい)
- PR では workflow-guard が赤になる(ci.yml と sync/requirements を変えるため)。check・audit・secrets・sync が緑なら、設計のチャットがレビューする
- マージの後、ブランチ保護の必須の検査に `sync` を足す(手順は設計のチャットで出す)
