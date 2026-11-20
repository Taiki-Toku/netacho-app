"""watch:配信の未着・載せ忘れ・一覧の取りこぼし・main の確認(依頼 10-1 の 4.8)。

出すのは当てはまった項目の番号・件数・id(形を DB の CHECK で確かめたもの)だけ。
"""

from __future__ import annotations

import datetime as dt
import os
import stat
from dataclasses import dataclass, field
from typing import Any, Callable

from .config import Config

MAX_IDS_SHOWN = 20


@dataclass
class Finding:
    code: str
    count: int = 1
    ids: list[str] = field(default_factory=list)


def digest_file_exists(data_dir: str, day: dt.date) -> bool:
    path = os.path.join(data_dir, "feed_digest", f"{day.isoformat()}.json")
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except OSError:
        return False


def run_watch(db: Any, conn: Any, cfg: Config, data_dir: str, today: dt.date,
              main_check: Callable[[], str | None]) -> list[Finding]:
    """db は nodal_sync.db(試験で差し替えられるように引数で受ける)。"""
    found: list[Finding] = []

    # 1. 未着
    if db.count_items_on(conn, today) == 0:
        found.append(Finding("W-NOT-ARRIVED"))

    if cfg.feed_checks:
        # 2. 載せ忘れ
        used = db.feed_ids_in_items_on(conn, today)
        missed = [i for i in db.feed_digested_on(conn, today) if i not in used]
        if missed:
            found.append(Finding("W-FEED-MISSED", len(missed), missed[:MAX_IDS_SHOWN]))
        # 3. 一覧の取りこぼし
        if not digest_file_exists(data_dir, today):
            found.append(Finding("W-DIGEST-FILE"))
        stale = db.feed_stale_undigested(conn)
        if stale:
            found.append(Finding("W-DIGEST-STALE", len(stale), stale[:MAX_IDS_SHOWN]))

    # 4. main の確認
    code = main_check()
    if code is not None:
        found.append(Finding(code))
    return found
