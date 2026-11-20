-- NODAL:0002 公式フィードの表、items の列の追加、ジャンル「アイデアラボ」
-- 状態:下書き v3(2026-11-18)。PostgreSQL 16 の模擬環境(0001 v2 と同じ土台。新しい表に anon・authenticated の権限が
--       自動で付く厳しい側の設定)で、下の 6章の試験 h〜v を確かめた。
-- v2 の変更:item_feedback の外部キーを on delete restrict にした(1b。評価・メモが付いた行・利用者を消すと、評価・メモまで消えるのを防ぐ)
-- v3 の変更(G1 の指摘):netacho_sync から item_feedback の権限を外した(4b。SEC-03)/適用の記録の表 schema_migrations を足した(5。DevOps-05)
-- 正とする文書:基本設計 v0.2 の 3.3・3.8・4.5・4.7・4.10・5.4・6.5
-- 前提:0001_init.sql v2 を適用済み。全体を1つのトランザクションで流す(途中で失敗したら何も変わらない)。
-- 対応する課題:K-036・K-037・K-040(公式フィード)、K-042(画像)、K-047(機械翻訳)、K-049(アイデア)

begin;

-- ---------------------------------------------------------------
-- 1. items に列を足す(3.8)
--    既存の 75 行には既定値が入る(image_url は null、配列は空)。
-- ---------------------------------------------------------------
alter table public.items
  add column image_url        text   check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 2000)),
  add column related_feed_ids text[] not null default '{}'
    check (cardinality(related_feed_ids) <= 50
           and array_to_string(related_feed_ids, ',', '*') ~ '^([0-9a-f]{32}(,[0-9a-f]{32})*)?$'),
  add column related_item_ids text[] not null default '{}'
    check (cardinality(related_item_ids) <= 10
           and array_to_string(related_item_ids, ',', '*') ~ '^(\d{4}-\d{2}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2}-\d{2})*)?$');
-- image_url:出典の og:image。https だけ。取れないときは null(同期は失敗にしない)
-- related_feed_ids:もとにした公式フィードの id(4.10)。形式だけを調べる(外部キーは配列に張れない。載せ忘れ・誤りは watch が見る)
-- related_item_ids:アイデアがもとにしたニュースの id(REQ-D-07)。形式だけを調べる
-- 配列の中の null は、'*' に置き換わって形式の検査で落ちる

-- ---------------------------------------------------------------
-- 1b. item_feedback の外部キーを restrict にする(6.5)
--     0001 v2 は on delete cascade で、items の行や利用者を消すと評価・メモも消えていた。
--     制約の名前は PostgreSQL の既定の名前。違えば drop で失敗し、全体が取り消される(何も変わらない)。
-- ---------------------------------------------------------------
alter table public.item_feedback
  drop constraint item_feedback_owner_id_fkey,
  drop constraint item_feedback_item_id_fkey,
  add constraint item_feedback_owner_id_fkey foreign key (owner_id) references auth.users (id) on delete restrict,
  add constraint item_feedback_item_id_fkey  foreign key (item_id)  references public.items (id) on delete restrict;

-- ---------------------------------------------------------------
-- 2. ジャンル「アイデアラボ」(id は idea。並び順は最後。K-049)
--    アプリの fixtures/genres.json にも同じ行を足す(id: idea、label: アイデアラボ、sortOrder: 90)
-- ---------------------------------------------------------------
insert into public.genres (id, label, sort_order) values ('idea', 'アイデアラボ', 90);

