# Visual Refresh — Slice 4: Student Remainder (9c + 9d) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Standing user directive for this project (overrides the default above):** the controller implements every task DIRECTLY; subagents are reviewers only (≤4-5 per plan; codex is the main lane, one first-party Opus lane resumed per round).

**Goal:** Restyle the last two student-facing reference screens — the mini-project page (artboard 9c) and the loading / empty / error states (artboard 9d) — by adding three small `ui/` primitives and adopting them on the five student surfaces, with no backend change.

**Architecture:** Three presentational primitives (`Skeleton`, `EmptyState`, `ErrorState`) land first with contract tests; the four smaller student surfaces then swap their ad-hoc loading/empty/error markup for them (plus one new Retry on `CourseList`); the mini-project page is rebuilt in two commits — frame/header/assignment/group/history/fetch-error first, then the submit card with a click-or-drop zone. Every colour is a token, every literal carries its `ref` annotation, and the built CSS is graded by the hash-coupled gate script.

**Tech Stack:** Svelte 5 (runes, snippets), TypeScript strict + `noUnusedLocals`, Vite build, vitest + jsdom with `mount`/`unmount`/`flushSync` (never `@testing-library`), zsh gate script `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-09-06-visual-refresh-slice4-student-remainder-design.md` (rev 5, CONVERGED). The plan argues from the spec; every `§`, `D`, `(A)/(B)/(C)` and `ref NNNN` below points into it or into `docs/design/visual-refresh/reference-screens.dc.html`.

## Global Constraints

Copied from the spec's §Global Constraints; every task implicitly includes them.

1. **Colours → tokens.** No hardcoded hex outside comments. **No new colour tokens.** Substitutions pinned in the spec table and annotated at the pin site: `#E9EBEF` → `var(--border-soft)` (history strip border), `#F0F1F4` → `var(--surface-2)` (PDF badge background). Exact-but-noteworthy: `#EDEFF2` → `var(--border-faint)` (skeleton bars), `#FCFCFD` → `var(--surface-3)` (file tile). Forced-colors system-colour keywords inside `@media (forced-colors: active)` are exempt. This slice **deletes** six pre-existing violations in `MiniProjectDetailPage.svelte`: `var(--warning, inherit)`, `var(--warning, #b85c00)`, `var(--danger, #c33)`, `var(--danger-bg, #fee)`, `var(--info, #ccd)`, `var(--info-bg, #eef)`, and the three `var(--border, #ddd)` fallbacks.
2. **No opacity-based disabled/dim.** Removes `.group-disabled { opacity: 0.7 }`. The visually-hidden file input uses `opacity:0` as the sr-only idiom (`Login.svelte:137`) — annotate it as "sr-only, not a disabled treatment".
3. **No decorative glyphs.** The one new SVG (download arrow) is `aria-hidden="true"`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, `stroke-width="1.6"`, round caps/joins. `LATEST_STATUS_META` glyph tokens stay (C14 carve-out). `SequencePlayer`'s `← Course` loses its `←`.
4. **Mono for every numeral** via the global `.mono` class (`base.css:11`): `Submission {n}`, the history meta line, file sizes, `{score}/100`, the soft-deadline aside, the evaluator date. Carve-out: the main deadline sentence stays sans (its digits are inside `formatRelativeDeadline`'s single string).
5. **Per-component literals — three forms:** (a) `/* ref NNNN */`, (b) no-ref with the scale named, (c) mechanism. Geometry only, never colour.
6. **Button primitive as-is.** No fork; `--btn-pad` stays `4px 10px`.
7. **`ItemMark` untouched.**
8. **No backend/API/route/schema change.**
9. **Commit trailer:** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — **no `Claude-Session` line.** `git add` exact named paths only, never `-A`/`.`. Commit from the repo root.
10. **Review discipline:** codex @ high + first-party Opus xhigh per task; fix every Critical/Important; re-review after EVERY fix until both lanes are clean; explicit user OK before a task is closed. Whole-branch final review at the end, then the user-owned browser pass.

**svelte-check baseline at the Slice-3 tip `22549e2`: 0 errors / 31 warnings.** Warnings must not grow. **Branch:** `feat/visual-refresh-slice4-student-remainder` (already exists, HEAD `799c703` = spec commits). **LOCAL — never push, never merge.**

---

## Conventions (shared by every task — read once)

### Test pattern (repo idiom — never `@testing-library`)

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Component from '../components/ui/Component.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Component, { target: host, props });
  flushSync();                 // flush after mount AND after every state change
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});
```

- **CSS is NOT computable in jsdom.** Assertions about rendered colour/size go to the **gate script** (below), never to `getComputedStyle`. DOM tests assert structure, class membership, text, `aria-*`, and `classList.contains('mono')`.
- **Async settle** in page tests: the file's existing `settle()` helper (12 × `await Promise.resolve()` + `flushSync()` in CourseList/CourseView; 8 × `await tick()` in MiniProjectDetailPage). Reuse it; never add a second one with a different tick count.
- **Snippet props in tests** (ErrorState `action`): pass a snippet built with `createRawSnippet` from `svelte`:
  ```ts
  import { createRawSnippet } from 'svelte';
  const action = createRawSnippet(() => ({ render: () => '<button type="button" class="probe">Go</button>' }));
  ```
  `createRawSnippet` is a public Svelte 5 export; the `render` string must have exactly one root element.

### Per-task gate (ALL must pass before review)

From `frontend/`, in order:

1. **Svelte autofixer** on each edited/created `.svelte` file (MCP `svelte-autofixer`). Re-run until it reports zero `issues` (its `suggestions` about `bind:this` → attachments are NOT applied: `bind:this` is the page's existing pattern).
2. `npm test` — the full suite.
3. `npm run check` — **0 errors, ≤ 31 warnings.**
4. `zsh frontend/scripts/visual-refresh-gate.sh` — it runs `npm run build` itself, then grades `dist/_app/*.css`. **Each task adds its own section to the script (below) and bumps `EXPECTED_CHECKS` by exactly the number of `PASS`/`FAIL` lines it adds** (the count is exact, not a floor). Read the script header before extending it: hash-couple every assertion, prove anchor ownership in source AND dist uniqueness, pair every `none` with a positive on the same anchor, anchor a `none` as `\{([^}]*;)?prop:`, strip comments in source greps, never put an apostrophe inside a `node -e`/`python3 -` payload, and **mutation-test every new assertion** (break the guarded thing, watch it go red, restore).
5. **Mutation checks** listed per task for the DOM tests: delete the named source line, run the named test, confirm it FAILS, restore.

**Gate-script section skeleton** (the helpers `check`, `none`, `d`, `dd` and the `$CSS` array are defined near the top of the script; `d` reads the globals `N` (label) and `H` (the hash **including** the `svelte-` prefix)). **T1 adds one more helper, `chk PREFIX DECL...`**, right after `dd` in the script's helper block — one anchored, order-independent declaration check per DECL against a caller-supplied emitted-selector regex (`d` only builds simple `.a.svelte-H` forms):

```zsh
# chk EMITTED-SELECTOR-REGEX DECL... — one declaration-level check per DECL; the caller
# supplies the full emitted selector (descendant/:has/:where forms), hash already expanded.
chk() { local pre=$1; shift; for decl in "$@"; do check "$N $(plain $pre) { $(plain $decl) }" "${pre}\{([^}]*;)?${decl}[;}]"; done }
```

Every pin below is ONE declaration per check — the script header forbids order-dependent regexes, so two declarations are never joined with `;` inside one regex.

```zsh
echo
echo "--- (q) Slice-4 T1 primitives ---"
# ownership: the anchor is authored as a top-level rule by exactly one file
owners=(${(f)"$(grep -rlE '^[[:space:]]*\.skeleton[[:space:]]*[,{]' src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == 'Skeleton.svelte' ]]; then
  echo "PASS  .skeleton is authored by Skeleton.svelte alone"
else
  echo "FAIL  .skeleton owner is not Skeleton.svelte alone (${#owners[@]}: $owners)"; fail=1
fi
# uniqueness: exactly one hash in dist
sk=(${(f)"$(grep -ohE '\.skeleton\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#sk[@]} -ne 1 ]]; then
  echo "FAIL  .skeleton not dist-unique (${#sk[@]}: $sk)"; fail=1
else
  echo "PASS  .skeleton resolves to one hash ($sk[1])"
  N=Skeleton; H=$sk[1]
  d '\.skeleton' '' 'border:1px solid var\(--border\)' 'padding:12px' 'gap:9px'
fi
```

Emitted selector forms (verified on the current dist; `H` = `svelte-<hash>`):

| authored | emitted (minified) | regex fragment |
|---|---|---|
| `.a { }` | `.a.svelte-H{` | `\.a\.${H}\{` |
| `.a.b { }` | `.a.b.svelte-H{` | `\.a\.b\.${H}\{` |
| `.a .b { }` | `.a.svelte-H .b:where(.svelte-H){` | `\.a\.${H} \.b:where\(\.${H}\)\{` |
| `.a :global(p) { }` | `.a.svelte-H p{` | `\.a\.${H} p\{` |
| `.a input:focus-visible` | `.a.svelte-H input:where(.svelte-H):focus-visible{` | `\.a\.${H} input:where\(\.${H}\):focus-visible\{` |
| `.a:has(input:focus-visible)` | `.a.svelte-H:has(input:where(.svelte-H):focus-visible){` | `\.a\.${H}:has\(input:where\(\.${H}\):focus-visible\)\{` |
| `@media (forced-colors: active) { .a { } }` | `@media (forced-colors:active){.a.svelte-H{…}…}` | `@media \(forced-colors: ?active\)\{(\.[^{]*\{[^}]*\})*\.a\.${H}\{` |

**Anchor collisions known today** (why every regex carries the hash): `.empty-state` ×2 hashes already in dist (RunSubmissionTab, RunAssetsTab), `.pills` ×1 (TeacherRunListPage), `.row` ×10, `.breadcrumb` ×2, `.title-row` ×2 (one is the MP page's own), `.history-entry-header` (MP page's own — its hash **changes** when its style block changes; re-derive at every gate). Prefix collisions: `.drop` vs `.drop-zone`, `.precondition` vs `.precondition-banner` — the `\.drop\.${H}` form already excludes them.

### Review (end of every task, after the gate)

Two lanes in parallel, then fix, then BOTH lanes again until both report 0 Critical / 0 Important:

- **codex @ high** — copy the previous round's script verbatim (template `/tmp/s4-spec-codex-rN.sh` → `s4-tN-codex-rN.sh`): `cd` to the repo root, heredoc `PROMPT`, `codex exec --sandbox read-only -c model_reasoning_effort="high" -c stream_idle_timeout_ms=600000 -c project_doc="./CLAUDE.md" "$PROMPT" < /dev/null`, run via Bash `run_in_background:true` writing to the scratchpad, read the tail after the last `^codex` line.
- **first-party Opus xhigh** — one general-purpose agent, resumed via `SendMessage` each round with the diff range and the spec/plan paths.

Each prompt names: the task's spec sections, the commit SHA(s), the files, the gate output, and asks for Critical/Important/Minor with file:line. Every Minor is either fixed or recorded (in the commit message or a `docs/backlog/` item). **Then wait for the user's explicit OK before starting the next task.**

### Commit (end of every task, from the repo root)

```bash
git add <exact paths listed in the task>          # never -A / .
git commit -m "<type>(frontend): Slice-4 <task> — <summary>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Review fixes are committed as follow-up commits (`fix(frontend): Slice-4 <task> review round N — …`), not amended, so the reviewers can diff the round.

---

## File structure

| file | responsibility | task |
|---|---|---|
| `frontend/src/components/ui/Skeleton.svelte` (new) | static row placeholder card, `role="status"` | T1 |
| `frontend/src/components/ui/EmptyState.svelte` (new) | titled empty card | T1 |
| `frontend/src/components/ui/ErrorState.svelte` (new) | inline (Retry) / page (`<h1>` + action) error card | T1 |
| `frontend/src/tests/{Skeleton,EmptyState,ErrorState}.svelte.test.ts` (new) | contract tests | T1 |
| `frontend/src/pages/CourseList.svelte` | Skeleton / EmptyState / inline ErrorState + `reloadTick` Retry | T2 |
| `frontend/src/pages/CourseView.svelte` | Skeleton(4) / EmptyState / page ErrorState | T2 |
| `frontend/src/pages/SequencePlayer.svelte` | Skeleton / EmptyState / two page ErrorStates | T2 |
| `frontend/src/components/items/QuizItem.svelte` | EmptyState in the empty branch | T2 |
| `frontend/src/tests/{CourseList,CourseView,SequencePlayer,QuizItem}.svelte.test.ts` | selector migrations + new loading/error/Retry tests | T2 |
| `frontend/src/pages/MiniProjectDetailPage.svelte` | frame, header, assignment, group, history, fetch-error, loading | T3 |
| `frontend/src/pages/MiniProjectDetailPage.svelte` | submit card: drop zone, Button, inline ErrorState, precondition | T4 |
| `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` | seam migrations (T3 set, T4 set) + new tests | T3, T4 |
| `docs/backlog/mp-can-submit-null-guard-is-dead.md` (new) | the dead `can_submit !== null` comparison | T3 |
| `frontend/scripts/visual-refresh-gate.sh` | one new section per task, `EXPECTED_CHECKS` bumped | T1-T4 |

---

## Task 1 — T1: the 9d primitives

**Files:**
- Create: `frontend/src/components/ui/Skeleton.svelte`, `frontend/src/components/ui/EmptyState.svelte`, `frontend/src/components/ui/ErrorState.svelte`
- Create: `frontend/src/tests/Skeleton.svelte.test.ts`, `frontend/src/tests/EmptyState.svelte.test.ts`, `frontend/src/tests/ErrorState.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (new section (q), `EXPECTED_CHECKS`)

**Spec:** §1.1-1.4, D2, D7, D9, Constraint 1 table rows for `#EDEFF2`.

**Interfaces:**
- Consumes: `components/ui/Button.svelte` (`variant`, `onclick`, `children`).
- Produces (used by T2-T4):
  - `Skeleton` — props `rows?: number` (default 3), `label?: string` (default `'Loading…'`). Root `div.skeleton[role="status"][aria-live="polite"]`, `rows` × `div.row[aria-hidden="true"]`, each with 3 × `span.bar`.
  - `EmptyState` — prop `title: string`. Root `div.empty-state` > `p.title`.
  - `ErrorState` — props `variant?: 'inline' | 'page'` (default `'inline'`), `title: string`, `message?: string`, `onretry?: () => void` (inline only), `action?: Snippet` (page only). Root `div.error-state.{variant}[role="alert"]`; title is `h1.title` (page) or `p.title` (inline); `p.message` when `message` is truthy; inline Retry is `<Button variant="secondary">` rendering `button.btn.secondary`; page action is `div.action`.

- [ ] **Step 1: Write the three failing test files.**

`frontend/src/tests/Skeleton.svelte.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Skeleton from '../components/ui/Skeleton.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: { rows?: number; label?: string } = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Skeleton, { target: host, props });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('Skeleton (Slice-4 §1.1)', () => {
  it('is a polite status region whose only text is the visually-hidden label', () => {
    const el = render();
    const root = el.querySelector('.skeleton');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('role')).toBe('status');
    expect(root!.getAttribute('aria-live')).toBe('polite');
    const label = root!.querySelector('.sr-only');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('Loading…');
    // The rows carry no text, so the region's text IS the label (trimmed: Svelte
    // keeps single spaces between sibling elements).
    expect(root!.textContent?.trim()).toBe('Loading…');
  });

  it('renders the default 3 rows, each hidden from AT with exactly 3 bars', () => {
    const el = render();
    const rows = el.querySelectorAll('.skeleton .row');
    expect(rows.length).toBe(3);
    rows.forEach((r) => {
      expect(r.getAttribute('aria-hidden')).toBe('true');
      expect(r.querySelectorAll('.bar').length).toBe(3);
      expect(r.querySelectorAll('.bar.end').length).toBe(1);
    });
  });

  it('renders `rows` rows and overrides the label', () => {
    const el = render({ rows: 1, label: 'Fetching courses' });
    expect(el.querySelectorAll('.row').length).toBe(1);
    expect(el.querySelector('.sr-only')!.textContent).toBe('Fetching courses');
  });

  it('cycles the three artboard width triples: row 4 repeats row 1', () => {
    const el = render({ rows: 4 });
    const rows = el.querySelectorAll('.row');
    expect(rows.length).toBe(4);
    const widths = (r: Element) =>
      Array.from(r.querySelectorAll<HTMLElement>('.bar')).map((b) => b.style.width);
    expect(widths(rows[0])).toEqual(['180px', '90px', '64px']);   // ref 1347
    expect(widths(rows[1])).toEqual(['220px', '70px', '64px']);   // ref 1348
    expect(widths(rows[2])).toEqual(['150px', '110px', '64px']);  // ref 1349
    expect(widths(rows[3])).toEqual(widths(rows[0]));
  });
});
```

`frontend/src/tests/EmptyState.svelte.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EmptyState from '../components/ui/EmptyState.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('EmptyState (Slice-4 §1.2)', () => {
  it('renders the title as the only content of the card', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(EmptyState, { target: host, props: { title: 'Nothing here yet.' } });
    flushSync();

    const root = host.querySelector('.empty-state');
    expect(root).not.toBeNull();
    const title = root!.querySelector('p.title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Nothing here yet.');
    // Title-only by decision D2: no hint, icon or action until a consumer needs one.
    expect(root!.children.length).toBe(1);
    expect(root!.textContent?.trim()).toBe('Nothing here yet.');
  });
});
```

`frontend/src/tests/ErrorState.svelte.test.ts`:
```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import ErrorState from '../components/ui/ErrorState.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(ErrorState, { target: host, props });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

const action = createRawSnippet(() => ({
  render: () => '<button type="button" class="probe">Back</button>',
}));

describe('ErrorState (Slice-4 §1.3)', () => {
  it('defaults to the inline variant: role=alert, <p> title, message, no Retry without onretry', () => {
    const el = render({ title: "Couldn't load", message: 'Server said no.' });
    const root = el.querySelector('.error-state');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('role')).toBe('alert');
    expect(root!.classList.contains('inline')).toBe(true);
    expect(root!.classList.contains('page')).toBe(false);
    const title = root!.querySelector('.title');
    expect(title!.tagName).toBe('P');
    expect(title!.textContent).toBe("Couldn't load");
    expect(root!.querySelector('.message')!.textContent).toBe('Server said no.');
    expect(root!.querySelector('.btn')).toBeNull();
  });

  it('omits the message element when no message is given', () => {
    const el = render({ title: 'Sequence not found' });
    expect(el.querySelector('.message')).toBeNull();
    expect(el.querySelector('.title')!.textContent).toBe('Sequence not found');
  });

  it('inline + onretry renders a secondary Retry button that calls it', () => {
    const onretry = vi.fn();
    const el = render({ title: 'x', onretry });
    const btn = el.querySelector<HTMLButtonElement>('.error-state.inline .btn');
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains('secondary')).toBe(true);
    expect(btn!.textContent?.trim()).toBe('Retry');
    btn!.click();
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('page variant: <h1> title (D9), message, action snippet rendered inside .action', () => {
    const el = render({ variant: 'page', title: 'Course not available', message: 'Ask your teacher.', action });
    const root = el.querySelector('.error-state.page');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('role')).toBe('alert');
    const title = root!.querySelector('.title');
    expect(title!.tagName).toBe('H1');
    expect(title!.textContent).toBe('Course not available');
    expect(root!.querySelector('.message')!.textContent).toBe('Ask your teacher.');
    expect(root!.querySelector('.action .probe')).not.toBeNull();
  });

  it('page variant ignores onretry; inline variant ignores action (variant-bound props, D2)', () => {
    const onretry = vi.fn();
    const page = render({ variant: 'page', title: 'x', onretry });
    expect(page.querySelector('.btn')).toBeNull();
    unmount(component!); component = null; host.remove();

    const inline = render({ title: 'x', action });
    expect(inline.querySelector('.action')).toBeNull();
    expect(inline.querySelector('.probe')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them — expect FAIL** (module not found).
```bash
cd frontend && npm test -- Skeleton EmptyState ErrorState
```

- [ ] **Step 3: Create the three components.**

`frontend/src/components/ui/Skeleton.svelte` — verbatim spec §1.1 plus the style block:
```svelte
<script lang="ts">
  // Skeleton — static loading placeholder (artboard 9d, ref 1345-1350).
  // "Loading — skeleton rows, never a spinner" (ref 1345): a placeholder that
  // holds row height, no animation, no shimmer. Presentational only.
  //
  // The three artboard rows, ref 1347/1348/1349, cycling for rows > 3.
  const W: ReadonlyArray<readonly [number, number, number]> = [[180, 90, 64], [220, 70, 64], [150, 110, 64]];
  let { rows = 3, label = 'Loading…' }: { rows?: number; label?: string } = $props();
</script>

<div class="skeleton" role="status" aria-live="polite">
  <span class="sr-only">{label}</span>
  {#each { length: rows }, i}
    <div class="row" aria-hidden="true">
      <span class="bar" style:width="{W[i % 3][0]}px"></span>
      <span class="bar" style:width="{W[i % 3][1]}px"></span>
      <span class="bar end" style:width="{W[i % 3][2]}px"></span>
    </div>
  {/each}
</div>

<style>
  .skeleton {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 12px; /* ref 1346 */
    display: flex;
    flex-direction: column;
    gap: 9px; /* ref 1346 */
  }
  .row { display: flex; align-items: center; gap: 12px; /* ref 1347 */ }
  .bar {
    display: block;
    height: 13px; /* ref 1347 */
    border-radius: 3px; /* ref 1347 — a literal, deliberately NOT var(--radius-pill): that token names status badges, and a placeholder bar is not a badge */
    background: var(--border-faint); /* #EDEFF2 exact — a border token used as a fill: the bar IS a placeholder stroke (spec substitution table) */
  }
  .end { margin-left: auto; }
  /* Visually hidden, reachable by screen readers — the repo 1px-box idiom (MiniProjectDetailPage.svelte .sr-only). */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
