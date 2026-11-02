# Visual Refresh — Slice 2 (Student Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the visual-refresh design to the three student-facing screens — CourseCard/CourseList (§2b), SequencePlayer sequence chain (§2c), and Login (§2a) — consuming the Slice-1 foundation (tokens + primitives), extending three primitives (Logo login form, Input mono, Button full-width) where §2a requires.

**Architecture:** Pure styling + minimal, well-bounded markup (a progress-bar element, a card footer strip, a segmented duration control) + three additive primitive props (`Logo form`, `Input mono`, `Button full`). No routing, API, or data-model changes. Every colour/metric comes from the Slice-1 tokens in `theme-default.css`; each screen's target is the vendored design authority. **Data honesty is the governing rule: every card maps to real `CourseListItem` fields — no invented status.**

**Tech Stack:** Svelte 5 runes, no JS/CSS deps. Tests via `mount`/`unmount`/`flushSync` from `svelte` (never @testing-library). Vitest + svelte-check + vite build.

**Spec:** `docs/design/visual-refresh/mathion-visual-spec.md` §4 (CourseCard, Sequence chain), §5 (copy/interaction), §6 (Applying-this map) + `reference-screens.dc.html` `#2a`/`#2b`/`#2c` (pixel ground truth). The prose spec's **token names win** over the reference's literal hexes where they differ (the tokens are the white-label surface).

**Branch:** `feat/visual-refresh-slice2-student-core` off `main` (`378a566`).

## Global Constraints

Copied from Slice-1 (bind every task):

