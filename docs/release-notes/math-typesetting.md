# Maths typesetting: existing formulas typeset when their content is edited and saved

From this release, `$…$` and `$$…$$` in pages, quiz questions, explanations,
answer choices, block and version info and mini-project assignments are shown
as typeset formulas (MathML in the STIX Two Math font). Content saved before the
update keeps its stored HTML, so its formulas still show as `$…$` source until
it is edited and saved (an unchanged field is not saved again; pages,
questions, explanations, choices and block info can be edited in a published
version too), or its version is cloned or published: both re-render every
field of the version. A run shows the version it was started on, so a clone
helps only runs on the new copy. Mini-project assignments belong to a run and
typeset when they are edited and saved. A choice such as `df$a and df$b` now
reads as a formula; write `\$` for a literal dollar sign.
