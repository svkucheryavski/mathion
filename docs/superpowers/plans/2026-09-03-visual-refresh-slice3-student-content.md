# Visual Refresh — Slice 3: Student In-Sequence Content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the student's in-course content experience — the sequence-player chrome, the item content (page / video / quiz / interactive / unsupported), and the CourseView blocks→sequences landing — to the refreshed visual system, plus the enumerated decorative-glyph→SVG, copy, and structural-a11y touches. **No backend/API/schema/route change except the ONE allow-list entry carved out in constraint 8** (`"ol": {"start"}` in `backend/mathion/markdown.py` + its tests, added in T5 — CORRECTED 2026-09-05, codex-t5r3-I2, which caught that this Goal line still made the unqualified claim after constraint 8 had been amended).

**Architecture:** Nine independently-reviewable tasks (execution order T1 → T4 → T2 → T3 → T5 → T6 → T7 → T8a → T8b) each restyle one surface or primitive, author/extend their own focused tests, and end with a full gate + review. All work is CSS/token + Svelte-markup + the spec's §Enumerated client-side touches; the design is authored against `reference-screens.dc.html` (2c / 10h / 3b) and Slice-1/2 conventions.

**Tech Stack:** Svelte 5 (runes) + TypeScript; component tests via `mount`/`unmount`/`flushSync` from `svelte` (never `@testing-library`); `svelte-check`, `vitest`, `vite build`. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-09-01-visual-refresh-slice3-student-content-design.md` — **CONVERGED at rev 22 (codex-verified 0C/0I).** The spec is the binding authority and travels with this plan. It pins every CSS declaration, rationale, gate grep, and ruling. **This plan sequences the tasks, provides the concrete test code, and gives each task's gate procedure; the exact CSS pins for each task live in the spec section named in that task — implement them from there rather than from a re-typed copy (single source of truth).** Where the spec and this plan appear to differ, the spec wins; raise it as a ruling.

## Global Constraints

Copied from the spec's §Global Constraints (every task implicitly includes these — exact values):

1. **Colours → tokens.** No hardcoded hex outside comments/brand-art; every colour resolves to an **existing** token in `frontend/src/styles/theme-default.css` (no new colour tokens). **Exemption:** CSS system-colour keywords (`Highlight`, `CanvasText`, …) inside `@media (forced-colors: active)` are required and not violations.
2. **No opacity-based disabled/dim.** Recede via tokens (`--faint`/`--muted`/`--border-faint`/`--surface-2`), never `opacity`. Exception: the sr-only native inputs use `opacity:0` for *visual hiding of a still-focusable control* (annotate as such). Disabled option/field **text** uses `--muted` + `--surface-2` + `--border-faint` (a documented deviation from Button's `--faint`, because `--faint` fails AA as read text).
3. **No *decorative* glyphs.** Five occurrences removed across four sites (four→SVG, one→gone). Every new SVG: `aria-hidden="true"`, `viewBox="0 0 16 16"`, `stroke`/`fill="currentColor"`, `stroke-width`≈1.6–1.9, round caps/joins, ~11–14px, colour inherited. Carve-out: `LATEST_STATUS_META` status glyphs stay (colourblind signal).
4. **Mono for every numeral** (`--font-mono`). Slice-3's new numerals use the **global `.mono` utility class** (`base.css:10`), asserted via `classList.contains('mono')` (jsdom can't compute a scoped `font-family`); retained scoped-mono rules are guarded by dist-greps.
5. **Per-component literals — three permitted forms:** (a) geometry matching a reference line, annotated `/* ref NNNN */`; (b) no-ref literal with a comment naming the scale it matches; (c) implementation-mechanics literal with a mechanism comment. **Literals are geometry ONLY, never colours.** The roster is non-exhaustive; every geometry literal carries one of the three forms.
6. **Dense control metrics are final:** `--control-h` 30px, `--control-pad-x` 9px, field value 13px, `--btn-pad` 4px 10px, `--btn-pad-sm` 4px 9px, code/textarea 8px/10px.
7. **`ItemIcon`/`ItemMark` states** = `'covered' | 'current' | 'not-yet'` (`ItemMarkState`); covered = `--primary` fill/white mark; current = `--primary-soft` + 1.5px `--primary` border + `--primary` mark; not-yet = `--surface` + 1px `--border-strong` + `--muted` mark.
8. **No backend/API/route/schema change **ONE DOCUMENTED EXCEPTION, added 2026-09-05 (lane-G I2, codex-t5r3-I2):** T5 adds `"ol": {"start"}` to `backend/mathion/markdown.py`'s `_ALLOWED_ATTRS`, plus three tests in `backend/tests/test_markdown.py`. It is here rather than in a backend slice because T5's own list-marker split is what turns a stripped `start` from invisible into harmful — `<ol>` used to render as bullets so no number showed; it now renders `1. 2. 3.` where the teacher wrote `3. 4. 5.`. Shipping the split without it would be shipping a regression. No route, schema, or migration change — one sanitiser allow-list entry.** Quiz POSTs the whole answer-map once; coverage trackers and all routes untouched; every behaviour touch is client-side and enumerated in the spec's §Enumerated changes.
9. **Commit trailer (pinned, do NOT "correct"):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git add` **exact named paths only** (never `-A`/`.`).
10. **Model / effort / review discipline:** every implementer **and** reviewer runs **Opus @ xhigh**; codex runs **@ high**; **never downgrade**. Per-task two-lane review gate (codex@high + first-party@opus); fix all Critical/Important; re-review until clean before the task is marked complete; whole-branch final review at the end.

**Branch:** `feat/visual-refresh-slice3-student-content` (already checked out; descends from Slice-2 tip `dca0a7b`). **Do NOT push** — the whole redesign lands as a stack later. **Quiz-state bugs** (attempts remount/store-sync + answer/reveal leakage) are **out of scope** — deferred to a separate quiz-state-hygiene follow-up slice (user decision). The item-scoped `lastAttempt` Try-again memo **is** in scope (T4).

---

## Conventions (shared by every task — read once)

### Test pattern (repo idiom — never `@testing-library`)

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Component from '../components/…/Component.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Component, { target: host, props });
  flushSync();                 // flush after mount AND after every state change
  return host;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});
