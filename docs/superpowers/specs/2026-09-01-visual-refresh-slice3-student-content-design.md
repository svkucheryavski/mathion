# Visual Refresh — Slice 3: Student In-Sequence Content — Design Spec

**Status:** Design — in the spec-review convergence loop (rev 3, folds round-2 findings from 3 lanes: codex 4C/7I, revA 2C/9I, revB 2C/6I — all convergent). Ready for re-review.

**Goal:** Restyle the student's in-course content experience — the sequence player chrome, the item content (page / video / quiz / interactive / unsupported), and the CourseView blocks→sequences landing — to the refreshed visual system, reusing Slice-1/2 conventions. It is styling + decorative-glyph removal + the small, fully-enumerated set of copy/interaction touches in §"Enumerated changes". **No student-facing feature is added or removed** (the round-2 "Finish sequence" over-reach is corrected — see D4). No backend/API/route/schema change.

**Design authority:** `docs/design/visual-refresh/` — `mathion-visual-spec.md` (§3 colour-of-state, §4 components, §5 copy) + `reference-screens.dc.html` screens **2c** (Sequence player, ~L2087-2144) and **10h** (Interactive-app *student card*, ~L1035-1052). **No-reference surfaces** (CourseView landing, `BlockGroup`, `SequenceLink`, `MiniProjectLink`) are styled pattern-faithfully by analogy, with exact metrics prescribed below so "pattern-faithful" cannot be read two ways. Screen **9d** (loading skeletons / empty-state cards) is acknowledged and **deferred** to a future states slice.

**Tech stack:** Svelte 5 (runes) + TypeScript; component tests via `mount`/`unmount`/`flushSync` (never `@testing-library`); `svelte-check`, `vitest`, `vite build`. No new runtime deps.

---

## Global Constraints

Inherited verbatim from Slice-1/2 (every task implicitly includes these):

