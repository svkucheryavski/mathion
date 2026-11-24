"""The import report: lines by level, once-per-course counts and blockers."""
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Level = Literal["skipped", "changed", "note"]
_RANK = {"skipped": 0, "changed": 1, "note": 2}
MAX_LINES = 20000
MAX_BLOCKERS = 200
MAX_WHERE, MAX_TEXT = 600, 2000
_SPACES = re.compile(r"\s+")
_HIDDEN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f\u202a-\u202e\u2066-\u2069]")


def _more(n: int, what: str) -> str:
    return f"{n} more {what} was not shown" if n == 1 else f"{n} more {what}s were not shown"


@dataclass(frozen=True)
class ReportLine:
    level: Level
    where: str
    text: str


def _line(text: str, limit: int) -> str:
    # one line without controls or direction overrides, cut to the build body's limit
    return _SPACES.sub(" ", _HIDDEN.sub("", text[: limit * 2])).strip()[:limit].rstrip()


def _clean_line(line: ReportLine) -> ReportLine:
    return ReportLine(line.level, _line(line.where, MAX_WHERE), _line(line.text, MAX_TEXT))


def _unit(unit: str, n: int) -> str:
    # "video|videos" gives the singular for 1
    if "|" in unit:
        one, many = unit.split("|", 1)
        return one if n == 1 else many
    return unit


class Report:
    def __init__(self) -> None:
        self._lines: list[ReportLine] = []
        self._once: dict[str, list] = {}
        self._blockers: list[ReportLine] = []
        self._order: dict[str, int] = {}
        self._dropped = 0
        self._blocks_dropped = 0

    def add(self, level: Level, where: str, text: str) -> None:
        if len(self._lines) >= MAX_LINES:
            self._dropped += 1
            return
        self._lines.append(_clean_line(ReportLine(level, where, text)))

    def once(self, key: str, level: Level, text: str, unit: str) -> None:
        self._once.setdefault(key, [level, text, unit, 0])[3] += 1

    def place(self, where: str) -> None:
        self._order.setdefault(_line(where, MAX_WHERE), len(self._order))

    def block(self, where: str, text: str) -> None:
        if len(self._blockers) >= MAX_BLOCKERS:
            self._blocks_dropped += 1
            return
        self._blockers.append(_clean_line(ReportLine("skipped", where, text)))

    @property
    def blockers(self) -> list[ReportLine]:
        more = [ReportLine("skipped", "", _more(self._blocks_dropped, "problem"))] if self._blocks_dropped else []
        return self._blockers + more

    def lines(self, extra: Iterable[ReportLine] = ()) -> list[ReportLine]:
        once = [ReportLine(lv, "", f"{text}: {n} {_unit(unit, n)}") for lv, text, unit, n in self._once.values()]
        out = self._lines + once
        if self._dropped:
            out.append(ReportLine("skipped", "", _more(self._dropped, "report line")))
        seen = set(out)
        for line in map(_clean_line, extra):
            if line not in seen:
                seen.add(line)
                out.append(line)
        # course-level lines first in each level, then course order; unplaced lines last
        last = len(self._order)
        return sorted(out, key=lambda ln: (_RANK[ln.level], ln.where != "", self._order.get(ln.where, last)))
