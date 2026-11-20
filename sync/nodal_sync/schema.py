"""入力の JSON(1ファイル=1本)の検査と、DB の行への変換(依頼 10-1 の 3章)。

結果には値を入れない。不正は (id, 決まりの番号) だけで返す。
"""

from __future__ import annotations

import datetime as dt
import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Iterable

# ---------------------------------------------------------------
# 決まりの番号(README にも同じ一覧を載せる)
# ---------------------------------------------------------------
# ファイル・日
E_JSON_UTF8 = "E-JSON-UTF8"        # UTF-8 で読めない
E_JSON_SYNTAX = "E-JSON-SYNTAX"    # JSON として読めない
E_JSON_CONST = "E-JSON-CONST"      # NaN・Infinity
E_DUP_KEY = "E-DUP-KEY"            # 同じキーが2回
E_JSON_TOP = "E-JSON-TOP"          # 最上位がオブジェクトでない
E_FILE_SIZE = "E-FILE-SIZE"        # 64 KB を超える
E_FILE_READ = "E-FILE-READ"        # 普通のファイルとして読めない
E_DAY_COUNT = "E-DAY-COUNT"        # 1日 30 本を超える
# 項目
E_ID_MISSING = "E-ID-MISSING"
E_ID_TYPE = "E-ID-TYPE"
E_ID_FORM = "E-ID-FORM"
E_ID_FILENAME = "E-ID-FILENAME"    # ファイル名と違う
E_DATE_MISSING = "E-DATE-MISSING"
E_DATE_TYPE = "E-DATE-TYPE"
E_DATE_FORM = "E-DATE-FORM"        # YYYY-MM-DD の実在の日付でない
E_DATE_ID = "E-DATE-ID"            # id の先頭と違う
E_DATE_FUTURE = "E-DATE-FUTURE"    # 日本時間の明日より後
E_ORDER_MISSING = "E-ORDER-MISSING"
E_ORDER_TYPE = "E-ORDER-TYPE"
E_ORDER_RANGE = "E-ORDER-RANGE"
E_SLOT_MISSING = "E-SLOT-MISSING"
E_SLOT_TYPE = "E-SLOT-TYPE"
E_SLOT_VALUE = "E-SLOT-VALUE"      # 設定の slots に無い
E_GENRE_MISSING = "E-GENRE-MISSING"
E_GENRE_TYPE = "E-GENRE-TYPE"
E_GENRE_VALUE = "E-GENRE-VALUE"    # DB の genres に無い
E_GENRE_NULL = "E-GENRE-NULL"      # mode が all 以外で null
E_TITLE_MISSING = "E-TITLE-MISSING"
E_TITLE_TYPE = "E-TITLE-TYPE"
E_TITLE_LEN = "E-TITLE-LEN"
E_TITLE_CTRL = "E-TITLE-CTRL"
E_LEAD_TYPE = "E-LEAD-TYPE"
E_LEAD_LEN = "E-LEAD-LEN"
E_LEAD_CTRL = "E-LEAD-CTRL"
E_SUMMARY_TYPE = "E-SUMMARY-TYPE"
E_SUMMARY_LEN = "E-SUMMARY-LEN"
E_SUMMARY_CTRL = "E-SUMMARY-CTRL"
E_POINTS_TYPE = "E-POINTS-TYPE"
E_POINTS_COUNT = "E-POINTS-COUNT"  # 0 個か 3 個でない
E_POINTS_LEN = "E-POINTS-LEN"
E_POINTS_CTRL = "E-POINTS-CTRL"
E_EXCERPT_TYPE = "E-EXCERPT-TYPE"
E_EXCERPT_LEN = "E-EXCERPT-LEN"
E_EXCERPT_CTRL = "E-EXCERPT-CTRL"
E_TRYIT_TYPE = "E-TRYIT-TYPE"
E_TRYIT_LEN = "E-TRYIT-LEN"
E_TRYIT_CTRL = "E-TRYIT-CTRL"
E_CAUTION_TYPE = "E-CAUTION-TYPE"
E_CAUTION_LEN = "E-CAUTION-LEN"
E_CAUTION_CTRL = "E-CAUTION-CTRL"
E_CATEGORIES_TYPE = "E-CATEGORIES-TYPE"
E_CATEGORIES_COUNT = "E-CATEGORIES-COUNT"
E_CATEGORIES_LEN = "E-CATEGORIES-LEN"
E_CATEGORIES_CTRL = "E-CATEGORIES-CTRL"
E_PROJECTS_TYPE = "E-PROJECTS-TYPE"
E_PROJECTS_COUNT = "E-PROJECTS-COUNT"
E_PROJECTS_LEN = "E-PROJECTS-LEN"
E_PROJECTS_CTRL = "E-PROJECTS-CTRL"
E_TAGS_TYPE = "E-TAGS-TYPE"
E_TAGS_COUNT = "E-TAGS-COUNT"
E_TAGS_LEN = "E-TAGS-LEN"
E_TAGS_CTRL = "E-TAGS-CTRL"
E_URL_TYPE = "E-URL-TYPE"
E_URL_SCHEME = "E-URL-SCHEME"      # https:// で始まらない
E_URL_HOST = "E-URL-HOST"          # ホストが無い
E_URL_SPACE = "E-URL-SPACE"        # 空白・制御文字を含む
E_URL_LEN = "E-URL-LEN"
E_SOURCE_TITLE_TYPE = "E-SOURCE-TITLE-TYPE"
E_SOURCE_TITLE_LEN = "E-SOURCE-TITLE-LEN"
E_SOURCE_TITLE_CTRL = "E-SOURCE-TITLE-CTRL"
E_TRUST_TYPE = "E-TRUST-TYPE"
E_TRUST_LEN = "E-TRUST-LEN"
E_TRUST_CTRL = "E-TRUST-CTRL"
E_STARS_TYPE = "E-STARS-TYPE"      # オブジェクトでない・値が整数でない(真偽値を含む)
E_STARS_KEY = "E-STARS-KEY"        # hot・use・fun 以外のキー
E_STARS_RANGE = "E-STARS-RANGE"
E_PUBLISHED_TYPE = "E-PUBLISHED-TYPE"
E_PUBLISHED_FORM = "E-PUBLISHED-FORM"
E_PUBLISHED_AFTER = "E-PUBLISHED-AFTER"  # date より後
E_FEED_IDS_TYPE = "E-FEED-IDS-TYPE"
E_FEED_IDS_COUNT = "E-FEED-IDS-COUNT"
E_FEED_IDS_FORM = "E-FEED-IDS-FORM"
E_ITEM_IDS_TYPE = "E-ITEM-IDS-TYPE"
E_ITEM_IDS_COUNT = "E-ITEM-IDS-COUNT"
E_ITEM_IDS_FORM = "E-ITEM-IDS-FORM"
E_IDEA_TAG = "E-IDEA-TAG"          # idea なのに tags に「AI提案」が無い
E_IDEA_RELATED = "E-IDEA-RELATED"  # idea なのに relatedItemIds が空

