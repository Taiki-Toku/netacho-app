"""DB を使う run の試験。TST-SYNC-04〜12・15。

NODAL_TEST_ADMIN_URL・NODAL_TEST_SYNC_URL が無ければ skip(NODAL_REQUIRE_DB=1 なら失敗)。
"""

from __future__ import annotations

import datetime as dt
import io
import re
from pathlib import Path
from typing import Any

import pytest

import nodal_sync.__main__ as cli
from helpers import OUTSIDER, TODAY, GitRepo, make_item, write_config
from nodal_sync import ogimage, schema


class NoNetFetcher(ogimage.Fetcher):
    """画像の取得はしない(ネットワークに出ない)。呼ばれた URL だけ数える。"""

    def __init__(self) -> None:
        self.urls: list[str] = []

    def fetch(self, url: str) -> str | None:
        self.urls.append(url)
        return None


def run(repo: GitRepo, cfg: str, sync_url: str, *extra: str, out: io.StringIO | None = None,
        summary: Path | None = None, fetcher: ogimage.Fetcher | None = None) -> int:
    args = ["run", "--config", cfg, "--data-dir", str(repo.path), *extra]
    if not any(a == "--mode" for a in extra):
        args += ["--mode", "range", "--from", "2026-11-18", "--to", "2026-11-20"]
    env = {"SYNC_DB_URL": sync_url}
    if summary is not None:
        env["GITHUB_STEP_SUMMARY"] = str(summary)
    return cli.main(args, today=TODAY, env=env, out=out or io.StringIO(),
                    fetcher=fetcher or NoNetFetcher())


def connect_sync(sync_url: str) -> Any:
    from nodal_sync import db
    return db.connect(sync_url, None)


def rows_of(day: dt.date) -> list[dict[str, Any]]:
    """1日分の正しい行(schema を通したもの)。"""
    files = [(f"{day.isoformat()}-{i:02d}", make_item(f"{day.isoformat()}-{i:02d}")) for i in (1, 2)]
    import json
    res = schema.validate_day(day, [(i, json.dumps(o).encode()) for i, o in files],
                              genres={"agent"}, slots=("新着",), allow_null_genre=False, today=TODAY)
    assert res.valid
    return res.rows


@pytest.fixture
def repo(tmp_path: Path) -> GitRepo:
    r = GitRepo(tmp_path / "ai-netacho")
    for d in ("2026-11-18", "2026-11-19", "2026-11-20"):
        r.put_item(make_item(f"{d}-01"))
        r.put_item(make_item(f"{d}-02"))
    r.commit("items")
    return r


def test_tst_sync_05_one_bad_day(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                 tmp_path: Path) -> None:
    """TST-SYNC-05:3日のうち1日だけ不正なら、ほかの2日は書かれ、終了コードは 1。"""
    repo.put_item(make_item("2026-11-19-02", sourceUrl="http://news.example.com/x"))
    repo.commit("bad")
    assert run(repo, write_config(tmp_path), db_urls[1]) == 1
    ids = [r[0] for r in admin_sql("select id from public.items order by id")]
    assert ids == ["2026-11-18-01", "2026-11-18-02", "2026-11-20-01", "2026-11-20-02"]


def test_tst_sync_06_idempotent(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                tmp_path: Path) -> None:
    """TST-SYNC-06:2回流しても結果が同じ(2回目は追加0・更新0、synced_at も変わらない)。"""
    cfg = write_config(tmp_path)
    assert run(repo, cfg, db_urls[1]) == 0
    before = admin_sql("select id, synced_at, title from public.items order by id")
    summary = tmp_path / "summary.md"
    assert run(repo, cfg, db_urls[1], summary=summary) == 0
    after = admin_sql("select id, synced_at, title from public.items order by id")
    assert before == after and len(after) == 6
    text = summary.read_text(encoding="utf-8")
    for d in ("2026-11-18", "2026-11-19", "2026-11-20"):
        assert f"| {d} | 2 | 0 | 0 | 2 | - | した |" in text

    conn = connect_sync(db_urls[1])
    try:
        from nodal_sync import db
        rows = rows_of(dt.date(2026, 11, 20))
        assert db.write_day(conn, rows) == (0, 0, 2)
        rows[0]["summary"] = "架空の要約(変えた)"
        assert db.write_day(conn, rows) == (0, 1, 1)
    finally:
        conn.close()