- Opus 4.8 @ xhigh for EVERY implementer + reviewer; codex@high for the codex lane. Never downgrade.
- Per-task gate: codex@high + controller first-party verification; fix ALL Critical/Important; re-review after EVERY fix; standing user OK to proceed between gate-clean tasks (zero Critical/Important).
- Svelte 5 runes only; no JS/CSS deps. Validate every `.svelte` edit via the Svelte MCP autofixer.
- Tests use `mount`/`unmount`/`flushSync` from `svelte`, never @testing-library/svelte.
- Colours/metrics come from tokens (no hardcoded hex outside a documented one-off + comment, as with AppHeader's `4px` pill). Per-component one-off geometry MAY be a literal that matches the spec verbatim — but it MUST carry an inline `/* ref <line> */` comment naming the reference, OR, where the branch has no reference counterpart (e.g. the admin-only `.hint`), a comment stating that and naming the scale it matches, OR, for an implementation-mechanics literal (sr-only sizing, focus-ring width), a comment explaining the mechanism. NO opacity-based disabled. NO emoji (glyphs are SVG).
- `git add` exact named paths only (never `-A`/`.`). Commit trailer EXACTLY: `git commit -m "<subj>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. (The trailer string is pinned for continuity with Slice-1's history — do not "correct" it.)
- Verification per task: `npm test` (vitest run, from `frontend/`), `npm run check` (`svelte-check --tsconfig ./tsconfig.json` — it type-checks the `.ts` test files too, since `tsconfig.json` `include` covers `src/**/*.ts`; `strict` + `noUnusedLocals` apply to tests, so a type error or unused import in a test file DOES break the gate; baseline is **0 errors / 36 warnings, exit 0** — keep 0 errors and watch the warning count for new `css_unused_selector` prunes), `npm run build` — all green. Styling tasks also get an agent-browser computed-style/visual check where a screen renders unauthenticated (Login) or behind login (note as pending where auth-gated).
- Feature branch on `main` checkout, NOT a worktree.

### Reconciliation rulings (design authority resolved once, here)

**Progress bar (§4, ref 2046):** track `var(--border-soft)`, fill `var(--primary)`, radius `var(--radius-pill)` (3px), height 4px. (Prose §4 names `--border-soft`; the reference literal `#E9EBEF` is actually `--state-archived-bg`, a stray lifecycle colour — prose token wins.)

**Card footer strip (§4, ref 2052):** `background: var(--surface-3)`, `border-top: 1px solid var(--border-soft)`, `padding: 8px 14px`, `font-size: 12px`, `color: var(--muted)`, `gap: 14px`. (Reference literal `#FAFBFC` → token `--surface-3` `#FCFCFD`.)

**Footer role badge (§4, ref 2054/2079) — semantics corrected:** `font-size: 10.5px; font-weight: 500; letter-spacing: .04em; padding: 2px 6px; border-radius: var(--radius-pill)`.
- **ADMIN** = `color: var(--primary); background: var(--primary-soft)`.
- **DRAFT** = `color: var(--state-created-fg); background: var(--state-created-bg)` (`#3D4350` on `#F0F1F4` — byte-identical to reference 2079, and a real lifecycle token, not `--border-soft` misused as a fill).
- **DRAFT shows iff** `course.is_admin && course.version_id !== null && course.version_state === 'created'` — i.e. an admin **enrolled in a draft (unpublished) version**, which is exactly what the reference's third card depicts (bar at 0%, "Start →", DRAFT). Otherwise every admin card shows **ADMIN**. `version_state` is the enrolled version's real state (`student.py:195`, `CourseListItem.version_state: 'created'|'published'|'archived'|null`, `types.ts:20`).

**CourseCard body (§4, ref 2044-2050):** `.body` `padding: 14px; gap: 10px`; card border `1px var(--border-strong)`, `radius var(--radius)`, `background: var(--surface)`, `overflow: hidden`. Title `<h3 class="title">` overridden to `14.5px/600`, `line-height: 1.3`, `color: var(--text)` (base `h3` is 14px/600 with `margin: 0`, `base.css:18` — a two-property override, not structural, no margin reset needed). Count `mono 11.5px var(--muted)`. CTA `12.5px/500 var(--primary)`.

**Count text (ref 2048/2073) — three-way, matching all three reference cards:** `course.total_items === 0 ? 'No items' : course.covered_items === 0 ? 'Not started' : \`${course.covered_items}/${course.total_items} items\``. Reference card 3 (the DRAFT card, `covered_items === 0`, `total_items > 0`) reads **"Not started"** — NOT "0/N items"; only cards with progress show `"14/22 items"` (ref 2048, no spaces — this is why `formatProgress`'s `"14 / 22"` is unusable). Bar fill: `course.total_items > 0 ? Math.round(course.covered_items / course.total_items * 100) : 0` percent. CTA text: `course.covered_items > 0 ? 'Continue →' : 'Start →'`.

**Heading + link semantics (must preserve — current CourseCard.svelte):** every variant keeps an `<h3 class="title">`. The two admin variants wrap the title text in `<a class="title-link">` (so screen-reader heading navigation lands on a link, per the documented reason at CourseCard.svelte:41-45). The pure-student variant's `<h3>` is plain text inside the card-level `<a>` (nesting an anchor inside the card link is illegal HTML). Preserve every existing `href`/`navigate`/`aria-label`.

**Three variants → real data (student.py `my_courses` verified):**
- **Pure student** (`!course.is_admin`): whole card is `<a class="card card-link">`. Body: `<h3>` title (plain) + progress bar + count/CTA (CTA a plain `<span>` — no nested anchor). Footer: enrolment status from real data — `{course.is_active ? 'Enrolled' : 'Past enrolment'}` (muted text, no badge). *(Reference shows "Enrolled · Autumn 2026"; there is NO enrolment-term data in the backend, so the term half is omitted — but `is_active` IS real, so it fills the strip honestly and keeps footer parity across the grid.)* The whole-card `<a>` accumulates an accessible name of "title + count + CTA + status"; accepted (the visible text IS the name), documented like the radiogroup double-announce below rather than adding an `aria-label`.
- **Mixed admin** (`course.is_admin && course.version_id !== null`): `<div class="card">` (two destinations — can't nest anchors). Body: `<h3>` title wrapped in `.title-link` → student view + progress bar + count row whose **CTA is a real `<a>` → student view**. Footer: `Edit`, `Runs` anchors + right badge (`DRAFT` if `version_state === 'created'`, else `ADMIN`).
- **Admin-only** (`course.is_admin && course.version_id === null`): `<div class="card">`. This row is emitted for a course the user **administers but is not enrolled in** (`student.py:202-211`; `total_items`/`covered_items`/`is_active` all default to 0/0/False, `schemas.py:316-318`) — and also for an admin whose only enrolment is on a `is_disabled` version, which `student.py:165-166` skips so the course falls through to the admin-only loop. The course **may well have a published version** — this row simply carries no version/progress data. Body: `<h3>` title wrapped in `.title-link` → **editor** + a muted `Not enrolled` line (**NO progress bar**, **NO "No published version"** — that claim is unfounded). Footer: `Edit`, `Runs` + `ADMIN` badge.
- The bar + count row render only in the two `version_id !== null` branches (pure-student, mixed-admin); admin-only shows neither.

**Enrolled count (§2b header, ref 2040):** `const enrolledCount = $derived(courses.filter((c) => c.version_id !== null && c.is_active).length)`, rendered `mono 12px var(--muted)` only when `> 0`. **Ruling:** counts **current** enrolments — `version_id !== null` excludes admin-only rows (not enrolments), and `is_active` excludes past enrolments, so the header ("N enrolled") never disagrees with a card whose footer reads "Past enrolment". `courses.length` would over-count — catastrophically for a superuser, who gets an admin-only row for every course in the deployment (`student.py:148-149`). (`my_courses` has no `is_active` filter — only an `is_active.desc()` ordering, `student.py:158` — so inactive rows do reach the client and the filter is live.) **Admin cards intentionally omit any enrolment-status line** — the right edge of their footer belongs to the ADMIN/DRAFT role badge, and the header count is the source of truth for current enrolments; only the pure-student footer surfaces `is_active` (an admin viewing a course they manage doesn't need a student-enrolment signal, so an inactive mixed-admin enrolment is simply not counted and carries no "Past enrolment" line).

**Sequence chain (§2c, ref 2112):** gap `6px` (documented literal — no `--space` token is 6px; `--space-1`=4px, `--space-2`=8px). Counter = `mono 11.5px var(--muted)`, `margin-left: auto`. **§2c breadth explicitly DEFERRED** to a later SequencePlayer-focused pass: the breadcrumb row restyle, the item `<h2>` size (base 15px vs reference 16px), and the strip's `padding-bottom:14px; margin-bottom:20px` are NOT in this slice. Slice-2 §2c scope = the two rules §4 names (6px gap + mono counter). §5.7 (no `page`/`video` type strings) is already satisfied in the player and is not re-opened.

**Login §2a (ref 1986-2013):**
- **Card**: `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-lg)` (8px), `padding: 28px`, `width: 100%; max-width: 380px` (reference 1987 is a fixed 380px; `max-width` is a deliberate responsive improvement), centered; card shadow `0 1px 2px rgba(20,24,35,.06)` is a documented one-off literal (no `--shadow` token — matches reference 1987 verbatim). Heading spacing `.card h1 { margin-bottom: 6px }` (ref 1992). *(This 6px sits above the subtitle on the two subtitled branches; on the subtitle-less `email`/`undefined` branches it sits above the form/spinner — still an improvement over today's 0px, recorded as a design-confirmation item.)*
- **Logo**: a NEW `form="login"` variant on `Logo.svelte` (28×28, `viewBox="0 0 32 32"`, stroke-width 4 — reference 1989). Slice-1 shipped only the header form (26×19.2, cropped viewBox, stroke 3.6) and its own header comment (Logo.svelte:8-11) states the login form is added by the consuming slice — this slice. The full-square login viewBox is centred on (16,16) and needs NO `translateY` nudge (that nudge is specific to AppHeader's cropped header form).
- **PIN field mono**: a NEW `mono` prop on `Input.svelte` (`font-family: var(--font-mono); font-size: 17px; letter-spacing: .34em` — reference 1997). The reference caption for §2a literally names "monospace PIN field"; §1 states "IBM Plex Mono for every numeral". Scoped CSS in Login cannot reach inside `Input.svelte`, so this MUST be a prop. Applied to the PIN `Input` in BOTH branches (the `send_pin_enabled === false` combined form and the `step === 'pin'` step). The email `Input` stays default.
- **Segmented duration** (replaces BOTH `<select>` occurrences, DRY via one `{#snippet}`): `role="radiogroup"` + native radios (an a11y upgrade — arrow-key traversal). `.segment { position: relative }` (the visually-hidden radio is `position:absolute` and needs a positioned ancestor, else it escapes to the initial containing block and focus scroll-jumps). Segment focus ring = `inset 0 0 0 2px var(--primary)` (**not** `--primary-soft` — the selected segment's background IS `--primary-soft`, so a soft ring is invisible). The global `:focus-visible` rule (`base.css:21-25`) sets `outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-soft)` — so the visually-hidden radio would itself paint a stray glow; suppress it with `.segment input:focus-visible { box-shadow: none }`. Segment cell padding = `var(--btn-pad-segment)` (the purpose-built token, theme:53). Iterate `const DURATIONS = [1, 7, 30] as const` (a bare `[1,7,30]` infers `number[]`, widening the loop variable `d` to `number`; `as const` keeps the segment values narrow and self-documenting, matching the explicitly-annotated `duration = $state<1|7|30>(7)`. `duration` itself stays `1|7|30` either way — its annotation is explicit and `bind:group` types as `any` under svelte2tsx — so this is hygiene, not a compile fix).
- **Pin-step actions**: the primary "Sign in" Button fills the row (via the new `Button full` prop — scoped CSS cannot reach a child component's root to flex it) and centres its label; Back stays compact (reference 2010-2012). Only the pin step gets `full` — it shares its row with Back (the reference's two-button row); the `send_pin_enabled === false` combined form's lone primary stays default-width. No `.actions > :first-child` rule is added (it would target Button's root across the component boundary, be pruned as unused CSS, and raise the warning count).
- **Subtitle** (ref 1993): `.subtitle { font-size: 13px; line-height: 1.5; margin: 0 0 20px }`.
- **FormRow / Input internal metrics** (label→field gap 6px ref 1994; field-row bottom margins 18/22px ref 1994/2001; PIN focused `border:1.5px` ref 1996) are **Slice-1 primitive geometry — recorded, not re-opened** in this slice.
- **Copy**: the existing single `<h1>Sign in</h1>` is preserved across all steps (reference §2a shows "Enter your PIN", but the current app uses one heading and §5 lists no copy change here — recorded, not changed).
- **a11y name**: the radiogroup carries `aria-label="Stay signed in for"`; the FormRow's visible `<label>` (no `for`, not programmatically associated) duplicates it. Kept as-is — a named radiogroup with a minor double-announce beats an unnamed one.

**Type-scale / global rulings:**
- **Page `<h1>`** stays at the base scale (`base.css:16` declares `h1 { font-size: 21px; margin: 0 }` — the handoff's own authority; the reference mockups' 19px is drift, not a requirement). Per-page h1 overrides would fragment the scale. (Design-confirmation item, not a code change.)
- **Mono usage**: numerals use `var(--font-mono)` via scoped component rules. Note: `Input`'s `mono` modifier class also matches the global `.mono` utility (`base.css:10`) — harmless, since both resolve the same `--font-mono` and the scoped `.input.mono` adds the size/letter-spacing.
- **Token-over-literal**: where §4 prose names a token and the reference shows a raw hex, the token wins.
- **Ghost-button padding**: the reference's Back `padding:10px 14px` (ref 2011) is **rejected drift** — spec §4 (l.154-157) declares control paddings final (`ghost` = `--btn-pad-sm`, "do not reintroduce roomier defaults"). Same prose-wins call as the 21px h1; do not roomier-ify Button in a later slice.

**Spacing reconciliation (ref-exact where a token fits, documented literal otherwise):**
- CourseList: page-head `margin-bottom: var(--space-3)` (16px, ref 2038 — was `--space-4`/24px), `gap: 12px` (literal, ref 2038). Grid `gap: 12px` (literal, ref 2042 — was `--space-3`/16px; the responsive `auto-fill` columns are kept over the reference's fixed `repeat(3,1fr)`). `.page { padding: var(--space-3) }` (16px) is kept — the reference's 20px content padding is within design-confirmation tolerance and no 20px token exists.
- Login: outer `padding: var(--space-6) var(--space-3)` (48/16 — reference 56px vertical is within design-confirmation tolerance). Brand lockup `margin-bottom: 20px` (ref 1988); `.wordmark` `font-size: 15px` (ref 1990 — the login lockup runs one step larger than AppHeader's 14px header lockup).

---

## File Structure

- Modify: `frontend/src/components/course/CourseCard.svelte` — §2b card: full three-branch restyle. (Task 1)
- Modify: `frontend/src/pages/CourseList.svelte` — §2b container: header enrolled-count + spacing. (Task 2)
- Test: `frontend/src/tests/CourseList.svelte.test.ts` — `courseStub` factory + card-variant + header-count cases. (Tasks 1-2)
- Modify: `frontend/src/pages/SequencePlayer.svelte` — §2c chain: gap 6px, counter mono 11.5px (`<style>`-only; no new test — see Task 3). (Task 3)
- Modify: `frontend/src/components/ui/Logo.svelte` — additive `form: 'header' | 'login'` prop. (Task 4)
- Modify: `frontend/src/components/ui/Input.svelte` — additive `mono` boolean prop. (Task 4)
- Modify: `frontend/src/components/ui/Button.svelte` — additive `full` boolean prop. (Task 4)
- Test: `frontend/src/tests/Logo.svelte.test.ts` + `frontend/src/tests/Input.svelte.test.ts` (both NEW — neither exists yet) + `frontend/src/tests/Button.svelte.test.ts` (**EXISTS from Slice-1 — 5 `it` blocks / 9 cases + a `render()` helper — MODIFY, add the `full` cases; do not overwrite**). (Task 4)
- Modify: `frontend/src/pages/Login.svelte` — §2a: centered card + Logo(login) lockup, mono PIN, `<select>` → segmented duration, full-width primary. (Task 5)
- Modify: `frontend/src/tests/Login.svelte.test.ts` — segmented control + numeric `duration_days` submission + card/Logo present. (Task 5)

Interfaces already available from Slice-1: `ui/Button.svelte` (`variant` primary/ghost…), `ui/Input.svelte`, `ui/FormRow.svelte` (label 12.5px/500 `--text-3`, `<label>` is a sibling — not a wrapper — so no click-forwarding to the radios), `ui/Spinner.svelte`, `ui/Logo.svelte`, `course/ItemIcon.svelte`, `lib/branding.ts` `PRODUCT_NAME` (`'Mathion'`), `lib/router.svelte` `navigate`, `lib/auth.svelte` `verifyPin(email, pin, duration_days: 1|7|30)` → `api.post('/api/auth/verify-pin', {email, pin, duration_days})`, which calls `fetch(path, { …, body: JSON.stringify(body) })` (`api.ts:44,70-76`). `CourseListItem = { course:{id,slug,name,description,is_admin}, version_id:number|null, version_state:'created'|'published'|'archived'|null, covered_items:number, total_items:number, is_active:boolean, is_admin:boolean }`. **`lib/format.ts` `formatProgress` is NOT used by any Slice-2 task** (its `"14 / 22"` output ≠ the reference's `"14/22 items"`; an unused import would fail `noUnusedLocals`, `tsconfig.json:13`; it stays live via `SequenceLink.svelte:3`).

---

## Task 1: CourseCard §2b — three-branch restyle (bar + footer strip)

**Files:**
- Modify: `frontend/src/components/course/CourseCard.svelte`
- Test: `frontend/src/tests/CourseList.svelte.test.ts` (CourseCard renders through CourseList; there is no CourseCard-specific test file, and routing through CourseList is the established pattern)

**Interfaces:**
- Consumes: `CourseListItem`, `navigate`. Tokens: `--border-strong`, `--radius`, `--surface`, `--border-soft`, `--primary`, `--primary-soft`, `--radius-pill`, `--muted`, `--text`, `--surface-3`, `--state-created-fg`, `--state-created-bg`, `--font-mono`. (**Do NOT import `formatProgress`.**)
- Produces: the same three render branches restyled; CTA is a real anchor in mixed-admin, a span in pure-student.

- [ ] **Step 1: Write the failing tests** — add a `courseStub` factory (reused by Task 2) and four card cases to `CourseList.svelte.test.ts`. Harness: `mount(CourseList,{target})`, module-level `fetchSpy` set in `beforeEach`, `settle()`, `target`/`cmp`. Add `import type { CourseListItem } from '../lib/types';` (`import type` — `verbatimModuleSyntax`). `seed()` **returns the host node** so each `it()` queries a non-null local — the module-level `target: HTMLDivElement | null` does not narrow across the helper boundary, and `npm run check` DOES type-check `.ts` tests (`--tsconfig` + `include: src/**/*.ts`), so a null-`target` deref would fail the 0-error gate. Keep each stub's `course.id` unique (CourseList keys `{#each courses as c (c.course.id)}`, CourseList.svelte:31 — duplicate keys throw); the factory syncs `course.is_admin` with the top-level flag to match real backend rows.

```ts
import type { CourseListItem } from '../lib/types';

function courseStub(id: number, over: Partial<CourseListItem> = {}): CourseListItem {
  const isAdmin = over.is_admin ?? false;
  return {
    course: { id, slug: `c${id}`, name: `Course ${id}`, description: '', is_admin: isAdmin },
    version_id: id, version_state: 'published',
    covered_items: 0, total_items: 10, is_active: true, is_admin: isAdmin,
    ...over,
  };
}
function seed(rows: CourseListItem[]): HTMLDivElement {
  fetchSpy.mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve(rows),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
  const host = document.createElement('div'); document.body.appendChild(host);
  target = host; cmp = mount(CourseList, { target: host });
  return host;
}

it('§2b pure-student: progress bar + mono count + honest footer, no nested anchor', async () => {
  const t = seed([courseStub(1, { covered_items: 14, total_items: 22 })]);
  await settle();
  const bar = t.querySelector('.bar-fill') as HTMLElement;
  expect(bar).not.toBeNull();
  expect(bar.style.width).toBe('64%');
  expect((t.querySelector('.count') as HTMLElement).textContent?.trim()).toBe('14/22 items');
  expect((t.querySelector('.footer') as HTMLElement).textContent?.trim()).toBe('Enrolled');
  expect(t.querySelectorAll('a a').length).toBe(0);              // no anchor nested in the card link
});

it('§2b mixed-admin (published): bar + ADMIN badge + Continue is a real anchor', async () => {
  const t = seed([courseStub(2, { is_admin: true, covered_items: 3, total_items: 12 })]);
  await settle();
  expect(t.querySelector('.bar-fill')).not.toBeNull();
  expect((t.querySelector('.badge-admin') as HTMLElement).textContent?.trim()).toBe('ADMIN');
  const cta = t.querySelector('.cta') as HTMLAnchorElement;
  expect(cta.tagName).toBe('A');
  expect(cta.getAttribute('href')).toBe('/courses/c2');
  expect(cta.textContent?.trim()).toBe('Continue →');
  expect(t.querySelector('.footer a[aria-label="Edit Course 2"]')).not.toBeNull();
});

it('§2b mixed-admin (draft): DRAFT badge + "Not started" when created & unstarted', async () => {
  const t = seed([courseStub(3, { is_admin: true, version_state: 'created', covered_items: 0, total_items: 8 })]);
  await settle();
  expect((t.querySelector('.badge-draft') as HTMLElement).textContent?.trim()).toBe('DRAFT');
  expect(t.querySelector('.badge-admin')).toBeNull();
  expect((t.querySelector('.count') as HTMLElement).textContent?.trim()).toBe('Not started');
  expect((t.querySelector('.cta') as HTMLElement).textContent?.trim()).toBe('Start →');
});

it('§2b admin-only (version_id null): no bar, ADMIN badge, honest "Not enrolled"', async () => {
  const t = seed([courseStub(4, { is_admin: true, version_id: null, version_state: null, total_items: 0, is_active: false })]);
  await settle();
  expect(t.querySelector('.bar')).toBeNull();
  expect(t.textContent).not.toContain('No published version');
  expect((t.querySelector('.hint') as HTMLElement).textContent?.trim()).toBe('Not enrolled');
  expect((t.querySelector('.badge-admin') as HTMLElement).textContent?.trim()).toBe('ADMIN');
  expect(t.querySelector('.footer a[href="/courses/c4/edit"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run it — verify RED**

Run: `npm test -- CourseList` → FAIL (no `.bar-fill`/`.count`/`.footer`/`.badge-admin` yet).

- [ ] **Step 3: Implement the restyle** — replace the whole component with the three-branch target below. Two `{#snippet}`s (`bar`, `adminFooter`) keep it DRY; the CTA is an anchor in mixed-admin and a span in pure-student; every variant keeps `<h3 class="title">`; body/footer wrappers are `<div>` (flow content — an `<h3>` inside a `<span>` violates the content model).

```svelte
<script lang="ts">
  import type { CourseListItem } from '../../lib/types';
  import { navigate } from '../../lib/router.svelte';
  let { course }: { course: CourseListItem } = $props();
  // $derived keeps these reactive if `course` props update (e.g. after a list refetch).
  const adminOnly = $derived(course.is_admin && course.version_id === null);
  const studentHref = $derived(`/courses/${course.course.slug}`);
  const editHref = $derived(`/courses/${course.course.slug}/edit`);
  const runsHref = $derived(`/courses/${course.course.slug}/runs`);
  const pct = $derived(course.total_items > 0 ? Math.round((course.covered_items / course.total_items) * 100) : 0);
  const countText = $derived(
    course.total_items === 0 ? 'No items'
    : course.covered_items === 0 ? 'Not started'
    : `${course.covered_items}/${course.total_items} items`
  );
  const ctaText = $derived(course.covered_items > 0 ? 'Continue →' : 'Start →');
  // DRAFT = an admin enrolled in an unpublished (created) version — a real version_state.
  const isDraft = $derived(course.is_admin && course.version_id !== null && course.version_state === 'created');
</script>

{#snippet bar()}
  <span class="bar" aria-hidden="true"><span class="bar-fill" style="width:{pct}%"></span></span>
{/snippet}

{#snippet adminFooter()}
  <div class="footer">
    <a class="foot-link" href={editHref}
       onclick={(e) => { e.preventDefault(); navigate(editHref); }}
       aria-label={`Edit ${course.course.name}`}>Edit</a>
    <a class="foot-link" href={runsHref}
       onclick={(e) => { e.preventDefault(); navigate(runsHref); }}
       aria-label={`Runs for ${course.course.name}`}>Runs</a>
    {#if isDraft}
      <span class="badge-draft">DRAFT</span>
    {:else}
      <span class="badge-admin">ADMIN</span>
    {/if}
  </div>
{/snippet}

{#if adminOnly}
  <!-- Admin of a course they are NOT enrolled in (also covers an admin whose only
       enrolment is on a disabled version — student.py:165-166): no progress data exists. -->
  <div class="card">
    <div class="body">
      <h3 class="title"><a class="title-link" href={editHref}
        onclick={(e) => { e.preventDefault(); navigate(editHref); }}>{course.course.name}</a></h3>
      <span class="hint">Not enrolled</span>
    </div>
    {@render adminFooter()}
  </div>
{:else if course.is_admin}
  <!-- Mixed (admin + enrolled): two destinations, so the card is a <div> and the
       CTA is a real anchor (a plain <span> here would delete the Continue link). -->
  <div class="card">
    <div class="body">
      <h3 class="title"><a class="title-link" href={studentHref}
        onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>{course.course.name}</a></h3>
      {@render bar()}
      <span class="meta">
        <span class="count">{countText}</span>
        <a class="cta" href={studentHref}
           onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>{ctaText}</a>
      </span>
    </div>
    {@render adminFooter()}
  </div>
{:else}
  <!-- Pure student: the whole card is the link (no nested anchors inside). -->
  <a class="card card-link" href={studentHref}
     onclick={(e) => { e.preventDefault(); navigate(studentHref); }}>
    <div class="body">
      <h3 class="title">{course.course.name}</h3>
      {@render bar()}
      <span class="meta">
        <span class="count">{countText}</span>
        <span class="cta">{ctaText}</span>
      </span>
    </div>
    <div class="footer footer-status">{course.is_active ? 'Enrolled' : 'Past enrolment'}</div>
  </a>
{/if}

<style>
  .card { display: block; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); overflow: hidden; color: var(--text); }
  /* Svelte scopes `.card-link` to `.card-link.svelte-<hash>` (0,2,0), which
     already outranks the global `a:hover` (0,1,1, base.css:13) — so the card
     text does not underline on hover; no extra hover override is needed. */
  .card-link { text-decoration: none; }
  .card-link:hover { border-color: var(--primary); }
  .body { padding: 14px; /* ref 2044 */ display: flex; flex-direction: column; gap: 10px; /* ref 2044 */ }
  .title { font-size: 14.5px; /* ref 2045 */ font-weight: 600; line-height: 1.3; color: var(--text); }
  .title-link { color: inherit; text-decoration: none; }
  .title-link:hover { text-decoration: underline; }
  .hint { font-size: 12px; /* no ref card for the admin-only branch — matches the 12px footer/secondary scale */ color: var(--muted); }
  .bar { display: block; height: 4px; /* ref 2046 */ background: var(--border-soft); border-radius: var(--radius-pill); overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: var(--primary); }
  .meta { display: flex; align-items: baseline; justify-content: space-between; }
  .count { font-family: var(--font-mono); font-size: 11.5px; /* ref 2048 */ color: var(--muted); }
  .cta { font-size: 12.5px; /* ref 2049 */ font-weight: 500; color: var(--primary); text-decoration: none; }
  .cta:hover { text-decoration: underline; }
  .footer { display: flex; gap: 14px; /* ref 2052 */ padding: 8px 14px; /* ref 2052 */ border-top: 1px solid var(--border-soft); background: var(--surface-3); font-size: 12px; color: var(--muted); }
  .foot-link { color: var(--muted); text-decoration: none; }
  .foot-link:hover { color: var(--primary); }
  .badge-admin, .badge-draft { margin-left: auto; font-size: 10.5px; /* ref 2054 */ font-weight: 500; letter-spacing: .04em; padding: 2px 6px; border-radius: var(--radius-pill); }
  .badge-admin { color: var(--primary); background: var(--primary-soft); }
  .badge-draft { color: var(--state-created-fg); background: var(--state-created-bg); }
</style>
```

(`.footer-status` carries no own rule — it is the pure-student footer's single status string plus a stable test hook; the base `.footer` styling suffices.)

- [ ] **Step 4: Run tests + check + build + Svelte MCP autofixer**

Run: `npm test -- CourseList` (green), `npm test` (full, green), `npm run check` (0 errors — the removed `formatProgress` import must not leave a dead import in `CourseCard.svelte`; warning count stays 36), `npm run build` (OK), autofixer on `CourseCard.svelte` (clean).

- [ ] **Step 5: Visual check** — agent-browser is auth-gated for `/courses`; note the computed-style check as pending the full visual pass. Verify statically that `.bar-fill` width binds and tokens resolve.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/course/CourseCard.svelte frontend/src/tests/CourseList.svelte.test.ts
git commit -m "feat(frontend): refresh CourseCard — three-branch bar + footer strip (§2b)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CourseList §2b — header enrolled-count + spacing

**Files:**
- Modify: `frontend/src/pages/CourseList.svelte`
- Test: `frontend/src/tests/CourseList.svelte.test.ts`

**Interfaces:** Consumes `courses` (filters `version_id !== null && is_active`). Tokens `--font-mono`, `--muted`, `--space-3`. Reuses `courseStub`/`seed` from Task 1.

- [ ] **Step 1: Write the failing test** — seed 3 active enrolments + 1 admin-only + 1 inactive enrolment; assert the count EXCLUDES both the admin-only and the past-enrolment rows, and that the inactive pure-student card shows the honest "Past enrolment" footer:

```ts
it('§2b: mono enrolled-count = current enrolments (excludes admin-only + past)', async () => {
  const t = seed([
    courseStub(1), courseStub(2), courseStub(3),
    courseStub(9, { is_admin: true, version_id: null, version_state: null, total_items: 0, is_active: false }),
    courseStub(8, { is_active: false }),   // past enrolment (has a version_id, but inactive)
  ]);
  await settle();
  expect((t.querySelector('.enrolled') as HTMLElement).textContent?.trim()).toBe('3 enrolled');   // 3 current, not 5 rows
  expect(Array.from(t.querySelectorAll('.footer-status')).map((n) => n.textContent?.trim()))
    .toContain('Past enrolment');                                                                   // is_active:false footer
});
```

- [ ] **Step 2: Run — verify RED** (`npm test -- CourseList` → no `.enrolled`).

- [ ] **Step 3: Implement** — add the derived count, wrap the h1 in a header row, retune spacing:

```svelte
<!-- in <script>, after `error`: -->
const enrolledCount = $derived(courses.filter((c) => c.version_id !== null && c.is_active).length);
```

```svelte
<div class="page-head">
  <h1>Your courses</h1>
  {#if enrolledCount > 0}<span class="enrolled">{enrolledCount} enrolled</span>{/if}
</div>
```

```css
/* replace `.page h1 { margin-bottom: var(--space-4) }` */
.page-head { display: flex; align-items: center; gap: 12px; /* ref 2038 */ margin-bottom: var(--space-3); /* 16px, ref 2038 */ }
.page-head h1 { margin: 0; flex: 1; }
.enrolled { font-family: var(--font-mono); font-size: 12px; /* ref 2040 */ color: var(--muted); }
/* grid gap 16px → 12px (ref 2042); responsive auto-fill columns kept */
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
```

- [ ] **Step 4: Run tests + check + build + autofixer** — all green/clean; confirm the existing `h1.textContent === 'Your courses'` assertion still passes through the `.page-head` wrap.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CourseList.svelte frontend/src/tests/CourseList.svelte.test.ts
git commit -m "feat(frontend): CourseList enrolled-count (current enrolments) + spacing (§2b)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: SequencePlayer §2c — chain gap + mono counter

**Files:**
- Modify: `frontend/src/pages/SequencePlayer.svelte` (`<style>` only)

**Interfaces:** Consumes the existing `sequence.items` + `ItemIcon`. Tokens `--font-mono`, `--muted`, `--border`.

**Why no new test:** this is a CSS-only change (two `<style>` rules; no markup/logic/DOM change). `vite.config.ts` runs `environment: 'jsdom'` with **no `css` option**, so component `<style>` is never injected in this suite — no `getComputedStyle` assertion is possible in ANY task, and no test mounts `SequencePlayer` (only `CourseList`/`Login`/`SequenceAccordion`/primitive harnesses exist). Per the Slice-1 precedent for pure-CSS tasks, verification is: full suite unchanged (no regression) + `npm run check` 0 errors + build + the visual pass. (§2c breadth — breadcrumb, item `<h2>` size, strip padding — is DEFERRED per the Global ruling.)

- [ ] **Step 1: Implement** — change only the `.strip` gap and `.counter` font (markup unchanged):

```css
.strip { display: flex; gap: 6px; /* ref 2112 — no --space token is 6px */ padding: var(--space-2) 0; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.counter { margin-left: auto; font-family: var(--font-mono); font-size: 11.5px; /* ref 2117 */ color: var(--muted); }
```

(Was `gap: var(--space-2)` (8px) and `.counter { color: var(--muted); font-size: 0.875rem; }`.)

- [ ] **Step 2: Validate + verify** — Svelte MCP autofixer on `SequencePlayer.svelte` (clean); `npm test` (full suite unchanged, no regression); `npm run check` (0 errors); `npm run build` (OK).

- [ ] **Step 3: Visual check** — auth-gated screen → note computed-style/visual as pending the full visual pass; confirm statically the two rules resolve to tokens.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SequencePlayer.svelte
git commit -m "feat(frontend): SequencePlayer chain gap + mono counter (§2c)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Primitives — Logo `form` + Input `mono` + Button `full` (for §2a)

**Files:**
- Modify: `frontend/src/components/ui/Logo.svelte`, `frontend/src/components/ui/Input.svelte`, `frontend/src/components/ui/Button.svelte`
- Test: create `frontend/src/tests/Logo.svelte.test.ts` + `frontend/src/tests/Input.svelte.test.ts` (NEW — neither exists); **modify** `frontend/src/tests/Button.svelte.test.ts` (EXISTS from Slice-1 — 5 `it` blocks / 9 cases inside a `describe('Button', …)` block + a `render(props): HTMLButtonElement` helper with its own `afterEach`).

**Interfaces:**
- Produces: `Logo` `form?: 'header' | 'login'` (default `'header'`); `Input` `mono?: boolean` (default `false`); `Button` `full?: boolean` (default `false`). All additive — existing consumers (AppHeader, all current `Input`/`Button` uses) are untouched by the defaults.

- [ ] **Step 1: Write the failing tests** —
  - **Logo & Input (new files):** `import { it, expect } from 'vitest'` + `import { mount, unmount } from 'svelte'` + the component under test (add `describe`/`afterEach` only if you actually write them — an unused import trips `noUnusedLocals`/TS6133 in the editor). `vite.config.ts` sets `globals: false`, hence the explicit vitest import.
  - **Button (modify existing):** add TWO `it` blocks inside the existing `describe('Button', …)` using the file's own `render(props)` helper (which returns the `<button>` element). Do NOT `Write` a new file — that deletes the 9 Slice-1 cases (5 `it` blocks).

```ts
// Logo.svelte.test.ts  (NEW)
import { it, expect } from 'vitest';
import { mount, unmount } from 'svelte';
import Logo from '../components/ui/Logo.svelte';

it('defaults to the header form (26×19.2, stroke 3.6)', () => {
  const t = document.createElement('div'); document.body.appendChild(t);
  const c = mount(Logo, { target: t });
  const svg = t.querySelector('svg')!;
  expect(svg.getAttribute('width')).toBe('26');
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 23.6');
  expect(t.querySelector('.peak-back')!.getAttribute('stroke-width')).toBe('3.6');
  unmount(c);
});
it('form="login" renders the 28px full-square mark (stroke 4)', () => {
  const t = document.createElement('div'); document.body.appendChild(t);
  const c = mount(Logo, { target: t, props: { form: 'login' } });
  const svg = t.querySelector('svg')!;
  expect(svg.getAttribute('width')).toBe('28');
  expect(svg.getAttribute('height')).toBe('28');
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
  expect(t.querySelector('.peak-front')!.getAttribute('stroke-width')).toBe('4');
  unmount(c);
});

// Input.svelte.test.ts  (NEW)
import { it, expect } from 'vitest';
import { mount, unmount } from 'svelte';
import Input from '../components/ui/Input.svelte';

it('mono adds the mono class; default does not', () => {
  const t = document.createElement('div'); document.body.appendChild(t);
  const c = mount(Input, { target: t, props: { mono: true } });
  expect(t.querySelector('input')!.classList.contains('mono')).toBe(true);
  unmount(c);
  const t2 = document.createElement('div'); document.body.appendChild(t2);
  const c2 = mount(Input, { target: t2 });
  expect(t2.querySelector('input')!.classList.contains('mono')).toBe(false);
  unmount(c2);
});

// Button.svelte.test.ts  (MODIFY — add inside the existing describe('Button', …), using render();
// ONE render() per test — the helper reassigns the module-level host/component, so afterEach
// only cleans up the last render; two renders in one it() would leak the first mount.)
it('full adds the full class', () => {
  expect(render({ full: true }).classList.contains('full')).toBe(true);
});
it('omits the full class by default', () => {
  expect(render({}).classList.contains('full')).toBe(false);
});
```

- [ ] **Step 2: Run — verify RED** (`npm test -- Logo Input Button` → login attrs wrong / no `.mono` / no `.full`; the existing Button cases stay green. Of the 5 NEW `it` blocks, THREE are RED: `full adds the full class` (Button), Logo's `form="login" renders the 28px full-square mark`, and Input's `mono adds the mono class; default does not` (a mixed block whose positive half fails — current `Input.svelte` emits only `class="input"`/`class:error`, so `contains('mono')` is false). The other TWO are GREEN negative controls **by design, not failures** — Button's `omits the full class by default` (`render({}).classList.contains('full')` is already false pre-implementation) and Logo's `defaults to the header form` (today's `Logo.svelte` already renders `26` / `0 0 32 23.6` / stroke `3.6`)).

- [ ] **Step 3: Implement** —

`Logo.svelte` — parameterise the four attributes that differ (the path `d` values are identical between forms); keep the provenance + paint-order comments:

```svelte
<script lang="ts">
  // Product logo mark: two overlapping peaks — gold behind, steel blue in front —
  // transcribed from the visual-refresh handoff. Two forms share the same paths and
  // differ only in box + stroke:
  //   'header' = self-contained 26×19.2 mark, ink-cropped viewBox 0 0 32 23.6,
  //              stroke 3.6 (AppHeader nudges it up 4.35px in its lockup).
  //   'login'  = 28px full-square mark, viewBox 0 0 32 32, stroke 4 (reference #2a
  //              line 1989); centred on (16,16) — no nudge.
  // The 'favicon' form (24px reversed on a #3F5C77 tile) is added by the slice that
  // needs it. Peaks are coloured via CSS (SVG presentation attrs can't resolve var()).
  let { form = 'header' }: { form?: 'header' | 'login' } = $props();
  const geom = {
    header: { w: 26, h: 19.2, viewBox: '0 0 32 23.6', stroke: 3.6 },
    login:  { w: 28, h: 28,   viewBox: '0 0 32 32',   stroke: 4 },
  } as const;
  const g = $derived(geom[form]);
</script>

<svg class="logo" width={g.w} height={g.h} viewBox={g.viewBox} fill="none" aria-hidden="true">
  <!-- back peak (gold), drawn first so the front peak paints over it -->
  <path class="peak-back" d="M10.15 21.8 18.25 10.2 28.05 21.8" stroke-width={g.stroke} stroke-linecap="round" stroke-linejoin="round" />
  <!-- front peak (steel blue) -->
  <path class="peak-front" d="M3.95 21.7 10.85 12 19.25 21.7" stroke-width={g.stroke} stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .logo { display: block; }
  .peak-back { stroke: var(--gold); }
  .peak-front { stroke: var(--primary); }
</style>
```

`Input.svelte` — add the `mono` prop + class + rule:

```svelte
<!-- in the $props() destructure, add: -->
    mono = false,
```
```svelte
<!-- on the <input>, add beside class:error -->
  class:mono={mono}
```
```css
/* PIN/code display — IBM Plex Mono, reference #2a line 1997. */
.input.mono { font-family: var(--font-mono); font-size: 17px; letter-spacing: .34em; }
```

`Button.svelte` — add the `full` prop + class + rule:

```svelte
<!-- in the $props() destructure, add: -->
    full = false,
```
```svelte
<!-- on the <button>, add beside data-variant -->
  class:full={full}
```
```css
/* Full-width form primary (e.g. Login §2a "Sign in", ref 2010) — scoped CSS in
   a page can't reach a child component root, so this lives on the Button.
   `flex:1` is inert outside a flex parent and exact inside `.actions` (ref 2010). */
.btn.full { flex: 1; width: 100%; justify-content: center; }
```

- [ ] **Step 4: Run tests + check + build + autofixer** — `npm test` green (incl. the 9 preserved Button cases), `npm run check` 0 errors / 36 warnings, `npm run build` OK, autofixer on all three `.svelte` files clean. Confirm AppHeader still renders (Logo default form unchanged) and existing Button/Input consumers are visually unaffected (defaults off).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Logo.svelte frontend/src/components/ui/Input.svelte frontend/src/components/ui/Button.svelte \
        frontend/src/tests/Logo.svelte.test.ts frontend/src/tests/Input.svelte.test.ts frontend/src/tests/Button.svelte.test.ts
git commit -m "feat(frontend): Logo login form + Input mono + Button full (§2a primitives)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Login §2a — card + Logo lockup + mono PIN + segmented duration

**Files:**
- Modify: `frontend/src/pages/Login.svelte`
- Test: `frontend/src/tests/Login.svelte.test.ts`

**Interfaces:** Consumes `Logo` (`form="login"`), `Input` (`mono`), `Button` (`full`), `PRODUCT_NAME`, `FormRow`, `Spinner`. Tokens `--surface`, `--border`, `--radius-lg`, `--radius`, `--primary`, `--primary-soft`, `--muted`, `--text`, `--space-6`, `--space-3`, `--space-2`, `--btn-pad-segment`. The segmented control replaces BOTH `<select>` occurrences — DRY via one `{#snippet}`.

- [ ] **Step 1: Write the failing test** — reach the combined form via `send_pin_enabled:false`, assert the segmented radiogroup + card + Logo + mono PIN render, then prove selecting 30 submits `duration_days: 30` as a **number** to `/api/auth/verify-pin`. Real harness helpers (`target`/`component`/`settle()`/`jsonResponse`/`vi.stubGlobal`/`flushSync`/`setValue`/`submitForm(container)`/`FAKE_USER`/`router`) already exist in `Login.svelte.test.ts`.

```ts
it('§2a: segmented duration in a card+logo; selecting 30 submits numeric duration_days', async () => {
  vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  const calls: Array<[string, RequestInit]> = [];
  const f = vi.fn((url: string, init?: RequestInit) => {
    calls.push([String(url), init ?? {}]);
    if (String(url).includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: false }));
    if (String(url).includes('/api/auth/verify-pin')) return Promise.resolve(jsonResponse(200, { user: FAKE_USER }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();

  expect(target.querySelector('.card')).not.toBeNull();
  expect(target.querySelector('.brand svg')).not.toBeNull();
  expect(target.querySelector('.brand .wordmark')?.textContent).toContain('Mathion');
  expect(target.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(target.querySelector('select')).toBeNull();
  expect(target.querySelector('input[name="pin"]')?.classList.contains('mono')).toBe(true);

  const seg30 = (Array.from(target.querySelectorAll('.segment')) as HTMLElement[])
    .find((s) => (s.textContent ?? '').includes('30'))!;
  (seg30.querySelector('input') as HTMLInputElement).click();
  flushSync();
  expect(seg30.classList.contains('selected')).toBe(true);

  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  setValue(target.querySelector('input[name="pin"]')!, '123456');
  submitForm(target);           // helper takes the CONTAINER and finds the form itself
  await settle();

  const verify = calls.find(([u]) => u.includes('/api/auth/verify-pin'))!;
  const body = JSON.parse(String(verify[1].body));
  expect(body.duration_days).toBe(30);
  expect(typeof body.duration_days).toBe('number');
});
```

- [ ] **Step 2: Run — verify RED** (`npm test -- Login` → no `[role="radiogroup"]`/`.card`; `<select>` still present). The EXISTING Login tests never touch the duration control (no `select`/`option`/`duration` reference in `Login.svelte.test.ts`), so the swap is safe — nothing to migrate; record this rather than searching for a migration.

- [ ] **Step 3: Implement** — replace the whole file with the post-edit template below. Changes vs today: (a) `Logo`/`PRODUCT_NAME` imports + `DURATIONS`; (b) wrap the existing `<h1>` + `{#if}` chain in `.login > .card` with the Logo(login) lockup; (c) both `<select>` FormRows → `{@render durationField()}`; (d) both PIN `Input`s → `mono`; (e) pin-step primary → `<Button full>`; (f) new card/brand/segmented styles, `select {…}` rule deleted, `.subtitle` reconciled. Every branch of the `{#if}` chain is shown — do not elide.

```svelte
<script lang="ts">
  import { requestPin, verifyPin, getAuthConfig } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext, defaultLandingPath } from '../lib/router.svelte';
  import type { User } from '../lib/types';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Logo from '../components/ui/Logo.svelte';
  import { PRODUCT_NAME } from '../lib/branding';

  // Capture + clear the superuser return path SYNCHRONOUSLY at init, before any
  // await — bounds the key's lifetime to this Login mount so an abandoned panel
  // redirect can't hijack a later ordinary login.
  // (Guarded by Login.svelte.test.ts.)
  const returnPath: string | null = (() => {
    const p = sessionStorage.getItem('superuser_return_path');
    if (p !== null) sessionStorage.removeItem('superuser_return_path');
    return p;
  })();

  type Step = 'email' | 'pin';
  let step = $state<Step>('email');
  let email = $state('');
  let pin = $state('');
  let duration = $state<1 | 7 | 30>(7);
  let busy = $state(false);
  let error = $state('');
  // undefined until GET /api/auth/config resolves — render-gate.
  let sendPinEnabled = $state<boolean | undefined>(undefined);
  const DURATIONS = [1, 7, 30] as const;   // `as const` keeps `d: 1|7|30` (bare [1,7,30] widens to number[])

  $effect(() => { void loadConfig(); });

  async function loadConfig(): Promise<void> {
    try { sendPinEnabled = (await getAuthConfig()).send_pin_enabled; }
    catch {
      // Network/5xx — resolve into the standard two-step flow (no infinite
      // spinner; submit re-enables). Production-normal path.
      sendPinEnabled = true;
    }
  }

  function afterLogin(user: User): void {
    if (returnPath !== null) { void navigate(returnPath, { replace: true }); return; }   // precedence over ?next=
    const rawNext = new URLSearchParams(location.search).get('next');
    const fallback = defaultLandingPath(user);
    const dest = (rawNext === null || rawNext === '/') ? fallback : safeNext(rawNext, location.origin, fallback);
    void navigate(dest, { replace: true });
  }

  async function onSubmitEmail(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (sendPinEnabled === undefined) return;   // belt-and-suspenders: no request-pin before config lands
    error = ''; busy = true;
    try { await requestPin(email.trim()); step = 'pin'; }
    catch (err: unknown) { error = err instanceof ApiError ? err.displayMessage : 'Could not send PIN. Try again.'; }
    finally { busy = false; }
  }

  async function onSubmitPin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = ''; busy = true;
    try { afterLogin(await verifyPin(email.trim(), pin.trim(), duration)); }
    catch (err: unknown) { error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.'; }
    finally { busy = false; }
  }
</script>

{#snippet durationField()}
  <FormRow label="Stay signed in for">
    <div class="segmented" role="radiogroup" aria-label="Stay signed in for">
      {#each DURATIONS as d (d)}
        <label class="segment" class:selected={duration === d}>
          <input type="radio" name="duration" value={d} bind:group={duration} />
          {d} {d === 1 ? 'day' : 'days'}
        </label>
      {/each}
    </div>
  </FormRow>
{/snippet}

<div class="login">
  <div class="card">
    <div class="brand"><Logo form="login" /><span class="wordmark">{PRODUCT_NAME}</span></div>
    <h1>Sign in</h1>

    {#if sendPinEnabled === undefined}
      <div class="loading"><Spinner /></div>
    {:else if sendPinEnabled === false}
      <p class="subtitle">Email delivery isn't configured — enter your email and the PIN shown in the server terminal.</p>
      <form onsubmit={onSubmitPin}>
        <FormRow label="Email">
          <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
        </FormRow>
        <FormRow label="PIN" error={error}>
          <Input type="text" mono bind:value={pin} autocomplete="one-time-code" name="pin" />
        </FormRow>
        {@render durationField()}
        <Button type="submit" loading={busy} disabled={!email || pin.length !== 6 || busy}>Sign in</Button>
      </form>
    {:else if step === 'email'}
      <form onsubmit={onSubmitEmail}>
        <FormRow label="Email" error={error}>
          <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
        </FormRow>
        <Button type="submit" loading={busy} disabled={!email || busy}>Send PIN</Button>
      </form>
    {:else}
      <p class="subtitle">If <strong>{email}</strong> is registered, a 6-digit PIN has been sent — check your email (or the server console/outbox in a dev deployment).</p>
      <form onsubmit={onSubmitPin}>
        <FormRow label="PIN" error={error}>
          <Input type="text" mono bind:value={pin} autocomplete="one-time-code" autofocus name="pin" />
        </FormRow>
        {@render durationField()}
        <div class="actions">
          <Button type="submit" full loading={busy} disabled={pin.length !== 6 || busy}>Sign in</Button>
          <Button variant="ghost" onclick={() => { step = 'email'; pin = ''; error = ''; }}>Back</Button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .login { display: flex; justify-content: center; padding: var(--space-6) var(--space-3); }
  .card { width: 100%; max-width: 380px; /* ref 1987 fixed 380 → max-width for responsiveness */ background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px; box-shadow: 0 1px 2px rgba(20, 24, 35, .06); /* ref 1987 — no --shadow token */ }
  .card h1 { margin-bottom: 6px; /* ref 1992 */ }
  .brand { display: flex; align-items: center; gap: var(--space-2); margin-bottom: 20px; /* ref 1988 */ }
  .wordmark { font-size: 15px; /* ref 1990 */ font-weight: 600; letter-spacing: -.01em; color: var(--text); }
  .subtitle { font-size: 13px; /* ref 1993 */ line-height: 1.5; color: var(--muted); margin: 0 0 20px; }
  .segmented { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .segment { position: relative; flex: 1; text-align: center; font-size: 13px; /* ref 2004 */ color: var(--muted); padding: var(--btn-pad-segment); background: var(--surface); cursor: pointer; }
  .segment:not(:first-child) { border-left: 1px solid var(--border); }
  .segment.selected { background: var(--primary-soft); color: var(--text); font-weight: 500; }
  .segment input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: -1px; }        /* visually-hidden radio (sr-only, not a disabled treatment) */
  .segment input:focus-visible { box-shadow: none; }                                                /* suppress the global :focus-visible glow (base.css:21-25) on the hidden radio */
  .segment:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }                 /* --primary: visible on both --surface and the selected --primary-soft */
  .actions { display: flex; align-items: center; gap: 10px; /* ref 2009 */ }
  .loading { display: flex; justify-content: center; padding: var(--space-4); }
</style>
```

- [ ] **Step 4: Run tests + check + build + autofixer** — `npm test` green, `npm run check` 0 errors / 36 warnings (a NEW `css_unused_selector` warning on `.segment:has(...)` would mean the focus ring was pruned — investigate if the count rises), `npm run build` OK, autofixer on `Login.svelte` clean (also confirms `bind:group` compiles inside the snippet and `duration` stays typed `1|7|30`).

- [ ] **Step 5: Visual check** — Login is UNAUTHENTICATED → agent-browser computed-style check: the card renders (max-width 380, `--radius-lg`, `--surface`, shadow), the 28px Logo(login) lockup + wordmark show, the segmented control renders 3 segments with the selected one on `--primary-soft`, **Tab into the control shows a visible `--primary` focus ring on the segment** (screenshot it), the PIN `Input` is monospace and not clipped at 17px/.34em inside the 30px field, and **the pin-step "Sign in" fills the row with its label centred**. Screenshot for the record.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Login.svelte frontend/src/tests/Login.svelte.test.ts
git commit -m "feat(frontend): Login card + logo lockup + mono PIN + segmented duration (§2a)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done-when

- CourseCards show the progress bar + mono count ("Not started" when unstarted, "14/22 items" with progress) + Continue/Start (a real anchor in the mixed-admin variant, a span in the pure-student card), with admin actions in a `--surface-3` footer strip carrying an `ADMIN` or (for an enrolled `version_state==='created'` draft) `DRAFT` badge; the three variants map to real `CourseListItem` data — admin-only rows show no bar and an honest "Not enrolled" (no false "No published version"), pure-student cards show an honest `is_active` enrolment status footer (both branches tested).
- CourseList header shows the mono enrolled-count over `version_id !== null && is_active` (current enrolments; admin-only + past rows excluded — it never disagrees with a **pure-student** card's "Past enrolment" footer; admin cards carry the role badge, not an enrolment-status line).
- SequencePlayer's item chain sits at 6px gap with a mono 11.5px `--muted` counter.
- `Logo` has a `form="login"` variant (28px, stroke 4), `Input` a `mono` prop, and `Button` a `full` prop — all additive; AppHeader + existing inputs/buttons unchanged; the Slice-1 Button tests preserved.
- Login is a centered card with the login Logo lockup, a monospace PIN field, the duration `<select>` replaced by an accessible segmented radiogroup (both occurrences, DRY via one snippet) with a visible `--primary` focus ring, and a full-width pin-step primary; selecting a duration submits it as a numeric `duration_days`.
- Full suite green, `npm run check` 0 errors / 36 warnings, `npm run build` OK. Login visually verified unauthenticated; the authed screens noted pending the full visual pass.
- No new tokens introduced; `--heat-*` + RunProgressTab + the §2c breadth (breadcrumb, item heading, strip padding) remain deferred to the run-management / later SequencePlayer slices.
