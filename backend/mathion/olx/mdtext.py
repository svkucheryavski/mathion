"""Math and text of imported content as Mathion Markdown: formulas first, then escaped text."""
import re
from dataclasses import dataclass
from typing import Literal

from mathion.latex_mathml import LatexError, latex_to_mathml


@dataclass
class Seg:
    kind: Literal["text", "math", "code"]
    text: str
    display: bool = False


# an opener not escaped by a backslash before it; [mathjax…] tags as plain text
_OPEN = re.compile(r"(?<!\\)(?:\\\\)*(\\[(\[])|\[mathjaxinline\]|\[mathjax\]")
_CLOSE = {"\\(": re.compile(r"(?<!\\)(?:\\\\)*\\\)"), "\\[": re.compile(r"(?<!\\)(?:\\\\)*\\\]")}
_TAG_CLOSE = {"[mathjaxinline]": "[/mathjaxinline]", "[mathjax]": "[/mathjax]"}
_WS = re.compile(r"[ \t\n\r\f\v]+")
_NUM_END = re.compile(r"(?<![0-9])(?<![0-9][.,])[0-9]+(?:[.,][0-9]+)*\Z")
_NUM_START = re.compile(r"[0-9]+(?:[.,][0-9]+)*")
_BARE_DOLLAR = re.compile(r"(?<!\\)((?:\\\\)*)\$")
_TEXT_ESC = re.compile(r"([\\`*_\[\]<>$]|&(?=#?[A-Za-z0-9]+;)|!\Z)")
_CHOICE_BACKSLASH = re.compile(r"\\(?=[!-/:-@\[-`{-~])")
_LINE_MARK = re.compile(r"(?m)^( *)(#|>|\+|-|=|\||~~~)")
_LINE_NUM = re.compile(r"(?m)^( *[0-9]+)([.)])")
_SCRIPT_BAD = set("\\{}$%&#^_~")
_BARE_BACKTICK = re.compile(r"(?<!\\)((?:\\\\)*)`")
# commands that act on the rest of their group, so a joined neighbour would fall under them
_GROUP_SWITCH = re.compile(
    r"\\(?:over|atop|above|choose|brace|brack|(?:over|atop|above)withdelims"
    r"|displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|sf|tt|cal|mit|color)(?![A-Za-z])")
_TOKEN = re.compile(r"\\[A-Za-z]+|\\.|[{}]", re.S)


def split_math(text: str) -> list[Seg]:
    """Text and formula segments, with delimiters found as MathJax finds them."""
    segs: list[Seg] = []
    unclosed: set[str] = set()
    pos = start = 0
    while m := _OPEN.search(text, pos):
        opener = m.group(1) or m.group(0)
        at = m.start(1) if m.group(1) else m.start()
        body = m.end()
        end = close_end = -1
        if opener not in unclosed:
            if opener in _CLOSE:
                c = _CLOSE[opener].search(text, body)
                if c:
                    end, close_end = c.end() - 2, c.end()
            else:
                end = text.find(_TAG_CLOSE[opener], body)
                close_end = end + len(_TAG_CLOSE[opener])
            if end == -1:
                unclosed.add(opener)                   # no closer later either
        if end == -1:
            pos = m.end()
            continue
        if at > start:
            segs.append(Seg("text", text[start:at]))
        segs.append(Seg("math", text[body:end], opener in ("\\[", "[mathjax]")))
        pos = start = close_end
    if start < len(text):
        segs.append(Seg("text", text[start:]))
    return segs


def _odd_backslashes(body: str) -> bool:
    return (len(body) - len(body.rstrip("\\"))) % 2 == 1


def _body(text: str) -> str:
    # one space per whitespace run, bare $ escaped, ` as TeX prints it (a backtick would pair as code)
    body = _BARE_DOLLAR.sub(r"\1\\$", _WS.sub(" ", text)).strip()
    body = _BARE_BACKTICK.sub("\\1\u2018", body)
    end = len(body)
    while True:                                        # drop final control spaces in one slice
        k = end
        while k and body[k - 1] == "\\":
            k -= 1
        if (end - k) % 2 == 0:
            return body[:end]
        end -= 1
        while end and body[end - 1].isspace():
            end -= 1