def test_tst_sync_07_failed_day_changes_nothing(db_urls: tuple[str, str], admin_sql: Any) -> None:
    """TST-SYNC-07:書き込みの途中で失敗した日は、その日の行が1つも変わらない。"""
    from nodal_sync import db
    day = dt.date(2026, 11, 20)
    rows = rows_of(day)
    conn = connect_sync(db_urls[1])
    try:
        assert db.write_day(conn, rows[:1]) == (1, 0, 0)
        changed = dict(rows[0], title="架空の見出し(変えた)")
        new = rows[1]
        bad = dict(rows[1], id="2026-11-20-03", date=dt.date(2026, 11, 19))  # id と date の食い違い(DB の CHECK)
        with pytest.raises(db.DbError) as e:
            db.write_day(conn, [changed, new, bad])
        assert e.value.code == "E-DB-WRITE"
        # 接続はそのまま使える
        assert db.read_genres(conn)
    finally:
        conn.close()
    got = admin_sql("select id, title from public.items order by id")
    assert got == [("2026-11-20-01", rows[0]["title"])]


def test_tst_sync_08_image_url_kept_or_reset(db_urls: tuple[str, str], admin_sql: Any) -> None:
    """TST-SYNC-08:本文だけ変えても image_url は残り、source_url を変えると null に戻る。"""
    from nodal_sync import db
    rows = rows_of(dt.date(2026, 11, 20))[:1]
    conn = connect_sync(db_urls[1])
    try:
        db.write_day(conn, rows)
        assert db.set_image(conn, rows[0]["id"], rows[0]["source_url"], "https://img.example.com/a.png")
        # 出典が違う・もう入っているときは書かない
        assert not db.set_image(conn, rows[0]["id"], rows[0]["source_url"], "https://img.example.com/b.png")
        rows[0]["summary"] = "架空の要約(変えた)"
        assert db.write_day(conn, rows) == (0, 1, 0)
        assert admin_sql("select image_url from public.items") == [("https://img.example.com/a.png",)]
        rows[0]["source_url"] = "https://news.example.com/changed"
        assert db.write_day(conn, rows) == (0, 1, 0)
        assert admin_sql("select image_url from public.items") == [(None,)]
    finally:
        conn.close()


def test_tst_sync_09_first_run_records_head(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                            tmp_path: Path) -> None:
    """TST-SYNC-09:初回は検査を飛ばして HEAD を記録する。"""
    # 初回なので、authors に無い人のコミットがあっても検査しない
    repo.put_item(make_item("2026-11-20-03"))
    repo.commit("outsider", author=OUTSIDER)
    summary = tmp_path / "summary.md"
    assert run(repo, write_config(tmp_path), db_urls[1], summary=summary) == 0
    assert admin_sql("select last_commit from public.sync_state where source = 'ai-netacho'") == [(repo.head(),)]
    assert "初回" in summary.read_text(encoding="utf-8")


def test_tst_sync_10_rewrite_writes_nothing(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                            tmp_path: Path) -> None:
    """TST-SYNC-10:前回のコミットが HEAD の祖先でなくなったら、何も書かずに終了コード 2。"""
    cfg = write_config(tmp_path)
    base = repo.head()
    repo.put_item(make_item("2026-11-20-03"))
    last = repo.commit("third")
    assert run(repo, cfg, db_urls[1]) == 0
    repo.git("reset", "-q", "--hard", base)
    repo.put_item(make_item("2026-11-20-04"))
    repo.put_item(make_item("2026-11-20-01", title="架空の見出し(書き換え)"))
    repo.commit("rewritten")
    before = admin_sql("select id, title, synced_at from public.items order by id")
    summary = tmp_path / "summary.md"
    assert run(repo, cfg, db_urls[1], summary=summary) == 2
    assert admin_sql("select id, title, synced_at from public.items order by id") == before
    assert admin_sql("select last_commit from public.sync_state") == [(last,)]
    assert "履歴の書き換え" in summary.read_text(encoding="utf-8")


def test_tst_sync_11_outsider_run_exits_2(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                          tmp_path: Path) -> None:
    """TST-SYNC-11:authors に無い人が data/items/ を変えたら、何も書かずに終了コード 2。"""
    cfg = write_config(tmp_path)
    assert run(repo, cfg, db_urls[1]) == 0
    last = repo.head()
    repo.put_item(make_item("2026-11-20-03"))
    repo.commit("outsider", author=OUTSIDER)
    assert run(repo, cfg, db_urls[1]) == 2
    assert admin_sql("select count(*) from public.items where id = '2026-11-20-03'") == [(0,)]
    assert admin_sql("select last_commit from public.sync_state") == [(last,)]


def test_tst_sync_12_reset_baseline(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                    tmp_path: Path) -> None:
    """TST-SYNC-12:reset_baseline で検査を飛ばし、基準が付け直される。"""
    cfg = write_config(tmp_path)
    base = repo.head()
    repo.put_item(make_item("2026-11-20-03"))
    repo.commit("third")
    assert run(repo, cfg, db_urls[1]) == 0
    repo.git("reset", "-q", "--hard", base)
    repo.put_item(make_item("2026-11-20-04"))
    new_head = repo.commit("rewritten")
    assert run(repo, cfg, db_urls[1]) == 2
    summary = tmp_path / "summary.md"
    assert run(repo, cfg, db_urls[1], "--reset-baseline", "--mode", "recent", summary=summary) == 0
    assert admin_sql("select last_commit from public.sync_state") == [(new_head,)]
    assert admin_sql("select count(*) from public.items where id = '2026-11-20-04'") == [(1,)]
    text = summary.read_text(encoding="utf-8")
    assert "基準を付け直した" in text
    assert "DB にあって JSON に無い id:1" in text  # 2026-11-20-03(消していない)
    assert run(repo, cfg, db_urls[1]) == 0


