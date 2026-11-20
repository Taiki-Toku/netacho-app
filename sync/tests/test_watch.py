"""watch の試験(DB を使う)。TST-SYNC-16・17。GitHub の API は差し替える。"""

from __future__ import annotations

import datetime as dt
import io
import json
from pathlib import Path
from typing import Any

import nodal_sync.__main__ as cli
from helpers import TODAY, make_item, write_config
from nodal_sync import schema

S = "b" * 40
FEED_A = "0123456789abcdef0123456789abcdef"
FEED_B = "fedcba9876543210fedcba9876543210"


def gh_ok(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
    if url.endswith("/commits/main"):
        return 200, json.dumps({"sha": S}).encode()
    if url.endswith(f"/commits/{S}/pulls"):
        return 200, json.dumps([{"number": 3, "merged_at": "2026-11-20T00:00:00Z",
                                 "merge_commit_sha": S, "base": {"ref": "main"}}]).encode()
    if url.endswith("/pulls/3"):
        return 200, json.dumps({"merged_by": {"login": "Taiki-Toku"}}).encode()
    return 404, b""


def gh_other_merger(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
    if url.endswith("/pulls/3"):
        return 200, json.dumps({"merged_by": {"login": "someone-else"}}).encode()
    return gh_ok(url, headers)


def watch(tmp_path: Path, sync_url: str, *, gh: Any = gh_ok, summary: Path | None = None,
          **cfg_over: Any) -> int:
    cfg = write_config(tmp_path, **cfg_over)
    env = {"SYNC_DB_URL": sync_url, "GITHUB_TOKEN": "test-token"}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    data_dir = tmp_path / "ai-netacho"
    data_dir.mkdir(exist_ok=True)
    return cli.main(["watch", "--config", cfg, "--data-dir", str(data_dir)], today=TODAY, env=env,
                    out=io.StringIO(), gh_get=gh)


def put_today_item(sync_url: str, **over: Any) -> None:
    from nodal_sync import db
    res = schema.validate_day(TODAY, [("2026-11-20-01", json.dumps(make_item(**over)).encode())],
                              genres={"agent"}, slots=("新着",), allow_null_genre=False, today=TODAY)
    assert res.valid
    conn = db.connect(sync_url, None)
    try:
        db.write_day(conn, res.rows)
    finally:
        conn.close()


def put_feed(admin_sql: Any, feed_id: str, digest: dt.date | None, hours_ago: int = 1) -> None:
    admin_sql(
        "insert into public.feed_entries (id, source_id, kind, title, lang, digest_date, first_seen_at) "
        "values (%s, 'example-src', 'release', '架空のフィードの題', 'en', %s, now() - make_interval(hours => %s::int))",
        (feed_id, digest, hours_ago),
    )


def put_digest_file(tmp_path: Path) -> None:
    p = tmp_path / "ai-netacho" / "feed_digest" / f"{TODAY.isoformat()}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{}")


def test_tst_sync_16_not_arrived(db_urls: tuple[str, str], tmp_path: Path) -> None:
    """TST-SYNC-16:今日の行が無いと 1、あれば 0。"""
    summary = tmp_path / "summary.md"
    assert watch(tmp_path, db_urls[1], summary=summary) == 1
    assert "W-NOT-ARRIVED" in summary.read_text(encoding="utf-8")
    put_today_item(db_urls[1])
    assert watch(tmp_path, db_urls[1]) == 0


def test_tst_sync_16_main_check(db_urls: tuple[str, str], tmp_path: Path) -> None:
    """watch の 4:main の先頭がオーナーのマージでなければ 1。GITHUB_TOKEN が無ければ 2。"""
    put_today_item(db_urls[1])
    summary = tmp_path / "summary.md"
    assert watch(tmp_path, db_urls[1], gh=gh_other_merger, summary=summary) == 1
    text = summary.read_text(encoding="utf-8")
    assert "W-MAIN-MERGED-BY" in text and "someone-else" not in text
    cfg = write_config(tmp_path)
    code = cli.main(["watch", "--config", cfg, "--data-dir", str(tmp_path)], today=TODAY,
                    env={"SYNC_DB_URL": db_urls[1]}, out=io.StringIO(), gh_get=gh_ok)
    assert code == 2


def test_tst_sync_17_feed_checks(db_urls: tuple[str, str], admin_sql: Any, tmp_path: Path) -> None:
    """TST-SYNC-17:feed_checks が true で、載せ忘れ・一覧の取りこぼしがあると 1。false なら調べない。"""
    put_today_item(db_urls[1], relatedFeedIds=[FEED_A])
    put_feed(admin_sql, FEED_A, TODAY)
    put_digest_file(tmp_path)
    assert watch(tmp_path, db_urls[1], feed_checks=True) == 0

    # 載せ忘れ:今日渡したのに、今日の items のどれにも入っていない
    put_feed(admin_sql, FEED_B, TODAY)
    summary = tmp_path / "summary.md"
    assert watch(tmp_path, db_urls[1], feed_checks=True, summary=summary) == 1
    text = summary.read_text(encoding="utf-8")
    assert "W-FEED-MISSED:1" in text and FEED_B in text and "架空のフィードの題" not in text
    assert watch(tmp_path, db_urls[1], feed_checks=False) == 0
    admin_sql("delete from public.feed_entries where id = %s", (FEED_B,))

    # 一覧の取りこぼし:今日の feed_digest が無い
    (tmp_path / "ai-netacho" / "feed_digest" / f"{TODAY.isoformat()}.json").unlink()
    assert watch(tmp_path, db_urls[1], feed_checks=True) == 1
    assert watch(tmp_path, db_urls[1], feed_checks=False) == 0
    put_digest_file(tmp_path)

    # 一覧の取りこぼし:digest_date が null のまま 24 時間を超えた
    put_feed(admin_sql, FEED_B, None, hours_ago=23)
    assert watch(tmp_path, db_urls[1], feed_checks=True) == 0
    admin_sql("delete from public.feed_entries where id = %s", (FEED_B,))
    put_feed(admin_sql, FEED_B, None, hours_ago=25)
    summary2 = tmp_path / "summary2.md"
    assert watch(tmp_path, db_urls[1], feed_checks=True, summary=summary2) == 1
    assert "W-DIGEST-STALE:1" in summary2.read_text(encoding="utf-8")
    assert watch(tmp_path, db_urls[1], feed_checks=False) == 0
