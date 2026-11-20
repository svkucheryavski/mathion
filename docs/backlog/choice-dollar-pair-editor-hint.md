---
worth: later
where: frontend/src/components/editor/quiz/ChoiceRow.svelte
added: 2026-11-20
---
# no editor hint when a choice's dollar pair becomes a formula

A choice such as `df$a and df$b` now reads as a formula (the release note says so; write `\$`). The editor shows the typeset result after save but gives no hint before. Unknown that settles it: whether authors hit this in practice (watch the OLX import and beta feedback).
