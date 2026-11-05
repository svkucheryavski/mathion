# Superuser Settings: deferred minors

Minor findings from the per-task review lanes of the Settings slice
(`docs/superpowers/plans/2026-11-04-superuser-settings.md`), kept for later.

## Task 1 (data, copy and seal)

- A 0 or negative MATHION_MAX_FILE_SIZE / MATHION_MAX_COURSE_SIZE silently
  becomes 1 MB with no printed line.
- The "MATHION_MAX_COURSE_SIZE is below the largest file" line doesn't show
  the old value.
- A password is copied (sealed) even when the username is empty; harmless
  (the mailer only logs in with a username), but it's kept.
- The `rerun` migration-test fixture has no try/finally: a failed upgrade
  leaves the test schema one revision back for the rest of the session.
- alembic `env.py` builds `Settings()`, so D2a ("no value in .env can make
  the migration fail") only fully holds once Tasks 2 and 3 drop the old keys
  from `Settings`.
- Never `asdict(SiteSettingsView)` into a response: the view carries the
  sealed password.
- `int()` accepts forms like "1_000" and " +5 "; the copy takes them.
- A username the copy drops (over 254 characters or not valid UTF-8)
  leaves email on with no login, and the password stays sealed. A dropped
  host is already copied as off; a dropped username should be too.
- After `_text` drops an over-long host or From, the next line says "is
  empty" / "is not set", which contradicts "is not copied".
- The "not a number" line for a byte limit prints the default in bytes
  (20971520), not in MB. Every note also echoes the whole raw value, so a
  5000-digit size prints a 5000-character line.
- A MATHION_SECRET_KEY that isn't valid UTF-8, with a password set, still
  makes the migration raise in `_seal_v1`. No such install can sign anyone
  in today (`hash_token` encodes the same key), but the D2a wording covers it.
- `load()`'s `begin_nested()` flushes the caller's pending changes and costs
  two round trips per call; Task 2's readers should call it before they
  stage writes.
- Test gaps:
  - no test pins "only UndefinedTable is swallowed" (an UndefinedColumn case);
  - `test_copy_smtp_without_from_keeps_sending` doesn't check the cert box
    or the two D10a times;
  - no migration test with a password over 32 bytes (a multi-block seal);
  - no test that flips a nonce byte.

## Task 2 (limits and sign-in rules)

- The minutes in the PIN email and in `mathion pin`'s output come from a
  second `load(db)` right after the PIN is committed. A save in between makes
  the text disagree with the PIN's real expiry. Fix: return the minutes from
  `request_pin`. The bootstrap command also clears wrong tries in its own
  commit; it could do that before `request_pin`, in one commit.
- `/verify-pin` loads the settings row twice (`api_verify_pin`, then
  `verify_pin`).
- Test gaps:
  - `test_login_pin_delivery` checks `task.args[2] == 10`, the default; no
    test checks the email's "It expires in N minutes." against a saved value;
  - only course files test "exactly the limit is accepted"; run files (POST,
    PUT), submissions and evaluations don't;
  - no test pins the wrong-try limit on an operator PIN;
  - `"Max-Age=86400" in set-cookie` is a substring check (864000 would match);
  - `test_config_without_a_row_reports_the_defaults` depends on the shell's
    MATHION_DEBUG (it should pin `settings.debug`);
  - `test_course_asset_read_is_bounded` proves MB+1 was read, not that
    nothing larger was.
- `test_auth.py` imports mid-file with underscore aliases (E402).

## Task 3 (email follows the panel)

- The `run-*.sh` dev scripts don't set `MATHION_DISPATCHER_LOCK_PATH`. The
  loop and lock now start at every boot, so a second dev server on the same
  host (or a probe beside the user's own) refuses to start. D10 says the plan
  handles this; give each script its own lock path before the Safari pass.
- `off_interval_for`: with email on, `email_off_at` set and `email_on_at`
  NULL, the filter has no upper bound, so nothing is ever sent, and nothing
  says so. Only a turn-on that forgets to stamp `email_on_at` reaches it.
  Task 4 must stamp it. Then treat that state as "no interval", or log it once.
- `describe()` sentences that misname the failure:
  - `SMTPNotSupportedError` from `login()` (a server without AUTH) or for
    SMTPUTF8 says "The secure connection … failed.";
  - a banner timeout that smtplib wraps as a disconnect says "Couldn't reach".
- In `file` mode, a disk `OSError` from `FileMailer` is stored and logged as
  "Couldn't reach  on port 0.", with no traceback. Describe only failures
  from an `SMTPMailer`.
- The dev modes' queue mail uses `DEFAULT_FROM` (the mailer is built once at
  boot), while the PIN email in the same mode uses the saved From.
- `_send_login_pin`'s `logger.exception` for non-SMTP failures can log a
  `UnicodeEncodeError` that names one character of a copied non-ASCII
  password and its position. This is pre-existing; D7 blocks new ones.
- A temporary 4xx reply to MAIL FROM (a provider's sending limit) arrives as
  `SMTPSenderRefused`, so the card says "The mail server refused <from> as the
  sender." and sends the superuser to fix a From that is fine. Stopping and
  backing off is right. For 4xx codes, say "The mail server asked Mathion to
  try again later."
- A 421 refused recipient closes the connection. The next message is charged
  for the disconnect before the batch stops, so one extra retry is charged.
- The failure line clears only after a message is sent. Consider also
  clearing it after a good session start that sends nothing (every row
  skipped or failed per message).
- `FileMailer._allowed_kinds`: the comment says the lazy import isn't a cycle
  break. It is now, since `templates.py` imports `DEFAULT_FROM` from
  `mailer.py`.
- `main.py`: `if task is not None` is dead now that the loop always starts,
  and `lock_fd = None` is reassigned on the next line.
- `SmtpFailure.batch_level` (session start) and `stops_the_batch` (mid-send)
  disagree by design, and nothing reads the field. Document it or drop it.
- `_fresh_row` calls `get_row(db)` only to make sure the row exists; the
  tick can't reach it without a row, so that's one extra SELECT.
- Test gaps:
  - no `SMTP_SSL` + skip-cert test;
  - no test that a tick with no rows leaves `send_failure_*` alone;
  - `test_late_commit_in_off_interval_not_sent` doesn't straddle a real
    transaction; the name over-claims;
  - the PIN off test doesn't assert that `build_mailer` gave None for
    `mode="smtp"`.

## Task 4 (the Settings API)

- After the 20 s answer, a retry can get "A test is already running." for as
  long as smtplib's per-step timeouts take: 20 s per step and per address of
  the host. A hostile server can drip bytes for longer. The sentence could say
  the last test is still finishing.
- If the endpoint's own `_record_test` fails on the timeout path (a database
  error), the answer is a 500 instead of the sentence.
- A thread that dies before settling would be reported as the 20 s timeout.
  Today every exit path settles.
- Host and username aren't checked for spaces or control characters. The
  dialog's single-line inputs can't send a newline, but the API accepts one,
  and it would reach log lines and sentences.
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
- `_from_problem`: the mailbox-count and `addr_spec` lines have no test of
  their own (other parts catch the same values). An NBSP in the local part
  would pin the `addr_spec` line.
- `parseaddr` accepts some odd Froms ("(comment) a@b.dk", a trailing comma).
  A From over 320 characters gets the format sentence, not a length one.
- A spaces-only password is accepted. The password has no length cap.
- Saving with email off still type-checks the whole body, so Task 5 should
  send `{"on": false}` alone. The API accepts email saves in the `file` and
  `memory` modes; the UI can't reach that.
- The encryption names are repeated (`ENCRYPTIONS`, `SmtpEncryption`), and the
  sentence styles vary.
- Test gaps:
  - no test that smtplib gets `timeout=20` (the fake ignores it);
  - the bad-token 404 is checked only on GET;
  - the off-save test sends no password;
  - nothing tests that no row lock is held during a test, or that the lock is
    released after a recording failure;
  - D10a's interval edges (`created_at == off_at`, a second toggle).
- D10a: a notification created during the turn-on's own milliseconds (its
  transaction started after the save's `now()`) is neither marked nor left out,
  so it's sent. A later off/on doesn't mark it either. Fix: at turn-off, mark
  the closing interval's unsent rows too.
- A non-ASCII username passes, and the test then says "Sending failed
  (UnicodeEncodeError).", which nobody can act on. Give the username the
  printable-ASCII check.
- If the thread is mid-record when the 20 s join ends, the dialog's answer
  arrives a few milliseconds before the commit. The card shows it on the next
  load.
- A From copied by the migration (D2) isn't checked: a non-ASCII address on a
  relay without SMTPUTF8 fails every message, one by one, as "secure
  connection failed". Add `SMTPNotSupportedError` to `_STOP_MID_SEND`, so it
  becomes D9c's batch stop with the card's red line, and give it its own
  sentence (see Task 3's describe() line). Saving from the dialog fixes it.
- `_send_login_pin` and the dispatcher still use `logger.exception` for
  non-SMTP failures. The test endpoint now logs those by class only; do the
  same there (see Task 3's line on this).
