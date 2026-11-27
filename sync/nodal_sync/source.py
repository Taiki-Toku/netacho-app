"""ai-netacho の checkout を読む:履歴の検査(4.2 の 3)、ファイルの形の検査(詳細設計 2.4 の3)、
日ごとのファイルの一覧(4.2 の 4)。

git は配列で呼ぶ(シェルを使わない)。git に渡す値は、形を確かめた 40 桁の16進だけ。
"""

from __future__ import annotations

import datetime as dt
import os
import re
import stat
import subprocess
from dataclasses import dataclass, field
from typing import Callable

from .schema import MAX_FILE_BYTES, date_of_id

SHA_RE = re.compile(r"[0-9a-f]{40}")
ITEM_FILE_RE = re.compile(r"([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2})\.json")
GIT_TIMEOUT = 60


class SourceError(Exception):
    """履歴の検査・checkout の読み取りで止まった。code は決まりの番号。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _git(data_dir: str, args: list[str]) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(["git", *args], cwd=data_dir, capture_output=True,
                              timeout=GIT_TIMEOUT, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SourceError("E-GIT-RUN") from None


def head_commit(data_dir: str) -> str:
    p = _git(data_dir, ["rev-parse", "--verify", "HEAD^{commit}"])
    sha = p.stdout.decode("ascii", "replace").strip()
    if p.returncode != 0 or not SHA_RE.fullmatch(sha):
        raise SourceError("E-GIT-HEAD")
    return sha


def check_history(data_dir: str, last_commit: str, head: str,
                  is_author: Callable[[str], bool]) -> None:
    """last_commit から head までを調べる。通らなければ SourceError。

    - last_commit が head の祖先でない(終了コード 1 も 128 も)→ E-HISTORY-REWRITE
    - data/items/ を変えたコミット(マージを含む)の作者かコミットした人が authors に無い → E-HISTORY-AUTHOR
    """
    if not SHA_RE.fullmatch(last_commit) or not SHA_RE.fullmatch(head):
        raise SourceError("E-HISTORY-REWRITE")
    p = _git(data_dir, ["merge-base", "--is-ancestor", last_commit, head])
    if p.returncode != 0:
        raise SourceError("E-HISTORY-REWRITE")
    p = _git(data_dir, ["log", "--full-history", "-m", "--format=%H%x00%ae%x00%ce",
                        f"{last_commit}..{head}", "--", "data/items/"])
    if p.returncode != 0:
        raise SourceError("E-GIT-LOG")
    for line in p.stdout.split(b"\n"):
        if not line.strip():
            continue
        parts = line.split(b"\x00")
        if len(parts) != 3 or not SHA_RE.fullmatch(parts[0].decode("ascii", "replace")):
            raise SourceError("E-GIT-LOG")
        author = parts[1].decode("utf-8", "replace")
        committer = parts[2].decode("utf-8", "replace")
        if not (is_author(author) and is_author(committer)):
            raise SourceError("E-HISTORY-AUTHOR")


def check_clean(data_dir: str) -> None:
    """data/items/ に未コミット・追跡していない・無視されたファイルがあれば E-SRC-DIRTY。

    履歴の検査はコミットだけを見るので、読むファイルが HEAD の中身と同じことをここで確かめる。
    """
    p = _git(data_dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all",
                        "--ignored=matching", "--", "data/items/"])
    if p.returncode != 0 or p.stdout:
        raise SourceError("E-SRC-DIRTY")


# ファイルの形の検査(詳細設計 2.4 の3。K-063)。パスの全体に当てる(fullmatch)。
# \d は全角などの数字にも合うので [0-9] と書く。
DATA_PATH_RES = (
    re.compile(r"data/items/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}\.json"),
    re.compile(r"feed_digest/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json"),
    re.compile(r"ネタ/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}( [^/]*)?\.md"),
    re.compile(r"放送/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md"),
)


def is_data_path(path: str) -> bool:
    return any(r.fullmatch(path) for r in DATA_PATH_RES)


class TreeError(SourceError):
    """ファイルの形の検査で止まった(E-SRC-TREE)。paths は違反のパス(表示の前に report で整える)。"""

    def __init__(self, paths: list[str]) -> None:
        super().__init__("E-SRC-TREE")
        self.paths = paths


def _nul_fields(raw: bytes) -> list[bytes]:
    """-z の出力を bytes のまま NUL で区切る(空の欄は捨てる)。"""
    return [f for f in raw.split(b"\x00") if f]


def _decode_path(raw: bytes) -> str | None:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def check_tree(data_dir: str, head: str, files: dict[str, str]) -> None:
    """今の木(head)の全部のファイルを調べる。違反があれば TreeError。

    - 種類が blob でモードが 100644 でない(リンク・実行ファイル・サブモジュール)→ 違反
    - パスがデータの形に合えば通す。合わなければ、files に同じパスと同じ blob の SHA があれば通す
    - UTF-8 で読めないパス・files にあって木に無いパス → 違反
    """
    if not SHA_RE.fullmatch(head):
        raise SourceError("E-GIT-HEAD")
    p = _git(data_dir, ["ls-tree", "-r", "-z", "--full-tree", head])
    if p.returncode != 0:
        raise SourceError("E-GIT-LOG")
    bad: list[str] = []
    seen: set[str] = set()
    for entry in _nul_fields(p.stdout):
        meta, tab, raw_path = entry.partition(b"\t")
        parts = meta.split(b" ")
        if not tab or len(parts) != 3 or not raw_path:
            raise SourceError("E-GIT-LOG")
        mode, kind, oid = (x.decode("ascii", "replace") for x in parts)
        path = _decode_path(raw_path)
        if path is None:
            bad.append(raw_path.decode("utf-8", "replace"))
            continue
        seen.add(path)
        if kind != "blob" or mode != "100644":
            bad.append(path)
        elif is_data_path(path):
            continue
        elif files.get(path) != oid:
            bad.append(path)
    bad += [path for path in files if path not in seen]
    if bad:
        raise TreeError(sorted(set(bad)))


def check_tree_history(data_dir: str, last_commit: str, head: str, files: dict[str, str]) -> None:
    """last_commit..head で変わったパスに、データの形にも files にも無いものがあれば TreeError。

    足して次のコミットで消したファイル(今の木には無い)を拾う。-m でマージは親ごとに、
    --no-renames で名前の変更は「消したパスと足したパス」の両方を出す。
    """
    if not SHA_RE.fullmatch(last_commit) or not SHA_RE.fullmatch(head):
        raise SourceError("E-HISTORY-REWRITE")
    p = _git(data_dir, ["log", "--full-history", "-m", "--no-renames", "--name-only", "-z",
                        "--format=", f"{last_commit}..{head}"])
    if p.returncode != 0:
        raise SourceError("E-GIT-LOG")
    bad: set[str] = set()
    for raw_path in _nul_fields(p.stdout):
        path = _decode_path(raw_path)
        if path is None:
            bad.add(raw_path.decode("utf-8", "replace"))
        elif not is_data_path(path) and path not in files:
            bad.add(path)
    if bad:
        raise TreeError(sorted(bad))


@dataclass
class Listing:
    by_day: dict[dt.date, list[tuple[str, bytes | None]]] = field(default_factory=dict)
    bad_files: int = 0  # ファイル名が id の形でない・シンボリックリンク・普通のファイルでない


def _read_regular(path: str) -> bytes | None:
    """シンボリックリンクを辿らずに開き、普通のファイルなら先頭の 64 KB + 1 バイトまで読む。"""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        chunks: list[bytes] = []
        remaining = MAX_FILE_BYTES + 1
        while remaining > 0:
            b = os.read(fd, remaining)
            if not b:
                break
            chunks.append(b)
            remaining -= len(b)
        return b"".join(chunks)
    except OSError:
        return None
    finally:
        os.close(fd)


def list_items(data_dir: str, days: set[dt.date] | None) -> Listing:
    """data/items/ の直下を見る(サブフォルダは見ない)。days が None なら全部の日。"""
    items_dir = os.path.join(data_dir, "data", "items")
    try:
        st = os.lstat(items_dir)
    except OSError:
        raise SourceError("E-SRC-DIR") from None
    if not stat.S_ISDIR(st.st_mode):
        raise SourceError("E-SRC-DIR")

    out = Listing()
    try:
        entries = sorted(os.scandir(items_dir), key=lambda e: e.name)
    except OSError:
        raise SourceError("E-SRC-DIR") from None
    for entry in entries:
        if entry.is_symlink():
            out.bad_files += 1
            continue
        if entry.is_dir(follow_symlinks=False):
            continue
        m = ITEM_FILE_RE.fullmatch(entry.name)
        day = date_of_id(m.group(1)) if m else None
        if m is None or day is None:
            out.bad_files += 1
            continue
        if not entry.is_file(follow_symlinks=False):
            out.bad_files += 1
            continue
        if days is not None and day not in days:
            continue
        out.by_day.setdefault(day, []).append((m.group(1), _read_regular(entry.path)))
    return out
