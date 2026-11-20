"""公式フィードの設定の試験。TST-FEED-01・08(設定の部分)。値はすべて架空。"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from nodal_sync import feedconfig
from nodal_sync.feedconfig import FeedConfigError, load_feed_config, parse_feed_config

SOURCE: dict[str, Any] = {
    "id": "example-status", "kind": "outage", "vendor": "Example", "product": "Example Cloud",
    "format": "atom", "url": "https://status.example.com/history.atom",
    "lang": "en", "translate": "title+summary", "filter": "statuspage-incident", "enabled": True,
}
CONFIG: dict[str, Any] = {"watch_products": ["ExampleGuard", "SampleKit"], "sources": [SOURCE]}


def cfg_with(**source_over: Any) -> dict[str, Any]:
    c = copy.deepcopy(CONFIG)
    c["sources"][0].update(source_over)
    return c


def error_of(obj: Any) -> str:
    with pytest.raises(FeedConfigError) as e:
        parse_feed_config(obj)
    return e.value.code


def test_good_config_and_defaults() -> None:
    cfg = parse_feed_config(copy.deepcopy(CONFIG))
    assert cfg.watch_products == ("exampleguard", "samplekit")
    s = cfg.sources[0]
    assert (s.id, s.kind, s.format, s.filter, s.enabled) == (
        "example-status", "outage", "atom", "statuspage-incident", True)
    assert s.max_bytes == 2 * 1024 * 1024 and s.max_age_days == 14
    s2 = parse_feed_config(cfg_with(max_bytes=8 * 1024 * 1024, max_age_days=90)).sources[0]
    assert (s2.max_bytes, s2.max_age_days) == (8 * 1024 * 1024, 90)


@pytest.mark.parametrize("over,code", [
    ({"id": "Bad_ID"}, "E-FEED-CONFIG-ID"),
    ({"id": "-starts-with-hyphen"}, "E-FEED-CONFIG-ID"),
    ({"id": "a" * 41}, "E-FEED-CONFIG-ID"),
    ({"kind": "news"}, "E-FEED-CONFIG-KIND"),
    ({"vendor": ""}, "E-FEED-CONFIG-NAME"),
    ({"product": "x" * 101}, "E-FEED-CONFIG-NAME"),
    ({"vendor": 1}, "E-FEED-CONFIG-NAME"),
    ({"format": "json"}, "E-FEED-CONFIG-FORMAT"),
    ({"url": "http://status.example.com/history.atom"}, "E-FEED-CONFIG-URL"),
    ({"url": "https://status.example.com/" + "a" * 2000}, "E-FEED-CONFIG-URL"),
    ({"lang": "fr"}, "E-FEED-CONFIG-LANG"),
    ({"translate": "all"}, "E-FEED-CONFIG-TRANSLATE"),
    ({"filter": "everything"}, "E-FEED-CONFIG-FILTER"),
    ({"enabled": "true"}, "E-FEED-CONFIG-ENABLED"),
    ({"enabled": 1}, "E-FEED-CONFIG-ENABLED"),
    ({"max_bytes": 8 * 1024 * 1024 + 1}, "E-FEED-CONFIG-MAX-BYTES"),
    ({"max_bytes": 0}, "E-FEED-CONFIG-MAX-BYTES"),
    ({"max_bytes": True}, "E-FEED-CONFIG-MAX-BYTES"),
    ({"max_bytes": 1.5}, "E-FEED-CONFIG-MAX-BYTES"),
    ({"max_age_days": 0}, "E-FEED-CONFIG-MAX-AGE"),
    ({"max_age_days": 91}, "E-FEED-CONFIG-MAX-AGE"),
    ({"unknown_key": 1}, "E-FEED-CONFIG-SOURCE-KEYS"),
])
def test_tst_feed_01_each_rule(over: dict[str, Any], code: str) -> None:
    """TST-FEED-01:取得先の各項目の決まりに外れた値で、決まりの番号の設定の誤り。"""
    assert error_of(cfg_with(**over)) == code


def test_tst_feed_01_top_level_and_counts() -> None:
    """TST-FEED-01:表に無いキー・足りないキー・取得先 0 件・50 件超・id の重複・型の違い。"""
    assert error_of([]) == "E-FEED-CONFIG-KEYS"
    assert error_of({**CONFIG, "extra": 1}) == "E-FEED-CONFIG-KEYS"
    assert error_of({"sources": [SOURCE]}) == "E-FEED-CONFIG-KEYS"
    assert error_of({**CONFIG, "sources": []}) == "E-FEED-CONFIG-SOURCES"
    many = [dict(SOURCE, id=f"s{i}") for i in range(51)]
    assert error_of({**CONFIG, "sources": many}) == "E-FEED-CONFIG-SOURCES"
    assert parse_feed_config({**CONFIG, "sources": many[:50]}).sources[49].id == "s49"
    assert error_of({**CONFIG, "sources": "x"}) == "E-FEED-CONFIG-SOURCES"
    assert error_of({**CONFIG, "sources": [SOURCE, dict(SOURCE)]}) == "E-FEED-CONFIG-ID"
    missing = {k: v for k, v in SOURCE.items() if k != "lang"}
    assert error_of({**CONFIG, "sources": [missing]}) == "E-FEED-CONFIG-SOURCE-KEYS"
    assert error_of({**CONFIG, "sources": ["x"]}) == "E-FEED-CONFIG-SOURCE-KEYS"


@pytest.mark.parametrize("watch", [
    [], ["ab"], ["  ab  "], ["x" * 61], [1], "ExampleGuard", ["ok-name", "ab"], ["a" * 3] * 201,
])
def test_tst_feed_08_watch_products_rules(watch: Any) -> None:
    """TST-FEED-08:watch_products は 1〜200 個・3〜60 字。2字以下は何にでも当たるので設定の誤り。"""
    assert error_of({**CONFIG, "watch_products": watch}) == "E-FEED-CONFIG-WATCH"


def test_tst_feed_01_file_rules(tmp_path: Path) -> None:
    """TST-FEED-01:64 KB を超える・JSON でない・同じキー・読めないファイルは設定の誤り。"""
    p = tmp_path / "feed.json"
    p.write_bytes(b"{" + b" " * (feedconfig.MAX_CONFIG_BYTES) + b"}")
    with pytest.raises(FeedConfigError) as e:
        load_feed_config(str(p))
    assert e.value.code == "E-FEED-CONFIG-READ"
    p.write_bytes(b"{not json")
    with pytest.raises(FeedConfigError) as e:
        load_feed_config(str(p))
    assert e.value.code == "E-FEED-CONFIG-JSON"
    p.write_bytes(b'{"sources": [], "sources": []}')
    with pytest.raises(FeedConfigError) as e:
        load_feed_config(str(p))
    assert e.value.code == "E-FEED-CONFIG-JSON"
    with pytest.raises(FeedConfigError) as e:
        load_feed_config(str(tmp_path / "missing.json"))
    assert e.value.code == "E-FEED-CONFIG-READ"
    p.write_text(json.dumps(CONFIG), encoding="utf-8")
    assert load_feed_config(str(p)).sources[0].id == "example-status"
