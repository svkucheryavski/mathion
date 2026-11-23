"""Open edX problems as Mathion quiz questions."""
import copy
import re
import shlex
import xml.etree.ElementTree as ET
from collections.abc import Collection
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_EVEN, Decimal, DecimalException
from html import escape
from typing import Literal

from mathion.olx.html_md import html_to_markdown, parse_html, text_only
from mathion.olx.links import LinkTargets
from mathion.olx.mdtext import escape_line_starts, formula_errors, normalize_segments, render_segments, split_math
from mathion.olx.report import Report

SUPPORTED = {"multiplechoiceresponse", "optionresponse", "choiceresponse", "numericalresponse", "stringresponse"}
INPUTS = {"choicegroup", "checkboxgroup", "radiogroup", "optioninput", "textline", "formulaequationinput"}
HINTS = {"correcthint", "choicehint", "stringequalhint", "optionhint", "hintgroup", "demandhint", "compoundhint",
         "targetedfeedbackset", "targetedfeedback", "regexphint"}
EXCLUDED = INPUTS | HINTS | {"solution", "solutionset", "additional_answer", "responseparam"}
_OWN_NUMBER = re.compile(r"(\d{1,3})\\[.)][ \t\xa0]+(?=\S)")        # a typed "1. " is escaped; a real list is not
PLAIN_TAGS = {"span", "p", "div", "br", "text"}       # choice content that carries no formatting
OPTION_MAX = 500
TEXT_MAX = 500
OPTIONS_MAX = 20_000                                  # the old options="(...)" text; its parser is slow on more
MAX_P = 10
DO_BY_HAND = "add this question in the quiz editor"
_NUM = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_RANGE = re.compile(r"([\[(])\s*([^,\s]+)\s*,\s*([^,\s]+)\s*([\])])")
_EXPLANATION = re.compile(r"[\\*_#:.\s]")
LIMIT = Decimal(10) ** 10


@dataclass
class PlanOption:
    text: str
    is_correct: bool


@dataclass
class PlanQuestion:
    type: Literal["single_choice", "multiple_choice", "numeric_answer", "text_answer"]
    text_md: str
    explanation_md: str | None
    options: list[PlanOption] = field(default_factory=list)
    correct_numeric: Decimal | None = None
    precision: int | None = None
    correct_text: str | None = None


class _Skip(Exception):
    pass


def precision_for(width: Decimal) -> tuple[int, bool]:
    """Smallest p in 0..10 whose ±5e-(p+1) fits in width; (10, True) when even p = 10 is wider."""
    for p in range(MAX_P + 1):
        if Decimal(5).scaleb(-(p + 1)) <= width:
            return p, False
    return MAX_P, True


def _step(p: int) -> str:
    return format(Decimal(5).scaleb(-(p + 1)), "f")


def _read(text: str) -> Decimal:
    # a plain or scientific number; anything else is not a number
    if not _NUM.fullmatch(text):
        raise ValueError("its answer is not a number")
    return Decimal(text)


def _exact(x: Decimal) -> Decimal:
    # trailing zeros dropped, at most 10 decimals, below 10^10
    if abs(x) >= LIMIT:
        raise ValueError("its answer is 10^10 or larger")
    sign, digits, exp = x.as_tuple()
    assert isinstance(exp, int)                       # _read admits no NaN or infinity
    if not any(digits):
        return Decimal(0)
    digits = list(digits)
    while len(digits) > 1 and digits[-1] == 0 and exp < 0:
        digits.pop()
        exp += 1
    if exp < -MAX_P:
        raise ValueError("its answer has more than 10 decimals")
    return Decimal(int(x)) if exp >= 0 else Decimal((sign, tuple(digits), exp))


def _width(x: Decimal, tolerance: str | None) -> tuple[Decimal | None, str | None]:
    # the Open edX tolerance as an absolute width; None means the default
    tol = (tolerance or "").strip()
    if not tol:
        return None, None
    pct = tol.endswith("%")
    num = tol[:-1].strip() if pct else tol
    try:
        t = _read(num)
        if t < 0:
            raise ValueError
        return (abs(x) * t / 100 if pct else t), None
    except (ValueError, DecimalException):
        return None, f"tolerance could not be read (“{tol[:40]}”), so the Open edX default was used"


