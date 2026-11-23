# Math backlog round: fraction style, alt text, output cap, slow `$$`, asset usage

Status: APPROVED by the owner 2026-11-23 (rev 2: builder-check corrections).

## Why

The owner's beta rule: every known defect is closed before the first beta (`project_beta_gate_minors`). The backlog walk of 2026-11-23 put five items into one round. The owner's own item is the first: inline fractions and scripts look looser than LaTeX sets them, which every student reading an inline fraction sees. The other four are small known defects from the maths and run-asset reviews.

Backlog files closed by this round (each deleted in the commit that fixes it): `math-fraction-style-tracking.md`, `image-alt-drops-formula.md`, `math-output-size-uncapped.md`, `math-hostile-markdown-saves-slowly.md` (the `$$` half only; the backtick half was never reproduced and is dropped), `extract-asset-refs-mirror-drift.md`.

## Goals

1. Formulas follow TeX's four styles (display D, text T, script S, scriptscript SS) for spacing and bracket growth.
2. Image alt text keeps a formula's text.
3. One formula's MathML output is capped.
4. The unclosed-`$$` shape renders in near-linear time.
5. The run Assets tab takes "which mini-projects use this file" from the server; the frontend copy of the backend's link rule is deleted.

Non-goals: new LaTeX commands; font sizes (the browser already shrinks fraction and script parts by MathML Core's `math-depth`); matrices/aligned; the `\bm` script placement and the choice `$…$` hint (both decided "won't fix", 2026-11-23).

Anti-goals: any formula that is right today coming out different except where TeX's style rules say it must; a hostile input made slow by the new code.

## 1. TeX style tracking (owner picked approach A)

### Approaches

- **A. Track TeX's four styles (chosen).** The parser carries the current style instead of the `display` flag. TeX's rules then decide each case: a fraction sets its parts one style down (D→T, T→S, S→SS, SS→SS), a script argument goes to S (from D or T) or SS (from S or SS), `\displaystyle`/`\textstyle` set D/T, and an `\over` split puts both halves one style down. Spacing and bracket measuring read the style. It mirrors TeX, so cases not listed here come out right without their own rule.
- B. Two flags (clear `display` in fraction parts and script arguments, tighten fraction parts when inline). Rejected: it patches the three listed symptoms one by one.

### What changes

Today (`backend/mathion/latex_mathml.py`): `Parser.display` is a bool; script arguments go through `tighten()` (binary, relation and punctuation operators lose their spacing, `relspace` spaces go); fraction parts are never tightened and do not clear `display`; the `\over` split sets `display = False` for the denominator only.

With A:
- `Parser.style` in {D, T, S, SS} replaces `Parser.display`. Today `display` is read in one place: `_left` → `_measure(node, parser.display)` (`\left…\right` growth). Limits are placed by the browser from `movablelimits` and the `display`/`mstyle` context (MathML Core already sets `mfrac` and script children to compact style), so limits placement does not change in the converter's output.
- **`_measure`** walks the finished tree with the style it is given; it must drop to non-display when it enters a script argument (`msub`/`msup`/`msubsup` scripts, `munder`/`mover` limits) or an `mfrac` part, so `$$\left( x^{\lim_n a} \right)$$` stops growing its brackets (pdflatex does not).
- **Spacing:** content in S or SS is tightened exactly as script arguments are today (TeX drops medium and thick spaces in script styles). So the parts of an inline `\frac`, of `\tfrac`, of a fraction inside a script, and both halves of an inline `\over` are tightened; the parts of a display `\frac` (style T) keep their spacing, as today.
- **Fraction parts:** parsed one style down. `\dfrac` parts are T (its own D, one down), `\tfrac` parts S (its own T, one down), `\binom` like `\frac`.
- **Script arguments:** parsed in S (from D or T) or SS (from S or SS), so bracket growth from a display limit no longer reaches inside a script. `\stackrel`/`\overset`/`\underset` tops (tightened today in `_stack`) count as script arguments (S).
- **`\over` / `\choose`:** both halves are one style down from the group's style (today only the denominator changes, and it is set to text). The numerator is parsed before the `\over` token is seen, so it is fixed up afterwards (re-tightened, and its `\left` brackets re-measured) rather than re-parsed: re-parsing nested groups (up to `MAX_DEPTH` 40) could take exponential time.
- **Explicit `\displaystyle` / `\textstyle`:** set D/T for what follows (today's `mstyle displaystyle … scriptlevel="0"` output stays); tightening stops at such a style, as `tighten()` already stops at an `mstyle` with a `scriptlevel`.
- **Square-root index:** stays SS-like (tightened, as today).
- **Output:** the MathML elements stay the same; what changes is which operators get `lspace="0em" rspace="0em"`, which `relspace` spaces are dropped, and where limits go and brackets grow. No new attributes are needed for size (MathML Core shrinks `mfrac` and script children itself).

### Checking it

pdflatex is on the development Mac (`/Library/TeX/texbin/pdflatex`). The builder sets a fixed list of formulas (below) in pdflatex and in Chrome and Safari, and compares spacing, limits and bracket heights by eye and by measurement. Reference list (at least):
`$\frac{a+b}{c}$` inline; `$$\frac{a+b}{c}$$`; `$\tfrac{a+b}{2}$`; `$x^{\frac{a+b}{2}}$`; `$$\frac{\left(\lim_n a\right)}{2}$$`; `$${\left(\lim_n c\right)\over b}$$`; `$a+b\over c$` inline; `$$\dfrac{a+b}{c}$$`; `$$\left( x^{\lim_n a} \right)$$`; `$\stackrel{a+b}{=}$`; `$$\sum_{i=1}^{n} x_i$$` (unchanged); `$e^{x+y}$` (unchanged).
Each becomes a converter test asserting the spacing attributes and bracket sizing that TeX's rules give.

## 2. Image alt text keeps formulas

`![a $x$ b](p.png)` renders `alt="a  b"` today (`backend/mathion/markdown.py`, the image's alt is built from its child tokens' text and the formula tokens have none). Fix: a formula token inside an image's alt contributes its LaTeX source without the dollar signs, so the alt is "a x b" (`$\alpha$` gives "\alpha"; the same as pandoc). Builder's call: where in the image rendering this hooks in.

## 3. Output cap per formula

`latex_to_mathml` caps the source length (`MAX_LENGTH`) but not the output, which can be 40-100 times larger (2000 `∑` ≈ 214 KB). Fix: if one formula's MathML is longer than 60 000 characters, raise `LatexError("formula too long")`, so the existing error box shows, as for a too-long source. Normal formulas are a few KB.

## 4. Unclosed `$$` renders in near-linear time

`"$$x\n# h\n" * 4000` (32 KB) takes 3.7 s today, growing quadratically (8 KB: 0.24 s): each unclosed `$$` searches the rest of the text for its closing `$$`. Profiling puts the cost in the block rules (`_block_end`, `markdown.py:311`, and the plugin's `_math_block_dollar`), each called once per opener and scanning to the end. Fix: bound that search so one unclosed opener does not rescan the whole text (the backlog's suggestion: stop at the first later line holding an unescaped `$`; the builder may pick another bound that gives the same results on every existing test). Test: the 32 KB shape renders in under 0.5 s (and 128 KB scales near-linearly); all existing Markdown and maths tests pass unchanged.

## 5. Asset usage from the server

Today the run Assets tab (`frontend/src/components/runs/RunAssetsTab.svelte`) works out which mini-projects use each file with `frontend/src/lib/extractAssetRefs.ts`, a regex copy of an old backend rule; the backend now scans markdown-it tokens (code spans, reference links, formulas), so the two disagree. The server already keeps the truth: `run_asset_references` rows (asset, mini-project), written by `sync_run_asset_references`, which also drives `is_referenced` and the delete guard.

Fix:
- `RunAssetResponse` gains `referenced_by: list[int]`, the mini-project ids from `run_asset_references`, ascending; `is_referenced` stays (`= bool(referenced_by)`). The list endpoint fetches all of a run's references in one query, not one per asset.
- The tab's `referencingMpIds(asset)` reads `asset.referenced_by` (keeping only ids of mini-projects it knows). `extractAssetRefs.ts` and its tests are deleted.
- **Upload and replace rebuild usage.** Today a force-deleted asset loses its rows (FK cascade) while the mini-project text still links its name; re-uploading that name writes no rows, so `is_referenced` is false and a plain teacher can delete it without `force` (a gap in today's delete guard too, hidden in the tab by the frontend regex). Fix (my call): uploading or replacing a run asset rebuilds its `run_asset_references` rows by scanning the run's mini-projects' `assignment_md` with the same backend rule, in the same transaction.
- Because the "used by" data now comes with the assets, every place that saves a mini-project's assignment on the run page must also refetch the assets (`onRefetchAssets`), so the chips update as they do today. The builder lists those places.

## Constraints

- No new dependencies (Python or JS). Code comments one short line.
- Run Python through `backend/.venv` with `-I`; never two pytest processes at once.
- The frontend gate (`frontend/scripts/visual-refresh-gate.sh`) stays green; update its pins where the Assets tab's markup or imports change.
- Never read `.superpowers/sdd/2026-11-17-olx-import/` (owner's private course).

## Left to the builder

- The exact `$$` bound (part 4), as long as results are unchanged.
- How the style is threaded through the parser (a field with save/restore like `display` today, or a parameter).
- The order of tasks; part 1 is the largest and goes through the usual review loop on its own.
- Which existing converter tests change expected output (each one must be explained by a TeX style rule in the review).
