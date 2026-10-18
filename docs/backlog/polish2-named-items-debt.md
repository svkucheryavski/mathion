# Polish 2 (named items) — deferred minors

Minors the review lanes raised and the user did not take into the slice, by task.
Spec: `docs/superpowers/specs/2026-10-18-visual-refresh-polish2-named-items-design.md`.
Plan: `docs/superpowers/plans/2026-10-18-visual-refresh-polish2-named-items.md`.

## Task 1 — focus ring and reduced motion

- **For the Safari pass:** the video and app iframes. Chrome gives Tab focus to the embedded page, so our inset ring on the frame never showed in the shots; check it in Safari. Where it shows, `--primary` on a black video frame is about 3.0:1, right at the limit (Fable r1).
- **For the Safari pass (a question for the user):** D60's gray list is the user's exact list. The ✕ "Cancel" IconButtons beside a ✓ (InlineName, InlineInput, KeyAnswer, BlockAccordion), the borderless chevrons, the `.add-line` buttons and the CourseCard footer links keep the steel-blue ring. So an InlineConfirm "Cancel" rings gray while an inline field's ✕ "Cancel" rings blue (Opus r1 note).
- RunSubmissionTab's sort and status buttons have no inset rule: their cells are padded enough for the outset ring (P98).
- The gate's `--ring` count row sees only `--ring: var(…)` in the bundle. A wrapper setting `--ring: currentColor` or `transparent`, or a markup-level `style="--ring: …"` / `style:--ring`, would recolour the rings inside with the count still at ten. Fix: count any value, and add a source grep for markup-level `--ring` like (b5)'s inline scan (Opus r2 m1).
- `docs/backlog/polish1-confirms-debt.md`, the Polish 3 bullet: "16 per-component forced-colors blocks" is 17 since Task 1 added `.sp-seg-opt` (Opus r2 m2).
