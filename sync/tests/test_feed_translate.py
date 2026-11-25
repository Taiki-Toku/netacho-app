"""公式フィードの機械翻訳の試験。TST-TR-01〜09(詳細設計 3.13.9)。

Translator への送信は FakeSend に差し替え、ネットワークに出ない。鍵・地域・記事はすべて架空の値。
DB の試験は test_feed_db と同じ土台(admin でつなぎ `set role netacho_feed`)。無ければ skip(NODAL_REQUIRE_DB=1 なら失敗)。
"""

from __future__ import annotations

import datetime as dt
import io
import json
from pathlib import Path
from typing import Any, Callable

import pytest

from nodal_sync import feedtranslate as ft
from nodal_sync.feedconfig import FeedConfig, Source
from nodal_sync.feedparse import SourceOutcome
from nodal_sync.report import FeedSummary, TranslateSummary
from test_feed_main import NOW, SOURCES, FakeFeedFetcher, ok_results, write_feed_config

FAKE_KEY = "fake-translator-key-0000"   # 架空の鍵
FAKE_REGION = "japaneast"
KEYS = {ft.KEY_ENV: FAKE_KEY, ft.REGION_ENV: FAKE_REGION}
UTC = dt.timezone.utc


# ---------------------------------------------------------------
# 試験の部品
# ---------------------------------------------------------------
def echo_reply(metered: str | None = "auto", prefix: str = "訳 ") -> Callable[[list[dict[str, str]]], ft.Reply]:
    """送った文字の前に prefix を付けて返す 200。metered が auto なら送った字数。"""
    def make(req: list[dict[str, str]]) -> ft.Reply:
        body = json.dumps([{"translations": [{"text": prefix + r["Text"], "to": "ja"}]} for r in req])
        m = str(sum(len(r["Text"]) for r in req)) if metered == "auto" else metered
        return ft.Reply(status=200, metered=m, body=body.encode("utf-8"))
    return make


class FakeSend:
    """要求ごとに replies を順に使う(最後の1つは使い回す)。送った本文とヘッダーを記録する。"""

    def __init__(self, *replies: Any) -> None:
        self.replies = list(replies) or [echo_reply()]
        self.calls: list[tuple[list[dict[str, str]], dict[str, str]]] = []

    def __call__(self, body: bytes, headers: Any) -> ft.Reply:
        req = json.loads(body.decode("utf-8"))
        self.calls.append((req, dict(headers)))
        r = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(r, BaseException):
            raise r
        if callable(r):
            return r(req)
        return r


def never_send(body: bytes, headers: Any) -> ft.Reply:
    raise AssertionError("Translator に送った")


def src(sid: str, **over: Any) -> Source:
    d = dict(SOURCES[sid])
    d.update(over)
    return Source(**d)


def cfg_of(*sources: Source, watch: tuple[str, ...] = ("exampleguard", "samplekit")) -> FeedConfig:
    return FeedConfig(watch_products=watch, sources=tuple(sources))


def prow(rid: str, source_id: str = "example-cloud", title: str = "Fictional title", summary: str = "",
         vendor: str = "Example", product: str = "Example Cloud") -> ft.PendingRow:
    return ft.PendingRow(id=rid, source_id=source_id, vendor=vendor, product=product, title=title, summary=summary)


class FakeConn:
    closed = False

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def fake_expat(monkeypatch: pytest.MonkeyPatch) -> None:
    from nodal_sync import feedparse
    monkeypatch.setattr(feedparse, "expat_version", lambda: "expat_2.7.2")