def _fits(mid: Decimal, p: int, a: Decimal, b: Decimal, open_a: bool, open_b: bool) -> bool:
    # the ± band inside the range; an open end is never accepted
    step = Decimal(5).scaleb(-(p + 1))
    low, high = mid - step, mid + step
    return (a < low if open_a else a <= low) and (high < b if open_b else high <= b)


def _range_fit(a: Decimal, b: Decimal, open_a: bool, open_b: bool) -> tuple[int, Decimal]:
    # smallest p, then fewest midpoint decimals, whose ± band stays inside the range
    first, _ = precision_for((b - a) / 2)
    exact = (a + b) / 2
    for p in range(first, MAX_P + 1):
        for d in range(min(p + 1, MAX_P), MAX_P + 1):
            mid = _exact(exact.quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_EVEN))
            if _fits(mid, p, a, b, open_a, open_b):
                return p, mid
    return MAX_P, mid


def numeric_answer(answer: str, tolerance: str | None) -> tuple[Decimal, int, str | None]:
    """(correct, precision, report note) for an Open edX numeric answer; ValueError says why it is skipped."""
    text = answer.strip()
    try:
        if m := _RANGE.fullmatch(text):
            a, b = _read(m.group(2)), _read(m.group(3))
            if abs(a) >= LIMIT or abs(b) >= LIMIT:
                raise ValueError("its answer is 10^10 or larger")
            if a > b:
                raise ValueError("its range is reversed")
            open_a, open_b = m.group(1) == "(", m.group(4) == ")"
            p, mid = _range_fit(a, b, open_a, open_b)
            wider = not _fits(mid, p, a, b, open_a, open_b)
            note = f"range narrowed to {mid:f} ± {_step(p)} (was {text[:60]})" + ("; tolerance widened" if wider else "")
            return mid, p, note
        x = _exact(_read(text))
        width, note = _width(x, tolerance)
        if width is None and x == 0:
            return x, MAX_P, note
        if width is None:
            width = abs(x) * Decimal("0.00001")
        p, wider = precision_for(width)
        if wider and x != 0:
            note = (note + "; " if note else "") + f"tolerance widened to ± {_step(p)}"
        elif width > Decimal("0.5"):
            note = (note + "; " if note else "") + "tolerance narrowed to ± 0.5"
        return x, p, note
    except DecimalException:
        raise ValueError("its answer is not a number") from None


def _prune(elem: ET.Element, skip: Collection[str]) -> None:
    # drop every descendant in skip, keeping the text after it; one pass per parent
    stack = [elem]
    while stack:
        parent = stack.pop()
        kept: list[ET.Element] = []
        tails: list[list[str]] = []
        head = [parent.text or ""]
        for kid in parent:
            if kid.tag not in skip:
                kept.append(kid)
                tails.append([kid.tail or ""])
            elif kid.tail:
                (tails[-1] if kept else head).append(kid.tail)
        if len(kept) != len(parent):
            parent.text = "".join(head) or None
            for kid, parts in zip(kept, tails):
                kid.tail = "".join(parts) or None
            parent[:] = kept
        stack.extend(kept)


def _outer(elem: ET.Element, tags: Collection[str]) -> list[ET.Element]:
    # descendants in tags, not looking inside a match, in document order
    out, stack = [], list(reversed(elem))
    while stack:
        e = stack.pop()
        if e.tag in tags:
            out.append(e)
        else:
            stack.extend(reversed(e))
    return out


def _inputs(resp: ET.Element) -> list[ET.Element]:
    # answer inputs, never one written inside a solution
    return [e for e in _outer(resp, INPUTS | {"solution"}) if e.tag != "solution"]


