"""起動:python -m nodal_sync run|watch(依頼 10-1 の 4.1・4.2・4.8・4.9)。

- 出力の最初に ::stop-commands::<乱数> を出し、終わりに ::<乱数>:: で戻す(値がワークフローのコマンドとして読まれないように)
- 例外はすべてここで受け、トレースバックを出さずに決まった文と決まりの番号だけを出す(終了コード 2)
- 終了コード:0=全部正しい/1=不正な日・書き込みの失敗・不正なファイルがある/2=止まった(何も書いていない)
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import secrets
import sys
from collections import Counter
from typing import Any, Mapping, NoReturn, TextIO

from . import report, source
from .config import Config, ConfigError, load_config
from .ogimage import Fetcher, fetch_images
from .schema import parse_date, validate_day

JST = dt.timezone(dt.timedelta(hours=9))
RECENT_DAYS = 3
MAX_RANGE_DAYS = 400

MESSAGES = {
    "E-ARGS": "引数が正しくありません",
    "E-ARGS-DATE": "日付の引数が正しくありません",
    "E-ARGS-DATA-DIR": "--data-dir がフォルダではありません",
    "E-CONFIG-READ": "設定を読めませんでした",
    "E-CONFIG-JSON": "設定が JSON として正しくありません",
    "E-CONFIG-KEYS": "設定のキーが正しくありません",
    "E-CONFIG-SLOTS": "設定の slots が正しくありません",
    "E-CONFIG-AUTHORS": "設定の authors が正しくありません",
    "E-CONFIG-OWNER": "設定の owner_login が正しくありません",
    "E-CONFIG-REPO": "設定の app_repo が正しくありません",
    "E-CONFIG-FEED-CHECKS": "設定の feed_checks が正しくありません",
    "E-DB-URL": "SYNC_DB_URL がありません",
    "E-DB-CONFIG": "DB の接続の設定が正しくありません",
    "E-DB-CA": "DB の CA 証明書がありません",
    "E-DB-CONNECT": "DB に接続できませんでした",
    "E-DB-READ": "DB を読めませんでした",
    "E-DB-WRITE": "DB に書き込めませんでした",
    "E-GIT-RUN": "git を実行できませんでした",
    "E-GIT-HEAD": "HEAD のコミットを読めませんでした",
    "E-GIT-LOG": "git の履歴を読めませんでした",
    "E-HISTORY-REWRITE": "履歴の書き換え:前回のコミットが HEAD の祖先ではありません",
    "E-HISTORY-AUTHOR": "authors に無い人が data/items/ を変えています",
    "E-SRC-DIR": "data/items/ を読めませんでした",
    "E-GH-TOKEN": "GITHUB_TOKEN がありません",
    "E-UNEXPECTED": "想定外の失敗",
}


class ArgError(Exception):
    def __init__(self, code: str = "E-ARGS") -> None:
        super().__init__(code)
        self.code = code


class Stop(Exception):
    """手順の途中で止まる(終了コード 2)。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _Parser(argparse.ArgumentParser):
    # argparse の既定は、間違った値をそのまま表示するので、決まった文だけにする
    def error(self, message: str) -> NoReturn:
        raise ArgError()


def build_parser() -> argparse.ArgumentParser:
    p = _Parser(prog="python -m nodal_sync")
    sub = p.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    watch = sub.add_parser("watch")
    for s in (run, watch):
        s.add_argument("--config", required=True)
        s.add_argument("--data-dir", required=True)
        s.add_argument("--ca")
    run.add_argument("--mode", choices=("recent", "range", "all"), default="recent")
    run.add_argument("--from", dest="date_from")
    run.add_argument("--to", dest="date_to")
    run.add_argument("--reset-baseline", action="store_true")
    return p


def select_days(mode: str, date_from: str | None, date_to: str | None,
                today: dt.date) -> list[dt.date] | None:
    """範囲の日の一覧(古い順)。all は None。おかしければ ArgError。"""
    if mode != "range":
        if date_from is not None or date_to is not None:
            raise ArgError("E-ARGS-DATE")
        if mode == "all":
            return None
        return [today - dt.timedelta(days=n) for n in range(RECENT_DAYS - 1, -1, -1)]
    if date_from is None or date_to is None:
        raise ArgError("E-ARGS-DATE")
    start, end = parse_date(date_from), parse_date(date_to)
    if start is None or end is None or start > end:
        raise ArgError("E-ARGS-DATE")
    n = (end - start).days + 1
    if n > MAX_RANGE_DAYS:
        raise ArgError("E-ARGS-DATE")
    return [start + dt.timedelta(days=i) for i in range(n)]


def _say(out: TextIO, code: str) -> None:
    report.log(out, f"{MESSAGES.get(code, '止まりました')}({code})")


def _load(args: argparse.Namespace) -> Config:
    if not os.path.isdir(args.data_dir):
        raise Stop("E-ARGS-DATA-DIR")
    try:
        return load_config(args.config)
    except ConfigError as e:
        raise Stop(e.code) from None


def _run(args: argparse.Namespace, today: dt.date, env: Mapping[str, str], out: TextIO,
         fetcher: Fetcher | None) -> int:
    summary = report.RunSummary(mode=args.mode)
    try:
        days = select_days(args.mode, args.date_from, args.date_to, today)
        cfg = _load(args)
        url = env.get("SYNC_DB_URL")
        if not url:
            raise Stop("E-DB-URL")
        from . import db
        try:
            conn = db.connect(url, args.ca)
        except db.DbError as e:
            raise Stop(e.code) from None
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2

    try:
        return _run_with_db(args, today, env, out, fetcher, cfg, days, db, conn, summary)
    finally:
        conn.close()


