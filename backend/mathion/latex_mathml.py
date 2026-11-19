"""Mathion's own LaTeX to MathML converter (no dependencies)."""
import html
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field

MAX_LENGTH = 2000
MAX_DEPTH = 40

# Attribute order in the output; matches the spec's sanitiser map.
_ATTR_ORDER = (
    "display", "encoding", "class", "mathvariant", "stretchy", "largeop", "movablelimits",
    "fence", "form", "lspace", "rspace", "minsize", "maxsize", "linethickness", "accent",
    "accentunder", "displaystyle", "width",
)
_ATTR_SET = set(_ATTR_ORDER)
_ZERO = {"lspace": "0em", "rspace": "0em"}

# Kinds after which + - ± ∓ are unary (TeX's rule).
_UNARY_AFTER = {None, "open", "rel", "bin", "op", "punct", "func", "bigop", "left"}
# Kinds that lose their spacing inside scripts, as in TeX.
_SCRIPT_TIGHT = {"bin", "rel", "punct"}
_SIGNS = {"+": "+", "-": "−", "−": "−", "–": "−", "±": "±", "∓": "∓"}   # – is pasted from Word

_NUMBER = re.compile(r"[0-9]+(?:\.[0-9]+)?")
_NAME = re.compile(r"[A-Za-z]+")


