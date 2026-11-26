"""ログと要約(依頼 10-1 の 4.2 の 8・4.9、依頼 12-1 の feed。詳細設計 3.8)。

ここに渡すのは、件数・形を確かめた id・決まりの番号だけ。JSON やページの値は渡さない。
"""

from __future__ import annotations

import datetime as dt
from collections import Counter
from dataclasses import dataclass, field
from typing import Mapping, TextIO


@dataclass
class DaySummary:
    day: dt.date
    read: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    errors: Counter[str] = field(default_factory=Counter)
    write_failed: bool = False


@dataclass
class RunSummary:
    mode: str = ""
    notes: list[str] = field(default_factory=list)
    stop_code: str | None = None
    days: list[DaySummary] = field(default_factory=list)
    bad_files: int = 0
    dropped: int = 0
    overlaps: int = 0
    images_ok: int = 0
    images_ng: int = 0
    missing_in_json: int = 0
    baseline_saved: bool = False

    def render(self) -> str:
        out = ["## nodal-sync run", "", f"- 範囲:{self.mode}"]
        out += [f"- {n}" for n in self.notes]
        if self.stop_code:
            out.append(f"- 止まった:{self.stop_code}(何も書いていない)")
            return "\n".join(out) + "\n"
        out += [
            f"- 不正なファイル(名前の形が違う・リンク):{self.bad_files}",
            f"- 捨てた項目:{self.dropped}",
            f"- 重なり(同じ日の order・タイトル):{self.overlaps}",
            f"- DB にあって JSON に無い id:{self.missing_in_json}(消していない)",
            f"- 画像:取れた {self.images_ok}/取れなかった {self.images_ng}",
            f"- 基準の記録:{'した' if self.baseline_saved else 'できなかった'}",
            "",
            "| 日 | 読んだ | 追加 | 更新 | 変化なし | 不正 | 書き込み |",
            "|---|---|---|---|---|---|---|",
        ]
        for d in self.days:
            errs = "、".join(f"{c} {n}" for c, n in sorted(d.errors.items())) or "-"
            if d.errors:
                w = "しない"
            elif d.write_failed:
                w = "失敗(取り消した)"
            else:
                w = "した"
            out.append(f"| {d.day.isoformat()} | {d.read} | {d.inserted} | {d.updated} | "
                       f"{d.unchanged} | {errs} | {w} |")
        return "\n".join(out) + "\n"


@dataclass
class FeedSourceSummary:
    """取得先1つの行。id は設定で形を確かめた値(^[a-z0-9][a-z0-9-]{0,39}$)。記事の値は持たない。"""
    source_id: str
    result: str = "ok"  # ok / 304 / 失敗の決まりの番号
    read: int = 0
    inserted: int = 0
    updated: int = 0
    merged: int = 0
    unchanged: int = 0
    old: int = 0
    filtered: int = 0
    invalid: Counter[str] = field(default_factory=Counter)
    failures: int | None = None  # 書いた後の consecutive_failures(dry-run は None)


TRANSLATE_SKIPPED = {
    "no-key": "翻訳なし(鍵なし)",
    "dry-run": "翻訳なし(dry-run)",
    "no-translate": "翻訳なし(--no-translate)",
}


