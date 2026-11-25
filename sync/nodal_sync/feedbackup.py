"""公式フィードのバックアップと戻し(依頼 12-6。詳細設計 3.14、REQ-N-16)。ロールは netacho_feed(select・insert・update だけ)。

- feed-backup:feed_entries(生成列の sort_at を除く全部の列)と feed_translate_usage を、--out の下の
  feed/YYYY-MM.jsonl(first_seen_at の日本時間の月)と usage.jsonl に書き出す。feed_source_state は書き出さない
- feed-restore:--in の下の同じ形のファイルを先に全部検査し、1行でも合わなければ何も書かない(E-RESTORE-ROW)。
  合えば1つのトランザクションで upsert する(消さない。値が違う行だけを上書きする)
- SQL は sql.SQL と値の引数で組み、列の名前と型はこのファイルの固定の一覧から作る
- 書くファイルは --out の下の feed/ と usage.jsonl だけ。パスは DB の時刻の年と月(整数)から固定の形で作る
- git の操作はしない(ワークフローが行う)。ログと要約には件数・月・不正な行のファイル名と行番号だけを渡す
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import stat
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .db import DbError, build_conninfo

APP_NAME = "nodal-backup"
UTC = dt.timezone.utc
JST = dt.timezone(dt.timedelta(hours=9))

# feed_entries の列(0002 の表の順。生成列の sort_at を除く)と、書き込むときの型
ENTRY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("id", "text"),
    ("source_id", "text"),
    ("kind", "text"),
    ("vendor", "text"),
    ("product", "text"),
    ("title", "text"),
    ("summary", "text"),
    ("url", "text"),
    ("published_at", "timestamptz"),
    ("first_seen_at", "timestamptz"),
    ("lang", "text"),
    ("title_ja", "text"),
    ("summary_ja", "text"),
    ("translate_status", "text"),
    ("translate_attempts", "smallint"),
    ("translated_at", "timestamptz"),
    ("cve_ids", "text[]"),
    ("severity", "text"),
    ("cvss", "numeric"),
    ("exploited", "boolean"),
    ("status", "text"),
    ("digest_date", "date"),
    ("updated_at", "timestamptz"),
)
ENTRY_NAMES = tuple(c for c, _ in ENTRY_COLUMNS)
USAGE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("month", "date"),
    ("chars", "bigint"),
    ("requests", "integer"),
    ("updated_at", "timestamptz"),
)
USAGE_NAMES = tuple(c for c, _ in USAGE_COLUMNS)

# 上書きで変えない列:id(衝突の鍵)、first_seen_at(feed_entries_guard が変えさせない)、updated_at(guard が今の時刻にする)
SET_NAMES = tuple(c for c in ENTRY_NAMES if c not in ("id", "first_seen_at", "updated_at"))
# 比べる列:上書きしても中身が変わらない行を上書きしない(上書きすると guard が updated_at を今の時刻にし、
# 次の書き出しでその月のファイルが変わる。3.14.3)。updated_at は入れない。first_seen_at は guard が変えさせない
# ので入れない。exploited は guard と同じ (t.exploited or excluded.exploited) と比べる(2026-11-26 のレビューの決定)
COMPARE_NAMES = tuple(c for c in ENTRY_NAMES if c not in ("id", "first_seen_at", "updated_at"))

TS_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"
TS_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z")
DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
MONTH_FILE_RE = re.compile(r"([0-9]{4})-([0-9]{2})\.jsonl")
ID_RE = re.compile(r"[0-9a-f]{32}")
SOURCE_ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")
CVE_RE = re.compile(r"CVE-[0-9]{4}-[0-9]{4,7}")
CVSS_RE = re.compile(r"[0-9]{1,2}(\.[0-9])?")
KINDS = frozenset({"release", "eol", "change", "exam", "vuln", "outage"})
LANGS = frozenset({"en", "ja"})
TRANSLATE_STATUSES = frozenset({"pending", "done", "skip", "failed"})
SEVERITIES = frozenset({"critical", "high", "medium", "low"})
BIGINT_MAX = 2**63 - 1
INT_MAX = 2**31 - 1
MAX_FILE_BYTES = 256 * 1024 * 1024  # 1ファイルの上限(読み込みでメモリを使い切らないように)
MAX_LISTED = 20  # 要約に並べる不正な行の数

FEED_DIR = "feed"
USAGE_FILE = "usage.jsonl"


class BackupError(Exception):
    """決まりの番号だけを持つ失敗(終了コード 2)。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------
