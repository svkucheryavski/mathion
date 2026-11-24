# Math Backlog Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five backlog items before the beta: TeX style tracking in the LaTeX→MathML converter, formulas kept in image alt text, a per-formula MathML cap, linear-time unclosed `$$`, and run-asset usage sent by the server.

**Architecture:** The converter's `Parser.display` bool becomes a four-value `Parser.style` (D/T/S/SS); a group looks ahead for its own `\over`, parts are tightened where the style first drops to S, and `_measure` changes style when it enters fraction parts and scripts. Markdown gets a `renderInlineAsText` override and a bounded `_block_end`. The run-asset API returns `referenced_by` per asset, and upload writes the new asset's reference rows under the mini-project locks; the Assets tab reads `referenced_by` and `extractAssetRefs.ts` goes.

**Tech Stack:** Python 3.13 / FastAPI / SQLAlchemy / Postgres 17 / markdown-it-py 4.0.0 + mdit_py_plugins; Svelte 5 + TypeScript, Vitest + jsdom; pdflatex for reference measurements.

**Spec:** `docs/superpowers/specs/2026-11-23-math-backlog-round-design.md` (rev 4, `1f1d08c7`)

## Global Constraints

- No new dependencies (Python or JS). Code comments: one short plain line.
- Python only via `backend/.venv/bin/python -I` / `backend/.venv/bin/pytest`; never two pytest processes at once.
- Frontend gate `zsh frontend/scripts/visual-refresh-gate.sh` (from the repo root) stays `ALL PASS`.
- Never read or list `.superpowers/sdd/2026-11-17-olx-import/`; say so to every reviewer and to Codex.
- Expected bracket sizes come from pdflatex, mapped: normal → `stretchy="false"`, `\big` → `minsize`/`maxsize` 1.2em, `\Big`+ → grow to content; a size the model cannot produce is a recorded known difference, never a new rule.
- Per-formula cap: `MAX_OUTPUT = 60_000` characters of the whole `<math>…</math>` string; reason `"formula too long"`. Per formula only (owner, 2026-11-24).
- Each task: Opus (high) + Fable on the uncommitted diff until both clean, then Codex (high), then the owner's OK, then commit. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never stage `logo.png`, `favicon.svg`. Each closed backlog file is `git rm`-ed in its task's commit.

## Review Focus

1. A formula that is right today changes where TeX does not call for it — every changed expected output in `test_latex_mathml.py` is listed in the ledger with its TeX rule (Task 1, step 5).
2. Hostile nesting (`\over` + `\left` at the deepest that converts) stays fast — timing test (Task 1).
3. An alt text whose formula fails to parse still keeps its source (Task 2 test row).
4. Upload to a run with no mini-projects, and a mini-project with no `assignment_md`, still upload cleanly with `referenced_by == []` (Task 3 tests).
5. `is_referenced` true but no known mini-project in the tab: the delete message uses the generic sentence (Task 4 test).

---

### Task 1: TeX styles in the converter

**Files:**
- Modify: `backend/mathion/latex_mathml.py` (`Node`, `tighten` :76, `_measure` :466, `Parser` :537-, `_seq` :591, `parse_scripted` :806/:811, `_frac` :968, `_sqrt` index :984, `_stack` :1011, `_left` :1050, `COMMANDS["colon"]` :1249)
- Test: `backend/tests/test_latex_mathml.py`
- Scratch: `.superpowers/sdd/2026-11-24-math-backlog-round/pdflatex/` (probe `.tex` + measurements; not committed)
- Delete: `docs/backlog/math-fraction-style-tracking.md`

**Interfaces:**
- Produces: module constants `_D, _T, _S, _SS = 0, 1, 2, 3`; `_frac_style(s: int) -> int` (`min(s + 1, _SS)`); `_script_style(s: int) -> int` (`_S` if `s <= _T` else `_SS`); `Parser.style: int` (constructor `Parser(src, display)` unchanged: `_D` if display else `_T`); `Parser.display` becomes a read-only property `self.style == _D`; `Parser.parse_styled(self, style: int, parse: Callable[[], Node]) -> Node` (sets the style, parses, restores, and calls `tighten` on the result when the style went from ≤ `_T` to ≥ `_S`); `Parser._group_splits(self, until: str | None) -> bool` (look-ahead, restores `pos`); `Node.colon: bool = False`.
- `latex_to_mathml(src, display) -> str` signature unchanged.

