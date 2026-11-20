import html
import random
import unicodedata
import xml.etree.ElementTree as ET

import re

import pytest

from mathion.latex_mathml import LatexError, Node, latex_to_mathml

UNARY_MINUS = '<mo lspace="0em" rspace="0em">−</mo>'
TIGHT = ' lspace="0em" rspace="0em"'

CASES = [
    ("x", "<mi>x</mi>"),
    ("12.5", "<mn>12.5</mn>"),
    ("a-b", "<mi>a</mi><mo>−</mo><mi>b</mi>"),
    ("-2", '<mo lspace="0em" rspace="0em">−</mo><mn>2</mn>'),
    ("(x)", '<mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'),
    ("|x|", '<mo stretchy="false" lspace="0em" rspace="0em">|</mo><mi>x</mi><mo stretchy="false" lspace="0em" rspace="0em">|</mo>'),
    ("x^10", "<msup><mi>x</mi><mn>1</mn></msup><mn>0</mn>"),
    ("x_i^2", "<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>"),
    ("{}^{14}C", "<msup><mrow/><mn>14</mn></msup><mi>C</mi>"),
    ("f'", "<msup><mi>f</mi><mo>′</mo></msup>"),
    ("f''", "<msup><mi>f</mi><mo>″</mo></msup>"),
    (r"\Gamma", '<mi mathvariant="normal">Γ</mi>'),
    (r"\epsilon", "<mi>ϵ</mi>"), (r"\varepsilon", "<mi>ε</mi>"),
    (r"\phi", "<mi>ϕ</mi>"), (r"\varphi", "<mi>φ</mi>"),
    (r"\approx", "<mo>≈</mo>"), (r"\ne", "<mo>≠</mo>"),
    (r"\mid", "<mo>∣</mo>"), (r"\infty", "<mi>∞</mi>"),
    ("μ", "<mi>μ</mi>"), ("≤", "<mo>≤</mo>"),
    (r"\text{ a   b }", "<mtext>\u00a0a\u00a0\u00a0\u00a0b\u00a0</mtext>"),   # every space kept
    (r"a\,b", '<mi>a</mi><mspace width="0.1667em"/><mi>b</mi>'),
    (r"\%", "<mo>%</mo>"), (r"\$", f"<mo{TIGHT}>$</mo>"),
    ("a\nb", "<mi>a</mi><mi>b</mi>"),
    ("x < y", "<mi>x</mi><mo>&lt;</mo><mi>y</mi>"),
    ("f'^2", "<msup><mi>f</mi><mrow><mo>′</mo><mn>2</mn></mrow></msup>"),
    ("x_i'", "<msubsup><mi>x</mi><mi>i</mi><mo>′</mo></msubsup>"),
    ("f'''", "<msup><mi>f</mi><mo>‴</mo></msup>"),
    ("^2x", "<msup><mrow/><mn>2</mn></msup><mi>x</mi>"),
    ("ж", '<mi mathvariant="normal">ж</mi>'),
    ("-t^2/2", UNARY_MINUS + '<msup><mi>t</mi><mn>2</mn></msup><mo lspace="0em" rspace="0em">/</mo><mn>2</mn>'),
    ("0{,}05", '<mn>0</mn><mo lspace="0em" rspace="0em">,</mo><mn>05</mn>'),
    (r"\|", '<mo stretchy="false" lspace="0em" rspace="0em">‖</mo>'),
    (r"x \le y", "<mi>x</mi><mo>≤</mo><mi>y</mi>"),
    ("x = -2", "<mi>x</mi><mo>=</mo>" + UNARY_MINUS + "<mn>2</mn>"),
    # own additions: unary after an opening bracket, a group start, an operator and a spacer
    ("(-x)", '<mo stretchy="false">(</mo>' + UNARY_MINUS + '<mi>x</mi><mo stretchy="false">)</mo>'),
    ("x^{-1}", "<msup><mi>x</mi><mrow>" + UNARY_MINUS + "<mn>1</mn></mrow></msup>"),
    ("x^-1", "<msup><mi>x</mi>" + UNARY_MINUS + "</msup><mn>1</mn>"),
    (r"a \pm -b", '<mi>a</mi><mo>±</mo>' + UNARY_MINUS + '<mi>b</mi>'),
    (r"x =\, -2", '<mi>x</mi><mo>=</mo><mspace width="0.1667em"/>' + UNARY_MINUS + '<mn>2</mn>'),
    (r"\pm 1", '<mo lspace="0em" rspace="0em">±</mo><mn>1</mn>'),
    ("(x)-1", '<mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>−</mo><mn>1</mn>'),
    ("x^2-1", "<msup><mi>x</mi><mn>2</mn></msup><mo>−</mo><mn>1</mn>"),
    # own additions: brackets, Greek, typed letters, escapes, text
    (r"\langle x \rangle", '<mo stretchy="false">⟨</mo><mi>x</mi><mo stretchy="false">⟩</mo>'),
    (r"\lvert x \rvert", '<mo stretchy="false" lspace="0em" rspace="0em">|</mo><mi>x</mi><mo stretchy="false" lspace="0em" rspace="0em">|</mo>'),
    (r"\{x\}", '<mo stretchy="false">{</mo><mi>x</mi><mo stretchy="false">}</mo>'),
    (r"\Omega\omega", '<mi mathvariant="normal">Ω</mi><mi>ω</mi>'),
    ("Γ", '<mi mathvariant="normal">Γ</mi>'),
    ("é", "<mi>é</mi>"),
    (r"\& \# \_", f"<mo>&amp;</mo><mo{TIGHT}>#</mo><mo>_</mo>"),
    (r"\text{a\$b \{c\}}", "<mtext>a$b\u00a0{c}</mtext>"),
    (r"\mbox{if}", "<mtext>if</mtext>"),
    (r"\text 12", "<mtext>1</mtext><mn>2</mn>"),
    (r"n!-1", "<mi>n</mi><mo>!</mo><mo>−</mo><mn>1</mn>"),
    (r"\quad\qquad\!\ ~", '<mspace width="1em"/><mspace width="2em"/><mspace width="-0.1667em"/><mspace width="0.3333em"/><mspace width="0.3333em"/>'),
    ("{x}", "<mi>x</mi>"),
    ("{xy}", "<mrow><mi>x</mi><mi>y</mi></mrow>"),
    ("{}", "<mrow/>"),
    ("x^{ab}", "<msup><mi>x</mi><mrow><mi>a</mi><mi>b</mi></mrow></msup>"),
    (r"x^\alpha_2", "<msubsup><mi>x</mi><mn>2</mn><mi>α</mi></msubsup>"),
    ("f'_i", "<msubsup><mi>f</mi><mi>i</mi><mo>′</mo></msubsup>"),
    ("f'^{ab}", "<msup><mi>f</mi><mrow><mo>′</mo><mi>a</mi><mi>b</mi></mrow></msup>"),
    # review round 1: typed symbols behave like their commands
    ("30° - 5°", "<mn>30</mn><mo>°</mo><mo>−</mo><mn>5</mn><mo>°</mo>"),
    ("∞-1", "<mi>∞</mi><mo>−</mo><mn>1</mn>"),
    ("1+…+n", f"<mn>1</mn><mo>+</mo><mo{TIGHT}>…</mo><mo>+</mo><mi>n</mi>"),
    (r"x_1, \ldots, x_n", f"<msub><mi>x</mi><mn>1</mn></msub><mo>,</mo><mo{TIGHT}>…</mo><mo>,</mo><msub><mi>x</mi><mi>n</mi></msub>"),
    (r"1 + \cdots + n", f"<mn>1</mn><mo>+</mo><mo{TIGHT}>⋯</mo><mo>+</mo><mi>n</mi>"),
    (r"\partial\nabla", '<mi mathvariant="normal">∂</mi><mi mathvariant="normal">∇</mi>'),
    ("∂", '<mi mathvariant="normal">∂</mi>'),
    ("ℓ", "<mi>ℓ</mi>"),
    ("X ⊥ Y", "<mi>X</mi><mo>⊥</mo><mi>Y</mi>"),
    ("ά", "<mi>ά</mi>"), ("µ", "<mi>μ</mi>"),
    ("e\u0301", "<mi>é</mi>"),                        # decomposed input is recombined
    ("x\u200by", "<mi>x</mi><mi>y</mi>"),             # invisible format characters are dropped
    (r"\$5", f"<mo{TIGHT}>$</mo><mn>5</mn>"),
    (r"\#1", f"<mo{TIGHT}>#</mo><mn>1</mn>"),
    (".5", f"<mo{TIGHT}>.</mo><mn>5</mn>"),
    ("a*b", "<mi>a</mi><mo>∗</mo><mi>b</mi>"),
    ("--x", UNARY_MINUS + "<mo>−</mo><mi>x</mi>"),
    ("a\\\nb", '<mi>a</mi><mspace width="0.3333em"/><mi>b</mi>'),
    # review round 2: typed math symbols without a command; joiners kept in text
    ("x ≲ -1", "<mi>x</mi><mo>≲</mo>" + UNARY_MINUS + "<mn>1</mn>"),
    ("x_{a⊕b}", f"<msub><mi>x</mi><mrow><mi>a</mi><mo{TIGHT}>⊕</mo><mi>b</mi></mrow></msub>"),
    (r"\text{a\quad b}", "<mtext>a\u2003b</mtext>"),
    ("\\text{a\u200cb}", "<mtext>a\u200cb</mtext>"),
    ("x\u200dy", "<mi>x</mi><mi>y</mi>"),
    ("ϐ", "<mi>ϐ</mi>"), ("ϲ", "<mi>ϲ</mi>"), ("ϳ", "<mi>ϳ</mi>"),
    ("5€", f"<mn>5</mn><mo{TIGHT}>€</mo>"),
    # review round 3: joiners in math, typed brackets, pasted typography
    ("x\u200d^2", "<msup><mi>x</mi><mn>2</mn></msup>"),
    ("⟨-x⟩", '<mo stretchy="false">⟨</mo>' + UNARY_MINUS + '<mi>x</mi><mo stretchy="false">⟩</mo>'),
    ("⌊x⌋‖v‖", f'<mo stretchy="false">⌊</mo><mi>x</mi><mo stretchy="false">⌋</mo><mo stretchy="false"{TIGHT}>‖</mo><mi>v</mi><mo stretchy="false"{TIGHT}>‖</mo>'),
    ("a – b", "<mi>a</mi><mo>−</mo><mi>b</mi>"),       # en dash pasted from Word
    ("f’(x)", '<msup><mi>f</mi><mo>′</mo></msup><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'),
    ("a⊕b", "<mi>a</mi><mo>⊕</mo><mi>b</mi>"),
    (r"\dots", f"<mo{TIGHT}>…</mo>"),
    # review round 1: operators inside scripts are tight, as in LaTeX (owner)
    (r"\chi^2_{n-1}", f"<msubsup><mi>χ</mi><mrow><mi>n</mi><mo{TIGHT}>−</mo><mn>1</mn></mrow><mn>2</mn></msubsup>"),
    ("x_{i=1}", f"<msub><mi>x</mi><mrow><mi>i</mi><mo{TIGHT}>=</mo><mn>1</mn></mrow></msub>"),
    (r"t_{n-1,\alpha/2}", f"<msub><mi>t</mi><mrow><mi>n</mi><mo{TIGHT}>−</mo><mn>1</mn><mo{TIGHT}>,</mo><mi>α</mi><mo{TIGHT}>/</mo><mn>2</mn></mrow></msub>"),
    ("e^{x_{i+1}}", f"<msup><mi>e</mi><msub><mi>x</mi><mrow><mi>i</mi><mo{TIGHT}>+</mo><mn>1</mn></mrow></msub></msup>"),
    ("x^{a(b)}", '<msup><mi>x</mi><mrow><mi>a</mi><mo stretchy="false">(</mo><mi>b</mi><mo stretchy="false">)</mo></mrow></msup>'),
    # review round 1: \text content
    (r"\text{a{b}c}", "<mtext>abc</mtext>"),
    (r"\text{5\,kg \quad x\!y}", "<mtext>5\u2009kg\u00a0\u2003xy</mtext>"),
]


def _body(out: str) -> str:                       # the whole content of the top <mrow>
    return out.split("<semantics><mrow>", 1)[1].rsplit('</mrow><annotation encoding="application/x-tex">', 1)[0]


@pytest.mark.parametrize("src,inner", CASES)
def test_core_cases(src, inner):
    out = latex_to_mathml(src, display=False)
    assert out.startswith("<math><semantics><mrow>")
    assert _body(out) == inner
    assert f'<annotation encoding="application/x-tex">{html.escape(src)}</annotation>' in out


