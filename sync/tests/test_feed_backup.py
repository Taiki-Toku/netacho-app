"""公式フィードのバックアップと戻しの試験(依頼 12-6。詳細設計 3.14.5)。TST-BK-01〜06。

DB の試験は conftest の土台(PostgreSQL 16 に 0001〜0003)を使い、feed-backup・feed-restore は admin でつないで
`set role netacho_feed` にした接続で動かす(本番の FEED_DB_URL の代わり)。値はすべて架空。
NODAL_TEST_ADMIN_URL・NODAL_TEST_SYNC_URL が無ければ skip(NODAL_REQUIRE_DB=1 なら失敗)。
"""

from __future__ import annotations

import datetime as dt
import io
import json
from pathlib import Path
from typing import Any

import pytest

import nodal_sync.__main__ as cli

UTC = dt.timezone.utc
FAKE_URL = "postgresql://unused@localhost/unused"
SECRET_TITLE = "::warning::Fictional secret backup title"
SECRET_URL = "https://leak.example.com/fictional-secret-path"
SECRET_ETAG = "fictional-etag-should-not-be-exported"


def _id(n: int) -> str:
    return f"{n:032x}"


@pytest.fixture
def fb() -> Any:
    pytest.importorskip("psycopg")
    from nodal_sync import feedbackup
    return feedbackup


@pytest.fixture
def bk_db(db_urls: tuple[str, str]) -> str:
    """feed の3表を空にし、admin の URL を返す。"""
    import psycopg
    with psycopg.connect(db_urls[0], autocommit=True) as c:
        c.execute("delete from public.feed_entries")
        c.execute("delete from public.feed_source_state")
        c.execute("delete from public.feed_translate_usage")
    return db_urls[0]


def feed_conn(admin_url: str) -> Any:
    """admin でつなぎ、netacho_feed に切り替えた接続。"""
    from nodal_sync import feedbackup
    c = feedbackup.connect(admin_url, None)
    c.execute("set role netacho_feed")
    c.commit()
    return c


def never_connect(url: str, ca: str | None) -> Any:
    raise AssertionError("DB に接続した")


def insert_entry(admin_sql: Any, n: int, **over: Any) -> str:
    """admin で1行入れる(first_seen_at・updated_at も決めた値で)。"""
    row: dict[str, Any] = {
        "id": _id(n), "source_id": "example-status", "kind": "outage", "vendor": "Example",
        "product": "Example Cloud", "title": f"Fictional title {n}", "summary": f"Fictional summary {n}",
        "url": f"https://news.example.com/{n}", "published_at": dt.datetime(2026, 11, 20, 9, 0, tzinfo=UTC),
        "first_seen_at": dt.datetime(2026, 11, 20, 9, 5, 0, 123456, tzinfo=UTC), "lang": "en",
        "title_ja": None, "summary_ja": None, "translate_status": "pending", "translate_attempts": 0,
        "translated_at": None, "cve_ids": [], "severity": None, "cvss": None, "exploited": False,
        "status": "", "digest_date": None,
        "updated_at": dt.datetime(2026, 11, 20, 9, 6, tzinfo=UTC),
    }
    row.update(over)
    cols = ", ".join(row)
    vals = ", ".join(f"%({k})s" + ("::text[]" if k == "cve_ids" else "") for k in row)
    # 列名は試験の中の固定の値だけ
    admin_sql(f"insert into public.feed_entries ({cols}) values ({vals})", row)
    return str(row["id"])


@pytest.fixture
def sqlrun(admin_sql: Any, bk_db: str) -> Any:
    """feed の3表を空にした後の、admin で SQL を流す関数。"""
    return admin_sql


def insert_usage(sqlrun: Any, month: str, chars: int, requests: int) -> None:
    sqlrun("insert into public.feed_translate_usage (month, chars, requests, updated_at) "
           "values (%s::date, %s, %s, '2026-11-20T00:00:00Z')", (month, chars, requests))


def snapshot(sqlrun: Any) -> tuple[Any, Any, Any]:
    return (sqlrun("select * from public.feed_entries order by id"),
            sqlrun("select * from public.feed_translate_usage order by month"),
            sqlrun("select * from public.feed_source_state order by source_id"))


