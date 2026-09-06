---
worth: yes
where: frontend/src/pages/CourseList.svelte:44
added: 2026-09-06
---
# CourseList treats an empty `ApiError.detail` as "no error"

`CourseList` keeps its fetch error as a string (`error = e.displayMessage`) and branches on
`{:else if error}`. `ApiError.displayMessage` (`frontend/src/lib/api.ts:22-26`) returns `detail`
verbatim with no fallback, so a backend error whose `detail` is `''` yields `error === ''`, which is
falsy: the page falls through to the "not enrolled in any courses yet" `EmptyState` instead of the
inline `ErrorState` with Retry. `CourseView` and `SequencePlayer` are immune (they hold the error
object and test `!== null`).

Pre-existing before Slice 4 (2026-09-06); surfaced by the Slice-4 T2 review and carried as-is
because that slice is a restyle. Fix: hold the `ApiError | null` (or a `{message}` object) and branch
on `!== null`, mirroring `CourseView`; one test with `detail: ''` makes it red first.