@pytest.mark.parametrize("src,reason", [
    (r"\foo", r"unknown command `\foo`"),
    (r"\begin{cases}", r"`\begin{cases}` is not supported yet"),
    (r"a\\b", "line breaks are not supported yet"),
    ("{x", "missing `}`"), ("x}", "unexpected `}`"),
    ("x^2^3", "double superscript"),
    ("", "empty formula"), ("  ", "empty formula"),
    ("a & b", r"write `\&` for a literal `&`"),
    ("x" * 2001, "formula too long"),
    ("x_1_2", "double subscript"),
    (r"\sum'\limits'", "double superscript"),       # \\limits ends the primes
    ("a # b", r"write `\#` for a literal `#`"),
    ("a % b", r"write `\%` for a literal `%`"),
    ("{" * 41 + "x" + "}" * 41, "formula nested too deeply"),
    ("x^{" * 41 + "x" + "}" * 41, "formula nested too deeply"),
    ("x^y^z", "double superscript"),
    # own additions
    ("x^", "`^` needs 1 argument"), ("x_}", "`_` needs 1 argument"),
    ("f'^2'", "double superscript"),
    (r"\text{ab", "missing `}`"),
    (r"\text{\alpha}", r"unknown command `\alpha`"),
    ("x\\", r"unknown command `\`"),
    ("a\x01b", "unsupported character U+0001"),
    (r"\-x", r"unknown command `\-`"),
    ("{" * 40 + "x'" + "}" * 40, "formula nested too deeply"),
    (r"\text" + "{" * 41 + "x" + "}" * 41, "formula nested too deeply"),
    (r"\mbox", r"`\mbox` needs 1 argument"),
    (r"\text^", r"`\text` needs 1 argument"),
    (r"\text&", r"write `\&` for a literal `&`"),
    (r"\text{a\\b}", "line breaks are not supported yet"),
    ("\\text{\x01}", "unsupported character U+0001"),
    (r"\begin", r"`\begin` is not supported yet"),
    ("\u200b", "empty formula"), ("\u200d", "empty formula"),
    ("x\u0302", r"unsupported combining mark U+0302; use an accent such as `\hat{x}`"),
    ("a\x1cb", "unsupported character U+001C"),           # Python counts it as whitespace
    ("a\vb", "unsupported character U+000B"),
    ("x\fy", "unsupported character U+000C"),            # invalid in XML
    ("\\text{a\x1cb}", "unsupported character U+001C"),
    (r"\text}", r"`\text` needs 1 argument"),
    # Task 3: structures
    (r"\frac{a}", r"`\frac` needs 2 arguments"),
    (r"\left(x", r"missing `\right`"),
    (r"x\right)", r"missing `\left`"),
    (r"\sqrt" * 41 + " x", "formula nested too deeply"),
    (r"\left(" * 41 + "x" + r"\right)" * 41, "formula nested too deeply"),
    (r"\left x\right)", r"`\left` needs a bracket"),
    (r"\left(x\right", r"`\right` needs a bracket"),
    (r"\left(x\right\alpha", r"`\right` needs a bracket"),
    (r"a\middle|b", r"missing `\left`"),
    (r"{\left(a}\right)", r"missing `\right`"),
    (r"\left({a\right)}", r"missing `\left`"),
    (r"{a \over b \over c}", r"two `\over` in one group; add braces"),
    (r"{a \over b \choose c}", r"two `\over` in one group; add braces"),
    (r"x\limits", r"`\limits` must follow an operator"),
    (r"\sin\nolimits", r"`\nolimits` must follow an operator"),
    (r"\sqrt[3{x}", "missing `]`"),
    (r"\sqrt[3]", r"`\sqrt` needs 1 argument"),
    (r"\frac\over b", r"misplaced `\over`"),
    (r"x^\displaystyle", r"misplaced `\displaystyle`"),
    (r"\overset{a}", r"`\overset` needs 2 arguments"),
    (r"\bar", r"`\bar` needs 1 argument"),
    (r"\big x", r"`\big` needs a bracket"),
    (r"\mathbf", r"`\mathbf` needs 1 argument"),
    (r"\operatorname*{x^2}", r"`\operatorname*` takes letters only"),
    (r"\operatorname", r"`\operatorname` needs 1 argument"),
    (r"\operatorname*{\infty}", r"`\operatorname*` takes letters only"),
    (r"{\sum}\limits_i", r"`\limits` must follow an operator"),
    ("{" * 40 + r"\big(" + "}" * 40, "formula nested too deeply"),
    (r"\not x", r"`\not` must come before a relation such as `=`"),
    (r"\not", r"`\not` must come before a relation such as `=`"),
    ("{" * 40 + r"\not=" + "}" * 40, "formula nested too deeply"),
    ("{" * 39 + r"\left(x\middle|y\right)" + "}" * 39, "formula nested too deeply"),
])
def test_errors(src, reason):
    with pytest.raises(LatexError) as e:
        latex_to_mathml(src, display=False)
    assert e.value.reason == reason
    assert str(e.value) == reason


def test_limits_are_inclusive():
    latex_to_mathml("x" * 2000, display=False)
    latex_to_mathml("{" * 40 + "x" + "}" * 40, display=False)   # depth 40 is allowed
    latex_to_mathml("x^{" * 40 + "x" + "}" * 40, display=False)
    latex_to_mathml("{" * 39 + "x'" + "}" * 39, display=False)
    latex_to_mathml(r"\text" + "{" * 40 + "x" + "}" * 40, display=False)
    latex_to_mathml(r"\sqrt" * 40 + " x", display=False)
    latex_to_mathml(r"\left(" * 40 + "x" + r"\right)" * 40, display=False)
    latex_to_mathml("{" * 39 + r"\big(" + "}" * 39, display=False)
    latex_to_mathml("{" * 39 + r"\not=" + "}" * 39, display=False)
    latex_to_mathml("{" * 38 + r"\left(x\middle|y\right)" + "}" * 38, display=False)


SYMBOLS = (   # the spec's Symbols and Greek-variant rows: name, character, element
    "approx ≈ mo|neq ≠ mo|ne ≠ mo|leq ≤ mo|le ≤ mo|geq ≥ mo|ge ≥ mo|ll ≪ mo|gg ≫ mo|lt &lt; mo|gt &gt; mo|"
    "pm ± mo|mp ∓ mo|times × mo|cdot ⋅ mo|div ÷ mo|ast ∗ mo|star ⋆ mo|infty ∞ mi|sim ∼ mo|simeq ≃ mo|"
    "cong ≅ mo|equiv ≡ mo|propto ∝ mo|in ∈ mo|notin ∉ mo|ni ∋ mo|subset ⊂ mo|subseteq ⊆ mo|supset ⊃ mo|"
    "supseteq ⊇ mo|cup ∪ mo|cap ∩ mo|setminus ∖ mo|emptyset ∅ mi|varnothing ∅ mi|forall ∀ mo|exists ∃ mo|"
    "neg ¬ mo|lnot ¬ mo|land ∧ mo|lor ∨ mo|wedge ∧ mo|vee ∨ mo|to → mo|rightarrow → mo|leftarrow ← mo|"
    "Rightarrow ⇒ mo|Leftarrow ⇐ mo|Leftrightarrow ⇔ mo|iff ⟺ mo|implies ⟹ mo|mapsto ↦ mo|mid ∣ mo|"
    "parallel ∥ mo|perp ⊥ mo|top ⊤ mi|bot ⊥ mi|ell ℓ mi|hbar ℏ mi|vdots ⋮ mo|ddots ⋱ mo|prime ′ mo|"
    "circ ∘ mo|degree ° mo|bullet ∙ mo|vartheta ϑ mi|varrho ϱ mi|varsigma ς mi|varpi ϖ mi"
)


@pytest.mark.parametrize("name,char,tag", [entry.split() for entry in SYMBOLS.split("|")])
def test_symbol_table(name, char, tag):
    body = _body(latex_to_mathml("\\" + name, display=False))
    assert body.startswith(f"<{tag}") and body.endswith(f">{char}</{tag}>")


@pytest.mark.parametrize("src,inner", [
    (r"\lfloor x \rfloor", '<mo stretchy="false">⌊</mo><mi>x</mi><mo stretchy="false">⌋</mo>'),
    (r"\lceil x \rceil", '<mo stretchy="false">⌈</mo><mi>x</mi><mo stretchy="false">⌉</mo>'),
    (r"\vert x \Vert", f'<mo stretchy="false"{TIGHT}>|</mo><mi>x</mi><mo stretchy="false"{TIGHT}>‖</mo>'),
    (r"a\:b\;c", '<mi>a</mi><mspace width="0.2222em"/><mi>b</mi><mspace width="0.2778em"/><mi>c</mi>'),
])
def test_more_brackets_and_spaces(src, inner):
    assert _body(latex_to_mathml(src, display=False)) == inner


def test_unknown_attribute_is_a_bug_not_dropped():
    with pytest.raises(AssertionError):
        Node("mo", "x", attrs={"bogus": "1"}).xml()


def test_display_flag():
    assert latex_to_mathml("x", display=True).startswith('<math display="block">')


def test_source_is_escaped_in_annotation():
    out = latex_to_mathml(r"\text{</annotation><script>}", display=False)
    assert "<script>" not in out
    assert "<mtext>&lt;/annotation&gt;&lt;script&gt;</mtext>" in out


# --- Task 3: structures -----------------------------------------------------------

SUM = '<mo largeop="true" movablelimits="true" lspace="0em" rspace="0em">∑</mo>'   # TeX's spaces sit beside it
STILL_SUM = SUM.replace(' movablelimits="true"', "")   # an argument's limits never move
INT = '<mo largeop="true" lspace="0em" rspace="0em">∫</mo>'
FN = '<mo>⁡</mo>'                  # FUNCTION APPLICATION
THIN = '<mspace width="0.1667em"/>'
def medium(c: str) -> str:
    """A \\left bracket around slightly tall content: the \\big size, as LaTeX picks."""
    bar = TIGHT if c in "|‖/" else ""
    return f'<mo stretchy="true" fence="true"{bar} minsize="1.2em" maxsize="1.2em">{c}</mo>'
MSTRUT = '<mspace height="0.85em" depth="0.35em"/>'   # centres a \\big-size bracket in Safari
def fence(c: str, grow: bool = True) -> str:
    """A \\left/\\right bracket: it grows only around tall content; bars have zero spacing."""
    bar = TIGHT if c in "|‖/" else ""
    return f'<mo stretchy="{str(grow).lower()}" fence="true"{bar}>{c}</mo>'
def acc(base: str, char: str, narrow: bool = True) -> str:
    cls = ' class="math-acc"' if narrow else ""
    return f'<mover accent="true">{base}<mo{cls} stretchy="false">{char}</mo></mover>'