# SQL(固定の一覧から組む)
# ---------------------------------------------------------------
def _cols(names: tuple[str, ...], prefix: str | None = None) -> sql.Composed:
    if prefix is None:
        return sql.SQL(", ").join(sql.Identifier(c) for c in names)
    return sql.SQL(", ").join(sql.Identifier(prefix, c) for c in names)


def _values(columns: tuple[tuple[str, str], ...]) -> sql.Composed:
    # 型の名前はこのファイルの固定の値だけ(外から来た値を SQL に入れない)
    return sql.SQL(", ").join(
        sql.SQL("{}::{}").format(sql.Placeholder(c), sql.SQL(t)) for c, t in columns)


SELECT_ENTRIES = sql.SQL("select {cols} from public.feed_entries order by id").format(cols=_cols(ENTRY_NAMES))
SELECT_USAGE = sql.SQL("select {cols} from public.feed_translate_usage order by month").format(
    cols=_cols(USAGE_NAMES))

# 同じ id は、比べる列のどれかが違うときだけ上書きする。返る行が無ければ「変わらない」
UPSERT_ENTRY = sql.SQL(
    "insert into public.feed_entries as t ({cols}) values ({vals}) "
    "on conflict (id) do update set {sets} "
    "where ({cur}) is distinct from ({new}) "
    "returning (xmax = 0) as inserted"
).format(
    cols=_cols(ENTRY_NAMES),
    vals=_values(ENTRY_COLUMNS),
    sets=sql.SQL(", ").join(
        sql.SQL("{c} = excluded.{c}").format(c=sql.Identifier(c)) for c in SET_NAMES),
    cur=_cols(COMPARE_NAMES, "t"),
    new=sql.SQL(", ").join(
        sql.SQL("({t} or {e})").format(t=sql.Identifier("t", c), e=sql.Identifier("excluded", c))
        if c == "exploited" else sql.Identifier("excluded", c)
        for c in COMPARE_NAMES),
)

# 月ごとに大きいほうを残す。chars・requests のどちらも増えないときは書かない
UPSERT_USAGE = sql.SQL(
    "insert into public.feed_translate_usage as u ({cols}) values ({vals}) "
    "on conflict (month) do update set "
    "chars = greatest(u.chars, excluded.chars), "
    "requests = greatest(u.requests, excluded.requests), "
    "updated_at = greatest(u.updated_at, excluded.updated_at) "
    "where excluded.chars > u.chars or excluded.requests > u.requests "
    "returning (xmax = 0) as inserted"
).format(cols=_cols(USAGE_NAMES), vals=_values(USAGE_COLUMNS))


# ---------------------------------------------------------------
# 接続
# ---------------------------------------------------------------
def build_backup_conninfo(url: str, ca_path: str | None) -> str:
    """同期の build_conninfo(localhost 以外は verify-full と --ca)を使い、application_name だけ替える。"""
    params: dict[str, Any] = conninfo_to_dict(build_conninfo(url, ca_path))
    params["application_name"] = APP_NAME
    try:
        return make_conninfo("", **params)
    except Exception:
        raise DbError("E-DB-CONFIG") from None


def connect(url: str, ca_path: str | None) -> psycopg.Connection[Any]:
    conninfo = build_backup_conninfo(url, ca_path)
    try:
        return psycopg.connect(conninfo, autocommit=False, prepare_threshold=None)
    except Exception:
        raise DbError("E-DB-CONNECT") from None


# ---------------------------------------------------------------
# 値 ⇔ JSON
# ---------------------------------------------------------------
def _ts(v: dt.datetime | None) -> str | None:
    return None if v is None else v.astimezone(UTC).strftime(TS_FORMAT)


def _to_json_value(v: Any) -> Any:
    """DB の値を JSON の値にする。時刻は UTC の ISO 8601、numeric は文字列、date は YYYY-MM-DD。"""
    if isinstance(v, dt.datetime):
        return _ts(v)
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, list):
        return [_to_json_value(x) for x in v]
    return v


def _line(names: tuple[str, ...], row: tuple[Any, ...]) -> bytes:
    # キーは列の順(sort_keys を使わない)。区切りの空白を入れず、同じ中身なら同じバイト列にする
    obj = {n: _to_json_value(v) for n, v in zip(names, row, strict=True)}
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"


def month_key(first_seen_at: dt.datetime) -> str:
    """first_seen_at の日本時間の年と月(ファイル名の元。整数から作る)。"""
    j = first_seen_at.astimezone(JST)
    return f"{j.year:04d}-{j.month:02d}"


