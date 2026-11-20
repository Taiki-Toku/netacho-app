"""公式フィードの取得の試験。名前解決と接続を差し替え、ネットワークに出ない。TST-FEED-10・11。

架空のインターネット(World)は ogimage の試験(TST-SYNC-14)と同じものを使う。
"""

from __future__ import annotations

from typing import Any

import pytest

from nodal_sync import feedhttp
from nodal_sync.feedhttp import FeedFetcher
from test_ogimage import PUBLIC4, PUBLIC6, NoTimer, Page, World

ATOM_TYPE = {"Content-Type": "application/atom+xml; charset=utf-8"}
BODY = b'<feed xmlns="http://www.w3.org/2005/Atom"></feed>'
MAX = 2 * 1024 * 1024


def fetcher(world: World, **kw: Any) -> FeedFetcher:
    return FeedFetcher(resolver=world.resolve, connector=world.connect, clock=world.clock, timer=NoTimer, **kw)


@pytest.fixture
def world() -> World:
    w = World()
    w.dns["status.example.com"] = [PUBLIC4, PUBLIC6]
    w.dns["cdn.example.com"] = [PUBLIC4]
    return w


def test_tst_feed_10_ok_and_headers(world: World) -> None:
    """TST-FEED-10:確かめた IP にだけつなぎ、User-Agent と format に合う Accept を送る。Accept-Encoding は送らない。"""
    world.pages[("status.example.com", "/history.atom")] = Page(
        headers={**ATOM_TYPE, "ETag": '"abc"', "Last-Modified": "Fri, 20 Nov 2026 08:00:00 GMT"}, body=BODY)
    r = fetcher(world).fetch("https://status.example.com/history.atom", "atom", MAX)
    assert r.code is None and r.body == BODY and not r.not_modified
    assert (r.etag, r.last_modified) == ('"abc"', "Fri, 20 Nov 2026 08:00:00 GMT")
    assert world.connected == [("status.example.com", PUBLIC4)]
    headers = world.requests[0][2]
    assert headers["User-Agent"] == "NODAL-feed/1 (+https://github.com/Taiki-Toku/netacho-app)"
    assert headers["Accept"].startswith("application/atom+xml")
    assert not any(k.lower() == "accept-encoding" for k in headers)
    assert "If-None-Match" not in headers and "If-Modified-Since" not in headers


def test_tst_feed_10_real_connection_sends_no_accept_encoding() -> None:
    """TST-FEED-10:本物の接続の部品(http.client)でも Accept-Encoding が付かない。Host はホスト名。"""
    sent: list[bytes] = []

    class FakeSock:
        def sendall(self, data: bytes) -> None:
            sent.append(data)

        def settimeout(self, t: float) -> None:
            pass

        def close(self) -> None:
            pass

    conn = feedhttp.FeedConnection("status.example.com", "127.0.0.1", timeout=1, port=443)
    conn.sock = FakeSock()  # type: ignore[assignment]
    conn.request("GET", "/history.atom", headers={"User-Agent": feedhttp.USER_AGENT, "Accept": "application/json"})
    raw = b"".join(sent).lower()
    assert raw.startswith(b"get /history.atom http/1.1\r\n")
    assert b"\r\nhost: status.example.com\r\n" in raw
    assert b"accept-encoding" not in raw
    conn2 = feedhttp.FeedConnection("status.example.com", "127.0.0.1", timeout=1, port=443)
    conn2.sock = FakeSock()  # type: ignore[assignment]
    with pytest.raises(ValueError):  # 改行を含む値は送らない(ヘッダーの差し込みを防ぐ)
        conn2.request("GET", "/", headers={"If-None-Match": '"a"\r\nX-Evil: 1'})


@pytest.mark.parametrize("ctype,ok", [
    ("application/atom+xml", True), ("application/rss+xml; charset=utf-8", True), ("text/xml", True),
    ("application/xml", True), ("application/json", True), ("text/plain; charset=utf-8", True),
    ("application/rdf+xml", True),
    ("text/html", False), ("image/png", False), ("", False), ("application/octet-stream", False),
])
def test_tst_feed_10_content_type(world: World, ctype: str, ok: bool) -> None:
    """TST-FEED-10:xml・rss・atom・json を含むか text/plain だけを受け入れる。"""
    world.pages[("status.example.com", "/f")] = Page(headers={"Content-Type": ctype}, body=BODY)
    r = fetcher(world).fetch("https://status.example.com/f", "atom", MAX)
    assert r.code == (None if ok else "E-HTTP-TYPE")


@pytest.mark.parametrize("enc", ["gzip", "br", "deflate", "identity"])
def test_tst_feed_10_content_encoding_is_rejected(world: World, enc: str) -> None:
    """TST-FEED-10:Content-Encoding が付いた応答は捨てる(展開の爆弾を避ける)。"""
    world.pages[("status.example.com", "/f")] = Page(headers={**ATOM_TYPE, "Content-Encoding": enc}, body=BODY)
    assert fetcher(world).fetch("https://status.example.com/f", "atom", MAX).code == "E-HTTP-ENCODING"


