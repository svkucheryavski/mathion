# Visual Refresh — Slice 5a: Authoring — Versions + Version Editor (3a + 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the authoring Versions page (3a) and the version editor (3b) to the visual-refresh reference: per-field inline editing, fixed icon slots with disabled reasons, foldable panels, heading-wrapped accordions, and drafts that a confirmed "Discard unsaved changes?" really discards.

**Architecture:** One new shared primitive, `ui/InlineField.svelte`, replaces every panel-level Save/Discard in the version editor (each field PATCHes on its own). `IconButton` and `EmptyState` gain the variants the artboards need; `lib/editorReasons.ts` owns every disabled-reason string; the dirty registry gains `discard()` / `discardAll()` and `DirtyGuard` an `onDiscard` hook. The block/sequence accordions get `<h3>`/`<h4>` headers with always-rendered arrows, body delete footers, and a navigate-first delete order that removes a spurious "not found" toast. No backend, API, route or store change.

**Tech Stack:** Svelte 5.55 runes + TypeScript, Vite, vitest + jsdom (`mount`/`unmount`/`flushSync` from `svelte`), the zsh gate `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-06-visual-refresh-slice5a-authoring-versions-design.md` (rev 9, commit `1b402b6`, user-approved 2026-10-06). Read it with this plan; § and D-numbers below refer to it.

**Branch:** `feat/visual-refresh-slice5-authoring` (off the Slice-4 tip `6fff756`). LOCAL — never push, never merge.

## How this plan was made (and how to read it)

Every code block below was executed before the plan was written: each task's end state was built in a scratch copy of `frontend/`, and the full suite, `svelte-check` and the gate were run **at every task boundary** (numbers in each task's verification step are the measured ones). Reviewer probes (deliberate mutations) were run against every task's tests and gate section; each probe listed under a task was confirmed to fail a test or a gate check. Code is given either as a **full file** (new files and rewrites) or as a **`git apply` patch** against the previous task's state — apply tasks in order.

For a design review without reading code, read the **task summaries** (the paragraph under each task heading) and the **Review Focus** list.

## Global Constraints

Every task's requirements implicitly include these (spec §Global Constraints, verbatim values):

1. **Colours → tokens.** No hardcoded hex outside comments; no new colour tokens. Delete every pre-existing hex literal in the touched files (`VersionsPage` `.badge.*`; `VersionEditPage` `.state-*`/`.banner`/`.banner.err`; `AccordionHeader` `#f5f5f5`). Forced-colors system colours inside `@media (forced-colors: active)` are exempt.
2. **No opacity-based disabled/dim.** Disabled rows recede via tokens only (D5). `ItemTypePicker`'s visually-hidden radio (`opacity: 0` + `position:absolute` + `pointer-events:none`) is the sr-only idiom — keep and annotate it.
3. **No emoji, no decorative glyphs.** New SVGs: `aria-hidden="true"`, `viewBox="0 0 16 16"`, `stroke="currentColor"`, `stroke-width` 1.6 (1.9 for the check), round caps/joins.
4. **Mono for every numeral** via the global `.mono` class: `v7`, the versions count, B/S code badges, slugs, the max-attempts value, `N questions`.
5. **Per-component literals — three forms**: (a) `/* ref NNNN */`, (b) no-ref with the scale named, (c) mechanism. Geometry only, never colour.
6. **Dense control metrics are final.** `ui/Button.svelte` as-is; `ui/Input.svelte` is not used — create-form fields stay raw `<input>`/`<textarea>` styled locally (`height: var(--control-h)`).
7. **`ItemMark` is used as-is** (`state="not-yet"` is the 3b item tile). `ItemIcon` is not used.
8. **No backend/API/schema/route change.** `routes.ts` untouched; the item route stays until 5b.
9. **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — **no `Claude-Session` line**. `git add` exact named paths only, never `-A`/`.`.
10. **Process.** Per task: implement → first-party Opus review + second lane (codex@high when available; otherwise an independent second reviewer) on the **UNCOMMITTED** diff → fix every Critical/Important → re-review until both lanes are clean → commit. Gate stays ALL PASS with `EXPECTED_CHECKS` = printed count. Polish/taste findings → one file each in `docs/backlog/`. User browser pass + explicit OK closes the slice.

## Review Focus

The five inputs the spec implies that are most likely to bite a real author, each pinned by a test in the owning task:

1. **A save still in flight when its field closes** (a confirmed navigation discards it, or Publish makes the version read-only): the field must reopen writable, and a late failure must surface exactly once as a toast — never silently, never as an inline error on a closed field. → T1 `InlineField` tests "discard during an in-flight commit …", "while busy: …", "a late failure after unmount still toasts".
2. **Deleting the block or sequence you are looking at**: one confirm, no second "Discard unsaved changes?" prompt, no "Block not found." / "Sequence not found." toast, and Back does not land on the deleted URL. → T5b page tests in `VersionEditPage.svelte.test.ts` (fail with the old reload-then-navigate order) + the accordions' "navigates … BEFORE the reload" tests asserting `history.replaceState`.
3. **Leaving with an open draft and confirming**: the drafts really go, so the next navigation does not prompt again. → T3 "a confirmed navigation discards the open draft", T4 create-block discard, T5b create-sequence `discardAll`.
4. **Switching version (Back/forward) while a mutation is in flight**: nothing reloads or navigates for the old version — but a sequence delete must still reload after its block merely collapsed. → T5b "a late delete after a version change …", "a late title commit after a version change …", "a sequence delete still reloads after the parent block collapsed".
5. **Keyboard while saving**: Enter cannot send a second PATCH; Escape cannot close mid-commit nor escape an enclosing modal; a number typed as `3.0` against a saved `3` is "unchanged". → T1 "Enter / Escape / ✓ / ✕ while busy …", "number: a draft equal in value …".

## Conventions

- **Directories.** `npm` and `zsh scripts/…` commands run in `frontend/`; `git` commands run at the repo root.
- **Baselines** (Slice-4 tip `6fff756`, unchanged by the spec commits): `npm test` 1396 passed; `npm run check` 0 errors / 31 warnings; gate `EXPECTED_CHECKS=489`.
- **Test pattern.** `mount` / `unmount` / `flushSync` from `svelte` — never `@testing-library/svelte`. Reactive props are a `$state({...})` object (files are `.svelte.test.ts`). Delegated events need `bubbles: true`.
- **Running tests.** Whole suite: `npm test` (it prepends `TZ=Europe/Copenhagen`). Single files: `TZ=Europe/Copenhagen npx vitest run src/tests/<file>` — bare `npx vitest` fails `datetime.test.ts` on purpose.
- **Type check.** `npm run check` → 0 errors; warnings must not exceed the task's stated number.
- **Gate.** `zsh scripts/visual-refresh-gate.sh` runs `npm run build` itself and greps `dist/_app/*.css`; the last line must read `VISUAL-REFRESH GATE: ALL PASS (N checks)` with `EXPECTED_CHECKS=N`. Existing helpers: `check`/`none` (regex present/absent), `d SEL SUF DECL…` (hash-coupled rule `SEL.svelte-H SUF{…DECL…}` using globals `N`, `H`), `chk PREFIX DECL…`. T2 adds `own ANCHOR FILE` (anchor authored by one file), `uniq1 ANCHOR` (one dist hash → `REPLY`) and `sweep LABEL HASH` (no hex, no opacity dim). A primitive's CSS is pinned in its **first consumer's** task (Vite emits no CSS for an unimported component).
- **Applying code.** Full files: write verbatim. Patches: run the shown `git apply` heredoc from the repo root (a patch that does not apply means the tree drifted from the previous task — stop and reconcile).
- **Review loop (every task, Step "Review").** Run both lanes on the **uncommitted** diff (`git status`, `git diff`, plus new files): a first-party Opus reviewer at high effort, and codex at `model_reasoning_effort=high` (or, if codex is unavailable, an independent second Opus/Fable reviewer). Give reviewers the spec, this task's section, and the Review Focus. Fix every Critical/Important, then re-run **both** lanes; repeat until clean. Never skip a round. Wait for the user's explicit OK before marking a task complete.
- **Commit.** `git add` exactly the paths in the task's **Files** list, then `git commit` with the given message and the trailer from Constraint 9.

## File structure

| file | status | task(s) | responsibility |
|---|---|---|---|
| `frontend/src/components/ui/InlineField.svelte` | new | T1 | one field: closed text ↔ open editor, own commit, generation guard, dirty tracker |
| `frontend/src/components/ui/IconButton.svelte` | modify | T1 | + glyphs `back`/`check`/`chevron-right`, `round`, `primary`, forwarded attrs, bindable `element` |
| `frontend/src/components/ui/EmptyState.svelte` | modify | T1 | + optional icon tile, hint, action |
| `frontend/src/components/editor/VersionBadges.svelte` | new | T1 | lifecycle + disabled badges (`.vbadge`) |
| `frontend/src/lib/editorReasons.ts` | new | T1 | every disabled-reason string + the D3 confirm suffix |
| `frontend/src/lib/dirtyRegistry.svelte.ts` | modify | T1 | `RegisteredTracker.discard?`, `discardAll()` |
| `frontend/src/components/editor/DirtyGuard.svelte` | modify | T1 | `onDiscard?` after a confirmed prompt |
| `docs/backlog/global-focus-ring-invisible-in-forced-colors.md` | modify | T1 | D12: list the new 5a focusables |
| `frontend/src/pages/editor/VersionsPage.svelte` | rewrite | T2 | 3a: heading, collapsed create, four-slot rows, states |
| `frontend/src/styles/theme-default.css` | modify | T2 | delete the `TODO(version-slice)` comment |
| `frontend/src/components/editor/VersionMetaForm.svelte` | rewrite | T3 | Version info card: three InlineFields, fold |
| `frontend/src/pages/editor/VersionEditPage.svelte` | modify | T3, T4 | heading/banners/states (T3); Blocks card, create-block, state bar, D3 confirms (T4) |
| `frontend/src/components/editor/AccordionHeader.svelte` | rewrite | T5a | heading toggle, badge, fixed arrows, chevron (D14), `extra` |
| `frontend/src/components/editor/BlockAccordion.svelte` | modify, rewrite | T5a, T5b | header `+` (T5a); body: InlineFields, create form, delete footer, navigate-first (T5b) |
| `frontend/src/components/editor/SequenceAccordion.svelte` | modify, rewrite, modify | T5a, T5b, T6 | header (T5a); body + race guards (T5b); ItemRow call site (T6) |
| `frontend/src/components/editor/ItemRow.svelte` | rewrite | T6 | ItemMark + four icon slots |
| `frontend/src/components/editor/ItemTypePicker.svelte` | rewrite | T6 | ItemMark radio cards, focus idiom, forced colors |
| `frontend/scripts/visual-refresh-gate.sh` | modify | T2–T6 | sections (u)–(z) + `EXPECTED_CHECKS` |
| `frontend/src/tests/*` | see tasks | T1–T6 | new and rewritten tests |

---

## Task 1: Primitives — InlineField, IconButton/EmptyState additions, VersionBadges, editor reasons, discard-on-confirm

Builds every shared piece the screens need, with unit tests only (no consumer yet, so no gate section — spec §Testing). `InlineField` is the slice's core: a row that reads as text until its pencil is clicked; ✓/Enter commits through the panel's `onCommit` (which throws on failure), ✕/Escape cancels; a generation counter makes every post-`await` continuation bail if the field was closed meanwhile, while `busy` is always reset in `finally`; a late failure after a close becomes one error toast. When `disabledReason` turns non-null while open (e.g. after Publish) the field closes at once, toasting "Editing closed …" only for a dirty, non-busy draft. The dirty registry learns to *discard*, and `DirtyGuard` calls `onDiscard` after a confirmed prompt (D3).

**Files:**
- Create: `frontend/src/components/ui/InlineField.svelte`, `frontend/src/components/editor/VersionBadges.svelte`, `frontend/src/lib/editorReasons.ts`
- Modify: `frontend/src/components/ui/IconButton.svelte`, `frontend/src/components/ui/EmptyState.svelte`, `frontend/src/lib/dirtyRegistry.svelte.ts`, `frontend/src/components/editor/DirtyGuard.svelte`, `docs/backlog/global-focus-ring-invisible-in-forced-colors.md`
- Test (create): `frontend/src/tests/InlineField.svelte.test.ts`, `frontend/src/tests/VersionBadges.svelte.test.ts`, `frontend/src/tests/editorReasons.test.ts`, `frontend/src/tests/DirtyGuard.svelte.test.ts`
- Test (modify): `frontend/src/tests/IconButton.svelte.test.ts`, `frontend/src/tests/EmptyState.svelte.test.ts`, `frontend/src/tests/dirtyRegistry.test.ts`

**Interfaces:**
- Consumes: `ApiError` (`lib/api`: `displayMessage`, `validationErrors()` → `{loc,msg,type}[] | null`), `pushToast` (`stores/toasts.svelte`), `DIRTY_REGISTRY_KEY`, `registerNavigationGuard` (router).
- Produces:
  - `InlineField` props: `label: string; value: string | number; kind?: 'text'|'textarea'|'number'; editTitle: string; disabledReason?: string | null; validate?: (parsed: string | number) => string | null; required?: boolean; maxlength?: number; min?/max?/step?: number; onCommit: (parsed: string | number) => Promise<void>` (throws on failure). DOM hooks: root `div.inline-field` (`.open`, `.ta`), `span.label`, `.value`, `p.err`; buttons by `data-glyph` (`pencil` | `close` | `check`); pencil `aria-label` = `editTitle`.
  - `IconButton` glyphs `pencil | duplicate | disable | enable | trash | plus | up | down | chevron | chevron-right | close | back | check`; props `title` (required), `size?: 'sm'|'md'` (default `md`), `borderless`, `disabled`, `danger`, `round`, `primary`, `onclick`, `onmousedown`, `aria-label`, `aria-hidden`, `aria-expanded`, `aria-controls`, `id`, `tabindex`, `element = $bindable()`; root `button.icon-btn[data-glyph]`.
  - `EmptyState` props `title: string; icon?: 'list'; hint?: string; action?: Snippet`; root `.empty-state`, `p.title`.
  - `VersionBadges` props `state: 'created'|'published'|'archived'; isDisabled: boolean`; `span.vbadges > span.vbadge`.
  - `lib/editorReasons.ts`: `metaReason`, `structureReason`, `textReason`, `deleteVersionReason`, `duplicateVersionReason` — each `(v: { state; is_disabled }) => string | null`; `unsavedSuffix(anyDirty: boolean): string` (`' Unsaved edits may be lost.'` or `''`).
  - `RegisteredTracker = { readonly isDirty: boolean; discard?: () => void }`; `DirtyRegistry.discardAll(): void`.
  - `DirtyGuard` prop `onDiscard?: () => void`.

- [ ] **Step 1: Write the failing tests**

File: `frontend/src/tests/InlineField.svelte.test.ts` — full content:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Hoisted: inline vi.fn() in the factory, typed handle after the imports.
vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...real, pushToast: vi.fn() };
});

import { pushToast } from '../stores/toasts.svelte';
import InlineField from '../components/ui/InlineField.svelte';
import { ApiError } from '../lib/api';
import { DIRTY_REGISTRY_KEY, createDirtyRegistry, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';

const toastMock = vi.mocked(pushToast);

type Props = {
  label: string;
  value: string | number;
  kind: 'text' | 'textarea' | 'number';
  editTitle: string;
  disabledReason: string | null;
  required?: boolean;
  validate?: (p: string | number) => string | null;
  onCommit: (p: string | number) => Promise<void>;
};

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function render(over: Partial<Props> = {}, registry?: DirtyRegistry) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const props: Props = $state({
    label: 'Label', value: 'Old', kind: 'text', editTitle: 'Edit the label',
    disabledReason: null, onCommit: vi.fn().mockResolvedValue(undefined), ...over,
  });
  cmp = mount(InlineField, {
    target: host, props,
    context: registry ? new Map<symbol, unknown>([[DIRTY_REGISTRY_KEY, registry]]) : undefined,
  });
  flushSync();
  return props;
}

