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
