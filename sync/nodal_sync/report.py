"""ログと要約(依頼 10-1 の 4.2 の 8・4.9)。

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
