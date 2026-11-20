"""DB を使う試験の準備。

NODAL_TEST_ADMIN_URL(postgres)と NODAL_TEST_SYNC_URL(netacho_sync)が無い・psycopg が無いときは skip。
NODAL_REQUIRE_DB=1 のときは skip せずに失敗にする(CI で skip のまま緑にならないように)。
"""

from __future__ import annotations

import os
from typing import Any

import pytest


def _unavailable(reason: str) -> None:
    if os.environ.get("NODAL_REQUIRE_DB") == "1":
        pytest.fail(f"NODAL_REQUIRE_DB=1 なのに {reason}")
    pytest.skip(reason)


@pytest.fixture
def db_urls() -> tuple[str, str]:
    """各 DB の試験の前に、表を空にする。(admin の URL, netacho_sync の URL) を返す。"""
    try:
        import psycopg
    except ImportError:
        _unavailable("psycopg がありません")
    admin = os.environ.get("NODAL_TEST_ADMIN_URL")
    sync = os.environ.get("NODAL_TEST_SYNC_URL")
    if not admin or not sync:
        _unavailable("NODAL_TEST_ADMIN_URL・NODAL_TEST_SYNC_URL がありません")
    assert admin and sync
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute("delete from public.item_feedback")
        c.execute("delete from public.feed_entries")
        c.execute("delete from public.items")
        c.execute("delete from public.sync_state")
    return admin, sync


@pytest.fixture
def admin_sql(db_urls: tuple[str, str]) -> Any:
    """admin で SQL を1つ流し、結果の行を返す関数。"""
    import psycopg

    def run(query: str, params: tuple[Any, ...] | None = None) -> list[tuple[Any, ...]]:
        with psycopg.connect(db_urls[0], autocommit=True) as c:
            cur = c.execute(query, params)
            return cur.fetchall() if cur.description else []

    return run