STRUCT = [  # each expected string is the whole body inside the top <mrow>
    (r"\frac12", "<mfrac><mn>1</mn><mn>2</mn></mfrac>"),
    (r"{a \over b}", "<mfrac><mi>a</mi><mi>b</mi></mfrac>"),
    (r"\dfrac{a}{b}", '<mstyle displaystyle="true" scriptlevel="0"><mfrac><mi>a</mi><mi>b</mi></mfrac></mstyle>'),
    (r"\tfrac{a}{b}", '<mstyle displaystyle="false" scriptlevel="0"><mfrac><mi>a</mi><mi>b</mi></mfrac></mstyle>'),
    (r"\binom{n}{k}", '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>'),
    (r"{n \choose k}", '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>'),
    (r"\sqrt[3]{x}", "<mroot><mi>x</mi><mn>3</mn></mroot>"),
    (r"\sqrt\frac12", "<msqrt><mfrac><mn>1</mn><mn>2</mn></mfrac></msqrt>"),
    # under/over limits are scripts, so the = is tight (owner, rev 7)
    (r"\sum_{i=1}^n", f'<munderover>{SUM}<mrow><mi>i</mi><mo{TIGHT}>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>'),
    (r"\sum\nolimits_i", '<msub><mo largeop="true" lspace="0em" rspace="0em">∑</mo><mi>i</mi></msub>'),
    (r"\int_0^1", '<msubsup><mo largeop="true" lspace="0em" rspace="0em">∫</mo><mn>0</mn><mn>1</mn></msubsup>'),
    (r"\int\limits_0^1", '<munderover><mo largeop="true" movablelimits="false" lspace="0em" rspace="0em">∫</mo><mn>0</mn><mn>1</mn></munderover>'),
    (r"\log_2 n", f'<msub><mi>log</mi><mn>2</mn></msub>{FN}{THIN}<mi>n</mi>'),
    (r"\sin(x)", f'<mi>sin</mi>{FN}<mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'),
    (r"\sin=", f'<mi>sin</mi>{FN}<mo>=</mo>'),
    (r"\max(a,b)", f'<mo movablelimits="true"{TIGHT}>max</mo><mo stretchy="false">(</mo><mi>a</mi><mo>,</mo><mi>b</mi><mo stretchy="false">)</mo>'),
    (r"\lim_{n\to\infty}", f'<munder><mo movablelimits="true"{TIGHT}>lim</mo><mrow><mi>n</mi><mo{TIGHT}>→</mo><mi>∞</mi></mrow></munder>'),
    (r"\operatorname{Var}(X)", f'<mi>Var</mi>{FN}<mo stretchy="false">(</mo><mi>X</mi><mo stretchy="false">)</mo>'),
    (r"\bar{x}", acc("<mi>x</mi>", "¯")),
    (r"\hat{X}", acc("<mi>X</mi>", "ˆ")),
    (r"\tilde{x}", acc("<mi>x</mi>", "˜")),
    (r"\dot{x}", acc("<mi>x</mi>", "˙")),
    (r"\ddot{x}", acc("<mi>x</mi>", "¨")),
    # a smaller arrow with no relation spacing, so Safari does not widen v⃗
    (r"\vec{v}", '<mover accent="true"><mi>v</mi><mo class="math-vec" stretchy="false" lspace="0em" rspace="0em">→</mo></mover>'),
    (r"\widehat{xy}", '<mover accent="true"><mrow><mi>x</mi><mi>y</mi></mrow><mo stretchy="true">̂</mo></mover>'),
    (r"\widetilde{xy}", '<mover accent="true"><mrow><mi>x</mi><mi>y</mi></mrow><mo stretchy="true">˜</mo></mover>'),
    (r"\overline{xy}", '<mrow class="math-overline"><mi>x</mi><mi>y</mi></mrow>'),
    (r"\underline{x}", '<mrow class="math-underline"><mi>x</mi></mrow>'),
    (r"\overset{iid}{\sim}", '<mover><mo stretchy="false" form="infix">∼</mo><mrow><mi>i</mi><mi>i</mi><mi>d</mi></mrow></mover>'),   # infix: Chrome drops ∼'s spacing
    (r"\left(\frac{a}{b}\right)", f'<mrow>{fence("(")}<mfrac><mi>a</mi><mi>b</mi></mfrac>{fence(")")}</mrow>'),
    (r"\left.x\right|", f'<mrow><mi>x</mi>{fence("|", False)}</mrow>'),
    (r"\left(a\middle|b\right)", f'<mrow>{fence("(", False)}<mi>a</mi>{fence("|", False)}<mi>b</mi>{fence(")", False)}</mrow>'),
    (r"\big(", '<mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow>'),
    (r"\mathbb{R}", "<mi>ℝ</mi>"), (r"\mathcal{L}", "<mi>ℒ</mi>"),
    (r"\mathbb{R}^2", "<msup><mi>ℝ</mi><mn>2</mn></msup>"),
    (r"\mathrm{d}", '<mi mathvariant="normal">d</mi>'),
    (r"\mathrm{Var}", "<mi>Var</mi>"),
    (r"\boldsymbol{\beta}", "<mi>\U0001d737</mi>"),
    (r"\boldsymbol{\Gamma}", "<mi>\U0001d6aa</mi>"),
    (r"\mathbf{x}", "<mi>\U0001d431</mi>"),
    (r"\mathbf{\alpha}", "<mi>α</mi>"),
    (r"x\displaystyle\sum", f'<mi>x</mi><mstyle displaystyle="true" scriptlevel="0">{THIN}{SUM}</mstyle>'),
    (r"{\textstyle\sum} x", f'<mstyle displaystyle="false" scriptlevel="0">{SUM}</mstyle><mi>x</mi>'),
    # own additions
    (r"\sqrt{x+1}", "<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt>"),
    (r"\sqrt[n+1]{x}", f"<mroot><mi>x</mi><mrow><mi>n</mi><mo{TIGHT}>+</mo><mn>1</mn></mrow></mroot>"),
    (r"\sqrt[{a]}]{x}", "<mroot><mi>x</mi><mrow><mi>a</mi><mo stretchy=\"false\">]</mo></mrow></mroot>"),
    (r"\stackrel{d}{=} -x", f'<mover><mo stretchy="false" form="infix">=</mo><mi>d</mi></mover>{UNARY_MINUS}<mi>x</mi>'),
    (r"\underset{a}{b}", "<munder><mi>b</mi><mi>a</mi></munder>"),
    (r"\underset{x}{+}", f"<munder><mo stretchy=\"false\"{TIGHT}>+</mo><mi>x</mi></munder>"),          # a lone + is unary
    (r"a \overset{!}{\cdot} b", f'<mi>a</mi><mover><mo stretchy="false" form="infix">⋅</mo><mo{TIGHT}>!</mo></mover><mi>b</mi>'),
    # a thin space also comes before a function after an ordinary atom, as in TeX
    (r"\frac12\exp x", f"<mfrac><mn>1</mn><mn>2</mn></mfrac>{THIN}<mi>exp</mi>{FN}{THIN}<mi>x</mi>"),
    (r"x\sin y", f"<mi>x</mi>{THIN}<mi>sin</mi>{FN}{THIN}<mi>y</mi>"),
    (r"(a)\log b", f'<mo stretchy="false">(</mo><mi>a</mi><mo stretchy="false">)</mo>{THIN}<mi>log</mi>{FN}{THIN}<mi>b</mi>'),
    (r"2\max_i a", f'<mn>2</mn>{THIN}<munder><mo movablelimits="true"{TIGHT}>max</mo><mi>i</mi></munder>{THIN}<mi>a</mi>'),
    (r"\sum\sin x", f'{SUM}{THIN}<mi>sin</mi>{FN}{THIN}<mi>x</mi>'),
    (r"\left(a\right)\sin x", f'<mrow>{fence("(", False)}<mi>a</mi>{fence(")", False)}</mrow>{THIN}<mi>sin</mi>{FN}{THIN}<mi>x</mi>'),
    (r"a=\sin x", f"<mi>a</mi><mo>=</mo><mi>sin</mi>{FN}{THIN}<mi>x</mi>"),
    (r"-\sin x", f"{UNARY_MINUS}{THIN}<mi>sin</mi>{FN}{THIN}<mi>x</mi>"),   # TeX's Ord-Op space
    (r"(\sin x)", f'<mo stretchy="false">(</mo><mi>sin</mi>{FN}{THIN}<mi>x</mi><mo stretchy="false">)</mo>'),
    (r"\overset{a+b}{c} - d", f"<mover><mi>c</mi><mrow><mi>a</mi><mo{TIGHT}>+</mo><mi>b</mi></mrow></mover><mo>−</mo><mi>d</mi>"),   # amsmath: an ordinary atom, so the minus is binary
    (r"\frac{a}{b} - c", "<mfrac><mi>a</mi><mi>b</mi></mfrac><mo>−</mo><mi>c</mi>"),
    (r"\sin x", f"<mi>sin</mi>{FN}{THIN}<mi>x</mi>"),
    (r"\sin -x", f"<mi>sin</mi>{FN}{THIN}{UNARY_MINUS}<mi>x</mi>"),
    (r"\sin^2 x", f"<msup><mi>sin</mi><mn>2</mn></msup>{FN}{THIN}<mi>x</mi>"),
    (r"\sin\,x", f"<mi>sin</mi>{FN}{THIN}{THIN}<mi>x</mi>"),
    (r"\sin\cos x", f"<mi>sin</mi>{FN}{THIN}<mi>cos</mi>{FN}{THIN}<mi>x</mi>"),
    (r"\log|x|", f'<mi>log</mi>{FN}{THIN}<mo stretchy="false"{TIGHT}>|</mo><mi>x</mi><mo stretchy="false"{TIGHT}>|</mo>'),
    (r"\exp\left(x\right)", f'<mi>exp</mi>{FN}<mrow>{fence("(", False)}<mi>x</mi>{fence(")", False)}</mrow>'),
    (r"\sin, x", f"<mi>sin</mi>{FN}<mo>,</mo><mi>x</mi>"),
    (r"\sin\bigl(x\bigr)", f'<mi>sin</mi>{FN}<mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow><mi>x</mi><mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">)</mo></mrow>'),
    (r"{\sin} x", f"<mrow><mi>sin</mi>{FN}</mrow><mi>x</mi>"),   # an ordinary group: no thin space
    (r"\Pr(A)", '<mo movablelimits="true" lspace="0em" rspace="0em">Pr</mo><mo stretchy="false">(</mo><mi>A</mi><mo stretchy="false">)</mo>'),   # \\mathop as \\lim
    (r"\limsup_{n}", f'<munder><mo movablelimits="true"{TIGHT}>lim sup</mo><mi>n</mi></munder>'),
    (r"\argmax_x f", f'<munder><mo movablelimits="true"{TIGHT}>arg max</mo><mi>x</mi></munder>{THIN}<mi>f</mi>'),
    (r"\max -x", f'<mo movablelimits="true"{TIGHT}>max</mo>{THIN}{UNARY_MINUS}<mi>x</mi>'),
    (r"\operatorname*{arg\,max}_x", f'<munder><mo movablelimits="true"{TIGHT}>arg max</mo><mi>x</mi></munder>'),
    (r"\operatorname{arg\,max} x", f"<mrow><mi>arg</mi>{THIN}<mi>max</mi></mrow>{FN}{THIN}<mi>x</mi>"),
    (r"\sum -x", f'{SUM}{THIN}<mo{TIGHT}>−</mo><mi>x</mi>'),
    (r"\prod_i x_i", f'<munder><mo largeop="true" movablelimits="true"{TIGHT}>∏</mo><mi>i</mi></munder>{THIN}<msub><mi>x</mi><mi>i</mi></msub>'),
    (r"\coprod\bigcup\bigcap", f'<mo largeop="true" movablelimits="true"{TIGHT}>∐</mo>{THIN}<mo largeop="true" movablelimits="true"{TIGHT}>⋃</mo>{THIN}<mo largeop="true" movablelimits="true"{TIGHT}>⋂</mo>'),
    (r"\iint\iiint\oint", f'<mo largeop="true"{TIGHT}>∬</mo>{THIN}<mo largeop="true"{TIGHT}>∭</mo>{THIN}<mo largeop="true"{TIGHT}>∮</mo>'),
    ("∑_i ∫_0^1", f'<munder>{SUM}<mi>i</mi></munder>{THIN}<msubsup>{INT}<mn>0</mn><mn>1</mn></msubsup>'),
    (r"\sum\limits_i", '<munder><mo largeop="true" movablelimits="false" lspace="0em" rspace="0em">∑</mo><mi>i</mi></munder>'),
    (r"\int\limits\nolimits_0", '<msub><mo largeop="true" lspace="0em" rspace="0em">∫</mo><mn>0</mn></msub>'),
    (r"\lim\limits_{x}", f'<munder><mo movablelimits="false"{TIGHT}>lim</mo><mi>x</mi></munder>'),
    (r"\left[x\right)", f'<mrow>{fence("[", False)}<mi>x</mi>{fence(")", False)}</mrow>'),
    (r"\left\{x\right.", f'<mrow>{fence("{", False)}<mi>x</mi></mrow>'),
    (r"\left\langle x\right\rangle", f'<mrow>{fence("⟨", False)}<mi>x</mi>{fence("⟩", False)}</mrow>'),
    (r"\left<x\right>", f'<mrow>{fence("⟨", False)}<mi>x</mi>{fence("⟩", False)}</mrow>'),
    (r"\left\lfloor x\right\rceil", f'<mrow>{fence("⌊", False)}<mi>x</mi>{fence("⌉", False)}</mrow>'),
    (r"\left\| x\right\Vert", f'<mrow>{fence("‖", False)}<mi>x</mi>{fence("‖", False)}</mrow>'),
    (r"\left.\right.", "<mrow/>"),
    (r"\left(-x\right)-y", f'<mrow>{fence("(", False)}{UNARY_MINUS}<mi>x</mi>{fence(")", False)}</mrow><mo>−</mo><mi>y</mi>'),
    (r"\left(x\right)^2", f'<msup><mrow>{fence("(", False)}<mi>x</mi>{fence(")", False)}</mrow><mn>2</mn></msup>'),
    (r"\left(a \over b\right)", f'<mrow>{fence("(")}<mfrac><mi>a</mi><mi>b</mi></mfrac>{fence(")")}</mrow>'),
    # brackets grow only around tall content (Chrome pads every growing bracket)
    (r"\left(\sqrt{x}\right)", f'<mrow>{fence("(")}<msqrt><mi>x</mi></msqrt>{fence(")")}</mrow>'),
    (r"\left(\sum x\right)", f'<mrow><mo stretchy="true" fence="true">(</mo>{SUM}{THIN}<mi>x</mi><mo stretchy="true" fence="true">)</mo></mrow>'),
    (r"\left(\hat{x}^2\right)", f'<mrow>{fence("(", False)}<msup>{acc("<mi>x</mi>", "ˆ")}<mn>2</mn></msup>{fence(")", False)}</mrow>'),
    (r"\left(\big(x\big)\right)", f'<mrow><mo stretchy="true" fence="true" minsize="1.2em">(</mo><mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow><mi>x</mi><mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">)</mo></mrow><mo stretchy="true" fence="true" minsize="1.2em">)</mo></mrow>'),
    (r"\left[\left(\frac ab\right)\right]", f'<mrow>{fence("[")}<mrow>{fence("(")}<mfrac><mi>a</mi><mi>b</mi></mfrac>{fence(")")}</mrow>{fence("]")}</mrow>'),
    (r"\left[\left(x\right)\right]", f'<mrow>{fence("[", False)}<mrow>{fence("(", False)}<mi>x</mi>{fence(")", False)}</mrow>{fence("]", False)}</mrow>'),
    (r"\left(a\middle|\frac bc\right)", f'<mrow>{fence("(")}<mi>a</mi>{fence("|")}<mfrac><mi>b</mi><mi>c</mi></mfrac>{fence(")")}</mrow>'),
    (r"\left(\displaystyle a\middle|b\right)", f'<mrow>{fence("(", False)}<mstyle displaystyle="true" scriptlevel="0"><mi>a</mi>{fence("|", False)}<mi>b</mi></mstyle>{fence(")", False)}</mrow>'),
    (r"\left(\overset{d}{=}\right)", f'<mrow>{medium("(")}{MSTRUT}<mover><mo stretchy="false" form="infix">=</mo><mi>d</mi></mover>{medium(")")}</mrow>'),
    (r"\Big[", '<mrow><mspace height="1.15em" depth="0.65em"/><mo stretchy="true" minsize="1.8em" maxsize="1.8em">[</mo></mrow>'),
    (r"\bigg\{", '<mrow><mspace height="1.45em" depth="0.95em"/><mo stretchy="true" minsize="2.4em" maxsize="2.4em">{</mo></mrow>'),
    (r"\Biggr)", '<mrow><mspace height="1.75em" depth="1.25em"/><mo stretchy="true" minsize="3em" maxsize="3em">)</mo></mrow>'),
    (r"\bigl|", f'<mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true"{TIGHT} minsize="1.2em" maxsize="1.2em">|</mo></mrow>'),
    (r"\bigl( -x", f'<mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow>{UNARY_MINUS}<mi>x</mi>'),
    (r"a\big.b", "<mi>a</mi><mi>b</mi>"),
    (r"a \over b", "<mfrac><mi>a</mi><mi>b</mi></mfrac>"),
    (r"{n+1 \over 2}", "<mfrac><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow><mn>2</mn></mfrac>"),
    (r"{\over b}", "<mfrac><mrow/><mi>b</mi></mfrac>"),
    (r"{a \over -b}", f"<mfrac><mi>a</mi><mrow>{UNARY_MINUS}<mi>b</mi></mrow></mfrac>"),
    (r"a \displaystyle b \textstyle c", '<mi>a</mi><mstyle displaystyle="true" scriptlevel="0"><mi>b</mi></mstyle><mstyle displaystyle="false" scriptlevel="0"><mi>c</mi></mstyle>'),
    (r"\displaystyle -x", f'<mstyle displaystyle="true" scriptlevel="0">{UNARY_MINUS}<mi>x</mi></mstyle>'),
    (r"x\displaystyle", "<mi>x</mi>"),
    (r"\mathbb{N}", "<mi>ℕ</mi>"), (r"\mathbb 1", "<mn>\U0001d7d9</mn>"),
    (r"\mathcal{A}", "<mi>\U0001d49c</mi>"), (r"\mathcal{B}", "<mi>ℬ</mi>"),
    (r"\mathit{h}", "<mi>ℎ</mi>"), (r"\mathit{\Gamma}", "<mi>\U0001d6e4</mi>"),
    (r"\mathsf{x}", "<mi>\U0001d5d1</mi>"), (r"\mathtt{x}", "<mi>\U0001d6a1</mi>"),
    (r"\mathrm{dx}", "<mi>dx</mi>"),
    (r"\mathrm{d}x", '<mi mathvariant="normal">d</mi><mi>x</mi>'),
    (r"\mathrm{x_1}", '<msub><mi mathvariant="normal">x</mi><mn>1</mn></msub>'),
    (r"\mathrm{\alpha}", "<mi>α</mi>"),
    (r"\mathbf{x_i}", "<msub><mi>\U0001d431</mi><mi>\U0001d422</mi></msub>"),
    (r"\mathbf{\mathrm{d}}", '<mi mathvariant="normal">d</mi>'),
    (r"\mathbf{\Gamma}", "<mi>\U0001d6aa</mi>"),
    (r"\mathbf{12}", "<mn>\U0001d7cf\U0001d7d0</mn>"),
    (r"\mathbf{\text{a}}", "<mtext>a</mtext>"),
    (r"\boldsymbol{x}", "<mi>\U0001d499</mi>"),
    (r"\boldsymbol{\partial}", "<mi>\U0001d74f</mi>"),
    (r"\boldsymbol{\nabla}", "<mi>\U0001d6c1</mi>"),
    (r"\boldsymbol{\infty}", "<mi>∞</mi>"),
    (r"\boldsymbol{α}", "<mi>\U0001d736</mi>"),
    (r"\mathbb{R}^n", "<msup><mi>ℝ</mi><mi>n</mi></msup>"),
    # review round 1
    (r"\mathbf{²}", "<mn>²</mn>"), ("\\mathbb{\U0001d7d9}", "<mn>\U0001d7d9</mn>"),      # only 0-9 are restyled
    (r"f\Big|_{x=0}", f'<mi>f</mi><msub><mrow><mspace height="1.15em" depth="0.65em"/><mo stretchy="true"{TIGHT} minsize="1.8em" maxsize="1.8em">|</mo></mrow><mrow><mi>x</mi><mo{TIGHT}>=</mo><mn>0</mn></mrow></msub>'),
    (r"\Bigr)^2", '<msup><mrow><mspace height="1.15em" depth="0.65em"/><mo stretchy="true" minsize="1.8em" maxsize="1.8em">)</mo></mrow><mn>2</mn></msup>'),
    (r"X_n \overset{p}{\to} X", '<msub><mi>X</mi><mi>n</mi></msub><mover><mo stretchy="false" form="infix">→</mo><mi>p</mi></mover><mi>X</mi>'),
    (r"\overset{a}{\sum}", '<mover><mo stretchy="false" largeop="true" movablelimits="false" lspace="0em" rspace="0em">∑</mo><mi>a</mi></mover>'),
    (r"a\overset{n}{+}b", '<mi>a</mi><mover><mo stretchy="false" form="infix">+</mo><mi>n</mi></mover><mi>b</mi>'),
    (r"\overset{n}{-}x", f'<mover><mo stretchy="false"{TIGHT}>−</mo><mi>n</mi></mover><mi>x</mi>'),
    (r"a\stackrel{n}{x}b", '<mi>a</mi><mspace width="0.2778em"/><mover><mi>x</mi><mi>n</mi></mover><mspace width="0.2778em"/><mi>b</mi>'),
    (r"a\stackrel{n}{+}b", '<mi>a</mi><mover><mo stretchy="false" form="infix" lspace="0.2778em" rspace="0.2778em">+</mo><mi>n</mi></mover><mi>b</mi>'),
    (r"{\sum}_i", f'<msub><mo largeop="true"{TIGHT}>∑</mo><mi>i</mi></msub>'),
    (r"\lim\nolimits\limits_x", f'<munder><mo movablelimits="false"{TIGHT}>lim</mo><mi>x</mi></munder>'),
    (r"\left(x^{x^{x}}\right)", f'<mrow>{medium("(")}{MSTRUT}<msup><mi>x</mi><msup><mi>x</mi><mi>x</mi></msup></msup>{medium(")")}</mrow>'),
    (r"\left(x^{x^{x^x}}\right)", f'<mrow>{fence("(")}<msup><mi>x</mi><msup><mi>x</mi><msup><mi>x</mi><mi>x</mi></msup></msup></msup>{fence(")")}</mrow>'),
    (r"\left(x_i^2\right)", f'<mrow>{fence("(", False)}<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>{fence(")", False)}</mrow>'),
    (r"\left(\widehat{XY}\right)", f'<mrow>{medium("(")}{MSTRUT}<mover accent="true"><mrow><mi>X</mi><mi>Y</mi></mrow><mo stretchy="true">\u0302</mo></mover>{medium(")")}</mrow>'),
    (r"\left(\widehat{\frac ab}\right)", f'<mrow>{fence("(")}<mover accent="true"><mfrac><mi>a</mi><mi>b</mi></mfrac><mo stretchy="true">\u0302</mo></mover>{fence(")")}</mrow>'),
    (r"\left|\overset{d}{\to}\right|", f'<mrow>{medium("|")}{MSTRUT}<mover><mo stretchy="false" form="infix">→</mo><mi>d</mi></mover>{medium("|")}</mrow>'),
    (r"\left(\underset{x}{\sum}\right)", f'<mrow>{fence("(")}<munder><mo stretchy="false" largeop="true" movablelimits="false" lspace="0em" rspace="0em">∑</mo><mi>x</mi></munder>{fence(")")}</mrow>'),
    (r"\left(\Big(x\Big)\right)", '<mrow><mo stretchy="true" fence="true" minsize="1.8em">(</mo><mrow><mspace height="1.15em" depth="0.65em"/><mo stretchy="true" minsize="1.8em" maxsize="1.8em">(</mo></mrow><mi>x</mi><mrow><mspace height="1.15em" depth="0.65em"/><mo stretchy="true" minsize="1.8em" maxsize="1.8em">)</mo></mrow><mo stretchy="true" fence="true" minsize="1.8em">)</mo></mrow>'),
    (r"a\displaystyle+b", '<mi>a</mi><mstyle displaystyle="true" scriptlevel="0"><mo form="infix">+</mo><mi>b</mi></mstyle>'),
    (r"\displaystyle a+\textstyle b", '<mstyle displaystyle="true" scriptlevel="0"><mi>a</mi><mo form="infix">+</mo></mstyle><mstyle displaystyle="false" scriptlevel="0"><mi>b</mi></mstyle>'),
    (r"\sin\cdot x", f"<mi>sin</mi>{FN}{THIN}<mo{TIGHT}>⋅</mo><mi>x</mi>"),   # a binary atom with nothing before is ordinary
    (r"\times x", f"<mo{TIGHT}>×</mo><mi>x</mi>"),
    (r"\sin\,(x)", f'<mi>sin</mi>{FN}{THIN}<mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'),
    (r"\big(-x", '<mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow><mo>−</mo><mi>x</mi>'),  # plain \big is ordinary
    (r"\operatorname{\sin}x", f"<mi>sin</mi>{FN}{THIN}<mi>x</mi>"),
    (r"\mathbf{\nabla}", '<mi mathvariant="normal">∇</mi>'), (r"\mathit{\partial}", '<mi mathvariant="normal">∂</mi>'),
    (r"\left\lbrace x\right\rbrace", f'<mrow>{fence("{", False)}<mi>x</mi>{fence("}", False)}</mrow>'),
    (r"\lbrack x\rbrack", '<mo stretchy="false">[</mo><mi>x</mi><mo stretchy="false">]</mo>'),
    (r"\bm{x}", "<mi>\U0001d499</mi>"),
    (r"\coth x", f"<mi>coth</mi>{FN}{THIN}<mi>x</mi>"),
    (r"\leftrightarrow\longrightarrow\longleftarrow\Longrightarrow\Longleftarrow\Longleftrightarrow\leqslant\geqslant",
     '<mo rspace="0em">↔</mo>' + "".join(f"<mo{TIGHT}>{c}</mo>" for c in "⟶⟵⟹⟸⟺⩽") + '<mo lspace="0em">⩾</mo>'),   # relations side by side join
    (r"f\colon A\to B", '<mi>f</mi><mo lspace="0em" rspace="0.2778em">:</mo><mi>A</mi><mo>→</mo><mi>B</mi>'),
    (r"a\not=b", "<mi>a</mi><mo>≠</mo><mi>b</mi>"),
    (r"x \not\in A \not\le \not\subset \not\equiv \not\sim", f'<mi>x</mi><mo>∉</mo><mi>A</mi><mo rspace="0em">≰</mo><mo{TIGHT}>⊄</mo><mo{TIGHT}>≢</mo><mo lspace="0em">≁</mo>'),
    # review round 2
    (r"a\displaystyle+_i b", '<mi>a</mi><mstyle displaystyle="true" scriptlevel="0"><msub><mo form="infix">+</mo><mi>i</mi></msub><mi>b</mi></mstyle>'),
    (r"\overset{a}{\textstyle\sum}", '<mover><mstyle displaystyle="false" scriptlevel="0"><mo stretchy="false" largeop="true" movablelimits="false" lspace="0em" rspace="0em">∑</mo></mstyle><mi>a</mi></mover>'),
    (r"a\overset{n}{\overset{m}{+}}b", '<mi>a</mi><mover><mover><mo stretchy="false" form="infix">+</mo><mi>m</mi></mover><mi>n</mi></mover><mi>b</mi>'),
    (r"\sin\cdot_i x", f"<mi>sin</mi>{FN}{THIN}<msub><mo{TIGHT}>⋅</mo><mi>i</mi></msub><mi>x</mi>"),
    (r"a\stackrel{n}{|}b", '<mi>a</mi><mover><mo stretchy="false" form="infix" lspace="0.2778em" rspace="0.2778em">|</mo><mi>n</mi></mover><mi>b</mi>'),
    (r"\stackrel{a}{b} = \stackrel{c}{d}", f'<mover><mi>b</mi><mi>a</mi></mover><mo{TIGHT}>=</mo><mover><mi>d</mi><mi>c</mi></mover>'),   # TeX: none between relations
    (r"(\stackrel{a}{b})", '<mo stretchy="false">(</mo><mover><mi>b</mi><mi>a</mi></mover><mo stretchy="false">)</mo>'),
    (r"x^{a\stackrel{n}{y}b}", "<msup><mi>x</mi><mrow><mi>a</mi><mover><mi>y</mi><mi>n</mi></mover><mi>b</mi></mrow></msup>"),
    (r"\sin≮x", f"<mi>sin</mi>{FN}<mo>≮</mo><mi>x</mi>"),
    (r"a + = b", f"<mi>a</mi><mo{TIGHT}>+</mo><mo>=</mo><mi>b</mi>"),       # TeX: a binary atom before a relation is ordinary
    (r"(a+)", f'<mo stretchy="false">(</mo><mi>a</mi><mo{TIGHT}>+</mo><mo stretchy="false">)</mo>'),
    (r"a+", f"<mi>a</mi><mo{TIGHT}>+</mo>"),
    (r"{a+ \over b}", f"<mfrac><mrow><mi>a</mi><mo{TIGHT}>+</mo></mrow><mi>b</mi></mfrac>"),
    (r"\operatorname{\sin x}", f'<mrow><mi>sin</mi>{THIN}<mi mathvariant="normal">x</mi></mrow>{FN}'),
    # review round 3
    (r"\overset{a}{\textstyle\sum_i}", '<mover><mrow><mstyle displaystyle="false" scriptlevel="0"><munder><mo largeop="true" movablelimits="true" lspace="0em" rspace="0em">∑</mo><mi>i</mi></munder></mstyle><mi></mi></mrow><mi>a</mi></mover>'),
    (r"\overset{a}{\sum_i}", '<mover><mrow><munder><mo largeop="true" movablelimits="true" lspace="0em" rspace="0em">∑</mo><mi>i</mi></munder><mi></mi></mrow><mi>a</mi></mover>'),
    (r"a:=b", '<mi>a</mi><mo lspace="0.2778em" rspace="0em">:</mo><mo lspace="0em">=</mo><mi>b</mi>'),   # Chrome spaces a lone : as punctuation
    (r"a=:b", '<mi>a</mi><mo rspace="0em">=</mo><mo lspace="0em" rspace="0.2778em">:</mo><mi>b</mi>'),
    (r"x^{a:=b}", f"<msup><mi>x</mi><mrow><mi>a</mi><mo{TIGHT}>:</mo><mo{TIGHT}>=</mo><mi>b</mi></mrow></msup>"),
    # review round 4
    (r"=\stackrel{n}{\lim_i}=", '<mo rspace="0em">=</mo><mover><mrow><munder><mo movablelimits="true" lspace="0em" rspace="0em">lim</mo><mi>i</mi></munder><mi></mi></mrow><mi>n</mi></mover><mo lspace="0em">=</mo>'),
    (r"a\stackrel{n}{\lim_i}b", '<mi>a</mi><mspace width="0.2778em"/><mover><mrow><munder><mo movablelimits="true" lspace="0em" rspace="0em">lim</mo><mi>i</mi></munder><mi></mi></mrow><mi>n</mi></mover><mspace width="0.2778em"/><mi>b</mi>'),
    (r"\overset{a}{\frac{\sum_i}{x}}", '<mover><mrow><mfrac><munder><mo largeop="true" movablelimits="true" lspace="0em" rspace="0em">∑</mo><mi>i</mi></munder><mi>x</mi></mfrac><mi></mi></mrow><mi>a</mi></mover>'),
    (r"\left(\lim\nolimits_n a_n\right)", f'<mrow>{fence("(", False)}<msub><mo{TIGHT}>lim</mo><mi>n</mi></msub>{THIN}<msub><mi>a</mi><mi>n</mi></msub>{fence(")", False)}</mrow>'),   # pdflatex: normal size
    (r"P = \int f", f'<mi>P</mi><mo>=</mo>{INT}{THIN}<mi>f</mi>'),
    (r"(\sum x)", f'<mo stretchy="false">(</mo>{SUM}{THIN}<mi>x</mi><mo stretchy="false">)</mo>'),
    (r"x\sum y", f'<mi>x</mi>{THIN}{SUM}{THIN}<mi>y</mi>'),
    # review round 5
    (r"\sum_i\sum_j x", f'<munder>{SUM}<mi>i</mi></munder>{THIN}<munder>{SUM}<mi>j</mi></munder>{THIN}<mi>x</mi>'),
    (r"\overset{a}{X}\sum y", f'<mover><mi>X</mi><mi>a</mi></mover>{THIN}{SUM}{THIN}<mi>y</mi>'),
    (r"\sin\sum x", f'<mi>sin</mi>{FN}{THIN}{SUM}{THIN}<mi>x</mi>'),
    (r"\max\int f", f'<mo movablelimits="true"{TIGHT}>max</mo>{THIN}{INT}{THIN}<mi>f</mi>'),
    (r"a \colon = b", '<mi>a</mi><mo lspace="0em" rspace="0.1667em">:</mo><mo lspace="0em">=</mo><mi>b</mi>'),   # TeX: thin after punctuation
    (r"a, = b", '<mi>a</mi><mo>,</mo><mo lspace="0em">=</mo><mi>b</mi>'),
    (r"\overset{a}{XY} Z", "<mover><mrow><mi>X</mi><mi>Y</mi></mrow><mi>a</mi></mover><mi>Z</mi>"),   # amsmath: an ordinary atom
    (r"W\overset{a}{X}", "<mi>W</mi><mover><mi>X</mi><mi>a</mi></mover>"),
    (r"\overset{a}{X} - b", "<mover><mi>X</mi><mi>a</mi></mover><mo>−</mo><mi>b</mi>"),
    (r"\overset{a}{X} = (\overset{b}{Y})", '<mover><mi>X</mi><mi>a</mi></mover><mo>=</mo><mo stretchy="false">(</mo><mover><mi>Y</mi><mi>b</mi></mover><mo stretchy="false">)</mo>'),
    (r"a\le = \, \ge b", '<mi>a</mi><mo rspace="0em">≤</mo><mo lspace="0em" rspace="0em">=</mo><mspace width="0.1667em"/><mo lspace="0em">≥</mo><mi>b</mi>'),
    (r"a = \overset{d}{=} b", '<mi>a</mi><mo rspace="0em">=</mo><mover><mo stretchy="false" form="infix" lspace="0em">=</mo><mi>d</mi></mover><mi>b</mi>'),
    (r"a,\stackrel{n}{x}b", '<mi>a</mi><mo>,</mo><mover><mi>x</mi><mi>n</mi></mover><mspace width="0.2778em"/><mi>b</mi>'),
    (r"a\bigm|b", '<mi>a</mi><mrow><mspace height="0.85em" depth="0.35em"/><mo stretchy="true" lspace="0.2778em" rspace="0.2778em" minsize="1.2em" maxsize="1.2em">|</mo></mrow><mi>b</mi>'),
]


