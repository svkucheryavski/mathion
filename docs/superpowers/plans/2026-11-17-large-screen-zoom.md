# Large-Screen Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On screens at least 1400 CSS px wide, the whole Mathion web app shows at 115%, with window-sized boxes and the two fixed tooltips still correct.

**Architecture:** A `--app-zoom` token (1, or 1.15 under `@media screen and (min-width: 1400px)`) drives `html { zoom }`. Every viewport-relative length divides by it. A small `lib/tipSpace.ts` helper converts rects and the viewport into the tooltips' own layout space; both tooltips use it.

**Tech Stack:** Svelte 5 (runes), Vite, vitest + jsdom, the zsh visual-refresh gate (`frontend/scripts/visual-refresh-gate.sh`), agent-browser (Chrome) for acceptance.

**Spec:** `docs/superpowers/specs/2026-11-17-large-screen-zoom-design.md` (rev 4, approved `3aed7d2`).

## Global Constraints

- Threshold `@media screen and (min-width: 1400px)`; factor `1.15`; token name `--app-zoom` (default `1`).
- `zoom` sits on `html`; `screen` only (print unaffected).
- No new JS/CSS dependencies; Svelte 5 only.
- Component tests use `mount`/`unmount`/`flushSync` from svelte, never @testing-library.
- Code comments: one short plain line.
- Supported browsers: current Chrome/Edge, current Firefox, Safari 26.4+.
- Gate: run with `zsh frontend/scripts/visual-refresh-gate.sh`; every global-rule hash or order change gets a dated "the ONLY change" note like the existing ones.
- Vitest green = exit 0 and no "Errors"/"Unhandled" line.
- `$WS` is this plan's workspace, `.superpowers/sdd/2026-11-17-large-screen-zoom/` (git-ignored); logs and the ledger go there.

## Review Focus

1. A keyboard-focused Progress header keeps its tip while the table scrolls (`restoreTip` → `placeTip` on every scroll event): the tip stays on its header at 1.15, and the probe is measured once, not per event. Pinned in Task 2 Step 1 (`rectScale` cache test, and the component test that places twice and counts probes).
2. A header partly scrolled under the pinned columns or past the scroll box's right edge, at 1.15: the tip is clipped to the visible part exactly as at 100%. Pinned in Task 2 Step 1 (right-half clipped case in both engine models).
3. The user's browser zoom switches the app zoom off (`--app-zoom` back to 1): tooltips use the 100% path unchanged. Pinned in Task 2 Step 1 (appZoom 1 → no probe, raw innerWidth), Task 3 check 9, and a real Cmd+ step in the owner's passes.
4. Printing a page from a 1512px window: no 115% on paper. Pinned in Task 1 Step 1 (gate pins the token rule inside `@media screen and (min-width: 1400px)`), checked in the owner's Safari pass.
5. Resizing a window across 1400px with a modal or the drawer open: the box re-sizes and its buttons stay reachable. Pinned in Task 3 check 4.

---

### Task 1: The zoom token, the root rule and the viewport lengths

**Files:**
- Modify: `frontend/src/styles/theme-default.css` (`:root`, next to `--page-max` at ~:115; new media rule right after the `:root` block)
- Modify: `frontend/src/styles/base.css` (new first rule)
- Modify: `frontend/src/App.svelte:100-101`
- Modify: `frontend/src/components/ui/Modal.svelte:230, 231, 248, 249`
- Modify: `frontend/src/components/runs/RunProgressTab.svelte:618`
- Modify: `frontend/src/pages/superuser/SuperuserUsers.svelte:412`
- Modify (test): `frontend/scripts/visual-refresh-gate.sh` (pins at :4290, :4967, :5375, :6157, :6189; global-rule freeze `WANT_FULL` :545 and `WANT_ORDER` :597; pinned-token definer guard ~:748-781; `EXPECTED_CHECKS` :90)

**Interfaces:**
- Produces: CSS custom property `--app-zoom` on `:root` (computed value `1` or `1.15`), read by Task 2's `appZoom()`.

