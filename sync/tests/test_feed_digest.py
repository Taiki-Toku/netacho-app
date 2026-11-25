"""翌朝のニュースへの受け渡しの試験(依頼 12-7。詳細設計 3.15.6)。TST-DG-01〜07。

DB の試験は conftest の土台(PostgreSQL 16 に 0001〜0003)を使い、feed-digest・feed-digest-backlog は admin で
つないで `set role netacho_feed` にした接続で動かす(本番の FEED_DB_URL の代わり)。値はすべて架空。
NODAL_TEST_ADMIN_URL・NODAL_TEST_SYNC_URL が無ければ skip(NODAL_REQUIRE_DB=1 なら失敗)。
TST-DG-05 は DB を使わない(psycopg が無ければ skip)。
"""

from __future__ import annotations

import datetime as dt
import io
import json
import os
from pathlib import Path
from typing import Any

import pytest

import nodal_sync.__main__ as cli

UTC = dt.timezone.utc
JST = dt.timezone(dt.timedelta(hours=9))
FAKE_URL = "postgresql://unused@localhost/unused"
NOW = dt.datetime(2026, 12, 1, 0, 0, tzinfo=UTC)  # 日本時間 2026-12-01 09:00
DAY = dt.date(2026, 12, 1)
SECRET_TITLE = "::warning::Fictional secret digest title"
SECRET_SUMMARY = "Fictional secret digest summary"
SECRET_JA = "架空の秘密の訳"
KEYS = ["id", "kind", "vendor", "product", "cve_ids", "url", "published_at", "status"]


def _id(n: int) -> str:
    return f"{n:032x}"


@pytest.fixture
def fd() -> Any:
    pytest.importorskip("psycopg")
    from nodal_sync import feeddigest
    return feeddigest


@pytest.fixture
def dg_db(db_urls: tuple[str, str]) -> str:
    """feed_entries を空にし、admin の URL を返す。"""
    import psycopg
    with psycopg.connect(db_urls[0], autocommit=True) as c:
        c.execute("delete from public.feed_entries")
    return db_urls[0]


@pytest.fixture
def sqlrun(admin_sql: Any, dg_db: str) -> Any:
    return admin_sql


def feed_conn(admin_url: str) -> Any:
    """admin でつなぎ、netacho_feed に切り替えた接続。"""
    from nodal_sync import feeddigest
    c = feeddigest.connect(admin_url, None)
    c.execute("set role netacho_feed")
    c.commit()
    return c


def never_connect(url: str, ca: str | None) -> Any:
    raise AssertionError("DB に接続した")


def insert_entry(sqlrun: Any, n: int, **over: Any) -> str:
    row: dict[str, Any] = {
        "id": _id(n), "source_id": "example-status", "kind": "outage", "vendor": "Example",
        "product": "Example Cloud", "title": f"{SECRET_TITLE} {n}", "summary": SECRET_SUMMARY,
        "url": f"https://news.example.com/{n}", "published_at": None,
        "first_seen_at": dt.datetime(2026, 11, 30, 20, 0, tzinfo=UTC), "lang": "en",
        "title_ja": None, "summary_ja": None, "translate_status": "pending",
        "translated_at": None, "cve_ids": [], "severity": None, "cvss": None, "exploited": False,
        "status": "", "digest_date": None,
    }
    row.update(over)
    cols = ", ".join(row)
    vals = ", ".join(f"%({k})s" + ("::text[]" if k == "cve_ids" else "") for k in row)
    # 列名は試験の中の固定の値だけ
    sqlrun(f"insert into public.feed_entries ({cols}) values ({vals})", row)
    return str(row["id"])


def snapshot(sqlrun: Any) -> Any:
    return sqlrun("select * from public.feed_entries order by id")


def digest_of(sqlrun: Any) -> dict[str, dt.date | None]:
    return {r[0]: r[1] for r in sqlrun("select id, digest_date from public.feed_entries order by id")}


def run(admin_url: str | None, args: list[str], *, now: dt.datetime = NOW, summary: Path | None = None,
        out: io.StringIO | None = None) -> int:
    env = {"FEED_DB_URL": FAKE_URL}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    connect = never_connect if admin_url is None else (lambda url, ca: feed_conn(admin_url))
    return cli.main(args, env=env, out=out or io.StringIO(), now=now, feed_connect=connect)