@dataclass
class TranslateSummary:
    """翻訳の行(詳細設計 3.13.7)。件数・字数・決まりの番号だけ。原文・訳・鍵は持たない。"""
    state: str = ""            # no-key / dry-run / no-translate / config / ran
    translated: int = 0        # done にした行
    failed: int = 0            # failed になった行
    other: Counter[str] = field(default_factory=Counter)  # 失敗した要求(E-TR-OTHER・E-TR-RESPONSE)
    skipped: int = 0           # translate が none・設定に無い取得先の行(pending のまま)
    sent_chars: int = 0
    metered: int = 0           # X-metered-usage の合計
    month_chars: int | None = None
    pending: int | None = None
    stop: str | None = None    # 止まった理由(E-TR-* ・月の上限・E-DB-*)
    exit_code: int = 0

    def render(self) -> str:
        if self.state in TRANSLATE_SKIPPED:
            return f"- {TRANSLATE_SKIPPED[self.state]}"
        if self.state == "config":
            return f"- 翻訳:止まった {self.stop}(原文は保存済み)"
        others = "、".join(f"{c} {n}" for c, n in sorted(self.other.items())) or "-"
        month = "-" if self.month_chars is None else str(self.month_chars)
        pending = "-" if self.pending is None else str(self.pending)
        return (f"- 翻訳:訳した {self.translated}/failed になった {self.failed}/失敗した要求 {others}/"
                f"訳さない取得先の行 {self.skipped}/pending の残り {pending}/送った字数 {self.sent_chars}/"
                f"X-metered-usage {self.metered}/今月の累計 {month}/止まった理由 {self.stop or '-'}")