@pytest.mark.parametrize("src,inner", STRUCT)
def test_structure_cases(src, inner):
    assert _body(latex_to_mathml(src, display=False)) == inner


@pytest.mark.parametrize("font", ["mathbf", "mathit", "boldsymbol", "mathbb", "mathcal", "mathsf", "mathtt"])
def test_every_font_letter_is_an_assigned_letter(font):
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz":
        mapped = _body(latex_to_mathml(f"\\{font}{{{c}}}", display=False))[4:-5]
        assert len(mapped) == 1 and unicodedata.category(mapped).startswith("L"), (font, c, mapped)
        assert mapped != c, (font, c)


ACCEPTANCE = [
    r"s = \sqrt{\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar{x})^2}",
    r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}",
    r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)",
    r"\Phi(a) = \int_{-\infty}^{a} f(x)\,dx",
    r"\Phi(z) = \int_{-\infty}^{z} \frac{1}{\sqrt{2\pi}} e^{-t^2/2}\,dt",
]


@pytest.mark.parametrize("src", ACCEPTANCE)
@pytest.mark.parametrize("display", [False, True])
def test_acceptance_formulas_convert(src, display):
    out = latex_to_mathml(src, display)
    tree = ET.fromstring(out)                      # well-formed XML
    assert tree.tag == "math" and tree.find("semantics/annotation").text == src
    if r"\left" not in src:
        assert 'stretchy="true"' not in out
    assert "<munderover>" in out or r"\sum" not in src


