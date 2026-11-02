# Slice 5c: a calmer course constructor (focus by depth) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the version editor easy to read and navigate:
- the open container is light and everything outside it is darker (focus by depth);
- rows carry controls only at the focus;
- blocks and sequences have only an inline-edited title;
- every item operation happens in a modal.

**Architecture:**
- **Focus depth.** The URL already drives one expansion path (`deriveExpansion`). The page derives a focus depth (0/1/2) from that path.
- **Header modes.** Each accordion derives a header *mode*: `row-focus`, `row-outside`, `open-focus` or `open-parent`. The mode picks both its background shade and the controls it shows.
- **New components.** Two modal components, `NewItemModal` and `VersionSettingsModal`, reuse 5b's `ui/Modal.svelte`. `AccordionHeader` gains the inline title editor.
- **Removed.** Block info leaves every screen; its data stays in the database.

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only, no JS/CSS deps.
- **Tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Gate:** the zsh gate script `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-visual-refresh-slice5c-constructor-focus-design.md` (rev 1, approved 2026-10-07, commit `0005bc4`).
**Mockup (authority for the look):** `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/constructor-v3.html`.

## Global Constraints

- **Branch:** `feat/visual-refresh-slice5-authoring`. LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/probe/`, never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only.
  - No new npm dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
- **Colours:**
  - No literal colours in component CSS. Use theme tokens only (spec "Process"; 5b Constraint 11). New shades are tokens in `styles/theme-default.css`.
  - No emoji in source. Icons come from `IconButton` glyphs: `pencil trash plus up down chevron chevron-right close check`.
- **Commands:**
  - Tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run`.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error` must show 0 errors. 13 warnings is the baseline.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus/tmp zsh scripts/visual-refresh-gate.sh`. It must end `ALL PASS (N checks)`. Never run it in two lanes at once.
- **Per task, in this order:**
  1. TDD.
  2. Screenshots of the affected states, shown to the user as an overlay with `--size-percent 60`. Get the user's OK on the look.
  3. Two review lanes, Opus and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes until both are clean. Minors go to `docs/backlog/slice5c-constructor-polish-debt.md`.
  4. Commit with exact paths and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  5. `task-done`, update memory, then WAIT for the user's OK before the next task.
- **Dev servers for screenshots:**
  - Backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && MATHION_DEBUG=1 .venv/bin/uvicorn mathion.main:app --reload`. The PIN is printed to its log.
  - Frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vite --port 5174 --strictPort`. Port 5173 belongs to another project.
  - Admin login: `dev@mathion.test`.
  - Demo course: course `demo-course`. v11 is created; v10 is published. In v11, block 53 → sequence 72 → items 171 (page) and 173 (quiz).
- **Permission rule (spec table):** controls the version state doesn't allow are hidden. Controls blocked only by the current state are disabled, with a reason tooltip.

## Rulings made while planning

- **R1 — After Create, push to the item URL; don't replace it.** Spec D10 says "navigate … with `replace`", but the New item modal is not a route, so Back can't reopen it anyway. 5b D7 needs the push: an in-page open sets `openedFromPage`, so × becomes `history.back()` and returns to the sequence. A `replace` would make × leave the sequence URL. T4 fixes the spec line.
  *Cost if wrong:* one argument to `navigate`.
- **R2 — Version Info is a plain monospace `<textarea>`** in the settings modal, not `MarkdownEditor`. The old card's inline field was also a plain textarea. `MarkdownEditor` would drag in `assetContext` and the asset sidebar for one rarely-edited field.
  *Cost if wrong:* swap the textarea for `MarkdownEditor` later.
- **R3 — Full-width shading through `:global(body:has(.canvas.d1))` / `.d2`.**
  - The app has no `<main>` wrapper; pages render straight into `body`.
  - `:has` is in Safari ≥ 15.4 and Chrome ≥ 105, so it needs no JS and leaves nothing behind when the page unmounts.
  - jsdom doesn't evaluate `:has`, so tests pin the `.canvas` classes and the gate pins the rules.
  *Cost if wrong:* a scoped `$effect` on `document.body` instead.
- **R4 — The item modal's context line is "Vectors › Linear combinations · item 1 of 2",** with no type word, as in the v3 mockup. The type mark already shows the type.
  *Cost if wrong:* one string.
- **R5 — Header mode is derived inside each accordion from `routeBid` / `routeSid`** and its own children, not passed down from the page. Accordions already own `expanded` the same way.
  *Cost if wrong:* a prop.

## Review Focus

These are the five failure modes most likely to bite an author. Each is pinned by a test in the owning task.

1. **Focus always follows the URL.** That includes Back/Forward, a deep link, a stale id falling back, and a reload.
   - Exactly one container has the `focus` class.
   - The `.canvas` depth class matches the open path.
   - Leaving the page removes `.canvas`, so the body shade goes with it.
   → T1: "depth classes follow navigation", "a collapsed parent loses the shade".
2. **Inline title editing is guarded like any draft.**
   - A changed title prompts on navigation; a confirmed prompt discards it.
   - A permission flip mid-edit closes it.
   - Esc inside the field cancels only the field.
   - A failed PATCH keeps the field open with the error.
   → T2: "rename is guard-dirty", "Esc cancels without a request", "error keeps the field open", "read-only flip closes it".
3. **The New item modal never loses typing silently and lands in the editor.**
   - × / Esc / Cancel with typed input prompts.
   - Browser Back while it's open prompts and closes it.
   - Create pushes the item URL, so the item's × returns to the sequence.
   - Closing that item lands focus on the new item's ✎.
   → T4: "close with typed input prompts", "create pushes into the item", "item × returns to the sequence, focus on ✎".
4. **Each version state shows exactly its controls.**
   - Published: ✎ titles and item ✎ only.
   - Archived / disabled: no title ✎, no ↑ ↓ 🗑, no "+ Add".
   - The settings modal is read-only outside "created".
   → T2/T3/T5: "published / archived / disabled control sets".
5. **Removing block info breaks nothing.**
   - The student view renders blocks without the info strip.
   - The constructor never sends `info`.
   - The settings modal sends only the fields that changed.
   → T6: "BlockGroup never renders info", "create block posts {title} only"; T5: "settings PATCH carries only changed fields".

## File structure

| File | Change | Task |
|---|---|---|
| `frontend/src/styles/theme-default.css` | add `--focus-*` tokens | T1 |
| `frontend/src/pages/editor/VersionEditPage.svelte` | `.canvas` + depth; drop Blocks card head and fold; "+ Add block" row; settings ✎ + modal; pass titles to the item modal | T1, T3, T4, T5 |
| `frontend/src/components/editor/BlockAccordion.svelte` | mode + shades; header controls; no body fields or delete footer; "+ Add sequence" row | T1, T2, T3 |
| `frontend/src/components/editor/SequenceAccordion.svelte` | mode + shades; header controls; no body fields or delete footer; "+ Add item" → modal | T1, T2, T4 |
| `frontend/src/components/editor/AccordionHeader.svelte` | rewritten: modes, inline title, header delete; no badge or slug | T2 |
| `frontend/src/components/editor/ItemRow.svelte` | no slug; `canStructure` hides ↑ ↓ 🗑 | T3 |
| `frontend/src/components/editor/NewItemModal.svelte` | **new** | T4 |
| `frontend/src/components/editor/ItemTypePicker.svelte` | four-card grid with a hint line | T4 |
| `frontend/src/components/editor/ItemEditorModal.svelte` | context-line props (`blockTitle`, `seqTitle`) | T4 |
| `frontend/src/components/editor/VersionSettingsModal.svelte` | **new** | T5 |
| `frontend/src/components/editor/VersionMetaForm.svelte` | **deleted** | T5 |
| `frontend/src/components/course/BlockGroup.svelte` | no info strip | T6 |
| `frontend/scripts/visual-refresh-gate.sh` | each task fixes its own pins; T6 adds section (ah) | T1–T6 |
| tests | per task, below | T1–T6 |

## Shared procedures

### P-shots: screenshots for the user

Run this at the end of every task, after tests, check and gate pass. The workspace is `W=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus`.

```bash
export AGENT_BROWSER_SESSION=mathion-5c
W=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-07-visual-refresh-slice5c-constructor-focus
mkdir -p $W/shots
B=http://localhost:5174/courses/demo-course/edit/v/11
agent-browser set viewport 1440 900
# one line per state the task changes, e.g.:
agent-browser open $B >/dev/null; agent-browser wait --load networkidle; agent-browser screenshot --full $W/shots/tN-1-version.png
agent-browser open $B/blocks/53 >/dev/null; agent-browser wait --load networkidle; agent-browser screenshot --full $W/shots/tN-2-block.png
agent-browser open $B/blocks/53/sequences/72 >/dev/null; agent-browser wait --load networkidle; agent-browser screenshot --full $W/shots/tN-3-sequence.png
```

If the session is logged out:
1. Open `/login`, fill `dev@mathion.test` and press "Send PIN".
2. Read the PIN from the backend log (`[auth] PIN for dev@mathion.test: NNNNNN`), fill it, and sign in.

Then:
1. `Read` every PNG yourself.
2. Fix anything plainly broken: misalignment, a missing control, a wrong shade.
3. Write `$W/tN-shots.html`: the PNGs as `<img src="shots/…">` with one caption line each. Open it with `agtermctl session overlay open --html $W/tN-shots.html --size-percent 60 --target "$AGTERM_SESSION_ID" --socket "$AGTERM_SOCKET"`.
4. Ask the user: "Does this look right?" Don't commit until they say yes.

### P-gate: keeping the gate green per task

After the code and tests of a task are green, run the gate.
- **Every `FAIL` must be a pin of markup or CSS this task removed or changed on purpose.** For each one, either delete the obsolete check from its section, or update its expected value to the new markup. Record each such change in the ledger as `Task N: gate — <section>: <check> removed|updated (<why>)`.
- **A FAIL for any other reason is a defect.** Fix the code, not the gate.
- **Then set `EXPECTED_CHECKS`** to the total the gate now prints, and record the old → new count in the ledger.
- **Never** delete a check that guards something still present: tokens, focus rings, forced-colors, emoji or literal colours.

### P-review: the two lanes

Dispatch two reviewers, model `opus` and model `fable`, on the uncommitted diff.

Give each one:
- the task's brief;
- the spec path, the plan's Global Constraints and Review Focus;
- the ledger;
- the rule "stay inside the project dir, read-only, don't run the gate".

They reply CLEAN or NOT CLEAN with file:line findings. Fix every Critical and Important finding with TDD, then send both lanes the new diff. Repeat until both are clean.

---

### Task 1: Focus by depth: shades, canvas, and no Blocks card

