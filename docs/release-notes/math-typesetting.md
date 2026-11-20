# Maths typesetting: existing formulas typeset when their content is edited and saved

From this release, `$…$` and `$$…$$` in pages, quiz questions, explanations,
answer choices, version info and mini-project assignments are shown as typeset
formulas (MathML in the STIX Two Math font).

Content saved before the update keeps its stored HTML until it is saved again.
Its formulas show as LaTeX source: in pages, questions, explanations,
version info and assignments mostly without the dollar signs (an inline
`$$…$$` shows one on each side), and in answer choices with them.

- Pages, questions, explanations and choices typeset when they are edited and
  saved, in a published version too. An unchanged field is not saved again.
- Cloning or publishing a version re-renders every field of that version.
  Version info cannot be edited once a version is published, so in a
  published version it typesets only in a clone (or, while no student is
  enrolled, after a revert and a new publish). A run shows the version it was started on, so a clone helps
  only runs on the new copy.
- Mini-project assignments belong to a run and typeset when they are edited
  and saved. An assignment that already has a submission is locked, so it
  keeps its source in that run.

In answer choices, a dollar pair now reads as a formula: `df$a and df$b`
becomes one. Write `\$` for a literal dollar sign. Backticks do not protect
it: choices have no code spans. A backslash before punctuation is now an
escape too: `a \* b` shows as `a * b`.
