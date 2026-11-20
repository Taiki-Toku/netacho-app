-- NODAL:0003 同期が前回読んだコミットの記録(B-19)
-- 状態:下書き v1(2026-11-20)。PostgreSQL 16 の模擬環境(0001 v2・0002 v3 と同じ土台)で、下の 4章の試験 w〜z を確かめた。
-- 正とする文書:詳細設計 2.6(docs/03_詳細設計書.md)、基本設計 v1.2 の 3.2 の1
-- 前提:0001 v2・0002 v3 を適用済み。全体を1つのトランザクションで流す(途中で失敗したら何も変わらない)。

begin;

-- ---------------------------------------------------------------
-- 0. 二重に流していないことを確かめる(基本設計 5.7)
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0003') then
    raise exception '0003 は適用済みです';
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 1. 表
--    source:読んだリポジトリ。今は ai-netacho だけ
--    last_commit:前回の同期が履歴の検査を通した HEAD のコミット(40 桁の16進)
-- ---------------------------------------------------------------
create table public.sync_state (
  source      text        primary key check (source in ('ai-netacho')),
  last_commit text        not null check (last_commit ~ '^[0-9a-f]{40}$'),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 2. 権限:まず全部取り上げ、netacho_sync にだけ select / insert / update を与える。削除は誰にも与えない
-- ---------------------------------------------------------------
revoke all on public.sync_state from public, anon, authenticated;
alter table public.sync_state enable row level security;
grant select, insert, update on public.sync_state to netacho_sync;
create policy sync_state_sync on public.sync_state
  for all to netacho_sync using (true) with check (true);

-- ---------------------------------------------------------------
-- 3. 適用の記録
-- ---------------------------------------------------------------
insert into public.schema_migrations (version) values ('0003');

commit;

-- ---------------------------------------------------------------
-- 4. 試験で確かめること(0002 の h〜v に続けて。pgTAP で自動化する。REQ-S-05)
--    w. anon・authenticated・netacho_feed は sync_state を読めず、書けない
--    x. netacho_sync は sync_state に upsert できるが、削除はできない
--    y. source が ai-netacho 以外の行、last_commit が 40 桁の16進でない行は入らない
--    z. 0003 を2回流すと、2回目は何も変えずに失敗する
-- ---------------------------------------------------------------
