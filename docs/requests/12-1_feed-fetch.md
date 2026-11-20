# 依頼 12-1:公式フィードの取得と保存(python -m nodal_sync feed。K-036・K-040)

## 目的
詳細設計 3章(netacho-infra の docs/03_詳細設計書.md v0.5、2026-11-20)を作る。設計の本文はこの依頼文の末尾の「付録:詳細設計 3章」に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。
基本設計 4章の取得 → 解析 → 検査 → 原文の保存。翻訳(4.6)・翌朝のニュースへの受け渡し(4.10)・backup は作らない。

## 変えるファイル
- 足す:`sync/nodal_sync/feedconfig.py`、`feedhttp.py`、`feedparse.py`、`feeddb.py`
- 変える:`sync/nodal_sync/__main__.py`(引数 feed と --dry-run、終了コード、決まった文)、`sync/nodal_sync/report.py`(feed の要約)
- 試験:`sync/tests/test_feed_config.py`、`test_feed_http.py`、`test_feed_parse.py`、`test_feed_db.py`、`test_feed_main.py`、見本 `sync/tests/data/feed/`(架空の値だけ。本物の記事の文を写さない)
- `sync/README.md`(feed の使い方を数行)
- この依頼文 `docs/requests/12-1_feed-fetch.md`
- 変えないもの:`ogimage.py`(import して使うだけ)、`requirements*.txt`(依存を足さない)、`supabase/migrations/`、`.github/`、`src/`。既存の試験の期待値は変えない(足すだけ)

## 作り方の決まり
- 標準ライブラリと psycopg だけ。feedparser・defusedxml・requests・PyYAML などを足さない(基本設計 4.4、オーナー決定)
- XML は付録 3.5 の守り(Expat 2.7.2 以上の確認、DOCTYPE・ENTITY の拒否、xml.etree)。`xml.dom.minidom`・`xml.sax` を直接使わない
- 外との通信は feedhttp.py だけ。試験ではネットワークに出ない(resolver・connector・clock を差し替える。ogimage.py の試験と同じ作り)
- ログと要約に記事の title・URL・本文を出さない。出すのは id・件数・決まりの番号だけ(付録 3.8)
- SQL は psycopg の sql.SQL と値の引数で組む(文字列の連結で値を入れない)
- 型ヒントを付ける。関数の頭に、何をするかと、なぜその守りが要るかを短く書く

## 試験
付録 3.11 の TST-FEED-01〜19 を作る(試験の名前に ID を入れる)。DB の試験は既存の conftest の作り(PostgreSQL 16、0001〜0003 を流した土台、DB が無ければ飛ばす)に合わせ、書き込みは `set role netacho_feed` で行う。TST-FEED-04 は「今の Python の pyexpat.EXPAT_VERSION が 2.7.2 以上であること」も確かめる(CI の Python で落ちたら止まって報告)。

## 確かめること
1. `cd sync && python -m pytest`(DB の試験が飛ばされた数も報告に書く。CI の sync のジョブで全部流れる)
2. `npm run lint` と `npm run build`(Python だけの変更でも、既存が壊れていないことを見る)
3. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
4. 外部の通信・DB の書き込み・ワークフローが動かすコードに触れるので、pr-reviewer にレビューさせる。重大は直して再レビュー、中は直すか理由を報告に書く

## 報告
- 部品ごとに、何をしているかと、なぜ安全か(CLAUDE.md の説明のルール。feedhttp.py・feedparse.py の XML の守り・feeddb.py は行ごと)
- 試験の結果(飛ばした数を含む)、pr-reviewer の結果、セキュリティの規約で確かめたこと
- テストが保証していないこと(少なくとも:本物の取得先の形(要素の名前、statuspage の計画メンテナンスの書き方、JVN の sec:cvss)は見本で作ったので、本番の dry_run(TST-FEED-20)で確かめる/取得先の URL が正しいか/本番の netacho_feed の権限)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く(何をしたか/なぜ/危ない点/試験とレビューの結果/テストが保証していないこと)。題は「公式フィードの取得と保存(K-036・K-040、依頼 12-1)」