ERROR_CODES: frozenset[str] = frozenset(
    v for k, v in dict(globals()).items() if k.startswith("E_") and isinstance(v, str)
)

# ---------------------------------------------------------------
# 上限と形
# ---------------------------------------------------------------
MAX_FILE_BYTES = 64 * 1024
MAX_ITEMS_PER_DAY = 30
IDEA_GENRE = "idea"
IDEA_TAG = "AI提案"

# \d は Unicode の数字にも当たるので [0-9] と fullmatch を使う
ID_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}")
DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
FEED_ID_RE = re.compile(r"[0-9a-f]{32}")

# 3章の表にある JSON の項目(これ以外は読まずに捨てる)
KNOWN_FIELDS: frozenset[str] = frozenset({
    "id", "date", "order", "slot", "genre", "title", "lead", "summary", "points", "excerpt",
    "tryit", "caution", "categories", "projects", "tags", "sourceUrl", "sourceTitle", "trust",
    "stars", "publishedAt", "relatedFeedIds", "relatedItemIds",
})

# DB の列(db.py の SQL もこの順と名前を使う)
ROW_COLUMNS: tuple[str, ...] = (
    "id", "date", "sort_order", "slot", "genre", "title", "lead", "summary", "points", "excerpt",
    "tryit", "caution", "categories", "projects", "tags", "source_url", "source_title", "trust",
    "star_hot", "star_use", "star_fun", "published_at", "related_feed_ids", "related_item_ids",
)

