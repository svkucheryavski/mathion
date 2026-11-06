"""The theme file and its colours (superuser Branding spec D10).

`parse_theme` reads an uploaded file into the changes it makes and its
problems, each with its line. Values follow D10's closed grammar, the forms
every browser takes, and are kept in a canonical form. `changes_in_use` is the
stored set without what a later release made dead; `write_stylesheet` is the
server's own stylesheet for it; `resolve` gives every colour as RGBA.
"""
import logging
import math
import re
from dataclasses import dataclass, field

from mathion.theme_vars import BY_NAME, NON_COLOUR_NAMES, THEME_VARS

log = logging.getLogger(__name__)

MAX_BYTES = 64 * 1024
MAX_PROBLEMS = 20
_ECHO = 40
_ELLIPSIS = chr(0x2026)
_BOM = chr(0xFEFF)

NOT_UTF8 = "The theme file must be UTF-8 text."
TOO_BIG = "The theme file can be at most 64 KB."
NO_COLOURS = "The theme file sets no colours."


def _cut(text: str) -> str:
    return text if len(text) <= _ECHO else text[:_ECHO] + _ELLIPSIS


def _shown(raw: str) -> str:
    """A refused value as the problem shows it: CSS whitespace runs as one
    space, and any other character outside printable ASCII as its code
    (`\\u00a0`), so a copied invisible character can't look valid."""
    text = re.sub(r"[ \t\n\f]+", " ", raw.strip(" \t\n\f"))
    return "".join(ch if " " <= ch <= "~" else f"\\u{ord(ch):04x}" for ch in text)


def _not_a_colour(line: int, value: str) -> str:
    return (f"Line {line}: `{_cut(value)}` isn't a colour. Use a hex colour, rgb(), hsl() "
            "(like `hsl(210deg 30% 36%)`), a colour name or var(--another-colour).")


def _structure(line: int) -> str:
    return f"Line {line}: only colour variables inside one `:root {{ }}` are allowed."


def _unknown(line: int, name: str) -> str:
    return f"Line {line}: `{_cut(name)}` isn't a theme variable."


def _not_colour_set(line: int, name: str) -> str:
    return f"Line {line}: `{_cut(name)}` isn't a colour, so it can't be changed here."


def _not_colour_ref(line: int, name: str) -> str:
    return f"Line {line}: `{_cut(name)}` isn't a colour, so it can't be referred to here."


# CSS's fixed table of named colours (CSS Color 4), as RGB hex.
_NAMED: dict[str, str] = dict(tuple(pair.split(":")) for pair in """
aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc
bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a
burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50
cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b
darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b
darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000
darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f
darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff
dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0
forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700
goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0
hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa
lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080
lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90
lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa
lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0
lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000
mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db
mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc
mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5
navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500
orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee
palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd
powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f
royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57
seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090
slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080
thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff
whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32
""".split())


@dataclass(frozen=True)
class RGBA:
    """Red, green and blue in 0-255 (not rounded), alpha in 0-1."""
    r: float
    g: float
    b: float
    a: float


# --- the value grammar ---

_NUM = r"[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?"
_RE_NUM = re.compile(_NUM)
_RE_PCT = re.compile(_NUM + "%")
_RE_HUE = re.compile(f"({_NUM})(deg|turn|rad|grad)?")
_RE_HEX = re.compile(r"#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})")
_RE_FUNC = re.compile(r"(rgba?|hsla?)\(([^()]*)\)")
_RE_VAR = re.compile(r"var\((--[a-z0-9_-]+)\)")
_REFUSED = ("\\", '"', "'", "{", "}", ";", "@", "<", "url(", "expression(")
# CSS whitespace (a \r is a line break by now); anything else outside printable
# ASCII is refused before lowercasing, which would fold the Kelvin sign into k.
_ALLOWED = frozenset(map(chr, range(0x20, 0x7F))) | {"\t", "\n", "\f"}