## 付録:詳細設計 3章
### 3. 公式フィードの取得と保存(REQ-F-13〜15・REQ-S-02・S-04・S-11。基本設計 4章。K-036・K-040)
#### 3.1 範囲(v0.5)
- この版で作るもの:取得 → 解析 → 検査 → 原文の保存(基本設計 4.4 の 1〜4・6)と、そのワークフロー。取得先は 障害 → 脆弱性 の順(基本設計 4.2)。プロダクトのリリース・サポート終了は、取得先を設定に足すだけで入る作りにし、一覧は後で足す
- 後に回すもの:機械翻訳(基本設計 4.6。F0 の作成と従量課金への切り替えが要る)、訳の表示(8.3 の①。design_spec v3.9)、翌朝のニュースへの受け渡し(4.10。配信タスクの直し K-037 と一緒)、backup ブランチへの書き出しと restore-feed(6章)
- 訳を後に回しても動く:訳は原文の後に別に入れる作りで、訳が無ければ原文だけを出す(基本設計 4.1)。英語の行は translate_status が pending のまま貯まり、翻訳を作ったときに新しい順に訳す

#### 3.2 部品と置き場
同期と同じく、コードは netacho-app の sync/、設定とワークフローは netacho-sync に置く(基本設計 2.5)。新しい依存は足さない(標準ライブラリと psycopg だけ)。
```
sync/nodal_sync/
  __main__.py      引数に feed を足す(python -m nodal_sync feed [--dry-run])
  feedconfig.py    3.3 の設定の読み込みと検査
  feedhttp.py      3.4 の取得(ogimage.py の check_url・is_public_ip・resolve・connect_pinned・watchdog を import して使う。ogimage.py は変えない)
  feedparse.py     3.5 の解析と検査。結果は「正しい記事」と「決まりの番号つきの不正」
  feeddb.py        3.6・3.7 の書き込み(netacho_feed)
  report.py        feed の要約を足す(3.8)
sync/tests/        test_feed*.py と、見本のフィード(tests/data/feed/。架空の値だけ)
```

#### 3.3 設定(netacho-sync の config/feed_sources.json)
```json
{
  "watch_products": ["CyberArk", "AdminONE", "ESS REC", "Heimdal", "..."],
  "sources": [
    {
      "id": "github-status", "kind": "outage", "vendor": "GitHub", "product": "GitHub",
      "format": "atom", "url": "https://www.githubstatus.com/history.atom",
      "lang": "en", "translate": "title+summary", "filter": "statuspage-incident", "enabled": true
    }
  ]
}
```
| 項目 | 決まり |
|---|---|
| watch_products | 担当製品・使用ツールの名前(基本設計 4.2)。1〜200 個、1つ 1〜60 字。大文字・小文字は区別しない。部分一致で使うので、2字以下の名前は不可(誤って何にでも当たるため) |
| id | `^[a-z0-9][a-z0-9-]{0,39}$`(0002 の source_id の CHECK と同じ)。重複は不可 |
| kind | release / eol / change / exam / vuln / outage |
| vendor, product | 1〜100 字。kev-json では記事の値で上書きする(3.5) |
| format | rss2 / atom / rss1 / kev-json |
| url | `https://` で始まり 2,000 字まで |
| lang | en / ja |
| translate | none / title / title+summary(今は保存するだけ。翻訳を作ったときに使う) |
| filter | all / statuspage-incident / watch-products / watch-products-or-cvss9 / kev(3.5 の表) |
| enabled | true / false |
| max_bytes | 省略可。既定 2 MB、上限 8 MB(KEV の一覧は 1 本の JSON で大きいため) |
| max_age_days | 省略可。既定 14、1〜90。公開日がこれより古い記事は入れない(3.6) |
- 表に無いキー、型の違い、取得先 0 件・50 件超は、設定の誤りとして何もせずに終了コード 2(E-FEED-CONFIG-*)。ファイルは 64 KB まで
- 取得先を足す・止めるのは netacho-sync の PR だけ(コードは変えない。REQ-F-13)。filter の種類を足すときはコードの変更になる

