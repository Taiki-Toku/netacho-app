# sync(nodal_sync)

毎朝の配信(ai-netacho の `data/items/<id>.json`)を Supabase の `items` に入れる同期の部品。
依頼文は [`docs/requests/10-1_sync.md`](../docs/requests/10-1_sync.md)。ワークフロー(netacho-sync、非公開)は別の作業。

- Python 3.12。使うのは標準ライブラリと psycopg 3 だけ(`requirements.txt`)
- DB には専用ロール `netacho_sync` でつなぐ(service_role は使わない)

## 使い方

```sh
python -m pip install --require-hashes --only-binary :all: --no-deps -r sync/requirements.txt
cd sync
python -m nodal_sync run   --config <config/sync.json> --data-dir <ai-netacho の checkout> --ca <CA 証明書> [--mode recent|range|all] [--from YYYY-MM-DD --to YYYY-MM-DD] [--reset-baseline]
python -m nodal_sync watch --config <config/sync.json> --data-dir <ai-netacho の checkout> --ca <CA 証明書>
```

| 引数 | 意味 |
|---|---|
| `--config` | 必須。設定(下の形) |
| `--data-dir` | 必須。ai-netacho を checkout した場所(git のリポジトリ) |
| `--ca` | DB の CA 証明書。localhost 以外につなぐときは必須(`sslmode=verify-full` で確かめる) |
| `--mode` | `recent`(既定。日本時間の今日を含む直近 3 日)/`range`(`--from`・`--to`、最大 400 日)/`all`(全件。genre の null を許す) |
| `--reset-baseline` | 履歴の検査を飛ばして、基準(sync_state の last_commit)を今の HEAD に付け直す |

| 環境変数 | 意味 |
|---|---|
| `SYNC_DB_URL` | DB の接続文字列(表示しない) |
| `GITHUB_STEP_SUMMARY` | あれば要約をこのファイルに追記する。無ければ標準出力 |
| `GITHUB_TOKEN` | watch の「main の確認」だけで使う |

設定(`config/sync.json`)の形。キーはこの5つだけ。本物の値は netacho-sync にだけ置く。

```json
{
  "slots": ["取り組みに効く", "新着"],
  "authors": ["bot@example.invalid"],
  "owner_login": "Taiki-Toku",
  "app_repo": "Taiki-Toku/netacho-app",
  "feed_checks": false
}
```

`--config` と同じフォルダに、ai-netacho のデータの形に合わないファイルの一覧 `ai_netacho_files.json` を置く(詳細設計 2.9。K-063)。無い・形がおかしいと `E-CONFIG-FILES`(終了コード 2)。

```json
{"files": {"CLAUDE.md": "<blob の SHA。40 桁の小文字の16進>", "tools/export.py": "<blob の SHA>"}}
```

- 作り方は設定手順書 4-7(PC の ai-netacho で `git ls-tree -r --full-tree HEAD` を流し、データの形に合わない行を全部並べる)
- 形:キーは `files` だけ。パスは 1〜300 字、SHA は 40 桁の小文字の16進、500 件まで。データの形(下)に合うパスは入れない
- オーナーが ai-netacho の tools/ などを直したら、netacho-sync のこの一覧を同じ PR で直す。直さないと次の同期が `E-SRC-TREE` で止まる。ファイルを消したときは一覧から消し、そのあと1回だけ手動の sync を `--reset-baseline` で流す(履歴に消したパスが残るため)

### 終了コード

| コード | run | watch |
|---|---|---|
| 0 | 全部正しい | 当てはまりなし |
| 1 | 不正な日・書き込みの失敗・不正なファイル(名前の形が違う・シンボリックリンク。コミットされたものはファイルの形の検査で先に 2 になるので、ふつうは一覧に入れたものだけ)のどれかがある。正しい日は書いた | 未着・載せ忘れ・一覧の取りこぼし・main の確認のどれかに当てはまる |
| 2 | 引数・設定・接続・履歴の検査・ファイルの形の検査で止まった(何も書いていない)。想定外の例外も 2(このときだけは、それまでの日を書いた後のことがある) | 引数・設定・接続で止まった |

