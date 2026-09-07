---
worth: yes
added: 2026-09-06
---
# Slice 4 (student remainder) — deferred Minors for the polish slice

Every item below was raised by a Slice-4 review (first-party or whole-branch) and deliberately
deferred with a ruling in the SDD ledger; none changes behaviour the spec enumerates. Fold them into
the final Polish slice.

**Visual / behaviour (all spec-literal today)**
- `.drop:has(input:disabled) { color: var(--faint) }` never paints: `.drop-label` sets `color` directly
  and `submitting` implies `.has-file`. Confirm on the browser pass, then drop the declaration or move
  it to `.drop:has(input:disabled) .drop-label`.
- No page-level `dragover`/`drop` cancel: dropping a PDF just outside the dashed zone navigates the
  browser to the file. Decide whether a page-level cancel is wanted.
- `header` has no bottom spacing when the deadlines row is absent (spec §3.1 as written): the `<h1>`
  sits 6px above the assignment card.
- `.members` has no `overflow-wrap` (one unbreakable name would widen the grid track).
- Two back-navigation conventions coexist: `Back to course` (SequencePlayer, MP page, no arrow) vs
  `← Courses` (CourseView header, out of Slice-4 scope). Converge.
- Three loading primitives coexist by slice order, not by rule: `Skeleton` (student surfaces),
  `Spinner` (App/Login/editor pages), `LoadingPlaceholder` (teacher pages). Write the rule or merge.
- The file input's accessible name is the wrapping label's text (the picked filename once one is
  chosen); verify with a screen reader before adding an `aria-label`.
- Pending group (`data.group === null`): the submit cell does not render and `auto-fit` collapses the
  empty track, so the group card spans the full width. Correct CSS, artboard-neutral; eyeball it.
- `Skeleton` with `rows <= 0` is unsupported (spec: not clamped) and untested.

**Gate script hardening**
- `header` is the one MP rule with no positive pin; the dim class also skips percentage opacity
  (`opacity:70%`).
- The anchor-ownership greps (`grep -rlE '^[[:space:]]*\.history-entry-header…'` and the (q) ones) do
  not strip comments, so a commented-out rule in another component would register as a second owner
  and red the gate (fails closed).
- Unpinned MP declarations: `.assignment-html :global(ul|ol)` padding/margin, `.deadline-soft`
  color/margin, `.deadline strong` font-weight, `.feedback-file` font-size, the `header` rule.
- Section (r)'s `.empty`/`.error` deletion pins miss a selector-list re-add (`.empty, .foo {`);
  CourseList/CourseView have no declaration inventory in the script, so the grep is their only guard.
- `GLOBAL_ALLOW` is keyed on `(file, payload)`, not the authored selector, so
  `.assignment-html :global(p)` rewritten to a bare `:global(p)` stays green.
- Two source-grep guards still strip HTML comments with the line-based, greedy `sed 's#<!--.*-->##g'`
  (section (r)'s SequencePlayer `← Course<` guard and section (t)'s MP seam guard). Both are negative
  guards, so under-stripping fails closed, but two comments on one line erase the live markup between
  them. Switch them to the multi-line `perl -0pe 's/<!--.*?-->//gs'` form the CourseView guard uses
  (the script's Python lanes already use the equivalent `re.S` form).
- Section (q)'s widened ErrorState leak-guard `none`s still miss a pseudo-class-qualified rule
  (`.message.H:hover{`); the in-script comment documents only the `@media`/`@supports` gap.
- The Spinner-import pin in section (r) greps whole files, so a comment mentioning `ui/Spinner.svelte`
  would false-FAIL.