1. **Colours → tokens.** No hardcoded hex anywhere outside comments/brand-art. Every colour resolves to a token in `frontend/src/styles/theme-default.css`. **No new colour tokens are introduced** — the option control uses `--border-strong`/`--primary`/`--primary-soft`/status tokens only (see §3).
2. **No opacity-based disabled/dim.** Recede via tokens (`--faint`, `--muted`, `--border-soft`), never `opacity`.
3. **No *decorative* glyphs on Slice-3 surfaces** (visual-spec §5.8 "No emoji anywhere", `mathion-visual-spec.md:326`). Slice-3 removes five decorative glyphs: `✓` in `VideoItem` (`VideoItem.svelte:37`), `✓` in `SequenceLink` (`SequenceLink.svelte:19`), `📋` in `MiniProjectLink` (`MiniProjectLink.svelte:44`), and the `▾`/`▸` toggle glyphs in `BlockGroup` (`BlockGroup.svelte:24`) → all replaced by SVG marks. **Carve-out (do NOT remove):** the `LATEST_STATUS_META` glyph tokens `✓ · ~ × ! …` (`studentMiniProjects.ts:44-50`) are the deliberate **non-colour, colourblind status signal** (C14) rendered by `StatusPill`; they stay, and `StatusPill.svelte.test.ts:31` continues to assert them. (Tension noted: `ui/StatusBadge.svelte:18-19` cites the same no-emoji rule to justify having *no* glyph; only `✓` here is pictographic, and it is retained under C14 as the accepted-state signal — an intentional divergence, not an oversight.) Emoji on **deferred** surfaces are out of scope.
4. **Mono for every numeral** (`--font-mono`) — item counters, per-question "Question N of M", attempts count, progress ratios, the `S{n}` prefix, the numeric-answer field value. Reference mock-ups that spell a number as a word ("Two attempts left", ref 2134) do not override this — the app renders a digit, so it is mono.
5. **Per-component one-off geometry MAY be a literal** matching the reference verbatim, annotated `/* ref NNNN */`. **Literals are geometry ONLY** — never colours (Constraint 1).
6. **Dense control metrics are final** (visual-spec §4): `--control-h` 30px, `--control-pad-x` 9px, field value 13px, `--btn-pad` 4px 10px, `--btn-pad-sm` 4px 9px, code/textarea blocks 8px/10px.
7. **`ItemIcon`/`ItemMark` states** (Slice-1) — the existing prop union is **`'covered' | 'current' | 'not-yet'`** (`ItemIcon.svelte:4`); "not started" is prose only, never a literal value: covered = `--primary` fill/white mark; current = `--primary-soft` + 1.5px `--primary` border + `--primary` mark; not-yet = `--surface` + 1px `--border-strong` + `--muted` mark.
8. **No backend/API/route/schema change.** The quiz submits the whole answer-map in one POST (`QuizItem.svelte:84`); coverage trackers (page 30s active-time `:11-30`, video mark-watched `:13-28`, interactive on-load `:33-70`) and all routes are untouched. Every behaviour touch is client-side and enumerated in §"Enumerated changes".
9. **Commit trailer (pinned, do NOT "correct"):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git add` exact named paths only (never `-A`/`.`).

### Decisions (locked in brainstorming; D4 corrected in round 2)

- **D1 — Quiz stays all-at-once (restyle only).** Questions stay stacked with one Submit; no state/backend change.
- **D2 — Quiz reveal: status-colour + a non-colour mark, an explicit extension of visual-spec §3** (which assigns green/red to *submission* states, not quiz correctness — `mathion-visual-spec.md:110-122`; D2 extends that palette to quiz reveal). *Choice* questions (correct_option_ids present) get a **four-state** reveal (§3): the **three evaluative states** — chosen-correct, wrong-pick, missed-correct — each carry a distinct class, a status colour, **and** a non-colour SVG mark (colourblind/forced-colors safe); the **neutral** state gets a structural `reveal-neutral` class with **no colour and no mark**. *Numeric/Text* questions have **no per-question `is_correct` in the payload** (`QuestionReveal`, `types.ts:161-170`), so they show **only the correct answer** and **deliberately do not judge** the student's value.
- **D3 — CourseView adopts accordion + chain** via a new presentational `ItemMark` primitive (D5). Blocks = §4 accordion sections; each sequence row shows a **non-interactive** `ItemMark` chain + mono progress.
- **D4 — Footer: Next = primary naming the destination; "Finish sequence" only at the course-flat end.** `flatItems` is **course-wide** and `next()` advances across sequence and block boundaries (`SequencePlayer.svelte:99-100,123-125`). The primary is:
  - when a next flat item exists (`flatIndex < flatItems.length - 1`, possibly in another sequence) → **`Next: {next item title} →`** (title from the extended `FlatRef`), crossing boundaries **exactly as today** (`Next →` when the title is empty/whitespace);
  - at the **course-flat end** (`flatIndex === flatItems.length - 1`, today a disabled no-op, `:184`) → **`Finish sequence`**, enabled, navigating to the existing `/courses/{courseSlug}` route.
  Previous = secondary, `disabled={flatIndex <= 0}`, still crossing backward. **This preserves all forward cross-sequence navigation** — the only change is turning the currently-disabled terminal button into an enabled "finish", matching ref 10h (which shows "Finish sequence" on the terminal sequence's last item) and ref 2c (Next primary mid-course). The round-2 reading that showed Finish at *every* sequence boundary is rejected: it would have stranded forward traversal and contradicted the Goal.
- **D5 — New additive primitive `ItemMark.svelte`.** Presentational 22px square + type SVG mark + state, a non-interactive `<span aria-hidden="true">` with **no text node**. Props: `type: Item['type']`, `state: 'covered' | 'current' | 'not-yet'` (there is no `ItemType` alias in the repo — T6 adds `export type ItemMarkType = Item['type']` and `export type ItemMarkState = 'covered' | 'current' | 'not-yet'` to `types.ts`, or uses the inline `Item['type']`). `ItemIcon.svelte` is **refactored to `<button class="icon {istate}" …><ItemMark type={item.type} state={istate}/></button>`** — the state class **stays on the button** (asserted by `ItemIcon.svelte.test.ts:33-36`), the button also forwards `state` to `ItemMark`, the button gets `padding:0;border:0;background:none;display:inline-flex;cursor:pointer` so the 22px box does not double, and `ItemMark`'s SVG remains reachable as `button svg` (asserted `:41-49`). `SequenceLink` (chain) and `MiniProjectLink` (single flag mark, `type='mini_project'`) use `ItemMark` directly.
- **D6 — `StatusPill` is authored from scratch, component-scoped.** It currently has **no `<style>` block**; the `pill-*` classes resolve to nothing (round-1 confirmed). T8b writes the pill geometry + class→token table (§4) as **Svelte-component-scoped** CSS. Consequences, stated so a reviewer need not re-derive them: (a) the scoped styles **travel with the `<StatusPill>` component** to every consumer, including the deferred `MiniProjectDetailPage:425` usage; (b) the **raw** `<span class="pill pill-warning">Late</span>` at `MiniProjectDetailPage:527` and the **separate** teacher-side pill family (`RunMiniProjectsTab:242` with its own scoped `.pill`/`.pill-published`/`.pill-locked` at `:397-408`) are **intentionally untouched** — each is its own surface's responsibility (Slice-4+); (c) scoping (not a global `.pill` rule) is what **preserves visual-spec §3's one-amber rule** — no cross-surface `pill-warning` leak.

---

## Enumerated changes (the ONLY non-pure-styling touches)

All client-side; none touch the backend/routes/schema. This list is **exhaustive** — anything not here is pure styling/tokenisation.

**Behaviour / state:**
1. **`FlatRef` gains `title: string`** (`SequencePlayer.svelte:101-110`) so the footer can name the next item. Ordering logic (`flatItems`/`flatIndex`/`previous`/`next`) is otherwise unchanged.
2. **Footer "Finish sequence"** (D4): at the course-flat end only, the primary Button is enabled and calls a new `finish()` → `navigate('/courses/{courseSlug}')`. Existing route (`routes.ts:7`); no addition. Forward cross-sequence `Next` is preserved.
3. **Attempts remaining stays accurate across "Try again"** (`QuizItem`): `attemptsUsed` (`:29-34`) currently falls back to the course-store count, which `submit()` never bumps and `tryAgain()` (`:96-101`) resets `lastResult` — so after submit→Try again it would read the *stale* store count. Add `let lastAttemptCount = $state<number | null>(null)`; set it from `res.attempt_count` on submit success; insert it into the `attemptsUsed` fallback chain **before** the store lookup; **`tryAgain()` does not reset it**. Client-only; no API change.
4. **Choice reveal derivations** (§3): new client-side `isChosen` + `isMissedCorrect` (data already present via `selected`/`value` + `correctOptionIds`).
5. **`SequenceLink` drops the `formatProgress` import** and renders a mono `{covered}/{total}` (no spaces, matching CourseCard) — `formatProgress` returns `"{covered} / {total}"` *with* spaces (`format.ts:2`); `format.test.ts` keeps the helper covered; `SequenceLink`'s non-reactive `total`/`href` become `$derived` (this removes its three `state_referenced_locally` warnings at `8:17`,`12:28`,`12:46`).

**Copy / rendered strings** (each touches a visible string — listed here so the "styling-only" claim is honest):
6. **Quiz Submit label:** `Submit` → **`Submit answer`** (`QuizItem.svelte:157`; ref 2133).
7. **Breadcrumb copy redistribution** (`SequencePlayer.svelte:151-156,166`): drop the `←` prefix on the course crumb; reformat `B{order}. {title}` → `B{n} · {block title}`; move `S{n}` out of the `<h1>` into the crumb.
8. **Footer Next label:** `Next →` → **`Next: {title} →`** (enumerated 1 supplies the title).
9. **VideoItem watched confirmation:** `✓ Marked as watched` → inline check SVG + text (`VideoItem.svelte:37`).
10. **Per-question label:** a mono `Question {i} of {n}` label is added before each question block (new rendered string; §3 T4).
11. **Attempts line copy:** `Maximum N attempts per quiz (X used)` → **`{remaining} {attempt|attempts} left`** (`QuizItem.svelte:174`), `remaining = Math.max(0, max - attemptsUsed)`; singular "1 attempt left"; the numeral is `--font-mono`; **suppressed when the course snapshot is absent** (`currentCourse.value === null` — the only reachable state where `max_quiz_attempts` is unavailable, since it is a required `number` in `VersionContent`, `types.ts:30-35`); renders in the **pre-submit (`!locked`) state only**.

---

## Scope

### In scope
**Player:** `pages/SequencePlayer.svelte`.
**Item content:** `components/items/PageItem.svelte`, `VideoItem.svelte`, `InteractiveAppItem.svelte`, `UnsupportedItem.svelte` (verify-only, see §2), `ItemRouter.svelte` (verify-only dispatcher). **Shared frames `VideoFrame.svelte`/`InteractiveFrame.svelte` are NOT restyled** — the card framing lands in the *item wrappers*; both frame roots carry `margin-bottom: var(--space-3)` (`VideoFrame.svelte:14`, `InteractiveFrame.svelte:35`), so each item wrapper's card gets `overflow:hidden` + a wrapper-local `:global(.frame){ margin-bottom:0 }` (scoped to the item component, leaving the deferred editor consumers unchanged); `InteractiveFrame`'s fixed 600px stays.
**Quiz:** `components/items/QuizItem.svelte` + `quiz/SingleChoiceQuestion.svelte`, `MultiChoiceQuestion.svelte`, `NumericQuestion.svelte`, `TextQuestion.svelte`.
**Landing + primitives:** `pages/CourseView.svelte`, `components/course/BlockGroup.svelte`, `SequenceLink.svelte`, `MiniProjectLink.svelte`, `StatusPill.svelte`, `ItemIcon.svelte` (refactor to compose `ItemMark`), **new `components/course/ItemMark.svelte`**.
**Types:** `frontend/src/lib/types.ts` — add the `ItemMarkType`/`ItemMarkState` aliases (T6).
**Tokens:** `frontend/src/styles/theme-default.css` — **verify-only** (no new tokens).

### Out of scope / deferred
- **Slice-4:** `pages/MiniProjectDetailPage.svelte` (ref 9c). It renders `<StatusPill>` (`:425`, styled by the scoped component CSS) and also has a **raw** `pill pill-warning` "Late" badge (`:527`, with **no `.pill-token` child**) that Slice-4 must reconcile against the one-amber rule.
- Teacher/authoring/superuser surfaces (incl. `RunMiniProjectsTab`, the interactive-app editor).
- **Screen 9d** loading skeletons + empty-state cards — no skeleton primitive exists yet. `components/ui/Spinner.svelte` is **already fully tokenised** (`--border-soft`/`--muted`) and is **not** in scope; Slice-3 only tokenises the **surrounding `<p>` loading/empty/error blocks** in `CourseView`/`SequencePlayer`.
- Any backend/route/schema change.

---

## Per-surface design

### 1. SequencePlayer chrome (ref 2c) — T1

- **Breadcrumb** (replaces the stacked crumbs): extract **one `{#snippet}`** used by BOTH the empty-sequence branch (`SequencePlayer.svelte:150-157`) and the normal branch (`160-167`). Horizontal row, 12.5px `--muted`, `--faint` `/` separators (a documented `--faint` use — breadcrumb separators, `theme-default.css:15`), last segment `--text`, `margin-bottom: 10px` (ref 2107): `{course name} / B{n} · {block title} / S{n}`. The **course-name segment links back** to `/courses/{courseSlug}` (drops the old `←`). **Fallbacks:** drop the block segment (and its separator) when `currentBlock === null` (`:37-41`); tolerate an absent course name while loading.
- **`<h1>`** = the sequence title only (`S{n}` moves into the breadcrumb). **Keep the base `h1` size (21px, `base.css:16`)** — Slice-2 ruled per-page `<h1>` overrides fragment the scale; change only `margin: 0 0 14px` (ref 2110).
- **Chain strip:** fold in the ref-2c geometry Slice-2 deferred — `padding-bottom: 14px; margin-bottom: 20px` (ref 2112) — preserving the Slice-2 `gap: 6px`, the mono "Item N of M" counter (ref 2117), the `--border` bottom rule, and wrapping.
- **Content rhythm (pinned — one owner):** `.content` gets `padding: 0` (drop the current `var(--space-3) 0`, `:206`); the top gap below the chain is owned **solely** by the strip's `margin-bottom: 20px`. The item `<article>` owns its internal rhythm (§2). `max-width: 68ch` on the content wrapper (ref 2120).
- **Footer (D4):** `justify-content:space-between`, `margin-top:24px`, `padding-top:14px`, `--border` top rule. **Previous** = secondary Button, `disabled={flatIndex <= 0}`. **Next/Finish** = primary Button per D4.
- **Loading / not-available / not-found** states: tokenise the existing `<h1>`/`<p>`/ghost-Button blocks; the empty-sequence branch also gets the shared breadcrumb snippet. Skeletons deferred (9d).

### 2. Item content — T5

Uniform rules across `PageItem`/`VideoItem`/`InteractiveAppItem` (and mirrored in `QuizItem`, T4):
- **Article rhythm (pinned):** each item `<article>` gets `padding: 0; display:flex; flex-direction:column; gap:16px /* ref 2120 */` — removing the per-article 16px padding (`PageItem.svelte:39`, `VideoItem.svelte:42`, `InteractiveAppItem` wrapper, `QuizItem.svelte:179`) that indents headings relative to the chain, and giving the h2→content→controls rhythm one consistent value. **T4 owns the Quiz article's padding removal; T5 owns the other three.**
- **Item `<h2>`:** unify all item-type headings at **16px/600 `--text`** as a per-component literal `/* ref 2122 */` (do not change `base.css` `h2` globally).

Per component:
- **PageItem:** preserve the trust-boundary comment verbatim (`:8-10`). Typographic pass on `:global` content styles: body `--text-2` at `line-height:1.6`, headings on the scale, links `--primary`, code/pre blocks `--surface-2` + 8px/10px padding + `--font-mono` + `--radius`. 30s coverage `$effect` untouched.
- **VideoItem:** `<h2>` title; `VideoFrame` wrapped in a `--surface`/1px `--border`/`--radius` card **with `overflow:hidden` + local `:global(.frame){margin-bottom:0}`**; primary "Mark as watched" Button; **replace `✓ Marked as watched`** with an inline check SVG + text, **both pinned to `--status-accepted-fg`** (enumerated 9). Coverage tracker (`:13-28`) untouched.
- **InteractiveAppItem:** preserve the coverage `$effect` + abort/stale guards verbatim (`:33-70`, guard comment `:13-16`). `<h2>` title; `InteractiveFrame` (600px, untouched) wrapped in the same bordered card (`overflow:hidden` + local frame-margin reset, ref 10h); `empty`/`error` notices → `--muted` (drop `font-style:italic`). Ref 10h's "Marked covered once opened." hint is intentionally omitted (no new copy).
- **UnsupportedItem** (rendered by `ItemRouter:20-21` for `mini_project` items in a sequence): **verify-only for colour** — it is already fully tokenised (`--border`/`--radius`/`--muted`, `:10`); the only change is dropping its article padding per the rhythm rule above and keeping the dashed box + informative text (spec §5.7 permits the type string on an error/fallback surface).
- **ItemRouter:** dispatcher; no visual change — verify its existing test stays green.

### 3. Quiz "Check yourself" (ref 2c, D1/D2) — T2 (choice), T3 (numeric/text), T4 (shell)

**QuizItem shell (T4):**
- Header: `<h2>{item.title}</h2>` (**NOT** a hardcoded "Check yourself" — that is the reference's demo item title, ref 2115/2122) styled 16px/600 `--text` `/* ref 2122 */`.
- **Per-question counter:** each question block is preceded by its own mono 11.5px `--muted` **`Question {i} of {n}`** label (type style adapted from ref 2123, where the counter sits on the `<h2>` baseline row; placing it per-question is a deliberate deviation that avoids double-labelling).
- Questions render stacked (control flow `:135-153` unchanged); preserve `assertNever` exhaustiveness (`:111-124`) and the submit/reveal state machine (`inflight`/`lastResult`/`revealed`/`autoRevealed`/`locked`).
- **Submit** = primary Button **"Submit answer"** (ref 2133), `disabled={!allAnswered}` (logic unchanged); submit-row `gap:12px` (ref 2132).
- **Attempts line + persisted count:** per enumerated 3 + 11.
- **Result/reveal block:** tokenise `.result` into a `--surface-3`/`--border`/`--radius` card (score + "Attempt N of M", mono numerals); "Try again" (primary) / "Show correct answers" (secondary) behaviour unchanged.
- **Explanation** (`r.explanation_html`): a `--surface-2` panel with a 3px `--primary` left rule (reusing visual-spec §4's information-banner tint), `--text-2` body.
- **Article padding removal** owned here (T4).

**Choice questions (Single + Multi, T2):**
- **Prompt** (`legend`): 14.5px / `line-height:1.6` / `--text-2` / weight 400 (ref 2125 — drop the current `legend{font-weight:500}`).
- **Option list:** `gap:8px` (ref 2126). Each option is a **drawn control**: the native `<input>` stays as the real focusable/checkable element but is visually hidden **sr-only** (the Slice-2 segmented pattern); the `<label>` is `position:relative` and painted:
  - Row: `padding: var(--btn-pad-sm)` (4px 9px, ref 2127), `--radius`, `gap:10px`, 14px `--text-2`.
  - **Unselected:** 1px `--border-strong`, `--surface`; drawn radio/checkbox glyph = 15px circle/box with a **`--border-strong`** ring (the token authority reserves `--faint` for disabled glyphs/carets/separators only — `theme-default.css:15`, `mathion-visual-spec.md:62` — so the enabled control ring uses `--border-strong`, the documented interactive-control token, `theme-default.css:20`).
  - **Selected:** 1.5px `--primary` border, `--primary-soft` background, weight 500, `--text`; drawn glyph filled `--primary` (dot / check). (The ref's soft outer ring is dropped — it collides with the focus system; border + soft fill carry selection, matching `ItemMark`'s `current` treatment.)
  - **Focus + forced-colors (copy Slice-2 M5, `Login.svelte:137-146`):** `input:focus-visible { box-shadow:none }` to suppress the global glow (`base.css:21-25`); `label:has(input:focus-visible){ box-shadow: inset 0 0 0 2px var(--primary) }`; `@media (forced-colors: active)` outlines for selected and focused.
- **Reveal — four states (D2), when `correctOptionIds !== null`:** add client-side `isChosen` (`selected === opt.id` / `value?.includes(opt.id)`) alongside the existing `isCorrect`/`isWrongPick`; derive `isMissedCorrect = isCorrect && !isChosen`. The **three evaluative** classes each carry a status colour **and** an SVG mark placed **trailing at the row end** (after the option text, not replacing the drawn glyph); **neutral** gets a bare `reveal-neutral` class (no colour, no mark):
  - **chosen-correct** (`isCorrect && isChosen`): `--status-accepted-bg`, `border-color: var(--status-accepted-fg)`, trailing check SVG (`--status-accepted-fg`).
  - **wrong-pick** (`isWrongPick`): `--status-rejected-bg`, `border-color: var(--status-rejected-fg)`, trailing × SVG (`--status-rejected-fg`).
  - **missed-correct** (`isMissedCorrect`): `--status-accepted-bg` + **1.5px dashed `--status-accepted-fg`** border (distinct from chosen-correct's solid) + trailing check SVG.
  Replaces the ad-hoc `color-mix(--success/--danger)` (`SingleChoiceQuestion.svelte:45-46`, `MultiChoiceQuestion.svelte:49-50`). A **multi-choice partial-answer** test must exercise all four states in one question.

**Numeric + Text questions (T3):**
- Field = a local `<input>` on the control tokens (**not** `ui/Input`, whose `mono` is PIN-specific 17px/.34em and which lacks `disabled`/`inputmode` — `Input.svelte:39`): `height: var(--control-h)`, `padding: 0 var(--control-pad-x)`, `font-size: var(--control-font)` (13px), 1px `--border-strong`, `--radius`; **numeric field carries `class="num mono"`** — geometry in the scoped `.num` rule, `--font-mono` via the global `.mono` utility (`base.css:10`), so `NumericQuestion.svelte.test.ts` can assert `classList.contains('mono')` (a `font-family` set only in scoped CSS is unassertable in jsdom). Keep `disabled={locked}` and `inputmode="decimal"`.
- **Reveal (D2):** show **only the correct answer** (`--status-accepted-fg` text, mono for the numeric value) on its own line — **no client-side judging** (no per-question `is_correct` in `QuestionReveal`). Move off the `--success`/0.9rem line.

### 4. CourseView landing — T6 (ItemMark), T7 (rows), T8a (BlockGroup), T8b (StatusPill + CourseView)

**ItemMark primitive (T6):** as D5. Add `components/course/ItemMark.svelte` + `ItemMarkType`/`ItemMarkState` aliases in `types.ts`; move the SVG marks + state CSS there; refactor `ItemIcon.svelte` to compose it (state class stays on the button; button reset; no text node; `button svg` reachable). `ItemIcon.svelte.test.ts` (asserts `button`, `data-type`, `title`, **state class on button `:33-36`**, `button svg` innerHTML `:41-49`, empty `textContent` `:30`) must stay green; add `ItemMark.svelte.test.ts` (mark per type; `aria-hidden`; state class).

**SequenceLink row (T7) — pinned layout:** whole-row `<a class="row">` (unchanged element) laid out `display:flex; align-items:center; gap:12px; padding: var(--space-2) var(--space-3); border-bottom:1px solid var(--border-soft)`; **left:** `S{n}.` mono prefix + sequence title at **13.5px/500 `--text`** (visual-spec §4 accordion rows); **right (margin-left:auto):** a **non-interactive `ItemMark` chain** (`gap:6px`, `flex-wrap:wrap`; covered/not-yet state from `state.items[…].is_covered`; no `current` on the landing) + a mono `{covered}/{total}` count at 12px `--muted`; **hover:** `background: var(--primary-soft)` (the documented hover-fill token — the current `.row:hover{background:var(--border)}` misuses a *line* token, `SequenceLink.svelte:24-34`,`theme-default.css:19`); focus via the global `:focus-visible`. **Remove the `✓` emoji** (completion reads from the all-covered chain). Per enumerated 5: `formatProgress` import dropped, `total`/`href` `$derived`.

**MiniProjectLink row (T7) — authored from scratch (it has NO `<style>` today, file ends `:47`):** the row currently renders as an unstyled inline anchor — same defect class round-1 caught for StatusPill. Author `.row`/`.row-glyph`/`.row-mp`/`.row-title` to **mirror `SequenceLink`'s row** (`display:flex; align-items:center; gap:12px; padding: var(--space-2) var(--space-3); border-bottom:1px solid var(--border-soft); hover → --primary-soft`): lead `.row-glyph` = a single **flag `ItemMark`** (`type='mini_project'`, `aria-hidden`) replacing `📋`; `.row-title` = the title at 13.5px/500; the `StatusPill` sits at `margin-left:auto`. Preserve the load-bearing `aria-label`, `encodeURIComponent` href, and `LATEST_STATUS_META` wiring verbatim (`:28-46`). The `.row-*` class names are depended on by **`BlockGroup.svelte.test.ts:80,98-100,117,151` and `MiniProjectLink.svelte.test.ts:47,124,148`** (NOT by "BlockGroup styling" — corrected). Test edit per enumerated below.
- **`MiniProjectLink.svelte.test.ts` assertion edit (authorised):** the `textContent === '📋'` assertion (`:127`) inverts to "no `📋`; the flag `ItemMark` is present"; the `aria-hidden="true"` on the lead glyph and the `.row-glyph`/`.row-mp`/`.row-title` class contracts are preserved.

**BlockGroup accordion (T8a) — pinned structure:** replace the pointer-only `<header onclick>` (which carries 2 baseline warnings: `a11y_click_events_have_key_events` + `a11y_no_static_element_interactions` at `:22`) and preserve heading semantics with:
`<header><h2><button id={btnId} aria-expanded={expanded} aria-controls={panelId}>{B-badge}{title}{chevron SVG}</button></h2></header>` + `<div id={panelId} role="region" aria-labelledby={btnId}>…sequence/MP list…</div>`.
Keyboard-activated (native button); **SVG chevron** replaces `▾/▸`; header strip `--surface-2`, mono `B{order}` badge (11px/500 `--primary` on `--primary-soft`, `--radius-pill`), title 14px/600. Precedent: `components/editor/AccordionHeader.svelte:58-70`. This DROPS the 2 warnings. `BlockGroup.svelte.test.ts:78,94,114,130` use direct-child selectors (`section.block > ul > li`) that the `role="region"` wrapper breaks — adjust those selectors (permitted; budget it in T8a).

**StatusPill (T8b, from scratch, component-scoped — D6):** add the `<style>` block. `.pill`: inline-flex, `--radius-pill`, 11px/500, padding per the `StatusBadge.svelte:18-24` precedent, a leading `.pill-token` glyph (the retained non-colour signal); the rule must render correctly **with or without** a `.pill-token` child (the deferred `:527` Late badge has none). Class→token table (from `LATEST_STATUS_META.cls`):

| class | statuses | bg | fg |
|---|---|---|---|
| `pill-neutral` | pending_group_assignment, not_submitted | `--status-not-submitted-bg` | `--status-not-submitted-fg` |
| `pill-info` | awaiting_evaluation | `--status-awaiting-eval-bg` | `--status-awaiting-eval-fg` |
| `pill-danger` | rejected | `--status-rejected-bg` | `--status-rejected-fg` |
| `pill-warning` | major_revision, minor_revision | `--status-needs-revision-bg` | `--status-needs-revision-fg` |
| `pill-success` | accepted | `--status-accepted-bg` | `--status-accepted-fg` |

Preserve the pre-existing StatusPill **no-`aria-label` policy** (`StatusPill.svelte:9-12`).

**CourseView (T8b):** course-name `<h1>` header (base 21px), version `info_html` block tokenised, blocks list, `← Courses` ghost Button kept. Error/empty `<p>` blocks tokenised (Spinner untouched; skeletons deferred). `CourseView.svelte.test.ts` stays green (adjust selectors only).

---

## Data flow & error handling

No change beyond the enumerated client-side touches. Item resolution (hash → last-visited → first), and the **course-wide** `flatItems` cross-sequence Previous/Next — both **preserved** (D4 only turns the currently-disabled terminal `Next` into an enabled `Finish sequence`; forward and backward boundary traversal are unchanged), now carrying `title`. The quiz submit/reveal state machine (plus the new non-clearing `lastAttemptCount`) and the three coverage trackers are preserved. All load-bearing comments/effects named above are preserved verbatim.

---

## Testing strategy

`mount`/`unmount`/`flushSync` only; TDD RED→GREEN per task; assert **load-bearing structure/classes**. jsdom cannot compute cascade → CSS-only changes verified via `svelte-check` (no `css_unused_selector`) + `vite build` + built-CSS grep.

- **Warning budget (exact, per Slice-2 gate):** baseline **36**; T7 removes 3 `SequenceLink` `state_referenced_locally` → **33**; T8a removes 2 `BlockGroup` a11y → **31**; all other tasks hold the count they inherit; any *new* warning (e.g. `css_unused_selector`) must be **0**. "Must not grow" is the gate.
- **Existing tests that must stay green** (adjust selectors only, never weaken — except the one authorised `MiniProjectLink` assertion edit): `CourseView`, `BlockGroup`, `InteractiveAppItem`, `InteractiveFrame`, `ItemRouter`, `MiniProjectLink`, `StatusPill`, **`ItemIcon`** (button state-class `:33-36` + `button svg` `:41-49` + empty `textContent` `:30`).
- **New / extended focused tests, with the locked edge cases:**
  - `ItemMark`: mark per type, `aria-hidden`, state class.
  - `SequencePlayer`: breadcrumb segments + course-link-back + `currentBlock===null` fallback; **shared breadcrumb renders in the empty-sequence branch**; footer `Next: {title}` primary at a **sequence boundary where a later flat item exists in another sequence** (asserts it crosses, does NOT show Finish); **whitespace next-title → plain `Next →`**; **`Finish sequence` enabled at the course-flat end → navigates to `/courses/{slug}`**.
  - `QuizItem`: item-title `<h2>` (stub `item.title`); per-question counter; "Submit answer"; **attempts line for 0 / 1 / plural**; **snapshot-absent (`__test__setSlots(null)`) suppresses the line**; **submit → result → Try again shows the decremented remaining** (regression for enumerated 3); explanation panel.
  - `SingleChoiceQuestion` + `MultiChoiceQuestion`: selected class; **all four reveal states** incl. multi-choice partial (neutral has no mark).
  - `NumericQuestion` (asserts `mono` class + correct-answer-only reveal, no student-value judging) + `TextQuestion` (correct-answer-only reveal).
  - `VideoItem` / `SequenceLink` / `MiniProjectLink`: the removed decorative glyph node is gone and the SVG/`ItemMark` is present — assertion **scoped to that node** (not a blanket "no ✓ anywhere", so `StatusPill`'s retained `✓` is unaffected); `SequenceLink` chain length + covered/not-yet classes + exact mono count + reactive `href`/`total`.
  - `BlockGroup`: `button[aria-expanded]` flips true/false on click; `aria-controls` matches the panel `id`; panel is `role="region"` with `aria-labelledby={btnId}`; SVG chevron present, no `▾/▸`; sequence list shows/hides with `expanded`.
- **Test-harness prerequisites:** `QuizItem` mounts an auto-reveal `$effect` calling `api.get(/reveal)` when `attempt_count >= max` — tests stub `api` and seed `currentCourse` (via `__test__setSlots`); `SequencePlayer` tests seed `currentCourse` + set `currentRoute.hash`. T1/T4 are not trivially sized.
- **Review per task:** two-lane gate (codex@high + first-party@opus), fix all Critical/Important, re-review until clean; whole-branch final review at the end.

---

## Task decomposition (9 tasks; finalised in the plan)

1. **T1 — SequencePlayer chrome:** breadcrumb snippet (both branches, null-block fallback, 10px margin), `<h1>` (base 21px + margin), chain-strip 2c geometry, `.content` padding:0 + 68ch, footer (`FlatRef.title`, Next-primary crossing boundaries, `Finish sequence` at flat-end → course navigate).
2. **T2 — Choice questions:** drawn option control (sr-only input, `--border-strong` ring, focus-visible + forced-colors per Slice-2 M5), prompt/list metrics, four-state reveal (three marks + bare neutral).
3. **T3 — Numeric + Text questions:** control-token field (`num mono`), correct-answer-only reveal.
4. **T4 — QuizItem shell:** item-title header, per-question counter, "Submit answer", attempts line + persisted `lastAttemptCount`, result card, explanation panel, article padding removal.
5. **T5 — Page / Video / Interactive / Unsupported items:** article rhythm + h2 unification, wrapper framing (`overflow:hidden` + local frame-margin reset, frames untouched), VideoItem `✓`→SVG (`--status-accepted-fg`), UnsupportedItem verify + padding drop.
6. **T6 — `ItemMark` primitive + type aliases:** extract presentational mark; refactor `ItemIcon` to compose it (state class on button, reset, no text node, `button svg` intact); `ItemIcon` tests stay green; add `ItemMark` test. **Must precede T7.**
7. **T7 — SequenceLink row + MiniProjectLink row:** pinned flex-row layout for both; `ItemMark` chain + mono `{covered}/{total}` (no `formatProgress`, `$derived`) + `✓` removal; MiniProjectLink authored from scratch + flag `ItemMark` + `📋` removal (authorised test edit); keep aria/row-class contracts.
8. **T8a — BlockGroup accordion:** pinned `<header><h2><button aria-expanded/-controls></h2></header>` + `role=region`/`aria-labelledby` panel + SVG chevron; drop 2 warnings; adjust direct-child test selectors + add accordion contract tests.
9. **T8b — StatusPill + CourseView:** from-scratch component-scoped pill (class→token table, renders with/without `.pill-token`), CourseView tokenise.

Dependencies: **T6 before T7**; T2/T3 before T4; T1/T5/T8a/T8b independent. Each ends with an independently testable deliverable + its own review gate.

---

## Git stacking (decided)

The Slice-3 branch `feat/visual-refresh-slice3-student-content` **descends from the Slice-2 tip `dca0a7b`** — the initial Slice-3 spec commit `50ecd09` is a direct child of `dca0a7b`, and the branch has advanced since (HEAD moves each spec revision). Rationale: Slice-2 modifies `SequencePlayer.svelte` (`e159612` — the `gap:6px` chain strip + mono counter this slice builds on) and remains unmerged (push deferred), so stacking avoids a conflict-prone rebase. The dependency is that SequencePlayer chain, **not** the Slice-2 primitive props — `Button.full`/`Logo.form` are unused here and `Input.mono` is deliberately not reused (§3 numeric field). The stack merges in order (`main ← slice2 ← slice3`) when the redesign lands; no integration into `main` now.

---

## Round-2 review resolutions (for re-review verification)

**Critical:** D4 "Finish sequence" removing forward cross-sequence nav (all 3 lanes) → corrected to Finish-at-flat-end-only; Next preserves boundary crossing; Data-flow claim now true; Goal restored; boundary/flat-end/whitespace tests added. MiniProjectLink zero CSS (revA I2, revB C2) → T7 authors the row from scratch; "BlockGroup styling" attribution corrected to the test files. Attempts-copy stale after Try again (codex C1) → enumerated `lastAttemptCount` persisted state + regression test. `--faint` misuse for enabled control (codex C4, revA I8) → `--border-strong`. Enumerated-exhaustiveness (codex C3, revA I7, revB I5) → added copy items 6-11 (Submit answer, breadcrumb redistribution, Next label, VideoItem ✓, per-question label, attempts copy). ItemMark contract (codex I2, revA C2, revB I2) → `Item['type']`/`ItemMarkState`, state stays `not-yet`, state class on button, `button svg` + empty-textContent asserted, button reset.
**Important:** item/quiz vertical rhythm pinned (`.content` padding:0, article flex gap:16px, T4 owns quiz padding) + frame-card `overflow:hidden` + local `:global(.frame){margin-bottom:0}` (revA I1, codex I3, M5). SequenceLink row layout + hover-token fix pinned (revA I3, codex I6). StatusPill scoped-vs-global decided = component-scoped, with the raw `:527` Late badge + teacher family untouched (revA I4, codex I1, revB I4). BlockGroup accordion structure locked + tests added (revA I5, codex I5, revB M2). Warning arithmetic 36→33→31 with per-task expectation (revA I6, revB I6). Numeric mono via `class="num mono"` for a jsdom-visible hook (revA I9). Attempts-undefined reframed as snapshot-absent (revB I3). Edge-case tests enumerated (codex I7). T8 split → T8a/T8b (revA M8).
**Minor:** `ItemType`→`Item['type']` alias (revA M1, revB I1, codex I2). Breadcrumb 10px margin (revA M2). Spinner/UnsupportedItem reworded to real targets (revA M3/M4, revB M1). Reveal-mark placement = trailing (revA M7). Emoji inventory folds `▾/▸` (revA M9). Counter citation "adapted from ref 2123" (revA M10, revB M3). StatusBadge no-glyph tension noted (revB M4). Git HEAD claim de-volatilised + StatusPill policy line `:9-12` (revB M5, codex M1). D3-naming collision reworded to "pre-existing StatusPill no-aria-label policy" (codex M2). Video-watched colour pinned `--status-accepted-fg` (codex M3).
