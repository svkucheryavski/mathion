# Superuser Settings: deferred minors

Minor findings from the per-task review lanes of the Settings slice
(`docs/superpowers/plans/2026-11-04-superuser-settings.md`), kept for later.

Sorted 2026-11-12: only items a person using the site can meet, and open calls, remain; test and comment nits were dropped and screen-reader items moved to beta-voiceover-pass.md.

## Whole-branch review

- **Won't fix (user, 2026-11-15): the PIN email ignores the queue's back-off**,
  so each "Send PIN" tries a refused login again. A PIN is needed now, and
  skipping it during the wait could lock people out after the server
  recovers; the 3-per-hour PIN limit caps the tries.
- **Curly quotes around a From name get the quotes sentence**:
  `“Mathion, AAU” <m@uni.dk>` reads "Put a name with a comma or colon in
  quotes." although they did. Accept curly quotes, or say "straight quotes".
- **A From name with `@ ; [ ]` and no comma gets the general format
  sentence** (`Mathion @ AAU <m@uni.dk>`), not the quotes hint.

## Minors round, Task 1 review (2026-11-15)

- **A 421 to smtplib's RSET is lost.** After a refused message smtplib sends
  RSET and drops the reply, so a server that hangs up there (an error limit
  below the batch of 20, e.g. Postfix's `smtpd_hard_error_limit` lowered under
  stress) gives the next message `SMTPServerDisconnected`: it is charged one
  try, the card shows nothing about it and the queue doesn't wait. A fix that
  makes RSET raise on a 421 must keep the earlier refusal (the recipient or
  body refusal, any code but 421) as that message's failure.
- **A refused DATA command leaves the transaction open.**
  smtplib's `data()` raises before `sendmail` can send RSET, so after a 4xx/5xx
  (not 421) to DATA itself the next message's MAIL FROM may get "503 nested
  MAIL command", read as a refused sender: wrong card line and a back-off.
  Not checked against a real server.