def canonical(value: str) -> str:
    """D10's stored form: lowercased; runs of whitespace as one space; no space
    just inside ( or ) or before a comma; one after a comma and around /."""
    v = re.sub(r"\s+", " ", value.strip().lower())
    v = re.sub(r"\( ", "(", v)
    v = re.sub(r" \)", ")", v)
    v = re.sub(r" ?, ?", ", ", v)
    return re.sub(r" ?/ ?", " / ", v)


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def _finite(text: str) -> float | None:
    # 1e999 is infinite: browsers and this code would disagree on its colour.
    x = float(text)
    return x if math.isfinite(x) else None


def _alpha(part: str) -> float | None:
    if _RE_PCT.fullmatch(part):
        x = _finite(part[:-1])
        return None if x is None else _clamp(x / 100, 0, 1)
    if _RE_NUM.fullmatch(part):
        x = _finite(part)
        return None if x is None else _clamp(x, 0, 1)
    return None


def _rgb(parts: list[str], alpha: float) -> RGBA | None:
    if all(_RE_NUM.fullmatch(p) for p in parts):
        xs = [_finite(p) for p in parts]
        per_cent = False
    elif all(_RE_PCT.fullmatch(p) for p in parts):
        xs = [_finite(p[:-1]) for p in parts]
        per_cent = True
    else:
        return None
    if None in xs:
        return None
    # x * 255 / 100, not x * 2.55: 50% must be exactly 127.5, as browsers round it.
    r, g, b = (_clamp(x * 255 / 100 if per_cent else x, 0, 255) for x in xs)
    return RGBA(r, g, b, alpha)


def _hsl(parts: list[str], alpha: float) -> RGBA | None:
    hue = _RE_HUE.fullmatch(parts[0])
    if not hue or not all(_RE_PCT.fullmatch(p) for p in parts[1:]):
        return None
    xs = [_finite(hue.group(1)), *(_finite(p[:-1]) for p in parts[1:])]
    if None in xs:
        return None
    turns = {None: 1 / 360, "deg": 1 / 360, "turn": 1, "rad": 1 / (2 * math.pi), "grad": 1 / 400}[hue.group(2)]
    h = (xs[0] * turns) % 1
    s, light = (_clamp(x, 0, 100) / 100 for x in xs[1:])
    c = (1 - abs(2 * light - 1)) * s

    def channel(n: float) -> float:
        k = (n + h * 12) % 12
        return 255 * (light - c / 2 * max(-1, min(k - 3, 9 - k, 1)))
    return RGBA(channel(0), channel(8), channel(4), alpha)


def _function(name: str, args: str) -> RGBA | None:
    if "," in args:
        if "/" in args:
            return None
        parts = args.split(", ")
        if any(" " in p or not p for p in parts):
            return None
    else:
        if name not in ("rgb", "hsl"):
            return None
        main, *rest = args.split(" / ")
        if len(rest) > 1 or len(main.split(" ")) != 3:
            return None
        parts = main.split(" ") + rest
    if len(parts) not in (3, 4):
        return None
    alpha = 1.0 if len(parts) == 3 else _alpha(parts[3])
    if alpha is None:
        return None
    return (_rgb if name.startswith("rgb") else _hsl)(parts[:3], alpha)


def _literal(value: str) -> RGBA | None:
    """A canonical literal colour as RGBA, None when it isn't one."""
    if _RE_HEX.fullmatch(value):
        digits = value[1:]
        if len(digits) <= 4:
            digits = "".join(ch * 2 for ch in digits)
        channels = [int(digits[i:i + 2], 16) for i in range(0, len(digits), 2)]
        return RGBA(channels[0], channels[1], channels[2], channels[3] / 255 if len(channels) == 4 else 1.0)
    if value == "transparent":
        return RGBA(0, 0, 0, 0)
    if value in _NAMED:
        return _literal("#" + _NAMED[value])
    m = _RE_FUNC.fullmatch(value)
    return _function(m.group(1), m.group(2)) if m else None


def parse_colour(value: str) -> RGBA | None:
    """A literal colour as RGBA; None for var() or anything outside the grammar."""
    return _literal(canonical(value))


def _same_literal(a: RGBA, b: RGBA) -> bool:
    def key(c: RGBA) -> tuple[int, ...]:
        return (*(math.floor(x + 0.5) for x in (c.r, c.g, c.b)), math.floor(c.a * 1000 + 0.5))
    return key(a) == key(b)


