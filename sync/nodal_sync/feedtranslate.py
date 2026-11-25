"""公式フィードの機械翻訳(依頼 12-4。詳細設計 3.13)。Translator へ送るのは、このファイルだけ。

- 宛先は HOST の1つだけ(TLS は標準の検証。転送は辿らない)。1要求 20 秒、応答は 1 MB まで、Accept-Encoding は送らない
- 鍵と地域は環境変数から読むだけ。ログ・要約・例外の文に出さない(Credentials の repr も隠す)
- 原文・訳は外のデータ。送る前に html.escape、受け取った後にタグ・実体参照・制御文字を整える
- 原文の書き込み(feeddb.write_all)が終わってから、別の接続・別のトランザクションで動く
- psycopg はここでは import しない(DB の読み書きは feeddb。試験で差し替えられるように store として受け取る)
"""

from __future__ import annotations

import datetime as dt
import html
import http.client
import json
import re
import socket
import ssl
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol

from .feedconfig import FeedConfig
from .feedparse import _drop_bad_chars, _TextOnly
from .ogimage import TimerFactory, watchdog
from .report import TranslateSummary
from .schema import JsonFileError, parse_json_strict

HOST = "api.cognitive.microsofttranslator.com"
PATH = "/translate?api-version=3.0&from=en&to=ja&textType=html"
KEY_ENV = "AZURE_TRANSLATOR_KEY"
REGION_ENV = "AZURE_TRANSLATOR_REGION"

RUN_CHAR_LIMIT = 30_000          # 1回の起動で送る字数の上限(基本設計 4.6)
MONTH_CHAR_LIMIT = 1_500_000     # 月の上限(無料分 2,000,000 字の 75%)
MAX_BATCH_ITEMS = 100            # 1要求の要素の数(サービスの上限は 1,000)
MAX_BATCH_CHARS = 50_000         # 1要求の字数(サービスの上限と同じ)
MAX_ITEM_CHARS = 1_000           # 印を付けて 1,000 字を超えたら、印なしで送る
SUMMARY_SOURCE_CHARS = 400       # summary は原文の先頭 400 字だけ送る
MAX_TITLE_JA = 1_000             # 0002 の CHECK
MAX_SUMMARY_JA = 4_000           # 同上
MAX_ATTEMPTS = 3                 # 3 回失敗したら failed
TIMEOUT_SECONDS = 20.0
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_SECRET_LEN = 200
READ_CHUNK = 65536

E_TR_CONFIG = "E-TR-CONFIG"
E_TR_QUOTA = "E-TR-QUOTA"
E_TR_AUTH = "E-TR-AUTH"
E_TR_OTHER = "E-TR-OTHER"
E_TR_RESPONSE = "E-TR-RESPONSE"
MONTH_LIMIT_REASON = "月の上限"

OPEN_MARK = '<span class="notranslate">'
CLOSE_MARK = "</span>"
# 前後が英数字でないものだけ(語の途中の数字を版として囲まない)
CVE_MARK_RE = re.compile(r"(?<![0-9A-Za-z])CVE-[0-9]{4}-[0-9]{4,7}(?![0-9A-Za-z])")
KB_MARK_RE = re.compile(r"(?<![0-9A-Za-z])KB[0-9]{6,8}(?![0-9A-Za-z])")
VERSION_MARK_RE = re.compile(r"(?<![0-9A-Za-z])v?[0-9]+(?:\.[0-9]+){1,3}(?![0-9A-Za-z])")

JST = dt.timezone(dt.timedelta(hours=9))


# ---------------------------------------------------------------
# 鍵と地域
# ---------------------------------------------------------------
class TranslateConfigError(Exception):
    """鍵・地域の設定の誤り。文は決まりの番号だけ(値を入れない)。"""

    def __init__(self) -> None:
        super().__init__(E_TR_CONFIG)
        self.code = E_TR_CONFIG


class Credentials:
    """鍵と地域。repr・str に値を出さない(ログ・例外の文に紛れ込まないように)。"""

    __slots__ = ("key", "region")

    def __init__(self, key: str, region: str) -> None:
        self.key = key
        self.region = region

    def __repr__(self) -> str:
        return "Credentials(<hidden>)"

    __str__ = __repr__


