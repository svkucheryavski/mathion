---
worth: no
where: frontend/src/components/editor/quiz/ChoiceRow.svelte
added: 2026-11-20
---
# no editor hint when a choice's dollar pair becomes a formula

A choice such as `df$a and df$b` now reads as a formula (the release note says so; write `\$`). The editor shows the typeset result after save but gives no hint before. Decided not to fix (owner, 2026-11-23): the saved preview shows the typeset result and the release note explains `\$`; reopen only if beta authors hit it.
