"""ファイルの形の検査(詳細設計 2.4 の3・2.9。K-063、依頼 14-1)。TST-SYNC-21〜23。

DB は使わない:nodal_sync.db を、読むだけの値を返し書き込みを数える偽物に差し替えて、run を通しで流す。
"""

from __future__ import annotations

import io
import os
import sys
import types
from pathlib import Path
from typing import Any

import pytest

import nodal_sync
import nodal_sync.__main__ as cli
from helpers import (BOT, FILES, GENRES, TODAY, TOOL_BODY, TOOL_PATH, GitRepo, blob_sha, dump, make_item,
                     write_config, write_files)
from nodal_sync import ogimage, report
from nodal_sync.config import ConfigError, load_files

SECRET_BODY = b"::warning:: fictional secret body 0123456789"


class FakeDb:
    """db モジュールの代わり。書き込みの呼び出しを writes に記録する。"""

    class DbError(Exception):
        def __init__(self, code: str) -> None:
            super().__init__(code)
            self.code = code

    def __init__(self, last: str | None) -> None:
        self.last = last
        self.writes: list[str] = []
        self.connected = False

    def module(self) -> types.ModuleType:
        m = types.ModuleType("nodal_sync.db")
        fake = self

        class Conn:
            def close(self) -> None:
                pass

        def write(name: str, result: Any = None) -> Any:
            def f(*a: Any, **k: Any) -> Any:
                fake.writes.append(name)
                return result
            return f

        m.DbError = FakeDb.DbError  # type: ignore[attr-defined]
        def connect(url: str, ca: str | None) -> Conn:
            fake.connected = True
            return Conn()

        m.connect = connect  # type: ignore[attr-defined]
        m.read_genres = lambda conn: GENRES  # type: ignore[attr-defined]
        m.read_last_commit = lambda conn: fake.last  # type: ignore[attr-defined]
        m.write_day = write("write_day", (0, 0, 0))  # type: ignore[attr-defined]
        m.write_last_commit = write("write_last_commit")  # type: ignore[attr-defined]
        m.set_image = write("set_image", False)  # type: ignore[attr-defined]
        m.item_ids_on = lambda conn, days: set()  # type: ignore[attr-defined]
        m.image_targets = lambda conn, days: []  # type: ignore[attr-defined]
        return m


class NoNetFetcher(ogimage.Fetcher):
    def fetch(self, url: str) -> str | None:
        return None


def run(monkeypatch: pytest.MonkeyPatch, repo: GitRepo, cfg_dir: Path, last: str | None,
        *extra: str, ai_files: dict[str, str] | None = None, write_cfg: bool = True,
        summary: Path | None = None) -> tuple[int, FakeDb, str]:
    fake = FakeDb(last)
    mod = fake.module()
    monkeypatch.setitem(sys.modules, "nodal_sync.db", mod)
    monkeypatch.setattr(nodal_sync, "db", mod, raising=False)
    cfg = write_config(cfg_dir, ai_files=ai_files) if write_cfg else str(cfg_dir / "sync.json")
    out = io.StringIO()
    env = {"SYNC_DB_URL": "postgresql://u@localhost/x"}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    code = cli.main(["run", "--config", cfg, "--data-dir", str(repo.path), "--mode", "range",
                     "--from", "2026-11-18", "--to", "2026-11-20", *extra],
                    today=TODAY, env=env, out=out, fetcher=NoNetFetcher())
    text = out.getvalue() + (summary.read_text(encoding="utf-8") if summary is not None else "")
    return code, fake, text


@pytest.fixture
def repo(tmp_path: Path) -> GitRepo:
    r = GitRepo(tmp_path / "ai-netacho")
    r.put_item(make_item("2026-11-20-01"))
    r.commit("base")
    return r


def assert_stopped(code: int, fake: FakeDb, text: str, *paths: str) -> None:
    assert code == 2, text
    assert fake.writes == []
    assert "E-SRC-TREE" in text
    assert "ai-netacho に想定外のファイルがあります" in text
    for p in paths:
        assert f"  - {report.md_escape(p)}" in text, (p, text)


# --- TST-SYNC-21:今の木 -------------------------------------------------------------------

def _add(rel: str, data: bytes = b"x") -> Any:
    return lambda r: r.put_file(rel, data)


def _exec(rel: str, data: bytes) -> Any:
    def f(r: GitRepo) -> None:
        r.put_file(rel, data)
        os.chmod(r.path / rel, 0o755)
    return f


def _symlink(r: GitRepo) -> None:
    os.symlink("../../tools/export.py", r.path / "data" / "items" / "2026-11-20-02.json")


