"""起動:python -m nodal_sync run|watch|feed(依頼 10-1 の 4.1・4.2・4.8・4.9、依頼 12-1 の feed。詳細設計 3.7・3.8)。

- 出力の最初に ::stop-commands::<乱数> を出し、終わりに ::<乱数>:: で戻す(値がワークフローのコマンドとして読まれないように)
- 例外はすべてここで受け、トレースバックを出さずに決まった文と決まりの番号だけを出す(終了コード 2)
- run の終了コード:0=全部正しい/1=不正な日・書き込みの失敗・不正なファイルがある/2=止まった(何も書いていない)
- feed の終了コード:0=全部成功か、続けての失敗が 3 回未満/1=続けて 3 回失敗した取得先がある・全部失敗した
  (dry-run は1回の失敗でも 1)/2=止まった(設定・Expat の版・DB の接続・書き込みの失敗。何も書いていない)
- feed の翻訳(依頼 12-4。詳細設計 3.13):原文の保存の後に別のトランザクションで訳す。翻訳の失敗では終了コードを
  変えない。ただし 401(E-TR-AUTH)と翻訳の途中の DB の失敗(E-DB-*。原文の保存は残る)は 1、
  鍵と地域の片方だけ・形の誤り(E-TR-CONFIG)は 2。取得と保存の終了コードと合わせるときは大きいほう
- feed-backup・feed-restore(依頼 12-6。詳細設計 3.14)の終了コード:0=成功(dry-run を含む)/2=止まった
  (引数・FEED_DB_URL・接続・読み出し・書き出し先・ファイルの形・不正な行 E-RESTORE-ROW・書き込みの失敗)。
  feed-restore が 2 のときは DB に何も書いていない
- feed-digest・feed-digest-backlog(依頼 12-7。詳細設計 3.15)の終了コード:0=成功(dry-run を含む。
  7日より古い null の行 E-DIGEST-OLD は要約に出すだけ)/2=止まった(引数・FEED_DB_URL・接続・読み出し・
  書き出し先・ファイルの形 E-DIGEST-FILE・書き込みの失敗)。2 のときは DB に何も書いていない
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import secrets
import sys
from collections import Counter
from typing import Any, Mapping, NoReturn, TextIO

from . import report, source
from .config import Config, ConfigError, load_config, load_files
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
    "E-ARGS-EXPECTED-HEAD": "--expected-head が無いか、40 桁の小文字の SHA ではありません",
    "E-HEAD-MISMATCH": "HEAD が --expected-head と違います(何も書いていない)",
    "E-SRC-DIR": "data/items/ を読めませんでした",
    "E-SRC-DIRTY": "data/items/ に未コミットの変更があります",
    "E-SRC-TREE": "ai-netacho に想定外のファイルがあります",
    "E-CONFIG-FILES": "設定の ai_netacho_files.json が無いか、正しくありません",
    "E-GH-TOKEN": "GITHUB_TOKEN がありません",
    "E-FEED-EXPAT": "Expat の版が 2.7.2 より古いので、フィードを読みません",
    "E-FEED-CONFIG-READ": "フィードの設定を読めませんでした",
    "E-FEED-CONFIG-JSON": "フィードの設定が JSON として正しくありません",
    "E-FEED-CONFIG-KEYS": "フィードの設定のキーが正しくありません",
    "E-FEED-CONFIG-WATCH": "フィードの設定の watch_products が正しくありません",
    "E-FEED-CONFIG-SOURCES": "フィードの設定の sources の数が正しくありません",
    "E-FEED-CONFIG-SOURCE-KEYS": "フィードの取得先のキーが正しくありません",
    "E-FEED-CONFIG-ID": "フィードの取得先の id が正しくないか、重なっています",
    "E-FEED-CONFIG-KIND": "フィードの取得先の kind が正しくありません",
    "E-FEED-CONFIG-NAME": "フィードの取得先の vendor・product が正しくありません",
    "E-FEED-CONFIG-FORMAT": "フィードの取得先の format が正しくありません",
    "E-FEED-CONFIG-URL": "フィードの取得先の url が正しくありません",
    "E-FEED-CONFIG-LANG": "フィードの取得先の lang が正しくありません",
    "E-FEED-CONFIG-TRANSLATE": "フィードの取得先の translate が正しくありません",
    "E-FEED-CONFIG-FILTER": "フィードの取得先の filter が正しくありません",
    "E-FEED-CONFIG-ENABLED": "フィードの取得先の enabled が正しくありません",
    "E-FEED-CONFIG-MAX-BYTES": "フィードの取得先の max_bytes が正しくありません",
    "E-FEED-CONFIG-MAX-AGE": "フィードの取得先の max_age_days が正しくありません",
    "E-FEED-DB-URL": "FEED_DB_URL がありません",
    "E-TR-CONFIG": "翻訳の鍵と地域の設定が正しくありません(原文は保存済み)",
    "E-TR-AUTH": "翻訳の鍵が受け付けられませんでした(原文は保存済み)",
    "E-BACKUP-OUT": "--out がフォルダでないか、feed/ の形が正しくありません",
    "E-BACKUP-WRITE": "バックアップのファイルを書けませんでした",
    "E-RESTORE-FILE": "--in のファイルの形が正しくありません(何も書いていない)",
    "E-RESTORE-ROW": "バックアップに不正な行があります(何も書いていない)",
    "E-DIGEST-OLD": "7日より古い null の行があります(一覧に入れていない)",
    "E-DIGEST-ROW": "DB の行の形が一覧に合いません(何も書いていない)",
    "E-DIGEST-WRITE": "feed_digest のファイルを書けませんでした",
    "E-DIGEST-FILE": "feed_digest のファイルの形か id が正しくありません(何も書いていない)",
    "E-UNEXPECTED": "想定外の失敗",
}
FEED_FAIL_LIMIT = 3  # 続けて 3 回失敗したら終了コード 1(失敗メールが届く)


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
    run.add_argument("--expected-head")
    feed = sub.add_parser("feed")
    feed.add_argument("--config", required=True)
    feed.add_argument("--ca")
    feed.add_argument("--dry-run", action="store_true")
    feed.add_argument("--no-translate", action="store_true")
    fb = sub.add_parser("feed-backup")
    fb.add_argument("--out", required=True)
    fb.add_argument("--ca")
    fr = sub.add_parser("feed-restore")
    fr.add_argument("--in", dest="in_dir", required=True)
    fr.add_argument("--ca")
    fr.add_argument("--dry-run", action="store_true")
    fd = sub.add_parser("feed-digest")
    fd.add_argument("--data-dir", required=True)
    fd.add_argument("--ca")
    fd.add_argument("--dry-run", action="store_true")
    fd.add_argument("--commit-db", action="store_true")
    fd.add_argument("--date", dest="digest_date")
    fdb = sub.add_parser("feed-digest-backlog")
    fdb.add_argument("--before", required=True)
    fdb.add_argument("--ca")
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


def check_expected_head(reset_baseline: bool, expected_head: str | None) -> None:
    """--reset-baseline には 40 桁の小文字の SHA が要る。無いのに有るのも不正(詳細設計 2.4)。おかしければ ArgError。"""
    if not reset_baseline:
        if expected_head is not None:
            raise ArgError("E-ARGS-EXPECTED-HEAD")
        return
    # strip しない(前後の空白も不正)
    if expected_head is None or not re.fullmatch(r"[0-9a-f]{40}", expected_head):
        raise ArgError("E-ARGS-EXPECTED-HEAD")


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
        try:
            ai_files = load_files(args.config)  # --config と同じフォルダの ai_netacho_files.json
        except ConfigError as e:
            raise Stop(e.code) from None
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
        return _run_with_db(args, today, env, out, fetcher, cfg, ai_files, days, db, conn, summary)
    finally:
        conn.close()


def _run_with_db(args: argparse.Namespace, today: dt.date, env: Mapping[str, str], out: TextIO,
                 fetcher: Fetcher | None, cfg: Config, ai_files: dict[str, str],
                 days: list[dt.date] | None, db: Any, conn: Any, summary: report.RunSummary) -> int:
    # 2〜4:読むだけ。ここで止まったら何も書いていない
    try:
        try:
            genres = db.read_genres(conn)
            last = db.read_last_commit(conn)
        except db.DbError as e:
            raise Stop(e.code) from None
        try:
            head = source.head_commit(args.data_dir)
            # オーナーが確かめた HEAD のときだけ基準を付け直す。SHA の値はどこにも出さない
            if args.reset_baseline and head != args.expected_head:
                raise Stop("E-HEAD-MISMATCH")
            if args.reset_baseline:
                summary.notes.append("基準を付け直した(履歴の検査を飛ばした)")
            elif last is None:
                summary.notes.append("初回(履歴の検査を飛ばした)")
            else:
                source.check_history(args.data_dir, last, head, cfg.is_author)
            # 履歴の検査はコミットしか見ないので、作業ツリーが HEAD と同じことを確かめる(検査を飛ばしたときも)
            source.check_clean(args.data_dir)
            # ファイルの形の検査(詳細設計 2.4 の3):今の木は毎回、履歴は前回の基準があるときだけ
            source.check_tree(args.data_dir, head, ai_files)
            if not args.reset_baseline and last is not None:
                source.check_tree_history(args.data_dir, last, head, ai_files)
            listing = source.list_items(args.data_dir, set(days) if days is not None else None)
        except source.SourceError as e:
            if e.code == "E-HISTORY-REWRITE":
                summary.notes.append("履歴の書き換え")
            if isinstance(e, source.TreeError):
                summary.tree_paths = e.paths
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


def feed_exit_code(outcomes: list[Any], failures: Mapping[str, int] | None) -> int:
    """詳細設計 3.7。failures(書いた後の consecutive_failures)が None なら dry-run で、1回の失敗でも 1。"""
    if not outcomes:
        return 0
    failed = [o for o in outcomes if not o.ok]
    if failures is None:
        return 1 if failed else 0
    if len(failed) == len(outcomes):
        return 1
    return 1 if any(n >= FEED_FAIL_LIMIT for n in failures.values()) else 0


def _translate(args: argparse.Namespace, cfg: Any, env: Mapping[str, str], out: TextIO, url: str,
               connect: Any, send: Any, now: dt.datetime, tr: report.TranslateSummary) -> int:
    """原文の保存の後に訳す(詳細設計 3.13)。dry-run・--no-translate・鍵なしは、外にも DB にも何も送らない。"""
    from . import feedtranslate
    if args.dry_run:
        tr.state = "dry-run"
        return 0
    if args.no_translate:
        tr.state = "no-translate"
        return 0
    try:
        creds = feedtranslate.read_credentials(env)
    except feedtranslate.TranslateConfigError as err:
        tr.state = "config"
        tr.stop = err.code
        _say(out, err.code)
        return 2
    if creds is None:
        tr.state = "no-key"
        return 0
    from . import feeddb
    open_db = connect if connect is not None else feeddb.connect
    feedtranslate.run(feeddb, lambda: open_db(url, args.ca), cfg, creds,
                      send if send is not None else feedtranslate.HttpsSender(), now, tr)
    if tr.exit_code and tr.stop:
        _say(out, tr.stop)  # E-TR-AUTH・E-DB-*(決まった文と番号だけ)
    return tr.exit_code


def _feed(args: argparse.Namespace, env: Mapping[str, str], out: TextIO, fetcher: Any,
          now: dt.datetime, connect: Any, translate_send: Any = None) -> int:
    """取得 → 解析 → 検査 → 保存(詳細設計 3.4〜3.7)。外との通信を全部終えてから DB に書く。"""
    from . import feedparse
    from .feedconfig import FeedConfigError, load_feed_config
    from .feedhttp import FeedFetcher

    summary = report.FeedSummary(dry_run=args.dry_run)
    states: dict[str, tuple[str | None, str | None]] = {}
    url = ""
    try:
        # 1. 解析の前に Expat の版を確かめる(古い Expat は実体の展開の守りが足りない)
        if not feedparse.expat_ok(feedparse.expat_version()):
            raise Stop("E-FEED-EXPAT")
        try:
            cfg = load_feed_config(args.config)
        except FeedConfigError as err:
            raise Stop(err.code) from None
        if not args.dry_run:
            # 2. 前回の etag・last_modified を読む(読むだけ。接続はすぐ閉じ、外と通信する間は持たない)
            url = env.get("FEED_DB_URL") or ""
            if not url:
                raise Stop("E-FEED-DB-URL")
            from . import db, feeddb
            open_db = connect if connect is not None else feeddb.connect
            try:
                conn = open_db(url, args.ca)
            except db.DbError as err:
                raise Stop(err.code) from None
            try:
                states = feeddb.read_states(conn)
            except db.DbError as err:
                raise Stop(err.code) from None
            finally:
                conn.close()
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2

    # 3. 取得先を順番に取り、解析と filter をする(並列にしない)
    f = fetcher if fetcher is not None else FeedFetcher()
    outcomes: list[feedparse.SourceOutcome] = []
    for src in cfg.sources:
        if not src.enabled:
            continue
        etag, last_modified = states.get(src.id, (None, None))
        fr = f.fetch(src.url, src.format, src.max_bytes, etag, last_modified)
        o = feedparse.SourceOutcome(source=src, code=fr.code, not_modified=fr.not_modified,
                                    etag=fr.etag, last_modified=fr.last_modified)
        if fr.code is None and not fr.not_modified:
            pr = feedparse.parse_feed(src, fr.body, cfg.watch_products, now)
            if pr.error is not None:
                o.code = pr.error
            else:
                o.entries, o.old = feedparse.split_old(pr.entries, src.max_age_days, now)
                o.invalid, o.read, o.filtered = pr.invalid, pr.read, pr.filtered
        outcomes.append(o)

    # 4. 全部の取得先の分を1つのトランザクションで書く
    stats: dict[str, Any] | None = None
    if not args.dry_run:
        from . import db, feeddb
        open_db = connect if connect is not None else feeddb.connect
        try:
            try:
                conn = open_db(url, args.ca)
            except db.DbError as err:
                raise Stop(err.code) from None
            try:
                stats, summary.pending = feeddb.write_all(conn, outcomes)
            except db.DbError as err:
                raise Stop(err.code) from None
            finally:
                conn.close()
        except Stop as e:
            summary.stop_code = e.code
            _say(out, e.code)
            report.emit_summary(summary.render(), env, out)
            return 2

    for o in outcomes:
        s = report.FeedSourceSummary(source_id=o.source.id, read=o.read, old=o.old, filtered=o.filtered,
                                     invalid=o.invalid)
        s.result = o.code if o.code is not None else ("304" if o.not_modified else "ok")
        if stats is None:
            s.inserted = len(o.entries)  # dry-run では「入れる候補の数」
        else:
            st = stats[o.source.id]
            s.inserted, s.updated, s.merged, s.unchanged = st.inserted, st.updated, st.merged, st.unchanged
            s.failures = st.failures
        summary.sources.append(s)

    failures = None if stats is None else {k: v.failures for k, v in stats.items()}
    code = feed_exit_code(outcomes, failures)

    # 5. 翻訳(原文の書き込みのトランザクションは、ここまでに終わっている)
    summary.translate = report.TranslateSummary()
    code = max(code, _translate(args, cfg, env, out, url, connect, translate_send, now, summary.translate))
    report.emit_summary(summary.render(), env, out)
    report.log(out, f"feed を終えました(終了コード {code})")
    return code


def _open_feed_db(args: argparse.Namespace, env: Mapping[str, str], connect: Any) -> Any:
    """FEED_DB_URL で netacho_feed につなぐ(application_name は nodal-backup)。失敗は Stop。"""
    url = env.get("FEED_DB_URL") or ""
    if not url:
        raise Stop("E-FEED-DB-URL")
    from . import db, feedbackup
    open_db = connect if connect is not None else feedbackup.connect
    try:
        return open_db(url, args.ca)
    except db.DbError as err:
        raise Stop(err.code) from None


def _feed_backup(args: argparse.Namespace, env: Mapping[str, str], out: TextIO, connect: Any) -> int:
    """DB を全部読んでから、--out の下の feed/ と usage.jsonl を書き直す(詳細設計 3.14.2)。"""
    from . import db, feedbackup
    summary = report.BackupSummary()
    try:
        if not os.path.isdir(args.out) or os.path.islink(args.out):
            raise Stop("E-BACKUP-OUT")
        conn = _open_feed_db(args, env, connect)
        try:
            res = feedbackup.backup(conn, args.out)
        except db.DbError as err:
            raise Stop(err.code) from None
        except feedbackup.BackupError as err:
            raise Stop(err.code) from None
        finally:
            conn.close()
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2
    summary.months, summary.usage = res.months, res.usage
    report.emit_summary(summary.render(), env, out)
    report.log(out, "feed-backup を終えました(終了コード 0)")
    return 0


def _feed_restore(args: argparse.Namespace, env: Mapping[str, str], out: TextIO, connect: Any) -> int:
    """先に全部の行を検査し、合えば1つのトランザクションで upsert する(詳細設計 3.14.3)。"""
    from . import db, feedbackup
    summary = report.RestoreSummary(dry_run=args.dry_run, max_listed=feedbackup.MAX_LISTED)
    try:
        try:
            loaded = feedbackup.load_backup(args.in_dir)
        except feedbackup.BackupError as err:
            raise Stop(err.code) from None
        summary.read, summary.usage_read = len(loaded.entries), len(loaded.usage)
        if loaded.bad:
            summary.bad = loaded.bad
            raise Stop("E-RESTORE-ROW")
        if not args.dry_run:
            conn = _open_feed_db(args, env, connect)
            try:
                e_counts, u_counts = feedbackup.restore(conn, loaded)
            except db.DbError as err:
                raise Stop(err.code) from None
            finally:
                conn.close()
            summary.inserted, summary.updated, summary.unchanged = (
                e_counts.inserted, e_counts.updated, e_counts.unchanged)
            summary.usage_inserted, summary.usage_updated, summary.usage_unchanged = (
                u_counts.inserted, u_counts.updated, u_counts.unchanged)
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2
    report.emit_summary(summary.render(), env, out)
    report.log(out, "feed-restore を終えました(終了コード 0)")
    return 0


def _open_digest_db(args: argparse.Namespace, env: Mapping[str, str], connect: Any) -> Any:
    """FEED_DB_URL で netacho_feed につなぐ(application_name は nodal-digest)。失敗は Stop。"""
    url = env.get("FEED_DB_URL") or ""
    if not url:
        raise Stop("E-FEED-DB-URL")
    from . import db, feeddigest
    open_db = connect if connect is not None else feeddigest.connect
    try:
        return open_db(url, args.ca)
    except db.DbError as err:
        raise Stop(err.code) from None


def _feed_digest(args: argparse.Namespace, env: Mapping[str, str], out: TextIO, connect: Any,
                 now: dt.datetime) -> int:
    """一覧を作って書く。--commit-db はファイルの id の行の digest_date をその日にする(詳細設計 3.15.2・3.15.3)。"""
    from . import db, feeddigest
    summary = report.DigestSummary(dry_run=args.dry_run, mode="commit" if args.commit_db else "build")
    try:
        if args.commit_db:
            day = feeddigest.parse_day(args.digest_date)
            if day is None:
                raise Stop("E-ARGS-DATE")
            summary.day = day
            try:
                ids = feeddigest.read_ids(args.data_dir, day)  # DB に触れる前に、全部の id を確かめる
            except feeddigest.DigestError as err:
                raise Stop(err.code) from None
            summary.listed = len(ids)
            if not args.dry_run:
                conn = _open_digest_db(args, env, connect)
                try:
                    res = feeddigest.commit_db(conn, day, ids)
                except db.DbError as err:
                    raise Stop(err.code) from None
                finally:
                    conn.close()
                summary.updated, summary.unchanged, summary.missing = res.updated, res.unchanged, res.missing
        else:
            if args.digest_date is not None:
                raise Stop("E-ARGS-DATE")  # 一覧の日付は日本時間の今日だけ(--date は --commit-db のときだけ)
            if not os.path.isdir(args.data_dir) or os.path.islink(args.data_dir):
                raise Stop("E-ARGS-DATA-DIR")
            summary.day = feeddigest.jst_today(now)
            conn = _open_digest_db(args, env, connect)
            try:
                d = feeddigest.build(conn, now)
            except db.DbError as err:
                raise Stop(err.code) from None
            except feeddigest.DigestError as err:
                raise Stop(err.code) from None
            finally:
                conn.close()
            summary.day = d.day
            summary.entries, summary.today_rows, summary.new_rows, summary.old = (
                len(d.entries), d.today_rows, d.new_rows, d.old)
            if not args.dry_run:
                try:
                    summary.path = feeddigest.write_file(args.data_dir, d)
                except feeddigest.DigestError as err:
                    raise Stop(err.code) from None
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2
    if summary.old:
        _say(out, "E-DIGEST-OLD")
    report.emit_summary(summary.render(), env, out)
    report.log(out, "feed-digest を終えました(終了コード 0)")
    return 0


def _feed_digest_backlog(args: argparse.Namespace, env: Mapping[str, str], out: TextIO, connect: Any,
                         now: dt.datetime) -> int:
    """始めるときの1回だけ:その日より前の null の行に印を付ける(詳細設計 3.15.5)。"""
    from . import db, feeddigest
    summary = report.DigestSummary(command="feed-digest-backlog", mode="backlog")
    try:
        before = feeddigest.parse_day(args.before)
        # 日本時間の今日より後は止める(今日の行に今日の印が付くと、今日の一覧に載ってしまう)
        if before is None or before > feeddigest.jst_today(now):
            raise Stop("E-ARGS-DATE")
        summary.day = before
        conn = _open_digest_db(args, env, connect)
        try:
            summary.marked = feeddigest.backlog(conn, before)
        except db.DbError as err:
            raise Stop(err.code) from None
        finally:
            conn.close()
    except Stop as e:
        summary.stop_code = e.code
        _say(out, e.code)
        report.emit_summary(summary.render(), env, out)
        return 2
    report.emit_summary(summary.render(), env, out)
    report.log(out, "feed-digest-backlog を終えました(終了コード 0)")
    return 0


def main(argv: list[str] | None = None, *, today: dt.date | None = None,
         env: Mapping[str, str] | None = None, out: TextIO | None = None,
         fetcher: Fetcher | None = None, gh_get: Any = None, feed_fetcher: Any = None,
         now: dt.datetime | None = None, feed_connect: Any = None, translate_send: Any = None) -> int:
    """today・env・out・fetcher・gh_get・feed_fetcher・now・feed_connect・translate_send は試験から差し替える。"""
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
                check_expected_head(args.reset_baseline, args.expected_head)
            except ArgError as err:
                _say(o, err.code)
                return 2
            code = _run(args, d, e, o, fetcher)
        elif args.command == "feed":
            n = now if now is not None else dt.datetime.now(dt.timezone.utc)
            code = _feed(args, e, o, feed_fetcher, n, feed_connect, translate_send)
        elif args.command == "feed-backup":
            code = _feed_backup(args, e, o, feed_connect)
        elif args.command == "feed-restore":
            code = _feed_restore(args, e, o, feed_connect)
        elif args.command == "feed-digest":
            n = now if now is not None else dt.datetime.now(dt.timezone.utc)
            code = _feed_digest(args, e, o, feed_connect, n)
        elif args.command == "feed-digest-backlog":
            n = now if now is not None else dt.datetime.now(dt.timezone.utc)
            code = _feed_digest_backlog(args, e, o, feed_connect, n)
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
