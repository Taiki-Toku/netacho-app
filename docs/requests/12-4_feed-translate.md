# 依頼 12-4:公式フィードの機械翻訳(K-047。詳細設計 3.13)

## 目的
詳細設計 3.13(netacho-infra の docs/03_詳細設計書.md v0.6、2026-11-25)を作る。本文は末尾の付録に写した。付録と食い違う作り方が必要になったら、作らずに止まって報告する。

## 変えるファイル
- 足す:`sync/nodal_sync/feedtranslate.py`、`sync/tests/test_feed_translate.py`
- 変える:`sync/nodal_sync/__main__.py`(保存の後に翻訳、--no-translate、終了コード)、`sync/nodal_sync/report.py`(翻訳の要約)、`sync/nodal_sync/feeddb.py`(訳す行の読み出し・保存・usage。必要な分だけ)、`sync/README.md`
- この依頼文 `docs/requests/12-4_feed-translate.md`
- 変えないもの:`ogimage.py`、`requirements*.txt`(依存を足さない。HTTP は http.client と ssl)、`supabase/migrations/`、`.github/`、`src/`。既存の試験の期待値は変えない(足すだけ)

## 作り方の決まり
- 標準ライブラリと psycopg だけ
- Translator への送信は feedtranslate.py だけ。宛先のホストは定数1つ。試験ではネットワークに出ない(送る部品を差し替える)
- 鍵は環境変数から読むだけ。ログ・要約・例外の文・試験のデータに出さない(試験の鍵は架空の文字列)
- SQL は psycopg の sql.SQL と値の引数で組む
- 外から来た文字(原文・訳)は信用しないデータとして扱う。送る前に html.escape、受け取った後にタグと制御文字を除く

## 試験
付録 3.13.9 の TST-TR-01〜09(名前に ID を入れる)。DB の試験は既存の conftest の作り。

## 確かめること
1. `cd sync && python -m pytest`(この VM で動かせない試験は、飛ばした数を報告に書く。CI の sync のジョブで全部流れる)
2. `npm run lint` と `npm run build`
3. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
4. 外部への送信・秘密の値・DB の書き込みに触れるので、pr-reviewer にレビューさせる。重大は直して再レビュー、中は直すか理由を報告に書く

## 報告
- 部品ごとに、何をしているかと、なぜ安全か(feedtranslate.py と feeddb.py の変更は行ごと)
- 試験の結果、pr-reviewer の結果、セキュリティの規約で確かめたこと(秘密の値・外のデータ・依存)
- テストが保証していないこと(少なくとも:本物の Translator の応答の形と X-metered-usage、notranslate が本当に守られるか、F0 の上限のときの本物のエラーの番号。TST-TR-10 で確かめる)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「公式フィードの機械翻訳(K-047、依頼 12-4)」