def test_acceptance_details():
    one = latex_to_mathml(ACCEPTANCE[0], display=True)
    assert ('<mo stretchy="false">(</mo><msub><mi>x</mi><mi>i</mi></msub><mo>−</mo>'
            + acc("<mi>x</mi>", "¯") + '<msup><mo stretchy="false">)</mo><mn>2</mn></msup>') in one
    three = latex_to_mathml(ACCEPTANCE[2], display=True)
    assert fence("(") + UNARY_MINUS + "<mfrac>" in three


def test_converter_never_raises_unexpected():
    rng = random.Random(1118)
    alphabet = list("abxy12^_{}[]()\\|'+-=., \n") + [r"\frac", r"\sqrt", r"\left", r"\right", r"\sum", "μ", "≤"]
    for _ in range(3000):
        src = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 80)))
        try:
            ET.fromstring(latex_to_mathml(src, display=bool(rng.getrandbits(1))))
        except LatexError:
            pass


LIM = '<munder><mo movablelimits="true" lspace="0em" rspace="0em">lim</mo><mi>n</mi></munder><mspace width="0.1667em"/><msub><mi>a</mi><mi>n</mi></msub>'



@pytest.mark.parametrize("src,inner", [
    (r"a\sum x", f"<mi>a</mi>{THIN}{SUM}{THIN}<mi>x</mi>"),
    (r"\sum(x)", f'{SUM}<mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'),
    (r"\sum_i x_i", f"<munder>{SUM}<mi>i</mi></munder>{THIN}<msub><mi>x</mi><mi>i</mi></msub>"),
    (r"\int_0^1 f", f"<msubsup>{INT}<mn>0</mn><mn>1</mn></msubsup>{THIN}<mi>f</mi>"),
    (r"\sum\sum x", f"{SUM}{THIN}{SUM}{THIN}<mi>x</mi>"),
    (r"x=\sum,", f"<mi>x</mi><mo>=</mo>{SUM}<mo>,</mo>"),
    (r"(\sum)", f'<mo stretchy="false">(</mo>{SUM}<mo stretchy="false">)</mo>'),
    (r"\sum -x", f"{SUM}{THIN}{UNARY_MINUS}<mi>x</mi>"),
    (r"a\frac\sum x b", f"<mi>a</mi><mfrac>{STILL_SUM}<mi>x</mi></mfrac><mi>b</mi>"),   # a one-token argument
    (r"x^\sum", f"<msup><mi>x</mi>{STILL_SUM}</msup>"),
    (r"\forall\sum x", f"<mo>∀</mo>{THIN}{SUM}{THIN}<mi>x</mi>"),                  # ∀ ∃ ¬ are ordinary in TeX
    (r"\neg\sin x", f"<mo>¬</mo>{THIN}<mi>sin</mi>{FN}{THIN}<mi>x</mi>"),
    (r"\sum_i\left(x\right)", f'<munder>{SUM}<mi>i</mi></munder>{THIN}<mrow>{fence("(", False)}<mi>x</mi>{fence(")", False)}</mrow>'),
    (r"\sum_i\big(", f'<munder>{SUM}<mi>i</mi></munder>{THIN}<mrow>{MSTRUT}<mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow>'),
    (r"\sum_i\bigl(", f'<munder>{SUM}<mi>i</mi></munder><mrow>{MSTRUT}<mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo></mrow>'),
    # TeX's Op–Inner space is dropped in scripts; Inner–Op is not
    (r"x^{\sum_i\left(a\right)}", f'<msup><mi>x</mi><mrow><munder>{SUM}<mi>i</mi></munder><mrow>{fence("(", False)}<mi>a</mi>{fence(")", False)}</mrow></mrow></msup>'),
    (r"x^{\left(a\right)\sum}", f'<msup><mi>x</mi><mrow><mrow>{fence("(", False)}<mi>a</mi>{fence(")", False)}</mrow>{THIN}{SUM}</mrow></msup>'),
])
def test_big_operators_carry_explicit_tex_spaces(src, inner):
    """Safari drops an operator's own right space, so TeX's thin spaces are written out."""
    assert _body(latex_to_mathml(src, display=False)) == inner