def build(admin_url: str, data_dir: Path, *extra: str, now: dt.datetime = NOW,
          summary: Path | None = None, out: io.StringIO | None = None) -> int:
    return run(admin_url, ["feed-digest", "--data-dir", str(data_dir), *extra], now=now, summary=summary,
               out=out)


def commit(admin_url: str | None, data_dir: Path, day: str, *extra: str, summary: Path | None = None) -> int:
    return run(admin_url, ["feed-digest", "--data-dir", str(data_dir), "--commit-db", "--date", day, *extra],
               summary=summary)


def read_digest(data_dir: Path, day: dt.date = DAY) -> dict[str, Any]:
    obj: dict[str, Any] = json.loads((data_dir / "feed_digest" / f"{day.isoformat()}.json").read_text("utf-8"))
    return obj


def ids_in(data_dir: Path, day: dt.date = DAY) -> list[str]:
    return [e["id"] for e in read_digest(data_dir, day)["entries"]]


def all_files(d: Path) -> dict[str, bytes]:
    return {str(p.relative_to(d)): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()}


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    d = tmp_path / "ai-netacho"
    d.mkdir()
    return d


# ---------------------------------------------------------------
# TST-DG-01
# ---------------------------------------------------------------
def test_tst_dg_01_selection_and_order(sqlrun: Any, dg_db: str, data_dir: Path, tmp_path: Path) -> None:
    """TST-DG-01:null・7日以内と今日の行だけ。古い null の行は数えるだけ。並びは sort_at の新しい順。"""
    insert_entry(sqlrun, 1, published_at=dt.datetime(2026, 11, 30, 10, 0, tzinfo=UTC))
    # 7日の境目:NOW - 7日 = 2026-11-24T00:00:00Z ちょうどは入る、1秒前は入らない
    insert_entry(sqlrun, 2, first_seen_at=dt.datetime(2026, 11, 24, 0, 0, 0, tzinfo=UTC))
    insert_entry(sqlrun, 3, first_seen_at=dt.datetime(2026, 11, 23, 23, 59, 59, tzinfo=UTC))
    insert_entry(sqlrun, 4, digest_date=dt.date(2026, 11, 30))  # 前の日に載った行
    insert_entry(sqlrun, 5, digest_date=DAY, published_at=dt.datetime(2026, 11, 30, 21, 10, tzinfo=UTC))
    insert_entry(sqlrun, 6, first_seen_at=dt.datetime(2026, 11, 1, tzinfo=UTC))  # とても古い null の行
    summary = tmp_path / "summary.md"
    out = io.StringIO()
    assert build(dg_db, data_dir, summary=summary, out=out) == 0
    assert ids_in(data_dir) == [_id(5), _id(1), _id(2)]  # sort_at の新しい順
    text = summary.read_text(encoding="utf-8")
    assert "一覧:3 件(今日の行 1/新しい行 2)" in text
    assert "E-DIGEST-OLD:7日より古い null の行 2" in text
    assert "E-DIGEST-OLD" in out.getvalue()
    # 要約とログに行の中身(id・題)を出さない
    for s in (text, out.getvalue()):
        assert SECRET_TITLE not in s and _id(1) not in s and "news.example.com" not in s
    # 一覧を作るだけでは DB は変わらない
    assert digest_of(sqlrun)[_id(1)] is None


def test_tst_dg_01_same_sort_at_is_stable(sqlrun: Any, dg_db: str, data_dir: Path) -> None:
    """TST-DG-01:sort_at が同じなら id の順(何度作っても同じ並び)。"""
    for n in (9, 7, 8):
        insert_entry(sqlrun, n)
    assert build(dg_db, data_dir) == 0
    assert ids_in(data_dir) == [_id(7), _id(8), _id(9)]


