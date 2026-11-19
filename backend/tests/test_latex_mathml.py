import html

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
    ("x\u0302", "unsupported character U+0302"),
    ("a\x1cb", "unsupported character U+001C"),           # Python counts it as whitespace
    ("a\vb", "unsupported character U+000B"),
    ("x\fy", "unsupported character U+000C"),            # invalid in XML
    ("\\text{a\x1cb}", "unsupported character U+001C"),           # no precomposed form: use \hat
    (r"\text}", r"`\text` needs 1 argument"),
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