def test_braced_sized_relation_is_ordinary():
    out = _body(latex_to_mathml(r"a{\bigm|}b", display=False))
    assert out == f'<mi>a</mi><mrow>{MSTRUT}<mo stretchy="true"{TIGHT} minsize="1.2em" maxsize="1.2em">|</mo></mrow><mi>b</mi>'


@pytest.mark.parametrize("sized,plain", [
    (r"\overset{a}{\Bigl(}x", r"\overset{a}{(}x"),
    (r"\overset{n}{\Big|}", r"\overset{n}{|}"),
    (r"\stackrel{a}{\bigm|}", r"\stackrel{a}{|}"),
])
def test_stacked_sized_bracket_is_a_normal_one(sized, plain):
    """A stack never stretches its base, so the strut and size go and the label sits on it."""
    assert _body(latex_to_mathml(sized, display=False)) == _body(latex_to_mathml(plain, display=False))


def test_medium_strut_only_with_a_bracket():
    assert "height=" not in latex_to_mathml(r"\left.x^{2^k}\right.", display=False)
    assert MSTRUT in latex_to_mathml(r"\left(x^{2^k}\right.", display=False)
    assert MSTRUT in latex_to_mathml(r"\left.x^{2^k}\middle|y\right.", display=False)   # a middle bar only


def test_a_left_group_is_not_a_sized_bracket():
    """A `\\left.` group starts with its strut too; stacks and braces keep it whole."""
    group = _body(latex_to_mathml(r"\left.x^{2^k}y\right)", display=False))
    stacked = _body(latex_to_mathml(r"\overset{a}{\left.x^{2^k}y\right)}", display=False))
    assert stacked == f"<mover>{group}<mi>a</mi></mover>"
    braced = latex_to_mathml(r"{\left.x^{2^k}\right)}", display=False)
    assert "<mrow lspace" not in braced and "<mrow rspace" not in braced


@pytest.mark.parametrize("sized,plain", [
    (r"a\stackrel{n}{{\bigm|}}b", r"a\stackrel{n}{{|}}b"),          # braces make it ordinary
    (r"\overset{a}{\textstyle\Big(}", r"\overset{a}{\textstyle(}"),
    (r"\overset{a}{\Big(^2}", r"\overset{a}{(^2}"),
])
def test_stacked_sized_bracket_through_braces_styles_and_scripts(sized, plain):
    assert _body(latex_to_mathml(sized, display=False)) == _body(latex_to_mathml(plain, display=False))


@pytest.mark.parametrize("sized,plain", [
    (r"\overset{a}{\overline{\Big(}}", r"\overset{a}{\overline{(}}"),    # the line stays
    (r"\overset{a}{\hat{\Big(}}", r"\overset{a}{\hat{(}}"),
    (r"\overset{a}{\frac{\Big(}{x}}", r"\overset{a}{\frac{(}{x}}"),
])
def test_stack_unsizes_the_bracket_it_treats_as_its_operator(sized, plain):
    assert _body(latex_to_mathml(sized, display=False)) == _body(latex_to_mathml(plain, display=False))


def test_stack_leaves_brackets_that_are_not_its_operator():
    out = latex_to_mathml(r"\overset{a}{\textstyle\big(x\big)}", display=False)
    assert out.count('minsize="1.2em" maxsize="1.2em"') == 2 and out.count(MSTRUT) == 2
    out = latex_to_mathml(r"\overset{a}{\left.\Big(\right.}", display=False)
    assert "height=" not in out and "minsize" not in out


def test_stack_keeps_the_strut_of_a_bracket_it_does_not_unsize():
    for src in (r"\overset{a}{\left.\displaystyle\middle|x^{2^k}\right.}",
                r"\overset{a}{\left.\textstyle\middle|\widehat{x}\right.}"):
        assert MSTRUT in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src", [
    r"x\overset{a}{{=}}y", r"x\overset{a}{|}y", r"x\overset{a}{(}y", r"2\overset{\circ}{A}B",
    r"\overset{a}{\sum} x", r"\underset{x}{\lim} f", r"\underset{x}{{\lim}} f",
])
def test_stack_is_ordinary_unless_its_base_is_a_relation_or_binary(src):
    """amsmath: \\binrel@@ is \\relax there, so the braces make an Ord atom (pdflatex widths)."""
    assert THIN not in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src", [r"\underset{\sim}{x} - \underset{\sim}{y}", r"x\overset{a}{|}-y", r"\overset{a+b}{c} - d"])
def test_minus_after_a_stack_is_binary(src):
    out = latex_to_mathml(src, display=False)
    assert UNARY_MINUS not in out and "<mo>−</mo>" in out


@pytest.mark.parametrize("bare,braced", [
    (r"a\mathbf\bigm|=b", r"a\mathbf{\bigm|}=b"),
    (r"a\mathrm\overset{x}{=}-b", r"a\mathrm{\overset{x}{=}}-b"),
    (r"a\mathbf\bigl(-b", r"a\mathbf{\bigl(}-b"),
    (r"\mathbf\sum_i x", r"\mathbf{\sum}_i x"),
])
def test_one_token_font_argument_matches_the_braced_one(bare, braced):
    assert _body(latex_to_mathml(bare, display=False)) == _body(latex_to_mathml(braced, display=False))


def test_one_token_big_operator_under_an_accent_keeps_its_limits_still():
    assert 'movablelimits="true"' not in latex_to_mathml(r"a\hat\sum b", display=False)


def test_bold_symbol_takes_the_class_of_its_operator():
    assert UNARY_MINUS in latex_to_mathml(r"a\boldsymbol{\,=}-b", display=False)
    assert UNARY_MINUS in latex_to_mathml(r"a\boldsymbol{\textstyle =}-b", display=False)
    assert '<mo lspace="0em">=</mo>' in latex_to_mathml(r"a\boldsymbol{\,=}=b", display=False)   # joined relations


@pytest.mark.parametrize("src", [r"\mathrm{" + "a" * 1990 + "}", r"\bm{\mathrm{" + "aé" * 990 + "}}"])
def test_upright_word_merge_stays_linear(monkeypatch, src):
    import mathion.latex_mathml as lm
    calls = 0
    real = lm._upright

    def counted(node):
        nonlocal calls
        calls += 1
        return real(node)

    monkeypatch.setattr(lm, "_upright", counted)
    latex_to_mathml(src, display=False)
    assert calls < 20_000                                  # about 2M when each step rescans the run


@pytest.mark.parametrize("src,limit", [
    (("{~" * 39 + "=" + "}" * 39) * 16, 400_000),                                  # 1.3M when cubic
    ("\\overset{a}{" * 30 + "{~" * 8 + "~" * 1584 + "=" + "}" * 38, 1_200_000),   # 0.67M now, 3.0M when cubic
    (("\\bm{" + "~" * 36 + "\\textstyle") * 39 + "\\lim" + "}" * 39 + "_n", 1_000_000),   # 3.5M unmemoised
])
def test_nested_groups_stay_quadratic(monkeypatch, src, limit):
    """Counted, not timed: CI machines differ in speed."""
    import mathion.latex_mathml as lm
    calls = [0]
    real = lm._space_like

    def counted(*args, **kwargs):
        calls[0] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(lm, "_space_like", counted)
    latex_to_mathml(src, display=False)
    assert calls[0] < limit


@pytest.mark.parametrize("braced,bare", [
    (r"\boldsymbol{\sin} x", r"\boldsymbol\sin x"),          # bm keeps a function's class
    (r"a\boldsymbol{\sin}-b", r"a\boldsymbol\sin -b"),
])
def test_bold_braced_function_stays_a_function(braced, bare):
    assert _body(latex_to_mathml(braced, display=False)) == _body(latex_to_mathml(bare, display=False))


def test_stacked_function_name_has_no_inner_function_mark():
    body = _body(latex_to_mathml(r"\underset{x}{\operatorname{argmax}} f", display=False))
    assert body == "<munder><mi>argmax</mi><mi>x</mi></munder><mi>f</mi>"


def test_font_kind_survives_upright_merging():
    out = latex_to_mathml(r"\mathrm{\left.\sum\right.}_i x", display=False)
    assert "<munder" not in out and THIN not in out


@pytest.mark.parametrize("src", [
    r"\hat{\sum}", r"a\hat\sum b", r"\overset{a}{{\sum}}", r"\overset{a}{\mathrm{\left.\sum\right.}}",
    r"a\hat{\textstyle\sum} b", r"\underset{x}{{\prod}}",
])
def test_no_movable_operator_under_an_accent_or_label(src):
    """MathML Core: ∑ is movable by default, so only an explicit "false" or a wrapper keeps the top above."""
    out = latex_to_mathml(src, display=False)
    assert 'movablelimits="true"' not in out or "<mi></mi></mrow>" in out
    assert 'movablelimits="false"' in out or "<mi></mi></mrow>" in out


@pytest.mark.parametrize("src,thin", [
    (r"a\bm{\textstyle\sum}x", 2), (r"a\bm{\textstyle\sin}x", 2), (r"a\boldsymbol{\displaystyle\lim}x", 2),
])
def test_bold_keeps_the_class_through_a_style(src, thin):
    assert latex_to_mathml(src, display=False).count(THIN) == thin


def test_bold_takes_the_class_of_the_atom_not_of_its_inner_operator():
    out = latex_to_mathml(r"a\bm{\overset{a}{\sum}}-x", display=False)
    assert THIN not in out and "<mo>−</mo>" in out              # the stack is Ord
    fenced = latex_to_mathml(r"\sin\bm{\textstyle\left(x\right)}", display=False)
    assert fenced.count(THIN) == latex_to_mathml(r"\sin\left(x\right)", display=False).count(THIN)


def test_styled_bold_operator_keeps_its_limits():
    assert "<munder>" in latex_to_mathml(r"\bm{\textstyle\sum}\limits_i", display=False)
    assert "<munder>" in latex_to_mathml(r"\bm{\displaystyle\sum}_i", display=True)
    assert "<msub>" in latex_to_mathml(r"{\textstyle\sum}_i", display=True)   # a plain group stays Ord


@pytest.mark.parametrize("src", [r"\hat{⋀}", r"\overset{a}{{⋀}}", r"\hat{⨁}"])
def test_dictionary_movable_operator_is_held_still(src):
    """MathML Core's dictionary makes these movable without largeop from us."""
    assert 'movablelimits="false"' in latex_to_mathml(src, display=False)


def test_integral_is_not_movable_so_not_wrapped():
    assert "<mi></mi></mrow>" not in latex_to_mathml(r"\hat{\int_0}", display=False)


@pytest.mark.parametrize("bold,plain", [
    (r"\bm{{\textstyle\sum}}_i x", r"{\textstyle\sum}_i x"),      # bm keeps an inner group whole
    (r"\bm{{\sum\,}}_i x", r"{\sum\,}_i x"),
    (r"\bm{\left.\sum\right.}_i x", r"\left.\sum\right._i x"),   # \left…\right is Inner
    (r"x\bm{\left.-\right.}y", r"x\left.-\right.y"),
    (r"\sin\bm{\left.x\right.}", r"\sin\left.x\right."),
    (r"a\bm{{\textstyle\sin}} x", r"a{\textstyle\sin} x"),
])
def test_bold_stops_at_inner_groups(bold, plain):
    strip = lambda t: re.sub(r"[\U0001D400-\U0001D7FF]", "", _body(latex_to_mathml(t, display=False)))
    assert strip(bold).count(THIN) == strip(plain).count(THIN)
    assert ("<munder>" in strip(bold)) == ("<munder>" in strip(plain))
    assert (UNARY_MINUS in strip(bold)) == (UNARY_MINUS in strip(plain))


@pytest.mark.parametrize("src", [r"\bm{{\textstyle\sum}}\limits_i", r"\bm{\left.\sum\right.}\limits_i"])
def test_limits_need_an_operator_not_a_group_inside_bold(src):
    with pytest.raises(LatexError):
        latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src,display,under", [
    (r"\bm{\textstyle\sum}_i x", True, False),     # TeX sets the limit in the operator's own style
    (r"\bm{\textstyle\lim}_n x", True, False),
    (r"\bm{\displaystyle\sum}_i x", False, True),
    (r"\bm{\displaystyle\lim}_n x", False, True),
    (r"\bm{\textstyle\sum}\limits_i", True, True),
])
def test_bold_styled_operator_limits_follow_its_own_style(src, display, under):
    out = latex_to_mathml(src, display=display)
    assert ("<munder>" in out) == under
    if under:
        assert 'movablelimits="true"' not in out


def test_bold_stacked_sign_judged_binary_keeps_infix_form():
    assert 'form="infix"' in latex_to_mathml(r"x\bm{\overset{a}{-}}y", display=False)


def test_stack_over_a_typed_nary_symbol_is_not_tall():
    assert MSTRUT in latex_to_mathml(r"\left(\overset{a}{⋀}\right)", display=False)


@pytest.mark.parametrize("bold,plain", [(r"a\bm{\,\sin} x", r"a\,\sin x"), (r"a\bm{\sin\,} x", r"a\sin\, x")])
def test_bold_function_with_a_space_stays_a_function(bold, plain):
    assert latex_to_mathml(bold, display=False).count(THIN) == latex_to_mathml(plain, display=False).count(THIN)