**最初の取得先(この版。URL はすべて【推測】。二次情報と各社のページの要約で見た値で、最初の手動の起動(TST-FEED-20)で取れることを確かめる。取れなかったものは enabled を false にし、ここに理由を書く)**
| id | kind | 取得先 | format | filter | 根拠 |
|---|---|---|---|---|---|
| github-status | outage | https://www.githubstatus.com/history.atom | atom | statuspage-incident | GitHub の障害のページの「Atom Feed」のリンク |
| cloudflare-status | outage | https://www.cloudflarestatus.com/history.atom | atom | statuspage-incident | 二次情報(feeder.co の一覧) |
| claude-status | outage | https://status.claude.com/history.atom | atom | statuspage-incident | Claude の障害のページの「Atom」のリンク |
| azure-status | outage | https://rssfeed.azure.status.microsoft/en-us/status/feed/ | rss2 | all | 二次情報。Azure の公開の障害だけが出る(Microsoft Learn の Azure status overview に RSS があると書かれている) |
| aws-status | outage | https://status.aws.amazon.com/rss/all.rss | rss2 | all | 二次情報。AWS の公式の文書に「RSS の形は変わることがある」とある【推測】ので、取れなくなったら止める |
| cisa-kev | vuln | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | kev-json | kev | 二次情報。cisa.gov は自動の取得を制限することがあるという記載がある【推測】。拒否されたら、CISA の GitHub(cisagov/kev-data)の写しに替える案を検討する |
| jvn-new | vuln | https://jvndb.jvn.jp/ja/rss/jvndb_new.rdf | rss1 | watch-products-or-cvss9 | 【推測】(JVN iPedia の新着の RSS) |
- Supabase の障害のページには、RSS・Atom のリンクが見当たらなかった【未確認】。今回は入れない
- watch_products の本物の一覧は、オーナーが netacho-sync で決める(K-036 の①の製品と、使用ツール:GitHub、Cloudflare、Supabase、Azure、AWS、Claude、Docker、Ubuntu など)

#### 3.4 取得(feedhttp.py。基本設計 4.4 の1)
設定の URL はオーナーが書く値だが、転送先は相手が決めるので、og:image と同じ守り(2.10)で取る。
- 転送は自分で処理し 3 回まで。1回ごとに check_url(https・443・空白なし)と、名前解決したすべての宛先が公開のアドレスであることを確かめ、確かめた IP に直接つなぐ(ogimage.py の部品を使う)
- 条件付きの GET:feed_source_state の etag を If-None-Match、last_modified を If-Modified-Since で送る。304 は「変化なし」で成功に数える
- ヘッダー:User-Agent `NODAL-feed/1 (+https://github.com/Taiki-Toku/netacho-app)`、Accept は format に合わせる。**Accept-Encoding は送らない**(圧縮された応答を受けない。展開の爆弾を避けるため)。Content-Encoding が付いた応答は捨てる
- 打ち切り:1つの取得先は接続から読み終わりまで 10 秒、1回の起動で合わせて 300 秒。大きさは max_bytes(既定 2 MB)。超えたら、その取得先の失敗
- 受け入れる Content-Type:xml・rss・atom・json を含むもの、または text/plain(一部の取得先が XML を text/plain で返すため)。それ以外は失敗
- 失敗の種類は決まりの番号だけを残す:E-HTTP-STATUS、E-HTTP-TYPE、E-HTTP-SIZE、E-HTTP-TIME、E-HTTP-ADDR(公開のアドレスでない)、E-HTTP-REDIRECT、E-HTTP-ENCODING、E-HTTP-NET
- 取得先どうしは順番に取る(並列にしない。時間の上限の中で足りるため)

#### 3.5 解析と検査(feedparse.py。基本設計 4.4 の2・3)
**XML の守り(2026-11-20 オーナー決定。基本設計 4.4)**
1. 起動の最初に `pyexpat.EXPAT_VERSION` が 2.7.2 以上であることを確かめ、満たさなければ何もせずに終了コード 2(E-FEED-EXPAT)
2. 本文の先頭 4 KB を含む全体に `<!DOCTYPE` または `<!ENTITY` があれば(大文字・小文字を区別しない)、解析せずにその取得先の失敗(E-PARSE-DTD)。RSS・Atom に DTD は要らない
3. `xml.etree.ElementTree.fromstring` で読む。解析の失敗は E-PARSE-XML。JSON は `json.loads`(E-PARSE-JSON)

