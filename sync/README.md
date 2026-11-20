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

### 終了コード

| コード | run | watch |
|---|---|---|
| 0 | 全部正しい | 当てはまりなし |
| 1 | 不正な日・書き込みの失敗・不正なファイル(名前の形が違う・シンボリックリンク)のどれかがある。正しい日は書いた | 未着・載せ忘れ・一覧の取りこぼし・main の確認のどれかに当てはまる |
| 2 | 引数・設定・接続・履歴の検査で止まった(何も書いていない)。想定外の例外も 2(このときだけは、それまでの日を書いた後のことがある) | 引数・設定・接続で止まった |

- `--data-dir` は履歴の全部が要る(actions/checkout なら `fetch-depth: 0`)。浅い clone だと前回のコミットが見つからず、毎回「履歴の書き換え」(終了コード 2)になる

### run の流れ

1. 設定を読む → 2. DB につなぎ、genres と sync_state を読む → 3. 履歴の検査(前回のコミットが HEAD の祖先か、`data/items/` を変えたコミットの作者とコミットした人が authors にあるか)→
4. 日ごとの検査 → 5. 正しい日だけ、日ごとに1つのトランザクションで upsert → 6. 基準の記録 → 7. og:image の取得(最大 30 件)→ 8. 要約

### ログと要約に出すもの

件数、形を確かめた id、決まりの番号だけ。JSON とページの値(タイトル・本文・URL)、接続文字列、トークンは出さない。
出力の最初に `::stop-commands::<乱数>` を出し、最後に `::<同じ値>::` で戻す。

## 公式フィード(feed)

公式の障害・脆弱性のフィードを取り、解析・検査して `feed_entries` に原文を入れる(依頼文は [`docs/requests/12-1_feed-fetch.md`](../docs/requests/12-1_feed-fetch.md))。翻訳と翌朝のニュースへの受け渡しはまだ作っていない。

```sh
python -m nodal_sync feed --config <config/feed_sources.json> --ca <CA 証明書> [--dry-run]
```

- DB には専用ロール `netacho_feed`(環境変数 `FEED_DB_URL`。表示しない)でつなぐ。`--dry-run` は取得・解析・filter までで、DB に接続しない
- 設定の形は依頼文の付録 3.3。取得先を足す・止めるのは netacho-sync の設定の PR だけ
- 起動の最初に Expat が 2.7.2 以上かを確かめる。DOCTYPE・ENTITY を含む XML は解析しない。Accept-Encoding を送らず、圧縮された応答は捨てる
- 終了コード:0=全部成功か、続けての失敗が 3 回未満/1=続けて 3 回失敗した取得先がある・全部失敗した(dry-run は1回の失敗でも 1)/2=止まった(設定・Expat の版・DB の接続・書き込みの失敗。何も書いていない)
- 要約に出すのは取得先の id・件数・決まりの番号(`E-FEED-CONFIG-*`・`E-FEED-EXPAT`・`E-FEED-DB-URL`・`E-HTTP-*`・`E-PARSE-*`・`E-ITEM-*`)だけ。記事の title・URL・本文は出さない
- 試験の名前に `TST-FEED-xx` を入れてある(`grep -rn TST-FEED- tests`)。見本のフィードは `tests/data/feed/`(架空の値だけ)

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