# ---------------------------------------------------------------
# 書き出し
# ---------------------------------------------------------------
@dataclass
class BackupResult:
    months: list[tuple[str, int]] = field(default_factory=list)  # (YYYY-MM, 行数)
    usage: int = 0

    @property
    def total(self) -> int:
        return sum(n for _, n in self.months)


def read_all(conn: psycopg.Connection[Any]) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    """2表を1つの読むだけのトランザクション(同じ時点のスナップショット)で読む。"""
    try:
        with conn.transaction():
            conn.execute("set transaction isolation level repeatable read, read only")
            conn.execute("set local statement_timeout = '120s'")
            entries = conn.execute(SELECT_ENTRIES).fetchall()
            usage = conn.execute(SELECT_USAGE).fetchall()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None
    return entries, usage


def _check_dir(path: str) -> None:
    """シンボリックリンクでない、ふつうのフォルダであること。"""
    try:
        st = os.lstat(path)
    except OSError:
        raise BackupError("E-BACKUP-OUT") from None
    if not stat.S_ISDIR(st.st_mode):
        raise BackupError("E-BACKUP-OUT")


def _write_new(path: str, data: bytes) -> None:
    # O_EXCL と O_NOFOLLOW:前もって消してから、新しいファイルとして作る(リンクの先に書かない)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "wb") as f:
        f.write(data)


def write_backup(out_dir: str, entries: list[tuple[Any, ...]], usage: list[tuple[Any, ...]]) -> BackupResult:
    """feed/ を空にしてから、月ごとのファイルと usage.jsonl を書く。"""
    _check_dir(out_dir)
    feed_dir = os.path.join(out_dir, FEED_DIR)
    fs_index = ENTRY_NAMES.index("first_seen_at")
    id_index = ENTRY_NAMES.index("id")
    by_month: dict[str, list[tuple[Any, ...]]] = {}
    for row in entries:
        by_month.setdefault(month_key(row[fs_index]), []).append(row)
    try:
        if os.path.lexists(feed_dir):
            _check_dir(feed_dir)
            with os.scandir(feed_dir) as it:
                names = [(e.name, e.is_dir(follow_symlinks=False)) for e in it]
            if any(is_dir for _, is_dir in names):
                raise BackupError("E-BACKUP-OUT")  # feed/ の下にフォルダは作らない。消さずに止まる
            for name, _ in names:
                os.unlink(os.path.join(feed_dir, name))  # リンクなら、リンクそのものを消す
        else:
            os.mkdir(feed_dir)
        result = BackupResult()
        for key in sorted(by_month):
            rows = sorted(by_month[key], key=lambda r: r[id_index])  # DB の照合順序に頼らず id の順にする
            _write_new(os.path.join(feed_dir, f"{key}.jsonl"), b"".join(_line(ENTRY_NAMES, r) for r in rows))
            result.months.append((key, len(rows)))
        usage_path = os.path.join(out_dir, USAGE_FILE)
        if os.path.lexists(usage_path):
            if os.path.isdir(usage_path) and not os.path.islink(usage_path):
                raise BackupError("E-BACKUP-OUT")
            os.unlink(usage_path)
        rows_u = sorted(usage, key=lambda r: r[0])
        _write_new(usage_path, b"".join(_line(USAGE_NAMES, r) for r in rows_u))
        result.usage = len(rows_u)
    except OSError:
        raise BackupError("E-BACKUP-WRITE") from None
    return result


def backup(conn: psycopg.Connection[Any], out_dir: str) -> BackupResult:
    _check_dir(out_dir)  # DB を読む前に、書き出し先を確かめる
    entries, usage = read_all(conn)
    return write_backup(out_dir, entries, usage)


# ---------------------------------------------------------------
# 戻しの検査
# ---------------------------------------------------------------
class _Bad(Exception):
    pass


def _reject_constant(_: str) -> Any:
    raise _Bad()


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    d: dict[str, Any] = {}
    for k, v in pairs:
        if k in d:
            raise _Bad()  # 同じキーが2回
        d[k] = v
    return d


def _text(v: Any, *, nullable: bool = False, min_len: int = 0, max_len: int) -> str | None:
    if v is None and nullable:
        return None
    if not isinstance(v, str):
        raise _Bad()
    if "\x00" in v:
        raise _Bad()  # PostgreSQL の text に NUL は入らない
    try:
        v.encode("utf-8")
    except UnicodeEncodeError:
        raise _Bad() from None  # 対になっていないサロゲート
    if not min_len <= len(v) <= max_len:
        raise _Bad()  # len は文字の数(char_length と同じ)
    return v