def same_colour(a: str, b: str) -> bool:
    """D10: literals are the same at 8 bits per channel and 3 decimals of alpha;
    a var() is the same only as the same var() text."""
    ca, cb = canonical(a), canonical(b)
    if ca.startswith("var(") or cb.startswith("var("):
        return ca == cb
    la, lb = _literal(ca), _literal(cb)
    return la is not None and lb is not None and _same_literal(la, lb)


def _reference(value: str) -> str | None:
    m = _RE_VAR.fullmatch(value)
    return m.group(1) if m else None


# --- loops ---

def _loop_hop(name: str, merged: dict[str, str]) -> str | None:
    """The first variable `name` refers to, when following its references
    through `merged` comes back to `name`; None otherwise."""
    first = _reference(merged.get(name, ""))
    current, seen = first, {name}
    while current is not None and current not in seen:
        seen.add(current)
        current = _reference(merged.get(current, ""))
    return first if current == name else None


def _merged(changes: dict[str, str]) -> dict[str, str]:
    return {v.name: canonical(changes.get(v.name, v.default)) for v in THEME_VARS}


# --- the file ---

@dataclass
class ThemeParse:
    changes: dict[str, str] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)
    more: int = 0


_RE_DECL = re.compile(r"(--[^\s:]+)\s*:(.*)", re.S)
_RE_CHARSET = re.compile(r'@charset\s+"utf-8"', re.I)


def _strip_comments(text: str) -> tuple[str, int | None]:
    """Comments become a space plus the line breaks they spanned; the line of
    an unclosed comment, if any."""
    out, i = [], 0
    while True:
        start = text.find("/*", i)
        if start < 0:
            out.append(text[i:])
            return "".join(out), None
        end = text.find("*/", start + 2)
        if end < 0:
            return "".join(out), text.count("\n", 0, start) + 1
        out.append(text[i:start])
        out.append(" " + "\n" * text.count("\n", start, end))
        i = end + 2


class _Reader:
    def __init__(self, text: str):
        self.text = text
        self.problems: list[tuple[int, str]] = []
        self.declared: list[tuple[int, str, str]] = []  # line, name, canonical value
        self.declarations = 0
        self.seen: set[str] = set()  # every colour name set, accepted or not

    def line(self, pos: int) -> int:
        return self.text.count("\n", 0, pos) + 1

    def problem(self, pos: int, make) -> None:
        self.problems.append((pos, make(self.line(pos))))

    def read(self) -> None:
        text, i, n, root_seen, first = self.text, 0, len(self.text), False, True
        while i < n:
            while i < n and text[i].isspace():
                i += 1
            if i >= n:
                break
            ends = [p for p in (text.find(ch, i) for ch in ";{}") if p >= 0]
            j = min(ends) if ends else n
            if j == n or text[j] in ";}":
                statement = text[i:j].strip()
                if not (first and text[j:j + 1] == ";" and _RE_CHARSET.fullmatch(statement)):
                    self.problem(i, _structure)
                first, i = False, j + 1
                continue
            close, depth = j + 1, 1
            while close < n and depth:
                depth += {"{": 1, "}": -1}.get(text[close], 0)
                close += 1
            if depth or text[i:j].strip() != ":root" or root_seen:
                self.problem(i, _structure)
            else:
                root_seen = True
                self.body(j + 1, close - 1)
            first, i = False, close

    def body(self, start: int, end: int) -> None:
        pos = start
        for chunk in self.text[start:end].split(";"):
            lead = len(chunk) - len(chunk.lstrip())
            if chunk.strip():
                self.declaration(pos + lead, chunk.strip())
            pos += len(chunk) + 1

    def declaration(self, pos: int, chunk: str) -> None:
        m = _RE_DECL.fullmatch(chunk)
        if not m or "{" in chunk or "}" in chunk or "!" in chunk:
            self.problem(pos, _structure)
            return
        self.declarations += 1
        name, raw = m.group(1), m.group(2)
        value_pos = pos + m.start(2) + len(raw) - len(raw.lstrip())
        if name not in BY_NAME:
            self.problem(pos, (lambda line: _not_colour_set(line, name)) if name in NON_COLOUR_NAMES
                         else (lambda line: _unknown(line, name)))
            return
        if name in self.seen:
            self.problem(pos, lambda line: f"Line {line}: `{name}` is set twice.")
            return
        self.seen.add(name)
        shown = _shown(raw)
        value = canonical(raw)
        refused = not set(raw) <= _ALLOWED or any(x in value for x in _REFUSED)
        ref = None if refused else _reference(value)
        if ref is not None:
            if ref in NON_COLOUR_NAMES:
                self.problem(value_pos, lambda line: _not_colour_ref(line, ref))
                return
            if ref not in BY_NAME:
                self.problem(value_pos, lambda line: _unknown(line, ref))
                return
        elif refused or _literal(value) is None:
            self.problem(value_pos, lambda line: _not_a_colour(line, shown))
            return
        self.declared.append((self.line(pos), name, value))


