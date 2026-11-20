"""0003(sync_state)の権限と CHECK の試験(DB を使う)。TST-SYNC-19。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

MIGRATION_0003 = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "0003_sync_state.sql"
SHA = "c" * 40


def _expect_error(admin_url: str, role: str, query: str, params: tuple[Any, ...] | None = None) -> type:
    """admin で role に切り替えて query を流し、失敗した例外の型を返す(何も残さない)。"""
    import psycopg
    from psycopg import sql
    with psycopg.connect(admin_url) as c:
        try:
            with c.transaction():
                c.execute(sql.SQL("set local role {}").format(sql.Identifier(role)))
                c.execute(query, params)
        except psycopg.Error as e:
            return type(e)
        finally:
            c.rollback()
    pytest.fail(f"{role} で失敗しなかった")


@pytest.mark.parametrize("role", ["anon", "authenticated", "netacho_feed"])
@pytest.mark.parametrize("query", [
    "select * from public.sync_state",
    "insert into public.sync_state (source, last_commit) values ('ai-netacho', 'cccccccccccccccccccccccccccccccccccccccc')",
    "update public.sync_state set last_commit = last_commit",
    "delete from public.sync_state",
])
def test_tst_sync_19_other_roles_cannot_touch(db_urls: tuple[str, str], role: str, query: str) -> None:
    """TST-SYNC-19:anon・authenticated・netacho_feed は sync_state を読めず書けない。"""
    import psycopg
    err = _expect_error(db_urls[0], role, query)
    assert issubclass(err, psycopg.errors.InsufficientPrivilege)


def test_tst_sync_19_sync_can_upsert_not_delete(db_urls: tuple[str, str], admin_sql: Any) -> None:
    """TST-SYNC-19:netacho_sync は upsert できるが delete できない。"""
    import psycopg

    from nodal_sync import db
    conn = db.connect(db_urls[1], None)
    try:
        assert db.read_last_commit(conn) is None
        db.write_last_commit(conn, SHA)
        db.write_last_commit(conn, "d" * 40)
        assert db.read_last_commit(conn) == "d" * 40
    finally:
        conn.close()
    with psycopg.connect(db_urls[1]) as c:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute("delete from public.sync_state")
        c.rollback()
    assert admin_sql("select source, last_commit from public.sync_state") == [("ai-netacho", "d" * 40)]


@pytest.mark.parametrize("source,commit", [
    ("other-repo", SHA),
    ("ai-netacho", "C" * 40),
    ("ai-netacho", "c" * 39),
    ("ai-netacho", "c" * 64),
    ("ai-netacho", "g" * 40),
])
def test_tst_sync_19_checks(db_urls: tuple[str, str], source: str, commit: str) -> None:
    """TST-SYNC-19:source が ai-netacho 以外、last_commit が 40 桁の16進でない行は入らない。"""
    import psycopg
    with psycopg.connect(db_urls[1]) as c:
        with pytest.raises(psycopg.errors.CheckViolation):
            c.execute("insert into public.sync_state (source, last_commit) values (%s, %s)", (source, commit))
        c.rollback()


def test_tst_sync_19_0003_twice_fails(db_urls: tuple[str, str], admin_sql: Any) -> None:
    """TST-SYNC-19:0003 を2回流すと2回目は失敗し、何も変わらない(1回目は CI が流した)。"""
    import psycopg
    admin_sql("insert into public.sync_state (source, last_commit) values ('ai-netacho', %s)", (SHA,))
    before = (
        admin_sql("select version from public.schema_migrations order by version"),
        admin_sql("select source, last_commit, updated_at from public.sync_state"),
        admin_sql("select policyname from pg_policies where tablename = 'sync_state' order by 1"),
    )
    script = MIGRATION_0003.read_text(encoding="utf-8")
    c = psycopg.connect(db_urls[0], autocommit=True)  # ファイルの begin・commit をそのまま使う
    try:
        with pytest.raises(psycopg.errors.RaiseException):
            c.execute(script)
    finally:
        c.close()
    after = (
        admin_sql("select version from public.schema_migrations order by version"),
        admin_sql("select source, last_commit, updated_at from public.sync_state"),
        admin_sql("select policyname from pg_policies where tablename = 'sync_state' order by 1"),
    )
    assert before == after
    assert [v for (v,) in after[0]] == ["0001", "0002", "0003"]