```

`frontend/src/components/ui/EmptyState.svelte`:
```svelte
<script lang="ts">
  // EmptyState — titled empty card (artboard 9d, ref 1353-1357). Title-only by
  // decision D2: hint / icon tile / action are added by the first slice that
  // consumes them (Authoring, "No versions yet"). Presentational only.
  let { title }: { title: string } = $props();
</script>

<div class="empty-state"><p class="title">{title}</p></div>

<style>
  .empty-state {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 34px 20px; /* ref 1355 */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px; /* ref 1355 — inert with one child today; kept so the hint/action land in place later */
    text-align: center;
  }
  .title { font-size: 14px; font-weight: 600; /* ref 1357 */ color: var(--text); margin: 0; }
</style>
```

`frontend/src/components/ui/ErrorState.svelte`:
```svelte
<script lang="ts">
  // ErrorState — inline (section-level, optional Retry) or page (heading +
  // action) error card (artboard 9d, ref 1376-1391). `onretry` renders only
  // for `inline`, `action` only for `page`; passing the other is a caller
  // error that is simply not rendered (spec §1.3). The page variant keeps an
  // <h1> so every page it replaces keeps its heading landmark (D9).
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';

  let {
    variant = 'inline',
    title,
    message = undefined,
    onretry = undefined,
    action = undefined,
  }: {
    variant?: 'inline' | 'page';
    title: string;
    message?: string;
    onretry?: () => void;
    action?: Snippet;
  } = $props();
</script>