- [ ] **Step 1: Change the gate first (RED)**

  In `visual-refresh-gate.sh`:
  The bundle keeps spaces around `/` in `calc()` and after `:` in media features and custom properties, so the regexes allow them (` ?/ ?`, `: ?`):
  - :4290 `.modal-panel`: `width:min\(var\(--modal-w\),calc\(100vw ?/ ?var\(--app-zoom\)\) - 32px\)` and `max-height:min\(var\(--modal-h\),calc\(100vh ?/ ?var\(--app-zoom\)\) - 52px\)`.
  - :5375 `.modal-panel.right`: width `min\(var\(--modal-w\),calc\(100vw ?/ ?var\(--app-zoom\)\)\)`; the `'height:100dvh'` pin becomes `'height:calc\(100vh ?/ ?var\(--app-zoom\)\)' 'height:calc\(100dvh ?/ ?var\(--app-zoom\)\)'` (spec rev 5).
  - :6157 `.shell`: `min-height:calc\(100vh ?/ ?var\(--app-zoom\)\)` and `min-height:calc\(100dvh ?/ ?var\(--app-zoom\)\)`.
  - :4967 `.pg-tip` and :6189 `.u-tip`: `max-width:min\(320px,calc\(100vw ?/ ?var\(--app-zoom\) - 16px\)\)` (new on `.u-tip`).
  - New checks next to the global-rule freeze: `check "app zoom token on wide screens" "@media screen and \(min-width: ?1400px\)\{:root\{--app-zoom: ?1\.15;?\}\}"` and `check "html carries the app zoom" "html\{zoom: ?var\(--app-zoom\);?\}"`. These two built-CSS pins are the spec's "stylesheet test"; jsdom gets no component CSS, so a vitest case could not see them.
  - Definer guard (~:748-781): `html { zoom: var(--app-zoom) }` makes `--app-zoom` a pinned token, and the guard allows a pinned token only on the one bare `:root`. Take `--app-zoom` out of `TOKENS` there and add one check of its own: `--app-zoom` is declared in exactly two rules, bare `:root` and `:root` under `@media screen and (min-width: 1400px)`, and nowhere else (no `@property`, inline style or `setProperty`, matched the same way the guard matches them). Every other token keeps the single-`:root` rule.
  - `EXPECTED_CHECKS` 3101 → 3106 (+1 `.u-tip`, +2 global checks, +1 `--app-zoom` definer check, +1 second drawer height pin). Any other count after Step 3 is a finding, not a number to copy.
  - After Step 3, confirm the spellings with `grep -oE 'calc\([^)]*app-zoom[^)]*\)|min-width: ?1400px\)\{[^}]*\}' frontend/dist/_app/*.css`.

- [ ] **Step 2: Run the gate to see it fail**

  Run: `zsh frontend/scripts/visual-refresh-gate.sh > $WS/gate-t1-red.log 2>&1; grep -c '^FAIL' $WS/gate-t1-red.log`
  Expected: the new and changed pins FAIL; nothing else does.

- [ ] **Step 3: Write the CSS**

  - `theme-default.css` `:root`: `--app-zoom: 1;` with a one-line comment; after the block: `@media screen and (min-width: 1400px) { :root { --app-zoom: 1.15; } }`.
  - `base.css` first rule: `html { zoom: var(--app-zoom); }`.
  - `App.svelte` `.shell`: `min-height: calc(100vh / var(--app-zoom)); min-height: calc(100dvh / var(--app-zoom));`.
  - `Modal.svelte`: `.modal-panel` width `min(var(--modal-w), calc(100vw / var(--app-zoom)) - 32px)`, max-height `min(var(--modal-h), calc(100vh / var(--app-zoom)) - 52px)`; `.modal-panel.right` width `min(var(--modal-w), calc(100vw / var(--app-zoom)))`, height `calc(100vh / var(--app-zoom))` then `calc(100dvh / var(--app-zoom))` (spec rev 5: FocusTrap's wrapper div, not the panel, is the backdrop's flex item).
  - `.pg-tip` and `.u-tip` max-width `min(320px, calc(100vw / var(--app-zoom) - 16px))`.

