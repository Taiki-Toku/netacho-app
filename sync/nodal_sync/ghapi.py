"""GitHub の REST API で「main の先頭がオーナーのマージした PR か」を確かめる(依頼 10-1 の 4.8 の 4)。

- 宛先は https://api.github.com だけ。転送は辿らない(トークンを別の宛先に送らないため)
- 5xx・時間切れ・接続の失敗は1回だけやり直す。4xx(と 3xx)はやり直さない
- 応答は 1 MB まで読み、JSON の形を確かめる。PR のタイトルや本文は使わない
"""

from __future__ import annotations

import http.client
import re
import urllib.error
import urllib.request
from typing import Any, Callable

from .schema import JsonFileError, parse_json_strict

API_BASE = "https://api.github.com"
TIMEOUT = 10
MAX_BYTES = 1024 * 1024
SHA_RE = re.compile(r"[0-9a-f]{40}")


class Transient(Exception):
    """時間切れ・接続の失敗(やり直してよい失敗)。"""


# (URL, ヘッダー) → (状態コード, 本文)。時間切れ・接続の失敗は Transient を投げる
HttpGet = Callable[[str, dict[str, str]], tuple[int, bytes]]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any,
                         newurl: str) -> None:
        return None


def urllib_get(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            return int(resp.status), resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        e.close()
        return int(e.code), b""
    except (urllib.error.URLError, OSError, TimeoutError, http.client.HTTPException):
        # 接続の失敗・時間切れ・途中で切れた応答(IncompleteRead など)
        raise Transient() from None


class MainCheck:
    def __init__(self, token: str, http_get: HttpGet = urllib_get) -> None:
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "NODAL-sync/1",
        }
        self._get = http_get

    def _get_json(self, path: str) -> Any | None:
        url = API_BASE + path
        for attempt in range(2):
            try:
                status, body = self._get(url, self._headers)
            except Transient:
                continue
            if status >= 500:
                continue
            if status != 200 or len(body) > MAX_BYTES:
                return None
            try:
                return parse_json_strict(body)
            except JsonFileError:
                return None
        return None

    def check(self, app_repo: str, owner_login: str) -> str | None:
        """当てはまり(確かめられない)なら決まりの番号、問題が無ければ None。app_repo は設定で形を確かめたもの。"""
        head = self._get_json(f"/repos/{app_repo}/commits/main")
        if not isinstance(head, dict) or not isinstance(head.get("sha"), str) \
                or not SHA_RE.fullmatch(head["sha"]):
            return "W-MAIN-API"
        sha = head["sha"]

        pulls = self._get_json(f"/repos/{app_repo}/commits/{sha}/pulls")
        if not isinstance(pulls, list):
            return "W-MAIN-API"
        number: int | None = None
        for pr in pulls:
            if not isinstance(pr, dict):
                continue
            base = pr.get("base")
            n = pr.get("number")
            if (isinstance(pr.get("merged_at"), str) and pr["merged_at"]
                    and pr.get("merge_commit_sha") == sha
                    and isinstance(base, dict) and base.get("ref") == "main"
                    and isinstance(n, int) and not isinstance(n, bool) and n > 0):
                number = n
                break
        if number is None:
            return "W-MAIN-NO-PR"

        pr_detail = self._get_json(f"/repos/{app_repo}/pulls/{number}")
        if not isinstance(pr_detail, dict):
            return "W-MAIN-API"
        merged_by = pr_detail.get("merged_by")
        login = merged_by.get("login") if isinstance(merged_by, dict) else None
        if not isinstance(login, str) or login.lower() != owner_login.lower():
            return "W-MAIN-MERGED-BY"
        return None
