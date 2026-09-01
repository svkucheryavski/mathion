# Visual Refresh — Slice 3: Student In-Sequence Content — Design Spec

**Status:** Design — approved in brainstorming 2026-09-01 (three key decisions locked). Ready for the user's spec-review gate, then `writing-plans`.

**Goal:** Restyle the student's in-course content experience — the sequence player chrome, the item content (page / video / quiz / interactive app), and the course landing — to the refreshed visual system, reusing the conventions and primitives established in Slice-1 (Foundation) and Slice-2 (Student Core). No feature is added or removed; this is styling, emoji removal, and two small copy/interaction-pattern touches only.

**Design authority:** `docs/design/visual-refresh/` — `mathion-visual-spec.md` (§3 colour-of-state, §4 components, §5 copy changes) + `reference-screens.dc.html` screens **2c** (Sequence player) and **10h** (Interactive app, student-view card). Two surfaces have **no pixel reference** and are styled pattern-faithfully by analogy (see §"No-reference surfaces"): the **CourseView** blocks→sequences landing and its `BlockGroup`/`SequenceLink` rows.

**Tech stack:** Svelte 5 (runes) + TypeScript; component tests via `mount`/`unmount`/`flushSync` from `svelte` (never `@testing-library`); `svelte-check`, `vitest`, `vite build`. No new runtime deps.

---

## Global Constraints

