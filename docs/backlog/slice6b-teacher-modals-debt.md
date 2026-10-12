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
