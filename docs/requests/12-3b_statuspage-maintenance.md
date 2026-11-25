# 依頼 12-3b:statuspage の計画メンテナンスを状態の語で外す(K-036。詳細設計 3.5)

## 目的
詳細設計 3.5(netacho-infra の docs/03_詳細設計書.md、2026-11-25 改訂)の filter「statuspage-incident」に合わせる。2026-11-25 の本番の dry_run で、cloudflare-status の 25 件がすべて計画メンテナンスなのに filter で外れなかった。本物の記事の本文は `<p><small>Nov 19, 16:50 UTC</small><br><strong>Scheduled</strong> - We will be performing scheduled maintenance …` の形で、今のコードが探す `THIS IS A SCHEDULED EVENT` の文が無い。状態の語で外すようにする。依頼 12-3(状態の語の取り方)の後に流す。

## 決まり(詳細設計 3.5 の改訂後の文)
- statuspage-incident の filter は、次のどちらかなら記事を入れない
  1. summary(タグを除いた後の先頭 2,000 字)の中で最初に現れる「状態の語 + 空白 + `-`」が、計画メンテナンスの語(Scheduled・In progress・Verifying・Completed)
  2. summary に `THIS IS A SCHEDULED EVENT` を含む(今の決まり。残す)
- 状態の語の探し方は 12-3 と同じ(大文字・小文字を区別しない、語の前は文字列の先頭か英数字以外、`re.ASCII`、入れ子の繰り返しなし)。障害の語(Resolved・Monitoring・Identified・Investigating・Update)と計画メンテナンスの語を1つの正規表現で探し、最初に当たったものを使う。`In progress` の語の間は空白1つ以上
- 障害の記事の status の値は 12-3 のまま(計画メンテナンスの語は status にしない。外すので保存されない)

## 変えるファイル
- `sync/nodal_sync/feedparse.py`(filter と状態の語の正規表現だけ)
- `sync/tests/test_feed_parse.py`、`sync/tests/data/feed/statuspage.atom`(計画メンテナンスの見本を本物と同じ形 `<p><small>日時</small><br><strong>Scheduled</strong> - …</p>` に。架空の値だけ)
- この依頼文 `docs/requests/12-3b_statuspage-maintenance.md`
- 変えないもの:ほかのすべて。既存の試験の期待値は、計画メンテナンスの見本の形に合わせる分だけ直してよい

## 試験(TST-FEED-08 に足す)
- `Nov 19, 16:50 UTC Scheduled - …` → 外す
- `In progress - …`・`Verifying - …`・`Completed - …` → 外す(新しい順で最初の語が計画メンテナンスの語)
- `Resolved - …` の後に `Scheduled - …` がある本文 → 入れる(最初が障害の語)
- `THIS IS A SCHEDULED EVENT` を含む本文 → 外す(今までどおり)
- `Rescheduled - …`(語の途中)→ 計画メンテナンスとしては扱わない
- 障害の記事の status は 12-3 の試験のまま通る

## 確かめること
1. `cd sync && python -m pytest`(この VM で動かせなければ、DB を使わない試験だけを流し、その旨と流さなかった数を報告。CI の sync のジョブで全部流れる)
2. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
3. 外部のデータの解析に触れるので、pr-reviewer にレビューさせる(この差分だけ)

## 報告
- 何を変えたか/なぜ安全か(正規表現が長い入力で遅くならないこと、を含む)
- 試験と pr-reviewer の結果
- テストが保証していないこと(本物の Cloudflare のフィードでの確認は、netacho-sync の cloudflare-status を有効に戻した後の dry_run で)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「statuspage の計画メンテナンスを状態の語で外す(K-036、依頼 12-3b)」
