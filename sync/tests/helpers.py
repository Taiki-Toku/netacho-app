"""試験の共通の部品。データはすべて架空の見本。"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

TODAY = dt.date(2026, 11, 20)
BOT = "bot@example.invalid"
OUTSIDER = "someone@example.invalid"
SHA_A = "a" * 40

CONFIG: dict[str, Any] = {
    "slots": ["取り組みに効く", "新着"],
    "authors": [BOT],
    "owner_login": "Taiki-Toku",
    "app_repo": "Taiki-Toku/netacho-app",
    "feed_checks": False,
}

GENRES = frozenset({"work", "agent", "local-llm", "security-news", "product", "creative", "tools", "idea"})

REMOVE = object()


def make_item(item_id: str = "2026-11-20-01", **over: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": item_id,
        "date": item_id[:10],
        "order": int(item_id[-2:]),
        "slot": "新着",
        "genre": "agent",
        "title": f"架空の見出し {item_id}",
        "lead": "架空のリード",
        "summary": "架空の要約",
        "points": ["要点1", "要点2", "要点3"],
        "excerpt": "",
        "tryit": "架空の試し方",
        "caution": "",
        "categories": ["架空の分類"],
        "projects": [],
        "tags": ["見本"],
        "sourceUrl": f"https://news.example.com/{item_id}",
        "sourceTitle": "架空の出典",
        "trust": "公式",
        "stars": {"hot": 3, "use": 2, "fun": 1},
        "publishedAt": item_id[:10],
    }
    for k, v in over.items():
        if v is REMOVE:
            d.pop(k, None)
        else:
            d[k] = v
    return d


def dump(obj: Any) -> bytes:
    # ensure_ascii:対になっていないサロゲートを入れた見本も書けるように
    return json.dumps(obj, ensure_ascii=True).encode("utf-8")


def blob_sha(data: bytes) -> str:
    """git の blob の SHA-1(git hash-object と同じ)。"""
    return hashlib.sha1(b"blob %d\x00" % len(data) + data).hexdigest()


# GitRepo が最初から置く、データの形に合わないファイル(架空の中身)と、それに合う一覧
TOOL_PATH = "tools/export.py"
TOOL_BODY = b"# fictional export tool\n"
FILES: dict[str, str] = {TOOL_PATH: blob_sha(TOOL_BODY)}


def write_files(path: Path, files: dict[str, Any] | None = None, raw: bytes | None = None) -> Path:
    """config フォルダに ai_netacho_files.json を置く。raw があればそのまま書く。"""
    p = path / "ai_netacho_files.json"
    p.write_bytes(raw if raw is not None else dump({"files": FILES if files is None else files}))
    return p


def write_config(path: Path, *, ai_files: dict[str, str] | None = None, **over: Any) -> str:
    """sync.json と、同じフォルダの ai_netacho_files.json(既定は FILES。ai_files で足す)を書く。"""
    cfg = dict(CONFIG)
    cfg.update(over)
    p = path / "sync.json"
    p.write_bytes(dump(cfg))
    write_files(path, {**FILES, **(ai_files or {})})
    return str(p)


class GitRepo:
    """tmp_path に作る一時のリポジトリ。グローバルの git の設定に頼らない。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.mkdir(parents=True, exist_ok=True)
        (path / "data" / "items").mkdir(parents=True, exist_ok=True)
        self.git("init", "-q", "-b", "main")
        self.put_file(TOOL_PATH, TOOL_BODY)  # 本物の ai-netacho の tools/ に当たるもの(最初のコミットに入る)

    def _env(self, author: str, committer: str) -> dict[str, str]:
        env = dict(os.environ)
        env.update({
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "test",
            "GIT_COMMITTER_NAME": "test",
            "GIT_AUTHOR_EMAIL": author,
            "GIT_COMMITTER_EMAIL": committer,
        })
        return env

    def git(self, *args: str, author: str = BOT, committer: str | None = None) -> str:
        p = subprocess.run(
            ["git", "-c", f"user.email={BOT}", "-c", "user.name=test", "-c", "commit.gpgsign=false",
             *args],
            cwd=self.path, env=self._env(author, committer or author),
            capture_output=True, check=True, timeout=60,
        )
        return p.stdout.decode().strip()

    def put_item(self, obj: dict[str, Any], name: str | None = None) -> None:
        (self.path / "data" / "items" / (name or f"{obj['id']}.json")).write_bytes(dump(obj))

    def put_file(self, rel: str, data: bytes) -> None:
        p = self.path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def commit(self, msg: str = "c", author: str = BOT, committer: str | None = None) -> str:
        self.git("add", "-A", author=author, committer=committer)
        self.git("commit", "-q", "--allow-empty", "-m", msg, author=author, committer=committer)
        return self.head()

    def head(self) -> str:
        return self.git("rev-parse", "HEAD")