# ---------------------------------------------------------------
# TST-DG-02
# ---------------------------------------------------------------
def test_tst_dg_02_file_shape(sqlrun: Any, dg_db: str, data_dir: Path) -> None:
    """TST-DG-02:載せる鍵だけ・題・本文・訳が無い・キーの順が固定・url の null は null のまま。"""
    insert_entry(sqlrun, 1, kind="vuln", source_id="example-kev", vendor="Example", product="Example OS",
                 cve_ids=["CVE-2026-91001", "CVE-2026-91002"], severity="critical", cvss=9.8, exploited=True,
                 url=None, published_at=dt.datetime(2026, 11, 30, 21, 10, 0, 654321, tzinfo=UTC),
                 translate_status="done", title_ja=SECRET_JA, summary_ja=SECRET_JA,
                 translated_at=dt.datetime(2026, 11, 30, 22, 0, tzinfo=UTC))
    insert_entry(sqlrun, 2, status="復旧済み", vendor="Example", product="Example Cloud",
                 published_at=dt.datetime(2026, 11, 30, 9, 0, tzinfo=dt.timezone(dt.timedelta(hours=9))))
    assert build(dg_db, data_dir) == 0
    raw = (data_dir / "feed_digest" / "2026-12-01.json").read_bytes()
    obj = json.loads(raw)
    assert list(obj) == ["version", "date", "entries"]
    assert obj["version"] == 1 and obj["date"] == "2026-12-01"
    for e in obj["entries"]:
        assert list(e) == KEYS
    vuln, outage = obj["entries"]
    assert vuln == {"id": _id(1), "kind": "vuln", "vendor": "Example", "product": "Example OS",
                    "cve_ids": ["CVE-2026-91001", "CVE-2026-91002"], "url": None,
                    "published_at": "2026-11-30T21:10:00Z", "status": ""}
    assert outage["url"] == f"https://news.example.com/{2}"
    assert outage["published_at"] == "2026-11-30T00:00:00Z"  # UTC にそろえる
    assert outage["status"] == "復旧済み"
    assert "復旧済み".encode() in raw  # ensure_ascii=False
    for secret in (SECRET_TITLE, SECRET_SUMMARY, SECRET_JA, "title", "summary", "severity", "cvss"):
        assert secret.encode() not in raw
    assert raw.endswith(b"\n")
    # 同じ中身なら同じバイト列(キーの順が固定)
    assert build(dg_db, data_dir) == 0
    assert (data_dir / "feed_digest" / "2026-12-01.json").read_bytes() == raw


def test_tst_dg_02_empty_still_writes(sqlrun: Any, dg_db: str, data_dir: Path, tmp_path: Path) -> None:
    """TST-DG-02:0件でもファイルを書く(entries は空の配列)。feed_digest/ が無ければ作る。"""
    summary = tmp_path / "summary.md"
    assert build(dg_db, data_dir, summary=summary) == 0
    assert (data_dir / "feed_digest" / "2026-12-01.json").read_bytes() == (
        b'{"version": 1, "date": "2026-12-01", "entries": []}\n')
    text = summary.read_text(encoding="utf-8")
    assert "一覧:0 件" in text and "feed_digest/2026-12-01.json" in text and "E-DIGEST-OLD" not in text


def test_tst_dg_02_today_is_jst(sqlrun: Any, dg_db: str, data_dir: Path) -> None:
    """TST-DG-02:ファイルの日付は日本時間の今日(UTC 15:00 で次の日になる)。"""
    assert build(dg_db, data_dir, now=dt.datetime(2026, 11, 30, 14, 59, 59, tzinfo=UTC)) == 0
    assert build(dg_db, data_dir, now=dt.datetime(2026, 11, 30, 15, 0, 0, tzinfo=UTC)) == 0
    assert sorted(all_files(data_dir)) == ["feed_digest/2026-11-30.json", "feed_digest/2026-12-01.json"]