def _run_with_db(args: argparse.Namespace, today: dt.date, env: Mapping[str, str], out: TextIO,
                 fetcher: Fetcher | None, cfg: Config, days: list[dt.date] | None, db: Any,
                 conn: Any, summary: report.RunSummary) -> int:
    # 2〜4:読むだけ。ここで止まったら何も書いていない
    try:
        try:
            genres = db.read_genres(conn)
            last = db.read_last_commit(conn)
        except db.DbError as e:
            raise Stop(e.code) from None
        try:
            head = source.head_commit(args.data_dir)
            if args.reset_baseline:
                summary.notes.append("基準を付け直した(履歴の検査を飛ばした)")
            elif last is None:
                summary.notes.append("初回(履歴の検査を飛ばした)")
            else:
                source.check_history(args.data_dir, last, head, cfg.is_author)
            listing = source.list_items(args.data_dir, set(days) if days is not None else None)
        except source.SourceError as e:
            if e.code == "E-HISTORY-REWRITE":
                summary.notes.append("履歴の書き換え")
            raise Stop(e.code) from None
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2

    exit_code = 0
    summary.bad_files = listing.bad_files
    if listing.bad_files:
        exit_code = 1

    # 4・5:日ごとに調べて、正しい日だけ書く
    json_ids: set[str] = set()
    for day in sorted(listing.by_day):
        files = listing.by_day[day]
        json_ids.update(i for i, _ in files)
        res = validate_day(day, files, genres=genres, slots=cfg.slots,
                           allow_null_genre=(args.mode == "all"), today=today)
        ds = report.DaySummary(day=day, read=res.read, errors=Counter(c for _, c in res.errors))
        summary.dropped += res.dropped
        summary.overlaps += res.overlaps
        if not res.valid:
            exit_code = 1
        else:
            try:
                ds.inserted, ds.updated, ds.unchanged = db.write_day(conn, res.rows)
            except db.DbError:
                ds.write_failed = True
                exit_code = 1
        summary.days.append(ds)

    # 6:基準の記録
    try:
        db.write_last_commit(conn, head)
        summary.baseline_saved = True
    except db.DbError:
        exit_code = 1

    # DB にあって JSON に無い id(範囲の日だけ。消さない)
    try:
        summary.missing_in_json = len(db.item_ids_on(conn, days) - json_ids)
    except db.DbError:
        exit_code = 1

    # 7:画像(取れなくても終了コードは変えない)
    try:
        targets = db.image_targets(conn, days)
    except db.DbError:
        targets = []
    f = fetcher if fetcher is not None else Fetcher()
    summary.images_ok, summary.images_ng = fetch_images(
        targets, f, lambda i, s, u: db.set_image(conn, i, s, u))

    report.emit_summary(summary.render(), env, out)
    report.log(out, f"run を終えました(終了コード {exit_code})")
    return exit_code


def _watch(args: argparse.Namespace, today: dt.date, env: Mapping[str, str], out: TextIO,
           gh_get: Any) -> int:
    from . import ghapi, watch
    try:
        cfg = _load(args)
        token = env.get("GITHUB_TOKEN")
        if not token:
            raise Stop("E-GH-TOKEN")
        url = env.get("SYNC_DB_URL")
        if not url:
            raise Stop("E-DB-URL")
        from . import db
        try:
            conn = db.connect(url, args.ca)
        except db.DbError as e:
            raise Stop(e.code) from None
        try:
            checker = ghapi.MainCheck(token, gh_get) if gh_get is not None else ghapi.MainCheck(token)
            findings = watch.run_watch(db, conn, cfg, args.data_dir, today,
                                       lambda: checker.check(cfg.app_repo, cfg.owner_login))
        except db.DbError as e:
            raise Stop(e.code) from None
        finally:
            conn.close()
    except Stop as e:
        _say(out, e.code)
        report.emit_summary(report.render_stop("watch", e.code), env, out)
        return 2
    report.emit_summary(report.render_watch([(f.code, f.count, f.ids) for f in findings]), env, out)
    code = 1 if findings else 0
    report.log(out, f"watch を終えました(終了コード {code})")
    return code


def main(argv: list[str] | None = None, *, today: dt.date | None = None,
         env: Mapping[str, str] | None = None, out: TextIO | None = None,
         fetcher: Fetcher | None = None, gh_get: Any = None) -> int:
    """today・env・out・fetcher・gh_get は試験から差し替える。"""
    o: TextIO = out if out is not None else sys.stdout
    e: Mapping[str, str] = env if env is not None else os.environ
    token = secrets.token_hex(16)
    o.write(f"::stop-commands::{token}\n")
    o.flush()
    code = 2
    try:
        try:
            args = build_parser().parse_args(argv)
        except ArgError as err:
            _say(o, err.code)
            return 2
        d = today if today is not None else dt.datetime.now(JST).date()
        if args.command == "run":
            try:
                select_days(args.mode, args.date_from, args.date_to, d)
            except ArgError as err:
                _say(o, err.code)
                return 2
            code = _run(args, d, e, o, fetcher)
        else:
            code = _watch(args, d, e, o, gh_get)
        return code
    except SystemExit as se:
        # --help のとき(argparse が表示して終わる)
        return se.code if isinstance(se.code, int) else 2
    except BaseException:
        try:
            _say(o, "E-UNEXPECTED")
        except BaseException:
            pass
        return 2
    finally:
        o.write(f"::{token}::\n")
        o.flush()


if __name__ == "__main__":
    sys.exit(main())
