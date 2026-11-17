# Large-screen zoom — design (rev 6)

Rev 1 was a single `@media screen and (min-width: 1280px) { html { zoom: 1.15 } }`
rule. Fable and Codex both reviewed it (round 1); this revision answers their
findings. Rev 3 answers round 2 (both: tooltip helper contract, browser-zoom
example, browser acceptance). Rev 4 applies the round-3 minors (both reviewers:
sound to plan from). The owner has seen side-by-side screenshots at 115%
and likes the look, and chose the 1400px threshold knowing the Cmd+ trade-off (§5).

## Intent
The Mathion web app looks small on laptops and larger screens: the theme's base
font is 14px (`frontend/src/styles/theme-default.css:99`) and almost every length
is a fixed `px` value (~2360 `px` vs 37 `rem`). On a 14" MacBook Pro (1512 CSS px
wide) the owner finds it "a bit small". Goal: text, icons, spacing and borders 15%
larger on wide windows; everything else unchanged.

## Decision (proposed)

1. **One scale token, one zoom rule.** In `frontend/src/styles/theme-default.css`
   next to the other tokens:
   ```css
   :root { --app-zoom: 1; }
   @media screen and (min-width: 1400px) {
     @supports (zoom: 1) { :root { --app-zoom: 1.15; } }
   }
   ```
   and in `frontend/src/styles/base.css` (or reset.css):
   ```css
   html { zoom: var(--app-zoom); }
   ```
   `html` covers the app and any future body-mounted portal; Mathion's modals are
   `<section role="dialog">` inside the tree (no native `<dialog>`, no portals).
   `screen` only, so print is unaffected.
   Rev 6, whole-branch review: `@supports` keeps a browser without CSS `zoom`
   at 100%; otherwise every length divided by the token would shrink there.
   Also fixed on this branch (pre-existing, the owner's call): every horizontal
   table box is `position: relative`, so its hidden screen-reader spans no longer
   widen the page.

2. **Threshold 1400 CSS px** (was 1280). Gets 115%: MacBook Air 13 (1470; older 1440), Air 15 (1710),
   MacBook Pro 14/16 (1512/1728), 1536x864 Windows, 1920+ monitors. Stays at 100%:
   1280x720 and 1366x768 Windows laptops (already physically larger pixels, only
   ~600-650px tall), all iPads (max 1376 landscape), phones, the 400px student
   screens. 1440px machines are borderline: a window that is not maximised or has
   a browser side panel open drops below 1400 and stays at 100%. At 1400 the zoomed layout is ~1217px wide, above the 1140px
   `--page-max` column (theme-default.css:115) and far above the 880/560/480
   `max-width` breakpoints.

3. **Compensate every viewport-relative length** (they are computed from the real
   viewport and then zoomed, so 100vh becomes 115% of the window):
   - `frontend/src/App.svelte:100-101` `.shell` min-height → `calc(100vh / var(--app-zoom))`
     and `calc(100dvh / var(--app-zoom))`.
   - `frontend/src/components/ui/Modal.svelte:230` width → `min(var(--modal-w), calc(100vw / var(--app-zoom)) - 32px)`;
     `:231` max-height → `min(var(--modal-h), calc(100vh / var(--app-zoom)) - 52px)`;
     `:248` drawer width → `min(var(--modal-w), calc(100vw / var(--app-zoom)))`;
     `:249` drawer `height: 100dvh` → `calc(100vh / var(--app-zoom))` then
     `calc(100dvh / var(--app-zoom))`. (Rev 5, Task 1 review: rev 4 deleted it, but
     the backdrop's flex item is FocusTrap's wrapper div, not the panel, so the
     drawer collapsed to its content.)
   - `RunProgressTab.svelte:618` and `SuperuserUsers.svelte:412` tooltip
     `max-width: min(320px, calc(100vw - 16px))` → divide `100vw` likewise.
   These are all the `vh`/`dvh`/`vw` uses in `frontend/src` today. The
   visual-refresh gate (`frontend/scripts/visual-refresh-gate.sh`) pins some of
   these exact strings and changes in the same task.

4. **Tooltip placement helper.** The two `position: fixed` tooltips
   (`RunProgressTab.svelte:245-258`, `SuperuserUsers.svelte:183-189`) read
   `getBoundingClientRect()` and `window.innerWidth/innerHeight` and write them
   as `top/left/right` in the tooltip's own (zoomed) layout space. Engines differ
   on the rect: Chrome 128+, Firefox and Safari 26.4+ return rects in visual
   (zoomed) px; Safari before 26.4 returns them unscaled. So the helper converts
   the two inputs **separately**:
   - **Viewport:** `innerWidth / appZoom`, `innerHeight / appZoom`, where
     `appZoom` is the computed `--app-zoom` on `<html>` (1 or 1.15; NaN, empty or
     <= 0 falls back to 1). Browser zoom changes `innerWidth` itself, CSS zoom
     never does, so this is right in every engine.
   - **Rect:** divide by `rectScale`, measured once per placement from a probe:
     a `position: absolute; visibility: hidden; width: 100px; height: 0;
     transform: none` element appended to `<body>` (inside the zoom context, no
     transformed ancestor), `rectScale = probe.getBoundingClientRect().width / 100`
     (~1.15 in rect-scaling engines, ~1 in old Safari; non-finite or <= 0 falls
     back to 1). The probe is created on demand and removed after measuring;
     the result is cached per `appZoom` value, so scroll-driven re-placement
     (`RunProgressTab.svelte:429`) does not force a layout per event.
   Both tooltips use the helper for position, edge clamps and the flip
   threshold. Unit tests cover both engine models — (a) rects scaled
   (rectScale 1.15) with appZoom 1.15; (b) rects unscaled (rectScale 1) with
   appZoom 1.15 — plus appZoom 1, edge clamps on both sides, the flip near the
   top, and the zero/NaN fallbacks; the existing `innerWidth` arithmetic tests
   (`RunProgressTab.svelte.test.ts:949-957`) are updated. `MarkdownEditor.svelte:194`
   (`caretPositionFromPoint` with `clientX/clientY`) stays as is: both are in
   viewport space.

5. **Accepted behaviour, written down (owner's choice):**
   - The user's own browser zoom shrinks the CSS viewport, so it can cross 1400px
     and switch the app zoom off. On windows ~1400-1540px wide (the 1440, 1470 and
     1512 MacBooks) the first Cmd+ goes 115% -> 110% in Chrome/Firefox (about 4%
     smaller) and 115% -> 115% in Safari (first step is 115%); the next press
     enlarges (Chrome and Safari 125%, Firefox 120%). Nothing is lost. Graduated or fluid scaling, or a per-user
     scale setting, are later options if this bothers anyone.
   - A narrow window on a big screen (e.g. half a 1512 screen) stays at 100%.
   - The app is px-based, so the browser's default-font-size preference is
     ignored, as it is today.

## Alternatives considered
- px → rem rewrite + larger root font: ~2360 edits, same picture. Rejected.
- `transform: scale`: breaks fixed positioning and layout width. Rejected.
- Fluid zoom tied to viewport width: re-flows on every resize, fractional
  pixels, still partly offsets browser zoom. Rejected for now.
- Graduated steps (1.08/1.15): later option.

## Supported browsers
Current Chrome/Edge, current Firefox, Safari 26.4+ (the owner's is 27.2). The
tooltip helper is written for pre-26.4 Safari's rect model too (unit-tested), but
older Safari is not browser-tested: on a window 1400px or wider it still gets
the zoom and stays usable, with possible cosmetic gaps. iPads stay below 1400px,
so iPad Safari is never affected. A browser without CSS `zoom` (Firefox
before 126) keeps 100%.

## Testing
- Unit: the tooltip helper (both engine models, appZoom 1 and 1.15, clamps,
  flip, fallbacks, probe measurement incl. zero width); existing tooltip tests
  updated; a stylesheet test pins the token, the 1400px query and the
  compensated viewport lengths.
- Chrome acceptance (agent-browser, real media rule, no injected style), windows
  1399x860 (no zoom), 1400x860, 1512x860, 1440x600 (short):
  - short page: `scrollHeight <= clientHeight` (footer visible);
  - largest modals (MiniProjectModal, RosterImportModal, EditColoursDialog,
    EditEmailDialog, VersionSettingsModal, NewItemModal) and the teacher side
    drawer: last footer button fully inside the window, drawer bottom reachable;
  - Progress header tooltips (left half, right half, near top, after scrolling)
    and Users chip tooltips sit at their intended offset from the source (the
    designed 6px / 4px gap, 6.9px / 4.6px at 115%, within 2px) with the expected
    horizontal alignment and edge clamp;
  - Progress table scrolled sideways: Student and Group columns stay pinned;
  - one real interactive app (iframe/canvas): clicks and drags land where
    pointed; note any canvas softness;
  - markdown editor: drop an image mid-text, lands at the drop point;
  - browser zoom 110/125/150% on top, incl. the 1512 first-step behaviour of §5.
- Firefox (required; owner, one step at a time — agent-browser drives Chrome
  only): short page footer, one large modal's buttons, the drawer bottom, a
  Progress tooltip on the right half, a Users chip tooltip.
- Safari 27 (owner, one step at a time): the same as Firefox plus sticky
  columns, the interactive app, resizing the window across 1400px (zoom switches
  on/off, scroll position sensible), print preview unaffected.
- One look on a 1x (non-Retina) external monitor if available: uneven 2-4px gaps,
  header mark baseline. No fix expected.

## Out of scope
The GitHub Pages project site (separate static page). Math rendering: there is no
math renderer in `frontend/src` today (rev 1's KaTeX line was wrong).