def _secret_ok(v: str) -> bool:
    """印字できる ASCII で 1〜200 字(改行などがあるとヘッダーに入れられない)。"""
    return 1 <= len(v) <= MAX_SECRET_LEN and all(0x20 <= ord(ch) <= 0x7E for ch in v)


def read_credentials(env: Mapping[str, str]) -> Credentials | None:
    """両方あれば Credentials、両方無ければ None(訳さない)。片方だけ・形が違うときは TranslateConfigError。

    空の文字列は「無い」と同じ(Secrets が無いと Actions は空の文字列を渡すため)。
    """
    key = env.get(KEY_ENV) or ""
    region = env.get(REGION_ENV) or ""
    if not key and not region:
        return None
    if not key or not region or not _secret_ok(key) or not _secret_ok(region):
        raise TranslateConfigError()
    return Credentials(key, region)


# ---------------------------------------------------------------
# 訳す行の選び方(3.13.2)と、送る文字(3.13.3)
# ---------------------------------------------------------------
@dataclass(frozen=True)
class PendingRow:
    """DB から読んだ、訳す候補の行。title・summary は読んだときの原文(保存のときに比べる)。"""
    id: str
    source_id: str
    vendor: str
    product: str
    title: str
    summary: str


@dataclass
class Job:
    """1行分の送る文字。texts は title だけか、title と summary(この順)。"""
    row: PendingRow
    with_summary: bool
    texts: list[str]

    @property
    def chars(self) -> int:
        return sum(len(t) for t in self.texts)


def _spans(text: str, names: list[str]) -> list[tuple[int, int]]:
    """印を付ける範囲。重なったら長いほうを残す(同じ長さなら前のほう)。始まりの順に返す。"""
    cands: list[tuple[int, int]] = []
    for pat in (CVE_MARK_RE, KB_MARK_RE, VERSION_MARK_RE):
        cands += [m.span() for m in pat.finditer(text)]
    for name in names:
        cands += [m.span() for m in re.finditer(re.escape(name), text, re.IGNORECASE)]
    chosen: list[tuple[int, int]] = []
    for s, e in sorted(set(cands), key=lambda se: (se[0] - se[1], se[0])):
        if s < e and all(e <= cs or s >= ce for cs, ce in chosen):
            chosen.append((s, e))
    return sorted(chosen)


def mark(text: str, names: list[str]) -> str:
    """原文を html.escape し、CVE・KB・版・製品名を notranslate で囲む。1,000 字を超えたら印なし。

    範囲は原文で探し、範囲の内と外をそれぞれ escape してから組み立てる(実体参照の途中を囲まないため)。
    """
    out: list[str] = []
    pos = 0
    for s, e in _spans(text, names):
        out.append(html.escape(text[pos:s]))
        out.append(OPEN_MARK + html.escape(text[s:e]) + CLOSE_MARK)
        pos = e
    out.append(html.escape(text[pos:]))
    marked = "".join(out)
    if len(marked) > MAX_ITEM_CHARS:
        return html.escape(text)
    return marked


def _names(watch_products: tuple[str, ...], row: PendingRow) -> list[str]:
    """watch_products と、その行の vendor・product。空を除き、大文字・小文字を区別せずに重複を除き、長い順。"""
    seen: set[str] = set()
    out: list[str] = []
    for n in (*watch_products, row.vendor, row.product):
        n = n.strip()
        if n and n.casefold() not in seen:
            seen.add(n.casefold())
            out.append(n)
    return sorted(out, key=len, reverse=True)


def make_job(row: PendingRow, with_summary: bool, watch_products: tuple[str, ...]) -> Job:
    names = _names(watch_products, row)
    texts = [mark(row.title, names)]
    summary = row.summary[:SUMMARY_SOURCE_CHARS]
    # summary が空なら title だけ送る(summary_ja は null)
    if with_summary and summary.strip():
        texts.append(mark(summary, names))
    else:
        with_summary = False
    return Job(row=row, with_summary=with_summary, texts=texts)