@pytest.mark.parametrize("bold,plain", [
    (r"x\bm{\left.\sin\right.}-y", r"x\left.\sin\right.-y"),       # a fenced group stays whole
    (r"a\bm{\,\textstyle\sin}-x", r"a\bm{\textstyle\,\sin}-x"),   # space and style both wrap it
    (r"a\bm{\operatorname{f\,}}-x", r"a\operatorname{f\,}-x"),        # already a function
])
def test_bold_function_mark_follows_the_transparent_path(bold, plain):
    one, two = latex_to_mathml(bold, display=False), latex_to_mathml(plain, display=False)
    strip = lambda t: re.sub(r"[\U0001D400-\U0001D7FF]", "", t)
    assert strip(one).count(THIN) == strip(two).count(THIN)
    assert (UNARY_MINUS in one) == (UNARY_MINUS in two)


@pytest.mark.parametrize("src,part", [
    (r"\bm{\sin} x", "<mi>𝐬𝐢𝐧</mi>"),                     # \\bm switches to bold math, as \\boldmath
    (r"\boldsymbol{\cos x}", "<mi>𝐜𝐨𝐬</mi>"),
    (r"\bm{\lim}_n x", ">𝐥𝐢𝐦</mo>"),
    (r"\bm{\limsup}", ">𝐥𝐢𝐦\u2009𝐬𝐮𝐩</mo>"),
    (r"\bm{\operatorname{ff}} x", "<mi>𝐟𝐟</mi>"),
    (r"\bm{\operatorname*{arg\,max}}_x f", ">𝐚𝐫𝐠\u2009𝐦𝐚𝐱</mo>"),
    (r"\bm{\mathrm{d}}", "<mi>𝐝</mi>"),
    (r"\bm{\mathrm{Var}}", "<mi>𝐕𝐚𝐫</mi>"),
    (r"\bm{\mathit{x}}", "<mi>𝒙</mi>"),
    (r"\bm{\mathrm{2}}", "<mn>𝟐</mn>"),
    (r"\bm{\mathbb{R}}", "<mi>ℝ</mi>"),                     # no bold double-struck
    (r"\bm{\mathit{\nabla}}", "<mi>𝛁</mi>"),                # a symbols-font nabla: \\mathit does not slant it
    (r"\boldsymbol{\mathit{\nabla}}", "<mi>𝛁</mi>"),
    (r"\bm{\mathcal{A}}", "<mi>𝓐</mi>"),
    (r"\bm{\mathsf{a}}", "<mi>𝗮</mi>"),
    (r"\bm{\mathit{\Gamma}}", "<mi>𝜞</mi>"),
    (r"\bm{\mathrm{\alpha}}", "<mi>𝜶</mi>"),
])
def test_bold_math_makes_names_and_inner_fonts_bold(src, part):
    assert part in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src,part", [
    (r"\mathbf{\sin} x", "<mi>sin</mi>"),                    # LaTeX: the operator font wins over \\mathbf
    (r"\sin x", "<mi>sin</mi>"),
    (r"\mathrm{Var}", "<mi>Var</mi>"),
])
def test_names_stay_upright_outside_bold_math(src, part):
    assert part in latex_to_mathml(src, display=False)


def test_bold_name_keeps_function_spacing():
    strip = lambda t: re.sub(r"[\U0001D400-\U0001D7FF]", "", t)
    assert strip(_body(latex_to_mathml(r"a\bm{\sin} x", False))) == strip(_body(latex_to_mathml(r"a\bm\sin x", False)))
    assert latex_to_mathml(r"a\bm{\sin} x", False).count(THIN) == latex_to_mathml(r"a\sin x", False).count(THIN)


@pytest.mark.parametrize("bold,plain", [
    (r"a\bm{\mathrm{\sin}}-x", r"a\bm{\mathbf{\sin}}-x"),        # \\mathrm{…} is a group like any font's
    (r"\bm{\mathrm{\,\sum}}_i x", r"\bm{\mathbf{\,\sum}}_i x"),
])
def test_bold_stops_at_an_upright_font_group(bold, plain):
    strip = lambda t: re.sub(r"[\U0001D400-\U0001D7FF]", "", _body(latex_to_mathml(t, display=True)))
    assert strip(bold) == strip(plain)


def test_bold_sign_beside_a_space_keeps_binary_spacing():
    assert 'form="infix"' in latex_to_mathml(r"x\bm{-\,}y", display=False)
    assert 'form="infix"' not in latex_to_mathml(r"\bm{-\,}y", display=False)   # unary stays


@pytest.mark.parametrize("src", [r"a\bm{x_i}^2", r"a\bm{x^2}_i", r"a\bm{x'}_i"])
def test_script_after_a_bold_scripted_atom_joins_it(src):
    """bm unpacks its argument, so both scripts sit on the letter."""
    out = _body(latex_to_mathml(src, display=False))
    assert out.startswith("<mi>a</mi><msubsup><mi>𝒙</mi>") and out.count("<msub") == 1


@pytest.mark.parametrize("bold,plain", [
    (r"\bm{\sum_i}^n x", r"\bm{\sum}_{\bm{i}}^n x"),
    (r"\bm{\sum^n}_i x", r"\bm{\sum}_i^{\bm{n}} x"),
    (r"\bm{\lim_x}^2", r"\bm{\lim}_{\bm{x}}^2"),
    (r"\bm{\sum\limits_i}^n", r"\bm{\sum}\limits_{\bm{i}}^n"),
])
def test_script_after_bold_operator_limits_joins_them(bold, plain):
    out = _body(latex_to_mathml(bold, display=True))
    assert "<munderover>" in out and out == _body(latex_to_mathml(plain, display=True))


@pytest.mark.parametrize("src", [r"\bm{\hat{x}}_2", r"\bm{\overset{a}{\lim}}_2", r"\bm{\underset{a}{x}}^2"])
def test_script_after_a_bold_stack_or_accent_stays_outside(src):
    assert "<munderover>" not in latex_to_mathml(src, display=True)


def test_script_join_keeps_the_function_class():
    out = _body(latex_to_mathml(r"a\bm{\sin_i}^2 x", display=False))
    assert out.count("\u2061") == 1 and out.count(THIN) == latex_to_mathml(r"a\sin_i^2 x", display=False).count(THIN)


@pytest.mark.parametrize("bold,plain", [
    (r"\bm{x'}^2", r"\bm{x}'^2"),                         # bm's prime takes a following ^, as x'^2
    (r"\bm{x''}^2", r"\bm{x}''^2"),
    (r"\bm{x_i'}^2", r"\bm{x}_{\bm{i}}'^2"),
    (r"\bm{x'}^2_i", r"\bm{x}'^2_i"),
    (r"\boldsymbol{X'}^{-1}", r"\boldsymbol{X}'^{-1}"),
])
def test_bold_prime_takes_a_following_superscript(bold, plain):
    assert _body(latex_to_mathml(bold, display=False)) == _body(latex_to_mathml(plain, display=False))


@pytest.mark.parametrize("src,nest", [
    (r"\bm{x_i}_j", "<msub><msub>"), (r"\bm{x^2}^3", "<msup><msup>"), (r"\bm{x'}'", "<msup><msup>"),
    (r"\boldsymbol{x_i}_j", "<msub><msub>"), (r"\boldsymbol{\beta^*}^T", "<msup><msup>"),
    (r"\bm{x_i^2}_j", "<msub><msubsup>"), (r"\bm{x'^2}^3", "<msup><msup>"),
])
def test_clashing_script_after_bold_nests_as_mathjax(src, nest):
    """amsmath's \\boldsymbol and MathJax keep the argument whole; imported content must render."""
    assert nest in latex_to_mathml(src, display=False)


def test_operatorname_keeps_its_own_scripts():
    assert "<msup><msub>" in latex_to_mathml(r"\operatorname{\sin_x}^2", display=False)
    assert "<msub><msub>" in latex_to_mathml(r"\operatorname{\sin_x}_y", display=False)


@pytest.mark.parametrize("late,early", [
    (r"\sum_i\limits^n", r"\sum\limits_i^n"),
    (r"\sum\limits_i\nolimits^n", r"\sum\nolimits_i^n"),
    (r"\bm{\sum_i}\limits^n", r"\bm{\sum}\limits_{\bm{i}}^n"),
])
def test_limits_after_a_script_still_counts(late, early):
    assert _body(latex_to_mathml(late, display=False)) == _body(latex_to_mathml(early, display=False))


@pytest.mark.parametrize("src,display,tag", [
    (r"\bm{\lim_x}\nolimits", False, "<msub>"), (r"\bm{\lim_x}\nolimits", True, "<msub>"),
    (r"\bm{\sum_i}\nolimits", True, "<msub>"),
    (r"\bm{\int_a}\limits", False, "<munder>"), (r"\boldsymbol{\int_a^b}\limits", False, "<munderover>"),
    (r"\bm{\int_a}\limits\nolimits", False, "<msub>"),
])
def test_limits_after_a_bold_scripted_operator_moves_its_scripts(src, display, tag):
    assert _body(latex_to_mathml(src, display=display)).startswith(tag)


@pytest.mark.parametrize("src,plain", [
    (r"\bm{x'}^\prime", r"\bm{x}'^\prime"),                # bm's prime takes ^\prime too, as x'^\prime
    (r"\bm{x'}^{\prime}", r"\bm{x}'^{\prime}"),
])
def test_bold_prime_takes_a_following_prime_superscript(src, plain):
    assert _body(latex_to_mathml(src, display=False)) == _body(latex_to_mathml(plain, display=False))


def test_bold_prime_superscript_is_not_an_apostrophe():
    assert "<msup><msup>" in latex_to_mathml(r"\bm{x^\prime}^2", display=False)   # TeX: double superscript


@pytest.mark.parametrize("src,part", [
    (r"x^{\displaystyle y}", '<mstyle displaystyle="true" scriptlevel="0">'),   # TeX: full size in a script
    (r"x^{\textstyle y}", '<mstyle displaystyle="false" scriptlevel="0">'),
    (r"x^{\dfrac12}", '<mstyle displaystyle="true" scriptlevel="0">'),
    (r"x^{\tfrac12}", '<mstyle displaystyle="false" scriptlevel="0">'),
])
def test_explicit_style_resets_the_script_size(src, part):
    assert part in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src,display,tag", [
    (r"\det_{x} A", True, "<munder>"), (r"\Pr_{x\sim D} A", True, "<munder>"),
    (r"\gcd_{i} a_i", True, "<munder>"), (r"\det_{x} A", False, "<munder>"),
])
def test_det_gcd_pr_take_limits_as_lim(src, display, tag):
    """amsmath makes them \\mathop with limits, as \\lim."""
    out = _body(latex_to_mathml(src, display=display))
    assert out.startswith(tag) and 'movablelimits="true"' in out


@pytest.mark.parametrize("src,part", [
    (r"\operatorname{f-g} x", "<mi>f-g</mi>"),              # amsmath: a tight text hyphen
    (r"\operatorname{a*b} x", "<mi>a*b</mi>"),
    (r"\operatorname*{arg-min}_x f", ">arg-min</mo>"),
    (r"\bm{\operatorname{f-g}} x", "<mi>𝐟-𝐠</mi>"),
    (r"\bm{\operatorname*{arg-min}}_x f", ">𝐚𝐫𝐠-𝐦𝐢𝐧</mo>"),
    (r"\operatorname*{\det}_x A", ">det</mo>"),
    (r"\operatorname{f'} x", "<mi>f’</mi>"),                 # a text apostrophe, not a prime
    (r"\operatorname*{f'}_x a", ">f’</mo>"),
    (r"\operatorname{a:b} x", '<mo lspace="0em" rspace="0.1667em">:</mo>'),   # punctuation
    (r"\operatorname{a.b} x", '<mo lspace="0em" rspace="0.1667em">.</mo>'),
])
def test_operatorname_hyphen_and_star_are_text(src, part):
    assert part in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src", [r"x^{\displaystyle a+b}", r"x^{\textstyle a=b}", r"\sum_{\textstyle i=1}", r"e^{-\dfrac{x-\mu}{2}}"])
def test_full_size_style_in_a_script_keeps_operator_spacing(src):
    out = latex_to_mathml(src, display=False)
    assert re.search(r'<mo( form="infix")?>[+=−]</mo>', out)


@pytest.mark.parametrize("src,part", [
    (r"\mathrm{\boldsymbol{x}}", "<mi>𝒙</mi>"),             # \\boldsymbol follows amsmath here; \\bm follows bm
    (r"\operatorname{a.} x", '<mo lspace="0em" rspace="0em">.</mo>'),   # no space after the last punctuation
    (r"\operatorname{f^'} x", "’"),
    (r"\operatorname*{\alpha-\beta}_x f", ">α-β</mo>"),
    (r"\operatorname{f}' x", "<mo>′</mo>"),                  # outside the name a prime again
    (r"\mathrm{a-b}", "<mo>−</mo>"),
    (r"\operatorname{e^{-x}}", '<mi mathvariant="normal">-</mi>'),
    (r"\mathbf{\bm{\mathrm{x}}}", "<mi>𝐱</mi>"),
])
def test_round_two_boundaries(src, part):
    assert part in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src", [r"\operatorname*{a.b}", r"\operatorname*{-}"])
