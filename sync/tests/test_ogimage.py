"""ogimage の試験。名前解決と接続を差し替え、ネットワークに出ない。TST-SYNC-14。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from nodal_sync import ogimage

PUBLIC4 = "93.184.215.14"
PUBLIC6 = "2606:4700::1111"


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


@dataclass
class Page:
    status: int = 200
    headers: dict[str, str] = field(default_factory=lambda: {"Content-Type": "text/html; charset=utf-8"})
    body: bytes = b""
    chunk: int = 65536
    delay_per_chunk: float = 0.0


def html(meta: str) -> bytes:
    return f"<html><head><title>架空の題</title>{meta}</head><body>架空の本文</body></html>".encode()


class FakeResponse:
    def __init__(self, page: Page, clock: Clock) -> None:
        self.status = page.status
        self._page = page
        self._clock = clock
        self._pos = 0

    def getheader(self, name: str, default: str | None = None) -> str | None:
        for k, v in self._page.headers.items():
            if k.lower() == name.lower():
                return v
        return default

    def read1(self, amt: int) -> bytes:
        n = min(amt, self._page.chunk)
        b = self._page.body[self._pos:self._pos + n]
        self._pos += len(b)
        if b:
            self._clock.t += self._page.delay_per_chunk
        return b


class World:
    """名前解決の結果とページを持つ、架空のインターネット。"""

    def __init__(self) -> None:
        self.clock = Clock()
        self.dns: dict[str, list[str]] = {}
        self.pages: dict[tuple[str, str], Page] = {}
        self.connected: list[tuple[str, str]] = []
        self.requests: list[tuple[str, str, dict[str, str]]] = []

    def resolve(self, host: str) -> list[str]:
        if host in self.dns:
            return self.dns[host]
        try:
            import ipaddress
            ipaddress.ip_address(host)
            return [host]  # IP アドレスそのもの
        except ValueError:
            raise OSError("no such host") from None

    def connect(self, host: str, ip: str, timeout: float) -> Any:
        self.connected.append((host, ip))
        world = self

        class Conn:
            path = ""

            def set_timeout(self, seconds: float) -> None:
                assert seconds > 0

            def request(self, method: str, path: str, headers: dict[str, str]) -> None:
                self.path = path
                world.requests.append((host, path, headers))

            def getresponse(self) -> FakeResponse:
                page = world.pages.get((host, self.path), Page(status=404))
                return FakeResponse(page, world.clock)

            def abort(self) -> None:
                pass

            def close(self) -> None:
                pass

        return Conn()

    def fetcher(self) -> ogimage.Fetcher:
        return ogimage.Fetcher(resolver=self.resolve, connector=self.connect, clock=self.clock,
                               timer=NoTimer)


class NoTimer:
    """偽の時計の試験では watchdog を動かさない(期限は偽の時計で確かめる)。"""

    def __init__(self, seconds: float, fn: Any) -> None:
        self.seconds = seconds

    def start(self) -> None:
        assert self.seconds > 0

    def cancel(self) -> None:
        pass


@pytest.fixture
def world() -> World:
    w = World()
    w.dns["news.example.com"] = [PUBLIC4, PUBLIC6]
    w.dns["cdn.example.com"] = [PUBLIC4]
    return w


def test_tst_sync_14_og_image_is_read(world: World) -> None:
    """TST-SYNC-14:og:image を読み、確かめた IP にだけつなぐ。User-Agent を付ける。"""
    world.pages[("news.example.com", "/a?x=1")] = Page(
        body=html('<meta property="og:image" content="https://cdn.example.com/a.png">'))
    assert world.fetcher().fetch("https://news.example.com/a?x=1#frag") == "https://cdn.example.com/a.png"
    assert world.connected == [("news.example.com", PUBLIC4)]
    assert world.requests[0][2]["User-Agent"] == ogimage.USER_AGENT


def test_tst_sync_14_relative_and_twitter_fallback(world: World) -> None:
    """TST-SYNC-14:相対の URL は直る。og:image が無ければ twitter:image に落ちる。"""
    world.pages[("news.example.com", "/dir/a")] = Page(
        body=html('<meta name="twitter:image" content="../img/b.png">'))
    assert world.fetcher().fetch("https://news.example.com/dir/a") == "https://news.example.com/img/b.png"


def test_tst_sync_14_relative_uses_last_page_after_redirect(world: World) -> None:
    """TST-SYNC-14:相対の URL は、最後に読んだページ(転送の後)を基準に直す。"""
    world.pages[("news.example.com", "/old")] = Page(status=301, headers={"Location": "https://cdn.example.com/new/"})
    world.pages[("cdn.example.com", "/new/")] = Page(body=html('<meta property="og:image" content="c.png">'))
    assert world.fetcher().fetch("https://news.example.com/old") == "https://cdn.example.com/new/c.png"


@pytest.mark.parametrize("content", ["http://cdn.example.com/a.png", "javascript:alert(1)",
                                     "https://cdn.example.com/a b.png", "data:image/png;base64,AAAA",
                                     "https://cdn.example.com/" + "a" * 2000])
def test_tst_sync_14_bad_image_url_is_not_used(world: World, content: str) -> None:
    """TST-SYNC-14:og:image が http などなら使わない。"""
    world.pages[("news.example.com", "/a")] = Page(
        body=html(f'<meta property="og:image" content="{content}">'))
    assert world.fetcher().fetch("https://news.example.com/a") is None


@pytest.mark.parametrize("url", [
    "http://news.example.com/a",
    "https://news.example.com:8443/a",
    "https://news.example.com:80/a",
    "https://user:pw@news.example.com/a",
    "ftp://news.example.com/a",
])
def test_tst_sync_14_scheme_and_port(world: World, url: str) -> None:
    """TST-SYNC-14:https・443 以外は、名前解決もしない・つながない。"""
    world.pages[("news.example.com", "/a")] = Page(body=html('<meta property="og:image" content="x.png">'))
    assert world.fetcher().fetch(url) is None
    assert world.connected == []


def test_tst_sync_14_port_443_explicit_is_ok(world: World) -> None:
    world.pages[("news.example.com", "/a")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    assert world.fetcher().fetch("https://news.example.com:443/a") == "https://news.example.com:443/x.png"


@pytest.mark.parametrize("addrs", [
    ["10.0.0.5"], ["192.168.1.1"], ["172.16.0.1"], ["127.0.0.1"], ["169.254.169.254"],
    ["::1"], ["fe80::1"], ["fc00::1"], ["::ffff:10.0.0.1"], ["::ffff:127.0.0.1"],
    ["100.64.0.1"], ["0.0.0.0"], ["224.0.0.1"], ["2002:0a00:0001::1"],
    [PUBLIC4, "10.0.0.5"], [PUBLIC6, "::1"], [],
], ids=lambda a: ",".join(a) or "empty")
def test_tst_sync_14_non_public_destinations(world: World, addrs: list[str]) -> None:
    """TST-SYNC-14:非公開の宛先(1つでも混ざる)にはつながない。"""
    world.dns["evil.example.com"] = addrs
    world.pages[("evil.example.com", "/")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    assert world.fetcher().fetch("https://evil.example.com/") is None
    assert world.connected == []


@pytest.mark.parametrize("url", ["https://10.0.0.1/", "https://127.0.0.1/", "https://[::1]/",
                                 "https://[::ffff:192.168.0.1]/", "https://169.254.169.254/latest"])
def test_tst_sync_14_ip_literal_hosts(world: World, url: str) -> None:
    """TST-SYNC-14:ホストが IP アドレスそのものでも同じ検査。"""
    assert world.fetcher().fetch(url) is None
    assert world.connected == []


def test_tst_sync_14_redirect_to_http_or_private(world: World) -> None:
    """TST-SYNC-14:転送先が http・プライベートなら使わない。"""
    world.dns["inner.example.com"] = ["10.1.2.3"]
    world.pages[("news.example.com", "/to-http")] = Page(status=302, headers={"Location": "http://cdn.example.com/"})
    world.pages[("news.example.com", "/to-private")] = Page(status=307, headers={"Location": "https://inner.example.com/"})
    world.pages[("news.example.com", "/to-meta")] = Page(status=308, headers={"Location": "https://169.254.169.254/"})
    world.pages[("cdn.example.com", "/")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    f = world.fetcher()
    assert f.fetch("https://news.example.com/to-http") is None
    assert f.fetch("https://news.example.com/to-private") is None
    assert f.fetch("https://news.example.com/to-meta") is None
    assert all(h == "news.example.com" for h, _ in world.connected)


def test_tst_sync_14_redirect_limit(world: World) -> None:
    """TST-SYNC-14:転送は3回まで。4回目は使わない。"""
    for i in range(5):
        world.pages[("news.example.com", f"/r{i}")] = Page(status=302, headers={"Location": f"/r{i + 1}"})
    world.pages[("news.example.com", "/r3")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    assert world.fetcher().fetch("https://news.example.com/r0") == "https://news.example.com/x.png"  # 3回
    world.connected.clear()
    world.pages[("news.example.com", "/r3")] = Page(status=302, headers={"Location": "/r4"})
    world.pages[("news.example.com", "/r4")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    assert world.fetcher().fetch("https://news.example.com/r0") is None  # 4回目
    assert len(world.connected) == 4  # r0〜r3 だけ。r4 にはつながない


def test_tst_sync_14_slow_drip(world: World) -> None:
    """TST-SYNC-14:5 秒を超えて少しずつ届くページは使わない。"""
    body = html('<meta property="og:image" content="/x.png">') + b" " * 10000
    world.pages[("news.example.com", "/slow")] = Page(body=body, chunk=1000, delay_per_chunk=0.6)
    assert world.fetcher().fetch("https://news.example.com/slow") is None
    world.pages[("news.example.com", "/ok")] = Page(body=body, chunk=1000, delay_per_chunk=0.1)
    assert world.fetcher().fetch("https://news.example.com/ok") == "https://news.example.com/x.png"


def test_tst_sync_14_watchdog_cuts_stalled_connection() -> None:
    """TST-SYNC-14:本物の時計で、応答を待ったまま進まない接続も、期限の時刻に watchdog が切る。"""
    import threading
    import time

    aborted = threading.Event()

    class StalledConn:
        def set_timeout(self, seconds: float) -> None:
            pass

        def request(self, method: str, path: str, headers: dict[str, str]) -> None:
            pass

        def getresponse(self) -> Any:
            # 少しずつ届くヘッダーの代わり:切られるまで返さない(最大 10 秒)
            if aborted.wait(10):
                raise OSError("aborted")
            raise AssertionError("watchdog が切らなかった")

        def abort(self) -> None:
            aborted.set()

        def close(self) -> None:
            pass

    f = ogimage.Fetcher(resolver=lambda h: [PUBLIC4], connector=lambda h, ip, t: StalledConn(),
                        per_item_seconds=0.3)
    start = time.monotonic()
    assert f.fetch("https://news.example.com/stall") is None
    assert aborted.is_set()
    assert time.monotonic() - start < 3


def test_tst_sync_14_watchdog_cuts_tls_handshake() -> None:
    """TST-SYNC-14:本物の PinnedHTTPSConnection で、握手のデータを返さない相手(ローカルのソケット)も期限で切れる。"""
    import socket
    import time

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]
    try:
        conn = ogimage.PinnedHTTPSConnection("news.example.com", "127.0.0.1", timeout=10, port=port)
        dog = ogimage.watchdog(0.3, conn.abort)
        dog.start()
        start = time.monotonic()
        with pytest.raises(OSError):  # ssl.SSLError も OSError の仲間
            conn.connect()
        dog.cancel()
        assert time.monotonic() - start < 3
        conn.close()
    finally:
        server.close()


def test_tst_sync_14_total_budget(world: World) -> None:
    """1回の起動で合わせて 60 秒を超えたら、それより後は取りに行かない。"""
    world.pages[("news.example.com", "/a")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    f = world.fetcher()
    world.clock.t += 61
    assert f.fetch("https://news.example.com/a") is None
    assert world.connected == []


def test_tst_sync_14_too_big(world: World) -> None:
    """TST-SYNC-14:256 KB を超えるページは使わない。"""
    body = html('<meta property="og:image" content="/x.png">')
    world.pages[("news.example.com", "/big")] = Page(body=body + b" " * (ogimage.MAX_BYTES + 1 - len(body)))
    assert world.fetcher().fetch("https://news.example.com/big") is None
    world.pages[("news.example.com", "/fit")] = Page(body=body + b" " * (ogimage.MAX_BYTES - len(body)))
    assert world.fetcher().fetch("https://news.example.com/fit") == "https://news.example.com/x.png"


@pytest.mark.parametrize("ctype", ["image/png", "application/json", "text/plain", "", "text/htmlx"])
def test_tst_sync_14_not_html(world: World, ctype: str) -> None:
    """TST-SYNC-14:text/html でないものは使わない。"""
    world.pages[("news.example.com", "/a")] = Page(
        headers={"Content-Type": ctype}, body=html('<meta property="og:image" content="/x.png">'))
    assert world.fetcher().fetch("https://news.example.com/a") is None


def test_tst_sync_14_errors_are_swallowed(world: World) -> None:
    """名前解決の失敗・404 は None(例外を外に出さない)。"""
    assert world.fetcher().fetch("https://nowhere.example.com/") is None
    assert world.fetcher().fetch("https://news.example.com/missing") is None


def test_fetch_images_counts(world: World) -> None:
    world.pages[("news.example.com", "/a")] = Page(body=html('<meta property="og:image" content="/x.png">'))
    saved: list[tuple[str, str, str]] = []
    ok, ng = ogimage.fetch_images(
        [("2026-11-20-01", "https://news.example.com/a"), ("2026-11-20-02", "https://news.example.com/b")],
        world.fetcher(), lambda i, s, u: saved.append((i, s, u)))
    assert (ok, ng) == (1, 1)
    assert saved == [("2026-11-20-01", "https://news.example.com/a", "https://news.example.com/x.png")]


def test_is_public_ip() -> None:
    assert ogimage.is_public_ip(PUBLIC4)
    assert ogimage.is_public_ip(PUBLIC6)
    assert not ogimage.is_public_ip("::ffff:10.0.0.1")
    assert not ogimage.is_public_ip("64:ff9b::a00:1")      # NAT64 で 10.0.0.1
    assert not ogimage.is_public_ip("64:ff9b::7f00:1")     # NAT64 で 127.0.0.1
    assert not ogimage.is_public_ip("::a00:1")             # IPv4 互換で 10.0.0.1
    assert not ogimage.is_public_ip("64:ff9b:1::1")
    assert not ogimage.is_public_ip("not-an-ip")