def _change_tool(r: GitRepo) -> None:
    r.put_file(TOOL_PATH, b"# changed by someone\n")


def _remove_tool(r: GitRepo) -> None:
    (r.path / TOOL_PATH).unlink()


def _submodule(r: GitRepo) -> None:
    GitRepo(r.path / "vendor" / "sub").commit("inner")  # 入れ子のリポジトリは add -A で gitlink(160000)になる


CASES = [
    ("CLAUDE.md", _add("CLAUDE.md")),
    (".claude/settings.json", _add(".claude/settings.json", b"{}")),
    ("data/items/CLAUDE.md", _add("data/items/CLAUDE.md")),
    ("ネタ/x.md", _add("ネタ/x.md")),
    ("data/items/2026-11-20-02.json", _exec("data/items/2026-11-20-02.json", dump(make_item("2026-11-20-02")))),
    (TOOL_PATH, _exec(TOOL_PATH, TOOL_BODY)),  # files と中身は同じでも実行ファイルは違反
    ("data/items/2026-11-20-02.json", _symlink),
    (TOOL_PATH, _change_tool),
    (TOOL_PATH, _remove_tool),
    ("vendor/sub", _submodule),
    ("data/items/2026-11-20-01.json.bak", _add("data/items/2026-11-20-01.json.bak")),
    ("ネタ/2026-11-20-01/CLAUDE.md", _add("ネタ/2026-11-20-01/CLAUDE.md")),
    ("data/items/２０２６-11-20-01.json", _add("data/items/２０２６-11-20-01.json")),  # 全角の数字
]


@pytest.mark.parametrize("first_run", [True, False])
@pytest.mark.parametrize("path,make", CASES)
def test_tst_sync_21_current_tree_stops(monkeypatch: pytest.MonkeyPatch, repo: GitRepo, tmp_path: Path,
                                        path: str, make: Any, first_run: bool) -> None:
    """TST-SYNC-21:想定外のファイル・形の違うファイル・files と違う・消されたファイルで、何も書かずに 2。
    コミットの作者は authors にいる BOT(作者では判定しない)。"""
    last = None if first_run else repo.head()
    make(repo)
    repo.commit("by bot", author=BOT)
    code, fake, text = run(monkeypatch, repo, tmp_path, last)
    assert_stopped(code, fake, text, path)


def test_tst_sync_21_reset_baseline_still_checks_tree(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                      tmp_path: Path) -> None:
    """TST-SYNC-21:--reset-baseline でも今の木は調べる。"""
    last = repo.head()
    repo.put_file("CLAUDE.md", b"x")
    repo.commit("add")
    code, fake, text = run(monkeypatch, repo, tmp_path, last, "--reset-baseline")
    assert_stopped(code, fake, text, "CLAUDE.md")


@pytest.mark.parametrize("first_run", [True, False])
def test_tst_sync_21_data_and_listed_files_pass(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                tmp_path: Path, first_run: bool) -> None:
    """TST-SYNC-21:データの形のファイルと、files に一致するファイルだけなら通る(書き込みもする)。"""
    last = None if first_run else repo.head()
    repo.put_item(make_item("2026-11-19-01"))
    repo.put_file("feed_digest/2026-11-20.json", b"{}")
    repo.put_file("ネタ/2026-11-20-01.md", b"x")
    repo.put_file("ネタ/2026-11-20-02 架空の題.md", b"x")
    repo.put_file("放送/2026-11-20.md", b"x")
    repo.put_file("CLAUDE.md", b"fictional rules\n")
    repo.commit("data")
    code, fake, text = run(monkeypatch, repo, tmp_path, last,
                           ai_files={"CLAUDE.md": blob_sha(b"fictional rules\n")})
    assert code == 0, text
    assert "write_day" in fake.writes and "write_last_commit" in fake.writes
    assert "E-SRC-TREE" not in text


