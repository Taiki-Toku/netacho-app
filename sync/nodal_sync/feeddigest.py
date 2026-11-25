"""翌朝のニュースへの受け渡し(依頼 12-7。詳細設計 3.15、REQ-D-06、K-037)。ロールは netacho_feed(select・insert・update だけ)。

- feed-digest:digest_date が null で first_seen_at が7日以内の行と、今日(日本時間)の digest_date の行を、
  --data-dir の下の feed_digest/YYYY-MM-DD.json に書く(DB は変えない)。7日より古い null の行は数えるだけ(E-DIGEST-OLD)
- feed-digest --commit-db --date:ワークフローの push の後に、その日のファイルの id の行の digest_date をその日にする
  (ファイルを先に全部確かめ、合わなければ何も書かない。1つのトランザクション)
- feed-digest-backlog --before:その日(日本時間)より前の null の行に、first_seen_at の日本時間の日付を付ける(1回だけ)
- 一覧に載せるのは ENTRY_KEYS だけ(題・本文・訳は入れない)。SQL は sql.SQL と値の引数で組む
- 書くファイルは --data-dir の下の feed_digest/YYYY-MM-DD.json だけ。パスは dt.date から固定の形で作る
- git の操作はしない(ワークフローが行う)。ログと要約には件数と日付だけを渡す
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import stat
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .db import DbError, build_conninfo

APP_NAME = "nodal-digest"
UTC = dt.timezone.utc
JST = dt.timezone(dt.timedelta(hours=9))
WINDOW = dt.timedelta(days=7)  # 5:35 の回が落ちても次の回が拾う(基本設計 4.10)
VERSION = 1
DIGEST_DIR = "feed_digest"
MAX_FILE_BYTES = 4 * 1024 * 1024  # --commit-db で読むファイルの上限(メモリを使い切らないように)

# 一覧の1件のキー(この順で書く)。題・本文・訳は入れない(外の文章を配信タスクの AI に渡す量を増やさない)
ENTRY_KEYS: tuple[str, ...] = ("id", "kind", "vendor", "product", "cve_ids", "url", "published_at", "status")
FILE_KEYS = frozenset({"version", "date", "entries"})
ID_RE = re.compile(r"[0-9a-f]{32}")
DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class DigestError(Exception):
    """決まりの番号だけを持つ失敗(終了コード 2)。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def parse_day(value: str | None) -> dt.date | None:
    """YYYY-MM-DD の形で、実在する日付だけを返す(ほかは None)。ファイルのパスはこの値から作る。"""
    if value is None or DATE_RE.fullmatch(value) is None:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def jst_today(now: dt.datetime) -> dt.date:
    return now.astimezone(JST).date()


def jst_midnight(day: dt.date) -> dt.datetime:
    """その日の日本時間 0 時(timestamptz に渡す値)。"""
    return dt.datetime.combine(day, dt.time(0), JST)


# ---------------------------------------------------------------
# SQL(固定の文と値の引数だけ)
# ---------------------------------------------------------------
# 対象:今日の digest_date の行(同じ日の2回目で載せ直す)と、7日以内の null の行。並びは sort_at の新しい順
SELECT_DIGEST = sql.SQL(
    "select {cols} from public.feed_entries "
    "where digest_date = %(today)s::date "
    "or (digest_date is null and first_seen_at >= %(cutoff)s::timestamptz) "
    "order by sort_at desc, id"
).format(cols=sql.SQL(", ").join([sql.Identifier(c) for c in ENTRY_KEYS] + [sql.Identifier("digest_date")]))

COUNT_OLD = sql.SQL(
    "select count(*) from public.feed_entries "
    "where digest_date is null and first_seen_at < %(cutoff)s::timestamptz")

# その日の値と違う行だけを変える(同じ値の行を書き直すと guard が updated_at を今にし、バックアップの差分が増える)
COMMIT_DIGEST = sql.SQL(
    "update public.feed_entries set digest_date = %(day)s::date "
    "where id = any(%(ids)s::text[]) and digest_date is distinct from %(day)s::date")

COUNT_IDS = sql.SQL("select count(*) from public.feed_entries where id = any(%(ids)s::text[])")

# first_seen_at の日本時間の日付(UTC に 9 時間を足した日付。地域の名前の表に頼らない)
BACKLOG = sql.SQL(
    "update public.feed_entries "
    "set digest_date = ((first_seen_at at time zone 'UTC') + interval '9 hours')::date "
    "where digest_date is null and first_seen_at < %(before)s::timestamptz")


