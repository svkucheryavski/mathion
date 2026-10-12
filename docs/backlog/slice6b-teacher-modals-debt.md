# Slice 6b — teacher modals: debt and deferred minors

Spec: `docs/superpowers/specs/2026-10-11-visual-refresh-slice6b-teacher-modals-design.md`.
Plan: `docs/superpowers/plans/2026-10-11-visual-refresh-slice6b-teacher-modals.md`.

Review minors and browser-pass findings, by task. Each entry says where it lives and what fixing it would take.

## Task 1 — Publish conflicts

Review round 1 (Opus + Fable), both CLEAN; minors:
- **E-mail face in the single-student layouts.** `PublishConflictsModal.svelte` (the single-sentence lead and the one-student grouped lead) sets the e-mail in the proportional `.pc-lead` font, while the list layout and the Global Constraints make e-mails mono. Fix: wrap it in `<span class="mono" title={…}>`. Related: the `<strong>` run title inside those sentences wraps rather than ellipsising; acceptable inside a sentence.
- **List semantics in Safari.** `.pc-emails { list-style: none }` makes VoiceOver drop "list, N items". Fix: `role="list"` on the `<ul>`.
- **Scroll-lock test, second open.** `PublishConflictsModal.svelte.test.ts` (Review Focus 3) checks only that the dialog returns after the second open, not that `overflow` is `hidden` again. Fix: one more `expect` after the last `settle()`.
- **Layout loop test leak.** In "shows the drawn note in all three layouts" a throwing `expect` skips `unmount(cmp)`, leaving a Modal on the stack and failing the scroll-lock test for the wrong reason. Fix: `try/finally`, or assign to `component`.
- **Gate (ak) pins.** `.pc-runs` `gap:12px` and the ellipsis trio on `.pc-title` / `.pc-emails li` are not pinned (not in the spec's key list). Optional hardening.
- **Gate (ak) D11 row reads comments.** It greps raw source, so a later comment naming `closeOnBackdrop` would red the gate. Keep the convention of never naming the prop in a comment, or strip comments as `emoji_scan` does.
- **Observation (pre-existing, every `ui/Modal` since 5b):** a mouse click in Safari does not focus Publish, so focus returns to `<body>` after Close. For the browser-pass notes, not a 6b change.

## Task 2 — New run and Switch

Found while taking the shots: the plan's heading id and the Title input id collided (`${uid}-title`), so Title had no accessible name. Fixed in the task (heading `${uid}-heading`, plus a label/id test).

Review round 1 (Opus + Fable), both CLEAN; minors:
- **No-version sentence cut off.** `NewRunModal.svelte` `.nr-strip-val` is `nowrap` with an ellipsis and has no `title` in the no-version branch. In a narrow window the reason Create run is disabled reads "No published version — close this mo…", and the full text is only the disabled button's tooltip, which keyboard users never see. Fix: let that span wrap, or give it `title={NO_VERSION}`.
- **Stale server banner.** A server-error banner from an earlier attempt stays when the next submit fails validation (pre-existing). Fix: `submitError = null` at the top of `submit()` after the guard, or on the validation-failure branch.
- **Cross-field date error.** Editing Start date does not clear "End date must be on or after start date" even when it fixes it (meets the spec's wording). Fix if wanted: also clear the end-date error when `start_date` changes.
- **Switch in forced-colors mode.** `border: 0` and state by background only; in Windows High Contrast on/off differ only by knob position. Fix: a `@media (forced-colors: active)` block (border `ButtonText`, on-knob `Highlight`).
- **Switch's accessible name rests on `<label for>`.** Its subtree is an empty `aria-hidden` span. Browsers honour it; the VoiceOver pass should confirm "Groups enabled, switch, off". If not, add an optional `labelledby` prop.
- **Reduced motion.** `.knob` `transition: transform .12s` has no `prefers-reduced-motion` guard; nothing in the app handles it yet. Polish slice.
- **Test isolation.** `NewRunModal.svelte.test.ts` unmounts at the end of each test without `try/finally`; one failing `expect` leaves a panel on Modal's stack and cascades. Fix: an `afterEach` unmount, as in the Task 1 file.
- **Note for 6c:** a disabled Switch names its reason only through `title`, which keyboard users and Safari never show. The Overview's "Locked once the run is published" should also be visible text or `aria-describedby`.

## Task 3 — Import roster

Found while taking the shots, fixed in the task: the status tile column was too narrow (border-box cells; now 32px, gate-pinned); `lib/csv.ts` dropped an empty first cell (a sheet row with no name) because it trimmed whole lines (now trims the end only; a leading column empty on every row is dropped; the delimiter is chosen from the trimmed first line).

Review round 1 (Opus + Fable), both CLEAN; the two csv regressions they found were fixed in the task. Minors:
- **Copied failed rows disagree with the screen.** `failedRowsAsText()` uses the raw `r.detail` (empty, or the literal "internal error"), while Detail shows "Not added" / "Server error — try again" (R25). Fix: build the copy text from `detailFor(r)`.
- **Re-bucketed e-mails are not mono.** The counts line "Already enrolled, will be re-bucketed: …" shows e-mails as muted proportional text. Fix: `<span class="ri-key mono">` per e-mail, keeping the "+N more" cut.
- **Step marker list semantics in Safari.** `<ol class="ri-steps">` with `list-style: none` loses "list, 2 items" in VoiceOver. Fix: `role="list"` (same family as Task 1's `.pc-emails`).
- **Test gap: Copy during Done's refetch.** Nothing asserts that Copy failed rows is inert while Done's refetch runs; dropping the `closing` guard in `onCopyFailed` passes the suite. Fix: one click-while-pending assertion in "Done runs once".
- **Observation (by design):** the D23 line uses the mount-time roster while the request and Detail use the refetch; a colleague's change in between can make preview and result disagree for that student. The result column is the truth.
- **Paste-parser quirks, pre-existing (round 2 probes, not 6b regressions).** In `lib/csv.ts`: an e-mail-first paste whose first row has a blank e-mail (`\tG1` / `b@x.com\tG2`) picks name-first and misreads every row; a line that is just `,` becomes a "Missing email" row instead of being skipped; an e-mail-first row with an empty middle cell (`a@x.com\t\tG1`) loses its group (positional e-mail-first reads only `cells[1]`). Fix together if the parser is revisited.

## Task 4 — Mini-project editor

Review round 1 (Opus + Fable), both CLEAN. Minors:
- **A failed refresh after a successful Publish reads as a publish error** (both lanes). `confirmPublish` awaits `onSaved()` inside the publish `try`, so the refresh's message shows as a red banner, Publish stays (stale `initial.is_published`), and a retry hits the backend's already-published 409. The spec keeps publish "as today"; it is the same class as D19. Fix: own `try` around `onSaved()`, toast "Published (refresh failed — reload to see latest)", still close.
- **Discard during an upload** (both lanes). Discard restores the saved text, then the finished upload inserts its reference into it at the old offset: the form is dirty again and the asset is orphaned. Fix: `uploadAbortController?.abort()` in `discard()`, or `discardReason = uploading ? UPLOAD_WAIT : …` like Save and Publish.
- **The drawn "·" is read aloud** (both lanes). `.mpm-box-list li::before { content: '· ' }` enters the accessible name, so VoiceOver says "middle dot" before each bullet (and in the inputs' `aria-describedby` text); `list-style: none` also drops list semantics in Safari. Fix: `content: '· ' / ''` and `role="list"`. Check in the Safari pass; Task 5 touches the box.
- **Stale snapshot comment.** The comment above `initialBlockId` says the modal remounts when its props change; since D19 it stays mounted across the refresh. The snapshot is still right (the baseline is re-based after a save). Fix: reword.
- **The zone slice trusts the label's shape.** `localTzLabel().slice(1, -1)` and the frame test build the expectation the same way, so a change to the label's parentheses would cut two real characters with the test green. Fix: `.replace(/^\(|\)$/g, '')` and a literal-shape assertion.
- **Test gaps.** No test for the After-Create fallback to the tab's h2 when the new row is missing (a failed refresh); no test for a double click on `confirm-publish` (guarded only by the sync `submitting` flag).
- **Observation:** Esc while a native `datetime-local` picker is open belongs to the browser; glance at it in the Safari pass.