Inherited verbatim from Slice-1/2 (every task's requirements implicitly include these):

1. **Colours → tokens.** No hardcoded hex outside comments/brand-art. Every value resolves to a token in `frontend/src/styles/theme-default.css`.
2. **No opacity-based disabled/dim.** Recede via tokens (`--faint`, `--muted`, `--border-faint`), never `opacity`.
3. **No emoji anywhere** (spec §5.8). Decorative/status glyphs are inline SVG or the existing `ItemIcon`/`StatusBadge` marks. **Slice-3 removes three surviving emoji:** `✓` in `VideoItem`, `✓` in `SequenceLink`, `📋` in `MiniProjectLink`.
4. **Mono for every numeral** — item counters, "Question N of M", attempts, progress ratios, the numeric-answer field value. Use `--font-mono`.
5. **Per-component one-off geometry MAY be a literal** matching the reference verbatim (with a `/* ref NNNN */` comment), not everything is a token — but a literal must match the reference number and be annotated.
6. **Dense control metrics are final** (spec §4): `--control-h` 30px, `--btn-pad` 4px 10px, `--btn-pad-sm` 4px 9px, field value 13px, code/textarea blocks 8px/10px. Do not reintroduce roomier defaults.
7. **`ItemIcon` states** (already built, Slice-1): covered = `--primary` fill/white mark; current = `--primary-soft` fill + 1.5px `--primary` border + `--primary` mark; not-started = `--surface` + 1px `--border-strong` + `--muted` mark.
8. **No backend/API/route changes.** Coverage trackers (page 30s active-time, video mark-watched, interactive on-load), the quiz submit/reveal endpoints, and all routes stay exactly as they are. Slice-3 is presentation + the two copy touches in §5 below.
9. **Commit trailer (pinned, do NOT "correct"):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git add` exact named paths only (never `-A`/`.`).

### Decisions locked in brainstorming (2026-09-01)

- **D1 — Quiz stays all-at-once (restyle only).** The 2c reference shows one question ("Question 1 of 3" + singular "Submit answer"), but the backend submits the whole answer-map in one call and spec §5 (the authoritative interaction-change list) does not mention quiz pagination. Keep the current all-questions-stacked, single-Submit model; the reference's per-question counter becomes per-question numbering. No pagination, no state/backend change.
- **D2 — Quiz reveal uses the status-colour system.** Post-submit feedback: correct option → `--status-accepted-*` (green); the student's wrong pick → `--status-rejected-*` (red); a missed-correct answer → accepted family with an outline; explanation → a bordered `--surface-3` panel with a left rule. Replaces the current ad-hoc `--success`/`--danger` `color-mix()` (used nowhere else in the refreshed UI).
- **D3 — CourseView adopts the accordion + chain patterns.** Blocks render as §4 accordion sections (`--surface-2` header strip, mono `B{n}` code badge on `--primary-soft`, chevron); each sequence row shows its `ItemIcon` chain (§2c pattern) + mono progress. Pattern-faithful, not screen-exact (no pixel reference).
- **D4 — Footer Next = primary, names the destination.** Player footer: Previous = secondary; **Next = primary** naming the next item ("Next: {title} →"), and **"Finish sequence"** (primary) on the final item of the course-flat ordering (per 10h student-view). Plain "Next →" only when the next item's title is unavailable.

### Git stacking (surface at spec-review gate)

Slice-2 (`feat/visual-refresh-slice2-student-core`, tip `dca0a7b`) is **complete and review-clean but not merged** (push deferred until the whole redesign lands). Slice-3 restyles `SequencePlayer.svelte` (whose chain strip was delivered in Slice-2 T3) and consumes the Slice-2 primitive props. Therefore **Slice-3 branches off the Slice-2 tip `dca0a7b`, not `main`** — the slices form a stack `main(378a566) ← slice2 ← slice3` that merges in order when the redesign is done. No integration into `main` happens now (that is the user's finishing-a-branch call). **Recommended safest choice; confirm at the spec-review gate.**

---

## Scope

### In scope (components restyled)

**Player chrome**
- `pages/SequencePlayer.svelte` — breadcrumb, title, content width, footer (chain strip already done in Slice-2 T3).

**Item content**
- `components/items/PageItem.svelte` — markdown typography.
- `components/items/VideoItem.svelte` (+ `VideoFrame.svelte`) — title, framed embed, mark-watched, **emoji removal**.
- `components/items/InteractiveAppItem.svelte` (+ `InteractiveFrame.svelte`) — title, framed sandbox, notices (10h student card).
- `components/items/ItemRouter.svelte` — dispatcher; no visual change (verify only).

**Quiz (restyle only, status reveal)**
- `components/items/QuizItem.svelte` — "Check yourself" header, per-question numbering, Submit-answer primary, attempts copy, result/reveal/explanation block.
- `components/items/quiz/SingleChoiceQuestion.svelte`, `MultiChoiceQuestion.svelte` — drawn option control + selected state + status reveal.
- `components/items/quiz/NumericQuestion.svelte`, `TextQuestion.svelte` — refreshed field (numeric = mono) + status reveal line.

**Course landing (accordion + chain, D3)**
- `pages/CourseView.svelte` — course header, version info, blocks list.
- `components/course/BlockGroup.svelte` — accordion section.
- `components/course/SequenceLink.svelte` — sequence row + `ItemIcon` chain + mono progress, **emoji removal**.
- `components/course/MiniProjectLink.svelte` — mini-project row with the flag `ItemIcon`, **emoji removal**.
- `components/course/StatusPill.svelte` — tokenise/verify (already largely refreshed).

### Out of scope / deferred
- **Slice-4:** `pages/MiniProjectDetailPage.svelte` (592 lines, ref 9c student submission) + the submission workflow.
- **Interactive-app EDITOR** half of 10h (`InteractiveAppEditor.svelte`) — authoring surface, a later authoring slice.
- Teacher/monitoring, authoring/admin, superuser surfaces — later slices.
- Any backend, route, or coverage-logic change.

---

## Per-surface design

### 1. SequencePlayer chrome (ref 2c)

Current: a stacked crumb block (`← Course`, `B{order}. title`, `S{order}. title`), an `<h1>` carrying `S{order}. {title}`, the chain `.strip` (done in Slice-2 T3), a `.content` pane, and a symmetric secondary Previous/Next footer.

Target (2c, lines 2106–2141):
- **Breadcrumb** (replaces stacked crumbs): a single horizontal row, 12.5px `--muted`, segments separated by `--faint` `/` glyphs, last segment `--text`: `{course name} / B{n} · {block title} / S{n}`. The **course-name segment links back** to the course view (replacing the `← Course` link). Bottom margin ~10px.
- **`<h1>`** = the sequence title **only** (drop the `S{order}.` prefix — it now lives in the breadcrumb): 20px/600, `letter-spacing:-.015em`, `--text`, `margin:0 0 14px`.
- **Chain strip:** unchanged from Slice-2 T3 (6px gap, `ItemIcon`s, mono "Item N of M" right, `--border` bottom rule). Verify it still matches after the header change.
- **Content:** wrapper `max-width: 68ch`, `display:flex; flex-direction:column; gap:16px` (ref 2120).
- **Footer (D4):** `justify-content:space-between`, `margin-top:24px`, `padding-top:14px`, `--border` top rule. **Previous** = secondary Button (disabled at the flat-start). **Next** = **primary** Button; label = `Next: {next item title} →` when a next item exists, `Finish sequence` when the current item is the last in the course-flat ordering (ref 10h line 1049), plain `Next →` as the fallback when the next title is unknown. Uses the existing `flatItems`/`flatIndex` logic (unchanged) to resolve the next item and its title.
- **Loading / not-available / not-found / empty** states: tokenise the existing `<h1>`/`<p>`/ghost-Button blocks (no structural change).

### 2. Item content

**PageItem** (markdown): keep the `<h2>` title + `@html` sanitised content (trust boundary comment at `PageItem.svelte:8-10` is load-bearing — preserve verbatim). Typographic pass on the `:global` content styles: body `--text-2`, `line-height:1.6`, reading measure inheriting the 68ch wrapper, headings on the type scale, **code/pre blocks** on the control tokens (`--surface-2` background, 8px/10px padding, `--font-mono`, `--radius`), links `--primary`. No change to the 30s coverage effect.

**VideoItem** (+ `VideoFrame`): `<h2>` title; the embed framed on a `--surface` card with `1px --border`, `--radius`; primary "Mark as watched" Button (unchanged behaviour); **replace the `✓ Marked as watched` emoji line** with an SVG check (the `ItemIcon` quiz-check mark or an inline check) + `--muted`/`--success`-token text — no emoji. `VideoFrame` embed container tokenised (aspect box, `--border`).

**InteractiveAppItem** (+ `InteractiveFrame`, ref 10h student card, lines 1035–1052): `<h2>` title; the sandbox frame in a bordered box (`1px --border`, `--radius`, `--surface`; ref shows a 150px min frame area); the `empty`/`error` notices tokenised (`--muted`, no `font-style:italic` emoji). The load-bearing coverage `$effect` and its abort/stale guards (`InteractiveAppItem.svelte:24-70`) are **preserved verbatim** — this is a style-only change to markup/CSS around them.

**ItemRouter:** dispatcher only; confirm no visual change and that its existing test still passes.

### 3. Quiz "Check yourself" (D1 restyle-only, D2 status reveal)

**QuizItem shell** (ref 2c lines 2120–2136):
- Header row: `<h2>Check yourself` 16px/600 `--text` + mono per-question label. With D1 (all-at-once), number each question inline: a mono `Question {i} of {n}` 11.5px `--muted` label per question (the reference's single "Question 1 of 3" becomes the first question's label). Keep the empty-quiz branch.
- Questions render stacked (unchanged control flow at `QuizItem.svelte:135-153`), each on the refreshed question components below.
- **Submit** = primary Button labelled **"Submit answer"** (ref 2133), disabled until `allAnswered` (logic unchanged).
- **Attempts copy:** replace the current `Maximum N attempts per quiz (X used)` hint with inline `{remaining} attempts left` (ref 2134) beside/under Submit, `--muted` 12.5px. Compute `remaining = max - attemptsUsed` from existing `attemptsUsed`/`max_quiz_attempts` (no new state).
- **Result / reveal block:** tokenise `.result` (score, attempt count) into a `--surface-3`/`--border` card; "Try again" (primary) and "Show correct answers" (secondary) unchanged in behaviour.
- **Explanation** (`r.explanation_html`): a bordered `--surface-3` panel with a 3px `--primary` left rule (D2), `--text-2`, replacing the current `.exp` `--border` left-rule at reduced font.

**Choice questions** (Single + Multi, ref 2c lines 2126–2131):
- Each option is a **drawn control** (hide the native `<input>` visually-hidden like the Slice-2 segmented control; keep it as the real focusable/checkable input for a11y + `bind`): a row, `padding:4px 9px`, `--radius`, `gap:10px`, 14px `--text-2`.
  - **Unselected:** `1px --border-strong`, `--surface`; the radio/checkbox drawn as a 15px circle (radio) / square-ish (checkbox) with `1.5px #C4CAD4`-family border (a `--border-strong`-adjacent token or literal).
  - **Selected:** `1.5px --primary` border, `--primary-soft` background, weight 500, `--text`, a soft ring `box-shadow: 0 0 0 3px {pale tint}` (ref `#F2F5F8` — per-component literal with `/* ref 2128 */`), and a filled `--primary` dot (radio) / check (checkbox).
- **Reveal (D2), when `correctOptionIds !== null`:** correct option → `--status-accepted-bg` / `--status-accepted-fg` + accepted-family border; the student's wrong pick → `--status-rejected-bg` / `--status-rejected-fg` + rejected-family border; a correct option the student missed → accepted family with an outline (distinct from a chosen-correct). Keep the existing `isCorrect`/`isWrongPick` `$derived` logic; only the class→token mapping changes. Preserve exhaustiveness (`assertNever`) wiring in QuizItem.

**Numeric + Text questions:**
- Field becomes the refreshed control (control tokens: `--control-h`, `--control-pad-x`, `--radius`, `1px --border-strong`, 13px value). **Numeric answer value is a numeral → `--font-mono`** (Global Constraint 4). Consider reusing the `ui/Input` primitive; if the question components keep their own `<input>`, they must match the control tokens exactly.
- **Reveal line** (`correctValue`/`correctText !== null`): move off `--success`/0.9rem onto the status-accepted token family, consistent with the choice reveal.

### 4. CourseView landing (D3 accordion + chain — no pixel reference)

**CourseView:** course-name `<h1>` header (tokenised; the `← Courses` ghost Button may stay or become a breadcrumb — keep the ghost Button for consistency with the not-found path), version `info_html` in a `--muted` block, then the blocks list. Error/empty states tokenised. The existing `CourseView.svelte.test.ts` must keep passing (adjust selectors only if markup changes).

**BlockGroup → accordion** (spec §4 Accordions): header = `--surface-2` strip with a mono **`B{order}`** code badge (11px/500 `--primary` on `--primary-soft`, `--radius-pill`), title 14px/600 `--text`, a borderless chevron toggle right (SVG or the existing `▾/▸` replaced with an SVG chevron per no-emoji-adjacent cleanliness — `▾` is a geometric glyph, not emoji, but prefer the SVG chevron used elsewhere for consistency). `expanded` state unchanged. Sequence list + optional `MiniProjectLink` unchanged in structure. Existing `BlockGroup.svelte.test.ts` must keep passing.

**SequenceLink → row + chain:** the row shows the sequence title (`S{order}. {title}` or title with `S{n}` as a mono lead — match the accordion item-row pattern §4: `13px title + mono slug`), its **`ItemIcon` chain** (compact, §2c pattern, reusing `iconState`-style covered/current/not-started — here just covered/not-started since there is no "current" outside the player), and a mono progress count `{covered}/{total}`. **Replace the emoji `✓`** with the completion state carried by the chain / an SVG check. Uses `formatProgress` (unchanged) for the count text.

**MiniProjectLink → row:** lead with the **mini-project `ItemIcon` (flag mark)** replacing the `📋` emoji glyph; keep the load-bearing `aria-label` (status announcement — `MiniProjectLink.svelte:39-46`), `encodeURIComponent` href, and `titleForLabel`/`statusLabel` `LATEST_STATUS_META` wiring verbatim; compose `StatusPill` as now. Add the row styling the component currently lacks (it has no `<style>`), aligned with `SequenceLink`'s row.

**StatusPill:** already token-driven via `LATEST_STATUS_META` (label/cls/token, non-colour glyph for colourblind users). Verify the glyph `token` is not an emoji and the `pill-*` classes resolve to status tokens; tokenise if any gap. Preserve the D3 no-aria-label policy (`StatusPill.svelte:9-13`).

---

## Data flow & error handling

No change. Item resolution (hash → last-visited → first), the `flatItems` cross-sequence Previous/Next, quiz submit/reveal state machine (`inflight`/`lastResult`/`revealed`/`autoRevealed`/`locked`), and the three coverage trackers are all preserved verbatim. Slice-3 touches markup/CSS and the two copy strings in §"Submit"/§"attempts"/footer labels (D4) only. Every load-bearing comment and effect guard listed above is preserved.

---

## Testing strategy

Same as Slice-1/2. Component tests use `mount`/`unmount`/`flushSync`; TDD RED→GREEN per task; assert **load-bearing structure/classes** (jsdom cannot compute cascade, so CSS-only changes are verified via `svelte-check` no-unused-selector + build + built-CSS grep, as with the Slice-2 segmented control).

- **Existing tests that must keep passing** (adjust selectors only as markup changes, do not weaken assertions): `CourseView`, `BlockGroup`, `InteractiveAppItem`, `InteractiveFrame`, `ItemRouter`, `MiniProjectLink`, `StatusPill`.
- **New focused tests** for currently-untested restyled behaviour: `SequencePlayer` (breadcrumb structure; footer Next primary + names next / "Finish sequence" at the end), `QuizItem` ("Check yourself" header, "Submit answer" label, "{n} attempts left" copy, reveal panel + explanation), `SingleChoiceQuestion`/`MultiChoiceQuestion` (selected class; status-token reveal classes for correct / wrong-pick / missed-correct), `NumericQuestion` (mono class on the field; status reveal line), `VideoItem`/`SequenceLink`/`MiniProjectLink` (no emoji present in output — assert the emoji chars are absent and the SVG/`ItemIcon` is).
- **Gate per task:** `svelte-check` 0 errors + baseline warnings (currently 36; must not grow), full `vitest` green, `vite build` OK. Every `.svelte` edit validated with the Svelte autofixer (real `issues` only; the data-fetch `$effect` "malpractice" *suggestion* is pre-existing/advisory).
- **Review:** per-task two-lane gate (codex@high + first-party@opus, fix all Critical/Important, re-review until clean) + a whole-branch final review at the end.

---

## Task decomposition (~6 tasks; finalised in the plan)

1. **T1 — SequencePlayer chrome:** breadcrumb + title (drop `S{n}` prefix) + 68ch content wrapper + footer (Next primary, names next / "Finish sequence"). Tests: breadcrumb segments + course-link-back; footer label logic.
2. **T2 — Choice questions:** `SingleChoiceQuestion` + `MultiChoiceQuestion` — drawn option control, selected state, D2 status reveal. Tests: selected class; reveal classes (correct / wrong-pick / missed-correct).
3. **T3 — Numeric + Text questions:** refreshed field (numeric mono), D2 reveal line. Tests: mono class; reveal line token.
4. **T4 — QuizItem shell:** "Check yourself" header + per-question numbering, "Submit answer" primary, "{n} attempts left" copy, result/reveal card + explanation panel. Tests: header, labels, attempts copy, reveal/explanation structure.
5. **T5 — Page / Video / Interactive items (+ frames):** typographic + framing pass; **remove VideoItem `✓` emoji**; 10h student-card framing. Tests: no-emoji assertions; framed structure; existing `InteractiveAppItem`/`InteractiveFrame`/`ItemRouter` tests stay green.
6. **T6 — CourseView landing:** `CourseView` + `BlockGroup` accordion + `SequenceLink` chain row + `MiniProjectLink` flag row + `StatusPill`; **remove SequenceLink `✓` and MiniProjectLink `📋` emoji**. Tests: block code badge; sequence chain + mono progress; mini-project flag `ItemIcon`; no-emoji assertions; existing `CourseView`/`BlockGroup`/`MiniProjectLink`/`StatusPill` tests stay green.

Order rationale: T1 is the standalone shell; T2→T4 build the quiz bottom-up (question controls before the shell that hosts them); T5 the remaining item types; T6 the landing. Each ends with an independently testable deliverable and its own review gate.

---

## Self-review (spec)

- **Placeholder scan:** none — every surface names its file, its reference (or "no-reference, pattern-faithful"), and its concrete token treatment.
- **Consistency:** D1 (all-at-once) is honoured by T2–T4 (no pagination state); D2 (status tokens) is applied identically in choice + numeric/text reveal; D3 (accordion+chain) drives T6; D4 (Next primary) drives T1. The "no backend change" constraint holds across all tasks (quiz submit map, coverage effects untouched).
- **Scope:** focused on one cohesive surface (student in-sequence content); mini-project submission (9c) and the interactive-app editor are explicitly deferred.
- **Ambiguity resolved:** the 2c "Question 1 of 3" is interpreted as illustrative (D1); the option ring `#F2F5F8` is a per-component literal (Constraint 5); the git base is the Slice-2 tip (stacking note).
- **Open item for the user at the review gate:** confirm the **git stacking** choice (branch Slice-3 off `dca0a7b`, not `main`).
