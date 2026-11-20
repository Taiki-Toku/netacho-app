"""公式フィードの DB の試験。TST-FEED-11〜16・18・19。

conftest の土台(PostgreSQL 16 に 0001〜0003)を使い、書き込みは admin でつないで `set role netacho_feed` で行う。
NODAL_TEST_ADMIN_URL・NODAL_TEST_SYNC_URL が無ければ skip(NODAL_REQUIRE_DB=1 なら失敗)。値はすべて架空。
"""

from __future__ import annotations

import datetime as dt
import io
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from nodal_sync.feedconfig import Source
from nodal_sync.feedhttp import FetchResult
from nodal_sync.feedparse import Entry, SourceOutcome, entry_id
from test_feed_main import SOURCES, FakeFeedFetcher, feed, ok_results, write_feed_config

UTC = dt.timezone.utc
CVE_A = "CVE-2026-91001"
CVE_B = "CVE-2026-91002"


@pytest.fixture
def feed_db(db_urls: tuple[str, str], fake_expat: None) -> str:
    """表を空にし(feed_source_state も)、admin の URL を返す。"""
    import psycopg
    with psycopg.connect(db_urls[0], autocommit=True) as c:
        c.execute("delete from public.feed_entries")
        c.execute("delete from public.feed_source_state")
    return db_urls[0]


@pytest.fixture
def fake_expat(monkeypatch: pytest.MonkeyPatch) -> None:
    from nodal_sync import feedparse
    monkeypatch.setattr(feedparse, "expat_version", lambda: "expat_2.7.2")


def feed_conn(admin_url: str) -> Any:
    """admin でつなぎ、netacho_feed に切り替えた接続(本番の FEED_DB_URL の代わり)。"""
    from nodal_sync import feeddb
    c = feeddb.connect(admin_url, None)
    c.execute("set role netacho_feed")
    c.commit()
    return c


def run_feed(admin_url: str, tmp_path: Path, fetcher: FakeFeedFetcher, ids: list[str] | None = None,
             summary: Path | None = None, sources: list[dict[str, Any]] | None = None) -> int:
    env = {"FEED_DB_URL": "postgresql://unused@localhost/unused"}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    over: dict[str, Any] = {"sources": sources} if sources is not None else {}
    return feed(["--config", write_feed_config(tmp_path, ids, **over)], env=env, out=io.StringIO(),
                fetcher=fetcher, connect=lambda url, ca: feed_conn(admin_url))


def snapshot(admin_sql: Any) -> tuple[Any, Any]:
    return (admin_sql("select * from public.feed_entries order by id"),
            admin_sql("select * from public.feed_source_state order by source_id"))


def source(sid: str, **over: Any) -> Source:
    base = {k: v for k, v in SOURCES[sid].items()}
    base.update(over)
    return Source(**base)


def entry(src: Source, guid: str, **over: Any) -> Entry:
    d: dict[str, Any] = dict(id=entry_id(src.id, guid), title=f"Fictional title {guid}",
                             summary=f"Fictional summary {guid}", url=f"https://news.example.com/{guid}",
                             published_at=dt.datetime(2026, 11, 20, 9, 0, tzinfo=UTC),
                             vendor=src.vendor, product=src.product)
    d.update(over)
    return Entry(**d)


def write(admin_url: str, outcomes: list[SourceOutcome]) -> Any:
    from nodal_sync import feeddb
    c = feed_conn(admin_url)
    try:
        return feeddb.write_all(c, outcomes)
    finally:
        c.close()


# ---------------------------------------------------------------
def test_tst_feed_12_idempotent(feed_db: str, admin_sql: Any, tmp_path: Path) -> None:
    """TST-FEED-12:2回流しても結果が同じ(2回目は追加 0・更新 0。行の updated_at も変わらない)。"""
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(ok_results())) == 0
    rows = admin_sql("select source_id, translate_status from public.feed_entries order by source_id, id")
    assert [r[0] for r in rows] == ["example-cloud"] * 2 + ["example-jvn"] + ["example-kev"] + ["example-status"] * 2
    assert {r[1] for r in rows if r[0] == "example-jvn"} == {"skip"}
    assert {r[1] for r in rows if r[0] != "example-jvn"} == {"pending"}
    before = snapshot(admin_sql)[0]
    summary = tmp_path / "summary.md"
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(ok_results()), summary=summary) == 0
    assert snapshot(admin_sql)[0] == before
    text = summary.read_text(encoding="utf-8")
    assert "| example-status | ok | 3 | 0 | 0 | 0 | 2 | 0 | 1 | - | 0 |" in text
    assert "| example-jvn | ok | 2 | 0 | 0 | 0 | 2 | 0 | 0 | - | 0 |" in text
    assert "新しい行:0" in text and "訳の待ち(pending):5" in text