- [ ] **Step 1: Measure the reference list in pdflatex**

In the scratch dir, one `.tex` (article + amsmath) that typesets every spec reference formula and, per formula, writes to the log the opening bracket's height+depth (for bracket rows) and the width of the part with `+`/`,`/`≤` against the same part with braced operators `{+}` (for spacing rows). Run `/Library/TeX/texbin/pdflatex -interaction=nonstopmode`. Write a table into the ledger: formula, pdflatex spacing (spaced/tight), pdflatex bracket level (normal/`\big`/`\Big`+). Where it disagrees with the predictions in step 2, pdflatex wins: change the test row, or mark it a known difference with a `Ruling:`.

- [ ] **Step 2: Write the failing tests**

In `test_latex_mathml.py`, a parametrized `test_tex_style_spacing(src, display, op, tight)`: converts `src`, finds the first `<mo>` with text `op` (inside the named part), asserts `lspace="0em" rspace="0em"` present iff `tight`. Rows (predictions, confirmed in step 1):

| src | display | op | tight |
|---|---|---|---|
| `\frac{a+b}{c}` | F | `+` | T |
| `\frac{a+b}{c}` | T | `+` | F |
| `\tfrac{a+b}{2}` | F | `+` | T |
| `\dfrac{a+b}{c}` | T | `+` | F |
| `\binom{a+b}{c}` | F | `+` | T |
| `x^{\frac{a+b}{2}}` | F | `+` | T |
| `\frac{a}{\frac{b+c}{d}}` | F | `+` | T |
| `\frac{x,y\le z}{2}` | F | `,` and `≤` | T |
| `\frac{\displaystyle a+b}{c}` | F | `+` | F |
| `\frac{\sin x+\sum_i\left(y\right)}{2}` | F | `+` | T |
| same | T | `+` | F |
| `a+b\over c` | F | `+` | T |
| `{\displaystyle a\over b+c}` | F | `+` (denominator) | T |
| `{\frac{a+b}{c}\over d}` | T | `+` | T |
| `{{a+b\over c}\over d}` | T | `+` | T |
| `\stackrel{a+b}{=}` | F | `+` | T |
| `e^{x+y}` | F | `+` | T (unchanged) |

Plus:
- `test_thin_spaces_in_script_style`: inline `\frac{\sin x+\sum_i\left(y\right)}{2}` keeps the `auto` thin space after `\sin` and has no Op–Inner `mspace` before `\left`; the display version has both.
- `test_colon_keeps_after_space_in_scripts`: in `\frac{f\colon X\to Y}{2}` (inline) and `x^{f\colon X\to Y}` the `:` keeps its non-zero `rspace` and has `lspace="0em"`.
- `test_tex_style_brackets(src, display, level)`, `level` in `{"normal", "big", "grow"}` read from the opening `<mo>`'s attrs: `\left(\lim_n a\right)` inside `\frac{…}{2}` (T), `{\left(\lim_n c\right)\over b}` (T), `{\sqrt{\left(\lim_n c\right)}\over b}` (T), `\left( x^{\lim_n a} \right)` (T, expect normal: known difference, pdflatex `\big` from letter heights — comment says so), `x^{\left(\lim_n a\right)}` (T), `\sqrt{\left(\lim_n a\right)}` (T, unchanged), `\sqrt[\left(\lim_n a\right)]{x}` (T), `\left(a+b\over c\right)` (T, grow), `\sum_{i=1}^{n} x_i` unchanged output. Levels per the step-1 table.
- `test_nested_over_left_converts_fast`: build nested `{\left(a\right)…\over z}` groups as deep as converts (loop down from 40 until no `LatexError("nested too deeply")`; assert the depth found ≥ 19 for the inner-group-inside-`\left` shape and ≥ 38 for the beside shape), pad with `a+` toward `MAX_LENGTH`; assert each converts in < 0.5 s (`time.perf_counter`).

