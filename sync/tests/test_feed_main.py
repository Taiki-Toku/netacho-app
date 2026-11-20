"""python -m nodal_sync feed の試験のうち DB を使わないもの。TST-FEED-01・04・16・17。

取得は FakeFeedFetcher に差し替え、ネットワークに出ない。値はすべて架空。
"""

from __future__ import annotations

import datetime as dt
import io
import json
import re
from pathlib import Path
from typing import Any

import pytest

import nodal_sync.__main__ as cli
from nodal_sync import feedparse
from nodal_sync.feedhttp import FetchResult

DATA = Path(__file__).resolve().parent / "data" / "feed"
NOW = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)

SOURCES: dict[str, dict[str, Any]] = {
    "example-status": {
        "id": "example-status", "kind": "outage", "vendor": "Example", "product": "Example Cloud",
        "format": "atom", "url": "https://status.example.com/history.atom", "lang": "en",
        "translate": "title+summary", "filter": "statuspage-incident", "enabled": True},
    "example-cloud": {
        "id": "example-cloud", "kind": "outage", "vendor": "Example", "product": "Example Cloud",
        "format": "rss2", "url": "https://cloud.example.com/status/feed", "lang": "en",
        "translate": "title+summary", "filter": "all", "enabled": True},
    "example-kev": {
        "id": "example-kev", "kind": "vuln", "vendor": "CISA", "product": "KEV",
        "format": "kev-json", "url": "https://kev.example.com/kev.json", "lang": "en",
        "translate": "title+summary", "filter": "kev", "enabled": True, "max_bytes": 8 * 1024 * 1024},
    "example-jvn": {
        "id": "example-jvn", "kind": "vuln", "vendor": "JVN", "product": "JVN iPedia",
        "format": "rss1", "url": "https://jvndb.example.jp/rss/new.rdf", "lang": "ja",
        "translate": "none", "filter": "watch-products-or-cvss9", "enabled": True},
}
BODIES = {
    "example-status": "statuspage.atom",
    "example-cloud": "status.rss",
    "example-kev": "kev.json",
    "example-jvn": "jvn.rdf",
}


def write_feed_config(tmp_path: Path, ids: list[str] | None = None, **over: Any) -> str:
    cfg: dict[str, Any] = {"watch_products": ["ExampleGuard", "SampleKit"],
                           "sources": [dict(SOURCES[i]) for i in (ids or list(SOURCES))]}
    cfg.update(over)
    p = tmp_path / "feed_sources.json"
    p.write_text(json.dumps(cfg), encoding="utf-8")
    return str(p)


class FakeFeedFetcher:
    """URL ごとに決めた結果を返す。送った etag・last_modified を記録する。"""

    def __init__(self, results: dict[str, FetchResult] | None = None) -> None:
        self.results = results or {}
        self.calls: list[tuple[str, str | None, str | None]] = []

    def fetch(self, url: str, fmt: str, max_bytes: int, etag: str | None = None,
              last_modified: str | None = None) -> FetchResult:
        self.calls.append((url, etag, last_modified))
        return self.results.get(url, FetchResult(code="E-HTTP-NET"))


def ok_results(etag: str | None = None) -> dict[str, FetchResult]:
    return {SOURCES[i]["url"]: FetchResult(body=(DATA / BODIES[i]).read_bytes(), etag=etag)
            for i in SOURCES}


@pytest.fixture
def fake_expat(monkeypatch: pytest.MonkeyPatch) -> None:
    """Expat の版の検査を通す(開発の VM の OS の Python は古いため。本物の版は TST-FEED-04 が CI で確かめる)。"""
    monkeypatch.setattr(feedparse, "expat_version", lambda: "expat_2.7.2")


def feed(args: list[str], env: dict[str, str] | None = None, out: io.StringIO | None = None,
         fetcher: Any = None, connect: Any = None) -> int:
    return cli.main(["feed", *args], env=env or {}, out=out or io.StringIO(), feed_fetcher=fetcher,
                    now=NOW, feed_connect=connect)


def assert_stop_commands(text: str) -> None:
    lines = text.splitlines()
    m = re.fullmatch(r"::stop-commands::([0-9a-f]{32})", lines[0])
    assert m, lines[0]
    assert lines[-1] == f"::{m.group(1)}::"


def never_connect(url: str, ca: str | None) -> Any:
    raise AssertionError("DB に接続した")