<div class="error-state {variant}" role="alert">
  <div class="body">
    {#if variant === 'page'}<h1 class="title">{title}</h1>{:else}<p class="title">{title}</p>{/if}
    {#if message}<p class="message">{message}</p>{/if}
  </div>
  {#if variant === 'inline' && onretry}<Button variant="secondary" onclick={onretry}>Retry</Button>{/if}
  {#if variant === 'page' && action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .error-state {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface); /* ref 1376/1386 */
  }
  /* Shared basics only. EVERY metric is qualified by its variant class below:
     an unqualified `.message { font-size }` would let the later rule win at
     equal specificity and leak the page metrics into the inline state. */
  .title { margin: 0; color: var(--text); font-weight: 600; }
  .message { margin: 0; color: var(--muted); }
  .body { display: flex; flex-direction: column; }

  /* inline — ref 1378-1383. `border-left` after the card's `border` shorthand
     replaces the shorthand's left component: the 3px danger rule sits on the
     card's own left edge. */
  .inline { display: flex; align-items: center; gap: 12px; padding: 14px 16px; /* ref 1378 */ border-left: 3px solid var(--danger); }
  .inline .body { gap: 3px; /* ref 1379 */ flex: 1; }
  .inline .title { font-size: 13px; /* ref 1380 */ }
  .inline .message { font-size: 12.5px; /* ref 1381 */ }

  /* page — ref 1388-1391 */
  .page { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 30px 20px; /* ref 1388 */ text-align: center; }
  .page .body { align-items: center; gap: 9px; /* ref 1388 — the root gap cannot separate the body's own children */ }
  .page .title { font-size: 14px; letter-spacing: 0; /* ref 1389 — overrides base.css:17's 21px/-.015em h1 */ }
  .page .message { font-size: 13px; line-height: 1.5; max-width: 46ch; /* ref 1390 */ text-wrap: pretty; }
  .page .action { margin-top: 4px; /* ref 1391 */ }
</style>
```

- [ ] **Step 4: Run the three test files — expect PASS.** `npm test -- Skeleton EmptyState ErrorState`. (The `{#each { length: rows }, i}` form and the `Snippet` prop were compiled clean by the autofixer during planning; if `svelte-check` objects to `style:width="{…}px"`, the equivalent `style:width={`${W[i % 3][0]}px`}` is the fallback.)

- [ ] **Step 5: Mutation checks.** (a) Remove `aria-hidden="true"` from Skeleton's `.row` → the "3 rows" test fails; restore. (b) Change the page-variant `<h1>` to `<p>` → the "page variant" test fails; restore. (c) Drop the `variant === 'inline' &&` guard on Retry → the "variant-bound props" test fails; restore.

- [ ] **Step 6: Gate-script section (q).** Append before the final `# The summary line…` comment; bump `EXPECTED_CHECKS` by the number of PASS/FAIL lines this section prints (count them after a run: ownership 3 + uniqueness 3 + the `d`/`check`/`none` lines below).

```zsh
echo
echo "--- (q) Slice-4 T1 primitives ---"
for pair in "Skeleton:skeleton:Skeleton.svelte" "EmptyState:empty-state:EmptyState.svelte" "ErrorState:error-state:ErrorState.svelte"; do
  N=${pair%%:*}; rest=${pair#*:}; A=${rest%%:*}; F=${rest##*:}
  owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${A}[[:space:]]*[,{]" src --include='*.svelte')"})
  if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == $F ]]; then
    echo "PASS  .$A is authored as a top-level rule by $F alone"
  else
    echo "FAIL  .$A owner is not $F alone (${#owners[@]}: $owners)"; fail=1
  fi
done
# .empty-state collides with RunSubmissionTab/RunAssetsTab (spec §Testing): the
# ownership grep above is on the FILE, so the dist hash is picked by excluding
# the hashes those two files own — the anchor that is unique is `.title` under
# an `.empty-state` parent, which only this component authors.
sk=(${(f)"$(grep -ohE '\.skeleton\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
es=(${(f)"$(grep -ohE '\.error-state\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
em=(${(f)"$(grep -ohE '\.empty-state\.svelte-[a-z0-9]+ \.title:where' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
for t in "skeleton:${#sk[@]}:$sk" "error-state:${#es[@]}:$es" "empty-state .title:${#em[@]}:$em"; do
  a=${t%%:*}; rest=${t#*:}; n=${rest%%:*}
  if [[ $n -eq 1 ]]; then echo "PASS  .$a resolves to one hash (${rest#*:})"; else echo "FAIL  .$a not dist-unique ($n: ${rest#*:})"; fail=1; fi
done
if [[ ${#sk[@]} -eq 1 ]]; then
  N=Skeleton; H=$sk[1]
  d '\.skeleton' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'padding:12px' 'display:flex' 'flex-direction:column' 'gap:9px'
  d '\.row' '' 'display:flex' 'align-items:center' 'gap:12px'
  d '\.bar' '' 'display:block' 'height:13px' 'border-radius:3px' 'background:var\(--border-faint\)'
  d '\.end' '' 'margin-left:auto'
  none "Skeleton has no animation (ref 1345: never a spinner)" "\.(skeleton|row|bar)\.${H}\{[^}]*animation"
fi
if [[ ${#em[@]} -eq 1 ]]; then
  N=EmptyState; H=$em[1]
  d '\.empty-state' '' 'padding:34px 20px' 'align-items:center' 'gap:9px' 'text-align:center' 'border:1px solid var\(--border\)'
  chk "\.empty-state\.${H} \.title:where\(\.${H}\)" 'font-size:14px' 'font-weight:600' 'color:var\(--text\)' 'margin:0'
fi
if [[ ${#es[@]} -eq 1 ]]; then
  N=ErrorState; H=$es[1]
  d '\.error-state' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)'
  d '\.inline' '' 'display:flex' 'align-items:center' 'gap:12px' 'padding:14px 16px' 'border-left:3px solid var\(--danger\)'
  chk "\.inline\.${H} \.body:where\(\.${H}\)"    'gap:3px' 'flex:1'
  chk "\.inline\.${H} \.title:where\(\.${H}\)"   'font-size:13px'
  chk "\.inline\.${H} \.message:where\(\.${H}\)" 'font-size:12\.5px'
  d '\.page' '' 'display:flex' 'flex-direction:column' 'align-items:center' 'gap:9px' 'padding:30px 20px' 'text-align:center'
  chk "\.page\.${H} \.body:where\(\.${H}\)"    'align-items:center' 'gap:9px'
  chk "\.page\.${H} \.title:where\(\.${H}\)"   'font-size:14px' 'letter-spacing:0'
  chk "\.page\.${H} \.message:where\(\.${H}\)" 'font-size:13px' 'line-height:1\.5' 'max-width:46ch' 'text-wrap:pretty'
  chk "\.page\.${H} \.action:where\(\.${H}\)"  'margin-top:4px'
  # The leak guard (spec §1.3): the UNQUALIFIED .message / .title / .body rules
  # carry no metric. Paired with the positives above on the same hash.
  none "ErrorState unqualified .message has no font-size" "(^|\})\.message\.${H}\{[^}]*font-size:"
  none "ErrorState unqualified .body has no gap"          "(^|\})\.body\.${H}\{[^}]*gap:"
  none "ErrorState unqualified .title has no font-size"   "(^|\})\.title\.${H}\{[^}]*font-size:"
fi
```
Also add the `chk` helper definition (Conventions) next to `dd`. Mutation-test the section: add `font-size:13px` to the bare `.message` rule → the `none` reds; change `gap:3px` to `4px` → the check reds; restore both. Then run the whole gate and record its PASS count in `EXPECTED_CHECKS`.

- [ ] **Step 7: Full gate** (Conventions): autofixer on the 3 components → `npm test` → `npm run check` (0 / ≤31) → `zsh frontend/scripts/visual-refresh-gate.sh` ALL PASS.

- [ ] **Step 8: Commit.**
```bash
git add frontend/src/components/ui/Skeleton.svelte frontend/src/components/ui/EmptyState.svelte frontend/src/components/ui/ErrorState.svelte \
        frontend/src/tests/Skeleton.svelte.test.ts frontend/src/tests/EmptyState.svelte.test.ts frontend/src/tests/ErrorState.svelte.test.ts \
        frontend/scripts/visual-refresh-gate.sh
git commit -m "feat(frontend): Slice-4 T1 — Skeleton, EmptyState, ErrorState primitives (9d)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 9: Review** (Conventions §Review). Point both lanes at §1 + D2/D7/D9. Fix, re-review until clean, user OK.

---

## Task 2 — T2: student page adoption (9d)

**Files:**
- Modify: `frontend/src/pages/CourseList.svelte` (whole file), `frontend/src/pages/CourseView.svelte` (whole file), `frontend/src/pages/SequencePlayer.svelte` (imports `:1-9`, effect `:16-29` untouched, template `:162-180`, style `:320`), `frontend/src/components/items/QuizItem.svelte` (`:11` import, `:141-144`, `:226`)
- Modify: `frontend/src/tests/CourseList.svelte.test.ts`, `frontend/src/tests/CourseView.svelte.test.ts`, `frontend/src/tests/SequencePlayer.svelte.test.ts:152`, `frontend/src/tests/QuizItem.svelte.test.ts:201`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (r))

**Spec:** §2 table, enumerated (A)2, (B)12, (C)14-16, (C)21's "Other files" line.

**Interfaces:**
- Consumes T1: `Skeleton` (`rows`), `EmptyState` (`title`), `ErrorState` (`variant`, `title`, `message`, `onretry`, `action` snippet) — DOM: `.skeleton .row`, `.empty-state .title`, `.error-state.inline .btn`, `.error-state.page h1.title`, `.error-state.page .message`, `.error-state.page .action .btn`.
- Produces: nothing other tasks consume. `Spinner.svelte` keeps its other users and is not deleted.

- [ ] **Step 1: Write the failing tests.**

Append to `frontend/src/tests/CourseList.svelte.test.ts` (uses the file's existing `fetchSpy`, `settle`, `courseStub`, `seed`, `target`, `cmp`):
```ts
describe('CourseList 9d states (Slice-4 T2)', () => {
  it('loading: renders the Skeleton (3 rows), not a spinner', () => {
    fetchSpy.mockReturnValue(new Promise(() => {}));   // never settles
    target = document.createElement('div'); document.body.appendChild(target);
    cmp = mount(CourseList, { target });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelectorAll('.skeleton .row').length).toBe(3);
    expect(target.querySelector('.spinner')).toBeNull();
  });

  it('empty: EmptyState carries the enrolment copy verbatim', async () => {
    const t = seed([]);
    await settle();
    const title = t.querySelector('.empty-state .title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("You're not enrolled in any courses yet — ask your teacher for an invite.");
    expect(t.querySelector('.grid')).toBeNull();
  });

  it('error: inline ErrorState with the backend detail; Retry re-fetches with a clean error and shows the grid', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false, status: 500,
        json: () => Promise.resolve({ detail: 'Database is asleep.' }),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([courseStub(1)]),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as Response);
    target = document.createElement('div'); document.body.appendChild(target);
    cmp = mount(CourseList, { target });
    await settle();

    const err = target.querySelector('.error-state.inline');
    expect(err).not.toBeNull();
    expect(err!.querySelector('.title')!.textContent).toBe("Couldn't load courses");
    expect(err!.querySelector('.message')!.textContent).toBe('Database is asleep.');
    const retry = err!.querySelector<HTMLButtonElement>('.btn');
    expect(retry).not.toBeNull();
    expect(retry!.textContent?.trim()).toBe('Retry');

    retry!.click();
    flushSync();
    // Retry re-enters the loading branch with the error cleared (enumerated (A)2).
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelector('.error-state')).toBeNull();
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(target.querySelector('.error-state')).toBeNull();
    expect(target.querySelectorAll('.grid a').length).toBeGreaterThan(0);
  });
});
```

Append to `frontend/src/tests/CourseView.svelte.test.ts` (extend the store import to `import { __test__setSlots, loadCourse } from '../stores/currentCourse.svelte';` and add `import { ApiError } from '../lib/api';`):
```ts
describe('CourseView 9d states (Slice-4 T2)', () => {
  it('loading: Skeleton with 4 rows while loadCourse is in flight', () => {
    vi.mocked(loadCourse).mockReturnValueOnce(new Promise<void>(() => {}));
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelectorAll('.skeleton .row').length).toBe(4);
  });

  it('empty: EmptyState under the course header when there are no blocks', async () => {
    __test__setSlots({
      slug: 'course-x', versionId: 1,
      course: { id: 1, slug: 'course-x', name: 'Course X' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [], state: { version_id: 1, items: {} }, miniProjectsByBlockId: {},
    });
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    expect(target.querySelector('h1')!.textContent).toBe('Course X');
    expect(target.querySelector('.empty-state .title')!.textContent).toBe('This course has no published blocks yet.');
  });

  it.each([
    [404, 'Course not available', "This course isn't available to you. Ask your teacher for an invite link, or check the URL."],
    [403, 'Access denied', "You don't have access to this course."],
    [500, "Couldn't load course", 'Server exploded.'],
  ])('error %i: page ErrorState keeps the <h1> (D9) and the Back action', async (status, title, message) => {
    vi.mocked(loadCourse).mockRejectedValueOnce(new ApiError(status, 'Server exploded.'));
    component = mount(CourseView, { target, props: { courseSlug: 'course-x' } });
    await settle();
    const err = target.querySelector('.error-state.page');
    expect(err).not.toBeNull();
    const h1 = err!.querySelector('h1.title');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe(title);
    expect(err!.querySelector('.message')!.textContent).toBe(message);
    const back = err!.querySelector<HTMLButtonElement>('.action .btn');
    expect(back!.textContent?.trim()).toBe('Back to courses');
    expect(back!.classList.contains('secondary')).toBe(true);
  });
});
```

Edit `frontend/src/tests/SequencePlayer.svelte.test.ts`: line 152 `expect(el.querySelector('.empty')).not.toBeNull();` → `expect(el.querySelector('.empty-state .title')!.textContent).toBe('This sequence has no items yet.');`. Add `import { loadCourse } from '../stores/currentCourse.svelte'` to the existing store import line, `import { ApiError } from '../lib/api';`, a `settle` helper, and this block:
```ts
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

describe('SequencePlayer 9d states (Slice-4 T2)', () => {
  it('loading: Skeleton (3 rows) while the course loads; then "Sequence not found" page ErrorState when the store stays empty', async () => {
    // Store NOT seeded → the :16-29 effect takes the loadCourse branch.
    seedRoute(100, '');
    const el = render('100');
    expect(el.querySelector('.skeleton')).not.toBeNull();
    expect(el.querySelectorAll('.skeleton .row').length).toBe(3);

    await settle();   // mocked loadCourse resolves; the store is still null → !sequence branch
    const err = el.querySelector('.error-state.page');
    expect(err).not.toBeNull();
    expect(err!.querySelector('h1.title')!.textContent).toBe('Sequence not found');
    expect(err!.querySelector('.message')).toBeNull();               // title-only (§2)
    const back = err!.querySelector<HTMLButtonElement>('.action .btn');
    expect(back!.textContent?.trim()).toBe('Back to course');     // no ← glyph (enumerated 12)
  });

  it('error 404: page ErrorState with the verbatim copy and the Back action', async () => {
    vi.mocked(loadCourse).mockRejectedValueOnce(new ApiError(404, 'gone'));
    seedRoute(100, '');
    const el = render('100');
    await settle();
    const err = el.querySelector('.error-state.page');
    expect(err!.querySelector('h1.title')!.textContent).toBe('Sequence not available');
    expect(err!.querySelector('.message')!.textContent).toBe("This sequence isn't available to you.");
    expect(err!.querySelector('.action .btn')!.textContent?.trim()).toBe('Back to course');
  });

  it('error 500: generic heading + the backend message', async () => {
    vi.mocked(loadCourse).mockRejectedValueOnce(new ApiError(500, 'Server exploded.'));
    seedRoute(100, '');
    const el = render('100');
    await settle();
    const err = el.querySelector('.error-state.page');
    expect(err!.querySelector('h1.title')!.textContent).toBe("Couldn't load");
    expect(err!.querySelector('.message')!.textContent).toBe('Server exploded.');
  });
});
```

Edit `frontend/src/tests/QuizItem.svelte.test.ts:201`: `expect(article!.querySelector('.empty')).not.toBeNull();` → `expect(article!.querySelector('.empty-state .title')!.textContent).toBe('This quiz has no questions yet.');`.

Edit the comment at `frontend/src/tests/CourseView.svelte.test.ts:39`: `// and the page would render the Spinner branch without the BlockGroup tree.` → `// and the page would render the Skeleton branch without the BlockGroup tree.`

- [ ] **Step 2: Run — expect FAIL.** `npm test -- CourseList CourseView SequencePlayer QuizItem` (new selectors absent; `.empty` assertions now fail).

- [ ] **Step 3: Implement.**

`frontend/src/pages/CourseList.svelte` — full file:
```svelte
<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import type { CourseListItem } from '../lib/types';
  import CourseCard from '../components/course/CourseCard.svelte';
  import Skeleton from '../components/ui/Skeleton.svelte';
  import EmptyState from '../components/ui/EmptyState.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';

  let loading = $state(true);
  let courses = $state<CourseListItem[]>([]);
  let error = $state('');
  // Retry counter (Slice-4 enumerated (A)2): the load effect reads it at its
  // top, so incrementing it re-runs the fetch. Retry is reachable only from
  // the error branch — i.e. after the previous request settled — so at most
  // one request is ever in flight and no stale-response guard is needed.
  let reloadTick = $state(0);
  // Current enrolments only: version_id !== null excludes admin-only rows (not
  // enrolments), is_active excludes past enrolments — so the header never disagrees
  // with a pure-student card's "Past enrolment" footer. (courses.length would
  // over-count, catastrophically for a superuser who gets an admin-only row per course.)
  const enrolledCount = $derived(courses.filter((c) => c.version_id !== null && c.is_active).length);

  $effect(() => {
    void reloadTick;
    loading = true;
    error = '';
    api.get<CourseListItem[]>('/api/my-courses')
      .then((cs) => { courses = cs; })
      .catch((e: unknown) => { error = e instanceof ApiError ? e.displayMessage : 'Failed to load courses.'; })
      .finally(() => { loading = false; });
  });

  function retry(): void { reloadTick += 1; }
</script>

<div class="page">
  <div class="page-head">
    <h1>Your courses</h1>
    {#if enrolledCount > 0}<span class="enrolled">{enrolledCount} enrolled</span>{/if}
  </div>

  {#if loading}
    <Skeleton />
  {:else if error}
    <ErrorState title="Couldn't load courses" message={error} onretry={retry} />
  {:else if courses.length === 0}
    <EmptyState title="You're not enrolled in any courses yet — ask your teacher for an invite." />
  {:else}
    <div class="grid">
      {#each courses as c (c.course.id)}
        <CourseCard course={c} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  .page-head { display: flex; align-items: center; gap: 12px; /* ref 2038 */ margin-bottom: var(--space-3); /* 16px, ref 2038 */ }
  .page-head h1 { margin: 0; flex: 1; }
  .enrolled { font-family: var(--font-mono); font-size: 12px; /* ref 2040 */ color: var(--muted); }
  /* grid gap 16px → 12px (ref 2042); responsive auto-fill columns kept */
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
</style>
```
(`.empty` and `.error` rules deleted; `.page`/`.page-head`/`.grid` untouched.)

`frontend/src/pages/CourseView.svelte` — full file:
```svelte
<script lang="ts">
  import { ApiError } from '../lib/api';
  import { currentCourse, loadCourse } from '../stores/currentCourse.svelte';
  import { navigate } from '../lib/router.svelte';
  import BlockGroup from '../components/course/BlockGroup.svelte';
  import Skeleton from '../components/ui/Skeleton.svelte';
  import EmptyState from '../components/ui/EmptyState.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  import Button from '../components/ui/Button.svelte';

  let { courseSlug }: { courseSlug: string } = $props();

  let loading = $state(true);
  let error = $state<{ status: number; message: string } | null>(null);

  $effect(() => {
    loading = true;
    error = null;
    loadCourse(courseSlug)
      .catch((e: unknown) => {
        if (e instanceof ApiError) {
          error = { status: e.status, message: e.displayMessage };
        } else {
          error = { status: 500, message: 'Could not load course.' };
        }
      })
      .finally(() => { loading = false; });
  });

  // Page-level error copy (Slice-4 §2): the three branches, text verbatim.
  const errorTitle = $derived.by(() => {
    if (error === null) return '';
    if (error.status === 404) return 'Course not available';
    if (error.status === 403) return 'Access denied';
    return "Couldn't load course";
  });
  const errorMessage = $derived.by(() => {
    if (error === null) return '';
    if (error.status === 404) return "This course isn't available to you. Ask your teacher for an invite link, or check the URL.";
    if (error.status === 403) return "You don't have access to this course.";
    return error.message;
  });
</script>

<div class="page">
  {#if loading}
    <Skeleton rows={4} />
  {:else if error}
    <ErrorState variant="page" title={errorTitle} message={errorMessage}>
      {#snippet action()}
        <Button variant="secondary" onclick={() => navigate('/courses')}>Back to courses</Button>
      {/snippet}
    </ErrorState>
  {:else if currentCourse.value}
    <header>
      <Button variant="ghost" onclick={() => navigate('/courses')}>← Courses</Button>
      <h1>{currentCourse.value.course.name}</h1>
    </header>
    {#if currentCourse.value.version.info_html}
      <div class="info">{@html currentCourse.value.version.info_html}</div>
    {/if}
    {#if currentCourse.value.blocks.length === 0}
      <EmptyState title="This course has no published blocks yet." />
    {:else}
      {#each currentCourse.value.blocks as b (b.id)}
        <BlockGroup {courseSlug} block={b} state={currentCourse.value.state} mpByBlockId={currentCourse.value.miniProjectsByBlockId} />
      {/each}
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .info { color: var(--muted); margin: var(--space-3) 0; }
</style>
```
(The header's `← Courses` ghost button is NOT in this slice's scope — (B)12 names only SequencePlayer's `← Course`. Leave it.)

`frontend/src/pages/SequencePlayer.svelte` — edits only:
- `:7` `import Spinner from '../components/ui/Spinner.svelte';` → three lines:
  ```ts
  import Skeleton from '../components/ui/Skeleton.svelte';
  import EmptyState from '../components/ui/EmptyState.svelte';
  import ErrorState from '../components/ui/ErrorState.svelte';
  ```
  (`Button` import at `:8` stays — the footer and the action snippets use it.)
- Add after the `iconState` function (before `</script>`):
  ```ts
  // Page-level error copy (Slice-4 §2), text verbatim from the former branches.
  const errorTitle = $derived.by(() => {
    if (error === null) return '';
    return error.status === 404 || error.status === 403 ? 'Sequence not available' : "Couldn't load";
  });
  const errorMessage = $derived.by(() => {
    if (error === null) return '';
    return error.status === 404 || error.status === 403 ? "This sequence isn't available to you." : error.message;
  });
  ```
- Template `:162-180` becomes:
  ```svelte
  <div class="page">
    {#if loading}
      <Skeleton />
    {:else if error}
      <ErrorState variant="page" title={errorTitle} message={errorMessage}>
        {#snippet action()}
          <Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}`)}>Back to course</Button>
        {/snippet}
      </ErrorState>
    {:else if !sequence}
      <ErrorState variant="page" title="Sequence not found">
        {#snippet action()}
          <Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}`)}>Back to course</Button>
        {/snippet}
      </ErrorState>
    {:else if sequence.items.length === 0}
      {@render crumbs(sequence)}
      <h1 class="seq-title">{sequence.title}</h1>
      <EmptyState title="This sequence has no items yet." />
    {:else}
  ```
  (everything from `{@render crumbs(sequence)}` in the non-empty branch onward is untouched.)
