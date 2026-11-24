# Larger item window and apps on white — short design

Owner request from the OLX import spot-check (2026-11-23), approved in the conversation.
Since the large-screen zoom merge (2026-11-24) the previews' floor is `calc(800px / var(--app-zoom, 1))`,
800 screen px under zoom (large-screen-zoom spec rev 7 §3).

## Intent

Graasta apps are built for 16:9 and need at least about 800 × 450 px. In the item
editor they sit in a 360 px tall preview inside a window of at most 920 × 600 px, so
they are cut off. The app's own page is transparent, so in the editor it shows on the
preview's light gray. The owner wants:
- a larger item window, the **same size for every item type** (owner's call);
- every app shown on **white**, wherever it appears.

## Goals

- The item window (ItemEditorModal, all item types) is 1120 × 820 px, still capped
  by the screen with Modal's usual margins (`100vw - 32px`, `100vh - 52px`).
- The app preview in the editor is 16:9 of its width (about 610 px tall in the larger
  window) instead of a fixed 360 px.
- The video preview in the editor is 16:9 too, instead of a fixed 296 px (owner, after the
  browser check showed a wide, short strip in the larger window).
- Both previews narrow (centred, still 16:9) so the window needs no vertical scroll, but
  never below 800 px wide (owner, Safari pass: scrolling was needed on a laptop). On a
  screen too short even for 800 × 450 (e.g. 1280 × 720) the body still scrolls a little.
- Every app shows on white, in the editor preview and in the student view, independent
  of the site theme. An app that colours its own `html` or `body` keeps its colour.

## Non-goals

- The student-side frame height (fixed 600 px) stays as it is; it is the separate
  "app auto-height" item.
- The page editor keeps its layout.
- Other modals keep their sizes.

## Approaches

- **One larger window for all item types, app preview at 16:9 (chosen).** One size
  everywhere, as the owner asked; the preview shows the app in the shape it was built for.
- A larger window for app items only: rejected — the owner wants one size for all items.
- Keep the window and scale the app down: rejected — Graasta apps become unreadable
  below about 800 × 450 px.

## The how (builder's calls)

- ItemEditorModal passes `width={1120}` and `maxHeight={820}` to Modal.
- InteractiveFrame and VideoFrame get a `fill` option (the frame takes its parent's
  height, with no bottom margin) in place of their fixed `height` option, which has no
  other users. AppBody's and VideoBody's `.preview-area` are `aspect-ratio: 16 / 9` and
  render the frame with `fill`. The app's loading placeholder keeps the same shape.
- The white sits on InteractiveFrame's `<iframe>` element (`background: #fff`); the app
  document stays transparent, so whatever the app paints wins (review r1).
- `.preview-area` width: `min(100%, max(800px, (min(calc(100vh / var(--app-zoom, 1)), 872px) - R) * 16 / 9))`
  with `margin-inline: auto`, where 872px is the window's 820px cap plus Modal's 52px
  margins, the height is divided by the large-screen zoom like Modal's (1 until that
  branch merges), and R is the rest of the window's height plus a few px for Safari
  (measured in Chrome: app 345px → 356, video 368px → 378).
- The visual-refresh gate's `.preview-area` height pins and `.frame.fixed` pins change to
  the aspect-ratio and `.frame.fill` rules.

## Constraints

- Authoring is laptop-only (owner, 2026-10-31): no phone layout for the item window.
- No new dependencies; Svelte 5; tests with mount/flushSync.
