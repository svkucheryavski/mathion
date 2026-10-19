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

## Task 2 — the page ground and the sheets

- **For the Safari pass:** the focus ring on the current strip tab. It wraps the tab, so its lower stroke sits just inside the sheet below the joint; that is unavoidable for an outline on a tab that overlaps its sheet. If it reads badly, the current tab alone could take a negative `outline-offset` (both lanes, r1).
- **For the Safari pass:** the done tiles in the strip read by their `--muted` glyph (4.94:1); their `--border-strong` edge is 1.04:1 on the `--border` fill and cannot be seen. If the tiles read too faint, the edge needs a darker token (Opus r1 M2).
- **Not checked in a browser:** High Contrast (forced colors) for the strip. The review traced the cascade (solid done fill, dashed not-done, a three-sided Highlight tab), but neither Chrome here nor Safari emulates forced colors; check on Windows High Contrast before beta.
- A browser that predates the `forced-colors` media feature (Safari < 16) skips the `forced-colors: none` block: the strip then shows the shared ItemMark colours (blue = done) with the D62 tab geometry. Coherent, not broken; restating the colours unconditionally plus a fuller `forced-colors: active` block would remove the dependence (Fable r1, Opus r1 note).
- On a phone, a long sequence wraps the strip; a current item on an upper row cannot touch the sheet and reads as a white button (spec §The player strip, known limit).
- The gate row `none … "body:has\([^)]*\)\{[^}]*--focus-page"` misses a selector with nested parentheses (`body:has(.page:not(.x))`); loosen to `body:has\([^{]*\{[^}]*--focus-page` (Opus r1 M3).
- `theme-default.css`, the `--focus-page` comment: "below --focus-1/--focus-2" is ambiguous, since `--bg` is lighter than both (Fable r1).
- **Polish 3:** at 320px wide the AppHeader overflows sideways on every page ("Dev" and Logout run to 390px). Not Task 2's: the header is unchanged; found during the Task 2 shots.
- Two stale words from the D62 fix (r2): the spec's §The player strip Gate bullet says the ItemMark inventory "gains the five rules", now four (Fable r2); the gate comment above the (i) SPECS (`visual-refresh-gate.sh:2062-2064`) still says `.icon` is the whole of what ItemIcon may keep, now `.icon` and `.icon.current` (Opus r2 m1).

## Task 3 — authored content, page scale

- **Before Task 4 (six more surfaces take the same carve-out):** the scanner's `attachOn` pins the source text `{@attach externalLinks(…)}`, not what the function does. An edit to `externalLinks.ts` that sets `.style` or `classList`, or a local `externalLinks` in PageItem that shadows the import, restyles the content box with the gate green. Fix: (an) source greps that PageItem imports `externalLinks` once from `'../../lib/externalLinks'` with no local binding, and that `externalLinks.ts` has no `.style`, `classList`, `setAttribute('style'` or `setAttribute('class'` (Opus r1 m2).
- The (an) stray-`prose` row matches only `class="… prose …"`. `class:prose`, a template-literal or array class, or `class="prose {x}"` adopt `.prose` uncounted. Fix: match the bare `prose` token in any class form and diff against CONTENT_SURFACES (Opus r1 m1, Fable r1 M3).
- MiniProjectDetailPage's attachment is pinned only by a fixed-string line count (the page is not in the scanner's SPEC set), so a second `{@attach}` elsewhere on the page passes, and a line-wrapped reformat of the div is a false red. Fix: add `grep -c '{@attach'` = 1 for the file (Fable r1 M2, Opus r1 m3).
- The (an) `nredecl` grep misses `:global(a:hover)`, `:global(p:not(…))`, `:global(img[src])`, `:global(.content p)` and the nested `:global { … }` block. Belt and braces only: (b3) GLOBAL_ALLOW equality catches any new `:global` on both surfaces (Fable r1 M4, Opus r1 m3).
- The (h) PageItem `none` row `\.content\.H [a-z]` misses the child combinator (`.content.svelte-H>p`); the (p) set-equal inventory catches it anyway. Fix: `[ >~+]` (Fable r1 M5).
- **Design question for the Safari pass:** in a loose list on the page scale a second paragraph in an item is 16px from its first and 16px from the next item, so `li + li { margin-top: var(--space-2) }` has no visible effect and items do not group. Not a regression (the old rules had no loose-list case). Fix, if wanted: `p + p` inside `li` at `--space-2`, or zero `p` margins in `li` and let `li + li` carry the gap (Fable r1 M1).