@pytest.mark.parametrize("kind", ["untracked", "modified", "ignored"])
@pytest.mark.parametrize("first_run", [True, False])
def test_tst_sync_11b_dirty_tree_writes_nothing(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                                tmp_path: Path, kind: str, first_run: bool) -> None:
    """TST-SYNC-11b:data/items/ にコミットしていないファイルがあれば、何も書かずに終了コード 2(初回・基準の付け直しも)。"""
    from test_source import make_dirty
    cfg = write_config(tmp_path)
    if not first_run:
        assert run(repo, cfg, db_urls[1]) == 0
    before_items = admin_sql("select id, title, synced_at from public.items order by id")
    before_state = admin_sql("select last_commit, updated_at from public.sync_state")
    make_dirty(repo, kind)
    summary = tmp_path / "summary.md"
    assert run(repo, cfg, db_urls[1], summary=summary) == 2
    assert run(repo, cfg, db_urls[1], "--reset-baseline", "--mode", "recent") == 2
    assert admin_sql("select id, title, synced_at from public.items order by id") == before_items
    assert admin_sql("select last_commit, updated_at from public.sync_state") == before_state
    assert "E-SRC-DIRTY" in summary.read_text(encoding="utf-8")


def test_bad_file_names_exit_1(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                               tmp_path: Path) -> None:
    """4.2 の 4:名前の形が違うファイルがあれば、正しい日は書いて終了コード 1。"""
    repo.put_file("data/items/notes.txt", b"x")
    repo.commit("stray")
    assert run(repo, write_config(tmp_path), db_urls[1]) == 1
    assert admin_sql("select count(*) from public.items") == [(6,)]


def test_images_only_in_range_newest_first(db_urls: tuple[str, str], admin_sql: Any, repo: GitRepo,
                                           tmp_path: Path) -> None:
    """4.2 の 7:image_url が null で source_url がある、範囲の日の行を新しい順に取りに行く。"""
    f = NoNetFetcher()
    assert run(repo, write_config(tmp_path), db_urls[1], fetcher=f) == 0
    assert f.urls[0] == "https://news.example.com/2026-11-20-01"
    assert len(f.urls) == 6
    f2 = NoNetFetcher()
    assert run(repo, write_config(tmp_path), db_urls[1], "--mode", "range", "--from", "2026-11-18",
               "--to", "2026-11-18", fetcher=f2) == 0
    assert f2.urls == ["https://news.example.com/2026-11-18-01", "https://news.example.com/2026-11-18-02"]


def test_tst_sync_04_and_15_no_values_in_output(db_urls: tuple[str, str], admin_sql: Any,
                                                tmp_path: Path) -> None:
    """TST-SYNC-04・15:ログと要約に、見本の値(タイトル・URL・:: で始まる文・メモ)が1つも出ない。"""
    repo = GitRepo(tmp_path / "leak")
    secrets_ = {
        "title": "::warning::架空の秘密の見出し",
        "lead": "::set-output name=x::架空のリード",
        "sourceUrl": "https://leak.example.com/secret-path",
        "sourceTitle": "::error::架空の出典名",
    }
    repo.put_item(make_item("2026-11-20-01", **secrets_, memo="架空のメモ本文", rating="架空の評価",
                            unknownField="架空の未知の値"))
    # 不正な日の値も出ない
    repo.put_item(make_item("2026-11-19-01", sourceUrl="http://leak2.example.com/secret2",
                            title="::endgroup::架空の見出し2"))
    repo.commit("leak")
    out = io.StringIO()
    summary = tmp_path / "summary.md"
    assert run(repo, write_config(tmp_path), db_urls[1], out=out, summary=summary) == 1
    text = out.getvalue() + summary.read_text(encoding="utf-8")
    for v in [*secrets_.values(), "leak.example.com", "secret-path", "leak2.example.com", "secret2",
              "架空の見出し2", "架空のメモ本文", "架空の評価", "unknownField", "架空の未知の値", "memo", "rating",
              db_urls[1]]:
        assert v not in text, v
    assert "Traceback" not in text
    assert "捨てた項目:3" in text
    assert "E-URL-SCHEME 1" in text
    lines = out.getvalue().splitlines()
    m = re.fullmatch(r"::stop-commands::([0-9a-f]{32})", lines[0])
    assert m and lines[-1] == f"::{m.group(1)}::"
    # メモ・評価は DB のどこにも入らない
    assert admin_sql("select count(*) from public.item_feedback") == [(0,)]
