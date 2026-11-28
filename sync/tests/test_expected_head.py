"""--expected-head の引数の検査(詳細設計 2.4。K-068、依頼 16-1)。TST-SYNC-25。

DB と設定を差し替え、引数がおかしいときは、どちらにも触れずに E-ARGS-EXPECTED-HEAD で 2 になることを確かめる。
"""

from __future__ import annotations

import io
import sys
import types
from pathlib import Path
from typing import Any

import pytest

import nodal_sync
import nodal_sync.__main__ as cli
from helpers import TODAY

SHA = "0123456789abcdef" * 2 + "01234567"


class Calls:
    def __init__(self) -> None:
        self.connect = 0
        self.config = 0


def run(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *extra: str) -> tuple[int, Calls, str]:
    calls = Calls()
    m = types.ModuleType("nodal_sync.db")

    class DbError(Exception):
        def __init__(self, code: str) -> None:
            super().__init__(code)
            self.code = code

    def connect(url: str, ca: str | None) -> Any:
        calls.connect += 1
        raise DbError("E-DB-CONNECT")

    m.DbError = DbError  # type: ignore[attr-defined]
    m.connect = connect  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "nodal_sync.db", m)
    monkeypatch.setattr(nodal_sync, "db", m, raising=False)

    def load_config(path: str) -> Any:
        calls.config += 1
        raise cli.ConfigError("E-CONFIG-READ")

    monkeypatch.setattr(cli, "load_config", load_config)
    out = io.StringIO()
    summary = tmp_path / "summary.md"
    env = {"SYNC_DB_URL": "postgresql://u@localhost/x", "GITHUB_STEP_SUMMARY": str(summary)}
    code = cli.main(["run", "--config", str(tmp_path / "sync.json"), "--data-dir", str(tmp_path), *extra],
                    today=TODAY, env=env, out=out)
    text = out.getvalue() + (summary.read_text(encoding="utf-8") if summary.exists() else "")
    return code, calls, text


@pytest.mark.parametrize("extra", [
    ["--reset-baseline"],                                    # ① reset_baseline だけ
    ["--reset-baseline", "--expected-head", SHA[:7]],        # ② 短縮
    ["--reset-baseline", "--expected-head", SHA[:39]],
    ["--reset-baseline", "--expected-head", SHA + "0"],      # 41 桁
    ["--reset-baseline", "--expected-head", SHA.upper()],    # 大文字
    ["--reset-baseline", "--expected-head", " " + SHA],      # 前後に空白
    ["--reset-baseline", "--expected-head", SHA + " "],
    ["--reset-baseline", "--expected-head", SHA + "\n"],
    ["--reset-baseline", "--expected-head", ""],
    ["--reset-baseline", "--expected-head", "g" * 40],       # 16 進でない
    ["--expected-head", SHA],                                # ③ expected_head だけ
    ["--expected-head", SHA, "--mode", "all"],
], ids=["only-reset", "short7", "short39", "long41", "upper", "lead-space", "trail-space", "newline", "empty",
        "non-hex", "only-expected", "only-expected-all"])
def test_tst_sync_25_bad_expected_head_exits_2(monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
                                               extra: list[str]) -> None:
    """TST-SYNC-25:どれも終了コード 2・E-ARGS-EXPECTED-HEAD で、DB に接続せず、設定も読まない。値は出さない。"""
    code, calls, text = run(monkeypatch, tmp_path, *extra)
    assert code == 2
    assert "E-ARGS-EXPECTED-HEAD" in text
    assert "--expected-head が無いか、40 桁の小文字の SHA ではありません" in text
    assert calls.connect == 0 and calls.config == 0
    assert SHA[:12] not in text and SHA.upper()[:12] not in text


def test_tst_sync_25_valid_expected_head_passes_args(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """TST-SYNC-25(対照):reset_baseline と 40 桁の小文字の SHA なら引数の検査を通り、設定を読みに進む。"""
    code, calls, text = run(monkeypatch, tmp_path, "--reset-baseline", "--expected-head", SHA)
    assert code == 2
    assert "E-ARGS-EXPECTED-HEAD" not in text
    assert "E-CONFIG-READ" in text and calls.config == 1


def test_tst_sync_25_no_flags_unchanged(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """TST-SYNC-25(対照):どちらも無いときは今までどおり引数の検査を通る。"""
    code, calls, text = run(monkeypatch, tmp_path)
    assert code == 2  # 差し替えた設定の読み込みで止まる
    assert "E-ARGS-EXPECTED-HEAD" not in text
    assert "E-CONFIG-READ" in text and calls.config == 1
