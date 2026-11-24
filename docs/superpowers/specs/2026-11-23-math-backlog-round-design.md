# Math backlog round: fraction style, alt text, output cap, slow `$$`, asset usage

Status: APPROVED by the owner 2026-11-23 (rev 2); rev 3 folds in the spec review (two Opus, one Fable) and the owner's page-cap call (2026-11-24); rev 4 the second review round (Opus + Fable), both clean on rev 4.

## Why

The owner's beta rule: every known defect is closed before the first beta (`project_beta_gate_minors`). The backlog walk of 2026-11-23 put five items into one round. The owner's own item is the first: inline fractions and scripts look looser than LaTeX sets them, which every student reading an inline fraction sees. The other four are small known defects from the maths and run-asset reviews.

Backlog files closed by this round (each deleted in the commit that fixes it): `math-fraction-style-tracking.md`, `image-alt-drops-formula.md`, `math-output-size-uncapped.md`, `math-hostile-markdown-saves-slowly.md` (the `$$` half only; the backtick half was never reproduced and is dropped), `extract-asset-refs-mirror-drift.md`.

## Goals

1. Formulas follow TeX's four styles (display D, text T, script S, scriptscript SS) for spacing and bracket growth.
2. Image alt text keeps a formula's text.
3. One formula's MathML output is capped.
4. The unclosed-`$$` shapes render in near-linear time.
5. The run Assets tab takes "which mini-projects use this file" from the server; the frontend copy of the backend's link rule is deleted.

