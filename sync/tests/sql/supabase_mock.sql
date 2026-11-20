-- 試験だけで使う Supabase の模擬の土台(本番には流さない)。
-- 本物の Supabase にある anon・authenticated のロール、auth.users、auth.uid() を真似る。
-- 新しい表に anon・authenticated の権限が自動で付く、厳しい側の既定の権限にしてある(0001 以降の revoke が効くことを確かめるため)。
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