const btn = (glyph: string) => host.querySelector<HTMLButtonElement>(`button[data-glyph="${glyph}"]`);
const editor = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
const err = () => host.querySelector('p.err');
async function open() { btn('pencil')!.click(); await settle(); }
function type(v: string) {
  const e = editor()!;
  e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(k: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  const stop = vi.spyOn(ev, 'stopPropagation');
  editor()!.dispatchEvent(ev);
  flushSync();
  return { ev, stop };
}

beforeEach(() => { toastMock.mockReset(); });
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('InlineField — closed', () => {
  it('renders label, value and an enabled pencil named by editTitle', () => {
    render();
    expect(host.querySelector('.label')?.textContent).toBe('Label');
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('Old');
    const p = btn('pencil')!;
    expect(p.disabled).toBe(false);
    expect(p.getAttribute('aria-label')).toBe('Edit the label');
    expect(p.title).toBe('Edit the label');
    expect(editor()).toBeNull();
  });

  it('shows "Not set" for an empty value', () => {
    render({ value: '' });
    expect(host.querySelector('.value .not-set')?.textContent).toBe('Not set');
  });

  it('wraps a number value in .mono', () => {
    render({ kind: 'number', value: 3 });
    expect(host.querySelector('.value .mono')?.textContent).toBe('3');
  });

  it('the row is a labelled focus-parking group', () => {
    render();
    const row = host.querySelector<HTMLElement>('.inline-field')!;
    const labelId = host.querySelector('.label')!.id;
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(row.getAttribute('aria-labelledby')).toBe(labelId);
  });

  it('a disabledReason disables the pencil and becomes its title', () => {
    render({ disabledReason: 'Enable the version first' });
    const p = btn('pencil')!;
    expect(p.disabled).toBe(true);
    expect(p.title).toBe('Enable the version first');
    expect(p.getAttribute('aria-label')).toBe('Edit the label');
  });

  it('follows a value change while closed', () => {
    const props = render();
    props.value = 'New';
    flushSync();
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('New');
  });
});

describe('InlineField — open / cancel', () => {
  it('opening focuses the editor holding the value; ✕ and ✓ replace the pencil', async () => {
    render();
    await open();
    expect(editor()!.value).toBe('Old');
    expect(document.activeElement).toBe(editor());
    expect(btn('pencil')).toBeNull();
    expect(btn('close')!.getAttribute('aria-label')).toBe('Cancel editing Label');
    expect(btn('check')!.getAttribute('aria-label')).toBe('Save Label');
    expect(btn('check')!.classList.contains('primary')).toBe(true);
    expect(editor()!.getAttribute('aria-labelledby')).toBe(host.querySelector('.label')!.id);
  });

  it('✕ cancels, drops the draft and focuses the pencil', async () => {
    const props = render();
    await open();
    type('Draft');
    btn('close')!.click();
    await settle();
    expect(editor()).toBeNull();
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('Old');
    expect(document.activeElement).toBe(btn('pencil'));
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('Escape cancels, prevents default and does not propagate', async () => {
    render();
    await open();
    type('Draft');
    const { ev, stop } = key('Escape');
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(btn('pencil'));
  });

  it('keeps the draft when the value changes while open', async () => {
    const props = render();
    await open();
    type('Mine');
    props.value = 'Server';
    flushSync();
    expect(editor()!.value).toBe('Mine');
  });

  it('reopening clears a stale error', async () => {
    render({ required: true });
    await open();
    type('');
    btn('check')!.click();
    await settle();
    expect(err()).not.toBeNull();
    btn('close')!.click();
    await settle();
    await open();
    expect(err()).toBeNull();
  });
});

describe('InlineField — commit', () => {
  it('Enter commits the parsed draft, closes and focuses the pencil', async () => {
    const props = render();
    await open();
    type('New');
    const { ev } = key('Enter');
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(props.onCommit).toHaveBeenCalledWith('New');
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(btn('pencil'));
  });

  it('✓ commits too', async () => {
    const props = render();
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith('New');
  });

  it('Enter is ignored while composing', async () => {
    const props = render();
    await open();
    type('New');
    key('Enter', { isComposing: true });
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
  });

  it('textarea: plain Enter does not commit, Ctrl+Enter and Cmd+Enter do', async () => {
    const props = render({ kind: 'textarea', value: 'a' });
    await open();
    expect(editor()!.tagName).toBe('TEXTAREA');
    expect(editor()!.classList.contains('mono')).toBe(true);
    const hintId = editor()!.getAttribute('aria-describedby')!;
    expect(document.getElementById(hintId)?.textContent).toMatch(/Control or Command plus Enter/);
    type('b');
    key('Enter');
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    key('Enter', { ctrlKey: true });
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith('b');
    await open();
    type('c');
    key('Enter', { metaKey: true });
    await settle();
    expect(props.onCommit).toHaveBeenLastCalledWith('c');
  });

  it('an unchanged draft closes without calling onCommit', async () => {
    const props = render();
    await open();
    btn('check')!.click();
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it('number: a draft equal in value ("3.0" vs 3) is unchanged — not dirty, closes without onCommit', async () => {
    const reg = createDirtyRegistry();
    const props = render({ kind: 'number', value: 3, label: 'Max quiz attempts' }, reg);
    await open();
    type('3.0');
    expect(reg.isAnyDirty()).toBe(false);
    btn('check')!.click();
    await settle();
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it('number: commits a number, blank → "Enter a number", validate blocks', async () => {
    const props = render({
      kind: 'number', value: 3, label: 'Max quiz attempts',
      validate: (n) => (typeof n === 'number' && n <= 10 ? null : 'Too many'),
    });
    await open();
    expect(editor()!.getAttribute('type')).toBe('number');
    type('');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Enter a number');
    type('11');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Too many');
    expect(props.onCommit).not.toHaveBeenCalled();
    type('5');
    btn('check')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith(5);
  });

  it('required: a blank draft shows "{label} is required" and does not commit', async () => {
    const props = render({ required: true, label: 'Block title' });
    await open();
    type('   ');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Block title is required');
    expect(err()?.getAttribute('role')).toBe('alert');
    expect(editor()!.getAttribute('aria-invalid')).toBe('true');
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('typing clears the error', async () => {
    render({ required: true });
    await open();
    type('');
    btn('check')!.click();
    await settle();
    expect(err()).not.toBeNull();
    type('x');
    expect(err()).toBeNull();
  });

  it('a rejected commit (string detail) keeps the draft, shows the detail and refocuses the editor', async () => {
    render({ onCommit: vi.fn().mockRejectedValue(new ApiError(400, 'Label taken')) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(editor()!.value).toBe('New');
    expect(err()?.textContent).toBe('Label taken');
    expect(editor()!.getAttribute('aria-describedby')).toContain(err()!.id);
    expect(document.activeElement).toBe(editor());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('a rejected commit (422 array detail) shows the first message', async () => {
    const e = new ApiError(422, [{ loc: ['body', 'label'], msg: 'String too long', type: 'x' }]);
    render({ onCommit: vi.fn().mockRejectedValue(e) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('String too long');
  });

  it('a non-API rejection shows "Save failed"', async () => {
    render({ onCommit: vi.fn().mockRejectedValue(new Error('boom')) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(err()?.textContent).toBe('Save failed');
  });
});

describe('InlineField — busy and the generation guard', () => {
  it('busy makes the editor readonly and disables ✕ / ✓', async () => {
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(editor()!.readOnly).toBe(true);
    expect(btn('check')!.disabled).toBe(true);
    expect(btn('close')!.disabled).toBe(true);
    d.resolve();
    await settle();
    expect(editor()).toBeNull();
  });

  it('Enter / Escape / ✓ / ✕ while busy are ignored; Escape still does not propagate', async () => {
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    key('Enter');
    await settle();
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const enter = key('Enter');
    expect(enter.ev.defaultPrevented).toBe(true);
    const esc = key('Escape');
    expect(esc.ev.defaultPrevented).toBe(true);
    expect(esc.stop).toHaveBeenCalled();
    btn('check')!.click();
    btn('close')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(editor()).not.toBeNull();
    d.resolve();
    await settle();
  });

  it('discard during an in-flight commit: a late success does nothing, and reopening is writable', async () => {
    const reg = createDirtyRegistry();
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) }, reg);
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    reg.discardAll();
    flushSync();
    expect(editor()).toBeNull();
    d.resolve();
    await settle();
    expect(err()).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(btn('pencil'));
    await open();
    expect(editor()!.readOnly).toBe(false);
  });

  it('discard during an in-flight commit: a late failure toasts once, no inline error, no focus', async () => {
    const reg = createDirtyRegistry();
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) }, reg);
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    reg.discardAll();
    flushSync();
    d.reject(new ApiError(400, 'Nope'));
    await settle();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Nope', 'error');
    expect(editor()).toBeNull();
    expect(err()).toBeNull();
  });

  it('a late failure after unmount still toasts', async () => {
    const d = deferred();
    render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    unmount(cmp!); cmp = null;
    d.reject(new ApiError(400, 'Gone'));
    await settle();
    expect(toastMock).toHaveBeenCalledWith('Gone', 'error');
  });
});

describe('InlineField — read-only flip', () => {
  it('closes a dirty open field, toasts once, and parks focus on the row', async () => {
    const props = render();
    await open();
    type('Draft');
    props.disabledReason = 'Only a created version can change its info';
    flushSync();
    await settle();
    expect(editor()).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Editing closed — this version is no longer editable', 'info');
    expect(document.activeElement).toBe(host.querySelector('.inline-field'));
    expect(btn('pencil')!.disabled).toBe(true);
  });

  it('a clean open field closes without a toast', async () => {
    const props = render();
    await open();
    props.disabledReason = 'Enable the version first';
    flushSync();
    await settle();
    expect(editor()).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('does not steal focus when focus was outside the field', async () => {
    const props = render();
    await open();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    props.disabledReason = 'Enable the version first';
    flushSync();
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('while busy: closes immediately, no "Editing closed"; late success → no toast', async () => {
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    props.disabledReason = 'Only a created version can change its info';
    flushSync();
    expect(editor()).toBeNull();
    d.resolve();
    await settle();
    expect(toastMock).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it('while busy: late failure → exactly one error toast, no inline error', async () => {
    const d = deferred();
    const props = render({ onCommit: vi.fn(() => d.promise) });
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    props.disabledReason = 'Only a created version can change its info';
    flushSync();
    d.reject(new ApiError(409, 'Version was published'));
    await settle();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Version was published', 'error');
    expect(err()).toBeNull();
  });
});

describe('InlineField — dirty registry', () => {
  it('is dirty only while open and changed', async () => {
    const reg = createDirtyRegistry();
    render({}, reg);
    expect(reg.isAnyDirty()).toBe(false);
    await open();
    expect(reg.isAnyDirty()).toBe(false);
    type('Changed');
    expect(reg.isAnyDirty()).toBe(true);
    type('Old');
    expect(reg.isAnyDirty()).toBe(false);
    type('Changed');
    btn('close')!.click();
    await settle();
    expect(reg.isAnyDirty()).toBe(false);
  });

  it('a number field opened and left unchanged is not dirty', async () => {
    const reg = createDirtyRegistry();
    render({ kind: 'number', value: 3 }, reg);
    await open();
    expect(editor()!.value).toBe('3');
    expect(reg.isAnyDirty()).toBe(false);
  });

  it('discardAll() closes the field without moving focus', async () => {
    const reg = createDirtyRegistry();
    render({}, reg);
    await open();
    type('Changed');
    reg.discardAll();
    flushSync();
    expect(editor()).toBeNull();
    expect(reg.isAnyDirty()).toBe(false);
    expect(host.querySelector('.value')?.textContent?.trim()).toBe('Old');
  });

  it('mounts and commits with no registry in context', async () => {
    const props = render();
    await open();
    type('New');
    btn('check')!.click();
    await settle();
    expect(props.onCommit).toHaveBeenCalledWith('New');
  });
});
```

File: `frontend/src/tests/IconButton.svelte.test.ts` — full content:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import IconButton from '../components/ui/IconButton.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(IconButton, { target: host, props: props as ComponentProps<typeof IconButton> });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

const GLYPHS = ['pencil','duplicate','disable','enable','trash','plus','up','down','chevron','close','back','check','chevron-right'] as const;

describe('IconButton', () => {
  it('requires and renders a title (tooltip + a11y)', () => {
    const btn = render({ glyph: 'pencil', title: 'Edit' });
    expect(btn.getAttribute('title')).toBe('Edit');
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  // Cover the WHOLE glyph set (no consumer wires most glyphs in Slice 1, so this
  // unit test is their only guard): each renders its data-glyph hook + an <svg>.
  for (const glyph of GLYPHS) {
    it(`renders the ${glyph} glyph as an SVG via data-glyph`, () => {
      const btn = render({ glyph, title: glyph });
      expect(btn.getAttribute('data-glyph')).toBe(glyph);
      expect(btn.querySelector('svg')).not.toBeNull();
    });
  }

  it('renders distinct geometry for EVERY glyph (no shared/placeholder mark)', () => {
    // Full-set distinctness: a 2-glyph spot check would let the other 8 share one
    // arbitrary mark and still pass. Render all 13, assert every SVG body is unique.
    const marks = GLYPHS.map((glyph) => {
      const svg = render({ glyph, title: glyph }).querySelector('svg')!.innerHTML;
      unmount(component!); component = null; host.parentNode?.removeChild(host);
      return svg;
    });
    expect(new Set(marks).size).toBe(GLYPHS.length);
  });

  it('renders disabled but still present (fixed-slot alignment)', () => {
    const btn = render({ glyph: 'disable', title: 'Not allowed', disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Not allowed');
  });

  it('does not fire onclick when disabled', () => {
    const onclick = vi.fn();
    const btn = render({ glyph: 'plus', title: 'Add', disabled: true, onclick });
    btn.click();
    expect(onclick).not.toHaveBeenCalled();
  });

  it('applies the danger class for destructive glyphs', () => {
    const btn = render({ glyph: 'trash', title: 'Delete', danger: true });
    expect(btn.classList.contains('danger')).toBe(true);
  });

  it('applies the borderless class for chevron/fold controls', () => {
    const btn = render({ glyph: 'chevron', title: 'Collapse', borderless: true });
    expect(btn.classList.contains('borderless')).toBe(true);
  });

  // ---- Slice-5a additions (spec §1.2) ----
  it('check carries the heavier 1.9 stroke on its own element', () => {
    const svg = render({ glyph: 'check', title: 'Save' }).querySelector('svg')!;
    expect(svg.getAttribute('stroke-width')).toBe('1.6');
    expect(svg.querySelector('polyline')!.getAttribute('stroke-width')).toBe('1.9');
  });

  it('applies the round and primary classes only when asked', () => {
    const plain = render({ glyph: 'back', title: 'Back' });
    expect(plain.classList.contains('round')).toBe(false);
    expect(plain.classList.contains('primary')).toBe(false);
    unmount(component!); component = null; host.parentNode?.removeChild(host);
    const both = render({ glyph: 'plus', title: 'New', round: true, primary: true });
    expect(both.classList.contains('round')).toBe(true);
    expect(both.classList.contains('primary')).toBe(true);
  });

  it('a disabled primary button is still natively disabled (the :disabled rule wins in CSS — gate-pinned)', () => {
    const btn = render({ glyph: 'plus', title: 'New', primary: true, disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('primary')).toBe(true);
  });

  it('binds the <button> element', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const props = $state<{ glyph: 'pencil'; title: string; element?: HTMLButtonElement }>({ glyph: 'pencil', title: 'Edit', element: undefined });
    component = mount(IconButton, { target: host, props });
    flushSync();
    expect(props.element).toBe(host.querySelector('button'));
  });

  it('forwards id / tabindex / aria-* / onmousedown only when passed', () => {
    const bare = render({ glyph: 'chevron', title: 'Collapse' });
    for (const a of ['id', 'tabindex', 'aria-hidden', 'aria-expanded', 'aria-controls']) {
      expect(bare.hasAttribute(a)).toBe(false);
    }
    unmount(component!); component = null; host.parentNode?.removeChild(host);
    const onmousedown = vi.fn();
    const btn = render({
      glyph: 'chevron', title: 'Collapse', id: 'x1', tabindex: -1, 'aria-hidden': 'true',
      'aria-expanded': false, 'aria-controls': 'panel-1', onmousedown,
    });
    expect(btn.id).toBe('x1');
    expect(btn.getAttribute('tabindex')).toBe('-1');
    expect(btn.getAttribute('aria-hidden')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('panel-1');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onmousedown).toHaveBeenCalledTimes(1);
  });
});
```

File: `frontend/src/tests/EmptyState.svelte.test.ts` — full content:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
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

  it('renders the optional icon tile, hint and action in order (Slice-5a, ref 1353-1360)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const action = createRawSnippet(() => ({ render: () => '<button type="button" class="probe">+ New version</button>' }));
    component = mount(EmptyState, {
      target: host,
      props: { title: 'No versions yet', icon: 'list', hint: 'A version holds the blocks.', action },
    });
    flushSync();
    const root = host.querySelector('.empty-state')!;
    const kids = [...root.children].map((c) => c.className.split(' ')[0]);
    expect(kids).toEqual(['tile', 'title', 'hint', 'action']);
    expect(root.querySelector('.tile')!.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelectorAll('.tile svg line').length).toBe(3);
    expect(root.querySelector('.hint')!.textContent).toBe('A version holds the blocks.');
    expect(root.querySelector('.action button.probe')).not.toBeNull();
  });
});
```

File: `frontend/src/tests/VersionBadges.svelte.test.ts` — full content:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionBadges from '../components/editor/VersionBadges.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(state: 'created' | 'published' | 'archived', isDisabled: boolean) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(VersionBadges, { target: host, props: { state, isDisabled } });
  flushSync();
  return [...host.querySelectorAll<HTMLElement>('.vbadge')];
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('VersionBadges (Slice-5a §1.4, D5)', () => {
  for (const state of ['created', 'published', 'archived'] as const) {
    it(`an enabled ${state} version shows one ${state}-toned badge`, () => {
      const badges = render(state, false);
      expect(badges.map((b) => b.textContent)).toEqual([state]);
      expect(badges[0].classList.contains(state)).toBe(true);
      expect(badges[0].classList.contains('off')).toBe(false);
    });

    it(`a disabled ${state} version drops BOTH badges to the disabled tone`, () => {
      const badges = render(state, true);
      expect(badges.map((b) => b.textContent)).toEqual([state, 'disabled']);
      for (const b of badges) {
        expect(b.classList.contains('off')).toBe(true);
        expect(b.classList.contains(state)).toBe(false);
      }
    });
  }
});
```

File: `frontend/src/tests/editorReasons.test.ts` — full content:

```ts
import { describe, it, expect } from 'vitest';
import {
  metaReason, structureReason, textReason, deleteVersionReason, duplicateVersionReason, unsavedSuffix,
} from '../lib/editorReasons';

type S = 'created' | 'published' | 'archived';
const v = (state: S, is_disabled: boolean) => ({ state, is_disabled });

// Every function × all six state × disabled combinations (spec §Testing T1).
// State is checked BEFORE is_disabled: "Enable … first" only where enabling unlocks.
const CASES: [S, boolean, { meta: string | null; structure: string | null; text: string | null; del: string | null; dup: string | null }][] = [
  ['created', false, { meta: null, structure: null, text: null, del: null, dup: null }],
  ['created', true, {
    meta: 'Enable the version first', structure: 'Enable the version first', text: 'Enable the version first',
    del: 'Delete — enable the version first', dup: 'Duplicate — enable the version first',
  }],
  ['published', false, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: null, del: 'Delete — only for a created version', dup: null,
  }],
  ['published', true, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: 'Enable the version first', del: 'Delete — only for a created version', dup: 'Duplicate — enable the version first',
  }],
  ['archived', false, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: 'Archived versions are read-only', del: 'Delete — only for a created version', dup: null,
  }],
  ['archived', true, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: 'Archived versions are read-only', del: 'Delete — only for a created version', dup: 'Duplicate — enable the version first',
  }],
];

describe('editorReasons', () => {
  for (const [state, dis, want] of CASES) {
    it(`${state}${dis ? ' + disabled' : ''}`, () => {
      expect(metaReason(v(state, dis))).toBe(want.meta);
      expect(structureReason(v(state, dis))).toBe(want.structure);
      expect(textReason(v(state, dis))).toBe(want.text);
      expect(deleteVersionReason(v(state, dis))).toBe(want.del);
      expect(duplicateVersionReason(v(state, dis))).toBe(want.dup);
    });
  }

  it('unsavedSuffix appends only when something is dirty', () => {
    expect(unsavedSuffix(true)).toBe(' Unsaved edits may be lost.');
    expect(unsavedSuffix(false)).toBe('');
  });
});
```

File: `frontend/src/tests/dirtyRegistry.test.ts` — full content:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type RegisteredTracker } from '../lib/dirtyRegistry.svelte';

// Fake tracker matching RegisteredTracker shape (readonly isDirty getter).
function fakeTracker(initial: boolean): RegisteredTracker & { setDirty(v: boolean): void } {
  let d = initial;
  return {
    get isDirty() { return d; },
    setDirty(v) { d = v; },
  };
}

describe('dirtyRegistry', () => {
  it('exports a symbol context key', () => {
    expect(typeof DIRTY_REGISTRY_KEY).toBe('symbol');
  });

  it('factory returns object with register / unregister / isAnyDirty', () => {
    const r = createDirtyRegistry();
    expect(typeof r.register).toBe('function');
    expect(typeof r.unregister).toBe('function');
    expect(typeof r.isAnyDirty).toBe('function');
  });

  it('empty registry returns isAnyDirty = false', () => {
    const r = createDirtyRegistry();
    expect(r.isAnyDirty()).toBe(false);
  });

  it('one clean tracker → isAnyDirty = false', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(false));
    expect(r.isAnyDirty()).toBe(false);
  });

  it('one dirty tracker → isAnyDirty = true', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(true));
    expect(r.isAnyDirty()).toBe(true);
  });

  it('multiple trackers OR correctly (any-dirty wins)', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(false));
    r.register(fakeTracker(false));
    r.register(fakeTracker(true));
    expect(r.isAnyDirty()).toBe(true);
  });

  it('reads tracker.isDirty getter on EACH iterate call (not cached)', () => {
    const r = createDirtyRegistry();
    const t = fakeTracker(false);
    r.register(t);
    expect(r.isAnyDirty()).toBe(false);
    t.setDirty(true);
    expect(r.isAnyDirty()).toBe(true);
    t.setDirty(false);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('unregister removes a tracker — register/unregister symmetric', () => {
    const r = createDirtyRegistry();
    const dirtyT = fakeTracker(true);
    r.register(dirtyT);
    expect(r.isAnyDirty()).toBe(true);
    r.unregister(dirtyT);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('unregister of unknown tracker is a no-op (does not throw)', () => {
    const r = createDirtyRegistry();
    const stranger = fakeTracker(true);
    expect(() => r.unregister(stranger)).not.toThrow();
    expect(r.isAnyDirty()).toBe(false);
  });

  it('add-then-remove sequence returns to clean', () => {
    const r = createDirtyRegistry();
    const t1 = fakeTracker(true);
    const t2 = fakeTracker(true);
    r.register(t1);
    r.register(t2);
    expect(r.isAnyDirty()).toBe(true);
    r.unregister(t1);
    expect(r.isAnyDirty()).toBe(true); // t2 still dirty
    r.unregister(t2);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('discardAll calls discard only on DIRTY trackers (Slice-5a D3)', () => {
    const r = createDirtyRegistry();
    const dirtyT = { isDirty: true, discard: vi.fn() };
    const cleanT = { isDirty: false, discard: vi.fn() };
    r.register(dirtyT);
    r.register(cleanT);
    r.discardAll();
    expect(dirtyT.discard).toHaveBeenCalledTimes(1);
    expect(cleanT.discard).not.toHaveBeenCalled();
  });

  it('discardAll tolerates trackers without discard and unregistering mid-loop', () => {
    const r = createDirtyRegistry();
    const legacy = fakeTracker(true);                       // no discard (e.g. ItemEditPage trackers)
    const selfRemoving: RegisteredTracker = {
      get isDirty() { return true; },
      discard: () => r.unregister(selfRemoving),
    };
    const later = { isDirty: true, discard: vi.fn() };
    r.register(legacy);
    r.register(selfRemoving);
    r.register(later);
    expect(() => r.discardAll()).not.toThrow();
    expect(later.discard).toHaveBeenCalledTimes(1);
  });
});
```

File: `frontend/src/tests/DirtyGuard.svelte.test.ts` — full content:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DirtyGuard from '../components/editor/DirtyGuard.svelte';
import { navigate, __resetGuardsForTests } from '../lib/router.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(isDirty: () => boolean, onDiscard: () => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(DirtyGuard, { target: host, props: { isDirty, onDiscard } });
  flushSync();
}

afterEach(async () => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __resetGuardsForTests();
  vi.restoreAllMocks();
  await navigate('/', { force: true });
});

describe('DirtyGuard — onDiscard (Slice-5a D3)', () => {
  it('calls onDiscard after the user confirms the prompt', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDiscard = vi.fn();
    render(() => true, onDiscard);
    await navigate('/somewhere');
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/somewhere');
  });

  it('does not call onDiscard when the user cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDiscard = vi.fn();
    render(() => true, onDiscard);
    await navigate('/elsewhere');
    expect(onDiscard).not.toHaveBeenCalled();
    expect(location.pathname).not.toBe('/elsewhere');
  });

  it('does not prompt or discard when nothing is dirty', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onDiscard = vi.fn();
    render(() => false, onDiscard);
    await navigate('/clean');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('beforeunload warns but never discards', () => {
    const onDiscard = vi.fn();
    render(() => true, onDiscard);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/InlineField.svelte.test.ts src/tests/IconButton.svelte.test.ts src/tests/EmptyState.svelte.test.ts src/tests/VersionBadges.svelte.test.ts src/tests/editorReasons.test.ts src/tests/dirtyRegistry.test.ts src/tests/DirtyGuard.svelte.test.ts
```

Expected: the four new files fail to import (`InlineField.svelte`, `VersionBadges.svelte`, `editorReasons` do not exist; `DirtyGuard` has no `onDiscard`, so its discard assertions fail); `IconButton` fails on the new glyphs/props; `EmptyState` on icon/hint/action; `dirtyRegistry` on `discardAll is not a function`.

- [ ] **Step 3: Implement**

File: `frontend/src/components/ui/IconButton.svelte` — full content:

```svelte
<script lang="ts">
  // Shared icon-only button. A <button> shell carrying data-glyph, a required
  // title (tooltip + a11y label default) and an inline glyph SVG. Glyph paths
  // are transcribed verbatim from the titled action controls in
  // docs/design/visual-refresh/reference-screens.dc.html. Glyph set:
  // pencil | duplicate | disable | enable | trash | plus | up | down | chevron |
  // chevron-right | close | back | check.
  type Size = 'sm' | 'md';
  type Glyph =
    | 'pencil' | 'duplicate' | 'disable' | 'enable' | 'trash' | 'plus' | 'up' | 'down'
    | 'chevron' | 'chevron-right' | 'close' | 'back' | 'check';
  type Props = {
    glyph: Glyph;
    // Required: the tooltip AND the default screen-reader label. A disabled
    // control keeps its slot and states its reason here.
    title: string;
    size?: Size;
    borderless?: boolean;
    disabled?: boolean;
    danger?: boolean;
    // Slice-5a: `round` = the 28px circular back button (ref 1473); `primary` =
    // the filled create / save control (ref 1479, 1546).
    round?: boolean;
    primary?: boolean;
    onclick?: () => void;
    onmousedown?: (e: MouseEvent) => void;
    // Forward aria-label so an icon-only button can announce a purpose distinct
    // from its tooltip; falls back to `title` when omitted.
    'aria-label'?: string;
    // The rest are forwarded verbatim and omitted from the DOM when undefined.
    'aria-hidden'?: boolean | 'true' | 'false';
    'aria-expanded'?: boolean;
    'aria-controls'?: string;
    id?: string;
    tabindex?: number;
    // Bindable ref to the <button> — InlineField returns focus here.
    element?: HTMLButtonElement;
  };
  let {
    glyph,
    title,
    size = 'md',
    borderless = false,
    disabled = false,
    danger = false,
    round = false,
    primary = false,
    onclick = undefined,
    onmousedown = undefined,
    'aria-label': ariaLabel = undefined,
    'aria-hidden': ariaHidden = undefined,
    'aria-expanded': ariaExpanded = undefined,
    'aria-controls': ariaControls = undefined,
    id = undefined,
    tabindex = undefined,
    element = $bindable(),
  }: Props = $props();
</script>

<button
  bind:this={element}
  type="button"
  class="icon-btn {size}"
  class:danger
  class:borderless
  class:round
  class:primary
  data-glyph={glyph}
  {disabled}
  {title}
  {id}
  {tabindex}
  aria-label={ariaLabel ?? title}
  aria-hidden={ariaHidden}
  aria-expanded={ariaExpanded}
  aria-controls={ariaControls}
  {onclick}
  {onmousedown}
>
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if glyph === 'pencil'}
      <path d="M3.2 12.8l.5-2.7 6.9-6.9 2.2 2.2-6.9 6.9z" /><line x1="9.6" y1="3.8" x2="12.2" y2="6.4" />
    {:else if glyph === 'duplicate'}
      <rect x="5.8" y="5.8" width="7.2" height="7.2" rx="1.4" /><path d="M10.2 3.6H4.4A1.4 1.4 0 0 0 3 5v5.8" />
    {:else if glyph === 'disable'}
      <circle cx="8" cy="8" r="5.4" /><line x1="4.6" y1="11.4" x2="11.4" y2="4.6" />
    {:else if glyph === 'enable'}
      <circle cx="8" cy="8" r="5.4" /><polyline points="5.5,8.2 7.3,10 10.6,5.9" />
    {:else if glyph === 'trash'}
      <line x1="3" y1="4.6" x2="13" y2="4.6" /><path d="M5.5 4.6V3.2h5v1.4" /><path d="M4.4 4.6l.7 8.2h5.8l.7-8.2" />
    {:else if glyph === 'plus'}
      <line x1="8" y1="3.4" x2="8" y2="12.6" /><line x1="3.4" y1="8" x2="12.6" y2="8" />
    {:else if glyph === 'up'}
      <line x1="8" y1="12.4" x2="8" y2="3.6" /><polyline points="4.4,7.2 8,3.6 11.6,7.2" />
    {:else if glyph === 'down'}
      <line x1="8" y1="3.6" x2="8" y2="12.4" /><polyline points="4.4,8.8 8,12.4 11.6,8.8" />
    {:else if glyph === 'chevron'}
      <polyline points="4.6,6.6 8,10 11.4,6.6" />
    {:else if glyph === 'chevron-right'}
      <polyline points="6.6,4.6 10,8 6.6,11.4" />
    {:else if glyph === 'close'}
      <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
    {:else if glyph === 'back'}
      <line x1="12.4" y1="8" x2="3.6" y2="8" /><polyline points="7.2,4.4 3.6,8 7.2,11.6" />
    {:else if glyph === 'check'}
      <!-- per-element 1.9: the check is the one heavier mark (visual-spec §4) -->
      <polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9" />
    {/if}
  </svg>
</button>

<style>
  /* Boxed default: fixed square so a row of icon buttons stays aligned even
     when one is disabled. Colour is functional-secondary (--muted), never a
     fill — except `primary`, the filled create / save control. */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    padding: 0;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }
  .sm { width: var(--glyph-btn); height: var(--glyph-btn); }
  .md { width: 28px; height: 28px; }
  .sm svg { width: 12px; height: 12px; }
  .md svg { width: 14px; height: 14px; }
  /* Danger (trash): a red glyph, never a red fill. */
  .danger { color: var(--danger); }
  /* Borderless (chevron/fold controls): no chrome, just the muted mark. */
  .borderless {
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .round { border-radius: 50%; /* ref 1473 */ }
  .primary {
    background: var(--primary);
    color: var(--primary-text);
    border-color: var(--primary); /* ref 1479 */
  }
  /* Disabled = a forbidden action that must keep its slot (spec §4). Recede via
     tokens, never opacity — opacity would composite the glyph against the page.
     `.icon-btn:disabled` (0,3,0 with the scope hash) beats `.danger` and
     `.primary` (0,2,0), so a disabled trash or a disabled filled `+` greys out too. */
  .icon-btn:disabled {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
</style>
```

File: `frontend/src/components/ui/EmptyState.svelte` — full content:

```svelte
<script lang="ts">
  // EmptyState — titled empty card (artboard 9d, ref 1353-1360). Title-only
  // callers are unchanged; Slice-5a adds the optional icon tile, hint and action
  // its first consumer ("No versions yet") needs. Presentational only.
  import type { Snippet } from 'svelte';
  let {
    title,
    icon = undefined,
    hint = undefined,
    action = undefined,
  }: { title: string; icon?: 'list'; hint?: string; action?: Snippet } = $props();
</script>

<div class="empty-state">
  {#if icon === 'list'}
    <span class="tile" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="4" x2="13" y2="4" /><line x1="3" y1="8" x2="13" y2="8" /><line x1="3" y1="12" x2="9" y2="12" />
      </svg>
    </span>
  {/if}
  <p class="title">{title}</p>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .empty-state {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 34px 20px; /* ref 1355 */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px; /* ref 1355 */
    text-align: center;
  }
  .title { font-size: 14px; font-weight: 600; /* ref 1357 */ color: var(--text); margin: 0; }
  /* #E9EBEF tile edge → --border (Slice-3 role split); #8B919E glyph → --muted
     (Slice-4 pre-ruling: no token has that hex; --faint is disabled-only). */
  .tile {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 38px;
    height: 38px; /* ref 1356 */
    border-radius: 8px; /* ref 1356 */
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .tile svg { width: 18px; height: 18px; /* ref 1356 */ }
  .hint {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    max-width: 44ch; /* ref 1358 */
    text-wrap: pretty;
    color: var(--muted);
  }
  .action { margin-top: 4px; /* ref 1359 */ }
</style>
```

File: `frontend/src/components/editor/VersionBadges.svelte` — full content:

```svelte
<script lang="ts">
  // Lifecycle + disabled badges for a version (3a rows, 3b heading). A disabled
  // version drops EVERY badge — the lifecycle one included — to the disabled
  // treatment (D5; visual-spec :199-201, ref 1497). `.vbadge` is unique to this
  // component so gate anchors cannot collide with AccordionHeader's code badge.
  import type { VersionLifecycleState } from '../../lib/versionPermissions';
  let { state, isDisabled }: { state: VersionLifecycleState; isDisabled: boolean } = $props();
</script>

<span class="vbadges">
  <span
    class="vbadge"
    class:created={!isDisabled && state === 'created'}
    class:published={!isDisabled && state === 'published'}
    class:archived={!isDisabled && state === 'archived'}
    class:off={isDisabled}
  >{state}</span>
  {#if isDisabled}<span class="vbadge off">disabled</span>{/if}
</span>

<style>
  .vbadges { display: inline-flex; align-items: center; gap: 6px; /* ref 1497 */ }
  .vbadge {
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 3px; /* ref 1485 */
    white-space: nowrap;
  }
  .created { background: var(--state-created-bg); color: var(--state-created-fg); }
  .published { background: var(--state-published-bg); color: var(--state-published-fg); }
  .archived { background: var(--state-archived-bg); color: var(--state-archived-fg); }
  .off { background: var(--state-disabled-bg); color: var(--state-disabled-fg); }
</style>
```

File: `frontend/src/lib/editorReasons.ts` — full content:

```ts
// Disabled-reason strings for the authoring surfaces (Slice-5a spec §4), in one
// place. State is checked BEFORE is_disabled, so "Enable the version first"
// appears only when enabling would actually unlock the action.
import type { VersionLifecycleState } from './versionPermissions';

type V = { state: VersionLifecycleState; is_disabled: boolean };

/** Version info (label / info / attempts) — created versions only. */
export function metaReason(v: V): string | null {
  if (v.state !== 'created') return 'Only a created version can change its info';
  if (v.is_disabled) return 'Enable the version first';
  return null;
}

/** Create / reorder / delete of blocks, sequences and items. */
export function structureReason(v: V): string | null {
  if (v.state !== 'created') return 'Only a created version can change its structure';
  if (v.is_disabled) return 'Enable the version first';
  return null;
}

/** Block title/info and sequence title — published text stays editable. */
export function textReason(v: V): string | null {
  if (v.state === 'archived') return 'Archived versions are read-only';
  if (v.is_disabled) return 'Enable the version first';
  return null;
}

/** The Delete slot on a Versions-page row (ref 1498). */
export function deleteVersionReason(v: V): string | null {
  if (v.state !== 'created') return 'Delete — only for a created version';
  if (v.is_disabled) return 'Delete — enable the version first';
  return null;
}

/** The Duplicate slot on a Versions-page row (ref 1498). */
export function duplicateVersionReason(v: V): string | null {
  return v.is_disabled ? 'Duplicate — enable the version first' : null;
}

/** D3: appended to the confirm() of an action that can close or unmount a draft. */
export function unsavedSuffix(anyDirty: boolean): string {
  return anyDirty ? ' Unsaved edits may be lost.' : '';
}
```

File: `frontend/src/lib/dirtyRegistry.svelte.ts` — full content:

```ts
// dirtyRegistry aggregates per-form makeDirtyTracker getters into a single
// page-wide `isAnyDirty()` callable. VersionEditPage provides one instance
// via setContext(DIRTY_REGISTRY_KEY, ...); every form below it registers
// its tracker in an $effect on mount and unregisters on unmount. DirtyGuard
// receives `() => isAnyDirty()` so its closure re-reads the live registry
// on every navigation. SvelteSet (not plain Set) makes membership changes
// reactive, so callers using `$derived(...registry...)` re-evaluate when
// trackers are added/removed.

import { SvelteSet } from 'svelte/reactivity';

// Erased shape — the registry stores trackers across all form shapes.
// The concrete tracker types still flow through their owning form; only
// the registry needs to forget the parameter. `discard` (Slice-5a D3) drops
// the tracker's draft when the user confirms the "Discard unsaved changes?"
// prompt, so a confirmed discard never re-prompts on the next navigation.
export type RegisteredTracker = { readonly isDirty: boolean; discard?: () => void };

export const DIRTY_REGISTRY_KEY = Symbol('dirtyRegistry');

export type DirtyRegistry = {
  register(t: RegisteredTracker): void;
  unregister(t: RegisteredTracker): void;
  isAnyDirty(): boolean;
  discardAll(): void;
};

export function createDirtyRegistry(): DirtyRegistry {
  const registry = new SvelteSet<RegisteredTracker>();
  return {
    register(t)   { registry.add(t); },
    unregister(t) { registry.delete(t); },
    isAnyDirty() {
      for (const t of registry) if (t.isDirty) return true;
      return false;
    },
    discardAll() {
      // Snapshot first: a discard closes its field, and that field's $effect
      // cleanup unregisters the tracker — never mutate the set mid-iteration.
      for (const t of [...registry]) if (t.isDirty) t.discard?.();
    },
  };
}
```

File: `frontend/src/components/editor/DirtyGuard.svelte` — full content:

```svelte
<script lang="ts">
  // Mounts a guard that intercepts in-app navigation AND browser unload while
  // the parent has unsaved changes. `isDirty` is a callback (not a boolean)
  // so the navigation-guard closure dereferences the parent's $state on every
  // check; capturing a boolean prop here would freeze the value at the moment
  // of registration — Svelte 5 $props() ARE reactive on prop changes, but the
  // closure passed to registerNavigationGuard is built once inside onMount
  // and never re-runs, so it would hold a stale capture of the old boolean.
  import { onMount } from 'svelte';
  import { registerNavigationGuard } from '../../lib/router.svelte';

  // `onDiscard` (Slice-5a D3) runs after the user CONFIRMS the in-app prompt —
  // never on beforeunload, which leaves the page anyway.
  let { isDirty, onDiscard = undefined }: { isDirty: () => boolean; onDiscard?: () => void } = $props();

  function confirmDiscard(): boolean {
    return window.confirm('Discard unsaved changes and continue?');
  }

  onMount(() => {
    const dispose = registerNavigationGuard(() => {
      if (!isDirty()) return true;
      const ok = confirmDiscard();
      if (ok) onDiscard?.();
      return ok;
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      dispose();
      window.removeEventListener('beforeunload', onUnload);
    };
  });
</script>
```

File: `frontend/src/components/ui/InlineField.svelte` — full content:

```svelte
<script lang="ts">
  // InlineField — one row that reads as text until opened; each field commits
  // on its own (visual-spec §4 "Inline field editing", Slice-5a spec §1.1).
  // The panel owns the PATCH: `onCommit` resolves on success and THROWS on
  // failure. The editor is one-way (value + oninput), never bind:value — a
  // bound type=number yields number|null and would break the string draft.
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import IconButton from './IconButton.svelte';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type Kind = 'text' | 'textarea' | 'number';
  type Props = {
    label: string;
    value: string | number;
    kind?: Kind;
    editTitle: string;
    disabledReason?: string | null;
    validate?: (parsed: string | number) => string | null;
    required?: boolean;
    maxlength?: number;
    min?: number;
    max?: number;
    step?: number;
    onCommit: (parsed: string | number) => Promise<void>;
  };

  let {
    label,
    value,
    kind = 'text',
    editTitle,
    disabledReason = null,
    validate = undefined,
    required = false,
    maxlength = undefined,
    min = undefined,
    max = undefined,
    step = undefined,
    onCommit,
  }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;

  let open = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  let rowEl = $state<HTMLDivElement>();
  let editorEl = $state<HTMLInputElement | HTMLTextAreaElement>();
  let pencilEl = $state<HTMLButtonElement>();

  // Generation guard (spec §1.1): bumped on every open and every close; each
  // continuation captures it immediately before its own await and bails if it
  // moved. It guards error / open-state / focus writes only — never `busy`.
  let gen = 0;
  let alive = true;
  onDestroy(() => { alive = false; });

  function parse(d: string): string | number {
    if (kind === 'number') return d.trim() === '' ? NaN : Number(d);
    return d;
  }
  function same(d: string, v: string | number): boolean {
    return kind === 'number' ? parse(d) === v : d === String(v);
  }
  function msg(e: unknown): string {
    return e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed';
  }

  function close() {
    open = false;
    draft = '';
    error = null;
    gen++;
  }

  async function openEditor() {
    if (disabledReason !== null) return;
    open = true;
    draft = String(value);
    error = null;
    const g = ++gen;
    await tick();
    if (g !== gen || !alive || !editorEl) return;
    editorEl.focus();
    // type=number has no selection API (setSelectionRange throws).
    if (kind !== 'number') editorEl.setSelectionRange(draft.length, draft.length);
  }

  async function cancel() {
    close();
    const g = gen;
    await tick();
    if (g !== gen || !alive) return;
    pencilEl?.focus();
  }

  async function commit() {
    error = null;
    if (required && draft.trim() === '') { error = `${label} is required`; return; }
    const parsed = parse(draft);
    if (kind === 'number' && !Number.isFinite(parsed)) { error = 'Enter a number'; return; }
    const invalid = validate?.(parsed) ?? null;
    if (invalid) { error = invalid; return; }
    if (same(draft, value)) { await cancel(); return; }

    busy = true;
    let g = gen;
    let failure: unknown = null;
    let failed = false;
    try {
      await onCommit(parsed);
    } catch (e) {
      failed = true;
      failure = e;
    } finally {
      // Always — a close during the commit must not leave the field read-only.
      if (alive) busy = false;
    }
    if (failed) {
      // Late failure after a close (discard / read-only flip) or an unmount:
      // toast BEFORE the bail, so the failure is never silent (spec §1.1).
      if (g !== gen || !alive) { pushToast(msg(failure), 'error'); return; }
      error = msg(failure);
      g = gen;
      await tick();
      if (g !== gen || !alive) return;
      editorEl?.focus();
      return;
    }
    if (g !== gen || !alive) return; // late success after a close: nothing to do
    close();
    g = gen;
    await tick();
    if (g !== gen || !alive) return;
    pencilEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      // stopPropagation: Slice-6 10a may sit inside an Escape-closing modal.
      e.preventDefault();
      e.stopPropagation();
      if (!busy) void cancel();
      return;
    }
    if (e.key !== 'Enter') return;
    if (kind === 'textarea' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!busy) void commit();
  }

  // Unsaved registration (D3) — optional: no registry outside the editor.
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = {
    get isDirty() { return open && !same(draft, value); },
    discard() { close(); },
  };
  $effect(() => {
    if (!registry || !open) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  // Read-only flip: tracks ONLY disabledReason + open. Captures happen inside
  // untrack and BEFORE the close — once the editor unmounts, activeElement is
  // <body>. While busy the draft is mid-save, so its own outcome is reported
  // (no "Editing closed" toast).
  $effect(() => {
    if (disabledReason === null || !open) return;
    untrack(() => {
      const hadFocus = !!rowEl && rowEl.contains(document.activeElement);
      const wasDirty = !busy && !same(draft, value);
      close();
      if (wasDirty) pushToast('Editing closed — this version is no longer editable', 'info');
      if (!hadFocus) return;
      const g = gen;
      void tick().then(() => { if (g === gen && alive) rowEl?.focus(); });
    });
  });
</script>

<div
  class="inline-field"
  class:open
  class:ta={kind === 'textarea'}
  bind:this={rowEl}
  tabindex="-1"
  role="group"
  aria-labelledby={labelId}
>
  <span class="label" id={labelId}>{label}</span>
  {#if open}
    <div class="editor">
      {#if kind === 'textarea'}
        <textarea
          bind:this={editorEl}
          class="mono"
          rows="3"
          value={draft}
          readonly={busy}
          {maxlength}
          aria-labelledby={labelId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${hintId} ${errId}` : hintId}
          oninput={(e) => { draft = e.currentTarget.value; error = null; }}
          onkeydown={onKeydown}
        ></textarea>
        <span class="sr-only" id={hintId}>Press Control or Command plus Enter to save, Escape to cancel</span>
      {:else}
        <input
          bind:this={editorEl}
          class:mono={kind === 'number'}
          type={kind === 'number' ? 'number' : 'text'}
          value={draft}
          readonly={busy}
          maxlength={kind === 'text' ? maxlength : undefined}
          min={kind === 'number' ? min : undefined}
          max={kind === 'number' ? max : undefined}
          step={kind === 'number' ? step : undefined}
          aria-labelledby={labelId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errId : undefined}
          oninput={(e) => { draft = e.currentTarget.value; error = null; }}
          onkeydown={onKeydown}
        />
      {/if}
      {#if error}<p class="err" role="alert" id={errId}>{error}</p>{/if}
    </div>
    <div class="slot">
      <IconButton size="sm" glyph="close" title="Cancel" aria-label="Cancel editing {label}" disabled={busy} onclick={() => { if (!busy) void cancel(); }} />
      <IconButton size="sm" glyph="check" primary title="Save" aria-label="Save {label}" disabled={busy} onclick={() => { if (!busy) void commit(); }} />
    </div>
  {:else}
    <span class="value">
      {#if value === ''}<span class="not-set">Not set</span>{:else if kind === 'number'}<span class="mono">{value}</span>{:else}{value}{/if}
    </span>
    <div class="slot">
      <IconButton
        size="sm"
        glyph="pencil"
        title={disabledReason ?? editTitle}
        aria-label={editTitle}
        disabled={disabledReason !== null}
        onclick={() => void openEditor()}
        bind:element={pencilEl}
      />
    </div>
  {/if}
</div>

<style>
  /* ref 1537-1551. The 54px action column is fixed in BOTH states, so opening
     never shifts the value column and the check lands where the pencil was. */
  .inline-field {
    display: grid;
    grid-template-columns: 132px 1fr 54px; /* ref 1537 */
    gap: 12px; /* ref 1537 */
    align-items: baseline; /* ref 1537 */
    padding: 9px 0; /* ref 1537 */
    border-bottom: 1px solid var(--border-soft);
  }
  .inline-field.open { align-items: start; /* ref 1543 */ }
  .label { font-size: 12.5px; /* ref 1538 */ color: var(--muted); }
  /* (b) form: centres the ~18px label line on the 30px --control-h field. */
  .open .label { padding-top: 6px; }
  .open.ta .label { padding-top: 9px; /* ref 1543 */ }
  .value {
    min-width: 0; /* (c): lets a long unbroken token wrap instead of widening the 1fr track */
    font-size: 13px; /* ref 1539 */
    line-height: 1.55; /* ref 1539 */
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .not-set { color: var(--muted); }
  .slot { display: flex; justify-content: flex-end; gap: 6px; /* ref 1546 */ align-self: center; /* ref 1540 */ }
  /* (b) form: centres a 24px button on the 30px field. */
  .open .slot { align-self: start; padding-top: 3px; }
  .open.ta .slot { padding-top: 7px; /* ref 1546 */ }
  .editor { position: relative; /* (c): anchors the sr-only hint */ min-width: 0; }
  .editor input,
  .editor textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1.5px solid var(--primary); /* ref 1544 */
    border-radius: var(--radius);
    box-shadow: 0 0 0 3px var(--primary-soft); /* ref 1544 */
    background: var(--surface);
    color: var(--text-2);
    font-size: 13px; /* ref 1544 */
  }
  .editor input { height: var(--control-h); padding: 0 10px; /* ref 1544 */ }
  .editor textarea { padding: 8px 10px; /* ref 1544 */ line-height: 1.6; /* ref 1544 */ resize: vertical; }
  .err { margin: var(--space-1) 0 0; font-size: 12.5px; /* the 12.5px meta step */ color: var(--danger); }
  /* Visually hidden, still announced (no global .sr-only class exists). No
     opacity — the gate sweeps for it. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
```

Append the D12 addendum to the forced-colors backlog file (from the repo root):

```bash
cat >> docs/backlog/global-focus-ring-invisible-in-forced-colors.md <<'EOF'

## Addendum 2026-10-06 — Slice-5a focusables (D12)

Slice 5a adds these focusables. Per the 2026-09-07 ruling none gets a per-control ring now; they all rely
on the global rule, so the polish-slice fix must cover them:

- `ui/IconButton.svelte` — every variant, including `round` and `primary` (a filled `--primary` button: an
  outline ring needs `outline-offset` so it reads off the fill).
- `ui/InlineField.svelte` — the open editor (its `--primary` border + `--primary-soft` halo marks the *open*
  state, not focus) and the row container (`tabindex="-1"`, the focus-parking spot after a read-only flip;
  deliberately unstyled).
- `editor/AccordionHeader.svelte` — the title toggle button (the chevron is `tabindex="-1"`).
- `pages/editor/VersionEditPage.svelte` — the `<h1>` course link.
- The raw create-form inputs/textareas in `VersionsPage`, `VersionEditPage`, `BlockAccordion`,
  `SequenceAccordion`, and the `VersionsPage` duplicate-row input.

`editor/ItemTypePicker.svelte` is the D12 exception: it keeps its own inset `--primary` ring plus a
forced-colors outline (the established Login / quiz-option idiom).
EOF
```

- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected per file: InlineField 37, IconButton 24, EmptyState 2, VersionBadges 6, editorReasons 7, dirtyRegistry 12, DirtyGuard 4 — all passed.

- [ ] **Step 5: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1461 passed (1461)`; `0 ERRORS 31 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (489 checks)`.

No gate change in T1 (no consumer imports the primitives yet).

- [ ] **Step 6: Reviewer probes**

Each of these mutations was confirmed to fail the named check; reviewers may re-run any of them (revert after):

- `InlineField`: `if (alive) busy = false;` → `if (alive && g === gen) busy = false;` → "discard during an in-flight commit: a late success does nothing, and reopening is writable" fails.
- `InlineField`: drop `e.stopPropagation();` in the Escape branch → the Escape-propagation tests fail.
- `InlineField`: late-failure branch `return` without `pushToast` → the late-failure tests fail.
- `InlineField`: `if (!busy) void commit();` → `void commit();` → "Enter / Escape / ✓ / ✕ while busy …" fails.
- `InlineField`: `wasDirty = !same(draft, value)` (no `!busy &&`) → the "while busy" read-only-flip tests fail.
- `InlineField`: `same()` as a plain string compare → "number: a draft equal in value (\"3.0\" vs 3) …" fails.
- `InlineField`: remove the tracker's `discard()` → the registry/discard tests fail.

- [ ] **Step 7: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ui/InlineField.svelte \
  frontend/src/components/ui/IconButton.svelte \
  frontend/src/components/ui/EmptyState.svelte \
  frontend/src/components/editor/VersionBadges.svelte \
  frontend/src/lib/editorReasons.ts \
  frontend/src/lib/dirtyRegistry.svelte.ts \
  frontend/src/components/editor/DirtyGuard.svelte \
  docs/backlog/global-focus-ring-invisible-in-forced-colors.md \
  frontend/src/tests/InlineField.svelte.test.ts \
  frontend/src/tests/IconButton.svelte.test.ts \
  frontend/src/tests/EmptyState.svelte.test.ts \
  frontend/src/tests/VersionBadges.svelte.test.ts \
  frontend/src/tests/editorReasons.test.ts \
  frontend/src/tests/dirtyRegistry.test.ts \
  frontend/src/tests/DirtyGuard.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5a T1 — InlineField, IconButton/EmptyState additions, VersionBadges, editor reasons, discard-on-confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## Task 2: Versions page (3a)

Rewrites `VersionsPage` to artboard 3a: a round back button and the course name as the `<h1>` (no "Edit ·"); a "Versions" header with a mono count and a filled `+` that reveals the collapsed create form (focusing Label); a bordered list card whose rows show `v{id}` (muted when disabled), the label, `VersionBadges`, and four always-rendered `IconButton sm` slots — Open · Duplicate · Disable/Enable · Delete — with the reasons from `editorReasons`; the duplicate row restyled as an inset row; Skeleton / page ErrorState / EmptyState ("No versions yet" with hint and action) states. Deletes the `TODO(version-slice)` theme comment. Gate section (u) adds the Slice-5a helpers and pins IconButton (first dist appearance), the EmptyState additions, VersionBadges and the page.

**Files:**
- Modify (rewrite): `frontend/src/pages/editor/VersionsPage.svelte`
- Modify: `frontend/src/styles/theme-default.css`, `frontend/scripts/visual-refresh-gate.sh`
- Test (create): `frontend/src/tests/VersionsPage.slots.svelte.test.ts`
- Test (rewrite): `frontend/src/tests/VersionsPage.duplicate.svelte.test.ts`

**Interfaces:**
- Consumes (T1): `IconButton` (`round`, `primary`, glyphs), `EmptyState` (`icon`, `hint`, `action`), `VersionBadges`, `deleteVersionReason`, `duplicateVersionReason`. Existing `versionsPageLoader` behaviour is unchanged.
- Produces: gate helpers `own`, `uniq1`, `sweep` (used by sections v–z); row slot names `"Open v{id}"`, `"Duplicate v{id}"`, `"Disable v{id}"`/`"Enable v{id}"`, `"Delete v{id}"`; the toggle `aria-label="New version"`.

- [ ] **Step 1: Write the failing tests**

File: `frontend/src/tests/VersionsPage.slots.svelte.test.ts` — full content:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Same hoisted-mock idiom as VersionsPage.duplicate.svelte.test.ts.
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});

import { navigate } from '../lib/router.svelte';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import type { Version } from '../lib/types';

const navigateMock = vi.mocked(navigate);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  navigateMock.mockReset();
  versionsPageState.course = { id: 1, slug: 'c', name: 'Applied Linear Algebra', description: '', is_admin: true };
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
async function render() {
  component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
  await settle();
}
const byLabel = (l: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`);
const slots = (id: number) => {
  const row = byLabel(`Open v${id}`)!.closest('li')!;
  return [...row.querySelectorAll<HTMLButtonElement>('.slots button')];
};

describe('VersionsPage — heading (3a)', () => {
  it('h1 is the course name only, with a round back button', async () => {
    await render();
    expect(target.querySelector('h1')!.textContent).toBe('Applied Linear Algebra');
    const back = byLabel('Back to courses')!;
    expect(back.classList.contains('round')).toBe(true);
    expect(back.getAttribute('data-glyph')).toBe('back');
    back.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses');
  });

  it('shows the version count in .mono', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 }), mkVersion({ id: 5 })];
    await render();
    const count = target.querySelector('.count')!;
    expect(count.textContent).toBe('2');
    expect(count.classList.contains('mono')).toBe(true);
  });
});

describe('VersionsPage — four fixed slots (§5.4)', () => {
  it('a created, enabled version: all four enabled with plain titles', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    const s = slots(7);
    expect(s.map((b) => b.getAttribute('data-glyph'))).toEqual(['pencil', 'duplicate', 'disable', 'trash']);
    expect(s.map((b) => b.title)).toEqual(['Open', 'Duplicate', 'Disable', 'Delete']);
    expect(s.every((b) => !b.disabled)).toBe(true);
    expect(s[3].classList.contains('danger')).toBe(true);
  });

  it('a published version: Delete disabled with its reason', async () => {
    versionsPageState.versions = [mkVersion({ id: 5, state: 'published' })];
    await render();
    const del = byLabel('Delete v5')!;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe('Delete — only for a created version');
    expect(byLabel('Duplicate v5')!.disabled).toBe(false);
  });

  it('an archived + disabled version (ref 1498): Enable slot, Duplicate and Delete disabled with reasons', async () => {
    versionsPageState.versions = [mkVersion({ id: 3, state: 'archived', is_disabled: true })];
    await render();
    const s = slots(3);
    expect(s.map((b) => b.getAttribute('data-glyph'))).toEqual(['pencil', 'duplicate', 'enable', 'trash']);
    expect(s[1].disabled).toBe(true);
    expect(s[1].title).toBe('Duplicate — enable the version first');
    expect(s[2].disabled).toBe(false);
    expect(s[3].title).toBe('Delete — only for a created version');
  });

  it('a created + disabled version: Delete says "enable the version first"', async () => {
    versionsPageState.versions = [mkVersion({ id: 9, is_disabled: true })];
    await render();
    expect(byLabel('Delete v9')!.title).toBe('Delete — enable the version first');
  });

  it('a disabled version number takes the muted hook (D5)', async () => {
    versionsPageState.versions = [mkVersion({ id: 3, is_disabled: true }), mkVersion({ id: 4 })];
    await render();
    const nums = [...target.querySelectorAll('.vnum')];
    expect(nums.map((n) => n.textContent)).toEqual(['v3', 'v4']);
    expect(nums[0].classList.contains('off')).toBe(true);
    expect(nums[1].classList.contains('off')).toBe(false);
    expect(nums[0].classList.contains('mono')).toBe(true);
  });

  it('Open navigates to the editor', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    byLabel('Open v7')!.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/7');
  });
});

describe('VersionsPage — collapsed create form (§5.3)', () => {
  it('starts collapsed; + opens it, focuses Label, swaps to close; close resets the fields', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    await render();
    expect(target.querySelector('form.create')).toBeNull();
    const toggle = byLabel('New version')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.classList.contains('primary')).toBe(true);
    toggle.click();
    await settle();
    const label = target.querySelector<HTMLInputElement>('input.new-label')!;
    expect(document.activeElement).toBe(label);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('data-glyph')).toBe('close');
    expect(toggle.title).toBe('Cancel new version');
    label.value = 'Draft';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    toggle.click();
    await settle();
    expect(target.querySelector('form.create')).toBeNull();
    toggle.click();
    await settle();
    expect(target.querySelector<HTMLInputElement>('input.new-label')!.value).toBe('');
  });
});

describe('VersionsPage — states (9d)', () => {
  it('loading renders a Skeleton', async () => {
    versionsPageState.loading = true;
    await render();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    expect(target.querySelector('h1')).toBeNull();
  });

  it('error renders a page ErrorState with Back to courses', async () => {
    versionsPageState.error = { status: 500, message: 'Server down' };
    await render();
    const es = target.querySelector('.error-state.page')!;
    expect(es.querySelector('h1')!.textContent).toBe("Couldn't load");
    expect(es.textContent).toContain('Server down');
    const back = [...es.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Back to courses')!;
    back.click();
    expect(navigateMock).toHaveBeenCalledWith('/courses');
  });

  it('empty renders the header plus an EmptyState whose action opens the form', async () => {
    await render();
    expect(target.querySelector('h2')!.textContent).toBe('Versions');
    const es = target.querySelector('.empty-state')!;
    expect(es.querySelector('.title')!.textContent).toBe('No versions yet');
    expect(es.querySelector('.tile')).not.toBeNull();
    expect(es.querySelector('.hint')!.textContent).toMatch(/^A version holds the blocks/);
    const act = [...es.querySelectorAll('button')].find((b) => b.textContent?.trim() === '+ New version')!;
    act.click();
    await settle();
    expect(target.querySelector('form.create')).not.toBeNull();
  });
});
```

File: `frontend/src/tests/VersionsPage.duplicate.svelte.test.ts` — full content:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// vi.mock is hoisted above imports, so its factory must NOT reference a
// top-level `const` (TDZ error under Vitest 2). Mock inline with vi.fn(),
// then grab typed handles via vi.mocked AFTER the imports — the repo idiom
// (see RunDetailPage.publish.svelte.test.ts).
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, post: vi.fn() } };
});
// Stub the loader so the page's onMount $effect doesn't hit the network; we
// seed versionsPageState directly.
vi.mock('../lib/versionsPageLoader.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/versionsPageLoader.svelte')>();
  return { ...real, loadVersionsPage: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...real, pushToast: vi.fn() };
});

import { navigate } from '../lib/router.svelte';
import { api } from '../lib/api';
import { versionsPageState } from '../lib/versionsPageLoader.svelte';
import { pushToast } from '../stores/toasts.svelte';
import VersionsPage from '../pages/editor/VersionsPage.svelte';
import type { Version } from '../lib/types';

// Typed handles to the already-hoisted mock fns (used in assertions + reset).
const navigateMock = vi.mocked(navigate);
const postMock = vi.mocked(api.post);
const pushToastMock = vi.mocked(pushToast);

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 1, state: 'published', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: '',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  navigateMock.mockReset();
  postMock.mockReset();
  pushToastMock.mockReset();
  versionsPageState.course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };
  versionsPageState.versions = [];
  versionsPageState.loading = false;
  versionsPageState.error = null;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

function clickButtonByText(root: HTMLElement, text: string) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
  flushSync();
}
// Slice-5a: row actions are icon buttons named by aria-label ("Duplicate v7").
function clickByLabel(root: HTMLElement, label: string) {
  const btn = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!btn) throw new Error(`button [aria-label="${label}"] not found`);
  btn.click();
  flushSync();
}

describe('VersionsPage — Duplicate', () => {
  it('opens with a clamped prefill, POSTs the label, navigates on success', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'Fall' })];
    postMock.mockResolvedValue({ id: 42 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();

    // label renders in the row (spec frontend requirement)
    expect(target.querySelector('.vlabel')?.textContent).toBe('Fall');

    clickByLabel(target, 'Duplicate v7');
    await settle();
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value).toBe('Copy of Fall');       // prefill
    expect(document.activeElement).toBe(input);     // opening focuses the input
    expect(input.maxLength).toBe(200);

    input.value = 'My Copy';
    input.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create copy');
    await settle();

    expect(postMock).toHaveBeenCalledWith('/api/versions/7/duplicate', { label: 'My Copy' });
    expect(navigateMock).toHaveBeenCalledWith('/courses/c/edit/v/42');
  });

  it('on error shows a toast and does NOT navigate', async () => {
    versionsPageState.versions = [mkVersion({ id: 7 })];
    postMock.mockRejectedValue(new Error('boom'));
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    clickButtonByText(target, 'Create copy');
    await settle();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('single-open: opening a second row does not keep the first open', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, label: 'A' }), mkVersion({ id: 8, label: 'B' })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    clickByLabel(target, 'Duplicate v8');
    const inputs = target.querySelectorAll('input.dup-label');
    expect(inputs.length).toBe(1);                    // only one row open
    expect((inputs[0] as HTMLInputElement).value).toBe('Copy of B');
  });

  it('the + New version form sends the optional label', async () => {
    postMock.mockResolvedValue({ id: 99 });
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'New version');
    await settle();
    const labelInput = target.querySelector<HTMLInputElement>('input.new-label');
    if (!labelInput) throw new Error('new-version label input missing');
    labelInput.value = 'First';
    labelInput.dispatchEvent(new Event('input'));
    flushSync();
    clickButtonByText(target, 'Create');
    await settle();
    expect(postMock).toHaveBeenCalledWith('/api/courses/1/versions', expect.objectContaining({ label: 'First' }));
  });

  it('clamps prefill to 200 chars when label exceeds 200', async () => {
    const longLabel = 'x'.repeat(300);
    versionsPageState.versions = [mkVersion({ id: 7, label: longLabel })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    const input = target.querySelector<HTMLInputElement>('input.dup-label');
    if (!input) throw new Error('duplicate label input missing');
    expect(input.value.length).toBe(200);
    expect(input.value).toBe(('Copy of ' + longLabel).slice(0, 200));
  });

  it('hides duplicate form when the row becomes disabled', async () => {
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: false })];
    component = mount(VersionsPage, { target, props: { courseSlug: 'c' } });
    await settle();
    clickByLabel(target, 'Duplicate v7');
    expect(target.querySelector('input.dup-label')).not.toBeNull(); // form open
    // Simulate the row becoming disabled (e.g., after transition('disable'))
    versionsPageState.versions = [mkVersion({ id: 7, is_disabled: true })];
    flushSync();
    await settle();
    // Form must be gone
    expect(target.querySelector('input.dup-label')).toBeNull();
    // Row rendered as disabled: the Enable slot replaces Disable, Duplicate keeps its slot disabled.
    expect(target.querySelector('button[aria-label="Enable v7"]')).not.toBeNull();
    expect(target.querySelector<HTMLButtonElement>('button[aria-label="Duplicate v7"]')!.disabled).toBe(true);
  });
});
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/VersionsPage.slots.svelte.test.ts src/tests/VersionsPage.duplicate.svelte.test.ts
```

Expected: failures on the missing `.versions-head`, the four named slots (`Duplicate v7` etc.) and the collapsed create toggle.

- [ ] **Step 3: Implement**

File: `frontend/src/pages/editor/VersionsPage.svelte` — full content:

```svelte
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import Button from '../../components/ui/Button.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import VersionBadges from '../../components/editor/VersionBadges.svelte';
  import { deleteVersionReason, duplicateVersionReason } from '../../lib/editorReasons';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { Version } from '../../lib/types';
  import {
    loadVersionsPage,
    versionsPageState,
    resetVersionsPageState,
  } from '../../lib/versionsPageLoader.svelte';

  let { courseSlug }: { courseSlug: string } = $props();

  // Reactive aliases over the module-scoped store. Routing slugs change in
  // place (App.svelte rebinds `courseSlug` rather than remounting), so the
  // store's stale-response guard prevents an in-flight 'a' from clobbering
  // a freshly-loaded 'b' — see versionsPageLoader.svelte.ts header.
  const course = $derived(versionsPageState.course);
  const versions = $derived(versionsPageState.versions);
  const loading = $derived(versionsPageState.loading);
  const error = $derived(versionsPageState.error);

  // Single in-flight flag — disables every action button (Create / Open /
  // Disable / Enable / Delete) while a POST/DELETE is awaiting completion,
  // preventing double-submit / racing transitions on the same row.
  let busy = $state(false);

  // Create form — collapsed behind the `+` toggle (visual-spec §5.3).
  let creating = $state(false);
  let info_md = $state('');
  let max_quiz_attempts = $state<number | null>(3);
  let newLabel = $state('');
  let newLabelEl = $state<HTMLInputElement>();

  async function load() {
    await loadVersionsPage(courseSlug);
  }

  // Re-runs whenever `courseSlug` changes — App.svelte updates the prop in
  // place rather than remounting the component, so onMount(load) would only
  // fire on the first slug. (Same pattern as CourseView.svelte:14.)
  $effect(() => {
    void courseSlug;
    void load();
  });

  // Reset module state on unmount so a fresh entry doesn't briefly render the
  // previous course's data before its own fetch resolves. Mirrors
  // VersionEditPage's clearEditorVersion onDestroy.
  onDestroy(() => resetVersionsPageState());

  function resetCreateForm() {
    newLabel = '';
    info_md = '';
    max_quiz_attempts = 3;
  }

  async function toggleCreate() {
    if (busy) return;
    if (creating) {
      resetCreateForm();
      creating = false;
      return;
    }
    creating = true;
    await tick();
    newLabelEl?.focus();
  }

  async function createVersion() {
    if (!course) return;
    // bind:value on <input type="number"> yields null when empty and NaN on
    // partial input; decimals (e.g. 5.5) parse cleanly but the backend
    // requires int (Pydantic ge=1/le=10) and 422s with an opaque message.
    // Validate client-side before POST.
    const n = max_quiz_attempts;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
      pushToast('Max quiz attempts must be a whole number between 1 and 10', 'error');
      return;
    }
    // Pin course.id + slug at POST-start. A prop-change mid-await would
    // otherwise let `course.id` (the route field reactively rebound) and
    // `courseSlug` drift to the new course, sending the user to the wrong
    // edit page after a race.
    const savedCourseId = course.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      const v = await api.post<Version>(`/api/courses/${savedCourseId}/versions`, { info_md, max_quiz_attempts: n, label: newLabel });
      navigate(`/courses/${savedSlug}/edit/v/${v.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to create version';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  async function transition(v: Version, action: 'disable' | 'enable') {
    // Spec §8: all state transitions follow confirm → POST → refetch / toast.
    const verb = action === 'disable' ? 'Disable' : 'Enable';
    if (!confirm(`${verb} version ${v.id}?`)) return;
    // Pin `v.id` already (closure arg). load() pins courseSlug internally, so
    // a prop-change mid-await re-loads the original course's list, not the
    // newly-routed-in slug.
    busy = true;
    try {
      await api.post(`/api/versions/${v.id}/${action}`);
      await load();
      // Close a stale duplicate form on this row after any transition. The row
      // just changed state; a concurrent disable may have hidden the form via
      // the render guard, and a later enable must not spuriously re-open it.
      if (duplicatingId === v.id) duplicatingId = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : `Could not ${action}`;
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  async function deleteVersion(v: Version) {
    if (!confirm(`Delete draft version ${v.id}? This cannot be undone.`)) return;
    busy = true;
    try {
      await api.delete(`/api/versions/${v.id}`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not delete';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }

  // Duplicate: per-row inline state. `duplicatingId` enforces a single open
  // row; `dupLabel` is the bound input value (clamped to 200 in JS — HTML
  // maxlength only bounds typing, not a programmatically-assigned value).
  let duplicatingId = $state<number | null>(null);
  let dupLabel = $state('');
  let dupInputEl = $state<HTMLInputElement>();

  async function openDuplicate(v: Version) {
    duplicatingId = v.id;
    dupLabel = ('Copy of ' + (v.label || 'v' + v.id)).slice(0, 200);
    await tick();
    dupInputEl?.focus();
  }

  async function duplicateVersion(v: Version) {
    // Pin id + slug before the await (prop-change-mid-await guard, mirroring
    // createVersion above).
    const savedId = v.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      const nv = await api.post<Version>(`/api/versions/${savedId}/duplicate`, { label: dupLabel });
      pushToast('Version duplicated', 'success');
      navigate(`/courses/${savedSlug}/edit/v/${nv.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.displayMessage : 'Failed to duplicate version';
      pushToast(msg, 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#snippet backToCourses()}
  <Button variant="secondary" onclick={() => navigate('/courses')}>Back to courses</Button>
{/snippet}

{#snippet newVersionAction()}
  <Button onclick={() => void toggleCreate()} disabled={busy}>+ New version</Button>
{/snippet}

<div class="page">
  {#if loading}
    <Skeleton rows={3} />
  {:else if error}
    <ErrorState variant="page" title="Couldn't load" message={error.message} action={backToCourses} />
  {:else if course}
    <div class="heading">
      <IconButton round glyph="back" title="Back to courses" onclick={() => navigate('/courses')} />
      <h1>{course.name}</h1>
    </div>
    <div class="versions-head">
      <h2>Versions</h2>
      <span class="mono count">{versions.length}</span>
      <span class="push">
        <IconButton
          primary
          glyph={creating ? 'close' : 'plus'}
          title={creating ? 'Cancel new version' : 'New version'}
          aria-label="New version"
          aria-expanded={creating}
          disabled={busy}
          onclick={() => void toggleCreate()}
        />
      </span>
    </div>
    {#if creating}
      <form class="create" onsubmit={(e) => { e.preventDefault(); createVersion(); }}>
        <label>Label (optional)
          <input class="new-label" type="text" maxlength="200" bind:value={newLabel} bind:this={newLabelEl} />
        </label>
        <label>Info (markdown)
          <textarea bind:value={info_md} rows="3"></textarea>
        </label>
        <label>Max quiz attempts
          <!-- Raw <input> — `Input.svelte` lacks min/max (spec Constraint 6). -->
          <input class="mono" type="number" min="1" max="10" step="1" required bind:value={max_quiz_attempts} />
        </label>
        <div class="submit"><Button type="submit" disabled={busy} loading={busy}>Create</Button></div>
      </form>
    {/if}
    {#if versions.length === 0}
      <EmptyState
        icon="list"
        title="No versions yet"
        hint="A version holds the blocks, sequences and items students see. Create one to start authoring."
        action={creating ? undefined : newVersionAction}
      />
    {:else}
      <ul class="vlist">
        {#each versions as v (v.id)}
          {@const dupReason = duplicateVersionReason(v)}
          {@const delReason = deleteVersionReason(v)}
          <li class="vrow">
            <span class="mono vnum" class:off={v.is_disabled}>v{v.id}</span>
            {#if v.label}<span class="vlabel">{v.label}</span>{/if}
            <span class="badges"><VersionBadges state={v.state} isDisabled={v.is_disabled} /></span>
            <span class="slots">
              <IconButton size="sm" glyph="pencil" title="Open" aria-label="Open v{v.id}" disabled={busy}
                onclick={() => navigate(`/courses/${courseSlug}/edit/v/${v.id}`)} />
              <IconButton size="sm" glyph="duplicate" title={dupReason ?? 'Duplicate'} aria-label="Duplicate v{v.id}"
                disabled={busy || dupReason !== null} onclick={() => void openDuplicate(v)} />
              {#if v.is_disabled}
                <IconButton size="sm" glyph="enable" title="Enable" aria-label="Enable v{v.id}" disabled={busy}
                  onclick={() => transition(v, 'enable')} />
              {:else}
                <IconButton size="sm" glyph="disable" title="Disable" aria-label="Disable v{v.id}" disabled={busy}
                  onclick={() => transition(v, 'disable')} />
              {/if}
              <IconButton size="sm" glyph="trash" danger title={delReason ?? 'Delete'} aria-label="Delete v{v.id}"
                disabled={busy || delReason !== null} onclick={() => deleteVersion(v)} />
            </span>
          </li>
          {#if !v.is_disabled && duplicatingId === v.id}
            <li class="dup-row">
              <form class="dup" onsubmit={(e) => { e.preventDefault(); duplicateVersion(v); }}>
                <label>New draft label
                  <input class="dup-label" type="text" maxlength="200" bind:value={dupLabel} bind:this={dupInputEl} disabled={busy} />
                </label>
                <Button type="submit" disabled={busy} loading={busy}>Create copy</Button>
                <Button variant="ghost" onclick={() => (duplicatingId = null)} disabled={busy}>Cancel</Button>
              </form>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  /* h1 / h2 metrics come from base.css (21px/600/-.015em, 15px/600 — ref 1474, 1477). */
  .heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; /* ref 1472 */ }
  .versions-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; /* ref 1476 */ }
  .count { font-size: 11.5px; /* ref 1478 */ color: var(--muted); }
  .push { margin-left: auto; display: flex; /* ref 1479 */ }
  .create {
    display: flex;
    flex-direction: column;
    gap: 8px; /* the 8px create-form gap (spec §4 Create forms) */
    padding: 14px;
    margin-bottom: 12px; /* the list's 12px rhythm (ref 1476) */
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .create label,
  .dup label { display: flex; flex-direction: column; gap: 4px; /* the 4px label/field step */ font-size: 12.5px; color: var(--muted); }
  .create input,
  .create textarea,
  .dup input {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .create input,
  .dup input { height: var(--control-h); padding: 0 10px; }
  .create textarea { padding: 8px 10px; }
  .submit { display: flex; justify-content: flex-end; }
  .vlist {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden; /* ref 1481 */
  }
  .vrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px 9px 14px; /* ref 1482 */
    border-bottom: 1px solid var(--border-soft);
  }
  .vlist > li:last-child { border-bottom: 0; }
  .vnum { font-size: 13px; /* ref 1483 */ color: var(--text); }
  /* D5: a disabled version recedes by its number dropping to --muted (ref 1495). */
  .vnum.off { color: var(--muted); }
  .vlabel { font-size: 13px; /* ref 1484 */ color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
  .badges { margin-left: auto; display: flex; /* ref 1485 */ }
  .slots { display: flex; gap: 6px; margin-left: 22px; /* ref 1486 */ }
  .dup-row {
    padding: 9px 12px 9px 14px; /* the row inset (ref 1482) */
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-soft);
  }
  .dup { display: flex; align-items: flex-end; gap: 8px; /* the 8px create-form gap */ }
  .dup label { flex: 1; min-width: 0; }
</style>
```

Patch for `frontend/src/styles/theme-default.css` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/styles/theme-default.css
+++ b/frontend/src/styles/theme-default.css
@@ -105,6 +105,4 @@
      contrast step below its neighbours while every element stays above 5.5:1.
      Opacity would composite the whole row — including live action glyphs —
      against the page and push the text to 2.7:1. */
-
-  /* TODO(version-slice): reconcile the disabled-version treatment with design — spec §4 prose uses --dimmed #6B7280; this reference deliberately omits --dimmed and uses --state-disabled-fg #5A616E. */
 }
PATCH
```


- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected: slots 12 passed, duplicate 6 passed.

- [ ] **Step 5: Gate section (u)**

Adds section (u) and bumps `EXPECTED_CHECKS` 489 → 591.

Patch for `frontend/scripts/visual-refresh-gate.sh` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/scripts/visual-refresh-gate.sh
+++ b/frontend/scripts/visual-refresh-gate.sh
@@ -87,7 +87,7 @@
 # checks are added, which is the failure this exists to catch (codex-r1-M2,
 # tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
 # speed bump is intentional.
-EXPECTED_CHECKS=489
+EXPECTED_CHECKS=591
 if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
   log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
   # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
@@ -3460,5 +3460,102 @@
   fi
 fi
 
+echo
+echo "--- (u) Slice-5a T2 — IconButton, EmptyState additions, VersionBadges, VersionsPage (3a) ---"
+# Slice-5a helpers (used by sections u-z):
+# own ANCHOR FILE — ANCHOR is authored as a top-level rule by FILE alone.
+own() {
+  local owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${1}[[:space:]]*[,{.:]" src --include='*.svelte')"})
+  if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == $2 ]]; then
+    echo "PASS  .$1 is authored by $2 alone"
+  else
+    echo "FAIL  .$1 owner is not $2 alone (${#owners[@]}: $owners)"; fail=1
+  fi
+}
+# uniq1 ANCHOR — ANCHOR resolves to exactly one dist hash; the hash is left in REPLY ('' on failure).
+uniq1() {
+  local hs=(${(f)"$(grep -ohE "\.${1}\.svelte-[a-z0-9]+" $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
+  if [[ ${#hs[@]} -eq 1 ]]; then
+    echo "PASS  .$1 resolves to one hash ($hs[1])"; REPLY=$hs[1]
+  else
+    echo "FAIL  .$1 not dist-unique (${#hs[@]}: $hs)"; fail=1; REPLY=''
+  fi
+}
+# sweep LABEL HASH — Constraints 1/2 over every emitted rule carrying HASH (the
+# section-(s)/(t) selector-agnostic anchors): no hex, no var() hex fallback, no opacity dim.
+sweep() {
+  none "$1 no bare hex in any declaration" "(^|[{}])[^{}]*\.${2}[^{]*\{[^}]*:[^};]*#[0-9a-fA-F]{3}"
+  none "$1 no opacity dim"                 "(^|[{}])[^{}]*\.${2}[^{]*\{[^}]*opacity:0?\.[0-9]"
+}
+
+own icon-btn IconButton.svelte
+uniq1 icon-btn
+if [[ -n $REPLY ]]; then
+  N=IconButton; H=$REPLY
+  d '\.icon-btn' '' 'display:inline-flex' 'border-radius:var\(--radius\)' 'border:1px solid var\(--border-strong\)' 'background:var\(--surface\)' 'color:var\(--muted\)' 'cursor:pointer'
+  d '\.sm' '' 'width:var\(--glyph-btn\)' 'height:var\(--glyph-btn\)'
+  d '\.md' '' 'width:28px' 'height:28px'
+  d '\.danger' '' 'color:var\(--danger\)'
+  d '\.borderless' '' 'border-color:transparent' 'background:transparent'
+  d '\.round' '' 'border-radius:50%'
+  d '\.primary' '' 'background:var\(--primary\)' 'color:var\(--primary-text\)' 'border-color:var\(--primary\)'
+  # The disabled rule must outrank .primary/.danger: it carries the extra :disabled pseudo-class.
+  d '\.icon-btn' ':disabled' 'background:var\(--bg\)' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)' 'cursor:not-allowed'
+  none "IconButton .primary is never re-asserted under :disabled" "\.primary\.${H}:disabled\{"
+  sweep IconButton $H
+fi
+
+# EmptyState: the hash section (q) derived (allem minus the run-tab exclusion set xh).
+emh=(${allem:|xh})
+if [[ ${#emh[@]} -eq 1 ]]; then
+  N=EmptyState; H=$emh[1]
+  d '\.tile' '' 'display:flex' 'width:38px' 'height:38px' 'border-radius:8px' 'background:var\(--surface-2\)' 'border:1px solid var\(--border\)' 'color:var\(--muted\)'
+  chk "\.tile\.${H} svg:where\(\.${H}\)" 'width:18px' 'height:18px'
+  d '\.hint' '' 'margin:0' 'font-size:13px' 'line-height:1\.5' 'max-width:44ch' 'color:var\(--muted\)'
+  d '\.action' '' 'margin-top:4px'
+  sweep EmptyState $H
+else
+  echo "FAIL  EmptyState hash not derivable for the Slice-5a additions (${#emh[@]}: $emh)"; fail=1
+fi
+
+own vbadge VersionBadges.svelte
+uniq1 vbadge
+if [[ -n $REPLY ]]; then
+  N=VersionBadges; H=$REPLY
+  d '\.vbadges' '' 'display:inline-flex' 'gap:6px'
+  d '\.vbadge' '' 'font-size:11px' 'font-weight:500' 'padding:3px 8px' 'border-radius:3px' 'white-space:nowrap'
+  d '\.created' '' 'background:var\(--state-created-bg\)' 'color:var\(--state-created-fg\)'
+  d '\.published' '' 'background:var\(--state-published-bg\)' 'color:var\(--state-published-fg\)'
+  d '\.archived' '' 'background:var\(--state-archived-bg\)' 'color:var\(--state-archived-fg\)'
+  d '\.off' '' 'background:var\(--state-disabled-bg\)' 'color:var\(--state-disabled-fg\)'
+  sweep VersionBadges $H
+fi
+
+own versions-head VersionsPage.svelte
+uniq1 versions-head
+if [[ -n $REPLY ]]; then
+  N=VersionsPage; H=$REPLY
+  d '\.heading' '' 'display:flex' 'align-items:center' 'gap:10px' 'margin-bottom:16px'
+  d '\.versions-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'margin-bottom:12px'
+  d '\.count' '' 'font-size:11\.5px' 'color:var\(--muted\)'
+  d '\.push' '' 'margin-left:auto'
+  d '\.vlist' '' 'list-style:none' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'overflow:hidden'
+  d '\.vrow' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:9px 12px 9px 14px' 'border-bottom:1px solid var\(--border-soft\)'
+  chk "\.vlist\.${H}>li:where\(\.${H}\):last-child" 'border-bottom:0'
+  d '\.vnum' '' 'font-size:13px' 'color:var\(--text\)'
+  d '\.vnum\.off' '' 'color:var\(--muted\)'
+  d '\.vlabel' '' 'font-size:13px' 'color:var\(--muted\)'
+  d '\.badges' '' 'margin-left:auto'
+  d '\.slots' '' 'display:flex' 'gap:6px' 'margin-left:22px'
+  d '\.dup-row' '' 'padding:9px 12px 9px 14px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border-soft\)'
+  none "VersionsPage pre-Slice-5a .badge rules gone" "\.badge\.${H}"
+  sweep VersionsPage $H
+fi
+if grep -q 'TODO(version-slice)' src/styles/theme-default.css; then
+  echo "FAIL  theme-default.css still carries the TODO(version-slice) note (D5)"; fail=1
+else
+  echo "PASS  theme-default.css TODO(version-slice) note removed (D5)"
+fi
+
 # The summary line is the parent process's (see the re-exec at the top).
 exit $fail
PATCH
```


- [ ] **Step 6: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1473 passed (1473)`; `0 ERRORS 31 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (591 checks)`.

- [ ] **Step 7: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/editor/VersionsPage.svelte \
  frontend/src/styles/theme-default.css \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/VersionsPage.slots.svelte.test.ts \
  frontend/src/tests/VersionsPage.duplicate.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(versions): Slice 5a T2 — Versions page (3a): heading, collapsed create, four-slot rows, states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## Task 3: Version editor shell — heading, banners, page states, Version info card

Restyles the top of `VersionEditPage`: the `<h1>` is the course name as a link back to the version list (plain clicks route in-app, modifier/middle clicks fall through) followed by ` · label` when set, then the mono `v{id}` and `VersionBadges`; the disabled-version information banner; Skeleton / page ErrorState states with a "Back to versions" action; an inline ErrorState for a refresh error. `VersionMetaForm` becomes the foldable "Version info" card with three `InlineField`s (each PATCHes its own field, then force-reloads if still on the version; read-only states keep the fields visible with a disabled pencil + reason). `DirtyGuard` gets `onDiscard={() => dirtyRegistry.discardAll()}`. The Blocks section and state bar are left for T4. Gate section (v) pins InlineField (first dist appearance), the card and the heading.

**Files:**
- Modify (rewrite): `frontend/src/components/editor/VersionMetaForm.svelte`
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (full content given), `frontend/scripts/visual-refresh-gate.sh`
- Test (create): `frontend/src/tests/VersionEditPage.svelte.test.ts`
- Test (rewrite): `frontend/src/tests/VersionMetaForm.label.svelte.test.ts`

**Interfaces:**
- Consumes (T1): `InlineField`, `IconButton` (`chevron`/`chevron-right`, `borderless`, `aria-expanded`, `aria-controls`), `VersionBadges`, `metaReason`, `discardAll`, `DirtyGuard.onDiscard`; `loadAdminTree(vid, { force }) → Promise<'ok' | 'error' | 'discarded'>`.
- Produces: `VersionMetaForm` props `{ vid: number; version: AdminTreeVersion }` (the `parentBusy` prop is removed); page DOM hooks `.editor-heading`, `.vid`, `.banner`, `.meta-card`; the test harness in `VersionEditPage.svelte.test.ts` (real router + store, `serve()` fetch stub) that T4 and T5b extend.

- [ ] **Step 1: Write the failing tests**

File: `frontend/src/tests/VersionEditPage.svelte.test.ts` — full content:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionEditPage from '../pages/editor/VersionEditPage.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeVersion } from '../lib/types';

// Real router + real store; only fetch is stubbed (SequenceAccordion.interactive idiom).
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 3, label: 'Autumn 2026 revision', created_at: '2026-01-01T00:00:00Z',
    published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkBlock(id: number, over: Partial<AdminTreeBlock> = {}): AdminTreeBlock {
  return { id, version_id: 1, title: `Block ${id}`, slug: `b${id}`, order: id, info: '', info_html: '', sequences: [], ...over };
}

let tree: AdminTree;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

// The admin-tree GET serves `tree` as it stands at call time, so a test can
// mutate `tree` before a refresh to model the server's new state.
function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const custom = extra(String(url), init);
    if (custom) return custom;
    if (String(url).endsWith('/admin-tree')) return jres(structuredClone(tree));
    return jres({});
  });
}

beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1', { force: true });
  tree = { course: { id: 1, name: 'Applied Linear Algebra', slug: 'c' }, version: mkVersion(), blocks: [mkBlock(10)] };
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  serve();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target.parentNode) target.parentNode.removeChild(target);
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  clearEditorVersion();
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

async function render(props: Record<string, string> = { courseSlug: 'c', versionId: '1' }) {
  component = mount(VersionEditPage, { target, props: props as { courseSlug: string; versionId: string } });
  await settle();
}

describe('VersionEditPage — heading (3b, §5.2)', () => {
  it('leads with the course link, then " · label", the mono id and the badges', async () => {
    await render();
    const h1 = target.querySelector('h1')!;
    expect(h1.textContent).toBe('Applied Linear Algebra · Autumn 2026 revision');
    const a = h1.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('/courses/c/edit');
    expect(a.title).toBe('Back to versions');
    const vid = target.querySelector('.editor-heading .vid')!;
    expect(vid.textContent).toBe('v1');
    expect(vid.classList.contains('mono')).toBe(true);
    expect(target.querySelector('.editor-heading .vbadge')!.textContent).toBe('created');
  });

  it('without a label the h1 is the course link only', async () => {
    tree.version = mkVersion({ label: '' });
    await render();
    expect(target.querySelector('h1')!.textContent).toBe('Applied Linear Algebra');
  });

  it('a plain click on the course link routes in-app', async () => {
    await render();
    const a = target.querySelector<HTMLAnchorElement>('h1 a')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(currentRoute.path).toBe('/courses/c/edit');
  });

  it('a Cmd/Ctrl-click on the course link is not intercepted', async () => {
    await render();
    let prevented: boolean | null = null;
    // Runs after the app's delegated handler; it records, then blocks jsdom's own navigation.
    const probe = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
    window.addEventListener('click', probe);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      target.querySelector('h1 a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mod }));
      await settle();
      expect(prevented).toBe(false);
      expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    }
    window.removeEventListener('click', probe);
  });

  it('a disabled version shows the information banner', async () => {
    tree.version = mkVersion({ is_disabled: true });
    await render();
    expect(target.querySelector('.banner')!.textContent).toBe('This version is disabled — editing is not allowed. Enable it first.');
  });
});

describe('VersionEditPage — page states (9d)', () => {
  it('an invalid id renders a page ErrorState with Back to versions', async () => {
    await render({ courseSlug: 'c', versionId: 'abc' });
    const es = target.querySelector('.error-state.page')!;
    expect(es.querySelector('h1')!.textContent).toBe('Bad URL');
    const back = [...es.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Back to versions')!;
    back.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit');
  });

  it('a load failure without a tree renders "Couldn\'t load"', async () => {
    serve((url) => (url.endsWith('/admin-tree') ? jres({ detail: 'Boom' }, 500) : undefined));
    await render();
    const es = target.querySelector('.error-state.page')!;
    expect(es.querySelector('h1')!.textContent).toBe("Couldn't load");
    expect(es.textContent).toContain('Boom');
  });

  it('shows a Skeleton until the tree arrives', async () => {
    let release!: () => void;
    serve((url) => (url.endsWith('/admin-tree') ? new Promise<void>((r) => { release = r; }).then(() => jres(structuredClone(tree))) : undefined));
    component = mount(VersionEditPage, { target, props: { courseSlug: 'c', versionId: '1' } });
    flushSync();
    expect(target.querySelector('.skeleton')).not.toBeNull();
    release();
    await settle();
    expect(target.querySelector('.skeleton')).toBeNull();
  });
});

describe('VersionEditPage — Version info card', () => {
  const field = (label: string) =>
    [...target.querySelectorAll<HTMLElement>('.meta-card .inline-field')].find((f) => f.querySelector('.label')?.textContent === label)!;

  it('renders three inline fields, editable on a created version', async () => {
    await render();
    const labels = [...target.querySelectorAll('.meta-card .inline-field .label')].map((l) => l.textContent);
    expect(labels).toEqual(['Label', 'Info (markdown)', 'Max quiz attempts']);
    expect(field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.disabled).toBe(false);
  });

  it('a published version still shows the fields, pencils disabled with the reason (D4)', async () => {
    tree.version = mkVersion({ state: 'published' });
    await render();
    const pencil = field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!;
    expect(pencil.disabled).toBe(true);
    expect(pencil.title).toBe('Only a created version can change its info');
  });

  it('folding keeps an open dirty draft mounted (D3)', async () => {
    await render();
    field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.click();
    await settle();
    const input = field('Label').querySelector('input')!;
    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const fold = target.querySelector<HTMLButtonElement>('button[aria-label="Collapse version info"]')!;
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    fold.click();
    flushSync();
    const body = document.getElementById(fold.getAttribute('aria-controls')!)!;
    expect(body.hidden).toBe(true);
    expect(body.contains(input)).toBe(true);
    expect(input.value).toBe('Draft');
    expect(target.querySelector('button[aria-label="Expand version info"]')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a confirmed navigation discards the open draft (onDiscard → discardAll)', async () => {
    await render();
    field('Label').querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.click();
    await settle();
    const input = field('Label').querySelector('input')!;
    input.value = 'Draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await navigate('/courses/c/edit/v/1/blocks/10');
    await settle();
    expect(field('Label').querySelector('input')).toBeNull();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
  });
});
```

File: `frontend/src/tests/VersionMetaForm.label.svelte.test.ts` — full content:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Inline vi.fn() in the (hoisted) factory — never capture a top-level const
// (TDZ under Vitest 2). Grab the typed handle via vi.mocked after imports.
vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return { ...real, api: { ...real.api, patch: vi.fn() } };
});
vi.mock('../stores/currentEditorVersion.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentEditorVersion.svelte')>();
  return { ...real, loadAdminTree: vi.fn().mockResolvedValue('ok') };
});

import { api } from '../lib/api';
import { loadAdminTree } from '../stores/currentEditorVersion.svelte';
import VersionMetaForm from '../components/editor/VersionMetaForm.svelte';
import type { AdminTreeVersion } from '../lib/types';
import { DIRTY_REGISTRY_KEY, createDirtyRegistry } from '../lib/dirtyRegistry.svelte';

const patchMock = vi.mocked(api.patch);
const loadMock = vi.mocked(loadAdminTree);

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 5, course_id: 1, state: 'created', is_disabled: false,
    info_md: '', info_html: '', max_quiz_attempts: 3, label: 'Old',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null,
    content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => { patchMock.mockReset(); loadMock.mockClear(); target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) { unmount(component); component = null; } if (target.parentNode) target.parentNode.removeChild(target); });

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

describe('VersionMetaForm — label (inline commit)', () => {
  it('PATCHes {label} only, then force-refreshes the tree', async () => {
    patchMock.mockResolvedValue({});
    component = mount(VersionMetaForm, {
      target,
      props: { vid: 5, version: mkVersion() },
      context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]),
    });
    await settle();

    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the label"]')!.click();
    await settle();
    const input = target.querySelector<HTMLInputElement>('.inline-field input')!;
    input.value = 'New Label';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="Save Label"]')!.click();
    await settle();

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith('/api/versions/5', { label: 'New Label' });
    expect(loadMock).toHaveBeenCalledWith(5, { force: true });
  });

  it('PATCHes max_quiz_attempts as a number and rejects out-of-range input inline', async () => {
    patchMock.mockResolvedValue({});
    component = mount(VersionMetaForm, {
      target,
      props: { vid: 5, version: mkVersion() },
      context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]),
    });
    await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the attempt limit"]')!.click();
    await settle();
    const input = target.querySelector<HTMLInputElement>('.inline-field input[type="number"]')!;
    input.value = '11';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="Save Max quiz attempts"]')!.click();
    await settle();
    expect(target.querySelector('.inline-field .err')!.textContent).toBe('Max quiz attempts must be a whole number between 1 and 10');
    expect(patchMock).not.toHaveBeenCalled();
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label="Save Max quiz attempts"]')!.click();
    await settle();
    expect(patchMock).toHaveBeenCalledWith('/api/versions/5', { max_quiz_attempts: 4 });
  });
});
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts src/tests/VersionMetaForm.label.svelte.test.ts
```

Expected: heading/banner/page-state/Version-info assertions fail (old `Edit · …` heading, `Spinner`, Save/Discard panel); the label test fails (no inline field).

- [ ] **Step 3: Implement**

File: `frontend/src/components/editor/VersionMetaForm.svelte` — full content:

```svelte
<script lang="ts">
  // Version info card (3b, ref 1531-1553): three per-field InlineFields, each
  // committing its own single-field PATCH (visual-spec §5.5, Slice-5a D2). Always
  // rendered — read-only states show the values as text with a disabled pencil
  // carrying the reason (D4). Foldable; the folded body stays mounted (D3), so
  // an open draft survives a fold.
  import { onDestroy } from 'svelte';
  import { api } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { metaReason } from '../../lib/editorReasons';
  import InlineField from '../ui/InlineField.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  let { vid, version }: { vid: number; version: AdminTreeVersion } = $props();

  const uid = $props.id();
  const bodyId = `${uid}-body`;
  let folded = $state(false);
  const reason = $derived(metaReason(version));

  let alive = true;
  onDestroy(() => { alive = false; });

  // One field per PATCH. A PATCH failure propagates to InlineField (inline
  // error); only the follow-up refresh is guarded — skipped if the page moved
  // to another version meanwhile (the page instance is preserved across vids).
  async function patch(field: { label: string } | { info_md: string } | { max_quiz_attempts: number }) {
    const savedVid = vid;
    await api.patch(`/api/versions/${savedVid}`, field);
    if (!alive || vid !== savedVid) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }

  function validateAttempts(n: string | number): string | null {
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10
      ? null
      : 'Max quiz attempts must be a whole number between 1 and 10';
  }
</script>

<section class="meta-card">
  <div class="card-head">
    <h2>Version info</h2>
    <IconButton
      size="sm"
      borderless
      glyph={folded ? 'chevron-right' : 'chevron'}
      title={folded ? 'Expand' : 'Collapse'}
      aria-label={folded ? 'Expand version info' : 'Collapse version info'}
      aria-expanded={!folded}
      aria-controls={bodyId}
      onclick={() => (folded = !folded)}
    />
  </div>
  <!-- No display rule on the element carrying `hidden` (an author display would
       beat the UA [hidden] rule); layout lives on the inner .fields wrapper. -->
  <div id={bodyId} hidden={folded}>
    <div class="fields">
      <InlineField
        label="Label"
        value={version.label}
        maxlength={200}
        editTitle="Edit the label"
        disabledReason={reason}
        onCommit={(p) => patch({ label: String(p) })}
      />
      <InlineField
        label="Info (markdown)"
        value={version.info_md}
        kind="textarea"
        editTitle="Edit the info"
        disabledReason={reason}
        onCommit={(p) => patch({ info_md: String(p) })}
      />
      <InlineField
        label="Max quiz attempts"
        value={version.max_quiz_attempts}
        kind="number"
        min={1}
        max={10}
        step={1}
        editTitle="Edit the attempt limit"
        disabledReason={reason}
        validate={validateAttempts}
        onCommit={(p) => patch({ max_quiz_attempts: Number(p) })}
      />
    </div>
  </div>
</section>

<style>
  .meta-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 16px 18px; /* ref 1531 */
    margin-bottom: 18px; /* ref 1531 */
  }
  .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; /* ref 1532 */ }
  h2 { font-size: 14px; /* ref 1533 — base.css h2 is 15px */ }
  .fields { display: flex; flex-direction: column; /* ref 1536 */ }
  .fields > :global(.inline-field:last-child) { border-bottom: 0; /* ref 1548 */ }
</style>
```

File: `frontend/src/pages/editor/VersionEditPage.svelte` — full content:

```svelte
<script lang="ts">
  import { setContext, onDestroy, tick } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { deriveExpansion } from '../../lib/deriveExpansion';
  import { handleStaleIdFallback } from '../../lib/handleStaleIdFallback';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import VersionMetaForm from '../../components/editor/VersionMetaForm.svelte';
  import BlockAccordion from '../../components/editor/BlockAccordion.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import VersionBadges from '../../components/editor/VersionBadges.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type Props = {
    courseSlug: string;
    versionId: string;
    blockId?: string;
    sequenceId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId }: Props = $props();

  const vid = $derived(Number(versionId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const routeBid = $derived(blockId ?? null);
  const routeSid = $derived(sequenceId ?? null);

  // Provide dirty registry BEFORE any consumer mounts (provider-before-
  // consumers ordering per spec).
  const dirtyRegistry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
  const perms = $derived(v ? versionPermissions(v) : null);

  // Tree that actually matches the URL we're rendering. During navigation
  // (X → Y, instance preserved) the store still holds X's tree until the
  // load $effect's loadAdminTree(Y) resolves. Validation and focus must
  // operate ONLY on a matching tree, otherwise they'd judge Y's routeBid /
  // routeSid against X's blocks and incorrectly redirect.
  const effectiveTree = $derived(
    tree && tree.version.id === vid && slugMatches ? tree : null,
  );

  let busy = $state(false);

  // Load $effect — declared FIRST (declaration-order discipline:
  // load → validation → focus, see spec §"$effect declaration order").
  $effect(() => {
    if (!vidValid) return;
    void loadAdminTree(vid);
  });

  // Validation $effect — declared SECOND in declaration order so stale-id
  // correction lands before the focus effect tries to find a toggle for a
  // stale entity. Uses effectiveTree (not tree) so stale-id checks aren't
  // run against the OLD version's blocks during preserved-instance nav.
  $effect(() => {
    if (!effectiveTree) return;
    const expansion = deriveExpansion(routeBid, routeSid, effectiveTree);
    if (expansion.staleBid || expansion.staleSid) {
      handleStaleIdFallback(
        { staleBid: expansion.staleBid, staleSid: expansion.staleSid },
        { courseSlug, vid: String(vid), bid: routeBid },
        { pushToast, navigate },
      );
    }
  });

  // Focus $effect — declared THIRD. Tracks (routeBid, routeSid,
  // effectiveTree) so it re-fires after the initial admin-tree load
  // resolves on deep-link mount. Uses effectiveTree (not tree) so we don't
  // try to find a header in a stale-vid tree.
  //
  // lastFocusedTarget remembers the headerId we last auto-focused. On a
  // plain tree refresh (e.g., save → loadAdminTree → currentEditorVersion
  // replaced) the route ids are unchanged, so the same headerId is computed
  // — and we skip refocus. Without this, typing in an input inside the
  // panel would lose focus on every save.
  let lastFocusedTarget = $state<string | null>(null);
  $effect(() => {
    const bid = routeBid;
    const sid = routeSid;
    const t = effectiveTree;
    if (!t) return;

    // Resolve deepest expanded headerId from current state.
    let headerId: string | null = null;
    if (bid !== null) {
      const blockMatch = t.blocks.find((b) => String(b.id) === bid);
      if (blockMatch) {
        if (sid !== null) {
          const seqMatch = blockMatch.sequences.find((s) => String(s.id) === sid);
          headerId = seqMatch
            ? `seq-${String(seqMatch.id)}-header`
            : `block-${String(blockMatch.id)}-header`;
        } else {
          headerId = `block-${String(blockMatch.id)}-header`;
        }
      }
    }
    if (!headerId) {
      // Collapsed back to version root — clear the memo so the next
      // expansion refocuses correctly.
      lastFocusedTarget = null;
      return;
    }

    // Skip refocus if route hasn't changed since the last auto-focus.
    if (headerId === lastFocusedTarget) return;
    lastFocusedTarget = headerId;

    // Capture the target headerId before await so a later effect run can't
    // race ahead of this one.
    const targetHeaderId = headerId;
    let cancelled = false;
    void (async () => {
      await tick();
      if (cancelled) return;
      // Read activeElement BEFORE any focus() call — once we focus we have
      // changed activeElement ourselves and the discriminator becomes
      // self-referential.
      const active = document.activeElement?.id ?? null;
      if (active === targetHeaderId) return; // user-click branch
      const el = document.getElementById(targetHeaderId);
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
    })();
    return () => { cancelled = true; };
  });

  let alive = true;
  onDestroy(() => { alive = false; clearEditorVersion(); });

  function stillOnVid(savedVid: number): boolean {
    return alive && vid === savedVid;
  }

  let creating = $state(false);
  let newTitle = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && newTitle.trim() !== '';
    },
  };

  // Register/unregister the create tracker — declared FOURTH in effect order.
  $effect(() => {
    if (!creating) return;
    dirtyRegistry.register(createTracker);
    return () => dirtyRegistry.unregister(createTracker);
  });

  // canStructure-flip $effect: reset create form when canEditStructure flips false.
  $effect(() => {
    if (perms && !perms.canEditStructure && creating) {
      newTitle = ''; createErrors = {}; createGlobalError = null;
      creating = false;
    }
  });

  function toggleCreate() {
    if (createBusy || busy) return;
    if (creating) { newTitle = ''; createErrors = {}; createGlobalError = null; }
    creating = !creating;
  }

  async function submitCreateBlock() {
    if (createBusy || busy || !perms?.canEditStructure || !newTitle.trim()) return;
    const savedVid = vid;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks`, { title: newTitle, info: '' });
      newTitle = ''; creating = false;
      if (!stillOnVid(savedVid)) return;
      await loadAdminTree(savedVid, { force: true });
      pushToast('Block created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title']);
      createErrors = mapped.fieldErrors;
      createGlobalError = mapped.globalMessage
        ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
      if (createGlobalError && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(createGlobalError, 'error');
      }
    } finally {
      createBusy = false;
    }
  }

  async function reorderBlock(idx: number, dir: -1 | 1) {
    if (dirtyRegistry.isAnyDirty() || busy || createBusy) return;
    if (!tree) return;
    const blocks = [...tree.blocks];
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
    const order = blocks.map((b, i) => ({ id: b.id, order: i + 1 }));
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks/reorder`, { order });
      if (!stillOnVid(savedVid)) return;
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
    }
  }

  async function transition(action: 'publish' | 'archive' | 'revert' | 'disable' | 'enable') {
    if (dirtyRegistry.isAnyDirty()) return;
    const prompts: Record<string, string> = {
      publish: `Publish version ${vid}? Students will see it.`,
      archive: `Archive version ${vid}?`,
      revert: `Revert version ${vid} to created?`,
      disable: `Disable version ${vid}?`,
      enable: `Enable version ${vid}?`,
    };
    if (!confirm(prompts[action])) return;
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/${action}`);
      await loadAdminTree(savedVid, { force: true });
      const past: Record<typeof action, string> = {
        publish: 'published', archive: 'archived', revert: 'reverted',
        disable: 'disabled', enable: 'enabled',
      };
      pushToast(`Version ${past[action]}`, 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : `Could not ${action}`, 'error');
    } finally {
      busy = false;
    }
  }

  // The course name in the <h1> is the way back to the version list (§5.2).
  // Plain left clicks route in-app; modifier / middle clicks fall through so
  // the list can open in a new tab (the router has no global anchor capture).
  function onCourseLink(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void navigate(`/courses/${courseSlug}/edit`);
  }

  async function deleteVersion() {
    if (dirtyRegistry.isAnyDirty()) return;
    if (!confirm(`Delete version ${vid}? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/versions/${savedVid}`);
      navigate(`/courses/${savedSlug}/edit`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#snippet backToVersions()}
  <Button variant="secondary" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>Back to versions</Button>
{/snippet}

<div class="page">
  {#if !vidValid}
    <ErrorState variant="page" title="Bad URL" message={`Version "${versionId}" is not a valid id.`} action={backToVersions} />
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <ErrorState variant="page" title="Couldn't load" message={loadError} action={backToVersions} />
  {:else if !tree || tree.version.id !== vid}
    <Skeleton rows={4} />
  {:else if !slugMatches}
    <ErrorState variant="page" title="Not found" message={`This version does not belong to course "${courseSlug}".`} action={backToVersions} />
  {:else if !v || !perms}
    <Skeleton rows={4} />
  {:else}
    {#if loadError}
      <div class="refresh-err">
        <ErrorState variant="inline" title="Couldn't refresh this version" message={loadError} onretry={() => void loadAdminTree(vid, { force: true })} />
      </div>
    {/if}
    <div class="editor-heading">
      <h1><a href={`/courses/${courseSlug}/edit`} title="Back to versions" onclick={onCourseLink}>{tree.course.name}</a>{#if v.label}<span class="vlabel">{` · ${v.label}`}</span>{/if}</h1>
      <span class="mono vid">v{v.id}</span>
      <VersionBadges state={v.state} isDisabled={v.is_disabled} />
    </div>

    {#if v.is_disabled}
      <p class="banner">This version is disabled — editing is not allowed. Enable it first.</p>
    {/if}

    <VersionMetaForm {vid} version={v} />

    <section class="blocks">
      <div class="head">
        <h2>Blocks</h2>
        {#if perms.canEditStructure}
          <Button
            disabled={dirtyRegistry.isAnyDirty() || busy || createBusy}
            title={dirtyRegistry.isAnyDirty() ? 'Save or discard changes first' : ''}
            onclick={toggleCreate}
          >{creating ? 'Cancel' : '+ New block'}</Button>
        {/if}
      </div>

      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreateBlock(); }}>
          <div class="field">
            <input placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
            {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          </div>
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <Button type="submit" disabled={createBusy || busy || !perms?.canEditStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
        </form>
      {/if}

      {#if tree.blocks.length === 0}
        <p class="empty">
          {perms.canEditStructure ? 'This version has no blocks yet.' : 'This version has no blocks.'}
        </p>
      {:else}
        <ul class="blocks-list">
          {#each tree.blocks as block, i (block.id)}
            <li>
              <BlockAccordion
                {courseSlug}
                {vid}
                {block}
                index={i + 1}
                blockCount={tree.blocks.length}
                {routeBid}
                {routeSid}
                onMoveUp={() => void reorderBlock(i, -1)}
                onMoveDown={() => void reorderBlock(i, 1)}
                parentBusy={busy || createBusy}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="state-actions">
      {#if perms.canPublish}
        <Button disabled={busy} onclick={() => transition('publish')}>Publish</Button>
      {/if}
      {#if perms.canArchive}
        <Button disabled={busy} onclick={() => transition('archive')}>Archive</Button>
      {/if}
      {#if perms.canRevert}
        <Button disabled={busy} onclick={() => transition('revert')}>Revert</Button>
      {/if}
      {#if perms.canDisable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('disable')}>Disable</Button>
      {/if}
      {#if perms.canEnable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('enable')}>Enable</Button>
      {/if}
      {#if perms.canDeleteVersion}
        <Button variant="ghost" disabled={busy} onclick={deleteVersion}>Delete</Button>
      {/if}
    </section>

    <DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} onDiscard={() => dirtyRegistry.discardAll()} />
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  .editor-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; /* ref 1525 */ }
  .editor-heading h1 { font-size: 20px; /* ref 1526 — base.css h1 is 21px */ min-width: 0; overflow-wrap: anywhere; }
  .editor-heading a { color: var(--primary); text-decoration: none; /* ref 1526 */ }
  .editor-heading a:hover { text-decoration: underline; }
  .vlabel { color: var(--text); /* ref 1526 */ }
  .vid { font-size: 12px; /* ref 1527 */ color: var(--muted); }
  /* §4 precondition banner, information form. */
  .banner {
    margin: 0 0 18px; /* the 18px section rhythm (ref 1525) */
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    font-size: 13px;
    color: var(--text);
  }
  .refresh-err { margin-bottom: 18px; /* the 18px section rhythm (ref 1525) */ }
  .state-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }
  .blocks { margin: var(--space-4) 0; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
  .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .blocks-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
</style>
```


- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected: VersionEditPage 12 passed, VersionMetaForm.label 2 passed.

- [ ] **Step 5: Gate section (v)**

Adds section (v), allow-lists the `.fields > :global(.inline-field:last-child)` rule in the reviewed `:global` set, and bumps `EXPECTED_CHECKS` 591 → 682.

Patch for `frontend/scripts/visual-refresh-gate.sh` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/scripts/visual-refresh-gate.sh
+++ b/frontend/scripts/visual-refresh-gate.sh
@@ -87,7 +87,7 @@
 # checks are added, which is the failure this exists to catch (codex-r1-M2,
 # tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
 # speed bump is intentional.
-EXPECTED_CHECKS=591
+EXPECTED_CHECKS=682
 if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
   log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
   # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
@@ -448,6 +448,8 @@
     ('src/pages/MiniProjectDetailPage.svelte', 'ul > li'),
     ('src/pages/MiniProjectDetailPage.svelte', 'ol > li'),
     ('src/pages/MiniProjectDetailPage.svelte', 'code'),
+    # Slice-5a T3: the last InlineField row drops its divider (ref 1548).
+    ('src/components/editor/VersionMetaForm.svelte', '.inline-field:last-child'),
 }
 def global_payloads(style):
     """(payload, …) for every `:global(...)` and `:global{…}`, balanced."""
@@ -3557,5 +3559,62 @@
   echo "PASS  theme-default.css TODO(version-slice) note removed (D5)"
 fi
 
+echo
+echo "--- (v) Slice-5a T3 — InlineField, Version info card, editor heading + banners (3b shell) ---"
+own inline-field InlineField.svelte
+uniq1 inline-field
+if [[ -n $REPLY ]]; then
+  N=InlineField; H=$REPLY
+  d '\.inline-field' '' 'display:grid' 'grid-template-columns:132px 1fr 54px' 'gap:12px' 'align-items:baseline' 'padding:9px 0' 'border-bottom:1px solid var\(--border-soft\)'
+  d '\.inline-field\.open' '' 'align-items:start'
+  d '\.label' '' 'font-size:12\.5px' 'color:var\(--muted\)'
+  chk "\.open\.${H} \.label:where\(\.${H}\)"    'padding-top:6px'
+  chk "\.open\.ta\.${H} \.label:where\(\.${H}\)" 'padding-top:9px'
+  d '\.value' '' 'min-width:0' 'font-size:13px' 'line-height:1\.55' 'color:var\(--text\)' 'white-space:pre-wrap' 'overflow-wrap:anywhere'
+  d '\.not-set' '' 'color:var\(--muted\)'
+  d '\.slot' '' 'display:flex' 'justify-content:flex-end' 'gap:6px' 'align-self:center'
+  chk "\.open\.${H} \.slot:where\(\.${H}\)"    'align-self:start' 'padding-top:3px'
+  chk "\.open\.ta\.${H} \.slot:where\(\.${H}\)" 'padding-top:7px'
+  # The open-editor treatment (ref 1544) — one selector list covers input + textarea.
+  ED="\.editor\.${H} input:where\(\.${H}\),\.editor\.${H} textarea:where\(\.${H}\)"
+  chk "$ED" 'box-sizing:border-box' 'width:100%' 'border:1\.5px solid var\(--primary\)' 'border-radius:var\(--radius\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)' 'background:var\(--surface\)' 'color:var\(--text-2\)' 'font-size:13px'
+  chk "\.editor\.${H} input:where\(\.${H}\)"    'height:var\(--control-h\)' 'padding:0 10px'
+  chk "\.editor\.${H} textarea:where\(\.${H}\)" 'padding:8px 10px' 'line-height:1\.6' 'resize:vertical'
+  d '\.err' '' 'font-size:12\.5px' 'color:var\(--danger\)'
+  d '\.sr-only' '' 'position:absolute' 'width:1px' 'height:1px' 'overflow:hidden' 'clip-path:inset\(50%\)' 'white-space:nowrap'
+  none "InlineField .sr-only uses no opacity" "\.sr-only\.${H}\{[^}]*opacity"
+  # D12: the parking row gets NO outline/ring of its own.
+  none "InlineField row has no focus styling of its own" "\.inline-field\.${H}:focus"
+  sweep InlineField $H
+fi
+
+own meta-card VersionMetaForm.svelte
+uniq1 meta-card
+if [[ -n $REPLY ]]; then
+  N=VersionMetaForm; H=$REPLY
+  d '\.meta-card' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'padding:16px 18px' 'margin-bottom:18px'
+  d '\.card-head' '' 'display:flex' 'align-items:center' 'gap:8px' 'margin-bottom:4px'
+  d 'h2' '' 'font-size:14px'
+  d '\.fields' '' 'display:flex' 'flex-direction:column'
+  chk "\.fields\.${H}>\.inline-field:last-child" 'border-bottom:0'
+  sweep VersionMetaForm $H
+fi
+
+own editor-heading VersionEditPage.svelte
+uniq1 editor-heading
+if [[ -n $REPLY ]]; then
+  N=VersionEditPage; H=$REPLY
+  d '\.editor-heading' '' 'display:flex' 'align-items:center' 'gap:10px' 'margin-bottom:18px'
+  chk "\.editor-heading\.${H} h1:where\(\.${H}\)" 'font-size:20px'
+  chk "\.editor-heading\.${H} a:where\(\.${H}\)"  'color:var\(--primary\)' 'text-decoration:none'
+  chk "\.editor-heading\.${H} a:where\(\.${H}\):hover" 'text-decoration:underline'
+  d '\.vlabel' '' 'color:var\(--text\)'
+  d '\.vid' '' 'font-size:12px' 'color:var\(--muted\)'
+  d '\.banner' '' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:13px' 'color:var\(--text\)'
+  none "VersionEditPage pre-Slice-5a .state-* badges gone" "\.state-(created|published|archived)\.${H}"
+  none "VersionEditPage .banner.err gone"                  "\.banner\.err\.${H}"
+  sweep VersionEditPage $H
+fi
+
 # The summary line is the parent process's (see the re-exec at the top).
 exit $fail
PATCH
```


- [ ] **Step 6: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1486 passed (1486)`; `0 ERRORS 27 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (682 checks)`.

- [ ] **Step 7: Reviewer probes**

Each of these mutations was confirmed to fail the named check; reviewers may re-run any of them (revert after):

- `InlineField` CSS `.open.ta .slot` `padding-top: 7px` → `6px` → gate FAIL `InlineField .open.ta… .slot… { padding-top:7px }`.
- `VersionMetaForm` last-row rule `border-bottom: 0` → `1px` → gate FAIL `VersionMetaForm .fields…>.inline-field:last-child { border-bottom:0 }`.

- [ ] **Step 8: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/VersionMetaForm.svelte \
  frontend/src/pages/editor/VersionEditPage.svelte \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/VersionEditPage.svelte.test.ts \
  frontend/src/tests/VersionMetaForm.label.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5a T3 — version editor heading, banners, page states, Version info inline fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## Task 4: Blocks card, create-block form, state-action bar, D3 confirms

Turns the Blocks section into a card with a fold chevron and a filled `+` (always rendered; disabled with `structureReason` when structure is forbidden; never blocked by drafts). An `$effect` that tracks only `routeBid` unfolds the card on every route block change, so a deep link never targets a hidden header, while the user can still fold with a block open. Opening the create form also unfolds the card and focuses Title; its tracker gains `discard()`. Empty → `EmptyState` "No blocks yet" / "This version has no blocks.". The state bar is right-aligned with Button variants (Publish primary, Archive/Revert secondary, Disable/Enable ghost, Delete danger). Transitions and delete-version are no longer blocked by a dirty field: publish/archive/disable/delete confirms gain " Unsaved edits may be lost." when dirty (revert/enable never), and delete-version navigates with `force`. `reorderBlock` drops its dirty guard. Gate section (w).

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (patch), `frontend/scripts/visual-refresh-gate.sh`
- Test (modify): `frontend/src/tests/VersionEditPage.svelte.test.ts` (patch)

**Interfaces:**
- Consumes (T1/T3): `IconButton` (`primary`, `borderless`), `EmptyState`, `structureReason`, `unsavedSuffix`, `navigate(path, { force })`.
- Produces: DOM hooks `.blocks-card`, `button[aria-label="New block"]`, `.cr-form`, `.state-actions`; the test file's `renderReactive()` helper and the hoisted-registry capture (`hoisted.registry`) used again in T5b.

- [ ] **Step 1: Write the failing tests**

Adds a module-level `scrollIntoView` stub (jsdom has none; the page focus effect calls it on route expansion), a `vi.mock` that captures the page's real dirty registry, and the Blocks-card + state-bar describe blocks.

Patch for `frontend/src/tests/VersionEditPage.svelte.test.ts` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/tests/VersionEditPage.svelte.test.ts
+++ b/frontend/src/tests/VersionEditPage.svelte.test.ts
@@ -4,6 +4,15 @@
 import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
 import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
 import type { AdminTree, AdminTreeBlock, AdminTreeVersion } from '../lib/types';
+import type { DirtyRegistry } from '../lib/dirtyRegistry.svelte';
+
+// Capture the page's real registry so a test can register a dirty tracker
+// without depending on which body (old panel / InlineField) a block renders.
+const hoisted = vi.hoisted(() => ({ registry: null as DirtyRegistry | null }));
+vi.mock('../lib/dirtyRegistry.svelte', async (importOriginal) => {
+  const m = await importOriginal<typeof import('../lib/dirtyRegistry.svelte')>();
+  return { ...m, createDirtyRegistry: () => (hoisted.registry = m.createDirtyRegistry()) };
+});
 
 // Real router + real store; only fetch is stubbed (SequenceAccordion.interactive idiom).
 const fetchSpy = vi.fn();
@@ -16,6 +25,8 @@
   } as unknown as Response);
 }
 async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
+// jsdom has no scrollIntoView; the page's focus $effect calls it on route expansion.
+Element.prototype.scrollIntoView = () => {};
 
 function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
   return {
@@ -203,3 +214,210 @@
     expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
   });
 });
+
+type PageProps = { courseSlug: string; versionId: string; blockId?: string; sequenceId?: string };
+
+// Props as a $state object so a test can change the route block id in place,
+// as App.svelte does when the router matches a new URL on the same page.
+async function renderReactive(init: PageProps = { courseSlug: 'c', versionId: '1' }) {
+  const props = $state<PageProps>(init);
+  component = mount(VersionEditPage, { target, props });
+  await settle();
+  return props;
+}
+
+function openLabelDraft() {
+  const row = [...target.querySelectorAll<HTMLElement>('.meta-card .inline-field')].find((f) => f.querySelector('.label')?.textContent === 'Label')!;
+  row.querySelector<HTMLButtonElement>('button[data-glyph="pencil"]')!.click();
+}
+async function makeDirty() {
+  openLabelDraft();
+  await settle();
+  const input = target.querySelector<HTMLInputElement>('.meta-card .inline-field input')!;
+  input.value = 'Draft';
+  input.dispatchEvent(new Event('input', { bubbles: true }));
+  flushSync();
+}
+const btnByText = (text: string) =>
+  [...target.querySelectorAll<HTMLButtonElement>('.state-actions button')].find((b) => b.textContent?.trim() === text);
+const posts = () => fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').map(([u]) => String(u));
+
+describe('VersionEditPage — Blocks card (T4)', () => {
+  const fold = () => target.querySelector<HTMLButtonElement>('.blocks-card .card-head button[aria-controls]')!;
+  const body = () => document.getElementById(fold().getAttribute('aria-controls')!)!;
+  const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New block"]')!;
+
+  it('folds and unfolds; the body stays mounted', async () => {
+    await render();
+    expect(fold().getAttribute('aria-label')).toBe('Collapse blocks');
+    expect(fold().title).toBe('Collapse');
+    fold().click();
+    flushSync();
+    expect(body().hidden).toBe(true);
+    expect(body().querySelector('.blocks-list')).not.toBeNull();
+    expect(fold().getAttribute('aria-label')).toBe('Expand blocks');
+    expect(fold().getAttribute('aria-expanded')).toBe('false');
+    expect(fold().dataset.glyph).toBe('chevron-right');
+  });
+
+  it('a route expansion unfolds a folded card, and so does block A → block B', async () => {
+    tree.blocks = [mkBlock(10), mkBlock(11)];
+    const props = await renderReactive();
+    fold().click();
+    flushSync();
+    expect(body().hidden).toBe(true);
+    props.blockId = '10';
+    await settle();
+    expect(body().hidden).toBe(false);
+    fold().click();
+    flushSync();
+    expect(body().hidden).toBe(true);
+    props.blockId = '11';
+    await settle();
+    expect(body().hidden).toBe(false);
+  });
+
+  it('folding while a block is expanded stays folded', async () => {
+    const props = await renderReactive({ courseSlug: 'c', versionId: '1', blockId: '10' });
+    expect(props.blockId).toBe('10');
+    fold().click();
+    await settle();
+    expect(body().hidden).toBe(true);
+  });
+
+  it('create-block starts collapsed; + opens it, unfolds the card and focuses Title', async () => {
+    await render();
+    expect(target.querySelector('.cr-form')).toBeNull();
+    expect(plus().title).toBe('New block');
+    expect(plus().getAttribute('aria-expanded')).toBe('false');
+    fold().click();
+    flushSync();
+    plus().click();
+    await settle();
+    expect(body().hidden).toBe(false);
+    const title = target.querySelector<HTMLInputElement>('.cr-form input')!;
+    expect(document.activeElement).toBe(title);
+    expect(plus().getAttribute('aria-label')).toBe('New block');
+    expect(plus().title).toBe('Cancel new block');
+    expect(plus().dataset.glyph).toBe('close');
+    expect(plus().getAttribute('aria-expanded')).toBe('true');
+    plus().click();
+    await settle();
+    expect(target.querySelector('.cr-form')).toBeNull();
+  });
+
+  it('+ is always rendered; on a published version it is disabled with the structure reason', async () => {
+    tree.version = mkVersion({ state: 'published' });
+    await render();
+    expect(plus().disabled).toBe(true);
+    expect(plus().title).toBe('Only a created version can change its structure');
+  });
+
+  it('+ is not blocked by an open draft (D3)', async () => {
+    await render();
+    await makeDirty();
+    expect(plus().disabled).toBe(false);
+  });
+
+  it('a confirmed navigation discards a typed create-block title', async () => {
+    await render();
+    plus().click();
+    await settle();
+    const title = target.querySelector<HTMLInputElement>('.cr-form input')!;
+    title.value = 'New block';
+    title.dispatchEvent(new Event('input', { bubbles: true }));
+    flushSync();
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
+    await navigate('/courses/c/edit/v/1/blocks/10');
+    await settle();
+    expect(confirmSpy).toHaveBeenCalledTimes(1);
+    expect(target.querySelector('.cr-form')).toBeNull();
+    await navigate('/courses/c/edit/v/1');
+    expect(confirmSpy).toHaveBeenCalledTimes(1);
+  });
+
+  it('empty: "No blocks yet" on a created version, "This version has no blocks." otherwise', async () => {
+    tree.blocks = [];
+    await render();
+    expect(target.querySelector('.blocks-card .empty-state .title')!.textContent).toBe('No blocks yet');
+    unmount(component!);
+    component = null;
+    tree.version = mkVersion({ state: 'archived' });
+    clearEditorVersion();
+    await render();
+    expect(target.querySelector('.blocks-card .empty-state .title')!.textContent).toBe('This version has no blocks.');
+  });
+});
+
+describe('VersionEditPage — state bar (T4)', () => {
+  const labels = () => [...target.querySelectorAll('.state-actions button')].map((b) => [b.textContent?.trim(), (b as HTMLElement).dataset.variant]);
+
+  it('created: Publish (primary), Disable (ghost), Delete (danger)', async () => {
+    await render();
+    expect(labels()).toEqual([['Publish', 'primary'], ['Disable', 'ghost'], ['Delete', 'danger']]);
+  });
+
+  it('published: Archive + Revert (secondary), Disable (ghost)', async () => {
+    tree.version = mkVersion({ state: 'published' });
+    await render();
+    expect(labels()).toEqual([['Archive', 'secondary'], ['Revert', 'secondary'], ['Disable', 'ghost']]);
+  });
+
+  it('disabled created: Enable (ghost) only', async () => {
+    tree.version = mkVersion({ is_disabled: true });
+    await render();
+    expect(labels()).toEqual([['Enable', 'ghost']]);
+  });
+
+  it('a dirty field does not block Publish; the confirm warns', async () => {
+    await render();
+    await makeDirty();
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
+    btnByText('Publish')!.click();
+    await settle();
+    expect(confirmSpy).toHaveBeenCalledWith('Publish version 1? Students will see it. Unsaved edits may be lost.');
+    expect(posts()).toContain('/api/versions/1/publish');
+  });
+
+  it('archive and disable warn when dirty; revert and enable never do', async () => {
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
+    tree.version = mkVersion({ state: 'published' });
+    await render();
+    hoisted.registry!.register({ isDirty: true });
+    btnByText('Archive')!.click();
+    btnByText('Disable')!.click();
+    btnByText('Revert')!.click();
+    expect(confirmSpy.mock.calls.map(([m]) => m)).toEqual([
+      'Archive version 1? Unsaved edits may be lost.',
+      'Disable version 1? Unsaved edits may be lost.',
+      'Revert version 1 to created?',
+    ]);
+  });
+
+  it('enable never carries the suffix', async () => {
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
+    tree.version = mkVersion({ is_disabled: true });
+    await render();
+    btnByText('Enable')!.click();
+    expect(confirmSpy).toHaveBeenCalledWith('Enable version 1?');
+  });
+
+  it('a clean page confirms without the suffix', async () => {
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
+    await render();
+    btnByText('Publish')!.click();
+    expect(confirmSpy).toHaveBeenCalledWith('Publish version 1? Students will see it.');
+  });
+
+  it('delete-version warns when dirty and navigates with force (one prompt only)', async () => {
+    await render();
+    await makeDirty();
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
+    btnByText('Delete')!.click();
+    await settle();
+    expect(confirmSpy).toHaveBeenCalledTimes(1);
+    expect(confirmSpy).toHaveBeenCalledWith('Delete version v1? This cannot be undone. Unsaved edits may be lost.');
+    expect(fetchSpy.mock.calls.some(([u, init]) => String(u) === '/api/versions/1' && (init as RequestInit).method === 'DELETE')).toBe(true);
+    expect(currentRoute.path).toBe('/courses/c/edit');
+  });
+});
PATCH
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts
```

Expected: the new "Blocks card (T4)" and "state bar (T4)" cases fail (no `.blocks-card`, no `New block` button, old confirm texts, dirty early-returns); the T3 cases still pass.

- [ ] **Step 3: Implement**

Patch for `frontend/src/pages/editor/VersionEditPage.svelte` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/pages/editor/VersionEditPage.svelte
+++ b/frontend/src/pages/editor/VersionEditPage.svelte
@@ -1,9 +1,10 @@
 <script lang="ts">
-  import { setContext, onDestroy, tick } from 'svelte';
+  import { setContext, onDestroy, tick, untrack } from 'svelte';
   import { api, ApiError } from '../../lib/api';
   import { navigate } from '../../lib/router.svelte';
   import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
   import { versionPermissions } from '../../lib/versionPermissions';
+  import { structureReason, unsavedSuffix } from '../../lib/editorReasons';
   import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
   import { deriveExpansion } from '../../lib/deriveExpansion';
   import { handleStaleIdFallback } from '../../lib/handleStaleIdFallback';
@@ -14,6 +15,8 @@
   import Button from '../../components/ui/Button.svelte';
   import Skeleton from '../../components/ui/Skeleton.svelte';
   import ErrorState from '../../components/ui/ErrorState.svelte';
+  import EmptyState from '../../components/ui/EmptyState.svelte';
+  import IconButton from '../../components/ui/IconButton.svelte';
   import VersionBadges from '../../components/editor/VersionBadges.svelte';
   import { pushToast } from '../../stores/toasts.svelte';
   import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
@@ -42,6 +45,7 @@
   const v = $derived(tree?.version);
   const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
   const perms = $derived(v ? versionPermissions(v) : null);
+  const blockReason = $derived(v ? structureReason(v) : null);
 
   // Tree that actually matches the URL we're rendering. During navigation
   // (X → Y, instance preserved) the store still holds X's tree until the
@@ -54,6 +58,18 @@
 
   let busy = $state(false);
 
+  // Blocks card fold (§3 T4): component-local, default open, body stays
+  // mounted (D3). Declared before the load effect: it only reads routeBid.
+  const uid = $props.id();
+  const blocksBodyId = `${uid}-blocks`;
+  let blocksFolded = $state(false);
+  // Unfold on every change of the route block id (deep link, Back/forward
+  // A → B) so the focus $effect never targets a header inside a hidden body.
+  // Tracks ONLY routeBid — the user can still fold while a block is expanded.
+  $effect(() => {
+    if (routeBid !== null) untrack(() => { blocksFolded = false; });
+  });
+
   // Load $effect — declared FIRST (declaration-order discipline:
   // load → validation → focus, see spec §"$effect declaration order").
   $effect(() => {
@@ -152,12 +168,19 @@
   let createErrors = $state<FieldErrors>({});
   let createGlobalError = $state<string | null>(null);
   let createBusy = $state(false);
+  let titleEl = $state<HTMLInputElement>();
+
+  function resetCreate() {
+    newTitle = ''; createErrors = {}; createGlobalError = null;
+  }
 
   // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
+  // discard() lets a confirmed DirtyGuard prompt really drop the draft (D3).
   const createTracker: RegisteredTracker = {
     get isDirty() {
       return creating && newTitle.trim() !== '';
     },
+    discard() { resetCreate(); creating = false; },
   };
 
   // Register/unregister the create tracker — declared FOURTH in effect order.
@@ -170,15 +193,19 @@
   // canStructure-flip $effect: reset create form when canEditStructure flips false.
   $effect(() => {
     if (perms && !perms.canEditStructure && creating) {
-      newTitle = ''; createErrors = {}; createGlobalError = null;
+      resetCreate();
       creating = false;
     }
   });
 
-  function toggleCreate() {
-    if (createBusy || busy) return;
-    if (creating) { newTitle = ''; createErrors = {}; createGlobalError = null; }
-    creating = !creating;
+  // Opening also unfolds the card — a hidden Title could not take focus.
+  async function toggleCreate() {
+    if (createBusy || busy || blockReason) return;
+    if (creating) { resetCreate(); creating = false; return; }
+    blocksFolded = false;
+    creating = true;
+    await tick();
+    titleEl?.focus();
   }
 
   async function submitCreateBlock() {
@@ -207,7 +234,7 @@
   }
 
   async function reorderBlock(idx: number, dir: -1 | 1) {
-    if (dirtyRegistry.isAnyDirty() || busy || createBusy) return;
+    if (busy || createBusy) return;
     if (!tree) return;
     const blocks = [...tree.blocks];
     const target = idx + dir;
@@ -230,13 +257,16 @@
     }
   }
 
+  // D3: transitions are never blocked by an open draft. Publish / archive /
+  // disable make every field read-only (closing open drafts), so their confirm
+  // warns; revert and enable never drop a draft.
   async function transition(action: 'publish' | 'archive' | 'revert' | 'disable' | 'enable') {
-    if (dirtyRegistry.isAnyDirty()) return;
+    const suffix = unsavedSuffix(dirtyRegistry.isAnyDirty());
     const prompts: Record<string, string> = {
-      publish: `Publish version ${vid}? Students will see it.`,
-      archive: `Archive version ${vid}?`,
+      publish: `Publish version ${vid}? Students will see it.${suffix}`,
+      archive: `Archive version ${vid}?${suffix}`,
       revert: `Revert version ${vid} to created?`,
-      disable: `Disable version ${vid}?`,
+      disable: `Disable version ${vid}?${suffix}`,
       enable: `Enable version ${vid}?`,
     };
     if (!confirm(prompts[action])) return;
@@ -267,14 +297,14 @@
   }
 
   async function deleteVersion() {
-    if (dirtyRegistry.isAnyDirty()) return;
-    if (!confirm(`Delete version ${vid}? This cannot be undone.`)) return;
+    if (!confirm(`Delete version v${vid}? This cannot be undone.${unsavedSuffix(dirtyRegistry.isAnyDirty())}`)) return;
     const savedVid = vid;
     const savedSlug = courseSlug;
     busy = true;
     try {
       await api.delete(`/api/versions/${savedVid}`);
-      navigate(`/courses/${savedSlug}/edit`);
+      // force: the user already confirmed above — no second DirtyGuard prompt.
+      void navigate(`/courses/${savedSlug}/edit`, { force: true });
     } catch (e) {
       pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
     } finally {
@@ -316,64 +346,87 @@
 
     <VersionMetaForm {vid} version={v} />
 
-    <section class="blocks">
-      <div class="head">
+    <section class="blocks-card">
+      <div class="card-head">
         <h2>Blocks</h2>
-        {#if perms.canEditStructure}
-          <Button
-            disabled={dirtyRegistry.isAnyDirty() || busy || createBusy}
-            title={dirtyRegistry.isAnyDirty() ? 'Save or discard changes first' : ''}
-            onclick={toggleCreate}
-          >{creating ? 'Cancel' : '+ New block'}</Button>
-        {/if}
+        <IconButton
+          size="sm"
+          borderless
+          glyph={blocksFolded ? 'chevron-right' : 'chevron'}
+          title={blocksFolded ? 'Expand' : 'Collapse'}
+          aria-label={blocksFolded ? 'Expand blocks' : 'Collapse blocks'}
+          aria-expanded={!blocksFolded}
+          aria-controls={blocksBodyId}
+          onclick={() => (blocksFolded = !blocksFolded)}
+        />
+        <span class="push">
+          <IconButton
+            primary
+            glyph={creating ? 'close' : 'plus'}
+            title={blockReason ?? (creating ? 'Cancel new block' : 'New block')}
+            aria-label="New block"
+            aria-expanded={creating}
+            disabled={!!blockReason || busy || createBusy}
+            onclick={() => void toggleCreate()}
+          />
+        </span>
       </div>
 
-      {#if creating}
-        <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreateBlock(); }}>
-          <div class="field">
-            <input placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
+      <!-- No display rule on the element carrying `hidden` (§3). -->
+      <div id={blocksBodyId} hidden={blocksFolded}>
+        {#if creating}
+          <form class="cr-form" onsubmit={(e) => { e.preventDefault(); void submitCreateBlock(); }}>
+            <input
+              bind:this={titleEl}
+              placeholder="Title"
+              aria-label="Block title"
+              bind:value={newTitle}
+              required
+              disabled={createBusy || busy}
+              oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }}
+            />
             {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
-          </div>
-          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
-          <Button type="submit" disabled={createBusy || busy || !perms?.canEditStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
-        </form>
-      {/if}
+            {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
+            <div class="cr-actions">
+              <Button type="submit" disabled={createBusy || busy || !perms?.canEditStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
+            </div>
+          </form>
+        {/if}
 
-      {#if tree.blocks.length === 0}
-        <p class="empty">
-          {perms.canEditStructure ? 'This version has no blocks yet.' : 'This version has no blocks.'}
-        </p>
-      {:else}
-        <ul class="blocks-list">
-          {#each tree.blocks as block, i (block.id)}
-            <li>
-              <BlockAccordion
-                {courseSlug}
-                {vid}
-                {block}
-                index={i + 1}
-                blockCount={tree.blocks.length}
-                {routeBid}
-                {routeSid}
-                onMoveUp={() => void reorderBlock(i, -1)}
-                onMoveDown={() => void reorderBlock(i, 1)}
-                parentBusy={busy || createBusy}
-              />
-            </li>
-          {/each}
-        </ul>
-      {/if}
+        {#if tree.blocks.length === 0}
+          <EmptyState title={v.state === 'created' ? 'No blocks yet' : 'This version has no blocks.'} />
+        {:else}
+          <ul class="blocks-list">
+            {#each tree.blocks as block, i (block.id)}
+              <li>
+                <BlockAccordion
+                  {courseSlug}
+                  {vid}
+                  {block}
+                  index={i + 1}
+                  blockCount={tree.blocks.length}
+                  {routeBid}
+                  {routeSid}
+                  onMoveUp={() => void reorderBlock(i, -1)}
+                  onMoveDown={() => void reorderBlock(i, 1)}
+                  parentBusy={busy || createBusy}
+                />
+              </li>
+            {/each}
+          </ul>
+        {/if}
+      </div>
     </section>
 
-    <section class="state-actions">
+    <div class="state-actions">
       {#if perms.canPublish}
-        <Button disabled={busy} onclick={() => transition('publish')}>Publish</Button>
+        <Button variant="primary" disabled={busy} onclick={() => transition('publish')}>Publish</Button>
       {/if}
       {#if perms.canArchive}
-        <Button disabled={busy} onclick={() => transition('archive')}>Archive</Button>
+        <Button variant="secondary" disabled={busy} onclick={() => transition('archive')}>Archive</Button>
       {/if}
       {#if perms.canRevert}
-        <Button disabled={busy} onclick={() => transition('revert')}>Revert</Button>
+        <Button variant="secondary" disabled={busy} onclick={() => transition('revert')}>Revert</Button>
       {/if}
       {#if perms.canDisable}
         <Button variant="ghost" disabled={busy} onclick={() => transition('disable')}>Disable</Button>
@@ -382,9 +435,9 @@
         <Button variant="ghost" disabled={busy} onclick={() => transition('enable')}>Enable</Button>
       {/if}
       {#if perms.canDeleteVersion}
-        <Button variant="ghost" disabled={busy} onclick={deleteVersion}>Delete</Button>
+        <Button variant="danger" disabled={busy} onclick={deleteVersion}>Delete</Button>
       {/if}
-    </section>
+    </div>
 
     <DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} onDiscard={() => dirtyRegistry.discardAll()} />
   {/if}
@@ -408,14 +461,38 @@
     color: var(--text);
   }
   .refresh-err { margin-bottom: 18px; /* the 18px section rhythm (ref 1525) */ }
-  .state-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }
-  .blocks { margin: var(--space-4) 0; }
-  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
-  .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
-  .create input { width: 100%; }
-  .create .field { display: flex; flex-direction: column; }
-  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
-  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
+  .blocks-card {
+    border: 1px solid var(--border);
+    border-radius: var(--radius);
+    background: var(--surface);
+    padding: 16px 18px; /* ref 1555 */
+  }
+  .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; /* ref 1556 */ }
+  h2 { font-size: 14px; /* ref 1557 — base.css h2 is 15px */ }
+  .push { margin-left: auto; display: flex; /* ref 1559 */ }
+  /* Create forms — shared look (spec §4). */
+  .cr-form { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
+  .cr-form input {
+    box-sizing: border-box;
+    width: 100%;
+    height: var(--control-h);
+    padding: 0 10px;
+    border: 1px solid var(--border-strong);
+    border-radius: var(--radius);
+    background: var(--surface);
+    color: var(--text);
+    font-size: 13px;
+  }
+  .cr-actions { display: flex; justify-content: flex-end; }
+  .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
   .blocks-list { list-style: none; padding: 0; margin: 0; }
-  .empty { color: var(--muted); }
+  .state-actions {
+    display: flex;
+    align-items: center;
+    gap: 10px;
+    justify-content: flex-end;
+    margin-top: 20px;
+    padding-top: 14px;
+    border-top: 1px solid var(--border); /* ref 1639 */
+  }
 </style>
PATCH
```


- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected: 28 passed.

- [ ] **Step 5: Gate section (w)**

Adds section (w) and bumps `EXPECTED_CHECKS` 682 → 730.

Patch for `frontend/scripts/visual-refresh-gate.sh` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/scripts/visual-refresh-gate.sh
+++ b/frontend/scripts/visual-refresh-gate.sh
@@ -87,7 +87,7 @@
 # checks are added, which is the failure this exists to catch (codex-r1-M2,
 # tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
 # speed bump is intentional.
-EXPECTED_CHECKS=682
+EXPECTED_CHECKS=730
 if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
   log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
   # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
@@ -3616,5 +3616,35 @@
   sweep VersionEditPage $H
 fi
 
+echo
+echo "--- (w) Slice-5a T4 — Blocks card, create-block form, state-action bar (3b) ---"
+own blocks-card VersionEditPage.svelte
+own state-actions VersionEditPage.svelte
+uniq1 blocks-card
+if [[ -n $REPLY ]]; then
+  N=VersionEditPage; H=$REPLY
+  d '\.blocks-card' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'padding:16px 18px'
+  none "VersionEditPage .blocks-card has no margin-bottom (last card)" "\.blocks-card\.${H}\{[^}]*margin-bottom"
+  d '\.card-head' '' 'display:flex' 'align-items:center' 'gap:8px' 'margin-bottom:10px'
+  d 'h2' '' 'font-size:14px'
+  d '\.push' '' 'margin-left:auto' 'display:flex'
+  d '\.cr-form' '' 'display:flex' 'flex-direction:column' 'gap:8px' 'padding:12px 0'
+  chk "\.cr-form\.${H} input:where\(\.${H}\)" 'box-sizing:border-box' 'width:100%' 'height:var\(--control-h\)' 'padding:0 10px' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:13px'
+  d '\.cr-actions' '' 'display:flex' 'justify-content:flex-end'
+  chk "\.field-err\.${H},\.form-err\.${H}" 'margin:0' 'font-size:12\.5px' 'color:var\(--danger\)'
+  d '\.blocks-list' '' 'list-style:none' 'padding:0' 'margin:0'
+  d '\.state-actions' '' 'display:flex' 'align-items:center' 'gap:10px' 'justify-content:flex-end' 'margin-top:20px' 'padding-top:14px' 'border-top:1px solid var\(--border\)'
+  # The pre-T4 rules are gone (old .blocks/.head/.create/.empty, rem font sizes).
+  none "VersionEditPage pre-T4 .blocks/.head/.create/.empty rules gone" "\.(blocks|head|create|empty)\.${H}[{ ,:]"
+  none "VersionEditPage no rem font sizes"                            "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
+  sweep VersionEditPage $H
+fi
+# Source: the state bar uses Button's own variants; Delete is the danger variant.
+if grep -qE '<Button variant="danger" disabled=\{busy\} onclick=\{deleteVersion\}>Delete</Button>' src/pages/editor/VersionEditPage.svelte; then
+  echo "PASS  VersionEditPage Delete uses Button variant=danger"
+else
+  echo "FAIL  VersionEditPage Delete uses Button variant=danger"; fail=1
+fi
+
 # The summary line is the parent process's (see the re-exec at the top).
 exit $fail
PATCH
```


- [ ] **Step 6: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1502 passed (1502)`; `0 ERRORS 27 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (730 checks)`.

- [ ] **Step 7: Reviewer probes**

Each of these mutations was confirmed to fail the named check; reviewers may re-run any of them (revert after):

- remove the `routeBid` unfold `$effect` body → "a route expansion unfolds a folded card …" fails.
- make the unfold effect read `blocksFolded` (`if (routeBid !== null && blocksFolded) blocksFolded = false;`) → "folding while a block is expanded stays folded" fails.
- drop `${suffix}` from archive or disable, or add it to revert → the state-bar confirm-text tests fail.
- delete-version `navigate(…)` without `{ force: true }` → "delete-version warns when dirty and navigates with force (one prompt only)" fails.
- re-add `if (dirtyRegistry.isAnyDirty()) return;` to `transition()` → the dirty-confirm transition tests fail.
- remove `createTracker.discard` → "a confirmed navigation discards a typed create-block title" fails.
- toggleCreate without `blocksFolded = false` or without `titleEl?.focus()` → "create-block starts collapsed; + opens it, unfolds the card and focuses Title" fails.
- `+` `disabled` without `!!blockReason` → the published-version `+` test fails; Delete as `variant="ghost"` → the created state-bar test fails.
- gate: `h2 { font-size: 15px }` or `.cr-actions` without `justify-content` → gate FAIL in (w).

- [ ] **Step 8: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/editor/VersionEditPage.svelte \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/VersionEditPage.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5a T4 — Blocks card, create-block form, state-action bar, warn-not-block confirms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## Task 5a: Accordion headers

Rewrites `AccordionHeader`: the toggle button (`aria-expanded`/`aria-controls`) sits inside `<h3>` (block) / `<h4>` (sequence) and shows the mono code badge (`B1`/`S1`), the title and the mono slug; block strip `--surface-2` with a bottom edge only when expanded, sequence row `--surface` with no border (D10), 13.5px sequence title (D11), no hover background. The ↑ ↓ arrows always render as `IconButton sm` with title precedence structure reason → boundary ("already first/last") → normal. An optional `extra` snippet renders before the chevron, which is `tabindex=-1`, `aria-hidden`, and prevents `mousedown` focus (D14). `BlockAccordion` passes the `+ New sequence` as `extra`: on an expanded block it toggles the (still old-style) form and focuses Title; on a collapsed block it navigates to expand first and opens the form only if the expansion landed (a cancelled DirtyGuard prompt leaves everything unchanged). The old in-body "Sequences / + New sequence" head is removed; `reorderSeq` loses its dirty guard. Bodies are untouched until T5b. Gate section (x).

**Files:**
- Modify (rewrite): `frontend/src/components/editor/AccordionHeader.svelte`
- Modify: `frontend/src/components/editor/BlockAccordion.svelte` (patch), `frontend/src/components/editor/SequenceAccordion.svelte` (patch), `frontend/scripts/visual-refresh-gate.sh`
- Test (rewrite): `frontend/src/tests/accordionHeader.svelte.test.ts`
- Test (create): `frontend/src/tests/BlockAccordion.svelte.test.ts`
- Test (modify): `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` (patch)

**Interfaces:**
- Consumes (T1): `IconButton` (`up`/`down`/`plus`/`close`/`chevron`/`chevron-right`, `tabindex`, `aria-hidden`, `onmousedown`), `structureReason`, `labelFor`.
- Produces: `AccordionHeader` props `{ headerId; panelId; level: 'block' | 'sequence'; badge: string; title: string | null; slug: string | null; index: number; expanded: boolean; busy: boolean; structureReason: string | null; canReorderUp: boolean; canReorderDown: boolean; onToggle; onMoveUp; onMoveDown; extra?: Snippet }` — `dirty` removed; `canReorder*` now mean "not at the boundary". DOM hooks `.acc-row` (`.block`/`.seq`, `.open`), `.hd`, `.code`, `.title`, `.slug`, `.actions`; the block `+` is `aria-label="New sequence in {block name}"`.

- [ ] **Step 1: Write the failing tests**

File: `frontend/src/tests/accordionHeader.svelte.test.ts` — full content:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import AccordionHeader from '../components/editor/AccordionHeader.svelte';

// Slice-5a T5a: the header is a section heading wrapping the accessible
// toggle; the reorder arrows ALWAYS render (disabled with a reason at the
// boundary or when structure is forbidden); the chevron is a pointer-only
// convenience (D14).

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

function mountHeader(overrides: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(AccordionHeader, {
    target,
    props: {
      headerId: 'h1',
      panelId: 'p1',
      level: 'block',
      badge: 'B2',
      title: 'Intro',
      slug: 'intro',
      index: 2, // middle row by default
      expanded: false,
      busy: false,
      structureReason: null,
      canReorderUp: true,
      canReorderDown: true,
      onToggle: () => {},
      onMoveUp: () => {},
      onMoveDown: () => {},
      ...overrides,
    } as never,
  });
  cleanup = () => { void unmount(cmp); };
  flushSync();
  return target;
}

const up = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('[aria-label^="Move block up"], [aria-label^="Move sequence up"]')!;
const down = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('[aria-label^="Move block down"], [aria-label^="Move sequence down"]')!;
const chevron = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')!;

describe('AccordionHeader — heading + toggle', () => {
  it('a block toggle sits inside an <h3> with the accordion ARIA contract', () => {
    const t = mountHeader();
    const btn = t.querySelector<HTMLButtonElement>('#h1')!;
    expect(btn.parentElement!.tagName).toBe('H3');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('p1');
    expect(btn.getAttribute('aria-label')).toBe('Intro');
  });

  it('a sequence toggle sits inside an <h4>', () => {
    const t = mountHeader({ level: 'sequence', badge: 'S1' });
    expect(t.querySelector('#h1')!.parentElement!.tagName).toBe('H4');
    expect(t.querySelector('.acc-row')!.classList.contains('seq')).toBe(true);
  });

  it('the toggle shows the mono code badge, the title and the mono slug (aria-hidden)', () => {
    const t = mountHeader();
    const btn = t.querySelector('#h1')!;
    const code = btn.querySelector('.code')!;
    expect(code.textContent).toBe('B2');
    expect(code.classList.contains('mono')).toBe(true);
    expect(btn.querySelector('.title')!.textContent).toBe('Intro');
    const slug = btn.querySelector('.slug')!;
    expect(slug.textContent).toBe('/intro');
    expect(slug.classList.contains('mono')).toBe(true);
    expect(slug.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a positional placeholder when title and slug are empty', () => {
    const t = mountHeader({ title: '', slug: '' });
    expect(t.querySelector('#h1 .title')!.textContent).toBe('(block 2)');
    expect(t.querySelector('#h1')!.getAttribute('aria-label')).toBe('block 2');
    expect(t.querySelector('#h1 .slug')).toBeNull();
  });

  it('only an expanded block header carries the open (border) hook', () => {
    expect(mountHeader().querySelector('.acc-row')!.classList.contains('open')).toBe(false);
    cleanup?.();
    expect(mountHeader({ expanded: true }).querySelector('.acc-row')!.classList.contains('open')).toBe(true);
  });
});

describe('AccordionHeader — reorder arrows (always rendered)', () => {
  it('a middle row has both arrows enabled with plain titles and named labels', () => {
    const t = mountHeader();
    expect(up(t).disabled).toBe(false);
    expect(up(t).title).toBe('Move up');
    expect(up(t).getAttribute('aria-label')).toBe('Move block up: Intro');
    expect(down(t).disabled).toBe(false);
    expect(down(t).title).toBe('Move down');
    expect(down(t).getAttribute('aria-label')).toBe('Move block down: Intro');
  });

  it('the first row keeps a disabled up arrow titled "already first"', () => {
    const t = mountHeader({ canReorderUp: false });
    expect(up(t).disabled).toBe(true);
    expect(up(t).title).toBe('Move up — already first');
    expect(down(t).disabled).toBe(false);
  });

  it('the last row keeps a disabled down arrow titled "already last"', () => {
    const t = mountHeader({ canReorderDown: false });
    expect(down(t).disabled).toBe(true);
    expect(down(t).title).toBe('Move down — already last');
    expect(up(t).disabled).toBe(false);
  });

  it('a structure reason disables both arrows and wins over the boundary title', () => {
    const reason = 'Only a created version can change its structure';
    const t = mountHeader({ structureReason: reason, canReorderUp: false });
    expect(up(t).disabled).toBe(true);
    expect(up(t).title).toBe(reason);
    expect(down(t).disabled).toBe(true);
    expect(down(t).title).toBe(reason);
  });

  it('busy disables both arrows; titles stay the normal ones', () => {
    const t = mountHeader({ busy: true });
    expect(up(t).disabled).toBe(true);
    expect(up(t).title).toBe('Move up');
    expect(down(t).disabled).toBe(true);
  });

  it('clicking an enabled arrow calls its handler', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const t = mountHeader({ onMoveUp, onMoveDown });
    up(t).click();
    down(t).click();
    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
  });
});

describe('AccordionHeader — chevron (D14) and extra', () => {
  it('the chevron is out of the tab order, hidden from AT, and swaps glyph + title', () => {
    let t = mountHeader();
    expect(chevron(t).tabIndex).toBe(-1);
    expect(chevron(t).dataset.glyph).toBe('chevron-right');
    expect(chevron(t).title).toBe('Expand');
    cleanup?.();
    t = mountHeader({ expanded: true });
    expect(chevron(t).dataset.glyph).toBe('chevron');
    expect(chevron(t).title).toBe('Collapse');
  });

  it('the chevron toggles, and its mousedown never takes focus', () => {
    const onToggle = vi.fn();
    const t = mountHeader({ onToggle });
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    chevron(t).dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    chevron(t).click();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders `extra` between the down arrow and the chevron', () => {
    const extra = createRawSnippet(() => ({ render: () => '<button class="probe">+</button>' }));
    const t = mountHeader({ extra });
    const glyphs = [...t.querySelectorAll('.actions > button')].map((b) => (b as HTMLElement).dataset.glyph ?? b.className);
    expect(glyphs).toEqual(['up', 'down', 'probe', 'chevron-right']);
  });
});
```

File: `frontend/src/tests/BlockAccordion.svelte.test.ts` — full content:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockAccordion from '../components/editor/BlockAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, matchRoute, registerNavigationGuard, __resetGuardsForTests } from '../lib/router.svelte';
import { routes } from '../routes';
import type { AdminTreeBlock, AdminTreeVersion } from '../lib/types';

// Real router + store; fetch stubbed. Route-derived props are getters over
// currentRoute, as App.svelte supplies them, so `expanded` follows navigate().
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 1, label: '', created_at: '2026-01-01T00:00:00Z', published_at: null,
    archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkBlock(over: Partial<AdminTreeBlock> = {}): AdminTreeBlock {
  return { id: 3, version_id: 1, title: 'Vectors', slug: 'vectors', order: 1, info: '', info_html: '', sequences: [], ...over };
}

let target: HTMLDivElement;
let registry: DirtyRegistry;
let cleanup: (() => void) | null = null;

beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1', { force: true });
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  currentEditorVersion.value = { course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [mkBlock()] };
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  cleanup?.(); cleanup = null;
  target.remove();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

const param = (k: string) => matchRoute(routes, currentRoute.path)?.params[k] ?? null;

function mountBlock(block: AdminTreeBlock = mkBlock(), over: { index?: number; blockCount?: number } = {}) {
  registry = createDirtyRegistry();
  const cmp = mount(BlockAccordion, {
    target,
    context: new Map([[DIRTY_REGISTRY_KEY, registry]]),
    props: {
      courseSlug: 'c', vid: 1, block, index: over.index ?? 1, blockCount: over.blockCount ?? 2,
      get routeBid() { return param('blockId'); },
      get routeSid() { return param('sequenceId'); },
      onMoveUp: vi.fn(), onMoveDown: vi.fn(),
    },
  });
  cleanup = () => unmount(cmp);
  flushSync();
}

// Dirty the block's own title draft (the pre-T5b Save/Discard panel input).
function dirtyBlockTitle() {
  const input = target.querySelector<HTMLInputElement>('#block-3-panel .meta input')!;
  input.value = 'Changed';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New sequence in Vectors"]')!;
const createTitle = () => target.querySelector<HTMLInputElement>('input[placeholder="Title"]');

describe('BlockAccordion — header (T5a)', () => {
  it('the header is an <h3> toggle with the B{index} badge and the slug', () => {
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const toggle = target.querySelector<HTMLButtonElement>('#block-3-header')!;
    expect(toggle.parentElement!.tagName).toBe('H3');
    expect(toggle.querySelector('.code')!.textContent).toBe('B2');
    expect(toggle.querySelector('.slug')!.textContent).toBe('/vectors');
  });

  it('arrows always render: boundary titles on an editable version', () => {
    mountBlock(mkBlock(), { index: 1, blockCount: 1 });
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    const down = target.querySelector<HTMLButtonElement>('[aria-label="Move block down: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Move up — already first');
    expect(down.disabled).toBe(true);
    expect(down.title).toBe('Move down — already last');
  });

  it('a published version keeps the arrows and the + with the structure reason', () => {
    currentEditorVersion.value!.version = mkVersion({ state: 'published' });
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const reason = 'Only a created version can change its structure';
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe(reason);
    expect(plus().disabled).toBe(true);
    expect(plus().title).toBe(reason);
  });

  it('the old in-body "+ New sequence" button is gone', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.includes('New sequence'))).toBe(false);
    expect(target.querySelector('#block-3-panel h3')).toBeNull();
  });

  it('+ on an expanded block toggles the create form and focuses Title', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect(plus().title).toBe('New sequence');
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    plus().click();
    await settle();
    expect(document.activeElement).toBe(createTitle());
    expect(plus().dataset.glyph).toBe('close');
    expect(plus().title).toBe('Cancel new sequence');
    expect(plus().getAttribute('aria-expanded')).toBe('true');
    plus().click();
    await settle();
    expect(createTitle()).toBeNull();
  });

  it('+ on a collapsed block expands it, then opens the form with Title focused', async () => {
    mountBlock();
    expect(createTitle()).toBeNull();
    plus().click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(document.activeElement).toBe(createTitle());
    expect(plus().getAttribute('aria-expanded')).toBe('true');
  });

  it('+ on a collapsed block with a cancelled guard prompt changes nothing', async () => {
    registerNavigationGuard(() => false);
    mountBlock();
    plus().click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(createTitle()).toBeNull();
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    // Nothing latent either: expanding later must not reveal a pre-opened form.
    __resetGuardsForTests();
    target.querySelector<HTMLButtonElement>('#block-3-header')!.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(createTitle()).toBeNull();
  });

  it('a reorder is not blocked by an open draft (D3)', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock(mkBlock({ sequences: [
      { id: 7, block_id: 3, title: 'S one', slug: 's1', order: 1, items: [] },
      { id: 8, block_id: 3, title: 'S two', slug: 's2', order: 2, items: [] },
    ] }));
    await settle();
    dirtyBlockTitle();
    expect(registry.isAnyDirty()).toBe(true);
    target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: S one"]')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/blocks/3/sequences/reorder')).toBe(true);
  });
});
```

Patch for `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
+++ b/frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
@@ -90,3 +90,16 @@
   newBtn.click(); flushSync();
   expect(target.querySelector('input[value="interactive_app"]')).not.toBeNull();
 });
+
+it('the header is an <h4> toggle with the S{index} badge; arrows render at the boundary (T5a)', () => {
+  const target = mountAccordion();
+  const toggle = target.querySelector<HTMLButtonElement>('#seq-2-header')!;
+  expect(toggle.parentElement!.tagName).toBe('H4');
+  expect(toggle.querySelector('.code')!.textContent).toBe('S1');
+  const up = target.querySelector<HTMLButtonElement>('[aria-label="Move sequence up: Seq"]')!;
+  const down = target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: Seq"]')!;
+  expect(up.disabled).toBe(true);
+  expect(up.title).toBe('Move up — already first');
+  expect(down.disabled).toBe(true);
+  expect(down.title).toBe('Move down — already last');
+});
PATCH
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/accordionHeader.svelte.test.ts src/tests/BlockAccordion.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts
```

Expected: header cases fail (no `<h3>`/`<h4>` wrapper, no badge, arrows omitted at the boundary, no chevron); `BlockAccordion` cases fail (no `New sequence in Vectors` button).

- [ ] **Step 3: Implement**

File: `frontend/src/components/editor/AccordionHeader.svelte` — full content:

```svelte
<script lang="ts">
  // Block / sequence accordion header (3b, ref 1564-1568 block, 1572-1576
  // sequence). The accessible toggle is the title button inside the section
  // heading; the chevron at the far right is a pointer convenience only (D14).
  import type { Snippet } from 'svelte';
  import { labelFor } from '../../lib/labelFor';
  import IconButton from '../ui/IconButton.svelte';

  type Props = {
    headerId: string;
    panelId: string;
    level: 'block' | 'sequence';
    // Code badge: 'B1' / 'S1' (ref 1565).
    badge: string;
    title: string | null;
    slug: string | null;
    index: number;
    expanded: boolean;
    busy: boolean;
    // Non-null when the version forbids structure changes; disables the
    // arrows with this reason as their title.
    structureReason: string | null;
    // "Not at the boundary in that direction". The arrows ALWAYS render
    // (§4 keep the slot count fixed); a boundary arrow is disabled with a
    // reason instead of omitted.
    canReorderUp: boolean;
    canReorderDown: boolean;
    onToggle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    // Extra right-group control before the chevron (the block's `+`).
    extra?: Snippet;
  };

  let {
    headerId,
    panelId,
    level,
    badge,
    title,
    slug,
    index,
    expanded,
    busy,
    structureReason,
    canReorderUp,
    canReorderDown,
    onToggle,
    onMoveUp,
    onMoveDown,
    extra,
  }: Props = $props();

  // Placeholder text when both title and slug are missing. Visible form
  // wraps it in parens to mark "this is a placeholder, not a real name";
  // aria-label uses the plain form so screen readers don't announce stray
  // punctuation.
  const placeholder = $derived(`${level} ${index}`);
  const ariaName = $derived(labelFor(title, slug, placeholder));
  const visibleTitle = $derived(title?.trim() || slug?.trim() || `(${placeholder})`);

  // Title precedence: structure reason → boundary → normal.
  const upTitle = $derived(structureReason ?? (canReorderUp ? 'Move up' : 'Move up — already first'));
  const downTitle = $derived(structureReason ?? (canReorderDown ? 'Move down' : 'Move down — already last'));
</script>

{#snippet toggle()}
  <button
    id={headerId}
    class="toggle"
    aria-expanded={expanded}
    aria-controls={panelId}
    aria-label={ariaName}
    onclick={onToggle}
  >
    <span class="mono code">{badge}</span>
    <span class="title">{visibleTitle}</span>
    {#if title?.trim() && slug?.trim()}
      <span class="mono slug" aria-hidden="true">/{slug}</span>
    {/if}
  </button>
{/snippet}

<div class="acc-row" class:block={level === 'block'} class:seq={level === 'sequence'} class:open={expanded}>
  {#if level === 'block'}
    <h3 class="hd">{@render toggle()}</h3>
  {:else}
    <h4 class="hd">{@render toggle()}</h4>
  {/if}
  <span class="actions">
    <IconButton
      size="sm"
      glyph="up"
      title={upTitle}
      aria-label={`Move ${level} up: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderUp}
      onclick={onMoveUp}
    />
    <IconButton
      size="sm"
      glyph="down"
      title={downTitle}
      aria-label={`Move ${level} down: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderDown}
      onclick={onMoveDown}
    />
    {@render extra?.()}
    <!-- D14: not in the tab order, not announced; mousedown is prevented so a
         click never leaves focus on an aria-hidden element. -->
    <IconButton
      size="sm"
      borderless
      glyph={expanded ? 'chevron' : 'chevron-right'}
      title={expanded ? 'Collapse' : 'Expand'}
      tabindex={-1}
      aria-hidden="true"
      onmousedown={(e) => e.preventDefault()}
      onclick={onToggle}
    />
  </span>
</div>

<style>
  .acc-row { display: flex; align-items: center; gap: 10px; /* ref 1564 */ }
  .block { padding: 9px 12px; background: var(--surface-2); /* ref 1564 */ }
  .block.open { border-bottom: 1px solid var(--border); /* ref 1564 vs 1630 */ }
  /* D10: the sequence header has no border; its body supplies the top rule. */
  .seq { padding: 8px 12px; background: var(--surface); /* ref 1572 */ }
  .hd { margin: 0; flex: 1 1 auto; min-width: 0; font: inherit; }
  /* No hover background — the strip tint is the affordance. */
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px; /* ref 1564 */
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .code {
    font-size: 11px;
    font-weight: 500;
    color: var(--primary);
    background: var(--primary-soft);
    padding: 2px 6px;
    border-radius: 3px; /* ref 1565 */
  }
  .title { font-size: 14px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; /* ref 1566 */ }
  .seq .title { font-size: 13.5px; /* D11 — visual-spec :265-266 over ref 1574's 13px */ }
  .slug { font-size: 12px; color: var(--muted); /* ref 1567 */ }
  .actions { display: flex; align-items: center; gap: 6px; /* ref 1568 */ }
</style>
```

Patch for `frontend/src/components/editor/BlockAccordion.svelte` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/components/editor/BlockAccordion.svelte
+++ b/frontend/src/components/editor/BlockAccordion.svelte
@@ -1,16 +1,19 @@
 <script lang="ts">
-  import { getContext, onDestroy } from 'svelte';
+  import { getContext, onDestroy, tick } from 'svelte';
   import AccordionHeader from './AccordionHeader.svelte';
   import SequenceAccordion from './SequenceAccordion.svelte';
   import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
   import { makeDirtyTracker } from '../../lib/dirty.svelte';
   import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
   import { versionPermissions } from '../../lib/versionPermissions';
+  import { structureReason } from '../../lib/editorReasons';
+  import { labelFor } from '../../lib/labelFor';
   import { navigate } from '../../lib/router.svelte';
   import { api, ApiError } from '../../lib/api';
   import { pushToast } from '../../stores/toasts.svelte';
   import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
   import Button from '../ui/Button.svelte';
+  import IconButton from '../ui/IconButton.svelte';
   import type { AdminTreeBlock } from '../../lib/types';
 
   type Props = {
@@ -54,6 +57,8 @@
   const perms = $derived(version ? versionPermissions(version) : null);
   const canEdit = $derived(perms?.canEditTextFields ?? false);
   const canStructure = $derived(perms?.canEditStructure ?? false);
+  const structReason = $derived(version ? structureReason(version) : null);
+  const name = $derived(labelFor(block.title, block.slug, `block ${index}`));
 
   type Meta = { title: string; info: string };
   const tracker = makeDirtyTracker<Meta>({ title: block.title, info: block.info });
@@ -172,7 +177,7 @@
     // `busy || createBusy || parentBusy`, but a stale/programmatic click
     // could still call this. A second reorder while one is in flight would
     // see a pre-swap snapshot of block.sequences.
-    if (tracker.isDirty || busy || createBusy || parentBusy) return;
+    if (busy || createBusy || parentBusy) return;
     const seqs = [...block.sequences];
     const target = idx + dir;
     if (target < 0 || target >= seqs.length) return;
@@ -202,6 +207,7 @@
   let createErrors = $state<FieldErrors>({});
   let createGlobalError = $state<string | null>(null);
   let createBusy = $state(false);
+  let titleEl = $state<HTMLInputElement>();
 
   // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
   const createTracker: RegisteredTracker = {
@@ -229,14 +235,31 @@
     }
   });
 
-  function toggleCreate() {
+  async function toggleCreate() {
     // Defense-in-depth: refuse mid-flight toggles. The toggle button is
     // already disabled in these states, but a stale/programmatic click
     // would otherwise unmount the form during an in-flight POST,
     // discarding validation errors and unregistering the create tracker.
     if (createBusy || busy || parentBusy) return;
-    if (creating) { newTitle = ''; createErrors = {}; createGlobalError = null; }
-    creating = !creating;
+    if (creating) { newTitle = ''; createErrors = {}; createGlobalError = null; creating = false; return; }
+    creating = true;
+    await tick();
+    titleEl?.focus();
+  }
+
+  // The header `+` (ref 1568). On a collapsed block it first expands the block
+  // through the router (so the DirtyGuard prompt still applies), then opens
+  // the form only if the expansion actually landed — a cancelled prompt
+  // leaves everything unchanged.
+  async function onPlus() {
+    if (structReason || createBusy || busy || parentBusy) return;
+    if (expanded) { await toggleCreate(); return; }
+    await navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
+    await tick();
+    if (!expanded) return;
+    creating = true;
+    await tick();
+    titleEl?.focus();
   }
 
   async function submitCreate() {
@@ -278,14 +301,27 @@
     slug={block.slug}
     {index}
     {expanded}
-    dirty={tracker.isDirty}
+    badge={`B${index}`}
     busy={busy || createBusy || parentBusy}
-    canReorderUp={canStructure && index > 1}
-    canReorderDown={canStructure && index < blockCount}
+    structureReason={structReason}
+    canReorderUp={index > 1}
+    canReorderDown={index < blockCount}
     onToggle={toggle}
     {onMoveUp}
     {onMoveDown}
-  />
+  >
+    {#snippet extra()}
+      <IconButton
+        size="sm"
+        glyph={creating && expanded ? 'close' : 'plus'}
+        title={structReason ?? (creating && expanded ? 'Cancel new sequence' : 'New sequence')}
+        aria-label={`New sequence in ${name}`}
+        aria-expanded={creating && expanded}
+        disabled={!!structReason || busy || createBusy || parentBusy}
+        onclick={() => void onPlus()}
+      />
+    {/snippet}
+  </AccordionHeader>
 
   {#if expanded}
     <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
@@ -301,21 +337,10 @@
       {/if}
 
       <section class="seqs">
-        <div class="head">
-          <h3>Sequences</h3>
-          {#if canStructure}
-            <Button
-              disabled={tracker.isDirty || busy || createBusy || parentBusy}
-              title={tracker.isDirty ? 'Save or discard changes first' : ''}
-              onclick={toggleCreate}
-            >{creating ? 'Cancel' : '+ New sequence'}</Button>
-          {/if}
-        </div>
-
         {#if creating}
           <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
             <div class="field">
-              <input placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
+              <input bind:this={titleEl} placeholder="Title" bind:value={newTitle} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
               {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
             </div>
             {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
@@ -371,7 +396,6 @@
   .meta label { display: block; margin: var(--space-2) 0; }
   .meta input, .meta textarea { width: 100%; }
   .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
-  .head { display: flex; justify-content: space-between; align-items: center; }
   .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
   .create input { width: 100%; }
   .create .field { display: flex; flex-direction: column; }
PATCH
```

Patch for `frontend/src/components/editor/SequenceAccordion.svelte` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/components/editor/SequenceAccordion.svelte
+++ b/frontend/src/components/editor/SequenceAccordion.svelte
@@ -7,6 +7,7 @@
   import { makeDirtyTracker } from '../../lib/dirty.svelte';
   import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
   import { versionPermissions } from '../../lib/versionPermissions';
+  import { structureReason } from '../../lib/editorReasons';
   import { navigate } from '../../lib/router.svelte';
   import { api, ApiError } from '../../lib/api';
   import { pushToast } from '../../stores/toasts.svelte';
@@ -57,6 +58,7 @@
   const perms = $derived(version ? versionPermissions(version) : null);
   const canEdit = $derived(perms?.canEditTextFields ?? false);
   const canStructure = $derived(perms?.canEditStructure ?? false);
+  const structReason = $derived(version ? structureReason(version) : null);
 
   type Meta = { title: string };
   const tracker = makeDirtyTracker<Meta>({ title: seq.title });
@@ -300,10 +302,11 @@
     slug={seq.slug}
     {index}
     {expanded}
-    dirty={tracker.isDirty}
+    badge={`S${index}`}
     busy={busy || createBusy || parentBusy}
-    canReorderUp={canStructure && index > 1}
-    canReorderDown={canStructure && index < sequenceCount}
+    structureReason={structReason}
+    canReorderUp={index > 1}
+    canReorderDown={index < sequenceCount}
     onToggle={toggle}
     {onMoveUp}
     {onMoveDown}
PATCH
```


- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected: accordionHeader 14, BlockAccordion 8, SequenceAccordion.interactive 3 — all passed.

- [ ] **Step 5: Gate section (x)**

Adds section (x) and bumps `EXPECTED_CHECKS` 730 → 775.

Patch for `frontend/scripts/visual-refresh-gate.sh` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/scripts/visual-refresh-gate.sh
+++ b/frontend/scripts/visual-refresh-gate.sh
@@ -87,7 +87,7 @@
 # checks are added, which is the failure this exists to catch (codex-r1-M2,
 # tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
 # speed bump is intentional.
-EXPECTED_CHECKS=730
+EXPECTED_CHECKS=775
 if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
   log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
   # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
@@ -3646,5 +3646,36 @@
   echo "FAIL  VersionEditPage Delete uses Button variant=danger"; fail=1
 fi
 
+echo
+echo "--- (x) Slice-5a T5a — accordion headers (3b) ---"
+own acc-row AccordionHeader.svelte
+uniq1 acc-row
+if [[ -n $REPLY ]]; then
+  N=AccordionHeader; H=$REPLY
+  d '\.acc-row' '' 'display:flex' 'align-items:center' 'gap:10px'
+  d '\.block' '' 'padding:9px 12px' 'background:var\(--surface-2\)'
+  d '\.block\.open' '' 'border-bottom:1px solid var\(--border\)'
+  # D10: only an EXPANDED block header carries the bottom edge; the sequence header none.
+  none "AccordionHeader collapsed block header has no border" "\.block\.${H}\{[^}]*border"
+  d '\.seq' '' 'padding:8px 12px' 'background:var\(--surface\)'
+  none "AccordionHeader sequence header has no border (D10)" "\.seq\.${H}\{[^}]*border"
+  d '\.hd' '' 'margin:0' 'flex:1 1 auto' 'min-width:0' 'font:inherit'
+  d '\.toggle' '' 'display:flex' 'align-items:center' 'gap:10px' 'width:100%' 'padding:0' 'border:0' 'background:transparent' 'color:var\(--text\)' 'text-align:left' 'cursor:pointer'
+  none "AccordionHeader toggle has no hover background" "\.toggle\.${H}:hover"
+  d '\.code' '' 'font-size:11px' 'font-weight:500' 'color:var\(--primary\)' 'background:var\(--primary-soft\)' 'padding:2px 6px' 'border-radius:3px'
+  d '\.title' '' 'font-size:14px' 'font-weight:600'
+  chk "\.seq\.${H} \.title:where\(\.${H}\)" 'font-size:13\.5px'
+  d '\.slug' '' 'font-size:12px' 'color:var\(--muted\)'
+  d '\.actions' '' 'display:flex' 'align-items:center' 'gap:6px'
+  none "AccordionHeader pre-5a .accordion-row gone" "\.accordion-row\.${H}"
+  sweep AccordionHeader $H
+fi
+# Source: the old #f5f5f5 fallback and the ↑/↓ text glyphs are gone.
+if grep -qE '#f5f5f5|surface-hover|[↑↓]' src/components/editor/AccordionHeader.svelte; then
+  echo "FAIL  AccordionHeader no #f5f5f5 / --surface-hover / ↑↓ text glyphs"; fail=1
+else
+  echo "PASS  AccordionHeader no #f5f5f5 / --surface-hover / ↑↓ text glyphs"
+fi
+
 # The summary line is the parent process's (see the re-exec at the top).
 exit $fail
PATCH
```


- [ ] **Step 6: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1520 passed (1520)`; `0 ERRORS 27 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (775 checks)`.

- [ ] **Step 7: Reviewer probes**

Each of these mutations was confirmed to fail the named check; reviewers may re-run any of them (revert after):

- chevron without `tabindex={-1}`, without `aria-hidden`, or without the `onmousedown` preventDefault → the D14 chevron tests fail.
- arrow title precedence boundary-before-reason → "a structure reason disables both arrows and wins over the boundary title" fails.
- down arrow `disabled` without `!canReorderDown` → the boundary-arrow tests fail; `<h3>` → `<div>` → the heading-level tests fail; drop `{@render extra?.()}` → the `extra`/block-`+` tests fail.
- `onPlus` without `if (!expanded) return;` → "+ on a collapsed block with a cancelled guard prompt changes nothing" fails (it re-expands afterwards and finds no latent form).
- re-add `tracker.isDirty ||` to `reorderSeq` → "a reorder is not blocked by an open draft (D3)" fails.
- gate: a `border-bottom` on `.seq`, or `.seq .title` at 13px → gate FAIL in (x).

- [ ] **Step 8: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/AccordionHeader.svelte \
  frontend/src/components/editor/BlockAccordion.svelte \
  frontend/src/components/editor/SequenceAccordion.svelte \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/accordionHeader.svelte.test.ts \
  frontend/src/tests/BlockAccordion.svelte.test.ts \
  frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5a T5a — accordion headers: heading toggle, code badge, fixed arrows, chevron, block +

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## Task 5b: Accordion bodies — inline fields, create forms, delete footers, navigate-first deletes

Rewrites both accordion bodies. Block: card chrome, body column (`gap:10px`), InlineFields "Block title" (required, max 200) and "Info (markdown)" with `textReason` (published text stays editable); the shared create-form look; a collapse-reset `$effect` (tracks only `expanded`); `createTracker` registered only while `creating && expanded`, with `discard()`; a delete footer (28px trash + text mirroring its title, precedence structure reason → sequences remain → form open → enabled). Delete: confirm with the D3 suffix; on success, **if the live route still names the block** (`expanded`) navigate to the version with `{ replace: true, force: true }` first, then force-reload — both gated on `stillOnVid`. Sequence: no card border (D10); InlineField "Sequence title"; `<h5>Items</h5>` + filled `+` that focuses the checked type radio inside its own form; restyled create-item form (fields and validation unchanged); "No items yet." / "No items."; a delete footer with the same navigate-first order. `SequenceAccordion` gains `alive` and a **required** `stillOnVid` prop from `BlockAccordion` (captured per operation): reloads are gated on the prop only (so they still run after the block collapses), the post-delete navigate on `alive && expanded && stillOnVid`. `ItemRow` keeps its old props until T6 (`parentDirty={false}`). A page-level test with router-driven props proves no stale-id toast after either delete. Gate section (y).

**Files:**
- Modify (rewrite): `frontend/src/components/editor/BlockAccordion.svelte`, `frontend/src/components/editor/SequenceAccordion.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh`
- Test (rewrite): `frontend/src/tests/BlockAccordion.svelte.test.ts`, `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`
- Test (modify): `frontend/src/tests/VersionEditPage.svelte.test.ts` (patch), `frontend/src/tests/BlockGroup.svelte.test.ts` (patch — stale line cite)

**Interfaces:**
- Consumes (T1/T5a): `InlineField`, `IconButton` (`trash` + `danger`, `primary`), `textReason`, `structureReason`, `unsavedSuffix`, `AccordionHeader` (T5a props), `navigate(path, { replace, force })`, `matchRoute(routes, path)`.
- Produces: `SequenceAccordion` prop `stillOnVid: (savedVid: number) => boolean` (required); DOM hooks `.block-card`, `.acc-body`, `.fields`, `.cr-form`, `.del-footer`, `.del-text`, `.items-head`, `.empty`; trash names `"Delete block {name}"` / `"Delete sequence {name}"`; item `+` `aria-label="New item in {sequence name}"`. T6 relies on `SequenceAccordion`'s `structReason` and on the old `ItemRow` call site still being present.

- [ ] **Step 1: Write the failing tests**

File: `frontend/src/tests/BlockAccordion.svelte.test.ts` — full content:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockAccordion from '../components/editor/BlockAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, matchRoute, registerNavigationGuard, __resetGuardsForTests } from '../lib/router.svelte';
import { routes } from '../routes';
import type { AdminTree, AdminTreeBlock, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

// Real router + store; fetch stubbed. Route-derived props are getters over
// currentRoute, as App.svelte supplies them, so `expanded` follows navigate().
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 1, label: '', created_at: '2026-01-01T00:00:00Z', published_at: null,
    archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkBlock(over: Partial<AdminTreeBlock> = {}): AdminTreeBlock {
  return { id: 3, version_id: 1, title: 'Vectors', slug: 'vectors', order: 1, info: '', info_html: '', sequences: [], ...over };
}

// The admin-tree GET serves `served`; each fetch records the route path at that
// moment, so a test can assert navigate-before-reload ordering.
let served: AdminTree;
let treeFetchPaths: string[];
function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const custom = extra(String(url), init);
    if (custom) return custom;
    if (String(url).endsWith('/admin-tree')) {
      treeFetchPaths.push(currentRoute.path);
      return jres(structuredClone(served));
    }
    return jres({});
  });
}
function deferredDelete(path: string) {
  const d = { release: () => {} };
  serve((url, init) => (url === path && init?.method === 'DELETE'
    ? new Promise<void>((r) => { d.release = r; }).then(() => jres({}))
    : undefined));
  return d;
}
function mkSeq(id: number, over: Partial<AdminTreeSequence> = {}): AdminTreeSequence {
  return { id, block_id: 3, title: `S ${id}`, slug: `s${id}`, order: id, items: [], ...over };
}

let target: HTMLDivElement;
let registry: DirtyRegistry;
let cleanup: (() => void) | null = null;

beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1', { force: true });
  fetchSpy.mockReset();
  treeFetchPaths = [];
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  currentEditorVersion.value = { course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [mkBlock()] };
  served = { course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] };
  serve();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  cleanup?.(); cleanup = null;
  target.remove();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

// A function call does not narrow `cleanup`, unlike an inline reset.
function teardown() { cleanup?.(); cleanup = null; }

const param = (k: string) => matchRoute(routes, currentRoute.path)?.params[k] ?? null;

function mountBlock(block: AdminTreeBlock = mkBlock(), over: { index?: number; blockCount?: number } = {}) {
  registry = createDirtyRegistry();
  const cmp = mount(BlockAccordion, {
    target,
    context: new Map([[DIRTY_REGISTRY_KEY, registry]]),
    props: {
      courseSlug: 'c', vid: 1, block, index: over.index ?? 1, blockCount: over.blockCount ?? 2,
      get routeBid() { return param('blockId'); },
      get routeSid() { return param('sequenceId'); },
      onMoveUp: vi.fn(), onMoveDown: vi.fn(),
    },
  });
  cleanup = () => unmount(cmp);
  flushSync();
}

const field = (label: string) =>
  [...target.querySelectorAll<HTMLElement>('#block-3-panel .inline-field')].find((f) => f.querySelector('.label')?.textContent === label)!;
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
// Open the block-title InlineField and leave a changed draft in it.
async function dirtyBlockTitle() {
  field('Block title').querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.click();
  await settle();
  type(field('Block title').querySelector('input')!, 'Changed');
}

const plus = () => target.querySelector<HTMLButtonElement>('button[aria-label="New sequence in Vectors"]')!;
const createTitle = () => target.querySelector<HTMLInputElement>('input[placeholder="Title"]');

describe('BlockAccordion — header (T5a)', () => {
  it('the header is an <h3> toggle with the B{index} badge and the slug', () => {
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const toggle = target.querySelector<HTMLButtonElement>('#block-3-header')!;
    expect(toggle.parentElement!.tagName).toBe('H3');
    expect(toggle.querySelector('.code')!.textContent).toBe('B2');
    expect(toggle.querySelector('.slug')!.textContent).toBe('/vectors');
  });

  it('arrows always render: boundary titles on an editable version', () => {
    mountBlock(mkBlock(), { index: 1, blockCount: 1 });
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    const down = target.querySelector<HTMLButtonElement>('[aria-label="Move block down: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Move up — already first');
    expect(down.disabled).toBe(true);
    expect(down.title).toBe('Move down — already last');
  });

  it('a published version keeps the arrows and the + with the structure reason', () => {
    currentEditorVersion.value!.version = mkVersion({ state: 'published' });
    mountBlock(mkBlock(), { index: 2, blockCount: 3 });
    const reason = 'Only a created version can change its structure';
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move block up: Vectors"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe(reason);
    expect(plus().disabled).toBe(true);
    expect(plus().title).toBe(reason);
  });

  it('the old in-body "+ New sequence" button is gone', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.includes('New sequence'))).toBe(false);
    expect(target.querySelector('#block-3-panel h3')).toBeNull();
  });

  it('+ on an expanded block toggles the create form and focuses Title', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock();
    await settle();
    expect(plus().title).toBe('New sequence');
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    plus().click();
    await settle();
    expect(document.activeElement).toBe(createTitle());
    expect(plus().dataset.glyph).toBe('close');
    expect(plus().title).toBe('Cancel new sequence');
    expect(plus().getAttribute('aria-expanded')).toBe('true');
    plus().click();
    await settle();
    expect(createTitle()).toBeNull();
  });

  it('+ on a collapsed block expands it, then opens the form with Title focused', async () => {
    mountBlock();
    expect(createTitle()).toBeNull();
    plus().click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(document.activeElement).toBe(createTitle());
    expect(plus().getAttribute('aria-expanded')).toBe('true');
  });

  it('+ on a collapsed block with a cancelled guard prompt changes nothing', async () => {
    registerNavigationGuard(() => false);
    mountBlock();
    plus().click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(createTitle()).toBeNull();
    expect(plus().getAttribute('aria-expanded')).toBe('false');
    // Nothing latent either: expanding later must not reveal a pre-opened form.
    __resetGuardsForTests();
    target.querySelector<HTMLButtonElement>('#block-3-header')!.click();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(createTitle()).toBeNull();
  });

  it('a reorder is not blocked by an open draft (D3)', async () => {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    mountBlock(mkBlock({ sequences: [
      { id: 7, block_id: 3, title: 'S one', slug: 's1', order: 1, items: [] },
      { id: 8, block_id: 3, title: 'S two', slug: 's2', order: 2, items: [] },
    ] }));
    await settle();
    await dirtyBlockTitle();
    expect(registry.isAnyDirty()).toBe(true);
    target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: S one"]')!.click();
    await settle();
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/blocks/3/sequences/reorder')).toBe(true);
  });
});

describe('BlockAccordion — body (T5b)', () => {
  const trash = () => target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Vectors"]')!;
  const delText = () => target.querySelector('#block-3-panel > .del-footer .del-text')!.textContent;
  async function expand() {
    await navigate('/courses/c/edit/v/1/blocks/3', { force: true });
    await settle();
  }

  it('title and info are inline fields; a title commit PATCHes {title} only, then reloads', async () => {
    await expand();
    mountBlock();
    await settle();
    const labels = [...target.querySelectorAll('#block-3-panel .inline-field .label')].map((l) => l.textContent);
    expect(labels).toEqual(['Block title', 'Info (markdown)']);
    await dirtyBlockTitle();
    field('Block title').querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3' && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ title: 'Changed' });
    expect(treeFetchPaths.length).toBe(1);
  });

  it('a published version keeps the text fields editable (textReason)', async () => {
    currentEditorVersion.value!.version = mkVersion({ state: 'published' });
    await expand();
    mountBlock();
    await settle();
    expect(field('Block title').querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.disabled).toBe(false);
  });

  it('collapse resets the create-sequence form', async () => {
    await expand();
    mountBlock();
    await settle();
    plus().click();
    await settle();
    type(createTitle()!, 'Draft');
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    await expand();
    expect(createTitle()).toBeNull();
    expect(plus().getAttribute('aria-expanded')).toBe('false');
  });

  it('a confirmed navigation discards a typed create-sequence title (createTracker.discard)', async () => {
    await expand();
    mountBlock();
    await settle();
    plus().click();
    await settle();
    type(createTitle()!, 'Draft');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll();
    flushSync();
    expect(createTitle()).toBeNull();
    expect(registry.isAnyDirty()).toBe(false);
  });

  it('delete footer precedence: reason → sequences → open form → enabled', async () => {
    await expand();
    mountBlock();
    await settle();
    expect(trash().disabled).toBe(false);
    expect(trash().title).toBe('Delete this block');
    expect(delText()).toBe('Delete this block');
    plus().click();
    await settle();
    expect(trash().disabled).toBe(true);
    expect(delText()).toBe('Delete this block — cancel the new sequence first');
    teardown();
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    expect(trash().disabled).toBe(true);
    expect(delText()).toBe('Delete this block — remove its sequences first');
    teardown();
    currentEditorVersion.value!.version = mkVersion({ is_disabled: true });
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    expect(trash().title).toBe('Delete this block — enable the version first');
    expect(delText()).toBe('Delete this block — enable the version first');
  });

  it('delete success: navigates to the version (replace, no prompt) BEFORE the reload', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const replaceSpy = vi.spyOn(history, 'replaceState');
    await expand();
    mountBlock();
    await settle();
    await dirtyBlockTitle();
    trash().click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('Delete block "Vectors"? This cannot be undone. Unsaved edits may be lost.');
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
  });

  it('delete success while another block is expanded: reload only, no navigate', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferredDelete('/api/blocks/3');
    await expand();
    mountBlock();
    await settle();
    trash().click();
    await settle();
    await navigate('/courses/c/edit/v/1/blocks/4', { force: true });
    await settle();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/4');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1/blocks/4']);
  });

  it('a sequence delete still reloads after the parent block collapsed (stillOnVid prop)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferredDelete('/api/sequences/7');
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/7', { force: true });
    mountBlock(mkBlock({ sequences: [mkSeq(7)] }));
    await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence S 7"]')!.click();
    await settle();
    await navigate('/courses/c/edit/v/1', { force: true });
    await settle();
    expect(target.querySelector('#seq-7-header')).toBeNull();
    del.release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1']);
  });

  it('empty sequences: "No sequences yet." when editable, "No sequences." otherwise', async () => {
    await expand();
    mountBlock();
    await settle();
    expect(target.querySelector('#block-3-panel > .empty')!.textContent).toBe('No sequences yet.');
    teardown();
    currentEditorVersion.value!.version = mkVersion({ state: 'archived' });
    mountBlock();
    await settle();
    expect(target.querySelector('#block-3-panel > .empty')!.textContent).toBe('No sequences.');
  });
});
```

File: `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` — full content:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SequenceAccordion from '../components/editor/SequenceAccordion.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import type { AdminTree, AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 1, label: '', created_at: '2026-01-01T00:00:00Z', published_at: null,
    archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
const item: AdminTreeItem = {
  id: 9, sequence_id: 2, title: 'Page', slug: 'page', order: 1, type: 'static_page',
  content_md: '', content_html: '', video_url: null, script_url: null, questions_count: 0,
};
function mkSeq(over: Partial<AdminTreeSequence> = {}): AdminTreeSequence {
  return { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [], ...over };
}
function mkTree(seq: AdminTreeSequence, version = mkVersion()): AdminTree {
  const block: AdminTreeBlock = { id: 3, version_id: 1, title: 'Block', slug: 'block', order: 1, info: '', info_html: '', sequences: [seq] };
  return { course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block] };
}

// The tree the admin-tree GET serves; the path the route had when it was fetched.
let served: AdminTree;
let treeFetchPaths: string[];
function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const custom = extra(String(url), init);
    if (custom) return custom;
    if (String(url).endsWith('/admin-tree')) {
      treeFetchPaths.push(currentRoute.path);
      return jres(structuredClone(served));
    }
    return jres({});
  });
}

let cleanup: (() => void) | null = null;
beforeEach(async () => {
  __resetGuardsForTests();
  await navigate('/courses/c/edit/v/1/blocks/3/sequences/2', { force: true });
  treeFetchPaths = [];
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  served = mkTree(mkSeq());
  serve();
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

// Direct mount: the required `stillOnVid` is a stub the test controls.
function mountAccordion(seq: AdminTreeSequence = mkSeq(), version = mkVersion()) {
  const tree = mkTree(seq, version);
  currentEditorVersion.value = tree;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const stillOnVid = vi.fn((_: number) => true);
  const props = $state({
    courseSlug: 'c', vid: 1, block: tree.blocks[0], seq, index: 1, sequenceCount: 1,
    routeBid: '3' as string | null, routeSid: '2' as string | null, stillOnVid, onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  });
  const cmp = mount(SequenceAccordion, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, createDirtyRegistry()]]) });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, stillOnVid, props };
}
const plus = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[aria-label="New item in Seq"]')!;
const trash = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence Seq"]')!;
const createBtn = (t: HTMLElement) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create') as HTMLButtonElement;
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('SequenceAccordion — header (T5a)', () => {
  it('the header is an <h4> toggle with the S{index} badge; arrows render at the boundary', () => {
    const { target } = mountAccordion();
    const toggle = target.querySelector<HTMLButtonElement>('#seq-2-header')!;
    expect(toggle.parentElement!.tagName).toBe('H4');
    expect(toggle.querySelector('.code')!.textContent).toBe('S1');
    const up = target.querySelector<HTMLButtonElement>('[aria-label="Move sequence up: Seq"]')!;
    const down = target.querySelector<HTMLButtonElement>('[aria-label="Move sequence down: Seq"]')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe('Move up — already first');
    expect(down.disabled).toBe(true);
    expect(down.title).toBe('Move down — already last');
  });
});

describe('SequenceAccordion — body (T5b)', () => {
  it('the sequence title is an inline field; a commit PATCHes {title} only, then reloads', async () => {
    const { target } = mountAccordion();
    const row = target.querySelector<HTMLElement>('.inline-field')!;
    expect(row.querySelector('.label')!.textContent).toBe('Sequence title');
    row.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!.click();
    await settle();
    const input = row.querySelector<HTMLInputElement>('input')!;
    type(input, 'Renamed');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/sequences/2' && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ title: 'Renamed' });
    expect(treeFetchPaths.length).toBe(1);
  });

  it('a late title commit after a version change does not reload', async () => {
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'PATCH'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, stillOnVid } = mountAccordion();
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!.click();
    await settle();
    const input = target.querySelector<HTMLInputElement>('.inline-field input')!;
    type(input, 'Renamed');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    stillOnVid.mockReturnValue(false);
    release();
    await settle();
    expect(treeFetchPaths).toEqual([]);
  });

  it('an archived version shows the title as text with a disabled pencil and reason', () => {
    const { target } = mountAccordion(mkSeq(), mkVersion({ state: 'archived' }));
    const pencil = target.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!;
    expect(pencil.disabled).toBe(true);
    expect(pencil.title).toBe('Archived versions are read-only');
  });

  it('Items is an <h5>; the + opens the form and focuses the checked type radio', async () => {
    const { target } = mountAccordion();
    expect(target.querySelector('.items-head h5')!.textContent).toBe('Items');
    expect(plus(target).title).toBe('New item');
    plus(target).click();
    await settle();
    const checked = target.querySelector<HTMLInputElement>('form input[type="radio"]:checked')!;
    expect(checked.value).toBe('static_page');
    expect(document.activeElement).toBe(checked);
    expect(plus(target).dataset.glyph).toBe('close');
    expect(plus(target).title).toBe('Cancel new item');
    expect(plus(target).getAttribute('aria-label')).toBe('New item in Seq');
    expect(plus(target).getAttribute('aria-expanded')).toBe('true');
  });

  it('the create form keeps its type-specific fields', async () => {
    const { target } = mountAccordion();
    plus(target).click();
    await settle();
    expect(target.querySelector('form textarea[placeholder="Content (markdown)"]')).not.toBeNull();
    target.querySelector<HTMLInputElement>('input[value="video"]')!.click(); flushSync();
    expect(target.querySelector('form input[type="url"]')).not.toBeNull();
    expect(target.querySelector('form textarea')).toBeNull();
    target.querySelector<HTMLInputElement>('input[value="quiz"]')!.click(); flushSync();
    expect(target.querySelector('form input[type="url"]')).toBeNull();
    expect(target.querySelector('form textarea')).toBeNull();
  });

  it('creates an interactive_app with only title + type — no script_url, no URL field', async () => {
    serve((url) => (url.endsWith('/api/sequences/2/items') ? jres({ id: 99 }) : undefined));
    const { target } = mountAccordion();
    plus(target).click();
    await settle();
    target.querySelector<HTMLInputElement>('input[value="interactive_app"]')!.click(); flushSync();
    expect(target.querySelector('input[type="url"]')).toBeNull();
    type(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'My app');
    createBtn(target).click();
    await settle();
    const post = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('/api/sequences/2/items') && (c[1] as RequestInit)?.method === 'POST',
    )!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ title: 'My app', type: 'interactive_app' });
  });

  it('collapse resets the create form', async () => {
    const { target, props } = mountAccordion();
    plus(target).click();
    await settle();
    type(target.querySelector<HTMLInputElement>('input[placeholder="Title"]')!, 'Draft');
    props.routeSid = null;
    flushSync();
    props.routeSid = '2';
    flushSync();
    expect(target.querySelector('form')).toBeNull();
    expect(plus(target).getAttribute('aria-expanded')).toBe('false');
  });

  it('empty items: "No items yet." when editable, "No items." otherwise', () => {
    let { target } = mountAccordion();
    expect(target.querySelector('.empty')!.textContent).toBe('No items yet.');
    cleanup?.();
    ({ target } = mountAccordion(mkSeq(), mkVersion({ state: 'published' })));
    expect(target.querySelector('.empty')!.textContent).toBe('No items.');
  });
});

describe('SequenceAccordion — delete footer (T5b)', () => {
  const text = (t: HTMLElement) => t.querySelector('.del-text')!.textContent;

  it('enabled: the trash and its text read "Delete this sequence"', () => {
    const { target } = mountAccordion();
    expect(trash(target).disabled).toBe(false);
    expect(trash(target).title).toBe('Delete this sequence');
    expect(text(target)).toBe('Delete this sequence');
  });

  it('items remain → "remove its items first" (ref 1610)', () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }));
    expect(trash(target).disabled).toBe(true);
    expect(trash(target).title).toBe('Delete this sequence — remove its items first');
    expect(text(target)).toBe('Delete this sequence — remove its items first');
  });

  it('the structure reason wins over items remaining', () => {
    const { target } = mountAccordion(mkSeq({ items: [item] }), mkVersion({ state: 'published' }));
    expect(text(target)).toBe('Delete this sequence — only a created version can change its structure');
    expect(trash(target).disabled).toBe(true);
  });

  it('an open create form → "cancel the new item first"', async () => {
    const { target } = mountAccordion();
    plus(target).click();
    await settle();
    expect(trash(target).disabled).toBe(true);
    expect(text(target)).toBe('Delete this sequence — cancel the new item first');
  });

  it('success: navigates to the block (replace, no prompt) BEFORE the reload', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const replaceSpy = vi.spyOn(history, 'replaceState');
    const { target } = mountAccordion();
    trash(target).click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith('Delete sequence "Seq"? This cannot be undone.');
    expect(fetchSpy.mock.calls.some(([u, i]) => String(u) === '/api/sequences/2' && (i as RequestInit).method === 'DELETE')).toBe(true);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3');
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/courses/c/edit/v/1/blocks/3');
    expect(treeFetchPaths).toEqual(['/courses/c/edit/v/1/blocks/3']);
  });

  it('a late delete after a version change neither navigates nor reloads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let release!: () => void;
    serve((url, init) => (url === '/api/sequences/2' && init?.method === 'DELETE'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({}))
      : undefined));
    const { target, stillOnVid } = mountAccordion();
    trash(target).click();
    await settle();
    stillOnVid.mockReturnValue(false);
    release();
    await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/2');
    expect(treeFetchPaths).toEqual([]);
  });
});
```

Patch for `frontend/src/tests/VersionEditPage.svelte.test.ts` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/tests/VersionEditPage.svelte.test.ts
+++ b/frontend/src/tests/VersionEditPage.svelte.test.ts
@@ -2,8 +2,10 @@
 import { mount, unmount, flushSync } from 'svelte';
 import VersionEditPage from '../pages/editor/VersionEditPage.svelte';
 import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
-import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
-import type { AdminTree, AdminTreeBlock, AdminTreeVersion } from '../lib/types';
+import { navigate, currentRoute, matchRoute, __resetGuardsForTests } from '../lib/router.svelte';
+import { routes } from '../routes';
+import { toasts, clearToasts } from '../stores/toasts.svelte';
+import type { AdminTree, AdminTreeBlock, AdminTreeSequence, AdminTreeVersion } from '../lib/types';
 import type { DirtyRegistry } from '../lib/dirtyRegistry.svelte';
 
 // Capture the page's real registry so a test can register a dirty tracker
@@ -69,6 +71,7 @@
   if (target.parentNode) target.parentNode.removeChild(target);
   (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
   clearEditorVersion();
+  clearToasts();
   __resetGuardsForTests();
   vi.restoreAllMocks();
 });
@@ -421,3 +424,56 @@
     expect(currentRoute.path).toBe('/courses/c/edit');
   });
 });
+
+// Router-driven props, as App.svelte supplies them: getters over the live
+// route, so the page follows the accordions' own navigate() calls.
+async function renderRouted() {
+  const param = (k: string) => matchRoute(routes, currentRoute.path)?.params[k];
+  component = mount(VersionEditPage, {
+    target,
+    props: {
+      get courseSlug() { return param('courseSlug') ?? ''; },
+      get versionId() { return param('versionId') ?? ''; },
+      get blockId() { return param('blockId'); },
+      get sequenceId() { return param('sequenceId'); },
+    },
+  });
+  await settle();
+}
+
+describe('VersionEditPage — no spurious stale-id toast after a delete (T5b)', () => {
+  const seq20: AdminTreeSequence = { id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [] };
+
+  it('deleting the expanded block lands on the version with no "Block not found."', async () => {
+    vi.spyOn(window, 'confirm').mockReturnValue(true);
+    serve((url, init) => {
+      if (url === '/api/blocks/10' && init?.method === 'DELETE') { tree.blocks = []; return jres({}); }
+      return undefined;
+    });
+    await navigate('/courses/c/edit/v/1/blocks/10', { force: true });
+    await renderRouted();
+    target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Block 10"]')!.click();
+    await settle();
+    await settle();
+    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
+    expect(target.querySelector('#block-10-header')).toBeNull();
+    expect(toasts.list.map((t) => t.message)).not.toContain('Block not found.');
+  });
+
+  it('deleting the expanded sequence lands on its block with no "Sequence not found."', async () => {
+    vi.spyOn(window, 'confirm').mockReturnValue(true);
+    tree.blocks = [mkBlock(10, { sequences: [seq20] })];
+    serve((url, init) => {
+      if (url === '/api/sequences/20' && init?.method === 'DELETE') { tree.blocks[0].sequences = []; return jres({}); }
+      return undefined;
+    });
+    await navigate('/courses/c/edit/v/1/blocks/10/sequences/20', { force: true });
+    await renderRouted();
+    target.querySelector<HTMLButtonElement>('button[aria-label="Delete sequence Seq 20"]')!.click();
+    await settle();
+    await settle();
+    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/10');
+    expect(target.querySelector('#seq-20-header')).toBeNull();
+    expect(toasts.list.map((t) => t.message)).not.toContain('Sequence not found.');
+  });
+});
PATCH
```

Patch for `frontend/src/tests/BlockGroup.svelte.test.ts` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/tests/BlockGroup.svelte.test.ts
+++ b/frontend/src/tests/BlockGroup.svelte.test.ts
@@ -173,7 +173,7 @@
   it('gives the header a real <button> carrying the accordion ARIA contract', () => {
     // The header was a <div onclick>: not focusable, not keyboard-operable, and
     // the source of the two a11y warnings this task removes. The precedent for
-    // the button form is editor/AccordionHeader.svelte:59-71.
+    // the button form is editor/AccordionHeader.svelte:67-82.
     const { btn, panel } = mountBlock();
     expect(btn).not.toBeNull();
     expect(panel).not.toBeNull();
PATCH
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/BlockAccordion.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts
```

Expected: body cases fail (no `.inline-field` in the bodies, no delete footer, old item `+` button text); the two page-level delete tests fail (no `Delete block Block 10` / `Delete sequence Seq 20` buttons); the T5a header cases still pass.

- [ ] **Step 3: Implement**

File: `frontend/src/components/editor/BlockAccordion.svelte` — full content:

```svelte
<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { structureReason, textReason, unsavedSuffix } from '../../lib/editorReasons';
  import { labelFor } from '../../lib/labelFor';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineField from '../ui/InlineField.svelte';
  import type { AdminTreeBlock } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    index: number;
    blockCount: number;
    routeBid: string | null;
    routeSid: string | null;
    onMoveUp: () => void;
    onMoveDown: () => void;
    // parentBusy disables this block's controls while a parent
    // (VersionEditPage) mutation is in flight.
    parentBusy?: boolean;
  };

  let {
    courseSlug,
    vid,
    block,
    index,
    blockCount,
    routeBid,
    routeSid,
    onMoveUp,
    onMoveDown,
    parentBusy = false,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — BlockAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid);
  const headerId = $derived(`block-${String(block.id)}-header`);
  const panelId = $derived(`block-${String(block.id)}-panel`);

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const structReason = $derived(version ? structureReason(version) : null);
  const txtReason = $derived(version ? textReason(version) : null);
  const name = $derived(labelFor(block.title, block.slug, `block ${index}`));

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    }
  }

  let busy = $state(false);

  // Track unmount so post-await reloads on a torn-down component (route
  // change away from /edit/v/:vid entirely) skip cleanly.
  let alive = true;
  onDestroy(() => { alive = false; });

  // Guard for post-await force-reloads: skip the reload if the user has
  // already navigated to a different version. loadAdminTree's token mechanism
  // catches out-of-order completion of NORMAL loads, but `{force: true}`
  // advances the token unconditionally — an old force-reload would win and
  // overwrite the new vid's tree.
  //
  // We compare against the LIVE `vid` (which reflects the current `versionId`
  // prop the router supplies — instance preservation on /edit/v/:vid
  // navigation means the prop updates without unmounting). Checking the store
  // value would miss the window between "navigation occurred" and "new tree
  // finished loading". Passed down to SequenceAccordion, whose own lifetime
  // ends when this block collapses (§4 race guards).
  function stillOnVid(savedVid: number): boolean {
    return alive && vid === savedVid;
  }

  // One field per PATCH (D2). A PATCH failure propagates to InlineField
  // (inline error); only the follow-up refresh is guarded.
  async function patchBlock(field: { title: string } | { info: string }) {
    const savedVid = vid;
    const savedBid = block.id;
    await api.patch(`/api/blocks/${savedBid}`, field);
    if (!stillOnVid(savedVid)) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }

  async function deleteBlock() {
    if (creating || !canStructure || busy || createBusy || parentBusy || block.sequences.length > 0) return;
    if (!confirm(`Delete block "${block.title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/blocks/${block.id}`);
      if (stillOnVid(savedVid)) {
        // Navigate FIRST so the route no longer names the deleted block when
        // the new tree lands (otherwise the page's validation effect shows a
        // spurious "Block not found."). Only when the live route still names
        // it (`expanded`): if the user has meanwhile expanded another block,
        // a forced navigate would collapse it and drop its drafts unprompted.
        // `force` — the user already confirmed; `replace` — keep the deleted
        // URL out of history.
        if (expanded) void navigate(`/courses/${savedSlug}/edit/v/${savedVid}`, { replace: true, force: true });
        await loadAdminTree(savedVid, { force: true });
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
    }
  }

  // Sequence-list reorder: this component owns block.sequences and the API call.
  async function reorderSeq(idx: number, dir: -1 | 1) {
    // Defense-in-depth: the AccordionHeader gates the up/down buttons on
    // `busy || createBusy || parentBusy`, but a stale/programmatic click
    // could still call this. A second reorder while one is in flight would
    // see a pre-swap snapshot of block.sequences. Not blocked by drafts (D3).
    if (busy || createBusy || parentBusy) return;
    const seqs = [...block.sequences];
    const target = idx + dir;
    if (target < 0 || target >= seqs.length) return;
    [seqs[idx], seqs[target]] = [seqs[target], seqs[idx]];
    const order = seqs.map((s, i) => ({ id: s.id, order: i + 1 }));
    const savedVid = vid;
    const savedBid = block.id;
    busy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences/reorder`, { order });
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
    } finally {
      busy = false;
    }
  }

  // Inline create-sequence form
  let creating = $state(false);
  let newTitle = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let titleEl = $state<HTMLInputElement>();

  // Footer text mirrors the trash button's title (ref 1610). Precedence:
  // structure reason → sequences remain → create form open → enabled.
  const deleteText = $derived(
    structReason
      ? `Delete this block — ${structReason[0].toLowerCase()}${structReason.slice(1)}`
      : block.sequences.length > 0
        ? 'Delete this block — remove its sequences first'
        : creating
          ? 'Delete this block — cancel the new sequence first'
          : 'Delete this block',
  );

  function resetCreate() {
    newTitle = '';
    createErrors = {};
    createGlobalError = null;
  }

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  // discard() lets a confirmed DirtyGuard prompt really drop the draft (D3).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && newTitle.trim() !== '';
    },
    discard() { resetCreate(); creating = false; },
  };

  // Registered only while the form is actually on screen.
  $effect(() => {
    if (!(creating && expanded)) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  // Collapse resets the form: a collapsed block shows no form, so a latent
  // open one must not reappear on the next expansion. Tracks only `expanded`.
  $effect(() => {
    if (!expanded) untrack(() => { if (creating) { resetCreate(); creating = false; } });
  });

  // Close + reset the create form if structure permission is revoked while
  // the form is open (e.g., parent publishes the version mid-edit). Without
  // this, the form would stay submittable even though the underlying
  // permission has flipped.
  $effect(() => {
    if (!canStructure && creating) {
      resetCreate();
      creating = false;
    }
  });

  async function toggleCreate() {
    // Defense-in-depth: refuse mid-flight toggles. The toggle button is
    // already disabled in these states, but a stale/programmatic click
    // would otherwise unmount the form during an in-flight POST,
    // discarding validation errors and unregistering the create tracker.
    if (createBusy || busy || parentBusy) return;
    if (creating) { resetCreate(); creating = false; return; }
    creating = true;
    await tick();
    titleEl?.focus();
  }

  // The header `+` (ref 1568). On a collapsed block it first expands the block
  // through the router (so the DirtyGuard prompt still applies), then opens
  // the form only if the expansion actually landed — a cancelled prompt
  // leaves everything unchanged.
  async function onPlus() {
    if (structReason || createBusy || busy || parentBusy) return;
    if (expanded) { await toggleCreate(); return; }
    await navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    await tick();
    if (!expanded) return;
    creating = true;
    await tick();
    titleEl?.focus();
  }

  async function submitCreate() {
    if (createBusy || busy || parentBusy || !canStructure || !newTitle.trim()) return;
    const savedVid = vid;
    const savedBid = block.id;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences`, { title: newTitle });
      resetCreate(); creating = false;
      if (stillOnVid(savedVid)) {
        await loadAdminTree(savedVid, { force: true });
      }
      pushToast('Sequence created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title']);
      createErrors = mapped.fieldErrors;
      // Fall back to a generic message if mapper produced nothing — without
      // this, a 500 with no validation body silently swallows the failure.
      createGlobalError = mapped.globalMessage
        ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
      if (createGlobalError && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(createGlobalError, 'error');
      }
    } finally {
      createBusy = false;
    }
  }
</script>

<div class="block-card">
  <AccordionHeader
    {headerId}
    {panelId}
    level="block"
    title={block.title}
    slug={block.slug}
    {index}
    {expanded}
    badge={`B${index}`}
    busy={busy || createBusy || parentBusy}
    structureReason={structReason}
    canReorderUp={index > 1}
    canReorderDown={index < blockCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  >
    {#snippet extra()}
      <IconButton
        size="sm"
        glyph={creating && expanded ? 'close' : 'plus'}
        title={structReason ?? (creating && expanded ? 'Cancel new sequence' : 'New sequence')}
        aria-label={`New sequence in ${name}`}
        aria-expanded={creating && expanded}
        disabled={!!structReason || busy || createBusy || parentBusy}
        onclick={() => void onPlus()}
      />
    {/snippet}
  </AccordionHeader>

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
      <div class="fields">
        <InlineField
          label="Block title"
          value={block.title}
          required
          maxlength={200}
          editTitle="Edit the block title"
          disabledReason={txtReason}
          onCommit={(p) => patchBlock({ title: String(p) })}
        />
        <InlineField
          label="Info (markdown)"
          value={block.info}
          kind="textarea"
          editTitle="Edit the block info"
          disabledReason={txtReason}
          onCommit={(p) => patchBlock({ info: String(p) })}
        />
      </div>

      {#if creating}
        <form class="cr-form" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
          <input
            bind:this={titleEl}
            placeholder="Title"
            aria-label="Sequence title"
            bind:value={newTitle}
            required
            disabled={createBusy || busy || parentBusy}
            oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }}
          />
          {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <div class="cr-actions">
            <Button type="submit" disabled={createBusy || busy || parentBusy || !canStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
          </div>
        </form>
      {/if}

      {#if block.sequences.length === 0}
        <p class="empty">{canStructure ? 'No sequences yet.' : 'No sequences.'}</p>
      {:else}
        <ul class="seqs-list">
          {#each block.sequences as seq, i (seq.id)}
            <li>
              <SequenceAccordion
                {courseSlug}
                {vid}
                {block}
                {seq}
                index={i + 1}
                sequenceCount={block.sequences.length}
                {routeBid}
                {routeSid}
                {stillOnVid}
                onMoveUp={() => void reorderSeq(i, -1)}
                onMoveDown={() => void reorderSeq(i, 1)}
                parentBusy={busy || createBusy || parentBusy}
              />
            </li>
          {/each}
        </ul>
      {/if}

      <div class="del-footer">
        <IconButton
          glyph="trash"
          danger
          title={deleteText}
          aria-label={`Delete block ${name}`}
          disabled={!!structReason || block.sequences.length > 0 || creating || busy || createBusy || parentBusy}
          onclick={() => void deleteBlock()}
        />
        <span class="del-text">{deleteText}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .block-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    margin-bottom: 10px; /* ref 1563 */
  }
  .acc-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; /* ref 1570 */ }
  .fields { display: flex; flex-direction: column; }
  .fields > :global(.inline-field:last-child) { border-bottom: 0; /* ref 1548 */ }
  /* Create forms — shared look (spec §4). */
  .cr-form { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
  .cr-form input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .cr-actions { display: flex; justify-content: flex-end; }
  .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
  .empty { margin: 0; font-size: 13px; color: var(--muted); }
  .seqs-list { display: flex; flex-direction: column; gap: 10px; list-style: none; padding: 0; margin: 0; /* ref 1570 rhythm */ }
  .del-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border-soft); /* ref 1609 */
  }
  .del-text { font-size: 12.5px; color: var(--muted); /* ref 1610 */ }
</style>
```

File: `frontend/src/components/editor/SequenceAccordion.svelte` — full content:

```svelte
<script lang="ts">
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import ItemRow from './ItemRow.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { structureReason, textReason, unsavedSuffix } from '../../lib/editorReasons';
  import { labelFor } from '../../lib/labelFor';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineField from '../ui/InlineField.svelte';
  import type { AdminTreeBlock, AdminTreeSequence } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    seq: AdminTreeSequence;
    index: number;
    sequenceCount: number;
    routeBid: string | null;
    routeSid: string | null;
    // The parent BlockAccordion's version guard (`alive && vid === savedVid`).
    // Required: this component is rendered inside the block's {#if expanded}
    // body, so its own lifetime ends when the block collapses — a reload
    // gated on its own `alive` would be skipped and leave a deleted sequence
    // or an old title in the store. The parent stays mounted while the block
    // is in the tree. No `() => true` default: that would silently reload a
    // torn-down version.
    stillOnVid: (savedVid: number) => boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    // parentBusy disables this sequence's controls while a parent
    // (BlockAccordion / VersionEditPage) mutation is in flight.
    parentBusy?: boolean;
  };

  let {
    courseSlug,
    vid,
    block,
    seq,
    index,
    sequenceCount,
    routeBid,
    routeSid,
    stillOnVid,
    onMoveUp,
    onMoveDown,
    parentBusy = false,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — SequenceAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid && String(seq.id) === routeSid);
  const headerId = $derived(`seq-${String(seq.id)}-header`);
  const panelId = $derived(`seq-${String(seq.id)}-panel`);

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canStructure = $derived(perms?.canEditStructure ?? false);
  const structReason = $derived(version ? structureReason(version) : null);
  const txtReason = $derived(version ? textReason(version) : null);
  const name = $derived(labelFor(seq.title, seq.slug, `sequence ${index}`));

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}`);
    }
  }

  let busy = $state(false);

  // Own lifetime — gates only the post-delete forced navigate (§4 race guards).
  let alive = true;
  onDestroy(() => { alive = false; });

  // One field per PATCH (D2). A PATCH failure propagates to InlineField.
  async function patchSeq(field: { title: string }) {
    const savedVid = vid;
    const check = stillOnVid;
    const savedSid = seq.id;
    await api.patch(`/api/sequences/${savedSid}`, field);
    if (!check(savedVid)) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }

  async function deleteSeq() {
    if (creating || !canStructure || busy || createBusy || parentBusy || seq.items.length > 0) return;
    if (!confirm(`Delete sequence "${seq.title}"? This cannot be undone.${unsavedSuffix(dirty.isAnyDirty())}`)) return;
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/sequences/${savedSid}`);
      // Navigate FIRST (no spurious "Sequence not found."), only while the
      // live route still names this sequence; `force` — already confirmed;
      // `replace` — keep the deleted URL out of history. Then reload, gated on
      // the parent's guard so it still runs after the block collapsed.
      if (alive && expanded && check(savedVid)) {
        void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}`, { replace: true, force: true });
      }
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Item-list reorder: this component owns seq.items and the API call.
  // Not blocked by drafts (D3); a second reorder while one is in flight would
  // see a pre-swap snapshot of seq.items.
  async function reorderItem(idx: number, dir: -1 | 1) {
    if (busy || createBusy || parentBusy) return;
    const items = [...seq.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    const order = items.map((it, i) => ({ id: it.id, order: i + 1 }));
    const savedVid = vid;
    const check = stillOnVid;
    const savedSid = seq.id;
    busy = true;
    try {
      await api.post(`/api/sequences/${savedSid}/items/reorder`, { order });
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  async function deleteItem(itemId: number, itemTitle: string) {
    if (busy || !canStructure) return;
    if (!confirm(`Delete "${itemTitle}"? This cannot be undone.`)) return;
    const savedVid = vid;
    const check = stillOnVid;
    busy = true;
    try {
      await api.delete(`/api/items/${itemId}`);
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
      pushToast('Item deleted', 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  function openItem(itemId: number) {
    void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}/items/${itemId}`);
  }

  // Inline create-item form
  let creating = $state(false);
  let newType = $state<'static_page' | 'video' | 'quiz' | 'interactive_app'>('static_page');
  let newTitle = $state('');
  let newContentMd = $state('');
  let newVideoUrl = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let contentMdTouched = $state(false);
  let formEl = $state<HTMLFormElement>();

  $effect(() => {
    if (creating && newType === 'static_page' && !contentMdTouched && newTitle) {
      newContentMd = `# ${newTitle}\n`;
    }
  });

  // Footer text mirrors the trash button's title (ref 1610). Precedence:
  // structure reason → items remain → create form open → enabled.
  const deleteText = $derived(
    structReason
      ? `Delete this sequence — ${structReason[0].toLowerCase()}${structReason.slice(1)}`
      : seq.items.length > 0
        ? 'Delete this sequence — remove its items first'
        : creating
          ? 'Delete this sequence — cancel the new item first'
          : 'Delete this sequence',
  );

  function resetCreateForm() {
    newType = 'static_page';
    newTitle = '';
    newContentMd = '';
    newVideoUrl = '';
    contentMdTouched = false;
    createErrors = {};
    createGlobalError = null;
  }

  // Tracker shim for the create form: synthesized isDirty getter reads
  // current state directly — NO reset()-on-keystroke (that would always
  // make the tracker clean and break smoke 14b). discard() lets a confirmed
  // DirtyGuard prompt really drop the draft (D3).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (
        newTitle.trim() !== '' ||
        (newType === 'static_page' && newContentMd.trim() !== '' && newContentMd !== `# ${newTitle}\n`) ||
        (newType === 'video' && newVideoUrl.trim() !== '')
      );
    },
    discard() { resetCreateForm(); creating = false; },
  };

  // Registered only while the form is actually on screen.
  $effect(() => {
    if (!(creating && expanded)) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  // Collapse resets the form. Tracks only `expanded`.
  $effect(() => {
    if (!expanded) untrack(() => { if (creating) { resetCreateForm(); creating = false; } });
  });

  // Close + reset the create form if structure permission is revoked while
  // the form is open (e.g., parent publishes the version mid-edit). Without
  // this, the form would stay submittable even though the underlying
  // permission has flipped.
  $effect(() => {
    if (!canStructure && creating) {
      resetCreateForm();
      creating = false;
    }
  });

  async function toggleCreate() {
    // Defense-in-depth: refuse mid-flight toggles. The toggle button is
    // already disabled in these states, but a stale/programmatic click
    // would otherwise unmount the form during an in-flight POST,
    // discarding validation errors and unregistering the create tracker.
    if (createBusy || busy || parentBusy || structReason) return;
    if (creating) { resetCreateForm(); creating = false; return; }
    creating = true;
    await tick();
    // The checked type radio is the form's first tab stop. Scoped to this
    // form — several sequences' pickers share the radio group name.
    formEl?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }

  async function submitCreate() {
    if (createBusy || busy || parentBusy || !canStructure || !newTitle.trim()) return;
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const body: Record<string, unknown> = { title: newTitle, type: newType };
    if (newType === 'static_page') body.content_md = newContentMd;
    if (newType === 'video') body.video_url = newVideoUrl;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);
      if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
      resetCreateForm();
      creating = false;
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
    } catch (e) {
      const known = newType === 'static_page'
        ? ['title', 'content_md', 'type']
        : newType === 'video'
          ? ['title', 'video_url', 'type']
          : ['title', 'type'];
      const mapped = mapCreateError(e, known);
      createErrors = mapped.fieldErrors;
      // Fall back to a generic message if mapper produced nothing — without
      // this, a 500 with no validation body silently swallows the failure.
      createGlobalError = mapped.globalMessage
        ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
      if (createGlobalError && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(createGlobalError, 'error');
      }
    } finally {
      createBusy = false;
    }
  }
</script>

<!-- D10: no card border — nesting is carried by indentation, badges and tints. -->
<div>
  <AccordionHeader
    {headerId}
    {panelId}
    level="sequence"
    title={seq.title}
    slug={seq.slug}
    {index}
    {expanded}
    badge={`S${index}`}
    busy={busy || createBusy || parentBusy}
    structureReason={structReason}
    canReorderUp={index > 1}
    canReorderDown={index < sequenceCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="acc-body">
      <div class="fields">
        <InlineField
          label="Sequence title"
          value={seq.title}
          required
          maxlength={200}
          editTitle="Edit the sequence title"
          disabledReason={txtReason}
          onCommit={(p) => patchSeq({ title: String(p) })}
        />
      </div>

      <div class="items-head">
        <h5>Items</h5>
        <IconButton
          primary
          glyph={creating ? 'close' : 'plus'}
          title={structReason ?? (creating ? 'Cancel new item' : 'New item')}
          aria-label={`New item in ${name}`}
          aria-expanded={creating}
          disabled={!!structReason || busy || createBusy || parentBusy}
          onclick={() => void toggleCreate()}
        />
      </div>

      {#if creating}
        <form class="cr-form" bind:this={formEl} onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
          <ItemTypePicker bind:value={newType} />
          <input placeholder="Title" aria-label="Item title" bind:value={newTitle} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
          {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          {#if newType === 'static_page'}
            <textarea placeholder="Content (markdown)" aria-label="Content (markdown)" rows="4" bind:value={newContentMd} disabled={createBusy || busy || parentBusy} oninput={() => { contentMdTouched = true; if (createErrors.content_md) createErrors = { ...createErrors, content_md: '' }; }} required></textarea>
            {#if createErrors.content_md}<small class="field-err">{createErrors.content_md}</small>{/if}
          {:else if newType === 'video'}
            <input type="url" placeholder="Video URL (https://…)" aria-label="Video URL" bind:value={newVideoUrl} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.video_url) createErrors = { ...createErrors, video_url: '' }; }} />
            {#if createErrors.video_url}<small class="field-err">{createErrors.video_url}</small>{/if}
          {/if}
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <div class="cr-actions">
            <Button type="submit" disabled={createBusy || busy || parentBusy || !canStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
          </div>
        </form>
      {/if}

      {#if seq.items.length === 0}
        <p class="empty">{canStructure ? 'No items yet.' : 'No items.'}</p>
      {:else}
        <ul class="items-list">
          {#each seq.items as item, i (item.id)}
            <li>
              <ItemRow
                {item}
                index={i + 1}
                {canStructure}
                canReorderUp={canStructure && i > 0}
                canReorderDown={canStructure && i < seq.items.length - 1}
                parentDirty={false}
                busy={busy || createBusy || parentBusy}
                onMoveUp={() => void reorderItem(i, -1)}
                onMoveDown={() => void reorderItem(i, 1)}
                onOpen={() => openItem(item.id)}
                onDelete={() => void deleteItem(item.id, item.title)}
              />
            </li>
          {/each}
        </ul>
      {/if}

      <div class="del-footer">
        <IconButton
          glyph="trash"
          danger
          title={deleteText}
          aria-label={`Delete sequence ${name}`}
          disabled={!!structReason || seq.items.length > 0 || creating || busy || createBusy || parentBusy}
          onclick={() => void deleteSeq()}
        />
        <span class="del-text">{deleteText}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .acc-body { padding: 12px 14px; border-top: 1px solid var(--border-soft); /* ref 1578 */ }
  .fields { display: flex; flex-direction: column; }
  .fields > :global(.inline-field:last-child) { border-bottom: 0; /* ref 1548 */ }
  .items-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; /* ref 1584 */ }
  h5 { margin: 0; font-size: 13px; font-weight: 600; /* ref 1585 */ }
  /* Create forms — shared look (spec §4). */
  .cr-form { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
  .cr-form input,
  .cr-form textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .cr-form input { height: var(--control-h); padding: 0 10px; }
  .cr-form textarea { height: auto; padding: 8px 10px; }
  .cr-actions { display: flex; justify-content: flex-end; }
  .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
  .empty { margin: 0; font-size: 13px; color: var(--muted); }
  .items-list { list-style: none; padding: 0; margin: 0; }
  .del-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border-soft); /* ref 1609 */
  }
  .del-text { font-size: 12.5px; color: var(--muted); /* ref 1610 */ }
</style>
```


- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected: BlockAccordion 17, SequenceAccordion.interactive 15, VersionEditPage 30 — all passed.

- [ ] **Step 5: Gate section (y)**

Adds section (y), allow-lists the two accordion `.inline-field:last-child` rules, and bumps `EXPECTED_CHECKS` 775 → 881.

Patch for `frontend/scripts/visual-refresh-gate.sh` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/scripts/visual-refresh-gate.sh
+++ b/frontend/scripts/visual-refresh-gate.sh
@@ -87,7 +87,7 @@
 # checks are added, which is the failure this exists to catch (codex-r1-M2,
 # tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
 # speed bump is intentional.
-EXPECTED_CHECKS=775
+EXPECTED_CHECKS=881
 if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
   log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
   # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
@@ -450,6 +450,9 @@
     ('src/pages/MiniProjectDetailPage.svelte', 'code'),
     # Slice-5a T3: the last InlineField row drops its divider (ref 1548).
     ('src/components/editor/VersionMetaForm.svelte', '.inline-field:last-child'),
+    # Slice-5a T5b: same last-row rule in the accordion bodies.
+    ('src/components/editor/BlockAccordion.svelte', '.inline-field:last-child'),
+    ('src/components/editor/SequenceAccordion.svelte', '.inline-field:last-child'),
 }
 def global_payloads(style):
     """(payload, …) for every `:global(...)` and `:global{…}`, balanced."""
@@ -3677,5 +3680,50 @@
   echo "PASS  AccordionHeader no #f5f5f5 / --surface-hover / ↑↓ text glyphs"
 fi
 
+echo
+echo "--- (y) Slice-5a T5b — accordion bodies: inline fields, create forms, delete footers (3b) ---"
+# body_common LABEL — the rules BlockAccordion and SequenceAccordion share (N/H set by caller).
+body_common() {
+  d '\.fields' '' 'display:flex' 'flex-direction:column'
+  chk "\.fields\.${H}>\.inline-field:last-child" 'border-bottom:0'
+  d '\.cr-form' '' 'display:flex' 'flex-direction:column' 'gap:8px' 'padding:12px 0'
+  d '\.cr-actions' '' 'display:flex' 'justify-content:flex-end'
+  chk "\.field-err\.${H},\.form-err\.${H}" 'margin:0' 'font-size:12\.5px' 'color:var\(--danger\)'
+  d '\.empty' '' 'margin:0' 'font-size:13px' 'color:var\(--muted\)'
+  d '\.del-footer' '' 'display:flex' 'align-items:center' 'gap:8px' 'margin-top:14px' 'padding-top:12px' 'border-top:1px solid var\(--border-soft\)'
+  d '\.del-text' '' 'font-size:12\.5px' 'color:var\(--muted\)'
+  none "$N pre-5a .meta/.row/.head/.create/.danger rules gone" "\.(meta|row|head|create|danger)\.${H}[{ ,:>]"
+  none "$N no rem font sizes"                                "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
+  sweep $N $H
+}
+
+own block-card BlockAccordion.svelte
+uniq1 block-card
+if [[ -n $REPLY ]]; then
+  N=BlockAccordion; H=$REPLY
+  d '\.block-card' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'overflow:hidden' 'margin-bottom:10px'
+  d '\.acc-body' '' 'display:flex' 'flex-direction:column' 'gap:10px' 'padding:12px 14px'
+  chk "\.cr-form\.${H} input:where\(\.${H}\)" 'box-sizing:border-box' 'width:100%' 'height:var\(--control-h\)' 'padding:0 10px' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:13px'
+  d '\.seqs-list' '' 'display:flex' 'flex-direction:column' 'gap:10px' 'list-style:none' 'padding:0' 'margin:0'
+  body_common
+fi
+
+own items-head SequenceAccordion.svelte
+uniq1 items-head
+if [[ -n $REPLY ]]; then
+  N=SequenceAccordion; H=$REPLY
+  d '\.acc-body' '' 'padding:12px 14px' 'border-top:1px solid var\(--border-soft\)'
+  d '\.items-head' '' 'display:flex' 'align-items:center' 'justify-content:space-between' 'margin-bottom:4px'
+  d 'h5' '' 'margin:0' 'font-size:13px' 'font-weight:600'
+  CF="\.cr-form\.${H} input:where\(\.${H}\),\.cr-form\.${H} textarea:where\(\.${H}\)"
+  chk "$CF" 'box-sizing:border-box' 'width:100%' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:13px'
+  chk "\.cr-form\.${H} input:where\(\.${H}\)"    'height:var\(--control-h\)' 'padding:0 10px'
+  chk "\.cr-form\.${H} textarea:where\(\.${H}\)" 'height:auto' 'padding:8px 10px'
+  d '\.items-list' '' 'list-style:none' 'padding:0' 'margin:0'
+  # D10: the sequence has no card border of its own.
+  none "SequenceAccordion has no card border (D10)" "\.sequence\.${H}\{"
+  body_common
+fi
+
 # The summary line is the parent process's (see the re-exec at the top).
 exit $fail
PATCH
```


- [ ] **Step 6: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1543 passed (1543)`; `0 ERRORS 18 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (881 checks)`.

- [ ] **Step 7: Reviewer probes**

Each of these mutations was confirmed to fail the named check; reviewers may re-run any of them (revert after):

- restore the old order in `BlockAccordion.deleteBlock` (reload, then navigate) → the page test "deleting the expanded block … no \"Block not found.\"" fails; same for `SequenceAccordion.deleteSeq` → the sequence page test fails.
- navigate even when not `expanded` → "delete success while another block is expanded: reload only, no navigate" fails; drop `replace: true` → the `replaceState` assertion fails.
- remove either collapse-reset `$effect` → the matching "collapse resets the create … form" test fails; remove `createTracker.discard` → the discardAll test fails.
- footer text without the lower-cased reason, or without the "cancel the new sequence/item first" / "remove its items first" branch → a precedence test fails.
- gate a sequence-delete reload on its own `alive` → "a sequence delete still reloads after the parent block collapsed" fails; drop `alive &&` or `check(savedVid)` from the sequence navigate gate → a late-delete test fails.
- `patchSeq` reload without the `check(savedVid)` gate → "a late title commit after a version change does not reload" fails.
- remove the checked-radio focus → "Items is an <h5>; the + opens the form and focuses the checked type radio" fails; drop the D3 suffix from the block confirm → the block delete test fails.
- gate: `.del-text` 12px or the item-form textarea `padding: 8px` → gate FAIL in (y).

- [ ] **Step 8: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/BlockAccordion.svelte \
  frontend/src/components/editor/SequenceAccordion.svelte \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/BlockAccordion.svelte.test.ts \
  frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts \
  frontend/src/tests/VersionEditPage.svelte.test.ts \
  frontend/src/tests/BlockGroup.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5a T5b — accordion bodies: inline fields, create forms, delete footers, navigate-first deletes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## Task 6: Item rows + item type picker

`ItemRow` drops the emoji for a non-interactive `ItemMark` (`state="not-yet"`), shows the title, mono slug and — for a quiz — a `--faint` separator and mono question count, and gets four always-rendered `IconButton sm` slots ↑ ↓ open delete (arrow precedence as the headers; delete disabled with the structure reason; Open enabled unless busy). Props: `canStructure` and `parentDirty` are replaced by `structureReason`; `canReorder*` mean "not at the boundary". `ItemTypePicker` becomes `fieldset.type-picker` with four `ItemMark` radio cards (selected `--primary` border on `--primary-soft`), the established inset focus ring via `label:has(input:focus-visible)` (the old `:focus-within` outline is removed — D12 exception) and a forced-colors block; radios stay sr-only. `SequenceAccordion`'s `ItemRow` call site changes here, plus a parent rule dropping the last row's hairline. Item delete never gets the D3 suffix. Gate section (z).

**Files:**
- Modify (rewrite): `frontend/src/components/editor/ItemRow.svelte`, `frontend/src/components/editor/ItemTypePicker.svelte`
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` (patch), `frontend/scripts/visual-refresh-gate.sh`
- Test (modify): `frontend/src/tests/ItemRow.svelte.test.ts`, `frontend/src/tests/ItemTypePicker.svelte.test.ts` (full content given), `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` (patch)

**Interfaces:**
- Consumes: `ItemMark` (`type`, `state`), `IconButton`, `labelFor`; `SequenceAccordion.structReason` (T5b).
- Produces: `ItemRow` props `{ item: AdminTreeItem; index: number; structureReason: string | null; canReorderUp: boolean; canReorderDown: boolean; busy: boolean; onMoveUp; onMoveDown; onOpen; onDelete }`; slot names `Move item up: {name}`, `Move item down: {name}`, `Open {name}`, `Delete {name}`; `[data-testid="item-question-count"]` kept.

- [ ] **Step 1: Write the failing tests**

File: `frontend/src/tests/ItemRow.svelte.test.ts` — full content:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemRow from '../components/editor/ItemRow.svelte';
import type { AdminTreeItem } from '../lib/types';

const item = (over: Partial<AdminTreeItem> = {}): AdminTreeItem => ({
  id: 1, sequence_id: 9, title: 'Pop quiz', slug: 'pop-quiz', order: 1,
  type: 'quiz', content_md: null, content_html: null, video_url: null,
  script_url: null, questions_count: 3, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    item: item(), index: 1, structureReason: null, canReorderUp: true,
    canReorderDown: true, busy: false,
    onMoveUp: vi.fn(), onMoveDown: vi.fn(), onOpen: vi.fn(), onDelete: vi.fn(), ...over,
  });
  const cmp = mount(ItemRow, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}
const count = (t: HTMLElement) => t.querySelector('[data-testid="item-question-count"]');

it('a quiz item row shows its questions_count (plural)', () => {
  const { target } = mountRow({ item: item({ questions_count: 3 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('3 questions');
});

it('a single-question quiz uses the singular noun', () => {
  const { target } = mountRow({ item: item({ questions_count: 1 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('1 question');
});

it('a zero-question quiz still renders the count (plural)', () => {
  const { target } = mountRow({ item: item({ questions_count: 0 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('0 questions');
});

it('non-quiz item types do NOT render a question count', () => {
  const { target } = mountRow({ item: item({ type: 'static_page', questions_count: 0 }) });
  flushSync();
  expect(count(target)).toBeNull();
});

it('the count updates reactively when questions_count changes (the post-delete refresh path)', () => {
  const { target, props } = mountRow({ item: item({ questions_count: 3 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('3 questions');
  props.item = item({ questions_count: 2 });   // loadAdminTree refresh replaces the item prop
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('2 questions');
});

// Slice-5a T6: ItemMark replaces the emoji glyph; four fixed icon slots.
const slot = (t: HTMLElement, glyph: string) => t.querySelector<HTMLButtonElement>(`.actions button[data-glyph="${glyph}"]`)!;
const EMOJI = /\p{Extended_Pictographic}/u;

describe('ItemRow — 3b treatment (T6)', () => {
  it('leads with a not-yet ItemMark of the item type and carries no emoji', () => {
    const { target } = mountRow({ item: item({ type: 'video' }) });
    flushSync();
    const mark = target.querySelector('.item-row > .item-mark')!;
    expect(mark.classList.contains('not-yet')).toBe(true);
    expect(target.querySelector('.glyph')).toBeNull();
    expect(EMOJI.test(target.textContent ?? '')).toBe(false);
  });

  it('title, mono slug (aria-hidden), and for a quiz the faint separator + mono count', () => {
    const { target } = mountRow();
    flushSync();
    expect(target.querySelector('.item-title')!.textContent).toBe('Pop quiz');
    const slug = target.querySelector('.item-slug')!;
    expect(slug.textContent).toBe('/pop-quiz');
    expect(slug.classList.contains('mono')).toBe(true);
    expect(slug.getAttribute('aria-hidden')).toBe('true');
    expect(target.querySelector('.sep')!.getAttribute('aria-hidden')).toBe('true');
    expect(count(target)!.classList.contains('mono')).toBe(true);
  });

  it('four slots in order ↑ ↓ open delete, named after the item', () => {
    const { target } = mountRow();
    flushSync();
    const slots = [...target.querySelectorAll<HTMLButtonElement>('.actions button')];
    expect(slots.map((b) => b.dataset.glyph)).toEqual(['up', 'down', 'pencil', 'trash']);
    expect(slots.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move item up: Pop quiz', 'Move item down: Pop quiz', 'Open Pop quiz', 'Delete Pop quiz',
    ]);
    expect(slots.map((b) => b.title)).toEqual(['Move up', 'Move down', 'Open', 'Delete']);
    expect(slots.every((b) => !b.disabled)).toBe(true);
  });

  it('boundary arrows stay rendered, disabled with "already first/last"', () => {
    const { target } = mountRow({ canReorderUp: false, canReorderDown: false });
    flushSync();
    expect(slot(target, 'up').disabled).toBe(true);
    expect(slot(target, 'up').title).toBe('Move up — already first');
    expect(slot(target, 'down').disabled).toBe(true);
    expect(slot(target, 'down').title).toBe('Move down — already last');
  });

  it('a structure reason disables ↑ ↓ delete with the reason; Open stays enabled', () => {
    const reason = 'Only a created version can change its structure';
    const { target } = mountRow({ structureReason: reason, canReorderUp: false });
    flushSync();
    for (const g of ['up', 'down', 'trash']) {
      expect(slot(target, g).disabled).toBe(true);
      expect(slot(target, g).title).toBe(reason);
    }
    expect(slot(target, 'pencil').disabled).toBe(false);
  });

  it('busy disables every slot', () => {
    const { target } = mountRow({ busy: true });
    flushSync();
    expect([...target.querySelectorAll<HTMLButtonElement>('.actions button')].every((b) => b.disabled)).toBe(true);
  });

  it('each enabled slot calls its handler', () => {
    const onMoveUp = vi.fn(), onMoveDown = vi.fn(), onOpen = vi.fn(), onDelete = vi.fn();
    const { target } = mountRow({ onMoveUp, onMoveDown, onOpen, onDelete });
    flushSync();
    slot(target, 'up').click();
    slot(target, 'down').click();
    slot(target, 'pencil').click();
    slot(target, 'trash').click();
    expect([onMoveUp, onMoveDown, onOpen, onDelete].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });
});
```

File: `frontend/src/tests/ItemTypePicker.svelte.test.ts` — full content:

```ts
import { it, expect, afterEach } from 'vitest';
import type { AdminTreeItem } from '../lib/types';
import { mount, unmount, flushSync } from 'svelte';
import ItemTypePicker from '../components/editor/ItemTypePicker.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('offers a quiz radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' | 'interactive_app' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const quiz = target.querySelector('input[value="quiz"]') as HTMLInputElement;
  expect(quiz).not.toBeNull();
  quiz.click();
  flushSync();
  expect(props.value).toBe('quiz');
});

it('offers an interactive_app radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' | 'interactive_app' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const radio = target.querySelector('input[value="interactive_app"]') as HTMLInputElement;
  expect(radio).not.toBeNull();
  radio.click();
  flushSync();
  expect(props.value).toBe('interactive_app');
});

type T = AdminTreeItem['type'];
function mountPicker(value: T = 'static_page') {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: T } = $state({ value });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, props };
}

it('renders four labelled cards, each led by a not-yet ItemMark — no emoji (T6)', () => {
  const { target } = mountPicker();
  expect(target.querySelector('fieldset.type-picker > legend')!.textContent).toBe('Item type');
  const cards = [...target.querySelectorAll('label')];
  expect(cards.map((c) => c.textContent?.trim())).toEqual(['Page', 'Video', 'Quiz', 'Interactive app']);
  expect(cards.every((c) => c.querySelector('.item-mark.not-yet'))).toBe(true);
  expect(/\p{Extended_Pictographic}/u.test(target.textContent ?? '')).toBe(false);
});

it('marks only the checked card as selected, and follows a change', () => {
  const { target } = mountPicker('video');
  const selected = () => [...target.querySelectorAll('label.selected')].map((c) => c.textContent?.trim());
  expect(selected()).toEqual(['Video']);
  target.querySelector<HTMLInputElement>('input[value="quiz"]')!.click();
  flushSync();
  expect(selected()).toEqual(['Quiz']);
});
```

Patch for `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
+++ b/frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
@@ -277,3 +277,23 @@
     expect(treeFetchPaths).toEqual([]);
   });
 });
+
+describe('SequenceAccordion — item rows (T6)', () => {
+  it('passes the structure reason to item rows (published: delete disabled, open enabled)', () => {
+    const { target } = mountAccordion(mkSeq({ items: [item] }), mkVersion({ state: 'published' }));
+    const del = target.querySelector<HTMLButtonElement>('button[aria-label="Delete Page"]')!;
+    expect(del.disabled).toBe(true);
+    expect(del.title).toBe('Only a created version can change its structure');
+    expect(target.querySelector<HTMLButtonElement>('button[aria-label="Open Page"]')!.disabled).toBe(false);
+  });
+
+  it('an item delete never carries the unsaved suffix (D3)', async () => {
+    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
+    const { target } = mountAccordion(mkSeq({ items: [item] }));
+    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the sequence title"]')!.click();
+    await settle();
+    type(target.querySelector<HTMLInputElement>('.inline-field input')!, 'Dirty');
+    target.querySelector<HTMLButtonElement>('button[aria-label="Delete Page"]')!.click();
+    expect(confirmSpy).toHaveBeenCalledWith('Delete "Page"? This cannot be undone.');
+  });
+});
PATCH
```


- [ ] **Step 2: Run them — expect FAIL**

```bash
TZ=Europe/Copenhagen npx vitest run src/tests/ItemRow.svelte.test.ts src/tests/ItemTypePicker.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts
```

Expected: the T6 cases fail (emoji glyphs, no `ItemMark`, text buttons instead of four icon slots, no `.type-picker`, Delete not disabled with the reason on a published version); the older count/binding cases still pass.

- [ ] **Step 3: Implement**

File: `frontend/src/components/editor/ItemRow.svelte` — full content:

```svelte
<script lang="ts">
  // One item in a sequence body (3b, ref 1588-1606): a non-interactive type
  // mark, the title, the mono slug, a quiz's question count, and four fixed
  // icon slots — ↑ ↓ open delete (§4 keep the slot count fixed).
  import { labelFor } from '../../lib/labelFor';
  import ItemMark from '../course/ItemMark.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import type { AdminTreeItem } from '../../lib/types';

  type Props = {
    item: AdminTreeItem;
    index: number;
    // Non-null when the version forbids structure changes; disables the
    // arrows and Delete with this reason as their title.
    structureReason: string | null;
    // "Not at the boundary in that direction" — the arrows always render.
    canReorderUp: boolean;
    canReorderDown: boolean;
    busy: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onOpen: () => void;
    onDelete: () => void;
  };

  let {
    item,
    index,
    structureReason,
    canReorderUp,
    canReorderDown,
    busy,
    onMoveUp,
    onMoveDown,
    onOpen,
    onDelete,
  }: Props = $props();

  // Placeholder text when both title and slug are missing. Visible form
  // wraps it in parens to mark "this is a placeholder, not a real name";
  // aria-label uses the plain form so screen readers don't announce stray
  // punctuation. Same convention as AccordionHeader.
  const placeholder = $derived(`item ${index}`);
  const ariaName = $derived(labelFor(item.title, item.slug, placeholder));
  const visibleTitle = $derived(item.title.trim() || item.slug.trim() || `(${placeholder})`);

  // Title precedence (as AccordionHeader): structure reason → boundary → normal.
  const upTitle = $derived(structureReason ?? (canReorderUp ? 'Move up' : 'Move up — already first'));
  const downTitle = $derived(structureReason ?? (canReorderDown ? 'Move down' : 'Move down — already last'));
</script>

<div class="item-row">
  <ItemMark type={item.type} state="not-yet" />
  <span class="item-title">{visibleTitle}</span>
  {#if item.title.trim() && item.slug.trim()}
    <span class="mono item-slug" aria-hidden="true">/{item.slug}</span>
  {/if}
  {#if item.type === 'quiz'}
    <span class="sep" aria-hidden="true">·</span>
    <span class="mono q-count" data-testid="item-question-count">{item.questions_count} {item.questions_count === 1 ? 'question' : 'questions'}</span>
  {/if}
  <span class="actions">
    <IconButton
      size="sm"
      glyph="up"
      title={upTitle}
      aria-label={`Move item up: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderUp}
      onclick={onMoveUp}
    />
    <IconButton
      size="sm"
      glyph="down"
      title={downTitle}
      aria-label={`Move item down: ${ariaName}`}
      disabled={busy || !!structureReason || !canReorderDown}
      onclick={onMoveDown}
    />
    <IconButton size="sm" glyph="pencil" title="Open" aria-label={`Open ${ariaName}`} disabled={busy} onclick={onOpen} />
    <IconButton
      size="sm"
      glyph="trash"
      danger
      title={structureReason ?? 'Delete'}
      aria-label={`Delete ${ariaName}`}
      disabled={busy || !!structureReason}
      onclick={onDelete}
    />
  </span>
</div>

<style>
  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-soft); /* ref 1588 */
  }
  .item-title { min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; /* ref 1590 */ }
  .item-slug { font-size: 12px; color: var(--muted); /* ref 1591 */ }
  .sep { color: var(--faint); /* ref 1606 — the separator use of --faint */ }
  .q-count { font-size: 12px; color: var(--muted); /* ref 1606 */ }
  .actions { margin-left: auto; display: flex; align-items: center; gap: 6px; /* ref 1593 */ }
</style>
```

File: `frontend/src/components/editor/ItemTypePicker.svelte` — full content:

```svelte
<script lang="ts">
  // Authorable item types offered by the create picker: static_page, video,
  // quiz, and interactive_app. Narrower than the full backend item-type union,
  // which also includes 'mini_project' (not authored via this picker). Widen
  // this union if the product scope expands.
  import ItemMark from '../course/ItemMark.svelte';

  type ItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app';
  // Canonical Svelte 5 form: `$bindable()` without a type argument; the
  // prop type `value: ItemType` constrains it. Every call site
  // (SequenceAccordion) binds `value`, so no default is needed.
  let { value = $bindable() }: { value: ItemType } = $props();

  const TYPES: { value: ItemType; label: string }[] = [
    { value: 'static_page', label: 'Page' },
    { value: 'video', label: 'Video' },
    { value: 'quiz', label: 'Quiz' },
    { value: 'interactive_app', label: 'Interactive app' },
  ];
</script>

<fieldset class="type-picker">
  <legend>Item type</legend>
  <div class="cards">
    {#each TYPES as t (t.value)}
      <label class:selected={value === t.value}>
        <input type="radio" name="item-type" value={t.value} bind:group={value} />
        <ItemMark type={t.value} state="not-yet" />
        <span>{t.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .type-picker { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 4px; /* the 4px label/field step */ font-size: 12.5px; color: var(--muted); }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; /* the 8px create-form gap (spec §4) */ }
  /* position: relative anchors the visually-hidden radio inside its card. */
  label {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  label.selected { border-color: var(--primary); background: var(--primary-soft); }
  /* D12 exception — the established sr-only-radio focus idiom (Login .segment,
     quiz .opt): --primary is visible on both --surface and --primary-soft. */
  label:has(input:focus-visible) { box-shadow: inset 0 0 0 2px var(--primary); }
  /* Constraint 2: the sr-only idiom for a still-focusable radio, not a dim. */
  label input { position: absolute; opacity: 0; pointer-events: none; }
  @media (forced-colors: active) {
    label.selected { border: 2px solid Highlight; }
    label:has(input:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
  }
</style>
```

Patch for `frontend/src/components/editor/SequenceAccordion.svelte` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/src/components/editor/SequenceAccordion.svelte
+++ b/frontend/src/components/editor/SequenceAccordion.svelte
@@ -376,10 +376,9 @@
               <ItemRow
                 {item}
                 index={i + 1}
-                {canStructure}
-                canReorderUp={canStructure && i > 0}
-                canReorderDown={canStructure && i < seq.items.length - 1}
-                parentDirty={false}
+                structureReason={structReason}
+                canReorderUp={i > 0}
+                canReorderDown={i < seq.items.length - 1}
                 busy={busy || createBusy || parentBusy}
                 onMoveUp={() => void reorderItem(i, -1)}
                 onMoveDown={() => void reorderItem(i, 1)}
@@ -430,6 +429,7 @@
   .field-err, .form-err { margin: 0; font-size: 12.5px; color: var(--danger); }
   .empty { margin: 0; font-size: 13px; color: var(--muted); }
   .items-list { list-style: none; padding: 0; margin: 0; }
+  .items-list > li:last-child > :global(.item-row) { border-bottom: 0; /* ref 1602 */ }
   .del-footer {
     display: flex;
     align-items: center;
PATCH
```


- [ ] **Step 4: Run the task tests — expect PASS**

Same command as Step 2. Expected: ItemRow 12, ItemTypePicker 4, SequenceAccordion.interactive 17 — all passed.

- [ ] **Step 5: Gate section (z)**

Adds section (z) (including a python-based emoji check — BSD grep has no `-P`), allow-lists the `SequenceAccordion` `.item-row` last-child rule, and bumps `EXPECTED_CHECKS` 881 → 942.

Patch for `frontend/scripts/visual-refresh-gate.sh` — apply from the repo root:

```bash
git apply <<'PATCH'
--- a/frontend/scripts/visual-refresh-gate.sh
+++ b/frontend/scripts/visual-refresh-gate.sh
@@ -87,7 +87,7 @@
 # checks are added, which is the failure this exists to catch (codex-r1-M2,
 # tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
 # speed bump is intentional.
-EXPECTED_CHECKS=881
+EXPECTED_CHECKS=942
 if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
   log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
   # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
@@ -453,6 +453,8 @@
     # Slice-5a T5b: same last-row rule in the accordion bodies.
     ('src/components/editor/BlockAccordion.svelte', '.inline-field:last-child'),
     ('src/components/editor/SequenceAccordion.svelte', '.inline-field:last-child'),
+    # Slice-5a T6: the last item row drops its hairline (ref 1602).
+    ('src/components/editor/SequenceAccordion.svelte', '.item-row'),
 }
 def global_payloads(style):
     """(payload, …) for every `:global(...)` and `:global{…}`, balanced."""
@@ -3725,5 +3727,60 @@
   body_common
 fi
 
+echo
+echo "--- (z) Slice-5a T6 — item rows + item type picker (3b) ---"
+own item-row ItemRow.svelte
+uniq1 item-row
+if [[ -n $REPLY ]]; then
+  N=ItemRow; H=$REPLY
+  d '\.item-row' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:8px 0' 'border-bottom:1px solid var\(--border-soft\)'
+  d '\.item-title' '' 'font-size:13px' 'font-weight:600' 'color:var\(--text\)'
+  d '\.item-slug' '' 'font-size:12px' 'color:var\(--muted\)'
+  d '\.sep' '' 'color:var\(--faint\)'
+  d '\.q-count' '' 'font-size:12px' 'color:var\(--muted\)'
+  d '\.actions' '' 'margin-left:auto' 'display:flex' 'align-items:center' 'gap:6px'
+  none "ItemRow pre-5a .glyph rule gone"  "\.glyph\.${H}"
+  none "ItemRow no rem font sizes"         "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
+  sweep ItemRow $H
+fi
+# The parent drops the last row's hairline (ref 1602), hash-coupled to SequenceAccordion.
+uniq1 items-head
+if [[ -n $REPLY ]]; then
+  N=SequenceAccordion; H=$REPLY
+  chk "\.items-list\.${H}>li:where\(\.${H}\):last-child>\.item-row" 'border-bottom:0'
+fi
+
+own type-picker ItemTypePicker.svelte
+uniq1 type-picker
+if [[ -n $REPLY ]]; then
+  N=ItemTypePicker; H=$REPLY
+  d '\.type-picker' '' 'border:0' 'padding:0' 'margin:0'
+  d 'legend' '' 'padding:0' 'margin-bottom:4px' 'font-size:12\.5px' 'color:var\(--muted\)'
+  d '\.cards' '' 'display:flex' 'flex-wrap:wrap' 'gap:8px'
+  d 'label' '' 'position:relative' 'display:flex' 'align-items:center' 'gap:8px' 'padding:6px 10px' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'font-size:13px' 'cursor:pointer'
+  d 'label\.selected' '' 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
+  # D12 exception: the established inset ring, and the forced-colors block.
+  chk "label\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'box-shadow:inset 0 0 0 2px var\(--primary\)'
+  chk "@media \(forced-colors: active\)\{label\.selected\.${H}" 'border:2px solid Highlight'
+  chk "label\.selected\.${H}\{border:2px solid Highlight\}label\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'outline:2px solid Highlight' 'outline-offset:-2px'
+  # Constraint 2: the radio stays the sr-only idiom (position + pointer-events), not a dim.
+  chk "label\.${H} input:where\(\.${H}\)" 'position:absolute' 'opacity:0' 'pointer-events:none'
+  none "ItemTypePicker :focus-within outline gone" "label\.${H}:focus-within"
+  none "ItemTypePicker pre-5a .picker/.glyph gone" "\.(picker|glyph)\.${H}"
+  sweep ItemTypePicker $H
+fi
+# Source: no emoji or decorative glyph in either file (Constraint 3) — BSD grep has no -P.
+if python3 - <<'PY'
+import re, sys
+pat = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u25A0-\u25FF\u2318]')
+files = ('src/components/editor/ItemRow.svelte', 'src/components/editor/ItemTypePicker.svelte')
+sys.exit(1 if any(pat.search(open(f).read()) for f in files) else 0)
+PY
+then
+  echo "PASS  ItemRow / ItemTypePicker carry no emoji"
+else
+  echo "FAIL  ItemRow / ItemTypePicker carry no emoji"; fail=1
+fi
+
 # The summary line is the parent process's (see the re-exec at the top).
 exit $fail
PATCH
```


- [ ] **Step 6: Full verification**

In `frontend/`:

```bash
npm test
npm run check
zsh scripts/visual-refresh-gate.sh
```

Expected: `Tests  1554 passed (1554)`; `0 ERRORS 18 WARNINGS`; `VISUAL-REFRESH GATE: ALL PASS (942 checks)`.

- [ ] **Step 7: Reviewer probes**

Each of these mutations was confirmed to fail the named check; reviewers may re-run any of them (revert after):

- `ItemRow` delete `disabled={busy}` (no reason) or `title="Delete"` → the published-version delete tests fail; Open disabled by the reason → the Open-stays-enabled tests fail; `ItemMark state="done"` or a slug without `.mono` → the matching row test fails.
- `ItemTypePicker` `class:selected` fixed to `static_page`, or no `ItemMark` → a picker test fails.
- `SequenceAccordion` call site `structureReason={null}` → "passes the structure reason to item rows …" fails; give `deleteItem` the D3 suffix → "an item delete never carries the unsaved suffix (D3)" fails.
- gate: the old `ItemRow` with emoji → "ItemRow / ItemTypePicker carry no emoji" FAIL; `.sep` in `--muted`, the inset ring as an outline, or no last-row rule → gate FAIL in (z).

- [ ] **Step 8: Review**

Run the review loop from **Conventions** on the uncommitted diff. Fix every Critical/Important, re-run both lanes after each fix, repeat until both are clean. Do not commit before that, and wait for the user's OK before marking the task complete.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/editor/ItemRow.svelte \
  frontend/src/components/editor/ItemTypePicker.svelte \
  frontend/src/components/editor/SequenceAccordion.svelte \
  frontend/scripts/visual-refresh-gate.sh \
  frontend/src/tests/ItemRow.svelte.test.ts \
  frontend/src/tests/ItemTypePicker.svelte.test.ts \
  frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): Slice 5a T6 — item rows (ItemMark + four slots) and item type picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Close-out

- [ ] **Whole-branch review.** Both lanes (first-party Opus + codex@high, or the independent second reviewer) on `git diff 1b402b6..HEAD` with the spec and this plan; same fix-until-clean loop.
- [ ] **Browser pass (user).** Start the dev server (`npm run dev` in `frontend/`) and walk 3a and 3b with the user against `docs/design/visual-refresh/reference-screens.dc.html` (artboards 3a `:1452-1503`, 3b `:1505-1647`, 9d empty `:1353-1360`): created / published / archived / disabled versions; inline edit, fold, create, reorder, delete; a confirmed and a cancelled DirtyGuard prompt. `agent-browser` screenshots can support the pass; the user's explicit OK closes the slice. Taste findings → `docs/backlog/`.
- [ ] **Memory.** Update `project_visual_refresh.md` (and its `MEMORY.md` line): 5a done, branch tip, gate 942, tests 1554; NEXT = Slice 5b (item-editor modal + shell) off the 5a tip.

## Expected numbers at each task boundary

| after | `npm test` | `npm run check` | gate |
|---|---|---|---|
| baseline | 1396 | 0 / 31 | 489 |
| T1 | 1461 | 0 / 31 | 489 |
| T2 | 1473 | 0 / 31 | 591 |
| T3 | 1486 | 0 / 27 | 682 |
| T4 | 1502 | 0 / 27 | 730 |
| T5a | 1520 | 0 / 27 | 775 |
| T5b | 1543 | 0 / 18 | 881 |
| T6 | 1554 | 0 / 18 | 942 |
