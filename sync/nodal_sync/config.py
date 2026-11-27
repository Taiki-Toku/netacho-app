"""設定(netacho-sync の config/sync.json と ai_netacho_files.json)を読んで形を確かめる
(依頼 10-1 の 4.6、依頼 14-1。詳細設計 2.9)。"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

from .schema import JsonFileError, has_bad_chars, parse_json_strict
from .source import is_data_path

MAX_CONFIG_BYTES = 64 * 1024
KEYS = frozenset({"slots", "authors", "owner_login", "app_repo", "feed_checks"})

AUTHOR_RE = re.compile(r"[^@\s]+@[^@\s]+")
# GitHub のログイン名:英数字とハイフン、39 字まで、ハイフンで始まらず終わらず、続かない
LOGIN_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}")
REPO_NAME_RE = re.compile(r"[A-Za-z0-9._-]{1,100}")


class ConfigError(Exception):
    """設定が読めない・形が違う。表示するのは決まりの番号だけ。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Config:
    slots: tuple[str, ...]
    authors: frozenset[str]  # 小文字にしたもの
    owner_login: str
    app_repo: str
    feed_checks: bool

    def is_author(self, email: str) -> bool:
        return email.lower() in self.authors


def _str_list(v: Any, lo_n: int, hi_n: int) -> list[str] | None:
    if not isinstance(v, list) or not lo_n <= len(v) <= hi_n:
        return None
    if not all(isinstance(x, str) for x in v):
        return None
    return list(v)


def parse_config(obj: Any) -> Config:
    if not isinstance(obj, dict) or set(obj) != KEYS:
        raise ConfigError("E-CONFIG-KEYS")

    slots = _str_list(obj["slots"], 1, 20)
    if slots is None or not all(1 <= len(s) <= 40 and not has_bad_chars(s) for s in slots):
        raise ConfigError("E-CONFIG-SLOTS")

    authors = _str_list(obj["authors"], 1, 10)
    if authors is None or not all(len(a) <= 254 and AUTHOR_RE.fullmatch(a) for a in authors):
        raise ConfigError("E-CONFIG-AUTHORS")

    owner = obj["owner_login"]
    if not isinstance(owner, str) or not LOGIN_RE.fullmatch(owner):
        raise ConfigError("E-CONFIG-OWNER")

    repo = obj["app_repo"]
    if not isinstance(repo, str) or repo.count("/") != 1:
        raise ConfigError("E-CONFIG-REPO")
    repo_owner, repo_name = repo.split("/")
    if (not LOGIN_RE.fullmatch(repo_owner) or not REPO_NAME_RE.fullmatch(repo_name)
            or repo_name in (".", "..")):
        raise ConfigError("E-CONFIG-REPO")

    feed_checks = obj["feed_checks"]
    if not isinstance(feed_checks, bool):
        raise ConfigError("E-CONFIG-FEED-CHECKS")

    return Config(
        slots=tuple(slots),
        authors=frozenset(a.lower() for a in authors),
        owner_login=owner,
        app_repo=repo,
        feed_checks=feed_checks,
    )


def load_config(path: str) -> Config:
    try:
        with open(path, "rb") as f:
            raw = f.read(MAX_CONFIG_BYTES + 1)
    except OSError:
        raise ConfigError("E-CONFIG-READ") from None
    if len(raw) > MAX_CONFIG_BYTES:
        raise ConfigError("E-CONFIG-READ")
    try:
        obj = parse_json_strict(raw)
    except JsonFileError:
        raise ConfigError("E-CONFIG-JSON") from None
    return parse_config(obj)


# ai_netacho_files.json(詳細設計 2.9。K-063):データの形に合わないファイルの一覧
FILES_NAME = "ai_netacho_files.json"
MAX_FILES = 500
MAX_FILE_PATH = 300
MAX_FILES_BYTES = 1024 * 1024  # 300 字 × UTF-8 の 3 バイト × 500 件より大きく
BLOB_SHA_RE = re.compile(r"[0-9a-f]{40}")


def files_path(config_path: str) -> str:
    """--config と同じフォルダの ai_netacho_files.json。"""
    return os.path.join(os.path.dirname(os.path.abspath(config_path)), FILES_NAME)


def parse_files(obj: Any) -> dict[str, str]:
    if not isinstance(obj, dict) or set(obj) != {"files"}:
        raise ConfigError("E-CONFIG-FILES")
    files = obj["files"]
    if not isinstance(files, dict) or len(files) > MAX_FILES:
        raise ConfigError("E-CONFIG-FILES")
    for path, sha in files.items():
        if (not isinstance(path, str) or not 1 <= len(path) <= MAX_FILE_PATH
                or not isinstance(sha, str) or not BLOB_SHA_RE.fullmatch(sha)
                or is_data_path(path)):
            raise ConfigError("E-CONFIG-FILES")
    return dict(files)


def load_files(config_path: str) -> dict[str, str]:
    """無い・読めない・形が違えば E-CONFIG-FILES(fail-closed)。"""
    try:
        with open(files_path(config_path), "rb") as f:
            raw = f.read(MAX_FILES_BYTES + 1)
    except OSError:
        raise ConfigError("E-CONFIG-FILES") from None
    if len(raw) > MAX_FILES_BYTES:
        raise ConfigError("E-CONFIG-FILES")
    try:
        obj = parse_json_strict(raw)
    except JsonFileError:
        raise ConfigError("E-CONFIG-FILES") from None
    return parse_files(obj)