@pytest.mark.parametrize("raw", [
    None,                                                        # 無い
    b"{",                                                        # JSON でない
    b'{"files": {}, "extra": 1}',                                # キーが違う
    b'{"files": []}',
    b'{"files": {"a": "' + b"a" * 40 + b'", "a": "' + b"b" * 40 + b'"}}',  # 同じキー
    dump({"files": {"CLAUDE.md": "A" * 40}}),                    # 大文字
    dump({"files": {"CLAUDE.md": "a" * 39}}),
    dump({"files": {"CLAUDE.md": 1}}),
    dump({"files": {"x" * 301: "a" * 40}}),                      # 300 字を超える
    dump({"files": {"": "a" * 40}}),
    dump({"files": {f"f{i}": "a" * 40 for i in range(501)}}),    # 500 件を超える
    dump({"files": {"data/items/2026-11-20-01.json": "a" * 40}}),  # データの形のパス
    dump({"files": {"ネタ/2026-11-20-01.md": "a" * 40}}),
])
def test_tst_sync_21_bad_files_list_exits_2(monkeypatch: pytest.MonkeyPatch, repo: GitRepo, tmp_path: Path,
                                            raw: bytes | None) -> None:
    """TST-SYNC-21(詳細設計 2.9):一覧が無い・形がおかしいと、DB に触れる前に E-CONFIG-FILES で 2。"""
    write_config(tmp_path)
    p = tmp_path / "ai_netacho_files.json"
    if raw is None:
        p.unlink()
    else:
        write_files(tmp_path, raw=raw)
    code, fake, text = run(monkeypatch, repo, tmp_path, None, write_cfg=False)
    assert code == 2
    assert "E-CONFIG-FILES" in text
    assert fake.writes == [] and not fake.connected


def test_tst_sync_21_files_list_limits_ok(tmp_path: Path) -> None:
    """TST-SYNC-21:300 字・500 件ちょうどは受け付ける。"""
    write_files(tmp_path, {**{f"f{i}": "a" * 40 for i in range(499)}, "あ" * 300: "0" * 40})
    assert len(load_files(str(tmp_path / "sync.json"))) == 500
    write_files(tmp_path, {**FILES, "x" * 301: "a" * 40})
    with pytest.raises(ConfigError):
        load_files(str(tmp_path / "sync.json"))


# --- TST-SYNC-22:履歴 ---------------------------------------------------------------------

def test_tst_sync_22_added_then_removed_stops(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                              tmp_path: Path) -> None:
    """TST-SYNC-22:CLAUDE.md を足して次のコミットで消しても 2。初回と reset_baseline では履歴を見ない。"""
    last = repo.head()
    repo.put_file("CLAUDE.md", b"x")
    repo.commit("add")
    (repo.path / "CLAUDE.md").unlink()
    repo.commit("remove")
    code, fake, text = run(monkeypatch, repo, tmp_path, last)
    assert_stopped(code, fake, text, "CLAUDE.md")

    code, fake, text = run(monkeypatch, repo, tmp_path, None)
    assert code == 0, text
    code, fake, text = run(monkeypatch, repo, tmp_path, last, "--reset-baseline")
    assert code == 0, text
    assert "write_last_commit" in fake.writes


def test_tst_sync_22_removed_on_side_branch_merge(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                  tmp_path: Path) -> None:
    """TST-SYNC-22:別のブランチで足して消し、マージしたものも拾う。"""
    last = repo.head()
    repo.git("checkout", "-q", "-b", "side")
    repo.put_file(".claude/commands/x.md", b"x")
    repo.commit("add")
    (repo.path / ".claude" / "commands" / "x.md").unlink()
    repo.commit("remove")
    repo.git("checkout", "-q", "main")
    repo.put_item(make_item("2026-11-20-02"))
    repo.commit("item")
    repo.git("merge", "-q", "--no-ff", "--no-edit", "side")
    code, fake, text = run(monkeypatch, repo, tmp_path, last)
    assert_stopped(code, fake, text, ".claude/commands/x.md")


def test_tst_sync_22_renamed_away_stops(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                        tmp_path: Path) -> None:
    """TST-SYNC-22:足したファイルをデータの形の名前に変えても、元のパスを拾う。"""
    last = repo.head()
    body = dump(make_item("2026-11-20-02"))
    repo.put_file("x.json", body)
    repo.commit("add")
    repo.git("mv", "x.json", "data/items/2026-11-20-02.json")
    repo.commit("rename")
    code, fake, text = run(monkeypatch, repo, tmp_path, last)
    assert_stopped(code, fake, text, "x.json")


def test_tst_sync_22_daily_data_commits_and_merge_pass(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                       tmp_path: Path) -> None:
    """TST-SYNC-22:データの形のファイルだけを変えた何コミットかと、データだけのブランチのマージは通る。"""
    last = repo.head()
    repo.put_item(make_item("2026-11-19-01"))
    repo.put_file("ネタ/2026-11-19-01 架空.md", b"x")
    repo.commit("day 1")
    repo.git("checkout", "-q", "-b", "side")
    repo.put_file("放送/2026-11-20.md", b"x")
    repo.put_file("feed_digest/2026-11-20.json", b"{}")
    repo.commit("side")
    repo.git("checkout", "-q", "main")
    repo.put_item(make_item("2026-11-20-02"))
    (repo.path / "ネタ" / "2026-11-19-01 架空.md").unlink()  # データの形のファイルは消しても通る
    repo.commit("day 2")
    repo.git("merge", "-q", "--no-ff", "--no-edit", "side")
    code, fake, text = run(monkeypatch, repo, tmp_path, last)
    assert code == 0, text
    assert "write_last_commit" in fake.writes