# ---------------------------------------------------------------
# 接続
# ---------------------------------------------------------------
def build_digest_conninfo(url: str, ca_path: str | None) -> str:
    """同期の build_conninfo(localhost 以外は verify-full と --ca)を使い、application_name だけ替える。"""
    params: dict[str, Any] = conninfo_to_dict(build_conninfo(url, ca_path))
    params["application_name"] = APP_NAME
    try:
        return make_conninfo("", **params)
    except Exception:
        raise DbError("E-DB-CONFIG") from None


def connect(url: str, ca_path: str | None) -> psycopg.Connection[Any]:
    conninfo = build_digest_conninfo(url, ca_path)
    try:
        return psycopg.connect(conninfo, autocommit=False, prepare_threshold=None)
    except Exception:
        raise DbError("E-DB-CONNECT") from None


# ---------------------------------------------------------------
# 一覧を作る
# ---------------------------------------------------------------
@dataclass
class Digest:
    day: dt.date
    entries: list[dict[str, Any]]
    today_rows: int = 0  # 今日の digest_date の行(同じ日の2回目で載せ直した数)
    new_rows: int = 0    # null の行(新しく載せた数)
    old: int = 0         # 7日より古い null の行(入れずに数えるだけ。E-DIGEST-OLD)


def _ts(v: dt.datetime | None) -> str | None:
    return None if v is None else v.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entry(row: tuple[Any, ...]) -> dict[str, Any]:
    """DB の1行を一覧の1件にする。キーは ENTRY_KEYS の順。形は DB の CHECK に加えてここでも確かめる。"""
    r = dict(zip(ENTRY_KEYS, row[:len(ENTRY_KEYS)], strict=True))
    if not isinstance(r["id"], str) or ID_RE.fullmatch(r["id"]) is None:
        raise DigestError("E-DIGEST-ROW")
    if r["url"] is not None and (not isinstance(r["url"], str) or not r["url"].startswith("https://")):
        raise DigestError("E-DIGEST-ROW")  # url は https だけ(null は null のまま)
    r["cve_ids"] = list(r["cve_ids"])
    r["published_at"] = _ts(r["published_at"])
    return r


def build(conn: psycopg.Connection[Any], now: dt.datetime) -> Digest:
    """読むだけのトランザクション(同じ時点のスナップショット)で一覧を作る。DB は変えない。"""
    day = jst_today(now)
    params = {"today": day, "cutoff": now - WINDOW}
    try:
        with conn.transaction():
            conn.execute("set transaction isolation level repeatable read, read only")
            conn.execute("set local statement_timeout = '60s'")
            rows = conn.execute(SELECT_DIGEST, params).fetchall()
            old_row = conn.execute(COUNT_OLD, params).fetchone()
    except psycopg.Error:
        raise DbError("E-DB-READ") from None
    d = Digest(day=day, entries=[_entry(r) for r in rows], old=int(old_row[0]) if old_row else 0)
    d.today_rows = sum(1 for r in rows if r[len(ENTRY_KEYS)] is not None)
    d.new_rows = len(rows) - d.today_rows
    return d