# ---------------------------------------------------------------
# TST-DG-03
# ---------------------------------------------------------------
def test_tst_dg_03_rerun_same_day(sqlrun: Any, dg_db: str, data_dir: Path) -> None:
    """TST-DG-03:同じ日の2回目は、その日の行と新しい行を合わせて書き直す。前の日に載った行は入らない。"""
    insert_entry(sqlrun, 1, published_at=dt.datetime(2026, 11, 30, 10, 0, tzinfo=UTC))
    insert_entry(sqlrun, 3, digest_date=dt.date(2026, 11, 30))
    assert build(dg_db, data_dir) == 0
    assert ids_in(data_dir) == [_id(1)]
    assert commit(dg_db, data_dir, "2026-12-01") == 0
    assert digest_of(sqlrun)[_id(1)] == DAY

    insert_entry(sqlrun, 2, published_at=dt.datetime(2026, 11, 30, 11, 0, tzinfo=UTC))
    assert build(dg_db, data_dir, now=NOW + dt.timedelta(hours=3)) == 0
    assert ids_in(data_dir) == [_id(2), _id(1)]
    assert commit(dg_db, data_dir, "2026-12-01") == 0
    assert digest_of(sqlrun) == {_id(1): DAY, _id(2): DAY, _id(3): dt.date(2026, 11, 30)}

    # 次の日:前の日に載った行は入らない(0件のファイル)。前の日のファイルは変えない
    before = (data_dir / "feed_digest" / "2026-12-01.json").read_bytes()
    assert build(dg_db, data_dir, now=NOW + dt.timedelta(days=1)) == 0
    assert ids_in(data_dir, dt.date(2026, 12, 2)) == []
    assert (data_dir / "feed_digest" / "2026-12-01.json").read_bytes() == before


def test_tst_dg_03_push_failed_next_day(sqlrun: Any, dg_db: str, data_dir: Path) -> None:
    """3.15.3:--commit-db まで行かなかった行は、翌日の一覧に入る(null のまま)。"""
    insert_entry(sqlrun, 1)
    assert build(dg_db, data_dir) == 0
    assert build(dg_db, data_dir, now=NOW + dt.timedelta(days=1)) == 0
    assert ids_in(data_dir, dt.date(2026, 12, 2)) == [_id(1)]


# ---------------------------------------------------------------
# TST-DG-04
# ---------------------------------------------------------------
def test_tst_dg_04_commit_only_file_ids(sqlrun: Any, dg_db: str, data_dir: Path, tmp_path: Path) -> None:
    """TST-DG-04:--commit-db はファイルの id の行だけを、その日にする。"""
    insert_entry(sqlrun, 1)
    insert_entry(sqlrun, 5, digest_date=DAY)
    assert build(dg_db, data_dir) == 0
    assert ids_in(data_dir) == [_id(1), _id(5)]
    insert_entry(sqlrun, 2)  # 一覧を作った後に入った行(ファイルに無い)
    stamp5 = sqlrun("select updated_at from public.feed_entries where id = %s", (_id(5),))
    summary = tmp_path / "summary.md"
    assert commit(dg_db, data_dir, "2026-12-01", summary=summary) == 0
    assert digest_of(sqlrun) == {_id(1): DAY, _id(2): None, _id(5): DAY}
    # もうその日だった行は書き直さない(guard が updated_at を変えない)
    assert sqlrun("select updated_at from public.feed_entries where id = %s", (_id(5),)) == stamp5
    text = summary.read_text(encoding="utf-8")
    assert "ファイルの id:2/その日にした 1/もうその日 1/DB に無い 0" in text
    assert _id(1) not in text


def test_tst_dg_04_unknown_id_is_counted(sqlrun: Any, dg_db: str, data_dir: Path, tmp_path: Path) -> None:
    """TST-DG-04:DB に無い id は数えるだけ(ほかの行は変えない)。"""
    insert_entry(sqlrun, 1)
    write_file(data_dir, "2026-12-01", [entry(_id(1)), entry(_id(99))])
    summary = tmp_path / "summary.md"
    assert commit(dg_db, data_dir, "2026-12-01", summary=summary) == 0
    assert digest_of(sqlrun) == {_id(1): DAY}
    assert "その日にした 1/もうその日 0/DB に無い 1" in summary.read_text(encoding="utf-8")


def entry(i: Any) -> dict[str, Any]:
    return {"id": i, "kind": "outage", "vendor": "Example", "product": "Example Cloud", "cve_ids": [],
            "url": None, "published_at": None, "status": ""}


def write_file(data_dir: Path, day: str, entries: list[Any], **over: Any) -> None:
    obj: dict[str, Any] = {"version": 1, "date": day, "entries": entries}
    obj.update(over)
    p = data_dir / "feed_digest" / f"{day}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj), encoding="utf-8")


