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
    "accentunder", "displaystyle", "width", "height", "depth",
)
_ATTR_SET = set(_ATTR_ORDER)
_ZERO = {"lspace": "0em", "rspace": "0em"}

# Kinds after which + - ± ∓ are unary (TeX's rule).
_UNARY_AFTER = {None, "open", "rel", "bin", "punct", "func", "limfunc", "bigop", "left"}
# Kinds before which a function gets no thin space (the spec's Functions row).
_NO_FUNC_SPACE = {"open", "close", "rel", "punct", "fenced"}
# Kinds after which a function gets a thin space before it, as in TeX.
_SPACE_BEFORE_FUNC = {"ord", "close", "fenced", "unary", "op"}   # a big operator brings its own
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
    group: bool = False                     # a braced group: \\bm keeps it whole

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
    node.children[:] = [c for c in node.children if c.kind != "relspace"]
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
           "mapsto ↦ mid ∣ parallel ∥ perp ⊥ leftrightarrow ↔ longrightarrow ⟶ longleftarrow ⟵ "
           "Longrightarrow ⟹ Longleftarrow ⟸ Longleftrightarrow ⟺ leqslant ⩽ geqslant ⩾",
    "bin": "pm ± mp ∓ times × cdot ⋅ div ÷ ast ∗ star ⋆ cup ∪ cap ∩ setminus ∖ land ∧ lor ∨ "
           "wedge ∧ vee ∨ circ ∘ bullet ∙",
    "op": "forall ∀ exists ∃ neg ¬ lnot ¬",
    "ord": "ldots … cdots ⋯ dots … vdots ⋮ ddots ⋱ prime ′ degree °",
    "mi": "infty ∞ partial ∂ nabla ∇ emptyset ∅ varnothing ∅ ell ℓ hbar ℏ top ⊤ bot ⊥",
}.items():
    _words = _pairs.split()
    for _name, _char in zip(_words[::2], _words[1::2]):
        _SYMBOLS[_name] = (_char, _kind)
_NOT = {   # \not before a relation: its negated character
    "=": "≠", "<": "≮", ">": "≯", "\\in": "∉", "\\ni": "∌", "\\le": "≰", "\\leq": "≰",
    "\\ge": "≱", "\\geq": "≱", "\\subset": "⊄", "\\supset": "⊅", "\\subseteq": "⊈",
    "\\supseteq": "⊉", "\\equiv": "≢", "\\sim": "≁", "\\simeq": "≄", "\\approx": "≉",
    "\\cong": "≇", "\\mid": "∤", "\\parallel": "∦",
}
# A typed symbol behaves like its command; the first kind wins (⊥ is \perp).
_TYPED: dict[str, str] = {}
for _char, _kind in _SYMBOLS.values():
    _TYPED.setdefault(_char, _kind)
for _char in _NOT.values():
    _TYPED.setdefault(_char, "rel")
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
    "lbrace": ("{", "open", False), "rbrace": ("}", "close", False),
    "lbrack": ("[", "open", False), "rbrack": ("]", "close", False),
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


# --- structure tables ---------------------------------------------------------

_BIGOPS = {"sum": "∑", "prod": "∏", "coprod": "∐", "bigcup": "⋃", "bigcap": "⋂"}
_INTEGRALS = {"int": "∫", "iint": "∬", "iiint": "∭", "oint": "∮"}
_TYPED_BIGOPS = {**{c: True for c in _BIGOPS.values()}, **{c: False for c in _INTEGRALS.values()}}
_FUNCTIONS = (
    "log ln lg exp sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh "
    "coth det dim ker deg hom arg Pr gcd"
).split()
_LIMFUNCS = {
    "lim": "lim", "limsup": "lim\u2009sup", "liminf": "lim\u2009inf", "max": "max", "min": "min",
    "sup": "sup", "inf": "inf", "argmax": "arg\u2009max", "argmin": "arg\u2009min",
}
_ACCENTS = {   # name -> (character, CSS class that places it, stretchy)
    "bar": ("¯", "math-acc", False), "hat": ("ˆ", "math-acc", False), "tilde": ("˜", "math-acc", False),
    "dot": ("˙", "math-acc", False), "ddot": ("¨", "math-acc", False), "vec": ("→", "math-vec", False),
    "widehat": ("\u0302", None, True), "widetilde": ("˜", None, True),
}
_BIG = {"big": "1.2em", "Big": "1.8em", "bigg": "2.4em", "Bigg": "3em"}
_OPEN_DELIMS = set("([{⟨⌊⌈")
_CLOSE_DELIMS = set(")]}⟩⌋⌉")
_BAR_DELIMS = set("|‖/")      # ordinary, so zero spacing as in TeX
# Tokens that can follow \left, \right, \middle and \big.
_DELIMS = {c: c for c in "()[]|/"}
_DELIMS.update({"<": "⟨", ">": "⟩"})
_DELIMS.update({"\\" + name: entry[0] for name, entry in _BRACKETS.items()})
_DELIMS.update({c: c for c in _TYPED_BRACKETS})

# Letter fonts: font -> (Latin, digits, capital Greek, lowercase Greek) styles; None keeps the letter.
_FONTS = {
    "mathrm": ("rm", None, None, None),
    "mathit": ("it", None, "it", None),
    "mathbf": ("bf", "bf", "bf", None),
    "boldsymbol": ("bfit", "bf", "bf", "bfit"),
    "mathbb": ("bb", "bb", None, None),
    "mathcal": ("cal", None, None, None),
    "mathsf": ("sf", "sf", None, None),
    "mathtt": ("tt", "tt", None, None),
}
_FONTS["bm"] = _FONTS["boldsymbol"]
# Mathematical Alphanumeric Symbols: capital A of each style; lowercase a is 26 later.
_LATIN_BASE = {"bf": 0x1D400, "it": 0x1D434, "bfit": 0x1D468, "cal": 0x1D49C, "bfcal": 0x1D4D0,
               "bb": 0x1D538, "sf": 0x1D5A0, "bfsf": 0x1D5D4, "tt": 0x1D670}
