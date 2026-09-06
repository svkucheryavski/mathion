---
worth: yes
where: frontend/src/styles/base.css:21
added: 2026-09-05
---
# the global focus ring is invisible in forced-colors mode

`base.css:21-25` is the app's only focus indicator for most controls:

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