def _match(v: Any, pattern: re.Pattern[str]) -> str:
    if not isinstance(v, str) or pattern.fullmatch(v) is None:
        raise _Bad()
    return v


def _in(v: Any, allowed: frozenset[str], *, nullable: bool = False) -> str | None:
    if v is None and nullable:
        return None
    if not isinstance(v, str) or v not in allowed:
        raise _Bad()
    return v


def _int(v: Any, lo: int, hi: int) -> int:
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise _Bad()
    return v


def _parse_ts(v: Any, *, nullable: bool = False) -> dt.datetime | None:
    if v is None and nullable:
        return None
    s = _match(v, TS_RE)
    try:
        return dt.datetime.strptime(s, TS_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        raise _Bad() from None


def _parse_date(v: Any, *, nullable: bool = False) -> dt.date | None:
    if v is None and nullable:
        return None
    s = _match(v, DATE_RE)
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise _Bad() from None


def _parse_object(raw: bytes, names: tuple[str, ...]) -> dict[str, Any]:
    try:
        obj = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise _Bad() from None
    if not isinstance(obj, dict) or set(obj) != set(names):
        raise _Bad()  # キーは列の名前ちょうど(足りない・余分は不正)
    return obj


def parse_entry(raw: bytes) -> dict[str, Any]:
    """1行を 0002 の列の型と CHECK で確かめ、書き込みに渡す値にする。合わなければ _Bad。"""
    o = _parse_object(raw, ENTRY_NAMES)
    r: dict[str, Any] = {
        "id": _match(o["id"], ID_RE),
        "source_id": _match(o["source_id"], SOURCE_ID_RE),
        "kind": _in(o["kind"], KINDS),
        "vendor": _text(o["vendor"], max_len=100),
        "product": _text(o["product"], max_len=100),
        "title": _text(o["title"], min_len=1, max_len=500),
        "summary": _text(o["summary"], max_len=2000),
        "url": _text(o["url"], nullable=True, max_len=2000),
        "published_at": _parse_ts(o["published_at"], nullable=True),
        "first_seen_at": _parse_ts(o["first_seen_at"]),
        "lang": _in(o["lang"], LANGS),
        "title_ja": _text(o["title_ja"], nullable=True, max_len=1000),
        "summary_ja": _text(o["summary_ja"], nullable=True, max_len=4000),
        "translate_status": _in(o["translate_status"], TRANSLATE_STATUSES),
        "translate_attempts": _int(o["translate_attempts"], 0, 10),
        "translated_at": _parse_ts(o["translated_at"], nullable=True),
        "severity": _in(o["severity"], SEVERITIES, nullable=True),
        "status": _text(o["status"], max_len=40),
        "digest_date": _parse_date(o["digest_date"], nullable=True),
        "updated_at": _parse_ts(o["updated_at"]),
    }
    if r["url"] is not None and not r["url"].startswith("https://"):
        raise _Bad()  # url は https だけ
    cves = o["cve_ids"]
    if not isinstance(cves, list) or len(cves) > 50:
        raise _Bad()
    r["cve_ids"] = [_match(c, CVE_RE) for c in cves]
    cvss = o["cvss"]
    if cvss is None:
        r["cvss"] = None
    else:
        try:
            d = Decimal(_match(cvss, CVSS_RE))  # numeric(3,1):小数は1桁まで
        except InvalidOperation:
            raise _Bad() from None
        if not Decimal(0) <= d <= Decimal(10):
            raise _Bad()
        r["cvss"] = d
    if not isinstance(o["exploited"], bool):
        raise _Bad()
    r["exploited"] = o["exploited"]
    # 表の CHECK(feed_translate_done・feed_translate_ja_skip・feed_vuln_only)
    if r["translate_status"] == "done" and (r["title_ja"] is None or r["translated_at"] is None):
        raise _Bad()
    if r["lang"] == "ja" and r["translate_status"] != "skip":
        raise _Bad()
    if r["kind"] != "vuln" and (r["cve_ids"] or r["severity"] is not None or r["cvss"] is not None
                                or r["exploited"]):
        raise _Bad()
    return r


def parse_usage(raw: bytes) -> dict[str, Any]:
    o = _parse_object(raw, USAGE_NAMES)
    month = _parse_date(o["month"])
    if month is None or month.day != 1:  # 月の初日だけ(0002 の CHECK)
        raise _Bad()
    return {"month": month, "chars": _int(o["chars"], 0, BIGINT_MAX),
            "requests": _int(o["requests"], 0, INT_MAX), "updated_at": _parse_ts(o["updated_at"])}


@dataclass
class Loaded:
    entries: list[dict[str, Any]] = field(default_factory=list)
    usage: list[dict[str, Any]] = field(default_factory=list)
    bad: list[tuple[str, int]] = field(default_factory=list)  # (ファイル名, 行番号)。ファイル名は形を確かめたものだけ


def _read_file(path: str) -> bytes:
    """シンボリックリンクでない、ふつうのファイルを読む(上限つき)。"""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        raise BackupError("E-RESTORE-FILE") from None
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_FILE_BYTES:
            raise BackupError("E-RESTORE-FILE")
        data = f.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise BackupError("E-RESTORE-FILE")
    return data


def _lines(data: bytes) -> list[bytes]:
    if not data:
        return []
    parts = data.split(b"\n")
    if parts[-1] == b"":
        parts.pop()  # 最後の改行の後ろ
    return parts


def _parse_lines(label: str, data: bytes, parse: Callable[[bytes], dict[str, Any]], key: str,
                 dest: list[dict[str, Any]], bad: list[tuple[str, int]]) -> None:
    seen = {r[key] for r in dest}
    for n, raw in enumerate(_lines(data), start=1):
        try:
            row = parse(raw)
        except _Bad:
            bad.append((label, n))
            continue
        if row[key] in seen:
            bad.append((label, n))  # 同じ id・同じ月が2回(どちらで上書きするかが決まらない)
            continue
        seen.add(row[key])
        dest.append(row)


def load_backup(in_dir: str) -> Loaded:
    """--in の下の feed/*.jsonl と usage.jsonl を読み、全部の行を確かめる(DB にはまだ触れない)。

    ファイルの形がおかしい(feed/ が無い・名前の形が違う・リンク・フォルダ)ときは BackupError("E-RESTORE-FILE")。
    """
    try:
        _check_dir(in_dir)
        feed_dir = os.path.join(in_dir, FEED_DIR)
        _check_dir(feed_dir)
    except BackupError:
        raise BackupError("E-RESTORE-FILE") from None
    try:
        with os.scandir(feed_dir) as it:
            names = sorted(e.name for e in it)
    except OSError:
        raise BackupError("E-RESTORE-FILE") from None
    loaded = Loaded()
    for name in names:
        m = MONTH_FILE_RE.fullmatch(name)
        if m is None or not 1 <= int(m.group(2)) <= 12:
            raise BackupError("E-RESTORE-FILE")  # 名前は出さない(形を確かめていない値なので)
        # 要約に出す名前は、形を確かめた年と月から作り直す
        label = f"{FEED_DIR}/{m.group(1)}-{m.group(2)}.jsonl"
        _parse_lines(label, _read_file(os.path.join(feed_dir, name)), parse_entry, "id",
                     loaded.entries, loaded.bad)
    _parse_lines(USAGE_FILE, _read_file(os.path.join(in_dir, USAGE_FILE)), parse_usage, "month",
                 loaded.usage, loaded.bad)
    return loaded


# ---------------------------------------------------------------
# 戻しの書き込み
# ---------------------------------------------------------------
@dataclass
class RestoreCounts:
    read: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0


def restore(conn: psycopg.Connection[Any], loaded: Loaded) -> tuple[RestoreCounts, RestoreCounts]:
    """1つのトランザクションで upsert する。(feed_entries の数, feed_translate_usage の数)。

    途中で失敗したら全部を取り消して DbError("E-DB-WRITE")(どの行も変わらない)。
    """
    e_counts = RestoreCounts(read=len(loaded.entries))
    u_counts = RestoreCounts(read=len(loaded.usage))
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '60s'")
            with conn.cursor() as cur:
                _upsert_many(cur, UPSERT_ENTRY, loaded.entries, e_counts)
                _upsert_many(cur, UPSERT_USAGE, loaded.usage, u_counts)
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
    return e_counts, u_counts


def _upsert_many(cur: psycopg.Cursor[Any], query: sql.Composed, rows: list[dict[str, Any]],
                 c: RestoreCounts) -> None:
    """executemany でまとめて送る(pipeline。1行ごとに往復しない)。行ごとの returning で数える。"""
    if not rows:
        return
    cur.executemany(query, rows, returning=True)
    for _ in cur.results():
        _count(cur.fetchone(), c)


def _count(row: tuple[Any, ...] | None, c: RestoreCounts) -> None:
    if row is None:
        c.unchanged += 1  # where で上書きしなかった
    elif row[0]:
        c.inserted += 1
    else:
        c.updated += 1
