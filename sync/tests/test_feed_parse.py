"""公式フィードの解析と検査の試験。TST-FEED-02〜09。見本は tests/data/feed/ の架空の値だけ。"""

from __future__ import annotations

import datetime as dt
import json
import pyexpat
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from nodal_sync import feedparse
from nodal_sync.feedconfig import Source
from nodal_sync.feedparse import Entry, entry_id, parse_feed

DATA = Path(__file__).resolve().parent / "data" / "feed"
NOW = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)
UTC = dt.timezone.utc
WATCH = ("exampleguard", "samplekit")


def src(**over: Any) -> Source:
    base: dict[str, Any] = dict(id="example-status", kind="outage", vendor="Example", product="Example Cloud",
                                format="atom", url="https://status.example.com/history.atom", lang="en",
                                translate="title+summary", filter="all", enabled=True)
    base.update(over)
    return Source(**base)


def data(name: str) -> bytes:
    return (DATA / name).read_bytes()


def by_title(entries: list[Entry]) -> dict[str, Entry]:
    return {e.title: e for e in entries}


# ---------------------------------------------------------------
# TST-FEED-02:形ごとの読み方
# ---------------------------------------------------------------
def test_tst_feed_02_atom_statuspage() -> None:
    """TST-FEED-02:Atom の id・title・link(alternate か rel なし)・content・published/updated。"""
    s = src(filter="statuspage-incident")
    res = parse_feed(s, data("statuspage.atom"), WATCH, NOW)
    assert res.error is None and res.read == 3 and res.filtered == 1 and not res.invalid
    e = by_title(res.entries)
    a = e["Fictional delays in the sample service"]
    assert a.id == entry_id("example-status", "tag:status.example.com,2005:Incident/1001")
    assert a.url == "https://status.example.com/incidents/1001"
    assert a.summary == ("Resolved - This fictional incident has been resolved.\n"
                         "Investigating - We are looking into fictional delays.")
    assert a.published_at == dt.datetime(2026, 11, 20, 9, 0, tzinfo=UTC)
    assert a.status == "復旧済み"
    assert (a.vendor, a.product, a.cve_ids, a.severity, a.cvss, a.exploited) == (
        "Example", "Example Cloud", [], None, None, False)
    b = e["Fictional errors & retries"]   # title type="html" のタグと実体参照が除かれる
    assert b.url is None                  # http の link はリンクにしない(記事は残す)
    assert b.summary == "Monitoring - A fictional fix has been applied."   # content が無ければ summary
    assert b.published_at == dt.datetime(2026, 11, 18, 3, 0, tzinfo=UTC)   # published が無ければ updated
    assert b.status == "監視中"


def test_tst_feed_02_rss2() -> None:
    """TST-FEED-02:RSS 2.0 の guid(無ければ link)・title・link・description・pubDate。"""
    res = parse_feed(src(format="rss2"), data("status.rss"), WATCH, NOW)
    assert res.error is None and len(res.entries) == 2
    a, b = res.entries
    assert a.id == entry_id("example-status", "https://cloud.example.com/status#a1")
    assert a.title == "Fictional service issue in Region A"
    assert a.url == "https://cloud.example.com/status/a1"
    assert a.summary == "Fictional latency & errors."
    assert a.published_at == dt.datetime(2026, 11, 20, 8, 30, tzinfo=UTC)
    assert a.status == ""  # statuspage の filter でなければ status は空
    assert b.id == entry_id("example-status", "https://cloud.example.com/status/a2")
    assert b.published_at is None  # 読めない日付


def test_tst_feed_02_rss1_jvn() -> None:
    """TST-FEED-02:RSS 1.0 の rdf:about・title・link・description・dc:date と、JVN の sec:cvss。"""
    s = src(id="jvn-new", kind="vuln", format="rss1", lang="ja", translate="none", filter="all",
            vendor="JVN", product="JVN iPedia")
    res = parse_feed(s, data("jvn.rdf"), WATCH, NOW)
    assert res.error is None and len(res.entries) == 2
    a, b = res.entries
    assert a.id == entry_id("jvn-new", "https://jvndb.example.jp/JVNDB-2026-900001")
    assert a.title == "架空製品 ExampleGuard における認証回避の脆弱性"
    assert a.url == "https://jvndb.example.jp/JVNDB-2026-900001"
    assert a.published_at == dt.datetime(2026, 11, 19, 1, 0, tzinfo=UTC)
    assert a.cve_ids == ["CVE-2026-90001"]
    assert (a.cvss, a.severity) == (Decimal("9.8"), "critical")  # score の最大値と、その severity
    assert a.exploited is False
    assert b.cve_ids == ["CVE-2026-90002"]  # 小文字の cve- も大文字にそろえて拾う
    assert (b.cvss, b.severity) == (Decimal("5.3"), "medium")


