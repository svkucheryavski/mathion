# Superuser Branding: deferred work

Minors from the per-task reviews and the whole-branch review, by task.

## Task 1 (storage, name rule, the read that never fails)

- **A slow read can overwrite a newer kept copy** (Opus r1 M2). Two reads that overlap a save can finish out of order, so the last good copy may briefly be the older one. It only matters during the next outage, and the next successful read corrects it. Fix if it ever shows: keep the copy with a read counter and drop older results.
- **The 60-character limit counts code points** (Fable r1 M6). A browser's `maxlength` and `.length` count UTF-16 units, so a name with emoji may be cut short in the dialog before the server's limit. Task 9: don't put `maxlength` on the name field; let the server's sentence speak.
- **`Logo.svelte`'s comment about the "favicon" form is stale** (Fable r1 M7): the form now lives in `backend/branding-defaults/icon.svg`. Update the comment when Task 8 touches the logo.
- **No test checks the outage log's text** (Opus r3 M7), only how many lines it logs. If a later edit logged the whole error, SQL would come back into the log unnoticed. Fix: in `test_load_branding_logs_first_failure_after_startup`, assert the message contains `does not exist` and neither `SELECT` nor a line break.
- **The back peak at tab size** (Fable r2 M8). The design system drops the back peak below 20 px (`base.css:62-64`); the 32 px icon's mark is 19.2 px and tabs show it at 16. D6 names the favicon form with both peaks, so both stay: the user judges it at real size in the Safari pass.
