"""DB への接続と読み書き(依頼 10-1 の 4.3〜4.5)。psycopg を import するのはこのファイルだけ。

- 値はすべてプレースホルダで渡す。列の名前はコードの中の固定の一覧(schema.ROW_COLUMNS)から作る
- psycopg の例外のメッセージ・接続文字列は外に出さず、決まりの番号(DbError.code)に置き換える
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .schema import ROW_COLUMNS

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
SOURCE = "ai-netacho"
ARRAY_COLUMNS = frozenset({"points", "categories", "projects", "tags",
                           "related_feed_ids", "related_item_ids"})

MESSAGES = {
    "E-DB-CONFIG": "DB の接続の設定が正しくありません",
    "E-DB-CA": "DB の CA 証明書がありません",
    "E-DB-CONNECT": "DB に接続できませんでした",
    "E-DB-READ": "DB を読めませんでした",
    "E-DB-WRITE": "DB に書き込めませんでした",
}


class DbError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code

    @property
    def message(self) -> str:
        return f"{MESSAGES.get(self.code, 'DB の操作に失敗しました')}({self.code})"


def build_conninfo(url: str, ca_path: str | None) -> str:
    """接続文字列に TLS の設定を足す。localhost 以外は verify-full と --ca の証明書で上書きする。"""
    try:
        params: dict[str, Any] = conninfo_to_dict(url)
    except Exception:
        raise DbError("E-DB-CONFIG") from None
    host = params.get("host")
    # hostaddr は host より優先して接続先になるので、あれば localhost とはみなさない
    is_local = isinstance(host, str) and host in LOCAL_HOSTS and "hostaddr" not in params
    if not is_local:
        if not ca_path or not os.path.isfile(ca_path):
            raise DbError("E-DB-CA")
        params["sslmode"] = "verify-full"
        params["sslrootcert"] = ca_path
    params["connect_timeout"] = "10"
    params["application_name"] = "nodal-sync"
    # GSSAPI の暗号化に切り替わって verify-full の TLS を通らない、ということが起きないように
    params["gssencmode"] = "disable"
    try:
        return make_conninfo("", **params)
    except Exception:
        raise DbError("E-DB-CONFIG") from None


def connect(url: str, ca_path: str | None) -> psycopg.Connection[Any]:
    conninfo = build_conninfo(url, ca_path)
    try:
        # prepare_threshold=None:サーバー側の prepared statement を使わない(Supabase のプーラーでも動くように)
        return psycopg.connect(conninfo, autocommit=False, prepare_threshold=None)
    except Exception:
        raise DbError("E-DB-CONNECT") from None


def _read(conn: psycopg.Connection[Any], query: sql.Composable | str,
          params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            return conn.execute(query, params or None).fetchall()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None


# ---------------------------------------------------------------
# run
# ---------------------------------------------------------------
def read_genres(conn: psycopg.Connection[Any]) -> frozenset[str]:
    return frozenset(r[0] for r in _read(conn, "select id from public.genres"))


def read_last_commit(conn: psycopg.Connection[Any]) -> str | None:
    rows = _read(conn, "select last_commit from public.sync_state where source = 'ai-netacho'")
    return rows[0][0] if rows else None


def write_last_commit(conn: psycopg.Connection[Any], sha: str) -> None:
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            conn.execute(
                "insert into public.sync_state (source, last_commit) values ('ai-netacho', %s) "
                "on conflict (source) do update set last_commit = excluded.last_commit, updated_at = now()",
                (sha,),
            )
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None


def _build_upsert() -> sql.Composed:
    cols = [sql.Identifier(c) for c in ROW_COLUMNS]
    values = [sql.SQL("%s::text[]") if c in ARRAY_COLUMNS else sql.SQL("%s") for c in ROW_COLUMNS]
    upd = [c for c in ROW_COLUMNS if c != "id"]
    sets = [sql.SQL("{c} = excluded.{c}").format(c=sql.Identifier(c)) for c in upd]
    sets.append(sql.SQL(
        "image_url = case when items.source_url is distinct from excluded.source_url "
        "then null else items.image_url end"))
    sets.append(sql.SQL("synced_at = now()"))
    cur_vals = [sql.SQL("items.{c}").format(c=sql.Identifier(c)) for c in upd]
    new_vals = [sql.SQL("excluded.{c}").format(c=sql.Identifier(c)) for c in upd]
    return sql.SQL(
        "insert into public.items ({cols}) values ({vals}) "
        "on conflict (id) do update set {sets} "
        "where ({cur}) is distinct from ({new}) "
        "returning (xmax = 0) as inserted"
    ).format(
        cols=sql.SQL(", ").join(cols),
        vals=sql.SQL(", ").join(values),
        sets=sql.SQL(", ").join(sets),
        cur=sql.SQL(", ").join(cur_vals),
        new=sql.SQL(", ").join(new_vals),
    )


UPSERT_ITEM = _build_upsert()


def write_day(conn: psycopg.Connection[Any], rows: list[dict[str, Any]]) -> tuple[int, int, int]:
    """1日分を1つのトランザクションで書く。(追加, 更新, 変化なし) を返す。失敗したら全部取り消して DbError。"""
    inserted = updated = unchanged = 0
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            for row in rows:
                r = conn.execute(UPSERT_ITEM, tuple(row[c] for c in ROW_COLUMNS)).fetchone()
                if r is None:
                    unchanged += 1
                elif r[0]:
                    inserted += 1
                else:
                    updated += 1
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
    return inserted, updated, unchanged


def item_ids_on(conn: psycopg.Connection[Any], days: list[dt.date] | None) -> set[str]:
    if days is None:
        rows = _read(conn, "select id from public.items")
    else:
        rows = _read(conn, "select id from public.items where date = any(%s::date[])", (days,))
    return {r[0] for r in rows}


def image_targets(conn: psycopg.Connection[Any], days: list[dt.date] | None,
                  limit: int = 30) -> list[tuple[str, str]]:
    """image_url が null で source_url がある行を、新しい順に最大 limit 件。"""
    base = ("select id, source_url from public.items "
            "where image_url is null and source_url is not null {cond} "
            "order by date desc, sort_order, id limit %s")
    if days is None:
        rows = _read(conn, base.format(cond=""), (limit,))
    else:
        rows = _read(conn, base.format(cond="and date = any(%s::date[])"), (days, limit))
    return [(r[0], r[1]) for r in rows]


def set_image(conn: psycopg.Connection[Any], item_id: str, source_url: str, image_url: str) -> bool:
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            cur = conn.execute(
                "update public.items set image_url = %s where id = %s and image_url is null and source_url = %s",
                (image_url, item_id, source_url),
            )
            return cur.rowcount == 1
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None


# ---------------------------------------------------------------
# watch
# ---------------------------------------------------------------
def count_items_on(conn: psycopg.Connection[Any], day: dt.date) -> int:
    return int(_read(conn, "select count(*) from public.items where date = %s", (day,))[0][0])


def feed_ids_in_items_on(conn: psycopg.Connection[Any], day: dt.date) -> set[str]:
    rows = _read(conn, "select distinct unnest(related_feed_ids) from public.items where date = %s", (day,))
    return {r[0] for r in rows}


def feed_digested_on(conn: psycopg.Connection[Any], day: dt.date) -> list[str]:
    rows = _read(conn, "select id from public.feed_entries where digest_date = %s order by id", (day,))
    return [r[0] for r in rows]


def feed_stale_undigested(conn: psycopg.Connection[Any]) -> list[str]:
    rows = _read(conn, "select id from public.feed_entries where digest_date is null "
                       "and first_seen_at < now() - interval '24 hours' order by id")
    return [r[0] for r in rows]
