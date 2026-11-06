# Superuser Branding: deferred work

Minors from the per-task reviews and the whole-branch review, by task.

## Task 1 (storage, name rule, the read that never fails)

- **A slow read can overwrite a newer kept copy** (Opus r1 M2). Two reads that overlap a save can finish out of order, so the last good copy may briefly be the older one. It only matters during the next outage, and the next successful read corrects it. Fix if it ever shows: keep the copy with a read counter and drop older results.
- **The 60-character limit counts code points** (Fable r1 M6). A browser's `maxlength` and `.length` count UTF-16 units, so a name with emoji may be cut short in the dialog before the server's limit. Task 9: don't put `maxlength` on the name field; let the server's sentence speak.
- **The design system's "favicon" form is stale** (Fable r1 M7, follow-up F2): the default tab icon is now the user's own drawing, `backend/branding-defaults/icon.svg`, but three places still call the reversed tile the favicon: `Logo.svelte`'s comment, `frontend/src/styles/base.css:62-64` and `docs/design/visual-refresh/mathion-visual-spec.md:93`. Update all three when Task 8 touches the logo.
- **No test checks the outage log's text** (Opus r3 M7), only how many lines it logs. If a later edit logged the whole error, SQL would come back into the log unnoticed. Fix: in `test_load_branding_logs_first_failure_after_startup`, assert the message contains `does not exist` and neither `SELECT` nor a line break.

## Task 2 (theme variables, the toast colour, the theme parser)

- **An empty value is echoed as empty backticks** (Opus r1 M5): `--bg: ;` gives "Line 2: `` isn't a colour. …". Not wrong, just odd. Fix if a school trips on it: a separate sentence for a missing value.
- **The echo's `\u` codes can be cut or too long** (Opus r3 M9, Fable r3 M7). The 40-character cut runs after escaping, so it can split a ` `; a character above U+FFFF shows as `\u` plus five hex digits (`ὤ2`). Cosmetic: the value is refused either way. Fix: cut before escaping, and use `\U0001f642` above U+FFFF.
- **A leading or trailing NBSP around a value is accepted** (Fable r3 note). `_RE_DECL`'s `\s*` and `strip()` take Unicode whitespace, so `--text: red;` stores `red`. Harmless (the stored value is clean), but D10 says any non-ASCII character is refused. Fix: strip only CSS whitespace.