def test_tst_feed_10_size(world: World) -> None:
    """TST-FEED-10:max_bytes を超えたら失敗(Content-Length が大きいときは読む前に)。ちょうどは通る。"""
    world.pages[("status.example.com", "/big")] = Page(headers=ATOM_TYPE, body=b"x" * 1001, chunk=100)
    world.pages[("status.example.com", "/fit")] = Page(headers=ATOM_TYPE, body=b"x" * 1000, chunk=100)
    world.pages[("status.example.com", "/cl")] = Page(headers={**ATOM_TYPE, "Content-Length": "5000"}, body=b"x")
    f = fetcher(world)
    assert f.fetch("https://status.example.com/big", "atom", 1000).code == "E-HTTP-SIZE"
    assert f.fetch("https://status.example.com/fit", "atom", 1000).code is None
    assert f.fetch("https://status.example.com/cl", "atom", 1000).code == "E-HTTP-SIZE"


def test_tst_feed_10_time(world: World) -> None:
    """TST-FEED-10:1つの取得先は 10 秒、1回の起動で合わせて 300 秒。"""
    world.pages[("status.example.com", "/slow")] = Page(headers=ATOM_TYPE, body=b"x" * 2000, chunk=100,
                                                        delay_per_chunk=0.6)
    world.pages[("status.example.com", "/ok")] = Page(headers=ATOM_TYPE, body=b"x" * 2000, chunk=100,
                                                      delay_per_chunk=0.4)
    f = fetcher(world)
    assert f.fetch("https://status.example.com/slow", "atom", MAX).code == "E-HTTP-TIME"
    assert f.fetch("https://status.example.com/ok", "atom", MAX).code is None
    world.clock.t += 300
    world.connected.clear()
    assert f.fetch("https://status.example.com/ok", "atom", MAX).code == "E-HTTP-TIME"
    assert world.connected == []


def test_tst_feed_10_timeout_and_net_errors() -> None:
    """TST-FEED-10:受信の時間切れは E-HTTP-TIME、つながらないものは E-HTTP-NET(例外を外に出さない)。"""

    class Conn:
        def __init__(self, exc: BaseException) -> None:
            self.exc = exc

        def set_timeout(self, s: float) -> None:
            pass

        def request(self, m: str, p: str, headers: dict[str, str]) -> None:
            raise self.exc

        def abort(self) -> None:
            pass

        def close(self) -> None:
            pass

    f = FeedFetcher(resolver=lambda h: [PUBLIC4], connector=lambda h, ip, t: Conn(TimeoutError()), timer=NoTimer)
    assert f.fetch("https://status.example.com/f", "atom", MAX).code == "E-HTTP-TIME"
    f = FeedFetcher(resolver=lambda h: [PUBLIC4], connector=lambda h, ip, t: Conn(ConnectionResetError()),
                    timer=NoTimer)
    assert f.fetch("https://status.example.com/f", "atom", MAX).code == "E-HTTP-NET"

    def no_dns(h: str) -> list[str]:
        raise OSError("no such host")

    assert FeedFetcher(resolver=no_dns, timer=NoTimer).fetch(
        "https://status.example.com/f", "atom", MAX).code == "E-HTTP-NET"


def test_tst_feed_10_watchdog_cuts_stalled_connection() -> None:
    """TST-FEED-10:本物の時計で、応答を待ったまま進まない接続も期限で切れ、E-HTTP-TIME。"""
    import threading
    import time
    aborted = threading.Event()

    class Stalled:
        def set_timeout(self, s: float) -> None:
            pass

        def request(self, m: str, p: str, headers: dict[str, str]) -> None:
            pass

        def getresponse(self) -> Any:
            if aborted.wait(10):
                raise OSError("aborted")
            raise AssertionError("watchdog が切らなかった")

        def abort(self) -> None:
            aborted.set()

        def close(self) -> None:
            pass

    f = FeedFetcher(resolver=lambda h: [PUBLIC4], connector=lambda h, ip, t: Stalled(), per_source_seconds=0.3)
    start = time.monotonic()
    assert f.fetch("https://status.example.com/f", "atom", MAX).code == "E-HTTP-TIME"
    assert aborted.is_set() and time.monotonic() - start < 3


@pytest.mark.parametrize("addrs", [
    ["10.0.0.5"], ["127.0.0.1"], ["169.254.169.254"], ["::1"], ["fc00::1"], ["::ffff:10.0.0.1"],
    [PUBLIC4, "192.168.1.1"], [],
], ids=lambda a: ",".join(a) or "empty")
def test_tst_feed_10_non_public_destinations(world: World, addrs: list[str]) -> None:
    """TST-FEED-10:公開でない宛先が1つでも混ざれば、つながずに E-HTTP-ADDR。"""
    world.dns["evil.example.com"] = addrs
    world.pages[("evil.example.com", "/f")] = Page(headers=ATOM_TYPE, body=BODY)
    assert fetcher(world).fetch("https://evil.example.com/f", "atom", MAX).code == "E-HTTP-ADDR"
    assert world.connected == []