## 付録:詳細設計 3.13
#### 3.13 機械翻訳(feedtranslate.py。基本設計 4.6・4.9、K-047。v0.6 2026-11-25)
##### 3.13.1 範囲と流れ
- 取得と保存(3.4〜3.7)が終わった後に、同じ `python -m nodal_sync feed` の中で訳す。原文の書き込みのトランザクションが終わってから始める(訳の失敗で原文の保存を巻き戻さない)
- 環境変数 `AZURE_TRANSLATOR_KEY` と `AZURE_TRANSLATOR_REGION` の両方があるときだけ訳す(空の文字列は「無い」と同じ。Secrets が無いと Actions は空の文字列を渡すため)。どちらも無ければ訳さずに要約に「翻訳なし(鍵なし)」と出す(F0 を作る前でも feed が動くように)。片方だけあるのは設定の誤りとして終了コード 2(E-TR-CONFIG。原文の保存は済んでいる)
- `--dry-run` と `--no-translate` では訳さない(外にも DB にも何も送らない)
- 使う API:Translator の v3.0(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=ja&textType=html`)。v3.0 は `textType=html` と notranslate の印が文書に書かれている。新しい GA の版 2026-06-06 は v3.0 と互換が無い変更を含み【確認済み】、F0 と notranslate の扱いを確かめていないので、今は使わない。v3.0 の終わりが告知されたら見直す(運用の点検で年に1回見る)

##### 3.13.2 訳す行の選び方
- `translate_status = 'pending'` かつ `translate_attempts < 3` の行を `sort_at` の新しい順に読む(索引 feed_entries_pending_idx)
- 行の source_id を今の設定(3.3)で引き、`translate` が title なら title だけ、title+summary なら title と summary を訳す。none、または設定から消えた取得先の行は訳さずに pending のまま残す(取得先を戻したときに訳せるように。数えて要約に出す)
- 送る文字の数(下の 3.13.3 の印を付けた後の長さ)を足していき、1回の起動の上限 30,000 字を超える手前で止める(基本設計 4.6)

##### 3.13.3 送る文字と、訳さない印
1. 原文を HTML の文字として安全にする(`html.escape`。`<`・`>`・`&`・引用符を実体参照にする)。これで、原文の中のタグのような文字が HTML として解釈されない
2. 次の語を `<span class="notranslate">…</span>` で囲む(重なったときは長いほうを優先し、二重に囲まない)
   - CVE の番号(`CVE-\d{4}-\d{4,7}`)、KB の番号(`KB\d{6,8}`)
   - 版(`v?\d+(\.\d+){1,3}`。前後が英数字でないもの)
   - watch_products の名前と、その行の vendor・product(大文字・小文字を区別しない。長い順に当てる)
3. summary は、1 の前の原文で先頭 400 字に切る(語の途中でもよい)
4. 1件の文字が 1,000 字を超えたら(印で長くなった場合)、その項目は印なしで送る

##### 3.13.4 送り方(Translator)
- 1回の要求は最大 100 件・合わせて 50,000 字まで(サービスの上限は 1,000 件・50,000 字【確認済み】)。title と summary は別の要素として送り、順番で対応づける
- ヘッダー:`Ocp-Apim-Subscription-Key`、`Ocp-Apim-Subscription-Region`(5-7 の地域。`japaneast`)、`Content-Type: application/json; charset=UTF-8`、`X-ClientTraceId`(要求ごとの乱数。障害の問い合わせ用)
- 宛先はコードに書いた1つのホストだけ。TLS の証明書は標準の検証、転送は辿らない(3xx は失敗)。打ち切りは1要求 20 秒(サービスの最大の待ち時間は 15 秒【確認済み】)、応答は 1 MB まで、Accept-Encoding は送らない
- 鍵はログ・要約・例外の文に出さない。鍵と地域は、印字できる ASCII で 1〜200 字のときだけ使う(それ以外は E-TR-CONFIG)

##### 3.13.5 応答の検査と保存
- 応答が JSON の配列で、送った数と同じ長さ、各要素の `translations[0].text` が文字列、`translations[0].to` が `ja` であること。違えば、その要求の全部の行を「その他の失敗」にする(E-TR-RESPONSE)
- 訳は、タグを除き(feedparse の整え方と同じ部品)、実体参照を戻し、制御文字を除いてから保存する。title_ja は 1,000 字、summary_ja は 4,000 字で切る(0002 の CHECK)
- 保存は要求ごとに1つのトランザクション:
  - 行の title(と summary)が送ったときと同じ、かつ still pending の行だけを `done` にする(訳している間に原文が変わった行は pending のまま。次の回に訳し直す)
  - `title_ja`・`summary_ja`(title だけのときは null)・`translated_at = now()`・`translate_status = 'done'`
  - feed_translate_usage の今月(日本時間の月の初日)の行に、`chars` を応答ヘッダー `X-metered-usage`(請求の対象の文字数【確認済み】)の値で、`requests` を 1 足す(upsert)。ヘッダーが無い・数でないときは、送った文字の数を足す

##### 3.13.6 月の上限とエラー
- 訳す前に feed_translate_usage の今月の chars を読み、**1,500,000 字(無料分の 75%)以上なら、その月は訳さない**(要約に「月の上限」)。1回の起動の中でも、足した後に超えたらそこで止める
- 応答ごとの扱い(基本設計 4.6):

| 応答 | 扱い | 要約の番号 |
|---|---|---|
| 200 | 3.13.5 のとおり保存 | ― |
| 429・403 | その回の翻訳をやめる。行は pending のまま(回数は足さない) | E-TR-QUOTA |
| 401 | その回の翻訳をやめ、終了コードを 1 にする(鍵の誤りに気づくため。原文の保存は済んでいる) | E-TR-AUTH |
| 400・408・5xx・時間切れ・通信の失敗・3.13.5 の検査の失敗 | その要求の行の translate_attempts を 1 足す。3 になったら failed(画面は原文だけ) | E-TR-OTHER |

- 翻訳の失敗だけでは、終了コードを変えない(401 を除く)。3.7 の終了コードと合わせるときは、大きいほうを使う

##### 3.13.7 ログと要約
- 3.8 と同じ決まり。翻訳の行に出すのは:訳した件数、pending の残り、failed になった件数、送った文字の数、`X-metered-usage` の合計、今月の累計、止まった理由の番号。原文・訳・鍵は出さない
- 最初の2週間は、この行で月の量を見積もる(基本設計 4.6)

##### 3.13.8 ワークフロー(feed.yml の変更)
- feed の step の env に `AZURE_TRANSLATOR_KEY: ${{ secrets.AZURE_TRANSLATOR_KEY }}` と `AZURE_TRANSLATOR_REGION: ${{ secrets.AZURE_TRANSLATOR_REGION }}` を渡す(ほかの step には渡さない)。drafts の feed.yml には最初から入れた(Secrets が無いうちは空の文字列になり、訳さずに動く)
- 時間の上限 10 分は変えない(取得 300 秒+翻訳は1要求 20 秒 × 数回)

##### 3.13.9 試験項目
| ID | 確かめること | 方法 |
|---|---|---|
| TST-TR-01 | 鍵なしは訳さず要約に「翻訳なし」、片方だけは終了コード 2、dry-run・--no-translate は外にも DB にも送らない | pytest |
| TST-TR-02 | 訳す行の選び方(pending・回数・新しい順・translate の種類・設定に無い取得先は残す・30,000 字で止まる) | pytest(DB) |
| TST-TR-03 | 印の付け方(CVE・KB・版・製品名・重なり・大文字小文字)と、原文の `<script>` などが実体参照になって送られること | pytest |
| TST-TR-04 | 要求の組み方(100 件・50,000 字で分ける、ヘッダー、宛先が1つ、Accept-Encoding なし)。鍵が要約・例外に出ない | pytest(送る部品を差し替える) |
| TST-TR-05 | 応答の検査(長さ違い・to が ja でない・text が文字列でない → E-TR-RESPONSE)と、訳のタグ・実体参照・制御文字の除去、長さの切り詰め | pytest |
| TST-TR-06 | 保存:done になり usage に X-metered-usage が足される。訳している間に原文が変わった行は pending のまま | pytest(DB) |
| TST-TR-07 | 月の上限(読む前に上限なら訳さない、途中で超えたら止める、月の境目は日本時間) | pytest(DB) |
| TST-TR-08 | 429・403 は pending のまま・回数は足さない、401 は終了コード 1、その他は回数を足し 3 で failed | pytest(DB) |
| TST-TR-09 | 翻訳が全部失敗しても原文は保存されている(トランザクションが分かれている) | pytest(DB) |
| TST-TR-10 | 本番:F0 で数件が done になり、画面に訳が出る(①の後)。usage の chars が増える | 構築で |

##### 3.13.10 構築の順番
1. オーナー:設定手順書 5-6(従量課金への切り替え)→ 5-7(F0 を作り、鍵と地域を Secrets と Bitwarden に置く)
2. 依頼 12-4(netacho-app の docs/requests/12-4_feed-translate.md):3.13 と TST-TR-01〜09。外部への送信と DB の書き込みに触れるので pr-reviewer を付ける
3. オーナー:設定手順書 5-7 の手順4(app-ref を新しくして起動)
4. TST-TR-10 は、訳の表示(5.3。①)の後に本番で確かめる
