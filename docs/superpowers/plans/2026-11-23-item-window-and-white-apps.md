# Larger item window and apps on white — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The item editor window is 1120 × 820 px for every item type, the app and video previews are 16:9 of their width, and every app renders on white.

**Architecture:** Three small frontend changes: ItemEditorModal passes a larger size to Modal; InteractiveFrame and VideoFrame swap their fixed `height` prop for `fill`, used by the 16:9 preview areas in AppBody and VideoBody; InteractiveFrame's `<iframe>` is white behind the app (review r1). The visual-refresh gate's pins follow.

**Tech Stack:** Svelte 5 (runes) + TypeScript, vitest + jsdom (mount/unmount/flushSync), zsh gate script.

**Spec:** `docs/superpowers/specs/2026-11-23-item-window-and-white-apps-design.md`

## Global Constraints

- Item window: `width={1120}`, `maxHeight={820}`; Modal's screen caps (`100vw - 32px`, `100vh - 52px`) stay.
- App preview: `aspect-ratio: 16 / 9`, frame fills it; the student frame keeps its 600 px default.
- White: `background: #fff` on InteractiveFrame's `<iframe>`; the app document sets no background (review r1).
- No new dependencies; tests use mount/unmount/flushSync from svelte; one-line code comments.
- Branch `feat/olx-import`; commit only on the owner's OK; never stage `logo.png` / `favicon.svg`.

## Review Focus

1. An app that sets its own page background keeps it: the white is on the host `<iframe>`, and the app document sets no background (review r1).
2. A laptop screen smaller than 1120 × 820 (e.g. 1280 × 720): the window shrinks to the screen, the body scrolls, the header and footer stay visible.
3. Page, video and quiz editors in the wider window: nothing stretches oddly (the video preview follows 16:9, owner's call after the browser check).
4. The student view is unchanged: the app frame is still 600 px, and the video frame is still 16:9.
5. While the app loads, the placeholder already has the 16:9 shape, so the window doesn't jump when the app appears.

---

### Task 1: Larger item window, 16:9 app preview, white app page

**Files:**
- Modify: `frontend/src/components/editor/ItemEditorModal.svelte:450` (the `<Modal` call)
- Modify: `frontend/src/components/items/InteractiveFrame.svelte` (props + `.frame.fill`)
- Modify: `frontend/src/components/editor/item/AppBody.svelte:273,284,336`
- Modify: `frontend/src/lib/interactiveHost.ts:28`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (the `.preview-area` pin near line 4406; the R3 frame block after it)
- Test: `frontend/src/tests/ItemEditorModal.svelte.test.ts`, `InteractiveFrame.svelte.test.ts`, `AppBody` tests (wherever AppBody's preview is asserted today; find with `grep -ln "preview-area\|height={360}" src/tests`), `interactiveHost.test.ts`

**Interfaces:**
- Produces: `InteractiveFrame` props `{ scriptSource: string; title: string; fill?: boolean }` and `VideoFrame` props `{ src: string; title: string; fill?: boolean }`. `fill` makes the frame take its parent's height with no bottom margin; `height` is gone (no callers).

- [ ] **Step 1: Write the failing tests**
  - `interactiveHost.test.ts` › "the app document sets no background of its own…": `buildAppSrcdoc('x')` contains no `background` (superseded in review r1: the white is pinned by the gate on `.frame iframe`).
  - `InteractiveFrame.svelte.test.ts` › "fill makes the frame take its parent's height": with `fill: true`, `.frame` has class `fill` and no `--frame-h` style. Without it, there is no `fill` class.
  - The AppBody preview test › "the preview is a 16:9 area the app frame fills": a ready app renders `.preview-area .frame.fill`. The loading state renders `.preview-area[aria-busy="true"]`.
  - `ItemEditorModal.svelte.test.ts` › "the item window is 1120 × 820 for every item type": for a page, a video and an app item, the Modal element carrying `--modal-w` has `1120px`, and `--modal-h` has `820px`.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/interactiveHost.test.ts src/tests/InteractiveFrame.svelte.test.ts src/tests/ItemEditorModal.svelte.test.ts <AppBody test file>`
  Expected: the 4 new tests FAIL on their assertions (`920px`, no `fill` class, a `background` in the srcdoc; the gate's iframe pin fails); all other tests pass.

- [ ] **Step 3: Implement**
  - ItemEditorModal: add `width={1120}` and `maxHeight={820}` to `<Modal`.
  - InteractiveFrame: add the `fill` prop, `class:fill`, `.frame.fill { height: 100%; margin-bottom: 0; }`. Update the D14 comment line to mention `fill`.
  - AppBody: `<InteractiveFrame … fill />` in place of `height={360}`. Change `.preview-area` to `aspect-ratio: 16 / 9;` and keep `background: var(--surface-2)`.
  - InteractiveFrame: `background: #fff` on `.frame iframe`, with a gate ALLOWED entry and pin (superseded in review r1: no longer in the srcdoc).

- [ ] **Step 4: Run the same tests and see them pass**
  Expected: all PASS, exit 0, no "Errors"/"Unhandled" line.

- [ ] **Step 5: Update the gate**
  - Change `d '\.preview-area' '' 'height:360px' …` to `'aspect-ratio:16/9'` (with the background kept).
  - In the R3 block, add `N=InteractiveFrame; chk "\.frame\.fill\.${IFH[1]}" 'height:100%' 'margin-bottom:0'`. The 600 px default anchor stays as it is (Review Focus 4).
  Run: `zsh frontend/scripts/visual-refresh-gate.sh | tail -2`. Expected: `ALL PASS`, with the check count up by the new pins.

- [ ] **Step 6: Full checks**
  Run: `cd frontend && TZ=Europe/Copenhagen npm test`, `npm run check`, and the gate, logging to the workspace.
  Expected: exit 0; no Errors/Unhandled; check 0 errors (11 old warnings); gate ALL PASS.

- [ ] **Step 7: Browser check (agent-browser, Chrome, 1512 px, signed in on :5180)**
  Use draft v24:
  - **App item 429:** the app is fully visible, the preview is about 16:9 and the app background is white.
  - **A page item and a video item:** the layout is sensible in the wider window.
  - **At 1280 × 720:** the window fits the screen and the body scrolls (Review Focus 2).
  - **Student preview of an app:** still 600 px, white.
  Take screenshots in `probe/`, look at them, and record what I saw.

- [ ] **Step 8: Review loop, then commit on the owner's OK**
  Opus + Fable on the uncommitted diff until both are clean on the same state, then Codex (high). Ask the owner for the OK, then make two commits:
  1. `docs: item window and white apps design + plan` (spec + this plan);
  2. `feat(editor): larger item window; apps at 16:9 on white` (code, tests, gate).