def test_tst_feed_04_old_expat_exits_2(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """TST-FEED-04:Expat の版が 2.7.2 未満と見なしたとき、何もせず(取得もせず)に終了コード 2。"""
    monkeypatch.setattr(feedparse, "expat_version", lambda: "expat_2.7.1")
    f = FakeFeedFetcher(ok_results())
    out = io.StringIO()
    assert feed(["--config", write_feed_config(tmp_path), "--dry-run"], out=out, fetcher=f,
                connect=never_connect) == 2
    assert f.calls == []
    assert "E-FEED-EXPAT" in out.getvalue()
    assert_stop_commands(out.getvalue())


def test_tst_feed_01_config_error_exits_2(tmp_path: Path, fake_expat: None) -> None:
    """TST-FEED-01:設定の誤りは、取得も接続もせずに終了コード 2 と決まりの番号(値は出さない)。"""
    secret = "::warning::架空の秘密の値"
    for over, code in [({"extra": secret}, "E-FEED-CONFIG-KEYS"),
                       ({"watch_products": ["ab"]}, "E-FEED-CONFIG-WATCH"),
                       ({"sources": []}, "E-FEED-CONFIG-SOURCES")]:
        f = FakeFeedFetcher(ok_results())
        out = io.StringIO()
        assert feed(["--config", write_feed_config(tmp_path, **over)], out=out, fetcher=f,
                    connect=never_connect, env={"FEED_DB_URL": "postgresql://u@db.example.invalid/x"}) == 2
        assert code in out.getvalue() and secret not in out.getvalue()
        assert f.calls == []
    bad = dict(SOURCES["example-status"], url="http://status.example.com/x")
    out = io.StringIO()
    assert feed(["--config", write_feed_config(tmp_path, sources=[bad])], out=out, connect=never_connect) == 2
    assert "E-FEED-CONFIG-URL" in out.getvalue()


def test_missing_feed_db_url_exits_2(tmp_path: Path, fake_expat: None) -> None:
    """FEED_DB_URL が無ければ、取得せずに終了コード 2。"""
    f = FakeFeedFetcher(ok_results())
    out = io.StringIO()
    assert feed(["--config", write_feed_config(tmp_path)], out=out, fetcher=f) == 2
    assert "E-FEED-DB-URL" in out.getvalue() and f.calls == []


def test_tst_feed_16_dry_run_does_not_connect(tmp_path: Path, fake_expat: None) -> None:
    """TST-FEED-16:dry-run は DB に接続せず、取得と解析と filter までの件数を出す。全部成功なら 0。"""
    f = FakeFeedFetcher(ok_results())
    out = io.StringIO()
    summary = tmp_path / "summary.md"
    code = feed(["--config", write_feed_config(tmp_path), "--dry-run"], out=out, fetcher=f,
                connect=never_connect, env={"GITHUB_STEP_SUMMARY": str(summary)})
    assert code == 0
    assert all(etag is None for _, etag, _ in f.calls) and len(f.calls) == 4
    text = summary.read_text(encoding="utf-8")
    assert "dry-run" in text
    assert "| example-status | ok | 3 | 2 | 0 | 0 | 0 | 0 | 1 | - | - |" in text
    assert "| example-kev | ok | 2 | 1 | 0 | 0 | 0 | 1 | 0 | E-ITEM-CVE 1 | - |" in text  # 2020 年の1件は古い
    assert "| example-jvn | ok | 2 | 2 | 0 | 0 | 0 | 0 | 0 | - | - |" in text
    assert "取得先:4(成功 4/失敗 0)" in text


def test_tst_feed_16_dry_run_one_failure_exits_1(tmp_path: Path, fake_expat: None) -> None:
    """TST-FEED-16:dry-run は feed_source_state を読まないので、1回の失敗でも終了コード 1。"""
    results = ok_results()
    results[SOURCES["example-cloud"]["url"]] = FetchResult(code="E-HTTP-STATUS")
    results[SOURCES["example-jvn"]["url"]] = FetchResult(body=b"<!DOCTYPE x><rdf/>")
    out = io.StringIO()
    assert feed(["--config", write_feed_config(tmp_path), "--dry-run"], out=out,
                fetcher=FakeFeedFetcher(results), connect=never_connect) == 1
    assert "| example-cloud | E-HTTP-STATUS |" in out.getvalue()
    assert "| example-jvn | E-PARSE-DTD |" in out.getvalue()


def test_tst_feed_16_disabled_sources_are_skipped(tmp_path: Path, fake_expat: None) -> None:
    """enabled が false の取得先は取りに行かない。"""
    off = dict(SOURCES["example-cloud"], enabled=False)
    f = FakeFeedFetcher(ok_results())
    assert feed(["--config", write_feed_config(tmp_path, sources=[SOURCES["example-status"], off]), "--dry-run"],
                fetcher=f, connect=never_connect) == 0
    assert [u for u, _, _ in f.calls] == [SOURCES["example-status"]["url"]]


def test_tst_feed_16_exit_code_rule() -> None:
    """TST-FEED-16:終了コードの決まり(3.7)。1回の失敗は 0、3回目で 1、全部失敗で 1、dry-run は1回で 1。"""
    src = object()

    class O:
        def __init__(self, ok: bool) -> None:
            self.ok = ok
            self.source = src

    assert cli.feed_exit_code([O(True), O(False)], {"a": 0, "b": 1}) == 0
    assert cli.feed_exit_code([O(True), O(False)], {"a": 0, "b": 2}) == 0
    assert cli.feed_exit_code([O(True), O(False)], {"a": 0, "b": 3}) == 1
    assert cli.feed_exit_code([O(False), O(False)], {"a": 1, "b": 1}) == 1
    assert cli.feed_exit_code([O(True), O(True)], {"a": 0, "b": 0}) == 0
    assert cli.feed_exit_code([O(True), O(False)], None) == 1
    assert cli.feed_exit_code([O(True)], None) == 0
    assert cli.feed_exit_code([], {}) == 0


LEAK_ATOM = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:leak.example.com,2005:Incident/1</id>
    <published>2026-11-20T09:00:00Z</published>
    <link href="https://leak.example.com/secret-path"/>
    <title>::warning::Fictional secret title</title>
    <summary>Resolved - ::set-output name=x::fictional secret body
::error::fictional second line</summary>
  </entry>
  <entry>
    <id></id>
    <title>::endgroup::Fictional invalid title</title>
  </entry>
</feed>"""


def test_tst_feed_17_no_values_in_output(tmp_path: Path, fake_expat: None) -> None:
    """TST-FEED-17:ログと要約に、見本の title・URL・本文・:: で始まる文が出ない。"""
    url = SOURCES["example-status"]["url"]
    out = io.StringIO()
    summary = tmp_path / "summary.md"
    code = feed(["--config", write_feed_config(tmp_path, ids=["example-status"]), "--dry-run"], out=out,
                fetcher=FakeFeedFetcher({url: FetchResult(body=LEAK_ATOM)}), connect=never_connect,
                env={"GITHUB_STEP_SUMMARY": str(summary)})
    assert code == 0
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    for v in ["Fictional secret title", "secret-path", "leak.example.com", "fictional secret body",
              "fictional second line", "Fictional invalid title", "::warning::", "::set-output", "::error::",
              "::endgroup::", url, "status.example.com"]:
        assert v not in text, v
    assert "E-ITEM-GUID 1" in text
    assert "Traceback" not in text
    assert_stop_commands(out.getvalue())
    assert [ln for ln in out.getvalue().splitlines() if ln.startswith("::")] == \
        [out.getvalue().splitlines()[0], out.getvalue().splitlines()[-1]]


def test_tst_feed_17_unexpected_exception(tmp_path: Path, fake_expat: None,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    """TST-FEED-17:想定外の例外でもトレースバックと値が出ず、終了コード 2。"""
    secret = "::warning::架空の例外の値"

    def boom(*a: Any, **k: Any) -> Any:
        raise RuntimeError(secret)

    monkeypatch.setattr(feedparse, "parse_feed", boom)
    out = io.StringIO()
    code = feed(["--config", write_feed_config(tmp_path), "--dry-run"], out=out,
                fetcher=FakeFeedFetcher(ok_results()), connect=never_connect)
    assert code == 2
    text = out.getvalue()
    assert "Traceback" not in text and secret not in text and "架空の例外" not in text
    assert "E-UNEXPECTED" in text
    assert_stop_commands(text)


def test_feed_args_do_not_echo_values(tmp_path: Path) -> None:
    """引数が正しくなくても、その値を表示しない(--config が無い・知らない引数)。"""
    out = io.StringIO()
    assert cli.main(["feed", "--bogus", "::warning::x"], env={}, out=out) == 2
    assert "::warning::x" not in out.getvalue() and "E-ARGS" in out.getvalue()


def test_feed_conninfo_uses_verify_full_and_app_name(tmp_path: Path) -> None:
    """3.6:同期と同じ接続の形(localhost 以外は verify-full と --ca)で、application_name は nodal-feed。"""
    pytest.importorskip("psycopg")
    from psycopg.conninfo import conninfo_to_dict

    from nodal_sync import db, feeddb
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    info = conninfo_to_dict(feeddb.build_feed_conninfo(
        "postgresql://netacho_feed.ref@pooler.example.invalid:5432/postgres?sslmode=disable", str(ca)))
    assert info["sslmode"] == "verify-full" and info["sslrootcert"] == str(ca)
    assert info["application_name"] == "nodal-feed"
    with pytest.raises(db.DbError):
        feeddb.build_feed_conninfo("postgresql://u@pooler.example.invalid/postgres", None)