def select_jobs(rows: list[PendingRow], cfg: FeedConfig,
                limit: int = RUN_CHAR_LIMIT) -> tuple[list[Job], int]:
    """rows(新しい順)から訳す行を選ぶ。(選んだ行, 訳さない取得先の行の数) を返す。

    translate が none・設定に無い取得先の行は数えて残す。送る字数が limit を超える手前で止める。
    """
    by_id = {s.id: s for s in cfg.sources}
    jobs: list[Job] = []
    skipped = 0
    total = 0
    full = False
    for r in rows:
        src = by_id.get(r.source_id)
        if src is None or src.translate == "none":
            skipped += 1
            continue
        if full:
            continue
        job = make_job(r, src.translate == "title+summary", cfg.watch_products)
        if total + job.chars > limit:
            full = True
            continue
        jobs.append(job)
        total += job.chars
    return jobs, skipped


def make_batches(jobs: list[Job], max_items: int = MAX_BATCH_ITEMS,
                 max_chars: int = MAX_BATCH_CHARS) -> list[list[Job]]:
    """要求ごとに分ける(100 要素・50,000 字まで)。1行の title と summary は同じ要求に入れる。"""
    batches: list[list[Job]] = []
    cur: list[Job] = []
    items = chars = 0
    for j in jobs:
        if cur and (items + len(j.texts) > max_items or chars + j.chars > max_chars):
            batches.append(cur)
            cur, items, chars = [], 0, 0
        cur.append(j)
        items += len(j.texts)
        chars += j.chars
    if cur:
        batches.append(cur)
    return batches


# ---------------------------------------------------------------
# 送る部品(3.13.4)
# ---------------------------------------------------------------
@dataclass
class Reply:
    status: int
    metered: str | None = None            # X-metered-usage
    content_encoding: str | None = None
    body: bytes = b""


Send = Callable[[bytes, Mapping[str, str]], Reply]


class _SendError(Exception):
    pass


class TranslatorConnection(http.client.HTTPSConnection):
    """HOST の 443 にだけつなぐ。証明書とホスト名は標準の検証(ssl.create_default_context)。"""

    def __init__(self, timeout: float) -> None:
        super().__init__(HOST, 443, timeout=timeout, context=ssl.create_default_context())

    def set_timeout(self, seconds: float) -> None:
        self.timeout = seconds
        if self.sock is not None:
            self.sock.settimeout(seconds)

    def abort(self) -> None:
        """別のスレッド(watchdog)から呼ぶ。待っている受信を終わらせる。"""
        s = self.sock
        if s is not None:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class _Conn(Protocol):
    def putrequest(self, method: str, url: str, skip_host: bool = ...,
                   skip_accept_encoding: bool = ...) -> None: ...

    def putheader(self, header: str, *values: str) -> None: ...

    def endheaders(self, message_body: bytes | None = ..., *, encode_chunked: bool = ...) -> None: ...

    def getresponse(self) -> Any: ...

    def set_timeout(self, seconds: float) -> None: ...

    def abort(self) -> None: ...

    def close(self) -> None: ...


