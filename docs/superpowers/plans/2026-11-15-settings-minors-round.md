# Settings Minors Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the seven items the 2026-11-15 walk kept: four mail-sending sentences and queue rules, two From-field messages, and the roster's bulk banner. Each item's bullet leaves `docs/backlog/superuser-settings-debt.md` in the commit that fixes it.

**Architecture:** Three tasks, one per area. Task 1 changes the mail path (`smtp_errors`, `mailer`, `dispatcher`, the PIN send). Task 2 changes the From check. Task 3 changes the roster banner. They share no code. New exceptions are subclasses of `smtplib.SMTPException`, so they count as `SMTP_FAILURES` and reach `describe()` on every path that already reads a mail failure: the Settings test, the queue and the PIN email.

**Tech Stack:** FastAPI + Postgres 17 (pytest, real `smtplib` against the `_stub` socket server in `backend/tests/test_smtp_errors.py`), Svelte 5 runes + TypeScript (vitest, jsdom).

**Spec:** the user's calls from the walk, copied below (record: `.superpowers/sdd/2026-11-15-settings-minors-walk/calls.md`). Design context: `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (rev 11: D7b From, D9/D9c sentences and batch stops, D9d sender lines). Tasks 1 and 2 each add a spec revision that records their calls.

## Global Constraints

