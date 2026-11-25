# 依頼 12-3:statuspage の障害の状態の語の取り方を直す(K-036。詳細設計 3.5)

## 目的
詳細設計 3.5(netacho-infra の docs/03_詳細設計書.md、2026-11-25 改訂)の「障害の status」に合わせる。今の `feedparse.py` は summary の先頭の語で状態を決めるが、statuspage の障害の記事の本文は「日時 状態の語 - 本文」の形(例:`Jun 22, 09:06 CDT Investigating - Our engineers are looking into it.`)で、先頭は日時なので、本番では状態がいつも空になる。本物の記事の本文(HTML)は `<p> <small>Nov 19, 18:17 UTC</small><br><strong>Resolved</strong> - …` の形で、状態の語は最初の `<strong>` の中にある(2026-11-25 に GitHub・Cloudflare・Claude の Atom で確認)。タグを除いた後の文字で探す決まりのままでよい。

## 決まり(詳細設計 3.5 の改訂後の文)
- statuspage の記事は、summary(タグを除いた後)の中で最初に現れる「状態の語 + 空白 + `-`」で決める
- 状態の語と値:Resolved → 復旧済み、Monitoring → 監視中、Identified → 原因を特定、Investigating → 調査中、Update → 更新。それ以外は空
- 探すのは、保存する summary と同じ先頭 2,000 字(`summary_full[:MAX_SUMMARY]`)だけ。今のコードは切る前の summary_full を渡しているので、ここも直す
- 大文字・小文字は区別しない。語の途中に当たらないよう、語の前は文字列の先頭か英数字以外とする
- 計画メンテナンスの記事は今までどおり filter(statuspage-incident)で外す(本文が `THIS IS A SCHEDULED EVENT` で始まる)

## 変えるファイル
- `sync/nodal_sync/feedparse.py`(状態の語の取り方だけ)
- `sync/tests/test_feed_parse.py`、`sync/tests/data/feed/statuspage.atom`(見本を本物と同じ HTML の形 `<p><small>日時</small><br><strong>状態の語</strong> - 本文</p>` にする。`<br>` が改行になり日時と語がくっつかないことも試す。架空の値だけ)
- この依頼文 `docs/requests/12-3_statuspage-status.md`
- 変えないもの:ほかのすべて。既存の試験のうち、status の期待値が先頭の語の形を前提にしているものは、新しい形に合わせて直してよい(それ以外の期待値は変えない)

## 試験(TST-FEED-02 に足す)
- `Jun 22, 09:06 CDT Investigating - …` → 調査中
- `Nov 3, 10:00 UTC Resolved - …` → 復旧済み
- 先頭が状態の語の形(`Monitoring - …`)→ 監視中
- 状態の語が無い本文 → 空
- `Unresolved - …` のように語の途中に当たる形 → 空
- 新しい順に更新が並ぶ本文(`Resolved - …` の後に `Investigating - …`)→ 最初の 復旧済み
- 2,000 字より後にだけ状態の語がある本文 → 空

## 確かめること
1. `cd sync && python -m pytest`(この VM で動かせなければ、DB を使わない試験だけを流し、その旨を報告)
2. `git diff --cached main --output=.tmp/review.diff` で差分を保存し、変わったのが上のファイルだけであること
3. 外部のデータの解析に触れるので、pr-reviewer にレビューさせる(この差分だけ)

## 報告
- 何を変えたか/なぜ安全か(正規表現が長い入力で遅くならないこと=入れ子の繰り返しが無く、探すのは 2,000 字で切った後であること、を含む)
- 試験と pr-reviewer の結果
- テストが保証していないこと(本物のフィードでの確認は本番の起動の後)
- PR の本文を `<!-- pr-body -->` と `<!-- /pr-body -->` の間に書く。題は「statuspage の障害の状態の語を日時の後から取る(K-036、依頼 12-3)」