_SCRIPTED = {"msub", "msup", "msubsup", "munder", "mover", "munderover"}
_RETAG = {t: pair for pair in (("msub", "munder"), ("msup", "mover"), ("msubsup", "munderover")) for t in pair}
_UPRIGHT = {"rm", "bf", "sf", "bfsf", "tt", "bb"}   # accented letters stay upright in these fonts
# Bold math (\bm, \boldsymbol) makes an inner font's letters bold where Unicode has the style.
_BOLDER = {"rm": "bf", "it": "bfit", "cal": "bfcal", "sf": "bfsf"}
_LETTERLIKE = {   # the block's holes, filled by older Letterlike Symbols
    ("it", "h"): "ℎ",
    **{("cal", c): v for c, v in zip("BEFHILMReg o".replace(" ", ""), "ℬℰℱℋℐℒℳℛℯℊℴ")},
    **{("bb", c): v for c, v in zip("CHNPQRZ", "ℂℍℕℙℚℝℤ")},
}
_DIGIT_BASE = {"bf": 0x1D7CE, "bb": 0x1D7D8, "sf": 0x1D7E2, "bfsf": 0x1D7EC, "tt": 0x1D7F6}
_GREEK_BASE = {"bf": 0x1D6A8, "it": 0x1D6E2, "bfit": 0x1D71C}
_GREEK_EXTRA = {"ϴ": 17, "∇": 25, "∂": 51, "ϵ": 52, "ϑ": 53, "ϰ": 54, "ϕ": 55, "ϱ": 56, "ϖ": 57}


def _greek_index(c: str) -> tuple[int, bool] | None:
    """Position in a Mathematical Greek alphabet, and whether it is a capital."""
    o = ord(c)
    if 0x391 <= o <= 0x3A9 and o != 0x3A2:
        return o - 0x391, True
    if 0x3B1 <= o <= 0x3C9:
        return 26 + o - 0x3B1, False
    if c in _GREEK_EXTRA:
        return _GREEK_EXTRA[c], _GREEK_EXTRA[c] < 26
    return None


def bigop_node(char: str, movable: bool) -> Node:
    attrs = {"largeop": "true", **({"movablelimits": "true"} if movable else {}), **_ZERO}
    return Node("mo", char, attrs=attrs, kind="bigop")   # TeX's spaces are written beside it


def fence_node(char: str, kind: str) -> Node:
    attrs = {"stretchy": "true", "fence": "true", **(_ZERO if char in _BAR_DELIMS else {})}
    return Node("mo", char, attrs=attrs, kind=kind)


def strut(size: str) -> Node:
    """An invisible bar of a bracket's height on the maths axis; Safari grows the bracket to it."""
    half = float(size[:-2]) / 2
    return Node("mspace", attrs={"height": f"{round(half + 0.25, 4):g}em", "depth": f"{round(half - 0.25, 4):g}em"},
                kind="strut")


def rel_space() -> Node:
    """The thick space around a stacked relation that is not an operator; gone in scripts."""
    return Node("mspace", attrs={"width": _SPACES[";"]}, kind="relspace")


def inner_space() -> Node:
    """A thin space that TeX drops in scripts (an operator before a `\\left…\\right` group)."""
    return Node("mspace", attrs={"width": _SPACES[","]}, kind="relspace")


def auto_space() -> Node:
    """A thin space the converter adds; `\\operatorname` drops it from its argument."""
    return Node("mspace", attrs={"width": _SPACES[","]}, kind="auto")


_SCRIPT_TAGS = {"msub", "msup", "msubsup"}
_STACK_TAGS = {"munder", "mover", "munderover"}
_MEDIUM = {"minsize": "1.2em", "maxsize": "1.2em"}   # the \\big size


def _has_fence(nodes: list[Node]) -> bool:
    """A `\\middle` bracket in the group, maybe inside a style segment."""
    return any((n.tag == "mo" and "fence" in n.attrs) or (n.tag == "mstyle" and _has_fence(n.children)) for n in nodes)


def _sized(node: Node) -> bool:
    """A `\\big…` bracket: its strut and the `mo`, nothing else."""
    return (node.tag == "mrow" and not node.attrs and len(node.children) == 2
            and node.children[0].kind == "strut" and node.children[1].tag == "mo")


def _unsize(node: Node, memo: dict[int, bool] | None = None) -> Node:
    """A stack never stretches its operator: along `_core`'s path it loses strut and size."""
    if memo is None:
        if _core(node).tag != "mo":
            return node
        memo = {}
    if _sized(node):
        node = node.children[1]
    if node.tag == "mo":
        for key in ("minsize", "maxsize"):
            node.attrs.pop(key, None)
    elif node.tag in _SCRIPT_TAGS or node.tag in _STACK_TAGS or node.tag == "mfrac":
        node.children[0] = _unsize(node.children[0], memo)
    elif node.tag in ("mstyle", "mrow"):
        real = [i for i, c in enumerate(node.children) if not _space_like(c, memo)]
        if len(real) == 1:
            node.children[real[0]] = _unsize(node.children[real[0]], memo)
            node.children[:] = [c for c in node.children if c.kind != "strut"]
    return node


def _ordinary(core: Node) -> None:
    """TeX: a group or an accented, rooted or fraction atom is ordinary."""
    if core.tag == "mo" and core.kind not in ("bigop", "limfunc"):
        core.attrs.update(_ZERO)
        core.kind = "ord"


