# Math Typesetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `$…$` and `$$…$$` in Mathion content, answer choices included, are
typeset as MathML. Mathion's own server-side LaTeX converter produces it, with
no new dependency.

**Architecture:**
- A pure converter `backend/mathion/latex_mathml.py` turns one formula into a
  `<math>` element.
- `backend/mathion/markdown.py` finds formulas with Mathion's own dollar
  rules and calls the converter. nh3 stays the last step.
- Answer options gain a stored `text_html`, filled by one model hook.
- The frontend shows the stored HTML, styles it, and bundles one math font.
- Hashed `/_app/` files become immutable-cached.

**Tech Stack:**
- Backend: Python 3.13, FastAPI, SQLAlchemy, Alembic, markdown-it-py 4.0.0,
  mdit-py-plugins 0.5.0, nh3 0.3.4, pytest.
- Frontend: Svelte 5, Vite, vitest.
- Gate: the zsh visual-refresh CSS gate.

**Spec:** `docs/superpowers/specs/2026-11-18-math-typesetting-design.md` (rev 6).
Plan rev 6 folds in Task 1's rulings (spec rev 6): the accent forms (`math-acc` class, `\hat` U+02C6, CSS over/underline), the new sanitiser classes, the exact look values, and STIX Two Math. Plan rev 5 answers Codex round 4 (`\middle` fence, `makeItem` string). Plan rev 4 answers Codex round 3: whole-body structure checks, nested `_tree` with NBSP, nested-script depth, an independent allowlist map, and fixed component examples. Plan rev 3 answers Codex round 2: tree-based sanitiser checks, full structure trees, NBSP for every `\text` space, depth 40/41, executable component tests, and the full browser repeat. Plan rev 2 answers the Codex plan review: executable tests, the real test
helpers, the migration harness, gate section (n), a full three-browser matrix
in Task 1, and wider converter and sanitiser coverage.
Every task reads the spec section it names; the spec is binding where this
plan is silent.

## Global Constraints

- No new Python or JS dependencies. The font is a bundled asset file, not a
  package.
- Svelte 5; component tests use `mount`/`unmount`/`flushSync` from `svelte`,
  never `@testing-library/svelte`.
- Python only via `backend/.venv` (`backend/.venv/bin/pytest`, `…/alembic`,
  `…/python`).
- Code comments are one short plain line; reasoning goes in the ledger.
- Browsers: current Chrome, Firefox and Safari (MathML Core); 400px phone
  width for student screens.
- The sanitiser (`_clean`, nh3) is the last step for every rendered field,
  option text included.
- Author HTML stays off (`html: False`).
- Owner's rule VR-B12: no backfill before the beta. Stored HTML re-renders
  on save, publish and clone only.
- Stay inside the repo: absolute `cd` only, no `/tmp`, and probes go in
  `.superpowers/sdd/2026-11-18-math-typesetting/probe/`.
- The branch is `feat/math-typesetting`, cut from `main` **after**
  `feat/large-screen-zoom` merges. No push or merge without the owner's OK.
- Per task, before each commit:
  1. Opus + Fable review lanes and Codex (`model_reasoning_effort=high`) on
     the uncommitted diff;
  2. fix every Critical/Important finding, then re-review;
  3. commit only on the owner's OK.

  The commit trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `logo.png` or `favicon.svg`.
