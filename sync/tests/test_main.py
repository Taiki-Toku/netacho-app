"""__main__ の試験のうち DB を使わないもの。TST-SYNC-15。"""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

import pytest

import nodal_sync.__main__ as cli
from helpers import TODAY, write_config

SECRET = "::warning::架空の秘密の値"


def lines_of(out: io.StringIO) -> list[str]:
    return out.getvalue().splitlines()


def assert_stop_commands(lines: list[str]) -> None:
    m = re.fullmatch(r"::stop-commands::([0-9a-f]{32})", lines[0])
    assert m, lines[0]
    assert lines[-1] == f"::{m.group(1)}::"


def test_tst_sync_15_unexpected_exception(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """TST-SYNC-15:想定外の例外でもトレースバックと値が出ず、終了コード 2。stop-commands が最初と最後にある。"""
    def boom(path: str) -> Any:
        raise RuntimeError(SECRET)

    monkeypatch.setattr(cli, "load_config", boom)
    out = io.StringIO()
    code = cli.main(["run", "--config", str(tmp_path / "x.json"), "--data-dir", str(tmp_path)],
                    today=TODAY, env={"SYNC_DB_URL": "postgresql://u:架空のパスワード@db.example.invalid/x"},
                    out=out)
    assert code == 2
    text = out.getvalue()
    assert "Traceback" not in text
    assert SECRET not in text and "架空の秘密" not in text and "架空のパスワード" not in text
    assert "E-UNEXPECTED" in text
    assert_stop_commands(lines_of(out))


def test_tst_sync_15_bad_args_do_not_echo_values(tmp_path: Path) -> None:
    """TST-SYNC-15:引数の値が間違っていても、その値を表示しない。"""
    out = io.StringIO()
    code = cli.main(["run", "--config", "x", "--data-dir", str(tmp_path), "--mode", SECRET],
                    today=TODAY, env={}, out=out)
    assert code == 2
    assert SECRET not in out.getvalue()
    assert_stop_commands(lines_of(out))


def test_tst_sync_15_config_errors_exit_2(tmp_path: Path) -> None:
    """設定の形が違えば終了コード 2(値は出さない)。"""
    cfg = write_config(tmp_path, extra=SECRET)
    out = io.StringIO()
    code = cli.main(["run", "--config", cfg, "--data-dir", str(tmp_path)], today=TODAY, env={}, out=out)
    assert code == 2
    assert "E-CONFIG-KEYS" in out.getvalue()
    assert SECRET not in out.getvalue()

    for over, err in [({"authors": ["not-an-email"]}, "E-CONFIG-AUTHORS"),
                      ({"authors": []}, "E-CONFIG-AUTHORS"),
                      ({"slots": []}, "E-CONFIG-SLOTS"),
                      ({"slots": ["x" * 41]}, "E-CONFIG-SLOTS"),
                      ({"owner_login": "-bad"}, "E-CONFIG-OWNER"),
                      ({"app_repo": "no-slash"}, "E-CONFIG-REPO"),
                      ({"app_repo": "a/.."}, "E-CONFIG-REPO"),
                      ({"feed_checks": 1}, "E-CONFIG-FEED-CHECKS")]:
        cfg = write_config(tmp_path, **over)
        out = io.StringIO()
        assert cli.main(["run", "--config", cfg, "--data-dir", str(tmp_path)],
                        today=TODAY, env={}, out=out) == 2
        assert err in out.getvalue()


def test_missing_db_url_or_ca_exits_2(tmp_path: Path) -> None:
    """SYNC_DB_URL が無い・localhost 以外で --ca が無いときは終了コード 2(接続文字列は出さない)。"""
    pytest.importorskip("psycopg")
    cfg = write_config(tmp_path)
    out = io.StringIO()
    assert cli.main(["run", "--config", cfg, "--data-dir", str(tmp_path)], today=TODAY, env={}, out=out) == 2
    assert "E-DB-URL" in out.getvalue()
    url = "postgresql://netacho_sync:架空のパスワード@db.example.invalid:5432/postgres"
    out = io.StringIO()
    assert cli.main(["run", "--config", cfg, "--data-dir", str(tmp_path)], today=TODAY,
                    env={"SYNC_DB_URL": url}, out=out) == 2
    assert "E-DB-CA" in out.getvalue()
    assert "架空のパスワード" not in out.getvalue() and "db.example.invalid" not in out.getvalue()


def test_build_conninfo_forces_verify_full(tmp_path: Path) -> None:
    """4.5:localhost 以外は sslmode=verify-full と --ca で上書きする(URL の sslmode は使わない)。"""
    pytest.importorskip("psycopg")
    from psycopg.conninfo import conninfo_to_dict

    from nodal_sync import db
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    info = conninfo_to_dict(db.build_conninfo(
        "postgresql://u@db.example.invalid:5432/postgres?sslmode=disable", str(ca)))
    assert info["sslmode"] == "verify-full"
    assert info["sslrootcert"] == str(ca)
    assert info["connect_timeout"] == "10"
    assert info["application_name"] == "nodal-sync"
    assert info["gssencmode"] == "disable"
    # localhost に見せかけて hostaddr で別の宛先へ向けるものも、localhost とはみなさない
    info = conninfo_to_dict(db.build_conninfo(
        "host=localhost hostaddr=192.0.2.1 user=u dbname=postgres", str(ca)))
    assert info["sslmode"] == "verify-full"
    info = conninfo_to_dict(db.build_conninfo("postgresql://u@localhost:5432/postgres", None))
    assert "sslrootcert" not in info
    with pytest.raises(db.DbError):
        db.build_conninfo("postgresql://u@db.example.invalid/postgres", None)
    with pytest.raises(db.DbError):
        db.build_conninfo("postgresql://u@db.example.invalid/postgres", str(tmp_path / "missing.pem"))
