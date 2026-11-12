---
worth: yes
added: 2026-11-12
---
# Superuser panel: screen-reader and keyboard checks for the beta VoiceOver pass

These were parked from the superuser panel slices for the single VoiceOver pass at beta.

## Users and Courses

- An info `NoteStrip` inserted together with its text may not be announced by every screen reader (a status region announces changes, not its own insertion); for the VoiceOver pass at beta (Opus r1).
- After a course delete, focus returns to the trash of a row the reload removes; focus the heading or New course instead (Opus r1).
- The dialogs' error sentence is described on the form, not tied to its field (no `aria-invalid`); for the VoiceOver pass at beta (Opus r1).
- The blocked trash's reason is only in `title`; `aria-label` "Delete <name>" names it and a keyboard user sees no tooltip; put the reason in the label when blocked (Fable r1).
- After a confirmed strip, focus is lost: Disable and Enable swap buttons, and a deleted row goes away; focus the heading or the row's next button (both lanes r1, as Task 6's delete).
- `.u-count` is not a live region, so a screen reader does not hear the new count after a search or pill; for the VoiceOver pass at beta (Fable r1).
- The chips' hover list is in `title` only, so a sighted keyboard user can't open it; the chips are plain spans (both lanes; beta a11y pass).
- VoiceOver may read a chip's `title` and its hidden list twice; check in the VoiceOver pass at beta (Opus).

## Branding

- **The file line's change from "checking…" to "N colours" isn't announced** (Fable r1 M1). A screen-reader user isn't told when the check answers and Save is ready; the blocked sentence is (role=status). Fix: `aria-live="polite"` on `.ec-file`. For the VoiceOver pass at beta.

## Settings

- **Edit email focus:** opened with email off, focus lands on × instead of
  the switch (Mail server is disabled).
- **Edit email a11y:**
  - The answer's `role="status"` region is created already filled, so a
    screen reader may not announce it. Keep an empty live region mounted.
  - The visible "Encryption" and "Longest sign-in" captions aren't tied to
    their radiogroups (`{uid}-enc` is unused); use `aria-labelledby`.