- **Test commands:**
  - backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
  - frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test && npm run check`

    Green means exit 0, and no "Errors" or "Unhandled" line.
  - gate: `zsh /Users/svkucheryavski/Documents/Developing/mathion/frontend/scripts/visual-refresh-gate.sh`

## Review Focus

1. **Real teacher prose next to formulas.** A paragraph that starts with a
   formula and ends in a digit, money amounts, `\$` inside and outside math,
   and `$$` in mid-sentence must each come out as the spec's dollar rule says.
   Never raw source where math was meant, and never an error box for money.
   Owned by Task 4: `test_dollar_rule_cases` (parametrised table).
2. **Converter input it was not written for.** Any string up to 2 000
   characters (random bytes, deep unbraced chains, unknown Unicode) must give
   MathML or an error span, never an exception out of `render_markdown`.
   Owned by Task 3: `test_converter_never_raises_unexpected`, a seeded fuzz
   loop over generated strings.
3. **Options created by paths other than the editor.** Clone, publish and the
   coming import must never leave `text_html` empty. Owned by Task 5:
   `test_every_option_path_fills_text_html`.
4. **A formula in a narrow choice or paragraph at 400px.** It must not widen
   the page, must not clip tall ink, and must keep spaces between text and
   math in a flex choice row. Owned by Task 6 (`.opt-text` wrapper test) and
   Task 8 (browser checks).
5. **Stored pre-update content.** It keeps showing as before (source,
   spacing intact) until it is re-saved; no page breaks. Owned by Task 7:
   the gate keeps the `div.math` selectors, plus a component render test of
   an old `<div class="math block">` string.

---

### Task 1: Font pick and MathML rendering spike (no product code)

**Files:**
- Create: `.superpowers/sdd/2026-11-18-math-typesetting/probe/fonts.html` (git-ignored)
- Create: `.superpowers/sdd/2026-11-18-math-typesetting/probe/*.woff2` (git-ignored)

**Interfaces:**
- Produces:
  - the chosen font (owner's pick), recorded in the ledger as
    `Ruling: font = <name>`;
  - a ledger line per checked rendering rule, giving the MathML form that
    works in all three browsers;
  - Tasks 2, 3 and 7 consume both.

- [ ] **Step 1: Fetch the two candidate fonts into the probe folder**
  - **STIX Two Math** woff2: from the upstream `stipub/stixfonts` GitHub
    release, with its SIL OFL 1.1 licence.
  - **Latin Modern Math**: the GUST release `latinmodern-math.otf`. GUST
    publishes no woff2, and converting needs a tool Mathion does not have.
    So if the owner picks it, the shipped file is the upstream `.otf`
    (spec rev 5 note, Font and caching).
  - Record each file's URL and SHA-256 in the ledger.

- [ ] **Step 2: Hand-write `fonts.html`**
  - Two columns, one per font (`@font-face` from the probe files).
  - Each column shows all five acceptance formulas of the spec's Goals,
    written as MathML exactly in the forms the spec's table prescribes:
    - `stretchy="false"` plain brackets;
    - `movablelimits` `\sum`;
    - `<mstyle displaystyle>` for `\dfrac`;
    - primes `f'` and `f'^2` as `<msup>` with ′;
    - every accent character from the Accents row;
    - unary minus with zero `lspace`/`rspace`;
    - the function `<mspace>`.
  - Add one inline sentence with `\sum_{i=1}^n` (limits beside), and one
    `\frac{\sum_{i=1}^n x_i}{n}` in display style (limits beside inside the
    fraction).
  - Add the look experiments, with the spec's CSS copied in:
    - an over-wide display formula in a `.math-display` box;
    - tall inline math (`\int`, `\sum`, an accent) in a one-line paragraph
      with `overflow-x: auto`, and in a flex `.opt` row with `.opt-text`;
    - a list item and a link near the edge of an overflow paragraph, at
      400px;
    - a third column with the font file missing, to see the swap fallback.

- [ ] **Step 3: Screenshot in Chrome yourself**

  Run `agent-browser`: open the file at 1280px and at 400px, take a
  screenshot of each, and Read the PNGs.

  Expected:
  - brackets around `(x_i-\bar{x})` are the height of the text, not of the
    sum;
  - limits sit under/over in display style and beside inline and inside the
    fraction;
  - nothing is missing a glyph;
  - the over-wide formula scrolls, with both ends reachable;
  - tall inline ink is not clipped, with no vertical scrollbar;
  - list markers and focus rings are intact;
  - the swap column is readable.

- [ ] **Step 4: Owner's Safari and Firefox check, one step at a time**

  Give the owner the probe file path and ask, one browser at a time, about
  each point of Step 3. Ask one point per message.

  Expected: yes in both. If no, record the failing rule and a working form
  (for example `<mstyle>` instead of `displaystyle` on `<mfrac>`) as a
  `Ruling:` line.

- [ ] **Step 5: Owner picks the font from a side-by-side overlay**

  Embed both screenshots as base64 in an agterm overlay
  (`--size-percent 60`) and ask which font.

  Expected: a pick, recorded as `Ruling: font = …`.

No commit; probe files stay git-ignored.

### Task 2: Converter core (tokens, atoms, scripts, errors)

**Files:**
- Create: `backend/mathion/latex_mathml.py`
- Test: `backend/tests/test_latex_mathml.py`

**Interfaces:**
- Consumes: Task 1's rulings on MathML forms.
- Produces:
  - `class LatexError(ValueError)` with attribute `reason: str`;
  - `latex_to_mathml(src: str, display: bool) -> str`, which returns the
    full `<math …><semantics><mrow>…</mrow><annotation encoding="application/x-tex">SRC</annotation></semantics></math>`,
    with `display="block"` only when `display`;
  - an internal command table that Task 3 extends:
    `COMMANDS: dict[str, Callable]`, one parser entry per command.

The spec sections this task covers: Converter, its Limits, Whitespace,
Unbraced arguments, and these rows of the supported table:
- Letters, Numbers, Operators, Brackets (plain), Primes;
- Greek, Greek variants, Symbols;
- Scripts, Unary signs, Text, Spacing, Escapes;
- the Errors table.

- [ ] **Step 1: Write the failing table test**

```python
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
    (r"\%", "<mo>%</mo>"), (r"\$", "<mo>$</mo>"),
    ("a\nb", "<mi>a</mi><mi>b</mi>"),
    ("x < y", "<mi>x</mi><mo>&lt;</mo><mi>y</mi>"),
]

def _body(out: str) -> str:                       # the whole content of the top <mrow>
    return out.split("<semantics><mrow>", 1)[1].rsplit('</mrow><annotation encoding="application/x-tex">', 1)[0]

@pytest.mark.parametrize("src,inner", CASES)
def test_core_cases(src, inner):
    out = latex_to_mathml(src, display=False)
    assert out.startswith("<math><semantics><mrow>")
    assert _body(out) == inner
    assert f'<annotation encoding="application/x-tex">{html.escape(src)}</annotation>' in out
```

Emitter conventions (the string tests rely on them):
- attributes are in the order the spec's sanitiser map lists them;
- a group holding one node collapses to that node;
- an empty group is `<mrow/>`;
- an argument of several nodes keeps its `<mrow>`;
- `\text` turns **every** space into U+00A0 (NBSP), leading and trailing
  ones included. MathML Core collapses ordinary spaces, so this is the only
  way to keep them.

Add these cases to `CASES`, each with its full expected inner string:
- `f'^2` → `<msup><mi>f</mi><mrow><mo>′</mo><mn>2</mn></mrow></msup>`;
- `x_i'` → `<msubsup><mi>x</mi><mi>i</mi><mo>′</mo></msubsup>`;
- `f'''` → ‴;
- `^2x` (a leading script);
- `ж` → `<mi mathvariant="normal">ж</mi>`;
- `-t^2/2` (the `/` with zero `lspace`/`rspace`);
- `0{,}05` (the comma with zero spacing);
- `\|` → ‖ non-stretchy, with zero spacing;
- `x \le y` after a relation, then unary `-`: `x = -2`.

- [ ] **Step 2: Write the failing error and limit tests**

```python
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
])
def test_errors(src, reason):
    with pytest.raises(LatexError) as e:
        latex_to_mathml(src, display=False)
    assert e.value.reason == reason

def test_limits_are_inclusive():
    latex_to_mathml("x" * 2000, display=False)
    latex_to_mathml("{" * 40 + "x" + "}" * 40, display=False)   # depth 40 is allowed
    latex_to_mathml("x^{" * 40 + "x" + "}" * 40, display=False)

def test_display_flag():
    assert latex_to_mathml("x", display=True).startswith('<math display="block">')

def test_source_is_escaped_in_annotation():
    out = latex_to_mathml(r"\text{</annotation><script>}", display=False)
    assert "<script>" not in out
```

The top level is depth 0. Each nested group, command argument or script adds
1, and a braced argument counts once: the argument and its braces are one
level. So 40 nested levels pass and 41 fail. An unbraced `x^y^z` is a double
superscript, not nesting. `\sqrt` and `\frac` are Task 3's,
and Task 3 adds the `\sqrt` chain cases: `\sqrt` × 40 passes, × 41 fails.

- [ ] **Step 3: Run the tests and see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_latex_mathml.py -q`
Expected: FAIL with `ModuleNotFoundError: mathion.latex_mathml`.

- [ ] **Step 4: Implement `latex_mathml.py`**
  - **Tokeniser:** commands `\name` and `\` + one char; digit runs with one
    `.`; single characters; whitespace tokens dropped outside `\text`.
  - **Parser:** recursive descent with a `depth` counter that rises on every
    group, command argument and script, and checks against 40 at each rise.
  - **Unbraced argument:** one token, and if the token is a digit run, only
    its first digit, leaving the rest in the stream. A command argument takes
    that command's own arguments.
  - **Unary rule:** a `+ - \pm \mp` is unary when the previous emitted node
    is none, an opening bracket, a relation, an operator, punctuation, a
    function or a big operator.
  - Escape every text node with `html.escape(…, quote=True)`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_latex_mathml.py -q`
Expected: all pass.

- [ ] **Step 6: Review lanes on the uncommitted diff, then commit on the owner's OK**

```bash
git add backend/mathion/latex_mathml.py backend/tests/test_latex_mathml.py
git commit -m "feat(math): LaTeX to MathML converter core"
```

### Task 3: Converter structures (fractions, operators, functions, accents, fences, fonts)

**Files:**
- Modify: `backend/mathion/latex_mathml.py`
- Test: `backend/tests/test_latex_mathml.py`

**Interfaces:**
- Consumes: Task 2's `latex_to_mathml`, `LatexError` and `COMMANDS`.
- Produces: no new public names.

The spec rows this task covers:
- Fractions, Binomial, Roots;
- Big operators, Integrals, Limit control;
- Functions, Limit-style functions;
- Accents, Stacked;
- Growing brackets, Fixed big brackets;
- Letter fonts.

- [ ] **Step 1: Write the failing structure tests**

```python
STRUCT = [  # each expected string is the whole body inside the top <mrow>
    (r"\frac12", "<mfrac><mn>1</mn><mn>2</mn></mfrac>"),
    (r"{a \over b}", "<mfrac><mi>a</mi><mi>b</mi></mfrac>"),
    (r"\dfrac{a}{b}", '<mstyle displaystyle="true"><mfrac><mi>a</mi><mi>b</mi></mfrac></mstyle>'),
    (r"\tfrac{a}{b}", '<mstyle displaystyle="false"><mfrac><mi>a</mi><mi>b</mi></mfrac></mstyle>'),
    (r"\binom{n}{k}", '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>'),
    (r"{n \choose k}", '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>'),
    (r"\sqrt[3]{x}", "<mroot><mi>x</mi><mn>3</mn></mroot>"),
    (r"\sqrt\frac12", "<msqrt><mfrac><mn>1</mn><mn>2</mn></mfrac></msqrt>"),
    (r"\sum_{i=1}^n", '<munderover><mo largeop="true" movablelimits="true">∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>'),
    (r"\sum\nolimits_i", '<msub><mo largeop="true">∑</mo><mi>i</mi></msub>'),
    (r"\int_0^1", '<msubsup><mo largeop="true">∫</mo><mn>0</mn><mn>1</mn></msubsup>'),
    (r"\int\limits_0^1", '<munderover><mo largeop="true" movablelimits="false">∫</mo><mn>0</mn><mn>1</mn></munderover>'),
    (r"\log_2 n", '<msub><mi>log</mi><mn>2</mn></msub><mo>⁡</mo><mspace width="0.1667em"/><mi>n</mi>'),
    (r"\sin(x)", '<mi>sin</mi><mo>⁡</mo><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'),
    (r"\sin=", '<mi>sin</mi><mo>⁡</mo><mo>=</mo>'),
    (r"\max(a,b)", '<mo movablelimits="true" lspace="0em" rspace="0em">max</mo><mo stretchy="false">(</mo><mi>a</mi><mo>,</mo><mi>b</mi><mo stretchy="false">)</mo>'),
    (r"\lim_{n\to\infty}", '<munder><mo movablelimits="true" lspace="0em" rspace="0em">lim</mo><mrow><mi>n</mi><mo>→</mo><mi>∞</mi></mrow></munder>'),
    (r"\operatorname{Var}(X)", '<mi>Var</mi><mo>⁡</mo><mo stretchy="false">(</mo><mi>X</mi><mo stretchy="false">)</mo>'),
    (r"\bar{x}", '<mover accent="true"><mi>x</mi><mo class="math-acc" stretchy="false">¯</mo></mover>'),
    (r"\hat{X}", '<mover accent="true"><mi>X</mi><mo class="math-acc" stretchy="false">ˆ</mo></mover>'),
    (r"\vec{v}", '<mover accent="true"><mi>v</mi><mo stretchy="false">→</mo></mover>'),
    (r"\widehat{xy}", '<mover accent="true"><mrow><mi>x</mi><mi>y</mi></mrow><mo stretchy="true">̂</mo></mover>'),
    (r"\overline{xy}", '<mrow class="math-overline"><mi>x</mi><mi>y</mi></mrow>'),
    (r"\underline{x}", '<mrow class="math-underline"><mi>x</mi></mrow>'),
    (r"\overset{iid}{\sim}", "<mover><mo>∼</mo><mrow><mi>i</mi><mi>i</mi><mi>d</mi></mrow></mover>"),
    (r"\left(\frac{a}{b}\right)", '<mrow><mo stretchy="true" fence="true">(</mo><mfrac><mi>a</mi><mi>b</mi></mfrac><mo stretchy="true" fence="true">)</mo></mrow>'),
    (r"\left.x\right|", '<mrow><mi>x</mi><mo stretchy="true" fence="true">|</mo></mrow>'),
    (r"\left(a\middle|b\right)", '<mrow><mo stretchy="true" fence="true">(</mo><mi>a</mi><mo stretchy="true" fence="true">|</mo><mi>b</mi><mo stretchy="true" fence="true">)</mo></mrow>'),
    (r"\big(", '<mo stretchy="true" minsize="1.2em" maxsize="1.2em">(</mo>'),
    (r"\mathbb{R}", "<mi>ℝ</mi>"), (r"\mathcal{L}", "<mi>ℒ</mi>"),
    (r"\mathbb{R}^2", "<msup><mi>ℝ</mi><mn>2</mn></msup>"),
    (r"\mathrm{d}", '<mi mathvariant="normal">d</mi>'),
    (r"\mathrm{Var}", "<mi>Var</mi>"),
    (r"\boldsymbol{\beta}", "<mi>\U0001d737</mi>"),
    (r"\boldsymbol{\Gamma}", "<mi>\U0001d6aa</mi>"),
    (r"\mathbf{x}", "<mi>\U0001d431</mi>"),
    (r"\mathbf{\alpha}", "<mi>α</mi>"),
    (r"x\displaystyle\sum", '<mi>x</mi><mstyle displaystyle="true"><mo largeop="true" movablelimits="true">∑</mo></mstyle>'),
    (r"{\textstyle\sum} x", '<mstyle displaystyle="false"><mo largeop="true" movablelimits="true">∑</mo></mstyle><mi>x</mi>'),
]

ACCEPTANCE = [
    r"s = \sqrt{\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar{x})^2}",
    r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}",
    r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)",
    r"\Phi(a) = \int_{-\infty}^{a} f(x)\,dx",
    r"\Phi(z) = \int_{-\infty}^{z} \frac{1}{\sqrt{2\pi}} e^{-t^2/2}\,dt",
]

@pytest.mark.parametrize("src,inner", STRUCT)
def test_structure_cases(src, inner):
    assert _body(latex_to_mathml(src, display=False)) == inner

@pytest.mark.parametrize("src", ACCEPTANCE)
@pytest.mark.parametrize("display", [False, True])
def test_acceptance_formulas_convert(src, display):
    out = latex_to_mathml(src, display)
    tree = ET.fromstring(out)                      # well-formed XML
    assert tree.tag == "math" and tree.find("semantics/annotation").text == src
    if r"\left" not in src:
        assert 'stretchy="true"' not in out
    assert "<munderover>" in out or r"\sum" not in src
```

Also pin these acceptance points:
- in formula 1, the brackets around `x_i-\bar{x}` are `stretchy="false"`;
- in formula 3, the minus after `\left(` carries `lspace="0em" rspace="0em"`.

Also add the `\sqrt`-chain depth case to `test_errors`.

Every expected string in `CASES` and `STRUCT` is the **whole** body of the
top `<mrow>`, so a missing argument, a misplaced child or a style leaking past
its group fails. Also add each remaining accent of the spec's Accents row to
`STRUCT` as a full body: `\tilde \dot \ddot` carry `class="math-acc"`,
`\widetilde` is `stretchy="true"` U+02DC with no class.

Add these to `test_errors`:
- `\frac{a}` → "`\frac` needs 2 arguments";
- `\left(x` → "missing `\right`";
- `x\right)` → "missing `\left`".

- [ ] **Step 2: Write the failing fuzz test (Review Focus 2)**

```python
def test_converter_never_raises_unexpected():
    rng = random.Random(1118)
    alphabet = list("abxy12^_{}[]()\\|'+-=., \n") + [r"\frac", r"\sqrt", r"\left", r"\right", r"\sum", "μ", "≤"]
    for _ in range(3000):
        src = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 80)))
        try:
            latex_to_mathml(src, display=bool(rng.getrandbits(1)))
        except LatexError:
            pass
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_latex_mathml.py -q`
Expected: the new cases FAIL with "unknown command".

- [ ] **Step 4: Implement the structures**

Add them to `COMMANDS`:
- `\over` and `\choose` split the current group;
- the Letterlike gaps are a small dict consulted before the Mathematical
  Alphanumeric offset arithmetic;
- function spacing follows the spec's Functions row exactly.

- [ ] **Step 5: Run the tests and see them pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_latex_mathml.py -q`
Expected: all pass, the fuzz loop included.

- [ ] **Step 6: Review lanes, then commit on the owner's OK**

```bash
git add backend/mathion/latex_mathml.py backend/tests/test_latex_mathml.py
git commit -m "feat(math): fractions, operators, functions, accents and fonts in the converter"
```

### Task 4: Markdown hook (dollar rules, render rules, sanitiser, asset extraction)

**Files:**
- Modify: `backend/mathion/markdown.py` (setup near `:226-230`, `_ALLOWED_TAGS`/`_ALLOWED_ATTRS`/`_ALLOWED_CLASSES` near `:236-258`, `render_markdown` docstring, `extract_asset_filenames` near `:301`)
- Test: `backend/tests/test_markdown.py` (update the old wrapper pins near `:40-48`, `:141`, `:379-381`)
- Test: `backend/tests/test_asset_markdown.py`

**Interfaces:**
- Consumes: `latex_to_mathml`, `LatexError` (Tasks 2–3).
- Produces:
  - `MATHML_ALLOWED: dict[str, set[str]]`, the per-tag MathML attribute map
    merged into `_ALLOWED_ATTRS`;
  - `math_inline_rule(state, silent) -> bool`, Mathion's inline rule for `$`
    and `$$`; Task 5 reuses it;
  - `render_math(src: str, display: bool, in_paragraph: bool) -> str`, which
    returns MathML or the error span/div, already escaped;
  - the updated `_clean`.

The spec section this task covers is "Where it hooks in", all bullets.

- [ ] **Step 1: Write the failing dollar-rule table (Review Focus 1)**

```python
@pytest.mark.parametrize("md,has_math,raw_kept", [
    (r"$n$ is the sample size, here 30", 1, None),
    (r"$\alpha$=0.05", 1, None),
    ("With $n$ = 30", 1, None),
    ("It costs $5 and $10", 0, "$5 and $10"),
    ("$5-$10", 0, "$5-$10"),
    ("2$x$", 0, "2$x$"),
    ("$ x $", 0, "$ x $"),
    ("$5 and $10 and $x$", 1, "$5 and $10 and "),
    (r"$x = 5\$$", 1, None),
    (r"\$$x$", 1, None),
    (r"a \$ b", 0, "a $ b"),
    ("see $$ x $$ here", 1, None),
    ("text\n$$\nx\n$$", 1, None),
    ("costs $$5", 0, "costs $$5"),
    ("`$x$`", 0, "$x$"),
])
def test_dollar_rule_cases(md, has_math, raw_kept):
    out = render_markdown(md)
    assert out.count("<math") == has_math
    if raw_kept:
        assert raw_kept in out
```

- [ ] **Step 2: Write the failing block, render and sanitiser tests**

```python
def test_display_block_own_paragraph():
    out = render_markdown("$$\nx^2\n$$")
    assert out.startswith('<div class="math-display"><math display="block">')

def test_display_inside_paragraph_is_span():
    out = render_markdown("a $$x$$ b")
    assert '<p>a <span class="math-display"><math display="block">' in out and "</span> b</p>" in out

def test_blockquote_display_drops_markers():
    out = render_markdown("> $$\n> x\n> $$")
    assert '<blockquote>\n<div class="math-display"><math display="block"><semantics><mrow><mi>x</mi></mrow>' in out

def test_list_item_display():
    assert '<li>\n<div class="math-display"><math display="block">' in render_markdown("- $$\n  x\n  $$")

def test_unclosed_display_stops_at_blank_line():
    out = render_markdown("$$\nx\n\nnext para")
    assert "<p>next para</p>" in out

def test_backslash_parity():
    assert render_markdown(r"\\$x$").count("<math") == 1      # escaped backslash, live dollar
    assert render_markdown(r"\$x$").count("<math") == 0

def test_display_error_inside_paragraph_is_span():
    assert '<p>a <span class="math-error"' in render_markdown(r"a $$\foo$$ b")

def test_two_displays_on_one_line_fall_through():
    assert render_markdown("$$a$$ and $$b$$").count('<span class="math-display">') == 2

def test_escaped_closing_double_dollar_falls_through():
    out = render_markdown(r"$$x\$$")
    assert "<math" not in out and "math-error" not in out and out.startswith("<p>")

def test_error_span_escapes_source_and_reason():
    out = render_markdown(r"$\foo<b>$")
    assert out.count('class="math-error"') == 1 and "<b>" not in out
    assert 'title="unknown command `\\foo`"' in out

def test_error_block_is_div():
    assert render_markdown("$$\n\\foo\n$$").startswith('<div class="math-error"')

def test_unexpected_converter_exception_becomes_error_span(monkeypatch):
    monkeypatch.setattr(markdown_mod, "latex_to_mathml", lambda s, d: 1 / 0)
    assert 'title="formula could not be read"' in render_markdown("$x$")

def test_sanitiser_keeps_mathml_and_drops_unknown_classes():
    out = _clean('<span class="evil math-error" title="r">x</span><math><mi onclick="x">a</mi></math>')
    assert 'class="math-error"' in out and "evil" not in out and "onclick" not in out and 'title="r"' in out
    assert "<math><mi>a</mi></math>" in out
    out = _clean('<math><mo class="math-acc evil">a</mo><mrow class="math-overline math-underline evil">b</mrow><mi class="math-acc">c</mi></math>')
    assert '<mo class="math-acc">' in out and '<mrow class="math-overline math-underline">' in out
    assert "evil" not in out and '<mi class' not in out

SANITISE = ACCEPTANCE + [r"\binom{n}{k}", r"\big(\dfrac{a}{b}\big)", r"\underline{x}",
    r"\lim_{n\to\infty}", r"a\,b", r"\sqrt[3]{x}", r"\text{a b}", r"\mathrm{d}x", r"\tfrac12",
    r"\left(-x\right)", r"\hat{\beta}", r"\sum\limits_i", r"\overline{x}", r"\bar{x}"]

def _tree(markup):                       # nested tags, attributes, exact text and tails
    def walk(e):
        return (e.tag, sorted(e.attrib.items()), e.text or "", [walk(c) for c in e], e.tail or "")
    return walk(ET.fromstring(markup.replace("&nbsp;", "\u00a0")))

@pytest.mark.parametrize("src", SANITISE)
@pytest.mark.parametrize("display", [False, True])
def test_sanitiser_keeps_every_emitted_tag_and_attribute(src, display):
    raw = latex_to_mathml(src, display)
    assert _tree(_clean(raw)) == _tree(raw)

SPEC_MAP = {   # copied from the spec's sanitiser map, independent of markdown.py
    "math": {"display"}, "semantics": set(), "annotation": {"encoding"}, "mrow": set(),
    "mi": {"mathvariant"}, "mn": set(), "mtext": set(), "mspace": {"width"},
    "mo": {"stretchy", "largeop", "movablelimits", "fence", "form", "lspace", "rspace", "minsize", "maxsize"},
    "msup": set(), "msub": set(), "msubsup": set(), "mfrac": {"linethickness"}, "msqrt": set(),
    "mroot": set(), "mover": {"accent"}, "munder": {"accentunder"}, "munderover": set(),
    "mstyle": {"displaystyle"},
}

def test_allowlist_matches_spec():
    assert MATHML_ALLOWED == SPEC_MAP

@pytest.mark.parametrize("tag,attrs", SPEC_MAP.items())
def test_every_allowed_tag_and_attribute_survives_clean(tag, attrs):
    inner = "<" + tag + "".join(f' {a}="v"' for a in sorted(attrs)) + ">t</" + tag + ">"
    snippet = inner if tag == "math" else "<math>" + inner + "</math>"
    assert _tree(_clean(snippet)) == _tree(snippet)

def test_render_markdown_never_raises():
    rng = random.Random(1118)
    pool = [chr(c) for c in range(32, 0x2FFF, 37)] + list("$\\{}^_\n") + ["$$", r"\frac", r"\left", r"\sqrt"]
    for n in (1, 50, 400, 1990, 2010):
        for _ in range(60):
            render_markdown("".join(rng.choice(pool) for _ in range(n)))

def test_asset_extraction_ignores_math_code_and_escapes():
    assert extract_asset_filenames(r"$E[X](t)$ and ![a](pic.png)") == {"pic.png"}
    assert extract_asset_filenames("`[x](y)` and \\[a\\](b)") == set()
```

`ACCEPTANCE` comes from `tests.test_latex_mathml`. Import it at the top of
`test_markdown.py`, together with `random` and
`xml.etree.ElementTree as ET`. `test_latex_mathml.py` imports `html`,
`random` and `ET` too.

`MATHML_ALLOWED` is the per-tag MathML map that Task 4 adds to
`markdown.py`; the test imports it from there.

Update the old wrapper tests to the new forms. The case
`$x = https://example.org$` now typesets. Assert one `<math` and no bare-URL
link inside it.

- [ ] **Step 3: Run the tests and see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_markdown.py tests/test_asset_markdown.py -q`
Expected: the new tests FAIL; old wrapper output is still produced.

- [ ] **Step 4: Implement in `markdown.py`**
  - **Setup:** `dollarmath_plugin(_md, allow_labels=False, allow_blank_lines=False, double_inline=True)`.
  - **Inline rule:** replace its inline rule with `math_inline_rule`
    (`_md.inline.ruler.at("math_inline", …)`), which implements the spec's
    opener, closer and `$$` rules.
  - **Block rule:** wrap the plugin's `math_block` block rule as the spec
    says: rebuild with `getLines`, trim, strip `$$`; on fall-through pop the
    token, restore `state.line` and return False.
  - **Render rules:** `add_render_rule` for `math_inline`,
    `math_inline_double` and `math_block`, all through `render_math`. The
    callbacks take the renderer's `self`.
    - `render_math` catches `LatexError`, and any other `Exception` as
      "formula could not be read".
    - It escapes source and reason with `html.escape(quote=True)`.
  - **Sanitiser maps:**
    - add the per-tag MathML map from the spec;
    - remove `class` from `span`/`div` attributes;
    - `_ALLOWED_CLASSES` gains `span: {math-display, math-error}`,
      `div: {math-display, math-error}`, `mo: {math-acc}` and
      `mrow: {math-overline, math-underline}`.
  - **Asset extraction:** `extract_asset_filenames` reads `link_open` and
    `image` tokens from `_md.parse(text)` instead of the raw `_LINK_REF`
    regex. That way math, code spans, `pre` and escaped brackets never count
    as links; the OLX import relies on this.
  - **Docstring:** drop the KaTeX line.

- [ ] **Step 5: Run the backend suite and see it pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 6: Review lanes, then commit on the owner's OK**

```bash
git add backend/mathion/markdown.py backend/tests/test_markdown.py backend/tests/test_asset_markdown.py
git commit -m "feat(math): typeset dollar math in Markdown as MathML"
```

### Task 5: Option text, publish and clone re-render, migration

**Files:**
- Create: `backend/alembic/versions/<rev>_option_text_html.py` (`down_revision = "d9a4c2e7f1b3"`)
- Modify:
  - `backend/mathion/markdown.py`: add `render_option_text`;
  - `backend/mathion/models.py:158-168`: the `text_html` column and the
    `@validates("text")` hook;
  - `backend/mathion/schemas.py:387`: `OptionResponse.text_html: str`;
  - `backend/mathion/api/content.py:216`: the option dict gains
    `"text_html"`;
  - `backend/mathion/api/version_clone.py:115,167`: re-render
    `Block.info_html`;
  - `backend/mathion/api/versions.py:315-347`: the publish re-render covers
    blocks and options.
- Test:
  - `backend/tests/test_option_text_html.py` (new);
  - `backend/tests/test_migration_option_text_html.py` (new, shaped like
    `test_migration_from_quotes.py`);
  - `backend/tests/test_version_clone.py`;
  - `backend/tests/test_content.py`.

**Interfaces:**
- Consumes: `math_inline_rule`, `render_math` and `_clean` (Task 4).
- Produces:
  - `render_option_text(text: str) -> str`;
  - `AnswerOption.text_html: Mapped[str]` (Text, not null), set whenever
    `text` is set;
  - `text_html` in `OptionResponse` and in the student option dicts.
  - The frontend (Task 6) and the OLX import consume them.

- [ ] **Step 1: Write the failing tests**

Use the real fixtures from `backend/tests/conftest.py`: `db` and the API
client, plus the existing builders that `test_questions_api.py` and
`test_version_clone.py` use for versions, questions and options.

```python
def test_render_option_text():
    assert render_option_text("a < b") == "a &lt; b"
    assert render_option_text(r"$\mu$ = 5").startswith("<math><semantics>")
    assert render_option_text(r"\$5") == "$5"
    assert "display" not in render_option_text("$$x$$")
    assert render_option_text("**b**") == "**b**"

def test_model_hook_sets_text_html():                 # no database needed
    o = AnswerOption(question_id=1, text="$x$", is_correct=True, order=1)
    assert "<math" in o.text_html
    o.text = "plain"
    assert o.text_html == "plain"
```

Write one test per write path. The edit, clone and publish tests first make
the stored HTML stale (`"STALE"`, through a direct SQL `UPDATE`), then run the
path and assert the exact new HTML. The create test asserts the returned and
the persisted `text_html` directly.
- `test_editor_create_option_fills_text_html`: POST an option `"$x$"`;
- `test_editor_edit_option_rerenders_text_html`;
- `test_clone_rerenders_option_text_html`;
- `test_publish_rerenders_option_text_html`;
- `test_clone_rerenders_block_info`: stale `info_html` and `info = "$x$"`;
- `test_publish_rerenders_block_info`.

Also update `test_version_clone.py:175`: the verbatim-copy assertion
`nb.info_html == "<p>Block info</p>"` becomes
`nb.info_html == render_markdown("Block info")`. The OLX import plan adds its
own write-path test; this plan does not.

Also write `test_student_content_options_carry_text_html`. It asserts the
student content payload's option dict has `text_html` equal to the stored
value.

Also write `test_math_surfaces`. It asserts `<math` in the response or the
stored HTML for each of these:
- `POST /api/versions/{id}/render`;
- `POST /api/runs/{id}/render`;
- a page save;
- a question text and explanation save;
- a block info save;
- version info;
- a mini-project assignment save (find its endpoint with
  `grep -rn assignment_md backend/mathion/api`).

The migration test is `test_migration_option_text_html.py`, shaped exactly
like `test_migration_from_quotes.py`'s `_migrate_again`, with
`BEFORE = "d9a4c2e7f1b3"`:
1. close the session and downgrade to `BEFORE`;
2. insert the parent rows and an option with text `a<b` in old-schema SQL;
3. upgrade to head;
4. assert `text_html == "a&lt;b"`, the column is NOT NULL, and it has no
   server default;
5. in a second test, downgrade to `BEFORE` and inspect: there is no
   `text_html` column;
6. always `command.upgrade(_cfg(), "head")` in `finally`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_option_text_html.py tests/test_migration_option_text_html.py -q`
Expected: FAIL (`render_option_text` and `text_html` are missing).

- [ ] **Step 3: Implement**
  - **`render_option_text`:** a module-level `MarkdownIt("zero")`. Register
    `math_inline_rule` on its inline ruler explicitly, then enable `escape`,
    `text` and that rule, plus render rules that
    call `render_math(…, display=False, in_paragraph=False)` for both inline
    token types. Return `_clean(md.renderInline(text))`.
  - **Model hook:** `@validates("text")` returns the value and sets
    `self.text_html`. If importing `mathion.markdown` from `models.py`
    creates a cycle, use the spec's fallback `set_option_text` and record it
    as a `Ruling:` line.
  - **Migration:** follow `d9a4c2e7f1b3`'s frozen-helper pattern:
    1. add the column with `server_default=''`;
    2. run a per-row loop with an inline `html.escape`;
    3. `alter_column(server_default=None)`.

    The downgrade drops the column.
  - **Clone:** `info_html=render_markdown(sb.info or "")`, as
    `api/blocks.py:89` does.
  - **Publish:** add a loop over the version's blocks that sets
    `block.info_html = render_markdown(block.info or "")`, and a loop over its
    options that re-runs the setter, so `text_html` is re-rendered.

- [ ] **Step 4: Run the backend suite and see it pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 5: Migrate the dev DB and check it**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/alembic upgrade head && .venv/bin/alembic current`
Expected: the new revision id `(head)`.

- [ ] **Step 6: Review lanes, then commit on the owner's OK**

```bash
git add backend/alembic/versions/*_option_text_html.py backend/mathion/markdown.py backend/mathion/models.py backend/mathion/schemas.py backend/mathion/api/content.py backend/mathion/api/version_clone.py backend/mathion/api/versions.py backend/tests/test_option_text_html.py backend/tests/test_migration_option_text_html.py backend/tests/test_version_clone.py backend/tests/test_content.py
git commit -m "feat(math): typeset answer choices; publish and clone re-render block info and options"
```

### Task 6: Frontend data and components

**Files:**
- Modify:
  - `frontend/src/lib/types.ts:122,127`: add `text_html: string` to both
    option types;
  - `frontend/src/lib/quizAuthoring.ts:7`: add it to `AuthoringOption`;
  - `frontend/src/tests/support/quizHarness.svelte.ts`;
  - `frontend/src/components/items/quiz/SingleChoiceQuestion.svelte:57` and
    `MultiChoiceQuestion.svelte:69`:
    `<span class="opt-text">{@html opt.text_html}</span>`;
  - `frontend/src/components/editor/quiz/ChoiceRow.svelte:50,53`:
    `{@html opt.text_html}` inside `.ans-text` and the edit button.
    `cutName(opt.text)` stays.
  - `frontend/src/components/editor/quiz/ChoiceAnswers.svelte:253`: merge
    `text_html: echo.text_html`;
  - `frontend/src/components/editor/quiz/QuizBody.svelte:276`: remove
    `annotation` nodes before `textContent`;
  - `frontend/scripts/visual-refresh-gate.sh`: the choice-template pins.
    - The DOM-order signature near `:1646` gains the `.opt-text` span and the
      `@html` node.
    - The old `label:opt…:{expr}` expression markers near `:1791` are removed.
    - The node and tag allowlists (`:1445-1452`) already hold `HtmlTag` and
      `span`, and need no change.
    - `own ans-row` (`:4684`) is CSS; Task 7 handles it.
- Test:
  - `frontend/src/tests/SingleChoiceQuestion.svelte.test.ts`;
  - `frontend/src/tests/MultiChoiceQuestion.svelte.test.ts`;
  - `frontend/src/tests/ChoiceAnswers.svelte.test.ts`;
  - `frontend/src/tests/QuizBody.svelte.test.ts` (new; no QuizBody
    component test exists today).

**Interfaces:**
- Consumes: `text_html` on options from the API (Task 5).
- Produces: the `.opt-text` and `.ans-text` wrappers that Task 7 styles.

- [ ] **Step 1: Write the failing component tests**

Use each test file's existing `question()` and `render()` helpers, which
already pass the required `value` and `onanswer` props. Extend `question()`
so every option carries `text_html`.

```ts
it('shows typeset option html inside one opt-text span', () => {
  const host = render({ question: { ...question(), options: [{ id: 1, text: '$x$', text_html: 'a <math><mi>x</mi></math> b' }] } });
  const span = host.querySelector('.opt .opt-text')!;
  expect(span.innerHTML).toContain('<math>');
  expect(span.textContent).toBe('a x b');          // spaces kept around the formula
});
```

Write the same test for `MultiChoiceQuestion`. Add these:
- **ChoiceAnswers:** after an inline text save whose echo has a new
  `text_html`, the row shows the echoed html.
- **QuizBody** (new test file): the delete-confirm title for a question
  whose `text_html` is
  `<p>a <math><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math></p>`
  equals the visible text `a x2`, so no annotation text is read at all.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/SingleChoiceQuestion.svelte.test.ts src/tests/MultiChoiceQuestion.svelte.test.ts src/tests/ChoiceAnswers.svelte.test.ts src/tests/QuizBody.svelte.test.ts`
Expected: FAIL (no `.opt-text`, no `text_html`).

- [ ] **Step 3: Implement the changes listed under Files**

Update every test fixture that builds options so it carries `text_html`.

- [ ] **Step 4: Run the frontend suite, check and gate**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test && npm run check && zsh scripts/visual-refresh-gate.sh`
Expected: all green, and the gate passes with the updated template pins.

- [ ] **Step 5: Review lanes, then commit on the owner's OK**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/quizAuthoring.ts frontend/src/tests frontend/src/components/items/quiz/SingleChoiceQuestion.svelte frontend/src/components/items/quiz/MultiChoiceQuestion.svelte frontend/src/components/editor/quiz/ChoiceRow.svelte frontend/src/components/editor/quiz/ChoiceAnswers.svelte frontend/src/components/editor/quiz/QuizBody.svelte frontend/scripts/visual-refresh-gate.sh
git commit -m "feat(math): show typeset answer choices"
```

### Task 7: Look, font and caching

**Files:**
- Create: `frontend/src/styles/fonts/STIXTwoMath-Regular.woff2` (Task 1's
  ruling: STIX Two Math) with its licence `STIXTwoMath-OFL.txt` next to it.
- Create: `docs/release-notes/math-typesetting.md` (one paragraph: "re-save
  or re-publish to typeset existing formulas").
- Modify:
  - `frontend/src/styles/fonts.css`: `@font-face` with `font-display: swap`;
  - `frontend/src/styles/content.css`: add top-level rules for `math`,
    `.math-display` (div and span), `.math-display > math`, `.math-error` and
    `.prose p:has(math)`, and add `div.math-display, div.math-error` to the
    four `.prose :where(…, div.math)` spacing lists, keeping `div.math`.
    Values from Task 1: `.math-display` `padding-block: 0.5em`;
    `.prose p:has(math)` `padding: 0.35em 4px; margin-inline: -4px`;
    `mrow.math-overline { border-top: 0.06em solid; padding-top: 0.08em }`,
    `mrow.math-underline { border-bottom: 0.06em solid; padding-bottom: 0.08em }`;
    `@supports (font: -apple-system-body) { mo.math-acc { position: relative; top: 0.2em } }`;
  - `SingleChoiceQuestion.svelte` / `MultiChoiceQuestion.svelte`:
    `.opt-text { overflow-x: auto; min-width: 0; padding-block: 0.35em }`;
  - `ChoiceRow.svelte`: `.ans-text` overflow and `padding-block: 0.35em`;
  - `frontend/src/components/editor/MarkdownEditor.svelte`:
    `.preview :global(.math-error)::after { display: block; content: attr(title); }`;
  - `frontend/scripts/visual-refresh-gate.sh`:
    - the new rule hashes and the (b4) inventory;
    - section (n)'s shared Single/Multi `want()` inventory (`:3045`, which
      rejects extra selectors at `:3119`) gains `.opt-text` with its
      declarations;
    - the ChoiceRow `own ans-row` CSS section (`:4684`) gains the `.ans-text`
      overflow declaration;
    - the `GLOBAL_ALLOW` entry
      `('src/components/editor/MarkdownEditor.svelte', '.math-error')`, plus
      a declaration check that pins `content: attr(title)` and
      `display: block`;
  - `backend/mathion/main.py:262`: in the file branch of `_spa_fallback`,
    `Cache-Control: public, max-age=31536000, immutable` when
    `full_path.startswith("_app/")`.
- Test:
  - `backend/tests/test_main_spa.py`;
  - `frontend/src/tests/MarkdownEditor.svelte.test.ts`;
  - the `PageItem` component test (existing file if one is there, otherwise
    `frontend/src/tests/PageItem.svelte.test.ts`).

  These two frontend tests are regression checks and may pass from the
  start.

**Interfaces:**
- Consumes: the class names from Tasks 4 and 6, and the font ruling from
  Task 1.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

Add these to `backend/tests/test_main_spa.py`, using its
`_client_with_dist(tmp_path, monkeypatch)` helper. That helper writes
`dist/_app/bundle.js`. Write `dist/robots.txt` in the test as the
non-`_app` file.

```python
def test_hashed_app_files_are_immutable(tmp_path, monkeypatch):
    c = _client_with_dist(tmp_path, monkeypatch)
    r = c.get("/_app/bundle.js")
    assert r.text == "console.log('hi')"
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"

def test_other_paths_keep_their_headers(tmp_path, monkeypatch):
    c = _client_with_dist(tmp_path, monkeypatch)
    (tmp_path / "dist" / "robots.txt").write_text("x")
    assert "immutable" not in c.get("/robots.txt").headers.get("cache-control", "")
    missing = c.get("/_app/missing.js")                 # SPA fallback page
    assert "immutable" not in missing.headers.get("cache-control", "")
    assert c.get("/").headers["cache-control"] == "no-cache"
    assert c.get("/index.html").headers.get("cache-control") != "public, max-age=31536000, immutable"
    assert c.get("/superuser").headers["cache-control"] == "no-store"
```

```ts
// MarkdownEditor.svelte.test.ts: its own stubCtx / mountEditor pattern (see :34, :52, :820)
it('preview keeps the error span and its reason title', async () => {
  vi.mocked(stubCtx.renderPreview).mockResolvedValue({ html: '<p><span class="math-error" title="unknown command `\\foo`">$\\foo$</span></p>' });
  const { target } = mountEditor({ readOnly: true });
  await vi.waitFor(() => expect(target.querySelector('.preview .math-error')?.getAttribute('title')).toBe('unknown command `\\foo`'));
});
// PageItem.svelte test: its existing target / makeItem() / mount / flushSync pattern
it('old stored div.math content still renders', () => {
  const c = mount(PageItem, { target, props: { item: makeItem('<div class="math block">x</div>') } });
  flushSync();
  expect(target.querySelector('.prose div.math')!.textContent).toBe('x');
  unmount(c);
});
```

jsdom cannot read `::after`. The preview-reason rule is pinned by the gate
entry and checked in Task 8; the component test only asserts that the span
and its title reach the DOM.

- [ ] **Step 2: Run them and see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest tests/test_main_spa.py -q`
Expected: the immutable test FAILS (no header).

- [ ] **Step 3: Implement the files listed above**

Copy the chosen font from the probe folder; its SHA-256 must match the
ledger. Merge any existing headers with the new Cache-Control header.

- [ ] **Step 4: Run all three suites**

Run:
1. `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
2. `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test && npm run check`
3. `zsh /Users/svkucheryavski/Documents/Developing/mathion/frontend/scripts/visual-refresh-gate.sh`

Expected: all green.

- [ ] **Step 5: Review lanes, then commit on the owner's OK**

```bash
git add frontend/src/styles frontend/src/components/items/quiz/SingleChoiceQuestion.svelte frontend/src/components/items/quiz/MultiChoiceQuestion.svelte frontend/src/components/editor/quiz/ChoiceRow.svelte frontend/src/components/editor/MarkdownEditor.svelte frontend/scripts/visual-refresh-gate.sh frontend/src/tests backend/mathion/main.py backend/tests/test_main_spa.py docs/release-notes/math-typesetting.md
git commit -m "feat(math): math font, formula styles and immutable caching of hashed files"
```

### Task 8: Browser pass in the running app

**Files:** none (results go to the ledger; findings to `docs/backlog/` only
with the owner's OK).

**Interfaces:**
- Consumes: the whole branch.
- Produces: the ledger lines for each check.

- [ ] **Step 1: Start the dev servers and create the test content**
  - Restart the backend with `MATHION_ASSET_PATH` set, after the gate runs
    (it caches `index.html`).
  - Create in a draft:
    - a page with the five acceptance formulas;
    - the Review Focus 1 sentences;
    - an over-wide display formula;
    - tall inline math;
    - a broken formula;
    - a quiz whose choices hold inline math.

- [ ] **Step 2: Chrome checks, run myself in agent-browser at 1280px and 400px**

  Screenshot each one and Read the screenshot. These are the spec's
  first-task checks, now in the app:
  - `movablelimits`;
  - `\dfrac`;
  - accents and primes;
  - non-stretching brackets;
  - the over-wide formula scrolls with both ends reachable;
  - tall inline math is not clipped, with no vertical scrollbar;
  - list markers and link focus rings are intact at 400px;
  - the font-swap look;
  - the preview shows the error reason, while the student view shows only
    the marked source.

  Expected: each holds. A failure applies the spec's named fallback, with a
  RED→GREEN test where one is possible, and goes back through the review
  lanes.

- [ ] **Step 3: Owner's Safari and Firefox steps, one at a time in the terminal**

  Repeat every applicable check of Step 2, since app CSS can change Task 1's
  results:
  - limits placement;
  - `\dfrac`;
  - accents and primes;
  - brackets;
  - the scroll box;
  - clipping;
  - list markers and link focus rings at 400px;
  - the font-swap look.

  Give exact URLs and what to look at.
  Expected: the owner confirms each.

- [ ] **Step 4: Check caching on the built app served by FastAPI**

  Run `npm run build`, then restart the backend and use port 8000, not the
  Vite server: only FastAPI's `_spa_fallback` sets the header. In
  agent-browser, watch the network:
  - on a page **without** formulas, there is no math-font request;
  - on the second load of a formula page, the font and the `/_app/` files
    come from the cache, with no revalidation request.

Then the whole-branch review: fresh Opus + Fable on `main..HEAD`, plus Codex.
After it, cleanup and the merge question.
