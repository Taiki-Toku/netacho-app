-- AIネタ帳 PWA:テーブルと行単位の権限(RLS)の下書き
-- 状態:下書き v2(2026-11-17)。模擬環境(PostgreSQL 16 に Supabase の auth.uid() と anon・authenticated を真似た土台)で
--       5章の試験 a〜e と、v2 で足した f・g が想定どおりに動くことを確かめた。
--       本物の Supabase でしか確かめられないこと:既定の権限、netacho_sync が接続プーラー経由でログインできるか、Data API への公開の設定。
--       pgTAP の自動試験は、ローカル Supabase を作るとき(K-030)に付ける。
-- v2 の変更:ジャンル vuln を削除(ジャンルの「脆弱性」は廃止。公式情報の脆弱性画面に一本化)/points・excerpt の列を追加/id と date の食い違いを拒否
-- 対応する課題:K-023(評価の分離)、K-025(同期の入力は JSON)、K-035(ジャンル)、K-021(同期用の専用ロール)
--
-- 方針
--   items         ネタの本文。同期が上書きしてよい。読めるのは「許可ユーザー表」に載っている人だけ。
--   item_feedback 評価・メモ。本人の行だけ読める。フェーズ1は同期だけが書く。フェーズ2から本人が書く。
--   genres        ジャンルの一覧(タブ)。表で持つので、あとから足す・名前を変えるのは行の操作で済む。
--   app_users     許可ユーザー表。管理者が手作業で登録する(新規登録は Supabase の設定で無効にする)。
--   公式フィード(K-036)の表は、基本設計 v0.2 のときに足す。

-- ---------------------------------------------------------------
-- 1. 表
-- ---------------------------------------------------------------
create table public.genres (
  id         text primary key,
  label      text not null,
  sort_order int  not null
);

insert into public.genres (id, label, sort_order) values
  ('work',          '仕事・自動化',         10),
  ('agent',         'エージェント',         20),
  ('local-llm',     'ローカルLLM',          30),
  ('security-news', 'セキュリティニュース', 40),
  ('product',       'プロダクト',           50),
  ('creative',      'VTuber・創作',         70),
  ('tools',         'ツール・業界',         80);
-- id・名前・並び順は、アプリの fixtures/genres.json と同じにする(2026-11-17 時点の genres.json から vuln を除いたもの。
-- genres.json に残っている vuln は、アプリ側の依頼で消す)

create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.items (
  id           text primary key check (id ~ '^\d{4}-\d{2}-\d{2}-\d{2}$'),
  date         date not null,
  sort_order   int  not null default 0,
  slot         text not null default '' check (char_length(slot) <= 40),
  genre        text references public.genres (id),          -- 過去分は対応表で入れる。未分類は null
  title        text not null check (char_length(title) between 1 and 200),
  lead         text not null default '' check (char_length(lead) <= 400),
  summary      text not null default '' check (char_length(summary) <= 4000),
  tryit        text not null default '' check (char_length(tryit) <= 2000),
  caution      text not null default '' check (char_length(caution) <= 2000),
  points       text[] not null default '{}' check (cardinality(points) <= 5),       -- 要点(短い箇条。無ければアプリは summary を段落で出す)
  excerpt      text not null default '' check (char_length(excerpt) <= 1000),     -- 元記事の抜粋(原文の引用)
  categories   text[] not null default '{}',
  projects     text[] not null default '{}',
  tags         text[] not null default '{}',
  source_url   text check (source_url is null or source_url ~ '^https://'),  -- https 以外は同期が null にする
  source_title text not null default '' check (char_length(source_title) <= 300),
  trust        text not null default '' check (char_length(trust) <= 40),
  star_hot     smallint not null default 0 check (star_hot between 0 and 5),
  star_use     smallint not null default 0 check (star_use between 0 and 5),
  star_fun     smallint not null default 0 check (star_fun between 0 and 5),
  published_at date,                                         -- 出典の公開日(K-013)
  synced_at    timestamptz not null default now(),
  -- id の先頭の日付と date が同じであること(make_date は immutable なので CHECK に使える)
  constraint items_id_matches_date check (
    date = make_date(substr(id, 1, 4)::int, substr(id, 6, 2)::int, substr(id, 9, 2)::int)
  )
);
create index items_date_idx  on public.items (date desc, sort_order);
create index items_genre_idx on public.items (genre, date desc);

