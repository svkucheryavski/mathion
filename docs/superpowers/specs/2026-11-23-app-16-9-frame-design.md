# Student app frame: 16:9, and a note on narrow screens

Small change. Status: APPROVED by the owner 2026-11-23.

## Why

On the student page every interactive app sits in a frame fixed at 600 px tall, so short apps leave empty space under them (owner, Sine explorer, 2026-11-18). The editor preview has been 16:9 since the item-window change; the student page is the only place left at 600 px.

## What the owner decided (2026-11-23)

- Apps have no height of their own. Every Graasta app in `graasta-mathion/apps` fills `#app-root` and is drawn for 16:9; future apps must follow the same rules (written down, see below). No other kind of app is planned.
- Apps are not meant for phones. Where the app cannot get at least 800 × 450, the student sees, instead of the app:
  "This app needs a larger screen. Open this page on a laptop or desktop computer."
  The app does not load and the item is not marked covered, so the student comes back to it on a laptop.
- Approach A (below).

## Goals

- The student frame is 16:9 of its width, like the editor preview, so its height follows the app's shape.
- The whole app fits in the window at once where the window allows it.
- Below 800 px of width: the note, no app, no coverage.
- A short written rule set for app authors.

Non-goals: apps reporting their own height; a per-item height setting; any phone layout for apps.
Anti-goal: a shrunk, unusable app on a phone that still counts as covered.

## Approaches

- **A. One 16:9 frame with a width check (chosen).** Same sizing rule as the editor preview; the page measures the width it has and shows the note under 800 px. All on Mathion's side, nothing new asked of apps.
- B. The app reports its height to the page (postMessage from the sandbox). Rejected: Graasta apps fill whatever they get, so there is no height to report; it also opens a channel from the sandbox.
- C. A height setting per app item. Rejected: an extra setting on every app, against one rule for all apps.

## Design

1. **Frame size.** The student app card is 16:9, centred, `width: min(100%, max(800px, (window height − the page's own chrome) × 16/9))`, the editor preview's rule with the student page's chrome; the window height is divided by `var(--app-zoom, 1)` as in the editor, so the pending large-screen zoom merges without change. On the 928 px student column that is at most 928 × 522.
2. **Narrow check.** The item measures its own width (Svelte `bind:clientWidth` on the article). Under 800 px: the note above, in the app card's place; no source fetch, no coverage tracker, no "Marked covered once opened." line. At 800 px or more: today's flow (fetch, frame, coverage). The check follows the width both ways: narrowing the window after the app loaded swaps the app for the note; coverage already credited stays. Until the width is known, nothing loads.
3. **InteractiveFrame.** The frame always fills its parent; the fixed 600 px default and the `fill` switch go away (editor and student both give it a sized box).
4. **Rules for apps.** A short page, `docs/interactive-apps.md`: one JS file, mounted into `#app-root`, fills it (100 % width and height), designed for 16:9, works from 800 × 450 up, no network (the sandbox CSP blocks it), white or own background. Linked from the README's authoring part if there is one.

## Left to the builder

- The exact chrome reserve on the student page (measured in the browser at 1512 × 860 and 1280 × 720, so the title, the app and the bottom bar fit without scrolling where possible).
- Test shape (jsdom has no layout: stub the measured width).
- The note's styling: the existing muted `.notice` inside the card.