_MOVABLE = frozenset("∏∐∑⋀⋁⋂⋃⨀⨁⨂⨃⨄⨅⨆⨇⨈⨉⨊⨝⨞⫼⫿")   # MathML Core dictionary, prefix form


def _movable(node: Node) -> bool:
    """Its limits move: the attribute, else MathML Core's dictionary default."""
    default = "true" if node.text in _MOVABLE else "false"
    return node.tag == "mo" and node.attrs.get("movablelimits", default) == "true"


def _operator(base: Node | None) -> Node | None:
    """The big operator or limit function a base is, maybe inside a bold group's style."""
    if base is None or base.kind not in ("bigop", "limfunc"):
        return None
    op = _transparent(base)
    return op if op.tag == "mo" and op.kind in ("bigop", "limfunc") else None


def _wrapper(node: Node) -> bool:
    """A style or plain row \\bm sees through; never a braced or `\\left…\\right` group."""
    return not node.group and (node.tag == "mstyle" or (node.tag == "mrow" and not node.attrs and node.kind != "fenced"))


def _lift_function(node: Node) -> bool:
    """One function along the wrappers: its mark moves outside, the wrappers become a function."""
    path = []
    memo: dict[int, bool] = {}
    while _wrapper(node):
        real = [c for c in node.children if not _space_like(c, memo)]
        if [c.kind for c in real] == ["func", "auto"]:
            node.children.remove(real[1])
            for wrapper in [*path, node]:
                wrapper.kind = "func"
            return True
        if len(real) != 1:
            return False
        path.append(node)
        node = real[0]
    return False


def _inner_style(node: Node) -> str | None:
    """The `displaystyle` of the innermost style on `_transparent`'s path, if any."""
    style = None
    memo: dict[int, bool] = {}
    while node is not _transparent(node, memo):
        if node.tag == "mstyle":
            style = node.attrs.get("displaystyle", style)
        real = [c for c in node.children if not _space_like(c, memo)]
        node = real[0]
    return style


def _transparent(node: Node, memo: dict[int, bool] | None = None) -> Node:
    """The one atom inside style or plain-row wrappers, spaces aside."""
    memo = {} if memo is None else memo
    while _wrapper(node):
        real = [c for c in node.children if not _space_like(c, memo)]
        if len(real) != 1:
            return node
        node = real[0]
    return node


def _rejudge(atom: Node, prev: str | None) -> None:
    """Alone in its braces a sign looked unary; beside an atom it is binary."""
    core = _core(atom)
    if core.tag == "mo" and atom.kind == "unary" and prev not in _UNARY_AFTER:
        core.attrs.pop("lspace", None)
        core.attrs.pop("rspace", None)
        core.kind = atom.kind = "bin"
        if core is not atom:
            core.attrs["form"] = "infix"      # Chrome otherwise spaces it as a prefix


def _space_like(node: Node, memo: dict[int, bool] | None = None) -> bool:
    if memo is not None and id(node) in memo:
        return memo[id(node)]
    found = node.tag in ("mspace", "mtext") or (
        node.tag in ("mrow", "mstyle") and all(_space_like(c, memo) for c in node.children)
    )
    if memo is not None:
        memo[id(node)] = found
    return found


def _core(node: Node) -> Node:
    """The operator an embellished operator is built on, by MathML Core's rules."""
    memo: dict[int, bool] = {}
    while True:
        if node.tag in _SCRIPT_TAGS or node.tag in _STACK_TAGS or node.tag == "mfrac":
            node = node.children[0]
        elif node.tag in ("mstyle", "mrow"):
            real = [c for c in node.children if not _space_like(c, memo)]
            if len(real) != 1:
                return node
            node = real[0]
        else:
            return node


def _join_relations(first: Node, second: Node) -> None:
    """TeX puts no space between two relations, as in `:=`."""
    a, b = _core(first), _core(second)
    if a.tag == "mo":
        a.attrs["rspace"] = "0em"
        if a.text == ":":
            a.attrs.setdefault("lspace", "0.2778em")   # Chrome spaces a lone : as punctuation
    if b.tag == "mo":
        b.attrs["lspace"] = "0em"
        if b.text == ":":
            b.attrs.setdefault("rspace", "0.2778em")


def _after_punct(punct: Node, relation: Node) -> None:
    """TeX puts a thin space between punctuation and a relation, as in `f\\colon = g`."""
    a, b = _core(punct), _core(relation)
    if b.tag == "mo":
        b.attrs["lspace"] = "0em"
    if a.tag == "mo" and a.attrs.get("rspace") == "0.2778em":
        a.attrs["rspace"] = "0.1667em"


def _make_ordinary(node: Node | None) -> None:
    """TeX: a binary operator with no operand on one side is set as an ordinary atom."""
    core = _core(node) if node is not None else None
    if node is not None and node.kind == "bin" and core is not None and core.tag == "mo":
        core.attrs.update(_ZERO)
        core.kind = node.kind = "unary"


def _measure(node: Node, display: bool) -> tuple[int, int]:
    """How far a \\left bracket grows for this node (0 not, 1 to the \\big size, 2 to the
    content), and how many script levels it stacks (1 for x^2, 2 for x^{x^2})."""
    parts = [_measure(c, display) for c in node.children]
    height = max((h for h, _ in parts), default=0)
    tower = max((t for _, t in parts), default=0)
    if node.tag in _SCRIPT_TAGS:
        tower = 1 + max((t for _, t in parts[1:]), default=0)
        height = max(height, 2 if tower >= 3 else 1 if tower == 2 else 0)
        if _core(node).kind == "limfunc":
            height = max(height, 1)                   # a limit beside its name
    elif node.tag == "mover" and node.attrs.get("accent") == "true":
        wide = node.children[1].attrs.get("stretchy") == "true"
        height = max(1 if wide else 0, parts[0][0])
    elif node.tag in ("mfrac", "msqrt", "mroot"):
        height = 2
    elif node.tag == "mo":
        height = 2 if "largeop" in node.attrs or "minsize" in node.attrs else 0
    elif node.tag in _STACK_TAGS:
        core = _core(node)
        under = (core.attrs.get("movablelimits") == "false" and ("largeop" in core.attrs or core.kind == "limfunc")) or (display and core.kind == "limfunc")
        height = max(2 if under else 1, height)    # limits under a name are tall
    return height, tower


