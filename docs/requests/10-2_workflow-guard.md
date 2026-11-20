# 依頼 10-2:workflow-guard の対象に同期のコードとマイグレーションを足す(K-055)

## 目的
課題 K-055(2026-11-20 に案 A で決定)。次の2つは、変わったらオーナーが差分を目で確かめてからマージする。
- 同期のコード `sync/nodal_sync/`:netacho-sync で本番の DB の資格情報を持って動く
- DB のマイグレーション `supabase/migrations/`:本番の権限(RLS・ロール・GRANT)を決める

そのため、`.github/workflows/ci.yml` の `workflow-guard` ジョブで、これらが変わった PR を赤にする。

## 変えるファイル
`.github/workflows/ci.yml` とこの依頼文だけ。ほかのファイルは変えない。

## 直すこと
1. `workflow-guard` ジョブの `guard` の手順の `grep -E` の式で、`sync/requirements[^/]*$` の後ろに、次の2つの選択肢を足す(前方一致なので `$` は付けない)
   - `sync/nodal_sync/`
   - `supabase/migrations/`
2. 式のほかの部分は変えない
3. ジョブの上の日本語のコメントに、同期のコード(netacho-sync で本番の DB の資格情報を持って動く)と DB のマイグレーション(本番の権限を決める)も守る対象にすること(K-055)を1行足す

## 確かめること
- npm は動かさない。bash の `grep -E` に、新しい式と次の見本のパスを渡す
  - 当たる:`sync/nodal_sync/db.py`、`supabase/migrations/0004_x.sql`、`sync/requirements.txt`、`.github/workflows/ci.yml`
  - 当たらない:`sync/README.md`、`sync/tests/test_x.py`、`src/App.tsx`、`docs/requests/10-2_workflow-guard.md`
- git diff で、変わったのが上の2か所と、この依頼文の追加だけであること