class HttpsSender:
    """POST を1回送る。connect・clock・timer を差し替えると、試験でネットワークに出ない。"""

    def __init__(self, connect: Callable[[float], _Conn] = TranslatorConnection,
                 clock: Callable[[], float] = time.monotonic, timer: TimerFactory = watchdog,
                 seconds: float = TIMEOUT_SECONDS, max_bytes: int = MAX_RESPONSE_BYTES) -> None:
        self._connect = connect
        self._clock = clock
        self._timer = timer
        self._seconds = seconds
        self._max_bytes = max_bytes

    def _remaining(self, deadline: float) -> float:
        left = deadline - self._clock()
        if left <= 0:
            raise TimeoutError()
        return left

    def __call__(self, body: bytes, headers: Mapping[str, str]) -> Reply:
        deadline = self._clock() + self._seconds
        conn = self._connect(self._seconds)
        # 接続から読み終わりまでを通して、期限の時刻に watchdog が接続を切る
        dog = self._timer(self._seconds, conn.abort)
        dog.start()
        try:
            # http.client は headers に無いと Accept-Encoding: identity を足すので、skip_accept_encoding で止める
            conn.putrequest("POST", PATH, skip_accept_encoding=True)
            for k, v in headers.items():
                conn.putheader(k, v)
            conn.putheader("Content-Length", str(len(body)))
            conn.endheaders(body)
            conn.set_timeout(self._remaining(deadline))
            resp = conn.getresponse()
            reply = Reply(status=resp.status, metered=resp.getheader("X-metered-usage"),
                          content_encoding=resp.getheader("Content-Encoding"))
            if resp.status != 200:
                return reply  # 3xx も含め、本文は読まない(転送は辿らない)
            length = (resp.getheader("Content-Length") or "").strip()
            if length.isdigit() and int(length) > self._max_bytes:
                raise _SendError()
            chunks: list[bytes] = []
            total = 0
            while True:
                conn.set_timeout(self._remaining(deadline))
                b = resp.read1(READ_CHUNK)
                self._remaining(deadline)
                if not b:
                    break
                total += len(b)
                if total > self._max_bytes:
                    raise _SendError()
                chunks.append(b)
            reply.body = b"".join(chunks)
            return reply
        finally:
            dog.cancel()
            conn.close()


# ---------------------------------------------------------------
# 応答の検査(3.13.5)
# ---------------------------------------------------------------
def parse_metered(v: str | None) -> int | None:
    """X-metered-usage の値。数字だけ(9 桁まで)のときだけ数にする。"""
    if v is None:
        return None
    v = v.strip()
    if not v or len(v) > 9 or not all("0" <= ch <= "9" for ch in v):
        return None
    return int(v)


def parse_response(body: bytes, count: int) -> list[str] | None:
    """JSON の配列で、長さが count、各要素の translations[0] の text が文字列・to が ja。違えば None。"""
    try:
        obj = parse_json_strict(body)
    except JsonFileError:
        return None
    if not isinstance(obj, list) or len(obj) != count:
        return None
    out: list[str] = []
    for el in obj:
        if not isinstance(el, dict):
            return None
        trs = el.get("translations")
        if not isinstance(trs, list) or not trs or not isinstance(trs[0], dict):
            return None
        text, to = trs[0].get("text"), trs[0].get("to")
        if not isinstance(text, str) or to != "ja":
            return None
        out.append(text)
    return out


def clean_translation(raw: str, *, single_line: bool) -> str:
    """訳のタグを除き(feedparse と同じ部品)、実体参照を戻し、制御文字を除く。長さはまだ切らない。

    feedparse.clean_text と違い、実体参照はタグを除くのと同時に戻す(送るときに escape した「<」などを、
    タグと取り違えて消さないため)。戻した文字はただの文字として保存し、画面は React の標準の描画で出す。
    """
    s = _drop_bad_chars(raw)
    p = _TextOnly()
    try:
        p.feed(s)
        p.close()
        s = "".join(p.parts)
    except Exception:
        s = html.unescape(re.sub(r"<[^>]*>", " ", s))
    s = _drop_bad_chars(s)
    if single_line:
        return re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[^\S\n]+", " ", s)
    s = re.sub(r" ?\n[\s]*", "\n", s)
    return s.strip()


@dataclass
class Save:
    """保存する1行。title・summary は読んだときの原文(変わっていたら done にしない)。"""
    id: str
    title: str
    summary: str
    title_ja: str
    summary_ja: str | None


def build_saves(batch: list[Job], texts: list[str]) -> list[Save]:
    out: list[Save] = []
    i = 0
    for job in batch:
        title_ja = clean_translation(texts[i], single_line=True)[:MAX_TITLE_JA]
        i += 1
        summary_ja: str | None = None
        if job.with_summary:
            summary_ja = clean_translation(texts[i], single_line=False)[:MAX_SUMMARY_JA]
            i += 1
        out.append(Save(id=job.row.id, title=job.row.title, summary=job.row.summary,
                        title_ja=title_ja, summary_ja=summary_ja))
    return out


