---
worth: yes
where: frontend/src/lib/format.ts:1
added: 2026-09-05
---
# formatProgress has no production caller left

T7 replaced SequenceLink's worded progress with a bare `{covered}/{total}` count, which removed
`formatProgress`'s last production call site. The only references left are its own test
(`frontend/src/tests/format.test.ts:2,5,9`), so the function and that test file now exist solely to
test each other.

Not deleted inside T7 on purpose: that task's cleanup budget names exactly two orphaned CSS rules
(`.progress`, `.check`), and the visual-refresh spec treats the cleanup budget as a pin — widening it
silently is the kind of drift the per-task gate exists to catch. Deleting the helper plus its test is a
two-file change with no other caller, so it is contained; the only judgement call is whether a future
surface wants a worded progress string back, in which case the helper is worth keeping and this item
should become a `no`.
