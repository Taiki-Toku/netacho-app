"""ghapi の試験。HTTP の部品を差し替え、ネットワークに出ない。TST-SYNC-18。"""

from __future__ import annotations

import json
from typing import Any, Callable

import pytest

from nodal_sync import ghapi

REPO = "Taiki-Toku/netacho-app"
OWNER = "Taiki-Toku"
S = "b" * 40


def fake_api(*, pulls: list[dict[str, Any]] | None = None, merged_by: Any = None,
             failures: dict[str, list[Any]] | None = None) -> tuple[Callable[..., Any], list[str]]:
    """failures は URL の末尾 → 先に返す失敗(状態コードか Transient)の一覧。"""
    calls: list[str] = []
    fails = {k: list(v) for k, v in (failures or {}).items()}
    if pulls is None:
        pulls = [{"number": 7, "merged_at": "2026-11-20T00:00:00Z", "merge_commit_sha": S,
                  "base": {"ref": "main"}, "title": "架空の PR の題"}]
    if merged_by is None:
        merged_by = {"login": OWNER}

    def get(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
        assert url.startswith("https://api.github.com/repos/" + REPO + "/")
        assert headers["Authorization"] == "Bearer test-token"
        assert headers["Accept"] == "application/vnd.github+json"
        assert headers["X-GitHub-Api-Version"] == "2022-11-28"
        calls.append(url)
        for suffix, queue in fails.items():
            if url.endswith(suffix) and queue:
                f = queue.pop(0)
                if f is ghapi.Transient:
                    raise ghapi.Transient()
                return f, b""
        if url.endswith("/commits/main"):
            return 200, json.dumps({"sha": S}).encode()
        if url.endswith(f"/commits/{S}/pulls"):
            return 200, json.dumps(pulls).encode()
        if url.endswith("/pulls/7"):
            return 200, json.dumps({"number": 7, "merged_by": merged_by, "body": "架空の本文"}).encode()
        return 404, b""

    return get, calls


def check(get: Callable[..., Any]) -> str | None:
    return ghapi.MainCheck("test-token", get).check(REPO, OWNER)


def test_tst_sync_18_owner_merged_pr_is_ok() -> None:
    """TST-SYNC-18:main の先頭がオーナーのマージした PR なら当てはまらない。大文字・小文字は区別しない。"""
    get, _ = fake_api()
    assert check(get) is None
    get, _ = fake_api(merged_by={"login": OWNER.lower()})
    assert check(get) is None


@pytest.mark.parametrize("pulls,merged_by,code", [
    ([], None, "W-MAIN-NO-PR"),
    ([{"number": 7, "merged_at": None, "merge_commit_sha": S, "base": {"ref": "main"}}], None, "W-MAIN-NO-PR"),
    ([{"number": 7, "merged_at": "2026-11-20T00:00:00Z", "merge_commit_sha": "c" * 40,
       "base": {"ref": "main"}}], None, "W-MAIN-NO-PR"),
    ([{"number": 7, "merged_at": "2026-11-20T00:00:00Z", "merge_commit_sha": S,
       "base": {"ref": "develop"}}], None, "W-MAIN-NO-PR"),
    ([{"number": True, "merged_at": "2026-11-20T00:00:00Z", "merge_commit_sha": S,
       "base": {"ref": "main"}}], None, "W-MAIN-NO-PR"),
    (None, {"login": "someone-else"}, "W-MAIN-MERGED-BY"),
    (None, {"name": "x"}, "W-MAIN-MERGED-BY"),
], ids=["no-pr", "not-merged", "other-sha", "other-base", "bool-number", "other-merger", "no-login"])
def test_tst_sync_18_not_owner_merge(pulls: Any, merged_by: Any, code: str) -> None:
    """TST-SYNC-18:PR が無い・merge_commit_sha が違う・base が main でない・merged_by が違うと当てはまる。"""
    get, _ = fake_api(pulls=pulls, merged_by=merged_by)
    assert check(get) == code


def test_tst_sync_18_5xx_twice_fails() -> None:
    """TST-SYNC-18:5xx が2回続けば当てはまる。"""
    get, calls = fake_api(failures={"/commits/main": [502, 503]})
    assert check(get) == "W-MAIN-API"
    assert len(calls) == 2


def test_tst_sync_18_5xx_once_is_retried() -> None:
    """TST-SYNC-18:1回目だけの 5xx・時間切れは、やり直して成功する。"""
    get, calls = fake_api(failures={"/commits/main": [500]})
    assert check(get) is None
    get, calls = fake_api(failures={"/pulls/7": [ghapi.Transient]})
    assert check(get) is None


def test_tst_sync_18_4xx_is_not_retried() -> None:
    """4xx・3xx はやり直さずに当てはまる。"""
    get, calls = fake_api(failures={"/commits/main": [404]})
    assert check(get) == "W-MAIN-API"
    assert len(calls) == 1
    get, calls = fake_api(failures={"/commits/main": [302]})
    assert check(get) == "W-MAIN-API"
    assert len(calls) == 1


def test_tst_sync_18_bad_shapes() -> None:
    """応答の形が違う・大きすぎるときは当てはまる。"""
    def get_bad_sha(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
        return 200, json.dumps({"sha": "not-a-sha"}).encode()
    assert check(get_bad_sha) == "W-MAIN-API"

    def get_big(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
        return 200, b" " * (ghapi.MAX_BYTES + 1)
    assert check(get_big) == "W-MAIN-API"

    def get_list(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
        return 200, b"[]"
    assert check(get_list) == "W-MAIN-API"
