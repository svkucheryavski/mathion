# Slice 6a — teacher screens restyle: deferred minors

Collected from the per-task review lanes (T1–T11). Each line: what, where, why it was deferred.

## Carried to the browser pass (spec §Carried to the browser pass)
- The run frame and the tabs at a normal laptop width and at about 1000px; the Progress table scrolls sideways inside its card, never the page.
- Sticky Student/Group columns in Safari while scrolling sideways.
- The redirects from old bookmarks.
- The interim mixed look (spec §Why) is expected, not a finding.
- **Safari pass with the user (2026-10-11) — done.** OK: the Teaching list and the course runs list, the run frame at a laptop width and at about 1000px, Progress (sideways scroll inside its card, sticky Student/Group columns), Submissions, the dirty-grade guard, Groups, Teachers, Mini-projects, Assets (upload, bulk strip, Replace and Delete confirms), and the old bookmarks (signed in, and signed out through login with one `?next=`). Changed on the user's word: one page width `--page-max` 1140px (`57c5864`), Submissions' CSV as a text button (`577f45f`), plain delete confirms as one-line rows under their row plus semi-bold deadline labels (`c626192`). P19 kept (no `<h2>` on Progress/Submissions). Spec rev 5 records these.
  - Not done: VoiceOver on the confirm groups ("Delete X?, group" before Cancel) — skipped by the user; the naming is pinned by tests.
  - Expected, not findings: the grading side panel still looks unstyled (DashboardSidePanel is 6c); Submissions sorting not checkable with one group (unchanged in 6a, covered by tests).
  - Dev setup note: the dev backend needs `MATHION_ASSET_PATH` (run-debug.sh sets `$HOME/mathion-assets`); without it uploads fail with "Failed to write asset file". The handler hides the real error behind that message.

## Minors
<!-- one heading per task, one bullet per deferred review minor -->

### T1 — backend Teaching list
- A superuser's `/api/teaching/runs` returns every run with no limit or paging (`backend/mathion/api/teaching.py`). Fine at today's scale; revisit if a large install appears.
- The docstring says "the role test is a WHERE ... IN, not a join": a how-comment that goes stale if the query is rewritten. The test `test_course_admin_who_also_teaches_sees_the_run_once_with_its_student_count` now pins the behaviour, so it is harmless.
- Round 2: the hardened test's comment says "(2x2x2)" while it asserts 2; "a role join would give 8, not 2" reads clearer. Cosmetic.
- Round 2: the docstring parenthetical could simply be dropped instead of tracked. Harmless either way.

### T2 — shared pieces
- `heatToken(NaN)` returns `--heat-4` (every `<=` is false for NaN). Today's caller `computeRatio` returns null for a 0 or null total, so NaN cannot arrive; T7 must keep it that way.
- `deadlinesHeader` throws `RangeError` on an unparseable ISO, as `formatLocalWithTz` already does; callers pass only real deadlines.
- The Intl spy in the `formatShortDeadline` locale test only catches `new Intl.DateTimeFormat`; a regression to `toLocaleString` under an en-US test locale would still pass.
- No test for `Button`'s `bind:element` or for `data-action` being absent on `Button`; T9/T11 callers exercise them.
- The StatusBadge label test's title says "the colours stay" but asserts only `data-status`.

### T3 — DangerConfirm, InlineName, InlineConfirm takeFocus
- While `busy`, DangerConfirm natively disables the focused box or button, so Chrome and Safari drop focus to `<body>`; the caller restores focus after the action (§Focus, T10/T11). Check in the browser pass.
- InlineName shows "Please correct the highlighted fields." for a 422 with a list detail, though nothing else is highlighted; an empty-string detail shows no error. Callers pass `maxlength={80}`, so a 422 is unlikely.
- InlineName's last test cannot tell the ApiError branch from the Error branch (`ApiError(500, 'Server exploded')` has message === displayMessage); a list-detail 422 would pin it.
- DangerConfirm's Esc handler sits on its three controls, not the root; a focusable element inside a caller's message snippet would not cancel on Esc. Today's messages hold only text and `<code>`.
- No test for the Force delete title while busy, or for InlineName's ✓ title ("Save" / `saveTitle`); T9 exercises the Groups rename title.
- Round 2: the DangerConfirm group and its button are announced with the same words ("Force delete, group" … "Force delete, button"); a name like "Confirm force delete" would read better. Cosmetic.

