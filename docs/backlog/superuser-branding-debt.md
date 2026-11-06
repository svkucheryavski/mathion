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

## Task 3 (readability warnings, the PNG check)

- **Rarer broken PNGs still pass the server's check** (Opus r2 M2, Fable r2 notes): a `PLTE` whose length isn't a non-zero multiple of 3 (or is over 768, or over 3 × 2^depth), two `PLTE`s, a `PLTE` on a grey image, an `IDAT` run split by another chunk. PNG forbids them; no common tool writes them; D5 doesn't ask, and the dialog's `img.decode()` refuses them before Save, so only a direct API call could store one. Fix in both copies of the check (server and Task 9's browser copy) if it ever matters.

## Task 4 (public files, the filled page head, the public config)

- **An unfilled page can be cached** (Opus r1 M1, Fable r1 M1). When the built page's markers are missing, `_spa_fallback` sends the file as before: with its `ETag` and `Last-Modified` and no `Cache-Control`. A browser may then reuse an old shell that names a script the new build no longer has, and show a blank app until reload. This predates the slice, and the markers are checked on every test run. Fix: pass `_page_cache_headers(full_path)` on that branch too, and assert `no-cache` in `test_unmarked_page_is_served_unfilled`.
- **`/favicon.ico` after a restart during an outage** (Opus r1 M2). With nothing read since startup, the address can't tell "no upload" from "not read yet", so a browser revalidating the school's icon gets Mathion's default until its next revalidation. Short-lived. Fix: answer 503 when the request's `If-None-Match` isn't the default's and nothing has been read yet.

## Task 5 (the panel's Branding API)

- **The 1 MB + 1 byte cap runs after the upload is spooled** (Opus r1 M1). Starlette receives and spools the whole multipart body before the handler reads its capped part, so a large file costs disk until the proxy's limit (60 MB) stops it. Every upload route in the app works this way; D5's "never read whole" holds for the checks. Fix, if it matters: a streaming size check before the multipart parser.
- **A release can make a stored colour equal Mathion's default** (Opus r1 M2). The card then still counts it as a change, and re-uploading the school's own download warns "puts back Mathion's colour" though nothing visible changes. Fix: `changes_in_use` also leaves out stored values equal to the current default, logged once.
- **The image upsert sends the bytes twice** (Fable r1 M1). `save_image` binds `data` in `values()` and again in `set_`, so a 1 MB logo travels as 2 MB to Postgres. Fix: `set_={"data": stmt.excluded.data}`.
