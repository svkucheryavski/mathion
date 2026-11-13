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
- **A session-start reply smtplib doesn't name reads "The mail server refused
  the message."** A `454 TLS not available` to STARTTLS arrives as a plain
  `SMTPResponseException`, and "No suitable authentication method found." from
  `login()` as a plain `SMTPException`; both are the server's side, not a
  refused message. Found reviewing the backlog round's Task 3 (pre-existing).
- **A PIN email that went out but whose closing QUIT fails is logged as
  failed** and not recorded as sent, though the person got the PIN.
- **Curly quotes around a From name get the quotes sentence**:
  `“Mathion, AAU” <m@uni.dk>` reads "Put a name with a comma or colon in
  quotes." although they did. Accept curly quotes, or say "straight quotes".
- **A From name with `@ ; [ ]` and no comma gets the general format
  sentence** (`Mathion @ AAU <m@uni.dk>`), not the quotes hint.
- **A non-ASCII username copied from `.env` shows "Sending failed
  (UnicodeEncodeError)."** on the card; saving the Edit email dialog gives
  the right sentence.
- **A 421 at the recipient or after the body charges the next message a
  try**: smtplib closes the connection without a disconnect error, so the
  queue doesn't see the session end (pre-existing).
- **A PIN email whose recipient is refused clears no "refused as the sender"
  line**, though it got past the sender; the queue would clear it.

## Cleanup (spec rev 6 review)

- **An old CLI's proxy also lacks the new timeouts**: through `mathion tls`,
  a slow email test gets a 502 at 5 s, and a large upload or download is cut
  at 30 s. One sentence in spec D11c and in
  `docs/release-notes/settings-release-order.md`.
