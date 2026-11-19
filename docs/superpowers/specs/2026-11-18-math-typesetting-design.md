# Math typesetting — design (rev 7)

Rev 2 answered the builder check: the stricter dollar rule (owner's call), and
no backfill before the beta, per the owner's recorded rule VR-B12.
Rev 3 folds in the spec review (two Opus lanes, one Fable lane): Mathion's own
inline dollar rule (the plugin drops a formula that starts a line ending in a
digit), non-stretching plain brackets, unary minus and function spacing, the
limits rule via `movablelimits`, unbraced arguments, primes, a wider symbol
table, a scroll box for display math, `text_html` on every option path, block
info re-rendered on publish and clone, and math kept out of asset-link
extraction.
Rev 4 folds in the rev 3 re-review (fresh Opus): in-paragraph display math as
a block `span` (a `div` inside `p` is split by nh3), exact closer and `$$`
rules, the block wrapper's line handling, choice-text wrapper spans, exact
overflow selectors, a reachable scroll box, `:global` for the preview reason,
and spacing details.
Rev 5 folds in the rev 4 re-review: `$$` has no space or digit tests, and a
`$` next to another `$` never opens or closes a single-dollar formula; the
block wrapper's fall-through cleanup; plain component selectors; the gate's
choice-template pins; and small look details.
Rev 6 records the font task (plan Task 1) in Chrome, Firefox and Safari. The
owner picked STIX Two Math. `\hat` uses U+02C6, because U+005E hits capitals.
`\widehat` uses U+0302. Safari draws narrow accents 0.2em too high, so they
get a marker class and a Safari-only nudge. `\overline` and `\underline`
become a CSS line on an `mrow`, because their stretchy glyphs break in Safari
and in Latin Modern. Exact paddings: 0.35em on inline boxes, 0.5em on display
math, 4px inline on `p:has(math)` for the focus ring.
Rev 7 records the Task 2 review. Operators inside scripts are tight, as in
LaTeX (owner). A typed symbol gives the same node as its command. `\partial`
and `\nabla` are upright. The ellipses, `\$`, `\#` and `.` get no
operator spacing. Input is NFC-normalised and invisible format characters
are dropped. Other control characters are an error. Typed brackets
(`⟨ ⌊ ‖`) act like their commands; a pasted en dash is a minus and a curly
apostrophe a prime.

## Intent

Mathion is for teaching mathematics and statistics. Its Markdown already
accepts LaTeX (`$…$` inline, `$$…$$` on its own line), but nothing typesets
it. The server wraps math in `<span class="math inline">` /
`<div class="math block">` (`backend/mathion/markdown.py`, mdit
`dollarmath_plugin`), no code draws it, and students see the LaTeX source.
Typesetting was deferred in the first student slice (May, "Q7: defer
entirely") and never backlogged. The owner considers it essential, and the
Open edX import (`docs/superpowers/specs/2026-11-18-olx-import-design.md`)
needs it, so it ships first, before the beta.

Mathion turns LaTeX into **MathML** on the server with its **own converter**
(no new Python or JS dependency, per the project rule). Chrome, Firefox and
Safari render MathML natively, so the browser loads no script.

## Goals

- `$…$` and `$$…$$` are typeset everywhere Markdown is shown:
  - pages;
  - quiz question text and explanations;
  - course (version) info and block info;
  - mini-project assignments;
  - every editor preview.

  The server renders all of these, including the live preview via
  `POST /api/versions/{id}/render` and `POST /api/runs/{id}/render`.
- Answer choices typeset `$…$` too; they are plain text today.
- The owner's acceptance formulas render correctly, in both written forms:
  ```
  s = \sqrt{\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar{x})^2}
  f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}
  f(x) = \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
  \Phi(a) = \int_{-\infty}^{a} f(x)\,dx
  \Phi(z) = \int_{-\infty}^{z} \frac{1}{\sqrt{2\pi}} e^{-t^2/2}\,dt
  ```
  "Correctly" includes these points:
  - brackets keep their size next to a tall sum;
  - a leading minus has no binary spacing;
  - limits sit under and over `\sum` in `$$…$$` and beside it inline.
- A formula the converter cannot read never breaks the page or blocks saving:
  - it shows its source, marked;
  - authors see the reason in the editor preview.
- Formulas look the same on every device: Mathion ships one free math font.
- Money stays text: `It costs $5 and $10` is not a formula (stricter dollar rule).

## Non-goals (for now; the owner: "inline or one single line so far")

- Multi-row layouts: `\\` line breaks, `aligned`/`align`, `cases`,
  matrices (`pmatrix`, `bmatrix`, `array`), `\begin{…}` of any kind.
- `\newcommand`/macros, colours, `\label`/`\ref`/equation numbers, `\tag`,
  packages (`tikz`, `chemfig`, …), `\href`, `\textbf`.
- Math in titles, report text, CSV exports, emails.
- Typesetting while typing in the quiz option inputs themselves. The inputs
  stay plain text; previews and the student view typeset.
- Copy-paste of a formula as LaTeX. The browser copies the visible
  characters.

## Anti-goals

- Any path where author input reaches the page as unescaped markup.
- A script in the browser to draw math.
- A formula error that hides the rest of the page, blocks saving, or returns
  a server error.

## Approaches considered

1. **Own converter on the server, LaTeX → MathML (chosen by the owner).**
   - One hook in the existing render pipeline.
   - Output is stored in the existing `*_html` fields.
   - No browser script and no dependency.
2. **A proven library as a dependency exception** (Temml, KaTeX). It gives far
   wider LaTeX coverage at once, but breaks the no-dependencies rule.
   Declined.
3. **An own converter in the browser** (TypeScript, run over the `.math` spans
   after display). It would avoid re-rendering stored content. But it touches
   every `{@html}` surface (13 today) and puts the converter on the client,
   while the server already renders everything. Not chosen.

## Design

### Converter (`backend/mathion/latex_mathml.py`, new)

`latex_to_mathml(src: str, display: bool) -> str` returns a `<math>` element
(`display="block"` for display math), or raises `LatexError(reason)`.

- **Pipeline:** tokenise, parse into a small tree, emit MathML. The parser is
  recursive descent over groups `{…}`, scripts `^`/`_`, commands and their
  arguments.
- **Output:**
  `<math …><semantics><mrow>…</mrow><annotation encoding="application/x-tex">SRC</annotation></semantics></math>`.
  - The annotation keeps the source in the stored HTML for future tools.
    Browsers neither show it nor copy it.
  - Screen readers get whatever native MathML reading the platform offers;
    nothing more is promised (VoiceOver pass at the beta).
  - All text is escaped, and only the elements and attributes listed under
    "Where it hooks in" are ever emitted.
- **Limits:**
  - Source over 2 000 characters raises `LatexError("formula too long")`.
  - Nesting deeper than 40 raises `LatexError("formula nested too deeply")`.
    Depth counts every group, every command argument and every script, braced
    or not, so `\sqrt\sqrt\sqrt…` and nested scripts `x^{x^{…}}` hit the limit before Python's
    recursion limit.
- **Whitespace:** spaces and newlines between tokens are ignored, as in LaTeX,
  except inside `\text{…}`. A backslash before a space or newline is a
  control space. Before parsing, the source is NFC-normalised and invisible
  format characters (U+200B, U+FEFF) are dropped, except the joiners
  U+200C/U+200D that `\text` needs; the annotation keeps it as typed.
- **Unbraced arguments:** an unbraced argument of a script or command is one
  character or one command, as in LaTeX. So `\frac12` = ½, `\sqrt2`, `x^\alpha`
  and `x^10` = x¹0. The tokeniser splits a number when it is taken as an
  unbraced argument. "One command" includes that command's own arguments:
  `\sqrt\frac12` = √(½).

**Supported LaTeX (v1):**

| Kind | LaTeX | MathML |
|---|---|---|
| Letters | `a`–`z`, `A`–`Z`, and any other Unicode letter (`μ`, `æ`, `ж`) typed directly | `<mi>`, italic by default; a non-Latin letter gets `mathvariant="normal"` except Greek lowercase (any lowercase Greek letter, accented or symbol forms too; the micro sign `µ` becomes `μ`) |
| Numbers | `12`, `3.14` | one `<mn>` per number (split when taken as an unbraced argument) |
| Operators, relations, punctuation | `+ - = < > ( ) [ ] , ; : ! / . * ? "` and the vertical bar, and any other non-letter Unicode symbol typed directly (`≤`, `−`, `±`) | `<mo>`; `-` → U+2212, `*` → ∗ U+2217; `/`, `.` and a plain bar are ordinary symbols (`lspace="0em" rspace="0em"`), as in TeX, so `-t^2/2` and `P(\lvert Z\rvert<z)` keep tight spacing. A typed symbol from the Symbols row gives the same node as its command (`∞` → `<mi>∞</mi>`, `°` is ordinary); any other typed maths symbol (Unicode Sm, such as `≲` or `⊕`) is a binary operator, and the rest are ordinary (`lspace="0em" rspace="0em"`, so `5€` stays tight) |
| Brackets | plain `( ) [ ] \{ \}` and the bar character, `\langle \rangle \lfloor \rfloor \lceil \rceil \vert \Vert \lvert \rvert \lVert \rVert`, and backslash-bar (the LaTeX double bar ‖) | `<mo stretchy="false">`; they never grow. Every bar form also gets `lspace="0em" rspace="0em"` |
| Primes | `f'`, `f''`, `f'''`, `x_i'`, `f'^2` | `<msup>` with ′ ″ ‴; a prime merges with a following `^` (`<msup>` with `<mrow>′ 2</mrow>`) and with a preceding `_` (`<msubsup>`) |
| Greek | `\alpha`…`\omega` and `\Gamma`…`\Omega` | `<mi>`; capitals get `mathvariant="normal"` (upright) |
| Greek variants | `\epsilon` → ϵ U+03F5, `\varepsilon` → ε U+03B5, `\phi` → ϕ U+03D5, `\varphi` → φ U+03C6, `\vartheta` → ϑ, `\varrho` → ϱ, `\varsigma` → ς, `\varpi` → ϖ | `<mi>` |
| Symbols | `\approx \neq \ne \leq \le \geq \ge \ll \gg \lt \gt \pm \mp \times \cdot \div \ast \star \infty \partial \nabla \sim \simeq \cong \equiv \propto \in \notin \ni \subset \subseteq \supset \supseteq \cup \cap \setminus \emptyset \varnothing \forall \exists \neg \lnot \land \lor \wedge \vee \to \rightarrow \leftarrow \Rightarrow \Leftarrow \Leftrightarrow \iff \implies \mapsto \mid \parallel \perp \top \bot \ell \hbar \ldots \cdots \dots \vdots \ddots \prime \circ \degree \bullet` | `<mo>`, or `<mi>` for `\infty \partial \nabla \emptyset \varnothing \ell \hbar \top \bot` (upright; `\partial` and `\nabla` carry `mathvariant="normal"`, since browsers italicise them), with the Unicode character. `\ldots \cdots \dots` get `lspace="0em" rspace="0em"`, so the neighbouring comma or `+` sets the gap, as in LaTeX |
| Scripts | `x^2`, `x_i`, `x_i^2`, `x^{n+1}`, `{}^{14}C`, `^2` at the start | `<msup>`, `<msub>`, `<msubsup>`; an empty base is `<mrow/>`. Binary, relation and punctuation operators inside a script get `lspace="0em" rspace="0em"`, as in LaTeX (owner, rev 7): `\chi^2_{n-1}`, `\sum_{i=1}^n` |
| Fractions | `\frac{a}{b}`, `\dfrac`, `\tfrac`, `{a \over b}` | `<mfrac>`; `\dfrac`/`\tfrac` wrap it in `<mstyle displaystyle="true"/"false">` |
| Binomial | `\binom{n}{k}`, `{n \choose k}` | `<mrow><mo>(</mo><mfrac linethickness="0">…</mfrac><mo>)</mo></mrow>`; these brackets stretch |
| Roots | `\sqrt{x}`, `\sqrt[3]{x}` | `<msqrt>`, `<mroot>` (base first, then index) |
| Big operators | `\sum \prod \coprod \bigcup \bigcap` | `<munderover>` (or `<munder>`/`<mover>`) with `<mo largeop="true" movablelimits="true">`. The browser puts limits under/over in display style and beside in inline style, inside fractions and in scripts, as LaTeX does |
| Integrals | `\int \iint \iiint \oint` | `<msubsup>` (limits always beside) with `<mo largeop="true">` |
| Limit control | `\limits`, `\nolimits`, `\displaystyle`, `\textstyle` | `\limits` → `movablelimits="false"` (`\int\limits` → `<munderover>`); `\nolimits` → `<msubsup>`; styles → `<mstyle displaystyle>` around the rest of the group |
| Functions | `\log \ln \lg \exp \sin \cos \tan \cot \sec \csc \arcsin \arccos \arctan \sinh \cosh \tanh \det \dim \ker \deg \hom \arg \Pr \gcd`, `\operatorname{Var}` | `<mi>` (multi-letter, so upright) + `<mo>` U+2061. U+2061 follows the whole scripted unit (`<msub><mi>log</mi><mn>2</mn></msub><mo>⁡</mo>`). An `<mspace width="0.1667em"/>` follows unless the next token is an opening or closing bracket, `\left`, a relation, punctuation, or the end of the group |
| Limit-style functions | `\lim \limsup \liminf \max \min \sup \inf \argmax \argmin` | `<mo movablelimits="true" lspace="0em" rspace="0em">lim</mo>` (not in the operator dictionary, so spacing is set explicitly; no U+2061) with `<munder>` like `\sum`; the same `<mspace>` rule as functions follows |
| Unary signs | `+ - \pm \mp` at the start of a group, or after an opening bracket, a relation, an operator, punctuation, a function, a big operator or `\left` | `<mo lspace="0em" rspace="0em">` (TeX's rule). A braced group of one operator (`0{,}05`) is spaced the same way |
| Accents | `\bar` (U+00AF), `\hat` (U+02C6), `\tilde` (U+02DC), `\dot` (U+02D9), `\ddot` (U+00A8), `\vec` (U+2192), `\widehat` (U+0302, stretchy), `\widetilde` (U+02DC, stretchy; only Firefox stretches it, others show a normal tilde); `\overline` / `\underline` | `<mover accent="true">base<mo stretchy="false">…</mo></mover>`; the five narrow accents `\bar \hat \tilde \dot \ddot` add `class="math-acc"` to their `mo` (Safari nudge, see Look), `\vec` does not; wide accents `stretchy="true"`; `\overline{x}` → `<mrow class="math-overline">x</mrow>`, `\underline{x}` → `<mrow class="math-underline">x</mrow>` (a CSS line, no glyph) |
| Stacked | `\overset{a}{b}`, `\underset{a}{b}`, `\stackrel{a}{b}` | `<mover>` / `<munder>` |
| Growing brackets | `\left( … \right)`, also `[ ] \{ \} \| \vert \Vert \langle \rangle \lfloor \rfloor \lceil \rceil .` and `\middle\|` | `<mrow>` with `<mo stretchy="true" fence="true">`; `\left.`/`\right.` emit nothing |
| Fixed big brackets | `\big \Big \bigg \Bigg` (+ `l`/`r` forms) before a bracket | `<mo stretchy="true" minsize="1.2em/1.8em/2.4em/3em" maxsize="…">` |
| Text | `\text{…}` (any Unicode, spaces kept), `\mbox{…}` | `<mtext>`; bare braces inside are grouping only; `\, \: \;` give a thin space, `\quad` an em space, `\!` nothing |
| Letter fonts | `\mathrm \mathit \mathbf \boldsymbol \mathbb \mathcal \mathsf \mathtt` | The content is math (scripts allowed, spaces ignored); the font is applied to its letters. `\mathrm{Var}` → `<mi>Var</mi>`; `\mathrm{d}` → `<mi mathvariant="normal">d</mi>`; other fonts map letters to Unicode Mathematical Alphanumeric Symbols, including the Letterlike gaps (ℝℂℕℚℤℍℙ, ℬℰℱℋℐℒℳℛ, italic ℎ). `\boldsymbol` gives bold italic for italic letters and bold upright for upright capital Greek; `\mathbf` leaves lowercase Greek unbolded, as LaTeX does |
| Spacing | `\, \: \; \quad \qquad \!`, `\ ` and `~` | `<mspace width=…>` (`\!` is negative; Chrome ignores it, which is harmless) |
| Escapes | `\{ \} \$ \% \& \# \_` | the character; `\{ \}` are plain brackets; `\$` and `\#` get `lspace="0em" rspace="0em"` |

**Errors.** Each of these raises a `LatexError` naming the problem:

| Input | Reason |
|---|---|
| unknown command | "unknown command `\foo`" |
| an environment | "`\begin{cases}` is not supported yet" |
| `\\` | "line breaks are not supported yet" |
| unbalanced brace | "missing `}`" / "unexpected `}`" |
| a missing argument | "`\frac` needs 2 arguments" |
| double superscript or subscript (`x^2^3`) | "double superscript" |
| `\left` without `\right` (or the reverse) | "missing `\right`" |
| an empty formula | "empty formula" |
| a bare `&`, `#` or `%` inside math | "write `\&` for a literal `&`" (likewise `\#`, `\%`) |
| a missing script argument (`x^`) | "`^` needs 1 argument" |
| a control, private-use or unassigned character, or a combining mark with no letter to join (`x` + U+0302) | "unsupported character U+0001" |

Any other exception inside the converter is caught by the render rule and
shown as the error span, with the reason "formula could not be read". It is
never a 500.

### Where it hooks in (`backend/mathion/markdown.py`)

- **Dollar rule (owner's call, pandoc-like), as Mathion's own small inline
  rule** registered instead of the plugin's inline rule. The plugin (0.5.0)
  reads `src[pos-1]` at position 0, which is the *last* character, so
  `$n$ is the sample size, here 30` and `$\alpha$=0.05` stay raw text with
  its rule.
  - An inline formula opens with `$` that is not escaped and not preceded by
    a digit, and is directly followed by a non-space.
  - Its closer is the **first** unescaped `$` after the opener. It must be
    directly preceded by a non-space and not followed by a digit; if it fails,
    no formula starts at this opener, the opener stays text, and scanning goes
    on from the next character. So `$5 and $10 and $x$` gives text plus the
    one formula `x`.
  - `$$` is tried before `$`. It has **no** space or digit tests, as in
    LaTeX: it opens at an unescaped `$$` and closes at the first unescaped
    `$$` after it, across newlines. So `see $$ x $$ here` and
    `text\n$$\nx\n$$` both give display math. An unclosed `$$`
    (`costs $$5`) stays text.
  - A `$` directly next to another *unescaped* `$` is never a single-dollar
    opener or closer, so a failed `$$` can never turn into an empty `$…$`.
    `$x = 5\$$` and `\$$x$` still work.
  - So `$5 and $10`, `$5-$10`, `2$x$` and `$ x $` stay text, while
    `$y = x^\alpha$`, `$n$ … 30` and `$\alpha$=0.05` work.
  - `\$` is a literal dollar.
  - `$$…$$` inside a paragraph is display math (as in LaTeX). The plugin's
    block rule does not end a paragraph, so `text\n$$x$$` also takes this
    path. It renders as a block-styled **`span`** (see the render rules),
    because nh3 splits a `div` inside a `p` (probed: the trailing text falls
    out and an empty `<p>` is added).
- **Display blocks** keep the plugin's block rule with
  `allow_labels=False` (numbering is a non-goal) and `allow_blank_lines=False`
  (an unclosed `$$` must not swallow paragraphs, matching LaTeX).
  - Mathion wraps that rule. The token content is rebuilt from
    `state.getLines(startLine, state.line, state.blkIndent, False)`, trimmed
    of whitespace, then stripped of the leading and trailing `$$`. Inside a blockquote or list this
    drops the `>` markers and indentation that the plugin's raw slice keeps.
  - If the rebuilt content contains an unescaped `$`, the wrapper pops the
    token the plugin pushed, restores `state.line`, and returns False, so
    the line falls through to the paragraph rule. It falls through the same
    way when the closing `$$` is preceded by a backslash (`$$x\$$`), which
    keeps block and inline in agreement. Today
    `$$a$$ and $$b$$` becomes one block with content `a$$ and $$b`; with the
    wrapper it becomes two in-paragraph display formulas.
  - A `$$` block that spans several lines is one formula; the newlines are
    whitespace.
- **Render rules** (`md.add_render_rule`, replacing the plugin's wrappers):
  - **Inline success:** the `<math>` element, bare.
  - **Display success, own block:** `<div class="math-display"><math display="block">…</math></div>`.
    The div is the sideways scroll box.
  - **Display success, inside a paragraph:** `<span class="math-display"><math display="block">…</math></span>`,
    styled `display: block` with its own margins.
  - **Error:** `<span class="math-error" title="REASON">$SRC$</span>` inline or
    inside a paragraph (`$$SRC$$` for display source), and
    `<div class="math-error" title="REASON">$$SRC$$</div>` for an own block.
    Source and reason are escaped with `html.escape(quote=True)`; the reason
    can contain author text.
- **Sanitiser.** `nh3` stays the single sanitiser and the last step. Its
  allowlist is a per-tag map built from the emitter's table:
  - **Elements:** `math semantics annotation mrow mi mn mo mtext mspace msup
    msub msubsup mfrac msqrt mroot mover munder munderover mstyle`.
  - **Attributes by element:**
    - `math`: `display`
    - `annotation`: `encoding`
    - `mi`: `mathvariant`
    - `mo`: `stretchy largeop movablelimits fence form lspace rspace minsize maxsize`
    - `mfrac`: `linethickness`
    - `mover`: `accent`
    - `munder`: `accentunder`
    - `mstyle`: `displaystyle`
    - `mspace`: `width`
  - **Classes:**
    - `class` moves from the `span`/`div` attribute sets to `allowed_classes`
      (`span: {math-display, math-error}`, `div: {math-display, math-error}`,
      `mo: {math-acc}`, `mrow: {math-overline, math-underline}`, plus the
      existing `ul`/`ol: {loose}`).
    - ammonia panics if `class` is in both maps.
  - **`title`** survives through nh3's generic attributes (checked with
    Mathion's `_clean`); a test pins it.
- **Asset extraction ignores math.** `extract_asset_filenames` (its
  `_LINK_REF` regex) reads `$E[X](t)$` as a link to a file `t` and blocks
  the save with a 422. It must skip text inside math tokens; the builder
  chooses token-based reading or stripping math spans first.
  A test pins `$E[X](t)$`.
- Author HTML stays off (`html: False`), so the only MathML on a page is the
  converter's.
- The `render_markdown` docstring loses its "client-side KaTeX" line.

### Answer choices

- `AnswerOption` gains `text_html` (Text, not null).
  - It is set in **one place**: a `@validates("text")` hook on the model.
    If an import cycle forbids that, a single `set_option_text(option, text)`
    helper is used by every write path.
  - Every path that creates or edits an option fills it this way: the editor
    (`api/questions.py`), clone (`version_clone.py`) and the OLX import.
  - A test per path proves it is not empty.
- **`render_option_text(text)`:**
  - a `MarkdownIt("zero")` with only the `escape` and `text` rules and
    Mathion's inline dollar rule, called with `renderInline`, then `_clean`;
  - so the text is escaped, each `$…$` becomes inline MathML (same converter,
    same error span, same dollar rule), and `\$` is a literal dollar;
  - `$$…$$` in an option renders inline (options are one line);
  - no other Markdown;
  - the `escape` rule also turns `\*` into `*`.
- **API and types gain `text_html`:**
  - `OptionResponse` (`backend/mathion/schemas.py`) and the hand-built
    student option dicts (`backend/mathion/api/content.py`, `{"id","text","order"}`);
  - the TS option types in `frontend/src/lib/types.ts` (single and multi);
  - `AuthoringOption` in `frontend/src/lib/quizAuthoring.ts`;
  - the test harness `frontend/src/tests/support/quizHarness.svelte.ts`.
- **Display sites** show `text_html` through `{@html}`, always inside a
  wrapper span. `.opt` is `display: flex; gap: 10px`, so bare HTML would turn
  every text run and every `<math>` into its own flex item.
  - `SingleChoiceQuestion.svelte` and `MultiChoiceQuestion.svelte`:
    `<span class="opt-text">{@html opt.text_html}</span>`.
  - The quiz editor's `ChoiceRow.svelte`: inside its existing `.ans-text`.

  `ChoiceAnswers.svelte` merges `text_html` from the save echo along with
  `text`. The option input keeps editing `text`. No teacher review screen
  shows option text today (`QuestionReveal` carries ids only).
- `ChoiceRow`'s short name and aria label (`cutName(opt.text)`) keep the raw
  text, LaTeX included. That is acceptable until the VoiceOver pass at the
  beta.
- **Alembic migration** on head `d9a4c2e7f1b3`, following its frozen-helper
  pattern and self-contained:
  1. add the column with `server_default=''`;
  2. fill it with the inline `html.escape` of `text`, as a per-row Python
     loop like `d9a4c2e7f1b3`;
  3. drop the server default.

  The downgrade drops the column.

  Existing choices keep showing exactly as today.
- `frontend/src/components/editor/quiz/QuizBody.svelte` (the
  delete-confirmation title, `DOMParser` → `textContent`) removes
  `annotation` nodes before reading the text, so the LaTeX is not read
  twice. It is the only place that reads text back out of rendered HTML.

### Existing content (owner's rule VR-B12, `backend/mathion/markdown.py:1`)

- Stored `*_html` re-renders on save, publish and clone; before the beta
  there is no backfill.
- This change makes the publish and clone paths keep that promise for every
  field:
  - `Block.info_html` is re-rendered with `render_markdown` in clone
    (`backend/mathion/api/version_clone.py`, today copied verbatim) and in publish
    (`versions.py`, which today covers items, questions and version info
    only);
  - `AnswerOption.text_html` is re-rendered with `render_option_text` in
    both.
- Content saved before this update shows math as source until it is saved
  again or its version is published or cloned. The OLX import renders
  fresh.
- An author may see typeset math in the live preview while the unsaved
  student page still shows source. The release notes say "re-save or
  re-publish to typeset existing formulas".
- From the beta on, a renderer change that alters stored output ships an
  Alembic data migration (VR-B12, unchanged).
- The old `div.math` CSS selectors stay until the beta, next to the new
  ones, so stored pre-update content keeps its spacing.

### Font and caching

- One free OpenType math font is bundled as a `woff2` file under
  `frontend/src/styles/fonts/`, with its licence. It is cached immutably and
  loaded only on pages with formulas.
  - **Chosen (owner, rev 6): STIX Two Math**, `STIXTwoMath-Regular.woff2`
    from the stipub/stixfonts tag `v2.13b171`
    (`fonts/static_otf_woff2/`), 551 908 bytes, sha256
    `094191335def3f0452c81ec0713cfc2f29bb6af8cecbf79b60881fbf2db97562`;
    licence `OFL.txt` from the same tag.
  - It is declared in `fonts.css` with `font-display: swap`, and used by
    `math { font-family: "STIX Two Math", math }` only. Where the browser supports
    the generic `math` family, it covers the swap period with a system math
    font. Formulas shift once on the first visit,
    then the font comes from the cache.
  - The browser downloads it only on a page that shows a formula.
  - There is no page CSP, so nothing constrains the font. The only CSP is
    the interactive app's iframe.
- **Candidates:**
  - **STIX Two Math** (SIL OFL 1.1, textbook look);
  - **Latin Modern Math** (GUST Font Licence, LaTeX look).

  The owner picks from screenshots of the acceptance formulas in both; this
  is the first task of the plan. The same task checks in Chrome, Firefox
  and Safari:
  - `movablelimits` placement;
  - the `\dfrac` `mstyle`;
  - the accent characters;
  - non-stretching brackets;
  - primes `f'` and `f'^2`;
  - an over-wide display formula: it scrolls and both ends are reachable;
  - tall inline math (`\int`, `\sum`, an accent) in an option and in a
    one-line paragraph is not clipped and shows no vertical scrollbar; the
    fallback is a small `padding-block` on those boxes;
  - the look during the font swap (the generic `math` family where the
    browser supports it, otherwise the text font);
  - at 400px, list markers and link focus rings in a paragraph with inline
    math are intact.
- **Cache:** files under `/_app/` have content-hashed names (Vite
  `assetsDir: '_app'`).
  - The server sends them with
    `Cache-Control: public, max-age=31536000, immutable`, but only when
    `candidate.is_file()` and `full_path.startswith("_app/")` (no leading
    slash) in `_spa_fallback` (`backend/mathion/main.py`).
  - Today they get no `Cache-Control` and are revalidated.
  - The index and missing-file branches keep their current headers.

### Look

- **Inline math** sits on the text baseline at the surrounding font size.
  - It cannot wrap.
  - These blocks get `overflow-x: auto`, so they never widen the page at
    400px:
    - `.prose p:has(math)`, in `content.css`;
    - in the components, plain `.opt-text` and `.ans-text` rules, always on.
      Svelte scopes what is inside `:has()`, so `.opt-text:has(math)` would
      never match the `{@html}` math.
  - List items, table cells and headings get no overflow rule, because it
    would hide outside list markers. A long inline formula there can widen
    the line; authors use display math for long formulas.
  - The first browser task found a link focus ring at the start of such a
    paragraph clipped (the app ring reaches 4px out), so the rule adds
    `padding-inline: 4px` with `margin-inline: -4px`.
  - `.prose p:has(math)`, `.opt-text` and `.ans-text` get
    `padding-block: 0.35em`; at 0.3em an inline `\dfrac` still overflows
    by 1px in STIX.
- **Accents in Safari:** WebKit places a non-stretchy `mover` accent about
  0.2em too high, in every font; Chrome and Firefox are right. `content.css`
  adds `@supports (font: -apple-system-body) { mo.math-acc { position:
  relative; top: 0.2em } }`. Only Safari (every WebKit) supports that font
  keyword. If WebKit fixes its layout, the accents would touch their base;
  the fix is to drop the rule.
- **Over- and underline:** `mrow.math-overline { border-top: 0.06em solid;
  padding-top: 0.08em }`, `mrow.math-underline { border-bottom: 0.06em solid;
  padding-bottom: 0.08em }`. Screen readers lose the word "overline"; the
  TeX annotation keeps it.
- **Display math** (`.math-display`, both the `div` and the in-paragraph
  `span`; the span adds `display: block` and margins `var(--space-2) 0`):
  - centred;
  - takes the paragraph spacing `div.math` has today
    (`frontend/src/styles/content.css`);
  - `overflow-x: auto` with `overflow-y: hidden`, so a long formula scrolls
    sideways inside its own box;
  - `.math-display > math { width: max-content; margin-inline: auto }`, so
    an over-wide formula starts at the left edge and stays reachable;
  - `padding-block: 0.5em`, so `overflow-y: hidden` does not clip accents
    or integral signs;
  - if the first browser task finds a browser ignoring `width` on `<math>`,
    the fallback is `.math-display { display: flex; justify-content: safe center }`.
- `math`, `.math-display` and `.math-error` are **top-level rules in
  `content.css`**, not nested under `.prose`, because choice text sits
  outside `.prose`.
- **`.math-error`:**
  - the source in the mono font on a soft danger tint (`--danger-panel-bg`,
    text `--danger-panel-fg`), with the reason in its `title`;
  - in the editor's Markdown preview only, the reason is also shown under the
    formula: `.preview :global(.math-error)::after { display: block; content: attr(title) }`
    in `MarkdownEditor.svelte`. It must be `:global` because the preview HTML
    comes from `{@html}`;
  - students see the marked source only.
- There is no dark theme, so there is no dark-mode work.
- **The visual-refresh CSS gate** (`frontend/scripts/visual-refresh-gate.sh`)
  pins the new rules.
  - It pins the four `div.math` selectors by hash, and section (b4) freezes
    every hashless rule.
  - So the plan budgets a gate step for `math`, `.math-display`,
    `.math-error`, `.opt-text` and the overflow selectors, with
    `div.math-display` and `div.math-error` added to the four
    `.prose :where(…, div.math)` spacing lists and their hashes.
  - Section (b3) fails any new `:global` by design, so the preview rule needs
    its own `GLOBAL_ALLOW` entry
    (`('src/components/editor/MarkdownEditor.svelte', '.math-error')`).
  - The gate also pins both choice components' templates: the node and tag
    lists, the DOM-order signature, the `label:opt…` expression pins, and
    ChoiceRow's `own ans-row` section. The new `.opt-text` span and
    `{@html …text_html}` update all of them in the same gate step.

## Constraints

- No new Python or JS dependencies; Svelte 5; component tests use
  `mount`/`unmount`/`flushSync`.
- Browsers: current Chrome, Firefox and Safari (MathML Core); phone width
  400px for student screens.
- The sanitiser remains the last step for every rendered field, option text
  included.

## Left to the builder

- The converter's internal structure and test layout. The tests include:
  - a table of LaTeX → expected MathML cases;
  - all five acceptance formulas;
  - every row of the supported table;
  - every error case.
- Exact spacing widths, and which symbols are `<mo>` vs `<mi>` beyond the
  table, following MathML Core and the operator dictionary.
- **Existing tests that change:**
  - `backend/tests/test_markdown.py` pins the old `math inline`/`math block`
    wrappers;
  - its `$x = https://example.org$` case now typesets (`.`, `:` and `/` are
    `<mo>`).