- [ ] **Step 4: Update the global-rule freeze**

  The freeze checks order first and stops at the first divergence, so it takes two runs:
  1. Fix `WANT_ORDER` (:597): the sequence becomes `:root`, the media `:root`, `html`, `body` (`html` is base.css's new first rule). Re-run.
  2. Copy the reported hashes into `WANT_FULL` (:545, sorted): `('', 'html', <hash>)` between `h4` and `html,body`; the media `:root` entry last, after the two forced-colors entries; `:root`'s hash updated.
  3. The comment at :591-593: "56" → "58", and the second `a` moves from #13 to #15.
  4. The dated note, one line: "# Zoom T1 (2026-11-17): <old> -> <new>, +--app-zoom 1 only; +2 rules (56 -> 58)."

- [ ] **Step 5: Gate, tests and type check pass**

  Run: `zsh frontend/scripts/visual-refresh-gate.sh > $WS/gate-t1.log 2>&1; echo $?; grep -c '^FAIL' $WS/gate-t1.log`
  Expected: exit 0, 0 FAIL, "3106 checks".
  Run: `cd frontend && npm test > $WS/fe-t1.log 2>&1; echo $?; grep -E 'Tests |Errors|Unhandled' $WS/fe-t1.log` and `npm run check`
  Expected: exit 0, all pass, no Errors/Unhandled; svelte-check 0 errors.

- [ ] **Step 6: Commit** (after the review lanes are clean and the owner says OK)

  ```bash
  git add frontend/src/styles/theme-default.css frontend/src/styles/base.css frontend/src/App.svelte frontend/src/components/ui/Modal.svelte frontend/src/components/runs/RunProgressTab.svelte frontend/src/pages/superuser/SuperuserUsers.svelte frontend/scripts/visual-refresh-gate.sh docs/superpowers/plans/2026-11-17-large-screen-zoom.md docs/superpowers/specs/2026-11-17-large-screen-zoom-design.md
  git commit -m "feat(ui): 115% zoom on windows 1400px and wider"
  ```

---

### Task 2: Tooltip placement in the zoomed space

**Files:**
- Create: `frontend/src/lib/tipSpace.ts`
- Create (test): `frontend/src/tests/tipSpace.test.ts`, `frontend/src/tests/support/zoomStubs.ts` (the shared stubs: `rect`, `stubZoom`)
- Modify: `frontend/src/components/runs/RunProgressTab.svelte:245-258` (`placeTip`)
- Modify: `frontend/src/pages/superuser/SuperuserUsers.svelte:183-189` (`placeTip`)
- Modify (test): `frontend/src/tests/RunProgressTab.svelte.test.ts` (tooltip describe, ~:926-965), `frontend/src/tests/SuperuserUsers.svelte.test.ts` (~:549)

**Interfaces:**
- Consumes: `--app-zoom` (Task 1).
- Produces (`frontend/src/lib/tipSpace.ts`):
  ```ts
  export interface TipBox { left: number; right: number; top: number; bottom: number }
  export interface TipSpace { width: number; height: number; box(r: DOMRectReadOnly): TipBox }
  export function appZoom(): number            // computed --app-zoom on <html>; 1 unless Number.isFinite and > 0
  export function rectScale(zoom: number): number // 1 when zoom is 1 (no probe); else probe width / 100, cached per zoom; 1 (uncached) unless that is Number.isFinite and > 0
  export function tipSpace(): TipSpace         // width/height = innerWidth/innerHeight / appZoom(); box() divides each edge by rectScale(appZoom())
  ```
  The cache is a module-level `Map<number, number>`; tests isolate by using a different zoom value per case, never a test-only reset export.
  The probe: a `div` with `data-zoom-probe`, style `position:absolute;visibility:hidden;width:100px;height:0;transform:none;pointer-events:none`, appended to `document.body`, measured with `getBoundingClientRect().width`, removed.

- [ ] **Step 1: Write the failing tests**

  `tipSpace.test.ts` (stub `window.getComputedStyle` so only `--app-zoom` changes; stub `Element.prototype.getBoundingClientRect` with `vi.spyOn` to return width `w` for `[data-zoom-probe]` (the components' `place` helper sets an instance property, which wins over it); `vi.stubGlobal` for `innerWidth`/`innerHeight` 1512 / 860; restore all after each):
  - `appZoom`: no value → 1; `' 1.15'` → 1.15; `'abc'`, `'0'`, `'-2'`, `'Infinity'` → 1.
  - `rectScale(1)` → 1 and no probe is ever appended.
  - `rectScale(1.17)` with probe width 117 → 1.17, and no `[data-zoom-probe]` is left in the document.
  - bad probe → 1, not cached: `rectScale(1.3)` with width 0 → 1, then width 130 → 1.3; the same for `rectScale(1.4)` with `NaN` then 140, and `rectScale(1.5)` with `Infinity` then 150.
  - cached: `rectScale(1.2)` width 120 → 1.2; then width 100 → still 1.2, and the probe was appended once.
  - `tipSpace()` model (a), zoom 1.15, probe 115: `width` ≈ 1512/1.15, `height` ≈ 860/1.15; `box({left:115,right:230,top:57.5,bottom:115})` ≈ `{left:100,right:200,top:50,bottom:100}`.
  - model (b), zoom 1.16 (a fresh cache key), probe 100: `box` returns the input unchanged; `width` ≈ 1512/1.16.

  The rect helper cache is module-level, so model (a) runs at zoom 1.15 (probe 115) and model (b) at zoom 1.16 with the probe stubbed to width 100; both use innerWidth 1512, innerHeight 860. Fractional results are compared with `parseFloat(...)` and `toBeCloseTo`; only values that divide exactly use string equality. Both component files set up the same three stubs as `tipSpace.test.ts` (`getComputedStyle` for `--app-zoom`, the probe width, `innerWidth`/`innerHeight`). (a) cases use the left-half case's box and pin unless they name their own; (b) cases use `mountPlaced`'s box and pin unless they name their own.

  `RunProgressTab.svelte.test.ts`, new cases in the tooltip describe (same `rect`/`place` helpers; the existing 100% cases stay as they are):
  - (a) left half: scroll box `rect(0,1150,322,460)`, pin `rect(230,345,322,391)`, header `rect(287.5,437,345,379.5)` → `left` `'300px'`, `top` `'294px'`, not below.
  - (a) right half, clipped by the scroll box: header `rect(805,1495,345,379.5)` → `right` ≈ `1512/1.15 - 1000`, `left` `''`.
  - (a) flip: header `rect(460,552,50,84.5)` (layout top 43.5 < 48) → below, `top` ≈ `84.5/1.15 + 6`. Raw rects would not flip.
  - (a) right clamp: box `rect(-57.5,1569.5,322,460)`, pin `rect(-115,-46,322,391)`, header `rect(1443,1558,345,379.5)` → `right` `'8px'`. A raw `innerWidth` would give ~157px.
  - (a) left clamp: same box and pin, header `rect(-46,57.5,345,379.5)` → `left` `'8px'`.
  - (b) left and right halves: the existing 100% layout rects (box `rect(0,1000,280,400)`, pin `rect(200,300,280,340)`, headers `rect(250,380)` and `rect(700,1300)`) → `left` `'300px'`, `top` `'294px'`; `right` ≈ `1512/1.16 - 1000`.
  - (a) bottom bound: header `rect(400,480,880,914.5)` (layout top 765 > 747.8) → no tip.
  - (b) flip: header `rect(400,480,50,80)` → not below; `rect(400,480,43.5,73.5)` → below. (b) right clamp: box `rect(-50,1353.45,280,400)`, header `rect(1250,1350)` → `right` `'8px'` (raw `innerWidth` would give 162px).
  - scroll re-placement at its own cache key, zoom 1.25 with probe 125: box `rect(0,1250,350,500)`, pin `rect(250,375,350,425)`, header `rect(312.5,475,375,412.5)`; focus the header, dispatch two `scroll` events on the scroll box → `left` `'300px'`, `top` `'294px'` after each, and the probe was appended exactly once.

  `SuperuserUsers.svelte.test.ts` (add the four-argument `rect` helper from `RunProgressTab.svelte.test.ts:926`):
  - (a) chip `rect(1380,1414.5,460,483)` → `left` ≈ `1512/1.15 - 328`, `top` ≈ 396, not below. A scaled rect with a raw height would flip it below.
  - (a) below: chip `rect(600,630,400,423)` (layout top 347.8 < 373.9) → below, `top` ≈ `423/1.15 + 4`, `left` ≈ `600/1.15`.
  - (b) chip `rect(1200,1230,400,420)` → `left` ≈ `1512/1.16 - 328`, `top` `'396px'`, not below.
  - (b) left clamp: chip `rect(2,30,400,420)` → `left` `'8px'`.

- [ ] **Step 2: Run them to see them fail**

  Run: `cd frontend && npx vitest run src/tests/tipSpace.test.ts src/tests/RunProgressTab.svelte.test.ts src/tests/SuperuserUsers.svelte.test.ts > $WS/fe-t2-red.log 2>&1; grep -E 'Tests |FAIL' $WS/fe-t2-red.log | head`
  Expected: `tipSpace.test.ts` fails to import; the new component cases fail (raw rects, raw `innerWidth`); existing cases pass.

- [ ] **Step 3: Implement `tipSpace.ts` and use it in both `placeTip`s**

  `RunProgressTab.placeTip`: `const s = tipSpace();` convert `r`, `box`, `pin` with `s.box(...)`; replace `window.innerHeight` with `s.height` and `window.innerWidth` with `s.width`; flip (`top < 48`) and offsets (`6`) unchanged, now in layout px. `SuperuserUsers.placeTip`: the same for `r`, `innerHeight / 2` and `innerWidth - 328`.

- [ ] **Step 4: Run them to see them pass, then the whole suite**

  Run: the Step 2 command, then `npm test > $WS/fe-t2.log 2>&1; echo $?; grep -E 'Tests |Errors|Unhandled' $WS/fe-t2.log`, `npm run check`, and the gate.
  Expected: all green, exit 0, no Errors/Unhandled; gate 0 FAIL.

- [ ] **Step 5: Commit** (after the review lanes and the owner's OK)

  ```bash
  git add frontend/src/lib/tipSpace.ts frontend/src/tests/tipSpace.test.ts frontend/src/tests/support/zoomStubs.ts frontend/src/components/runs/RunProgressTab.svelte frontend/src/pages/superuser/SuperuserUsers.svelte frontend/src/tests/RunProgressTab.svelte.test.ts frontend/src/tests/SuperuserUsers.svelte.test.ts
  git commit -m "fix(ui): place the fixed tooltips in the zoomed space"
  ```

---

### Task 3: Chrome acceptance

**Files:** none planned; any fix found here gets its own failing test first and joins this task's commit. Results go in the ledger (`$WS/progress.md`).

**Interfaces:** consumes Tasks 1-2 as built; dev servers as in the spike (backend :8000 `MATHION_DEBUG=1`, vite :5180; :5173 belongs to another project). Real media rule only, no injected style.

- [ ] **Step 1: Run the checks in agent-browser** at windows 1399x860, 1400x860, 1512x860 and 1440x600 unless a check names one. Record each with its measured numbers.
  1. 1399: `getComputedStyle(html).zoom` is `1`; 1400 and 1512: `1.15`.
  2. Short page (`/courses`) at 1512x860 and 1440x600: `documentElement.scrollHeight <= clientHeight`; the "Powered by" footer is inside the window.
  3. Each large modal opened (MiniProjectModal, RosterImportModal, EditColoursDialog, EditEmailDialog, VersionSettingsModal, NewItemModal) at 1440x600 and 1512x860: the last footer button's rect bottom `<= innerHeight` and it is clickable (`elementFromPoint` at its centre is the button or inside it). Open only; cancel, never save.
  4. Same window resized 1512 → 1399 → 1512 with a modal open, then with the drawer open: the footer (modal) and the last control (drawer) stay inside after each step.
  5. The teacher drawer (evaluation side panel) at 1512x860 and 1440x600: panel rect bottom within 1px of `innerHeight`; scrolled to the end, the last control is inside.
  6. Progress header tips: left half, right half, near the top (flip below), after a sideways scroll, and a keyboard-focused header while scrolling: the tip's near edge is the designed 6px (6.9 at 115%) from the header, within 2px, with the expected side alignment; Users chip tip: 4px (4.6 at 115%), within 2px.
  7. Progress scrolled sideways: Student and Group columns stay pinned, no gap.
  8. One interactive app (iframe/canvas): a click and a drag land where pointed; note any canvas softness.
  9. Browser-zoom smoke, emulated by the CSS viewport each step produces on a 1512x860 window: 1375x782 (110%), 1210x688 (125%), 1008x573 (150%): app zoom is off at each, tips still sit on their source. agent-browser cannot press the browser's own Cmd+, so the real 110/125% steps go to the owner's passes below.
  10. Markdown editor: drop an image mid-text; it lands at the drop point.
- [ ] **Step 2:** A failing check is a finding: reproduce it in a test where jsdom can (a CSS or helper case), fix, re-run its check and the suite; otherwise ledger a `Ruling:`.
- [ ] **Step 3:** Ledger the results; commit any fix with its test (after the lanes and the owner's OK).

---

### After the tasks

Whole-branch review (fresh Opus + Fable, Codex), then the owner's browser pass, one step at a time, on a 1512px-wide window:
- Chrome (real Cmd+ only): 110%, 125%, 150%. At each, `--app-zoom` is 1 (the page is smaller at 110% than at 100% browser zoom, larger at 125%), and a Progress tip and a Users chip tip sit on their source.
- Firefox: the spec's Firefox list, plus the first two Cmd+ presses (110%, 120%): `--app-zoom` is 1 at both, tips on their source.
- Safari 27: the spec's Safari list, plus the first two Cmd+ presses (115%, 125%): at 115% the page looks unchanged because `--app-zoom` is now 1, and at 125% it is larger; tips on their source.
- One look on a 1x monitor if one is at hand.

Then cleanup (stop the dev servers, drop the spike's dev session and panel token rows, delete the workspace).