**Rules (the user's):**
- Branch `feat/settings-minors-round` off `main` `e43a091`. No push or merge without the user. Stage exact paths with `git add --pathspec-from-file=<list>`, never `-A`. Never stage `logo.png` or `favicon.svg`.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no session line. Commit only on the user's OK.
- Stay inside the repo, absolute `cd` only. Scratch in `$SDD` = `.superpowers/sdd/2026-11-15-settings-minors-round/` (`tmp/`, `shots/`), never /tmp.
- Python only via `backend/.venv`. No new packages. Svelte 5 runes; tests use mount/unmount/flushSync.
- Code comments: one short plain line.
- Browser checks: run them in agent-browser myself; hand the user only what needs real Safari, and never ask about a focus ring after a mouse click.

**The user's calls (copy is verbatim):**
- C5a: a STARTTLS reply that isn't 220 (e.g. `454 TLS not available`) reads `The secure connection to {host} failed.` plus the existing port hint, and stops the batch. A 421 when the session opens (greeting, EHLO, STARTTLS, login, also when the server hangs up after a login 421) reads `The mail server asked Mathion to try again later.` (review rounds 4-6).
- C5b: "No suitable authentication method found." from `login()` reads `The mail server offers no login method Mathion can use.` and stops the batch.
- C9: a username smtplib can't send (non-ASCII, copied from `.env` by D2) reads `The username can't contain letters like æ, ø or å.` on the Email card, the same sentence as the Edit email dialog's. Stops the batch.
- C10 (changed by the user in Task 1 review r3, 2026-11-15): a 421 at RCPT or after the body ends the batch and starts the back-off; its message is charged one try, so a message the server always closes on fails out. The card reads `The mail server asked Mathion to try again later.`
- C11: a PIN email that got past the sender (recipient or body refused) clears a stored sender-side line, as the queue does.
- C7: curly quotes `“ ”` in From are taken as straight `"`, before checking and before saving.
- C8: a From name before `<` with any of `, : ; @ [ ]` outside quotes (and no address in it) gets the quotes hint, now worded `Put a name with symbols like , : ; @ [ ] in quotes.`
- C12: when a whole bulk request fails, the roster banner reads `{Verb} {n} of {total} — {f} failed, {c} cancelled. {reason}` with `reason = failureText(error, SERVER_ERROR_MESSAGE)`; the raw error is kept, so offline gives `OFFLINE_MESSAGE`. The hover hint, when present, still follows.

**Suites (green = all four):**
- backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo $?` gives 0.
- frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp npm test > $SDD/tmp/vitest.log 2>&1; echo $?` gives 0, and `grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log` gives 0.
- svelte-check: 0 errors (11 warnings today).
- gate: `TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh` from `frontend/` passes all 3058 checks.

**Per-task loop:** RED tests seen failing (any test green on its first run is mutation-checked) → implement → suites → Opus (general-purpose, effort high; may mutate and restore) and Fable (read-only, runs the gate) review the UNCOMMITTED diff; never edit while a review runs; fix every finding and re-review until both are clean → user OK → commit exact paths → ledger + memory → wait for "go".

## Review Focus

- **Real smtplib shapes.** C5a, C5b, C9 and C10 key on how smtplib raises: a non-220 to STARTTLS is a plain `SMTPResponseException`, a failed method match is a plain `SMTPException`, a non-ASCII login is `UnicodeEncodeError`, and a 421 at RCPT closes the socket and raises `SMTPRecipientsRefused`. Task 1 drives real `smtplib.SMTP` against `_stub` for all four, not only hand-made exceptions.
- **Subclasses must not be swallowed.** `SMTPAuthenticationError`, `SMTPNotSupportedError` and `SMTPServerDisconnected` from `starttls()`/`login()` keep their own sentences. Only the exact plain classes are re-raised as the new ones. Task 1 tests each subclass still passes through.
- **421 elsewhere.** A 421 to MAIL FROM is already `SMTPSenderRefused` → TRY_LATER. A 421 from the PIN path's send must also reach the card as a batch-level TRY_LATER, not as "refused to send to".
- **Curly quotes in the saved value.** The stored `email_from` must hold straight quotes, so the queue's From and the PIN's From are the same as the tested one. A lone `“` (unbalanced) must still fail the way an unbalanced `"` does.
- **The roster banner for a move.** The `move` path builds the same banner. Both remove and move get the reason, and the retry links and their labels don't change.

---

### Task 1: Mail sentences and the queue (C5a, C5b, C9, C10, C11)

**Files:**
- Modify: `backend/mathion/notifications/smtp_errors.py` (new exceptions, sentences, `describe`, `stops_the_batch`)
- Modify: `backend/mathion/notifications/mailer.py:96-116` (`SMTPMailer.session`)
- Modify: `backend/mathion/notifications/dispatcher.py:497,515` (rename `_record_connected` → `record_connected`)
- Modify: `backend/mathion/api/auth.py:75-131` (`_send_login_pin`)
- Modify: `backend/mathion/api/superuser_settings.py:59` (import `USERNAME_ASCII` instead of its own copy)
- Modify: `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (rev 12 line: D9 C5a, C5b, C9; D9c C10; D9d C11)
- Modify: `docs/backlog/superuser-settings-debt.md` (delete the four bullets: session-start reply, non-ASCII username, 421, PIN recipient refused)
- Test: `backend/tests/test_smtp_errors.py`, `backend/tests/test_notifications_mailer.py`, `backend/tests/test_dispatcher_settings.py`, `backend/tests/test_login_pin_delivery.py`

**Interfaces:**
- Produces in `smtp_errors.py`:
  - `class StartTlsRefused(smtplib.SMTPResponseException)`
  - `class NoLoginMethod(smtplib.SMTPException)`
  - `class UsernameNotAscii(smtplib.SMTPException)`, `class PasswordNotAscii(smtplib.SMTPException)`
  - `class LoginClosing(smtplib.SMTPResponseException)` (review round 6)
  - `NO_LOGIN_METHOD = "The mail server offers no login method Mathion can use."`
  - `USERNAME_ASCII = "The username can't contain letters like æ, ø or å."`
  - `SAVED_NOT_ASCII = "The saved password has characters that can't be sent: type it again."`
  - `closing(exc) -> bool`: a 421 at RCPT or DATA (public, the dispatcher charges it)
- Produces in `dispatcher.py`: `record_connected(db, view, *, past_sender: bool) -> None` (the renamed `_record_connected`, same body).

- [ ] **Step 1: Write the failing tests**

`test_smtp_errors.py` (real smtplib against `_stub`):
- `test_starttls_refused_says_secure_connection_failed`: the stub answers EHLO with `250-stub\r\n250 STARTTLS`, then `454 TLS not available`. `SMTPMailer("127.0.0.1", port, "starttls", "", "", True, timeout=5).session()` raises `StartTlsRefused`. `describe(..., host="mail.uni.dk", port=587, encryption="starttls")` gives `("The secure connection to mail.uni.dk failed.", True)` for `(sentence, batch_level)`.
- `test_no_login_method_says_so`: the stub offers only `250 AUTH XOAUTH2`. On a real `smtplib.SMTP` client to it, `SMTPMailer._login(client, "u@uni.dk", "pw")` (Step 3) raises `NoLoginMethod`, and `describe` gives `(NO_LOGIN_METHOD, True)`. (A login needs STARTTLS or SSL in a full session, D7, so the test calls `_login` directly.)
- `test_non_ascii_username_says_so`: `SMTPMailer._login(client, "søren@uni.dk", "pw")` against an `AUTH PLAIN` stub raises `UsernameNotAscii`, and the stub sees no AUTH line. `describe` gives `(USERNAME_ASCII, True)`.
- `test_421_at_rcpt_stops_the_batch`: the stub answers RCPT with `421 closing`. `client.sendmail(...)` raises `SMTPRecipientsRefused`. `stops_the_batch(exc, sender=...)` is True and `describe(...).sentence == TRY_LATER`. The same for a 421 after DATA (`SMTPDataError(421, b"x")`, hand-made is fine here).
- Extend `test_what_stops_a_batch_mid_send` with `(smtplib.SMTPRecipientsRefused({"a@b.dk": (450, b"x")}), False)` so only 421 stops.

`test_notifications_mailer.py`:
- `test_auth_subclasses_pass_through`: `login` raising `SMTPAuthenticationError(535, b"x")`, `SMTPNotSupportedError("AUTH")` or `SMTPServerDisconnected("x")` reaches the caller as that same class.

`test_dispatcher_settings.py`:
- `test_a_421_charges_its_message_stops_and_backs_off` (RCPT and DATA, per the changed C10): with three rows and the 421 on the second, r1 is sent, r2 has `retry_count == 1` and waits 5 minutes, r3 is untouched, the card reads TRY_LATER and the back-off is at step 1. Also `test_a_421_on_the_last_try_fails_the_message_out`.

`test_login_pin_delivery.py`:
- `test_refused_recipient_on_a_pin_email_clears_a_sender_line`: `set_site(send_failure_message="The mail server refused m@uni.dk as the sender.", …)`, and the mailer raises `SMTPRecipientsRefused` (550). After request-pin, `_card(db)[0] is None`.
- `test_421_on_a_pin_email_says_try_later`: the mailer raises `SMTPRecipientsRefused({"real@example.com": (421, b"x")})`. The card reads TRY_LATER.
- Keep `test_refused_recipient_on_a_pin_email_leaves_the_card` as it is: with nothing stored, nothing is written.

- [ ] **Step 2: Run them and see each fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_smtp_errors.py tests/test_notifications_mailer.py tests/test_dispatcher_settings.py tests/test_login_pin_delivery.py`
Expected: the new tests FAIL (ImportError for the new names counts, but `_login` and the 421 tests must each fail on their own assertion once the names exist).

- [ ] **Step 3: Implement**

- `smtp_errors.py`: add the five classes, three constants and `closing` (Interfaces). In `describe`, before the generic branches: any `SMTPResponseException` with code 421 → `TRY_LATER`, True (rounds 4-6); other `StartTlsRefused` → the secure-connection sentence with `hint`, batch True; `NoLoginMethod` → `NO_LOGIN_METHOD`, True; `UsernameNotAscii` → `USERNAME_ASCII`, True; `PasswordNotAscii` → `SAVED_NOT_ASCII`, True; `SMTPRecipientsRefused`/`SMTPDataError` with `_code(exc) == 421` → `TRY_LATER`, True. `stops_the_batch` is also True for that 421 case.
- `mailer.py`: add `@staticmethod _login(smtp, username, password)`. It raises `UsernameNotAscii` when `not username.isascii()` and `PasswordNotAscii` when the password isn't ASCII, calls `smtp.login`, and re-raises a plain `SMTPException` (`type(exc) is smtplib.SMTPException`) whose text starts "No suitable authentication method" as `NoLoginMethod() from exc`. It wraps `smtp.auth` on the connection so a 421 raises `LoginClosing` (an `SMTPResponseException`), which `login()` doesn't swallow (round 6). `session()` likewise wraps `smtp.ehlo` (`_stop_on_421`) so a 421 to any EHLO raises `SMTPHeloError` instead of smtplib sending HELO on the closed socket (round 7). Both wrappers live as long as the connection, which each session opens anew. `session` uses it. `starttls` is wrapped so a plain `SMTPResponseException` (`type(exc) is ...`) becomes `StartTlsRefused(exc.smtp_code, exc.smtp_error) from exc`.
- `dispatcher.py`: rename to `record_connected` (one caller, line 497).
- `auth.py`: in the `SMTP_FAILURES` branch, when `sending` and the exception is `SMTPRecipientsRefused` or `SMTPDataError` and no card was recorded, call `record_connected(db, site, past_sender=True)` in its own session, skipped in `DEV_MODES` like `_record_on_card`.
- `superuser_settings.py`: `_USERNAME_ASCII` becomes the imported `USERNAME_ASCII`.
- Spec rev 12 line and the four debt bullets deleted.

- [ ] **Step 4: Run the tests, then the suites**

Run the Step 2 command. Expected: all pass. Then the four suites from Global Constraints.

- [ ] **Step 5: Review loop, then commit on the user's OK**

`fix(email): clearer session-start sentences, 421 ends the batch, PIN clears a passed sender line`

---

### Task 2: The From field (C7, C8)

**Files:**
- Modify: `backend/mathion/schemas.py:1284-1289` (`EmailTestIn._trim`, which also feeds `EmailSettingsIn`)
- Modify: `backend/mathion/api/superuser_settings.py:57,124-130` (`_FROM_QUOTES` text; the name check's character set)
- Modify: `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (rev 13 line: D7b C7, C8; the Rev 8 paragraph's sentence updated)
- Modify: `docs/backlog/superuser-settings-debt.md` (delete the curly-quotes and `@ ; [ ]` bullets)
- Test: `backend/tests/test_superuser_settings.py`

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing tests**

- `QUOTES` in the test module becomes `"Put a name with symbols like , : ; @ [ ] in quotes."`
- `test_curly_quotes_are_straightened`: saving `“Mathion, AAU” <m@uni.dk>` gives 200 and `_view(db).email_from == '"Mathion, AAU" <m@uni.dk>'`. `_test(...)` with the same value is not refused with a 422.
- `test_a_lone_curly_quote_fails_like_a_straight_one`: `“Mathion, AAU <m@uni.dk>` gets the same status and sentence as `"Mathion, AAU <m@uni.dk>`.
- `test_from_with_symbols_needs_quotes`, parametrized over `Mathion @ AAU <m@uni.dk>`, `Mathion; AAU <m@uni.dk>`, `Mathion [AAU] <m@uni.dk>`, `Maths@AAU <m@uni.dk>`: both `_email` and `_test` give `(422, QUOTES)`.
- Their quoted forms (`"Mathion @ AAU" <m@uni.dk>`, and so on) are added to `test_good_from_accepted`.

- [ ] **Step 2: Run them and see each fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_superuser_settings.py -k "quote or from"`
Expected: the new and changed tests FAIL.

- [ ] **Step 3: Implement**

- `_trim` (for `from_address` only) maps `“` and `”` to `"` after trimming. Use a separate validator if that reads more simply.
- `_FROM_QUOTES` takes the C8 text. The name check becomes `any(c in ",:;@[]" for c in name)` in the `<` branch only. The no-`<` branch keeps `",:"`.
- Spec rev 13 and the two debt bullets deleted. Only the won't-fix bullet stays in the file.

- [ ] **Step 4: Run the tests, then the suites**

- [ ] **Step 5: Review loop, then commit on the user's OK**

`fix(settings): curly quotes in From, and the quotes hint for any symbol in a name`

---

### Task 3: The roster's bulk banner (C12)

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte:26-30` (the `error` field's type becomes `unknown`), `:208-219` (`summaryText`), `:299,321` (keep the raw error)
- Test: `frontend/src/tests/RunRosterTab.table.svelte.test.ts`

**Interfaces:** consumes `failureText`, `SERVER_ERROR_MESSAGE` and `OFFLINE_MESSAGE` from `lib/api.ts` (unchanged).

- [ ] **Step 1: Write the failing tests**

- The cancelled-move test (line 413-419): its mock's detail becomes `'Something broke.'`, and the banner reads `'Moved 0 of 3 — 0 failed, 3 cancelled. Something broke.'`.
- `cancelled remove, offline`: `bulk-delete` rejects with `new TypeError('Failed to fetch')`. The banner reads `'Removed 0 of 3 — 0 failed, 3 cancelled. ' + OFFLINE_MESSAGE`.
- `cancelled remove, 409`: `jres({ detail: 'This run has ended.' }, 409)`. The banner ends with `'cancelled. This run has ended.'`.
- `cancelled with marked rows keeps the hover hint`: 201 selected rows. The first chunk (200) returns one row error, and the second chunk's request fails with a 500 and `{ detail: 'Something broke.' }`. The banner ends with `'cancelled. Something broke. Hover a marked row for the reason.'`.

- [ ] **Step 2: Run them and see each fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-11-15-settings-minors-round/tmp TZ=Europe/Copenhagen npx vitest run src/tests/RunRosterTab.table.svelte.test.ts`
Expected: the four tests FAIL on the banner text.

- [ ] **Step 3: Implement**

`chunkLevelError` holds the caught value as is (`unknown`). The cancelled line is ``${verb} … — ${f} failed, ${c} cancelled. ${failureText(r.error, SERVER_ERROR_MESSAGE)}${hint}``.

- [ ] **Step 4: Run the test file, then the suites**

- [ ] **Step 5: Browser check in agent-browser (Chrome), no user step**

Fail a bulk remove (500, then offline via `agent-browser set offline on`) and read the banner. Shots go to `$SDD/shots/`.

- [ ] **Step 6: Review loop, then commit on the user's OK**

`fix(roster): the bulk banner says why a request was cancelled`
