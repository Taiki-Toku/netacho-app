"""出典のページから og:image の URL を取る(依頼 10-1 の 4.7)。SSRF の入口として作る。

- 転送は自分で辿る(3回まで)。1回ごとに https・443・名前解決の結果がすべて公開のアドレスかを確かめる
- 確かめた IP に直接つなぐ(名前解決をやり直さない)。SNI・証明書・Host はホスト名
- 1件 5 秒・1回の起動で 60 秒の打ち切りを自分で持つ。読むのは 256 KB まで、text/html だけ
- ページの中身はログに出さない。返すのは確かめた画像の URL だけ
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import threading
import time
from html.parser import HTMLParser
from typing import Any, Callable, Protocol
from urllib.parse import urljoin, urlsplit

USER_AGENT = "NODAL-sync/1 (+https://github.com/Taiki-Toku/netacho-app)"
PER_ITEM_SECONDS = 5.0
TOTAL_SECONDS = 60.0
MAX_BYTES = 256 * 1024
MAX_REDIRECTS = 3
MAX_URL_LEN = 2000
READ_CHUNK = 8192
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


class Response(Protocol):
    status: int

    def getheader(self, name: str, default: str | None = None) -> str | None: ...

    def read1(self, amt: int) -> bytes: ...


class Connection(Protocol):
    def set_timeout(self, seconds: float) -> None: ...

    def request(self, method: str, url: str, headers: dict[str, str]) -> None: ...

    def getresponse(self) -> Response: ...

    def abort(self) -> None: ...

    def close(self) -> None: ...


class Timer(Protocol):
    def start(self) -> None: ...

    def cancel(self) -> None: ...


Resolver = Callable[[str], list[str]]
Connector = Callable[[str, str, float], Connection]  # (ホスト名, 確かめた IP, timeout)
TimerFactory = Callable[[float, Callable[[], None]], Timer]  # (秒, 時刻になったら呼ぶ関数)


def watchdog(seconds: float, fn: Callable[[], None]) -> Timer:
    """期限の時刻に fn(接続を切る)を呼ぶ。ソケットの timeout は1回の受信ごとの上限なので、合計の時間はこれで守る。"""
    t = threading.Timer(seconds, fn)
    t.daemon = True
    return t


def resolve(host: str) -> list[str]:
    """名前解決した宛先の IP アドレス(文字列)を全部返す。"""
    infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    out: list[str] = []
    for info in infos:
        addr = str(info[4][0])
        if addr not in out:
            out.append(addr)
    return out


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """確かめた IP に直接つなぐ HTTPS の接続。SNI・証明書の確認・Host にはホスト名を使う。"""

    def __init__(self, host: str, ip: str, timeout: float, port: int = 443) -> None:
        # port は試験(ローカルのソケット)のためだけ。本番の connect_pinned は 443 だけを使う
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._pinned_ip = ip
        self._aborted = threading.Event()

    def connect(self) -> None:
        sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)
        try:
            # 握手の前に self.sock に入れておき、握手の途中でも abort() が切れるようにする
            # (wrap_socket は元のソケットを detach するので、元のソケットは切れない)
            ssock = self._context.wrap_socket(  # type: ignore[attr-defined]
                sock, server_hostname=self.host, do_handshake_on_connect=False)
        except BaseException:
            sock.close()
            raise
        self.sock = ssock
        if self._aborted.is_set():
            raise OSError("aborted")
        ssock.do_handshake()

    def set_timeout(self, seconds: float) -> None:
        self.timeout = seconds
        if self.sock is not None:
            self.sock.settimeout(seconds)

    def abort(self) -> None:
        """別のスレッド(watchdog)から呼ぶ。待っている受信(握手を含む)を終わらせる。"""
        self._aborted.set()
        s = self.sock
        if s is not None:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def connect_pinned(host: str, ip: str, timeout: float) -> Connection:
    return PinnedHTTPSConnection(host, ip, timeout)


_EMBEDDED_V4_NETS = (ipaddress.IPv6Network("64:ff9b::/96"), ipaddress.IPv6Network("::/96"))
_NAT64_LOCAL = ipaddress.IPv6Network("64:ff9b:1::/48")


def is_public_ip(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif any(ip in net for net in _EMBEDDED_V4_NETS):
            # NAT64(64:ff9b::/96)・IPv4 互換(::/96)は、末尾の 32 ビットの IPv4 を確かめる
            ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        elif ip in _NAT64_LOCAL:
            return False
        else:
            # 6to4・Teredo で埋め込んだ IPv4 も確かめる
            embedded = [x for x in (ip.sixtofour, *(ip.teredo or ())) if x is not None]
            if any(not (e.is_global and not e.is_multicast) for e in embedded):
                return False
    return ip.is_global and not ip.is_multicast


def check_url(url: str) -> tuple[str, str] | None:
    """https・ホストあり・ポート 443・空白なし・2000 字以内なら (ホスト名, パス) を返す。"""
    if len(url) > MAX_URL_LEN or any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in url):
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or not parts.hostname:
        return None
    if parts.username is not None or parts.password is not None:
        return None
    if port is not None and port != 443:
        return None
    host = parts.hostname
    if not host.isascii():
        return None
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    if not path.isascii():
        return None
    return host, path


def is_usable_image_url(url: str) -> bool:
    if len(url) > MAX_URL_LEN or any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in url):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme == "https" and bool(parts.hostname)


class _MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.og: str | None = None
        self.twitter: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        content = a.get("content")
        if content is None:
            return
        if self.og is None and a.get("property", "").lower() == "og:image":
            self.og = content
        elif self.twitter is None and a.get("name", "").lower() == "twitter:image":
            self.twitter = content


def extract_image(html_bytes: bytes, content_type: str, page_url: str) -> str | None:
    charset = "utf-8"
    for part in content_type.split(";")[1:]:
        k, _, v = part.strip().partition("=")
        if k.lower() == "charset" and v:
            charset = v.strip().strip('"')
    try:
        text = html_bytes.decode(charset, "replace")
    except LookupError:
        text = html_bytes.decode("utf-8", "replace")
    p = _MetaParser()
    try:
        p.feed(text)
        p.close()
    except Exception:
        return None
    raw = p.og if p.og is not None else p.twitter
    if raw is None:
        return None
    img = urljoin(page_url, raw.strip())
    return img if is_usable_image_url(img) else None


class Fetcher:
    """og:image を取る。resolver・connector・clock を差し替えると、試験でネットワークに出ない。"""

    def __init__(self, resolver: Resolver = resolve, connector: Connector = connect_pinned,
                 clock: Callable[[], float] = time.monotonic,
                 timer: TimerFactory = watchdog,
                 per_item_seconds: float = PER_ITEM_SECONDS,
                 total_seconds: float = TOTAL_SECONDS) -> None:
        self._resolve = resolver
        self._connect = connector
        self._clock = clock
        self._timer = timer
        self._per_item = per_item_seconds
        self._total_deadline = clock() + total_seconds

    def fetch(self, url: str) -> str | None:
        """取れれば画像の URL、取れなければ None。例外は外に出さない。"""
        try:
            return self._fetch(url)
        except Exception:
            return None

    def _remaining(self, deadline: float) -> float:
        return deadline - self._clock()

    def _fetch(self, url: str) -> str | None:
        deadline = min(self._clock() + self._per_item, self._total_deadline)
        current = url
        for hop in range(MAX_REDIRECTS + 1):
            checked = check_url(current)
            if checked is None:
                return None
            host, path = checked
            if self._remaining(deadline) <= 0:
                return None
            addrs = self._resolve(host)
            if not addrs or not all(is_public_ip(a) for a in addrs):
                return None
            remaining = self._remaining(deadline)
            if remaining <= 0:
                return None
            conn = self._connect(host, addrs[0], remaining)
            # 接続・握手・ヘッダー・本文を通して、期限の時刻に接続を切る
            dog = self._timer(remaining, conn.abort)
            dog.start()
            try:
                conn.request("GET", path, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
                conn.set_timeout(max(self._remaining(deadline), 0.001))
                resp = conn.getresponse()
                if resp.status in REDIRECT_STATUSES:
                    location = resp.getheader("Location")
                    if not location or hop >= MAX_REDIRECTS:
                        return None
                    current = urljoin(current, location.strip())
                    continue
                if resp.status != 200:
                    return None
                ctype = resp.getheader("Content-Type") or ""
                if ctype.split(";", 1)[0].strip().lower() != "text/html":
                    return None
                body = self._read_body(conn, resp, deadline)
                if body is None:
                    return None
                return extract_image(body, ctype, current)
            finally:
                dog.cancel()
                conn.close()
        return None

    def _read_body(self, conn: Connection, resp: Response, deadline: float) -> bytes | None:
        chunks: list[bytes] = []
        total = 0
        while True:
            remaining = self._remaining(deadline)
            if remaining <= 0:
                return None
            conn.set_timeout(remaining)
            b = resp.read1(READ_CHUNK)  # read と違い、1回の受信で戻る
            if self._remaining(deadline) <= 0:
                return None
            if not b:
                return b"".join(chunks)
            total += len(b)
            if total > MAX_BYTES:
                return None
            chunks.append(b)


def fetch_images(targets: list[tuple[str, str]], fetcher: Fetcher,
                 save: Callable[[str, str, str], Any]) -> tuple[int, int]:
    """targets の (id, source_url) ごとに取り、取れたら save(id, source_url, image_url)。(取れた, 取れなかった)。"""
    ok = ng = 0
    for item_id, source_url in targets:
        img = fetcher.fetch(source_url)
        if img is None:
            ng += 1
            continue
        try:
            save(item_id, source_url, img)
            ok += 1
        except Exception:
            ng += 1
    return ok, ng