- [ ] **Step 3: Run them to see them fail**

Run: `cd backend && .venv/bin/pytest -q tests/test_latex_mathml.py -k "tex_style or thin_spaces or colon_keeps or nested_over" 2>&1 | tail -15`
Expected: the inline-fraction, `\over`, nested-fraction, `\colon` and bracket rows FAIL; unchanged rows and the timing test pass.

- [ ] **Step 4: Implement**

- Style plumbing per the Interfaces block; `_seq` saves and restores `style` (as it does `display` now).
- `_frac` parses both parts with `parse_styled(_frac_style(s), …)`, where `s` is `_D` for `\dfrac`, `_T` for `\tfrac`, else `self.style`. Script arguments (`parse_scripted` `^`/`_`), stack tops (`_stack`) use `_script_style`; the `\sqrt` index uses `_SS`. These replace the direct `tighten(...)` calls there.
- `_seq`: at entry `start = self.style`; if `self._group_splits(until)` the numerator is parsed in `_frac_style(start)`; at `\over`/`\choose` the denominator style is `_frac_style(start)` (not the current style); each half is tightened when `start <= _T` and the half's style `>= _S`. The look-ahead walks the parser's own tokens to this group's end: braces nest; `\left`/`\right` nest; `]` ends only a `\sqrt` index group (`until == "]"`); the token after `\left`/`\right`/`\middle`/`\big`-family is a bracket, not a group delimiter; raw `\text{…}` groups are skipped whole; only `\over`/`\choose` at this group's own level count.
- `tighten`: a `Node` with `colon=True` keeps its `rspace`; `COMMANDS["colon"]` sets `colon=True`.
- `_measure`: `display` becomes `False` for `mfrac` children, for `msub`/`msup`/`msubsup` children after the base, and for non-accent `munder`/`mover`/`munderover` children after the base; `_left` passes `parser.display`.

- [ ] **Step 5: Run the converter and Markdown suites**

Run: `cd backend && .venv/bin/pytest -q tests/test_latex_mathml.py tests/test_markdown.py tests/test_asset_markdown.py 2>&1 | tail -15`
Expected: new tests pass. Any existing test whose expected output changes: update it only if a TeX style rule (and the step-1 pdflatex table) calls for the change, and list each in the ledger as `Task 1: Ruling: <test> changes — <rule>`.

- [ ] **Step 6: Full backend suite**

