---
worth: later
where: frontend/src/components/editor/AssetSidebar.svelte:462
added: 2026-09-05
---
# other `flex: 1` titles may collapse to 0px the way SequenceLink's did

`flex: 1` expands to `flex: 1 1 0%` — a flex BASIS of zero. When a sibling in the same row keeps an
auto basis and can grow with its content, the row's free space goes negative, `flex-grow` stops
applying, and the zero-basis item resolves to **0px** with its text overflowing its neighbours. That is
what happened to SequenceLink's `.row-title` next to the `ItemMark` chain (past ~24 items on a 760px
card, ~9 on a 340px one); measured in a browser, and fixed in T7 by giving the title `flex: 1 1 auto`
so the shrink is shared in proportion to content.

The same shape appears elsewhere and nobody has checked whether any of them is exposed:

- `frontend/src/components/editor/AssetSidebar.svelte:449, 462, 490` — `.msg`, `.row-click`, `.meta`
- `frontend/src/components/chrome/AppHeader.svelte:87` — `.links`
- `frontend/src/pages/CourseList.svelte:60` — `.page-head h1`

(Re-checked 2026-10-31, Polish 3: `ItemRow.svelte` and `AccordionHeader.svelte` were rewritten and no
longer use a bare `flex: 1` on a title; `OptionRow.svelte` is gone.)

**What settles the value call:** most of these sit beside fixed-width controls (buttons, pills, icons),
where free space never goes negative and `flex: 1` is exactly right — the bug needs a sibling whose
width grows without bound. Checking is cheap (for each, ask what the widest sibling can become), but
whether any of them is actually reachable with real teacher-authored content is unknown, and a blanket
sweep to `flex: 1 1 auto` would be churn on rules that are correct as written.

Deliberately NOT including `header h2 { flex:1; min-width:0 }`, which the Slice-3 spec pins for T8a: the
`h2` there sits beside a fixed-width badge and chevron, so that header's free space cannot go negative.
This is recorded in the spec's §4 T7 ruling so a reviewer does not "correct" it.