def test_tst_feed_02_kev_json() -> None:
    """TST-FEED-02:KEV の cveID・title の組み立て・NVD の URL・dateAdded・vendor/product・exploited。"""
    s = src(id="cisa-kev", kind="vuln", format="kev-json", filter="kev", vendor="CISA", product="KEV")
    res = parse_feed(s, data("kev.json"), WATCH, NOW)
    assert res.error is None and res.invalid == {"E-ITEM-CVE": 1}
    a = res.entries[0]
    assert a.id == entry_id("cisa-kev", "CVE-2026-90001")
    assert a.title == "ExampleVendor ExampleGuard: ExampleGuard Fictional Authentication Bypass"
    assert a.url == "https://nvd.nist.gov/vuln/detail/CVE-2026-90001"
    assert a.summary == "Fictional authentication bypass in a sample product."
    assert a.published_at == dt.datetime(2026, 11, 19, tzinfo=UTC)
    assert (a.vendor, a.product) == ("ExampleVendor", "ExampleGuard")
    assert (a.exploited, a.severity, a.cvss, a.cve_ids) == (True, None, None, ["CVE-2026-90001"])
    # 古い記事は解析では残り、split_old で外れる(3.6)
    keep, old = feedparse.split_old(res.entries, 14, NOW)
    assert old == 1 and [e.cve_ids for e in keep] == [["CVE-2026-90001"]]


def test_tst_feed_02_wrong_shape() -> None:
    """形の違うもの(rss と言って Atom・KEV でない JSON)は、その取得先の失敗。"""
    assert parse_feed(src(format="rss2"), data("statuspage.atom"), WATCH, NOW).error == "E-PARSE-SHAPE"
    assert parse_feed(src(format="rss1"), data("status.rss"), WATCH, NOW).error == "E-PARSE-SHAPE"
    kev = src(kind="vuln", format="kev-json", filter="kev")
    assert parse_feed(kev, b'{"x": []}', WATCH, NOW).error == "E-PARSE-SHAPE"
    assert parse_feed(kev, b"{not json", WATCH, NOW).error == "E-PARSE-JSON"
    assert parse_feed(kev, b'{"a": 1, "a": 2}', WATCH, NOW).error == "E-PARSE-JSON"
    assert parse_feed(src(), b"<feed", WATCH, NOW).error == "E-PARSE-XML"
    assert parse_feed(src(), b"<feed>&undefined;</feed>", WATCH, NOW).error == "E-PARSE-XML"