@pytest.fixture
def fake_feed_db(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """feed の DB(etag の読み出しと原文の書き込み)を差し替える。接続した回数を数える。psycopg が要る。"""
    pytest.importorskip("psycopg")
    from nodal_sync import feeddb
    monkeypatch.setattr(feeddb, "read_states", lambda conn: {})
    monkeypatch.setattr(feeddb, "write_all", lambda conn, outcomes: (
        {o.source.id: feeddb.WriteStats() for o in outcomes}, 0))
    for name in ("read_usage", "read_translate_targets", "save_translations", "record_failures", "count_pending"):
        def boom(*a: Any, **k: Any) -> Any:
            raise AssertionError("翻訳で DB を使った")
        monkeypatch.setattr(feeddb, name, boom)
    calls: list[str] = []
    return calls


def counting_connect(calls: list[str]) -> Callable[[str, str | None], FakeConn]:
    def connect(url: str, ca: str | None) -> FakeConn:
        calls.append(url)
        return FakeConn()
    return connect


# ---------------------------------------------------------------
# TST-TR-01 鍵・dry-run・--no-translate
# ---------------------------------------------------------------
def test_tst_tr_01_read_credentials() -> None:
    """TST-TR-01:両方あれば使う。両方無い・空は None。片方だけ・形が違うのは E-TR-CONFIG(文に値を入れない)。"""
    c = ft.read_credentials(KEYS)
    assert c is not None and c.key == FAKE_KEY and c.region == FAKE_REGION
    assert FAKE_KEY not in repr(c) and FAKE_KEY not in str(c)
    assert ft.read_credentials({}) is None
    assert ft.read_credentials({ft.KEY_ENV: "", ft.REGION_ENV: ""}) is None
    for env in [{ft.KEY_ENV: FAKE_KEY}, {ft.REGION_ENV: FAKE_REGION},
                {ft.KEY_ENV: FAKE_KEY, ft.REGION_ENV: ""},
                {ft.KEY_ENV: FAKE_KEY + "\n", ft.REGION_ENV: FAKE_REGION},
                {ft.KEY_ENV: "鍵" + FAKE_KEY, ft.REGION_ENV: FAKE_REGION},
                {ft.KEY_ENV: "k" * 201, ft.REGION_ENV: FAKE_REGION},
                {ft.KEY_ENV: FAKE_KEY, ft.REGION_ENV: "japan\teast"}]:
        with pytest.raises(ft.TranslateConfigError) as e:
            ft.read_credentials(env)
        assert str(e.value) == "E-TR-CONFIG" and FAKE_KEY not in str(e.value)
    assert ft.read_credentials({ft.KEY_ENV: "k" * 200, ft.REGION_ENV: "r"}) is not None


def test_tst_tr_01_no_key_does_not_translate(tmp_path: Path, fake_expat: None, fake_feed_db: list[str]) -> None:
    """TST-TR-01:鍵が無い(空の文字列を含む)ときは訳さず、要約に「翻訳なし(鍵なし)」。終了コードは 0。"""
    for extra in [{}, {ft.KEY_ENV: "", ft.REGION_ENV: ""}]:
        fake_feed_db.clear()
        summary = tmp_path / "summary.md"
        summary.write_text("")
        env = {"FEED_DB_URL": "postgresql://unused@localhost/unused", "GITHUB_STEP_SUMMARY": str(summary), **extra}
        code = cli_feed(["--config", write_feed_config(tmp_path)], env, connect=counting_connect(fake_feed_db),
                        send=never_send)
        assert code == 0
        assert len(fake_feed_db) == 2   # etag の読み出しと原文の書き込みだけ
        assert "翻訳なし(鍵なし)" in summary.read_text(encoding="utf-8")


def test_tst_tr_01_one_key_exits_2(tmp_path: Path, fake_expat: None, fake_feed_db: list[str]) -> None:
    """TST-TR-01:片方だけ・形の誤りは終了コード 2(E-TR-CONFIG)。原文は書いた後で、鍵の値は出さない。"""
    for env_keys in [{ft.KEY_ENV: FAKE_KEY}, {ft.REGION_ENV: FAKE_REGION, ft.KEY_ENV: ""},
                     {ft.KEY_ENV: FAKE_KEY + "\r\n", ft.REGION_ENV: FAKE_REGION}]:
        fake_feed_db.clear()
        out = io.StringIO()
        summary = tmp_path / "summary.md"
        summary.write_text("")
        env = {"FEED_DB_URL": "postgresql://unused@localhost/unused", "GITHUB_STEP_SUMMARY": str(summary),
               **env_keys}
        code = cli_feed(["--config", write_feed_config(tmp_path)], env, connect=counting_connect(fake_feed_db),
                        send=never_send, out=out)
        assert code == 2
        assert len(fake_feed_db) == 2
        text = out.getvalue() + summary.read_text(encoding="utf-8")
        assert "E-TR-CONFIG" in text and FAKE_KEY not in text and FAKE_REGION not in text


def test_tst_tr_01_dry_run_and_no_translate_send_nothing(tmp_path: Path, fake_expat: None,
                                                         fake_feed_db: list[str]) -> None:
    """TST-TR-01:鍵があっても、dry-run は DB にも Translator にもつながず、--no-translate は翻訳で何も送らない。"""
    def no_db(url: str, ca: str | None) -> Any:
        raise AssertionError("DB に接続した")

    summary = tmp_path / "summary.md"
    code = cli_feed(["--config", write_feed_config(tmp_path), "--dry-run"],
                    {**KEYS, "GITHUB_STEP_SUMMARY": str(summary)}, connect=no_db, send=never_send)
    assert code == 0
    assert "翻訳なし(dry-run)" in summary.read_text(encoding="utf-8")

    summary.write_text("")
    code = cli_feed(["--config", write_feed_config(tmp_path), "--no-translate"],
                    {**KEYS, "FEED_DB_URL": "postgresql://unused@localhost/unused",
                     "GITHUB_STEP_SUMMARY": str(summary)},
                    connect=counting_connect(fake_feed_db), send=never_send)
    assert code == 0
    assert len(fake_feed_db) == 2
    assert "翻訳なし(--no-translate)" in summary.read_text(encoding="utf-8")


def cli_feed(args: list[str], env: dict[str, str], connect: Any, send: Any,
             out: io.StringIO | None = None) -> int:
    from nodal_sync.__main__ import main
    return main(["feed", *args], env=env, out=out or io.StringIO(),
                feed_fetcher=FakeFeedFetcher(ok_results()), now=NOW, feed_connect=connect, translate_send=send)


# ---------------------------------------------------------------
# TST-TR-02 訳す行の選び方(DB を使わない部分)
# ---------------------------------------------------------------
def test_tst_tr_02_select_by_translate_kind() -> None:
    """TST-TR-02:title は title だけ、title+summary は両方。none・設定に無い取得先は数えて残す。順番は読んだ順。"""
    cfg = cfg_of(src("example-cloud"), src("example-status", translate="title"),
                 src("example-kev", translate="none"))
    rows = [prow("a", "example-cloud", summary="Fictional summary"),
            prow("b", "example-status", summary="Fictional summary"),
            prow("c", "example-kev"),
            prow("d", "removed-source"),
            prow("e", "example-cloud", summary="   ")]
    jobs, skipped = ft.select_jobs(rows, cfg)
    assert [j.row.id for j in jobs] == ["a", "b", "e"]
    assert [j.with_summary for j in jobs] == [True, False, False]
    assert [len(j.texts) for j in jobs] == [2, 1, 1]
    assert skipped == 2


def test_tst_tr_02_run_char_limit() -> None:
    """TST-TR-02:送る字数の合計が 30,000 字を超える手前で止める(その後の短い行も取らない)。"""
    cfg = cfg_of(src("example-cloud"), watch=())
    rows = [prow(f"r{i}", title="a" * 500, summary="b" * 2000, vendor="", product="") for i in range(40)]
    rows.append(prow("short", title="tiny", vendor="", product=""))
    jobs, _ = ft.select_jobs(rows, cfg)
    assert all(j.chars == 900 for j in jobs)        # title 500 + summary の先頭 400
    assert len(jobs) == 33 and sum(j.chars for j in jobs) == 29_700
    assert "short" not in [j.row.id for j in jobs]


# ---------------------------------------------------------------
# TST-TR-03 送る文字と印
# ---------------------------------------------------------------
def span(s: str) -> str:
    return f'<span class="notranslate">{s}</span>'


def test_tst_tr_03_marks() -> None:
    """TST-TR-03:CVE・KB・版・製品名を囲む。大文字・小文字を区別しない。前後が英数字なら版にしない。"""
    names = ft._names(("exampleguard", "samplekit"), prow("x", vendor="Example", product="Example Cloud"))
    assert names[0] == "Example Cloud"
    got = ft.mark("Fix CVE-2026-12345 and KB5031234 in EXAMPLEGUARD v1.2.3 (build abc1.2 / 10.0.1.2)", names)
    assert got == (f"Fix {span('CVE-2026-12345')} and {span('KB5031234')} in {span('EXAMPLEGUARD')} "
                   f"{span('v1.2.3')} (build abc1.2 / {span('10.0.1.2')})")
    assert ft.mark("CVE-2026-1234567 KB12345 x2.0", []) == f"{span('CVE-2026-1234567')} KB12345 x2.0"


def test_tst_tr_03_overlap_prefers_longer() -> None:
    """TST-TR-03:重なったら長いほうを1回だけ囲む(二重に囲まない)。長い製品名を先に当てる。"""
    names = ft._names(("samplekit 4.1", "samplekit"), prow("x", vendor="", product=""))
    assert ft.mark("Update SampleKit 4.1 and samplekit 5.0", names) == \
        f"Update {span('SampleKit 4.1')} and {span('samplekit')} {span('5.0')}"
    assert ft.mark("Example Cloud outage", ft._names((), prow("x"))) == f"{span('Example Cloud')} outage"


def test_tst_tr_03_escapes_html() -> None:
    """TST-TR-03:原文の <script>・&・引用符は実体参照になって送られる。製品名の中の & も escape する。"""
    got = ft.mark('<script>alert("x")</script> & \'AT&T\' 1.2', ["AT&T"])
    assert got == ("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; "
                   f"&#x27;{span('AT&amp;T')}&#x27; {span('1.2')}")
    assert "<script" not in got


def test_tst_tr_03_long_marked_text_is_sent_without_marks() -> None:
    """TST-TR-03:印で 1,000 字を超えたら印なし(escape だけ)。summary は原文の先頭 400 字。"""
    text = "CVE-2026-12345 " * 40
    assert len(ft.mark(text, [])) == len(text) and "span" not in ft.mark(text, [])
    job = ft.make_job(prow("x", title="T", summary="<" * 500, vendor="", product=""), True, ())
    assert job.texts == ["T", "&lt;" * 400]


# ---------------------------------------------------------------
# TST-TR-04 要求の組み方
# ---------------------------------------------------------------
def job_of(rid: str, *texts: str) -> ft.Job:
    return ft.Job(row=prow(rid), with_summary=len(texts) == 2, texts=list(texts))


def test_tst_tr_04_batches() -> None:
    """TST-TR-04:100 要素・50,000 字で分ける。1行の title と summary は別の要求に分けない。"""
    b = ft.make_batches([job_of(str(i), "t") for i in range(150)])
    assert [len(x) for x in b] == [100, 50]
    b = ft.make_batches([job_of(str(i), "t", "s") for i in range(51)])
    assert [sum(len(j.texts) for j in x) for x in b] == [100, 2]
    b = ft.make_batches([job_of(str(i), "x" * 1000) for i in range(60)])
    assert [sum(j.chars for j in x) for x in b] == [50_000, 10_000]
    assert ft.make_batches([]) == []


def test_tst_tr_04_headers_and_body() -> None:
    """TST-TR-04:ヘッダーは4つ(鍵・地域・Content-Type・要求ごとに違う X-ClientTraceId)。本文は Text の配列。"""
    send = FakeSend()
    t = ft.Translator(ft.Credentials(FAKE_KEY, FAKE_REGION), send)
    assert t.call(["a", "b"]).kind == "ok"
    assert t.call(["c"]).kind == "ok"
    (req1, h1), (req2, h2) = send.calls
    assert req1 == [{"Text": "a"}, {"Text": "b"}] and req2 == [{"Text": "c"}]
    assert set(h1) == {"Ocp-Apim-Subscription-Key", "Ocp-Apim-Subscription-Region", "Content-Type",
                       "X-ClientTraceId"}
    assert h1["Ocp-Apim-Subscription-Key"] == FAKE_KEY and h1["Ocp-Apim-Subscription-Region"] == FAKE_REGION
    assert h1["Content-Type"] == "application/json; charset=UTF-8"
    assert h1["X-ClientTraceId"] != h2["X-ClientTraceId"]


class FakeResp:
    def __init__(self, status: int, body: bytes = b"", headers: dict[str, str] | None = None) -> None:
        self.status = status
        self._body = body
        self._headers = headers or {}

    def getheader(self, name: str) -> str | None:
        for k, v in self._headers.items():
            if k.lower() == name.lower():
                return v
        return None

    def read1(self, n: int) -> bytes:
        b, self._body = self._body[:n], self._body[n:]
        return b


class FakeHttpConn:
    """http.client の接続の代わり。送った行を記録する。"""

    def __init__(self, resp: FakeResp) -> None:
        self.resp = resp
        self.lines: list[tuple[Any, ...]] = []
        self.closed = False

    def putrequest(self, method: str, url: str, skip_host: bool = False,
                   skip_accept_encoding: bool = False) -> None:
        self.lines.append(("request", method, url, skip_accept_encoding))

    def putheader(self, header: str, *values: str) -> None:
        self.lines.append(("header", header, *values))

    def endheaders(self, message_body: bytes | None = None, *, encode_chunked: bool = False) -> None:
        self.lines.append(("body", message_body))

    def getresponse(self) -> FakeResp:
        return self.resp

    def set_timeout(self, seconds: float) -> None:
        pass

    def abort(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


class NoTimer:
    def start(self) -> None:
        pass

    def cancel(self) -> None:
        pass


def sender_with(resp: FakeResp, conns: list[FakeHttpConn], max_bytes: int = ft.MAX_RESPONSE_BYTES) -> ft.HttpsSender:
    def connect(timeout: float) -> FakeHttpConn:
        assert timeout == ft.TIMEOUT_SECONDS
        c = FakeHttpConn(resp)
        conns.append(c)
        return c
    return ft.HttpsSender(connect=connect, timer=lambda s, fn: NoTimer(), max_bytes=max_bytes)


def test_tst_tr_04_sender_destination_and_no_accept_encoding() -> None:
    """TST-TR-04:宛先はコードの1つのホスト(443)。POST は固定の PATH、Accept-Encoding は送らない。"""
    c = ft.TranslatorConnection(5.0)   # 作るだけ(接続はしない)
    assert (c.host, c.port) == (ft.HOST, 443)
    assert ft.HOST == "api.cognitive.microsofttranslator.com"
    assert ft.PATH == "/translate?api-version=3.0&from=en&to=ja&textType=html"

    conns: list[FakeHttpConn] = []
    body = b'[{"translations":[{"text":"x","to":"ja"}]}]'
    reply = sender_with(FakeResp(200, body, {"X-metered-usage": "1"}), conns)(b"[]", {"A": "b"})
    assert (reply.status, reply.metered, reply.body) == (200, "1", body)
    lines = conns[0].lines
    assert lines[0] == ("request", "POST", ft.PATH, True)
    assert not any(ln[0] == "header" and ln[1].lower() == "accept-encoding" for ln in lines)
    assert ("header", "Content-Length", "2") in lines and lines[-1] == ("body", b"[]")
    assert conns[0].closed


def test_tst_tr_04_sender_redirect_and_size() -> None:
    """TST-TR-04:3xx は辿らずに返す(失敗に数える)。1 MB を超える応答は例外(番号 E-TR-OTHER になる)。"""
    conns: list[FakeHttpConn] = []
    r = sender_with(FakeResp(302, b"", {"Location": "https://elsewhere.example.com/"}), conns)(b"[]", {})
    assert r.status == 302 and len(conns) == 1
    t = ft.Translator(ft.Credentials(FAKE_KEY, FAKE_REGION),
                      sender_with(FakeResp(302, b"", {"Location": "https://elsewhere.example.com/"}), conns))
    assert t.call(["a"]).code == "E-TR-OTHER"

    big = sender_with(FakeResp(200, b"x" * 101), conns, max_bytes=100)
    with pytest.raises(ft._SendError):
        big(b"[]", {})
    big_len = sender_with(FakeResp(200, b"", {"Content-Length": "101"}), conns, max_bytes=100)
    with pytest.raises(ft._SendError):
        big_len(b"[]", {})
    t = ft.Translator(ft.Credentials(FAKE_KEY, FAKE_REGION), sender_with(FakeResp(200, b"x" * 101), conns, 100))
    assert t.call(["a"]).code == "E-TR-OTHER"


def test_tst_tr_04_sender_deadline() -> None:
    """TST-TR-04:1要求 20 秒を過ぎたら、読むのをやめて時間切れ(E-TR-OTHER)。watchdog には 20 秒を渡す。"""
    times = iter([0.0, 1.0, 25.0])
    timers: list[float] = []

    def timer(seconds: float, fn: Any) -> NoTimer:
        timers.append(seconds)
        return NoTimer()

    conns: list[FakeHttpConn] = []

    def connect(timeout: float) -> FakeHttpConn:
        c = FakeHttpConn(FakeResp(200, b"[]"))
        conns.append(c)
        return c

    s = ft.HttpsSender(connect=connect, clock=lambda: next(times), timer=timer)
    with pytest.raises(TimeoutError):
        s(b"[]", {})
    assert timers == [ft.TIMEOUT_SECONDS] and conns[0].closed


def test_tst_tr_04_key_not_in_summary_or_errors() -> None:
    """TST-TR-04:鍵は、例外の文・結果・要約に出ない(送る部品の例外に鍵が入っていても)。"""
    def leaky(body: bytes, headers: Any) -> ft.Reply:
        raise RuntimeError(f"failed with {headers['Ocp-Apim-Subscription-Key']}")

    r = ft.Translator(ft.Credentials(FAKE_KEY, FAKE_REGION), leaky).call(["a"])
    assert (r.kind, r.code) == ("other", "E-TR-OTHER") and FAKE_KEY not in repr(r)
    s = TranslateSummary(state="ran", stop="E-TR-AUTH", sent_chars=1)
    fs = FeedSummary(translate=s)
    assert FAKE_KEY not in fs.render() and "止まった理由 E-TR-AUTH" in fs.render()


# ---------------------------------------------------------------
# TST-TR-05 応答の検査と訳の整え方
# ---------------------------------------------------------------
def tr_body(*items: Any) -> bytes:
    return json.dumps(list(items)).encode("utf-8")


def ok_item(text: Any = "訳", to: Any = "ja") -> dict[str, Any]:
    return {"translations": [{"text": text, "to": to}]}


def test_tst_tr_05_response_check() -> None:
    """TST-TR-05:長さ違い・to が ja でない・text が文字列でない・形が違う → E-TR-RESPONSE。"""
    assert ft.parse_response(tr_body(ok_item("a"), ok_item("b")), 2) == ["a", "b"]
    for body, n in [(tr_body(ok_item()), 2), (tr_body(ok_item(), ok_item()), 1),
                    (tr_body(ok_item(to="en")), 1), (tr_body(ok_item(to=None)), 1),
                    (tr_body(ok_item(text=1)), 1), (tr_body(ok_item(text=None)), 1),
                    (tr_body({"translations": []}), 1), (tr_body({}), 1), (tr_body("x"), 1),
                    (b'{"translations": []}', 1), (b"not json", 1), (b"\xff", 1),
                    (b'[{"translations":[{"text":"a","text":"b","to":"ja"}]}]', 1)]:
        assert ft.parse_response(body, n) is None, body
        r = ft.Translator(ft.Credentials(FAKE_KEY, FAKE_REGION),
                          FakeSend(ft.Reply(200, "5", None, body))).call(["x"] * n)
        assert (r.kind, r.code, r.texts) == ("other", "E-TR-RESPONSE", None)
    # 圧縮された応答も検査の失敗
    r = ft.Translator(ft.Credentials(FAKE_KEY, FAKE_REGION),
                      FakeSend(ft.Reply(200, None, "gzip", tr_body(ok_item())))).call(["x"])
    assert r.code == "E-TR-RESPONSE"


def test_tst_tr_05_clean_translation() -> None:
    """TST-TR-05:訳のタグを除き、実体参照を戻し、制御文字(向きを変える文字を含む)を除く。"""
    raw = '<span class="notranslate">CVE-2026-12345</span> の修正\x07 &lt;script&gt;alert(1)&lt;/script&gt; &amp;‮'
    assert ft.clean_translation(raw, single_line=True) == "CVE-2026-12345 の修正 <script>alert(1)</script> &"
    assert ft.clean_translation("<b>太字</b><script>x()</script>本文", single_line=True) == "太字本文"
    assert ft.clean_translation("一行目<br>  二行目\n\n三行目", single_line=False) == "一行目\n二行目\n三行目"


def test_tst_tr_05_truncate() -> None:
    """TST-TR-05:title_ja は 1,000 字、summary_ja は 4,000 字で切る(0002 の CHECK)。title だけなら summary_ja は None。"""
    saves = ft.build_saves([job_of("a", "t", "s"), job_of("b", "t")], ["あ" * 1200, "い" * 5000, "う"])
    assert len(saves[0].title_ja) == 1000 and len(saves[0].summary_ja or "") == 4000
    assert (saves[1].title_ja, saves[1].summary_ja) == ("う", None)
    assert ft.parse_metered("123") == 123
    assert [ft.parse_metered(v) for v in (None, "", "-1", "1.5", "１２", "9999999999")] == [None] * 6


def test_tst_tr_07_month_start_is_jst() -> None:
    """TST-TR-07:月の境目は日本時間(UTC の 11/30 15:00 は日本時間の 12/1)。"""
    assert ft.month_start(dt.datetime(2026, 11, 30, 14, 59, tzinfo=UTC)) == dt.date(2026, 11, 1)
    assert ft.month_start(dt.datetime(2026, 11, 30, 15, 0, tzinfo=UTC)) == dt.date(2026, 12, 1)


# ---------------------------------------------------------------
# DB を使う試験(TST-TR-02・06〜09)
# ---------------------------------------------------------------
@pytest.fixture
def tr_db(db_urls: tuple[str, str]) -> str:
    """feed の3表を空にし、admin の URL を返す。"""
    import psycopg
    with psycopg.connect(db_urls[0], autocommit=True) as c:
        c.execute("delete from public.feed_entries")
        c.execute("delete from public.feed_source_state")
        c.execute("delete from public.feed_translate_usage")
    return db_urls[0]


def feed_conn(admin_url: str) -> Any:
    from test_feed_db import feed_conn as fc
    return fc(admin_url)


def put(admin_url: str, s: Source, *guids: str, hours: list[int] | None = None, **over: Any) -> list[str]:
    """架空の記事を書き、id を返す。hours があれば published_at を 2026-11-20 のその時刻にする。"""
    from test_feed_db import entry, write
    es = []
    for i, g in enumerate(guids):
        extra = dict(over)
        if hours is not None:
            extra["published_at"] = dt.datetime(2026, 11, 20, hours[i], 0, tzinfo=UTC)
        es.append(entry(s, g, **extra))
    write(admin_url, [SourceOutcome(source=s, entries=es)])
    return [e.id for e in es]


def run_tr(admin_url: str, cfg: FeedConfig, send: Any, now: dt.datetime = NOW) -> TranslateSummary:
    from nodal_sync import feeddb
    res = TranslateSummary()
    ft.run(feeddb, lambda: feed_conn(admin_url), cfg, ft.Credentials(FAKE_KEY, FAKE_REGION), send, now, res)
    return res


def usage(admin_sql: Any) -> list[tuple[Any, ...]]:
    return admin_sql("select month, chars, requests from public.feed_translate_usage order by month")


def test_tst_tr_02_read_targets(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-02:pending で回数が 3 未満の行だけを新しい順に読む。done・failed・skip・3 回の行は読まない。"""
    from nodal_sync import feeddb
    cloud = src("example-cloud")
    ids = put(tr_db, cloud, "old", "new", "mid", "done", "tries", hours=[1, 9, 5, 2, 3])
    put(tr_db, src("example-jvn", kind="outage", format="rss2", filter="all"), "ja")
    admin_sql("update public.feed_entries set translate_status = 'done', title_ja = 'x', translated_at = now() "
              "where id = %s", (ids[3],))
    admin_sql("update public.feed_entries set translate_attempts = 3 where id = %s", (ids[4],))
    c = feed_conn(tr_db)
    try:
        rows = feeddb.read_translate_targets(c, ft.MAX_ATTEMPTS)
    finally:
        c.close()
    assert [r.id for r in rows] == [ids[1], ids[2], ids[0]]
    assert rows[0].title == "Fictional title new" and rows[0].summary == "Fictional summary new"


def test_tst_tr_02_unknown_and_none_sources_stay_pending(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-02:none・設定から消えた取得先の行は訳さずに pending のまま。数えて要約に出す。"""
    cloud, status = src("example-cloud"), src("example-status")
    a = put(tr_db, cloud, "a")
    b = put(tr_db, status, "b")
    send = FakeSend()
    res = run_tr(tr_db, cfg_of(src("example-cloud", translate="none")), send)
    assert send.calls == [] and res.skipped == 2 and res.translated == 0 and res.pending == 2
    assert admin_sql("select translate_status from public.feed_entries where id in (%s, %s)", (a[0], b[0])) == [
        ("pending",), ("pending",)]
    res = run_tr(tr_db, cfg_of(cloud), send)
    assert res.translated == 1 and res.skipped == 1 and res.pending == 1


def test_tst_tr_06_save_done_and_usage(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-06:done になり、訳が入り、usage に X-metered-usage と要求 1 回が足される。title だけなら summary_ja は null。"""
    cloud, status = src("example-cloud"), src("example-status", translate="title")
    a = put(tr_db, cloud, "a")[0]
    b = put(tr_db, status, "b")[0]
    send = FakeSend(echo_reply(metered="77"))
    res = run_tr(tr_db, cfg_of(cloud, status, watch=()), send)
    assert len(send.calls) == 1 and len(send.calls[0][0]) == 3
    assert (res.translated, res.metered, res.month_chars, res.stop) == (2, 77, 77, None)
    assert res.sent_chars == sum(len(r["Text"]) for r in send.calls[0][0])
    got = dict((r[0], r[1:]) for r in admin_sql(
        "select id, translate_status, title_ja, summary_ja, translated_at is not null from public.feed_entries"))
    assert got[a] == ("done", "訳 Fictional title a", "訳 Fictional summary a", True)
    assert got[b] == ("done", "訳 Fictional title b", None, True)
    assert usage(admin_sql) == [(dt.date(2026, 11, 1), 77, 1)]

    # X-metered-usage が無い・数でないときは、送った字数を足す
    put(tr_db, cloud, "c")
    send = FakeSend(echo_reply(metered=None))
    res = run_tr(tr_db, cfg_of(cloud, watch=()), send)
    sent = sum(len(r["Text"]) for r in send.calls[0][0])
    assert res.metered == 0 and usage(admin_sql) == [(dt.date(2026, 11, 1), 77 + sent, 2)]


def test_tst_tr_06_changed_while_translating_stays_pending(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-06:訳している間に原文(title・summary)が変わった行は pending のまま。ほかの行は done。"""
    cloud = src("example-cloud")
    a, b, c = put(tr_db, cloud, "a", "b", "c")

    def change_then_reply(req: list[dict[str, str]]) -> ft.Reply:
        admin_sql("update public.feed_entries set title = 'Fictional changed' where id = %s", (a,))
        admin_sql("update public.feed_entries set summary = 'Fictional changed' where id = %s", (b,))
        return echo_reply()(req)

    res = run_tr(tr_db, cfg_of(cloud, watch=()), FakeSend(change_then_reply))
    assert res.translated == 1 and res.pending == 2
    got = dict(admin_sql("select id, translate_status from public.feed_entries"))
    assert (got[a], got[b], got[c]) == ("pending", "pending", "done")
    assert admin_sql("select title_ja from public.feed_entries where id = %s", (a,)) == [(None,)]


def test_tst_tr_06_marks_are_removed_from_saved_text(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-06・03:送った文字は escape と印つき、保存した訳は印が除かれ、原文の < は文字として戻る。"""
    cloud = src("example-cloud")
    a = put(tr_db, cloud, "a", title="Fix <b> in CVE-2026-12345", summary="")[0]
    send = FakeSend()
    run_tr(tr_db, cfg_of(cloud, watch=()), send)
    assert send.calls[0][0] == [{"Text": f"Fix &lt;b&gt; in {span('CVE-2026-12345')}"}]
    assert admin_sql("select title_ja, summary_ja from public.feed_entries where id = %s", (a,)) == [
        ("訳 Fix <b> in CVE-2026-12345", None)]


def test_tst_tr_07_month_limit_before(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-07:今月の chars が 1,500,000 以上なら送らない(要約に「月の上限」)。前の月の量は数えない。"""
    cloud = src("example-cloud")
    put(tr_db, cloud, "a")
    admin_sql("insert into public.feed_translate_usage (month, chars, requests) values ('2026-11-01', 1500000, 9)")
    send = FakeSend()
    res = run_tr(tr_db, cfg_of(cloud), send)
    assert send.calls == [] and res.stop == "月の上限" and res.translated == 0
    assert "止まった理由 月の上限" in res.render()
    # 日本時間で 12 月に入ると、11 月の量は数えず、12 月の行に足す
    res = run_tr(tr_db, cfg_of(cloud), send, now=dt.datetime(2026, 11, 30, 15, 0, tzinfo=UTC))
    assert len(send.calls) == 1 and res.translated == 1
    assert [r[0] for r in usage(admin_sql)] == [dt.date(2026, 11, 1), dt.date(2026, 12, 1)]


def test_tst_tr_07_month_limit_during_run(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-07:足した後に上限を超えたら、そこで止める(次の要求を送らない)。"""
    cloud = src("example-cloud", translate="title")
    put(tr_db, cloud, *[f"g{i}" for i in range(101)])   # 101 行 → 2 要求
    admin_sql("insert into public.feed_translate_usage (month, chars, requests) values ('2026-11-01', 1499990, 1)")
    send = FakeSend(echo_reply(metered="20"))
    res = run_tr(tr_db, cfg_of(cloud, watch=()), send)
    assert len(send.calls) == 1 and res.translated == 100 and res.stop == "月の上限"
    assert res.month_chars == 1_500_010 and res.pending == 1


def test_tst_tr_08_quota_keeps_pending(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-08:429・403 はその回をやめ、行は pending のまま・回数は足さない。usage も足さない。"""
    cloud = src("example-cloud", translate="title")
    put(tr_db, cloud, *[f"g{i}" for i in range(101)])
    for status in (429, 403):
        send = FakeSend(ft.Reply(status))
        res = run_tr(tr_db, cfg_of(cloud), send)
        assert len(send.calls) == 1 and res.stop == "E-TR-QUOTA" and res.exit_code == 0
        assert admin_sql("select distinct translate_status, translate_attempts from public.feed_entries") == [
            ("pending", 0)]
    assert usage(admin_sql) == []


def test_tst_tr_08_auth_exit_1(tr_db: str, admin_sql: Any, tmp_path: Path, fake_expat: None) -> None:
    """TST-TR-08:401 はその回をやめて終了コード 1(原文は保存済み)。鍵は要約・ログに出ない。"""
    out = io.StringIO()
    summary = tmp_path / "summary.md"
    env = {"FEED_DB_URL": "postgresql://unused@localhost/unused", "GITHUB_STEP_SUMMARY": str(summary), **KEYS}
    send = FakeSend(ft.Reply(401))
    code = cli_feed(["--config", write_feed_config(tmp_path, ["example-status"])], env,
                    connect=lambda url, ca: feed_conn(tr_db), send=send, out=out)
    assert code == 1 and len(send.calls) == 1
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    assert "E-TR-AUTH" in text and FAKE_KEY not in text and FAKE_REGION not in text
    assert admin_sql("select count(*) from public.feed_entries") == [(2,)]
    assert admin_sql("select distinct translate_status, translate_attempts from public.feed_entries") == [
        ("pending", 0)]


def test_tst_tr_08_other_failures_count_up_to_failed(tr_db: str, admin_sql: Any) -> None:
    """TST-TR-08:400・408・5xx・時間切れ・3xx・応答の検査の失敗は回数を 1 足し、3 回目で failed。次の要求は続ける。"""
    cloud = src("example-cloud", translate="title")
    a = put(tr_db, cloud, "a")[0]
    for i, r in enumerate([ft.Reply(500), TimeoutError(), ft.Reply(200, "3", None, b"[]")]):
        res = run_tr(tr_db, cfg_of(cloud), FakeSend(r))
        expect = ("failed", 3) if i == 2 else ("pending", i + 1)
        assert admin_sql("select translate_status, translate_attempts from public.feed_entries where id = %s",
                         (a,)) == [expect]
        assert res.exit_code == 0 and res.translated == 0
    assert res.failed == 1 and res.other == {"E-TR-RESPONSE": 1}
    # usage に足すのは保存したときだけ(3.13.5)
    assert usage(admin_sql) == []
    # failed の行はもう読まない
    send = FakeSend()
    run_tr(tr_db, cfg_of(cloud), send)
    assert send.calls == []

    for status in (400, 408, 302, 502):
        admin_sql("delete from public.feed_entries")
        put(tr_db, cloud, "b")
        res = run_tr(tr_db, cfg_of(cloud), FakeSend(ft.Reply(status)))
        assert res.other == {"E-TR-OTHER": 1}
        assert admin_sql("select translate_attempts from public.feed_entries") == [(1,)]


def test_tst_tr_09_all_failures_keep_originals(tr_db: str, admin_sql: Any, tmp_path: Path,
                                              fake_expat: None) -> None:
    """TST-TR-09:翻訳が全部失敗しても、原文は保存されている。通信の失敗では終了コードは変わらず、DB の失敗では 1。"""
    env = {"FEED_DB_URL": "postgresql://unused@localhost/unused", **KEYS}
    summary = tmp_path / "summary.md"
    code = cli_feed(["--config", write_feed_config(tmp_path, ["example-status", "example-cloud"])],
                    {**env, "GITHUB_STEP_SUMMARY": str(summary)},
                    connect=lambda url, ca: feed_conn(tr_db), send=FakeSend(OSError("fictional")))
    assert code == 0
    assert admin_sql("select count(*) from public.feed_entries") == [(4,)]
    assert admin_sql("select distinct translate_status, translate_attempts from public.feed_entries") == [
        ("pending", 1)]
    assert "失敗した要求 E-TR-OTHER 1" in summary.read_text(encoding="utf-8")

    # 翻訳の接続(3 回目)で DB が使えなくても、原文の保存はそのまま。終了コードは 1
    admin_sql("delete from public.feed_entries")
    admin_sql("delete from public.feed_source_state")
    calls: list[int] = []

    def third_fails(url: str, ca: str | None) -> Any:
        from nodal_sync import db
        calls.append(1)
        if len(calls) == 3:
            raise db.DbError("E-DB-CONNECT")
        return feed_conn(tr_db)

    summary.write_text("")
    out = io.StringIO()
    code = cli_feed(["--config", write_feed_config(tmp_path, ["example-status"])],
                    {**env, "GITHUB_STEP_SUMMARY": str(summary)}, connect=third_fails, send=never_send, out=out)
    assert code == 1 and len(calls) == 3
    assert admin_sql("select count(*) from public.feed_entries") == [(2,)]
    assert "止まった理由 E-DB-CONNECT" in summary.read_text(encoding="utf-8")
    assert "E-DB-CONNECT" in out.getvalue()


def test_tst_tr_09_db_error_on_save_exits_1(tr_db: str, admin_sql: Any, tmp_path: Path, fake_expat: None,
                                           monkeypatch: pytest.MonkeyPatch) -> None:
    """TST-TR-09:訳の保存で DB が失敗したら、そこで止めて終了コード 1。原文の行は保存されていて pending のまま。"""
    from nodal_sync import db, feeddb

    def broken_save(*a: Any, **k: Any) -> Any:
        raise db.DbError("E-DB-WRITE")

    monkeypatch.setattr(feeddb, "save_translations", broken_save)
    out = io.StringIO()
    summary = tmp_path / "summary.md"
    send = FakeSend()
    code = cli_feed(["--config", write_feed_config(tmp_path, ["example-status", "example-cloud"])],
                    {"FEED_DB_URL": "postgresql://unused@localhost/unused", "GITHUB_STEP_SUMMARY": str(summary),
                     **KEYS},
                    connect=lambda url, ca: feed_conn(tr_db), send=send, out=out)
    assert code == 1 and len(send.calls) == 1
    assert admin_sql("select count(*) from public.feed_entries") == [(4,)]
    assert admin_sql("select distinct translate_status, translate_attempts, title_ja from public.feed_entries") == [
        ("pending", 0, None)]
    assert usage(admin_sql) == []
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    assert "止まった理由 E-DB-WRITE" in text and FAKE_KEY not in text
    assert "E-DB-WRITE" in out.getvalue() and "postgresql://" not in text


class FailingStore:
    """メモリの中の偽の DB。fail_on に名前を入れた操作で DbError にする(DB を使わずに止まり方を確かめる)。"""

    class DbError(Exception):
        def __init__(self, code: str) -> None:
            super().__init__(code)
            self.code = code

    def __init__(self, fail_on: str, rows: list[ft.PendingRow]) -> None:
        self.fail_on = fail_on
        self.rows = rows

    def _maybe(self, name: str, code: str) -> None:
        if name == self.fail_on:
            raise self.DbError(code)

    def read_usage(self, conn: Any, month: dt.date) -> int:
        self._maybe("read_usage", "E-DB-READ")
        return 0

    def read_translate_targets(self, conn: Any, mx: int) -> list[ft.PendingRow]:
        self._maybe("read_translate_targets", "E-DB-READ")
        return self.rows

    def save_translations(self, conn: Any, saves: list[ft.Save], month: dt.date, chars: int) -> tuple[int, int]:
        self._maybe("save_translations", "E-DB-WRITE")
        return len(saves), chars

    def record_failures(self, conn: Any, ids: list[str], mx: int) -> int:
        self._maybe("record_failures", "E-DB-WRITE")
        return 0

    def count_pending(self, conn: Any) -> int:
        self._maybe("count_pending", "E-DB-READ")
        return 0


def test_tst_tr_09_db_errors_stop_with_exit_1() -> None:
    """TST-TR-09:翻訳の途中の DB の失敗(接続・読み出し・保存・失敗の記録)は、そこで止めて終了コード 1。次の要求は送らない。"""
    cfg = cfg_of(src("example-cloud", translate="title"))
    rows = [prow(f"r{i}") for i in range(150)]   # 2 要求になる
    cases = [("connect", "E-DB-CONNECT", 0, ft.Reply(200)), ("read_usage", "E-DB-READ", 0, None),
             ("read_translate_targets", "E-DB-READ", 0, None), ("save_translations", "E-DB-WRITE", 1, None),
             ("record_failures", "E-DB-WRITE", 1, ft.Reply(500)), ("count_pending", "E-DB-READ", 2, None)]
    for fail_on, code, sends, reply in cases:
        store = FailingStore(fail_on, rows)
        conns: list[FakeConn] = []

        def open_conn() -> FakeConn:
            if fail_on == "connect":
                raise store.DbError("E-DB-CONNECT")
            conns.append(FakeConn())
            return conns[-1]

        send = FakeSend(reply) if reply is not None else FakeSend()
        res = TranslateSummary()
        ft.run(store, open_conn, cfg, ft.Credentials(FAKE_KEY, FAKE_REGION), send, NOW, res)
        assert (res.stop, res.exit_code, len(send.calls)) == (code, 1, sends), fail_on
        assert all(c.closed for c in conns), fail_on   # 失敗しても接続は閉じる
    # 通信の失敗だけなら終了コードは変えない
    res = TranslateSummary()
    ft.run(FailingStore("", rows), FakeConn, cfg, ft.Credentials(FAKE_KEY, FAKE_REGION),
           FakeSend(ft.Reply(503)), NOW, res)
    assert (res.stop, res.exit_code) == (None, 0)