**Files:**
- Modify: `frontend/src/styles/theme-default.css`
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (script: depth; template: `.canvas`, remove the Blocks card head and fold; styles)
- Modify: `frontend/src/components/editor/BlockAccordion.svelte` (mode + panel classes + styles)
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` (mode + `.seq-card` wrapper + styles)
- Test: `frontend/src/tests/VersionEditPage.svelte.test.ts`, `frontend/src/tests/BlockAccordion.svelte.test.ts`, `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`

**Interfaces:**
- Produces:
  - `type HeaderMode = 'row-focus' | 'row-outside' | 'open-focus' | 'open-parent'`, exported from `AccordionHeader.svelte`'s `<script module>`. T1 adds the module script only; T2 rewrites the rest.
  - In BlockAccordion: `const mode: HeaderMode`.
  - In SequenceAccordion: `const mode: HeaderMode`.
  - On VersionEditPage: `.canvas` with class `d0|d1|d2`.

- [ ] **Step 1: Write the failing tests**

In `VersionEditPage.svelte.test.ts`, add the following. It uses that file's existing mount helper and router setup; read the top of the file first and reuse its helpers by name.

```ts
describe('VersionEditPage — focus by depth (Slice-5c T1)', () => {
  it('depth classes follow navigation: d0 → d1 → d2 → d1 → d0', async () => {
    // Uses the file's existing two-level tree fixture (block 3 → sequence 5).
    await mountPageAt('/courses/c/edit/v/1');
    const canvas = () => document.querySelector('.canvas')!;
    expect(canvas().classList.contains('d0')).toBe(true);
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(canvas().classList.contains('d1')).toBe(true);
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    expect(canvas().classList.contains('d2')).toBe(true);
    history.back(); await waitPop(); await settle();
    expect(canvas().classList.contains('d1')).toBe(true);
    history.back(); await waitPop(); await settle();
    expect(canvas().classList.contains('d0')).toBe(true);
  });

  it('exactly one container is the focus at every depth', async () => {
    await mountPageAt('/courses/c/edit/v/1/blocks/3/sequences/5');
    expect(document.querySelectorAll('.focus').length).toBe(1);
    expect(document.querySelector('.seq-card.focus')).not.toBeNull();
    expect(document.querySelector('.block-card.parent')).not.toBeNull();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(document.querySelectorAll('.focus').length).toBe(1);
    expect(document.querySelector('.block-card.focus')).not.toBeNull();
    expect(document.querySelector('.block-card.parent')).toBeNull();
  });

  it('the Blocks card head and its fold are gone', async () => {
    await mountPageAt('/courses/c/edit/v/1');
    expect(document.querySelector('.blocks-card')).toBeNull();
    expect(document.querySelector('button[aria-label="Collapse blocks"]')).toBeNull();
  });

  it('a stale block id falls back and the canvas returns to d0', async () => {
    await mountPageAt('/courses/c/edit/v/1/blocks/999');
    await settle();
    expect(document.querySelector('.canvas')!.classList.contains('d0')).toBe(true);
  });
});
```

If the file's helpers have different names (for example `renderAt` instead of `mountPageAt`, or no `waitPop`), use the existing ones. If `waitPop` is missing, copy it from `VersionEditPage.svelte.test.ts`'s T3b section, or from the 5b host tests: two `setTimeout(0)` hops. Record the names used in the ledger.

In `BlockAccordion.svelte.test.ts`, add:

```ts
describe('BlockAccordion — focus shading (Slice-5c T1)', () => {
  it('collapsed with no block open: a row at the focus level, no shade', () => {
    mountBlock();
    const card = target.querySelector('.block-card')!;
    expect(card.classList.contains('focus')).toBe(false);
    expect(card.classList.contains('parent')).toBe(false);
  });

  it('open with no sequence open: the focus', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(target.querySelector('.block-card')!.classList.contains('focus')).toBe(true);
  });

  it('open with one of its sequences open: the parent shade, not the focus', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    const card = target.querySelector('.block-card')!;
    expect(card.classList.contains('parent')).toBe(true);
    expect(card.classList.contains('focus')).toBe(false);
  });

  it('a collapsed parent loses the shade (sequence closed → block is the focus again)', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    const card = target.querySelector('.block-card')!;
    expect(card.classList.contains('focus')).toBe(true);
    expect(card.classList.contains('parent')).toBe(false);
  });
});
```

In `SequenceAccordion.interactive.svelte.test.ts`, add the following, using that file's mount helper:

```ts
describe('SequenceAccordion — focus shading (Slice-5c T1)', () => {
  it('the open sequence is the focus; a collapsed one has no shade', async () => {
    mountSeq();                                     // the file's helper; block 3, seq 5
    expect(target.querySelector('.seq-card')!.classList.contains('focus')).toBe(false);
    await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    expect(target.querySelector('.seq-card')!.classList.contains('focus')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionEditPage.svelte.test.ts src/tests/BlockAccordion.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts -t "Slice-5c T1"`
Expected: FAIL. There is no `.canvas`, no `.focus` / `.parent` classes, and no `.seq-card`, and `.blocks-card` still exists.

- [ ] **Step 3: Add the tokens**

In `frontend/src/styles/theme-default.css`, inside the `:root` block after `--surface-3`, add:

```css
  /* Slice-5c focus by depth: the open container is --focus-0; each level
     further out is one step darker (spec D1/D2). */
  --focus-0: var(--surface);
  --focus-1: #EEF0F3;
  --focus-2: #E1E4E9;
  --focus-line: rgba(20, 24, 35, 0.11);      /* borders that stay visible on every shade */
  --focus-line-strong: #B9C2CF;              /* the focus container's border */
  --focus-shadow: 0 1px 4px rgba(20, 24, 35, 0.08);
```

- [ ] **Step 4: Add the `HeaderMode` type**

At the top of `AccordionHeader.svelte`, before the existing `<script lang="ts">`, add:

```svelte
<script module lang="ts">
  // Where a block / sequence header sits relative to the focus (Slice-5c D4):
  // a row inside the focus container, a row outside it, the open node that IS
  // the focus, or the open node above it (the block of an open sequence).
  export type HeaderMode = 'row-focus' | 'row-outside' | 'open-focus' | 'open-parent';
</script>
```

- [ ] **Step 5: BlockAccordion mode and classes**

In `BlockAccordion.svelte`'s script, after `const expanded = …`, add:

```ts
  import type { HeaderMode } from './AccordionHeader.svelte';   // move to the import block
  // Slice-5c D1/D4: where this block sits relative to the focus.
  const seqOpen = $derived(expanded && block.sequences.some((s) => String(s.id) === routeSid));
  const mode: HeaderMode = $derived(
    expanded ? (seqOpen ? 'open-parent' : 'open-focus') : (routeBid === null ? 'row-focus' : 'row-outside'),
  );
```

Change the root element:

```svelte
<div class="block-card" class:focus={mode === 'open-focus'} class:parent={mode === 'open-parent'}>
```

Replace the `.block-card` rule with:

```css
  .block-card {
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: transparent;   /* a row takes its container's shade */
    overflow: hidden;
    margin-bottom: 6px;
  }
  .block-card.parent { background: var(--focus-1); }
  .block-card.focus {
    background: var(--focus-0);
    border-color: var(--focus-line-strong);
    box-shadow: var(--focus-shadow);
  }
```

- [ ] **Step 6: SequenceAccordion mode, wrapper and classes**

In `SequenceAccordion.svelte`'s script, after `const expanded = …`, add:

```ts
  import type { HeaderMode } from './AccordionHeader.svelte';   // move to the import block
  // Slice-5c D1/D4: a sequence is only visible while its block is open.
  const mode: HeaderMode = $derived(expanded ? 'open-focus' : (routeSid === null ? 'row-focus' : 'row-outside'));
```

Change the template root from `<div>` to:

```svelte
<div class="seq-card" class:focus={mode === 'open-focus'}>
```

Then add:

```css
  .seq-card {
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: transparent;
    overflow: hidden;
  }
  .seq-card.focus {
    background: var(--focus-0);
    border-color: var(--focus-line-strong);
    box-shadow: var(--focus-shadow);
  }
```

Remove the comment `<!-- D10: no card border — nesting is carried by indentation, badges and tints. -->`, because the card now has a border.

- [ ] **Step 7: VersionEditPage canvas, depth, and no Blocks card**

In the script:
- Remove `blocksBodyId`, `blocksFolded`, the unfold `$effect` and their comment block, but keep `const uid = $props.id();` if anything else uses it. `grep -n "uid" VersionEditPage.svelte` decides.
- In `toggleCreate`, delete the line `blocksFolded = false;` and its comment line "Opening also unfolds the card…".
- Add, after `const expansion = …`:

```ts
  // Slice-5c D1: how far the focus sits from the page (0 page, 1 block, 2 sequence).
  const depth = $derived(expansion.expandedSequence ? 2 : expansion.expandedBlock ? 1 : 0);
```

In the template, wrap everything inside `{:else}` (from the `{#if loadError}` refresh error through the `<DirtyGuard … />`) in:

```svelte
    <div class="canvas" class:d0={depth === 0} class:d1={depth === 1} class:d2={depth === 2}>
      …existing content…
    </div>
```

Replace the whole `<section class="blocks-card"> … </section>` with its body, without the card head and the `hidden` wrapper:

```svelte
    <section class="blocks" aria-label="Blocks">
      {#if creating}
        …the existing create-block <form> unchanged (T3 replaces it)…
      {/if}
      {#if tree.blocks.length === 0}
        <EmptyState title={v.state === 'created' ? 'No blocks yet' : 'This version has no blocks.'} />
      {:else}
        <ul class="blocks-list">…unchanged…</ul>
      {/if}
    </section>
```

The filled "New block" `IconButton` has gone with the card head. Until T3 lands the inline "+ Add block" row, keep block creation reachable: put the same `IconButton primary glyph="plus" aria-label="New block"` (its existing props) right after `<section class="blocks" …>` opens, inside `<div class="blocks-tools">`. T3 replaces it. Record this as a T1 ruling in the ledger.

Styles:
- Delete `.blocks-card`, `.card-head`, `h2`, `.push`.
- Add:

```css
  .canvas { min-height: 100%; }
  /* R3: the page shade spans the viewport. body:has() needs no JS and ends
     with the page (no .canvas → no rule). */
  :global(body:has(.canvas.d1)) { background: var(--focus-1); }
  :global(body:has(.canvas.d2)) { background: var(--focus-2); }
  .blocks-tools { display: flex; justify-content: flex-end; margin-bottom: 8px; }
```

- [ ] **Step 8: Run the tests and watch them pass**

Run the Step 2 command again.
Expected: PASS for every `Slice-5c T1` test.

Then run the whole suite: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run`.
Expected: all green, except the existing tests that assert the removed Blocks card. Update those to the new markup:
- delete the fold tests;
- change `.blocks-card` queries to `section.blocks`.
List every changed test in the ledger.

- [ ] **Step 9: Check, gate, shots**

1. Run `npx svelte-check --threshold error`. Expected: 0 errors.
2. Run the gate and follow P-gate. Section (w) pins `.blocks-card`, `.card-head` and the fold: remove or update those pins.
3. Run P-shots for three states: version, block 53 open, sequence 72 open. In the overlay, put `probe/constructor-v3.html` state 1 side by side with your screenshots.

- [ ] **Step 10: Review, commit, task-done**

1. Run P-review until both lanes are clean.
2. Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/styles/theme-default.css frontend/src/pages/editor/VersionEditPage.svelte \
  frontend/src/components/editor/AccordionHeader.svelte frontend/src/components/editor/BlockAccordion.svelte \
  frontend/src/components/editor/SequenceAccordion.svelte frontend/src/tests/VersionEditPage.svelte.test.ts \
  frontend/src/tests/BlockAccordion.svelte.test.ts frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts \
  frontend/scripts/visual-refresh-gate.sh
git commit -m "feat(editor): Slice 5c T1 — focus by depth (shades, canvas, no Blocks card)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

3. Run `task-done PLAN 1 BASE -- <tests>`, update memory, and wait for the user's OK.

---

### Task 2: Headers: modes, inline title, delete in the header

**Files:**
- Rewrite: `frontend/src/components/editor/AccordionHeader.svelte` (keep the T1 module script)
- Modify: `frontend/src/components/editor/BlockAccordion.svelte`
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte`
- Test (rewritten): `frontend/src/tests/accordionHeader.svelte.test.ts`; updated: `BlockAccordion.svelte.test.ts`, `SequenceAccordion.interactive.svelte.test.ts`

**Interfaces:**
- Consumes: `HeaderMode` and `mode` from T1.
- Produces: AccordionHeader props:
  - `{ headerId, panelId, level, mode, title, slug, index, expanded, busy, canStructure, canEditTitle, canReorderUp, canReorderDown, deleteBlockedReason: string | null, onToggle, onMoveUp, onMoveDown, onDelete: () => void, onRename: (title: string) => Promise<void> /* throws on failure */ }`.
  - The removed props are `badge`, `structureReason` and `extra`.

- [ ] **Step 1: Write the failing AccordionHeader tests**

Replace `frontend/src/tests/accordionHeader.svelte.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AccordionHeader from '../components/editor/AccordionHeader.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let registry: DirtyRegistry;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  registry = createDirtyRegistry();
  const props = $state({
    headerId: 'h', panelId: 'p', level: 'sequence', mode: 'open-focus', title: 'Linear combinations',
    slug: 'linear-combinations', index: 1, expanded: true, busy: false, canStructure: true, canEditTitle: true,
    canReorderUp: true, canReorderDown: true, deleteBlockedReason: null,
    onToggle: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDelete: vi.fn(),
    onRename: vi.fn(() => Promise.resolve()), ...over,
  });
  cmp = mount(AccordionHeader, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
  flushSync();
  return props;
}
const btn = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const pencil = () => btn('Edit the sequence title');
const input = () => target.querySelector<HTMLInputElement>('input.title-input');
function type(v: string) { const el = input()!; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
function key(k: string) { input()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); flushSync(); }

describe('AccordionHeader — title only, no badge or slug (D5)', () => {
  it('shows the title; no B/S code, no /slug', () => {
    render();
    expect(target.querySelector('.title')!.textContent).toBe('Linear combinations');
    expect(target.querySelector('.code')).toBeNull();
    expect(target.querySelector('.slug')).toBeNull();
    expect(target.textContent).not.toContain('/linear-combinations');
  });
  it('keeps the heading toggle and its ARIA contract', () => {
    render({ level: 'block', title: 'Vectors' });
    const t = target.querySelector<HTMLButtonElement>('#h')!;
    expect(t.parentElement!.tagName).toBe('H3');
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(t.getAttribute('aria-controls')).toBe('p');
  });
});

describe('AccordionHeader — controls per mode (D4, D6)', () => {
  it('open-focus: ✎ ↑ ↓ 🗑 and the chevron', () => {
    render();
    expect(pencil()).not.toBeNull();
    expect(btn('Move sequence up: Linear combinations')).not.toBeNull();
    expect(btn('Move sequence down: Linear combinations')).not.toBeNull();
    expect(btn('Delete sequence Linear combinations')).not.toBeNull();
  });
  it('row-focus: ↑ ↓ only (no ✎, no 🗑)', () => {
    render({ mode: 'row-focus', expanded: false });
    expect(pencil()).toBeNull();
    expect(btn('Delete sequence Linear combinations')).toBeNull();
    expect(btn('Move sequence up: Linear combinations')).not.toBeNull();
  });
  it('row-outside: the title only', () => {
    render({ mode: 'row-outside', expanded: false });
    expect(target.querySelectorAll('.actions button').length).toBe(0);
  });
  it('open-parent: the title and the chevron only', () => {
    render({ mode: 'open-parent' });
    expect(pencil()).toBeNull();
    expect(btn('Move sequence up: Linear combinations')).toBeNull();
    expect(btn('Delete sequence Linear combinations')).toBeNull();
  });
  it('published (canStructure false, canEditTitle true): ✎ only', () => {
    render({ canStructure: false });
    expect(pencil()).not.toBeNull();
    expect(btn('Move sequence up: Linear combinations')).toBeNull();
    expect(btn('Delete sequence Linear combinations')).toBeNull();
  });
  it('archived / disabled (both false): no controls but the chevron', () => {
    render({ canStructure: false, canEditTitle: false });
    expect(pencil()).toBeNull();
    expect([...target.querySelectorAll('.actions button')].every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
  it('a blocked delete stays visible, disabled, with the reason as its title', () => {
    render({ deleteBlockedReason: 'Remove its items first' });
    const t = btn('Delete sequence Linear combinations')!;
    expect(t.disabled).toBe(true);
    expect(t.title).toBe('Remove its items first');
  });
  it('the trash calls onDelete', () => {
    const p = render();
    btn('Delete sequence Linear combinations')!.click();
    expect(p.onDelete).toHaveBeenCalledTimes(1);
  });
  it('boundary arrows stay rendered, disabled with "already first/last"', () => {
    render({ canReorderUp: false, canReorderDown: false });
    expect(btn('Move sequence up: Linear combinations')!.disabled).toBe(true);
    expect(btn('Move sequence up: Linear combinations')!.title).toBe('Move up — already first');
    expect(btn('Move sequence down: Linear combinations')!.title).toBe('Move down — already last');
  });
});

describe('AccordionHeader — inline title (D8)', () => {
  it('✎ turns the title into a focused field holding the title', async () => {
    render();
    pencil()!.click(); await settle();
    expect(input()!.value).toBe('Linear combinations');
    expect(document.activeElement).toBe(input());
  });
  it('Enter saves through onRename with the trimmed title, then closes and refocuses ✎', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('  Combinations  '); key('Enter'); await settle();
    expect(p.onRename).toHaveBeenCalledWith('Combinations');
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(pencil());
  });
  it('Esc cancels without a request', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('X'); key('Escape'); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });
  it('Esc does not bubble (an enclosing modal must not close)', async () => {
    render();
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    pencil()!.click(); await settle();
    key('Escape');
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });
  it('an empty title is refused in place', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('   '); key('Enter'); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(target.querySelector('.err')!.textContent).toBe('Title is required');
  });
  it('an unchanged title closes without a request', async () => {
    const p = render();
    pencil()!.click(); await settle();
    key('Enter'); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });
  it('error keeps the field open with the message and the draft', async () => {
    render({ onRename: vi.fn(() => Promise.reject(new Error('nope'))) });
    pencil()!.click(); await settle();
    type('New'); key('Enter'); await settle();
    expect(input()!.value).toBe('New');
    expect(target.querySelector('.err')!.textContent).toBe('Save failed');
  });
  it('rename is guard-dirty only when the draft differs; discardAll closes it', async () => {
    render();
    pencil()!.click(); await settle();
    expect(registry.isAnyDirty()).toBe(false);
    type('Changed');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll(); flushSync();
    expect(input()).toBeNull();
  });
  it('read-only flip closes the field', async () => {
    const p = render();
    pencil()!.click(); await settle();
    p.canEditTitle = false; flushSync();
    expect(input()).toBeNull();
  });
  it('leaving the focus closes the field', async () => {
    const p = render();
    pencil()!.click(); await settle();
    p.mode = 'open-parent'; flushSync();
    expect(input()).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/accordionHeader.svelte.test.ts`
Expected: FAIL. The props don't exist yet, `.code` and `.slug` still render, and there is no ✎.

- [ ] **Step 3: Rewrite AccordionHeader**

Replace the instance script, template and styles. Keep the T1 `<script module>`.

```svelte
<script lang="ts">
  // Block / sequence header (Slice-5c). What it shows depends on where it sits
  // relative to the focus (D4): a row in the focus container carries ↑ ↓; a
  // row outside it is the title only; the open node that IS the focus carries
  // ✎ ↑ ↓ 🗑 (D6, D8); the open node above the focus shows its title. Version
  // permissions HIDE what the state doesn't allow; a state-blocked control
  // stays visible, disabled, with its reason as the title.
  import { getContext, onDestroy, tick } from 'svelte';
  import { labelFor } from '../../lib/labelFor';
  import { ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import IconButton from '../ui/IconButton.svelte';

  type Props = {
    headerId: string;
    panelId: string;
    level: 'block' | 'sequence';
    mode: HeaderMode;
    title: string | null;
    // Only for the accessible-name fallback; never shown (D5).
    slug: string | null;
    index: number;
    expanded: boolean;
    busy: boolean;
    canStructure: boolean;
    canEditTitle: boolean;
    canReorderUp: boolean;
    canReorderDown: boolean;
    // Non-null: the trash is disabled with this title (children remain, …).
    deleteBlockedReason: string | null;
    onToggle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
    // Resolves on success and THROWS on failure (the parent owns the PATCH).
    onRename: (title: string) => Promise<void>;
  };

  let {
    headerId, panelId, level, mode, title, slug, index, expanded, busy,
    canStructure, canEditTitle, canReorderUp, canReorderDown, deleteBlockedReason,
    onToggle, onMoveUp, onMoveDown, onDelete, onRename,
  }: Props = $props();

  const uid = $props.id();
  const errId = `${uid}-err`;

  const placeholder = $derived(`${level} ${index}`);
  const ariaName = $derived(labelFor(title, slug, placeholder));
  const visibleTitle = $derived(title?.trim() || slug?.trim() || `(${placeholder})`);
  const Level = $derived(level === 'block' ? 'Block' : 'Sequence');

  const showArrows = $derived(canStructure && (mode === 'open-focus' || mode === 'row-focus'));
  const showOwn = $derived(mode === 'open-focus');
  const upTitle = $derived(canReorderUp ? 'Move up' : 'Move up — already first');
  const downTitle = $derived(canReorderDown ? 'Move down' : 'Move down — already last');

  // ---- D8: the inline title ----
  let renaming = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);
  let saving = $state(false);
  let inputEl = $state<HTMLInputElement>();
  let pencilEl = $state<HTMLButtonElement>();
  let alive = true;
  onDestroy(() => { alive = false; });

  function msg(e: unknown): string {
    return e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed';
  }

  async function startRename() {
    if (!canEditTitle || busy || saving) return;
    draft = title ?? '';
    error = null;
    renaming = true;
    await tick();
    if (!alive) return;
    inputEl?.focus();
    inputEl?.select();
  }

  async function cancelRename() {
    renaming = false;
    error = null;
    await tick();
    if (alive) pencilEl?.focus();
  }

  async function commitRename() {
    if (saving) return;
    const next = draft.trim();
    if (next === '') { error = 'Title is required'; return; }
    if (next === (title ?? '').trim()) { await cancelRename(); return; }
    saving = true;
    try {
      await onRename(next);
    } catch (e) {
      saving = false;
      if (!alive || !renaming) { pushToast(msg(e), 'error'); return; }
      error = msg(e);
      await tick();
      if (alive) inputEl?.focus();
      return;
    }
    saving = false;
    if (!alive || !renaming) return;
    await cancelRename();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();          // an enclosing modal must not close
      if (!saving) void cancelRename();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void commitRename();
  }

  // Unsaved registration, as InlineField: optional outside the editor.
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = {
    get isDirty() { return renaming && draft.trim() !== (title ?? '').trim(); },
    discard() { renaming = false; error = null; },
  };
  $effect(() => {
    if (!registry || !renaming) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  // Leaving the focus or losing the permission closes the field (a dirty one
  // was already confirmed by the guard, or the version went read-only).
  $effect(() => {
    if (renaming && !saving && (mode !== 'open-focus' || !canEditTitle)) { renaming = false; error = null; }
  });
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
    <span class="title">{visibleTitle}</span>
  </button>
{/snippet}

<div class="acc-row" class:block={level === 'block'} class:seq={level === 'sequence'} class:renaming>
  {#if renaming}
    <div class="rename">
      <input
        bind:this={inputEl}
        class="title-input"
        value={draft}
        maxlength={200}
        readonly={saving}
        aria-label={`${Level} title`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errId : undefined}
        oninput={(e) => { draft = e.currentTarget.value; error = null; }}
        onkeydown={onKeydown}
      />
      {#if error}<p class="err" role="alert" id={errId}>{error}</p>{/if}
    </div>
    <span class="actions">
      <IconButton size="sm" glyph="check" primary title="Save" aria-label={`Save the ${level} title`} disabled={saving} onclick={() => void commitRename()} />
      <IconButton size="sm" glyph="close" title="Cancel" aria-label={`Cancel editing the ${level} title`} disabled={saving} onclick={() => void cancelRename()} />
    </span>
  {:else}
    {#if level === 'block'}
      <h3 class="hd">{@render toggle()}</h3>
    {:else}
      <h4 class="hd">{@render toggle()}</h4>
    {/if}
    <span class="actions">
      {#if showOwn && canEditTitle}
        <IconButton size="sm" glyph="pencil" title={`Edit the ${level} title`} aria-label={`Edit the ${level} title`}
          disabled={busy} bind:element={pencilEl} onclick={() => void startRename()} />
      {/if}
      {#if showArrows}
        <IconButton size="sm" glyph="up" title={upTitle} aria-label={`Move ${level} up: ${ariaName}`}
          disabled={busy || !canReorderUp} onclick={onMoveUp} />
        <IconButton size="sm" glyph="down" title={downTitle} aria-label={`Move ${level} down: ${ariaName}`}
          disabled={busy || !canReorderDown} onclick={onMoveDown} />
      {/if}
      {#if showOwn && canStructure}
        <IconButton size="sm" glyph="trash" danger title={deleteBlockedReason ?? `Delete this ${level}`}
          aria-label={`Delete ${level} ${ariaName}`} disabled={busy || deleteBlockedReason !== null} onclick={onDelete} />
      {/if}
      {#if mode !== 'row-outside'}
        <!-- D14 (5a): not in the tab order, not announced; mousedown prevented. -->
        <IconButton size="sm" borderless glyph={expanded ? 'chevron' : 'chevron-right'} title={expanded ? 'Collapse' : 'Expand'}
          tabindex={-1} aria-hidden="true" onmousedown={(e) => e.preventDefault()} onclick={onToggle} />
      {/if}
    </span>
  {/if}
</div>

<style>
  .acc-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 6px 12px; }
  .hd { margin: 0; flex: 1 1 auto; min-width: 0; font: inherit; }
  .toggle {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .title { font-size: 14px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .seq .title { font-size: 13.5px; }
  .actions { display: flex; align-items: center; gap: 6px; }
  .rename { flex: 1 1 auto; min-width: 0; }
  .title-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1.5px solid var(--primary);
    border-radius: var(--radius);
    box-shadow: 0 0 0 3px var(--primary-soft);   /* InlineField's open editor */
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
  }
  .err { margin: var(--space-1) 0 0; font-size: 12.5px; color: var(--danger); }
</style>
```

- [ ] **Step 4: Run the AccordionHeader tests**

Run the Step 2 command.
Expected: PASS, every test.

- [ ] **Step 5: Write the failing accordion tests**

In `BlockAccordion.svelte.test.ts`:
- Delete these tests:
  - "the header is an <h3> toggle with the B{index} badge and the slug";
  - "a published version keeps the arrows and the + with the structure reason";
  - "the old in-body \"+ New sequence\" button is gone";
  - "title and info are inline fields…";
  - "a published version keeps the text fields editable (textReason)";
  - "delete footer precedence…";
  - "an info commit PATCHes {info} only".
- Keep the create-sequence and `+` tests until T3, but expand the block before using `+` if they break. T3 replaces them.
- Add:

```ts
describe('BlockAccordion — header (Slice-5c T2)', () => {
  it('open block: ✎ renames with a {title} PATCH, then reloads', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Edit the block title"]')!.click(); await settle();
    const inp = target.querySelector<HTMLInputElement>('input.title-input')!;
    inp.value = 'Vectors 2'; inp.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await settle();
    const patch = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3' && i?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1].body))).toEqual({ title: 'Vectors 2' });
    expect(treeFetchPaths.length).toBeGreaterThan(0);
  });
  it('the body has no Title/Info field rows and no delete footer', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(target.querySelector('#block-3-panel .inline-field')).toBeNull();
    expect(target.querySelector('.del-footer')).toBeNull();
  });
  it('the header trash: disabled "Remove its sequences first" while sequences remain', async () => {
    mountBlock(mkBlock({ sequences: [mkSeq(5)] }));
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    const t = target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Vectors"]')!;
    expect(t.disabled).toBe(true);
    expect(t.title).toBe('Remove its sequences first');
  });
  it('an empty open block: the trash deletes after a confirm (replace, no prompt)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    target.querySelector<HTMLButtonElement>('button[aria-label="Delete block Vectors"]')!.click(); await settle();
    expect(fetchSpy.mock.calls.some(([u, i]) => String(u) === '/api/blocks/3' && i?.method === 'DELETE')).toBe(true);
    expect(currentRoute.path).toBe('/courses/c/edit/v/1');
  });
  it('published: ✎ only — no arrows, no trash', async () => {
    currentEditorVersion.value = { ...currentEditorVersion.value!, version: mkVersion({ state: 'published' }) };
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(target.querySelector('button[aria-label="Edit the block title"]')).not.toBeNull();
    expect(target.querySelector('button[aria-label="Move block up: Vectors"]')).toBeNull();
    expect(target.querySelector('button[aria-label="Delete block Vectors"]')).toBeNull();
  });
  it('archived: no ✎, no arrows, no trash', async () => {
    currentEditorVersion.value = { ...currentEditorVersion.value!, version: mkVersion({ state: 'archived' }) };
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(target.querySelector('button[aria-label="Edit the block title"]')).toBeNull();
    expect(target.querySelector('button[aria-label="Delete block Vectors"]')).toBeNull();
  });
  it('another block open: this one is a title-only row', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/99'); await settle();
    expect(target.querySelector('button[aria-label="Move block up: Vectors"]')).toBeNull();
  });
});
```

The existing delete tests ("delete success: navigates…", "delete success while another block is expanded…", "a late delete after an unmount…") clicked the footer trash. Point them at `button[aria-label="Delete block Vectors"]`. For "another block expanded", the trash is only in the open block's header, so rewrite that test to: expand block 3, start the delete with a deferred DELETE, navigate to block 99, release, and assert reload only with no navigate.

In `SequenceAccordion.interactive.svelte.test.ts`, delete the "header (T5a)" and "delete footer (T5b)" describes and the inline-field tests, and add the sequence equivalents:
- ✎ rename PATCHes `{title}` to `/api/sequences/5`;
- no `.inline-field`, no `.del-footer`, no `h5` "Items";
- the trash is disabled "Remove its items first" with items, and deletes when empty (replace to the block URL, before the reload);
- published shows ✎ only; archived shows nothing;
- with a sibling open, this is a title-only row.

These use the same code shape as the block tests above, with `Delete sequence S 5` and `Edit the sequence title`.

- [ ] **Step 6: Run and watch them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/BlockAccordion.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts`
Expected: FAIL. The accordions still pass `badge`, `structureReason` and `extra` and render the field rows and footers.

- [ ] **Step 7: Wire BlockAccordion**

- Add `const canEditTitle = $derived(perms?.canEditTextFields ?? false);`.
- Rename `patchBlock` to:

```ts
  // D8: the header's inline title. One PATCH, then a guarded reload; a PATCH
  // failure propagates to the header (inline error).
  async function renameBlock(title: string) {
    const savedVid = vid;
    await api.patch(`/api/blocks/${block.id}`, { title });
    if (!stillOnVid(savedVid)) return;
    const result = await loadAdminTree(savedVid, { force: true });
    if (result === 'error') pushToast('Saved (refresh failed — reload to see latest)', 'info');
  }
```

- Replace the `deleteText` derived with:

```ts
  // D6: the header trash's reason while it is blocked.
  const deleteBlockedReason = $derived(
    block.sequences.length > 0 ? 'Remove its sequences first'
      : creating ? 'Cancel the new sequence first'
        : null,
  );
```

- Replace the `<AccordionHeader …>` with:

```svelte
  <AccordionHeader
    {headerId}
    {panelId}
    level="block"
    {mode}
    title={block.title}
    slug={block.slug}
    {index}
    {expanded}
    busy={busy || createBusy || parentBusy}
    {canStructure}
    {canEditTitle}
    canReorderUp={index > 1}
    canReorderDown={index < blockCount}
    {deleteBlockedReason}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
    onDelete={() => void deleteBlock()}
    onRename={renameBlock}
  />
```

- In the body, delete `<div class="fields">…</div>` (both InlineFields) and `<div class="del-footer">…</div>`.
- Delete the now-unused imports and styles: `InlineField`, `textReason` / `txtReason`, `structReason` if unused, `.fields`, `.del-footer`, `.del-text`.
- Keep the `extra`-less `+` path for T3. Until then, the create-sequence form opens from the **"New sequence"** IconButton moved into the body top: `<div class="body-tools">` holding the same `IconButton` that `extra` held, shown only when `mode === 'open-focus' && canStructure`. Delete `onPlus` (it existed to expand a collapsed block first, and collapsed rows no longer carry `+`). `toggleCreate` stays. Record the interim in the ledger.

- [ ] **Step 8: Wire SequenceAccordion**

Same pattern:
- `canEditTitle`;
- `renameSeq(title)`, which PATCHes `/api/sequences/${seq.id}` with the guarded reload through `stillOnVid`, as `patchSeq` does today;
- `deleteBlockedReason = seq.items.length > 0 ? 'Remove its items first' : creating ? 'Cancel the new item first' : null`;
- the header props as above with `level="sequence"`, `onDelete={() => void deleteSeq()}` and `onRename={renameSeq}`;
- delete the InlineField `.fields`, the `<div class="items-head">` `<h5>Items</h5>` block (move its `+` IconButton into `<div class="body-tools">`, shown when `canStructure`; T4 replaces it) and the `.del-footer`;
- remove the unused imports and styles.

- [ ] **Step 9: Run the tests and watch them pass**

1. Run the Step 6 command. Expected: PASS.
2. Run the full suite. Expected: green.
3. Fix any other test that queried `.code`, `.slug` or `.del-footer` in these components (`VersionEditPage.svelte.test.ts` may), and list each one in the ledger.

- [ ] **Step 10: Check, gate, shots, review, commit, task-done**

1. Run `svelte-check`: 0 errors.
2. Run the gate with P-gate. Sections (x) and (y) pin the badge, slug, header strip tints, field rows and delete footers: remove or update those pins.
3. Run P-shots for:
   - v11 block 53 open;
   - v11 sequence 72 open;
   - v11 sequence 72 with the title field open (click ✎ via `agent-browser`);
   - v10 (published) block open, showing ✎ only.
4. Run P-review.
5. Commit the files listed above plus the gate:

```bash
git commit -m "feat(editor): Slice 5c T2 — header modes, inline title, delete in the header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

6. Run task-done, update memory, and wait for the user's OK.

---

### Task 3: Rows and "+ Add …" lines

**Files:**
- Modify: `frontend/src/components/editor/ItemRow.svelte`
- Modify: `frontend/src/components/editor/BlockAccordion.svelte` (inline "+ Add sequence")
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (inline "+ Add block")
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` (ItemRow props)
- Test: `ItemRow.svelte.test.ts`, `BlockAccordion.svelte.test.ts`, `VersionEditPage.svelte.test.ts`, `SequenceAccordion.interactive.svelte.test.ts`

**Interfaces:**
- Produces: ItemRow props `{ item, index, canStructure: boolean, canReorderUp, canReorderDown, busy, onMoveUp, onMoveDown, onOpen, onDelete }`. `structureReason` is removed.
- The add-row markup, shared by convention (not a component, to keep the two create flows independent):
  - collapsed: `<button class="add-line">+ Add sequence</button>`;
  - open: `<form class="add-row">`, holding `<input class="add-input" aria-label="New sequence title">` plus ✓ (`aria-label="Create sequence"`) and ✕ (`aria-label="Cancel new sequence"`).

- [ ] **Step 1: Write the failing tests**

`ItemRow.svelte.test.ts`:
- Delete "title, mono slug (aria-hidden)…", "a structure reason disables ↑ ↓ delete…" and "with no title and no slug…" (the slug half).
- Change every `structureReason: null` in that file's props factory to `canStructure: true`.
- Add:

```ts
describe('ItemRow — Slice-5c T3', () => {
  it('no slug in the row', () => {
    render();                                  // the file's helper
    expect(target.querySelector('.item-slug')).toBeNull();
    expect(target.textContent).not.toContain('/');
  });
  it('canStructure false (published / archived): ✎ only — no ↑ ↓ 🗑', () => {
    render({ canStructure: false });
    const labels = [...target.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([expect.stringMatching(/^Open /)]);
  });
  it('canStructure true: ↑ ↓ ✎ 🗑 in that order', () => {
    render();
    const glyphs = [...target.querySelectorAll('button')].map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['up', 'down', 'pencil', 'trash']);
  });
});
```

In `BlockAccordion.svelte.test.ts`, replace the remaining `+` / create-form tests with:

```ts
describe('BlockAccordion — "+ Add sequence" (Slice-5c T3)', () => {
  const addLine = () => [...target.querySelectorAll<HTMLButtonElement>('button.add-line')].find((b) => b.textContent!.includes('Add sequence'));
  const addInput = () => target.querySelector<HTMLInputElement>('input[aria-label="New sequence title"]');
  it('shown only on the open-focus block of an editable version', async () => {
    mountBlock();
    expect(addLine()).toBeUndefined();                  // collapsed
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    expect(addLine()).toBeDefined();
  });
  it('the line opens a focused title row; Enter creates {title} and reloads', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    addLine()!.click(); await settle();
    expect(document.activeElement).toBe(addInput());
    addInput()!.value = 'Span'; addInput()!.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    addInput()!.form!.requestSubmit(); await settle();
    const post = fetchSpy.mock.calls.find(([u, i]) => String(u) === '/api/blocks/3/sequences' && i?.method === 'POST')!;
    expect(JSON.parse(String(post[1].body))).toEqual({ title: 'Span' });
    expect(addInput()).toBeNull();
  });
  it('Esc closes the row without a request and returns focus to the line', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    addLine()!.click(); await settle();
    addInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
    expect(addInput()).toBeNull();
    expect(document.activeElement).toBe(addLine());
  });
  it('a typed title is guard-dirty; a confirmed discard closes the row', async () => {
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    addLine()!.click(); await settle();
    addInput()!.value = 'x'; addInput()!.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll(); flushSync();
    expect(addInput()).toBeNull();
  });
  it('a server error shows under the row', async () => {
    serve((u, i) => (u === '/api/blocks/3/sequences' && i?.method === 'POST' ? jres({ detail: [{ loc: ['body', 'title'], msg: 'Too long' }] }, 422) : undefined));
    mountBlock();
    await navigate('/courses/c/edit/v/1/blocks/3'); await settle();
    addLine()!.click(); await settle();
    addInput()!.value = 'x'; addInput()!.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    addInput()!.form!.requestSubmit(); await settle();
    expect(target.querySelector('.add-err')!.textContent).toContain('Too long');
  });
});
```

Keep the existing tests "collapse resets the create-sequence form" and "a create failure after the form closed toasts…", re-pointed at the add row.

In `VersionEditPage.svelte.test.ts`, add the same four behaviours for "+ Add block":
- shown only at depth 0 on a created version;
- Enter POSTs `{ title }` only, with **no `info`** (Review Focus 5);
- Esc closes and refocuses the line;
- guard-dirty.

The POST assertion:

```ts
expect(JSON.parse(String(post[1].body))).toEqual({ title: 'Matrices' });   // no info (D7)
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/ItemRow.svelte.test.ts src/tests/BlockAccordion.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts`
Expected: FAIL.

- [ ] **Step 3: ItemRow**

- Props: replace `structureReason: string | null` with `canStructure: boolean`.
- Template: delete the `{#if item.title.trim() && item.slug.trim()} <span class="mono item-slug"…>` block. Wrap the ↑, ↓ and trash `IconButton`s in `{#if canStructure}`, keeping the order ↑ ↓ ✎ 🗑:

```svelte
  <span class="actions">
    {#if canStructure}
      <IconButton size="sm" glyph="up" title={upTitle} aria-label={`Move item up: ${ariaName}`}
        disabled={busy || !canReorderUp} onclick={onMoveUp} />
      <IconButton size="sm" glyph="down" title={downTitle} aria-label={`Move item down: ${ariaName}`}
        disabled={busy || !canReorderDown} onclick={onMoveDown} />
    {/if}
    <!-- id: the item modal's close falls back here (Slice-5b D18). -->
    <IconButton id={`item-${item.id}-open`} size="sm" glyph="pencil" title="Open" aria-label={`Open ${ariaName}`} disabled={busy} onclick={onOpen} />
    {#if canStructure}
      <IconButton size="sm" glyph="trash" danger title="Delete" aria-label={`Delete ${ariaName}`} disabled={busy} onclick={onDelete} />
    {/if}
  </span>
```

- `upTitle` / `downTitle` lose the `structureReason ??` prefix. Delete `.item-slug`.
- Row look on the focus panel, from the mockup:

```css
  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border: 1px solid var(--focus-line);
    border-radius: var(--radius);
    background: var(--surface);
  }
```

Add `gap: 4px` to the parent `.items-list` in SequenceAccordion, so rows read as separate boxes as in the mockup.

- [ ] **Step 4: "+ Add sequence" in BlockAccordion**

- Replace the `body-tools` IconButton and the old `<form class="cr-form">` with the add row. Put it after the sequences list:

```svelte
      {#if mode === 'open-focus' && canStructure}
        {#if creating}
          <form class="add-row" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <div class="add-field">
              <input
                bind:this={titleEl}
                class="add-input"
                placeholder="New sequence title"
                aria-label="New sequence title"
                aria-invalid={createErrors.title || createGlobalError ? 'true' : undefined}
                bind:value={newTitle}
                maxlength={200}
                readonly={createBusy}
                onkeydown={(e) => { if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); void cancelAdd(); } }}
                oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; createGlobalError = null; }}
              />
              {#if createErrors.title || createGlobalError}<p class="add-err" role="alert">{createErrors.title || createGlobalError}</p>{/if}
            </div>
            <IconButton size="sm" glyph="check" primary type="submit" title="Create" aria-label="Create sequence" disabled={createBusy || !newTitle.trim()} />
            <IconButton size="sm" glyph="close" title="Cancel" aria-label="Cancel new sequence" disabled={createBusy} onclick={() => void cancelAdd()} />
          </form>
        {:else}
          <button bind:this={addLineEl} class="add-line" disabled={busy || parentBusy} onclick={() => void toggleCreate()}>+ Add sequence</button>
        {/if}
      {/if}
```

  First check that `IconButton` forwards `type`: `grep -n "type" src/components/ui/IconButton.svelte`. If it doesn't, add a `type?: 'button' | 'submit'` prop defaulting to `'button'`, with a test in `IconButton.svelte.test.ts` that `type="submit"` submits its form.

- In the script, add `let addLineEl = $state<HTMLButtonElement>();` and:

```ts
  async function cancelAdd() {
    if (createBusy) return;
    resetCreate(); creating = false;
    await tick();
    addLineEl?.focus();
  }
```

  `submitCreate` stays. On success it already does `resetCreate(); creating = false;`.

- Styles: delete `.cr-form`, `.cr-form input`, `.cr-actions`, `.field-err` and `.form-err`, then add:

```css
  .add-line {
    align-self: flex-start;
    padding: 4px 2px;
    border: 0;
    background: transparent;
    color: var(--primary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .add-line:disabled { color: var(--muted); cursor: default; }
  .add-row { display: flex; align-items: flex-start; gap: 6px; }
  .add-field { flex: 1 1 auto; min-width: 0; }
  .add-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1.5px solid var(--primary);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .add-err { margin: var(--space-1) 0 0; font-size: 12.5px; color: var(--danger); }
```

- [ ] **Step 5: "+ Add block" in VersionEditPage**

- Same markup with `New block title` / `Create block` / `Cancel new block`.
- Shown when `depth === 0 && perms.canEditStructure`, after the `<ul class="blocks-list">`.
- Remove the T1 interim `blocks-tools` IconButton and its style.
- `submitCreateBlock` posts `{ title: newTitle }`, removing `info: ''` (D7). Add `cancelAdd` the same way.
- The empty-state text stays.

- [ ] **Step 6: SequenceAccordion → ItemRow props**

Pass `canStructure={canStructure}` instead of `structureReason={structReason}`.

- [ ] **Step 7: Run the tests and watch them pass**

1. Run the Step 2 command, then the full suite. Expected: green.
2. Update the remaining old create-form tests to the add row: VersionEditPage's "New block" tests. Ledger every change.

- [ ] **Step 8: Check, gate, shots, review, commit, task-done**

1. Run `svelte-check`: 0 errors.
2. Run the gate with P-gate. Section (z) pins the item slug; (w) and (y) pin the create forms: remove or update them.
3. Run P-shots for:
   - v11 version (the "+ Add block" line);
   - block 53 open with the add row typed into;
   - sequence 72 open (item rows);
   - v10 sequence open (published: ✎ only on items).
4. Run P-review.
5. Commit `"feat(editor): Slice 5c T3 — calm rows and inline + Add lines"`.
6. Run task-done and wait for the user's OK.

---

### Task 4: New item modal and the path context line

**Files:**
- Create: `frontend/src/components/editor/NewItemModal.svelte`
- Modify: `frontend/src/components/editor/ItemTypePicker.svelte` (card grid with a hint line)
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` (remove the create form; "+ Add item" opens the modal)
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte` (`seqIndex` → `blockTitle`, `seqTitle`)
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (pass the titles)
- Modify: `frontend/src/tests/support/ItemEditorModalHarness.svelte` if it passes `seqIndex`
- Modify: `docs/superpowers/specs/2026-10-07-visual-refresh-slice5c-constructor-focus-design.md` (R1: push, not replace)
- Test: create `frontend/src/tests/NewItemModal.svelte.test.ts`; update `SequenceAccordion.interactive.svelte.test.ts`, `ItemEditorModal.svelte.test.ts`, `ItemTypePicker.svelte.test.ts`, `VersionEditPage.svelte.test.ts`

**Interfaces:**
- Produces:
  - `NewItemModal` props: `{ blockTitle: string; seqTitle: string; position: number; onCreate: (body: Record<string, unknown>) => Promise<void> /* throws */; onClose: () => void }`.
  - `ItemEditorModal` props: `seqIndex` is replaced by `blockTitle: string; seqTitle: string`.

- [ ] **Step 1: Write the failing NewItemModal tests**

Create `frontend/src/tests/NewItemModal.svelte.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import NewItemModal from '../components/editor/NewItemModal.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { ApiError } from '../lib/api';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let registry: DirtyRegistry;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); document.documentElement.style.overflow = ''; vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  registry = createDirtyRegistry();
  const props = { blockTitle: 'Vectors', seqTitle: 'Linear combinations', position: 3,
    onCreate: vi.fn(() => Promise.resolve()), onClose: vi.fn(), ...over };
  cmp = mount(NewItemModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const titleIn = () => panel().querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
const radio = (v: string) => panel().querySelector<HTMLInputElement>(`input[type="radio"][value="${v}"]`)!;
const create = () => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === 'Create')!;
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
function pick(v: string) { radio(v).checked = true; radio(v).dispatchEvent(new Event('change', { bubbles: true })); flushSync(); }

describe('NewItemModal (Slice-5c T4, D10)', () => {
  it('header names the path and the position; Title is focused; Page is the default', async () => {
    render(); await settle();
    expect(panel().querySelector('.ctx')!.textContent).toBe('Vectors › Linear combinations · will be item 3 of 3');
    expect(document.activeElement).toBe(titleIn());
    expect(radio('static_page').checked).toBe(true);
  });
  it('Page asks for content (prefilled "# Title"), Video for a URL, Quiz and App for nothing more', () => {
    render();
    type(titleIn(), 'Dot product');
    expect(panel().querySelector<HTMLTextAreaElement>('textarea[aria-label="Content (markdown)"]')!.value).toBe('# Dot product\n');
    pick('video');
    expect(panel().querySelector('input[aria-label="Video URL"]')).not.toBeNull();
    expect(panel().querySelector('textarea')).toBeNull();
    pick('quiz');
    expect(panel().querySelector('input[aria-label="Video URL"]')).toBeNull();
    pick('interactive_app');
    expect(panel().querySelectorAll('input:not([type="radio"]), textarea').length).toBe(1);
  });
  it('Create is disabled until the required fields are filled', () => {
    render();
    pick('video');
    type(titleIn(), 'Clip');
    expect(create().disabled).toBe(true);
    type(panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!, 'https://youtu.be/x');
    expect(create().disabled).toBe(false);
  });
  it('Create sends exactly the body the backend expects per type', async () => {
    const p = render();
    pick('quiz'); type(titleIn(), 'Test me');
    create().click(); await settle();
    expect(p.onCreate).toHaveBeenCalledWith({ title: 'Test me', type: 'quiz' });
  });
  it('Enter in Title submits', async () => {
    const p = render();
    pick('quiz'); type(titleIn(), 'Q');
    titleIn().form!.requestSubmit(); await settle();
    expect(p.onCreate).toHaveBeenCalledTimes(1);
  });
  it('a 422 maps onto the field; the modal stays open', async () => {
    const err = new ApiError(422, [{ loc: ['body', 'title'], msg: 'Too long', type: 'x' }]);
    const p = render({ onCreate: vi.fn(() => Promise.reject(err)) });
    pick('quiz'); type(titleIn(), 'Q');
    create().click(); await settle();
    expect(panel().querySelector('.field-err')!.textContent).toContain('Too long');
    expect(p.onClose).not.toHaveBeenCalled();
  });
  it('close with typed input prompts; Cancel at the prompt keeps it open', () => {
    const p = render();
    type(titleIn(), 'half');
    const c = vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(c).toHaveBeenCalledWith('Discard unsaved changes and continue?');
    expect(p.onClose).not.toHaveBeenCalled();
  });
  it('close with nothing typed closes at once', () => {
    const p = render();
    panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('typed input is guard-dirty; discardAll closes the modal (browser Back)', () => {
    const p = render();
    type(titleIn(), 'half');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('while creating: × and Escape are frozen', async () => {
    let release!: () => void;
    const p = render({ onCreate: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    pick('quiz'); type(titleIn(), 'Q');
    create().click(); await settle();
    expect(panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(true);
    release(); await settle();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
```

`ApiError(status, detail, errorCode?, body?)` is the constructor in `src/lib/api.ts`; `mapCreateError` returns `{ fieldErrors, globalMessage }`.

- [ ] **Step 2: Run and watch them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/NewItemModal.svelte.test.ts`
Expected: FAIL. The component doesn't exist yet.

- [ ] **Step 3: Create NewItemModal**

```svelte
<script lang="ts">
  // "+ Add item" (Slice-5c D10): pick a type, a title and the one field the
  // backend requires at creation (ItemCreate: page → content_md, video →
  // video_url). `onCreate` owns the request, the reload and the navigation
  // into the new item's editor (R1: a push), and THROWS on failure so the
  // errors land on these fields. Not a route: closing asks before dropping
  // typed input; browser Back goes through the page guard (tracker.discard).
  import { getContext, onDestroy } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { pushToast } from '../../stores/toasts.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';

  type ItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app';
  type Props = {
    blockTitle: string;
    seqTitle: string;
    position: number;
    onCreate: (body: Record<string, unknown>) => Promise<void>;
    onClose: () => void;
  };
  let { blockTitle, seqTitle, position, onCreate, onClose }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;

  let type = $state<ItemType>('static_page');
  let title = $state('');
  let contentMd = $state('');
  let contentTouched = $state(false);
  let videoUrl = $state('');
  let errors = $state<FieldErrors>({});
  let globalError = $state<string | null>(null);
  let busy = $state(false);
  let alive = true;
  onDestroy(() => { alive = false; });

  // A page starts as "# <title>" until the author edits the content.
  $effect(() => {
    if (type === 'static_page' && !contentTouched) contentMd = title ? `# ${title}\n` : '';
  });

  const dirty = $derived(
    title.trim() !== ''
      || (type === 'static_page' && contentTouched && contentMd.trim() !== '')
      || (type === 'video' && videoUrl.trim() !== ''),
  );
  const ready = $derived(
    title.trim() !== ''
      && (type !== 'static_page' || contentMd.trim() !== '')
      && (type !== 'video' || videoUrl.trim() !== ''),
  );

  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = {
    get isDirty() { return dirty; },
    discard() { onClose(); },
  };
  $effect(() => {
    if (!registry) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm('Discard unsaved changes and continue?')) return;
    onClose();
  }

  async function submit() {
    if (busy || !ready) return;
    const body: Record<string, unknown> = { title, type };
    if (type === 'static_page') body.content_md = contentMd;
    if (type === 'video') body.video_url = videoUrl;
    errors = {};
    globalError = null;
    busy = true;
    try {
      await onCreate(body);
    } catch (e) {
      const known = type === 'static_page' ? ['title', 'content_md', 'type']
        : type === 'video' ? ['title', 'video_url', 'type'] : ['title', 'type'];
      const mapped = mapCreateError(e, known);
      if (!alive) {
        pushToast(mapped.globalMessage ?? Object.values(mapped.fieldErrors)[0] ?? 'Create failed', 'error');
        return;
      }
      errors = mapped.fieldErrors;
      globalError = mapped.globalMessage ?? (Object.keys(mapped.fieldErrors).length === 0 ? 'Create failed' : null);
    } finally {
      if (alive) busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={labelId} class="nm">New item</h2>
  <span class="ctx">{blockTitle} › {seqTitle} · will be item {position} of {position}</span>
{/snippet}

{#snippet foot()}
  <Button variant="ghost" disabled={busy} onclick={requestClose}>Cancel</Button>
  <Button variant="primary" disabled={!ready || busy} loading={busy} onclick={() => void submit()}>Create</Button>
{/snippet}

<Modal labelledby={labelId} width={640} maxHeight={600} onRequestClose={requestClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="form" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
    <ItemTypePicker bind:value={type} />
    <div class="field-row">
      <span class="field-label">Title</span>
      <div class="field">
        <input class="plain-input" data-autofocus aria-label="Title" maxlength={200} bind:value={title} readonly={busy}
          aria-invalid={errors.title ? 'true' : undefined}
          oninput={() => { if (errors.title) errors = { ...errors, title: '' }; }} />
        {#if errors.title}<small class="field-err">{errors.title}</small>{/if}
      </div>
    </div>
    {#if type === 'static_page'}
      <div class="field-row top">
        <span class="field-label">Content</span>
        <div class="field">
          <textarea class="plain-input mono ta" rows="6" aria-label="Content (markdown)" bind:value={contentMd} readonly={busy}
            aria-invalid={errors.content_md ? 'true' : undefined}
            oninput={() => { contentTouched = true; if (errors.content_md) errors = { ...errors, content_md: '' }; }}></textarea>
          {#if errors.content_md}<small class="field-err">{errors.content_md}</small>{/if}
        </div>
      </div>
    {:else if type === 'video'}
      <div class="field-row">
        <span class="field-label">Video URL</span>
        <div class="field">
          <input class="plain-input" type="url" aria-label="Video URL" placeholder="https://…" bind:value={videoUrl} readonly={busy}
            aria-invalid={errors.video_url ? 'true' : undefined}
            oninput={() => { if (errors.video_url) errors = { ...errors, video_url: '' }; }} />
          {#if errors.video_url}<small class="field-err">{errors.video_url}</small>{/if}
        </div>
      </div>
    {/if}
    {#if globalError}<p class="field-err" role="alert">{globalError}</p>{/if}
  </form>
</Modal>

<style>
  .nm { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .ctx { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .form { display: flex; flex-direction: column; gap: 12px; }
  /* The 5b item-modal field look (ItemEditorModal .field-row / .plain-input). */
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; }
  .field-row.top { align-items: start; }
  .field-row.top .field-label { padding-top: 7px; }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input.ta { height: auto; padding: 8px var(--control-pad-x); line-height: 1.6; resize: vertical; }
  .plain-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
```

- [ ] **Step 4: ItemTypePicker cards**

The picker gets four equal cards, each with a hint line, matching the v3 mockup. In the `TYPES` array, add `hint`: Page "text + math", Video "YouTube / Vimeo", Quiz "questions", Interactive app → label `App`, hint "interactive". Template inside the label: `<ItemMark …/><span class="t">{t.label}</span><small>{t.hint}</small>`. CSS:

```css
  .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  label { flex-direction: column; justify-content: center; text-align: center; gap: 2px; padding: 10px 8px; }
  label small { font-size: 11.5px; color: var(--muted); }
```

Keep the focus-visible, forced-colors and sr-only radio rules. Update `ItemTypePicker.svelte.test.ts`: the label "Interactive app" becomes "App", and add a test that each card shows its hint.

- [ ] **Step 5: Wire SequenceAccordion**

Delete the whole inline create-item machinery:
- the state `newType`, `newTitle`, `newContentMd`, `newVideoUrl`, `createErrors`, `createGlobalError`, `contentMdTouched`, `formEl`;
- the content-prefill effect, `resetCreateForm`, `createTracker` and its effects;
- `toggleCreate`, `submitCreate`;
- the `<form class="cr-form">`, the `body-tools` IconButton and the `.cr-form…` styles.

Keep `creating` (now "the modal is open") and `createBusy` (unused then; delete it, and drop it from the `busy` expressions).

Add:

```ts
  import NewItemModal from './NewItemModal.svelte';

  let addLineEl = $state<HTMLButtonElement>();
  // D10: the modal owns the form; this owns the request, the reload and the
  // navigation into the new item's editor (R1: push, so the item's × is Back).
  async function createItem(body: Record<string, unknown>) {
    const savedVid = vid;
    const check = stillOnVid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);   // throws → modal shows it
    if (check(savedVid)) await loadAdminTree(savedVid, { force: true });
    creating = false;
    if (check(savedVid)) void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
  }
  async function closeNewItem() {
    creating = false;
    await tick();
    addLineEl?.focus();
  }
  // Leaving the sequence or losing structure permission closes the modal.
  $effect(() => { if (creating && (!expanded || !canStructure)) creating = false; });
```

Update `deleteBlockedReason` to `seq.items.length > 0 ? 'Remove its items first' : null`.

In the template, after the items list:

```svelte
      {#if canStructure}
        <button bind:this={addLineEl} class="add-line" disabled={busy || parentBusy} onclick={() => (creating = true)}>+ Add item</button>
      {/if}
      {#if creating}
        <NewItemModal
          blockTitle={block.title}
          seqTitle={seq.title}
          position={seq.items.length + 1}
          onCreate={createItem}
          onClose={() => void closeNewItem()}
        />
      {/if}
```

Copy the `.add-line` CSS from T3's BlockAccordion block into this component.

- [ ] **Step 6: The path context line**

In `ItemEditorModal.svelte`:
- Props: replace `seqIndex: number` with `blockTitle: string; seqTitle: string`, and update the destructuring.
- Head: `<span class="item-ctx">{blockTitle} › {seqTitle} · item {itemIndex} of {itemCount}</span>`. Remove the `mono` class and the `TYPE_WORDS` use (delete `TYPE_WORDS` if unused) (R4).
- CSS: `.item-ctx { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }`.

In VersionEditPage, change the `<ItemEditorModal …>` call: `seqIndex={…}` becomes `blockTitle={hostBlock.title} seqTitle={hostSeq.title}`.

In `ItemEditorModal.svelte.test.ts`, the render helper passes `seqIndex: 2`; change it to `blockTitle: 'Vectors', seqTitle: 'Linear combinations'`. The header test's expectation `'static page · S2 · item 3 of 4'` becomes `'Vectors › Linear combinations · item 3 of 4'`, and drop the `mono` expectation.

- [ ] **Step 7: The page-level behaviour tests**

In `SequenceAccordion.interactive.svelte.test.ts`:
- Replace the create-form tests ("Items is an <h5>…", "the create form keeps its type-specific fields", "creates an interactive_app…", "collapse resets the create form", "a late create-item success…", "a create failure after a collapse…") with:

```ts
describe('SequenceAccordion — "+ Add item" opens the New item modal (Slice-5c T4)', () => {
  const addLine = () => [...target.querySelectorAll<HTMLButtonElement>('button.add-line')].find((b) => b.textContent!.includes('Add item'));
  it('the line opens the modal; Create POSTs, reloads and PUSHES the item URL (R1)', async () => {
    serve((u, i) => (u === '/api/sequences/5/items' && i?.method === 'POST' ? jres({ id: 77 }) : undefined));
    mountSeq(); await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    const before = history.length;
    addLine()!.click(); await settle();
    const panel = document.querySelector<HTMLElement>('section.modal-panel')!;
    const radio = panel.querySelector<HTMLInputElement>('input[value="quiz"]')!;
    radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    const t = panel.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    t.value = 'Test'; t.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    t.form!.requestSubmit(); await settle();
    expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/5/items/77');
    expect(history.length).toBe(before + 1);                 // a push, not a replace
    expect(document.querySelector('section.modal-panel h2')?.textContent).not.toBe('New item');
  });
  it('a late create after a version change neither reloads nor navigates', async () => {
    // Port the old "late create-item success" test: hold the POST, change the
    // version via the stillOnVid stub, release, and assert no navigate / no reload.
  });
  it('published: no "+ Add item"', async () => {
    currentEditorVersion.value = { ...currentEditorVersion.value!, version: mkVersion({ state: 'published' }) };
    mountSeq(); await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    expect(addLine()).toBeUndefined();
  });
  it('closing the modal returns focus to the line', async () => {
    mountSeq(); await navigate('/courses/c/edit/v/1/blocks/3/sequences/5'); await settle();
    addLine()!.click(); await settle();
    document.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click(); await settle();
    expect(document.querySelector('section.modal-panel')).toBeNull();
    expect(document.activeElement).toBe(addLine());
  });
});
```

  Fill in the second test's body by porting the existing "a late create-item success after a version change neither reloads nor navigates" test as it is today: same stub, now driven through the modal. Use whatever names that file uses for its mount helper, `mkVersion` and `serve`.

- In `VersionEditPage.svelte.test.ts`, the existing 5b test "create-item close lands on the pencil" must still pass. Re-point it to drive the New item modal. Then add the R1 end-to-end:

```ts
it('item × after a modal create returns to the sequence (history.back), focus on the new item\'s ✎', async () => {
  // mount at the sequence, + Add item → quiz "T" → Create (POST → id 77) …
  // then click the item modal's × and await waitPop(); settle()
  expect(currentRoute.path).toBe('/courses/c/edit/v/1/blocks/3/sequences/5');
  expect(document.activeElement?.id).toBe('item-77-open');
});
```

  Write it with the file's own helpers and its served tree. The tree served after the create must contain item 77, so extend `served` before the POST resolves.

- [ ] **Step 8: Fix the spec lines (R1)**

In the spec:
- In the "New item modal (D10)" section, "On success: navigate to the new item's route with `replace`, so Back doesn't reopen the New item modal." becomes "On success: navigate (push) to the new item's route. The New item modal is not a route, so Back can't reopen it, and the push lets the item's × return to the sequence (5b D7)."
- In §Testing, "Create posts the right body and replaces the URL with the item route." becomes "Create posts the right body and pushes the item route."

- [ ] **Step 9: Run everything**

1. Run the new and updated test files, then the full suite. Expected: green.
2. Run `svelte-check`: 0 errors.
3. Run the gate with P-gate. Section (ac) pins the mono `.item-ctx`; section (z) pins ItemTypePicker's flex cards: update them. Add the new file `NewItemModal.svelte` to the `FILES_5B`-style lists used by the emoji scan and the literal-colour scan. T6 moves those into (ah); for now append it to the existing (af) and (ag) arrays, and ledger that.

- [ ] **Step 10: Shots, review, commit, task-done**

1. Run P-shots for:
   - sequence 72 with "+ Add item";
   - the New item modal on Page (typed title);
   - the modal on Video;
   - after Create, the item editor with the new context line;
   - after ×, the sequence again.
2. Run P-review.
3. Commit with the new and changed files plus the spec: `"feat(editor): Slice 5c T4 — New item modal, path context line"`.
4. Run task-done and wait for the user's OK.

---

### Task 5: Version settings modal

**Files:**
- Create: `frontend/src/components/editor/VersionSettingsModal.svelte`
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (heading ✎; modal; remove `VersionMetaForm`)
- Delete: `frontend/src/components/editor/VersionMetaForm.svelte`, `frontend/src/tests/VersionMetaForm.label.svelte.test.ts`
- Test: create `frontend/src/tests/VersionSettingsModal.svelte.test.ts`; update `VersionEditPage.svelte.test.ts`

**Interfaces:**
- Produces: `VersionSettingsModal` props `{ vid: number; version: AdminTreeVersion; editable: boolean; stillOnVid: (vid: number) => boolean; onClose: () => void }`.

- [ ] **Step 1: Read what the deleted label test covered**

Read `frontend/src/tests/VersionMetaForm.label.svelte.test.ts` (2 tests) and port its assertions into the new file below. It likely covers stripping whitespace from the label and the label showing in the heading. Ledger what was ported.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/tests/VersionSettingsModal.svelte.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionSettingsModal from '../components/editor/VersionSettingsModal.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', json: () => Promise.resolve(body),
    text: () => Promise.resolve(''), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return { id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: 'Hello', info_html: '<p>Hello</p>',
    max_quiz_attempts: 3, label: 'Draft', created_at: '', published_at: null, archived_at: null, content_updated_at: '', ...over };
}
let target: HTMLDivElement; let cmp: ReturnType<typeof mount> | null = null; let registry: DirtyRegistry;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((u: string, i?: RequestInit) => (String(u).endsWith('/admin-tree')
    ? jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] })
    : i?.method === 'PATCH' ? jres(mkVersion()) : jres({})));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); (globalThis as { fetch: typeof fetch }).fetch = originalFetch; clearToasts(); document.documentElement.style.overflow = ''; vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div'); document.body.appendChild(target);
  registry = createDirtyRegistry();
  const props = { vid: 1, version: mkVersion(), editable: true, stillOnVid: () => true, onClose: vi.fn(), ...over };
  cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const input = (l: string) => panel().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${l}"]`)!;
const footBtn = (t: string) => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === t);
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const patches = () => fetchSpy.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([u, i]) => [String(u), JSON.parse(String(i!.body))]);

describe('VersionSettingsModal (Slice-5c T5, D12)', () => {
  it('editable: Label, Info, Max quiz attempts seeded from the version; Save disabled while clean', () => {
    render();
    expect(input('Label').value).toBe('Draft');
    expect(input('Info (markdown)').value).toBe('Hello');
    expect(input('Max quiz attempts').value).toBe('3');
    expect(footBtn('Save')!.disabled).toBe(true);
  });
  it('settings PATCH carries only changed fields, then reloads, toasts and closes', async () => {
    const p = render();
    type(input('Max quiz attempts'), '5');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([['/api/versions/1', { max_quiz_attempts: 5 }]]);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/admin-tree'))).toBe(true);
    expect(toasts.list.map((t) => t.message)).toContain('Saved');
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('attempts outside 1–10 block Save with the field error', async () => {
    render();
    type(input('Max quiz attempts'), '11');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([]);
    expect(panel().querySelector('.field-err')!.textContent).toBe('Max quiz attempts must be a whole number between 1 and 10');
  });
  it('a failed PATCH keeps the modal open with the message', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? jres({ detail: 'Nope' }, 409) : jres({})));
    const p = render();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(panel().textContent).toContain('Nope');
  });
  it('Discard resets the fields', () => {
    render();
    type(input('Label'), 'L2');
    footBtn('Discard')!.click(); flushSync();
    expect(input('Label').value).toBe('Draft');
  });
  it('close with changes prompts; discardAll (Back) closes', () => {
    const p = render();
    type(input('Label'), 'L2');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(p.onClose).not.toHaveBeenCalled();
    registry.discardAll();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('read-only (published / archived / disabled): values as text, no footer, no inputs', () => {
    render({ editable: false, version: mkVersion({ state: 'published' }) });
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    expect(panel().querySelector('input, textarea')).toBeNull();
    expect(panel().textContent).toContain('Draft');
    expect(panel().textContent).toContain('3');
  });
});
```

In `VersionEditPage.svelte.test.ts`:
- Delete every test that drives the old Version info card (`.meta-card`, "Expand version info", the inline Label / Info / attempts fields). List them in the ledger.
- Add:

```ts
describe('VersionEditPage — version settings (Slice-5c T5)', () => {
  it('the heading ✎ opens the settings modal; the old Version info card is gone', async () => {
    await mountPageAt('/courses/c/edit/v/1');
    expect(document.querySelector('.meta-card')).toBeNull();
    document.querySelector<HTMLButtonElement>('button[aria-label="Version settings"]')!.click(); await settle();
    expect(document.querySelector('section.modal-panel h2')!.textContent).toBe('Version settings');
  });
  it('on a published version the modal opens read-only', async () => {
    // serve a published tree with the file's fixture helper, mount, click ✎
    expect(document.querySelector('section.modal-panel footer.modal-foot')).toBeNull();
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/VersionSettingsModal.svelte.test.ts src/tests/VersionEditPage.svelte.test.ts -t "Slice-5c T5|VersionSettingsModal"`
Expected: FAIL.

- [ ] **Step 4: Create VersionSettingsModal**

```svelte
<script lang="ts">
  // Version settings (Slice-5c D12): Label, Info and Max quiz attempts in the
  // 5b modal frame with one footer Save. Read-only outside "created" (the
  // values as text, no footer). Save sends ONE PATCH with the changed fields
  // (VersionUpdate accepts any subset). R2: Info is a plain textarea.
  import { getContext, onDestroy, untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
    editable: boolean;
    stillOnVid: (vid: number) => boolean;
    onClose: () => void;
  };
  let { vid, version, editable, stillOnVid, onClose }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  // Seeded once per open (the modal mounts per open).
  const initial = untrack(() => ({ label: version.label, info: version.info_md, attempts: String(version.max_quiz_attempts) }));
  let label = $state(initial.label);
  let info = $state(initial.info);
  let attempts = $state(initial.attempts);
  let attemptsError = $state<string | null>(null);
  let globalError = $state<string | null>(null);
  let saving = $state(false);
  let alive = true;
  onDestroy(() => { alive = false; });

  const dirty = $derived(editable && (label !== initial.label || info !== initial.info || attempts !== initial.attempts));

  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  const tracker: RegisteredTracker = { get isDirty() { return dirty; }, discard() { onClose(); } };
  $effect(() => {
    if (!registry) return;
    registry.register(tracker);
    return () => registry.unregister(tracker);
  });

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved changes and continue?')) return;
    onClose();
  }

  function discard() {
    label = initial.label; info = initial.info; attempts = initial.attempts;
    attemptsError = null; globalError = null;
  }

  async function save() {
    if (!dirty || saving) return;
    const n = Number(attempts);
    if (!(attempts.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 10)) {
      attemptsError = 'Max quiz attempts must be a whole number between 1 and 10';
      return;
    }
    const body: Record<string, unknown> = {};
    if (label !== initial.label) body.label = label;
    if (info !== initial.info) body.info_md = info;
    if (attempts !== initial.attempts) body.max_quiz_attempts = n;
    const savedVid = vid;
    globalError = null;
    saving = true;
    try {
      await api.patch(`/api/versions/${savedVid}`, body);
    } catch (e) {
      if (alive) {
        saving = false;
        globalError = e instanceof ApiError ? (e.validationErrors()?.[0]?.msg ?? e.displayMessage) : 'Save failed';
      } else {
        pushToast('Save failed', 'error');
      }
      return;
    }
    if (stillOnVid(savedVid)) {
      const r = await loadAdminTree(savedVid, { force: true });
      pushToast(r === 'error' ? 'Saved (refresh failed — reload to see latest)' : 'Saved', r === 'error' ? 'info' : 'success');
    }
    if (alive) { saving = false; onClose(); }
  }
</script>

{#snippet head()}
  <h2 id={labelId} class="nm">Version settings</h2>
{/snippet}

{#snippet foot()}
  <span class="dirty mono">{dirty ? 'unsaved changes' : ''}</span>
  <Button variant="ghost" disabled={!dirty || saving} onclick={discard}>Discard</Button>
  <Button variant="primary" disabled={!dirty || saving} loading={saving} onclick={() => void save()}>Save</Button>
{/snippet}

<Modal labelledby={labelId} width={640} maxHeight={600} onRequestClose={requestClose} closeDisabled={saving}
  header={head} footer={editable ? foot : undefined}>
  {#if editable}
    <form class="form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <div class="field-row">
        <span class="field-label">Label</span>
        <input class="plain-input" data-autofocus aria-label="Label" maxlength={200} bind:value={label} readonly={saving} />
      </div>
      <div class="field-row top">
        <span class="field-label">Info</span>
        <textarea class="plain-input mono ta" rows="6" aria-label="Info (markdown)" bind:value={info} readonly={saving}></textarea>
      </div>
      <div class="field-row">
        <span class="field-label">Max quiz attempts</span>
        <div class="field">
          <input class="plain-input num mono" type="number" min="1" max="10" step="1" aria-label="Max quiz attempts"
            aria-invalid={attemptsError ? 'true' : undefined} bind:value={attempts} readonly={saving}
            oninput={() => { attemptsError = null; }} />
          {#if attemptsError}<small class="field-err">{attemptsError}</small>{/if}
        </div>
      </div>
      {#if globalError}<p class="field-err" role="alert">{globalError}</p>{/if}
    </form>
  {:else}
    <dl class="ro">
      <dt>Label</dt><dd>{version.label || 'Not set'}</dd>
      <dt>Info</dt><dd class="pre">{version.info_md || 'Not set'}</dd>
      <dt>Max quiz attempts</dt><dd class="mono">{version.max_quiz_attempts}</dd>
    </dl>
  {/if}
</Modal>

<style>
  .nm { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .form { display: flex; flex-direction: column; gap: 12px; }
  .field-row { display: grid; grid-template-columns: 132px 1fr; align-items: center; gap: 12px; }
  .field-row.top { align-items: start; }
  .field-row.top .field-label { padding-top: 7px; }
  .field-label { font-size: 12.5px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .plain-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .plain-input.ta { height: auto; padding: 8px var(--control-pad-x); line-height: 1.6; resize: vertical; }
  .plain-input.num { width: 96px; }
  .plain-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .plain-input[aria-invalid="true"] { border: 1.5px solid var(--danger); }
  .field-err { margin: 0; font-size: 12px; color: var(--danger); }
  .dirty { margin-right: auto; font-size: 12px; color: var(--muted); }
  .ro { display: grid; grid-template-columns: 132px 1fr; gap: 10px 12px; margin: 0; }
  .ro dt { font-size: 12.5px; color: var(--muted); }
  .ro dd { margin: 0; font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
  .ro .pre { white-space: pre-wrap; }
</style>
```

  If `bind:value` on `type=number` yields a number (Svelte does coerce), keep `attempts` as `string | number` and compare with `String(attempts)`. Simpler: drop `bind:` and use `value={attempts} oninput={(e) => { attempts = e.currentTarget.value; attemptsError = null; }}`, as InlineField does, so the draft stays a string. Use that form for the attempts input.

- [ ] **Step 5: Wire VersionEditPage**

- Delete the `VersionMetaForm` import and `<VersionMetaForm {vid} version={v} />`.
- Import `VersionSettingsModal`.
- Add `let settingsOpen = $state(false);` and `let settingsBtn = $state<HTMLButtonElement>();`.
- In `.editor-heading`, after `<VersionBadges …/>`:

```svelte
      <span class="head-push">
        <IconButton size="sm" glyph="pencil" title="Version settings" aria-label="Version settings"
          bind:element={settingsBtn} onclick={() => (settingsOpen = true)} />
      </span>
```

- Before `<DirtyGuard>`:

```svelte
    {#if settingsOpen}
      <VersionSettingsModal {vid} version={v} editable={perms.canEditVersionMeta} {stillOnVid}
        onClose={() => { settingsOpen = false; void tick().then(() => settingsBtn?.focus()); }} />
    {/if}
```

- Add `.head-push { margin-left: auto; display: flex; }` to the styles.
- Close the modal on a version change: `$effect(() => { void vid; untrack(() => { settingsOpen = false; }); });`. Declare it after the load effect, and record its position in the ledger. The effect-order discipline lives in that file's comments, so keep this one last.

- [ ] **Step 5b: Fix the spec line (R2)**

In the spec's "Version settings modal (D12)" fields list, "Info (MarkdownEditor, plain; no asset sidebar needed);" becomes "Info (a plain monospace textarea; R2 of the plan);". Add the spec to this task's commit.

- [ ] **Step 6: Delete the old component**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git rm frontend/src/components/editor/VersionMetaForm.svelte frontend/src/tests/VersionMetaForm.label.svelte.test.ts
grep -rn "VersionMetaForm" frontend/src frontend/scripts
```

Expected: no remaining references, apart from gate section (v), which P-gate handles.

- [ ] **Step 7: Run everything**

1. Run the tests (new and full suite), `svelte-check`, and the gate with P-gate. Section (v) pins the Version info card: remove those pins. Keep (v)'s InlineField pins only while InlineField still exists, and check whether anything still uses it: `grep -rn "InlineField" frontend/src --include=*.svelte`.
2. If nothing uses InlineField any more, ask the user before deleting it. It's a shared UI component that Slice 6 may reuse. Ledger the answer.

- [ ] **Step 8: Shots, review, commit, task-done**

1. Run P-shots for:
   - the heading with ✎;
   - the settings modal, editable (v11);
   - the modal read-only (v10);
   - an attempts error.
2. Run P-review.
3. Commit `"feat(editor): Slice 5c T5 — version settings modal"`, which includes the `git rm`s.
4. Run task-done and wait for the user's OK.

---

### Task 6: Block info off every screen, gate (ah), close-out

**Files:**
- Modify: `frontend/src/components/course/BlockGroup.svelte`
- Modify: `frontend/src/tests/BlockGroup.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section k-info; new section (ah); `EXPECTED_CHECKS`)
- Create: `docs/backlog/slice5c-constructor-polish-debt.md` if T1–T5 haven't already
- Modify: `docs/backlog/slice5b-authoring-polish-debt.md` (close the 5b items 5c resolved)

- [ ] **Step 1: Write the failing tests**

In `BlockGroup.svelte.test.ts`:
- Replace "renders .info only when block.info_html is non-empty" with:

```ts
it('never renders block info, even when info_html is set (Slice-5c D7)', () => {
  render({ block: { ...BASE_BLOCK, info_html: '<p>x</p>' } });   // the file's helper
  expect(target.querySelector('.info')).toBeNull();
  expect(target.textContent).not.toContain('x');
});
```

- Update the test at :227–233, which asserts `.info` IS present when set, to assert it is absent. Keep the remaining layout assertions.

- [ ] **Step 2: Run and watch it fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/BlockGroup.svelte.test.ts`
Expected: FAIL. `.info` renders.

- [ ] **Step 3: Remove it**

In `BlockGroup.svelte`:
- delete `{#if block.info_html}<div class="info">{@html block.info_html}</div>{/if}`;
- rewrite the comment above the panel to "The panel and ITS CONTENTS are always rendered; only `hidden` gates visibility (keeps `aria-controls` valid when collapsed). Block info is not shown (Slice-5c D7; the data stays).";
- delete the `.info` rule.

Then confirm nothing else renders block info:
`grep -rn "info_html\|block.info" frontend/src --include=*.svelte | grep -v tests`
Expected: only `CourseView.svelte`'s *version* `info_html`.

- [ ] **Step 4: Run the tests**

Run the full suite. Expected: green.

- [ ] **Step 5: Gate section (ah) and clean-up**

1. Run the gate and apply P-gate to section (k): remove the AST pin `"#if:", "div:info[class=\"info\"]", "@html:block.info_html"` and the `.info` CSS pin.
2. Then add section (ah) before the final summary. It is the "lighter gate" of the spec, run over every 5c-touched component:

```zsh
echo
echo "--- (ah) Slice-5c — focus tokens, no literal colours, no emoji in 5c files ---"
FILES_5C=(
  src/pages/editor/VersionEditPage.svelte src/components/editor/AccordionHeader.svelte
  src/components/editor/BlockAccordion.svelte src/components/editor/SequenceAccordion.svelte
  src/components/editor/ItemRow.svelte src/components/editor/ItemTypePicker.svelte
  src/components/editor/NewItemModal.svelte src/components/editor/VersionSettingsModal.svelte
  src/components/editor/ItemEditorModal.svelte src/components/course/BlockGroup.svelte
)
emoji_scan "all Slice-5c files" $FILES_5C
chk "the --focus-0/1/2 tokens are defined in the theme" \
  "$(grep -cE '^\s*--focus-(0|1|2):' src/styles/theme-default.css)" "3"
chk "the canvas shades the body only through the tokens (R3; T1 ruling: scoped :has)" \
  "$(grep -cE ':global\(body\):has\(\.canvas\.d[12]\)\s*\{\s*background:\s*var\(--focus-[12]\)' src/pages/editor/VersionEditPage.svelte)" "2"
chk "focus panels use --focus-0 + --focus-line-strong" \
  "$(grep -c 'var(--focus-line-strong)' src/components/editor/BlockAccordion.svelte src/components/editor/SequenceAccordion.svelte | awk -F: '{s+=$2} END {print s}')" "2"
none "no slug or code badge in the constructor rows" '\.(slug|code|item-slug)\b' \
  src/components/editor/AccordionHeader.svelte src/components/editor/ItemRow.svelte
```

   Use the gate's real helper signatures. Read `chk`, `none` and `emoji_scan` at the top of the script and adapt the calls to them exactly. If `chk` takes `label actual expected` in another order, follow the script.
3. For the literal-colour rule: refactor the (ag) python heredoc into a function `colour_scan LABEL FILES…`, so (ag) calls it with `$FILES_5B` and (ah) calls it with `$FILES_5C`. The scanner text doesn't change. The (ag) `ALLOWED` table stays keyed to `Modal.svelte`.
4. Mutation-check each new (ah) check once: break the thing, watch FAIL, restore. Record each in the ledger.
5. Set `EXPECTED_CHECKS` to the new total.

- [ ] **Step 6: Backlogs**

- In `docs/backlog/slice5b-authoring-polish-debt.md`, mark as resolved by 5c: the label-baseline and Version-info-card items, plus anything else 5c removed. Search for `VersionMetaForm`, `del-footer`, `.slug`, `Info (markdown)`, `badge`.
- Ensure `docs/backlog/slice5c-constructor-polish-debt.md` exists with T1–T6's deferred minors.

- [ ] **Step 7: Full verification, shots, review, commit, task-done**

1. Run the tests, `svelte-check` (0 errors) and the gate (ALL PASS).
2. Run P-shots for:
   - the student course view of demo-course (`/courses/demo-course`), with blocks and no info strip;
   - one full pass over the constructor at each depth.
3. Run P-review.
4. Commit `"chore(editor): Slice 5c T6 — block info off every screen, gate (ah)"`.
5. Run task-done and wait for the user's OK.

---

## After Task 6

1. **Whole-branch review** (`736bbd4..HEAD`, which covers 5b and 5c together, because they ship together). Two fresh lanes, Opus and Fable, get the 5b and 5c Review Focus lists verbatim and both ledgers' rulings. Fix every Critical and Important finding with TDD and re-review.
2. **Browser pass in Safari with the user**, step by step, over every item type and version state. It includes the carried 5b checks:
   - the 5a Back freeze;
   - the mouse-Save / ⌘S focus;
   - the T5b footer-Discard vs × prompt;
   - the label baseline;
   - the quiz key move.

   The user also decides the open 5b T6 resync-baseline question.
3. **No merge, no push**, unless the user asks.