def _largest_size(nodes: list[Node]) -> str | None:
    """The biggest `\\big` size inside, which an outer growing bracket must reach."""
    sizes = []
    stack = list(nodes)
    while stack:
        node = stack.pop()
        if node.tag == "mo" and "minsize" in node.attrs:
            sizes.append(node.attrs["minsize"])
        stack.extend(node.children)
    return max(sizes, key=lambda v: float(v[:-2])) if sizes else None


def _set_fences(nodes: list[Node], **attrs: str) -> None:
    """Update the \\middle brackets of a \\left group (they may sit inside a style)."""
    for node in nodes:
        if node.tag == "mo" and "fence" in node.attrs:
            node.attrs.update(attrs)
        elif node.tag == "mstyle":
            _set_fences(node.children, **attrs)


def binom_node(top: Node, bottom: Node) -> Node:
    frac = Node("mfrac", children=[top, bottom], attrs={"linethickness": "0"})
    return Node("mrow", children=[mo("("), frac, mo(")")])


def _delim_kind(char: str) -> str:
    return "open" if char in _OPEN_DELIMS else "close" if char in _CLOSE_DELIMS else "ord"


def _inner(node: Node) -> list[Node]:
    """The children a wrapper element takes: a plain mrow's, or the node itself."""
    return node.children if node.tag == "mrow" and not node.attrs else [node]


# Command parsers: (parser, command name without backslash, depth) -> node or None.
Handler = Callable[["Parser", str, int], "Node | None"]
COMMANDS: dict[str, Handler] = {}


# --- parser -------------------------------------------------------------------