**形ごとの読み方**(「→」の左が元の要素、右が feed_entries の列)
| format | 1件 | guid | title | url | summary | published_at |
|---|---|---|---|---|---|---|
| rss2 | channel/item | guid、無ければ link | title | link | description | pubDate(RFC 822。email.utils) |
| atom | entry | id | title | link の rel が alternate(または rel なし)の href | summary、無ければ content | published、無ければ updated(ISO 8601) |
| rss1 | rdf:RDF/item | rdf:about | title | link | description | dc:date |
| kev-json | vulnerabilities[] | cveID | `{vendorProject} {product}: {vulnerabilityName}` | `https://nvd.nist.gov/vuln/detail/{cveID}` | shortDescription | dateAdded(日付。00:00 UTC とする) |
- 文字の整え方:HTML の実体参照を戻し、タグを html.parser で取り除き、空白をまとめる。制御文字(改行・タブ以外)は除く。title は 500 字、summary は 2,000 字で切る(0002 の CHECK に合わせる)
- id:`sha256(source_id + "\n" + guid)` の先頭 32 桁(0002 の CHECK)。guid が空の記事は飛ばす(E-ITEM-GUID)
- url:https で 2,000 字以内のときだけ入れ、それ以外は null(記事は残す。リンクを出さないだけ)
- published_at:読めなければ null(並びは first_seen_at)。未来の日時(今より 1 日を超えて先)は null にする
- 脆弱性の項目:
  - cve_ids:title と summary(rss1 は sec:identifier なども)から `CVE-\d{4}-\d{4,7}` を拾い、重複を除いて 50 個まで(0002 の CHECK)
  - rss1(JVN)の CVSS:sec:cvss の score 属性の最大値を cvss、severity 属性を小文字にして severity に入れる(critical・high・medium・low 以外は null)。要素の名前は【推測】で、見本の取得(3.10 の1)で確かめてから見本のフィードを作る
  - kev-json:exploited を true、severity・cvss は null(画面では「未評価」。基本設計 4.5)。vendor は vendorProject、product は product(100 字で切る)
- 障害の status(40 字):statuspage の記事は summary の先頭の語で決める(Resolved → 復旧済み、Monitoring → 監視中、Identified → 原因を特定、Investigating → 調査中、それ以外は空)。並びの語は【推測】で、見本で確かめる
- 不正な記事(title が空、kind に合わない値など)は飛ばして、決まりの番号ごとに数える(基本設計 4.1)。記事の中身はログに出さない

**filter**(基本設計 4.2 の「入れるものを絞る」)
| filter | 入れる記事 |
|---|---|
| all | すべて |
| statuspage-incident | 計画メンテナンス以外。summary に `THIS IS A SCHEDULED EVENT`(大文字・小文字を区別しない)を含む記事は入れない【推測。statuspage の計画メンテナンスの記事の書き方。見本で確かめる】 |
| watch-products | title か summary に watch_products のどれかを含む |
| watch-products-or-cvss9 | watch-products に当たる、または cvss が 9.0 以上 |
| kev | すべて(KEV に載ったものは全部入れる。基本設計 4.2) |