- Style: delete `:320` `.empty { color: var(--muted); }`.

`frontend/src/components/items/QuizItem.svelte` — edits only:
- After `:11` `import Button from '../ui/Button.svelte';` add `import EmptyState from '../ui/EmptyState.svelte';`.
- `:143` `<p class="empty">This quiz has no questions yet.</p>` → `<EmptyState title="This quiz has no questions yet." />`.
- Delete `:226` `.empty { color: var(--muted); }`.

- [ ] **Step 4: Run — expect PASS.** `npm test -- CourseList CourseView SequencePlayer QuizItem`, then the full `npm test`.

- [ ] **Step 5: Mutation checks.** (a) In CourseList's effect, delete `void reloadTick;` → the Retry test fails (only one fetch); restore. (b) Delete `error = '';` from the effect → the Retry test's "skeleton after click / error-state null" assertion fails; restore. (c) In SequencePlayer's `!sequence` branch, add `message="x"` → the "title-only" assertion fails; restore.

- [ ] **Step 6: Gate-script section (r).** The four surfaces' own rules are unchanged except deletions, so this section pins the DELETIONS and the primitive usage:
```zsh
echo
echo "--- (r) Slice-4 T2 student-page adoption ---"
# The four scoped `.empty` rules and CourseList's `.error` are gone (spec §2);
# a surviving one would be a css_unused_selector warning AND a stray rule.
for f in src/pages/CourseList.svelte src/pages/CourseView.svelte src/pages/SequencePlayer.svelte src/components/items/QuizItem.svelte; do
  if sed 's#/\*.*\*/##g' "$f" | grep -qE '^[[:space:]]*\.(empty|error)[[:space:]]*\{'; then
    echo "FAIL  $f still authors a .empty/.error rule"; fail=1
  else
    echo "PASS  ${f:t} no longer authors .empty/.error"
  fi
  if grep -qE "components/ui/Spinner\.svelte" "$f"; then
    echo "FAIL  $f still imports Spinner"; fail=1
  else
    echo "PASS  ${f:t} does not import Spinner"
  fi
done
# The ← glyph left SequencePlayer's error actions (enumerated 12); CourseView's
# `← Courses` header button is out of scope and must still be there.
if sed 's#<!--.*-->##g' src/pages/SequencePlayer.svelte | grep -qE '← Course<'; then
  echo "FAIL  SequencePlayer still renders '← Course'"; fail=1
else
  echo "PASS  SequencePlayer error actions read 'Back to course'"
fi
grep -q '← Courses' src/pages/CourseView.svelte && echo "PASS  CourseView header button untouched (out of scope)" || { echo "FAIL  CourseView '← Courses' header button changed — out of Slice-4 scope"; fail=1 }
```
Bump `EXPECTED_CHECKS` by 10. Mutation-test: temporarily re-add `.empty { }` to QuizItem → red; restore.

- [ ] **Step 7: Full gate.** Autofixer on the 4 components → `npm test` → `npm run check` (0 / ≤31 — the deleted `.empty` rules would otherwise have produced `css_unused_selector` warnings, so the count must not rise) → gate ALL PASS.

- [ ] **Step 8: Commit.**
```bash
git add frontend/src/pages/CourseList.svelte frontend/src/pages/CourseView.svelte frontend/src/pages/SequencePlayer.svelte frontend/src/components/items/QuizItem.svelte \
        frontend/src/tests/CourseList.svelte.test.ts frontend/src/tests/CourseView.svelte.test.ts frontend/src/tests/SequencePlayer.svelte.test.ts frontend/src/tests/QuizItem.svelte.test.ts \
        frontend/scripts/visual-refresh-gate.sh
git commit -m "feat(frontend): Slice-4 T2 — student pages adopt Skeleton/EmptyState/ErrorState, CourseList Retry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 9: Review.** Both lanes; §2 + (A)2 + (C)14-16. Fix, re-review, user OK.

---

## Task 3 — T3: mini-project page — frame, header, assignment, group, history, fetch-error, loading

**Files:**
- Modify: `frontend/src/pages/MiniProjectDetailPage.svelte` (imports `:22-36`; add `showResub`; template `:396-558` except the submit section's INNER markup; style `:560-592` except `.banner-error`, `.banner-info`, `.sr-only`)
- Modify: `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (the T3 migrations from enumerated 21 + new tests)
- Create: `docs/backlog/mp-can-submit-null-guard-is-dead.md`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (s))

**Spec:** §3.1-3.4, §3.7, §3.8, §3.9 T3 rows, (B)4-8/10, (C)17/19/20/21, D3/D4/D6/D8/D9, Constraints 1-4.

**Interfaces:**
- Consumes T1 `Skeleton`, `ErrorState` (page + `action` snippet); `Button`; `StatusPill` (`status: LatestStatus` — `entry.evaluation.result` is a 4-value subset, type-correct as-is, D8).
- Produces for T4: the `section.submit-block` sits inside `div.grid2` as the second cell with `class:can={data.can_submit === true}` (no `.can` rule yet); the shared card rule `.group-block, .submit-block { … }` and `.group-block h2, .submit-block h2 { … }`; the `.banner-error` / `.banner-info` rules and the raw input/button/banner markup survive **unchanged** inside it until T4.

**Plan ruling on §3.9 vs §3.4 (record for reviewers):** §3.9 attributes the `.submit-block` rewrite to T4 while §3.4 (T3) pins both grid cells as identical cards. T3 authors the shared card rule (so the relocated section renders correctly inside the grid between the two commits, the stated purpose of keeping the `.banner-*` rules); T4 adds `.submit-block.can` and the inner rules. Net effect identical to the spec at T4's commit.

- [ ] **Step 1: Test migrations + new tests** in `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts`.

Migrations (line numbers are pre-edit):
- `:221` `expect(entries[0].textContent).not.toContain('Evaluated:');` → `expect(entries[0].querySelector('.feedback')).toBeNull();` and its comment `// No evaluation block — heuristic: no "Evaluated:" text.` → `// No evaluation → no .feedback block.`
- `:252-253` `'Submission #2'` → `'Submission 2'`, `'Submission #1'` → `'Submission 1'`.
- `:273` `expect(entries[0].textContent).toContain('Evaluated:');` → `expect(entries[0].querySelector('.feedback')).not.toBeNull();`
- `:296` same replacement.
- `:342` comment `// Pill MUST exist as a sibling within the header row.` → `// Pill MUST exist within the header row, never inside the h3 (its parent is .pills, the h3's sibling).`
- `:761` comment `// The full-page banner renders <h1>, <p>{copy}</p>, and a "Back to course"` / `// button. Query the <p> so the byte-exact comparison only sees the copy.` → `// The full-page banner is ErrorState's page variant: <h1 class="title">, <p class="message">{copy}</p>,` / `// and a "Back to course" action. Query .message so the comparison only sees the copy.`; `:763` `banner.querySelector('p')` → `banner.querySelector('.message')`; `:764` error text `'expected <p> inside 403 fetch-error banner'` → `'expected .message inside 403 fetch-error banner'`.
- `:782-789` the same three edits for the 404 test.