# ---------------------------------------------------------------
# TST-FEED-03:DOCTYPE・ENTITY
# ---------------------------------------------------------------
BILLION_LAUGHS = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<rss version="2.0"><channel><item><title>&lol3;</title><guid>g</guid></item></channel></rss>"""


@pytest.mark.parametrize("body", [
    BILLION_LAUGHS,
    b'<?xml version="1.0"?><!DOCTYPE rss SYSTEM "https://evil.example.com/x.dtd"><rss/>',
    b'<?xml version="1.0"?><!doctype rss><rss version="2.0"><channel/></rss>',
    b'<rss version="2.0"><channel/></rss>' + b" " * 8192 + b"<!-- <!EnTiTy x 'y'> -->",
], ids=["billion-laughs", "external-dtd", "lowercase", "after-4kb"])
def test_tst_feed_03_dtd_is_rejected(body: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    """TST-FEED-03:DOCTYPE・ENTITY を含む XML は、解析せずに E-PARSE-DTD(先頭 4 KB の後でも)。"""
    called: list[bytes] = []
    real = feedparse.ET.fromstring

    def spy(b: bytes) -> Any:
        called.append(b)
        return real(b)

    monkeypatch.setattr(feedparse.ET, "fromstring", spy)
    for fmt in ("rss2", "atom", "rss1"):
        assert parse_feed(src(format=fmt), body, WATCH, NOW).error == "E-PARSE-DTD"
    assert called == []


@pytest.mark.parametrize("body", [
    '<?xml version="1.0" encoding="UTF-16"?><rss version="2.0"/>'.encode("utf-16"),
    b'<?xml version="1.0" encoding="UTF-7"?><rss version="2.0"/>',
    b'<?xml version="1.0" encoding="cp037"?><rss version="2.0"/>',
], ids=["utf-16", "utf-7", "ebcdic"])
def test_tst_feed_03_non_ascii_compatible_encoding(body: bytes) -> None:
    """TST-FEED-03:DOCTYPE の検査がすり抜けうる文字コード(UTF-16・UTF-7・EBCDIC)は読まない。"""
    assert parse_feed(src(format="rss2"), body, WATCH, NOW).error == "E-PARSE-XML"


# ---------------------------------------------------------------
# TST-FEED-04:Expat の版(終了コード 2 は test_feed_main)
# ---------------------------------------------------------------
@pytest.mark.parametrize("version,ok", [
    ("expat_2.7.2", True), ("expat_2.7.10", True), ("expat_3.0.0", True),
    ("expat_2.7.1", False), ("expat_2.6.4", False), ("expat_1.95.8", False), ("unknown", False),
])
def test_tst_feed_04_expat_version_rule(version: str, ok: bool) -> None:
    """TST-FEED-04:2.7.2 以上だけを通す(読めない版は通さない)。"""
    assert feedparse.expat_ok(version) is ok


def test_tst_feed_04_this_python_has_expat_2_7_2() -> None:
    """TST-FEED-04:今の Python の pyexpat.EXPAT_VERSION が 2.7.2 以上(CI と本番のワークフローの Python)。

    GitHub Actions(CI=true)では必ず確かめる。それ以外(開発の VM の OS の Python など)で古いときは skip にする。
    """
    import os
    in_ci = os.environ.get("CI") == "true" or os.environ.get("NODAL_REQUIRE_DB") == "1"
    if not feedparse.expat_ok(pyexpat.EXPAT_VERSION) and not in_ci:
        pytest.skip(f"この Python の Expat は {pyexpat.EXPAT_VERSION}(CI で確かめる)")
    assert feedparse.expat_ok(pyexpat.EXPAT_VERSION), pyexpat.EXPAT_VERSION
    assert feedparse.expat_version() == pyexpat.EXPAT_VERSION


# ---------------------------------------------------------------
# TST-FEED-05・06:文字・URL・日付
# ---------------------------------------------------------------
def rss_item(title: str = "t", link: str = "https://news.example.com/a", desc: str = "d",
             pub: str = "Fri, 20 Nov 2026 08:30:00 GMT", guid: str | None = "g1") -> bytes:
    g = f"<guid>{guid}</guid>" if guid is not None else ""
    return (f'<rss version="2.0"><channel><item><title>{title}</title><link>{link}</link>'
            f"<description>{desc}</description><pubDate>{pub}</pubDate>{g}</item></channel></rss>").encode()


def one(body: bytes, **over: Any) -> Entry:
    res = parse_feed(src(**{"format": "rss2", **over}), body, WATCH, NOW)
    assert res.error is None and len(res.entries) == 1, (res.error, res.invalid)
    return res.entries[0]


def test_tst_feed_05_tags_entities_control_chars() -> None:
    """TST-FEED-05:タグ・実体参照・制御文字が除かれ、空白がまとまる。script の中身は残らない。"""
    # XML 1.0 は制御文字をそのまま持てないので、HTML の実体参照(&#x7; など)として入れる
    e = one(rss_item(title="&lt;b&gt;Bold&lt;/b&gt;  &amp;amp;\t title&amp;#x7;",
                     desc="&lt;p&gt;line1&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;p&gt;line2  x&lt;/p&gt;"
                          "&amp;#x1b;[31m"))
    assert e.title == "Bold & title"
    assert e.summary == "line1\nline2 x[31m"
    assert "\x1b" not in e.summary and "alert" not in e.summary
    # 文字そのものの制御文字・対になっていないサロゲートも除く(改行・タブは空白の扱い)
    assert feedparse.clean_text("a\x07b\x1bc\ud800d\x00e\r\nf", single_line=True) == "abcde f"
    assert feedparse.clean_text("a\x07b\n\n\tc", single_line=False) == "ab\nc"
    # 文字の向きを変える制御文字(見た目の偽装)も除く。URL に入っていればリンクにしない
    assert feedparse.clean_text("abc\u202edef\u2066g", single_line=True) == "abcdefg"
    assert feedparse.clean_url("https://news.example.com/\u202egpj.exe") is None


def test_tst_feed_05_lengths() -> None:
    """TST-FEED-05:title は 500 字、summary は 2,000 字で切る(0002 の CHECK)。"""
    e = one(rss_item(title="あ" * 600, desc="い" * 2500))
    assert e.title == "あ" * 500 and e.summary == "い" * 2000


@pytest.mark.parametrize("link,want", [
    ("https://news.example.com/a?x=1&amp;y=2", "https://news.example.com/a?x=1&y=2"),
    ("http://news.example.com/a", None),
    ("javascript:alert(1)", None),
    ("data:text/html,x", None),
    ("https://news.example.com/a b", None),
    ("https://", None),
    ("https://news.example.com/" + "a" * 2000, None),
    ("", None),
])
def test_tst_feed_05_url(link: str, want: str | None) -> None:
    """TST-FEED-05:https で 2,000 字以内のときだけ url に入れる。それ以外は null で、記事は残す。"""
    assert one(rss_item(link=link, guid="g1")).url == want


@pytest.mark.parametrize("pub,want", [
    ("Fri, 20 Nov 2026 08:30:00 +0900", dt.datetime(2026, 11, 19, 23, 30, tzinfo=UTC)),
    ("Fri, 20 Nov 2026 08:30:00 -0000", dt.datetime(2026, 11, 20, 8, 30, tzinfo=UTC)),
    ("Sat, 21 Nov 2026 11:00:00 GMT", dt.datetime(2026, 11, 21, 11, 0, tzinfo=UTC)),  # 1 日以内の先は残す
    ("Sun, 22 Nov 2026 13:00:00 GMT", None),   # 1 日を超えて先
    ("2026-11-20", None),                      # RFC 822 でない
    ("Fri, 99 Nov 2026 08:30:00 GMT", None),
    ("", None),
])
def test_tst_feed_06_rss2_dates(pub: str, want: dt.datetime | None) -> None:
    """TST-FEED-06:読めない・未来(今より 1 日を超えて先)の公開日は null。"""
    assert one(rss_item(pub=pub)).published_at == want


def test_tst_feed_06_iso_and_kev_dates() -> None:
    """TST-FEED-06:ISO 8601(Atom・dc:date)と KEV の日付。"""
    assert feedparse.parse_iso("2026-11-20T01:02:03Z", NOW) == dt.datetime(2026, 11, 20, 1, 2, 3, tzinfo=UTC)
    assert feedparse.parse_iso("2026-11-20", NOW) == dt.datetime(2026, 11, 20, tzinfo=UTC)
    assert feedparse.parse_iso("2030-01-01T00:00:00Z", NOW) is None
    assert feedparse.parse_iso("yesterday", NOW) is None
    assert feedparse.parse_day("2026-11-19", NOW) == dt.datetime(2026, 11, 19, tzinfo=UTC)
    assert feedparse.parse_day("2026-02-30", NOW) is None
    assert feedparse.parse_day("2027-01-01", NOW) is None
    assert feedparse.parse_day(20261119, NOW) is None


# ---------------------------------------------------------------
# TST-FEED-07:CVE と JVN の CVSS
# ---------------------------------------------------------------
def test_tst_feed_07_cve_extraction() -> None:
    """TST-FEED-07:重複を除き、大文字にそろえ、4〜7 桁だけ、50 個まで。"""
    text = ("CVE-2026-1234 cve-2026-1234 CVE-2026-1234567 CVE-2026-12345678 CVE-2026-123 "
            "XCVE-2026-5555 CVE-26-1234 CVE-2026-7777.")
    assert feedparse.find_cves([text]) == ["CVE-2026-1234", "CVE-2026-1234567", "CVE-2026-7777"]
    many = " ".join(f"CVE-2026-{10000 + i}" for i in range(60))
    got = feedparse.find_cves([many])
    assert len(got) == 50 and got[0] == "CVE-2026-10000" and got[-1] == "CVE-2026-10049"
    # 脆弱性でない取得先では CVE を拾わない(0002 の feed_vuln_only)
    e = one(rss_item(title="Fictional CVE-2026-1111 note"))
    assert e.cve_ids == []
    e = one(rss_item(title="Fictional CVE-2026-1111 note"), kind="vuln")
    assert e.cve_ids == ["CVE-2026-1111"] and e.cvss is None and e.severity is None


def jvn_item(cvss: str, title: str = "t", desc: str = "d") -> bytes:
    return ('<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
            'xmlns:sec="http://jvn.jp/rss/mod_sec/3.0/">'
            f'<item rdf:about="https://jvndb.example.jp/X"><title>{title}</title><link>https://jvndb.example.jp/X</link>'
            f"<description>{desc}</description>{cvss}</item></rdf:RDF>").encode()


def test_tst_feed_07_kev_cve_ids_is_only_cve_id() -> None:
    """TST-FEED-07:KEV の cve_ids は [cveID](大文字にそろえる)だけ。本文・題に書かれた CVE は拾わない。"""
    kev = {"vulnerabilities": [{
        "cveID": "cve-2026-90011", "vendorProject": "V", "product": "P",
        "vulnerabilityName": "Fictional issue related to CVE-2026-90013",
        "shortDescription": "Fictional chain with CVE-2026-90012.", "dateAdded": "2026-11-19"}]}
    res = parse_feed(src(id="example-kev", kind="vuln", format="kev-json", filter="kev"),
                     json.dumps(kev).encode(), WATCH, NOW)
    e = res.entries[0]
    assert e.cve_ids == ["CVE-2026-90011"]
    assert e.id == entry_id("example-kev", "CVE-2026-90011")
    assert e.url == "https://nvd.nist.gov/vuln/detail/CVE-2026-90011"


REF = ('<sec:references source="NVD" id="CVE-2026-90021">'
       "https://nvd.example.org/vuln/detail/CVE-2026-90021</sec:references>")


@pytest.mark.parametrize("extra,want", [
    (REF, ["CVE-2026-90021"]),                                                   # 参照があれば参照だけ
    (REF + '<sec:references source="CVE" id="CVE-2026-90024"/>', ["CVE-2026-90021", "CVE-2026-90024"]),
    ("", ["CVE-2026-90022", "CVE-2026-90023"]),                                  # 参照が無ければ題と本文
    ("<sec:identifier>JVNDB-2026-900009 CVE-2026-90025</sec:identifier>",
     ["CVE-2026-90022", "CVE-2026-90023"]),                                     # 参照でない要素は使わない
], ids=["refs", "two-refs", "no-refs", "identifier-only"])
def test_tst_feed_07_jvn_cves_from_references(extra: str, want: list[str]) -> None:
    """TST-FEED-07:JVN の cve_ids は sec:references の CVE。無いときだけ title と summary から拾う。"""
    e = one(jvn_item(extra, title="Fictional CVE-2026-90022 note", desc="Mentions CVE-2026-90023."),
            format="rss1", kind="vuln")
    assert e.cve_ids == want


@pytest.mark.parametrize("cvss,want", [
    ('<sec:cvss score="4.0" severity="Medium"/><sec:cvss score="10.0" severity="CRITICAL"/>',
     (Decimal("10.0"), "critical")),
    ('<sec:cvss score="9.0" severity="Emergency"/>', (Decimal("9.0"), None)),
    ('<sec:cvss score="11" severity="High"/>', (None, None)),
    ('<sec:cvss score="NaN" severity="High"/>', (None, None)),
    ('<sec:cvss severity="High"/>', (None, None)),
    ("", (None, None)),
])
def test_tst_feed_07_jvn_cvss(cvss: str, want: tuple[Decimal | None, str | None]) -> None:
    """TST-FEED-07:sec:cvss の score の最大値を cvss、その severity を小文字で(4種類以外は null)。"""
    e = one(jvn_item(cvss), format="rss1", kind="vuln")
    assert (e.cvss, e.severity) == want


# ---------------------------------------------------------------
# TST-FEED-08:filter
# ---------------------------------------------------------------
def test_tst_feed_08_filters() -> None:
    """TST-FEED-08:filter の5種類。statuspage の計画メンテナンスが外れる。"""
    pf = feedparse.passes_filter
    assert pf("all", "x", "THIS IS A SCHEDULED EVENT", None, WATCH)
    assert pf("kev", "x", "y", None, WATCH)
    assert not pf("statuspage-incident", "x", "Scheduled - This Is A Scheduled Event.", None, WATCH)
    assert pf("statuspage-incident", "x", "Resolved - fixed.", None, WATCH)
    assert pf("watch-products", "Update for EXAMPLEGUARD", "", None, WATCH)
    assert pf("watch-products", "x", "about samplekit 2", None, WATCH)
    assert not pf("watch-products", "Other product", "nothing", Decimal("9.9"), WATCH)
    assert pf("watch-products-or-cvss9", "Other", "nothing", Decimal("9.0"), WATCH)
    assert not pf("watch-products-or-cvss9", "Other", "nothing", Decimal("8.9"), WATCH)
    assert not pf("watch-products-or-cvss9", "Other", "nothing", None, WATCH)
    assert pf("watch-products-or-cvss9", "ExampleGuard", "", None, WATCH)


def test_tst_feed_08_jvn_with_watch_filter() -> None:
    """TST-FEED-08:JVN の見本で watch-products-or-cvss9。CVSS 9.8 の記事と、製品名に当たる記事が入る。"""
    s = src(id="jvn-new", kind="vuln", format="rss1", lang="ja", filter="watch-products-or-cvss9")
    res = parse_feed(s, data("jvn.rdf"), ("samplekit-not-here",), NOW)
    assert [e.cvss for e in res.entries] == [Decimal("9.8")] and res.filtered == 1
    res = parse_feed(s, data("jvn.rdf"), ("samplekit",), NOW)
    assert len(res.entries) == 2 and res.filtered == 0


# ---------------------------------------------------------------
# TST-FEED-09:不正な記事
# ---------------------------------------------------------------
def test_tst_feed_09_invalid_items_are_counted() -> None:
    """TST-FEED-09:不正な記事は飛ばして番号ごとに数え、ほかの記事は入る。"""
    body = ('<rss version="2.0"><channel>'
            "<item><title>ok one</title><guid>g1</guid></item>"
            "<item><title>   </title><guid>g2</guid></item>"
            "<item><title>&lt;b&gt;&lt;/b&gt;</title><guid>g3</guid></item>"
            "<item><title>no guid no link</title></item>"
            "<item><title>dup</title><guid>g1</guid></item>"
            "<item><title>ok two</title><link>https://news.example.com/b</link></item>"
            "</channel></rss>").encode()
    res = parse_feed(src(format="rss2"), body, WATCH, NOW)
    assert [e.title for e in res.entries] == ["ok one", "ok two"]
    assert res.invalid == {"E-ITEM-TITLE": 2, "E-ITEM-GUID": 1, "E-ITEM-DUP": 1}
    kev = {"vulnerabilities": [
        "not-an-object",
        {"cveID": 123},
        {"cveID": "", "vulnerabilityName": "x"},
        {"cveID": "CVE-2026-90003", "vendorProject": "V", "product": "P", "vulnerabilityName": "",
         "dateAdded": "2026-11-19"},
        {"cveID": "CVE-2026-90004", "vendorProject": "V", "product": "P", "vulnerabilityName": "N",
         "dateAdded": "2026-11-19"},
    ]}
    res = parse_feed(src(kind="vuln", format="kev-json", filter="kev"), json.dumps(kev).encode(), WATCH, NOW)
    assert [e.cve_ids for e in res.entries] == [["CVE-2026-90004"]]
    assert res.invalid == {"E-ITEM-SHAPE": 2, "E-ITEM-GUID": 1, "E-ITEM-TITLE": 1}
    # 脆弱性でない取得先に KEV を設定したら、kind に合わない
    res = parse_feed(src(kind="outage", format="kev-json", filter="kev"), json.dumps(kev).encode(), WATCH, NOW)
    assert res.entries == [] and res.invalid["E-ITEM-KIND"] == 2
