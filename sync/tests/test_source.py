"""source(履歴の検査・ファイルの一覧)と範囲の選び方の試験(DB を使わない)。TST-SYNC-10・11・13。"""

from __future__ import annotations

import datetime as dt
import io
import os
from pathlib import Path

import pytest

import nodal_sync.__main__ as cli
from helpers import BOT, OUTSIDER, TODAY, GitRepo, make_item, write_config
from nodal_sync import source


def is_author(email: str) -> bool:
    return email.lower() == BOT


@pytest.fixture
def repo(tmp_path: Path) -> GitRepo:
    r = GitRepo(tmp_path / "ai-netacho")
    r.put_item(make_item("2026-11-20-01"))
    r.commit("first")
    return r


def test_tst_sync_10_rewritten_history_is_rejected(repo: GitRepo) -> None:
    """TST-SYNC-10:前回のコミットが HEAD の祖先でなくなったら止まる。"""
    first = repo.head()
    repo.put_item(make_item("2026-11-20-02"))
    last = repo.commit("second")
    repo.git("reset", "-q", "--hard", first)
    repo.put_item(make_item("2026-11-20-03"))
    head = repo.commit("rewritten")
    with pytest.raises(source.SourceError) as e:
        source.check_history(str(repo.path), last, head, is_author)
    assert e.value.code == "E-HISTORY-REWRITE"


def test_tst_sync_11_unknown_commit_128(repo: GitRepo) -> None:
    """TST-SYNC-11:last_commit が見つからない(merge-base の終了コード 128)ときも止まる。"""
    with pytest.raises(source.SourceError) as e:
        source.check_history(str(repo.path), "0" * 40, repo.head(), is_author)
    assert e.value.code == "E-HISTORY-REWRITE"


def test_tst_sync_11_bad_sha_is_not_passed_to_git(repo: GitRepo) -> None:
    """TST-SYNC-11:形の違う last_commit は git に渡さずに止める。"""
    with pytest.raises(source.SourceError):
        source.check_history(str(repo.path), "--output=/tmp/x", repo.head(), is_author)


@pytest.mark.parametrize("author,committer", [(OUTSIDER, BOT), (BOT, OUTSIDER), (OUTSIDER, OUTSIDER)])
def test_tst_sync_11_outsider_changing_items(repo: GitRepo, author: str, committer: str) -> None:
    """TST-SYNC-11:authors に無い作者・コミットした人が data/items/ を変えたら止まる。"""
    last = repo.head()
    repo.put_item(make_item("2026-11-20-02"))
    head = repo.commit("outsider", author=author, committer=committer)
    with pytest.raises(source.SourceError) as e:
        source.check_history(str(repo.path), last, head, is_author)
    assert e.value.code == "E-HISTORY-AUTHOR"


def test_tst_sync_11_authors_case_insensitive(repo: GitRepo) -> None:
    """TST-SYNC-11:authors の照合は大文字・小文字を区別しない(設定の Config.is_author)。"""
    from nodal_sync.config import parse_config
    from helpers import CONFIG
    cfg = parse_config(dict(CONFIG))
    last = repo.head()
    repo.put_item(make_item("2026-11-20-02"))
    head = repo.commit("upper", author=BOT.upper(), committer=BOT.upper())
    source.check_history(str(repo.path), last, head, cfg.is_author)


def test_tst_sync_11_merge_commit_by_outsider(repo: GitRepo) -> None:
    """TST-SYNC-11:マージコミットで data/items/ を変えた場合も止まる。"""
    last = repo.head()
    repo.git("checkout", "-q", "-b", "side")
    repo.put_item(make_item("2026-11-20-02"))
    repo.commit("side by bot")
    repo.git("checkout", "-q", "main")
    repo.put_file("feed_digest/2026-11-20.json", b"{}")
    repo.commit("digest by bot")
    repo.git("merge", "-q", "--no-ff", "-m", "merge", "side", author=OUTSIDER)
    head = repo.head()
    with pytest.raises(source.SourceError) as e:
        source.check_history(str(repo.path), last, head, is_author)
    assert e.value.code == "E-HISTORY-AUTHOR"


def test_tst_sync_11_feed_digest_only_passes(repo: GitRepo) -> None:
    """TST-SYNC-11:authors に無い人でも feed_digest/ だけなら通る。"""
    last = repo.head()
    repo.put_file("feed_digest/2026-11-20.json", b"{}")
    head = repo.commit("digest", author=OUTSIDER)
    source.check_history(str(repo.path), last, head, is_author)
    # bot が data/items/ を変えるのは通る
    repo.put_item(make_item("2026-11-20-02"))
    head = repo.commit("bot")
    source.check_history(str(repo.path), last, head, is_author)


def make_dirty(repo: GitRepo, kind: str) -> None:
    """data/items/ を、コミットしていない状態にする(追跡していない・変えた・無視された)。"""
    if kind == "untracked":
        repo.put_item(make_item("2026-11-20-05"))
    elif kind == "modified":
        repo.put_item(make_item("2026-11-20-01", title="架空の見出し(コミットしていない)"))
    else:
        repo.put_file(".gitignore", b"data/items/*.tmp\n")
        repo.commit("ignore")
        repo.put_file("data/items/2026-11-20-06.json.tmp", b"{}")