New tests (append; they use the file's `makeDetail`/`makeEntry`/`makeEval`/`mountPage`/`settle`):
```ts
describe('MiniProjectDetailPage 9c frame + header (Slice-4 T3)', () => {
  it('loading: Skeleton with 4 rows; the sr-live region stays outside it (C16)', async () => {
    vi.mocked(fetchDetail).mockReturnValueOnce(new Promise<StudentMiniProjectDetail>(() => {}));
    component = mount(MiniProjectDetailPage, { target, props: { courseSlug: 'course-x', blockSlug: 'block-y' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelectorAll('.skeleton .row').length).toBe(4);
    expect(target.querySelector('[data-testid="sr-live"]')).not.toBeNull();
  });

  it('breadcrumb: Courses / {course} / {block title}, current crumb aria-current, separators hidden', async () => {
    __test__setSlots({
      slug: 'course-x', versionId: 1,
      course: { id: 1, slug: 'course-x', name: 'Course X' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [], state: { version_id: 1, items: {} }, miniProjectsByBlockId: {},
    });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail());
    await mountPage();
    const nav = target.querySelector('nav.breadcrumb');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute('aria-label')).toBe('Breadcrumb');
    const links = nav!.querySelectorAll('a');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('/courses');
    expect(links[0].textContent).toBe('Courses');
    expect(links[1].getAttribute('href')).toBe('/courses/course-x');
    expect(links[1].textContent).toBe('Course X');
    const seps = nav!.querySelectorAll('.sep');
    expect(seps.length).toBe(2);
    seps.forEach((s) => { expect(s.getAttribute('aria-hidden')).toBe('true'); expect(s.textContent).toBe('/'); });
    const current = nav!.querySelector('.current');
    expect(current!.getAttribute('aria-current')).toBe('page');
    expect(current!.textContent).toBe('Final Project');
    expect(nav!.textContent).not.toContain('<');
    expect(nav!.textContent).not.toContain('›');
  });

  it('title row: h1 reads "Mini-project — {block title}" beside the StatusPill', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ block_title: 'Final Project' }));
    await mountPage();
    const row = target.querySelector('.title-row');
    expect(row!.querySelector('h1')!.textContent).toBe('Mini-project — Final Project');
    expect(row!.querySelector('.pill')).not.toBeNull();
  });

  it('deadlines: hard-deadline sentence + mono soft aside; no resubmission line outside a revision state', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      hard_deadline: '2026-06-30T23:59:00Z', soft_deadline: '2026-06-20T23:59:00Z',
      resubmission_deadline: '2026-07-05T23:59:00Z', latest_status: 'not_submitted',
    }));
    await mountPage();
    const dl = target.querySelector('.deadlines');
    expect(dl).not.toBeNull();
    const hard = dl!.querySelector('.deadline-hard');
    expect(hard).not.toBeNull();
    expect(hard!.querySelector('strong')!.textContent).toBe('Hard deadline');
    expect(hard!.textContent).toMatch(/^Hard deadline · 2026-07-01 01:59 GMT\+2 — /);   // TZ=Europe/Copenhagen (package.json test script)
    expect(dl!.querySelector('.deadline-resub')).toBeNull();
    const soft = dl!.querySelector('.deadline-soft');
    expect(soft!.classList.contains('mono')).toBe(true);
    expect(soft!.textContent).toBe('soft deadline · 2026-06-21 01:59 GMT+2');
  });

  it('deadlines: resubmission line wins in a revision state', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      latest_status: 'minor_revision', resubmission_deadline: '2026-06-25T23:59:00Z',
      submission_history: [makeEntry({ evaluation: makeEval({ result: 'minor_revision' }) })],
    }));
    await mountPage();
    const resub = target.querySelector('.deadline-resub');
    expect(resub).not.toBeNull();
    expect(resub!.querySelector('strong')!.textContent).toBe('Resubmission deadline');
    expect(target.querySelector('.deadline-hard')).toBeNull();
  });

  it('deadlines row is absent when nothing would render in it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ hard_deadline: null, soft_deadline: null, resubmission_deadline: null }));
    await mountPage();
    expect(target.querySelector('.deadlines')).toBeNull();
  });
});

describe('MiniProjectDetailPage 9c assignment + group (Slice-4 T3)', () => {
  it('assignment card: h2 "Assignment" above the bound assignment-html seam', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ assignment_html: '<p>Do <a href="https://x.y">it</a>.</p>' }));
    await mountPage();
    const card = target.querySelector('section.assignment');
    expect(card).not.toBeNull();
    expect(card!.querySelector('h2')!.textContent).toBe('Assignment');
    const html = card!.querySelector('[data-testid="assignment-html"]');
    expect(html).not.toBeNull();
    expect(html!.querySelector('a')!.getAttribute('target')).toBe('_blank');   // rewriteExternalLinks still bound (L1/M1)
  });

  it('group card: "Your group", current member bold and first, group name in the sentence; no opacity class', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({
      group: makeGroup({ members: [TEAMMATE, ME], is_disabled: true }),
    }));
    await mountPage();
    const card = target.querySelector('section.group-block');
    expect(card!.querySelector('h2')!.textContent).toBe('Your group');
    const members = card!.querySelector('.members');
    expect(members!.textContent?.replace(/\s+/g, ' ').trim()).toBe('Group Team Alpha — Alice Student (you), Bob Other');
    const strong = members!.querySelectorAll('strong');
    expect(strong.length).toBe(1);
    expect(strong[0].textContent).toBe('Alice Student (you)');
    expect(card!.querySelector('.group-notice')!.textContent).toBe('This group is disabled — contact your teacher.');
    expect(card!.classList.contains('group-disabled')).toBe(false);
    expect(card!.closest('.grid2')).not.toBeNull();
  });

  it('single-member group sentence', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ group: makeGroup({ members: [ME] }) }));
    await mountPage();
    const members = target.querySelector('.group-block .members');
    expect(members!.textContent?.replace(/\s+/g, ' ').trim()).toBe("Group Team Alpha — Alice Student (you) — you're the only member so far.");
    expect(members!.querySelector('strong')!.textContent).toBe('Alice Student (you)');
  });

  it('submit section is the grid second cell with its seam and inner controls intact (T4 restyles them)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const submit = target.querySelector('[data-testid="mp-submit-section"]');
    expect(submit!.closest('.grid2')).not.toBeNull();
    expect(submit!.classList.contains('can')).toBe(true);
    expect(submit!.querySelector('[data-testid="mp-file-input"]')).not.toBeNull();
  });
});

describe('MiniProjectDetailPage 9c history (Slice-4 T3)', () => {
  it('entry header: mono numeral, mono meta "{date} · {name} (you)", pills group beside the h3', async () => {
    const entry = makeEntry({ submission_number: 3, is_late: true, evaluation: makeEval({ result: 'rejected', score: 40 }) });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [entry], latest_status: 'rejected' }));
    await mountPage();
    const head = target.querySelector('.history-entry-header');
    const h3 = head!.querySelector('h3');
    expect(h3!.textContent).toBe('Submission 3');
    const num = h3!.querySelector('.mono');
    expect(num!.textContent).toBe('3');
    const meta = head!.querySelector('.entry-meta');
    expect(meta!.classList.contains('mono')).toBe(true);
    expect(meta!.textContent).toBe('2026-06-10 14:00 GMT+2 · Alice Student (you)');
    const pills = head!.querySelector('.pills');
    expect(pills).not.toBeNull();
    expect(pills!.previousElementSibling).toBe(meta);
    const inPills = pills!.querySelectorAll('.pill');
    expect(inPills.length).toBe(2);
    expect(inPills[0].classList.contains('pill-late')).toBe(true);
    expect(inPills[0].textContent).toBe('Late');
    expect(inPills[1].textContent).toContain('Rejected');          // StatusPill (D8)
    expect(h3!.querySelector('.pill')).toBeNull();                  // D15 invariant
  });

  it('file tile: PDF badge hidden from AT, name + mono size, icon download link with the filename in its label', async () => {
    const entry = makeEntry({ filename: 'thesis-final.pdf', file_size: 2_350_000, submission_id: 777 });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [entry], latest_status: 'awaiting_evaluation', can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation' }));
    await mountPage();
    const file = target.querySelector('.history-entry-body .file');
    expect(file).not.toBeNull();
    const kind = file!.querySelector('.file-kind');
    expect(kind!.getAttribute('aria-hidden')).toBe('true');
    expect(kind!.classList.contains('mono')).toBe(true);
    expect(kind!.textContent).toBe('PDF');
    expect(file!.querySelector('.file-name .name')!.textContent).toBe('thesis-final.pdf');
    const size = file!.querySelector('.file-name .size');
    expect(size!.classList.contains('mono')).toBe(true);
    expect(size!.textContent).toBe(formatFileSize(2_350_000));
    const dl = file!.querySelector<HTMLAnchorElement>('a.dl');
    expect(dl!.getAttribute('href')).toBe('/api/submissions/777/file');
    expect(dl!.hasAttribute('download')).toBe(true);
    expect(dl!.getAttribute('aria-label')).toBe('Download thesis-final.pdf');
    expect(dl!.getAttribute('title')).toBe('Download');
    const svg = dl!.querySelector('svg');
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(dl!.textContent?.trim()).toBe('');                       // icon-only; the label is aria
  });

  it('feedback block: result class, meta line with mono score + mono date, text, optional feedback file', async () => {
    const entry = makeEntry({ evaluation: makeEval({ result: 'minor_revision', score: 65, feedback_text: 'Fix typos.', has_feedback_file: true, eval_id: 909 }) });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [entry], latest_status: 'minor_revision' }));
    await mountPage();
    const fb = target.querySelector('.history-entry-body .feedback');
    expect(fb!.classList.contains('needs-revision')).toBe(true);
    const meta = fb!.querySelector('.feedback-meta');
    expect(meta!.textContent?.replace(/\s+/g, ' ').trim()).toBe('Needs revision (minor) · score 65/100 · Prof Smith, 2026-06-15 12:00 GMT+2');
    const monos = meta!.querySelectorAll('.mono');
    expect(monos.length).toBe(2);
    expect(monos[0].textContent).toBe('65/100');
    expect(fb!.querySelector('.feedback-text')!.textContent).toBe('Fix typos.');
    expect(fb!.querySelector<HTMLAnchorElement>('a.feedback-file')!.getAttribute('href')).toBe('/api/evaluations/909/feedback-file');
  });

  it('feedback block: null score omits the score segment; empty text falls back; rejected/accepted classes', async () => {
    const rejected = makeEntry({ submission_id: 1, submission_number: 1, evaluation: makeEval({ result: 'rejected', score: null, feedback_text: '' }) });
    const accepted = makeEntry({ submission_id: 2, submission_number: 2, evaluation: makeEval({ result: 'accepted' }) });
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ submission_history: [accepted, rejected], latest_status: 'accepted', can_submit: false, can_submit_reason_if_not: 'already_accepted' }));
    await mountPage();
    const blocks = target.querySelectorAll('.feedback');
    expect(blocks[0].classList.contains('accepted')).toBe(true);
    expect(blocks[1].classList.contains('rejected')).toBe(true);
    expect(blocks[1].querySelector('.feedback-meta')!.textContent).not.toContain('score');
    expect(blocks[1].querySelector('.feedback-text')!.textContent).toBe('No written feedback');
  });

  it('fetch error: page ErrorState keeps the h1 "Mini-project unavailable" and a secondary Back action (D9)', async () => {
    vi.mocked(fetchDetail).mockRejectedValueOnce(new ApiError(404, 'gone'));
    await mountPage();
    const banner = target.querySelector('[data-testid="fetch-error-banner"]');
    const err = banner!.querySelector('.error-state.page');
    expect(err).not.toBeNull();
    expect(err!.querySelector('h1.title')!.textContent).toBe('Mini-project unavailable');
    const back = err!.querySelector('.action .btn');
    expect(back!.textContent?.trim()).toBe('Back to course');
    expect(back!.classList.contains('secondary')).toBe(true);
  });
});
```
Add `import { formatFileSize } from '../lib/format';` to the test imports. `makeEval` sets `score: 88` typed `number | null` in the fixture type — `score: null` compiles because the type allows it (check `types.ts:490` region; if `score` is typed `number`, drop the null-score assertion and the `score: null` override — do NOT widen the type).

- [ ] **Step 2: Run — expect FAIL.** `npm test -- MiniProjectDetailPage`.

- [ ] **Step 3: Implement.**

Imports (`:22-36`): add
```ts
import Skeleton from '../components/ui/Skeleton.svelte';
import ErrorState from '../components/ui/ErrorState.svelte';
import Button from '../components/ui/Button.svelte';
```
Script addition (after `titleForHeading`):
```ts
  // Deadline row (Slice-4 §3.2): the resubmission line takes prominence in a
  // revision state (the former :429 predicate); the row itself renders only
  // when it would have content.
  const showResub = $derived(
    data !== null &&
    data.resubmission_deadline !== null &&
    (data.latest_status === 'major_revision' || data.latest_status === 'minor_revision'),
  );
```

Template — replace everything from `{#if isLoading}` (`:406`) to the end of the history section (`:557`) with:
```svelte
  {#if isLoading}
    <Skeleton rows={4} />
  {:else if fetchErrorMessage !== null}
    <div data-testid="fetch-error-banner">
      <ErrorState variant="page" title="Mini-project unavailable" message={fetchErrorMessage}>
        {#snippet action()}
          <Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}`)}>Back to course</Button>
        {/snippet}
      </ErrorState>
    </div>
  {:else if data}
    <header>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/courses">Courses</a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="/courses/{courseSlug}">{currentCourse.value?.course.name ?? '<Course Name>'}</a>
        <span class="sep" aria-hidden="true">/</span>
        <span class="current" aria-current="page">{titleForHeading}</span>
      </nav>
      <div class="title-row">
        <h1>Mini-project — {titleForHeading}</h1>
        <StatusPill status={data.latest_status} />
      </div>
      {#if showResub || data.hard_deadline !== null || data.soft_deadline !== null}
        <div class="deadlines">
          <!-- `&& data.resubmission_deadline !== null` narrows for TS; showResub already implies it. -->
          {#if showResub && data.resubmission_deadline !== null}
            <p class="deadline deadline-resub"><strong>Resubmission deadline</strong> · {formatRelativeDeadline(data.resubmission_deadline)}</p>
          {:else if data.hard_deadline !== null}
            <p class="deadline deadline-hard"><strong>Hard deadline</strong> · {formatRelativeDeadline(data.hard_deadline)}</p>
          {/if}
          {#if data.soft_deadline !== null}
            <p class="deadline-soft mono">soft deadline · {formatLocalWithTz(data.soft_deadline)}</p>
          {/if}
        </div>
      {/if}
    </header>

    <section class="assignment">
      <h2>Assignment</h2>
      <!-- L1 + M1: bind:this and {@html} on the SAME div; data-testid is the test seam. -->
      <div class="assignment-html" data-testid="assignment-html" bind:this={assignmentEl}>
        {@html data.assignment_html}
      </div>
    </section>

    <div class="grid2">
      <section class="group-block">
        <h2>Your group</h2>
        {#if data.group === null}
          <!-- D4 friendly banner. -->
          <p class="members">You're not yet assigned to a group. Once your teacher assigns you, you'll be able to submit.</p>
        {:else if data.group.members.length === 1}
          {@const me = data.group.members[0]}
          <p class="members">Group {data.group.name} — <strong>{me.full_name} (you)</strong> — you're the only member so far.</p>
        {:else}
          <p class="members">
            Group {data.group.name} —
            {#each orderedMembers as m, i (m.user_id)}{#if i > 0}{', '}{/if}{#if m.is_me}<strong>{m.full_name} (you)</strong>{:else}{m.full_name}{/if}{/each}
          </p>
        {/if}
        {#if data.group?.is_disabled}
          <!-- The disabled meaning is carried by this line alone (Constraint 2: no opacity dim). -->
          <p class="group-notice">This group is disabled — contact your teacher.</p>
        {/if}
      </section>

      <!-- D6 — submit / resubmit section. Renders ONLY when the group is
           assigned AND can_submit has been resolved (true OR false with a
           reason). When can_submit=false, render the reason banner only —
           no file picker, no submit button. -->
      {#if data.group !== null && data.can_submit !== null}
        <section class="submit-block" class:can={data.can_submit === true} data-testid="mp-submit-section">
          {#if data.can_submit === true}
            <h2>{submitHeading}</h2>
            <input
              type="file"
              accept="application/pdf"
              data-testid="mp-file-input"
              disabled={submitState === 'submitting'}
              onchange={handleFileChange}
              bind:this={fileInputEl}
            />
            <button
              type="button"
              data-testid="mp-submit-btn"
              disabled={!canSubmitClick}
              onclick={handleSubmit}
            >
              {submitState === 'submitting' ? 'Submitting…' : 'Submit'}
            </button>
            {#if submitState === 'error' && submitErrorMessage !== null}
              <div class="banner banner-error" data-testid="mp-submit-error">
                <p>{submitErrorMessage}</p>
                {#if submitErrorIsNetwork}
                  <button
                    type="button"
                    data-testid="mp-retry-btn"
                    onclick={handleSubmit}
                  >Retry</button>
                {/if}
              </div>
            {/if}
          {:else if data.can_submit_reason_if_not !== null}
            <div class="banner banner-info" data-testid="mp-cannot-submit">
              {REASON_LABELS[data.can_submit_reason_if_not]}
            </div>
          {/if}
        </section>
      {/if}
    </div>

    {#if data.submission_history.length > 0}
      <section class="history">
        <h2>Submission history</h2>
        {#each data.submission_history as entry (entry.submission_id)}
          <section class="history-entry">
            <!-- D15 (restated in Slice-4 enumerated 19): the Late pill is never inside <h3>;
                 its parent is .pills, the h3's sibling. -->
            <div class="history-entry-header">
              <h3>Submission <span class="mono">{entry.submission_number}</span></h3>
              <span class="entry-meta mono">{formatLocalWithTz(entry.submitted_at)} · {entry.submitted_by_full_name}{entry.submitter_is_me ? ' (you)' : ''}</span>
              <span class="pills">
                {#if entry.is_late}
                  <span
                    class="pill pill-late"
                    title={data.soft_deadline
                      ? `Submitted past the soft deadline (${formatLocalWithTz(data.soft_deadline)})`
                      : 'Submitted past the soft deadline'}
                  >Late</span>
                {/if}
                {#if entry.evaluation}
                  <StatusPill status={entry.evaluation.result} />
                {/if}
              </span>
            </div>
            <div class="history-entry-body">
              <div class="file">
                <span class="file-kind mono" aria-hidden="true">PDF</span>
                <span class="file-name">
                  <span class="name">{entry.filename}</span>
                  <span class="size mono">{formatFileSize(entry.file_size)}</span>
                </span>
                <a class="dl" href="/api/submissions/{entry.submission_id}/file" download title="Download" aria-label="Download {entry.filename}">
                  <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="3" x2="8" y2="10.6"/><polyline points="4.8,7.6 8,10.8 11.2,7.6"/><line x1="3.4" y1="13" x2="12.6" y2="13"/></svg>
                </a>
              </div>
              {#if entry.evaluation}
                {@const ev = entry.evaluation}
                <div class="feedback {ev.result === 'rejected' ? 'rejected' : ev.result === 'accepted' ? 'accepted' : 'needs-revision'}">
                  <!-- Separators as string expressions: Svelte trims whitespace at block edges, and a
                       bare " · score " as the first node of the {#if} would lose its leading space. -->
                  <p class="feedback-meta">{evaluationResultLabel(ev.result)}{#if ev.score !== null}{' · score '}<span class="mono">{ev.score}/100</span>{/if}{' · '}{ev.evaluated_by_full_name}, <span class="mono">{formatLocalWithTz(ev.evaluated_at)}</span></p>
                  <p class="feedback-text">{ev.feedback_text || 'No written feedback'}</p>
                  {#if ev.has_feedback_file}
                    <a class="feedback-file" href="/api/evaluations/{ev.eval_id}/feedback-file" download>Download feedback</a>
                  {/if}
                </div>
              {/if}
            </div>
          </section>
        {/each}
      </section>
    {/if}
  {/if}
</div>
```
The submit section's inner markup (from `{#if data.can_submit === true}` to the closing `{/if}`) is the pre-edit `:479-513` moved without a character changed — T4 rewrites it, and a diff of T3 must show it as a pure move.

Style block — replace `:561-576` and `:579` (keep `:577-578` `.banner-error`/`.banner-info` and `:580-591` `.sr-only` verbatim):
```css
  .page { max-width: 800px; /* ref 1265-1266: 760px content column + 20px padding each side; reset.css:1 is border-box, so the outer max is 800 for the inner to be 760 */ margin: 0 auto; padding: 18px 20px 24px; /* ref 1265 */ }
  header { display: flex; flex-direction: column; }
  /* Breadcrumb — ref 1267. base.css paints links --primary; the crumbs read as chrome. */
  .breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-bottom: 10px; /* ref 1267 */ flex-wrap: wrap; }
  .breadcrumb a { color: var(--muted); }
  .breadcrumb .sep { color: var(--faint); /* ref 1267 — separators are the token's documented role */ }
  .breadcrumb .current { color: var(--text); }
  .title-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; /* ref 1268 */ flex-wrap: wrap; /* 320px viewports: a long block title + the nowrap pill need it */ }
  .title-row h1 { flex: 1; min-width: 0; overflow-wrap: anywhere; /* 5(c): a long unbreakable title shrinks instead of pushing the pill out (PageItem.svelte:80 precedent) */ }
  .deadlines { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; /* ref 1272 */ flex-wrap: wrap; /* 5(b): the mono aside drops under the sentence at narrow widths */ }
  .deadline { font-size: 12.5px; color: var(--muted); margin: 0; /* ref 1273 */ }
  .deadline strong { font-weight: 600; }
  .deadline-resub { color: var(--status-needs-revision-fg); /* ref 1273 — the one amber: names the revision the student must act on */ }
  .deadline-soft { font-size: 11.5px; color: var(--muted); margin: 0; /* ref 1274 */ }
  /* Assignment card — ref 1277-1280. Content typography is the assignment SUBSET of
     PageItem's block (paragraphs, list, link, code); headings/pre/img are not copied. */
  .assignment { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 16px 18px; margin-bottom: 14px; /* ref 1277 */ }
  .assignment h2 { font-size: 14px; margin: 0 0 8px; /* ref 1278 */ }
  .assignment-html { overflow-wrap: anywhere; /* PageItem.svelte:80 precedent */ }
  .assignment-html :global(p) { font-size: 14px; line-height: 1.65; color: var(--text-2); margin: 0 0 10px; /* ref 1279 */ }
  .assignment-html :global(p:last-child) { margin-bottom: 0; /* ref 1280 */ }
  .assignment-html :global(a) { color: var(--primary); }
  .assignment-html :global(ul), .assignment-html :global(ol) { padding-left: var(--space-4); margin: 0 0 10px; }
  .assignment-html :global(ul > li) { list-style: disc; /* reset.css:16 strips markers (PageItem.svelte:99-100 split form) */ }
  .assignment-html :global(ol > li) { list-style: decimal; }
  .assignment-html :global(code) { font-family: var(--font-mono); }
  /* Group + submit grid — ref 1283-1285. auto-fit collapses to one column under ~600px (5(b)). */
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 14px; /* ref 1283 */ }
  .group-block, .submit-block { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 14px 16px; /* ref 1284 */ }
  .group-block h2, .submit-block h2 { font-size: 13px; margin: 0 0 8px; /* ref 1285 */ }
  .members { font-size: 13px; line-height: 1.7; color: var(--text-2); margin: 0; /* ref 1286 */ }
  .group-notice { font-size: 12.5px; color: var(--text-3); margin: 6px 0 0; /* 5(b): the hint scale; `.notice` is scoped in InteractiveAppItem, hence the name */ }
  /* Submission history — ref 1297-1332, D6 uniform card per entry. */
  .history h2 { font-size: 14px; margin: 0 0 10px; /* ref 1297 */ }
  .history-entry { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; margin-bottom: 10px; /* ref 1298 */ }
  .history-entry:last-child { margin-bottom: 0; }
  .history-entry-header { display: flex; align-items: center; gap: 9px; padding: 9px 12px; /* ref 1299 */ background: var(--surface-2); border-bottom: 1px solid var(--border-soft); /* #E9EBEF → --border-soft (spec substitution table: the exact-hex token is a state token) */ flex-wrap: wrap; }
  .history-entry-header h3 { font-size: 13px; margin: 0; /* ref 1300 */ }
  .entry-meta { font-size: 11.5px; color: var(--muted); /* ref 1301; `.meta` is scoped in CourseCard/QuizItem, hence the name */ }
  .pills { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1302 */ }
  /* Late pill — ref 1320 geometry (StatusPill's ref-1112 scale); GREY per D3, not the artboard's amber:
     "needs revision" is the only amber in the product (mathion-visual-spec.md:132-133). */
  .pill-late { padding: 3px 8px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 500; white-space: nowrap; background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .history-entry-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; /* ref 1304 */ }
  .file { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-3); /* ref 1305 — #FCFCFD exact */ }
  .file-kind { display: flex; align-items: center; justify-content: center; width: 32px; height: 28px; border-radius: 4px; /* ref 1306 */ background: var(--surface-2); /* #F0F1F4 → --surface-2 (substitution table: a background wants a surface token) */ font-size: 9.5px; font-weight: 600; color: var(--muted); flex: 0 0 auto; }
  .file-name { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; /* ref 1307 */ }
  .file-name .name { font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
  .file-name .size { font-size: 11.5px; color: var(--muted); }
  .dl { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-3); flex: 0 0 auto; /* ref 1308 */ }
  .dl:hover { text-decoration: none; color: var(--text); }
  /* Feedback block — ref 1310-1312. The rule colour is the result's pill BACKGROUND token
     (the artboard's #FDECC8 is the pill background, not its text); the --border default is
     unreachable (every result maps to one of the three) and exists so the rule is never colourless. */
  .feedback { border-left: 3px solid var(--border); padding: 2px 0 2px 11px; display: flex; flex-direction: column; gap: 5px; /* ref 1310 */ }
  .feedback.needs-revision { border-color: var(--status-needs-revision-bg); }
  .feedback.rejected { border-color: var(--status-rejected-bg); }
  .feedback.accepted { border-color: var(--status-accepted-bg); }
  .feedback-meta { font-size: 12.5px; color: var(--muted); margin: 0; /* ref 1311 */ }
  .feedback-text { font-size: 13px; line-height: 1.6; color: var(--text-2); text-wrap: pretty; margin: 0; /* ref 1312 */ }
  .feedback-file { font-size: 12.5px; /* 5(b): a text link at the meta scale — no artboard counterpart */ }
  /* T4 replaces the two rules below together with the submit section's inner markup (spec §3.9);
     kept here so the relocated section renders correctly between the T3 and T4 commits. */
  .banner-error { padding: var(--space-3); border: 1px solid var(--danger, #c33); border-radius: 4px; background: var(--danger-bg, #fee); }
  .banner-info { padding: var(--space-2); border: 1px solid var(--info, #ccd); border-radius: 4px; background: var(--info-bg, #eef); margin-top: var(--space-2); }
```
(Those two are the existing `:577`-`:578` lines, untouched — their hex fallbacks are the reason the "no hex fallback" gate assertion is a T4 assertion.) Deleted: old `.page`, `header` (gap/margin), `.breadcrumb .sep` (`--muted`), `.deadlines` (`color`), `.deadline-resub strong`, `.assignment-html` margin, `.group-block` (fallback), `.group-disabled`, `.group-disabled-notice`, `.history`, old `.history-entry`, old `.history-entry-header`/`h3`, old `.submit-block`.

Also update the header comment block at `:1-20` where it says `header (breadcrumb + H1 + StatusPill + deadline summary)` — append `; Slice-4 (2026-09-06) restyled every D5 block to artboard 9c` so the file's own summary is not stale.

- [ ] **Step 4: Backlog item** `docs/backlog/mp-can-submit-null-guard-is-dead.md` (the `backlog` skill's frontmatter, as in the existing items):
```markdown
---
worth: yes
where: frontend/src/pages/MiniProjectDetailPage.svelte:477
added: 2026-09-06
---
# `data.can_submit !== null` is a dead comparison

The submit section's render guard is `data.group !== null && data.can_submit !== null`, but
`StudentMiniProjectDetail.can_submit` is typed `boolean` (`frontend/src/lib/types.ts:524`), so the
second conjunct is always true and the guard is really just `data.group !== null`. The comment above
it ("can_submit has been resolved (true OR false with a reason)") describes a tri-state the wire type
does not have.

Carried as-is through Slice 4 (2026-09-06) on purpose: that slice is a restyle and its cleanup budget
is the enumerated list in its spec; changing a render predicate inside it would be an unenumerated
behaviour change. The fix is one line (drop the conjunct, reword the comment) plus the matching
test-comment tweak — but it should land as its own commit so the intent is reviewable.
```
(Re-read `types.ts` at that line before writing: if `can_submit` is `boolean | null` after all, the item is wrong and must NOT be written — report that to the user instead.)

- [ ] **Step 5: Run — expect PASS.** `npm test -- MiniProjectDetailPage`, then the full `npm test`.

- [ ] **Step 6: Mutation checks.** (a) Move the Late pill inside `<h3>` → scenario 7 AND the T3 "entry header" test fail; restore. (b) Drop `aria-current="page"` → the breadcrumb test fails; restore. (c) Swap `<strong>` to `<span>` on `is_me` → the group test fails; restore. (d) Drop the `showResub ||` conjunct → the "resubmission line wins" test fails; restore.

- [ ] **Step 7: Gate-script section (s).** The MP page's hash changes with the style block; derive it from `.history-entry-header` (authored only here — verify with the ownership grep) and pin:
```zsh
echo
echo "--- (s) Slice-4 T3 mini-project page (frame, header, assignment, group, history) ---"
owners=(${(f)"$(grep -rlE '^[[:space:]]*\.history-entry-header[[:space:]]*[,{]' src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == 'MiniProjectDetailPage.svelte' ]]; then
  echo "PASS  .history-entry-header is authored by MiniProjectDetailPage.svelte alone"
else
  echo "FAIL  .history-entry-header owner is not MiniProjectDetailPage.svelte alone (${#owners[@]}: $owners)"; fail=1
fi
mp=(${(f)"$(grep -ohE '\.history-entry-header\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#mp[@]} -ne 1 ]]; then
  echo "FAIL  MP anchor not dist-unique (${#mp[@]}: $mp)"; fail=1
else
  echo "PASS  MP page resolves to one hash ($mp[1])"
  N=MP; H=$mp[1]
  d '\.page' '' 'max-width:800px' 'padding:18px 20px 24px'
  d '\.breadcrumb' '' 'gap:8px' 'font-size:12\.5px' 'color:var\(--muted\)' 'margin-bottom:10px' 'flex-wrap:wrap'
  chk "\.breadcrumb\.${H} a:where\(\.${H}\)"        'color:var\(--muted\)'
  chk "\.breadcrumb\.${H} \.sep:where\(\.${H}\)"     'color:var\(--faint\)'
  chk "\.breadcrumb\.${H} \.current:where\(\.${H}\)" 'color:var\(--text\)'
  d '\.title-row' '' 'gap:12px' 'margin-bottom:6px' 'flex-wrap:wrap'
  chk "\.title-row\.${H} h1:where\(\.${H}\)" 'flex:1' 'min-width:0' 'overflow-wrap:anywhere'
  d '\.deadlines' '' 'gap:14px' 'margin-bottom:18px' 'flex-wrap:wrap'
  d '\.deadline' '' 'font-size:12\.5px' 'color:var\(--muted\)' 'margin:0'
  d '\.deadline-resub' '' 'color:var\(--status-needs-revision-fg\)'
  d '\.deadline-soft' '' 'font-size:11\.5px'
  d '\.assignment' '' 'padding:16px 18px' 'margin-bottom:14px' 'border:1px solid var\(--border\)'
  chk "\.assignment\.${H} h2:where\(\.${H}\)" 'font-size:14px' 'margin:0 0 8px'
  d '\.assignment-html' '' 'overflow-wrap:anywhere'
  chk "\.assignment-html\.${H} p"            'font-size:14px' 'line-height:1\.65' 'color:var\(--text-2\)' 'margin:0 0 10px'
  chk "\.assignment-html\.${H} p:last-child" 'margin-bottom:0'
  chk "\.assignment-html\.${H} a"            'color:var\(--primary\)'
  chk "\.assignment-html\.${H} ul>li"        'list-style:disc'
  chk "\.assignment-html\.${H} ol>li"        'list-style:decimal'
  chk "\.assignment-html\.${H} code"         'font-family:var\(--font-mono\)'
  d '\.grid2' '' 'display:grid' 'grid-template-columns:repeat\(auto-fit,minmax\(280px,1fr\)\)' 'gap:14px' 'margin-bottom:14px'
  chk "\.group-block\.${H},\.submit-block\.${H}"  'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'padding:14px 16px'
  chk "\.group-block\.${H} h2:where\(\.${H}\),\.submit-block\.${H} h2:where\(\.${H}\)" 'font-size:13px' 'margin:0 0 8px'
  d '\.members' '' 'font-size:13px' 'line-height:1\.7' 'color:var\(--text-2\)' 'margin:0'
  d '\.group-notice' '' 'font-size:12\.5px' 'color:var\(--text-3\)' 'margin:6px 0 0'
  chk "\.history\.${H} h2:where\(\.${H}\)" 'font-size:14px' 'margin:0 0 10px'
  d '\.history-entry' '' 'overflow:hidden' 'margin-bottom:10px' 'border:1px solid var\(--border\)'
  d '\.history-entry' ':last-child' 'margin-bottom:0'
  chk "\.history-entry-header\.${H} h3:where\(\.${H}\)" 'font-size:13px' 'margin:0'
  d '\.history-entry-header' '' 'gap:9px' 'padding:9px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border-soft\)' 'flex-wrap:wrap'
  d '\.entry-meta' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.pills' '' 'margin-left:auto' 'gap:6px'
  d '\.pill-late' '' 'padding:3px 8px' 'border-radius:var\(--radius-pill\)' 'font-size:11px' 'font-weight:500' 'white-space:nowrap' 'background:var\(--status-not-submitted-bg\)' 'color:var\(--status-not-submitted-fg\)'
  none "MP Late pill is not amber (D3)"    "\.pill-late\.${H}\{[^}]*needs-revision"
  d '\.history-entry-body' '' 'padding:12px' 'gap:10px'
  d '\.file' '' 'gap:9px' 'padding:8px 10px' 'background:var\(--surface-3\)'
  d '\.file-kind' '' 'width:32px' 'height:28px' 'border-radius:4px' 'background:var\(--surface-2\)' 'font-size:9\.5px' 'font-weight:600'
  d '\.dl' '' 'width:24px' 'height:24px' 'border:1px solid var\(--border-strong\)' 'color:var\(--text-3\)'
  d '\.feedback' '' 'border-left:3px solid var\(--border\)' 'padding:2px 0 2px 11px' 'gap:5px'
  d '\.feedback\.needs-revision' '' 'border-color:var\(--status-needs-revision-bg\)'
  d '\.feedback\.rejected' ''       'border-color:var\(--status-rejected-bg\)'
  d '\.feedback\.accepted' ''       'border-color:var\(--status-accepted-bg\)'
  chk "\.file-name\.${H} \.name:where\(\.${H}\)" 'font-size:12\.5px' 'color:var\(--text\)' 'overflow-wrap:anywhere'
  chk "\.file-name\.${H} \.size:where\(\.${H}\)" 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.dl' ':hover' 'text-decoration:none' 'color:var\(--text\)'
  d '\.feedback-meta' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.feedback-text' '' 'font-size:13px' 'line-height:1\.6' 'color:var\(--text-2\)' 'text-wrap:pretty'
  # Constraint 1/2 deletions — paired with the positives above on the same hash.
  # (The "no hex fallback in var()" none lives in section (t): .banner-error/.banner-info
  #  keep theirs until T4, so it would be red here for a state the spec permits.)
  none "MP no opacity dim (group-disabled gone)"     "\.[a-z-]+\.${H}\{[^}]*opacity:\.?[0-9]"
  none "MP no --warning fallback"                    "\.[a-z-]+\.${H}[^{]*\{[^}]*var\(--warning"
  none "MP no .group-disabled rule"                  "\.group-disabled(-notice)?\.${H}"
fi
```
Bump `EXPECTED_CHECKS` by the printed count. Mutation-test: change `--status-not-submitted-bg` to `--status-needs-revision-bg` on `.pill-late` → the D3 `none` reds; re-add `.group-disabled { opacity: 0.7 }` → two `none`s red; restore.

- [ ] **Step 8: Full gate.** Autofixer → `npm test` → `npm run check` (0 / ≤31) → gate ALL PASS.

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/pages/MiniProjectDetailPage.svelte frontend/src/tests/MiniProjectDetailPage.svelte.test.ts \
        docs/backlog/mp-can-submit-null-guard-is-dead.md frontend/scripts/visual-refresh-gate.sh
git commit -m "feat(frontend): Slice-4 T3 — mini-project page frame, header, assignment, group, history (9c)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 10: Review.** Both lanes; §3.1-3.4, §3.7-3.9, (B)4-8/10, (C)17/19-21, D3/D6/D8/D9. **This round's correctness-axis prompt** (spec §Testing): 320px width (grid collapses, title wraps, aside drops), a 24-character status label in the strip, an eight-member group, an assignment with a list. Fix, re-review, user OK.

---

## Task 4 — T4: mini-project page — submit card

**Files:**
- Modify: `frontend/src/pages/MiniProjectDetailPage.svelte` (script: `isDragOver`, `acceptFile` split, three drag handlers, two message strings; template: the submit section's inner markup; style: `.submit-block.can`, `.submit-row`, `.drop*`, `.submit-error`, `.precondition`; delete `.banner-error`, `.banner-info`)
- Modify: `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (the T4 migrations from enumerated 21 + new tests)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (t))

**Spec:** §3.5, §3.6, §3.9 T4 rows, (A)1, (B)9/11, (C)18, D5, Constraint 2 (the sr-only annotation).

**Interfaces:**
- Consumes T1 `ErrorState` (inline, `onretry`), `Button` (`variant="primary"`, `disabled`, `loading`, `title`, `onclick`), T3's grid cell + shared card rule.
- Produces: nothing downstream. Test seams after T4: `mp-submit-section`, `mp-file-input`, `mp-submit-error`, `mp-cannot-submit`; the submit button is `.submit-row .btn.primary`; Retry is `[data-testid="mp-submit-error"] .btn`.

- [ ] **Step 1: Test migrations + new tests.**

Migrations (pre-edit line numbers):
- `:405` `expect(target.querySelector('.banner-error')).toBeNull();` → `expect(target.querySelector('[data-testid="mp-submit-error"]')).toBeNull();` (comment `// Banner: none on success.` stays).
- `clickSubmit()` helper (`:373-377`) and every `button[data-testid="mp-submit-btn"]` query (`:407`, `:415`, `:463`, `:574`, `:642`, plus the helper) → `'.submit-row .btn.primary'`. Cast stays `<HTMLButtonElement>`.
- `:449-451`: `const bannerP = banner.querySelector('p');` → `const bannerMsg = banner.querySelector('.message');`, the throw text → `'expected .message inside 409 banner'`, `bannerP.textContent` → `bannerMsg.textContent`; comment `// The banner copy lives in a <p> child; query it` / `// directly so an incidental Retry button (none on 409, but defensive)` → `// The banner is ErrorState inline: the title is a <p> too, so query .message` / `// directly — a <p> query would return the constant title`.
- `:495` `banner.querySelector<HTMLButtonElement>('button[data-testid="mp-retry-btn"]')` → `banner.querySelector<HTMLButtonElement>('.btn')`; `:509` `'[data-testid="mp-retry-btn"]'` → `'.btn'`.
- `:493`/`:508` `expect(banner.textContent).toContain("Couldn't submit");` — still true (constant title); leave, but ADD after each: `expect(banner.querySelector('.message')!.textContent).toBe("The upload didn't go through. Nothing has been lost — retrying sends the same file.");`

New tests (append):
```ts
// ---- Slice-4 T4 — drop zone (D5 / enumerated (A)1) ----

function dropEvent(type: 'dragover' | 'dragleave' | 'drop', files: File[] = []): Event {
  // jsdom has no DragEvent / DataTransfer constructor; a plain Event with a
  // synthetic dataTransfer carries what the handlers read.
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    configurable: true,
    value: { files: Object.assign(files.slice(), { item: (i: number) => files[i] ?? null }) },
  });
  return e;
}

// jsdom throws InvalidStateError when a file input's `value` is set to a
// non-empty string (the spec's "filename" mode); D6.10 works around it the same
// way. After the defineProperty fallback the production `fileInputEl.value = ''`
// writes the own data property, which is what the assertions read back.
function setFileInputValue(input: HTMLInputElement, v: string): void {
  try {
    input.value = v;
  } catch {
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: v });
  }
  expect(input.value).toBe(v);
}

function dropZone(): HTMLLabelElement {
  const z = target.querySelector<HTMLLabelElement>('label.drop');
  if (!z) throw new Error('expected label.drop');
  return z;
}

describe('MiniProjectDetailPage (Slice-4 T4 — submit card)', () => {
  it('can-submit card: emphasised class, drop label wraps the input, Submit is a primary Button with the pick hint', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const section = target.querySelector('[data-testid="mp-submit-section"]')!;
    expect(section.classList.contains('can')).toBe(true);
    expect(section.querySelector('h2')!.textContent).toBe('Submit');
    const zone = dropZone();
    expect(zone.querySelector('input[type="file"][data-testid="mp-file-input"]')).not.toBeNull();
    expect(zone.querySelector('.drop-label')!.textContent).toBe('Drop a PDF or click to pick');
    expect(zone.classList.contains('has-file')).toBe(false);
    const btn = section.querySelector<HTMLButtonElement>('.submit-row .btn.primary')!;
    expect(btn.textContent?.trim()).toBe('Submit');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Pick a PDF first');
    expect(section.querySelector('.banner-error, .banner-info')).toBeNull();
  });

  it('picking a file swaps the label for the filename and clears the hint', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    await pickFile(makePdf('thesis.pdf'));
    const zone = dropZone();
    expect(zone.classList.contains('has-file')).toBe(true);
    expect(zone.querySelector('.drop-label')!.textContent).toBe('thesis.pdf');
    const btn = target.querySelector<HTMLButtonElement>('.submit-row .btn.primary')!;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('title')).toBeNull();
  });

  it('dragover lights the zone and is cancelled; dragleave clears it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    const zone = dropZone();
    const over = dropEvent('dragover');
    zone.dispatchEvent(over);
    flushSync();
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains('dragover')).toBe(true);
    zone.dispatchEvent(dropEvent('dragleave'));
    flushSync();
    expect(zone.classList.contains('dragover')).toBe(false);
  });

  it('drop selects the first file through the same path as the picker and submits it', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    vi.mocked(submit).mockResolvedValue(undefined);
    await mountPage();
    const zone = dropZone();
    const drop = dropEvent('drop', [makePdf('dropped.pdf'), makePdf('second.pdf')]);
    zone.dispatchEvent(drop);
    await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(zone.classList.contains('dragover')).toBe(false);
    expect(zone.querySelector('.drop-label')!.textContent).toBe('dropped.pdf');
    clickSubmit();
    await settle();
    expect(vi.mocked(submit)).toHaveBeenCalledTimes(1);
    expect((vi.mocked(submit).mock.calls[0][1] as File).name).toBe('dropped.pdf');
  });

  it('a fileless drop is a no-op: keeps the earlier pick and the native input untouched', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    await pickFile(makePdf('kept.pdf'));
    const input = target.querySelector<HTMLInputElement>('[data-testid="mp-file-input"]')!;
    setFileInputValue(input, 'sentinel.pdf');
    dropZone().dispatchEvent(dropEvent('drop', []));
    await settle();
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('kept.pdf');
    expect(input.value).toBe('sentinel.pdf');
  });

  it('pick A → drop B → re-pick A submits A (an accepted drop clears the native input, D5)', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    vi.mocked(submit).mockResolvedValue(undefined);
    await mountPage();
    await pickFile(makePdf('a.pdf'));
    const input = target.querySelector<HTMLInputElement>('[data-testid="mp-file-input"]')!;
    setFileInputValue(input, 'a.pdf');                      // what a browser stores after the pick
    dropZone().dispatchEvent(dropEvent('drop', [makePdf('b.pdf')]));
    await settle();
    expect(input.value).toBe('');                           // cleared → the re-pick of a.pdf will fire change
    expect(dropZone().querySelector('.drop-label')!.textContent).toBe('b.pdf');
    await pickFile(makePdf('a.pdf'));
    clickSubmit();
    await settle();
    expect((vi.mocked(submit).mock.calls[0][1] as File).name).toBe('a.pdf');
  });

  it('while submitting: drop is cancelled but discarded, and dragover does not light the zone', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    let resolveSubmit: () => void = () => {};
    vi.mocked(submit).mockReturnValue(new Promise<void>((res) => { resolveSubmit = res; }));
    await mountPage();
    await pickFile(makePdf('first.pdf'));
    clickSubmit();
    await settle();
    const zone = dropZone();
    const over = dropEvent('dragover');
    zone.dispatchEvent(over); flushSync();
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains('dragover')).toBe(false);
    const drop = dropEvent('drop', [makePdf('late.pdf')]);
    zone.dispatchEvent(drop); await settle();
    expect(drop.defaultPrevented).toBe(true);
    expect(zone.querySelector('.drop-label')!.textContent).toBe('first.pdf');
    resolveSubmit(); await settle();
  });

  it('submit error renders the inline ErrorState with the constant title; network errors get Retry, guards do not', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: true }));
    await mountPage();
    await pickFile(makeTxt());
    clickSubmit(); await settle();
    const err = target.querySelector('[data-testid="mp-submit-error"] .error-state.inline');
    expect(err).not.toBeNull();
    expect(err!.querySelector('.title')!.textContent).toBe("Couldn't submit");
    expect(err!.querySelector('.message')!.textContent).toBe('Only PDF files are accepted.');
    expect(err!.querySelector('.btn')).toBeNull();
  });

  it('cannot-submit: precondition banner replaces the card body, no heading, no controls', async () => {
    vi.mocked(fetchDetail).mockResolvedValue(makeDetail({ can_submit: false, can_submit_reason_if_not: 'awaiting_evaluation', latest_status: 'awaiting_evaluation' }));
    await mountPage();
    const section = target.querySelector('[data-testid="mp-submit-section"]')!;
    expect(section.classList.contains('can')).toBe(false);
    const pre = section.querySelector('.precondition[data-testid="mp-cannot-submit"]');
    expect(pre).not.toBeNull();
    expect(pre!.textContent?.trim()).toBe(REASON_LABELS.awaiting_evaluation);
    expect(section.querySelector('h2')).toBeNull();
    expect(section.querySelector('input, .btn')).toBeNull();
  });
});
```
Add `REASON_LABELS` to the `'../lib/studentMiniProjects'` import in the test (the mock re-exports the real one).

- [ ] **Step 2: Run — expect FAIL.** `npm test -- MiniProjectDetailPage`.

- [ ] **Step 3: Implement.**

Script:
- After `let submitErrorIsNetwork = $state(false);` add:
  ```ts
  // Slice-4 D5 — drop-zone highlight. Drag handlers below cancel the browser's
  // default FIRST and unconditionally (an uncancelled drop opens the file and
  // navigates away), then gate everything else on not submitting.
  let isDragOver = $state(false);
  ```
- Replace `handleFileChange` (`:260-268`) with:
  ```ts
  // Single entry point for a picked OR dropped file (D5): selectedFile is the
  // one source of truth for what gets submitted; the .pdf / size guards run
  // in handleSubmit, so both paths get them identically.
  function acceptFile(f: File | null): void {
    selectedFile = f;
    // Spec line 781: picking a new file in 'error' does NOT clear the banner
    // or change state — the student may want to retry with the same file
    // after seeing the error. Only the transition out of 'success' is here.
    if (submitState === 'success') submitState = 'idle';
  }

  function handleFileChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    acceptFile(input.files && input.files.length > 0 ? input.files[0] : null);
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    if (submitState === 'submitting') return;
    isDragOver = true;
  }

  function handleDragLeave(): void {
    isDragOver = false;
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    isDragOver = false;
    if (submitState === 'submitting') return;
    const f = e.dataTransfer?.files?.[0] ?? null;
    if (f === null) return;   // a fileless drop (text, a URL) changes nothing
    // An ACCEPTED drop clears the native input: after pick A → drop B, re-picking
    // A must fire `change` (browsers suppress it for an identical stored value),
    // else Submit would silently send B. Programmatic `.value = ''` fires no
    // `change`, so this cannot re-enter acceptFile.
    if (fileInputEl) fileInputEl.value = '';
    acceptFile(f);
  }
  ```
- `:334` and `:350`: `"Couldn't submit — retry?"` → `"The upload didn't go through. Nothing has been lost — retrying sends the same file."` (both sites; 5(b) copy modelled on ref 1381).

Template — the submit section's inner markup becomes:
```svelte
        <section class="submit-block" class:can={data.can_submit === true} data-testid="mp-submit-section">
          {#if data.can_submit === true}
            <h2>{submitHeading}</h2>
            <div class="submit-row">
              <label
                class="drop"
                class:dragover={isDragOver}
                class:has-file={selectedFile !== null}
                ondragover={handleDragOver}
                ondragleave={handleDragLeave}
                ondrop={handleDrop}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  data-testid="mp-file-input"
                  disabled={submitState === 'submitting'}
                  onchange={handleFileChange}
                  bind:this={fileInputEl}
                />
                <span class="drop-label">{selectedFile !== null ? selectedFile.name : 'Drop a PDF or click to pick'}</span>
              </label>
              <Button
                variant="primary"
                disabled={!canSubmitClick}
                loading={submitState === 'submitting'}
                onclick={handleSubmit}
                title={selectedFile === null && submitState !== 'submitting' ? 'Pick a PDF first' : undefined}
              >
                {submitState === 'submitting' ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
            {#if submitState === 'error' && submitErrorMessage !== null}
              <div class="submit-error" data-testid="mp-submit-error">
                <ErrorState title="Couldn't submit" message={submitErrorMessage} onretry={submitErrorIsNetwork ? handleSubmit : undefined} />
              </div>
            {/if}
          {:else if data.can_submit_reason_if_not !== null}
            <div class="precondition" data-testid="mp-cannot-submit">{REASON_LABELS[data.can_submit_reason_if_not]}</div>
          {/if}
        </section>
```
(If `svelte-check` reports `string | null` is not assignable to `message?: string` — the `{#if … !== null}` guard normally narrows the `$state` variable — pass `message={submitErrorMessage ?? undefined}` instead; do not widen the primitive's prop type.)

Style — delete `.banner-error` and `.banner-info`; add after `.group-notice`:
```css
  /* Submit card, can submit — ref 1288-1293. The only card with an emphasised border: it is the one action on the page. */
  .submit-block.can { border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); /* ref 1288 */ }
  .submit-block.can h2 { margin-bottom: 9px; /* ref 1289 */ }
  .submit-row { display: flex; align-items: center; gap: 9px; /* ref 1290 */ }
  .drop { position: relative; /* anchors the absolutely-positioned hidden input (Login.svelte:134) */ flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; border: 2px dashed var(--border-strong); border-radius: var(--radius); padding: 4px 9px; font-size: 12.5px; color: var(--muted); /* ref 1291 */ cursor: pointer; }
  .drop > * { pointer-events: none; /* 5(c): dragleave fires when the pointer crosses onto a child, which would blink the highlight between dragover ticks; with the children inert the label is the only drag target. Click-to-pick is unaffected — label activation reaches the input through label semantics, not hit-testing */ }
  .drop input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: -1px; }        /* visually-hidden file input (sr-only, not a disabled treatment — Login.svelte:137 idiom) */
  .drop.has-file .drop-label { color: var(--text); overflow-wrap: anywhere; /* a picked filename is content, not a hint */ }
  .drop.dragover { border-color: var(--primary); background: var(--primary-soft); /* 5(b): the affordance the artboard cannot show */ }
  .drop input:focus-visible { box-shadow: none; }                                                /* suppress the global :focus-visible glow (base.css:21-25) on the hidden input */
  .drop:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }                 /* redraw it on the label */
  /* Forced-colors drops background-color AND box-shadow: restore the focus ring and the
     drag highlight with outlines (forced-colors keeps outlines). Highlight is a system colour
     under Constraint 1's forced-colors exemption. */
  @media (forced-colors: active) {
    .drop:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
    .drop.dragover { outline: 2px dashed; }
  }
  .drop:has(input:disabled) { background: var(--bg); border-color: var(--border-faint); color: var(--faint); cursor: not-allowed; /* mathion-visual-spec.md:159 disabled recipe — tokens, no opacity */ }
  .submit-error { margin-top: 10px; /* 5(b): the history body gap */ }
  /* Precondition banner — mathion-visual-spec.md:289-293. */
  .precondition { border-left: 3px solid var(--primary); background: var(--surface-2); padding: 14px 16px; /* 5(b): no artboard box for this banner — matches the inline-state row, ref 1378 */ font-size: 13px; line-height: 1.55; color: var(--text-3); /* ref 1373 */ border-radius: var(--radius); }
```
Remove the T3 "T4 replaces the two rules below" comment with the rules.

- [ ] **Step 4: Run — expect PASS.** `npm test -- MiniProjectDetailPage`, then the full `npm test` (D6.1-D6.17 must all still pass with the migrated selectors).

- [ ] **Step 5: Mutation checks.** (a) Remove `if (fileInputEl) fileInputEl.value = '';` from `handleDrop` → the "pick A → drop B → re-pick A" test fails; restore. (b) Move `e.preventDefault()` in `handleDrop` below the submitting guard → the "while submitting" test fails on `defaultPrevented`; restore. (c) Remove the `f === null` early return → the "fileless drop" test fails; restore. (d) Remove `onretry=` → D6.4 fails; restore.

- [ ] **Step 6: Gate-script section (t)** (same `mp` hash derivation as (s) — re-run it here, since the hash changed again):
```zsh
echo
echo "--- (t) Slice-4 T4 submit card ---"
mp=(${(f)"$(grep -ohE '\.history-entry-header\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#mp[@]} -ne 1 ]]; then
  echo "FAIL  MP anchor not dist-unique (${#mp[@]}: $mp)"; fail=1
else
  N=MP; H=$mp[1]
  d '\.submit-block\.can' '' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  chk "\.submit-block\.can\.${H} h2:where\(\.${H}\)" 'margin-bottom:9px'
  d '\.submit-row' '' 'display:flex' 'align-items:center' 'gap:9px'
  d '\.drop' '' 'position:relative' 'flex:1' 'min-width:0' 'border:2px dashed var\(--border-strong\)' 'padding:4px 9px' 'font-size:12\.5px' 'color:var\(--muted\)' 'cursor:pointer'
  # `.drop > *` — Svelte's scoping of the universal child is not pinned to one emitted form; the
  # child part is absorbed with [^{]*, the .drop half stays hash-exact.
  chk "\.drop\.${H}>[^{]*"                                       'pointer-events:none'
  chk "\.drop\.${H} input:where\(\.${H}\)"                      'position:absolute' 'width:1px' 'height:1px' 'opacity:0' 'margin:-1px'
  chk "\.drop\.has-file\.${H} \.drop-label:where\(\.${H}\)"   'color:var\(--text\)' 'overflow-wrap:anywhere'
  d '\.drop\.dragover' '' 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  chk "\.drop\.${H} input:where\(\.${H}\):focus-visible"        'box-shadow:none'
  chk "\.drop\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'box-shadow:inset 0 0 0 2px var\(--primary\)'
  FCM="@media \(forced-colors: ?active\)\{(\.[^{]*\{[^}]*\})*"
  chk "${FCM}\.drop\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'outline:2px solid Highlight' 'outline-offset:-2px'
  chk "${FCM}\.drop\.dragover\.${H}"                                 'outline:2px dashed'
  chk "\.drop\.${H}:has\(input:where\(\.${H}\):disabled\)"    'background:var\(--bg\)' 'border-color:var\(--border-faint\)' 'color:var\(--faint\)' 'cursor:not-allowed'
  none  "MP disabled drop uses no opacity"   "\.drop\.${H}:has\(input:where\(\.${H}\):disabled\)\{[^}]*opacity"
  d '\.submit-error' '' 'margin-top:10px'
  d '\.precondition' '' 'border-left:3px solid var\(--primary\)' 'background:var\(--surface-2\)' 'padding:14px 16px' 'font-size:13px' 'line-height:1\.55' 'color:var\(--text-3\)' 'border-radius:var\(--radius\)'
  # Constraint 1: the last hex fallbacks left with .banner-error/.banner-info (paired with the positives above).
  none  "MP no hex fallback in var() anywhere" "\.[a-z-]+\.${H}[^{]*\{[^}]*var\(--[a-z-]+,#"
  none  "MP .banner-error gone"               "\.banner-error\.${H}"
  none  "MP .banner-info gone"                "\.banner-info\.${H}"
  # Old markup must not linger in source either (strip comments first).
  if sed 's#<!--.*-->##g' src/pages/MiniProjectDetailPage.svelte | grep -qE 'mp-submit-btn|mp-retry-btn|banner-(error|info)'; then
    echo "FAIL  MiniProjectDetailPage.svelte still references mp-submit-btn / mp-retry-btn / banner-*"; fail=1
  else
    echo "PASS  MiniProjectDetailPage.svelte carries no pre-Slice-4 submit seams"
  fi
fi
```
Bump `EXPECTED_CHECKS`. Mutation-test the forced-colors regex by moving the `.drop.dragover` outline rule outside the media block → red; restore.

- [ ] **Step 7: Full gate.** Autofixer → `npm test` → `npm run check` (0 / ≤31) → gate ALL PASS.

- [ ] **Step 8: Commit.**
```bash
git add frontend/src/pages/MiniProjectDetailPage.svelte frontend/src/tests/MiniProjectDetailPage.svelte.test.ts frontend/scripts/visual-refresh-gate.sh
git commit -m "feat(frontend): Slice-4 T4 — mini-project submit card: click-or-drop zone, Button, inline ErrorState (9c)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 9: Review.** Both lanes; §3.5-3.6, (A)1, (B)9/11, (C)18, D5. Fix, re-review, user OK.

---

## Close-out

- [ ] **Whole-branch review** (both lanes) over `22549e2..HEAD`: spec coverage table (every §/D/enumerated item → commit), Constraint 1-4 sweep (`grep -nE '#[0-9a-fA-F]{3,6}' frontend/src/components/ui/{Skeleton,EmptyState,ErrorState}.svelte frontend/src/pages/MiniProjectDetailPage.svelte` must hit comments only; `grep -n opacity` the same files → only the sr-only input), warnings still ≤ 31, gate ALL PASS. Fix, re-review until clean.
- [ ] **Update memory** (`project_visual_refresh.md` RESUME HERE block): Slice 4 status, commit SHAs, what is next (Authoring slice), any new lessons.
- [ ] **Browser pass (user-owned)** — hand the user the checklist from spec §Testing: `./run-slice3-surfaces.sh` + `npm run dev`; the six 9c states + pending group; submit with a dropped PDF and a picked PDF; **drop a non-PDF then press Submit** (the guard fires on Submit); the 404 fetch-error page; `/courses` skeleton (throttle) and inline error + Retry (stop/start the backend); the empty course list (user's call whether to withdraw the demo enrolment).
- [ ] Wait for the user's sign-off before starting Slice 5 (Authoring). Branch stays LOCAL.