@pytest.mark.parametrize("url", ["https://status.example.com:8443/f", "https://u:p@status.example.com/f",
                                 "https://10.0.0.1/f", "https://[::1]/f", "https://status.example.com/a b"])
def test_tst_feed_10_bad_first_url(world: World, url: str) -> None:
    """TST-FEED-10:443 以外・利用者名つき・IP そのものの内側・空白は、つながない。"""
    assert fetcher(world).fetch(url, "atom", MAX).code == "E-HTTP-ADDR"
    assert world.connected == []


def test_tst_feed_10_redirects(world: World) -> None:
    """TST-FEED-10:転送は自分で辿り 3 回まで。http・内側の宛先への転送はつながない。"""
    world.dns["inner.example.com"] = ["10.1.2.3"]
    for i in range(5):
        world.pages[("status.example.com", f"/r{i}")] = Page(status=302, headers={"Location": f"/r{i + 1}"})
    world.pages[("status.example.com", "/r3")] = Page(headers=ATOM_TYPE, body=BODY)
    assert fetcher(world).fetch("https://status.example.com/r0", "atom", MAX).code is None  # 3 回
    world.pages[("status.example.com", "/r3")] = Page(status=302, headers={"Location": "/r4"})
    world.pages[("status.example.com", "/r4")] = Page(headers=ATOM_TYPE, body=BODY)
    world.connected.clear()
    assert fetcher(world).fetch("https://status.example.com/r0", "atom", MAX).code == "E-HTTP-REDIRECT"
    assert len(world.connected) == 4

    world.pages[("status.example.com", "/to-http")] = Page(status=301, headers={"Location": "http://cdn.example.com/f"})
    world.pages[("status.example.com", "/to-inner")] = Page(status=307,
                                                            headers={"Location": "https://inner.example.com/f"})
    world.pages[("status.example.com", "/to-meta")] = Page(status=308, headers={"Location": "https://169.254.169.254/"})
    world.pages[("status.example.com", "/no-location")] = Page(status=302, headers={})
    world.connected.clear()
    f = fetcher(world)
    assert f.fetch("https://status.example.com/to-http", "atom", MAX).code == "E-HTTP-REDIRECT"
    assert f.fetch("https://status.example.com/to-inner", "atom", MAX).code == "E-HTTP-ADDR"
    assert f.fetch("https://status.example.com/to-meta", "atom", MAX).code == "E-HTTP-ADDR"
    assert f.fetch("https://status.example.com/no-location", "atom", MAX).code == "E-HTTP-REDIRECT"
    assert all(h == "status.example.com" for h, _ in world.connected)


@pytest.mark.parametrize("status", [404, 500, 403, 204, 206])
def test_tst_feed_10_status(world: World, status: int) -> None:
    world.pages[("status.example.com", "/f")] = Page(status=status, headers=ATOM_TYPE, body=BODY)
    assert fetcher(world).fetch("https://status.example.com/f", "atom", MAX).code == "E-HTTP-STATUS"


def test_tst_feed_11_conditional_get(world: World) -> None:
    """TST-FEED-11:前回の etag を If-None-Match、last_modified を If-Modified-Since で送り、304 は変化なしの成功。"""
    world.pages[("status.example.com", "/f")] = Page(status=304, headers={"ETag": '"v2"'})
    r = fetcher(world).fetch("https://status.example.com/f", "atom", MAX, '"v1"', "Thu, 19 Nov 2026 00:00:00 GMT")
    assert r.code is None and r.not_modified and r.body == b""
    assert r.etag == '"v2"' and r.last_modified is None
    headers = world.requests[0][2]
    assert headers["If-None-Match"] == '"v1"'
    assert headers["If-Modified-Since"] == "Thu, 19 Nov 2026 00:00:00 GMT"


@pytest.mark.parametrize("etag,want", [
    ('"ok"', '"ok"'), ("W/\"weak\"", "W/\"weak\""), ("x" * 501, None), ("bad\x01", None), ("日本", None),
    ("   ", None),
])
def test_tst_feed_11_etag_is_kept_only_if_safe(world: World, etag: str, want: str | None) -> None:
    """TST-FEED-11:次回に送り返す ETag は、印字できる ASCII で 500 字以内のときだけ持つ。"""
    world.pages[("status.example.com", "/f")] = Page(headers={**ATOM_TYPE, "ETag": etag}, body=BODY)
    assert fetcher(world).fetch("https://status.example.com/f", "atom", MAX).etag == want