- `--data-dir` は履歴の全部が要る(actions/checkout なら `fetch-depth: 0`)。浅い clone だと前回のコミットが見つからず、毎回「履歴の書き換え」(終了コード 2)になる

### run の流れ

1. 設定と `ai_netacho_files.json` を読む → 2. DB につなぎ、genres と sync_state を読む → 3. 履歴の検査(前回のコミットが HEAD の祖先か、`data/items/` を変えたコミットの作者とコミットした人が authors にあるか)、`data/items/` が HEAD と同じか、ファイルの形の検査(下)→
4. 日ごとの検査 → 5. 正しい日だけ、日ごとに1つのトランザクションで upsert → 6. 基準の記録 → 7. og:image の取得(最大 30 件)→ 8. 要約

### ファイルの形の検査(詳細設計 2.4 の3。K-063)

配信タスク(Web を読む無人の AI)が ai-netacho の CLAUDE.md・`.claude/`・tools/ などを書き換えたことに気づいて止める。作者は偽れるので、作者ではなくファイルの形と一覧で判定する。どれかに当たれば、何も書かずに `E-SRC-TREE`(終了コード 2)。

- データの形(パスの全体に当てる):`data/items/YYYY-MM-DD-NN.json`・`feed_digest/YYYY-MM-DD.json`・`ネタ/YYYY-MM-DD-NN.md`(`ネタ/YYYY-MM-DD-NN <題>.md` も)・`放送/YYYY-MM-DD.md`。数字は半角だけ
- 今の木(`git ls-tree -r -z --full-tree <HEAD>`。初回と `--reset-baseline` でも行う):blob でモードが 100644 でないもの(シンボリックリンク・実行ファイル・サブモジュール)、データの形に合わず一覧にも同じパスと同じ blob の SHA が無いもの、一覧にあって木に無いもの、UTF-8 で読めないパスは違反
- 履歴(`git log --full-history -m --no-renames --name-only -z --format= <前回>..<HEAD>`。初回と `--reset-baseline` では行わない):その間に変わったパスに、データの形にも一覧にも無いものがあれば違反(足して消したファイルを拾う)
- 一覧にあるファイルの中身を変えて戻したもの、`feed_digest/` の中身は、この検査では止まらない(詳細設計 2.4 の3)
- 要約に出すのは違反のパスだけ(制御文字・書式文字・行の区切りは `?`、1つ 200 字、20 件まで。超えた分は件数。Markdown の記号 `` \`*_[]()<>!|~&# `` の前には `\` を付ける)。ファイルの中身と SHA は出さない

### ログと要約に出すもの

件数、形を確かめた id、決まりの番号だけ。JSON とページの値(タイトル・本文・URL)、接続文字列、トークンは出さない。
出力の最初に `::stop-commands::<乱数>` を出し、最後に `::<同じ値>::` で戻す。

## 公式フィード(feed)

公式の障害・脆弱性のフィードを取り、解析・検査して `feed_entries` に原文を入れ、そのあと英語の行を機械翻訳する(依頼文は [`docs/requests/12-1_feed-fetch.md`](../docs/requests/12-1_feed-fetch.md)、翻訳は [`docs/requests/12-4_feed-translate.md`](../docs/requests/12-4_feed-translate.md))。翌朝のニュースへの受け渡しはまだ作っていない。

```sh
python -m nodal_sync feed --config <config/feed_sources.json> --ca <CA 証明書> [--dry-run] [--no-translate]
```

- DB には専用ロール `netacho_feed`(環境変数 `FEED_DB_URL`。表示しない)でつなぐ。`--dry-run` は取得・解析・filter までで、DB に接続しない
- 設定の形は依頼文の付録 3.3。取得先を足す・止めるのは netacho-sync の設定の PR だけ
- 起動の最初に Expat が 2.7.2 以上かを確かめる。DOCTYPE・ENTITY を含む XML は解析しない。Accept-Encoding を送らず、圧縮された応答は捨てる
- 終了コード:0=全部成功か、続けての失敗が 3 回未満/1=続けて 3 回失敗した取得先がある・全部失敗した(dry-run は1回の失敗でも 1)/2=止まった(設定・Expat の版・DB の接続・書き込みの失敗。何も書いていない)
- 要約に出すのは取得先の id・件数・決まりの番号(`E-FEED-CONFIG-*`・`E-FEED-EXPAT`・`E-FEED-DB-URL`・`E-HTTP-*`・`E-PARSE-*`・`E-ITEM-*`)だけ。記事の title・URL・本文は出さない
- 試験の名前に `TST-FEED-xx` を入れてある(`grep -rn TST-FEED- tests`)。見本のフィードは `tests/data/feed/`(架空の値だけ)

### 翻訳(feedtranslate.py。詳細設計 3.13)

- 原文の書き込みのトランザクションが終わってから、別の接続で訳す(訳の失敗で原文の保存を巻き戻さない)
- 環境変数 `AZURE_TRANSLATOR_KEY`・`AZURE_TRANSLATOR_REGION`(表示しない)の両方があるときだけ訳す。両方無い・空なら「翻訳なし(鍵なし)」。片方だけ・印字できる ASCII で 1〜200 字でないときは `E-TR-CONFIG`(終了コード 2。原文は保存済み)
- `--dry-run`・`--no-translate` では訳さない(Translator にも DB にも何も送らない)
- 宛先は `api.cognitive.microsofttranslator.com` の v3.0 だけ(TLS は標準の検証。転送は辿らない。1要求 20 秒・応答 1 MB まで・Accept-Encoding なし)
- 訳すのは pending で失敗が 3 回未満の行を新しい順に、取得先の `translate`(title・title+summary)のとおり。none・設定に無い取得先の行は pending のまま残す。1回の起動で 30,000 字まで、1要求は 100 要素・50,000 字まで
- 原文は html.escape してから送り、CVE・KB・版・製品名を `<span class="notranslate">` で囲む。訳はタグ・実体参照・制御文字を整え、title_ja 1,000 字・summary_ja 4,000 字で切る
- 保存は要求ごとに1つのトランザクション。送ったときと原文が同じ pending の行だけを done にし、`feed_translate_usage` の今月(日本時間)に `X-metered-usage`(無ければ送った字数)と要求 1 回を足す
- 今月の chars が 1,500,000 以上なら訳さない(途中で超えたらそこで止める)

| 応答 | 扱い | 番号 |
|---|---|---|
| 429・403 | その回をやめる。行は pending のまま(回数を足さない) | `E-TR-QUOTA` |
| 401 | その回をやめ、終了コード 1 | `E-TR-AUTH` |
| 400・408・3xx・5xx・時間切れ・通信の失敗 | その要求の行の回数を 1 足す。3 回で failed | `E-TR-OTHER` |
| 200 だが形が違う(長さ・to・text・圧縮) | 同上 | `E-TR-RESPONSE` |

- 要約の翻訳の行に出すのは、訳した件数・failed になった件数・失敗した要求の番号・訳さない取得先の行・pending の残り・送った字数・`X-metered-usage` の合計・今月の累計・止まった理由(`E-TR-*`・月の上限・`E-DB-*`)だけ。原文・訳・鍵は出さない
- 翻訳の失敗では終了コードを変えない。ただし 401(`E-TR-AUTH`)と、翻訳の途中の DB の失敗(`E-DB-*`。接続・読み出し・訳の保存・usage・失敗の記録)はそこで止めて 1、`E-TR-CONFIG` は 2。どれも原文の保存は済んでいて残る。取得と保存の終了コードと合わせるときは大きいほう
- 試験の名前に `TST-TR-xx` を入れてある(`grep -rn TST-TR- tests`)。Translator への送信は差し替え、ネットワークに出ない

## 公式フィードのバックアップと戻し(feedbackup.py。詳細設計 3.14、REQ-N-16)

公式フィードの行は Supabase にしか無い(RSS は新しい記事しか持たず、取り直せない)ので、毎日 netacho-sync の backup ブランチに書き出す。依頼文は [`docs/requests/12-6_feed-backup.md`](../docs/requests/12-6_feed-backup.md)。git の操作(checkout・commit・push、日付でのコミットの選び方)はワークフロー(netacho-sync)が行い、このコードはしない。

```sh
python -m nodal_sync feed-backup  --out <backup ブランチの checkout> --ca <CA 証明書>
python -m nodal_sync feed-restore --in  <backup ブランチの checkout> --ca <CA 証明書> [--dry-run]
```

- DB には `FEED_DB_URL`(netacho_feed。表示しない)でつなぐ。application_name は `nodal-backup`
- feed-backup:`feed_entries`(生成列の `sort_at` を除く全部の列)と `feed_translate_usage` を、読むだけのトランザクション(repeatable read)で読んでから、`--out` の下の `feed/` を空にし、`feed/YYYY-MM.jsonl`(first_seen_at の日本時間の月)と `usage.jsonl` を書く。`feed_source_state` は書き出さない。書くのはこの2つだけ
  - 1行に1件の JSON。キーは列の順、行は id の順(usage は month の順)。時刻は UTC の `YYYY-MM-DDTHH:MM:SS.ffffffZ`、numeric は文字列、date は `YYYY-MM-DD`。同じ中身なら同じバイト列になる
- feed-restore:先に全部の行を 0002 の列の型と CHECK で確かめ、1行でも合わなければ何も書かずに `E-RESTORE-ROW`(ファイル名と行番号だけを出す)。合えば1つのトランザクションで upsert する
  - `feed_entries`:同じ id は、上書きして中身が変わるときだけ上書きする(比べる列から updated_at と first_seen_at を外し、exploited は guard と同じ `t.exploited or excluded.exploited` と比べる。変わらない行は updated_at も変わらない)。DB にあって backup に無い行は残す。first_seen_at は DB の値のまま、exploited は true から戻らない(feed_entries_guard)
  - `feed_translate_usage`:月ごとに chars・requests の大きいほうを残す
  - `--dry-run`:検査と件数だけで、DB に接続しない
- 終了コード:0=成功(dry-run を含む)/2=止まった。feed-restore の 2 は DB に何も書いていない
- 要約に出すのは、月ごとの行数(feed-backup)、読んだ・追加・上書き・変わらないの数(feed-restore)、不正な行のファイル名と行番号だけ。行の中身は出さない
- 試験の名前に `TST-BK-xx` を入れてある(`grep -rn TST-BK- tests`)

| 番号 | 意味 |
|---|---|
| `E-BACKUP-OUT` | `--out` がフォルダでない(リンクを含む)・`feed/` がリンクか、下にフォルダがある・`usage.jsonl` がフォルダ |
| `E-BACKUP-WRITE` | ファイルを書けない |
| `E-RESTORE-FILE` | `--in`・`feed/`・`usage.jsonl` が無い、`feed/` に `YYYY-MM.jsonl` の形でない名前・リンク・256 MB を超えるファイルがある(名前は出さない) |
| `E-RESTORE-ROW` | 型・CHECK に合わない行、キーの過不足・同じキー、同じ id・同じ月の2回目の行がある |

## 翌朝のニュースへの受け渡し(feeddigest.py。詳細設計 3.15、REQ-D-06、K-037)

公式フィードに出たものを翌朝の配信タスクが記事にできるよう、毎朝の一覧を ai-netacho の `feed_digest/` に置く。依頼文は [`docs/requests/12-7_feed-digest.md`](../docs/requests/12-7_feed-digest.md)。git の操作(checkout・commit・push)はワークフロー(netacho-sync の feed.yml)が行い、このコードはしない。

```sh
python -m nodal_sync feed-digest --data-dir <ai-netacho の clone> --ca <CA 証明書> [--dry-run]
python -m nodal_sync feed-digest --data-dir <ai-netacho の clone> --ca <CA 証明書> --commit-db --date YYYY-MM-DD [--dry-run]
python -m nodal_sync feed-digest-backlog --before YYYY-MM-DD --ca <CA 証明書>
```

- DB には `FEED_DB_URL`(netacho_feed。表示しない)でつなぐ。application_name は `nodal-digest`
- feed-digest:読むだけのトランザクション(repeatable read)で、digest_date が null で first_seen_at が7日以内の行と、日本時間の今日の digest_date の行を読み、`--data-dir` の下の `feed_digest/YYYY-MM-DD.json`(日本時間の今日)を書き直す。DB は変えない。0件でも書く。7日より古い null の行は入れずに数え、要約とログに `E-DIGEST-OLD` を出す(終了コードは 0。watch の `W-DIGEST-STALE` でも気づける)
  - 形:`{"version": 1, "date": "YYYY-MM-DD", "entries": [...]}`。1件のキーは `id・kind・vendor・product・cve_ids・url・published_at・status` だけ(この順。題・本文・訳は入れない)。並びは sort_at の新しい順(同じなら id の順)。published_at は UTC の `YYYY-MM-DDTHH:MM:SSZ`、url・published_at の null は null のまま。`ensure_ascii=False`
  - 書くのはこのファイルだけ。名前は日付(dt.date)から作る。`--data-dir`・`feed_digest/`・その日のファイルがリンクなら書かずに止まる
- `--commit-db --date`:push の後に呼ぶ。その日のファイルを読み、形(キー・version・date・id が 32 桁の16進・同じ id が無い)を全部確かめてから、載った id の行のうち digest_date が null の行だけを、1つのトランザクションでその日にする。もう digest_date が付いている行は、別の日でも同じ日でも変えずに「印が付いていて変えない」に数える(3.15.2:同じ行を2つの日に載せない。2026-11-26 のレビューの決定)。合わなければ DB に何も書かずに `E-DIGEST-FILE`。`--dry-run` はファイルを確かめるだけで DB に接続しない
- feed-digest-backlog(始めるときの1回だけ):first_seen_at が `--before` の日(日本時間 0 時)より前で digest_date が null の行に、first_seen_at の日本時間の日付を付ける。どの日の一覧にも載らず、watch の 2・3 に当たらなくなる
- `--date`・`--before` は `YYYY-MM-DD` の実在する日だけ。`--date` は `--commit-db` のときだけ使える。`--before` は日本時間の今日まで(明日以降だと今日の行に今日の印が付き、今日の一覧に載ってしまうので止まる)
- ファイルは `--data-dir` と `feed_digest/` を `O_DIRECTORY|O_NOFOLLOW` で開いた fd を基準に読み書きする(確かめた後にリンクへ差し替えられても、リンクの先に書かない)
- 終了コード:0=成功(dry-run を含む)/2=止まった(何も書いていない)
- 要約とログに出すのは、日付・件数・書いたファイルのパスだけ。id・題・URL は出さない
- 試験の名前に `TST-DG-xx` を入れてある(`grep -rn TST-DG- tests`)。TST-DG-08(本番の結合テスト)は試験に無い

| 番号 | 意味 |
|---|---|
| `E-DIGEST-OLD` | 7日より古い null の行がある(一覧に入れていない。止まらない) |
| `E-DIGEST-ROW` | DB の行の id・url の形が一覧に合わない(DB の CHECK があるので、ふだんは起きない) |
| `E-DIGEST-WRITE` | `feed_digest/` かその日のファイルがリンク・フォルダ、または書けない |
| `E-DIGEST-FILE` | `--commit-db` で読むファイルが無い・リンク・4 MB を超える・形か id が正しくない |

## 決まりの番号

### 入力の JSON(schema.py)

| 番号 | 意味 |
|---|---|
| `E-JSON-UTF8` | UTF-8 で読めない |
| `E-JSON-SYNTAX` | JSON として読めない(深すぎる入れ子を含む) |
| `E-JSON-CONST` | NaN・Infinity |
| `E-DUP-KEY` | 同じキーが2回 |
| `E-JSON-TOP` | 最上位がオブジェクトでない |
| `E-FILE-SIZE` | 64 KB を超える |
| `E-FILE-READ` | 普通のファイルとして読めない |
| `E-DAY-COUNT` | 1日 30 本を超える |
| `E-ID-MISSING`・`E-ID-TYPE`・`E-ID-FORM`・`E-ID-FILENAME` | id が無い・文字列でない・形が違う・ファイル名と違う |
| `E-DATE-MISSING`・`E-DATE-TYPE`・`E-DATE-FORM`・`E-DATE-ID`・`E-DATE-FUTURE` | date が無い・文字列でない・実在の日付でない・id の先頭と違う・日本時間の明日より後 |
| `E-ORDER-MISSING`・`E-ORDER-TYPE`・`E-ORDER-RANGE` | order が無い・整数でない(真偽値を含む)・0〜999 の外 |
| `E-SLOT-MISSING`・`E-SLOT-TYPE`・`E-SLOT-VALUE` | slot が無い・文字列でない・設定の slots に無い |
| `E-GENRE-MISSING`・`E-GENRE-TYPE`・`E-GENRE-VALUE`・`E-GENRE-NULL` | genre が無い・文字列でない・DB の genres に無い・all 以外で null |
| `E-TITLE-MISSING`・`E-TITLE-TYPE`・`E-TITLE-LEN`・`E-TITLE-CTRL` | title が無い・文字列でない・1〜200 字の外・制御文字 |
| `E-LEAD-*`・`E-SUMMARY-*`・`E-EXCERPT-*`・`E-TRYIT-*`・`E-CAUTION-*`・`E-SOURCE-TITLE-*`・`E-TRUST-*` | `-TYPE`(文字列でない)・`-LEN`(字数の上限を超える)・`-CTRL`(制御文字) |
| `E-POINTS-TYPE`・`E-POINTS-COUNT`・`E-POINTS-LEN`・`E-POINTS-CTRL` | points が文字列の配列でない・0 個か 3 個でない・各 1〜300 字の外・制御文字 |
| `E-CATEGORIES-*`・`E-PROJECTS-*`・`E-TAGS-*` | `-TYPE`・`-COUNT`(20 個を超える)・`-LEN`(各 1〜50 字の外)・`-CTRL` |
| `E-URL-TYPE`・`E-URL-SCHEME`・`E-URL-HOST`・`E-URL-SPACE`・`E-URL-LEN` | sourceUrl が文字列でない・`https://` で始まらない・ホストが無い・空白や制御文字を含む・2000 字を超える |
| `E-STARS-TYPE`・`E-STARS-KEY`・`E-STARS-RANGE` | stars がオブジェクトでない・値が整数でない(真偽値を含む)・hot/use/fun 以外のキー・0〜5 の外 |
| `E-PUBLISHED-TYPE`・`E-PUBLISHED-FORM`・`E-PUBLISHED-AFTER` | publishedAt が文字列でない・実在の日付でない・date より後 |
| `E-FEED-IDS-TYPE`・`E-FEED-IDS-COUNT`・`E-FEED-IDS-FORM` | relatedFeedIds が文字列の配列でない・50 個を超える・32 桁の16進でない |
| `E-ITEM-IDS-TYPE`・`E-ITEM-IDS-COUNT`・`E-ITEM-IDS-FORM` | relatedItemIds が文字列の配列でない・10 個を超える・id の形でない |
| `E-IDEA-TAG`・`E-IDEA-RELATED` | genre が idea なのに、tags に「AI提案」が無い・relatedItemIds が空 |

制御文字(`-CTRL`)は、NUL と、改行・タブ以外の制御文字(Unicode の Cc)、対になっていないサロゲート(DB に入らない)。

### 止まったとき(終了コード 2)

| 番号 | 意味 |
|---|---|
| `E-ARGS`・`E-ARGS-DATE`・`E-ARGS-DATA-DIR` | 引数・日付の範囲・`--data-dir` が正しくない |
| `E-CONFIG-READ`・`E-CONFIG-JSON`・`E-CONFIG-KEYS`・`E-CONFIG-SLOTS`・`E-CONFIG-AUTHORS`・`E-CONFIG-OWNER`・`E-CONFIG-REPO`・`E-CONFIG-FEED-CHECKS` | 設定が読めない・形が違う |
| `E-DB-URL`・`E-DB-CONFIG`・`E-DB-CA`・`E-DB-CONNECT`・`E-DB-READ` | 接続文字列が無い・正しくない・CA 証明書が無い・接続できない・読めない |
| `E-GIT-RUN`・`E-GIT-HEAD`・`E-GIT-LOG` | git を実行できない・HEAD・履歴を読めない |
| `E-HISTORY-REWRITE` | 履歴の書き換え(前回のコミットが HEAD の祖先でない・見つからない) |
| `E-HISTORY-AUTHOR` | authors に無い作者かコミットした人が `data/items/` を変えた(マージコミットを含む) |
| `E-SRC-DIR` | `data/items/` が無い・フォルダでない |
| `E-SRC-DIRTY` | `data/items/` に未コミットの変更・追跡していないファイル・無視されたファイルがある(履歴の検査を飛ばすときも調べる) |
| `E-SRC-TREE` | ai-netacho に想定外のファイルがある(ファイルの形の検査。要約に違反のパスを出す) |
| `E-CONFIG-FILES` | `ai_netacho_files.json` が無い・読めない・形が違う |
| `E-GH-TOKEN` | watch で `GITHUB_TOKEN` が無い |
| `E-UNEXPECTED` | 想定外の例外 |

書き込みの失敗(`E-DB-WRITE`)は、その日を取り消して次の日へ進む(終了コード 1)。

### watch の当てはまり(終了コード 1)

| 番号 | 意味 |
|---|---|
| `W-NOT-ARRIVED` | 未着:items に日本時間の今日の行が無い |
| `W-FEED-MISSED` | 載せ忘れ:今日渡した公式フィードが、今日の items のどの related_feed_ids にも無い(feed_checks のときだけ) |
| `W-DIGEST-FILE` | 一覧の取りこぼし:今日の `feed_digest/YYYY-MM-DD.json` が無い(feed_checks のときだけ) |
| `W-DIGEST-STALE` | 一覧の取りこぼし:digest_date が null のまま 24 時間を超えた行がある(feed_checks のときだけ) |
| `W-MAIN-NO-PR`・`W-MAIN-MERGED-BY`・`W-MAIN-API` | main の先頭が、マージされた main 向けの PR でない・オーナーのマージでない・API で確かめられない |

## 試験

```sh
python -m pip install --require-hashes --only-binary :all: --no-deps -r sync/requirements.txt -r sync/requirements-dev.txt
cd sync
python -m pytest -q
```

- DB を使う試験は `NODAL_TEST_ADMIN_URL`(postgres)と `NODAL_TEST_SYNC_URL`(netacho_sync)が要る。無ければ skip。`NODAL_REQUIRE_DB=1` なら skip せずに失敗にする
- DB の準備は CI の `sync` ジョブ(`.github/workflows/ci.yml`)と同じ:`tests/sql/supabase_mock.sql` → `supabase/migrations/0001`〜`0003` → `alter role netacho_sync login`
- ネットワークには出ない(og:image と GitHub の API は部品を差し替える)
- 試験の名前か docstring に `TST-SYNC-xx` を入れてある(`grep -rn TST-SYNC- tests`)