BAD_FILES: list[tuple[str, Any]] = [
    ("upper", lambda d: write_file(d, "2026-12-01", [entry(_id(1)), entry(_id(0xAB).upper())])),
    ("short", lambda d: write_file(d, "2026-12-01", [entry(_id(1)), entry("abc")])),
    ("sql", lambda d: write_file(d, "2026-12-01", [entry(_id(1)), entry("' or true --")])),
    ("number", lambda d: write_file(d, "2026-12-01", [entry(_id(1)), entry(1)])),
    ("duplicate", lambda d: write_file(d, "2026-12-01", [entry(_id(1)), entry(_id(1))])),
    ("extra-key", lambda d: write_file(d, "2026-12-01", [dict(entry(_id(1)), title="x")])),
    ("other-date", lambda d: write_file(d, "2026-12-01", [entry(_id(1))], date="2026-11-30")),
    ("version", lambda d: write_file(d, "2026-12-01", [entry(_id(1))], version=2)),
    ("version-bool", lambda d: write_file(d, "2026-12-01", [entry(_id(1))], version=True)),
    ("version-float", lambda d: write_file(d, "2026-12-01", [entry(_id(1))], version=1.0)),
    ("not-json", lambda d: (d / "feed_digest").mkdir() or (d / "feed_digest" / "2026-12-01.json")
     .write_bytes(b"{not json")),
    ("dup-key", lambda d: (d / "feed_digest").mkdir() or (d / "feed_digest" / "2026-12-01.json")
     .write_bytes(b'{"version": 1, "version": 1, "date": "2026-12-01", "entries": []}')),
    ("missing", lambda d: None),
]


@pytest.mark.parametrize("name,make", BAD_FILES, ids=[n for n, _ in BAD_FILES])
def test_tst_dg_04_bad_file_writes_nothing(sqlrun: Any, dg_db: str, data_dir: Path, tmp_path: Path,
                                           name: str, make: Any) -> None:
    """TST-DG-04:id の形が違う(ファイルの形が違う)ときは、何も書かずに終了コード 2。"""
    insert_entry(sqlrun, 1)
    insert_entry(sqlrun, 2)
    make(data_dir)
    before = snapshot(sqlrun)
    summary = tmp_path / "summary.md"
    assert commit(dg_db, data_dir, "2026-12-01", summary=summary) == 2
    assert snapshot(sqlrun) == before
    text = summary.read_text(encoding="utf-8")
    assert "E-DIGEST-FILE" in text and "or true" not in text


def test_tst_dg_04_bad_date_args(sqlrun: Any, dg_db: str, data_dir: Path) -> None:
    """TST-DG-04:--date の形が違う・--commit-db に --date が無い・--date だけは 2(DB に触れない)。"""
    write_file(data_dir, "2026-12-01", [entry(_id(1))])
    for day in ("2026-02-30", "2026-1-01", "../2026-12-01", "2026-12-01\n", "２０２６-12-01"):
        assert commit(None, data_dir, day) == 2
    assert run(None, ["feed-digest", "--data-dir", str(data_dir), "--commit-db"]) == 2
    assert run(None, ["feed-digest", "--data-dir", str(data_dir), "--date", "2026-12-01"]) == 2


# ---------------------------------------------------------------
# TST-DG-05(DB を使わない)
# ---------------------------------------------------------------
def test_tst_dg_05_writes_only_digest_file(fd: Any, tmp_path: Path) -> None:
    """TST-DG-05:--data-dir の下の feed_digest/YYYY-MM-DD.json のほかに書かない。パスは日付から作る。"""
    data_dir = tmp_path / "ai-netacho"
    (data_dir / "data" / "items").mkdir(parents=True)
    (data_dir / "data" / "items" / "keep.json").write_bytes(b"{}")
    outside = all_files(tmp_path)
    d = fd.Digest(day=DAY, entries=[])
    assert fd.write_file(str(data_dir), d) == "feed_digest/2026-12-01.json"
    after = all_files(tmp_path)
    assert set(after) - set(outside) == {"ai-netacho/feed_digest/2026-12-01.json"}
    assert all(after[k] == v for k, v in outside.items())
    assert fd.digest_path(str(data_dir), DAY) == os.path.join(str(data_dir), "feed_digest", "2026-12-01.json")


