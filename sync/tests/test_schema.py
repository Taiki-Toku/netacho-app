"""schema の試験(DB を使わない)。TST-SYNC-01〜04。"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from helpers import GENRES, REMOVE, TODAY, dump, make_item
from nodal_sync import schema

SLOTS = ("取り組みに効く", "新着")
DAY = dt.date(2026, 11, 20)


def check_day(files: list[tuple[str, bytes | None]], *, day: dt.date = DAY,
              allow_null_genre: bool = False) -> schema.DayResult:
    return schema.validate_day(day, files, genres=GENRES, slots=SLOTS,
                               allow_null_genre=allow_null_genre, today=TODAY)


def one(obj: Any, file_id: str = "2026-11-20-01", **kw: Any) -> schema.DayResult:
    good = make_item("2026-11-20-02")
    return check_day([(file_id, dump(obj)), ("2026-11-20-02", dump(good))], **kw)


# (項目を変える値, 出るはずの決まりの番号)
BAD_FIELDS: list[tuple[dict[str, Any], str]] = [
    ({"id": REMOVE}, "E-ID-MISSING"),
    ({"id": 20261120}, "E-ID-TYPE"),
    ({"id": "2026-11-20-1"}, "E-ID-FORM"),
    ({"id": "２０２６-11-20-01"}, "E-ID-FORM"),
    ({"id": "2026-11-20-01\n"}, "E-ID-FORM"),
    ({"id": "2026-11-20-03"}, "E-ID-FILENAME"),
    ({"date": REMOVE}, "E-DATE-MISSING"),
    ({"date": 20261120}, "E-DATE-TYPE"),
    ({"date": "2026/11/20"}, "E-DATE-FORM"),
    ({"date": "2026-11-19"}, "E-DATE-ID"),
    ({"order": REMOVE}, "E-ORDER-MISSING"),
    ({"order": "1"}, "E-ORDER-TYPE"),
    ({"order": True}, "E-ORDER-TYPE"),
    ({"order": 1.0}, "E-ORDER-TYPE"),
    ({"order": 1000}, "E-ORDER-RANGE"),
    ({"order": -1}, "E-ORDER-RANGE"),
    ({"slot": REMOVE}, "E-SLOT-MISSING"),
    ({"slot": 1}, "E-SLOT-TYPE"),
    ({"slot": "朝刊"}, "E-SLOT-VALUE"),
    ({"genre": REMOVE}, "E-GENRE-MISSING"),
    ({"genre": None}, "E-GENRE-NULL"),
    ({"genre": 3}, "E-GENRE-TYPE"),
    ({"genre": "vuln"}, "E-GENRE-VALUE"),
    ({"title": REMOVE}, "E-TITLE-MISSING"),
    ({"title": 5}, "E-TITLE-TYPE"),
    ({"title": ""}, "E-TITLE-LEN"),
    ({"title": "あ" * 201}, "E-TITLE-LEN"),
    ({"title": "a\x00b"}, "E-TITLE-CTRL"),
    ({"title": "a\rb"}, "E-TITLE-CTRL"),
    ({"title": "a\x1bb"}, "E-TITLE-CTRL"),
    ({"title": "a\ud800b"}, "E-TITLE-CTRL"),
    ({"lead": None}, "E-LEAD-TYPE"),
    ({"lead": "x" * 401}, "E-LEAD-LEN"),
    ({"lead": "\x07"}, "E-LEAD-CTRL"),
    ({"summary": "x" * 4001}, "E-SUMMARY-LEN"),
    ({"summary": ["x"]}, "E-SUMMARY-TYPE"),
    ({"points": "abc"}, "E-POINTS-TYPE"),
    ({"points": [1, 2, 3]}, "E-POINTS-TYPE"),
    ({"points": ["a", "b"]}, "E-POINTS-COUNT"),
    ({"points": ["a", "b", "c", "d"]}, "E-POINTS-COUNT"),
    ({"points": ["a", "b", ""]}, "E-POINTS-LEN"),
    ({"points": ["a", "b", "c" * 301]}, "E-POINTS-LEN"),
    ({"points": ["a", "b", "c\x00"]}, "E-POINTS-CTRL"),
    ({"excerpt": "x" * 1001}, "E-EXCERPT-LEN"),
    ({"tryit": "x" * 2001}, "E-TRYIT-LEN"),
    ({"caution": "x" * 2001}, "E-CAUTION-LEN"),
    ({"caution": 1}, "E-CAUTION-TYPE"),
    ({"categories": [f"c{i}" for i in range(21)]}, "E-CATEGORIES-COUNT"),
    ({"categories": "c"}, "E-CATEGORIES-TYPE"),
    ({"projects": [""]}, "E-PROJECTS-LEN"),
    ({"projects": ["x" * 51]}, "E-PROJECTS-LEN"),
    ({"tags": [None]}, "E-TAGS-TYPE"),
    ({"tags": ["a\x01"]}, "E-TAGS-CTRL"),
    ({"sourceUrl": 5}, "E-URL-TYPE"),
    ({"sourceUrl": None}, "E-URL-TYPE"),
    ({"sourceUrl": "http://news.example.com/a"}, "E-URL-SCHEME"),
    ({"sourceUrl": "javascript:alert(1)"}, "E-URL-SCHEME"),
    ({"sourceUrl": "HTTPS://news.example.com/a"}, "E-URL-SCHEME"),
    ({"sourceUrl": "https://"}, "E-URL-HOST"),
    ({"sourceUrl": "https:///path"}, "E-URL-HOST"),
    ({"sourceUrl": "https://news.example.com/a b"}, "E-URL-SPACE"),
    ({"sourceUrl": "https://news.example.com/a\x00"}, "E-URL-SPACE"),
    ({"sourceUrl": "https://news.example.com/" + "a" * 2000}, "E-URL-LEN"),
    ({"sourceTitle": "x" * 301}, "E-SOURCE-TITLE-LEN"),
    ({"trust": "x" * 41}, "E-TRUST-LEN"),
    ({"trust": False}, "E-TRUST-TYPE"),
    ({"stars": [1, 2, 3]}, "E-STARS-TYPE"),
    ({"stars": {"hot": True}}, "E-STARS-TYPE"),
    ({"stars": {"hot": 1.5}}, "E-STARS-TYPE"),
    ({"stars": {"hot": 6}}, "E-STARS-RANGE"),
    ({"stars": {"use": -1}}, "E-STARS-RANGE"),
    ({"stars": {"wow": 1}}, "E-STARS-KEY"),
    ({"publishedAt": 1}, "E-PUBLISHED-TYPE"),
    ({"publishedAt": "2026/11/01"}, "E-PUBLISHED-FORM"),
    ({"publishedAt": "2026-02-30"}, "E-PUBLISHED-FORM"),
    ({"publishedAt": "2026-11-21"}, "E-PUBLISHED-AFTER"),
    ({"relatedFeedIds": "x"}, "E-FEED-IDS-TYPE"),
    ({"relatedFeedIds": [1]}, "E-FEED-IDS-TYPE"),
    ({"relatedFeedIds": ["0" * 32] * 51}, "E-FEED-IDS-COUNT"),
    ({"relatedFeedIds": ["A" * 32]}, "E-FEED-IDS-FORM"),
    ({"relatedFeedIds": ["0" * 31]}, "E-FEED-IDS-FORM"),
    ({"relatedItemIds": None}, "E-ITEM-IDS-TYPE"),
    ({"relatedItemIds": ["2026-11-19-01"] * 11}, "E-ITEM-IDS-COUNT"),
    ({"relatedItemIds": ["2026-11-19"]}, "E-ITEM-IDS-FORM"),
]


@pytest.mark.parametrize("over,code", BAD_FIELDS, ids=[c for _, c in BAD_FIELDS])
def test_tst_sync_01_each_rule_makes_day_invalid(over: dict[str, Any], code: str) -> None:
    """TST-SYNC-01:決まりに外れた値で、その日が不正になり、決まりの番号が出る。"""
    res = one(make_item(**over))
    assert not res.valid
    assert res.rows == []
    assert ("2026-11-20-01", code) in res.errors
    assert code in schema.ERROR_CODES
    # 値そのものは結果に入らない(id と番号だけ)
    for ident, c in res.errors:
        assert schema.ID_RE.fullmatch(ident) or schema.DATE_RE.fullmatch(ident)
        assert c in schema.ERROR_CODES


def test_tst_sync_01_future_date() -> None:
    """TST-SYNC-01:日本時間の明日より後の date は不正。明日までは通る。"""
    tomorrow = make_item("2026-11-21-01")
    res = check_day([("2026-11-21-01", dump(tomorrow))], day=dt.date(2026, 11, 21))
    assert res.valid
    later = make_item("2026-11-22-01")
    res = check_day([("2026-11-22-01", dump(later))], day=dt.date(2026, 11, 22))
    assert ("2026-11-22-01", "E-DATE-FUTURE") in res.errors


@pytest.mark.parametrize("raw,code", [
    (b"\xff\xfe{}", "E-JSON-UTF8"),
    (b"{", "E-JSON-SYNTAX"),
    (b'{"order": NaN}', "E-JSON-CONST"),
    (b'{"order": Infinity}', "E-JSON-CONST"),
    (b'{"order": -Infinity}', "E-JSON-CONST"),
    (b'{"title": "a", "title": "b"}', "E-DUP-KEY"),
    (b'{"stars": {"hot": 1, "hot": 2}}', "E-DUP-KEY"),
    (b"[]", "E-JSON-TOP"),
    (b'"text"', "E-JSON-TOP"),
    (b"[" * 30000 + b"]" * 30000, "E-JSON-SYNTAX"),
], ids=["utf8", "syntax", "nan", "inf", "-inf", "dup", "dup-nested", "list", "string", "deep"])
def test_tst_sync_01_file_level(raw: bytes, code: str) -> None:
    """TST-SYNC-01:JSON として不正なファイル。"""
    res = check_day([("2026-11-20-01", raw)])
    assert res.errors == [("2026-11-20-01", code)]


def test_tst_sync_01_file_size_and_day_count() -> None:
    """TST-SYNC-01:64 KB を超えるファイル、1日 30 本を超える日、読めないファイル。"""
    big = make_item(summary="x" * 10)
    raw = dump(big)
    raw = raw[:-1] + b"," + b'"pad": "' + b"x" * (schema.MAX_FILE_BYTES) + b'"}'
    res = check_day([("2026-11-20-01", raw)])
    assert ("2026-11-20-01", "E-FILE-SIZE") in res.errors

    files = [(f"2026-11-20-{i:02d}", dump(make_item(f"2026-11-20-{i:02d}"))) for i in range(31)]
    res = check_day(files)
    assert ("2026-11-20", "E-DAY-COUNT") in res.errors
    files30 = files[:30]
    assert check_day(files30).valid

    res = check_day([("2026-11-20-01", None)])
    assert res.errors == [("2026-11-20-01", "E-FILE-READ")]


def test_tst_sync_01_null_genre_only_in_all_mode() -> None:
    """TST-SYNC-01:genre の null は mode が all のときだけ。"""
    res = one(make_item(genre=None), allow_null_genre=True)
    assert res.valid
    assert res.rows[0]["genre"] is None


def test_tst_sync_02_sample_becomes_row() -> None:
    """TST-SYNC-02:正しい見本の1日分がそのまま行の値になる。"""
    path = Path(__file__).parent / "data" / "2026-11-20-01.json"
    res = check_day([("2026-11-20-01", path.read_bytes())])
    assert res.valid, res.errors
    assert res.rows == [{
        "id": "2026-11-20-01",
        "date": dt.date(2026, 11, 20),
        "sort_order": 1,
        "slot": "取り組みに効く",
        "genre": "tools",
        "title": "架空の見出し:見本のツールが新しい版を出した",
        "lead": "架空のリード文。",
        "summary": "架空の要約。\n2行目。",
        "points": ["架空の要点1", "架空の要点2", "架空の要点3"],
        "excerpt": "",          # 無い項目は既定値
        "tryit": "",
        "caution": "",
        "categories": ["架空の分類"],
        "projects": [],
        "tags": ["見本", "架空"],
        "source_url": None,     # 空の sourceUrl は null
        "source_title": "架空の出典",
        "trust": "",
        "star_hot": 4,
        "star_use": 0,          # キーが無い星は 0
        "star_fun": 2,
        "published_at": dt.date(2026, 11, 19),
        "related_feed_ids": ["0123456789abcdef0123456789abcdef"],
        "related_item_ids": ["2026-11-19-02"],
    }]
    assert list(res.rows[0]) == list(schema.ROW_COLUMNS)


def test_tst_sync_02_minimal_item_defaults() -> None:
    """TST-SYNC-02:必須の項目だけの見本は、任意の項目が DB の既定値になる。"""
    obj = {"id": "2026-11-20-01", "date": "2026-11-20", "order": 0, "slot": "新着",
           "genre": "work", "title": "架空"}
    res = check_day([("2026-11-20-01", dump(obj))])
    assert res.valid
    row = res.rows[0]
    assert row["lead"] == row["summary"] == row["excerpt"] == row["tryit"] == ""
    assert row["points"] == row["categories"] == row["projects"] == row["tags"] == []
    assert row["related_feed_ids"] == row["related_item_ids"] == []
    assert row["source_url"] is None and row["published_at"] is None
    assert (row["star_hot"], row["star_use"], row["star_fun"]) == (0, 0, 0)


def test_tst_sync_03_idea_rules() -> None:
    """TST-SYNC-03:idea で「AI提案」が無い・relatedItemIds が空なら不正。"""
    ok = make_item(genre="idea", tags=["AI提案"], relatedItemIds=["2026-11-19-01"])
    assert one(ok).valid
    no_tag = make_item(genre="idea", tags=["見本"], relatedItemIds=["2026-11-19-01"])
    assert ("2026-11-20-01", "E-IDEA-TAG") in one(no_tag).errors
    no_rel = make_item(genre="idea", tags=["AI提案"], relatedItemIds=[])
    assert ("2026-11-20-01", "E-IDEA-RELATED") in one(no_rel).errors
    missing_rel = make_item(genre="idea", tags=["AI提案"])
    assert ("2026-11-20-01", "E-IDEA-RELATED") in one(missing_rel).errors


def test_tst_sync_04_unknown_fields_are_dropped() -> None:
    """TST-SYNC-04:表に無い項目と rating・memo などは読まれず、件数だけが出る。"""
    obj = make_item(rating="架空の評価", status="架空の状態", memo="架空のメモ本文",
                    userUpdatedAt="2026-11-19T01:02:03Z", extraField={"x": "架空の値"})
    res = check_day([("2026-11-20-01", dump(obj))])
    assert res.valid
    assert res.dropped == 5
    text = json.dumps(res.rows, default=str, ensure_ascii=False) + repr(res.errors)
    for value in ("架空のメモ本文", "架空の評価", "架空の状態", "01:02:03", "extraField", "架空の値"):
        assert value not in text


def test_overlaps_are_counted_not_rejected() -> None:
    """同じ日の order・タイトルの重なりは不正にしない(件数だけ)。"""
    a = make_item("2026-11-20-01", order=5, title="同じ")
    b = make_item("2026-11-20-02", order=5, title="同じ")
    res = check_day([("2026-11-20-01", dump(a)), ("2026-11-20-02", dump(b))])
    assert res.valid
    assert res.overlaps == 2