def test_operatorname_star_still_wants_a_name(src):
    with pytest.raises(LatexError):
        latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src,grows", [
    (r"\left(\lim_{n\to\infty} a_n\right)", False),           # pdflatex: a subscript beside is not tall
    (r"\left(\gcd_i a\right)", False),
    (r"\left(\lim\nolimits_n a\right)", False),
    (r"\left(\det^{-1}A\right)", True),                         # a superscript is
    (r"\left(\Pr^2 x\right)", True),
])
def test_bracket_around_a_limit_beside_its_name(src, grows):
    assert ("minsize" in latex_to_mathml(src, display=False)) == grows


@pytest.mark.parametrize("src,display,grows", [
    (r"\left(\displaystyle\lim_n a\right)", False, True),            # the limit sits under the name
    (r"\displaystyle\left(\lim_n a\right)", False, True),
    (r"{\displaystyle\left(\lim_{n\to\infty} a_n\right)}", False, True),
    (r"\textstyle\left(\lim_n a\right)", True, False),               # beside it again (pdflatex: normal)
    (r"\left(\lim_n a\right)", False, False),
])
def test_explicit_style_decides_where_a_limit_sits_for_brackets(src, display, grows):
    assert ('stretchy="true"' in latex_to_mathml(src, display=display)) == grows


@pytest.mark.parametrize("src", [
    r"\operatorname{{a.}b}", r"\operatorname{a.\,} x", r"\operatorname{a.^2}", r"\operatorname{a\textstyle.}",
])
def test_operatorname_last_punctuation_has_no_space_after(src):
    out = latex_to_mathml(src, display=False)
    assert 'rspace="0em">.</mo>' in out and 'rspace="0.1667em">.</mo>' not in out


@pytest.mark.parametrize("src,spaced", [
    (r"\operatorname{\left(a.\right)}", True),      # punctuation before a closing bracket keeps its space
    (r"\operatorname{a\bm{.}b}", True),              # \\bm unpacks: the dot is still followed by b
    (r"\operatorname{\boldsymbol{a.}b}", True),
    (r"\operatorname{a.\over b}", False),            # a numerator is a list of its own
    (r"\operatorname{\overset{x}{a.}b}", False),     # so is a stacked base
    (r"\operatorname{a\bm{.}}", False),
    (r"\operatorname{\left(a\over b.\right)c}", False),  # the denominator ends its own list first
    (r"\operatorname{\left(a\choose b;\right)c}", False),
    (r"\operatorname{\bm{{a.}}b}", False),           # inner braces inside \\bm are a real list
    (r"\operatorname{\bm{a\over b.}c}", False),      # our reading: \\bm{a\\over b} is an error in bm
    (r"\operatorname{\left.a.\right.}d", True),       # a null \\right is still a closing atom
    (r"\operatorname{\left(a.\right.}d", True),
    (r"\operatorname{x{\left.a.\right.}}d", True),
    (r"\operatorname{\left[a.\right.}", True),
    (r"\operatorname\bm{a.}d", False),              # a one-token argument ends the name too
])
def test_operatorname_list_ends_for_punctuation(src, spaced):
    out = latex_to_mathml(src, display=False)
    assert ('rspace="0.1667em">' in out) == spaced, out
    assert spaced or 'rspace="0em">' in out, out


@pytest.mark.parametrize("src,display", [
    (r"{a\over b}\left(\lim_n c\right)", True),          # display style again after the group
    (r"\displaystyle{a\over b}\left(\lim_n c\right)", False),
    (r"{\textstyle x}\left(\lim_n c\right)", True),
])
def test_display_style_returns_after_a_group(src, display):
    assert 'stretchy="true"' in latex_to_mathml(src, display=display)


def test_denominator_after_over_is_not_display_style():
    out = latex_to_mathml(r"{\displaystyle a\over \left(\lim_n b\right)}", display=False)
    assert 'stretchy="true"' not in out


def test_operatorname_keeps_the_space_of_colon():
    assert "0.2778em" in latex_to_mathml(r"\operatorname{a\colon}b", display=False)


def test_minus_outside_operatorname_stays_a_sign():
    assert "<mo>−</mo>" in latex_to_mathml(r"f-g", display=False)


@pytest.mark.parametrize("src,part", [
    (r"\mathrm{\bm{x}}", '<mi mathvariant="normal">x</mi>'),   # bm leaves an outer alphabet's letters
    (r"\mathbf{\bm{x}}", "<mi>𝐱</mi>"),
    (r"\mathbb{\bm{R}}", "<mi>ℝ</mi>"),
    (r"\bm{\mathrm{x}}", "<mi>𝐱</mi>"),                      # an inner font still takes bold math
    (r"\mathrm{\bm{\Gamma}}", '<mi mathvariant="normal">Γ</mi>'),
    (r"\mathrm{\bm{2}}", "<mn>2</mn>"),
    (r"\mathrm{\bm{\bm{x}}}", '<mi mathvariant="normal">x</mi>'),
    # the rest is still bold math, as bm
    (r"\mathbf{\boldsymbol{\beta}}", "<mi>𝜷</mi>"),
    (r"\mathrm{d\bm{\mu}}", "<mi>𝝁</mi>"),
    (r"\mathrm{\bm{\sin}} x", "<mi>𝐬𝐢𝐧</mi>"),
    (r"\mathrm{\bm{\lim}}", ">𝐥𝐢𝐦</mo>"),
    (r"\mathrm{\bm{\nabla}}", "<mi>𝛁</mi>"),
    (r"\mathbf{\bm{\partial}}", "<mi>𝝏</mi>"),
    (r"\mathrm{\bm{\mathit{x}}}", "<mi>𝒙</mi>"),
    (r"\mathrm{\bm{\mathsf{x}}}", "<mi>𝘅</mi>"),
    (r"\mathrm{\bm{\mathrm{x}}}", "<mi>𝐱</mi>"),
    (r"\bm{\mathrm{\bm{x}}}", "<mi>𝐱</mi>"),
    (r"\bm{\mathsf{\bm{\Gamma}}}", "<mi>𝝘</mi>"),
    (r"\operatorname{\bm{\alpha}} x", "<mi>𝜶</mi>"),
])
def test_outer_font_around_bold_keeps_its_letters(src, part):
    assert part in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src,part", [
    (r"\bm{\mathsf{\Gamma}}", "<mi>𝝘</mi>"),                  # bold sans capital Greek
    (r"\bm{\mathsf{\alpha}}", "<mi>𝜶</mi>"),                   # lowercase Greek ignores \\mathsf
    (r"\mathsf{\Gamma}", '<mi mathvariant="normal">Γ</mi>'),  # Unicode has no plain sans Greek
])
def test_bold_sans_capital_greek(src, part):
    assert part in latex_to_mathml(src, display=False)


def test_braced_scripted_atom_keeps_its_own_scripts():
    assert "<msup><msub>" in latex_to_mathml(r"{x_i}^2", display=False)


def test_upright_font_keeps_accented_latin_letters_upright():
    assert latex_to_mathml(r"\mathrm{aéb}", display=False).count("<mi>aéb</mi>") == 1


@pytest.mark.parametrize("src,part", [
    (r"\bm{\mathrm{aéb}}", "<mi>𝐚é𝐛</mi>"),                 # no bold é in Unicode; one upright word
    (r"\bm{\operatorname{aéb}} x", "<mi>𝐚é𝐛</mi>"),
    (r"\bm{\mathrm{é}}", '<mi mathvariant="normal">é</mi>'),
    (r"\mathbf{é}", '<mi mathvariant="normal">é</mi>'),
    (r"\mathsf{é}", '<mi mathvariant="normal">é</mi>'),
    (r"\mathtt{é}", '<mi mathvariant="normal">é</mi>'),
])
def test_upright_fonts_keep_accented_letters_upright_in_bold(src, part):
    assert part in latex_to_mathml(src, display=False)


@pytest.mark.parametrize("src", [r"\mathit{é}", r"\bm{é}", "é"])
def test_italic_fonts_keep_accented_letters_italic(src):
    assert "<mi>é</mi>" in latex_to_mathml(src, display=False)


def test_bold_opening_bracket_through_a_style_makes_the_sign_unary():
    assert UNARY_MINUS in latex_to_mathml(r"\bm{\textstyle(}-x", display=False)


@pytest.mark.parametrize("src", [
    r"a\hat{\sum_i} b", r"a\vec{\lim_n} b", r"a\hat{\textstyle\sum} b", r"a\hat{\,\sum} b",
    r"a\hat{\frac{\sum_i}{2}} b",
])
def test_accent_stays_above_a_movable_operator(src):
    """An embellished base with movable limits would carry the accent aside in Chrome."""
    out = latex_to_mathml(src, display=False)
    assert '<mover accent="true"><mrow>' in out and "<mi></mi></mrow>" in out


@pytest.mark.parametrize("braced,bare", [
    (r"a\boldsymbol{\times}b", r"a\times b"),        # amsbsy keeps the class
    (r"a\bm{=}b", r"a=b"),
    (r"a\boldsymbol{-}b", r"a-b"),
    (r"\boldsymbol{-}x", r"-x"),
])
def test_bold_symbol_keeps_operator_spacing(braced, bare):
    assert _body(latex_to_mathml(braced, display=False)) == _body(latex_to_mathml(bare, display=False))


@pytest.mark.parametrize("bare,braced", [
    (r"a\hat=b", r"a\hat{=}b"),
    (r"\frac=2 x", r"\frac{=}2 x"),
    (r"a\sqrt=b", r"a\sqrt{=}b"),
    (r"x^=", r"x^{=}"),
])
def test_one_token_argument_is_ordinary_like_a_braced_one(bare, braced):
    assert _body(latex_to_mathml(bare, display=False)) == _body(latex_to_mathml(braced, display=False))


@pytest.mark.parametrize("src", [r"a{\,=}b", r"a{=\,}b", r"a\frac{\,=}{2}b", r"a\overline{\,=}b"])
def test_braced_operator_with_spaces_is_ordinary(src):
    assert '<mo lspace="0em" rspace="0em">=</mo>' in latex_to_mathml(src, display=False)


def test_stack_base_with_spaces_stays_a_relation():
    assert 'form="infix"' in latex_to_mathml(r"a\overset{b}{\,=}c", display=False)


@pytest.mark.parametrize("src", [r"a{\textstyle\bigm|}b", r"a{\bigm|^2}b", r"a{\textstyle=}b"])
def test_braced_embellished_operator_is_ordinary(src):
    """TeX: a braced group is an ordinary atom, even around a styled or scripted operator."""
    out = latex_to_mathml(src, display=False)
    assert "0.2778em" not in out and 'lspace="0em" rspace="0em"' in out


@pytest.mark.parametrize("src,inner", [
    (r"\neg -x", "<mo>¬</mo><mo>−</mo><mi>x</mi>"),       # ∀ ∃ ¬ are ordinary in TeX: the minus stays binary
    (r"\forall -x", "<mo>∀</mo><mo>−</mo><mi>x</mi>"),
])
def test_minus_after_quantifier_is_binary(src, inner):
    assert _body(latex_to_mathml(src, display=False)) == inner


@pytest.mark.parametrize("src,display,bracket", [
    (r"\left(\lim_{n} a_n\right)", False, "normal"),     # beside the name a subscript is not tall (pdflatex)
    (r"\left(\lim_{n} a_n\right)", True, "grow"),        # the limit sits under it
])
def test_limits_under_a_name_grow_brackets_in_display(src, display, bracket):
    left, right = (fence("(", False), fence(")", False)) if bracket == "normal" else (fence("("), fence(")"))
    assert _body(latex_to_mathml(src, display)) == f"<mrow>{left}{LIM}{right}</mrow>"


def test_forced_limits_grow_brackets_inline():
    out = _body(latex_to_mathml(r"\left(\lim\limits_{n} a\right)", False))
    assert out.startswith(f"<mrow>{fence('(')}<munder>")


def test_stack_over_a_function_name_is_ordinary():
    body = _body(latex_to_mathml(r"\underset{x}{\arg\max} f", False))
    assert body.endswith("</munder><mi>f</mi>")             # amsmath: Ord, no space before f


def test_operatorname_keeps_one_function_mark():
    assert latex_to_mathml(r"\operatorname{\textstyle\sin x}", False).count("\u2061") == 1


def test_stack_over_a_spaced_sum_keeps_the_top_above():
    assert "<mi></mi></mrow><mi>a</mi></mover>" in latex_to_mathml(r"\overset{a}{\sum\,}", False)