def test_tst_dg_05_parse_day(fd: Any) -> None:
    """TST-DG-05:日付は ^\\d{4}-\\d{2}-\\d{2}$ の実在する日だけ(パスに入る文字を絞る)。"""
    assert fd.parse_day("2026-12-01") == DAY
    assert fd.parse_day("2028-02-29") == dt.date(2028, 2, 29)
    for bad in (None, "", "2026-02-30", "2026-13-01", "2026-1-01", "20261201", "../x", "2026-12-01/..",
                "2026-12-01\n", "２０２６-12-01", "2026-12-01T00:00"):
        assert fd.parse_day(bad) is None


def test_tst_dg_05_symlinks_are_not_followed(fd: Any, tmp_path: Path) -> None:
    """TST-DG-05:feed_digest/ やその日のファイルがリンクなら、リンクの先に書かない。"""
    target = tmp_path / "elsewhere"
    target.mkdir()
    d = fd.Digest(day=DAY, entries=[])

    a = tmp_path / "a"
    a.mkdir()
    (a / "feed_digest").symlink_to(target, target_is_directory=True)
    with pytest.raises(fd.DigestError) as e1:
        fd.write_file(str(a), d)
    assert e1.value.code == "E-DIGEST-WRITE"
    assert list(target.iterdir()) == []

    b = tmp_path / "b"
    (b / "feed_digest").mkdir(parents=True)
    victim = target / "victim.txt"
    victim.write_bytes(b"keep")
    (b / "feed_digest" / "2026-12-01.json").symlink_to(victim)
    with pytest.raises(fd.DigestError):
        fd.write_file(str(b), d)
    assert victim.read_bytes() == b"keep"

    c = tmp_path / "c"
    c.symlink_to(target, target_is_directory=True)  # --data-dir そのものがリンク
    with pytest.raises(fd.DigestError) as e3:
        fd.write_file(str(c), d)
    assert e3.value.code == "E-ARGS-DATA-DIR"
    with pytest.raises(fd.DigestError):
        fd.write_file(str(c) + "/", d)  # 末尾の / でもリンクをたどらない
    assert sorted(p.name for p in target.iterdir()) == ["victim.txt"]

    # 読むほうもリンクをたどらない
    (target / "2026-12-01.json").write_text(json.dumps({"version": 1, "date": "2026-12-01", "entries": []}))
    with pytest.raises(fd.DigestError):
        fd.read_ids(str(a), DAY)


def test_tst_dg_05_bad_data_dir_cli(tmp_path: Path) -> None:
    """TST-DG-05:--data-dir がフォルダでなければ、DB に触れずに 2。"""
    assert run(None, ["feed-digest", "--data-dir", str(tmp_path / "missing")]) == 2
    f = tmp_path / "file"
    f.write_bytes(b"")
    assert run(None, ["feed-digest", "--data-dir", str(f)]) == 2


# ---------------------------------------------------------------
# TST-DG-06
# ---------------------------------------------------------------
def test_tst_dg_06_backlog_marks(sqlrun: Any, dg_db: str, tmp_path: Path) -> None:
    """TST-DG-06:その日(日本時間)より前の null の行に、first_seen_at の日本時間の日付を付ける。"""
    insert_entry(sqlrun, 1, first_seen_at=dt.datetime(2026, 10, 31, 14, 59, 59, 999999, tzinfo=UTC))  # JST 10-31
    insert_entry(sqlrun, 2, first_seen_at=dt.datetime(2026, 10, 31, 15, 0, 0, tzinfo=UTC))  # JST 11-01
    insert_entry(sqlrun, 3, first_seen_at=dt.datetime(2026, 10, 10, 16, 0, tzinfo=UTC))  # JST 10-11
    insert_entry(sqlrun, 4, first_seen_at=dt.datetime(2026, 10, 1, tzinfo=UTC), digest_date=dt.date(2026, 10, 20))
    summary = tmp_path / "summary.md"
    assert run(dg_db, ["feed-digest-backlog", "--before", "2026-11-01"], summary=summary) == 0
    assert digest_of(sqlrun) == {_id(1): dt.date(2026, 10, 31), _id(2): None, _id(3): dt.date(2026, 10, 11),
                                 _id(4): dt.date(2026, 10, 20)}
    assert "印を付けた行(上の日付より前の null の行):2" in summary.read_text(encoding="utf-8")
    # 2回目は何も変えない
    before = snapshot(sqlrun)
    assert run(dg_db, ["feed-digest-backlog", "--before", "2026-11-01"]) == 0
    assert snapshot(sqlrun) == before