def _grouped(body: str) -> str:
    # braces around a body whose top level holds a group switch
    depth = 0
    for tok in _TOKEN.finditer(body):
        t = tok.group()
        if t == "{":
            depth += 1
        elif t == "}":
            depth = max(depth - 1, 0)
        elif depth == 0 and _GROUP_SWITCH.fullmatch(t):
            return "{" + body + "}"
    return body


def _number(num: str) -> str:
    # a comma inside a pulled number is not punctuation
    return num.replace(",", "{,}")


def _merge(segs: list[Seg]) -> tuple[list[Seg], bool]:
    # touching inline formulas join; a script attaches directly, anything else after an empty group
    out: list[Seg] = []
    parts: list[list[str]] = []
    merged = False
    for seg in segs:
        last = out[-1] if out else None
        if last and seg.kind == last.kind == "math" and not seg.display and not last.display:
            if len(parts[-1]) == 1:
                parts[-1][0] = _grouped(parts[-1][0])
            body = _grouped(seg.text)
            parts[-1] += [body] if body[:1] in ("^", "_") else ["{}", body]
            merged = True
        elif last and seg.kind == last.kind == "text":
            parts[-1].append(seg.text)
        else:
            out.append(Seg(seg.kind, "", seg.display))
            parts.append([seg.text])
    for seg, texts in zip(out, parts):
        seg.text = "".join(texts)
    return out, merged


def _pull_and_merge(segs: list[Seg]) -> bool:
    changed = False
    for i, seg in enumerate(segs):
        if seg.kind != "math" or seg.display:
            continue
        nxt = segs[i + 1] if i + 1 < len(segs) else None
        if nxt and nxt.kind == "text" and (m := _NUM_START.match(nxt.text)):
            seg.text, nxt.text, changed = _grouped(seg.text) + "{}" + _number(m.group()), nxt.text[m.end():], True
        prev = segs[i - 1] if i else None
        if prev and prev.kind == "text" and (m := _NUM_END.search(prev.text)):
            seg.text, prev.text, changed = _number(m.group()) + _grouped(seg.text), prev.text[:m.start()], True
    segs[:], merged = _merge([s for s in segs if s.text])
    return changed or merged


def normalize_segments(segs: list[Seg]) -> list[Seg]:
    """Clean formula bodies, pull touching numbers into inline formulas and merge touching ones."""
    out = [Seg(s.kind, _body(s.text) if s.kind == "math" else s.text, s.display) for s in segs]
    out = _merge([s for s in out if s.text])[0]
    while _pull_and_merge(out):
        pass
    return out


def escape_text(text: str) -> str:
    """Markdown escaping for one text run; whitespace runs become one space."""
    return _TEXT_ESC.sub(r"\\\1", _WS.sub(" ", text))


def _escape_choice(text: str, before_more: bool) -> str:
    text = _CHOICE_BACKSLASH.sub(r"\\\\", _WS.sub(" ", text)).replace("$", "\\$")
    # a final backslash would escape the next segment's first character
    return text + "\\" if before_more and _odd_backslashes(text) else text


def escape_line_starts(md: str) -> str:
    """Escape block markers at the start of each line."""
    return _LINE_NUM.sub(r"\1\\\2", _LINE_MARK.sub(r"\1\\\2", md))


def render_segments(segs: list[Seg], *, choice: bool = False) -> str:
    parts: list[str] = []
    for i, seg in enumerate(segs):
        if seg.kind == "math":
            prev = segs[i - 1] if i else None
            if prev and prev.kind == "math" and prev.display != seg.display:
                parts.append(" ")
            mark = "$$" if seg.display else "$"
            parts.append(f"{mark}{seg.text}{mark}")
        elif seg.kind == "code":
            parts.append(seg.text)
        elif choice:
            parts.append(_escape_choice(seg.text, i + 1 < len(segs)))
        else:
            parts.append(escape_text(seg.text))
    return "".join(parts)


def formula_errors(segs: list[Seg]) -> list[tuple[str, str]]:
    """(formula source, reason) for each formula the math feature cannot typeset."""
    errors = []
    for seg in segs:
        if seg.kind != "math":
            continue
        try:
            latex_to_mathml(seg.text, seg.display)
        except LatexError as exc:
            errors.append((seg.text, exc.reason))
        except Exception:                              # same fallback as the page renderer
            errors.append((seg.text, "formula could not be read"))
    return errors


def script_text_ok(text: str) -> bool:
    """Whether sup/sub text can go inside \\text{…}."""
    return not _SCRIPT_BAD.intersection(text)