Run: `cd backend && .venv/bin/pytest -q -x 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 7: Review loop and commit**

Opus + Fable on the uncommitted diff (give them the step-1 table and the ledger rulings) until both clean; Codex (high); the owner's OK; then:

```bash
git rm docs/backlog/math-fraction-style-tracking.md
git add backend/mathion/latex_mathml.py backend/tests/test_latex_mathml.py
git commit -m "feat(math): TeX styles — fraction and script parts spaced as in LaTeX"
```

---

### Task 2: Alt text, output cap, bounded `$$`

**Files:**
- Modify: `backend/mathion/markdown.py` (`_block_end` :311, renderer setup near :379), `backend/mathion/latex_mathml.py` (`latex_to_mathml` :1403)
- Test: `backend/tests/test_markdown.py`, `backend/tests/test_latex_mathml.py`
- Delete: `docs/backlog/image-alt-drops-formula.md`, `docs/backlog/math-output-size-uncapped.md`, `docs/backlog/math-hostile-markdown-saves-slowly.md`

**Interfaces:**
- Produces: `MAX_OUTPUT = 60_000` in `latex_mathml.py`; `_render_inline_as_text(self, tokens, options, env) -> str` in `markdown.py`, bound onto `_md.renderer.renderInlineAsText`.

- [ ] **Step 1: Record today's output for the `$$` regression shapes**

Run the current `render_markdown` on: `"$$\nx\n$$"`, `"$$x$$"`, `"$$\na\n$b$\n$$"`, `"$$\na\n\\$\n$$"`, `"- $$\n  x\n  $$"`, `"> $$\n> x\n> $$"`. Paste each output as the expected literal of `test_dollar_block_bound_keeps_results` (parametrized).

- [ ] **Step 2: Write the failing tests**

- `test_image_alt_keeps_text(md, alt)`, asserting `f'alt="{alt}"'` in `render_markdown(md)`:

| md | alt |
|---|---|
| `![a $x$ b](p.png)` | `a x b` |
| `![a $$ x $$ b](p.png)` | `a x b` |
| `![$\alpha$](p.png)` | `\alpha` |
| `![a $\frac{a}$ b](p.png)` (fails to parse) | `a \frac{a} b` |
| `![price \$5](p.png)` | `price $5` |
| `![a \* b](p.png)` | `a * b` |
| `![a &amp; b](p.png)` | `a &amp; b` |
| `![a "q" $x$](p.png)` | `a &quot;q&quot; x` |
| `![a ![b $x$](q.png) c](p.png)` | `a b x c` |
| `![a  \nb](p.png)` (hard break) | `a\nb` |

- `test_formula_output_cap`: `latex_to_mathml("∑" * 1000, False)` raises `LatexError` with reason `"formula too long"`; `latex_to_mathml("x" * 2000, False)` converts; `render_markdown("$" + "∑" * 1000 + "$")` contains `title="formula too long"`.
- `test_unclosed_double_dollar_is_linear(src, limit)`: `"$$x\n# h\n" * 4000`, `"$$x\n# h\n" * 4000 + "$$\n"`, `"> $$x\n> # h\n" * 2000`, `"$$x\n\\$ a\n# h\n" * 3000` each < 0.5 s; `"$$x\n# h\n" * 16000` (128 KB) < 2.0 s.

- [ ] **Step 3: Run them to see them fail**

Run: `cd backend && .venv/bin/pytest -q tests/test_markdown.py tests/test_latex_mathml.py -k "image_alt or output_cap or unclosed_double or dollar_block_bound" 2>&1 | tail -15`
Expected: alt rows (except plain ones), the cap and the timing tests FAIL; `dollar_block_bound` passes (it pins today's output).

- [ ] **Step 4: Implement**

- `latex_to_mathml`: raise `LatexError("formula too long")` when the returned string is longer than `MAX_OUTPUT`.
- `_render_inline_as_text`: `text` and `text_special` → content; `math_inline`/`math_inline_double` → `_source(content)` (trimmed source, no dollars); `image` → recurse into children; `softbreak`/`hardbreak` → `"\n"`; others as markdown-it-py does today.
- `_block_end`: after the start line, a line that holds an unescaped `$` (`_has_dollar`) ends the search, that line included.

- [ ] **Step 5: Run the suites**

Run: `cd backend && .venv/bin/pytest -q tests/test_markdown.py tests/test_latex_mathml.py tests/test_asset_markdown.py 2>&1 | tail -5`, then the full suite `.venv/bin/pytest -q -x 2>&1 | tail -5`.
Expected: all pass, no existing test changed.

- [ ] **Step 6: Review loop and commit**

As Task 1, step 7; then:

```bash
git rm docs/backlog/image-alt-drops-formula.md docs/backlog/math-output-size-uncapped.md docs/backlog/math-hostile-markdown-saves-slowly.md
git add backend/mathion/markdown.py backend/mathion/latex_mathml.py backend/tests/test_markdown.py backend/tests/test_latex_mathml.py
git commit -m "fix(math): formulas in image alt text, per-formula output cap, linear unclosed \$\$"
```

---

### Task 3: Asset usage from the server

**Files:**
- Modify: `backend/mathion/schemas.py:844` (`RunAssetResponse`), `backend/mathion/api/run_assets.py` (upload :39, replace :117, list :217), `backend/mathion/api/asset_render.py` (next to `sync_run_asset_references` :215)
- Test: `backend/tests/test_run_assets.py`, new `backend/tests/test_concurrency_run_assets.py`

**Interfaces:**
- Produces: `RunAssetResponse.referenced_by: list[int]` (distinct mini-project ids, ascending; default empty); `is_referenced == bool(referenced_by)` in every response; `reference_new_run_asset(db: Session, asset: RunAsset, mp_ids: list[int]) -> None` in `asset_render.py`; `advisory.interleave_hook("asset_upload_locked")` in upload after the locks.

- [ ] **Step 1: Write the failing tests**

In `test_run_assets.py`:
- `test_list_assets_referenced_by_distinct_ascending`: one asset linked from two mini-projects (insert their rows directly, higher id first, plus a duplicate row) → `referenced_by == [low_id, high_id]`, `is_referenced is True`.
- `test_list_assets_one_reference_query`: three assets; count statements touching `run_asset_references` (SQLAlchemy `before_cursor_execute` listener) during `GET /api/runs/{id}/assets` → exactly 1.
- `test_upload_after_force_delete_restores_usage`: `_create_referenced_asset` (existing helper), force-delete it as course admin, re-upload the same name → response `referenced_by == [mp.id]`, `is_referenced is True`; then a run teacher's plain delete → 409.
- `test_upload_new_name_unreferenced`: `referenced_by == []`.
- `test_upload_run_without_mini_projects`: 201, `referenced_by == []`.
- `test_upload_skips_mini_project_without_text`: a mini-project with `assignment_md` null → 201, `referenced_by == []`.
- `test_replace_returns_referenced_by`: replace a referenced asset → `referenced_by == [mp.id]`; its rows unchanged.

In `test_concurrency_run_assets.py` (threads + `interleave_hook`, as `test_concurrency_mini_project.py`):
- `test_upload_and_delete_run_do_not_deadlock`: upload parks at `asset_upload_locked`; `DELETE /api/runs/{id}?force=true` starts in a second thread and blocks; release the upload; both finish; neither returns 500 (no `40P01`).
- `test_upload_reads_text_saved_while_waiting`: the mini-project text links `fig.png` (asset force-deleted); a PATCH removing the link parks at its `mp_patch` hook holding the lock; the upload of `fig.png` starts and blocks; release the PATCH; upload finishes → `referenced_by == []`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && .venv/bin/pytest -q tests/test_run_assets.py tests/test_concurrency_run_assets.py 2>&1 | tail -15`
Expected: new tests FAIL (`referenced_by` missing, usage not restored, hook label never reached); existing ones pass.