# 任意の文字列:JSON の項目, DB の列, 最大の字数, 番号の頭
_OPTIONAL_TEXT: tuple[tuple[str, str, int, str], ...] = (
    ("lead", "lead", 400, "LEAD"),
    ("summary", "summary", 4000, "SUMMARY"),
    ("excerpt", "excerpt", 1000, "EXCERPT"),
    ("tryit", "tryit", 2000, "TRYIT"),
    ("caution", "caution", 2000, "CAUTION"),
    ("sourceTitle", "source_title", 300, "SOURCE-TITLE"),
    ("trust", "trust", 40, "TRUST"),
)
# 任意の文字列の配列(0〜20 個、各 1〜50 字)
_OPTIONAL_LIST: tuple[tuple[str, str], ...] = (
    ("categories", "CATEGORIES"),
    ("projects", "PROJECTS"),
    ("tags", "TAGS"),
)


class JsonFileError(Exception):
    """1ファイルが JSON として不正なとき。code は決まりの番号。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _DupKey(Exception):
    pass


class _BadConst(Exception):
    pass


def _pairs_no_dup(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in pairs:
        if k in out:
            raise _DupKey()
        out[k] = v
    return out


def _reject_const(_name: str) -> Any:
    raise _BadConst()


def parse_json_strict(raw: bytes) -> Any:
    """UTF-8 の JSON を、同じキー・NaN・Infinity を拒んで読む。失敗は JsonFileError。"""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise JsonFileError(E_JSON_UTF8) from None
    try:
        return json.loads(text, object_pairs_hook=_pairs_no_dup, parse_constant=_reject_const)
    except _DupKey:
        raise JsonFileError(E_DUP_KEY) from None
    except _BadConst:
        raise JsonFileError(E_JSON_CONST) from None
    except (ValueError, RecursionError):
        raise JsonFileError(E_JSON_SYNTAX) from None


def has_bad_chars(s: str) -> bool:
    """NUL・改行とタブ以外の制御文字(Cc)・対になっていないサロゲート(Cs。DB に入らない)があれば真。"""
    for ch in s:
        if ch in "\n\t":
            continue
        cat = unicodedata.category(ch)
        if cat == "Cc" or cat == "Cs":
            return True
    return False


def parse_date(s: str) -> dt.date | None:
    if not DATE_RE.fullmatch(s):
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def date_of_id(item_id: str) -> dt.date | None:
    """id(形を確かめたもの)の先頭の日付。実在しなければ None。"""
    if not ID_RE.fullmatch(item_id):
        return None
    return parse_date(item_id[:10])


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _text(v: Any, lo: int, hi: int, stem: str, errors: list[str]) -> bool:
    if not isinstance(v, str):
        errors.append(f"E-{stem}-TYPE")
        return False
    if not lo <= len(v) <= hi:
        errors.append(f"E-{stem}-LEN")
        return False
    if has_bad_chars(v):
        errors.append(f"E-{stem}-CTRL")
        return False
    return True


def _text_list(v: Any, max_count: int, lo: int, hi: int, stem: str, errors: list[str],
               exact_counts: Iterable[int] | None = None) -> bool:
    if not isinstance(v, list):
        errors.append(f"E-{stem}-TYPE")
        return False
    if exact_counts is not None:
        if len(v) not in exact_counts:
            errors.append(f"E-{stem}-COUNT")
            return False
    elif len(v) > max_count:
        errors.append(f"E-{stem}-COUNT")
        return False
    for s in v:
        if not _text(s, lo, hi, stem, errors):
            return False
    return True


def _check_url(v: str, errors: list[str]) -> bool:
    if len(v) > 2000:
        errors.append(E_URL_LEN)
        return False
    if any(ch.isspace() for ch in v) or has_bad_chars(v):
        errors.append(E_URL_SPACE)
        return False
    if not v.startswith("https://"):
        errors.append(E_URL_SCHEME)
        return False
    # https:// の後、最初の / ? # までがホストの部分(userinfo とポートを除いた残りが空でないこと)
    authority = re.split(r"[/?#]", v[len("https://"):], maxsplit=1)[0]
    host = authority.rsplit("@", 1)[-1]
    if host.startswith("["):
        host = host.split("]", 1)[0].lstrip("[")
    else:
        host = host.split(":", 1)[0]
    if not host:
        errors.append(E_URL_HOST)
        return False
    return True


@dataclass
class ItemResult:
    row: dict[str, Any] | None
    errors: list[str]
    dropped: int


def validate_item(obj: Any, file_id: str, *, genres: frozenset[str] | set[str],
                  slots: Iterable[str], allow_null_genre: bool, today: dt.date) -> ItemResult:
    """1本を調べる。file_id はファイル名から取った id(形を確かめたもの)。today は日本時間の今日。"""
    errors: list[str] = []
    if not isinstance(obj, dict):
        return ItemResult(None, [E_JSON_TOP], 0)

    dropped = sum(1 for k in obj if k not in KNOWN_FIELDS)
    row: dict[str, Any] = {}

    # id
    if "id" not in obj:
        errors.append(E_ID_MISSING)
    elif not isinstance(obj["id"], str):
        errors.append(E_ID_TYPE)
    elif not ID_RE.fullmatch(obj["id"]):
        errors.append(E_ID_FORM)
    elif obj["id"] != file_id:
        errors.append(E_ID_FILENAME)
    else:
        row["id"] = obj["id"]

    # date
    item_date: dt.date | None = None
    if "date" not in obj:
        errors.append(E_DATE_MISSING)
    elif not isinstance(obj["date"], str):
        errors.append(E_DATE_TYPE)
    else:
        item_date = parse_date(obj["date"])
        if item_date is None:
            errors.append(E_DATE_FORM)
        elif obj["date"] != file_id[:10]:
            errors.append(E_DATE_ID)
            item_date = None
        elif item_date > today + dt.timedelta(days=1):
            errors.append(E_DATE_FUTURE)
            item_date = None
        else:
            row["date"] = item_date

    # order
    if "order" not in obj:
        errors.append(E_ORDER_MISSING)
    elif not _is_int(obj["order"]):
        errors.append(E_ORDER_TYPE)
    elif not 0 <= obj["order"] <= 999:
        errors.append(E_ORDER_RANGE)
    else:
        row["sort_order"] = obj["order"]

    # slot
    if "slot" not in obj:
        errors.append(E_SLOT_MISSING)
    elif not isinstance(obj["slot"], str):
        errors.append(E_SLOT_TYPE)
    elif obj["slot"] not in set(slots):
        errors.append(E_SLOT_VALUE)
    else:
        row["slot"] = obj["slot"]

    # genre
    if "genre" not in obj:
        errors.append(E_GENRE_MISSING)
    elif obj["genre"] is None:
        if allow_null_genre:
            row["genre"] = None
        else:
            errors.append(E_GENRE_NULL)
    elif not isinstance(obj["genre"], str):
        errors.append(E_GENRE_TYPE)
    elif obj["genre"] not in genres:
        errors.append(E_GENRE_VALUE)
    else:
        row["genre"] = obj["genre"]

    # title
    if "title" not in obj:
        errors.append(E_TITLE_MISSING)
    elif _text(obj["title"], 1, 200, "TITLE", errors):
        row["title"] = obj["title"]

    # 任意の文字列
    for key, col, hi, stem in _OPTIONAL_TEXT:
        if key not in obj:
            row[col] = ""
        elif _text(obj[key], 0, hi, stem, errors):
            row[col] = obj[key]

    # points:0 個か 3 個、各 1〜300 字
    if "points" not in obj:
        row["points"] = []
    elif _text_list(obj["points"], 3, 1, 300, "POINTS", errors, exact_counts=(0, 3)):
        row["points"] = list(obj["points"])

    for key, stem in _OPTIONAL_LIST:
        if key not in obj:
            row[key] = []
        elif _text_list(obj[key], 20, 1, 50, stem, errors):
            row[key] = list(obj[key])

    # sourceUrl:空なら null
    if "sourceUrl" not in obj:
        row["source_url"] = None
    elif not isinstance(obj["sourceUrl"], str):
        errors.append(E_URL_TYPE)
    elif obj["sourceUrl"] == "":
        row["source_url"] = None
    elif _check_url(obj["sourceUrl"], errors):
        row["source_url"] = obj["sourceUrl"]

    # stars
    stars = {"hot": 0, "use": 0, "fun": 0}
    if "stars" in obj:
        sv = obj["stars"]
        if not isinstance(sv, dict):
            errors.append(E_STARS_TYPE)
        elif any(k not in stars for k in sv):
            errors.append(E_STARS_KEY)
        elif not all(_is_int(x) for x in sv.values()):
            errors.append(E_STARS_TYPE)
        elif not all(0 <= x <= 5 for x in sv.values()):
            errors.append(E_STARS_RANGE)
        else:
            stars.update(sv)
    row["star_hot"], row["star_use"], row["star_fun"] = stars["hot"], stars["use"], stars["fun"]

    # publishedAt:date より後は不可
    if "publishedAt" not in obj:
        row["published_at"] = None
    elif not isinstance(obj["publishedAt"], str):
        errors.append(E_PUBLISHED_TYPE)
    else:
        pub = parse_date(obj["publishedAt"])
        if pub is None:
            errors.append(E_PUBLISHED_FORM)
        elif item_date is not None and pub > item_date:
            errors.append(E_PUBLISHED_AFTER)
        else:
            row["published_at"] = pub

    # relatedFeedIds
    if "relatedFeedIds" not in obj:
        row["related_feed_ids"] = []
    else:
        v = obj["relatedFeedIds"]
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            errors.append(E_FEED_IDS_TYPE)
        elif len(v) > 50:
            errors.append(E_FEED_IDS_COUNT)
        elif not all(FEED_ID_RE.fullmatch(x) for x in v):
            errors.append(E_FEED_IDS_FORM)
        else:
            row["related_feed_ids"] = list(v)

    # relatedItemIds
    if "relatedItemIds" not in obj:
        row["related_item_ids"] = []
    else:
        v = obj["relatedItemIds"]
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            errors.append(E_ITEM_IDS_TYPE)
        elif len(v) > 10:
            errors.append(E_ITEM_IDS_COUNT)
        elif not all(ID_RE.fullmatch(x) for x in v):
            errors.append(E_ITEM_IDS_FORM)
        else:
            row["related_item_ids"] = list(v)

    # idea のつじつま
    if row.get("genre") == IDEA_GENRE:
        if IDEA_TAG not in row.get("tags", []):
            errors.append(E_IDEA_TAG)
        if not row.get("related_item_ids"):
            errors.append(E_IDEA_RELATED)

    if errors:
        return ItemResult(None, errors, dropped)
    return ItemResult({c: row[c] for c in ROW_COLUMNS}, [], dropped)


@dataclass
class DayResult:
    day: dt.date
    read: int = 0
    rows: list[dict[str, Any]] = field(default_factory=list)
    errors: list[tuple[str, str]] = field(default_factory=list)  # (id, 決まりの番号)
    dropped: int = 0
    overlaps: int = 0

    @property
    def valid(self) -> bool:
        return not self.errors


def validate_day(day: dt.date, files: list[tuple[str, bytes | None]], *,
                 genres: frozenset[str] | set[str], slots: Iterable[str],
                 allow_null_genre: bool, today: dt.date) -> DayResult:
    """1日分を調べる。files は (ファイル名から取った id, 中身)。中身が None は普通のファイルとして読めなかったもの。"""
    slots = tuple(slots)
    res = DayResult(day=day, read=len(files))
    if len(files) > MAX_ITEMS_PER_DAY:
        res.errors.append((day.isoformat(), E_DAY_COUNT))
    rows: list[dict[str, Any]] = []
    for file_id, raw in files:
        if raw is None:
            res.errors.append((file_id, E_FILE_READ))
            continue
        if len(raw) > MAX_FILE_BYTES:
            res.errors.append((file_id, E_FILE_SIZE))
            continue
        try:
            obj = parse_json_strict(raw)
        except JsonFileError as e:
            res.errors.append((file_id, e.code))
            continue
        r = validate_item(obj, file_id, genres=genres, slots=slots,
                          allow_null_genre=allow_null_genre, today=today)
        res.dropped += r.dropped
        res.errors.extend((file_id, code) for code in r.errors)
        if r.row is not None:
            rows.append(r.row)
    if res.errors:
        return res
    res.rows = rows
    orders = [r["sort_order"] for r in rows]
    titles = [r["title"] for r in rows]
    res.overlaps = (len(orders) - len(set(orders))) + (len(titles) - len(set(titles)))
    return res