def _html(elem: ET.Element, skip: Collection[str] = ()) -> str:
    # one element back as HTML; Studio's label and description read as paragraphs
    c = copy.deepcopy(elem)
    _prune(c, skip)
    for e in c.iter():
        if e.tag in ("label", "description"):
            e.tag = "p"
    return ET.tostring(c, encoding="unicode", method="html")


def _inner(elem: ET.Element, skip: Collection[str] = ()) -> str:
    return escape(elem.text or "", quote=False) + "".join(
        escape(c.tail or "", quote=False) if c.tag in skip else _html(c, skip) for c in elem)


def _open_edx_options(literal: str) -> list[str]:
    # Open edX's own OptionInput.parse_options: single quotes only, no escapes decoded
    literal = re.sub(r"([a-zA-Z])('|\\')([a-zA-Z])", r"\1&#39;\3", literal)
    literal = re.sub(r"\\'", "&#39;", literal)
    lexer = shlex.shlex(literal[1:-1])
    lexer.quotes = "'"
    lexer.whitespace = ", "
    return [t[1:-1].replace("&#39;", "'") for t in lexer]


def _drop_explanation_head(md: str) -> str:
    blocks = md.split("\n\n")
    if blocks and _EXPLANATION.sub("", blocks[0]).lower() == "explanation":
        blocks = blocks[1:]
    return "\n\n".join(blocks).strip()