```

- **CSS is NOT computable in jsdom.** Any assertion about a *rendered* colour/size/scoped `font-family` must go to the **build-CSS grep** (below), not a `getComputedStyle` DOM check. DOM tests assert **structure, class membership, text content, `aria-*`, and `classList.contains('mono')`** only.
- **Mono assertions:** `expect(el.classList.contains('mono')).toBe(true)` — never a `font-family` check.
- **Seeding the course store:** `import { __test__setSlots } from '../stores/currentCourse.svelte'` and pass a `CourseSnapshot` (see `currentCourse.test.ts` / `CourseView.svelte.test.ts` for the shape). Reset with `__test__setSlots(null)` in `afterEach` where used.
- **Router-nav assertions** (T1 Finish): mock in a **separate test file** so the module-hoisted `vi.mock` doesn't break sibling tests that need the real `navigate`:
  ```ts
  vi.mock('../lib/router.svelte', async (importOriginal) => {
    const real = await importOriginal<typeof import('../lib/router.svelte')>();
    return { ...real, navigate: vi.fn() };   // factory must NOT reference a top-level const (TDZ)
  });
  // after imports:  const { navigate } = await import('../lib/router.svelte');
  ```

### Per-task gate (inherited verbatim from the Slice-2 plan — ALL must pass before review)

Run, in order, from `frontend/`:

1. **Svelte autofixer** on each edited `.svelte` file (MCP `svelte-autofixer`, or the `svelte:svelte-file-editor` agent). Re-run until it reports clean.
2. `npm test` — the **full** `vitest run` suite (not just the task's specs).
3. `npm run check` — **0 errors**; source warnings **must not grow** past baseline (**34 source warnings** today: SequenceLink ×3 `state_referenced_locally` at `8:17`/`12:28`/`12:46`, BlockGroup ×2 a11y at `22:3`, plus 2 `tsconfig.json` env warnings; several tasks *remove* warnings — never add).
4. `npm run build` — `vite build` succeeds.
5. **The task's source-greps + dist-CSS greps** (below, per task). Dist greps run **after** `npm run build`, against `dist/_app/*.css` (path pinned by `vite.config.ts:23 assetsDir:'_app'`), as **shell greps** — NOT vitest cases (no `src/tests` file may read `dist/`; a clean checkout has no `dist/`).

**Dist-grep discipline (spec §Testing strategy — the giant grep bullet):** each grep is a **declaration-level regex** tolerant of Svelte's scope-hash rewrite (`.sel` → `.sel.svelte-<hash>`, `:global(…)` stays bare, non-leading parts → `el:where(.svelte-<hash>)`, so use `[^}]*` to absorb interior `:where(…){`). **Hash-couple to a gate-verified-unique anchor:** for each rule, pick an anchor class the component's markup gives ONLY to the target, run `grep -oE '\.A\.svelte-[a-z0-9]+' dist/_app/*.css | sort -u` on the fresh build, confirm it yields exactly the expected hash(es) (AND grep the component's own source for the anchor — both prove ownership), then assert the rule under each literal `svelte-<hash>`. Never a bare match-count. The concrete anchors are re-verified at each gate.

### Commit (end of every task)

```bash
git add <exact paths listed in the task>          # never -A / .
git commit -m "<type>(frontend): Slice-3 <task> — <summary>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Review (end of every task — do not mark complete until clean)

Two-lane gate: **codex @ high** + **first-party reviewer @ Opus xhigh**, both against the task diff. Fix every Critical/Important, re-review until both lanes are clean. Then proceed to the next task. Whole-branch final review after T8b.

---

## File Structure

**New files:**
- `frontend/src/components/course/ItemMark.svelte` — presentational 22px square + type SVG + state (T6).
- **Eleven brand-new test files** (all in `frontend/src/tests/`, **all verified ABSENT today** — each task authors its own from scratch, so the per-task authoring counts are T1=2 / T2=2 / T3=2 / T4=1 / T5=2 / T6=1 / T7=1 = 11): `SequencePlayer.svelte.test.ts`, `SequencePlayer.finish.svelte.test.ts` (T1); `QuizItem.svelte.test.ts` (T4 — no student-facing QuizItem test exists today; the existing `QuizEditor`/`QuestionAccordion`/`QuestionTypePicker` tests are the authoring side); `SingleChoiceQuestion.svelte.test.ts`, `MultiChoiceQuestion.svelte.test.ts` (T2); `NumericQuestion.svelte.test.ts`, `TextQuestion.svelte.test.ts` (T3); `VideoItem.svelte.test.ts`, `UnsupportedItem.svelte.test.ts` (T5); `ItemMark.svelte.test.ts` (T6); `SequenceLink.svelte.test.ts` (T7).

**Modified components:** `pages/SequencePlayer.svelte` (T1); `components/items/QuizItem.svelte` (T4); `quiz/SingleChoiceQuestion.svelte`, `MultiChoiceQuestion.svelte` (T2); `quiz/NumericQuestion.svelte`, `TextQuestion.svelte` (T3); `items/PageItem.svelte`, `VideoItem.svelte`, `InteractiveAppItem.svelte`, `UnsupportedItem.svelte`, `items/ItemRouter.svelte` (T5); `course/ItemIcon.svelte` (T6); `course/SequenceLink.svelte`, `course/MiniProjectLink.svelte` (T7); `course/BlockGroup.svelte` (T8a); `course/StatusPill.svelte`, `pages/CourseView.svelte` (T8b); `lib/types.ts` (+`ItemMarkState`, T6).

**Extended tests:** `InteractiveAppItem.svelte.test.ts`, `ItemRouter.svelte.test.ts` (+mini_project dispatch case, T5); `ItemIcon.svelte.test.ts` stays green + gains a forwarding assertion (T6); `MiniProjectLink.svelte.test.ts` (authorised assertion inversion, T7); `BlockGroup.svelte.test.ts` (selector adjustments + accordion-contract tests, T8a); `CourseView.svelte.test.ts`, `StatusPill.svelte.test.ts` (T8b).

**Must stay green (regression guards, adjust selectors only — never weaken):** `MiniProjectDetailPage.svelte.test.ts` (its two `header .pill` assertions at `:214`/`:402` — T8b's scoped StatusPill CSS must not break them), `InteractiveFrame.svelte.test.ts`. **`PageItem` gets NO new test file** (its 30s coverage timer is preserve-verbatim, unchanged by the CSS-only `.content` touch — spec §Testing-strategy, test-harness prereqs).

---

## Task 1 — T1: SequencePlayer chrome

**Files:**
- Modify: `frontend/src/pages/SequencePlayer.svelte`
- Create: `frontend/src/tests/SequencePlayer.svelte.test.ts`, `frontend/src/tests/SequencePlayer.finish.svelte.test.ts`

**Spec:** §Per-surface design §1 (breadcrumb snippet, `<h1>`+header reconciliation, chain strip, content rhythm, footer D4) + Enumerated (A)1/(A)2, (B)7/(B)8, D4. Implement the pinned rules from there.

**Interfaces:**
- Consumes: nothing from earlier tasks (T1 is independent).
- Produces: `FlatRef` gains `title: string` (`SequencePlayer.svelte`); the breadcrumb `<nav class="crumbs">` snippet + `.seq-title`/`.strip`/`.content`/footer markup. No exported symbol other tasks consume.

**Test-harness prerequisites (both T1 files — the round-3→6 Critical; get this exact or the tests are flaky):**
- Seed **the player's own route, not only the hash**, BEFORE mount: `history.replaceState(null, '', '/courses/{slug}/seq/{seqId}')` **and** set `currentRoute.path = '/courses/{slug}/seq/{seqId}'`, `currentRoute.search = ''`, `currentRoute.hash = '#item=<valid member id>'`. Without the seeded `path`, the resolution effect's `navigate` suspends at `await runGuards()` and `flushSync` (which flushes Svelte's effect queue, NOT the JS microtask queue) returns with `currentItemId === null`, and the deferred `applyLocationToRoute` clobbers your seed.
- The seeded snapshot's **`slug` MUST equal the `courseSlug` prop** — else the `:16-29` load effect takes the `!==` branch and fires an unstubbed `loadCourse`→`api.get`.
- Mounting `SequencePlayer` mounts the real item subtree via `ItemRouter`; seed **`static_page` items** (lightest renderer — no fetch, no auto-reveal) for chrome/footer/breadcrumb fixtures, and unmount cleanly (PageItem's interval/tracker tear down on `unmount`).
- `flatIndex < 0` recipe: after the valid-member mount+flushSync (which lands `currentItemId` synchronously via `navigate`'s `target===current` early-return), set `currentRoute.hash = '#item=<id NOT in flatItems>'` + `flushSync()` → `currentItem` null, `flatIndex === -1`; the resolution effect's `currentItemId === null` guard now fails so it does not re-navigate. Assert primary is disabled with label `Next →` (NOT "Finish") and both buttons carry `title="Loading…"`.
- `SequencePlayer.finish.svelte.test.ts` keeps the seed but adds the module-hoisted `vi.mock('../lib/router.svelte', …navigate: vi.fn())` (Conventions §router-nav) — the mock is why it must be a separate file: the main file's recipes depend on the REAL `navigate`.

- [ ] **Step 1: Write the failing tests.** `SequencePlayer.svelte.test.ts` (real `navigate`) — seed the course store via `__test__setSlots` with a course whose block/sequence give a known breadcrumb, mount `SequencePlayer`, `flushSync`, and assert **structure only** (jsdom can't see CSS):
  - `nav.crumbs` exists with `aria-label="Breadcrumb"`; its flex-item children are course `<a>` → `.sep` → `.crumb` (block) → `.sep` → `.current` (S segment).
  - the block segment is a single `.crumb` span wrapping `<span class="mono">B{order}</span>` + ` · {title}` text; `expect(bMono.classList.contains('mono')).toBe(true)`.
  - the S segment is `<span class="mono current">S{order}</span>`; `classList.contains('mono')` **and** `contains('current')`.
  - the course segment is an `<a href="/courses/{slug}">` with no leading `←`.
  - `h1.seq-title` renders the **sequence title only** (no `S{order}` prefix).
  - footer: with a mid-course item, primary Button label is `Next: {title} →` inside one `.next-label` span containing `.next-title`; Previous is `disabled` when `flatIndex<=0`.
  - empty-sequence branch renders the same `nav.crumbs` + `.seq-title` (title-only).

  `SequencePlayer.finish.svelte.test.ts` (mocked router, separate file) — seed the store so the current item is the **course-flat last** item; mount, `flushSync`, click the primary Button, assert `navigate` was called once with `/courses/{courseSlug}` and the label read `Finish sequence`.

- [ ] **Step 2: Run the tests — expect FAIL.** `npm test -- SequencePlayer` → both new files fail (breadcrumb `<nav>`/`.seq-title`/finish-nav don't exist yet).

- [ ] **Step 3: Implement** per spec §1. In `SequencePlayer.svelte`: add `title: string` to `FlatRef` (Enumerated (A)1); extract the breadcrumb `{#snippet crumbs(seq: SequenceContent)}` used by both the normal and empty branches with the `{#if currentBlock}` inner guard and pinned markup/classes; drop the `<header>` wrapper and its `header`/`header h1`/`.crumb*` rules, add `<h1 class="seq-title">` + `.seq-title { margin:0 0 14px }`; apply the ref-2c `.strip`/`.content` geometry; implement the D4 three-way footer predicate (`Next: {title} →` bounded label with `.next-label { white-space:nowrap; min-width:0 }` + `.next-title` ellipsis, `Finish sequence` → `navigate('/courses/{courseSlug}')`, conditional disabled `title`s). Keep loading/error/not-found branches verify-only (bare `h1` must NOT get the margin — scope it to `.seq-title`).

- [ ] **Step 4: Run the tests — expect PASS.** `npm test -- SequencePlayer`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail** (Conventions §gate). T1 dist/source greps: `.strip` `margin-bottom:20px`; `.crumbs` `gap:8px` + `flex-wrap:wrap`; `.crumbs a` `color:var(--muted)` (scoped to `.crumbs`, not bare `nav a`); `.crumbs .current` `color:var(--text)`; `.crumbs .sep` `color:var(--faint)`; `.next-label` `white-space:nowrap`; `.next-title` `max-width:22ch` + `text-overflow:ellipsis`; `.content` `padding:0` **hash-coupled via the SequencePlayer-unique `.strip`** (bare `.content` collides with PageItem). **The `max-width:68ch` half of this assertion is RETIRED** — spec §103's 2026-09-04 correction found it a 16px→14px unit-porting bug and moved the measure to `.quiz` (`max-width:652px`) and `.page-item` (`max-width:652px`) (**CORRECTED 2026-09-05, codex-t5r2-I2** — the `calc(652px + 2 * var(--space-3))` this line carried compensated for a padding that T5 zeroes, so it both over-measured by 32px and made the gate reject the correct code); assert those two instead, plus `68ch` appearing ZERO times in the bundle. **Also assert `.counter` `font-size:12.5px`** (§124(c) raised it from ref 2117's 11.5px; unguarded until revD-I3). Plus the DOM assertion that `nav.crumbs` has the expected flex-item children.

- [ ] **Step 6: Commit.**
```bash
git add src/pages/SequencePlayer.svelte src/tests/SequencePlayer.svelte.test.ts src/tests/SequencePlayer.finish.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T1 — SequencePlayer chrome (breadcrumb, footer D4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane, Conventions §review). Fix all Critical/Important, re-review until clean.

---

## Task 2 — T4: QuizItem shell (before T2/T3)

**Files:**
- Modify: `frontend/src/components/items/QuizItem.svelte`
- Create: `frontend/src/tests/QuizItem.svelte.test.ts` (verified ABSENT — no student-facing QuizItem test exists today).

**Spec:** §3 "QuizItem shell (T4)" + Enumerated (A)3 (`lastAttempt` memo), (B)6 (`Submit answer`), (B)10 (per-question counter), (B)11 (attempts line), + §Testing-strategy QuizItem bullet (D1 all-at-once contract + deferred-response recipe). Implement the pinned structure/rules from there.

**Harness:** stub `api` (the auto-reveal `$effect` fires `api.get('/reveal')` when `attempt_count >= max`) and seed `currentCourse` via `__test__setSlots` (Conventions).

**Interfaces:**
- Consumes: nothing (T4 is the first quiz task).
- Produces: the `.q-block` per-question wrapper + `.q-counter`, `.submit-row`, `.result`/`.meta`, `.exp`, and the zeroed article rhythm that **T2/T3 rely on** (they zero their own `fieldset`/`.row` margins against T4's `gap:16px`). The `lastAttempt` memo lives here.

- [ ] **Step 1: Write the failing test.** Create `QuizItem.svelte.test.ts`; seed a quiz item + `currentCourse` snapshot; mount; `flushSync`; assert:
  - each question is wrapped in `.q-block` containing a `<span class="q-counter mono">Question {i+1} of {n}</span>` — assert text `Question 1 of N` (1-based) and `classList.contains('mono')`.
  - the `{@const r = revealById?.[q.id] ?? null}` stays an immediate `{#each}` child (compiles — this is caught by `npm run build`, not a DOM assert).
  - submit row: primary Button reads `Submit answer`; `disabled` when not all answered; retains `loading` when in-flight.
  - **D1 all-at-once contract (spec §Testing-strategy, since T4 restructures the `{#each}`):** with a stubbed `api.post` spy — Submit stays `disabled` until **every** question is answered; on click **exactly one** POST fires carrying the whole answer-map; a **second click while `inflight !== null` posts nothing further** (assert spy call-count stays 1).
  - attempts line: `!locked` renders `{remaining} attempt(s) left` with the numeral in `<span class="mono">` (`classList.contains('mono')`); singular "1 attempt left"; the **0-case** (`remaining === 0`, reachable only before auto-reveal flips `revealed`: seed `attempt_count = max`, stub `api.get('/reveal')` as never-resolving, assert immediately after `flushSync` while `locked` is still false); suppressed when `currentCourse.value === null` (`__test__setSlots(null)`); **absent in the locked/result state**.
  - **`lastAttempt` memo (Enumerated (A)3):** simulate submit success returning `{ item_id, attempt_count }`; assert the attempts line reflects `res.attempt_count` across a `tryAgain()` (regression for "stays accurate across Try again"); and that the memo is **id-guarded** — submit item A → Try again → swap the `item` prop to a fresh quiz B (same instance) → B's attempts line reads B's store count, NOT A's leaked `lastAttempt`. Keyed off `res.item_id`, NOT `item.id`.
  - **deferred-response variant (TOCTOU guard):** swap `item` to B *before* A's submit promise resolves, then resolve A (stub `can_retry: true`); click "Try again" so `locked` returns false; assert B's attempts line reads B's store count, not A's leaked count. **Also assert `markItemCovered` was called with `res.item_id` (A's id), not B's** — guards the `markItemCovered(item.id)`→`markItemCovered(res.item_id)` change, which otherwise ships unguarded.
  - result card: score wrapped `<span class="mono">{correct} / {total}</span>` (`classList.contains('mono')`); explanation panel renders.

- [ ] **Step 2: Run — expect FAIL.** `npm test -- QuizItem`.

- [ ] **Step 3: Implement** per spec §3 QuizItem-shell: restructure the `{#each}` (`{@const r}` above `<div class="q-block">`, per-question counter, index `, i`), the `.submit-row` with `Submit answer` + `loading` retained, the `.hint` attempts line (`{remaining} left`, mono numeral, snapshot-absent guard, `!locked` only), the `lastAttempt = $state<{id;count}|null>` memo set to `{id:res.item_id, count:res.attempt_count}` on submit success (and route `markItemCovered` through `res.item_id` too), the result card (`align-items:flex-start`, `.meta` retarget, mono score wrapper), the explanation panel, and zero the `.result`/`.hint`/`.exp` margins against the article `gap:16px`. Preserve the state machine + `assertNever`.

- [ ] **Step 4: Run — expect PASS.** `npm test -- QuizItem`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T4 dist greps: `.q-block`; `.submit-row` `gap:12px`; `.result` `flex-direction:column` + `align-items:flex-start`; the quiz article `/\.quiz\.svelte-[a-z0-9]+[^}]*gap:16px/` + `padding:0` (`.quiz` is QuizItem-unique — verify one hash); the quiz `h2` `/\.quiz\.svelte-[a-z0-9]+ h2[^}]*font-size:16px/`; **the quiz measure `/\.quiz\.svelte-[a-z0-9]+[^}]*max-width:652px/`** (§103 correction); **and the two §124 deviation values, unguarded until revD-I3: `/\.q-counter\.svelte-[a-z0-9]+\{[^}]*font-size:12\.5px/` and `/\.q-block\.svelte-[a-z0-9]+\+\.q-block[^}]*border-top:1px solid var\(--border\)/`, plus NEGATIVE assertions that the divider does not use `--border-faint` (the disabled-control token) and that neither `.q-counter` nor `.counter` is left at 11.5px.** (The three P/V/I `h2`s are T5's.)

- [ ] **Step 6: Commit.**
```bash
git add src/components/items/QuizItem.svelte src/tests/QuizItem.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T4 — QuizItem shell (q-block, submit row, attempts memo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 3 — T2: Choice questions (Single + Multi)

**Files:**
- Modify: `frontend/src/components/items/quiz/SingleChoiceQuestion.svelte`, `frontend/src/components/items/quiz/MultiChoiceQuestion.svelte`
- Create: `frontend/src/tests/SingleChoiceQuestion.svelte.test.ts`, `frontend/src/tests/MultiChoiceQuestion.svelte.test.ts`

**Spec:** §3 "Choice questions (Single + Multi, T2)" + the four-class reveal (Enumerated (A)4, D2) + the **canonical `.opt` `<style>` authoring order** (8-step, source-order-dependent — implement in exactly that order) + the source-order gate.

**Interfaces:**
- Consumes: T4's article/`.q-block` rhythm (zero this task's own `fieldset` margin against it).
- Produces: the `.opts`/`.opt`/`.ctl`/reveal partition. No symbol other tasks consume.

- [ ] **Step 1: Write the failing tests.** For each of Single/Multi, mount with a question + options; `flushSync`; assert (structure/class only):
  - `.opts` container wraps the option rows; each row is `<label class="opt">` with a visually-hidden native `<input>` + a `<span class="ctl">`.
  - `class:selected` toggles on pick (assert `classList.contains('selected')` after setting the input).
  - **pre-submit (`correctOptionIds === null`):** NO `.opt` carries any `reveal-*` class, even after a pick (guards the "fires before submit" regression).
  - **locked pre-reveal (`disabled` + `correctOptionIds === null`):** `.opt` carries `locked` and NOT any `reveal-*` class (the one assertion that guards the gated cascade).
  - **reveal (`correctOptionIds !== null`):** every option carries **exactly one** of `reveal-correct`/`reveal-wrong`/`reveal-missed`/`reveal-neutral`; the three evaluative rows carry an `svg.mark[aria-hidden="true"]` + an `.sr-only` label with the expected text; `reveal-neutral` has neither; an **unanswered** correct option → `reveal-correct` (not neutral).
  - Multi partial-answer test exercises all four classes; the `{#if isChosen}` inner glyph (`.dot` / `svg.check`) is present when selected, absent otherwise.

- [ ] **Step 2: Run — expect FAIL.** `npm test -- ChoiceQuestion` (both files).

- [ ] **Step 3: Implement** per spec §3 T2. Add the `.opts` container; `legend` owns the prompt→options gap (`padding:0`, last-paragraph-only `.text :global(p)` margin); the drawn `.ctl` (radio ring→dot / checkbox square+check, both `flex:0 0 auto`, no pseudo-elements, conditional `{#if isChosen}` inner glyph); the `class:selected` + **`class:locked={disabled && correctOptionIds === null}`** hooks; the four reveal predicates (all guarded by `isRevealed = correctOptionIds !== null`); the reveal row rules + pinned `.mark` status colours + `.sr-only` rule + `reveal-neutral` recede + combined `.ctl` recede; focus-visible + forced-colors. **Author the `.opt` scoped rules in the spec's exact 8-step source order** (the source-order gate checks this).

- [ ] **Step 4: Run — expect PASS.** `npm test -- ChoiceQuestion`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T2 dist greps (hash-coupled per component — Single vs Multi discriminate by Single's `.ctl .dot { border-radius:50% }` vs Multi's checkbox-only `.opt.selected .ctl { background:var(--primary) }`): the four reveal classes incl. `reveal-neutral` recede; the mark colours (`.opt.reveal-correct .mark`/`.opt.reveal-missed .mark` `--status-accepted-fg`, `.opt.reveal-wrong .mark` `--status-rejected-fg`); evaluative rows `border-width:1.5px`; combined `.ctl` recede `border-color:var(--border-faint)`; `.opt.locked` bg `--surface-2` + `.opt.locked .ctl` `--border-faint`; `input:focus-visible`; `@media (forced-colors`; `.sr-only` clip; the **paired** `.text` margin greps (`p:last-child{margin:0}` AND non-last `p{margin:0 0 …}`), hash-coupled, **exactly 2 pairs** at this gate. Plus the **source-order assertion** per component (compare selector byte-offsets in the `.svelte` source — no compiled hash — verifying `.opt.locked` < `.opt.selected`, reveal `.ctl` recede < `.opt.selected .ctl`, `.opt.selected` < the three evaluative rows).

- [ ] **Step 6: Commit.**
```bash
git add src/components/items/quiz/SingleChoiceQuestion.svelte src/components/items/quiz/MultiChoiceQuestion.svelte src/tests/SingleChoiceQuestion.svelte.test.ts src/tests/MultiChoiceQuestion.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T2 — choice questions (drawn control + four-class reveal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 4 — T3: Numeric + Text questions

**Files:**
- Modify: `frontend/src/components/items/quiz/NumericQuestion.svelte`, `frontend/src/components/items/quiz/TextQuestion.svelte`
- Create: `frontend/src/tests/NumericQuestion.svelte.test.ts`, `frontend/src/tests/TextQuestion.svelte.test.ts`

**Spec:** §3 "Numeric + Text questions (T3)".

**Interfaces:**
- Consumes: T4's `.q-block` rhythm (zero this task's `.row` margin against it).
- Produces: the `.num`/`.txt` control-token field + correct-answer-only reveal.

- [ ] **Step 1: Write the failing tests.** Numeric: mount; assert the field is a local `<input class="num mono">` (`classList.contains('mono')`), keeps `inputmode="decimal"` and `disabled={locked}`; on reveal the correct-line renders `Correct answer: <strong class="mono">{value}</strong>` (`classList.contains('mono')`) and **does NOT judge** the student value. Text: field `class="txt"`; reveal shows the correct answer **non-mono** (no `.mono` on the revealed value); no client-side judging. Both: multi-paragraph prompt keeps inter-paragraph separation (assert two `<p>` in `.text`).

- [ ] **Step 2: Run — expect FAIL.** `npm test -- Question` (Numeric/Text).

- [ ] **Step 3: Implement** per spec §3 T3. Local `<input>` on control tokens (NOT `ui/Input`); `class="num mono"` / `class="txt"`; **per-file** `.num:disabled` / `.txt:disabled` token treatment (NOT a combined selector list — the absent member would emit `css_unused_selector`); retain the existing field widths; **retarget the bare `input {}` rules to `.num`/`.txt`** (replace, don't supplement — else conflicting `--border`/padding); `.row { …; gap:16px; margin:0 }` + last-paragraph-only `.text :global(p)` margin + `.correct-line { margin:0 }`; numeric reveal value `<strong class="mono">`, Text value non-mono.

- [ ] **Step 4: Run — expect PASS.** `npm test -- Question`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T3 dist greps: `.num` control metrics; **per-file** `.num:disabled` (Numeric) / `.txt:disabled` (Text) token bg — two separate greps, one per file, NOT combined; `.txt` control metrics; `.row` `gap:16px` hash-coupled to `.num:disabled`/`.txt:disabled`; the **paired** `.text` margin greps (hash-coupled; at T3's gate the cumulative bundle holds 4 pairs — T2's persist — so assert 4 OR hash-couple Numeric/Text via `.num:disabled`/`.txt:disabled`). The numeric-reveal `<strong class="mono">` is a DOM `classList` test.

- [ ] **Step 6: Commit.**
```bash
git add src/components/items/quiz/NumericQuestion.svelte src/components/items/quiz/TextQuestion.svelte src/tests/NumericQuestion.svelte.test.ts src/tests/TextQuestion.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T3 — numeric + text questions (control field + answer reveal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 5 — T5: Page / Video / Interactive / Unsupported items

**Files:**
- Modify: `frontend/src/components/items/PageItem.svelte`, `VideoItem.svelte`, `InteractiveAppItem.svelte`, `UnsupportedItem.svelte`, `ItemRouter.svelte`
- Create: `frontend/src/tests/VideoItem.svelte.test.ts`, `frontend/src/tests/UnsupportedItem.svelte.test.ts`
- Extend: `frontend/src/tests/InteractiveAppItem.svelte.test.ts`, `frontend/src/tests/ItemRouter.svelte.test.ts`
- Modify (backend, per the constraint-8 carve-out): `backend/mathion/markdown.py`
- Extend (backend): `backend/tests/test_markdown.py`

**Spec:** §2 "Item content — T5" + Enumerated (B)9 (VideoItem check), (B)16 (Interactive hint), (B)17 (Unsupported copy).

**Interfaces:**
- Consumes: nothing (T5 is independent of T1–T4; the shared article `gap:16px` rule is authored here for P/V/I).
- Produces: the P/V/I article rhythm + card framing; `ItemRouter` drops the `type=` passes.

- [ ] **Step 1: Write the failing tests.** `VideoItem.svelte.test.ts`: watched confirmation renders an inline `svg[aria-hidden="true"]` + text (no `✓` glyph), inside `.watched` — assertion **scoped to that node** (not a blanket "no ✓", so StatusPill's retained `✓` elsewhere is unaffected). **Also assert the coverage-tracker lifecycle** (preserve-verbatim wiring must survive the glyph edit): the `$effect`/`markWatched()` fires **once** on the watched path and **tears down on `unmount`** (spy on the tracker). `UnsupportedItem.svelte.test.ts`: renders the type-neutral `<p>` whose text contains **neither `mini_project` nor `(`** and **does** contain "isn't available"; component is prop-less. Extend `InteractiveAppItem.svelte.test.ts`: the ready state renders `<p class="cover-hint">Marked covered once opened.</p>` (ready only; **absent** in loading/empty/error branches; existing coverage-effect/guard tests stay green). Extend `ItemRouter.svelte.test.ts` with a **`mini_project` dispatch case** (mirror the existing `interactive_app` test): mount ItemRouter with a `mini_project` item + state, assert the UnsupportedItem type-neutral copy renders (`.unsupported`/text contains "isn't available", no raw identifier) — the regression guard for the `type=` removal.

- [ ] **Step 2: Run — expect FAIL.** `npm test -- "VideoItem|UnsupportedItem|InteractiveAppItem|ItemRouter"`.

- [ ] **Step 3: Implement** per spec §2. Article flex rhythm (`display:flex;flex-direction:column;gap:16px;padding:0`) + `<h2>` 16px/600 for Page/Video/Interactive; card framing (`overflow:hidden` + **ancestor-scoped** `.video-card :global(.frame){margin-bottom:0}` / `.app-card` twin — never a bare top-level `:global(.frame)`); action-Button `.actions` wrappers; **PageItem** exact content selectors retained, including the **split `.content :global(ul > li){list-style:disc}` / `.content :global(ol > li){list-style:decimal}`** (the compile-valid `:global(> li)` form — NOT `:global(ul) li`); VideoItem `✓`→SVG in `.watched`; InteractiveAppItem `.cover-hint` ready-only + notices `--muted`; **UnsupportedItem** type-neutral copy + drop the `type` prop but **KEEP an empty `<script lang="ts">` block** (**CORRECTED 2026-09-05, codex-t5r2-M5** — this said "delete the whole prop-less `<script>`"; doing so leaves the component untyped, so every importer resolves it as implicit `any` and `npm run check` went 0 → 2 errors at `ItemRouter.svelte:8` and the T5 test's import. The empty typed block is the smallest thing that satisfies both, and the deviation is recorded in spec §2) + drop `ItemRouter:21`/`:27` `type=` passes.

- [ ] **Step 4: Run — expect PASS.** `npm test -- "VideoItem|UnsupportedItem|InteractiveAppItem|ItemRouter"`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T5 greps: source-grep `.video-card … .frame{…margin-bottom:0}` + `.app-card` twin; **PageItem's `{@html}` rules in DIST, hash-coupled to the PageItem-unique `.page-item` anchor (`.content` collides with SequencePlayer's) — `padding-left` on `.content :global(ul), :global(ol)`, the split markers `:global(ul > li)`→disc / `:global(ol > li)`→decimal, `:global(p)` `margin-bottom`/`line-height`, AND `.content { overflow-wrap: anywhere }`; plus each of those selectors in the structural exactly-once/top-level inventory** (**CORRECTED 2026-09-05, codex-t5r2-I2** — this prescribed a SOURCE grep, which mutation testing proved unsound in both directions: a later duplicate `:global(ol > li){list-style:none}` and an `@media`-wrapped `padding-left:0` both ESCAPED, while merely reflowing the selector list across two lines RED the gate on an identical file. `:global` leaves the payload hashless but the LEADING part keeps the scope hash, so these are all dist-greppable; see spec:197); dist `--status-accepted-fg` watched line; the article flex `gap:16px` as `/\.(page-item|video-item|interactive-app)\.svelte-[a-z0-9]+[^}]*gap:16px/` **matching exactly 3 distinct hashes** + `padding:0` for the three; the three P/V/I `h2`s `/\.(page-item|video-item|interactive-app)\.svelte-[a-z0-9]+ h2[^}]*font-size:16px/` (3 distinct hashes); InteractiveAppItem `.cover-hint` `font-size:12.5px`.

- [ ] **Step 6: Commit.**
```bash
git add ../backend/mathion/markdown.py ../backend/tests/test_markdown.py src/components/items/PageItem.svelte src/components/items/VideoItem.svelte src/components/items/InteractiveAppItem.svelte src/components/items/UnsupportedItem.svelte src/components/items/ItemRouter.svelte src/tests/VideoItem.svelte.test.ts src/tests/UnsupportedItem.svelte.test.ts src/tests/InteractiveAppItem.svelte.test.ts src/tests/ItemRouter.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T5 — page/video/interactive/unsupported items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 6 — T6: `ItemMark` primitive + `ItemMarkState` (must precede T7)

**Files:**
- Create: `frontend/src/components/course/ItemMark.svelte`, `frontend/src/tests/ItemMark.svelte.test.ts`
- Modify: `frontend/src/components/course/ItemIcon.svelte`, `frontend/src/lib/types.ts`

**Spec:** D5 + §4 "ItemMark primitive (T6)".

**Interfaces:**
- Consumes: nothing.
- Produces: **`ItemMark.svelte`** — props `{ type: Item['type']; state?: ItemMarkState }` (`state` defaults to `'not-yet'`), root `<span class="item-mark {state}" aria-hidden="true">`; **`ItemMarkState = 'covered' | 'current' | 'not-yet'`** in `types.ts`. Both consumed by **T7** (SequenceLink chain + MiniProjectLink flag).

- [ ] **Step 1: Write the failing test.** `ItemMark.svelte.test.ts`: renders a distinct `svg[aria-hidden="true"]` mark per `type`; root is `<span class="item-mark">` with `aria-hidden="true"` and no text node; the `state` class is applied; **default state is `not-yet`** when `state` omitted. Also extend `ItemIcon.svelte.test.ts` with the **forwarding assertion** (codex-r19-I5): for each of covered/current/not-yet, render `<ItemIcon>` and assert the nested `.item-mark` carries the matching state class (not just the button) — guards against a hardcoded `not-yet` child.

- [ ] **Step 2: Run — expect FAIL.** `npm test -- "ItemMark|ItemIcon"`.

- [ ] **Step 3: Implement** per spec §4 T6. Add `ItemMarkState` to `types.ts` (and replace `ItemIcon`'s local `type State`). Author `ItemMark.svelte`: `{ type, state = 'not-yet' }` props, the SVG marks + the **full base rule** `.item-mark { box-sizing:border-box; width:22px; height:22px; flex:0 0 auto; …; display:inline-flex; align-items:center; justify-content:center }` + state rules `.item-mark.covered`/`.current`/`.not-yet` (Constraint 7) + a **`@media (forced-colors: active)`** block restating all three with a non-colour distinction (covered = inverted solid fill `CanvasText`/`Canvas`, current = `2px solid Highlight`, not-yet = `1px dashed GrayText`) — without it `covered` and `not-yet` collapse under Windows High Contrast and per-item completion is lost entirely (codex-r1-I1). Refactor `ItemIcon` to `<button class="icon {istate}"><ItemMark type={item.type} state={istate}/></button>`; **reduce `.icon` to `{ display:inline-flex; border-radius:var(--radius) }`** (delete its box/border/bg to avoid the double-ring) and **delete the orphaned `.covered`/`.current`/`.not-yet` rules** (`ItemIcon.svelte:66/72/78`). Keep `button svg` reachable + empty `textContent`.

- [ ] **Step 4: Run — expect PASS.** `npm test -- "ItemMark|ItemIcon"`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T6 assertions — **PARSE-BASED, not greps (CORRECTED 2026-09-05, laneB-C1)**: select every rule whose PARSED selector carries the component hash, compare the full rule INVENTORY against the pinned list, and compare each rule's DECLARATION SET. Pinned: `.item-mark`'s base box stated in full (incl. the load-bearing `flex:0 0 auto`), the three state rules per Constraint 7, and `.icon`'s `display:inline-flex; border-radius:var(--radius)` — listing `.icon`'s complete rule set IS the deletion half, stated positively. Both anchors need the OWNERSHIP check as well as dist-uniqueness (one hash alone does not say which component owns it). **Why not greps:** the first version pinned `\.icon\.HASH\{…`, which demands the compound sit immediately before the brace — a selector list (`.icon, .covered { …22px box… }`) and a `:where()` suffix BOTH restored the double-ring defect T6 exists to prevent with the gate exiting 0, an `@media`-wrapped bare `.covered` escaped, an ADDED declaration (`min-width:44px` beating `width:22px`) escaped, a DELETED unpinned one (`.current`'s `color`) escaped, hash ownership could migrate to another component, and the bare-state check false-FAILED when an unrelated component legitimately authored `.covered`. **Two further holes closed 2026-09-05 (codex-r1):** (1) **inline styling is invisible to a CSS gate** — Svelte emits `style="…"` and `style:prop` into the JS bundle, never into `dist/_app/*.css`, so an inline 22px bordered box on ItemIcon's button restored the double ring with the gate reporting ALL PASS and all component tests green (reproduced); the gate now scans both components' MARKUP (comments stripped) and rejects `style=` / `style:` / spreads, and both test files assert `hasAttribute('style') === false` on the roots. (2) the **forced-colors rules are pinned in the inventory** and the g2 duplicate/at-rule guard now permits that ONE named at-rule per state rule while still rejecting any other (an `@media (min-width:1px)` override is still caught) — nothing in `npm test` can see the block, and the states still look right in a normal theme with it deleted. The gate's summary now prints the number of assertions that actually ran (`ALL PASS (174 checks)`), so a section that silently skips its checks no longer reads like one that passed them. **Round 2 (codex-r2) closed four more:** (a) the inline-style scan is now a **Svelte-compiler parse with an allowlist**, not a regex — `style = "…"`, uppercase `STYLE=`, the `{style}` shorthand, `--x={…}` CSS-property props, `use:`, `{@attach}`, `bind:this`, spreads and `<svelte:element>` all red, and comment-stripping (which was not syntax-aware — a `//` inside a URL erased the source after it) is gone entirely; (b) **all three** `rules()` parsers now carry the FULL at-rule **ancestry** rather than the innermost, because `@supports (display:grid) { @media (forced-colors:active) { … } }` and an outer `@media (min-width:9999px)` both read as exactly the permitted block and passed — the second silently disabling the a11y treatment; (c) the re-exec resolves `${0:A}` **before** the `cd`, since `$0` is relative in the documented repo-root invocation and re-execing it after the cd looked for `frontend/frontend/scripts/…` and reported `FAILURES (0 checks)`; (d) the count is now **exact** (`EXPECTED_CHECKS`), not merely printed — bump it when adding assertions, which is the intended speed bump — with a cleanup trap, a portable `mktemp` template, a private child sentinel, and `tee`'s status checked. The SVG **root**'s attribute set is now compared exactly too (`fill`, `stroke-linecap`, `stroke-linejoin` were unpinned; dropping `fill="none"` floods the quiz polyline). **Round 3 (codex-r3)** closed the last one: the AST scan enforced only on `RegularElement`/`Component`/`SvelteElement`, so `{@html '<style>.icon{…22px box…}</style>'}` after the button restored the double ring with zero hits, unchanged built CSS and an unchanged check count — and a `<link rel="stylesheet" href="data:…">` passed too, since `link`/`rel`/`href` were all allowed. The walk is now itself a **markup-construct allowlist** (`Fragment`/`Text`/`Comment`/`ExpressionTag`/`RegularElement`/`Component`/`IfBlock`, and an element-tag allowlist), so `HtmlTag`, `RenderTag`, `SlotElement`, an `{#each}`, a `<svelte:head>`, an unreviewed tag, or whatever Svelte adds next all red by default. Also fixed: a seventh ancestry consumer (`definers`) that mixed tuples with `''` and raised `TypeError` — failing closed but losing its diagnostic — and the signal trap, which combined EXIT with INT/TERM and so overwrote `$pipestatus` and deleted the log before they were read, reporting an ordinary failure instead of 130/143. **Round 4 (codex-r4) returned 0 findings in T6's five source/test files** — the extraction, forced-colors treatment, geometry and citations were all confirmed against the reference and the built bundle. Its one remaining note was a limitation rather than a defect, and is now stated in the gate instead of overclaimed by it: this is a check on **declarative** markup, so it cannot see runtime style mutation (an allowed event handler assigning `currentTarget.style.cssText` parses as an ordinary attribute, leaves the CSS inventory untouched, and passes the initial no-style assertions because nothing has fired yet), nor does it traverse an imported component's internals. Closing that would need a rendered-DOM check in a real browser, which this slice does not have. What the gate does guarantee is that neither component styles its DOM declaratively outside its `<style>` block — the actual regression path for the double ring — and that any new markup construct or tag reds for review.

- [ ] **Step 6: Commit.**
```bash
git add src/components/course/ItemMark.svelte src/components/course/ItemIcon.svelte src/lib/types.ts src/tests/ItemMark.svelte.test.ts src/tests/ItemIcon.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T6 — ItemMark primitive + ItemIcon refactor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 7 — T7: SequenceLink row + MiniProjectLink row (after T6)

**Files:**
- Modify: `frontend/src/components/course/SequenceLink.svelte`, `frontend/src/components/course/MiniProjectLink.svelte`
- Create: `frontend/src/tests/SequenceLink.svelte.test.ts` (verified ABSENT — authored from scratch, the 11th new file)
- Extend: `frontend/src/tests/MiniProjectLink.svelte.test.ts` (the one authorised assertion inversion at `:127`)

**Spec:** §4 "SequenceLink row (T7)" + "MiniProjectLink row (T7)" + Enumerated (A)5, (B)19, (C)14.

**Interfaces:**
- Consumes: **T6's `ItemMark` + `ItemMarkState`** (import into both files).
- Produces: the pinned flex rows; the `.row-glyph`/`.chain`/`.badge`/`.count`/`.row-title` classes that **T8a's last-row hairline fix depends on** (`li:last-child :global(.row){border-bottom:0}`).

- [ ] **Step 1: Write/adjust the failing tests.** Create `SequenceLink.svelte.test.ts` (dedicated new file — mount with a sequence + its items, seed nothing router-wise beyond a plain href): the combined `S{order}. {title}` splits into `<span class="badge mono">S{order}</span>` (`classList.contains('mono')`, textContent `S{order}` with **no trailing period**) + `.row-title`; the `✓` node is **gone with no replacement mark** (asserting the `✓` node's absence ALONE is not enough — a `★` in an `{#if covered === total}` passes that, passes an exact `.children` schema, which excludes text nodes, and passes the gate's element-level markup signature; all three were verified green on the mutation in T7 round 4. Pin the row's whole normalised `textContent` instead, and the gate now pins every literal text node keyed by its owning element — completion is the all-covered chain); a non-interactive `ItemMark` chain (`.chain[aria-hidden="true"]`) with the expected **chain length + covered/not-yet state classes**; `<span class="count mono">{covered}/{total}</span>` — exact **text** `{covered}/{total}` (no spaces) **and** `classList.contains('mono')`; the `href`/`total` are **reactive** (`$derived`). Extend `MiniProjectLink.svelte.test.ts`: **invert** the `:127` `textContent === '📋'` assertion → "no `📋`; the flag `ItemMark` is present"; `.row-glyph`/`.row-title` present; `aria-label`/`encodeURIComponent` href preserved.

- [ ] **Step 2: Run — expect FAIL.** `npm test -- "SequenceLink|MiniProjectLink|BlockGroup"`.

- [ ] **Step 3: Implement** per spec §4 T7. SequenceLink: pinned `.row` (ref 1572 `padding:8px 12px`+`gap:10px`, keep `color:var(--text)`, drop `space-between`+`border-radius`, hover `--primary-soft`+`text-decoration:none`), `S{order}` `<span class="badge mono">` (global `.mono`, no period), `.row-title { flex:1 1 auto; min-width:0 }`, `<span class="chain" aria-hidden="true">` of `ItemMark`s + `<span class="count mono">`, remove `✓`, drop `formatProgress` + make `total`/`href` `$derived`, delete orphaned `.progress`/`.check`. MiniProjectLink: author the `<style>` from scratch, preserve script/markup + the `:2-21` comment EXCEPT the `import ItemMark` + `📋`→`<ItemMark type="mini_project"/>` swap; `.row-glyph { display:inline-flex; flex:0 0 auto }` (the T7 dist-anchor), `.row-title { flex:1 1 auto; min-width:0 }`, mirror the SequenceLink `.row`. **Post-review, 2026-09-05 (user rulings on two findings that changed spec-pinned values — see spec §4 T7):** (1) both `.row-title` rules take `flex:1 1 auto`, not `flex:1` — a zero basis collapsed the title to 0px once the chain outgrew the row (~24 items at 760px, ~9 at 340px), and the two rules move together because the gate asserts they are byte-identical; (2) the SequenceLink `<a class="row">` gains a `$derived` `aria-label` — `` `Sequence S${order}: ${title}, ${covered} of ${total} item(s) completed` `` — because with the chain `aria-hidden` the link's computed name was "S3 Determinants 2/3".

- [ ] **Step 4: Run — expect PASS.** `npm test -- "SequenceLink|MiniProjectLink|BlockGroup"`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T7 greps (two component-unique anchors — SequenceLink `.chain`, MiniProjectLink `.row-glyph`): `.row-title` `flex:1 1 auto` (**repinned 2026-09-05** from `flex:1`; the constant is stated in full in section (j) so a revert goes red, and mutation-testing confirmed it goes red both when one row is reverted and when BOTH are — the latter being the case the byte-identical cross-check waves through); `.row:hover` `text-decoration:none`; `.chain` `gap:6px`; both rows' `.row` `padding:8px 12px`+`gap:10px` (ref 1572) under **both** anchors; SequenceLink `.badge` `--primary-soft` hash-coupled to `.chain`; `.count` `font-size:11.5px` hash-coupled to `.chain` (vs the CourseCard `.count` collision). `.row-glyph { flex:0 0 auto }`. **IMPLEMENTED PARSE-BASED, not as greps (2026-09-05, carrying T6's lesson forward):** these two rows share every class name they use — `.row`, `.row:hover`, `.row-title` — so a grep for `.row{…}` cannot say WHICH component it matched, and a selector list or `:where()` suffix walks through a declaration-level regex regardless. Section (j) instead derives each component's hash from its unique anchor (`.chain` / `.row-glyph`, both ownership- and dist-verified, and asserted DISTINCT from each other), then compares the full rule INVENTORY and each rule's DECLARATION SET per component — which disambiguates the shared names by hash and states the pinned set in full. Two extra assertions the greps could not express: both row kinds must declare a **byte-identical** `.row` and `.row-title`, because they are `<li>` siblings in one BlockGroup panel `<ul>` and a drift in either makes the list read as two unrelated lists. The **inline-styling guard was also extended** from T6's two components to all four, with a per-FILE node/tag allowlist so T6 keeps its tight pin (SequenceLink needs `EachBlock`; ItemMark must not silently gain one). The 2026-09-05 `aria-label` is pinned by **unit test only**: the gate grades compiled CSS, and its markup scanner records `tag:class` signatures, so neither lane can see an attribute. Two tests carry it — the whole string at mount, and the string again after a prop change (a non-`$derived` label would freeze exactly as `total`/`covered`/`href` did, and invisibly). Both were mutation-verified, along with the dropped-plural-branch case.

- [ ] **Step 6: Commit.**
```bash
git add src/components/course/SequenceLink.svelte src/components/course/MiniProjectLink.svelte src/tests/SequenceLink.svelte.test.ts src/tests/MiniProjectLink.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T7 — SequenceLink + MiniProjectLink rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 8 — T8a: BlockGroup accordion (after T7)

**Files:**
- Modify: `frontend/src/components/course/BlockGroup.svelte`
- Extend: `frontend/src/tests/BlockGroup.svelte.test.ts` (selector adjustments + new accordion-contract tests)

**Spec:** §4 "BlockGroup accordion (T8a)" + Enumerated (C)12 (keyboard accordion), (B)18 (`B{order}` split).

**Interfaces:**
- Consumes: **T7's row `.row` border** (its `li:last-child :global(.row){border-bottom:0}` fix is inert until T7's row border exists — this is why T7 precedes T8a).
- Produces: the accordion `<button aria-expanded/-controls>` + `role="region"` panel + `.acc`/`.chev`/`.block` geometry.

- [ ] **Step 1: Write the failing tests.** New accordion-contract tests: the header is `<button id aria-expanded aria-controls>`; the panel is `role="region" aria-labelledby={btnId}` and is **always rendered**, collapsed via **`panel.hidden === true`** (property check, NOT DOM-absence); `aria-controls` matches the panel `id` in both states; toggling flips `aria-expanded` + `panel.hidden`; the chevron `.chev` carries `collapsed` iff `aria-expanded === "false"`; **no `.info` element when `block.info_html` is empty** (the retained inner `{#if}`); `B{order}` renders as `<span class="badge mono">` (`classList.contains('mono')`, **no period** — `B1 Vectors` not `B1.`). Adjust the existing `section.block > ul > li` direct-child selectors broken by the panel wrapper.

- [ ] **Step 2: Run — expect FAIL** (and confirm the 2 baseline a11y warnings will drop). `npm test -- BlockGroup`.

- [ ] **Step 3: Implement** per spec §4 T8a. Replace `<header onclick>` with `<header><h2><button class="acc" id={btnId} aria-expanded aria-controls={panelId}>{B-badge}{title}{chevron SVG}</button></h2></header>` + an always-rendered `<div id={panelId} role="region" aria-labelledby={btnId} hidden={!expanded}>` (drop only the **outer** `{#if expanded}`; **retain** the inner `{#if block.info_html}`); `$derived` ids; `header h2 { flex:1; min-width:0 }`; the SVG chevron (`.acc .chev { color:var(--muted); margin-left:auto }`, down=expanded, `.collapsed { transform:rotate(-90deg) }`); `B{order}` `<span class="badge mono">` split (no period); ref-3b `.block` geometry (`margin-bottom:10px`, `background:var(--surface)`, `overflow:hidden`, `padding:0`); header strip; `.info` `color:var(--muted)` + padding; last-row `li:last-child :global(.row){border-bottom:0}`. Delete orphaned `.toggle`; replace the old `header` rule.

- [ ] **Step 4: Run — expect PASS.** `npm test -- BlockGroup` (and `npm run check` shows the 2 a11y warnings gone, none added).

  **Round-3 rulings (2026-09-05), all three folded and spec-amended.** (a) The header/panel separator moves off `header` onto the panel — `[role='region'] { border-top: 1px solid var(--border) }`. Carried on the header it was drawn unconditionally, so a COLLAPSED card (panel `hidden`, i.e. `display:none`) laid it directly on `.block`'s own border with zero gap and drew a 2px bottom edge; ref 1630's collapsed card omits it, ref 1564's expanded one carries it. Pin the **unquoted** `[role=region]` — the minifier strips quotes from a valid identifier. (b) **User ruling:** both row kinds gain `.row:focus-visible { box-shadow: inset 0 0 0 2px var(--primary) }`. This is a T7-surface change made here because T8a's `overflow:hidden` is what clips the global outset ring, and it is gate-checked byte-for-byte across the two rows like `.row`/`.row-title`. (c) **User ruling:** `.info` horizontal padding re-pinned `var(--space-3)` (16px) → **12px**, aligning its text with the row badges in the same panel. Do NOT "restore" any of the three on review — each reads as a tidy-up and each reintroduces a measured defect.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T8a greps (BlockGroup-unique anchor **`.acc`** — NOT `.block`, a 3-way collision): `.block` `padding:0`+`margin-bottom:10px`+`background:var(--surface)`; the header-strip rule; `.acc .chev` `color:var(--muted)`; `.acc .chev.collapsed` `transform:rotate(-90deg)`; the `B{order}` `.badge` `background:var(--primary-soft)` **hash-coupled to `.acc`** (NOT `.block`); source-grep `li:last-child … .row{…border-bottom:0}`. Plus the DOM contract tests (`panel.hidden`, `.info`-absent, chevron `collapsed`, `aria-controls`===`id`).

- [ ] **Step 6: Commit.**
```bash
git add src/components/course/BlockGroup.svelte src/tests/BlockGroup.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T8a — BlockGroup keyboard accordion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Task 9 — T8b: StatusPill + CourseView

**Files:**
- Modify: `frontend/src/components/course/StatusPill.svelte`, `frontend/src/pages/CourseView.svelte`
- Extend: `frontend/src/tests/CourseView.svelte.test.ts` (selector adjustments), `frontend/src/tests/StatusPill.svelte.test.ts` (stays green)

**Spec:** §4 "StatusPill (T8b)" + "CourseView (T8b)" + D6.

**Interfaces:**
- Consumes: T7's MiniProjectLink renders `<StatusPill>` structurally (unstyled until now).
- Produces: the component-scoped pill CSS. No symbol other tasks consume (last task).

- [ ] **Step 1: Write/adjust the failing tests.** StatusPill: always renders a leading `.pill-token` glyph + the class→token `pill-*` class from `LATEST_STATUS_META`; preserve the no-`aria-label` policy (`StatusPill.svelte.test.ts:31` stays green). CourseView: stays green with adjusted selectors (verify-only chrome). **Added by T8a's review:** `CourseView.svelte.test.ts:87-91` asserts the MiniProjectLink anchor exists and contains its title. Before T8a a collapsed panel removed that anchor from the DOM; the panel is now ALWAYS rendered and `textContent` reads through `hidden`, so the assertion can no longer tell "visible" from "permanently hidden". Nothing is unguarded — BlockGroup's own test pins `panel.hidden` — but the assertion no longer means what it looks like it means, so strengthen it here (assert the enclosing `[role="region"]` is not hidden) rather than leaving a test that reads as a visibility check and is not one.

- [ ] **Step 2: Run — expect FAIL** (StatusPill new scoped-CSS assertions) / green where verify-only. `npm test -- "StatusPill|CourseView"`.

- [ ] **Step 3: Implement** per spec §4 T8b. Author StatusPill's `<style>` from scratch (component-scoped, D6): `.pill { display:inline-flex; align-items:center; white-space:nowrap; gap:4px; --radius-pill; 11px/500; padding: 3px 8px /* ref 1112 */ }` + the class→token table (`pill-neutral`/`-info`/`-danger`/`-warning`/`-success` → the `--status-*-bg/-fg` pairs), always a leading `.pill-token`. CourseView: verify-only (already token-based) — confirm the `<h1>`, `← Courses` Button, error/empty `<p>` are token-compliant; adjust test selectors only.

- [ ] **Step 4: Run — expect PASS.** `npm test -- "StatusPill|CourseView"`.

- [ ] **Step 5: Full gate.** Run `zsh frontend/scripts/visual-refresh-gate.sh` — the committed, executable form of every assertion described here (it builds first and grades `dist/_app/*.css`; its header carries the rules for extending it). Add this task's section before running. **Step 5 detail.** T8b greps: the five `pill-*`→token rules (component-scoped, present in dist).

- [ ] **Step 6: Commit.**
```bash
git add src/components/course/StatusPill.svelte src/pages/CourseView.svelte src/tests/StatusPill.svelte.test.ts src/tests/CourseView.svelte.test.ts
git commit -m "feat(frontend): Slice-3 T8b — StatusPill scoped styles + CourseView

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Review** (two-lane). Fix Critical/Important, re-review until clean.

---

## Whole-branch final review

After T8b's per-task review is clean:

- [ ] Run the **full gate** once more on the whole branch: autofixer clean on every edited `.svelte`, `npm test` green, `npm run check` **0 errors** with source warnings **at or below** the 34-warning baseline (T7 removes SequenceLink's 3 `state_referenced_locally`; T8a removes BlockGroup's 2 a11y — per spec §Testing-strategy), `npm run build` green.
- [ ] **End-of-slice manual visual check** against reference screens **2c / 10h / 3b** (the content region — AppHeader is out of scope), walking the D2 reveal state checklist (correct/missed/wrong/neutral, unanswered-correct, multi-partial) and the D4 footer states (mid-course Next, course-flat Finish, unresolved/first-item disabled).
- [ ] **Whole-branch review** on the most capable model (codex@high + first-party@Opus xhigh) over the full `dca0a7b..HEAD` diff. Fix any Critical/Important, re-review until clean.
- [ ] Report completion. **Do NOT push and do NOT merge** — the Slice-3 branch stays local; the redesign lands as a stack (`main ← slice2 ← slice3`) when the whole redesign is done (user decision).