class Parser:
    def __init__(self, src: str, display: bool = False):
        self.src = src
        self.display = display              # whether movable limits sit under their operator
        self.pos = 0
        self.font: str | None = None
        self.bold = False                   # inside \\bm or \\boldsymbol: bold math
        self.prev: str | None = None        # the kind before the atom being parsed

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

    def parse_seq(self, depth: int, until: str | None = None) -> list[Node]:
        """Nodes up to the group's end: the source end, `}`, `]` or `\\right` (`until`)."""
        nodes: list[Node] = []
        styles: list[tuple[int, str]] = []          # (start index, displaystyle value)
        split: tuple[list[Node], str] | None = None  # numerator and `\\over` or `\\choose`
        prev: str | None = "left" if until == "\\right" else None
        spaced = False                               # a function waits for its thin space
        last: Node | None = None                     # the last atom, for TeX's binary rule
        rel_after = False                            # a stacked relation waits for its space
        op_after = False                             # so does a big operator
        while True:
            tok = self.peek()
            if tok is None or tok in ("}", "\\right") or (tok == "]" and until == "]"):
                _check_end(tok, until)
                _make_ordinary(last)
                break
            if tok == "\\middle":
                if until != "\\right":
                    raise LatexError("missing `\\left`")
                _make_ordinary(last)
                last, rel_after, op_after = None, False, False
                self.take()
                self.enter(depth + 1)
                char = self.delimiter("\\middle")
                if char:
                    nodes.append(fence_node(char, "open"))
                prev, spaced = "open", False
                continue
            if tok in ("\\over", "\\choose"):
                if split is not None:
                    raise LatexError("two `\\over` in one group; add braces")
                self.take()
                _make_ordinary(last)
                split = (_fold_styles(nodes, styles), tok)
                nodes, styles, prev, spaced, last, rel_after, op_after = [], [], None, False, None, False, False
                continue
            if tok in ("\\displaystyle", "\\textstyle"):
                self.take()
                styles.append((len(nodes), "true" if tok == "\\displaystyle" else "false"))
                continue
            self.prev = prev
            node = self.parse_scripted(depth, prev)
            if node is None:
                continue
            if prev in _UNARY_AFTER:
                _make_ordinary(node)                      # nothing before it to operate on
            if node.kind == "space":
                nodes.append(node)                        # a waiting function space goes after it
                continue
            if node.kind in ("rel", "close", "punct"):
                _make_ordinary(last)                      # nothing after it to operate on
                prev = last.kind if last is not None else prev
            core = _core(node)
            if node.kind == "rel" and last is not None and last.kind == "rel":
                _join_relations(last, node)
            elif node.kind == "rel" and last is not None and last.kind == "punct":
                _after_punct(last, node)
            if rel_after and node.kind not in ("rel", "close", "punct"):
                nodes.append(rel_space())
            rel_after = node.kind == "rel" and core.tag != "mo"
            if rel_after and prev not in (None, "rel", "open", "left", "punct"):
                nodes.append(rel_space())                 # an operator gets this from MathML itself
            if op_after and node.kind not in ("rel", "open", "close", "punct"):
                nodes.append(inner_space() if node.kind == "fenced" else auto_space())
            op_after = node.kind == "bigop"
            if op_after and prev in _SPACE_BEFORE_FUNC:
                nodes.append(auto_space())                # TeX's thin space beside an operator
            if spaced and node.kind not in _NO_FUNC_SPACE:
                nodes.append(auto_space())
            elif node.kind in ("func", "limfunc") and prev in _SPACE_BEFORE_FUNC:
                nodes.append(auto_space())
            spaced = node.kind in ("func", "limfunc")
            nodes.append(node)
            if node.kind == "func":
                nodes.append(mo("\u2061", "auto"))     # FUNCTION APPLICATION
            prev = node.kind
            last = node
        nodes = _fold_styles(nodes, styles)
        if split is None:
            return nodes
        num, cmd = split
        if cmd == "\\over":
            return [Node("mfrac", children=[row(num), row(nodes)])]
        return [binom_node(row(num), row(nodes))]

    def parse_braced(self, depth: int, ordinary: bool = True) -> Node:
        """`{…}` at the given depth; alone, an operator gets TeX's ordinary spacing."""
        self.take()
        nodes = self.parse_seq(depth, "}")
        self.take()
        if not ordinary and len(nodes) == 2 and nodes[0].kind == "func" and nodes[1].kind == "auto":
            nodes.pop()                                   # the row outside marks it again
        if not ordinary and len(nodes) == 1:
            return nodes[0]
        if ordinary and nodes and not (len(nodes) == 1 and nodes[0].tag == "mo"):
            _ordinary(_core(row(nodes)))
        if len(nodes) == 1 and nodes[0].tag == "mo":
            only = nodes[0]                               # an ordinary atom: no limits under or over
            attrs = {k: v for k, v in only.attrs.items() if k != "movablelimits"}
            return Node("mo", only.text, attrs={**attrs, **_ZERO})
        node = row(nodes)
        return Node(node.tag, node.text, node.children, node.attrs, group=ordinary)

    def parse_arg(self, depth: int, owner: str, count: int = 1, ordinary: bool = True) -> Node:
        """One argument of a script or command: a braced group or one token."""
        depth = self.enter(depth + 1)
        tok = self.peek()
        if tok is None or tok in ("}", "^", "_", "'"):
            raise LatexError(f"`{owner}` needs {count} argument{'s' if count > 1 else ''}")
        if tok == "{":
            return self.parse_braced(depth, ordinary)
        if tok[0].isdigit():
            self.pos += 1
            return self.restyle(Node("mn", tok[0]))
        self.prev = None
        node = self.parse_atom(depth, None)
        if node is None:
            return Node("mrow")
        if ordinary:
            _ordinary(_core(node))
            if node.tag == "mo":
                node.attrs.pop("movablelimits", None)   # as a braced one: no limits under or over
        return node

    def styled_arg(self, depth: int, font: str, owner: str, ordinary: bool = True) -> Node:
        """An argument whose letters take `font`; an inner font wins."""
        saved, self.font = self.font, font
        try:
            return self.parse_arg(depth, owner, ordinary=ordinary)
        finally:
            self.font = saved

    def restyle(self, leaf: Node) -> Node:
        """A letter or number in the current font."""
        if self.font is None or leaf.text is None or leaf.tag not in ("mi", "mn"):
            return leaf
        latin, digits, upper, lower = _FONTS[self.font]
        if self.bold:
            latin = _BOLDER.get(latin, latin)
            digits = {None: "bf", "sf": "bfsf"}.get(digits, digits)
            upper = {None: "bf", "it": "bfit"}.get(upper, upper)
            lower = "bfit"
        if leaf.tag == "mn":
            if digits is None:
                return leaf
            return Node("mn", "".join(
                chr(_DIGIT_BASE[digits] + ord(d) - 48) if "0" <= d <= "9" else d for d in leaf.text
            ))
        c = leaf.text
        if len(c) != 1:
            return leaf
        if latin in _UPRIGHT and c.isalpha() and not c.isascii() and unicodedata.name(c, "").startswith("LATIN"):
            return mi(c, mathvariant="normal")
        if c.isascii() and c.isalpha():
            if latin == "rm":
                return mi(c, mathvariant="normal")
            if (latin, c) in _LETTERLIKE:
                return mi(_LETTERLIKE[latin, c])
            offset = ord(c) - 65 if c.isupper() else 26 + ord(c) - 97
            return mi(chr(_LATIN_BASE[latin] + offset))
        if c in "∇∂" and lower != "bfit":
            return leaf                               # only \\boldsymbol changes these symbols
        greek = _greek_index(c)
        if greek is not None:
            style = "bf" if c == "∇" else upper if greek[1] else lower   # ∇ is an upright symbol
            if style is not None:
                return mi(chr(_GREEK_BASE[style] + greek[0]))
        return leaf

    def delimiter(self, owner: str) -> str:
        """The bracket after `\\left`, `\\right`, `\\middle` or `\\big`; `.` is none."""
        tok = self.peek()
        if tok == ".":
            self.take()
            return ""
        if tok is None or tok not in _DELIMS:
            raise LatexError(f"`{owner}` needs a bracket")
        self.take()
        return _DELIMS[tok]

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
            if tok in ("\\limits", "\\nolimits"):
                self.take()
                self.limits(base, tok)                # TeX takes it after scripts too
                primes_open = not primes              # and it ends the primes
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

    def limits(self, base: Node | None, tok: str) -> None:
        scripted = base is not None and not base.group and base.tag in _SCRIPTED and base.kind in ("bigop", "limfunc")
        op = _operator(base.children[0] if scripted else base)   # \\bm{\\sum_i}\\limits: the operator inside
        if op is None:
            raise LatexError(f"`{tok}` must follow an operator")
        if tok == "\\limits":
            op.attrs["movablelimits"] = "false"
        else:
            op.attrs.pop("movablelimits", None)
        if scripted:
            base.tag = _RETAG[base.tag][tok == "\\limits"]     # its scripts move under or beside it

    def parse_atom(self, depth: int, prev: str | None) -> Node | None:
        tok = self.peek()
        assert tok is not None
        if tok == "{":
            return self.parse_braced(self.enter(depth + 1))
        if tok[0] == "\\":
            return self.parse_command(depth, prev)
        self.take()
        if tok[0].isdigit():
            return self.restyle(Node("mn", tok))
        return self.restyle(char_node(tok, prev))

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
            return self.restyle(symbol_node(*_SYMBOLS[name]))
        if name in _GREEK:
            return self.restyle(mi(_GREEK[name]))
        if name in _GREEK_UPPER:
            return self.restyle(mi(_GREEK_UPPER[name], mathvariant="normal"))
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


