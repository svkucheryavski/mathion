---
worth: yes
where: frontend/src/styles/base.css:21
added: 2026-09-05
---
# the global focus ring is invisible — in forced-colors mode AND in normal mode

`base.css:21-25` is the app's only focus indicator for most controls (`Button`, `ItemIcon`, the
header links, `CourseCard`, `BlockGroup`'s accordion button — everything without its own rule):

```css
:focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
```

Forced-colors mode (Windows High Contrast) **drops `box-shadow` outright** while the
`outline: none` keeps applying, so every control relying on this rule shows **no focus
indicator at all** — on every screen. `grep -rn forced-colors frontend/src/styles/` returns
nothing, so nothing anywhere restores it.

Components that author their own `:focus-visible` already ship the companion and are fine:
the four quiz question components, `ItemMark`, `Login.svelte:146`, and (from Slice-3 T8a
round 4) `SequenceLink`/`MiniProjectLink`. Everything else is not — including `Button`,
`ItemIcon`, and the accordion button `BlockGroup` introduces, which was measured with
`boxShadow: "none"` and `outline-style: none` under emulated forced-colors.

The fix is one block:

```css
@media (forced-colors: active) {
  :focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
}
```

Deferred rather than done inline because `base.css` is **Slice-1 surface** and sits under the
visual-refresh gate's (b4) hashless global freeze, which pins global CSS including document
order — so the change also has to re-freeze it, and doing that mid-Slice-3 would widen T8a's
scope. Surfaced by the T8a round-5 review; not a regression this branch introduced, only one
it made visible by adding a keyboard control.

## Addendum 2026-09-07 — it is also invisible in NORMAL mode (user browser pass, Slice 4)

The user reported during the Slice-4 pass that Tab "does not allow me to navigate on page, for
example move across sequence icons". Investigation (no code changed):

- The icons are real `<button>`s (`ItemIcon.svelte`), nothing on the student pages intercepts
  `keydown` or steals focus, so focus DOES move. What is missing is the indicator.
- The ring the rule paints is `3px var(--primary-soft)` = `#EAEFF4`, which measures **1.16:1**
  against `--surface` (#FFFFFF) and 1.12:1 against `--bg`. WCAG 2.4.11 wants 3:1. `--primary`
  (#3F5C77) is 6.98:1. `SequenceLink.svelte:79-85` already records the same conclusion ("at ~1.15:1
  against `--surface` the soft token was never a usable indicator on its own") and paints its own
  inset `2px var(--primary)` ring — as do Login, the four question components, MiniProjectLink and
  MiniProjectDetailPage. Everything else relies on the global rule and takes focus silently.
- The rule is copied verbatim from the design handoff (`docs/design/visual-refresh/base.css:132`),
  so this is a defect in the reference itself, present since Slice 1, not a slice regression.

**One fix closes both halves** (forced-colors and normal mode): replace the rule with an outline,
which forced-colors keeps and which the per-component inset rings coexist with:

```css
:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  box-shadow: none;
}
```

Deliberate deviation from the reference; note it in the polish-slice spec. Re-freeze the gate's
(b4) global CSS pin, and check the 22px `ItemIcon` squares in the `.strip` still read well with a
2px-offset ring on a tight wrap line.

**User ruling 2026-09-07:** "I do not think it is important now, most of the users can use mouse.
Let's backlog it for the final stage." → polish slice.

**Testing caveat for future browser passes:** Safari on macOS skips buttons and links on plain Tab
by default (only text fields and drop-downs stop). Use **Option+Tab**, or enable Safari >
Settings > Advanced > "Press Tab to highlight each item on a webpage". This is not something
the app can change; Chrome and Firefox reach buttons with plain Tab.
