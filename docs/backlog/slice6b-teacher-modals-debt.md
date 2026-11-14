# Slice 6b — teacher modals: debt and deferred minors

Walked 2026-11-14 against main `1c904f9`: done and code-only items were dropped, screen-reader items moved to `beta-voiceover-pass.md`, by-hand browser checks to `beta-browser-pass.md`. What is left goes into one fix round; **[open]** marks an item that needs the user's call first.

## Task 1 — Publish conflicts

- **E-mail face in the single-student layouts.** `PublishConflictsModal.svelte` (the single-sentence lead and the one-student grouped lead) sets the e-mail in the proportional `.pc-lead` font, while the list layout and the Global Constraints make e-mails mono. Fix: wrap it in `<span class="mono" title={…}>`. Related: the `<strong>` run title inside those sentences wraps rather than ellipsising; acceptable inside a sentence.

## Task 3 — Import roster

- **Copied failed rows disagree with the screen.** `failedRowsAsText()` uses the raw `r.detail` (empty, or the literal "internal error"), while Detail shows "Not added" / "Server error — try again" (R25). Fix: build the copy text from `detailFor(r)`.
- **Re-bucketed e-mails are not mono.** The counts line "Already enrolled, will be re-bucketed: …" shows e-mails as muted proportional text. Fix: `<span class="ri-key mono">` per e-mail, keeping the "+N more" cut.
- **Paste-parser quirks, pre-existing (round 2 probes, not 6b regressions).** In `lib/csv.ts`: an e-mail-first paste whose first row has a blank e-mail (`\tG1` / `b@x.com\tG2`) picks name-first and misreads every row; a line that is just `,` becomes a "Missing email" row instead of being skipped; an e-mail-first row with an empty middle cell (`a@x.com\t\tG1`) loses its group (positional e-mail-first reads only `cells[1]`). Fix together if the parser is revisited.
