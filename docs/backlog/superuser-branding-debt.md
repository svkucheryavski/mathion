# Superuser Branding: deferred work

Minors from the per-task reviews and the whole-branch review, by task.

## Task 1 (storage, name rule, the read that never fails)

- **A slow read can overwrite a newer kept copy** (Opus r1 M2). Two reads that overlap a save can finish out of order, so the last good copy may briefly be the older one. It only matters during the next outage, and the next successful read corrects it. Fix if it ever shows: keep the copy with a read counter and drop older results.
- **The 60-character limit counts code points** (Fable r1 M6). A browser's `maxlength` and `.length` count UTF-16 units, so a name with emoji may be cut short in the dialog before the server's limit. Task 9: don't put `maxlength` on the name field; let the server's sentence speak.
- **The design system's "favicon" form is stale** (Fable r1 M7, follow-up F2): the default tab icon is now the user's own drawing, `backend/branding-defaults/icon.svg`, but three places still call the reversed tile the favicon: `Logo.svelte`'s comment, `frontend/src/styles/base.css:62-64` and `docs/design/visual-refresh/mathion-visual-spec.md:93`. Update all three when Task 8 touches the logo.
- **No test checks the outage log's text** (Opus r3 M7), only how many lines it logs. If a later edit logged the whole error, SQL would come back into the log unnoticed. Fix: in `test_load_branding_logs_first_failure_after_startup`, assert the message contains `does not exist` and neither `SELECT` nor a line break.
