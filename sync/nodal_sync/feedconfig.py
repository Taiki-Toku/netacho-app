"""公式フィードの設定(netacho-sync の config/feed_sources.json)を読んで形を確かめる(依頼 12-1。詳細設計 3.3)。

設定はオーナーが書く値だが、誤りがあれば何もせずに止まる(終了コード 2)。表示するのは決まりの番号だけ。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .schema import JsonFileError, has_bad_chars, parse_json_strict

MAX_CONFIG_BYTES = 64 * 1024
TOP_KEYS = frozenset({"watch_products", "sources"})
REQUIRED_KEYS = frozenset({"id", "kind", "vendor", "product", "format", "url", "lang", "translate",
                           "filter", "enabled"})
OPTIONAL_KEYS = frozenset({"max_bytes", "max_age_days"})

ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")  # 0002 の source_id の CHECK と同じ
KINDS = frozenset({"release", "eol", "change", "exam", "vuln", "outage"})
FORMATS = frozenset({"rss2", "atom", "rss1", "kev-json"})
LANGS = frozenset({"en", "ja"})
TRANSLATES = frozenset({"none", "title", "title+summary"})
FILTERS = frozenset({"all", "statuspage-incident", "watch-products", "watch-products-or-cvss9", "kev"})

MAX_SOURCES = 50
MAX_WATCH = 200
MIN_WATCH_LEN = 3  # 2字以下は部分一致で何にでも当たるので不可
MAX_WATCH_LEN = 60
MAX_NAME_LEN = 100
MAX_URL_LEN = 2000
DEFAULT_MAX_BYTES = 2 * 1024 * 1024
LIMIT_MAX_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_AGE_DAYS = 14
LIMIT_MAX_AGE_DAYS = 90


class FeedConfigError(Exception):
    """設定が読めない・形が違う。code は E-FEED-CONFIG-*。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Source:
    id: str
    kind: str
    vendor: str
    product: str
    format: str
    url: str
    lang: str
    translate: str
    filter: str
    enabled: bool
    max_bytes: int = DEFAULT_MAX_BYTES
    max_age_days: int = DEFAULT_MAX_AGE_DAYS


@dataclass(frozen=True)
class FeedConfig:
    watch_products: tuple[str, ...]  # casefold したもの
    sources: tuple[Source, ...]


def _is_int(v: Any) -> bool:
    # JSON の true・false は Python では int の仲間なので外す
    return isinstance(v, int) and not isinstance(v, bool)


def _choice(v: Any, allowed: frozenset[str], code: str) -> str:
    if not isinstance(v, str) or v not in allowed:
        raise FeedConfigError(code)
    return v


def _name(v: Any) -> str:
    if not isinstance(v, str) or not 1 <= len(v) <= MAX_NAME_LEN or has_bad_chars(v):
        raise FeedConfigError("E-FEED-CONFIG-NAME")
    return v


def _parse_watch(v: Any) -> tuple[str, ...]:
    """watch_products:1〜200 個、1つ 3〜60 字の文字列。部分一致に使うので casefold して持つ。"""
    if not isinstance(v, list) or not 1 <= len(v) <= MAX_WATCH:
        raise FeedConfigError("E-FEED-CONFIG-WATCH")
    out: list[str] = []
    for p in v:
        if (not isinstance(p, str) or not MIN_WATCH_LEN <= len(p.strip()) <= MAX_WATCH_LEN
                or has_bad_chars(p)):
            raise FeedConfigError("E-FEED-CONFIG-WATCH")
        out.append(p.strip().casefold())
    return tuple(out)


def _parse_source(obj: Any) -> Source:
    """取得先1つ。表に無いキー・足りないキー・型の違いは設定の誤り。"""
    if not isinstance(obj, dict):
        raise FeedConfigError("E-FEED-CONFIG-SOURCE-KEYS")
    keys = set(obj)
    if not REQUIRED_KEYS <= keys or not keys <= REQUIRED_KEYS | OPTIONAL_KEYS:
        raise FeedConfigError("E-FEED-CONFIG-SOURCE-KEYS")

    sid = obj["id"]
    if not isinstance(sid, str) or not ID_RE.fullmatch(sid):
        raise FeedConfigError("E-FEED-CONFIG-ID")
    url = obj["url"]
    if not isinstance(url, str) or not url.startswith("https://") or len(url) > MAX_URL_LEN:
        raise FeedConfigError("E-FEED-CONFIG-URL")
    enabled = obj["enabled"]
    if not isinstance(enabled, bool):
        raise FeedConfigError("E-FEED-CONFIG-ENABLED")

    max_bytes = obj.get("max_bytes", DEFAULT_MAX_BYTES)
    if not _is_int(max_bytes) or not 1 <= max_bytes <= LIMIT_MAX_BYTES:
        raise FeedConfigError("E-FEED-CONFIG-MAX-BYTES")
    max_age = obj.get("max_age_days", DEFAULT_MAX_AGE_DAYS)
    if not _is_int(max_age) or not 1 <= max_age <= LIMIT_MAX_AGE_DAYS:
        raise FeedConfigError("E-FEED-CONFIG-MAX-AGE")

    return Source(
        id=sid,
        kind=_choice(obj["kind"], KINDS, "E-FEED-CONFIG-KIND"),
        vendor=_name(obj["vendor"]),
        product=_name(obj["product"]),
        format=_choice(obj["format"], FORMATS, "E-FEED-CONFIG-FORMAT"),
        url=url,
        lang=_choice(obj["lang"], LANGS, "E-FEED-CONFIG-LANG"),
        translate=_choice(obj["translate"], TRANSLATES, "E-FEED-CONFIG-TRANSLATE"),
        filter=_choice(obj["filter"], FILTERS, "E-FEED-CONFIG-FILTER"),
        enabled=enabled,
        max_bytes=max_bytes,
        max_age_days=max_age,
    )


def parse_feed_config(obj: Any) -> FeedConfig:
    """設定の全体を確かめる。1つでも外れたら FeedConfigError(何もしないで止まるため)。"""
    if not isinstance(obj, dict) or set(obj) != TOP_KEYS:
        raise FeedConfigError("E-FEED-CONFIG-KEYS")
    watch = _parse_watch(obj["watch_products"])
    raw_sources = obj["sources"]
    if not isinstance(raw_sources, list) or not 1 <= len(raw_sources) <= MAX_SOURCES:
        raise FeedConfigError("E-FEED-CONFIG-SOURCES")
    sources = [_parse_source(s) for s in raw_sources]
    ids = [s.id for s in sources]
    if len(set(ids)) != len(ids):
        raise FeedConfigError("E-FEED-CONFIG-ID")
    return FeedConfig(watch_products=watch, sources=tuple(sources))


def load_feed_config(path: str) -> FeedConfig:
    """64 KB までのファイルを、同じキー・NaN を拒んで読む(config.py と同じ読み方)。"""
    try:
        with open(path, "rb") as f:
            raw = f.read(MAX_CONFIG_BYTES + 1)
    except OSError:
        raise FeedConfigError("E-FEED-CONFIG-READ") from None
    if len(raw) > MAX_CONFIG_BYTES:
        raise FeedConfigError("E-FEED-CONFIG-READ")
    try:
        obj = parse_json_strict(raw)
    except JsonFileError:
        raise FeedConfigError("E-FEED-CONFIG-JSON") from None
    return parse_feed_config(obj)