-- ---------------------------------------------------------------
-- 3. 公式フィードの表(4.5)
-- ---------------------------------------------------------------
create table public.feed_entries (
  id                 text primary key check (id ~ '^[0-9a-f]{32}$'),  -- sha256(source_id + 改行 + guid) の先頭 32 桁(16進)
  source_id          text not null check (source_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  kind               text not null check (kind in ('release', 'eol', 'change', 'exam', 'vuln', 'outage')),
  vendor             text not null default '' check (char_length(vendor) <= 100),
  product            text not null default '' check (char_length(product) <= 100),
  title              text not null check (char_length(title) between 1 and 500),
  summary            text not null default '' check (char_length(summary) <= 2000),
  url                text check (url is null or (url ~ '^https://' and char_length(url) <= 2000)),
  published_at       timestamptz,
  first_seen_at      timestamptz not null default now(),
  sort_at            timestamptz generated always as (coalesce(published_at, first_seen_at)) stored,
                     -- 画面の並び。Data API(PostgREST)は式で並べられないので、列にして索引を張る
  lang               text not null check (lang in ('en', 'ja')),
  title_ja           text check (char_length(title_ja) <= 1000),
  summary_ja         text check (char_length(summary_ja) <= 4000),
  translate_status   text not null default 'pending' check (translate_status in ('pending', 'done', 'skip', 'failed')),
  translate_attempts smallint not null default 0 check (translate_attempts between 0 and 10),
  translated_at      timestamptz,
  cve_ids            text[] not null default '{}'
    check (cardinality(cve_ids) <= 50
           and array_to_string(cve_ids, ',', '*') ~ '^(CVE-\d{4}-\d{4,7}(,CVE-\d{4}-\d{4,7})*)?$'),
  severity           text check (severity in ('critical', 'high', 'medium', 'low')),  -- null は画面で「未評価」
  cvss               numeric(3,1) check (cvss between 0 and 10),
  exploited          boolean not null default false,             -- CISA KEV に載ったら true。false には戻らない(下の関数)
  status             text not null default '' check (char_length(status) <= 40),
  digest_date        date,                                       -- 翌朝のニュースに渡した日(4.10)
  updated_at         timestamptz not null default now(),
  -- 訳の状態と中身のつじつま
  constraint feed_translate_done check (translate_status <> 'done' or (title_ja is not null and translated_at is not null)),
  constraint feed_translate_ja_skip check (lang <> 'ja' or translate_status = 'skip'),
  -- 脆弱性の項目は脆弱性の行だけ
  constraint feed_vuln_only check (kind = 'vuln' or (cardinality(cve_ids) = 0 and severity is null and cvss is null and not exploited))
);
create index feed_entries_sort_idx    on public.feed_entries (sort_at desc);
create index feed_entries_kind_idx    on public.feed_entries (kind, sort_at desc);
create index feed_entries_pending_idx on public.feed_entries (sort_at desc) where translate_status = 'pending';
create index feed_entries_digest_idx  on public.feed_entries (digest_date) where digest_date is not null;

-- 書き換えてはいけない値を守る:first_seen_at は最初の値のまま、exploited は true から戻さない、updated_at は自動
create function public.feed_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.first_seen_at := old.first_seen_at;
  new.exploited     := old.exploited or new.exploited;
  new.updated_at    := now();
  return new;
end;
$$;
revoke all on function public.feed_entries_guard() from public, anon, authenticated;
create trigger feed_entries_guard before update on public.feed_entries
  for each row execute function public.feed_entries_guard();

create table public.feed_source_state (
  source_id            text primary key check (source_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  etag                 text check (char_length(etag) <= 500),
  last_modified        text check (char_length(last_modified) <= 100),
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  consecutive_failures int  not null default 0 check (consecutive_failures >= 0),
  last_error           text not null default '' check (char_length(last_error) <= 1000),
  updated_at           timestamptz not null default now()
);

create table public.feed_translate_usage (
  month      date primary key check (extract(day from month) = 1),  -- 月の初日(日本時間の月)
  chars      bigint not null default 0 check (chars >= 0),
  requests   int    not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 4. 権限:まず全部取り上げ、必要なものだけ与える(4.7・3.3)
-- ---------------------------------------------------------------
revoke all on public.feed_entries, public.feed_source_state, public.feed_translate_usage from public, anon, authenticated;

alter table public.feed_entries         enable row level security;
alter table public.feed_source_state    enable row level security;
alter table public.feed_translate_usage enable row level security;

-- アプリ(許可ユーザー)は feed_entries を読むだけ。ほかの2表は見せない(policy も作らない)
grant select on public.feed_entries to authenticated;
create policy feed_entries_read on public.feed_entries
  for select to authenticated using (public.is_app_user());

-- 公式フィードの書き込み用の専用ロール。3表の select / insert / update だけ。削除は無し。
-- パスワードはこのファイルに書かない。適用後に管理者が SQL エディターで
-- `alter role netacho_feed with login password '...';` を1回だけ実行し、GitHub Secrets(FEED_DB_URL)にだけ置く。
create role netacho_feed nologin;
grant usage on schema public to netacho_feed;
grant select, insert, update on public.feed_entries, public.feed_source_state, public.feed_translate_usage to netacho_feed;
create policy feed_entries_feed      on public.feed_entries         for all to netacho_feed using (true) with check (true);
create policy feed_source_state_feed on public.feed_source_state    for all to netacho_feed using (true) with check (true);
create policy feed_usage_feed        on public.feed_translate_usage for all to netacho_feed using (true) with check (true);

-- 同期の netacho_sync は、載せ忘れの確認のため feed_entries を読むだけ(3.3)
grant select on public.feed_entries to netacho_sync;
create policy feed_entries_sync_read on public.feed_entries
  for select to netacho_sync using (true);

-- ---------------------------------------------------------------
-- 4b. netacho_sync から item_feedback の権限を外す(G1 の SEC-03)
--     フェーズ1の item_feedback は空で、同期は書かない。フェーズ2で本人が書く形を作るときに、要る権限だけを足す。
-- ---------------------------------------------------------------
revoke all on public.item_feedback from netacho_sync;
drop policy feedback_sync on public.item_feedback;

-- ---------------------------------------------------------------
-- 5. 適用の記録(G1 の DevOps-05。基本設計 5.7)
--    本番には SQL エディターで流す。どの番号まで流したかをこの表で確かめる。誰にも見せない(policy も作らない)。
--    0001 の applied_at は、この 0002 を流した時刻になる(0001 のときは表が無かったため)。
--    0003 以降は、ファイルの先頭で「自分の番号がまだ無いこと」を確かめ、最後に自分の番号を入れる。
-- ---------------------------------------------------------------
create table public.schema_migrations (
  version    text        primary key check (version ~ '^\d{4}$'),
  applied_at timestamptz not null default now()
);
revoke all on public.schema_migrations from public, anon, authenticated;
alter table public.schema_migrations enable row level security;
insert into public.schema_migrations (version) values ('0001'), ('0002');

commit;

-- ---------------------------------------------------------------
-- 5. 適用後に管理者が行うこと(この SQL の外)
--    ・alter role netacho_feed with login password '...';(Bitwarden に控え、GitHub Secrets の FEED_DB_URL に置く)
--    ・プーラー経由のログインを確かめる(ユーザー名 netacho_feed.<プロジェクトの ref>、5432)
--    ・アプリの fixtures/genres.json に idea を足す依頼(K-049)
--
-- 6. 試験で確かめること(0001 の a〜g に続けて。pgTAP で自動化する。REQ-S-05)
--    h. anon は feed の3表のどれも読めない
--    i. 許可ユーザーは feed_entries を読めるが、未登録の authenticated は 0 行。feed_source_state・feed_translate_usage は誰も読めない
--    j. authenticated は feed の3表に insert / update / delete できない
--    k. netacho_feed は3表に upsert できるが、削除はできない。items・app_users・item_feedback には触れない
--    l. netacho_sync は feed_entries を読めるが、書けない。feed_source_state・feed_translate_usage は読めない
--    m. feed_entries の CHECK:kind・severity・translate_status の値、https 以外の url、id の形式、ja の原文は skip、
--       done なのに訳が無い行、脆弱性でない行の CVE は入らない
--    n. exploited は true から false に戻らない。first_seen_at は更新で変わらない
--    o. sort_at は published_at、無ければ first_seen_at になる
--    p. items の image_url は https だけ。related_feed_ids・related_item_ids は形式が違う値と null を含む配列が入らない
--    q. 0002 を流しても既存の items の行はそのまま(列の既定値が入る)
--    r. genres に idea があり、並び順が最後
--    s. feed_entries_guard() を anon・authenticated が呼べない
--    t. 評価・メモが付いた items の行と利用者(auth.users)は、管理者でも消せない。評価・メモが無い items の行は管理者が消せる
--    u. netacho_sync は item_feedback を読めず、書けない(v3)
--    v. schema_migrations は anon・authenticated・netacho_sync・netacho_feed から読めず、書けない。0001・0002 が入っている(v3)