def test_tst_sync_22_tool_fixed_with_files_passes(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                  tmp_path: Path) -> None:
    """TST-SYNC-22:tools/export.py を直し、files も同じ SHA に直したコミットは通る。"""
    last = repo.head()
    new_body = b"# fixed by owner\n"
    repo.put_file(TOOL_PATH, new_body)
    repo.commit("fix tool")
    code, fake, text = run(monkeypatch, repo, tmp_path, last, ai_files={TOOL_PATH: blob_sha(new_body)})
    assert code == 0, text
    assert "write_last_commit" in fake.writes
    # files を直さなければ止まる(設定手順書 4-7)
    code, fake, text = run(monkeypatch, repo, tmp_path, last)
    assert_stopped(code, fake, text, TOOL_PATH)


# --- TST-SYNC-23:要約に出るパス ------------------------------------------------------------

def test_tst_sync_23_paths_sanitized_and_limited(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                 tmp_path: Path) -> None:
    """TST-SYNC-23:制御文字は ?、1つ 200 字、20 件まで。ファイルの中身と SHA は出ない。"""
    repo.put_file("evil\n::warning::x\x1b[31m.md", SECRET_BODY)
    repo.put_file("a" * 250, SECRET_BODY)  # 並べると最初に来る名前
    for i in range(25):
        repo.put_file(f"extra/{i:02d}.txt", SECRET_BODY)
    repo.commit("many")
    summary = tmp_path / "summary.md"
    code, fake, text = run(monkeypatch, repo, tmp_path, None, summary=summary)
    assert code == 2 and fake.writes == []
    body = summary.read_text(encoding="utf-8")
    assert "- 想定外のファイル:27" in body
    listed = [ln for ln in body.splitlines() if ln.startswith("  - ")]
    assert len(listed) == 21 and listed[-1] == "  - ほか 7 件"
    assert "  - evil?::warning::x?\\[31m.md" in listed
    assert "  - " + "a" * 200 in listed and "a" * 201 not in body
    assert "\x1b" not in text
    assert not any(ln.startswith("::warning") for ln in text.splitlines())
    assert SECRET_BODY.decode() not in text and "secret" not in text
    assert blob_sha(SECRET_BODY) not in text and blob_sha(TOOL_BODY) not in text


def test_tst_sync_23_non_utf8_path_is_violation(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                tmp_path: Path) -> None:
    """TST-SYNC-23:UTF-8 で読めないパスは違反(置き換え文字で出す)。"""
    try:
        fd = os.open(os.fsencode(str(repo.path)) + b"/bad\xff.md", os.O_WRONLY | os.O_CREAT, 0o644)
    except OSError:
        pytest.skip("このファイルシステムは UTF-8 でない名前を作れない")
    os.close(fd)
    repo.commit("bad name")
    code, fake, text = run(monkeypatch, repo, tmp_path, None)
    assert_stopped(code, fake, text, "bad�.md")


def test_tst_sync_23_markdown_in_path_is_escaped(monkeypatch: pytest.MonkeyPatch, repo: GitRepo,
                                                 tmp_path: Path) -> None:
    """TST-SYNC-23:名前の強調・リンク・HTML は要約で働かない(記号の前に \\ が付く)。"""
    repo.put_file("**ok** [run](x) <b>|#.md", b"x")
    repo.commit("md")
    summary = tmp_path / "summary.md"
    code, fake, text = run(monkeypatch, repo, tmp_path, None, summary=summary)
    assert code == 2
    assert "  - \\*\\*ok\\*\\* \\[run\\]\\(x\\) \\<b\\>\\|\\#.md" in text
    assert "<b>" not in text and "**ok**" not in text and "[run](x)" not in text


def test_tst_sync_23_safe_path_unit() -> None:
    """TST-SYNC-23:向きを変える文字・改行・区切りも ? にする。"""
    assert report.safe_path("a‮b\r\nc d\x00") == "a?b??c?d?"
    assert report.safe_path("ネ" * 300) == "ネ" * 200
    assert report.render_paths([str(i) for i in range(21)])[-1] == "  - ほか 1 件"