#### 3.6 保存(feeddb.py。基本設計 4.4 の4・4.5)
- 接続は同期と同じ形(2.7):`FEED_DB_URL`(netacho_feed、共有プーラー、5432)、verify-full、`application_name=nodal-feed`
- 1回の起動の書き込みは、全部の取得先の分を1つのトランザクションで行う。取得(外との通信)は全部終えてから書く(トランザクションの中で外と通信しない)
- **入れる記事**:published_at が max_age_days(既定 14 日)より古い記事は入れない(数えるだけ)。KEV の一覧は毎回すべての脆弱性を返すので、これが無いと初回に千件以上入るため。published_at が無い記事は入れる
- **新しい記事**:insert。translate_status は lang が ja なら skip、en なら pending
- **ある記事**(同じ id):title・summary・url・published_at・status が変わったときだけ update。title か summary が変わり lang が en なら、title_ja・summary_ja・translated_at を null、translate_status を pending、translate_attempts を 0 に戻す(古い訳を出さない)。first_seen_at・exploited は 0002 の feed_entries_guard が守る
- **同じ CVE は1行にまとめる**(基本設計 4.5):脆弱性の新しい記事の cve_ids のどれかが、既にある行の cve_ids に入っていれば、新しい行は作らず、最も古い行(first_seen_at が最小)を更新する
  - 新しい記事が KEV:その行の exploited を true にする
  - 新しい記事が JVN:その行の severity・cvss を JVN の値にし(JVN を優先)、cve_ids に足りない CVE を足す(50 個まで)。url は元の行のまま
  - 1つの記事が2つ以上の行に当たるときも、最も古い1行だけを更新する(行は消せないので、まとめきれない分は残る)
- feed_source_state:取得先ごとに last_attempt_at、成功なら last_success_at・etag・last_modified と consecutive_failures を 0、失敗なら consecutive_failures を 1 足し、last_error に決まりの番号だけを入れる
- `--dry-run`:取得と解析と filter まで行い、DB には書かない(接続もしない)。件数の要約だけを出す。取得先を足すときの確認に使う

#### 3.7 失敗の判断と終了コード(基本設計 4.4 の6)
| 終了コード | 当てはまるとき |
|---|---|
| 0 | 全部の取得先が成功(304 を含む)、または失敗が続けて 3 回に届いていない |
| 1 | どれかの取得先の consecutive_failures が 3 以上になった、または有効な取得先が全部失敗した(失敗メールが届く) |
| 2 | 止まった:設定の誤り、Expat の版、DB に接続できない、書き込みの失敗(何も書いていない) |
- `--dry-run` では feed_source_state を読まないので、1回の失敗でも終了コード 1 にする(足す前の確認のため)

#### 3.8 ログと要約(2.11 と同じ決まり)
- 出力の最初に `::stop-commands::<乱数>`、終わりに戻す。例外はトレースバックを出さずに決まった文と番号だけ
- 要約は取得先ごとに1行:id、結果(ok / 304 / 失敗の番号)、記事の数、入れた・更新した・まとめた・古くて入れない・filter で外した・不正(番号ごとの数)。記事の title・URL・本文は出さない(外のデータに `::` の行があっても命令として読まれないように)
- 合計:取得先の数、成功・失敗、新しい行の数、pending の行の数

#### 3.9 ワークフロー(netacho-sync の feed.yml。基本設計 4.3)
| 項目 | 値 |
|---|---|
| 起動 | cron `35 */2 * * *` と workflow_dispatch(入力 dry_run:true / false) |
| permissions | contents: read |
| concurrency | group `nodal-feed`、cancel-in-progress: false(sync・watch と分ける) |
| timeout-minutes | 10 |
| 手順 | 自分を checkout → app-ref.txt の形を確かめる → netacho-app をその SHA で checkout → setup-python → `pip install --require-hashes --only-binary :all: --no-deps -r sync/requirements.txt` → `python -m nodal_sync feed --config config/feed_sources.json --ca config/supabase-ca.crt`(dry_run のときは `--dry-run`) |
- アクションは sync.yml と同じ SHA で固定する。入力は env で渡す。`FEED_DB_URL` は python の step にだけ渡す。ai-netacho は checkout しない(受け渡しの 4.10 を作るまで要らない。デプロイキーを渡さない)
- cron は最初から有効にする(同期と違い、ai-netacho のデータを待たない)。ただし、翌朝のニュースへの受け渡し(4.10)を作るときに、それより前に入った行をどう扱うか(渡さない印を付けるなど)を決める(3.12)
- 置き場:netacho-infra の `drafts/netacho-sync/`(feed.yml と config/feed_sources.json の見本)。オーナーが netacho-sync に写す(設定手順書 4-4 を足す)

