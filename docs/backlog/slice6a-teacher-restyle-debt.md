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