def _misplaced(message: str) -> Handler:
    def handler(parser: Parser, name: str, depth: int) -> Node | None:
        raise LatexError(message.replace("NAME", name))
    return handler


for _name in ("right", "middle"):
    COMMANDS[_name] = _misplaced("missing `\\left`")
for _name in ("over", "choose", "displaystyle", "textstyle"):
    COMMANDS[_name] = _misplaced("misplaced `\\NAME`")
for _name in ("limits", "nolimits"):
    COMMANDS[_name] = _misplaced("`\\NAME` must follow an operator")


def _frac(parser: Parser, name: str, depth: int) -> Node:
    top = parser.parse_arg(depth, f"\\{name}", 2)
    bottom = parser.parse_arg(depth, f"\\{name}", 2)
    if name == "binom":
        return binom_node(top, bottom)
    frac = Node("mfrac", children=[top, bottom])
    if name == "frac":
        return frac
    return Node("mstyle", children=[frac], attrs={"displaystyle": "true" if name == "dfrac" else "false"})


def _sqrt(parser: Parser, name: str, depth: int) -> Node:
    if parser.peek() != "[":
        return Node("msqrt", children=_inner(parser.parse_arg(depth, "\\sqrt")))
    inner = parser.enter(depth + 1)
    parser.take()
    index = tighten(row(parser.parse_seq(inner, "]")))   # a script-size index
    parser.take()
    return Node("mroot", children=[parser.parse_arg(depth, "\\sqrt"), index])


def _accent(parser: Parser, name: str, depth: int) -> Node:
    char, cls, stretchy = _ACCENTS[name]
    base = parser.parse_arg(depth, f"\\{name}")
    core = _core(base)
    if _movable(core) and core is base:
        core.attrs["movablelimits"] = "false"                  # else Chrome sets the accent aside
    elif _movable(core):
        base = Node("mrow", children=[base, Node("mi", "")])   # its own scripts keep their place
    attrs = {"class": cls} if cls else {}
    attrs["stretchy"] = "true" if stretchy else "false"
    if cls == "math-vec":
        attrs.update(_ZERO)                            # Safari would add the arrow's relation spacing
    return Node("mover", children=[base, Node("mo", char, attrs=attrs)], attrs={"accent": "true"})


def _line(parser: Parser, name: str, depth: int) -> Node:
    base = parser.parse_arg(depth, f"\\{name}")
    return Node("mrow", children=_inner(base), attrs={"class": f"math-{name}"})


def _stack(parser: Parser, name: str, depth: int) -> Node:
    prev = parser.prev
    top = tighten(parser.parse_arg(depth, f"\\{name}", 2))
    base = parser.parse_arg(depth, f"\\{name}", 2, ordinary=False)   # `{=}` stays a relation
    rel = name == "stackrel"
    base = _unsize(base)
    core = _core(base)
    inner = base
    while inner.tag == "mstyle" and len(inner.children) == 1:
        inner = inner.children[0]
    movable = core.tag == "mo" and (core.kind in ("bigop", "limfunc") or _movable(core))
    if movable and inner is not core:
        base = Node("mrow", children=[base, Node("mi", "")])   # keeps its own limits; the top stays above
        core = base
    if core.tag == "mo":
        core.attrs["stretchy"] = "false"      # a stretchy arrow lifts the label in Chrome
        _rejudge(core, prev)
        if movable:
            core.attrs["movablelimits"] = "false"   # a stack never moves its top aside
        if rel and core.kind != "rel":
            core.attrs.update(lspace="0.2778em", rspace="0.2778em")
            core.kind = "rel"
        if core.kind in ("rel", "bin"):
            core.attrs["form"] = "infix"      # Chrome otherwise drops the spacing of some, like ∼
    if core.tag == "mo" and (rel or core.kind in ("rel", "bin", "unary")):
        kind = "rel" if rel else core.kind
    elif core.tag == "mo":
        core.attrs.update(_ZERO)              # amsmath: an ordinary atom
        kind = "ord"
    else:
        kind = "rel" if rel or base.kind == "rel" else "ord"     # amsmath: an ordinary atom
    return Node("munder" if name == "underset" else "mover", children=[base, top], kind=kind)


def _left(parser: Parser, name: str, depth: int) -> Node:
    depth = parser.enter(depth + 1)
    opening = parser.delimiter("\\left")
    inner = parser.parse_seq(depth, "\\right")
    parser.take()
    closing = parser.delimiter("\\right")
    fences = ([fence_node(opening, "open")] if opening else []) + ([fence_node(closing, "close")] if closing else [])
    height = max((_measure(node, parser.display)[0] for node in inner), default=0)
    if height == 0:
        attrs = {"stretchy": "false"}                 # Chrome reserves the widest size for growing
    elif height == 1:
        attrs = dict(_MEDIUM)                         # a little taller: LaTeX picks the \\big size
    else:
        size = _largest_size(inner)
        attrs = {"minsize": size} if size else {}
    _set_fences(fences + inner, **attrs)
    if height == 1 and (fences or _has_fence(inner)):
        inner = [strut(_MEDIUM["minsize"]), *inner]   # Safari would grow the bracket upwards only
    children = fences[:1] + inner + fences[1:] if opening else inner + fences
    return Node("mrow", children=children, kind="fenced")