class _Quiz:
    """One problem: its questions and its once-per-quiz report lines."""

    def __init__(self, node: ET.Element, targets: LinkTargets, report: Report, where: str) -> None:
        self.node, self.targets, self.report, self.where = node, targets, report, where
        self.flags: set[str] = set()

    def md(self, html: str) -> str:
        return html_to_markdown(parse_html(html), self.targets, self.report, self.where).markdown.strip()

    def text(self, source: str) -> str:
        # plain text with math, escaped for an option input
        segs = normalize_segments(split_math(source))
        for src, reason in formula_errors(segs):
            self.report.add("changed", self.where, f"Formula could not be typeset: {reason} (“{src}”)")
        return render_segments(segs, choice=True).strip()

    def choice_text(self, choice: ET.Element) -> str:
        c = copy.deepcopy(choice)
        _prune(c, EXCLUDED)
        if any(e.tag not in PLAIN_TAGS for e in c.iter() if e is not c):
            self.flags.add("formatting")
        return self.text(text_only(parse_html(_inner(c))))

    def options(self, group: ET.Element) -> list[PlanOption]:
        if (group.get("shuffle") or "").strip().lower() == "true":
            self.flags.add("shuffle")
        if group.tag == "optioninput" and group.get("options") is not None:
            return self.old_options(group)
        tag = "option" if group.tag == "optioninput" else "choice"
        return [PlanOption(self.choice_text(c), (c.get("correct") or "").strip().lower() == "true")
                for c in group.findall(tag)]

    def old_options(self, group: ET.Element) -> list[PlanOption]:
        # options="('a','b')" correct="a"
        literal = group.get("options", "").strip()
        if len(literal) > OPTIONS_MAX:
            raise _Skip("its dropdown options are too long")
        try:
            values = _open_edx_options(literal)
        except ValueError:
            raise _Skip("its dropdown options could not be read") from None
        correct = (group.get("correct") or "").strip()
        return [PlanOption(self.text(v), v.strip() == correct) for v in values]

    def choices(self, resp: ET.Element, inputs: list[ET.Element], i: int) -> dict:
        opts = self.options(inputs[0])
        if len(opts) < 2:
            raise _Skip("it has fewer than 2 choices")
        if any(not o.text for o in opts):
            raise _Skip("a choice is empty (for example an image-only choice)")
        if any(len(o.text) > OPTION_MAX for o in opts):
            raise _Skip(f"a choice is longer than {OPTION_MAX} characters")
        right = sum(o.is_correct for o in opts)
        if not right:
            raise _Skip("it has no correct choice")
        if inputs[0].tag == "checkboxgroup":
            self.report.once("olx-partial", "note", "Checkbox questions use Mathion's partial credit", "question|questions")
            kind = "multiple_choice"
        elif right > 1:
            self.report.add("changed", self.where, f"Question {i} has several correct choices and became a multiple-choice question")
            kind = "multiple_choice"
        else:
            kind = "single_choice"
        return {"type": kind, "options": opts}

    def others(self, resp: ET.Element, i: int, more: list[str] | None = None) -> None:
        extra = (more or []) + [(a.get("answer") or a.text or "").strip() for a in _outer(resp, {"additional_answer"})]
        if extra := [a for a in extra if a]:
            shown = ", ".join(f"“{a[:60]}”" for a in extra[:5]) + (" …" if len(extra) > 5 else "")
            self.report.add("changed", self.where, f"Question {i}: other accepted answers were dropped: {shown}")

    def numeric(self, resp: ET.Element, i: int) -> dict:
        answer = resp.get("answer")
        if answer is None or not answer.strip():
            raise _Skip("it has no answer")
        tol = next((r.get("default") for r in resp.iter("responseparam") if r.get("type") == "tolerance"), None)
        try:
            correct, p, note = numeric_answer(answer, tol)
        except ValueError as exc:
            raise _Skip(str(exc)) from None
        if note:
            self.report.add("changed", self.where, f"Question {i}: {note}")
        self.others(resp, i)
        return {"type": "numeric_answer", "correct_numeric": correct, "precision": p}

    def string(self, resp: ET.Element, i: int) -> dict:
        kinds = (resp.get("type") or "").lower().split()
        if "regexp" in kinds:
            raise _Skip("its answer is a pattern (regular expression)")
        answer = (resp.get("answer") or "").strip()
        more: list[str] = []
        if "_or_" in answer:
            # Open edX's old "a_or_b" list of answers (split on the lower-case form only)
            answer, *more = (a.strip() for a in answer.split("_or_"))
        if not answer:
            raise _Skip("it has no answer")
        if len(answer) > TEXT_MAX:
            raise _Skip(f"its answer is longer than {TEXT_MAX} characters")
        if "ci" not in kinds:
            self.report.once("olx-case", "changed", "Text answers are now checked ignoring case", "question|questions")
        self.others(resp, i, more)
        return {"type": "text_answer", "correct_text": answer}

    def answer(self, resp: ET.Element, i: int) -> dict:
        inputs = _inputs(resp)
        if len(inputs) > 1:
            raise _Skip("it has several answer inputs")
        if resp.tag in ("multiplechoiceresponse", "choiceresponse", "optionresponse"):
            # choiceresponse also takes Open edX's older radiogroup
            want = {"multiplechoiceresponse": {"choicegroup"}, "choiceresponse": {"checkboxgroup", "radiogroup"},
                    "optionresponse": {"optioninput"}}
            if not inputs or inputs[0].tag not in want[resp.tag]:
                raise _Skip("it has no choices")
            return self.choices(resp, inputs, i)
        if resp.tag == "numericalresponse":
            return self.numeric(resp, i)
        return self.string(resp, i)

    def explanation(self, solutions: list[ET.Element]) -> str:
        return "\n\n".join(md for md in (_drop_explanation_head(self.md(_inner(s, EXCLUDED))) for s in solutions) if md)

    def skip(self, i: int, why: object, after: str | None) -> None:
        self.report.add("skipped", self.where, f"Question {i} was skipped: {why}; {DO_BY_HAND}")
        if after and html_to_markdown(parse_html(after), self.targets, Report(), self.where).markdown.strip():
            self.report.add("changed", self.where, "Text after the last question was dropped with it")

    def question(self, i: int, resp: ET.Element, before: str, pre: list[ET.Element], post: list[ET.Element],
                 after: str | None):
        if resp.tag not in SUPPORTED:
            self.skip(i, f"its question type ({resp.tag}) is not supported", after)
            return None
        text_md = "\n\n".join(md for md in (self.md(before), self.md(_inner(resp, EXCLUDED))) if md)
        if not text_md:
            label = next((c.get("label", "") for c in _inputs(resp) if c.get("label", "").strip()), "")
            text_md = self.md(f"<p>{escape(label)}</p>") if label else ""
        if not text_md:
            self.skip(i, "it has no question text", after)
            return None
        try:
            fields = self.answer(resp, i)
        except _Skip as why:
            self.skip(i, why, after)
            return None
        explanation = self.explanation(pre + _outer(resp, {"solution"}) + post)
        if after and (tail := self.md(after)):
            explanation = f"{explanation}\n\n{tail}" if explanation else tail
            self.report.add("changed", self.where, "Text after the last question was added to its explanation")
        return PlanQuestion(text_md=text_md, explanation_md=explanation or None, **fields)

    def convert(self) -> list[PlanQuestion]:
        if next(self.node.iter("script"), None) is not None:
            self.report.add("skipped", self.where,
                            "This quiz computes its answers with a script; add its questions in the quiz editor")
            return []
        direct = sum(c.tag.endswith("response") for c in self.node)
        if sum(e.tag.endswith("response") for e in self.node.iter()) > direct:
            self.report.add("skipped", self.where,
                            "This quiz has questions inside other elements; add its questions in the quiz editor")
            return []
        for e in self.node.iter():
            if e.tag in HINTS:
                self.flags.add("demandhint" if e.tag == "demandhint" else "hints")
        found: list[dict] = []
        orphans: list[ET.Element] = []
        pending = [escape(self.node.text or "", quote=False)]
        for child in self.node:
            if child.tag.endswith("response"):
                found.append({"resp": child, "before": "".join(pending), "pre": orphans if not found else [], "post": []})
                pending = [escape(child.tail or "", quote=False)]
                continue
            if child.tag in ("solution", "solutionset"):
                sols = [child] if child.tag == "solution" else _outer(child, {"solution"})
                (found[-1]["post"] if found else orphans).extend(sols)
            elif child.tag not in EXCLUDED:
                for s in _outer(child, {"solution"}):
                    (found[-1]["post"] if found else orphans).append(s)
                pending.append(_html(child, EXCLUDED))
                continue
            pending.append(escape(child.tail or "", quote=False))
        if not found:
            self.report.add("skipped", self.where, "This quiz has no questions Mathion can read; add them in the quiz editor")
            return []
        after = "".join(pending)
        out = []
        for i, f in enumerate(found, 1):
            q = self.question(i, f["resp"], f["before"], f["pre"], f["post"], after if i == len(found) else None)
            if q:
                out.append(self.unnumber(q, {i, len(out) + 1}))
        self.tell()
        return out

    def unnumber(self, q: PlanQuestion, positions: set[int]) -> PlanQuestion:
        # Mathion numbers questions, so drop an own number equal to its position
        m = _OWN_NUMBER.match(q.text_md)
        if not m or int(m.group(1)) not in positions:
            return q
        self.report.once("olx-numbers", "changed",
                         "Question numbers at the start of the question text were removed, since Mathion numbers questions",
                         "question|questions")
        first, nl, rest = q.text_md[m.end():].partition("\n")
        return replace(q, text_md=escape_line_starts(first) + nl + rest)  # later lines keep their own markup

    def tell(self) -> None:
        if "hints" in self.flags:
            self.report.add("changed", self.where, "Hints and feedback were dropped")
        if "demandhint" in self.flags:
            self.report.add("changed", self.where, "Hints shown on request were dropped")
        if "formatting" in self.flags:
            self.report.add("changed", self.where, "Formatting in choices (such as code) was dropped")
        if "shuffle" in self.flags:
            self.report.once("olx-shuffle", "changed", "Shuffled choices now keep their written order", "quiz|quizzes")
        if (self.node.get("showanswer") or "").strip():
            self.report.once("olx-showanswer", "changed", 'The "show answer" setting was dropped', "quiz|quizzes")


def convert_problem(node: ET.Element, targets: LinkTargets, report: Report, where: str) -> list[PlanQuestion]:
    """The questions of one Open edX problem; skipped ones are reported with what to do by hand."""
    return _Quiz(node, targets, report, where).convert()
