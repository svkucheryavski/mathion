# Superuser Settings: deferred minors

Minor findings from the per-task review lanes of the Settings slice
(`docs/superpowers/plans/2026-11-04-superuser-settings.md`), kept for later.

Sorted 2026-11-12: only items a person using the site can meet, and open calls, remain; test and comment nits were dropped and screen-reader items moved to beta-voiceover-pass.md.

## Task 5: the Settings page and its dialogs

Minors from the review lanes, Task 5 (Opus + Fable, round 1).

- **Cancel mid-test** reloads the page before the test records, so in the
  failing-server case the card shows the test only on the next load (D9a
  accepts this).

## Task 6: the login page and the upload screens

- **Check by hand in the Safari pass:** a proxy can drop the connection
  instead of sending its 413 (HTTP/1.1, nginx). Then the student sees the
  network copy with Retry, not the limit sentence. Note which one appears in
  the spec's manual check (a 40 MB upload through an old proxy) and adjust
  the README's D11c paragraph and the release note
  (`docs/release-notes/settings-release-order.md`, which quotes the sentence)
  if needed.

## Task 7: CLI, deploy files and docs

- **An old CLI's `mathion pin` still prints "10 min"** under the server's real
  minutes, until the operator upgrades the CLI.

## Whole-branch review

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