@dataclass
class FeedSummary:
    dry_run: bool = False
    stop_code: str | None = None
    sources: list[FeedSourceSummary] = field(default_factory=list)
    pending: int | None = None
    translate: TranslateSummary | None = None

    def render(self) -> str:
        out = ["## nodal-sync feed", ""]
        if self.dry_run:
            out.append("- dry-run(取得・解析・filter まで。DB には接続していない)")
        if self.stop_code:
            out.append(f"- 止まった:{self.stop_code}(何も書いていない)")
            return "\n".join(out) + "\n"
        ok = sum(1 for s in self.sources if s.result in ("ok", "304"))
        out += [
            f"- 取得先:{len(self.sources)}(成功 {ok}/失敗 {len(self.sources) - ok})",
            f"- 新しい行:{sum(s.inserted for s in self.sources)}",
            f"- 訳の待ち(pending):{'-' if self.pending is None else self.pending}",
        ]
        if self.translate is not None:
            out.append(self.translate.render())
        out += [
            "",
            "| 取得先 | 結果 | 記事 | 追加 | 更新 | まとめた | 変化なし | 古くて入れない | filter で外した | 不正 | 続けての失敗 |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for s in self.sources:
            errs = "、".join(f"{c} {n}" for c, n in sorted(s.invalid.items())) or "-"
            fails = "-" if s.failures is None else str(s.failures)
            out.append(f"| {s.source_id} | {s.result} | {s.read} | {s.inserted} | {s.updated} | "
                       f"{s.merged} | {s.unchanged} | {s.old} | {s.filtered} | {errs} | {fails} |")
        return "\n".join(out) + "\n"


@dataclass
class BackupSummary:
    """feed-backup の要約(詳細設計 3.14.2)。月(YYYY-MM。DB の時刻の年と月から作った値)と行数だけ。"""
    stop_code: str | None = None
    months: list[tuple[str, int]] = field(default_factory=list)
    usage: int = 0

    def render(self) -> str:
        out = ["## nodal-sync feed-backup", ""]
        if self.stop_code:
            out.append(f"- 止まった:{self.stop_code}")
            return "\n".join(out) + "\n"
        out += [
            f"- feed_entries:{sum(n for _, n in self.months)} 行({len(self.months)} か月)",
            f"- feed_translate_usage:{self.usage} 行",
            "",
            "| 月(日本時間) | 行 |",
            "|---|---|",
        ]
        out += [f"| {m} | {n} |" for m, n in self.months]
        return "\n".join(out) + "\n"


@dataclass
class RestoreSummary:
    """feed-restore の要約(詳細設計 3.14.3)。件数と、不正な行のファイル名(形を確かめた名前)・行番号だけ。"""
    dry_run: bool = False
    stop_code: str | None = None
    bad: list[tuple[str, int]] = field(default_factory=list)
    max_listed: int = 20
    read: int = 0
    inserted: int | None = None
    updated: int | None = None
    unchanged: int | None = None
    usage_read: int = 0
    usage_inserted: int | None = None
    usage_updated: int | None = None
    usage_unchanged: int | None = None

    def render(self) -> str:
        out = ["## nodal-sync feed-restore", ""]
        if self.dry_run:
            out.append("- dry-run(検査と件数だけ。DB には接続していない)")
        if self.stop_code:
            out.append(f"- 止まった:{self.stop_code}(何も書いていない)")
            if self.bad:
                out.append(f"- 不正な行:{len(self.bad)}")
                out += [f"  - {name} の {n} 行目" for name, n in self.bad[:self.max_listed]]
                if len(self.bad) > self.max_listed:
                    out.append(f"  - ほか {len(self.bad) - self.max_listed} 行")
            return "\n".join(out) + "\n"

        def num(v: int | None) -> str:
            return "-" if v is None else str(v)

        out += [
            "| 表 | 読んだ | 追加 | 上書き | 変わらない |",
            "|---|---|---|---|---|",
            f"| feed_entries | {self.read} | {num(self.inserted)} | {num(self.updated)} | {num(self.unchanged)} |",
            f"| feed_translate_usage | {self.usage_read} | {num(self.usage_inserted)} | "
            f"{num(self.usage_updated)} | {num(self.usage_unchanged)} |",
        ]
        return "\n".join(out) + "\n"


@dataclass
class DigestSummary:
    """feed-digest・feed-digest-backlog の要約(詳細設計 3.15)。日付(dt.date から作った値)と件数だけ。id・題は持たない。"""
    command: str = "feed-digest"
    mode: str = "build"  # build / commit / backlog
    dry_run: bool = False
    stop_code: str | None = None
    day: dt.date | None = None
    path: str | None = None  # 書いたファイル(feed_digest/YYYY-MM-DD.json。日付から作った値)
    entries: int = 0
    today_rows: int = 0
    new_rows: int = 0
    old: int = 0
    listed: int = 0
    updated: int | None = None
    unchanged: int | None = None
    missing: int | None = None
    marked: int | None = None

    def render(self) -> str:
        out = [f"## nodal-sync {self.command}", ""]
        if self.dry_run:
            out.append("- dry-run(ファイルも DB も変えていない)")
        if self.day is not None:
            out.append(f"- 日付:{self.day.isoformat()}")
        if self.stop_code:
            out.append(f"- 止まった:{self.stop_code}(DB に何も書いていない)")
            return "\n".join(out) + "\n"

        def num(v: int | None) -> str:
            return "-" if v is None else str(v)

        if self.mode == "build":
            out += [
                f"- 一覧:{self.entries} 件(今日の行 {self.today_rows}/新しい行 {self.new_rows})",
                f"- ファイル:{self.path or '書いていない'}",
            ]
            if self.old:
                out.append(f"- E-DIGEST-OLD:7日より古い null の行 {self.old}(入れていない)")
        elif self.mode == "commit":
            out.append(f"- ファイルの id:{self.listed}/その日にした {num(self.updated)}/"
                       f"もうその日 {num(self.unchanged)}/DB に無い {num(self.missing)}")
        else:
            out.append(f"- 印を付けた行(上の日付より前の null の行):{num(self.marked)}")
        return "\n".join(out) + "\n"


def render_watch(findings: list[tuple[str, int, list[str]]]) -> str:
    out = ["## nodal-sync watch", ""]
    if not findings:
        out.append("- 当てはまりなし")
    for code, count, ids in findings:
        line = f"- {code}:{count}"
        if ids:
            line += "(" + "、".join(ids) + ")"
        out.append(line)
    return "\n".join(out) + "\n"


def render_stop(command: str, code: str) -> str:
    return f"## nodal-sync {command}\n\n- 止まった:{code}\n"


def emit_summary(text: str, env: Mapping[str, str], out: TextIO) -> None:
    """GITHUB_STEP_SUMMARY があれば追記、無ければ標準出力。"""
    path = env.get("GITHUB_STEP_SUMMARY")
    if path:
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(text)
            return
        except OSError:
            pass
    out.write(text)


def log(out: TextIO, message: str) -> None:
    out.write(message + "\n")
    out.flush()
