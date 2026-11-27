# Item Name Opens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Clicking an item's name in the course editor opens its editor, like the pencil.

**Architecture:** A click handler on the existing `.item-title` span in `ItemRow.svelte` calls
`onOpen` unless `busy`; CSS gives it a pointer cursor. No new Tab stop, no role.

**Tech Stack:** Svelte 5, Vitest (mount/unmount/flushSync).

**Spec:** `docs/superpowers/specs/2026-11-27-item-name-opens-design.md`

## Global Constraints

- No new dependencies; one-line comments; the pencil, arrows and delete are unchanged.

## Review Focus

1. A click on the name while busy must not open the editor (test in Task 1).
2. The name must not become focusable or gain a role (test in Task 1).
3. A published version (canStructure false) still opens from the name (test in Task 1).

---

### Task 1: The name opens the item

**Files:**
- Modify: `frontend/src/components/editor/ItemRow.svelte`
- Test: `frontend/src/tests/ItemRow.svelte.test.ts` (new `describe('ItemRow — the name opens the item')`)

- [ ] **Step 1: Write the failing tests:** `clicking the name calls onOpen once`; `clicking the name
  while busy does nothing`; `in a published version the name still opens` (canStructure false);
  `the name is not focusable and has no role` (no `tabindex`, no `role`, still a `SPAN`).
- [ ] **Step 2: Run** `cd frontend && npm test -- src/tests/ItemRow.svelte.test.ts`. Expected: the
  click tests FAIL.
- [ ] **Step 3: Implement:** `onclick` on `.item-title` → `if (!busy) onOpen()`, with the svelte-ignore
  for the click-without-key warnings (the pencil is the keyboard path); `.item-title { cursor:
  pointer }`, default cursor while busy.
- [ ] **Step 4: Run** the test file, `SequenceAccordion.interactive.svelte.test.ts`, the full
  `npm test`, `npm run check`. Expected: all PASS, 0 errors.
- [ ] **Step 5: Browser check** (agent-browser, servers on 127.0.0.1): clicking a name opens the
  editor; Esc returns focus as before; a Safari-only step to the owner.
- [ ] **Step 6: Commit** (after Opus + Fable are clean and the owner's OK).