def parse_theme(data: bytes) -> ThemeParse:
    """D10: an uploaded theme file read into its changes (values equal to the
    default dropped) and its problems (the first 20, and how many more)."""
    if len(data) > MAX_BYTES:
        return ThemeParse(problems=[TOO_BIG])
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return ThemeParse(problems=[NOT_UTF8])
    text = text.removeprefix(_BOM).replace("\r\n", "\n").replace("\r", "\n")
    text, unclosed = _strip_comments(text)
    if unclosed is not None:
        return ThemeParse(problems=[f"Line {unclosed}: a comment isn't closed."])

    reader = _Reader(text)
    reader.read()
    problems = [p for _, p in sorted(reader.problems, key=lambda item: item[0])]
    if not problems and not reader.declarations:
        return ThemeParse(problems=[NO_COLOURS])

    upload = {name: value for _, name, value in reader.declared}
    merged = _merged(upload)
    changes = {}
    for line, name, value in reader.declared:
        hop = _loop_hop(name, merged)
        if hop is not None:
            problems.append(f"Line {line}: `{name}` refers back to itself through `{hop}`.")
        elif not same_colour(value, BY_NAME[name].default):
            changes[name] = value
    return ThemeParse(changes, problems[:MAX_PROBLEMS], max(0, len(problems) - MAX_PROBLEMS))


# --- the stored set ---

_logged: set[tuple[str, str]] = set()


def changes_in_use(stored: dict[str, str]) -> dict[str, str]:
    """D10 "after a release": the stored changes without removed names, var()
    to anything that isn't an overridable colour, or loops. Each dropped entry
    is logged once."""
    def drop(name: str, value: str, why: str) -> None:
        if (name, value) not in _logged:
            _logged.add((name, value))
            log.warning("branding: the stored colour %s: %s is left out (%s)", name, value, why)

    in_use = {}
    for name, value in stored.items():
        if name not in BY_NAME:
            drop(name, value, "not a theme colour")
            continue
        ref = _reference(value)
        if ref is not None and ref not in BY_NAME:
            drop(name, value, "refers to something that isn't a theme colour")
            continue
        if value != canonical(value) or (ref is None and _literal(value) is None):
            drop(name, value, "not a colour in the stored form")
            continue
        in_use[name] = value
    merged = _merged(in_use)
    for name in [n for n in in_use if _loop_hop(n, merged) is not None]:
        drop(name, in_use.pop(name), "loops")
    return in_use


def resolve(changes: dict[str, str]) -> dict[str, RGBA]:
    """All 73 colours as RGBA, the changes over the defaults, var() followed.
    A loop or an unreadable value falls back to the default's colour."""
    merged = _merged(changes)
    defaults = _merged({})

    def colour(name: str, values: dict[str, str], seen: frozenset[str]) -> RGBA | None:
        value = values[name]
        ref = _reference(value)
        if ref is None:
            return _literal(value)
        if ref in seen or ref not in values:
            return None
        return colour(ref, values, seen | {ref})

    out = {}
    for v in THEME_VARS:
        out[v.name] = (colour(v.name, merged, frozenset({v.name}))
                       or colour(v.name, defaults, frozenset({v.name})))
    return out


def write_stylesheet(changes: dict[str, str]) -> str:
    """D13: the server's own stylesheet, "" when nothing is changed."""
    lines = [f"  {v.name}: {changes[v.name]};" for v in THEME_VARS if v.name in changes]
    if not lines:
        return ""
    return ":root:root {\n" + "\n".join(lines) + "\n}\n"
