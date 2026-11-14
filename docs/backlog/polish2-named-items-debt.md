# Polish 2 (named items) — deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## Task 1 — focus ring and reduced motion

- **[open]** **For the Safari pass (a question for the user):** D60's gray list is the user's exact list. The ✕ "Cancel" IconButtons beside a ✓ (InlineName, InlineInput, KeyAnswer, BlockAccordion), the borderless chevrons, the `.add-line` buttons and the CourseCard footer links keep the steel-blue ring. So an InlineConfirm "Cancel" rings gray while an inline field's ✕ "Cancel" rings blue (Opus r1 note).

## Task 3 — authored content, page scale

- D85 (Polish 3 Task 6) detects a loose list by `:has(> li > p)`. A loose list whose items hold no paragraph (each item only a code block, a quote or a nested list, blank-line separated) is not detected and keeps the tight spacing. Rare in teaching text; a fix needs a renderer-side class (markdown-it knows the list is loose) (Opus r2 m2, Polish 3 Task 6).

## Task 6 — bare URLs

- **[open]** An entity or a backslash escape that is not a letter or digit ends the link there: `https://x.org/?a=1&amp;b=2` links up to `1`. Same as markdown-it's own linkify (both run while escapes are separate tokens, which is what keeps `http\://x` plain). Realistic for URLs pasted from HTML with `&amp;`. One that IS a letter or digit (`&uuml;`, `\_`) leaves the whole address plain (D66, pinned). Pin the `&amp;` row (Fable r1 M2, Opus r1 note).
- **[open]** Deleting `stored-content-html-not-rerendered-after-renderer-change.md` (per the plan) leaves one property only in D55: stored `content_html` re-renders only on save, publish and clone. After the beta every renderer change (this is the second) needs a backfill decision (Fable r1 M5, Opus r1 note).

## Whole-branch review (ba8ace4..9bb8607, fresh Opus + Fable, 2026-10-19)

- D66 judges the seam on the raw match, before trimming: `(https://x.org)*note*` and `See https://x.org.**Note** that` stay plain as a whole, although `)` or `.` is a real word boundary. Safe direction, rare; trim first and glue only when nothing (or a word character) was trimmed (Fable final r2 M1).
- The look-past over closing delimiters stops at an empty `text` token (a spent delimiter, or dollarmath's empty token before `$…$`): `*https://x.org/caf*__é__` and `*https://x.org/caf*$x$` link `https://x.org/caf`, and `**https://x.org**$x$` links where `https://x.org$x$` stays plain. Contrived (a cut address, a closer and an opener with no space). Fix: also skip empty `text` tokens in `_glues`' loop, and pin `*https://x.org/caf*__é__` (Opus final r3 m1, Fable final r3 M2).
