# Superuser Settings: deferred minors

Minor findings from the per-task review lanes of the Settings slice
(`docs/superpowers/plans/2026-11-04-superuser-settings.md`), kept for later.

Sorted 2026-11-12: only items a person using the site can meet, and open calls, remain; test and comment nits were dropped and screen-reader items moved to beta-voiceover-pass.md.

## Task 1 (data, copy and seal)

- A 0 or negative MATHION_MAX_FILE_SIZE / MATHION_MAX_COURSE_SIZE silently
  becomes 1 MB with no printed line.
- The "MATHION_MAX_COURSE_SIZE is below the largest file" line doesn't show
  the old value.
- A username the copy drops (over 254 characters or not valid UTF-8)
  leaves email on with no login, and the password stays sealed. A dropped
  host is already copied as off; a dropped username should be too.
- After `_text` drops an over-long host or From, the next line says "is
  empty" / "is not set", which contradicts "is not copied".
- The "not a number" line for a byte limit prints the default in bytes
  (20971520), not in MB. Every note also echoes the whole raw value, so a
  5000-digit size prints a 5000-character line.

## Task 3 (email follows the panel)

- `describe()` sentences that misname the failure:
  - `SMTPNotSupportedError` from `login()` (a server without AUTH) or for
    SMTPUTF8 says "The secure connection … failed.";
  - a banner timeout that smtplib wraps as a disconnect says "Couldn't reach".
- `_send_login_pin`'s `logger.exception` for non-SMTP failures can log a
  `UnicodeEncodeError` that names one character of a copied non-ASCII
  password and its position. This is pre-existing; D7 blocks new ones.
