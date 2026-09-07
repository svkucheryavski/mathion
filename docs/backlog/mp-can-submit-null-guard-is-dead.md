---
worth: yes
where: frontend/src/pages/MiniProjectDetailPage.svelte:534
added: 2026-09-06
---
# `data.can_submit !== null` is a dead comparison

The submit section's render guard is `data.group !== null && data.can_submit !== null`, but
`StudentMiniProjectDetail.can_submit` is typed `boolean` (`frontend/src/lib/types.ts:524`), so the
second conjunct is always true and the guard is really just `data.group !== null`. The comment above
it ("can_submit has been resolved (true OR false with a reason)") describes a tri-state the wire type
does not have.

Carried as-is through Slice 4 (2026-09-06) on purpose: that slice is a restyle and its cleanup budget
is the enumerated list in its spec; changing a render predicate inside it would be an unenumerated
behaviour change. The fix is one line (drop the conjunct, reword the comment) plus the matching
test-comment tweak — but it should land as its own commit so the intent is reviewable.
