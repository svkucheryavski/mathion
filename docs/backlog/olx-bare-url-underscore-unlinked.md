---
worth: no
where: backend/mathion/olx/mdtext.py:24
added: 2026-11-21
---
# imported bare URLs with an underscore are not clickable

The OLX import escapes every `_` in page text, so a bare URL such as
`https://en.wikipedia.org/wiki/Normal_distribution` comes out as `Normal\_distribution`.
Mathion's bare-URL rule then leaves the whole address as plain text: intact, never a cut
link, but not clickable. CommonMark never opens or closes emphasis on an `_` between two
alphanumerics, so that `_` could stay unescaped; it needs its own round-trip fuzz round.
Surfaced in the Task 2 reviews (Fable r3 M2). Unknown that settles it: how many imported
courses carry bare Wikipedia-style URLs (the dry-run report of a real import will show it).

Owner 2026-11-24: no. The sample export has none (46 pages, 0 bare URLs in text; all 17 links are `<a href>`, which keep their underscores). Reopen if a real import's report shows bare URLs with `_`.