- A temporary 4xx reply to MAIL FROM (a provider's sending limit) arrives as
  `SMTPSenderRefused`, so the card says "The mail server refused <from> as the
  sender." and sends the superuser to fix a From that is fine. Stopping and
  backing off is right. For 4xx codes, say "The mail server asked Mathion to
  try again later."
- The failure line clears only after a message is sent. Consider also
  clearing it after a good session start that sends nothing (every row
  skipped or failed per message).

## Task 4 (the Settings API)

- After the 20 s answer, a retry can get "A test is already running." for as
  long as smtplib's per-step timeouts take: 20 s per step and per address of
  the host. A hostile server can drip bytes for longer. The sentence could say
  the last test is still finishing.
- A display name with an unquoted comma (`Mathion, AAU <m@uni.dk>`) is refused
  with the format sentence, which doesn't say why. Suggest: "Put a name with a
  comma in quotes."
- A display name with a colon (`Aalborg Universitet: Institut <m@aau.dk>`) is
  accepted, but goes out as group syntax (`…<m@aau.dk>;`), which RFC 5322
  doesn't allow in From. How strict receivers treat it is unverified. Fix:
  refuse when `back["From"].groups[0].display_name` is set, and add "or
  colon" to the comma sentence above.
- A pasted zero-width space (U+200B) at the end of the From isn't stripped,
  so the field looks right but gets the format sentence.
- An underscore domain (`my_school.dk`) is refused (correct under RFC 5321)
  with a sentence that doesn't say why.
- A non-ASCII username passes, and the test then says "Sending failed
  (UnicodeEncodeError).", which nobody can act on. Give the username the
  printable-ASCII check.
- A From copied by the migration (D2) isn't checked: a non-ASCII address on a
  relay without SMTPUTF8 fails every message, one by one, as "secure
  connection failed". Add `SMTPNotSupportedError` to `_STOP_MID_SEND`, so it
  becomes D9c's batch stop with the card's red line, and give it its own
  sentence (see Task 3's describe() line). Saving from the dialog fixes it.
- `_send_login_pin` and the dispatcher still use `logger.exception` for
  non-SMTP failures. The test endpoint now logs those by class only; do the
  same there (see Task 3's line on this).

## Task 5: the Settings page and its dialogs

Minors from the review lanes, Task 5 (Opus + Fable, round 1).

- **Edit email: the saved password's hint can mislead.** The placeholder
  "Saved: type a new one to replace it" stays when the mail server or username
  changes or the certificate box is newly ticked, though D8a then asks for the
  password again; the server's sentence says so on Save or test. Clearing the
  username drops the saved password with no hint, and a password typed with no
  username is ignored. Fix: derive the placeholder from D8a's rule, and add a
  note when the username is cleared.
- **Edit email while busy:**
  - Send test email stays usable while Save runs, so it can start a needless
    20 s server-side test.
  - While saving, the segmented choices and the checkbox go `disabled` (they
    flash grey and drop focus), while the text fields only go read-only.
  - A save error stays on screen next to a test result that says the same.
- **Edit email layout:** on a short laptop screen the test answer can sit
  below the fold of the scrolling body. Scroll it into view when it appears.
- **Cancel mid-test** reloads the page before the test records, so in the
  failing-server case the card shows the test only on the next load (D9a
  accepts this).
- **Greyed fields:** `.ee-input:disabled` keeps the strong border. Match the
  project's disabled-field look (`--border-faint`) and pin it in the gate.

## Task 6: the login page and the upload screens

- **A saved limit reaches other screens only on reload.** The upload limit is
  read once per page load. A superuser who changes it in the panel and goes on
  to the course editor in the same tab still meets the old number until a
  reload. A failed read also stays failed until the next reload. Fix: after
  the limits save, set `uploadLimit.mb` to the saved value.
- **The interactive-app upload (AppBody) has no browser-side size check.** It
  never had one; the server's 400 sentence covers it.
- **"Over the limit" is worded five ways** across the four screens, plus the
  server's own sentence. One shared sentence would read better.
- **File sizes use 1000-based units, the limit 1024-based.** `formatFileSize`
  shows a 20.5 MiB file as "21.0 MB" beside "max 20 MB", and the file is
  accepted. Pre-existing.
- **Check by hand in the Safari pass:** a proxy can drop the connection
  instead of sending its 413 (HTTP/1.1, nginx). Then the student sees the
  network copy with Retry, not the limit sentence. Note which one appears in
  the spec's manual check (a 40 MB upload through an old proxy) and adjust
  the README's D11c paragraph and the release note
  (`docs/release-notes/settings-release-order.md`, which quotes the sentence)
  if needed.

## Task 7: CLI, deploy files and docs

- **The README's way back in is CLI-only.** Operations names
  `sudo mathion pin <email>`; an operator on the manual docker-compose path has
  no `mathion` binary. Add the `docker compose … exec app python -m
  mathion.superuser pin <email>` form.
- **The man page calls `pin` "pin the image"** (`deploy/man/mathion.1:36-37`,
  pre-existing). It issues a sign-in PIN.
- **`mathion pin` prints its "Log in at…" advisory after "unknown email" or
  "user is disabled"** (pre-existing; the backend command always exits 0).
- **An old CLI's `mathion pin` still prints "10 min"** under the server's real
  minutes, until the operator upgrades the CLI.
- **The release note (`docs/release-notes/settings-release-order.md`) could
  say more** (review r3):
  - operators could check `sudo mathion version` before `mathion update` too;
  - say where startup names the leftover `.env` keys (one INFO line in
    `sudo mathion logs app`);
  - a line for operators on the manual docker-compose path, who have no
    `mathion self-update`.

## Whole-branch review

- **Restoring a pre-update backup with the old image** needs the old email
  keys still in `.env`: with `MATHION_EMAIL_MODE=smtp` and the keys removed,
  the old image refuses to boot. One sentence in the release note.
- **The red "saved password can't be read" hint stays visible with the switch
  off** in the Edit email dialog (D7c needs no password then).
- **The Email-off card names only `mathion pin`**; the manual docker-compose
  path has no `mathion` binary.
- **The PIN email ignores the queue's back-off**, so each "Send PIN" tries a
  refused login again.
- **A relay that refuses every recipient (`554 Relay access denied`) still
  fails each message for good, with no card line.** Refusals after the body
  are retried and shown on the card; a refused recipient still fails at once,
  because it is usually that address's own problem.
- **A relay with no username still reads "check that the login may send as
  <From>"**; there is no login. Pick a no-login sentence when the saved
  username is empty.
- **Send test answers only "The mail server refused the message."** for the
  same refusal the card explains; reuse `refusal_on_card`'s hint in the test.
- **A refusal after the body leaves an old queue back-off in place.** It
  proves the login works, but a PIN refused after the body during a "refused
  the login" back-off relabels the card while the queue still waits up to
  60 min, and `send_backoff_step` keeps its old value. Clear the retry time
  and step when the failure is not server-side.
- **One template refused by a content filter on a busy install** toggles the
  red line on and off for ~8.5 h with a fresh "since" each time; hedge the
  copy ("…or that it accepts Mathion's messages").

## Cleanup (spec rev 6 review)

- **An old CLI's proxy also lacks the new timeouts**: through `mathion tls`,
  a slow email test gets a 502 at 5 s, and a large upload or download is cut
  at 30 s. One sentence in spec D11c and in
  `docs/release-notes/settings-release-order.md`.