def _big(parser: Parser, name: str, depth: int) -> Node | None:
    side = name[-1] if name[-1] in "lrm" and name[:-1] in _BIG else ""
    size = _BIG[name[:-1] if side else name]
    parser.enter(depth + 1)
    char = parser.delimiter(f"\\{name}")
    if not char:
        return None
    kind = {"l": "open", "r": "close", "m": "rel"}.get(side, "ord")   # plain \\big is ordinary, as in TeX
    if side == "m":
        spacing = {"lspace": "0.2778em", "rspace": "0.2778em"}
    else:
        spacing = _ZERO if char in _BAR_DELIMS else {}
    attrs = {"stretchy": "true", **spacing, "minsize": size, "maxsize": size}
    return Node("mrow", children=[strut(size), Node("mo", char, attrs=attrs, kind=kind)], kind=kind)


def _font(parser: Parser, name: str, depth: int) -> Node:
    prev = parser.prev
    keep = name in ("boldsymbol", "bm")                   # the bm package keeps an operator's class
    saved, parser.bold = parser.bold, parser.bold or keep
    try:
        node = parser.styled_arg(depth, name, f"\\{name}", ordinary=not keep)
    finally:
        parser.bold = saved
    if keep and (node.kind == "func" or _lift_function(node)):
        return node                                        # a function keeps its class
    if keep:
        atom = _transparent(node)
        _rejudge(atom, prev)
        node.kind = atom.kind                              # the bm package keeps the atom's class
        core = _core(atom)
        if atom is not node and atom.kind in ("bin", "rel") and core.tag == "mo":
            core.attrs["form"] = "infix"                   # first in a row, Chrome would take it as prefix
        return node
    if name == "mathrm":
        node = _merge_upright(node)
    node.kind = "ord"
    return node


def _bold(text: str) -> str:
    """Latin letters in Mathematical Bold, as a name looks under \\bm."""
    return "".join(
        chr(0x1D400 + (ord(c) - 65 if c.isupper() else 26 + ord(c) - 97)) if c.isascii() and c.isalpha() else c
        for c in text
    )


def _upright(node: Node) -> str | None:
    """An upright letter's style, plain or bold; None for anything else."""
    if node.tag != "mi" or not node.text or len(node.text) != 1:
        return None
    if node.attrs == {"mathvariant": "normal"}:
        return "rm" if node.text.isascii() else "any"          # an accented letter joins either run
    if not node.attrs and 0x1D400 <= ord(node.text) <= 0x1D433:
        return "bf"
    return None


def _merge_upright(node: Node) -> Node:
    """Neighbouring upright letters form one word: `\\mathrm{Var}` is <mi>Var</mi>."""
    if node.tag != "mrow" or node.attrs:
        return node
    out: list[Node] = []
    run: list[Node] = []
    held: str | None = None                           # the run's plain or bold style
    for child in [*node.children, None]:
        style = _upright(child) if child is not None else None
        if style is not None and (style == "any" or held in (None, style)):
            run.append(child)
            held = held if style == "any" else style
            continue
        if len(run) > 1:
            out.append(mi("".join(n.text or "" for n in run)))
        else:
            out.extend(run)
        run = []
        held = None if style in (None, "any") else style
        if style is not None:
            run.append(child)                         # it starts the next run
        elif child is not None:
            out.append(child)
    if len(run) > 1:
        out.append(mi("".join(n.text or "" for n in run)))
    else:
        out.extend(run)
    merged = row(out)
    merged.group = merged.group or node.group             # still the braced group it was
    return merged


def _drop_marks(node: Node) -> None:
    """Remove the converter's function marks inside a name."""
    node.children[:] = [c for c in node.children if c.tag != "mo" or c.kind != "auto"]
    for child in node.children:
        _drop_marks(child)


def _operatorname(parser: Parser, name: str, depth: int) -> Node:
    star = parser.peek() == "*"
    if star:
        parser.take()
    owner = "\\operatorname*" if star else "\\operatorname"
    parts = [p for p in _inner(parser.styled_arg(depth, "mathrm", owner)) if p.tag != "mo" or p.kind != "auto"]
    for part in parts:
        _drop_marks(part)
    while parts and parts[-1].kind == "auto":
        parts.pop()                                   # the outer name brings its own mark
    node = _merge_upright(Node("mrow", children=parts)) if len(parts) != 1 else parts[0]
    if not star:
        node.kind = "func"
        node.group = True                             # \\mathop: its scripts stay its own
        return node
    parts = _inner(node)
    if not parts or any(
        not (p.tag == "mspace" or (p.tag == "mi" and (p.text or "").isalpha())) for p in parts
    ):
        raise LatexError("`\\operatorname*` takes letters only")
    text = "".join(p.text or "" if p.tag == "mi" else "\u2009" for p in parts)
    return mo(text, "limfunc", movablelimits="true", **_ZERO)


for _name in ("frac", "dfrac", "tfrac", "binom"):
    COMMANDS[_name] = _frac
COMMANDS["sqrt"] = _sqrt
for _name in _ACCENTS:
    COMMANDS[_name] = _accent
for _name in ("overline", "underline"):
    COMMANDS[_name] = _line
for _name in ("overset", "underset", "stackrel"):
    COMMANDS[_name] = _stack
COMMANDS["left"] = _left
for _name in _BIG:
    for _suffix in ("", "l", "r", "m"):
        COMMANDS[_name + _suffix] = _big
for _name in _FONTS:
    COMMANDS[_name] = _font
COMMANDS["operatorname"] = _operatorname