def render(d: Digest) -> bytes:
    """キーの順は固定(sort_keys を使わない)。ensure_ascii=False、NaN は入れない。同じ中身なら同じバイト列。"""
    obj = {"version": VERSION, "date": d.day.isoformat(), "entries": d.entries}
    return json.dumps(obj, ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n"


# ---------------------------------------------------------------
# ファイル(--data-dir の下の feed_digest/YYYY-MM-DD.json だけ)
# ---------------------------------------------------------------
def _is_real_dir(path: str) -> bool:
    try:
        return stat.S_ISDIR(os.lstat(path).st_mode)  # lstat:リンクはフォルダとみなさない
    except OSError:
        return False


def digest_path(data_dir: str, day: dt.date) -> str:
    # 名前は dt.date の isoformat(YYYY-MM-DD)だけから作る。外から来た文字はパスに入れない
    return os.path.join(data_dir, DIGEST_DIR, f"{day.isoformat()}.json")


def _open_digest_dir(data_dir: str, create: bool) -> int:
    """feed_digest/ を O_DIRECTORY|O_NOFOLLOW で開く(リンクなら OSError)。この fd を基準に開けば、
    確かめた後にフォルダをリンクに差し替えられても、リンクの先には書かない。"""
    # normpath で末尾の / を取る(「link/」の形だと O_NOFOLLOW でもリンクをたどるため)
    base = os.open(os.path.normpath(data_dir), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if create:
            try:
                os.mkdir(DIGEST_DIR, dir_fd=base)
            except FileExistsError:
                pass  # あるものがリンク・ふつうのファイルなら、次の open が OSError になる
        return os.open(DIGEST_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=base)
    finally:
        os.close(base)


def write_file(data_dir: str, d: Digest) -> str:
    """feed_digest/ が無ければ作り、その日のファイルを書き直す。返すのは --data-dir からの相対パス。"""
    if not _is_real_dir(os.path.normpath(data_dir)):
        raise DigestError("E-ARGS-DATA-DIR")
    name =f"{d.day.isoformat()}.json"  # dt.date から作った名前だけ
    data = render(d)
    try:
        dfd = _open_digest_dir(data_dir, create=True)
    except OSError:
        raise DigestError("E-DIGEST-WRITE") from None  # feed_digest/ がリンク・ふつうのファイル
    try:
        try:
            st: os.stat_result | None = os.stat(name, dir_fd=dfd, follow_symlinks=False)
        except FileNotFoundError:
            st = None
        if st is not None:
            if not stat.S_ISREG(st.st_mode):
                raise DigestError("E-DIGEST-WRITE")  # フォルダ・リンクは消さずに止まる
            os.unlink(name, dir_fd=dfd)
        # O_EXCL と O_NOFOLLOW:新しいファイルとして作る(リンクの先に書かない)
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=dfd)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    except OSError:
        raise DigestError("E-DIGEST-WRITE") from None
    finally:
        os.close(dfd)
    return f"{DIGEST_DIR}/{name}"


def _reject_constant(_: str) -> Any:
    raise ValueError("constant")


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    d: dict[str, Any] = {}
    for k, v in pairs:
        if k in d:
            raise ValueError("duplicate key")
        d[k] = v
    return d


def read_ids(data_dir: str, day: dt.date) -> list[str]:
    """その日のファイルを読み、形と id を全部確かめる。1つでも合わなければ DigestError("E-DIGEST-FILE")。"""
    try:
        dfd = _open_digest_dir(data_dir, create=False)  # --data-dir・feed_digest/ がリンクなら開かない
    except OSError:
        raise DigestError("E-DIGEST-FILE") from None
    try:
        # O_NONBLOCK:名前付きパイプでも開くところで待ち続けない(次の fstat で、ふつうのファイルでなければ止まる)
        fd = os.open(f"{day.isoformat()}.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dfd)
    except OSError:
        raise DigestError("E-DIGEST-FILE") from None
    finally:
        os.close(dfd)
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_FILE_BYTES:
            raise DigestError("E-DIGEST-FILE")
        raw = f.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise DigestError("E-DIGEST-FILE")
    try:
        obj = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise DigestError("E-DIGEST-FILE") from None
    if (not isinstance(obj, dict) or set(obj) != FILE_KEYS
            or type(obj["version"]) is not int or obj["version"] != VERSION  # True・1.0 は通さない
            or obj["date"] != day.isoformat() or not isinstance(obj["entries"], list)):
        raise DigestError("E-DIGEST-FILE")
    ids: list[str] = []
    seen: set[str] = set()
    for e in obj["entries"]:
        if not isinstance(e, dict) or set(e) != set(ENTRY_KEYS):
            raise DigestError("E-DIGEST-FILE")
        i = e["id"]
        if not isinstance(i, str) or ID_RE.fullmatch(i) is None or i in seen:
            raise DigestError("E-DIGEST-FILE")  # id の形が違う・同じ id が2回
        seen.add(i)
        ids.append(i)
    return ids


# ---------------------------------------------------------------
# DB に書く(--commit-db と backlog)
# ---------------------------------------------------------------
@dataclass
class CommitResult:
    listed: int = 0     # ファイルの id の数
    updated: int = 0    # digest_date をその日にした行
    unchanged: int = 0  # もうその日だった行
    missing: int = 0    # DB に無い id


def commit_db(conn: psycopg.Connection[Any], day: dt.date, ids: list[str]) -> CommitResult:
    """ファイルの id の行だけを、1つのトランザクションでその日にする。失敗したら全部を取り消す。"""
    res = CommitResult(listed=len(ids))
    if not ids:
        return res
    params = {"day": day, "ids": ids}
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '30s'")
            found_row = conn.execute(COUNT_IDS, params).fetchone()
            cur = conn.execute(COMMIT_DIGEST, params)
            res.updated = cur.rowcount
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
    found = int(found_row[0]) if found_row else 0
    res.missing = len(ids) - found
    res.unchanged = found - res.updated
    return res


def backlog(conn: psycopg.Connection[Any], before: dt.date) -> int:
    """その日(日本時間)より前の null の行に、first_seen_at の日本時間の日付を付ける。付けた行の数。"""
    try:
        with conn.transaction():
            conn.execute("set local statement_timeout = '60s'")
            cur = conn.execute(BACKLOG, {"before": jst_midnight(before)})
            return cur.rowcount
    except psycopg.Error:
        raise DbError("E-DB-WRITE") from None
