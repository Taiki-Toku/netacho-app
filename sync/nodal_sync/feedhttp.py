"""公式フィードの取得(依頼 12-1。詳細設計 3.4)。外と通信するのは、このファイルだけ。

設定の URL はオーナーが書く値だが、転送先は相手が決めるので、og:image と同じ守りで取る(ogimage.py の部品を使う)。
- 転送は自分で辿る(3回まで)。1回ごとに https・443・空白なしと、名前解決の結果がすべて公開のアドレスかを確かめ、確かめた IP に直接つなぐ
- Accept-Encoding は送らない。Content-Encoding が付いた応答は捨てる(圧縮の展開の爆弾を避ける)
- 1つの取得先は 10 秒、1回の起動で合わせて 300 秒。大きさは max_bytes まで
- 失敗は決まりの番号だけを返す。応答の中身・URL はログに出さない
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.parse import urljoin

from .ogimage import (
    REDIRECT_STATUSES,
    Connection,
    Connector,
    PinnedHTTPSConnection,
    Resolver,
    Response,
    TimerFactory,
    check_url,
    is_public_ip,
    resolve,
    watchdog,
)

USER_AGENT = "NODAL-feed/1 (+https://github.com/Taiki-Toku/netacho-app)"
PER_SOURCE_SECONDS = 10.0
TOTAL_SECONDS = 300.0
MAX_REDIRECTS = 3
READ_CHUNK = 65536
MAX_ETAG_LEN = 500           # 0002 の feed_source_state の CHECK
MAX_LAST_MODIFIED_LEN = 100  # 同上

ACCEPT = {
    "rss2": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
    "atom": "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
    "rss1": "application/rdf+xml, application/rss+xml;q=0.9, application/xml;q=0.8, text/xml;q=0.7",
    "kev-json": "application/json",
}
TYPE_WORDS = ("xml", "rss", "atom", "json")

E_STATUS = "E-HTTP-STATUS"
E_TYPE = "E-HTTP-TYPE"
E_SIZE = "E-HTTP-SIZE"
E_TIME = "E-HTTP-TIME"
E_ADDR = "E-HTTP-ADDR"
E_REDIRECT = "E-HTTP-REDIRECT"
E_ENCODING = "E-HTTP-ENCODING"
E_NET = "E-HTTP-NET"


class _HttpError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class FetchResult:
    """取得の結果。code が None なら成功。not_modified は 304(変化なし。成功に数える)。"""
    code: str | None = None
    not_modified: bool = False
    body: bytes = b""
    etag: str | None = None
    last_modified: str | None = None


class FeedConnection(PinnedHTTPSConnection):
    """ogimage の接続に、Accept-Encoding を付けない request を足したもの。

    http.client の request は、headers に無いと「Accept-Encoding: identity」を自分で足す。
    設計は「送らない」なので、putrequest の skip_accept_encoding で止める。Host はホスト名が付く。
    """

    def request(self, method: str, url: str, body: Any = None,  # type: ignore[override]
                headers: Mapping[str, str] = {}, *, encode_chunked: bool = False) -> None:
        self.putrequest(method, url, skip_accept_encoding=True)
        for k, v in headers.items():
            self.putheader(k, v)  # 改行を含む値は http.client が ValueError にする
        self.endheaders()


def connect_feed(host: str, ip: str, timeout: float) -> Connection:
    """確かめた IP の 443 にだけつなぐ(SNI・証明書・Host はホスト名)。"""
    return FeedConnection(host, ip, timeout)


def _header_value(v: str | None, limit: int) -> str | None:
    """ETag・Last-Modified を次回に送り返すので、印字できる ASCII で limit 字以内のときだけ持つ。"""
    if v is None:
        return None
    v = v.strip()
    if not v or len(v) > limit or any(not 0x20 <= ord(ch) <= 0x7E for ch in v):
        return None
    return v


def _type_ok(ctype: str) -> bool:
    """xml・rss・atom・json を含む Content-Type か、text/plain(XML を text/plain で返す取得先がある)。"""
    main = ctype.split(";", 1)[0].strip().lower()
    return main == "text/plain" or any(w in main for w in TYPE_WORDS)


class FeedFetcher:
    """フィードを取る。resolver・connector・clock・timer を差し替えると、試験でネットワークに出ない。"""

    def __init__(self, resolver: Resolver = resolve, connector: Connector = connect_feed,
                 clock: Callable[[], float] = time.monotonic, timer: TimerFactory = watchdog,
                 per_source_seconds: float = PER_SOURCE_SECONDS,
                 total_seconds: float = TOTAL_SECONDS) -> None:
        self._resolve = resolver
        self._connect = connector
        self._clock = clock
        self._timer = timer
        self._per_source = per_source_seconds
        self._total_deadline = clock() + total_seconds

    def fetch(self, url: str, fmt: str, max_bytes: int, etag: str | None = None,
              last_modified: str | None = None) -> FetchResult:
        """取って FetchResult を返す。例外は外に出さず、決まりの番号にする(中身を出さないため)。"""
        deadline = min(self._clock() + self._per_source, self._total_deadline)
        try:
            return self._fetch(url, fmt, max_bytes, etag, last_modified, deadline)
        except _HttpError as e:
            return FetchResult(code=e.code)
        except TimeoutError:
            return FetchResult(code=E_TIME)
        except Exception:
            # watchdog が接続を切ったときは OSError になるので、期限を過ぎていれば時間切れに数える
            return FetchResult(code=E_TIME if self._clock() >= deadline else E_NET)

    def _remaining(self, deadline: float) -> float:
        left = deadline - self._clock()
        if left <= 0:
            raise _HttpError(E_TIME)
        return left

    def _fetch(self, url: str, fmt: str, max_bytes: int, etag: str | None,
               last_modified: str | None, deadline: float) -> FetchResult:
        headers = {"User-Agent": USER_AGENT, "Accept": ACCEPT.get(fmt, "application/xml")}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        current = url
        for hop in range(MAX_REDIRECTS + 1):
            checked = check_url(current)
            if checked is None:
                # 最初の URL は設定の値(https で始まることは確かめ済み)。転送先なら転送の誤り
                raise _HttpError(E_ADDR if hop == 0 else E_REDIRECT)
            host, path = checked
            self._remaining(deadline)
            try:
                addrs = self._resolve(host)
            except OSError:
                raise _HttpError(E_NET) from None
            # 1つでも公開でない宛先が混ざれば、つながない(DNS で内側へ向ける攻撃を避ける)
            if not addrs or not all(is_public_ip(a) for a in addrs):
                raise _HttpError(E_ADDR)
            remaining = self._remaining(deadline)
            conn = self._connect(host, addrs[0], remaining)
            # 接続から読み終わりまでを通して、期限の時刻に watchdog が接続を切る
            dog = self._timer(remaining, conn.abort)
            dog.start()
            try:
                conn.request("GET", path, headers=headers)
                conn.set_timeout(max(deadline - self._clock(), 0.001))
                resp = conn.getresponse()
                if resp.status in REDIRECT_STATUSES:
                    location = resp.getheader("Location")
                    if not location or hop >= MAX_REDIRECTS:
                        raise _HttpError(E_REDIRECT)
                    current = urljoin(current, location.strip())
                    continue
                if resp.status == 304:
                    return FetchResult(
                        not_modified=True,
                        etag=_header_value(resp.getheader("ETag"), MAX_ETAG_LEN),
                        last_modified=_header_value(resp.getheader("Last-Modified"),
                                                    MAX_LAST_MODIFIED_LEN))
                if resp.status != 200:
                    raise _HttpError(E_STATUS)
                if (resp.getheader("Content-Encoding") or "").strip():
                    raise _HttpError(E_ENCODING)
                if not _type_ok(resp.getheader("Content-Type") or ""):
                    raise _HttpError(E_TYPE)
                length = (resp.getheader("Content-Length") or "").strip()
                if length.isdigit() and int(length) > max_bytes:
                    raise _HttpError(E_SIZE)
                body = self._read_body(conn, resp, deadline, max_bytes)
                return FetchResult(
                    body=body,
                    etag=_header_value(resp.getheader("ETag"), MAX_ETAG_LEN),
                    last_modified=_header_value(resp.getheader("Last-Modified"), MAX_LAST_MODIFIED_LEN))
            finally:
                dog.cancel()
                conn.close()
        raise _HttpError(E_REDIRECT)

    def _read_body(self, conn: Connection, resp: Response, deadline: float, max_bytes: int) -> bytes:
        """max_bytes を超えたら、その時点で読むのをやめる(全部を読んでから捨てない)。"""
        chunks: list[bytes] = []
        total = 0
        while True:
            conn.set_timeout(self._remaining(deadline))
            b = resp.read1(READ_CHUNK)  # read と違い、1回の受信で戻る
            self._remaining(deadline)
            if not b:
                return b"".join(chunks)
            total += len(b)
            if total > max_bytes:
                raise _HttpError(E_SIZE)
            chunks.append(b)
