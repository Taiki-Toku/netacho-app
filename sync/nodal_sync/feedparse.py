"""公式フィードの解析と検査(依頼 12-1。詳細設計 3.5)。結果は「正しい記事」と「決まりの番号つきの不正」。

フィードの中身は外のデータなので、すべて信用しない。
- XML:Expat 2.7.2 以上を確かめ、DOCTYPE・ENTITY を含むものは解析しない(実体の展開の爆弾・外部の実体を避ける)。
  読むのは xml.etree.ElementTree.fromstring だけ(xml.dom.minidom・xml.sax は使わない)
- 文字:実体参照を戻し、タグを取り除き、制御文字を除き、DB の CHECK の長さで切る
- URL は https で 2,000 字以内のときだけ持つ。それ以外は null(記事は残す)
- 記事の中身はここから外(ログ・要約)に出さない。数えるのは決まりの番号だけ
"""

from __future__ import annotations

import datetime as dt
import email.utils
import hashlib
import html
import math
import pyexpat
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from html.parser import HTMLParser
from typing import Any, Iterable

from .feedconfig import Source
from .schema import JsonFileError, parse_json_strict

MIN_EXPAT = (2, 7, 2)
MAX_TITLE = 500     # 0002 の CHECK
MAX_SUMMARY = 2000  # 同上
MAX_URL = 2000
MAX_CVES = 50
MAX_NAME = 100
MAX_STATUS = 40
FUTURE_SLACK = dt.timedelta(days=1)

ATOM = "http://www.w3.org/2005/Atom"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
RSS1 = "http://purl.org/rss/1.0/"
DC = "http://purl.org/dc/elements/1.1/"

E_PARSE_DTD = "E-PARSE-DTD"
E_PARSE_XML = "E-PARSE-XML"
E_PARSE_JSON = "E-PARSE-JSON"
E_PARSE_SHAPE = "E-PARSE-SHAPE"   # XML・JSON として読めたが、形(rss・feed・RDF・vulnerabilities)が違う
E_ITEM_GUID = "E-ITEM-GUID"       # guid が空・使えない文字
E_ITEM_TITLE = "E-ITEM-TITLE"     # title が空
E_ITEM_SHAPE = "E-ITEM-SHAPE"     # KEV の1件がオブジェクトでない・値が文字列でない
E_ITEM_KIND = "E-ITEM-KIND"       # kind に合わない(脆弱性でない取得先の KEV)
E_ITEM_CVE = "E-ITEM-CVE"         # KEV の cveID が CVE の形でない
E_ITEM_DUP = "E-ITEM-DUP"         # 同じフィードの中で同じ guid

DTD_RE = re.compile(rb"<!(?:DOCTYPE|ENTITY)", re.IGNORECASE)
XML_DECL_ENC_RE = re.compile(rb"\A(?:\xef\xbb\xbf)?\s*<\?xml[^>]*?encoding\s*=\s*[\"']([A-Za-z0-9._-]+)[\"']")
# ASCII と同じ並びの文字コードだけ。これ以外(UTF-16・UTF-7・EBCDIC など)では、上の DTD の検査がすり抜けうる
ASCII_COMPATIBLE = frozenset({"utf-8", "utf8", "us-ascii", "ascii", "iso-8859-1", "latin-1", "latin1"})
CVE_RE = re.compile(r"(?<![0-9A-Za-z])CVE-[0-9]{4}-[0-9]{4,7}(?![0-9])", re.IGNORECASE)
CVE_FULL_RE = re.compile(r"CVE-[0-9]{4}-[0-9]{4,7}")
SCHEDULED_MARK = "this is a scheduled event"
SEVERITIES = frozenset({"critical", "high", "medium", "low"})
REFERENCE_NAMES = frozenset({"references", "reference"})  # JVN の sec:references(【推測】)
BIDI_CONTROLS = frozenset("\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069")
STATUS_WORDS = {
    "resolved": "復旧済み",
    "monitoring": "監視中",
    "identified": "原因を特定",
    "investigating": "調査中",
    "update": "更新",
}
# 状態の語 + 空白 + "-"。語の前は先頭か英数字以外(Unresolved などに当てない)。入れ子の繰り返しは無い
STATUS_RE = re.compile(r"(?<![0-9A-Za-z])(resolved|monitoring|identified|investigating|update)\s+-",
                       re.IGNORECASE | re.ASCII)


# ---------------------------------------------------------------
# Expat の版
# ---------------------------------------------------------------
def expat_version() -> str:
    """今の Python の Expat の版(試験で差し替える)。"""
    return pyexpat.EXPAT_VERSION


