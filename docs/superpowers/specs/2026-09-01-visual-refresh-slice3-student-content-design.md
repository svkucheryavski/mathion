# Visual Refresh — Slice 3: Student In-Sequence Content — Design Spec

**Status:** Design — in the spec-review convergence loop (rev 2, folds round-1 findings from 3 lanes: codex + two first-party reviewers). Ready for re-review.

**Goal:** Restyle the student's in-course content experience — the sequence player chrome, the item content (page / video / quiz / interactive app / unsupported), and the CourseView blocks→sequences landing — to the refreshed visual system, reusing Slice-1/2 conventions. This is styling + decorative-emoji removal + a small, enumerated set of copy/interaction touches (each listed in §"Enumerated behaviour changes"); no other feature is added or removed.

**Design authority:** `docs/design/visual-refresh/` — `mathion-visual-spec.md` (§3 colour-of-state, §4 components, §5 copy) + `reference-screens.dc.html` screens **2c** (Sequence player, ~L2087-2144) and **10h** (Interactive-app *student card*, ~L1035-1052). **No-reference surfaces** styled pattern-faithfully by analogy: CourseView landing, `BlockGroup`, `SequenceLink`. Screen **9d** (loading skeletons / empty-state cards) is acknowledged and **explicitly deferred** to a future states slice (see §"Deferred").

**Tech stack:** Svelte 5 (runes) + TypeScript; component tests via `mount`/`unmount`/`flushSync` (never `@testing-library`); `svelte-check`, `vitest`, `vite build`. No new runtime deps.

---

## Global Constraints

Inherited verbatim from Slice-1/2 (every task implicitly includes these):