def _not(parser: Parser, name: str, depth: int) -> Node:
    parser.enter(depth + 1)
    tok = parser.peek()
    if tok not in _NOT:
        raise LatexError("`\\not` must come before a relation such as `=`")
    parser.take()
    return mo(_NOT[tok], "rel")


COMMANDS["not"] = _not
COMMANDS["colon"] = lambda parser, name, depth: mo(":", "punct", lspace="0em", rspace="0.2778em")
for _name, _char in _BIGOPS.items():
    COMMANDS[_name] = lambda parser, name, depth: bigop_node(_BIGOPS[name], True)
for _name, _char in _INTEGRALS.items():
    COMMANDS[_name] = lambda parser, name, depth: bigop_node(_INTEGRALS[name], False)
for _name in _FUNCTIONS:
    COMMANDS[_name] = lambda parser, name, depth: Node("mi", _bold(name) if parser.bold else name, kind="func")
for _name in _LIMFUNCS:
    COMMANDS[_name] = lambda parser, name, depth: mo(
        _bold(_LIMFUNCS[name]) if parser.bold else _LIMFUNCS[name], "limfunc", movablelimits="true", **_ZERO
    )


def _unpack(base: Node, sub: Node | None, sup: Node | None) -> tuple[Node, Node | None, Node | None]:
    """A scripted atom \\bm handed back takes the new scripts as its own; a clash nests, as in MathJax."""
    limits = base.kind in ("bigop", "limfunc")      # stacks and accents keep their own under/over
    lower = {"msub", "msubsup"} | ({"munder", "munderover"} if limits else set())
    upper = {"msup", "msubsup"} | ({"mover", "munderover"} if limits else set())
    has_sub, has_sup = base.tag in lower, base.tag in upper
    if not has_sub and not has_sup:
        return base, sub, sup
    inner, *scripts = base.children
    old_sub = scripts[0] if has_sub else None
    old_sup = scripts[-1] if has_sup else None
    if old_sub is not None and sub is not None:
        return base, sub, sup
    if old_sup is not None and sup is not None:
        if not _prime(old_sup) or _prime(sup):
            return base, sub, sup
        sup = Node("mrow", children=[old_sup, *(sup.children if sup.tag == "mrow" and not sup.attrs else [sup])])
        old_sup = None                                # bm's x' takes a following ^, as x'^2
    return inner, sub if old_sub is None else old_sub, sup if old_sup is None else old_sup


def _prime(node: Node) -> bool:
    """Primes typed as apostrophes; `^\\prime` carries spacing attributes."""
    return node.tag == "mo" and not node.attrs and bool(node.text) and set(node.text) <= set("′″‴⁗")


def attach_scripts(base: Node | None, sub: Node | None, sup: Node | None) -> Node:
    """Scripts on a base; an operator with movable or forced limits takes them under and over."""
    kind = base.kind if base is not None else "ord"
    if base is not None and not base.group:
        base, sub, sup = _unpack(base, sub, sup)       # \bm{x_i}^2: both on the letter, as bm unpacks
    base = base if base is not None else Node("mrow")
    op = _operator(base)
    limits = op is not None and "movablelimits" in op.attrs
    style = _inner_style(base) if limits and op is not base else None
    if style is not None and op.attrs["movablelimits"] == "true":
        limits = style == "true"                  # TeX sets them in the operator's own style
        if limits:
            op.attrs["movablelimits"] = "false"
    both, over, under = ("munderover", "mover", "munder") if limits else ("msubsup", "msup", "msub")
    if sub is not None and sup is not None:
        return Node(both, children=[base, sub, sup], kind=kind)
    if sup is not None:
        return Node(over, children=[base, sup], kind=kind)
    assert sub is not None
    return Node(under, children=[base, sub], kind=kind)


def _check_end(tok: str | None, until: str | None) -> None:
    """The token that ended a sequence must be the one its group waits for."""
    if tok == until:
        return
    if until == "\\right":
        raise LatexError("missing `\\right`")
    if tok == "\\right":
        raise LatexError("missing `\\left`")
    if until == "}":
        raise LatexError("missing `}`")
    if until == "]":
        raise LatexError("missing `]`")
    raise LatexError("unexpected `}`")


def _fold_styles(nodes: list[Node], styles: list[tuple[int, str]]) -> list[Node]:
    """`\\displaystyle` and `\\textstyle` each wrap what follows them, up to the next one."""
    if not styles:
        return nodes
    out = nodes[:styles[0][0]]
    for i, (start, value) in enumerate(styles):
        end = styles[i + 1][0] if i + 1 < len(styles) else len(nodes)
        if start < end:
            segment = nodes[start:end]
            for j, node in ((0, segment[0]), (len(segment) - 1, segment[-1])):
                inside = start + j not in (0, len(nodes) - 1)
                core = _core(node)
                if inside and core.tag == "mo" and node.kind in ("bin", "rel"):
                    core.attrs["form"] = "infix"      # the wrapper would make it a prefix or postfix
            out.append(Node("mstyle", children=segment, attrs={"displaystyle": value}))
    return out


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
    if c in _TYPED_BIGOPS:
        return bigop_node(c, _TYPED_BIGOPS[c])
    if unicodedata.category(c)[0] == "M":    # NFC already joined what it could
        raise LatexError(f"unsupported combining mark U+{ord(c):04X}; use an accent such as `\\hat{{x}}`")
    if unicodedata.category(c)[0] == "C":
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
    nodes = Parser(text, display).parse_seq(0)
    body = "".join(n.xml() for n in nodes) if nodes else "<mrow/>"
    head = '<math display="block">' if display else "<math>"
    return (
        f"{head}<semantics><mrow>{body}</mrow>"
        f'<annotation encoding="application/x-tex">{html.escape(src, quote=True)}</annotation>'
        "</semantics></math>"
    )
