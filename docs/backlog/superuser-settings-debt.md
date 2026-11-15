# Superuser Settings: deferred minors

Minor findings from the per-task review lanes of the Settings slice
(`docs/superpowers/plans/2026-11-04-superuser-settings.md`), kept for later.

Sorted 2026-11-12: only items a person using the site can meet, and open calls, remain; test and comment nits were dropped and screen-reader items moved to beta-voiceover-pass.md.

## Whole-branch review

- **Won't fix (user, 2026-11-15): the PIN email ignores the queue's back-off**,
  so each "Send PIN" tries a refused login again. A PIN is needed now, and
  skipping it during the wait could lock people out after the server
  recovers; the 3-per-hour PIN limit caps the tries.
- **A session-start reply smtplib doesn't name reads "The mail server refused
  the message."** A `454 TLS not available` to STARTTLS arrives as a plain
  `SMTPResponseException`, and "No suitable authentication method found." from
  `login()` as a plain `SMTPException`; both are the server's side, not a
  refused message. Found reviewing the backlog round's Task 3 (pre-existing).
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
