"""公式フィードの DB への書き込み(依頼 12-1。詳細設計 3.6・3.7。翻訳の分は依頼 12-4・詳細設計 3.13)。ロールは netacho_feed(select・insert・update だけ)。

- 接続は同期と同じ形(verify-full と --ca)。application_name だけ nodal-feed にする
- SQL はすべて固定の文で、値はプレースホルダで渡す(文字列の連結で値を入れない)
- 1回の起動の書き込みは、全部の取得先の分を1つのトランザクションで行う。外との通信はこの前に終えている
- psycopg の例外のメッセージ・接続文字列は外に出さず、決まりの番号(db.DbError)に置き換える
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .db import DbError, build_conninfo
from .feedparse import MAX_CVES, Entry, SourceOutcome
from .feedtranslate import PendingRow, Save

APP_NAME = "nodal-feed"

SELECT_STATES = sql.SQL(
    "select source_id, etag, last_modified from public.feed_source_state")

# 同じ id の行。for update で、書き終わるまで他から変えられないようにする
SELECT_BY_ID = sql.SQL(
    "select title, summary, url, published_at, status from public.feed_entries "
    "where id = %s for update")

UPDATE_BY_ID = sql.SQL(
    "update public.feed_entries set "
    "title = %(title)s, summary = %(summary)s, url = %(url)s::text, "
    "published_at = %(published_at)s::timestamptz, status = %(status)s "
    "where id = %(id)s")

# title・summary が変わった en の行は、古い訳を出さないように訳を消して pending に戻す
RESET_TRANSLATION = sql.SQL(
    "update public.feed_entries set "
    "title_ja = null, summary_ja = null, translated_at = null, "
    "translate_status = 'pending', translate_attempts = 0 "
    "where id = %s")

INSERT_ENTRY = sql.SQL(
    "insert into public.feed_entries "
    "(id, source_id, kind, vendor, product, title, summary, url, published_at, lang, "
    "translate_status, cve_ids, severity, cvss, exploited, status) values ("
    "%(id)s, %(source_id)s, %(kind)s, %(vendor)s, %(product)s, %(title)s, %(summary)s, "
    "%(url)s::text, %(published_at)s::timestamptz, %(lang)s, %(translate_status)s, "
    "%(cve_ids)s::text[], %(severity)s::text, %(cvss)s::numeric, %(exploited)s, %(status)s)")

# 同じ CVE を持つ、最も古い脆弱性の行(first_seen_at が同じなら id の順)
SELECT_MERGE_TARGET = sql.SQL(
    "select id, cve_ids, severity, cvss, exploited from public.feed_entries "
    "where kind = 'vuln' and cve_ids && %s::text[] "
    "order by first_seen_at, id limit 1 for update")

MERGE_KEV = sql.SQL(
    "update public.feed_entries set exploited = true, cve_ids = %s::text[] where id = %s")

MERGE_JVN = sql.SQL(
    "update public.feed_entries set severity = %s::text, cvss = %s::numeric, cve_ids = %s::text[] "
    "where id = %s")

# 成功(304 を含む):失敗の数を 0 に戻す。304 で ETag が来なければ前の値を残す
STATE_SUCCESS = sql.SQL(
    "insert into public.feed_source_state as s "
    "(source_id, etag, last_modified, last_attempt_at, last_success_at, consecutive_failures, last_error) "
    "values (%(source_id)s, %(etag)s::text, %(last_modified)s::text, now(), now(), 0, '') "
    "on conflict (source_id) do update set "
    "etag = case when %(keep)s::boolean then coalesce(excluded.etag, s.etag) else excluded.etag end, "
    "last_modified = case when %(keep)s::boolean "
    "then coalesce(excluded.last_modified, s.last_modified) else excluded.last_modified end, "
    "last_attempt_at = now(), last_success_at = now(), consecutive_failures = 0, last_error = '', "
    "updated_at = now() "
    "returning consecutive_failures")

# 失敗:数を 1 足し、決まりの番号だけを残す。etag は変えない(次回も全部を取り直すため)
STATE_FAILURE = sql.SQL(
    "insert into public.feed_source_state as s "
    "(source_id, last_attempt_at, consecutive_failures, last_error) "
    "values (%(source_id)s, now(), 1, %(code)s) "
    "on conflict (source_id) do update set "
    "last_attempt_at = now(), consecutive_failures = s.consecutive_failures + 1, "
    "last_error = excluded.last_error, updated_at = now() "
    "returning consecutive_failures")

COUNT_PENDING = sql.SQL(
    "select count(*) from public.feed_entries where translate_status = 'pending'")

# --- 翻訳(依頼 12-4。詳細設計 3.13) ---
# 訳す候補:pending で、失敗が上限より少ない行を新しい順に(索引 feed_entries_pending_idx)
SELECT_TRANSLATE_TARGETS = sql.SQL(
    "select id, source_id, vendor, product, title, summary from public.feed_entries "
    "where translate_status = 'pending' and translate_attempts < %s "
    "order by sort_at desc, id")

SELECT_USAGE = sql.SQL(
    "select chars from public.feed_translate_usage where month = %s")

# 送ったときと原文が同じで、まだ pending の行だけを done にする(訳している間に変わった行は次の回に訳し直す)
SAVE_TRANSLATION = sql.SQL(
    "update public.feed_entries set "
    "title_ja = %(title_ja)s, summary_ja = %(summary_ja)s::text, translated_at = now(), translate_status = 'done' "
    "where id = %(id)s and translate_status = 'pending' and title = %(title)s and summary = %(summary)s")

# 今月の行に足す(無ければ作る)。足した後の chars を返す
ADD_USAGE = sql.SQL(
    "insert into public.feed_translate_usage as u (month, chars, requests) values (%s, %s, 1) "
    "on conflict (month) do update set "
    "chars = u.chars + excluded.chars, requests = u.requests + 1, updated_at = now() "
    "returning chars")

# 失敗の回数を 1 足し、上限に達したら failed にする(右辺の translate_attempts は足す前の値)
RECORD_FAILURE = sql.SQL(
    "update public.feed_entries set "
    "translate_attempts = translate_attempts + 1, "
    "translate_status = case when translate_attempts + 1 >= %(max)s then 'failed' else translate_status end "
    "where id = any(%(ids)s::text[]) and translate_status = 'pending' "
    "returning translate_status")


@dataclass
class WriteStats:
    inserted: int = 0
    updated: int = 0
    merged: int = 0
    unchanged: int = 0
    failures: int = 0  # 書いた後の consecutive_failures


def build_feed_conninfo(url: str, ca_path: str | None) -> str:
    """同期の build_conninfo(localhost 以外は verify-full と --ca)を使い、application_name だけ替える。"""
    params: dict[str, Any] = conninfo_to_dict(build_conninfo(url, ca_path))
    params["application_name"] = APP_NAME
    try:
        return make_conninfo("", **params)
    except Exception:
        raise DbError("E-DB-CONFIG") from None


def connect(url: str, ca_path: str | None) -> psycopg.Connection[Any]:
    conninfo = build_feed_conninfo(url, ca_path)
    try:
        # prepare_threshold=None:サーバー側の prepared statement を使わない(Supabase のプーラーでも動くように)
        return psycopg.connect(conninfo, autocommit=False, prepare_threshold=None)
    except Exception:
        raise DbError("E-DB-CONNECT") from None


def read_states(conn: psycopg.Connection[Any]) -> dict[str, tuple[str | None, str | None]]:
    """取得先ごとの (etag, last_modified)。条件付きの GET に使う。"""
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            rows = conn.execute(SELECT_STATES).fetchall()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None
    return {r[0]: (r[1], r[2]) for r in rows}


def _merge(conn: psycopg.Connection[Any], o: SourceOutcome, e: Entry) -> str | None:
    """同じ CVE の行があれば、新しい行を作らずに最も古い行へまとめる。'merged'・'unchanged'、無ければ None。"""
    row = conn.execute(SELECT_MERGE_TARGET, (e.cve_ids,)).fetchone()
    if row is None:
        return None
    target_id, cves, severity, cvss, exploited = row
    fmt = o.source.format
    # どちらも、まとめ先の行に足りない CVE を足す(50 個まで。0002 の CHECK)
    new_cves = (list(cves) + [c for c in e.cve_ids if c not in cves])[:MAX_CVES]
    if fmt == "kev-json":
        # KEV:exploited を立て、cveID が無ければ足す(KEV の cve_ids は [cveID] だけ)
        if exploited and new_cves == list(cves):
            return "unchanged"
        conn.execute(MERGE_KEV, (new_cves, target_id))
        return "merged"
    if fmt == "rss1":
        # JVN の severity・cvss を優先する(JVN に値が無ければ元の値のまま)
        new_sev = e.severity if e.severity is not None else severity
        new_cvss = e.cvss if e.cvss is not None else cvss
        if (new_sev, new_cvss, new_cves) == (severity, cvss, list(cves)):
            return "unchanged"
        conn.execute(MERGE_JVN, (new_sev, new_cvss, new_cves, target_id))
        return "merged"
    return "unchanged"


def _write_entry(conn: psycopg.Connection[Any], o: SourceOutcome, e: Entry) -> str:
    """1件を書く。'inserted'・'updated'・'merged'・'unchanged' のどれかを返す。"""
    cur = conn.execute(SELECT_BY_ID, (e.id,)).fetchone()
    if cur is not None:
        new = (e.title, e.summary, e.url, e.published_at, e.status)
        if tuple(cur) == new:
            return "unchanged"
        conn.execute(UPDATE_BY_ID, {"id": e.id, "title": e.title, "summary": e.summary, "url": e.url,
                                    "published_at": e.published_at, "status": e.status})
        if o.source.lang == "en" and (cur[0], cur[1]) != (e.title, e.summary):
            conn.execute(RESET_TRANSLATION, (e.id,))
        return "updated"
    if o.source.kind == "vuln" and e.cve_ids:
        merged = _merge(conn, o, e)
        if merged is not None:
            return merged
    conn.execute(INSERT_ENTRY, {
        "id": e.id, "source_id": o.source.id, "kind": o.source.kind,
        "vendor": e.vendor, "product": e.product, "title": e.title, "summary": e.summary,
        "url": e.url, "published_at": e.published_at, "lang": o.source.lang,
        "translate_status": "skip" if o.source.lang == "ja" else "pending",
        "cve_ids": e.cve_ids, "severity": e.severity, "cvss": e.cvss,
        "exploited": e.exploited, "status": e.status,
    })
    return "inserted"


def write_all(conn: psycopg.Connection[Any], outcomes: list[SourceOutcome]) -> tuple[dict[str, WriteStats], int]:
    """全部の取得先の分を1つのトランザクションで書く。(取得先ごとの数, pending の行の数) を返す。

    途中で失敗したら全部を取り消して DbError("E-DB-WRITE")(どの行も変わらない)。
    """
    stats: dict[str, WriteStats] = {}
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '60s'")
            for o in outcomes:
                st = WriteStats()
                if o.ok:
                    for e in o.entries:
                        r = _write_entry(conn, o, e)
                        setattr(st, r, getattr(st, r) + 1)
                    row = conn.execute(STATE_SUCCESS, {
                        "source_id": o.source.id, "etag": o.etag, "last_modified": o.last_modified,
                        "keep": o.not_modified}).fetchone()
                else:
                    row = conn.execute(STATE_FAILURE, {"source_id": o.source.id, "code": o.code}).fetchone()
                st.failures = int(row[0]) if row is not None else 0
                stats[o.source.id] = st
            pending_row = conn.execute(COUNT_PENDING).fetchone()
            pending = int(pending_row[0]) if pending_row is not None else 0
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
    return stats, pending


def read_usage(conn: psycopg.Connection[Any], month: dt.date) -> int:
    """今月(日本時間の月の初日)の chars。行が無ければ 0。"""
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            row = conn.execute(SELECT_USAGE, (month,)).fetchone()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None
    return int(row[0]) if row is not None else 0


def read_translate_targets(conn: psycopg.Connection[Any], max_attempts: int) -> list[PendingRow]:
    """訳す候補の行(新しい順)。取得先の設定で選ぶのは feedtranslate.select_jobs。"""
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            rows = conn.execute(SELECT_TRANSLATE_TARGETS, (max_attempts,)).fetchall()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None
    return [PendingRow(id=r[0], source_id=r[1], vendor=r[2], product=r[3], title=r[4], summary=r[5])
            for r in rows]


def count_pending(conn: psycopg.Connection[Any]) -> int:
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            row = conn.execute(COUNT_PENDING).fetchone()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None
    return int(row[0]) if row is not None else 0


def save_translations(conn: psycopg.Connection[Any], saves: list[Save], month: dt.date,
                      chars: int) -> tuple[int, int]:
    """1要求の訳を1つのトランザクションで保存し、usage に chars と要求 1 回を足す。(done にした数, 今月の chars)。"""
    done = 0
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            for s in saves:
                cur = conn.execute(SAVE_TRANSLATION, {
                    "id": s.id, "title": s.title, "summary": s.summary,
                    "title_ja": s.title_ja, "summary_ja": s.summary_ja})
                done += max(cur.rowcount, 0)
            row = conn.execute(ADD_USAGE, (month, chars)).fetchone()
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
    return done, int(row[0]) if row is not None else 0


def record_failures(conn: psycopg.Connection[Any], ids: list[str], max_attempts: int) -> int:
    """1要求の行の失敗の回数を1つのトランザクションで足す(上限で failed)。failed になった数を返す。"""
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            rows = conn.execute(RECORD_FAILURE, {"ids": ids, "max": max_attempts}).fetchall()
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
    return sum(1 for r in rows if r[0] == "failed")