def expat_ok(version: str) -> bool:
    """expat_X.Y.Z が 2.7.2 以上なら真。2.7.2 で実体の展開の守りが揃う(基本設計 4.4)。読めない版は偽。"""
    m = re.fullmatch(r"expat_(\d+)\.(\d+)\.(\d+)", version)
    if not m:
        return False
    return tuple(int(x) for x in m.groups()) >= MIN_EXPAT


# ---------------------------------------------------------------
# 結果の形
# ---------------------------------------------------------------
@dataclass
class Entry:
    id: str
    title: str
    summary: str
    url: str | None
    published_at: dt.datetime | None
    vendor: str
    product: str
    cve_ids: list[str] = field(default_factory=list)
    severity: str | None = None
    cvss: Decimal | None = None
    exploited: bool = False
    status: str = ""


@dataclass
class ParseResult:
    entries: list[Entry] = field(default_factory=list)
    invalid: Counter[str] = field(default_factory=Counter)
    read: int = 0       # 不正を除いた記事の数(filter の前)
    filtered: int = 0   # filter で外した数
    error: str | None = None  # フィード全体が読めないときの決まりの番号


@dataclass
class SourceOutcome:
    """1つの取得先の、取得と解析の結果。code が None なら成功。"""
    source: Source
    code: str | None = None
    not_modified: bool = False
    etag: str | None = None
    last_modified: str | None = None
    entries: list[Entry] = field(default_factory=list)
    invalid: Counter[str] = field(default_factory=Counter)
    read: int = 0
    filtered: int = 0
    old: int = 0

    @property
    def ok(self) -> bool:
        return self.code is None