def test_tst_feed_11_not_modified_writes_nothing(feed_db: str, admin_sql: Any, tmp_path: Path) -> None:
    """TST-FEED-11:前回の etag・last_modified を送り、304 なら記事を書かずに成功(etag は残る)。"""
    results = ok_results(etag='"e1"')
    url = SOURCES["example-status"]["url"]
    results[url].last_modified = "Thu, 19 Nov 2026 00:00:00 GMT"
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(results), ids=["example-status"]) == 0
    before = snapshot(admin_sql)[0]
    f = FakeFeedFetcher({url: FetchResult(not_modified=True)})
    summary = tmp_path / "summary.md"
    assert run_feed(feed_db, tmp_path, f, ids=["example-status"], summary=summary) == 0
    assert f.calls == [(url, '"e1"', "Thu, 19 Nov 2026 00:00:00 GMT")]
    assert snapshot(admin_sql)[0] == before
    assert admin_sql("select etag, last_modified, consecutive_failures, last_error from public.feed_source_state") \
        == [('"e1"', "Thu, 19 Nov 2026 00:00:00 GMT", 0, "")]
    assert "| example-status | 304 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - | 0 |" in summary.read_text(encoding="utf-8")


def test_tst_feed_13_old_entries_are_not_inserted(feed_db: str, admin_sql: Any, tmp_path: Path) -> None:
    """TST-FEED-13:max_age_days より古い記事は入らない。公開日が無い記事は入る。"""
    status = dict(SOURCES["example-status"], max_age_days=1)
    sources = [status, SOURCES["example-cloud"], SOURCES["example-kev"]]
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(ok_results()), sources=sources) == 0
    got = {r[0] for r in admin_sql("select id from public.feed_entries")}
    assert entry_id("example-status", "tag:status.example.com,2005:Incident/1001") in got
    assert entry_id("example-status", "tag:status.example.com,2005:Incident/1003") not in got   # 2 日前
    assert entry_id("example-kev", "CVE-2020-90009") not in got                                   # 2020 年
    assert entry_id("example-cloud", "https://cloud.example.com/status/a2") in got               # 公開日なし


def test_tst_feed_14_title_change_resets_translation(feed_db: str, admin_sql: Any) -> None:
    """TST-FEED-14:title が変わった en の行は訳が消えて pending に戻る。first_seen_at は変わらない。"""
    en = source("example-cloud")
    ja = source("example-jvn", kind="outage", format="rss2", filter="all")
    e_en = entry(en, "g1")
    e_ja = entry(ja, "g2")
    write(feed_db, [SourceOutcome(source=en, entries=[e_en]), SourceOutcome(source=ja, entries=[e_ja])])
    admin_sql("update public.feed_entries set title_ja = '架空の訳', summary_ja = '架空の要約の訳', "
              "translated_at = now(), translate_status = 'done', translate_attempts = 1 where id = %s", (e_en.id,))
    first = admin_sql("select first_seen_at from public.feed_entries where id = %s", (e_en.id,))

    # url だけ変わったときは訳を残す
    stats, _ = write(feed_db, [SourceOutcome(source=en, entries=[entry(en, "g1", url=None)])])
    assert stats["example-cloud"].updated == 1
    assert admin_sql("select translate_status, title_ja, url from public.feed_entries where id = %s",
                     (e_en.id,)) == [("done", "架空の訳", None)]

    stats, _ = write(feed_db, [SourceOutcome(source=en, entries=[entry(en, "g1", title="Fictional new title")]),
                               SourceOutcome(source=ja, entries=[entry(ja, "g2", title="架空の新しい題")])])
    assert stats["example-cloud"].updated == 1 and stats["example-jvn"].updated == 1
    assert admin_sql("select title, title_ja, summary_ja, translated_at, translate_status, translate_attempts "
                     "from public.feed_entries where id = %s", (e_en.id,)) == [
        ("Fictional new title", None, None, None, "pending", 0)]
    assert admin_sql("select first_seen_at from public.feed_entries where id = %s", (e_en.id,)) == first
    assert admin_sql("select title, translate_status from public.feed_entries where id = %s", (e_ja.id,)) == [
        ("架空の新しい題", "skip")]