# ---------------------------------------------------------------
# 1要求(3.13.4〜3.13.6)
# ---------------------------------------------------------------
@dataclass
class CallResult:
    kind: str                      # ok / quota / auth / other
    code: str | None = None        # 決まりの番号(ok は None)
    texts: list[str] | None = None
    metered: int | None = None     # X-metered-usage(200 のときだけ)


class Translator:
    def __init__(self, creds: Credentials, send: Send,
                 trace_id: Callable[[], str] = lambda: str(uuid.uuid4())) -> None:
        self._creds = creds
        self._send = send
        self._trace_id = trace_id

    def call(self, texts: list[str]) -> CallResult:
        """texts を送って結果を返す。例外は外に出さない(例外の文に値が入りうるため、番号だけにする)。"""
        body = json.dumps([{"Text": t} for t in texts], ensure_ascii=False).encode("utf-8")
        headers = {
            "Ocp-Apim-Subscription-Key": self._creds.key,
            "Ocp-Apim-Subscription-Region": self._creds.region,
            "Content-Type": "application/json; charset=UTF-8",
            "X-ClientTraceId": self._trace_id(),
        }
        try:
            reply = self._send(body, headers)
        except Exception:
            return CallResult("other", E_TR_OTHER)
        if reply.status == 200:
            metered = parse_metered(reply.metered)
            enc = (reply.content_encoding or "").strip().lower()
            out = parse_response(reply.body, len(texts)) if enc in ("", "identity") else None
            if out is None:
                return CallResult("other", E_TR_RESPONSE, metered=metered)
            return CallResult("ok", texts=out, metered=metered)
        if reply.status in (429, 403):
            return CallResult("quota", E_TR_QUOTA)
        if reply.status == 401:
            return CallResult("auth", E_TR_AUTH)
        return CallResult("other", E_TR_OTHER)


def month_start(now: dt.datetime) -> dt.date:
    """日本時間の月の初日(feed_translate_usage の month)。"""
    return now.astimezone(JST).date().replace(day=1)


def run(store: Any, open_conn: Callable[[], Any], cfg: FeedConfig, creds: Credentials, send: Send,
        now: dt.datetime, result: TranslateSummary) -> None:
    """訳して保存する。結果は result に入れる(401 なら result.exit_code = 1)。

    store は feeddb(試験で差し替えられる)。DB の失敗はそこで止め、番号を result.stop に入れる。
    """
    result.state = "ran"
    month = month_start(now)
    try:
        conn = open_conn()
    except store.DbError as e:
        result.stop = e.code
        return
    try:
        try:
            used = store.read_usage(conn, month)
            result.month_chars = used
            rows = store.read_translate_targets(conn, MAX_ATTEMPTS)
            jobs, result.skipped = select_jobs(rows, cfg)
            if used >= MONTH_CHAR_LIMIT:
                result.stop = MONTH_LIMIT_REASON
                jobs = []
            translator = Translator(creds, send)
            for batch in make_batches(jobs):
                texts = [t for j in batch for t in j.texts]
                r = translator.call(texts)
                if r.kind == "quota":
                    result.stop = r.code
                    break
                if r.kind == "auth":
                    result.stop = r.code
                    result.exit_code = 1
                    break
                sent = sum(len(t) for t in texts)
                result.sent_chars += sent
                if r.metered is not None:
                    result.metered += r.metered
                if r.kind == "ok" and r.texts is not None:
                    charge = r.metered if r.metered is not None else sent
                    done, used = store.save_translations(conn, build_saves(batch, r.texts), month, charge)
                    result.translated += done
                else:
                    result.other[r.code or E_TR_OTHER] += 1
                    result.failed += store.record_failures(conn, [j.row.id for j in batch], MAX_ATTEMPTS)
                result.month_chars = used
                if used >= MONTH_CHAR_LIMIT:
                    result.stop = MONTH_LIMIT_REASON
                    break
            result.pending = store.count_pending(conn)
        except store.DbError as e:
            result.stop = e.code
    finally:
        conn.close()
