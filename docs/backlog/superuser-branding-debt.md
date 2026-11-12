# Superuser Branding: deferred work

Minors from the per-task reviews and the whole-branch review, by task.

Sorted 2026-11-12: only items a person using the site can meet, and open calls, remain; test and comment nits were dropped and screen-reader items moved to beta-voiceover-pass.md.

## Task 1 (storage, name rule, the read that never fails)

- **A slow read can overwrite a newer kept copy** (Opus r1 M2). Two reads that overlap a save can finish out of order, so the last good copy may briefly be the older one. It only matters during the next outage, and the next successful read corrects it. Fix if it ever shows: keep the copy with a read counter and drop older results.

## Task 2 (theme variables, the toast colour, the theme parser)

- **An empty value is echoed as empty backticks** (Opus r1 M5): `--bg: ;` gives "Line 2: `` isn't a colour. …". Not wrong, just odd. Fix if a school trips on it: a separate sentence for a missing value.
- **The echo's `\u` codes can be cut or too long** (Opus r3 M9, Fable r3 M7). The 40-character cut runs after escaping, so it can split a ` `; a character above U+FFFF shows as `\u` plus five hex digits (`ὤ2`). Cosmetic: the value is refused either way. Fix: cut before escaping, and use `\U0001f642` above U+FFFF.

## Task 4 (public files, the filled page head, the public config)

- **`/favicon.ico` after a restart during an outage** (Opus r1 M2). With nothing read since startup, the address can't tell "no upload" from "not read yet", so a browser revalidating the school's icon gets Mathion's default until its next revalidation. Short-lived. Fix: answer 503 when the request's `If-None-Match` isn't the default's and nothing has been read yet.

## Task 5 (the panel's Branding API)

- **A release can make a stored colour equal Mathion's default** (Opus r1 M2). The card then still counts it as a change, and re-uploading the school's own download warns "puts back Mathion's colour" though nothing visible changes. Fix: `changes_in_use` also leaves out stored values equal to the current default, logged once.

## Task 9 (the Branding page, the name dialog, the image dialogs)

- **A huge file is read whole before the 1 MB check** (Fable r1 M1). The picker accepts PNGs, but "All files" lets a superuser pick, say, a video; FileReader then loads all of it before refusing it. Fix: refuse at once when `file.size > PNG_MAX_BYTES`, with the same sentence.

## Whole-branch review (aed0056..5f1a4c6)

- **The Colours card lists changed names in the database's key order, not the theme's** (both seats). Postgres JSONB orders keys shortest first, so "--bg, --muted, --primary" can come out unlike the downloaded file. Fix: build the in-use set in `THEME_VARS` order in `changes_in_use` (`theme_css.py`).
- **A backtick in an echoed value or name turns the rest of a problem sentence into code** (Opus M2). Fix: escape backticks when a problem echoes a value or a name (`theme_css.py`, the echo helper).
- **Names echoed in problems aren't shown the way values are** (Opus M3). A name with a pasted zero-width space reads "`--bg` isn't a theme variable.", which looks false. Fix: run names through `_shown` too.
- **A panel save doesn't refresh the last good branding** (Fable M3). An outage that starts before the next read serves the pre-save branding until a read succeeds. Rare; next to Task 1's slow-read item.