- [ ] **Step 3: Implement**

- `RunAssetResponse.referenced_by: list[int] = Field(default_factory=list)`.
- One private builder in `run_assets.py` used by list, upload and replace; the list endpoint loads all of the run's references in one `SELECT DISTINCT run_asset_id, mini_project_id … ORDER BY mini_project_id`.
- Upload, after the size checks: select the run's mini-project ids ascending; `advisory_xact_lock(db, LOCK_NS_MINIPROJECT, id)` for each; `interleave_hook("asset_upload_locked")`; then `db.add` + `flush` (existing `IntegrityError` path unchanged); `reference_new_run_asset(db, asset, ids)`; then the file write; commit. Replace does not touch references.
- `reference_new_run_asset`: for each id, `db.get(MiniProject, id, populate_existing=True)`; skip `None` or empty text; add a `RunAssetReference` when `asset.filename in extract_asset_filenames(mp.assignment_md)`.

- [ ] **Step 4: Run the suites**

Run: `cd backend && .venv/bin/pytest -q tests/test_run_assets.py tests/test_concurrency_run_assets.py tests/test_mini_projects.py tests/test_concurrency_mini_project.py 2>&1 | tail -5`, then `.venv/bin/pytest -q -x 2>&1 | tail -5`.
Expected: all pass.

- [ ] **Step 5: Review loop and commit**

As Task 1, step 7; then:

```bash
git add backend/mathion/schemas.py backend/mathion/api/run_assets.py backend/mathion/api/asset_render.py backend/tests/test_run_assets.py backend/tests/test_concurrency_run_assets.py
git commit -m "feat(assets): referenced_by per run asset; upload restores usage under the mini-project locks"
```

---

