---
worth: later
where: frontend/src/styles/theme-default.css:5
added: 2026-09-04
---
# the page background reads as gray against the white header

`--bg: #FBFBFC` paints `body` (`frontend/src/styles/base.css:3`) directly beneath `AppHeader`, whose
bar is `--surface: #FFFFFF` (`frontend/src/components/chrome/AppHeader.svelte:54`). The two meet on a
hard edge with no border between them, so the ~1.5% step does not read as depth — it reads as the page
being dirty. Surfaced during Slice-3 T3's browser pass on the real stack (2026-09-04); a lighter `--bg`
was tried and reverted at the user's request ("We will work on refinements later").

The same file carries a related inversion worth settling in the same pass: `--surface-3: #FCFCFD`,
commented "nested/inset panels", is *lighter* than `--bg`, so a panel inset into the page ground would
be brighter than the ground it sits in. `QuizItem.svelte` already routes around this — its `.result`
and `.exp` panels use `--surface-2` with a comment saying `--surface-3` is a near-invisible step
against the article's inherited `--bg`.

`later`, not `yes`: the unknown is whether a tinted page ground is wanted at all. The reference screens
float cards on a tint, but they never place that tint flush against a pure-white bar. Settling it means
deciding either (a) the header takes a bottom border / its own tint so the step is deliberate, or
(b) `--bg` goes to `#FFFFFF` and card separation moves entirely onto borders — which changes every
screen in the app, not just the student surfaces. Not a Slice-3 decision.