### T4 — run pages under /teaching
- Staff notification emails still link to `/courses/{slug}/runs/{id}` (`backend/mathion/notifications/templates.py:35` `_staff_url`, pinned by `backend/tests/test_notifications_templates.py:44,58`). They work through RunsRedirect, which is why the two redirect routes must never be removed. Switch `_staff_url` to `/teaching/...` in 6b/6c (the spec allows only T1's backend change in 6a).
- The gate's D3 grep cannot see an address built by concatenation (`'/courses/' + slug + '/runs'`) or from a variable; and excluding all of `routes.ts` would hide a future third old route. None exists today.
- No test pins the route table itself (`/teaching/s/runs/8` → RunDetailPage, the old address → RunsRedirect); the App-level test covers it indirectly.
- `RunDetailPage.svelte:276` encodes `courseSlug` (a decoded route param) while the other links interpolate `course.slug` raw (API slugs are `[a-z0-9-]`). Harmless; noted so nobody "fixes" one side.
- RunsRedirect's "renders nothing" test spies on `router.navigate` through Vitest's ESM rewriting; the null-user test confirms the spy intercepts.

### T5 — run frame, tab in the address
- The Assets "Edit" test (`RunDetailPage.tabs.svelte.test.ts`) promises "the tab has focus underneath" but asserts only the dialog; P10 (the modal returning focus to the Mini-projects tab) is checked by code reading only. Close the modal and assert `document.activeElement === tab('mini-projects')` (both lanes).
- No test asserts that `#hash` survives a tab click (`setTab` carries `currentRoute.hash`); only the unknown-tab rewrite test covers the hash.
- The tabpanel has no `tabindex="0"`; the ARIA tabs pattern suggests one when a panel may open on non-focusable content (Progress or Submissions while loading). Optional.
- `isRunPath` rejects a trailing slash (`/teaching/s/runs/8/`), which the router accepts; an unknown `?tab` there is not rewritten, though the page shows Overview. Cosmetic.
- "Open Overview" inside MiniProjectModal: FocusTrap's cleanup runs before `setTab`'s `tick()`, and its `previousFocus` (the unmounted row control) is skipped because `isConnected` is false, so the tab keeps focus. Correct, but implicit; add a comment when T10 touches the modal wiring.
- Pre-existing: the run-change effect does not clear `pendingEditTarget` (`loadAll` does); it is non-null only between `setTab` and the modal consuming it.
- `.run-title-row` wraps, so a long run title pushes the publish bar onto a second line (the spec says "right end of the title row"). User-approved; check at ~1000px in the browser pass.

### T6 — the two runs lists
- §Focus steps 2-3 after a delete (the next row's 🗑, then the previous row's) are implemented but not pinned; only "+ New run", Cancel and failure are tested. An off-by-one or a swapped next/prev would pass. Add: three drafts, delete the middle → the former third row's 🗑; delete the last → the previous row's 🗑 (both lanes).
- Pre-existing: a double-click on "Confirm Delete" sends two `deleteRun` calls; the second 404s, so an error toast follows "Run deleted." and focus jumps. InlineConfirm has no in-flight guard (DangerConfirm got one in T3).
- Pre-existing: `RunListPage` loads in `onMount`, so a change of `courseSlug` on the same mounted page would not reload. No in-app link goes course-to-course today; check before 6b adds one.
- `.runs-head h1:focus { outline: none }`: the heading is focused only as the last fallback (`tabindex=-1`); `:focus:not(:focus-visible)` would be the conservative form. Practical effect nil.
- The run-title link colour (`--primary`, a ledgered deviation from the plan) has no gate row; add `d '\.runs-table td a' … 'color:var\(--primary\)'` if it should be held.
- `TeacherRunListPage` would read "No all runs." if the All pill were ever empty; unreachable today (pills show only when there are rows).
- `trashEls` is `$state({})` though nothing in the template reads it; a plain object would do. Harmless.

### T7 — Progress
- `tbody .sticky-name, tbody .sticky-group { padding: 6px 12px }` beats `.progress-grid th, .progress-grid td { padding: 0 }` only by source order (both (0,2,1)); `.progress-grid tbody .sticky-name` would win on specificity (both lanes). Same class of fragility the T7 header ruling fixed.
- `blockGroupedSequences` declares a local `const blocks = new Map(...)` that shadows the new `blocks` prop; harmless, but rename to `byBlock` next to `blockPositions(blocks)`.
- The "a block missing from `blocks`" test relies on the mock's block title being literally `'B1'`, which reads like a prefix; use a distinct title (e.g. 'Vectors') and assert exactly that.
- No quiz-mode heat assertion (e.g. 1/2 → `--heat-2` after clicking Quiz) and no `aria-sort` assertion on the new headers; heatToken's own T2 test covers the thresholds.
- `.block-header, .seq-header { position: sticky; top: 0 }` is inert (`.table-scroll` has no height limit, so headers never stick on a page scroll). Pre-existing; look at it in the browser pass.
- The 14rem / 6rem sticky widths and `.name-box { width: calc(14rem - 25px) }` assume border-box cells; `reset.css` sets `*, *::before, *::after { box-sizing: border-box }`, so this holds in every engine. Check in Safari anyway. `.name-box`'s `white-space: normal` is redundant (the th inherits normal).
- Pre-existing: three CSV-download tests print jsdom "Not implemented: navigation" on stderr (the anchor `click()`); not a vitest Errors line.

### T8 — Submissions
- Test strength: the mock's block titles are literally 'B1' / 'B2' / 'B99' and `BLOCKS` puts blocks 5 and 6 at positions 1 and 2, so the R13 header and aria-label tests cannot tell `block_title` from `B{position}` (an implementation printing the title in line 2, or `B${n}` in line 1, would pass). Put a third block first in `BLOCKS` and use distinct titles, then expect 'B2' / 'B3 · 1 awaiting · 1 revision' (both lanes). Same pattern as the T7 minor.
- An empty `<span class="mp-line2">` renders when the block is missing from `blocks` and nothing is left to count; harmless (0 height); `{#if line2(mp)}` would skip it.
- `.mp-head { min-width: 11rem }` on a table cell is undefined in CSS 2.1 (old Gecko ignored it); under `width: max-content` with nowrap headers it rarely matters.
- Gate: the T8 block has `uniq1 submission-grid` but no `own submission-grid`; section (q) proves dist-uniqueness indirectly.
- Pre-existing: the out-of-scope cell is `<span aria-label="No data">—</span>` with no role, which screen readers may not announce; visually-hidden text would be robust.

### T9 — Groups and Teachers
- The "invited" chip sits inline after "—" (the plan's markup); drawing 10d puts it at the row's right, before 🗑. The user approved the screenshots as they are.
- `.g-name` has no `overflow-wrap`: one long unbreakable group name (up to 80 characters) runs into the capacity badge. `overflow-wrap: anywhere` (as T7's `.name-box`) fixes it.
- `addGroup`: if `createGroup` succeeds but `onRefetchGroups()` throws, the refetch error shows under the field, which still holds the created name; Save again reports "already exists".
- `confirmDelete` (Groups): the refetch awaited inside `catch` is unguarded, so a failing refetch rejects `confirmDelete`, and InlineConfirm does not await `onConfirm`, which leaves an unhandled rejection. Pre-existing shape.
- A non-ApiError (network) failure on group delete or teacher remove is silent (no toast). Pre-existing in both components.
- Teachers `submit` always moves focus back to the email field when the request settles; during a slow add, a user who moved on (e.g. opened a remove confirm) gets focus pulled back. Guard on `activeElement` being `<body>` or inside the tab if it shows up.
- The disabled-groups text now reads "Overview › Settings" (brief P7) where it used to read "→".
- Test strength: only the "last row → + toggle / email field", Cancel and failure focus paths are pinned; "next row's 🗑" and "previous row's 🗑" after a delete are not (a three-row middle-delete test would pin them). Same as the T6 minor.

### T10 — Mini-projects
- P20 (user-approved): the plain "Delete this mini-project?" confirm sits beside ✎ 🗑 in the actions cell, which widens it, so the columns shift while it is open.
- `.mp-table` uses `border-collapse: collapse`, which ignores `border-radius`, so the card corners are square (10j draws them rounded). `border-collapse: separate; border-spacing: 0` (as the Progress/Submissions grids) or a wrapper with `overflow: hidden` fixes it. T6's `.runs-table` has the same pattern.
- After a failed force delete, focus goes to the row's 🗑 (the panel rule), and the panel stays open unarmed below it; focusing the panel's checkbox would keep a retrying user in place.
- An admin's 409 whose refetched row is still not locked leaves the inline confirm open with no feedback (pre-existing).
- The empty text keys off `rows.length` (mini-projects whose block is in `blocks`), so a mini-project whose block is missing from the pinned version shows "No mini-projects yet…" and "0 of N". The data model should not allow that.
- Tests: the admin-409 test does not assert focus on `input[data-role="danger-ack"]`, and the force-delete success focus path (`focusAfterRemoval`) is untested.

### T11 — Assets
- At 1000px, an extreme filename together with a very long uploader email (and the plain delete confirm open in the actions cell) squeezes the Filename column; the replace confirm already sits in its own full-width row (browser pass).
- `.assets-table` uses `border-collapse: collapse`, so the card corners are square (same as T6 `.runs-table` and T10 `.mp-table`).
- Tests: after a delete, the "next row's 🗑" and "previous row's 🗑" focus steps are not pinned (only the last-row → + Upload step is), and the 403 force-delete path has no focus assertion.

### Final whole-branch review (fresh Opus + Fable: no Critical; two minors re-graded Important and fixed; the rest deferred)
Fixed in the review pass: inline confirms are now groups named by their question (screen readers hear "Delete run X?" before "Cancel"); the group rename ✓/× name the group.
- `RunDetailPage` binds tab buttons into a plain object: Svelte logs `binding_property_non_reactive` eight times per mount in dev and in tests. Fix: `const tabEls = $state<…>({})`.
- Assets "used by → Edit" opens the mini-project modal even when that mini-project is locked (its ✎ is disabled on Mini-projects); saving then fails with 409. Take with 6b's modal work.
- Assets 403 on force delete reloads the whole run page, so the "no longer have permission" banner disappears and focus lands on `<body>` (pre-existing, rare). Toast it, or refetch only the course.
- Teachers add: a network (non-API) failure shows nothing.
- Spec R14 still says the Replace confirm stays in the actions cell; T11 moved it to a full-width row (browser pass). Update the spec line.
- `withTab`/`withoutTab` re-serialise other search parameters (`%20` → `+`); none exist on run addresses today.
- `RunListPage` actions header uses `<th aria-label>` where the tabs use a visually-hidden span.
- P19: Progress and Submissions have no h2 header row, while the spec says the header row is common to all six tabs — confirm with the user at the Safari pass.
- Carried to 6c: the publish bar's Unpublish confirm and the Publish ↔ Unpublish swap drop focus to `<body>`.
- "Delete N selected" stays enabled while a bulk delete runs; a second deliberate confirm starts a duplicate loop and a misleading "deleted by another user" banner (pre-existing).
- The Teaching list's status pill is not kept in the address, so Back from a run resets it to Active (pre-existing).
- The Mini-projects and Assets single-row delete confirms are named "Delete this mini-project?" / "Delete this asset?", not after their row (the three new labels are); pass `label="Delete {name}?"` if wanted.
- Every InlineConfirm with a warning is now a group named by it, including the confirms outside 6a (Unpublish, MiniProjectModal publish, discard prompts); the MiniProjectModal publish group's name is its whole two-sentence warning. Keep in mind for 6b/6c.

### For the final Polish slice (user decision in the 6a Safari pass, 2026-10-11)
- **One way to confirm a delete: in place, everywhere.** The Teaching screens confirm in the row (InlineConfirm) or in a danger panel under it (DangerConfirm), as the handoff's "never opens a second dialog" rule says; the authoring screens still use the browser's `confirm()` (~12 places: block/sequence/item deletes in BlockAccordion, SequenceAccordion, VersionEditPage; question delete in QuizBody; explanation remove; app-script remove in AppBody; version archive/revert/disable/delete in VersionsPage and VersionEditPage; the published-key confirm in KeyAnswer/ChoiceAnswers). Convert them to in-place confirms. The in-app "Discard unsaved changes?" prompts (DirtyGuard, modal closes) are part of the same question; only the close-tab/reload warning must stay the browser's (beforeunload allows nothing else).
- The `download` glyph in IconButton has no consumer since Submissions' CSV became a text button (Safari pass); keep or drop.
- Assets: the "0 uses" chip opens an empty "used by" panel (just "file — used by"). Suggest the panel say "Not used by any mini-project." (or the chip not open at 0). Seen in the Safari pass; pre-existing.