class LatexError(ValueError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class Node:
    tag: str
    text: str | None = None
    children: list["Node"] = field(default_factory=list)
    attrs: dict[str, str] = field(default_factory=dict)
    kind: str = "ord"

    def xml(self) -> str:
        assert set(self.attrs) <= _ATTR_SET, self.attrs
        attrs = "".join(
            f' {k}="{html.escape(self.attrs[k], quote=True)}"' for k in _ATTR_ORDER if k in self.attrs
        )
        if self.text is not None:
            return f"<{self.tag}{attrs}>{html.escape(self.text, quote=True)}</{self.tag}>"
        if not self.children:
            return f"<{self.tag}{attrs}/>"
        return f"<{self.tag}{attrs}>{''.join(c.xml() for c in self.children)}</{self.tag}>"


def mo(text: str, kind: str = "ord", **attrs: str) -> Node:
    return Node("mo", text, attrs=dict(attrs), kind=kind)


def mi(text: str, **attrs: str) -> Node:
    return Node("mi", text, attrs=dict(attrs))


def row(nodes: list[Node]) -> Node:
    """A group: one node stands alone, none is an empty mrow."""
    if len(nodes) == 1:
        return nodes[0]
    return Node("mrow", children=nodes)


def tighten(node: Node) -> Node:
    """Script content: binary, relation and punctuation operators lose their spacing."""
    if node.tag == "mo" and node.kind in _SCRIPT_TIGHT:
        node.attrs.update(_ZERO)
    for child in node.children:
        tighten(child)
    return node


# --- tables -------------------------------------------------------------------

_GREEK = dict(zip(
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma "
    "tau upsilon phi chi psi omega".split(),
    "αβγδϵζηθικλμνξπρστυϕχψω",
))
_GREEK.update({
    "varepsilon": "ε", "varphi": "φ", "vartheta": "ϑ", "varrho": "ϱ",
    "varsigma": "ς", "varpi": "ϖ",
})
_GREEK_UPPER = dict(zip(
    "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split(), "ΓΔΘΛΞΠΣΥΦΨΩ",
))

# name -> (character, kind); kind "mi" means an upright ordinary identifier.
_SYMBOLS: dict[str, tuple[str, str]] = {}
for _kind, _pairs in {
    "rel": "approx ≈ neq ≠ ne ≠ leq ≤ le ≤ geq ≥ ge ≥ ll ≪ gg ≫ lt < gt > sim ∼ simeq ≃ cong ≅ "
           "equiv ≡ propto ∝ in ∈ notin ∉ ni ∋ subset ⊂ subseteq ⊆ supset ⊃ supseteq ⊇ to → "
           "rightarrow → leftarrow ← Rightarrow ⇒ Leftarrow ⇐ Leftrightarrow ⇔ iff ⟺ implies ⟹ "
           "mapsto ↦ mid ∣ parallel ∥ perp ⊥",
    "bin": "pm ± mp ∓ times × cdot ⋅ div ÷ ast ∗ star ⋆ cup ∪ cap ∩ setminus ∖ land ∧ lor ∨ "
           "wedge ∧ vee ∨ circ ∘ bullet ∙",
    "op": "forall ∀ exists ∃ neg ¬ lnot ¬",
    "ord": "ldots … cdots ⋯ dots … vdots ⋮ ddots ⋱ prime ′ degree °",
    "mi": "infty ∞ partial ∂ nabla ∇ emptyset ∅ varnothing ∅ ell ℓ hbar ℏ top ⊤ bot ⊥",
}.items():
    _words = _pairs.split()
    for _name, _char in zip(_words[::2], _words[1::2]):
        _SYMBOLS[_name] = (_char, _kind)
# A typed symbol behaves like its command; the first kind wins (⊥ is \perp).
_TYPED: dict[str, str] = {}
for _char, _kind in _SYMBOLS.values():
    _TYPED.setdefault(_char, _kind)
_UPRIGHT_MI = {"∂", "∇"}    # these would be italic by default
_TIGHT_ORD = {"…", "⋯"}

_REL_CHARS = set("=<>:")
_BIN_CHARS = set("·")
_PUNCT_CHARS = set(",;")
_OPEN_CHARS = set("([")
_CLOSE_CHARS = set(")]")

_BRACKETS = {   # name -> (character, kind, zero spacing)
    "{": ("{", "open", False), "}": ("}", "close", False),
    "langle": ("⟨", "open", False), "rangle": ("⟩", "close", False),
    "lfloor": ("⌊", "open", False), "rfloor": ("⌋", "close", False),
    "lceil": ("⌈", "open", False), "rceil": ("⌉", "close", False),
    "vert": ("|", "ord", True), "Vert": ("‖", "ord", True), "|": ("‖", "ord", True),
    "lvert": ("|", "open", True), "rvert": ("|", "close", True),
    "lVert": ("‖", "open", True), "rVert": ("‖", "close", True),
}
# A typed bracket behaves like its command; the first entry wins (‖ is \Vert).
_TYPED_BRACKETS: dict[str, tuple[str, str, bool]] = {}
for _entry in _BRACKETS.values():
    if _entry[0] not in "{}|":
        _TYPED_BRACKETS.setdefault(_entry[0], _entry)
_ESCAPES = {"$": "$", "%": "%", "&": "&", "#": "#", "_": "_"}
_TIGHT_ESCAPES = {"$", "#"}   # not in the browser's operator dictionary
_SPACES = {
    ",": "0.1667em", ":": "0.2222em", ";": "0.2778em", "!": "-0.1667em", " ": "0.3333em",
    "quad": "1em", "qquad": "2em",
}
_TEXT_SPACES = {",": " ", ":": " ", ";": " ", "!": "", " ": " ",
                "quad": " ", "qquad": "  "}
_BARE = {"&": r"write `\&` for a literal `&`", "#": r"write `\#` for a literal `#`",
         "%": r"write `\%` for a literal `%`"}
_PRIMES = {1: "′", 2: "″", 3: "‴", 4: "⁗"}
_FORBIDDEN = {"Cc", "Co", "Cn", "Cs"}   # control, private-use, unassigned, surrogate
_JOINERS = {"\u200c", "\u200d"}   # needed by Persian, Indic scripts and emoji


def bracket(char: str, kind: str, zero: bool) -> Node:
    attrs = {"stretchy": "false", **(_ZERO if zero else {})}
    return Node("mo", char, attrs=attrs, kind=kind)


def symbol_node(char: str, kind: str) -> Node:
    if kind == "mi":
        return mi(char, mathvariant="normal") if char in _UPRIGHT_MI else mi(char)
    if char in _TIGHT_ORD:
        return mo(char, kind, **_ZERO)
    return mo(char, kind)


def space_node(name: str) -> Node:
    return Node("mspace", attrs={"width": _SPACES[name]}, kind="space")


# Command parsers: (parser, command name without backslash, depth) -> node or None.
Handler = Callable[["Parser", str, int], "Node | None"]
COMMANDS: dict[str, Handler] = {}


# --- parser -------------------------------------------------------------------

class Parser:
    def __init__(self, src: str):
        self.src = src
        self.pos = 0

    # tokens

    def peek(self) -> str | None:
        """The next token after whitespace, not consumed."""
        s = self.src
        while self.pos < len(s) and (s[self.pos].isspace() or s[self.pos] in _JOINERS):
            self.pos += 1
        if self.pos >= len(s):
            return None
        c = s[self.pos]
        if c == "’":                    # a curly apostrophe pasted from Word is a prime
            return "'"
        if c == "\\":
            m = _NAME.match(s, self.pos + 1)
            if m:
                return "\\" + m.group()
            return s[self.pos:self.pos + 2]
        m = _NUMBER.match(s, self.pos)
        if m:
            return m.group()
        return c

    def take(self) -> str:
        tok = self.peek()
        assert tok is not None
        self.pos += len(tok)
        return tok

    @staticmethod
    def enter(depth: int) -> int:
        if depth > MAX_DEPTH:
            raise LatexError("formula nested too deeply")
        return depth

    # structure

    def parse_seq(self, depth: int, closed: bool) -> list[Node]:
        """Nodes up to the end, or up to a `}` when the group was opened by `{`."""
        nodes: list[Node] = []
        prev: str | None = None
        while True:
            tok = self.peek()
            if tok is None:
                if closed:
                    raise LatexError("missing `}`")
                return nodes
            if tok == "}":
                if closed:
                    return nodes
                raise LatexError("unexpected `}`")
            node = self.parse_scripted(depth, prev)
            if node is not None:
                nodes.append(node)
                if node.kind != "space":
                    prev = node.kind

    def parse_braced(self, depth: int) -> Node:
        """`{…}` at the given depth; one operator alone gets TeX's ordinary spacing."""
        self.take()
        nodes = self.parse_seq(depth, closed=True)
        self.take()
        if len(nodes) == 1 and nodes[0].tag == "mo":
            only = nodes[0]
            return Node("mo", only.text, attrs={**only.attrs, **_ZERO})
        node = row(nodes)
        return Node(node.tag, node.text, node.children, node.attrs)

    def parse_arg(self, depth: int, owner: str, count: int = 1) -> Node:
        """One argument of a script or command: a braced group or one token."""
        depth = self.enter(depth + 1)
        tok = self.peek()
        if tok is None or tok in ("}", "^", "_", "'"):
            raise LatexError(f"`{owner}` needs {count} argument{'s' if count > 1 else ''}")
        if tok == "{":
            return self.parse_braced(depth)
        if tok[0].isdigit():
            self.pos += 1
            return Node("mn", tok[0])
        node = self.parse_atom(depth, None)
        if node is None:
            return Node("mrow")
        return node

    def parse_scripted(self, depth: int, prev: str | None) -> Node | None:
        tok = self.peek()
        base = None if tok in ("^", "_", "'") else self.parse_atom(depth, prev)
        sup: Node | None = None
        sub: Node | None = None
        primes = 0
        primes_open = True
        while True:
            tok = self.peek()
            if tok == "'":
                if sup is not None or (primes and not primes_open):
                    raise LatexError("double superscript")
                if not primes:
                    self.enter(depth + 1)
                self.take()
                primes += 1
                continue
            if primes:
                primes_open = False
            if tok == "^":
                if sup is not None:
                    raise LatexError("double superscript")
                self.take()
                sup = tighten(self.parse_arg(depth, "^"))
            elif tok == "_":
                if sub is not None:
                    raise LatexError("double subscript")
                self.take()
                sub = tighten(self.parse_arg(depth, "_"))
            else:
                break
        if primes:
            prime = mo(_PRIMES.get(primes, "′" * primes))
            if sup is None:
                sup = prime
            elif sup.tag == "mrow" and sup.children and not sup.attrs:
                sup = Node("mrow", children=[prime, *sup.children])
            else:
                sup = Node("mrow", children=[prime, sup])
        if sup is None and sub is None:
            return base
        return attach_scripts(base, sub, sup)

    def parse_atom(self, depth: int, prev: str | None) -> Node | None:
        tok = self.peek()
        assert tok is not None
        if tok == "{":
            return self.parse_braced(self.enter(depth + 1))
        if tok[0] == "\\":
            return self.parse_command(depth, prev)
        self.take()
        if tok[0].isdigit():
            return Node("mn", tok)
        return char_node(tok, prev)

    def parse_command(self, depth: int, prev: str | None) -> Node | None:
        tok = self.take()
        name = " " if tok[1:].isspace() else tok[1:]
        if name == "\\":
            raise LatexError("line breaks are not supported yet")
        if name in ("begin", "end"):
            if self.peek() != "{":
                raise LatexError(f"`\\{name}` is not supported yet")
            raise LatexError(f"`\\{name}{{{self.raw_group(None)}}}` is not supported yet")
        if name in COMMANDS:
            return COMMANDS[name](self, name, depth)
        if name in ("pm", "mp"):
            return sign_node(_SYMBOLS[name][0], prev)
        if name in _SYMBOLS:
            return symbol_node(*_SYMBOLS[name])
        if name in _GREEK:
            return mi(_GREEK[name])
        if name in _GREEK_UPPER:
            return mi(_GREEK_UPPER[name], mathvariant="normal")
        if name in _BRACKETS:
            return bracket(*_BRACKETS[name])
        if name in _ESCAPES:
            return mo(_ESCAPES[name], **(_ZERO if name in _TIGHT_ESCAPES else {}))
        if name in _SPACES:
            return space_node(name)
        raise LatexError(f"unknown command `{tok}`")

    # raw text

    def raw_group(self, depth: int | None) -> str:
        """The raw characters of a `{…}` group; nested braces count towards depth."""
        self.peek()
        s = self.src
        start = self.pos + 1
        i = start
        level = 1
        while i < len(s):
            c = s[i]
            if c == "\\":
                i += 2
                continue
            if c == "{":
                level += 1
                if depth is not None:
                    self.enter(depth + level - 1)
            elif c == "}":
                level -= 1
                if level == 0:
                    self.pos = i + 1
                    return s[start:i]
            i += 1
        raise LatexError("missing `}`")

    def parse_text(self, depth: int, name: str) -> Node:
        """`\\text{…}`: plain text, every space kept as a no-break space."""
        depth = self.enter(depth + 1)
        tok = self.peek()
        if tok is None or tok in ("}", "^", "_", "'"):
            raise LatexError(f"`\\{name}` needs 1 argument")
        if tok in _BARE:
            raise LatexError(_BARE[tok])
        if tok == "{":
            raw = self.raw_group(depth)
        else:
            raw = tok[0] if tok[0].isdigit() else tok
            self.pos += len(raw)
        out = []
        i = 0
        while i < len(raw):
            c = raw[i]
            if c == "\\":
                m = _NAME.match(raw, i + 1)
                cmd = m.group() if m else raw[i + 1:i + 2]
                if cmd == "\\":
                    raise LatexError("line breaks are not supported yet")
                if cmd in _ESCAPES or cmd in ("{", "}"):
                    out.append(cmd)
                elif cmd.isspace() or cmd in _TEXT_SPACES:
                    out.append(_TEXT_SPACES.get(cmd, " "))
                else:
                    raise LatexError(f"unknown command `\\{cmd}`")
                i += 1 + len(cmd)
                if m:                          # a control word swallows the spaces after it
                    while i < len(raw) and raw[i].isspace():
                        i += 1
                continue
            if c not in "{}":
                out.append(" " if c.isspace() or c == "~" else c)
            i += 1
        return Node("mtext", "".join(out).replace(" ", " "))


def _text_command(parser: Parser, name: str, depth: int) -> Node:
    return parser.parse_text(depth, name)


COMMANDS["text"] = _text_command
COMMANDS["mbox"] = _text_command


def attach_scripts(base: Node | None, sub: Node | None, sup: Node | None) -> Node:
    """Scripts on a base; an absent base is an empty mrow."""
    kind = base.kind if base is not None else "ord"
    base = base if base is not None else Node("mrow")
    if sub is not None and sup is not None:
        return Node("msubsup", children=[base, sub, sup], kind=kind)
    if sup is not None:
        return Node("msup", children=[base, sup], kind=kind)
    assert sub is not None
    return Node("msub", children=[base, sub], kind=kind)


def sign_node(char: str, prev: str | None) -> Node:
    text = _SIGNS.get(char, char)
    if prev in _UNARY_AFTER:
        return mo(text, "unary", **_ZERO)
    return mo(text, "bin")


def _greek_lower(c: str) -> bool:
    return unicodedata.category(c) == "Ll" and unicodedata.name(c, "").startswith("GREEK")


def char_node(c: str, prev: str | None) -> Node:
    if c in _BARE:
        raise LatexError(_BARE[c])
    if c in _SIGNS:
        return sign_node(c, prev)
    if c == "~":
        return space_node(" ")
    if c.isascii() and c.isalpha():
        return mi(c)
    if c == "µ":                       # MICRO SIGN, as typed on a Mac
        return mi("μ")
    if c in _TYPED:
        return symbol_node(c, _TYPED[c])
    if c in _TYPED_BRACKETS:
        return bracket(*_TYPED_BRACKETS[c])
    if c.isalpha():
        if _greek_lower(c) or unicodedata.name(c, "").startswith("LATIN"):
            return mi(c)
        return mi(c, mathvariant="normal")
    if unicodedata.category(c)[0] in "CM":  # a lone combining mark too: use \hat and friends
        raise LatexError(f"unsupported character U+{ord(c):04X}")
    if c in _OPEN_CHARS:
        return bracket(c, "open", False)
    if c in _CLOSE_CHARS:
        return bracket(c, "close", False)
    if c == "|":
        return bracket("|", "ord", True)
    if c in "/.":
        return mo(c, "ord", **_ZERO)
    if c == "*":
        return mo("∗", "bin")
    if c in _REL_CHARS:
        return mo(c, "rel")
    if c in _BIN_CHARS:
        return mo(c, "bin")
    if c in _PUNCT_CHARS:
        return mo(c, "punct")
    if c in "!?":
        return mo(c, "close")
    # Other typed maths symbols (≲, ⊕) act as operators; the rest are ordinary.
    if unicodedata.category(c) == "Sm":
        return mo(c, "bin")
    return mo(c, "ord", **_ZERO)


def latex_to_mathml(src: str, display: bool) -> str:
    """One formula as a `<math>` element, or a LatexError naming the problem."""
    if len(src) > MAX_LENGTH:
        raise LatexError("formula too long")
    # Recombine pasted decomposed letters; drop invisible format characters except joiners.
    text = "".join(
        c for c in unicodedata.normalize("NFC", src) if c in _JOINERS or unicodedata.category(c) != "Cf"
    )
    for c in text:
        if unicodedata.category(c) in _FORBIDDEN and c not in "\t\n\r":   # whitespace valid in XML
            raise LatexError(f"unsupported character U+{ord(c):04X}")
    if all(c.isspace() or c in _JOINERS for c in text):
        raise LatexError("empty formula")
    nodes = Parser(text).parse_seq(0, closed=False)
    body = "".join(n.xml() for n in nodes) if nodes else "<mrow/>"
    head = '<math display="block">' if display else "<math>"
    return (
        f"{head}<semantics><mrow>{body}</mrow>"
        f'<annotation encoding="application/x-tex">{html.escape(src, quote=True)}</annotation>'
        "</semantics></math>"
    )