def test_tst_dg_06_backlog_clears_watch(sqlrun: Any, dg_db: str, db_urls: tuple[str, str]) -> None:
    """TST-DG-06:印を付けた後は、watch の 2(載せ忘れ)・3(一覧の取りこぼし)に当たらない。"""
    from nodal_sync import db
    for n, days in ((1, 10), (2, 2)):
        sqlrun("insert into public.feed_entries (id, source_id, kind, title, lang, first_seen_at) values "
               "(%s, 'example-src', 'release', 'Fictional', 'en', now() - make_interval(days => %s::int))",
               (_id(n), days))
    real_now = dt.datetime.now(UTC)
    today = real_now.astimezone(JST).date()
    conn = db.connect(db_urls[1], None)
    try:
        assert db.feed_stale_undigested(conn) == [_id(1), _id(2)]
        conn.rollback()
        assert run(dg_db, ["feed-digest-backlog", "--before", today.isoformat()], now=real_now) == 0
        assert db.feed_stale_undigested(conn) == []
        assert db.feed_digested_on(conn, today) == []
    finally:
        conn.close()
    got = sqlrun("select id, digest_date, first_seen_at from public.feed_entries order by id")
    for _, digest_date, first_seen_at in got:
        assert digest_date == first_seen_at.astimezone(JST).date()


def test_tst_dg_06_backlog_bad_before(sqlrun: Any, dg_db: str) -> None:
    """TST-DG-06:--before の形が違う・日本時間の今日より後なら、DB に触れずに 2。今日ちょうどは通る。"""
    insert_entry(sqlrun, 1, first_seen_at=dt.datetime(2026, 10, 1, tzinfo=UTC))
    for bad in ("2026-11-31", "2026/11/01", "yesterday", "2026-12-02"):  # NOW は日本時間 2026-12-01
        assert run(None, ["feed-digest-backlog", "--before", bad]) == 2
    assert digest_of(sqlrun) == {_id(1): None}
    # 日本時間 12-02 0 時を過ぎれば 2026-12-02 は今日なので通る
    assert run(dg_db, ["feed-digest-backlog", "--before", "2026-12-02"],
               now=dt.datetime(2026, 12, 1, 15, 0, tzinfo=UTC)) == 0
    assert digest_of(sqlrun) == {_id(1): dt.date(2026, 10, 1)}


# ---------------------------------------------------------------
# TST-DG-07
# ---------------------------------------------------------------
def test_tst_dg_07_dry_run_changes_nothing(sqlrun: Any, dg_db: str, data_dir: Path, tmp_path: Path) -> None:
    """TST-DG-07:dry-run はファイルも DB も変えない(一覧の件数だけ出す)。"""
    insert_entry(sqlrun, 1)
    insert_entry(sqlrun, 2, first_seen_at=dt.datetime(2026, 11, 1, tzinfo=UTC))
    before = snapshot(sqlrun)
    summary = tmp_path / "summary.md"
    assert build(dg_db, data_dir, "--dry-run", summary=summary) == 0
    assert all_files(data_dir) == {}
    assert not (data_dir / "feed_digest").exists()
    text = summary.read_text(encoding="utf-8")
    assert "dry-run" in text and "一覧:1 件" in text and "書いていない" in text

    # 前からあるファイルも書き直さない
    write_file(data_dir, "2026-12-01", [entry(_id(1))])
    files_before = all_files(data_dir)
    assert build(dg_db, data_dir, "--dry-run") == 0
    assert all_files(data_dir) == files_before

    # --commit-db の dry-run は、ファイルを確かめるだけで DB に接続しない
    assert commit(None, data_dir, "2026-12-01", "--dry-run") == 0
    assert snapshot(sqlrun) == before