Non-goals: new LaTeX commands (`\scriptstyle`/`\scriptscriptstyle` stay unsupported); font sizes (the browser already shrinks fraction and script parts by MathML Core's `math-depth`); limits placement (the browser places them from `movablelimits` and the `display`/`mstyle` context, and MathML Core already gives `mfrac` and script children compact style); cramped styles (they only move superscripts, which the browser places); matrices/aligned; the `\bm` script placement and the choice `$…$` hint (both "won't fix", 2026-11-23).

Anti-goals: any formula that is right today coming out different except where TeX's style rules say it must; a hostile input made slow by the new code.

## 1. TeX style tracking (owner picked approach A)

### Approaches

- **A. Track TeX's four styles (chosen).** Every part of a formula has a TeX style decided by where it sits: a fraction's parts are one style down (D→T, T→S, S→SS, SS→SS), a script argument is S (from D or T) or SS (from S or SS), `\displaystyle`/`\textstyle` set D/T. Spacing and bracket sizing read the style. It mirrors TeX, so cases not listed here come out right without their own rule.
- B. Two flags (clear `display` in fraction parts and script arguments, tighten fraction parts when inline). Rejected: it patches the three listed symptoms one by one.

### Today (`backend/mathion/latex_mathml.py`)

`Parser.display` is a bool, read in one place: `_left` → `_measure(node, parser.display)` (`\left…\right` growth). Script arguments, `\stackrel`/`\overset`/`\underset` tops and the `\sqrt` index go through `tighten()` (binary, relation and punctuation operators get `lspace`/`rspace` 0, `relspace` spaces go; it stops at an `mstyle` with `scriptlevel`). Fraction parts are never tightened and keep `display`; the `\over` split sets `display = False` for the denominator only. `_measure` walks a finished subtree with the flag it is given, also into scripts and fraction parts.

### The rules

- **Style per part:** fraction parts (`\frac`, `\binom`, `{…\over…}`, `{…\choose…}`) one down from the style the fraction sits in; `\dfrac` parts T, `\tfrac` parts S (each is its own D/T, one down); script arguments and stack tops S from D/T, SS from S/SS; the `\sqrt` index SS; the radicand, accent bases, `\overline`, font commands, `\operatorname` and `\left…\right` contents keep the style; `\displaystyle`/`\textstyle` set D/T for what follows in their group.
- **`\over` / `\choose`:** both halves are one style down from the style **the group started in** (so in `${\displaystyle a\over b+c}$` the numerator is D by its own switch and the denominator S). No after-the-fact fix-up of the numerator: re-tightening only its top level gets nested fractions and brackets wrong (`$${\frac{a+b}{c}\over d}$$`: pdflatex sets the inner `a+b` tight). **Builder's call between:** (a) look ahead, before parsing a group, for its own top-level `\over`/`\choose`, or (b) build the tree first and decide styles, spacing and bracket sizes in one pass over it from the root, bracket sizes on the way back up (innermost first). A look-ahead runs for every group `_seq` splits today (the whole formula, braces, `\left…\right`, the `\sqrt[…]` index) and uses the parser's own tokens and group ends (`]` only for a `\sqrt` index, `\left`/`\right` nesting, the bracket token after `\left`/`\right`/`\middle` and the `\big` family (`\bigl`, `\Bigr`, …), raw `\text` groups), so `\overline`/`\overset` and `{\sqrt[a\over b]{x}+c}` do not look like a fraction. Either way no part is parsed twice and the total work stays at most `MAX_DEPTH` × length (an outer `\left` re-measuring an inner one's subtree, as today, is fine).
- **Spacing in S and SS:** exactly what `tighten()` does today, which matches TeX's spacing table (TeXbook p. 170): binary, relation and punctuation spacing goes, `relspace` (thick, around stacked relations) and `inner_space` (Op–Inner) go; `auto_space` (the Ord–Op / Op–Ord thin space) stays; explicit `\,` `\;` `\quad` stay. Exception: `\colon`'s after-space is an explicit `\mskip6mu` in amsmath and stays in script styles, so `tighten()` keeps a `\colon`'s `rspace` (new; affects `$\frac{f\colon X\to Y}{2}$` and `$x^{f\colon X\to Y}$`). The node is marked as a `\colon` when parsed (its `rspace` cannot identify it: `_after_punct` rewrites it). Only `rspace` is in scope; amsmath's 2mu before a `\colon` in script style is a known difference (the converter has `lspace` 0 in every style). S and SS are identical for everything the converter emits. Tightening stops at an explicit `\displaystyle`/`\textstyle` (D/T again).
- **Bracket growth:** `\left…\right` sizes are measured with the style of each part, not the outer flag: entering a fraction part or a script argument changes the style used inside it. **The expected size for every reference formula is pdflatex's, measured**, mapped onto the converter's three levels: normal → `stretchy="false"`, `\big` → 1.2em (`minsize`/`maxsize`), `\Big` or larger → grow to the content. A pdflatex size this model cannot produce is recorded in the test as a known difference, never forced by a new rule. Known difference: pdflatex grows `$$\left( x^{\lim_n a} \right)$$` to `\big` because of tall letters (`x^{b}` and `x^{\lim a}` grow too; `x^{\max_n a}`, `x^{y}` do not); the converter does not model letter heights, so with the style rules it stays normal there. Where bracket sizes are measured innermost-first today (an outer `\left` reading an inner one's `minsize`), that order stays.
- **Output:** the MathML elements stay the same; what changes is which operators get `lspace="0em" rspace="0em"`, which `relspace`/`inner_space` spaces are dropped, and which brackets get `stretchy="false"`/`minsize`/a strut. No new attributes for size.

### Checking it

pdflatex is on the development Mac (`/Library/TeX/texbin/pdflatex`). The builder sets the reference list in pdflatex and in Chrome and Safari, and compares spacing and bracket heights by measurement. Each becomes a converter test asserting the spacing and bracket attributes pdflatex's result calls for. Reference list (at least):

- `$\frac{a+b}{c}$`, `$$\frac{a+b}{c}$$`, `$\tfrac{a+b}{2}$`, `$$\dfrac{a+b}{c}$$`, `$\binom{a+b}{c}$`
- `$x^{\frac{a+b}{2}}$`, `$\frac{a}{\frac{b+c}{d}}$` (SS→SS), `$\frac{x,y\le z}{2}$`, `$\frac{\displaystyle a+b}{c}$`
- `$\frac{\sin x+\sum_i\left(y\right)}{2}$` and the same in `$$…$$` (thin spaces kept; `inner_space` dropped inline)
- `$a+b\over c$`, `${\displaystyle a\over b+c}$`, `$${\frac{a+b}{c}\over d}$$`, `$${{a+b\over c}\over d}$$`
- `$$\frac{\left(\lim_n a\right)}{2}$$`, `$${\left(\lim_n c\right)\over b}$$`, `$${\sqrt{\left(\lim_n c\right)}\over b}$$`
- `$$\left( x^{\lim_n a} \right)$$`, `$$x^{\left(\lim_n a\right)}$$`, `$$\sqrt{\left(\lim_n a\right)}$$`, `$$\sqrt[\left(\lim_n a\right)]{x}$$`
- `$\stackrel{a+b}{=}$`, `$\frac{f\colon X\to Y}{2}$`, `$x^{f\colon X\to Y}$`, `$$\left(a+b\over c\right)$$`
- unchanged: `$$\sum_{i=1}^{n} x_i$$`, `$e^{x+y}$`

Plus a timing test: nested `{…\over…}` groups with a `\left…\right` in each numerator, as deep as converts (found by trying, about 39 groups with the `\left` beside the inner group and 20 with the inner group inside the `\left`), padded toward `MAX_LENGTH`, asserts it converts and does so in well under a second (counted steps preferred to wall time where the existing tests count, `test_latex_mathml.py` "Counted, not timed").

Existing converter tests whose expected output changes: each one is named in the review with the TeX rule (and pdflatex result) behind it.

## 2. Image alt text keeps formulas

`![a $x$ b](p.png)` renders `alt="a  b"` today: the image's alt is built by markdown-it's `renderInlineAsText` from child tokens' text, and formula tokens and escapes have none. Fix, in `renderInlineAsText` (so a nested image keeps its formula too):

- `math_inline` and `math_inline_double` contribute their trimmed LaTeX source without the dollar signs: `![a $x$ b](p.png)` → "a x b", `![a $$ x $$ b](p.png)` → "a x b", `$\alpha$` → "\alpha" (as pandoc). A formula that fails to parse still gives its source.
- Every `text_special` (escapes and entities) contributes its content: `![price \$5](p.png)` → "price $5", `![a \* b](p.png)` → "a * b", `![a &amp; b](p.png)` → "a & b".
- `hardbreak` contributes a newline, as markdown-it JS does (`![a  \nb](p.png)` → "a\nb", today "ab").
- Out of scope (my call): code spans in alt stay as today (pandoc also keeps their text; not reported, not part of the backlog item).
- Escaping for the attribute is already done by `renderToken`; a test pins `"` → `&quot;`.

## 3. Output cap

`latex_to_mathml` caps the source length (`MAX_LENGTH`) but not the output, which grows about 100 characters per source character (2000 `∑` ≈ 214 KB). Per formula: if one formula's whole `<math>…</math>` string is longer than 60 000 characters, raise `LatexError("formula too long")`, so the existing error box shows, as for a too-long source. Normal formulas are a few KB; no existing test's output reaches it.

A per-formula cap alone does not bound a page: 170 formulas of 590 `∑` each (100 KB of Markdown) render to 10.7 MB, each formula under the cap. **Owner's call (2026-11-24): per formula only.** Only admins write this text and nobody writes such pages; the page-size case is kept as a backlog note with `worth: no`, so it is not rediscovered.

## 4. Unclosed `$$` renders in near-linear time

`"$$x\n# h\n" * 4000` (32 KB) takes 3.7 s today, growing quadratically: each unclosed `$$` searches the rest of the text for its closing `$$`. The cost is in the block rules (`_block_end`, `markdown.py:311`, and the dollarmath plugin's `_math_block_dollar`), each called once per opener and scanning to the end.

Fix: the search for a block's closing `$$` stops at the first later line holding an unescaped `$`, **including that line** (it may be the closer). This changes no result: any unescaped `$` between opener and closer already makes the block invalid (0 differences over 60 000 fuzzed inputs in review). Test shapes, each under 0.5 s at its size and 128 KB of the first under 2 s (as the existing timing tests in `test_markdown.py`):

- `"$$x\n# h\n" * 4000` (32 KB, 3.7 s today)
- `"$$x\n# h\n" * 4000 + "$$\n"` (32 KB, 6.1 s today)
- `"> $$x\n> # h\n" * 2000` (24 KB, 1.0 s today)
- `"$$x\n\\$ a\n# h\n" * 3000` (39 KB, 3.5 s today)

All existing Markdown and maths tests pass unchanged.

## 5. Asset usage from the server

Today the run Assets tab (`frontend/src/components/runs/RunAssetsTab.svelte`) works out which mini-projects use each file with `frontend/src/lib/extractAssetRefs.ts` (its only user), a regex copy of an old backend rule; the backend now scans markdown-it tokens, so the two disagree. The server keeps `run_asset_references` rows (asset, mini-project), written by `sync_run_asset_references` on every mini-project save; they drive `is_referenced` and the delete guard.

Fix:
- `RunAssetResponse` gains `referenced_by: list[int]`: the **distinct** mini-project ids, ascending, from `run_asset_references` (the table has no unique constraint, so duplicates are possible). `is_referenced` stays (`= bool(referenced_by)`). All three builders fill both: the list endpoint (one query for the whole run's references, not one per asset), upload (today hard-codes `is_referenced = False`) and replace.
- The tab's `referencingMpIds(asset)` walks `miniProjects` in their list order and keeps those in `asset.referenced_by` (today's chip and panel order; ids the tab does not know drop out). If `is_referenced` is true but that list is empty, the delete message uses the generic sentence, not "referenced by 0 mini-projects". `extractAssetRefs.ts` and its tests are deleted; test fixtures that set chips through `assignment_md` set `referenced_by` instead (`types.ts` and `mkAsset` gain the field).
- **Upload rebuilds usage; replace does not.** A force-deleted asset loses its rows (FK cascade) while the mini-project text still links its name; re-uploading that name writes no rows, so a plain teacher could delete it without `force` (a gap in today's delete guard, hidden in the tab by the frontend regex). Upload therefore writes the new asset's rows itself, in this order: (1) select the run's mini-project ids and take each one's advisory lock (`LOCK_NS_MINIPROJECT`, ascending id) **before** `db.add(asset)`/`flush()` — the order `delete_run` uses; taking them after the insert deadlocks with a run delete (the insert holds a KEY SHARE lock on the run row); (2) add and flush the asset (a run deleted meanwhile still gives today's clean 404 through the `IntegrityError` path); (3) re-read each mini-project fresh under its lock (`populate_existing`, as `patch_mini_project` does), skipping any that are gone, and scan its `assignment_md` with the backend rule; (4) write the rows; (5) write the file to disk, nothing else after the rows. Saves already reject links to missing assets (422), so no row can be lost; the lock and the fresh read stop a stale extra row. The locks are held only to the end of this short transaction (student submissions take the same lock). Replace keeps the asset row and its filename, so its rows are already right; it does not rebuild (a rebuild there could race a save and lose a row).
- **No backfill (my call):** rows written under older rules stay until the next save of that mini-project. All data so far is the owner's dev data.
- **Refresh:** no new wiring. Every mini-project save and delete on the run page already refetches the assets (`refetchAll` in `RunMiniProjectsTab.svelte`), and an asset delete refetches both lists.
- **Tests:** `referenced_by` contents and order; the list endpoint's reference query is one per request (the per-asset `uploaded_by_email` lookups are out of scope); upload after a force delete then a plain delete → 409; a duplicate row gives one id; the tab's chips, filter counts and "used by" panel from `referenced_by`.

## Constraints

- No new dependencies (Python or JS). Code comments one short line.
- Run Python through `backend/.venv` with `-I`; never two pytest processes at once.
- The frontend gate (`frontend/scripts/visual-refresh-gate.sh`) stays green (it has no pins on `extractAssetRefs`).
- Never read `.superpowers/sdd/2026-11-17-olx-import/` (owner's private course).

## Left to the builder

- Look-ahead or one tree pass for part 1 (above).
- The order of tasks; part 1 is the largest and goes through the usual review loop on its own.
