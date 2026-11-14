# Slice 5d — quiz editor: deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## T4 — the quiz header

- A tree reload that lands while the title field is open is not applied on Cancel: the header keeps the
  pre-rename title until `item.title` changes again (a `pendingTitle` fix) (Opus M1 / Fable M1).

## T5 — choice answers

- **[open]** An answer row grows about 6px while its field is open (user not asked to change it).

## T6 — Number and Text keys

- Number's `same` compares trimmed strings, so "5.0" over a stored 5 counts as changed and raises the D10
  prompt, although Enter closes it without a request.