def test_tst_feed_15_kev_after_jvn(feed_db: str, admin_sql: Any) -> None:
    """TST-FEED-15:JVN の行が先にあり、同じ CVE の KEV が後:新しい行を作らず、その行の exploited を true にする。"""
    jvn, kev = source("example-jvn"), source("example-kev")
    j = entry(jvn, "j1", cve_ids=[CVE_A], severity="high", cvss=Decimal("8.1"))
    write(feed_db, [SourceOutcome(source=jvn, entries=[j])])
    k = entry(kev, CVE_A, cve_ids=[CVE_A], exploited=True, url=f"https://nvd.nist.gov/vuln/detail/{CVE_A}")
    stats, _ = write(feed_db, [SourceOutcome(source=kev, entries=[k])])
    assert (stats["example-kev"].merged, stats["example-kev"].inserted) == (1, 0)
    assert admin_sql("select id, exploited, severity, cvss from public.feed_entries") == [
        (j.id, True, "high", Decimal("8.1"))]
    stats, _ = write(feed_db, [SourceOutcome(source=kev, entries=[k])])   # 2回目は変化なし
    assert (stats["example-kev"].merged, stats["example-kev"].unchanged) == (0, 1)


def test_tst_feed_15_jvn_after_kev(feed_db: str, admin_sql: Any) -> None:
    """TST-FEED-15:KEV の行が先にあり、JVN が後:severity・cvss は JVN の値、CVE は足し、url は元のまま。"""
    jvn, kev = source("example-jvn"), source("example-kev")
    k = entry(kev, CVE_A, cve_ids=[CVE_A], exploited=True, url=f"https://nvd.nist.gov/vuln/detail/{CVE_A}")
    write(feed_db, [SourceOutcome(source=kev, entries=[k])])
    j = entry(jvn, "j1", cve_ids=[CVE_B, CVE_A], severity="critical", cvss=Decimal("9.8"))
    stats, _ = write(feed_db, [SourceOutcome(source=jvn, entries=[j])])
    assert (stats["example-jvn"].merged, stats["example-jvn"].inserted) == (1, 0)
    assert admin_sql("select id, exploited, severity, cvss, cve_ids, url from public.feed_entries") == [
        (k.id, True, "critical", Decimal("9.8"), [CVE_A, CVE_B], f"https://nvd.nist.gov/vuln/detail/{CVE_A}")]


def test_tst_feed_15_two_rows_only_oldest_is_updated(feed_db: str, admin_sql: Any) -> None:
    """TST-FEED-15:1つの記事が2つの行に当たるときは、最も古い1行だけを更新する(もう1行は残る)。"""
    jvn, kev = source("example-jvn"), source("example-kev")
    old = entry(kev, CVE_A, cve_ids=[CVE_A], exploited=True)
    write(feed_db, [SourceOutcome(source=kev, entries=[old])])
    newer = entry(kev, CVE_B, cve_ids=[CVE_B], exploited=True)
    write(feed_db, [SourceOutcome(source=kev, entries=[newer])])
    j = entry(jvn, "j1", cve_ids=[CVE_B, CVE_A], severity="low", cvss=Decimal("3.1"))
    stats, _ = write(feed_db, [SourceOutcome(source=jvn, entries=[j])])
    assert stats["example-jvn"].merged == 1
    rows = admin_sql("select id, severity, cvss, cve_ids from public.feed_entries order by first_seen_at")
    assert rows == [(old.id, "low", Decimal("3.1"), [CVE_A, CVE_B]), (newer.id, None, None, [CVE_B])]