create table public.item_feedback (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  item_id    text not null references public.items (id) on delete cascade,
  rating     text not null default '' check (rating in ('', 'hot', 'good', 'meh', 'no')),
  status     text not null default '' check (status in ('', 'interest', 'plan', 'tried', 'adopted', 'skip')),
  memo       text not null default '' check (char_length(memo) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, item_id)
);

-- ---------------------------------------------------------------
-- 2. 権限:まず全部取り上げ、必要なものだけ与える
-- ---------------------------------------------------------------
revoke all on public.genres, public.app_users, public.items, public.item_feedback from anon, authenticated;
grant select on public.genres, public.items, public.item_feedback, public.app_users to authenticated;
-- anon(未ログイン)には何も与えない。フェーズ1では、アプリ(authenticated)からの書き込みも与えない。

-- 許可ユーザーかどうかを調べる関数(RLS の中から app_users を読むため、定義者の権限で動かす)
create function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_users where user_id = (select auth.uid()));
$$;
revoke all on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated;

-- ---------------------------------------------------------------
-- 3. RLS(行単位の権限)
-- ---------------------------------------------------------------
alter table public.genres        enable row level security;
alter table public.app_users     enable row level security;
alter table public.items         enable row level security;
alter table public.item_feedback enable row level security;

create policy genres_read on public.genres
  for select to authenticated using (public.is_app_user());

create policy app_users_read_self on public.app_users
  for select to authenticated using (user_id = (select auth.uid()));

create policy items_read on public.items
  for select to authenticated using (public.is_app_user());

create policy feedback_read_own on public.item_feedback
  for select to authenticated using (owner_id = (select auth.uid()) and public.is_app_user());

-- ---------------------------------------------------------------
-- 4. 同期用の専用ロール(service_role キーを使わない。K-021)
--    items と item_feedback の追加・更新だけができる。削除はできない。
--    パスワードはこのファイルに書かない。作成後に、管理者が SQL エディターで
--    `alter role netacho_sync with login password '...';` を1回だけ実行し、GitHub Secrets にだけ置く。
-- ---------------------------------------------------------------
create role netacho_sync nologin;
grant usage on schema public to netacho_sync;
grant select, insert, update on public.items, public.item_feedback to netacho_sync;
grant select on public.genres to netacho_sync;

create policy items_sync on public.items
  for all to netacho_sync using (true) with check (true);
create policy feedback_sync on public.item_feedback
  for all to netacho_sync using (true) with check (true);
create policy genres_sync_read on public.genres
  for select to netacho_sync using (true);

-- ---------------------------------------------------------------
-- 5. 試験で確かめること(pgTAP で自動化する。REQ-S-05)
--    a. anon は、4つの表のどれも読めない(拒否されるか 0 行)
--    b. app_users に載っていない authenticated は、items を 0 行しか読めない
--    c. app_users に載っている利用者は items を読めるが、他人の item_feedback は 0 行
--    d. authenticated は、どの表にも insert / update / delete できない(フェーズ1)
--    e. netacho_sync は items を追加・更新(upsert を含む)できるが、削除はできない。app_users は読めない
--    f. id と date が食い違う行、genres に無いジャンルの行は、netacho_sync でも入らない
--    g. anon は is_app_user() を呼べない(authenticated は呼べるが、返すのは自分が許可ユーザーかどうかだけ)
-- ---------------------------------------------------------------