#### 3.10 構築の順番
1. 依頼 A1(netacho-app の docs/requests/12-1_feed-fetch.md):3.2〜3.8 と試験 TST-FEED-01〜19。sync/ と .github/(ci.yml を変える場合)に触れるので pr-reviewer を付ける。見本のフィードは架空の値で作り、形は各社の公開の文書と、VM から取れるなら本物の取得結果(中身は入れず、要素の名前だけを使う)に合わせる
2. Claude:drafts/netacho-sync/ に feed.yml と feed_sources.json、設定手順書 4-4(netacho_feed のパスワード、Secrets の FEED_DB_URL、写して push、手動の起動)を書く
3. オーナー:A1 のマージ、設定手順書 4-4
4. Claude:TST-FEED-20(dry_run → 本番)を、オーナーが貼る要約と本番の画面(A2 の後)で確かめる。取れなかった取得先を止める PR の文面を出す

#### 3.11 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-FEED-01 | 設定の各決まりに外れた値(項目ごとに1つ)で、何もせずに終了コード 2 と決まりの番号 | pytest |
| TST-FEED-02 | rss2・atom・rss1・kev-json の見本が、3.5 の表のとおりの列の値になる | pytest |
| TST-FEED-03 | DOCTYPE・ENTITY を含む XML(billion laughs の形を含む)は解析せずに E-PARSE-DTD | pytest |
| TST-FEED-04 | Expat の版が 2.7.2 未満と見なしたとき終了コード 2。CI の Python の版が 2.7.2 以上であること | pytest |
| TST-FEED-05 | タグ・実体参照・制御文字が除かれ、500 字・2,000 字で切れる。https 以外の url は null | pytest |
| TST-FEED-06 | 読めない・未来の公開日は null | pytest |
| TST-FEED-07 | CVE の拾い方(重複、50 個まで、形の違うもの)と、JVN の CVSS・severity | pytest |
| TST-FEED-08 | filter の5種類。statuspage の計画メンテナンスが外れる。2字以下の watch_products は設定の誤り | pytest |
| TST-FEED-09 | 不正な記事は飛ばして番号ごとに数え、ほかの記事は入る | pytest |
| TST-FEED-10 | 転送・宛先・大きさ・時間・Content-Type・Content-Encoding の守り(TST-SYNC-14 と同じ形)。Accept-Encoding を送らない | pytest(取得の部品を差し替える) |
| TST-FEED-11 | 条件付きの GET の送り方と、304 で何も書かずに成功 | pytest |
| TST-FEED-12 | 2回流しても結果が同じ(2回目は追加 0・更新 0) | pytest(DB) |
| TST-FEED-13 | 古い記事(max_age_days 超え)は入らない | pytest(DB) |
| TST-FEED-14 | title が変わった en の行は訳が消えて pending に戻る。first_seen_at は変わらない | pytest(DB) |
| TST-FEED-15 | 同じ CVE のまとめ方(KEV が後、JVN が後、2行に当たる場合) | pytest(DB) |
| TST-FEED-16 | consecutive_failures の数え方と終了コード(1回の失敗は 0、3回目で 1、全部失敗で 1)。dry-run は DB に接続しない | pytest(DB) |
| TST-FEED-17 | ログと要約に見本の title・URL・`::` で始まる文が出ない。想定外の例外でもトレースバックが出ない | pytest |
| TST-FEED-18 | netacho_feed で書き込みが通り、削除はできない(0002 の試験 k をこの部品で) | pytest(DB) |
| TST-FEED-19 | 書き込みの途中で失敗したら、どの行も変わらない | pytest(DB) |
| TST-FEED-20 | 本番:dry_run で取得先ごとの結果を見る → 本番の起動で行が入り、2回目は追加が少ない。cron の回が成功する | 構築で(オーナーが Actions の要約を貼る) |

#### 3.12 決めていないこと
| 件 | 決める場 |
|---|---|
| watch_products の本物の一覧 | オーナー(netacho-sync の設定。3.10 の3) |
| プロダクトのリリース・サポート終了の取得先 | 障害・脆弱性が動いた後に、取得先を足す PR で |
| 受け渡し(4.10)より前に入った行の扱い | 受け渡しの詳細設計(K-037) |
| 1日の件数(目安 10 本)に合わせた filter の詰め | 最初の2週間の実測(基本設計 4.2) |