def test_tst_feed_16_consecutive_failures(feed_db: str, admin_sql: Any, tmp_path: Path) -> None:
    """TST-FEED-16:1回・2回の失敗は 0、3回目で 1。成功で 0 に戻る。全部失敗なら1回目でも 1。"""
    ids = ["example-status", "example-cloud"]
    results = ok_results()
    results[SOURCES["example-cloud"]["url"]] = FetchResult(code="E-HTTP-NET")
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(results), ids=ids) == 0
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(results), ids=ids) == 0
    summary = tmp_path / "summary.md"
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(results), ids=ids, summary=summary) == 1
    assert "| example-cloud | E-HTTP-NET | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - | 3 |" in summary.read_text(encoding="utf-8")
    assert admin_sql("select source_id, consecutive_failures, last_error, last_success_at is null "
                     "from public.feed_source_state order by source_id") == [
        ("example-cloud", 3, "E-HTTP-NET", True), ("example-status", 0, "", False)]
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher(ok_results()), ids=ids) == 0
    assert admin_sql("select consecutive_failures, last_error from public.feed_source_state "
                     "where source_id = 'example-cloud'") == [(0, "")]
    admin_sql("delete from public.feed_source_state")
    assert run_feed(feed_db, tmp_path, FakeFeedFetcher({}), ids=ids) == 1   # 全部失敗


def test_tst_feed_18_feed_role_can_write_not_delete(feed_db: str, admin_sql: Any) -> None:
    """TST-FEED-18:netacho_feed で書き込みが通り、削除はできない。items・app_users・item_feedback には触れない。"""
    import psycopg
    cloud = source("example-cloud")
    write(feed_db, [SourceOutcome(source=cloud, entries=[entry(cloud, "g1")]),
                    SourceOutcome(source=source("example-status"), code="E-HTTP-NET")])
    assert admin_sql("select count(*) from public.feed_entries") == [(1,)]
    assert admin_sql("select count(*) from public.feed_source_state") == [(2,)]
    c = feed_conn(feed_db)
    try:
        assert c.execute("select current_user").fetchone() == ("netacho_feed",)
        c.commit()
        for q in ["delete from public.feed_entries", "delete from public.feed_source_state",
                  "delete from public.feed_translate_usage", "select * from public.items",
                  "select * from public.app_users", "select * from public.item_feedback",
                  "select * from public.sync_state"]:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                c.execute(q)
            c.rollback()
    finally:
        c.close()
    assert admin_sql("select count(*) from public.feed_entries") == [(1,)]


def test_tst_feed_19_failure_changes_nothing(feed_db: str, admin_sql: Any, tmp_path: Path) -> None:
    """TST-FEED-19:書き込みの途中で失敗したら、どの行も変わらない(feed_entries・feed_source_state とも)。"""
    from nodal_sync import db
    cloud, kev = source("example-cloud"), source("example-kev")
    write(feed_db, [SourceOutcome(source=cloud, entries=[entry(cloud, "g1")])])
    before = snapshot(admin_sql)
    bad = entry(kev, "bad", cve_ids=["CVE-bad"])   # 0002 の CHECK に外れる
    outcomes = [
        SourceOutcome(source=cloud, entries=[entry(cloud, "g1", title="Fictional changed"), entry(cloud, "g2")]),
        SourceOutcome(source=source("example-status"), code="E-HTTP-NET"),
        SourceOutcome(source=kev, entries=[bad]),
    ]
    with pytest.raises(db.DbError) as e:
        write(feed_db, outcomes)
    assert e.value.code == "E-DB-WRITE"
    assert snapshot(admin_sql) == before

    # 起動の全体でも:書き込みの失敗は終了コード 2(何も書いていない)
    calls: list[int] = []

    def broken(url: str, ca: str | None) -> Any:
        c = feed_conn(feed_db)
        calls.append(1)
        if len(calls) == 2:   # 1回目(etag を読む)は通し、2回目(書く)だけ書く権限の無いロールにする
            c.execute("set role anon")
            c.commit()
        return c

    summary = tmp_path / "summary.md"
    code = feed(["--config", write_feed_config(tmp_path, ["example-cloud"])],
                env={"FEED_DB_URL": "postgresql://unused@localhost/unused", "GITHUB_STEP_SUMMARY": str(summary)},
                fetcher=FakeFeedFetcher(ok_results()), connect=broken)
    assert code == 2 and len(calls) == 2
    assert snapshot(admin_sql) == before
    assert "止まった:E-DB-WRITE" in summary.read_text(encoding="utf-8")