@pytest.mark.parametrize("kind", ["untracked", "modified", "ignored"])
def test_tst_sync_11b_dirty_tree_is_rejected(repo: GitRepo, kind: str) -> None:
    """TST-SYNC-11b:data/items/ に未コミットの変更・追跡していない・無視されたファイルがあれば止まる。"""
    source.check_clean(str(repo.path))
    make_dirty(repo, kind)
    with pytest.raises(source.SourceError) as e:
        source.check_clean(str(repo.path))
    assert e.value.code == "E-SRC-DIRTY"


def test_tst_sync_11b_changes_outside_items_pass(repo: GitRepo) -> None:
    """TST-SYNC-11b:data/items/ の外(feed_digest/ など)の未コミットの変更は見ない。"""
    repo.put_file("feed_digest/2026-11-20.json", b"{}")
    source.check_clean(str(repo.path))


def test_tst_sync_11b_not_a_repo(tmp_path: Path) -> None:
    """TST-SYNC-11b:git のリポジトリでなければ(終了コード 0 以外)止まる。"""
    (tmp_path / "data" / "items").mkdir(parents=True)
    with pytest.raises(source.SourceError) as e:
        source.check_clean(str(tmp_path))
    assert e.value.code == "E-SRC-DIRTY"


def test_list_items_groups_by_day_and_counts_bad_files(tmp_path: Path) -> None:
    """4.2 の 4:ファイル名の日付で分ける。名前の形が違う・リンクは不正なファイルとして数え、読まない。"""
    repo = GitRepo(tmp_path / "r")
    items = repo.path / "data" / "items"
    repo.put_item(make_item("2026-11-19-01"))
    repo.put_item(make_item("2026-11-20-01"))
    repo.put_item(make_item("2026-11-20-02"))
    repo.put_item(make_item("2026-11-01-01"))
    (items / "README.md").write_text("x")
    (items / "2026-11-20-1.json").write_text("{}")
    (items / "2026-13-40-01.json").write_text("{}")
    (items / "sub").mkdir()
    (items / "sub" / "2026-11-20-05.json").write_text("{}")
    outside = tmp_path / "secret.json"
    outside.write_text("{}")
    os.symlink(outside, items / "2026-11-20-09.json")

    days = {dt.date(2026, 11, 19), dt.date(2026, 11, 20)}
    listing = source.list_items(str(repo.path), days)
    assert sorted(listing.by_day) == [dt.date(2026, 11, 19), dt.date(2026, 11, 20)]
    assert [i for i, _ in listing.by_day[dt.date(2026, 11, 20)]] == ["2026-11-20-01", "2026-11-20-02"]
    assert listing.bad_files == 4  # README.md・2026-11-20-1.json・2026-13-40-01.json・リンク

    all_days = source.list_items(str(repo.path), None)
    assert dt.date(2026, 11, 1) in all_days.by_day


def test_list_items_missing_dir(tmp_path: Path) -> None:
    with pytest.raises(source.SourceError):
        source.list_items(str(tmp_path), None)


def test_tst_sync_13_select_days() -> None:
    """TST-SYNC-13:recent・range・all の範囲の選び方。"""
    assert cli.select_days("recent", None, None, TODAY) == [
        dt.date(2026, 11, 18), dt.date(2026, 11, 19), dt.date(2026, 11, 20)]
    assert cli.select_days("all", None, None, TODAY) is None
    assert cli.select_days("range", "2026-11-01", "2026-11-03", TODAY) == [
        dt.date(2026, 11, 1), dt.date(2026, 11, 2), dt.date(2026, 11, 3)]
    assert len(cli.select_days("range", "2025-10-17", "2026-11-20", TODAY) or []) == 400


@pytest.mark.parametrize("args", [
    ("range", "2025-10-16", "2026-11-20"),   # 401 日
    ("range", "2026-11-20", "2026-11-19"),   # from > to
    ("range", "2026/11/01", "2026-11-02"),
    ("range", "2026-02-30", "2026-03-01"),
    ("range", "２０２６-11-01", "2026-11-02"),
    ("range", None, "2026-11-02"),
    ("recent", "2026-11-01", None),
    ("all", None, "2026-11-01"),
])
def test_tst_sync_13_bad_ranges(args: tuple[str, str | None, str | None]) -> None:
    """TST-SYNC-13:400 日を超える range・from > to・形の違う日付は拒否。"""
    with pytest.raises(cli.ArgError):
        cli.select_days(args[0], args[1], args[2], TODAY)


def test_tst_sync_13_bad_range_exits_2(tmp_path: Path) -> None:
    """TST-SYNC-13:main からも終了コード 2(DB に触れる前に止まる)。"""
    cfg = write_config(tmp_path)
    out = io.StringIO()
    code = cli.main(["run", "--config", cfg, "--data-dir", str(tmp_path), "--mode", "range",
                     "--from", "2026-11-20", "--to", "2026-11-01"], today=TODAY, env={}, out=out)
    assert code == 2
    assert "E-ARGS-DATE" in out.getvalue()
    code = cli.main(["run", "--config", cfg, "--data-dir", str(tmp_path), "--mode", "weekly"],
                    today=TODAY, env={}, out=io.StringIO())
    assert code == 2