def run_backup(admin_url: str, out_dir: Path, summary: Path | None = None,
               out: io.StringIO | None = None) -> int:
    env = {"FEED_DB_URL": FAKE_URL}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    return cli.main(["feed-backup", "--out", str(out_dir)], env=env, out=out or io.StringIO(),
                    feed_connect=lambda url, ca: feed_conn(admin_url))


def run_restore(admin_url: str | None, in_dir: Path, dry_run: bool = False, summary: Path | None = None,
                out: io.StringIO | None = None) -> int:
    env = {"FEED_DB_URL": FAKE_URL}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    args = ["feed-restore", "--in", str(in_dir)] + (["--dry-run"] if dry_run else [])
    connect = never_connect if admin_url is None else (lambda url, ca: feed_conn(admin_url))
    return cli.main(args, env=env, out=out or io.StringIO(), feed_connect=connect)


def files(d: Path) -> dict[str, bytes]:
    return {str(p.relative_to(d)): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()}


def read_rows(p: Path) -> list[dict[str, Any]]:
    return [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines()]


def write_rows(p: Path, rows: list[dict[str, Any]]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"
                           for r in rows))


# ---------------------------------------------------------------
# TST-BK-01
# ---------------------------------------------------------------
def test_tst_bk_01_month_split_order_and_stable_bytes(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-01:日本時間の月の境目で分け、キーは列の順、行は id の順。同じ中身なら同じバイト列。"""
    # 日本時間 2026-10-31 23:59:59.999999(UTC 14:59:59.999999)は 10 月、UTC 15:00 は日本時間 11-01 で 11 月
    insert_entry(sqlrun, 3, first_seen_at=dt.datetime(2026, 10, 31, 14, 59, 59, 999999, tzinfo=UTC))
    insert_entry(sqlrun, 9, first_seen_at=dt.datetime(2026, 10, 31, 15, 0, 0, tzinfo=UTC))
    insert_entry(sqlrun, 2, first_seen_at=dt.datetime(2026, 11, 20, 1, 0, tzinfo=UTC))
    insert_entry(sqlrun, 5, kind="vuln", source_id="example-kev", cve_ids=["CVE-2026-91001"],
                 severity="critical", cvss=9.8, exploited=True, digest_date=dt.date(2026, 11, 21),
                 first_seen_at=dt.datetime(2026, 11, 2, 0, 0, tzinfo=UTC))
    insert_usage(sqlrun, "2026-11-01", 1234, 3)
    insert_usage(sqlrun, "2026-10-01", 99, 1)

    out1 = tmp_path / "a"
    out1.mkdir()
    assert run_backup(bk_db, out1) == 0
    got = files(out1)
    assert sorted(got) == ["feed/2026-10.jsonl", "feed/2026-11.jsonl", "usage.jsonl"]
    oct_rows = read_rows(out1 / "feed" / "2026-10.jsonl")
    nov_rows = read_rows(out1 / "feed" / "2026-11.jsonl")
    assert [r["id"] for r in oct_rows] == [_id(3)]
    assert [r["id"] for r in nov_rows] == [_id(2), _id(5), _id(9)]  # id の順
    for r in oct_rows + nov_rows:
        assert list(r) == list(fb.ENTRY_NAMES)  # キーは列の順
    assert oct_rows[0]["first_seen_at"] == "2026-10-31T14:59:59.999999Z"  # UTC の ISO 8601
    assert nov_rows[2]["first_seen_at"] == "2026-10-31T15:00:00.000000Z"
    vuln = nov_rows[1]
    assert vuln["cvss"] == "9.8" and vuln["digest_date"] == "2026-11-21"  # numeric は文字列
    assert vuln["cve_ids"] == ["CVE-2026-91001"] and vuln["exploited"] is True
    assert [json.loads(ln) for ln in got["usage.jsonl"].decode().splitlines()] == [
        {"month": "2026-10-01", "chars": 99, "requests": 1, "updated_at": "2026-11-20T00:00:00.000000Z"},
        {"month": "2026-11-01", "chars": 1234, "requests": 3, "updated_at": "2026-11-20T00:00:00.000000Z"},
    ]
    # 区切りに空白を入れない、1行に1件、最後は改行
    assert got["feed/2026-11.jsonl"].count(b"\n") == 3 and got["feed/2026-11.jsonl"].endswith(b"\n")
    assert b'": ' not in got["feed/2026-11.jsonl"]

    # 同じ中身なら、別のフォルダでも同じバイト列
    out2 = tmp_path / "b"
    out2.mkdir()
    assert run_backup(bk_db, out2) == 0
    assert files(out2) == got

    # 同じフォルダにもう一度:前の feed/ は空にしてから書く(消えた月が残らない)。feed/ と usage.jsonl 以外は触らない
    (out1 / "feed" / "2020-01.jsonl").write_bytes(b"stale\n")
    (out1 / "README.md").write_bytes(b"keep\n")
    assert run_backup(bk_db, out1) == 0
    after = files(out1)
    assert "feed/2020-01.jsonl" not in after and after["README.md"] == b"keep\n"
    after.pop("README.md")
    assert after == got


def test_tst_bk_01_out_dir_checks(bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-01:--out がフォルダでない・feed/ がリンクなら、書かずに終了コード 2。"""
    out = io.StringIO()
    assert run_backup(bk_db, tmp_path / "missing", out=out) == 2
    assert "E-BACKUP-OUT" in out.getvalue()
    target = tmp_path / "elsewhere"
    target.mkdir()
    (target / "keep.jsonl").write_bytes(b"keep\n")
    d = tmp_path / "out"
    d.mkdir()
    (d / "feed").symlink_to(target)
    out = io.StringIO()
    assert run_backup(bk_db, d, out=out) == 2
    assert "E-BACKUP-OUT" in out.getvalue()
    assert (target / "keep.jsonl").read_bytes() == b"keep\n"  # リンクの先は消さない
    # feed/ の下にフォルダがある・usage.jsonl がフォルダ:消さずに止まる
    d2 = tmp_path / "out2"
    (d2 / "feed" / "sub").mkdir(parents=True)
    (d2 / "feed" / "sub" / "keep.jsonl").write_bytes(b"keep\n")
    out = io.StringIO()
    assert run_backup(bk_db, d2, out=out) == 2 and "E-BACKUP-OUT" in out.getvalue()
    assert (d2 / "feed" / "sub" / "keep.jsonl").read_bytes() == b"keep\n"
    d3 = tmp_path / "out3"
    (d3 / "usage.jsonl").mkdir(parents=True)
    out = io.StringIO()
    assert run_backup(bk_db, d3, out=out) == 2 and "E-BACKUP-OUT" in out.getvalue()


# ---------------------------------------------------------------
# TST-BK-02
# ---------------------------------------------------------------
def test_tst_bk_02_no_generated_column_no_source_state_no_values(sqlrun: Any, bk_db: str, tmp_path: Path,
                                                                fb: Any) -> None:
    """TST-BK-02:生成列の sort_at と feed_source_state を書き出さない。要約とログに行の中身が出ない。"""
    # 書き出す列は、表の生成列でない列ちょうど(列が足されたら、この試験が落ちて一覧の直しに気づく)
    cols = sqlrun("select column_name from information_schema.columns "
                  "where table_schema = 'public' and table_name = 'feed_entries' and is_generated = 'NEVER' "
                  "order by ordinal_position")
    assert tuple(c[0] for c in cols) == fb.ENTRY_NAMES
    ucols = sqlrun("select column_name from information_schema.columns "
                   "where table_schema = 'public' and table_name = 'feed_translate_usage' order by ordinal_position")
    assert tuple(c[0] for c in ucols) == fb.USAGE_NAMES

    insert_entry(sqlrun, 1, title=SECRET_TITLE, url=SECRET_URL, summary="::error::fictional secret body")
    sqlrun("insert into public.feed_source_state (source_id, etag, last_modified) values ('example-status', %s, %s)",
           (SECRET_ETAG, "Fri, 20 Nov 2026 09:00:00 GMT"))
    d = tmp_path / "out"
    d.mkdir()
    summary = tmp_path / "summary.md"
    out = io.StringIO()
    assert run_backup(bk_db, d, summary=summary, out=out) == 0
    got = files(d)
    assert sorted(got) == ["feed/2026-11.jsonl", "usage.jsonl"]
    assert got["usage.jsonl"] == b""
    blob = b"".join(got.values())
    assert b"sort_at" not in blob and SECRET_ETAG.encode() not in blob and b"consecutive_failures" not in blob
    assert SECRET_TITLE.encode() in blob  # 行の中身はファイルにだけある
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    for v in [SECRET_TITLE, SECRET_URL, "leak.example.com", "fictional secret body", "::warning::", "::error::",
              _id(1), SECRET_ETAG]:
        assert v not in text, v
    assert "| 2026-11 | 1 |" in text and "feed_entries:1 行(1 か月)" in text
    assert "Traceback" not in text


def test_tst_bk_02_missing_url_and_conninfo(tmp_path: Path, fb: Any) -> None:
    """TST-BK-02:FEED_DB_URL が無ければ接続せず 2。接続は verify-full と --ca、application_name は nodal-backup。"""
    from psycopg.conninfo import conninfo_to_dict

    from nodal_sync import db
    d = tmp_path / "out"
    d.mkdir()
    out = io.StringIO()
    assert cli.main(["feed-backup", "--out", str(d)], env={}, out=out, feed_connect=never_connect) == 2
    assert "E-FEED-DB-URL" in out.getvalue() and files(d) == {}
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    info = conninfo_to_dict(fb.build_backup_conninfo(
        "postgresql://netacho_feed.ref@pooler.example.invalid:5432/postgres?sslmode=disable", str(ca)))
    assert info["sslmode"] == "verify-full" and info["sslrootcert"] == str(ca)
    assert info["application_name"] == "nodal-backup"
    with pytest.raises(db.DbError):
        fb.build_backup_conninfo("postgresql://u@pooler.example.invalid/postgres", None)


# ---------------------------------------------------------------
# TST-BK-03
# ---------------------------------------------------------------
def valid_row(n: int = 1, **over: Any) -> dict[str, Any]:
    r: dict[str, Any] = {
        "id": _id(n), "source_id": "example-status", "kind": "outage", "vendor": "Example",
        "product": "Example Cloud", "title": f"Fictional title {n}", "summary": "", "url": None,
        "published_at": None, "first_seen_at": "2026-11-20T09:00:00.000000Z", "lang": "en",
        "title_ja": None, "summary_ja": None, "translate_status": "pending", "translate_attempts": 0,
        "translated_at": None, "cve_ids": [], "severity": None, "cvss": None, "exploited": False,
        "status": "", "digest_date": None, "updated_at": "2026-11-20T09:00:00.000000Z",
    }
    r.update(over)
    return r


VULN = {"kind": "vuln", "source_id": "example-kev"}
BAD_ROWS: list[tuple[str, dict[str, Any]]] = [
    ("id の形", {"id": "G" * 32}),
    ("id の長さ", {"id": "a" * 31}),
    ("source_id", {"source_id": "-bad"}),
    ("kind", {"kind": "news"}),
    ("url が http", {"url": "http://news.example.com/1"}),
    ("url が javascript", {"url": "javascript:alert(1)"}),
    ("url の長さ", {"url": "https://e.example/" + "a" * 2000}),
    ("title が空", {"title": ""}),
    ("title の長さ", {"title": "あ" * 501}),
    ("summary の長さ", {"summary": "a" * 2001}),
    ("vendor の長さ", {"vendor": "a" * 101}),
    ("status の長さ", {"status": "a" * 41}),
    ("title_ja の長さ", {"title_ja": "a" * 1001}),
    ("summary_ja の長さ", {"summary_ja": "a" * 4001}),
    ("NUL", {"summary": "a\x00b"}),
    ("サロゲート", {"summary": "\ud800"}),
    ("title が数", {"title": 1}),
    ("lang", {"lang": "fr"}),
    ("translate_status", {"translate_status": "queued"}),
    ("translate_attempts の範囲", {"translate_attempts": 11}),
    ("translate_attempts が真偽値", {"translate_attempts": True}),
    ("done なのに訳が無い", {"translate_status": "done"}),
    ("ja なのに skip でない", {"lang": "ja"}),
    ("時刻の形", {"first_seen_at": "2026-11-20T09:00:00Z"}),
    ("時刻が実在しない", {"first_seen_at": "2026-02-30T09:00:00.000000Z"}),
    ("first_seen_at が null", {"first_seen_at": None}),
    ("digest_date の形", {"digest_date": "2026/11/20"}),
    ("cve_ids の形", {**VULN, "cve_ids": ["CVE-26-1"]}),
    ("cve_ids の数", {**VULN, "cve_ids": [f"CVE-2026-{90000 + i}" for i in range(51)]}),
    ("cve_ids が文字列", {**VULN, "cve_ids": "CVE-2026-91001"}),
    ("severity", {**VULN, "severity": "urgent"}),
    ("cvss が数", {**VULN, "cvss": 9.8}),
    ("cvss の範囲", {**VULN, "cvss": "10.5"}),
    ("cvss の桁", {**VULN, "cvss": "9.85"}),
    ("exploited が文字列", {**VULN, "exploited": "true"}),
    ("vuln でない行の CVE", {"cve_ids": ["CVE-2026-91001"]}),
    ("vuln でない行の exploited", {"exploited": True}),
]


@pytest.mark.parametrize("label,over", BAD_ROWS, ids=[b for b, _ in BAD_ROWS])
def test_tst_bk_03_parse_entry_rejects(label: str, over: dict[str, Any], fb: Any) -> None:
    """TST-BK-03:0002 の列の型と CHECK に合わない行は不正(1行ずつ)。"""
    fb.parse_entry(json.dumps(valid_row()).encode())  # 元の行は正しい
    with pytest.raises(fb._Bad):
        fb.parse_entry(json.dumps(valid_row(**over)).encode())


def test_tst_bk_03_parse_entry_rejects_shapes(fb: Any) -> None:
    """TST-BK-03:キーの過不足・同じキー・NaN・JSON でない・オブジェクトでない行は不正。"""
    r = valid_row()
    extra = dict(r, sort_at="2026-11-20T09:00:00.000000Z")
    missing = {k: v for k, v in r.items() if k != "status"}
    dup = json.dumps(r)[:-1] + ', "status": ""}'
    for raw in [json.dumps(extra), json.dumps(missing), dup, json.dumps(r).replace('"cvss": null', '"cvss": NaN'),
                "{", "[]", "", b"\xff".decode("latin-1")]:
        with pytest.raises(fb._Bad):
            fb.parse_entry(raw.encode("utf-8"))
    with pytest.raises(fb._Bad):
        fb.parse_entry(b"\xff\xfe")
    ok = valid_row(**VULN, cve_ids=["CVE-2026-91001"], cvss="10.0", severity="high", exploited=True,
                   lang="ja", translate_status="skip", url="https://news.example.com/x",
                   published_at="2026-11-19T00:00:00.000000Z", digest_date="2026-11-21")
    assert fb.parse_entry(json.dumps(ok).encode())["cvss"] == fb.Decimal("10.0")
    for bad_u in [{"month": "2026-11-02", "chars": 0, "requests": 0, "updated_at": "2026-11-20T09:00:00.000000Z"},
                  {"month": "2026-11-01", "chars": -1, "requests": 0, "updated_at": "2026-11-20T09:00:00.000000Z"},
                  {"month": "2026-11-01", "chars": 0, "requests": 2**31, "updated_at": "2026-11-20T09:00:00.000000Z"},
                  {"month": "2026-11-01", "chars": 0, "requests": 0}]:
        with pytest.raises(fb._Bad):
            fb.parse_usage(json.dumps(bad_u).encode())


def test_tst_bk_03_one_bad_row_writes_nothing(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-03:1行でも不正なら、ほかの正しい行も書かずに終了コード 2。ファイル名と行番号だけを出す。"""
    insert_entry(sqlrun, 7)
    insert_usage(sqlrun, "2026-11-01", 10, 1)
    before = snapshot(sqlrun)
    d = tmp_path / "in"
    write_rows(d / "feed" / "2026-10.jsonl", [valid_row(1, first_seen_at="2026-10-01T00:00:00.000000Z")])
    write_rows(d / "feed" / "2026-11.jsonl",
               [valid_row(2), valid_row(3, title=SECRET_TITLE, url="http://leak.example.com/x"), valid_row(4)])
    write_rows(d / "usage.jsonl", [{"month": "2026-11-01", "chars": 999, "requests": 9,
                                    "updated_at": "2026-11-21T00:00:00.000000Z"}])
    summary = tmp_path / "summary.md"
    out = io.StringIO()
    assert run_restore(bk_db, d, summary=summary, out=out) == 2
    assert snapshot(sqlrun) == before
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    assert "E-RESTORE-ROW" in text and "feed/2026-11.jsonl の 2 行目" in text and "不正な行:1" in text
    for v in [SECRET_TITLE, "leak.example.com", _id(3), "::warning::"]:
        assert v not in text, v

    # 同じ id が別のファイルにもう1回ある → 2回目の行が不正
    write_rows(d / "feed" / "2026-11.jsonl", [valid_row(1), valid_row(4)])
    out = io.StringIO()
    assert run_restore(bk_db, d, out=out) == 2
    assert "feed/2026-11.jsonl の 1 行目" in out.getvalue()
    assert snapshot(sqlrun) == before


def test_tst_bk_03_bad_files_write_nothing(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-03:feed/ が無い・名前の形が違う・リンク・usage.jsonl が無いときは、名前を出さずに終了コード 2。"""
    before = snapshot(sqlrun)
    d = tmp_path / "in"
    d.mkdir()
    out = io.StringIO()
    assert run_restore(bk_db, d, out=out) == 2 and "E-RESTORE-FILE" in out.getvalue()
    write_rows(d / "feed" / "2026-11.jsonl", [valid_row(1)])
    out = io.StringIO()
    assert run_restore(bk_db, d, out=out) == 2 and "E-RESTORE-FILE" in out.getvalue()  # usage.jsonl が無い
    write_rows(d / "usage.jsonl", [])
    (d / "feed" / "::warning::x.jsonl").write_bytes(b"")
    out = io.StringIO()
    assert run_restore(bk_db, d, out=out) == 2
    assert "E-RESTORE-FILE" in out.getvalue() and "::warning::x" not in out.getvalue()
    (d / "feed" / "::warning::x.jsonl").unlink()
    (d / "feed" / "2026-12.jsonl").symlink_to(d / "feed" / "2026-11.jsonl")
    out = io.StringIO()
    assert run_restore(bk_db, d, out=out) == 2 and "E-RESTORE-FILE" in out.getvalue()
    assert snapshot(sqlrun) == before


def test_tst_bk_03_db_rejects_midway_rolls_back(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-03:検査を通っても DB が途中の行を拒んだら、それまでの行も取り消して終了コード 2(E-DB-WRITE)。"""
    # DB の exploited=true の脆弱性の行を、vuln でない行で上書きすると、guard が exploited を true に戻し
    # feed_vuln_only に反する(検査はファイルの行だけを見るので通る)
    a = insert_entry(sqlrun, 1, kind="vuln", source_id="example-kev", cve_ids=["CVE-2026-91001"], exploited=True)
    insert_usage(sqlrun, "2026-11-01", 10, 1)
    before = snapshot(sqlrun)
    d = tmp_path / "in"
    write_rows(d / "feed" / "2026-10.jsonl", [valid_row(2, first_seen_at="2026-10-01T00:00:00.000000Z",
                                                        title=SECRET_TITLE)])
    write_rows(d / "feed" / "2026-11.jsonl", [valid_row(1, id=a)])
    write_rows(d / "usage.jsonl", [{"month": "2026-11-01", "chars": 999, "requests": 9,
                                    "updated_at": "2026-11-21T00:00:00.000000Z"}])
    summary = tmp_path / "summary.md"
    out = io.StringIO()
    assert run_restore(bk_db, d, summary=summary, out=out) == 2
    assert snapshot(sqlrun) == before  # 1行目(id 2)も usage も入っていない
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    assert "E-DB-WRITE" in text and SECRET_TITLE not in text and "Traceback" not in text


# ---------------------------------------------------------------
# TST-BK-04
# ---------------------------------------------------------------
def test_tst_bk_04_upsert_rules(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-04:違う行は上書き、同じ行は上書きしない(updated_at が変わらない)、backup に無い行は残る、
    first_seen_at・exploited は守られる、usage は月ごとに大きいほう。"""
    x = insert_entry(sqlrun, 1, kind="vuln", source_id="example-kev", cve_ids=["CVE-2026-91001"], exploited=True,
                     title="Fictional old title")
    y = insert_entry(sqlrun, 2)
    z = insert_entry(sqlrun, 3)
    insert_usage(sqlrun, "2026-11-01", 500, 5)
    insert_usage(sqlrun, "2026-09-01", 50, 2)
    src = tmp_path / "src"
    src.mkdir()
    assert run_backup(bk_db, src) == 0
    rows = {r["id"]: r for r in read_rows(src / "feed" / "2026-11.jsonl")}

    d = tmp_path / "in"
    new_x = dict(rows[x], title="Fictional new title", exploited=False,
                 first_seen_at="2026-11-25T00:00:00.000000Z")
    w = valid_row(4, title="Fictional restored title", first_seen_at="2026-11-01T00:00:00.000000Z")
    write_rows(d / "feed" / "2026-11.jsonl", [new_x, rows[y], w])  # z は backup に無い
    write_rows(d / "usage.jsonl", [
        {"month": "2026-09-01", "chars": 50, "requests": 2, "updated_at": "2026-11-20T00:00:00.000000Z"},
        {"month": "2026-10-01", "chars": 70, "requests": 1, "updated_at": "2026-10-31T00:00:00.000000Z"},
        {"month": "2026-11-01", "chars": 300, "requests": 7, "updated_at": "2026-11-21T00:00:00.000000Z"},
    ])
    y_before = sqlrun("select updated_at from public.feed_entries where id = %s", (y,))
    x_before = sqlrun("select first_seen_at from public.feed_entries where id = %s", (x,))
    summary = tmp_path / "summary.md"
    assert run_restore(bk_db, d, summary=summary) == 0

    got = {r[0]: r for r in sqlrun("select id, title, exploited, first_seen_at, updated_at "
                                   "from public.feed_entries order by id")}
    assert set(got) == {x, y, z, _id(4)}  # z は残る(消さない)
    assert got[x][1] == "Fictional new title"  # 上書き
    assert got[x][2] is True  # exploited は true から戻らない
    assert got[x][3] == x_before[0][0]  # first_seen_at は DB の値のまま
    assert got[y][4] == y_before[0][0]  # 同じ中身の行は上書きしない
    assert got[_id(4)][1] == "Fictional restored title"
    assert got[_id(4)][3] == dt.datetime(2026, 11, 1, tzinfo=UTC)  # 新しい行は backup の値で入る
    usage = sqlrun("select month::text, chars, requests from public.feed_translate_usage order by month")
    assert usage == [("2026-09-01", 50, 2), ("2026-10-01", 70, 1), ("2026-11-01", 500, 7)]
    text = summary.read_text(encoding="utf-8")
    assert "| feed_entries | 3 | 1 | 1 | 1 |" in text
    assert "| feed_translate_usage | 3 | 1 | 1 | 1 |" in text
    assert "Fictional" not in text


# ---------------------------------------------------------------
# TST-BK-05
# ---------------------------------------------------------------
def test_tst_bk_05_round_trip(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-05:書き出し → 空の DB に戻す → もう一度書き出すと、同じファイルになる。表の行も同じ。"""
    insert_entry(sqlrun, 1)
    insert_entry(sqlrun, 2, kind="vuln", source_id="example-jvn", lang="ja", translate_status="skip",
                 cve_ids=["CVE-2026-91001", "CVE-2026-91002"], severity="high", cvss=7.5,
                 published_at=None, url=None, digest_date=dt.date(2026, 11, 21), status="公開",
                 title="架空の脆弱性のタイトル", summary="改行を含む\n架空の本文\t\"引用\"")
    insert_entry(sqlrun, 3, title_ja="架空の訳", summary_ja="架空の訳の本文", translate_status="done",
                 translated_at=dt.datetime(2026, 11, 20, 10, 0, 0, 1, tzinfo=UTC), translate_attempts=1,
                 first_seen_at=dt.datetime(2026, 9, 30, 15, 0, tzinfo=UTC))
    insert_entry(sqlrun, 4, translate_status="failed", translate_attempts=3, vendor="", product="")
    insert_usage(sqlrun, "2026-11-01", 12345, 6)
    before = snapshot(sqlrun)
    a = tmp_path / "a"
    a.mkdir()
    assert run_backup(bk_db, a) == 0
    first = files(a)
    assert sorted(first) == ["feed/2026-10.jsonl", "feed/2026-11.jsonl", "usage.jsonl"]

    sqlrun("delete from public.feed_entries")
    sqlrun("delete from public.feed_translate_usage")
    summary = tmp_path / "summary.md"
    assert run_restore(bk_db, a, summary=summary) == 0
    assert "| feed_entries | 4 | 4 | 0 | 0 |" in summary.read_text(encoding="utf-8")
    assert snapshot(sqlrun) == before

    b = tmp_path / "b"
    b.mkdir()
    assert run_backup(bk_db, b) == 0
    assert files(b) == first

    # もう一度同じ backup を戻しても、どの行も上書きしない(次の書き出しのファイルが変わらない)
    summary2 = tmp_path / "summary2.md"
    assert run_restore(bk_db, a, summary=summary2) == 0
    assert "| feed_entries | 4 | 0 | 0 | 4 |" in summary2.read_text(encoding="utf-8")
    assert "| feed_translate_usage | 1 | 0 | 0 | 1 |" in summary2.read_text(encoding="utf-8")
    assert snapshot(sqlrun) == before


# ---------------------------------------------------------------
# TST-BK-06
# ---------------------------------------------------------------
def test_tst_bk_06_dry_run_writes_nothing(sqlrun: Any, bk_db: str, tmp_path: Path, fb: Any) -> None:
    """TST-BK-06:dry-run は検査と件数だけで、DB に接続しない(書かない)。不正な行は dry-run でも 2。"""
    insert_entry(sqlrun, 1, title="Fictional db title")
    before = snapshot(sqlrun)
    d = tmp_path / "in"
    write_rows(d / "feed" / "2026-11.jsonl", [valid_row(1, title="Fictional changed"), valid_row(2)])
    write_rows(d / "usage.jsonl", [{"month": "2026-11-01", "chars": 9, "requests": 1,
                                    "updated_at": "2026-11-21T00:00:00.000000Z"}])
    summary = tmp_path / "summary.md"
    assert run_restore(None, d, dry_run=True, summary=summary) == 0
    assert snapshot(sqlrun) == before
    text = summary.read_text(encoding="utf-8")
    assert "dry-run" in text and "| feed_entries | 2 | - | - | - |" in text
    assert "| feed_translate_usage | 1 | - | - | - |" in text

    write_rows(d / "feed" / "2026-11.jsonl", [valid_row(1, kind="bad")])
    out = io.StringIO()
    assert run_restore(None, d, dry_run=True, out=out) == 2
    assert "E-RESTORE-ROW" in out.getvalue()
    assert snapshot(sqlrun) == before


def test_restore_args_do_not_echo_values() -> None:
    """引数が正しくなくても、その値を表示しない。"""
    out = io.StringIO()
    assert cli.main(["feed-restore", "--bogus", "::warning::x"], env={}, out=out) == 2
    assert "::warning::x" not in out.getvalue() and "E-ARGS" in out.getvalue()
    out = io.StringIO()
    assert cli.main(["feed-backup"], env={}, out=out) == 2 and "E-ARGS" in out.getvalue()