# ---------------------------------------------------------------
# 文字の整え方
# ---------------------------------------------------------------
class _TextOnly(HTMLParser):
    """タグを取り除き、文字だけを集める。script・style の中身は捨てる。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in ("br", "p", "div", "li", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def _bad_char(ch: str) -> bool:
    """改行・タブ以外の制御文字(Cc)、対になっていないサロゲート(Cs。DB に入らない)、文字の向きを変える制御文字(見た目の偽装に使える)。"""
    return ch not in "\n\t" and (unicodedata.category(ch) in ("Cc", "Cs") or ch in BIDI_CONTROLS)


def _drop_bad_chars(s: str) -> str:
    return "".join(ch for ch in s if not _bad_char(ch))


def clean_text(raw: str | None, *, single_line: bool) -> str:
    """実体参照を戻し、タグを取り除き、制御文字を除き、空白をまとめる。長さはまだ切らない。"""
    if not raw:
        return ""
    s = html.unescape(_drop_bad_chars(raw))
    p = _TextOnly()
    try:
        p.feed(s)
        p.close()
        s = "".join(p.parts)
    except Exception:
        s = re.sub(r"<[^>]*>", " ", s)
    s = _drop_bad_chars(s)
    if single_line:
        return re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[^\S\n]+", " ", s)
    s = re.sub(r" ?\n[\s]*", "\n", s)
    return s.strip()


def clean_url(raw: str | None) -> str | None:
    """https で、空白・制御文字が無く、2,000 字以内のときだけ返す。それ以外は None(リンクにしない)。"""
    if raw is None:
        return None
    u = raw.strip()
    if (not u.startswith("https://") or len(u) > MAX_URL or len(u) <= len("https://")
            or any(ch.isspace() or _bad_char(ch) for ch in u)):
        return None
    return u


def entry_id(source_id: str, guid: str) -> str:
    """sha256(source_id + 改行 + guid) の先頭 32 桁(0002 の CHECK)。"""
    return hashlib.sha256((source_id + "\n" + guid).encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------
# 日時
# ---------------------------------------------------------------
def _aware(d: dt.datetime) -> dt.datetime:
    """時差の無い日時は UTC とみなす(DB の timestamptz に入れるため)。"""
    return d if d.tzinfo is not None else d.replace(tzinfo=dt.timezone.utc)


def _not_future(d: dt.datetime | None, now: dt.datetime) -> dt.datetime | None:
    """今より 1 日を超えて先の日時は null(並びの先頭に居座らないように)。"""
    if d is None or d > now + FUTURE_SLACK:
        return None
    return d


def parse_rfc822(s: str | None, now: dt.datetime) -> dt.datetime | None:
    """RSS 2.0 の pubDate(RFC 822)。読めなければ None(並びは first_seen_at になる)。"""
    if not s:
        return None
    try:
        return _not_future(_aware(email.utils.parsedate_to_datetime(s.strip())), now)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None


def parse_iso(s: str | None, now: dt.datetime) -> dt.datetime | None:
    """Atom の published・updated と dc:date(ISO 8601)。読めなければ None。"""
    if not s:
        return None
    try:
        return _not_future(_aware(dt.datetime.fromisoformat(s.strip())), now)
    except (ValueError, OverflowError):
        return None


def parse_day(s: Any, now: dt.datetime) -> dt.datetime | None:
    """KEV の dateAdded(日付だけ)。00:00 UTC とする。"""
    if not isinstance(s, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", s):
        return None
    try:
        d = dt.date.fromisoformat(s)
    except ValueError:
        return None
    return _not_future(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc), now)


# ---------------------------------------------------------------
# 脆弱性の項目
# ---------------------------------------------------------------
def find_cves(texts: Iterable[str], first: Iterable[str] = ()) -> list[str]:
    """CVE-YYYY-NNNN(4〜7 桁)を拾い、大文字にそろえ、重複を除いて 50 個まで(0002 の CHECK)。"""
    out: list[str] = []
    for c in first:
        if c not in out:
            out.append(c)
    for t in texts:
        for m in CVE_RE.finditer(t):
            c = m.group(0).upper()
            if c not in out:
                out.append(c)
    return out[:MAX_CVES]


def _score(v: str | None) -> Decimal | None:
    """CVSS の score 属性。0〜10 の有限の数だけを小数1桁で(numeric(3,1) の CHECK)。それ以外は None。"""
    if v is None:
        return None
    try:
        f = float(v.strip())
    except ValueError:
        return None
    if not math.isfinite(f) or not 0 <= f <= 10:
        return None
    return Decimal(f"{f:.1f}")


# ---------------------------------------------------------------
# XML
# ---------------------------------------------------------------
def _local(tag: Any) -> str:
    """{名前空間}名前 の「名前」。コメントなど文字列でない tag は空。"""
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _ns(tag: Any) -> str:
    """{名前空間}名前 の「名前空間」。"""
    return tag[1:].split("}", 1)[0] if isinstance(tag, str) and tag.startswith("{") else ""


def _child(el: ET.Element, name: str, ns: str = "") -> ET.Element | None:
    """名前空間まで一致する最初の子(media:title などの別の要素を取り違えないため)。"""
    tag = f"{{{ns}}}{name}" if ns else name
    for c in el:
        if c.tag == tag:
            return c
    return None


def _text(el: ET.Element | None) -> str:
    """要素の文字(子の要素の文字も。Atom の type="xhtml" のため)。"""
    if el is None:
        return ""
    return "".join(el.itertext())


def load_xml(body: bytes) -> ET.Element:
    """XML の守り(詳細設計 3.5):DOCTYPE・ENTITY があれば解析しない。ASCII と同じ並びの文字コードだけを読む。"""
    if DTD_RE.search(body):
        raise _FeedError(E_PARSE_DTD)
    # UTF-16・UTF-32 は ASCII の文字にも NUL が入る。その形では上の検査が効かないので読まない
    if b"\x00" in body or body.startswith((b"\xfe\xff", b"\xff\xfe")):
        raise _FeedError(E_PARSE_XML)
    m = XML_DECL_ENC_RE.match(body)
    if m and m.group(1).decode("ascii").lower() not in ASCII_COMPATIBLE:
        raise _FeedError(E_PARSE_XML)
    try:
        return ET.fromstring(body)
    except (ET.ParseError, ValueError, RecursionError):
        raise _FeedError(E_PARSE_XML) from None


class _FeedError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class _Raw:
    """形ごとに読んだ、整える前の値。"""
    guid: str
    title: str
    url: str | None
    summary: str
    published_at: dt.datetime | None
    # 記事が主に扱う CVE(KEV は cveID、JVN は参照の要素)。あればこれだけを cve_ids にする
    first_cves: list[str] = field(default_factory=list)
    severity: str | None = None
    cvss: Decimal | None = None
    vendor: str | None = None
    product: str | None = None
    exploited: bool = False


def _read_rss2(root: ET.Element, now: dt.datetime) -> list[_Raw]:
    """RSS 2.0:channel/item。guid が無ければ link を guid にする(3.5 の表)。"""
    if root.tag != "rss":
        raise _FeedError(E_PARSE_SHAPE)
    channel = _child(root, "channel")
    if channel is None:
        raise _FeedError(E_PARSE_SHAPE)
    out: list[_Raw] = []
    for it in channel.findall("item"):
        link = _text(_child(it, "link")).strip()
        guid = _text(_child(it, "guid")).strip() or link
        out.append(_Raw(guid=guid, title=_text(_child(it, "title")), url=link or None,
                        summary=_text(_child(it, "description")),
                        published_at=parse_rfc822(_text(_child(it, "pubDate")), now)))
    return out


def _atom_link(entry: ET.Element) -> str | None:
    """rel が alternate か rel の無い link の href(self・enclosure などは使わない)。"""
    for link in entry.findall(f"{{{ATOM}}}link"):
        rel = link.get("rel")
        if rel is None or rel == "alternate":
            href = link.get("href")
            if href:
                return href
    return None


def _read_atom(root: ET.Element, now: dt.datetime) -> list[_Raw]:
    """Atom:entry。summary が無ければ content、published が無ければ updated(3.5 の表)。"""
    if root.tag != f"{{{ATOM}}}feed":
        raise _FeedError(E_PARSE_SHAPE)
    out: list[_Raw] = []
    for e in root.findall(f"{{{ATOM}}}entry"):
        summary_el = _child(e, "summary", ATOM)
        if summary_el is None or not _text(summary_el).strip():
            summary_el = _child(e, "content", ATOM)
        published = _text(_child(e, "published", ATOM)) or _text(_child(e, "updated", ATOM))
        out.append(_Raw(guid=_text(_child(e, "id", ATOM)).strip(), title=_text(_child(e, "title", ATOM)),
                        url=_atom_link(e), summary=_text(summary_el),
                        published_at=parse_iso(published, now)))
    return out


def _read_rss1(root: ET.Element, now: dt.datetime) -> list[_Raw]:
    """RSS 1.0:rdf:RDF/item。guid は rdf:about。JVN の sec:cvss の score の最大値と、その severity を持つ。"""
    if root.tag != f"{{{RDF}}}RDF":
        raise _FeedError(E_PARSE_SHAPE)
    out: list[_Raw] = []
    for it in root.findall(f"{{{RSS1}}}item"):
        # JVN の sec:references・sec:cvss など(要素の名前は【推測】。名前空間は問わず名前で見る)
        # CVE は参照の要素(references・reference)からだけ拾う。本文に書かれただけの CVE でまとめ先を決めないため
        refs: list[str] = []
        severity: str | None = None
        best: Decimal | None = None
        for c in it:
            if _ns(c.tag) in (RSS1, DC, RDF):
                continue
            if _local(c.tag) in REFERENCE_NAMES:
                refs.append(_text(c))
                refs.extend(v for v in c.attrib.values())
            if _local(c.tag) == "cvss":
                s = _score(c.get("score"))
                if s is not None:
                    if best is None or s > best:
                        best = s
                        sev = (c.get("severity") or "").strip().lower()
                        severity = sev if sev in SEVERITIES else None
        out.append(_Raw(guid=(it.get(f"{{{RDF}}}about") or "").strip(),
                        title=_text(_child(it, "title", RSS1)),
                        url=_text(_child(it, "link", RSS1)).strip() or None,
                        summary=_text(_child(it, "description", RSS1)),
                        published_at=parse_iso(_text(_child(it, "date", DC)), now),
                        first_cves=find_cves(refs), severity=severity, cvss=best))
    return out


def _read_kev(body: bytes, now: dt.datetime, invalid: Counter[str]) -> list[_Raw]:
    """CISA KEV の JSON:vulnerabilities[]。同じキー・NaN を拒んで読む。形の違う1件は数えて飛ばす。"""
    try:
        obj = parse_json_strict(body)
    except JsonFileError:
        raise _FeedError(E_PARSE_JSON) from None
    if not isinstance(obj, dict) or not isinstance(obj.get("vulnerabilities"), list):
        raise _FeedError(E_PARSE_SHAPE)
    out: list[_Raw] = []
    for v in obj["vulnerabilities"]:
        if not isinstance(v, dict):
            invalid[E_ITEM_SHAPE] += 1
            continue
        names = ("cveID", "vendorProject", "product", "vulnerabilityName", "shortDescription")
        if not all(isinstance(v.get(k, ""), str) for k in names):
            invalid[E_ITEM_SHAPE] += 1
            continue
        cve = v.get("cveID", "").strip().upper()
        if not CVE_FULL_RE.fullmatch(cve):
            invalid[E_ITEM_CVE if cve else E_ITEM_GUID] += 1
            continue
        vendor = clean_text(v.get("vendorProject"), single_line=True)
        product = clean_text(v.get("product"), single_line=True)
        name = clean_text(v.get("vulnerabilityName"), single_line=True)
        out.append(_Raw(guid=cve, title=f"{vendor} {product}: {name}" if name else "",
                        url=f"https://nvd.nist.gov/vuln/detail/{cve}",
                        summary=v.get("shortDescription", ""),
                        published_at=parse_day(v.get("dateAdded"), now),
                        first_cves=[cve], vendor=vendor[:MAX_NAME], product=product[:MAX_NAME],
                        exploited=True))
    return out


# ---------------------------------------------------------------
# filter と status
# ---------------------------------------------------------------
def statuspage_status(summary: str) -> str:
    """summary の中で最初に現れる「状態の語 - 」で障害の状態を決める(本文は「日時 状態の語 - 本文」の形)。
    呼ぶ側は保存する summary と同じ先頭 MAX_SUMMARY 字だけを渡す。"""
    m = STATUS_RE.search(summary)
    return STATUS_WORDS[m.group(1).lower()] if m else ""


def passes_filter(kind_filter: str, title: str, summary: str, cvss: Decimal | None,
                  watch_products: tuple[str, ...]) -> bool:
    """詳細設計 3.5 の filter の表。watch_products は casefold 済み。"""
    if kind_filter in ("all", "kev"):
        return True
    if kind_filter == "statuspage-incident":
        return SCHEDULED_MARK not in summary.casefold()
    hay = (title + "\n" + summary).casefold()
    hit = any(p in hay for p in watch_products)
    if kind_filter == "watch-products":
        return hit
    if kind_filter == "watch-products-or-cvss9":
        return hit or (cvss is not None and cvss >= Decimal("9.0"))
    return False


# ---------------------------------------------------------------
# 入口
# ---------------------------------------------------------------
def parse_feed(source: Source, body: bytes, watch_products: tuple[str, ...],
               now: dt.datetime) -> ParseResult:
    """フィード1本を読み、正しい記事(filter を通したもの)と、不正の番号ごとの数を返す。例外は外に出さない。"""
    res = ParseResult()
    try:
        if source.format == "kev-json":
            raws = _read_kev(body, now, res.invalid)
        else:
            root = load_xml(body)
            reader = {"rss2": _read_rss2, "atom": _read_atom, "rss1": _read_rss1}[source.format]
            raws = reader(root, now)
    except _FeedError as e:
        res.error = e.code
        return res
    except Exception:
        res.error = E_PARSE_XML if source.format != "kev-json" else E_PARSE_JSON
        return res

    seen: set[str] = set()
    is_vuln = source.kind == "vuln"
    for r in raws:
        if r.exploited and not is_vuln:
            res.invalid[E_ITEM_KIND] += 1
            continue
        guid = r.guid
        if not guid or any(unicodedata.category(ch) in ("Cc", "Cs") for ch in guid):
            res.invalid[E_ITEM_GUID] += 1
            continue
        title_full = clean_text(r.title, single_line=True)
        if not title_full:
            res.invalid[E_ITEM_TITLE] += 1
            continue
        eid = entry_id(source.id, guid)
        if eid in seen:
            res.invalid[E_ITEM_DUP] += 1
            continue
        seen.add(eid)
        summary_full = clean_text(r.summary, single_line=False)
        res.read += 1
        cves: list[str] = []
        severity: str | None = None
        cvss: Decimal | None = None
        if is_vuln:
            # KEV は [cveID] だけ、JVN は参照の要素の CVE があればそれだけ。無いときだけ title と summary から拾う
            cves = r.first_cves[:MAX_CVES] if r.first_cves else find_cves([title_full, summary_full])
            if source.format == "rss1":
                severity, cvss = r.severity, r.cvss
        if not passes_filter(source.filter, title_full, summary_full, cvss, watch_products):
            res.filtered += 1
            continue
        status = ""
        if source.filter == "statuspage-incident":
            status = statuspage_status(summary_full[:MAX_SUMMARY])[:MAX_STATUS]
        res.entries.append(Entry(
            id=eid,
            title=title_full[:MAX_TITLE],
            summary=summary_full[:MAX_SUMMARY],
            url=clean_url(r.url),
            published_at=r.published_at,
            vendor=(r.vendor or source.vendor)[:MAX_NAME],
            product=(r.product or source.product)[:MAX_NAME],
            cve_ids=cves,
            severity=severity,
            cvss=cvss,
            exploited=r.exploited and is_vuln,
            status=status,
        ))
    return res


def split_old(entries: list[Entry], max_age_days: int, now: dt.datetime) -> tuple[list[Entry], int]:
    """公開日が max_age_days より古い記事を外す(KEV の一覧が毎回全部を返すため)。公開日が無い記事は残す。"""
    limit = now - dt.timedelta(days=max_age_days)
    keep = [e for e in entries if e.published_at is None or e.published_at >= limit]
    return keep, len(entries) - len(keep)
