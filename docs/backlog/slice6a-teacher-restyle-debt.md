# Slice 6a — teacher screens restyle: deferred minors

Collected from the per-task review lanes (T1–T11). Each line: what, where, why it was deferred.

## Carried to the browser pass (spec §Carried to the browser pass)
- The run frame and the tabs at a normal laptop width and at about 1000px; the Progress table scrolls sideways inside its card, never the page.
- Sticky Student/Group columns in Safari while scrolling sideways.
- The redirects from old bookmarks.
- The interim mixed look (spec §Why) is expected, not a finding.

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