1. **Colours → tokens.** No hardcoded hex anywhere outside comments/brand-art. Every colour resolves to a token in `frontend/src/styles/theme-default.css`. (Round-1 C1/CR-F: the earlier `#C4CAD4`/`#F2F5F8` literals are removed — see §3 option control, which now uses only existing tokens.)
2. **No opacity-based disabled/dim.** Recede via tokens (`--faint`, `--muted`, `--border-faint`), never `opacity`.
3. **No *decorative* emoji on Slice-3 surfaces** (spec §5.8). Slice-3 removes the three **decorative** emoji: `✓` in `VideoItem` (`VideoItem.svelte:37`), `✓` in `SequenceLink` (`SequenceLink.svelte:19`), `📋` in `MiniProjectLink` (`MiniProjectLink.svelte:44`). **Carve-out (do NOT remove):** the `LATEST_STATUS_META` glyph tokens `✓ · ~ × ! …` (`studentMiniProjects.ts:44-50`) are the deliberate **non-colour, colourblind status signal** (C14) rendered by `StatusPill`; they stay, and `StatusPill.svelte.test.ts:31` continues to assert them. Emoji on **deferred** surfaces (`OptionRow`, `AssetSidebar`, `ItemRow`, `ItemTypePicker`, `QuestionAccordion`, etc.) are out of scope; this constraint is scoped to Slice-3 surfaces, not repository-wide.
4. **Mono for every numeral** (`--font-mono`) — item counters, per-question "Question N of M", attempts count, progress ratios, the numeric-answer field value. Reference mock-ups that spell a number as a word ("Two attempts left", ref 2134) do **not** override this — the app renders a digit, so it is mono.
5. **Per-component one-off geometry MAY be a literal** matching the reference verbatim, annotated `/* ref NNNN */`. **Literals are geometry ONLY** — never colours (Constraint 1).
6. **Dense control metrics are final** (spec §4): `--control-h` 30px, `--control-pad-x` 9px, field value 13px, `--btn-pad` 4px 10px, `--btn-pad-sm` 4px 9px, code/textarea blocks 8px/10px. Do not reintroduce roomier defaults.
7. **`ItemIcon`/`ItemMark` states** (Slice-1): covered = `--primary` fill/white mark; current = `--primary-soft` + 1.5px `--primary` border + `--primary` mark; not-started = `--surface` + 1px `--border-strong` + `--muted` mark.
8. **No backend/API/route/schema changes.** The quiz submits the whole answer-map in one POST (`QuizItem.svelte:84`); coverage trackers (page 30s active-time, video mark-watched, interactive on-load) and all routes are untouched. The only behaviour changes are the enumerated ones in §"Enumerated behaviour changes", all client-side.
9. **Commit trailer (pinned, do NOT "correct"):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git add` exact named paths only (never `-A`/`.`).

### Decisions (locked in brainstorming, refined by round-1 review)

- **D1 — Quiz stays all-at-once (restyle only).** Backend submits the whole answer-map; spec §5 does not authorise pagination. Questions stay stacked with one Submit. No state/backend change.
- **D2 — Quiz reveal uses the status-colour system + a non-colour mark.** *Choice* questions (correct_option_ids present) get a **four-state** reveal (see §3): chosen-correct, wrong-pick, **missed-correct**, neutral — each a distinct class from new client-side derivations, each carrying a **non-colour SVG mark** (colourblind/forced-colors safe, per C14). *Numeric/Text* questions have **no per-question `is_correct` in the payload** (`QuestionReveal`, `types.ts:161-170`), so they show **only the correct answer** in the accepted family and **deliberately do not judge the student's own value** (no client-side `===` that could disagree with the server score).
- **D3 — CourseView adopts accordion + chain patterns** via a new presentational `ItemMark` primitive (see D5). Blocks = §4 accordion sections; each sequence row shows a **non-interactive** `ItemMark` chain + mono progress. Pattern-faithful, not screen-exact.
- **D4 — Footer: Next = primary naming the destination; end-of-sequence "Finish sequence" navigates to the course view.** Previous = secondary (`disabled` at flat-start). Next = primary; label `Next: {next item title} →` (title from an extended `FlatRef`, see §"Enumerated behaviour changes"). When the current item is the **last of its sequence** (not merely the flat end), the primary becomes **"Finish sequence"**, **enabled**, navigating to the existing `/courses/{courseSlug}` route (a small, enumerated interaction change — NOT a no-op, NOT a route addition). Plain `Next →` only when a next item exists but its title is empty/whitespace.
- **D5 — New additive primitive `ItemMark.svelte`** (the Slice-2 additive-primitive pattern, like `Logo form`/`Button full`). `ItemMark` is the presentational 22px square + type SVG mark + covered/current/not-started state as a non-interactive `<span aria-hidden="true">`, taking `type: ItemType` + `state`. `ItemIcon.svelte` is **refactored to compose `<button …><ItemMark …/></button>`**, preserving its exact button/`onclick`/`title`/`aria-label`/`data-type` contract so `ItemIcon.svelte.test.ts` stays green. `SequenceLink` (chain) and `MiniProjectLink` (single flag mark) use `ItemMark` directly — no nested interactive content, no fabricated `Item` objects.
- **D6 — `StatusPill` is authored from scratch.** It currently has **no `<style>` block** and the `pill-*` classes resolve to nothing (round-1 C2/C3 confirmed). T8 writes the pill geometry + an exact class→token table (below).

---

## Enumerated behaviour changes (the ONLY non-pure-styling touches)

All client-side; none touch the backend/routes/schema:

1. **`FlatRef` gains `title: string`** (`SequencePlayer.svelte:101-110`) so the footer can name the next item. Ordering logic (`flatItems`/`flatIndex`/`previous`/`next`) is otherwise unchanged.
2. **Footer "Finish sequence"** (D4): at the last item of the current sequence, the primary Button is enabled and calls a new `finish()` → `navigate('/courses/{courseSlug}')`. Existing route; no addition.
3. **Attempts copy** (`QuizItem`): replace `Maximum N attempts per quiz (X used)` with `{remaining} {attempt|attempts} left`, where `remaining = Math.max(0, max - attemptsUsed)`; **suppress the line entirely when `max_quiz_attempts` is undefined** (no `NaN`/`?`); singular "1 attempt left"; the numeral is `--font-mono` (Constraint 4); the line renders in the **pre-submit (`!locked`) state only** (the result block owns the locked-state attempt display).
4. **Choice reveal derivations** (§3): new client-side `$derived`/`{@const}` `isChosen`, `isMissedCorrect` (data already present via `selected` + `correctOptionIds`).
5. **`SequenceLink` drops the `formatProgress` import** and renders a mono `{covered}/{total}` (no spaces, matching CourseCard), because `formatProgress` returns `"{covered} / {total}"` *with* spaces (`format.ts:2`). `format.test.ts` keeps the helper covered; `SequenceLink`'s non-reactive `total`/`href` become `$derived`.
6. **`MiniProjectLink.svelte.test.ts` assertion edit** (authorised): the `textContent === '📋'` assertion (`:127`) inverts to "no `📋`; the flag `ItemMark` is present"; the `aria-hidden="true"` on the lead glyph and the `.row-glyph`/`.row-mp`/`.row-title` class contracts (depended on by `BlockGroup` styling) are preserved.

Everything else is pure styling/tokenisation.

---

## Scope

### In scope
**Player:** `pages/SequencePlayer.svelte`.
**Item content:** `components/items/PageItem.svelte`, `VideoItem.svelte`, `InteractiveAppItem.svelte`, `UnsupportedItem.svelte`, `ItemRouter.svelte` (verify-only dispatcher). **Shared frames `VideoFrame.svelte`/`InteractiveFrame.svelte` are NOT restyled** — the card framing lands in the *item wrappers* (`VideoItem`/`InteractiveAppItem`), leaving the frames untouched so the deferred editor consumers (`ItemEditPage`, `InteractiveAppEditor`) are unaffected; `InteractiveFrame`'s fixed 600px stays (ref 10h's 150px is a schematic mock).
**Quiz:** `components/items/QuizItem.svelte` + `quiz/SingleChoiceQuestion.svelte`, `MultiChoiceQuestion.svelte`, `NumericQuestion.svelte`, `TextQuestion.svelte`.
**Landing + primitives:** `pages/CourseView.svelte`, `components/course/BlockGroup.svelte`, `SequenceLink.svelte`, `MiniProjectLink.svelte`, `StatusPill.svelte`, `ItemIcon.svelte` (refactor to compose `ItemMark`), **new `components/course/ItemMark.svelte`**.
**Tokens:** `frontend/src/styles/theme-default.css` — verify-only (no new tokens are required; §3 uses existing tokens).

### Out of scope / deferred
- **Slice-4:** `pages/MiniProjectDetailPage.svelte` (ref 9c). Note it shares the `pill pill-*` class names (`MiniProjectDetailPage.svelte:527`) — the StatusPill styling authored here must be reachable by it (scoped-vs-global ruling in T8).
- Interactive-app **editor** (`InteractiveAppEditor`), all authoring/teacher/superuser surfaces.
- **Screen 9d** loading skeletons + empty-state cards (there is no skeleton primitive yet; `LoadingPlaceholder` is an italic text line). Slice-3 only **tokenises the existing `Spinner`/paragraph** loading/empty/error blocks; the skeleton redesign is a later states slice.
- Any backend/route/schema change.

---

## Per-surface design

### 1. SequencePlayer chrome (ref 2c) — T1

- **Breadcrumb** (replaces the stacked crumbs): extract **one `{#snippet}`** used by BOTH the empty-sequence branch (`SequencePlayer.svelte:150-157`) and the normal branch (`160-167`) so the file ships one chrome. Horizontal row, 12.5px `--muted`, `--faint` `/` separators, last segment `--text`: `{course name} / B{n} · {block title} / S{n}`. The **course-name segment links back** to `/courses/{courseSlug}`. **Fallbacks:** drop the block segment (and its separator) when `currentBlock === null` (`:37-41`); the course-name segment tolerates an absent name while loading.
- **`<h1>`** = the sequence title only (the `S{n}` moves into the breadcrumb). **Keep the base `h1` size (21px, `base.css:16`)** — Slice-2 ruled that per-page `<h1>` overrides fragment the scale; change only `margin: 0 0 14px` (ref 2110). Do not add a 20px override.
- **Chain strip:** fold in the ref-2c geometry Slice-2 explicitly deferred to this pass — `padding-bottom: 14px; margin-bottom: 20px` (ref 2112) — while preserving the Slice-2 `gap: 6px` (ref 2112), the mono "Item N of M" counter (ref 2117), the `--border` bottom rule, and wrapping.
- **Content wrapper:** `max-width: 68ch` (ref 2120). Note `gap:16px` is inert with a single `ItemRouter` child — the per-item internal spacing lives in the item components (§2), not here; the wrapper only bounds measure + top spacing.
- **Footer (D4):** `justify-content:space-between`, `margin-top:24px`, `padding-top:14px`, `--border` top rule. **Previous** = secondary Button, `disabled={flatIndex <= 0}`. **Next/Finish** = primary Button: within a sequence → `Next: {nextTitle} →` (from the extended `FlatRef.title`); at the sequence's last item → **`Finish sequence`**, enabled, `onclick=finish()` → `navigate('/courses/{courseSlug}')`; `Next →` fallback when `nextTitle` is empty/whitespace.
- **Loading / not-available / not-found** states: tokenise the existing `<h1>`/`<p>`/ghost-Button blocks (pure tokenisation; the empty-sequence branch additionally gets the shared breadcrumb snippet per above). Skeletons deferred (9d).

### 2. Item content — T5

Uniform rules across `PageItem`/`VideoItem`/`InteractiveAppItem`/`UnsupportedItem`:
- **Article padding:** each item article currently adds its own 16px padding (`PageItem.svelte:39`, `VideoItem.svelte:42`, `QuizItem.svelte:179`, etc.), which indents headings relative to the chain. **Rule: remove the per-article horizontal padding** (the 68ch wrapper + player padding own horizontal rhythm); keep a small top gap so the heading sits directly under the chain like ref 2c.
- **Item `<h2>`:** unify all four item-type headings at **16px/600 `--text`** as a per-component literal `/* ref 2122 */` (Slice-2 deferred the 15-vs-16 item-heading decision to this pass; apply it uniformly rather than only to the quiz). Do not change `base.css` `h2` globally.

Per component:
- **PageItem:** preserve the trust-boundary comment verbatim (`PageItem.svelte:8-10`). Typographic pass on the `:global` content styles: body `--text-2` at `line-height:1.6`, headings on the scale, links `--primary`, **code/pre blocks** `--surface-2` bg + 8px/10px padding + `--font-mono` + `--radius`. 30s coverage `$effect` untouched.
- **VideoItem:** `<h2>` title; the `VideoFrame` embed wrapped in a **`--surface`/1px `--border`/`--radius` card in VideoItem** (VideoFrame itself untouched); primary "Mark as watched" Button; **replace the `✓ Marked as watched` decorative emoji** with an inline check SVG (the `ItemMark` quiz-check glyph) + text on a status token. Coverage tracker (`:13-28`) untouched.
- **InteractiveAppItem:** preserve the coverage `$effect` + abort/stale guards verbatim (`InteractiveAppItem.svelte:33-70`, and the `coverStartedForId` guard comment at `:13-16`). `<h2>` title; the `InteractiveFrame` (fixed 600px, untouched) wrapped in a **bordered card in InteractiveAppItem** (ref 10h student card); the `empty`/`error` notices tokenised to `--muted` (drop `font-style:italic`). Ref 10h's "Marked covered once opened." hint is **intentionally omitted** (§5 authorises no new copy).
- **UnsupportedItem:** rendered by `ItemRouter` for `mini_project` items in a sequence (`ItemRouter.svelte:20-21`). Tokenise its text only. It prints the raw type string; per spec §5.7 (types carried by the icon, not text) this is acceptable for an **error/fallback** surface — keep the informative text, just tokenise it. Verify its existing behaviour.
- **ItemRouter:** dispatcher; no visual change — verify its existing test stays green.

### 3. Quiz "Check yourself" (ref 2c, D1/D2) — T2 (choice), T3 (numeric/text), T4 (shell)

**QuizItem shell (T4):**
- Header: `<h2>{item.title}</h2>` (**NOT** a hardcoded "Check yourself" — that is the reference's demo item title, ref 2115/2122) styled 16px/600 `--text` `/* ref 2122 */`.
- **Per-question counter:** the `<h2>` row carries **no** counter; **each question block is preceded by its own mono 11.5px `--muted` `Question {i} of {n}` label** (ref 2123). (One consistent rule — avoids double-labelling the first question.)
- Questions render stacked (control flow `QuizItem.svelte:135-153` unchanged), each on the refreshed components below; preserve the `assertNever` exhaustiveness wiring (`:111-124`) and the submit/reveal state machine (`inflight`/`lastResult`/`revealed`/`autoRevealed`/`locked`).
- **Submit** = primary Button "Submit answer" (ref 2133), `disabled={!allAnswered}` (logic unchanged). Submit-row `gap:12px` (ref 2132).
- **Attempts copy:** per §"Enumerated behaviour changes" item 3.
- **Result/reveal block:** tokenise `.result` into a `--surface-3`/`--border`/`--radius` card (score + attempt count, mono numerals); "Try again" (primary) / "Show correct answers" (secondary) behaviour unchanged.
- **Explanation** (`r.explanation_html`): a bordered `--surface-2` panel with a 3px `--primary` left rule — reusing the spec §4 "precondition/information banner" treatment (`--surface-2` + `--primary` rule) rather than inventing a `--surface-3` variant — `--text-2` body.

**Choice questions (Single + Multi, T2):**
- **Prompt** (`legend`): 14.5px / `line-height:1.6` / `--text-2` / **weight 400** (ref 2125 — the current `legend { font-weight:500 }` is dropped).
- **Option list:** `gap:8px` (ref 2126). Each option is a **drawn control**: the native `<input>` stays as the real focusable/checkable element but is visually hidden **sr-only** (the exact Slice-2 segmented pattern), the `<label>` is `position:relative` and painted:
  - Row: `padding: var(--btn-pad-sm)` (= 4px 9px, ref 2127, token per Constraint 1), `--radius`, `gap:10px`, 14px `--text-2`.
  - **Unselected:** 1px `--border-strong`, `--surface`; drawn radio/checkbox glyph = 15px circle/box with a **`--faint`** border (the ref's mid-grey control outline; token, not a literal).
  - **Selected:** 1.5px `--primary` border, `--primary-soft` background, weight 500, `--text`; drawn glyph filled `--primary` (dot for radio, check for checkbox). (The ref's soft outer ring is dropped — it collides with the focus system; the border + soft fill carry selection, matching `ItemMark`'s `current` treatment.)
  - **Focus + forced-colors (copy Slice-2 M5 verbatim):** `input:focus-visible { box-shadow: none }` to suppress the global glow (`base.css:21-25`); `label:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary) }`; `@media (forced-colors: active)` outlines for both selected and focused states.
- **Reveal — four states (D2), when `correctOptionIds !== null`:** add client-side `isChosen` (`selected === opt.id` / `selected.has(opt.id)`) alongside the existing `isCorrect`/`isWrongPick`; derive `isMissedCorrect = isCorrect && !isChosen`. Classes + treatment (each with a **non-colour SVG mark**, forced-colors safe):
  - **chosen-correct** (`isCorrect && isChosen`): `--status-accepted-bg`, `border-color: var(--status-accepted-fg)`, a check SVG.
  - **wrong-pick** (`isWrongPick`): `--status-rejected-bg`, `border-color: var(--status-rejected-fg)`, an × SVG.
  - **missed-correct** (`isMissedCorrect`): `--status-accepted-bg` with a **1.5px dashed `--status-accepted-fg`** border (distinct from chosen-correct's solid) + a check SVG.
  - neutral: unchanged.
  Replaces the ad-hoc `color-mix(--success/--danger)` (`SingleChoiceQuestion.svelte:45-46`, `MultiChoiceQuestion.svelte:49-50`). A **multi-choice partial-answer** test must exercise all four states in one question.

**Numeric + Text questions (T3):**
- Field = a local `<input>` on the control tokens (**not** `ui/Input`, whose `mono` is PIN-specific 17px/.34em and which lacks `disabled`/`inputmode` — round-1 I9/I14): `height: var(--control-h)`, `padding: 0 var(--control-pad-x)`, `font-size: var(--control-font)` (13px), 1px `--border-strong`, `--radius`; **numeric field adds `font-family: var(--font-mono)`** (Constraint 4). Keep `disabled={locked}` and `inputmode="decimal"`.
- **Reveal (D2):** show **only the correct answer** in the accepted family (`--status-accepted-fg` text, mono for the numeric value), on its own line — **do not judge the student's value** (no per-question `is_correct` exists in `QuestionReveal`; grading tolerance/normalisation is server-side). Move off the `--success`/0.9rem line.

### 4. CourseView landing (accordion + chain, D3/D5/D6) — T6 (ItemMark), T7 (rows), T8 (CourseView/BlockGroup/StatusPill)

**ItemMark primitive (T6):** as D5. Add `components/course/ItemMark.svelte` (presentational `<span aria-hidden="true">`, `type: ItemType` + `state`), move the SVG marks + state CSS there, refactor `ItemIcon.svelte` to `<button …><ItemMark …/></button>`. `ItemIcon.svelte.test.ts` (queries `button`, `data-type`, `title`) must stay green; add an `ItemMark.svelte.test.ts` (renders the right mark per type; `aria-hidden`; state classes).

**SequenceLink (T7):** whole-row `<a>` (unchanged) containing the sequence title (`S{n}. {title}`), a **non-interactive `ItemMark` chain** for its items (covered/not-started state from `state.items[…].is_covered`; no `current` on the landing), and a mono `{covered}/{total}` count (per §"Enumerated behaviour changes" item 5 — no `formatProgress`, `$derived` `total`/`href`). **Remove the `✓` emoji** — completion is carried by the chain (all-covered) / a check `ItemMark`.

**MiniProjectLink (T7):** lead with a single **flag `ItemMark`** (`type='mini_project'`, `aria-hidden`) replacing the `📋` glyph; preserve the load-bearing `aria-label`, `encodeURIComponent` href, and `LATEST_STATUS_META` wiring verbatim (`:28-46`); keep the `.row-glyph`/`.row-mp`/`.row-title` class contracts (BlockGroup + tests depend on them); compose `StatusPill` as now. Test edit per §"Enumerated behaviour changes" item 6.

**BlockGroup accordion (T8):** replace the pointer-only `<header onclick>` (which carries 2 of the 36 baseline warnings — `a11y_click_events_have_key_events`, `a11y_no_static_element_interactions`) with a **real `<button aria-expanded aria-controls>`** toggling a `role="region"` panel with a stable id, an **SVG chevron** (not `▾/▸`), keyboard-activated — mirroring the existing `components/editor/AccordionHeader.svelte:58-70` precedent. Header strip = `--surface-2`, mono `B{order}` code badge (11px/500 `--primary` on `--primary-soft`, `--radius-pill`), title 14px/600. **This should DROP the 2 warnings** (allowed under "must not grow"; note the expected new count). `expanded` state + sequence/MP list structure unchanged.

**StatusPill (T8, authored from scratch — D6):** add the `<style>` block. `.pill`: inline-flex, `--radius-pill`, 11px/500, `padding` per the `StatusBadge.svelte:18-24` badge precedent, a leading `.pill-token` glyph (the retained non-colour signal). Exact class→token table (from `LATEST_STATUS_META.cls`):

| class | statuses | bg | fg |
|---|---|---|---|
| `pill-neutral` | pending_group_assignment, not_submitted | `--status-not-submitted-bg` | `--status-not-submitted-fg` |
| `pill-info` | awaiting_evaluation | `--status-awaiting-eval-bg` | `--status-awaiting-eval-fg` |
| `pill-danger` | rejected | `--status-rejected-bg` | `--status-rejected-fg` |
| `pill-warning` | major_revision, minor_revision | `--status-needs-revision-bg` | `--status-needs-revision-fg` |
| `pill-success` | accepted | `--status-accepted-bg` | `--status-accepted-fg` |

Decide **scoped vs global**: because `MiniProjectDetailPage.svelte:527` (Slice-4) renders the same `pill pill-*` classes, T8 authors the pill CSS so it is reachable by that consumer too — either a shared `pill.css`/`base.css` rule or a shared component; the plan picks the mechanism and documents that Slice-4 inherits it. Preserve the D3 no-`aria-label` policy (`StatusPill.svelte:8-11`).

**CourseView (T8):** course-name `<h1>` header (keep base 21px), version `info_html` block tokenised, blocks list. Error/empty states tokenised (skeletons deferred). Keep the existing `← Courses` ghost Button. `CourseView.svelte.test.ts` stays green (adjust selectors only).

---

## Data flow & error handling

No change beyond the enumerated client-side touches. Item resolution (hash → last-visited → first), `flatItems` cross-sequence Previous/Next (now carrying `title`), the quiz submit/reveal state machine, and the three coverage trackers are preserved. All load-bearing comments/effects named above are preserved verbatim.

---

## Testing strategy

`mount`/`unmount`/`flushSync` only; TDD RED→GREEN per task; assert **load-bearing structure/classes**. jsdom cannot compute cascade → CSS-only changes verified via `svelte-check` (no `css_unused_selector`; warning count must not grow above 36 — the BlockGroup a11y fix should reduce it) + `vite build` + built-CSS grep.

- **Existing tests that must stay green** (adjust selectors only, never weaken — except the one authorised `MiniProjectLink` assertion edit, §"Enumerated behaviour changes" item 6): `CourseView`, `BlockGroup`, `InteractiveAppItem`, `InteractiveFrame`, `ItemRouter`, `MiniProjectLink`, `StatusPill`, **`ItemIcon`**.
- **New focused tests:** `ItemMark` (mark per type, `aria-hidden`, state class); `SequencePlayer` (breadcrumb segments + course-link-back + `currentBlock===null` fallback; footer `Next: {title}` primary / `Finish sequence` enabled → navigates to `/courses/{slug}`); `QuizItem` (item-title `<h2>` via stubbed `item.title`; per-question counter; "Submit answer"; attempts copy for 0 / 1 / plural / undefined-max; explanation panel); `SingleChoiceQuestion` + `MultiChoiceQuestion` (selected class; **all four reveal states** incl. multi-choice partial); `NumericQuestion` + **`TextQuestion`** (mono class on numeric; correct-answer-only reveal, no student-value judgement); `VideoItem` / `SequenceLink` / `MiniProjectLink` (the removed decorative glyph node is gone and the SVG/`ItemMark` is present — assertion **scoped to that node**, not a blanket "no ✓ anywhere", so `StatusPill`'s retained `✓` is unaffected).
- **Test-harness prerequisites to encode in the plan:** `QuizItem` mounts an auto-reveal `$effect` that calls `api.get(/reveal)` when `attempt_count >= max` — tests stub `api` and seed `currentCourse`; `SequencePlayer` tests seed `currentCourse` (via the store's test hook) + set `currentRoute.hash` (`#item=`). So T1/T4 are not trivially sized.
- **Review per task:** two-lane gate (codex@high + first-party@opus), fix all Critical/Important, re-review until clean; whole-branch final review at the end.

---

## Task decomposition (8 tasks; finalised in the plan)

1. **T1 — SequencePlayer chrome:** breadcrumb snippet (both branches, null-block fallback), `<h1>` (base 21px + margin), chain-strip 2c geometry, 68ch wrapper, footer (`FlatRef.title`, Next-primary, `Finish sequence` → course navigate).
2. **T2 — Choice questions:** drawn option control (sr-only input, focus-visible + forced-colors per Slice-2 M5, tokens only), prompt/list metrics, four-state reveal + non-colour marks.
3. **T3 — Numeric + Text questions:** local control-token field (numeric mono), correct-answer-only reveal.
4. **T4 — QuizItem shell:** item-title header, per-question counter, "Submit answer", attempts copy (Math.max/plural/undefined/mono/!locked), result card, explanation panel.
5. **T5 — Page / Video / Interactive / Unsupported items:** article-padding + h2 unification, wrapper framing (shared frames untouched), VideoItem `✓` removal, 10h card, UnsupportedItem tokenise; existing item tests stay green.
6. **T6 — `ItemMark` primitive:** extract presentational mark; refactor `ItemIcon` to compose it (its tests stay green); add `ItemMark` test. **Must precede T7.**
7. **T7 — SequenceLink chain row + MiniProjectLink flag row:** `ItemMark` chain + mono `{covered}/{total}` (no `formatProgress`, `$derived` fixes) + `✓` removal; flag `ItemMark` + `📋` removal (authorised test edit); keep aria/row contracts.
8. **T8 — CourseView + BlockGroup accordion + StatusPill:** real `<button aria-expanded/-controls>` accordion (AccordionHeader precedent, chevron, warning drop), from-scratch pill class→token styling (scoped-vs-global ruling), CourseView tokenise.

Dependency: **T6 before T7**; T2/T3 before T4; T1/T5/T8 independent. Each ends with an independently testable deliverable + its own review gate.

---

## Git stacking (decided)

Slice-3 is **already based on the Slice-2 tip `dca0a7b`** (branch `feat/visual-refresh-slice3-student-content`, HEAD `50ecd09` is a direct child) — not `main`. Rationale: Slice-2 modifies `SequencePlayer.svelte` (`e159612`, the chain strip this slice builds on) and remains unmerged (push deferred), so stacking avoids a conflict-prone rebase. (The dependency is the SequencePlayer chain, not the Slice-2 primitive props — `Button.full`/`Logo.form` are unused here and `Input.mono` is deliberately not reused, §3 numeric field.) The stack merges in order (`main ← slice2 ← slice3`) when the redesign lands; no integration into `main` now (the user's finishing-a-branch call).

---

## Round-1 review resolutions (for re-review verification)

**Critical:** hardcoded `#C4CAD4`/`#F2F5F8` → removed, option control uses `--faint`/`--border-strong`/`--primary-soft` only (§3, Constraint 1/5). Chain-strip 2c geometry (pad-bottom 14 / margin-bottom 20) → explicit T1. `ItemIcon` reuse infeasible → new `ItemMark` primitive (D5, T6) + `ItemIcon.svelte.test.ts` in must-stay-green. "Finish sequence" no-op → enabled, navigates to course view (D4, enumerated change 2). Emoji inventory → decorative-only removal + `LATEST_STATUS_META` carve-out (Constraint 3), the 4th `✓` is a retained status token. "Check yourself" literal → `<h2>{item.title}>` (§3 T4). `StatusPill` "already token-driven" false → authored from scratch with a class→token table (D6, T8). D2 missed-correct → new `isChosen`/`isMissedCorrect` derivations + 4-state (§3 T2).
**Important:** StatusPill from scratch (T8); shared-frame leak → framing moved to item wrappers, 600px stays (§Scope, §2); article padding + h2 unified (§2); attempts copy Math.max/plural/undefined/mono/!locked (enumerated 3); `FlatRef` gains `title` (enumerated 1); accordion real button + a11y (T8); `formatProgress` spaces → mono `{covered}/{total}`, import dropped (enumerated 5); 10h coverage hint intentionally omitted (§2); T6 split out of the old T6 (now T6/T7/T8); numeric/text no client judgement + control-token field not `ui/Input` (§3 T3); focus-visible/forced-colors on option control (§3 T2); reveal border tokens named (`--status-*-fg`) + non-colour marks (§3 T2); h1 keeps 21px, h2 unified 16px (§1/§2); 9d skeletons deferred (§Deferred); prompt/gap metrics added (§3); `MiniProjectLink` 📋 assertion edit authorised (enumerated 6); StatusPill `✓` retained (Constraint 3); `UnsupportedItem` added to scope (§2/T5).
**Minor:** breadcrumb snippet shared + null-block fallback (§1); `--btn-pad-sm` token used (§3); explanation panel reuses `--surface-2` precondition-banner tint (§3 T4); citation drift fixed (InteractiveAppItem `33-70`/`13-16`; StatusPill `8-11`); git stacking recorded as decided + rationale reworded (§Git stacking); test-harness prerequisites named (§Testing).