### Task 4: Assets tab reads `referenced_by`

**Files:**
- Modify: `frontend/src/lib/types.ts:437`, `frontend/src/components/runs/RunAssetsTab.svelte` (import :11, `refsByMp`/`referencingMpIds` :520-536, delete message :855)
- Delete: `frontend/src/lib/extractAssetRefs.ts`, `frontend/src/tests/extractAssetRefs.test.ts`, `docs/backlog/extract-asset-refs-mirror-drift.md`
- Test: `frontend/src/tests/RunAssetsTab.svelte.test.ts`, `frontend/src/tests/RunDetailPage.tabs.svelte.test.ts` (fixtures)

**Interfaces:**
- Consumes: `RunAssetResponse.referenced_by: number[]` (Task 3).
- `referencingMpIds(asset)` keeps its name and return type (`number[]`, in `miniProjects` list order).

- [ ] **Step 1: Write the failing tests and move fixtures**

`mkAsset(id, filename, referenced_by: number[] = [])` sets `referenced_by` and `is_referenced: referenced_by.length > 0`. Every fixture that sets chips through `assignment_md` sets `referenced_by` instead (`mkMp` keeps its text, now irrelevant to chips). New tests:
- `'chips follow the mini-project list order, not referenced_by order'`: mini-projects listed `[mp 9, mp 3]`, asset `referenced_by: [3, 9]` → the "used by" panel lists mp 9 then mp 3.
- `'ignores mini-project ids the tab does not know'`: `referenced_by: [3, 99]` → chip "1".
- `'an asset whose text link is not in referenced_by counts as orphan'`: mp text links `a.png`, `referenced_by: []` → Orphan filter count includes it.
- `'referenced but no known mini-project: generic delete sentence'`: `is_referenced: true`, `referenced_by: [99]` → the delete row says "This asset is referenced by other mini-projects."

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunAssetsTab.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts 2>&1 | tail -15`
Expected: the four new tests FAIL; moved fixtures fail where chips came from text.

- [ ] **Step 3: Implement**

`types.ts` gains `referenced_by: number[]`; `referencingMpIds` = the ids of `miniProjects` (in order) that `asset.referenced_by` includes; drop `refsByMp` and the import; the delete message takes the generic branch when `miniProjects == null || refIds.length === 0`. Delete `extractAssetRefs.ts` and its test.

- [ ] **Step 4: Run the frontend checks**

Run: `cd frontend && TZ=Europe/Copenhagen npm test 2>&1 | tail -8`, `npm run check 2>&1 | tail -3`, and from the repo root `zsh frontend/scripts/visual-refresh-gate.sh 2>&1 | tail -3`.
Expected: all pass, exit 0, no "Errors"/"Unhandled" line; check 0 errors; gate `ALL PASS`.

- [ ] **Step 5: Review loop and commit**

As Task 1, step 7; then:

```bash
git rm frontend/src/lib/extractAssetRefs.ts frontend/src/tests/extractAssetRefs.test.ts docs/backlog/extract-asset-refs-mirror-drift.md
git add frontend/src/lib/types.ts frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts frontend/src/tests/RunDetailPage.tabs.svelte.test.ts
git commit -m "refactor(assets): the run Assets tab reads referenced_by; drop the frontend link rule"
```

---

### Task 5: Browser pass

- [ ] **Step 1: Chrome (agent-browser, dev servers)**

Dev item with the Task 1 reference formulas (inline and display): screenshot in Chrome and compare with the pdflatex PDF rendered to PNG (spacing and bracket sizes; measure, report good/bad). An image with `$x$` in its alt: check the `alt` in the DOM. Run Assets tab: chips after a mini-project save; re-upload after a force delete shows "used by" again.

- [ ] **Step 2: Safari (owner, one step at a time)**

The same item in Safari: compare inline fractions with Chrome myself from screenshots the owner saves into the workspace; ask the owner only for what cannot be captured.

- [ ] **Step 3: Cleanup**

List, then delete the dev rows made for the pass (sign-in rows, test item, test asset); stop servers; record in the ledger.
