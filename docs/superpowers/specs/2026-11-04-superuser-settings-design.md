# Superuser panel: Settings — design

**Status:** rev 6, 2026-11-05.
- Rev 2 folded in the builder check: D2a, D7a, D8a, D11b, the lower file ceiling in D11, and the user's D10a.
- Rev 3 folds in spec review round 1, three lanes (`.superpowers/sdd/2026-11-04-superuser-settings/spec-r1-*.md`), and the user's answer on the upload ceiling (D11c). New or changed:
  - **D10b:** every email reader is listed;
  - **D2/§6:** the copy runs in the migration, and a missing row means defaults;
  - **D10a:** `email_on_since`;
  - **D7b:** the From address is checked;
  - **D9b:** log redaction;
  - **D12:** a longer sign-in is shortened, not refused;
  - **D14:** server and CLI text;
  - **D11c:** the proxy cap.
- Rev 4 folds in spec review round 2, two lanes (`spec-r2-opus.md`, `spec-r2-fable.md`), and the user's new upload ceiling of 50 MB (D11, D11c). New or changed:
  - **D10a:** the off interval replaces `email_on_since`;
  - **D2:** the From for a copied "on";
  - **D9a:** the keyed fingerprint;
  - **D9c:** the exhaustive list;
  - **D9d:** the card shows a stuck queue;
  - **D10c:** the dev modes;
  - **D12:** PIN request floor 3, and `mathion pin` skips the request limit;
  - **D11c:** the release order.
- Rev 5 folds in spec review round 3 (`spec-r3-opus.md`, `spec-r3-fable.md`). New or changed:
  - **D9a:** a test of the saved settings reaches the card;
  - **D9c:** a disconnect stops the batch, and the queue backs off;
  - **D10:** the queue's seam;
  - **D10a:** the epoch, never `-infinity`;
  - **D11c:** image first, then the CLI;
  - **D7c:** an "off" save writes only the switch;
  - **D12:** `mathion pin` clears the wrong-try count.
- Rev 6 records what the build, its reviews and the user's rulings settled (plan `docs/superpowers/plans/2026-11-04-superuser-settings.md`, ledger `.superpowers/sdd/2026-11-04-superuser-settings/progress.md`). New or changed:
  - **D7b:** the final From check (an ASCII address, any line break refused, a message built and read back);
  - **D9a:** a passing test of the saved settings clears the card's red line and the queue's wait;
  - **D9c:** a refusal after the message body is retried per message, never failed at once (the user's ruling);
  - **D9d:** the card's line for refusals after the body, and the PIN email reaches the card;
  - **D11a:** a proxy's 413 shows its sentence on every upload screen;
  - **D11c:** the bundled proxy's two timeouts, and what a proxy refusal shows (Safari pass).

**Builds on:** `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (panel pages, dialogs, D25 errors) and `docs/superpowers/specs/2026-07-11-superuser-panel-slice-1-design.md` (panel access and shell).

**Source of the requirement:** platform spec §8, `docs/superpowers/specs/2026-04-19-mathion-platform-design.md:554` ("Settings: SMTP, file limits, session durations, system defaults").

**Mockups:** `.superpowers/sdd/2026-11-04-superuser-settings/`
- `settings-mock.html`: the page, the email-off card, the Edit email dialog ("Looks good"). Since then the dialog has gained the certificate box (D7a).
- `logo-fit.html`: how the user's logo fits the header. It belongs to the Branding project (§7), not this one.

## 1. Why

Email, file limits and sign-in rules live in the server's `.env` (`backend/mathion/config.py:8-40`). To change one, someone edits the file on the server and restarts Mathion. Email starts out off (`MATHION_EMAIL_MODE=disabled`, written by `cli/internal/config/env.go:29`). So a fresh install sends no sign-in PINs, and its login page has no "Send PIN" step (`Login.svelte:89-103`), until someone who knows the file turns email on. That blocks a real beta.

This slice adds the panel's **Settings** page. A superuser sets up email, tests it, and adjusts file limits and sign-in rules from the browser. A change takes effect at once, with no restart.

## 2. Goals, non-goals, anti-goals

**Goals**
- Turn email on and point it at the institution's mail server: STARTTLS on 587 with a login, SSL/TLS on 465, or a campus relay on 25 without a login. From then on the login page emails PINs.
- Send a test email before saving, and see in plain words why it failed.
- Set the largest file (up to 50 MB, and the bundled proxy lets it through, D11c), the total files per course version or run, and the sign-in rules.
- One place per setting: after the update to this version, the panel is the only place these values are set.

**Non-goals (later slices or never)**
- Branding: the logo image, the site name, the theme `.css` file. That's the next project (§7).
- The first-login setup checklist: the slice after Branding.
- Editing the site address in the panel (D3).
- Server wiring in the panel: database, secret key, asset path, cookie and debug flags, version, HTTPS.
- Streaming uploads to disk, which would allow much larger files (D11).
- A history of who changed which setting (D13).

**Anti-goals (would make it a failure even if it works)**
- A setting saved in the panel locks the superuser out. The address can't be edited for this reason (D3), the request and wrong-try floors are 3, and `mathion pin` skips the request limit (D12), and no setting can stop the panel itself from loading.
- The mail password leaks:
  - to the browser;
  - to a log line or an error sentence (D9b);
  - to a server it wasn't saved for (D8a);
  - in clear text in a database backup (D8).
- An update fails or loses a value on an existing install. The `.env` values must arrive in the panel unchanged, apart from D2a's clamping.
- Lowering a limit deletes or hides files that are already there.
- Changing a sign-in rule signs anyone out, or makes a person with a valid PIN fail to sign in (D12).
- Turning email on floods people with old notifications (D10a).

## 3. Decisions

Each decision is marked as the **user's** or **mine** (a call a sensible builder could also make; the user can overrule it).

### Where settings live

- **D1. What moves into the panel** (user's). These are edited in the panel:
  - email, its on/off state included;
  - the largest file and the total files per course version or run;
  - how long a PIN lasts, PIN requests per hour and wrong PIN tries per hour;
  - the longest sign-in.

  Everything else in `config.py` stays in `.env`.
- **D2. Copied once, in the migration** (user's: copy once; mine: in the migration).
  - **Where the copy runs:** the Alembic migration that creates the settings table also copies the current `.env` values into it. It reads the variables raw from the environment, not through `Settings()`, so a bad value can't stop it (D2a). Both `mathion install` and `mathion update` run the migration with `.env` loaded (`cli/cmd/update.go:457-461`). The app's startup reads nothing from the table: a fresh install starts the app before migrating (`cli/cmd/install.go:155-160, 213-216`).
  - **What's copied:**
    - `MATHION_EMAIL_MODE`; `smtp` becomes "on", anything else "off";
    - `MATHION_SMTP_HOST`, `MATHION_SMTP_PORT`, `MATHION_SMTP_USERNAME` and `MATHION_SMTP_PASSWORD` (the password stored as D8 says);
    - `MATHION_EMAIL_FROM` when `.env` sets it. Without the key, the From depends on the copied mode:
      - a copied "on" gets the config default (`config.py:35`), which is what such a server sends with today, so it keeps sending, and the log says the From came from the default;
      - a copied "off" gets an empty From, because `noreply@mathion.test` is not a real address;
    - `MATHION_MAX_FILE_SIZE` and `MATHION_MAX_COURSE_SIZE`;
    - `MATHION_PIN_EXPIRY_MINUTES`, `MATHION_MAX_PIN_REQUESTS_PER_HOUR` and `MATHION_MAX_PIN_FAILURES_PER_HOUR`.

    A key `.env` doesn't set gets today's default. A byte limit that isn't whole MB is rounded up to whole MB. The longest sign-in starts at 30 days, today's longest. The copied encryption is STARTTLS, which is what Mathion uses today (`mailer.py:71`).
  - **The migration carries its own frozen copy** of D8's v1 encryption and of the defaults it needs (the From default, `config.py:35`, and today's numbers), so a later change to the app's code can't change what an old migration writes. It reads `MATHION_SECRET_KEY` raw, falling back to the dev default as `Settings` does.
  - **A missing row** (the table is empty or doesn't exist yet) means the defaults with email off. Every reader treats it that way, which also covers the test suite truncating tables after each test (`backend/tests/conftest.py:258-264`).
  - **After the copy,** these keys are ignored, and they come out of `Settings` (`config.py`). `MATHION_EMAIL_MODE` and `MATHION_EMAIL_OUTBOX` stay (D2c), so a typo in an ignored key can't stop startup. At startup, if `.env` still sets any ignored key (`MATHION_EMAIL_MODE` is never one, D2c), the server log says once: "These .env keys are ignored since this version; the panel's Settings page sets them: <keys>." It doesn't ask anyone to delete them.
- **D2a. Copied values that don't fit** (mine). Nothing in `.env` makes the migration fail.
  - **A number out of range** is clamped into D11's or D12's range, and the log names the key, the old value and the new one. For example, a 2 GB file limit becomes 50 MB.
  - **A value that isn't a number** gets the default, with the same kind of log line.
  - **A total below the largest file** is raised to the largest file.
  - **Email "on" without a usable setup:** a copied `smtp` mode without a mail server, or with a username but no password, is copied as off, with a log line naming what's missing.
  - **A broken login** is copied as it is and simply fails the next test or send.
- **D2b. The `mathion` CLI and deploy files** (mine). `GenerateEnv` (`cli/internal/config/env.go:18`) stops writing `MATHION_MAX_FILE_SIZE` and `MATHION_MAX_COURSE_SIZE` into a new `.env`, and `deploy/.env.prod.example` drops them. `MATHION_EMAIL_MODE=disabled` stays in both, because the mode is still read for D2c and `disabled` means "the panel decides". On an existing server nothing is removed. No CLI path adds missing keys to an existing `.env` today, and none starts to.
- **D2c. Developer modes stay in `.env`** (mine). `MATHION_EMAIL_MODE=file` or `memory` still wins over the panel, for development and tests. The Email card then shows "Email goes to a developer outbox (set on the server)." with no pencil. `smtp` and `disabled` in `.env` mean nothing after D2's copy, so D2's startup log line doesn't name the mode for `file` or `memory`.
- **D3. The site address stays on the server** (mine; the user agreed). Every sign-in link and the panel's own link are built from `MATHION_BASE_URL`. A wrong value saved in the panel couldn't be fixed from the panel. The Site card shows the address read-only: "Set on the server, because every link Mathion sends is built from it."

### The page

- **D4. A Settings pill and page** (user's). `/superuser/{token}/settings`, a fourth pill after Courses (`PanelPage` in `frontend/src/lib/superuser.ts` gains `'settings'`). The page has four cards in this order: Email, File limits, Sign-in, Site.
  - **While it loads:** a skeleton.
  - **If loading fails:** the panel's error state with the server's sentence (D25). The guard's 401 and 404 go to the shell, as on the other pages.
- **D5. Cards show; one pencil edits** (user's, from the panel's rule of one Edit dialog per row). Each card lists its current values. Its single pencil opens one Edit dialog with all of that card's fields. Nothing is edited in place. Site has no pencil (D3). Dialogs follow the Courses and Users dialogs:
  - Save is blocked until something changes;
  - the server's sentence shows inside the dialog (D25 of the Users/Courses spec);
  - Esc or Cancel closes without saving;
  - while Save runs, Cancel and Esc wait.

  After a save, the card shows the saved values.
- **D6. The Email card** (user's, as drawn). When on, it shows an "On" badge and these rows:
  - **Mail server:** host:port and the encryption, plus "certificate not checked" when D7a's box is ticked;
  - **Login:** the username and "password saved", "No login", or "password can't be read" (D8);
  - **From:** the From address;
  - **Last test:** the time and outcome of the last test of the settings now saved (D9a). It's red with the reason when that test failed (mine). It's absent when the saved settings were never tested.

  When off, it shows an "Off" badge and this sentence: "Email is off: sign-in PINs and notifications aren't sent. People can sign in only with a PIN you make on the server (`mathion pin <email>`)." In a developer mode it shows D2c's sentence.

### Email

- **D7. Connecting** (user's: all three). The Edit email dialog has:
  - **Send email**, a switch;
  - **Mail server** and **Port**;
  - **Encryption**, three segments: STARTTLS / SSL/TLS / None. Picking one sets the port to 587, 465 or 25. The port stays editable, from 1 to 65535.
  - **Username**, with the hint "Leave empty to send without logging in." An empty username means no login.
  - **Password**;
  - **From address**.

  Ports and logins map like this:
  - STARTTLS: connect, then `starttls()`;
  - SSL/TLS: connect with SSL from the start (`smtplib.SMTP_SSL`);
  - None: plain SMTP;
  - login only when the username is set.

  The username and password fields carry `autocomplete="off"` and `autocomplete="new-password"`, so a browser's saved login can't fill them and trip D8a (mine).

  **Rules for turning email on** (mine):
  - Turning email on needs the mail server and From address.
  - A username needs a password, typed or saved.
  - A password must be plain ASCII, because `smtplib` can't send other characters: "The password can only use plain letters, digits and symbols (no accents)."
- **D7a. Encryption and certificates** (mine, from the builder check).
  - **A login needs encryption.** With Encryption = None, a username is refused with "A login needs encryption: pick STARTTLS or SSL/TLS." A password must never cross the network in clear text.
  - **Certificates are checked.** STARTTLS and SSL/TLS check the server's certificate with `ssl.create_default_context()`. Today's `starttls()` checks nothing.
  - **An opt-out for campus relays.** For a relay with a self-signed or internal certificate, the dialog has one checkbox under Encryption: "Don't check the server's certificate".
  - **Copied settings keep today's behaviour.** D2's copy ticks the box only when the copied mode is `smtp`, because a server that sends today must still send after the update. On every other install, and for new settings, it starts unticked.
- **D7b. The From address is checked** (mine, from review; rev 6 gives the final check). On save and on test, the server refuses a From address that would fail every message later. The sentence is "The From address must look like Name <address@example.edu> or address@example.edu." when:
  - it has a line break of any kind (a Unicode one included, which a paste can carry) or a control character, is longer than 320 characters, or has unbalanced `<` `>`;
  - `email.utils.parseaddr` can't read a name and an address with an @ and no spaces;
  - a message built with it as From, flattened as smtplib sends it and read back, doesn't give exactly that one address, with a domain of letters, digits and hyphens between single dots.

  The address part must be plain ASCII, because most mail servers refuse any other (no SMTPUTF8): "The address in From can only use plain letters, digits and symbols: write an accented domain in its xn-- form." The display name may use any letters.
- **D7c. Turning email off** (mine, from review). The switch off keeps the saved server, login, password and From. Saving "off" writes only the switch, so a changed server can't be stored next to the old password without D8a's check. It checks nothing and needs no password, even one that can't be read. With the switch off, the dialog greys the other fields and hides Send test email.
- **D8. The password** (mine; the user agreed). It's never sent to the browser.
  - **The field:** it's always empty. When a password is saved, the placeholder says "Saved: type a new one to replace it". When none is saved, it's blank with no placeholder. Leaving it empty keeps the saved one. Clearing the username drops it (mine).
  - **Storage:** it's stored encrypted with keys derived from `MATHION_SECRET_KEY`. Mathion's backups contain the database but not `.env` (`cli/cmd/backup.go`), so a leaked backup doesn't reveal the password. With the dev default secret key, this protects nothing, which is fine for dev only. Production refuses to boot on that key.
  - **Construction** (no new package, §4):
    - the keystream is HMAC-SHA256 in counter mode over a random 16-byte nonce;
    - two keys come from the secret key with distinct labels (HMAC-SHA256 of the secret over each label): one for the keystream, one for the tag;
    - the tag is HMAC-SHA256 over the version prefix, the nonce and the ciphertext. It's checked with `hmac.compare_digest` before anything is decrypted;
    - the stored text is `v1:` followed by base64 of nonce, ciphertext and tag.
  - **D8a. A saved password stays with its server** (mine, from the builder check and review). An empty password field means "use the saved one" only while the mail server and username are unchanged and D7a's box isn't newly ticked. Otherwise, a test or a save needs the password typed again: "Type the password again: the mail server, username or certificate check has changed." This way the saved password never goes to a server it wasn't saved for. Changing the port or the encryption alone keeps it.
  - **When it can't be read:** if the tag doesn't verify (for example, a restore onto a server with another secret key):
    - the dialog says "The saved password can't be read on this server: type it again.";
    - the card's Login row says "password can't be read";
    - a send fails with that reason, and the queue treats it as D9c's server-side failure. The server logs it once per saved change, not on every tick. While the password can't be read, `send_pin_enabled` (D10b) is false, so the login page doesn't offer a step that can't work.
- **D9. Send test email** (user's). The button at the dialog's bottom left sends one test message to the signed-in superuser's own address, using what's in the form now (D8a decides whether an empty password field means the saved one). The result shows above the buttons as one sentence:
  - success: "Sent to <email>: check your inbox.";
  - otherwise the reason, for example:
    - "The mail server refused the login.";
    - "Couldn't reach <host> on port <port>.";
    - "The secure connection to <host> failed.";
    - "The mail server's certificate couldn't be checked.";
    - "The mail server refused <from> as the sender.";
    - "The mail server refused to send to <email>.";
    - "The mail server didn't answer within 20 seconds.".

  **How it runs** (mine):
  - The test runs off the event loop.
  - `smtplib`'s own socket timeout is 20 s, and the whole test gives up after 20 s and answers with the last sentence. A thread can't be cancelled, so the socket timeout is what stops it.
  - One test at a time, on the server too: a second test while one runs is refused with "A test is already running." While one runs, the button shows a spinner. Save and Cancel stay usable.
  - The answer the dialog shows is the outcome recorded: when the 20 s answer goes out, a late result from the thread is discarded.
  - If the dialog closes mid-test, the test still finishes and records its outcome (D9a). The card shows it from the next load.
  - With SSL/TLS on port 587, or STARTTLS on 465, a failed connection adds "Port 465 usually means SSL/TLS, and 587 STARTTLS." to the sentence.
- **D9a. Saving doesn't need a passing test** (user's), because a mail server can be briefly down. Each test records its outcome with a fingerprint of what it tested: the mail server, port, encryption, certificate box, username, password and From (mine).
  - **The fingerprint is keyed:** an HMAC-SHA256 under a third key derived from the secret key (D8). A leaked backup then can't be used to guess the password offline.
  - **Two records are kept:** the latest test of any values, and the card's test.
    - When a test records, if its fingerprint equals the settings saved at that moment, it also becomes the card's test. So re-testing the saved settings, the usual first step after an update, reaches the card.
    - On save, if the latest test's fingerprint equals the new saved settings, it becomes the card's test. Otherwise the card's test is cleared.
    - A save made while a test runs is handled by the first of these when the test records.
  - The card shows the card's test. So the usual flow works: type, test, Save. Testing other values and pressing Cancel leaves the card's test alone.
  - **A passing test of the saved settings clears D9d's red line and the queue's wait** (rev 6, from the whole-branch review). It proves the saved settings work, so the superuser who fixed the server side needn't wait up to an hour. A failing test, or a test of other values, leaves both alone.
- **D9b. Nothing the mail server says reaches a log or the browser** (mine, from review). Some servers echo the credentials in their replies.
  - Every place that talks to the mail server goes through one helper that turns an SMTP failure into the error's class name, the SMTP code and D9's sentence, and logs only that. Those places are the queue (`dispatcher.py:163, 223-235`), the PIN email (`api/auth.py:63-69`) and the test.
  - The queue's stored `error` column gets the same text.
  - The settings endpoints don't echo their input in a 422 (FastAPI's default does), because the input may hold a typed password.
- **D9c. A failure on the mail server's side doesn't use up messages** (mine, from review). Today a refused sender is classed as permanent (`notifications/errors.py:15-17`), so with a bad From every queued message is marked failed for good (`dispatcher.py:216-235`).

  These failures, and only these, stop the batch and retry at the next tick without counting against any message:
  - failing to connect or start the session (today's session-acquire path, `dispatcher.py:155-165`);
  - a refused login (`SMTPAuthenticationError`);
  - a certificate or TLS failure;
  - an unreadable password (D8);
  - a refused greeting (`SMTPHeloError`);
  - a refused sender (`SMTPSenderRefused`).

  Everything else stays per-message with `classify()` (`notifications/errors.py`): a refused recipient, a missing referent or recipient email. A disconnect mid-batch counts against the message being sent and stops the batch, so the messages after it aren't charged a retry (today they are). This way one bad message can't freeze the queue.

  **A refusal after the message body is retried** (user's ruling, rev 6, 2026-11-05). Some servers accept the sender and only refuse once the body is sent, for example Microsoft 365's `554 5.2.252 SendAsDenied` when the login may not send as the From. Every `SMTPDataError` (4xx or 5xx) is transient: the message is tried again after 5 minutes, 30 minutes, 2 hours and 6 hours, and fails for good on its fifth try. It never holds up other messages, and it doesn't stop the batch or start the queue's wait. So a From refused this way (unlike a refused sender above) uses up each message after its five tries, about 8.5 hours, while the card says why (D9d). A recipient refused with a 5xx still fails at once, because it's usually that address's own problem; a 4xx one (greylisting) is retried.

  **The queue backs off after a D9c failure** (mine, from review). The next try waits 5 minutes, then doubles each time up to 1 hour, instead of every 30 s. A login refused every 30 s could trip a provider's lockout (Office 365, Google). A save of the email settings, a successful send, or a passing test of the saved settings (D9a) resets the wait.
- **D9d. The card shows a stuck queue** (mine, from review). When a D9c failure stops a batch, the queue stores its sentence and time with the settings. The Email card then shows a red line under Last test: "Sending is failing since <time>: <sentence>". A successful send clears it, and so do a save of the email settings and a passing test of the saved settings (D9a). It's logged once per change of sentence, not every tick.
  - **Refusals after the body** (user's ruling, rev 6). When a tick has at least one 5xx refusal after the body, no D9c failure, and nothing in it got through, the card shows the same red line with "The mail server refused a message: check that the login may send as <From>." (the saved From, never the server's text, D9b). Other per-message failures in the tick don't hide it. It starts no wait. The next message that gets through clears it, as do an email save and a passing test of the saved settings. A D9c failure in the same tick wins, with its own sentence and the wait.
  - **The PIN email reaches the card** (rev 6). A PIN email that fails on the server's side (D9c) or is refused after the body shows its sentence there too, and a PIN email that gets through clears the line. A refused recipient doesn't reach the card. A failing PIN email starts no wait (only the queue's own tick backs off), and one that gets through also resets the queue's wait. The PIN email still doesn't wait for the queue's back-off.
- **D10. When a change takes effect** (mine). At once:
  - the PIN email and the notification queue use the saved email settings from their next send;
  - a file limit applies from the next upload;
  - a sign-in rule applies from the next PIN or sign-in.

  The email queue's loop therefore starts at every boot, whether email is on or not (`main.py:86` only starts it when a mailer exists today).

  **The seam** (mine, from review). The loop (`run_forever`, `dispatcher.py:255`) reads the mode and the settings once per tick: a missing table or row means "off" (D2). It builds the mailer, and passes `tick()` the mailer and D10a's off interval. `tick()` stays a pure function of what it's given, and with no interval passed it behaves as today. The ~27 tests that call `tick(db, MemoryMailer(), …)` directly, under `MATHION_EMAIL_MODE=disabled` (`conftest.py:20`), keep working unchanged. The single-sender lock (`acquire_singleton_lock`) is now taken at every boot, so a second server process on the same host refuses to start even with email off. `test_lifespan_disabled_mode_no_lock` flips to match. Tests that boot the app (`test_startup_db_log.py`, `test_startup_secret_guard.py`) and the dev probe need their own lock path; the plan handles that.
- **D10a. What happened while email was off is never emailed** (user's; mechanism mine, from review).
  - **What's stored:** two times, `email_off_at` (the last time email was turned off) and `email_on_at` (the last time it was turned on).
  - **The off interval:** `[email_off_at, email_on_at)`. While email is off, the queue sends nothing and marks nothing.
  - **Turning email on** marks every unsent row created in the off interval as `skipped: email was off`.
  - **The queue's select** also leaves out rows created in that interval. That covers a row whose transaction began before the toggle and committed after it, since `created_at` is the transaction's start.
  - **Rows created while email was on** are never skipped, even after an off/on toggle. For example, a message stuck in a relay outage (D9c) still goes out once email works again.
  - **A first turn-on** (the copy said "off", or a fresh install) has `email_off_at` at the Unix epoch, so everything queued before it is skipped. It's never `-infinity`, which psycopg can't read back.
  - **The copy (D2)** of an "on" leaves both times NULL. Both NULL means "no off interval", so a running install keeps sending its whole queue, retries in backoff included.
  - Rows are still queued as today (`submissions.py:181` and the other four places). The queue is the one place that decides.
- **D10b. Every email reader follows the panel** (mine, from review). These read the saved settings (the dev modes of D2c still win):
  - **`GET /api/auth/config`** (`api/auth.py:47-54`): `send_pin_enabled` is true when email is on with a readable password or no login (or in debug or the `file` mode, as today), so turning email on gives the login page its "Send PIN" step. It also returns D12's `longest_sign_in_days` and D11b's `max_file_mb`. It's public, so it carries nothing else.
  - **`_send_login_pin`** (`api/auth.py:56-69`). It runs as a background task, so it opens its own database session to read the settings.
  - **`email_is_set_up()`** (`superuser_courses.py:35-39`), which decides the Courses page's admin note (D5a of the Users/Courses spec).
  - **The PIN email's minutes** (`templates.py:142`) and the admin note's `pin_minutes` (`superuser_courses.py:117`).
  - **The From** in `templates.py:118, 136`.
  - **The login page's email-off sentence** (`Login.svelte:92`) becomes "Email isn't set up on this server, so PINs aren't emailed. Ask the person who runs this Mathion for one." (mine). That matches D6: the PIN comes from `mathion pin`, not from a terminal the person can see.

- **D10c. The developer modes win everywhere** (mine, from review). In `file` and `memory` mode (D2c), the loop passes no off interval, so the queue sends every row as today. It ignores D10a's times and the panel's switch, because the switch can't be used in those modes. The dev outbox keeps working unchanged; the direct `tick()` tests are covered by D10's seam.

### File limits and sign-in

- **D11. File limits** (user's; ranges mine). The Edit file limits dialog has two fields, in whole MB, where 1 MB = 1,048,576 bytes as today:
  - **Largest file:** 1 to 50 (user's). The ceiling is low on purpose: every upload path reads the whole file into memory (`assets.py:49`, `run_assets.py:44`, `evaluations.py:77`, `submissions.py:73`), and `assets.py:55`'s `.strip()` briefly holds a second copy. At 50 MB, a few uploads at once stay within a small server's memory. Long videos belong on a video service, linked from the course. It covers course files, run files, student submissions and evaluation files: every read of `settings.max_file_size` today. `assets.py:49` reads the whole upload with no bound today; it reads at most the limit plus one byte, like the others.
  - **Files per course version or run, in total:** from the largest file up to 102,400 (100 GB). It covers every read of `settings.max_course_size` today: version files, run files, and version copies (`versions.py:36-42, 84-89`).

  Lowering a limit deletes nothing. Existing files stay, and only new uploads and copies are checked.
- **D11a. Upload errors in MB** (mine; the user agreed).
  - **A file over the limit:** "This file is over the <m> MB limit." Three upload paths read only the limit plus one byte, so they never know the real size, and a rounded size could read "20 MB; the largest allowed is 20 MB".
  - **A total over the limit:** "This would take the files of this <version|run> past its <m> MB limit." For a version copy: "This version's files are over the <m> MB limit, so it can't be copied."
  - The statuses stay as they are today.
  - The run files tab (`RunAssetsTab.svelte:229, 506`) shows the server's sentence instead of mapping every 413 to "storage quota".
  - **A 413 without a sentence** comes from a proxy. Every upload screen (rev 6; the build shares `tooLargeSentence` in `lib/uploadLimit.svelte.ts` across all five upload paths) shows: "This file is over the server's upload limit."
- **D11b. The browser follows the saved limit** (mine, from the builder check and review). Today the frontend hard-codes 20 MB:
  - in its checks: `lib/runAssets.ts:9`, `lib/evaluations.ts:8`, `lib/studentMiniProjects.ts:24`;
  - in its messages and help text: `AssetSidebar.svelte:200`, `DashboardSidePanel.svelte:602, 856`, `MiniProjectDetailPage.svelte:353-354` (a student screen), `RunAssetsTab.svelte:195, 287`.

  The plan greps for any other `20 MB`, `20MB` and `20 * 1024`.

  All of these read `max_file_mb` from `GET /api/auth/config` (D10b), fetched once per page load and shared.
  - The messages say the saved number, for example "PDF only, max 50 MB".
  - Until the value arrives, or if the fetch fails, the help text leaves the number out ("PDF only") and the browser skips its size check.
  - The browser's check is a convenience; the server's D11a sentence is the rule.
  - The student screens keep working at 400 px.
- **D11c. The bundled proxy lets 50 MB through** (user's). Mathion's bundled HTTPS proxy caps request bodies at 25 MiB (`MAX_SIZE: "25M"` in `docker-compose.prod.yml:78` and the CLI's embedded copy, `cli/internal/compose/docker-compose.yml:78`).
  - This slice raises both to `60M`: the 50 MB ceiling plus room for the form's overhead. `cli/internal/compose/embed_test.go:174`, which pins `25M`, changes with them.
  - **Release order:** a plain `mathion update` or `mathion install` deploys the image tag baked into the CLI (`APP_IMAGE` in `.github/workflows/release-cli.yml:92`, read at `cli/cmd/update.go:305-307` and `install.go:172`), with that CLI's compose file. So the image tag goes out first. Then the CLI tag goes out, with `APP_IMAGE` (and `amd64-smoke.yml`) raised to it. A plain update then brings the new image and the `60M` proxy together.
  - Only `mathion update --version` run from an old CLI gets the new image with a 25 MB proxy. D11a's proxy sentence covers that case.
  - The README's upload-limit paragraph (`README.md:259-261`) changes to match: the panel sets the limit, and the bundled proxy allows up to the ceiling.
  - The File limits dialog says under Largest file: "Uploads also pass the server's proxy. With `mathion tls`, an up-to-date `mathion` allows 50 MB; another proxy must allow at least this."
  - **The proxy's timeouts** (rev 6, from the whole-branch review). The bundled proxy (reproxy) waits 5 s for a response header and gives a request 30 s by default, which cuts off the 20 s email test (D9) and a 50 MB upload or download on a slow link. Both compose copies set `TIMEOUT_RESP_HEADER: "30s"` and `TIMEOUT_WRITE: "15m"` (50 MB at about 0.45 Mbit/s), and `embed_test.go` pins them. The README's line for running reproxy yourself adds `--timeout.resp-header=30s --timeout.write=15m`.
  - **What a proxy refusal shows** (Safari pass, 2026-11-05). The pinned reproxy answers a body over `MAX_SIZE` with a clean 413, and Safari shows D11a's "This file is over the server's upload limit.", not the network error.
- **D12. Sign-in rules** (user's; ranges mine). The Edit sign-in dialog has four fields:
  - **A PIN lasts:** 5 to 60 minutes;
  - **PIN requests per hour:** 3 to 20. The floor is 3, so a person who clicks twice still gets a PIN;
  - **Wrong PIN tries per hour:** 3 to 20. The floor is 3, so one typo can't lock the superuser out for an hour;
  - **Longest sign-in:** 1, 7 or 30 days, as three segments.

  **`mathion pin` skips the request limit** (mine, from review). Today the operator's command shares the per-email request counter (`superuser/service.py:111-123` through `auth.py:44-51`), so a locked-out superuser can't get a PIN from the terminal for an hour. It's the server's operator, so it skips that count. Making a PIN this way also clears that email's wrong-try count, so with email off it's always a way back in. The wrong-try limit still applies to the PIN it makes.

  **The login page** offers only the lengths up to the longest (`DURATIONS`, `Login.svelte:32`), from `longest_sign_in_days` in `GET /api/auth/config` (D10b). It preselects 7 days, or the longest when that's shorter. If the config fetch fails, the page shows its existing error state, as today. The segmented control there is markup inside the page, not a component; the plan extracts it or copies it for D7 and D12's dialogs.

  **A longer request is shortened, not refused** (mine, from review). If the server gets a `duration_days` longer than the longest (a login page left open across a change), it signs the person in for the longest, for both the session and the cookie. It happens before and apart from PIN checking, so a valid PIN never fails and no wrong try is counted. The schema's 1-30 bound (`schemas.py:235`) stays.

  Changes apply to new PINs and new sign-ins: nobody is signed out, and existing sign-ins keep their end date.
- **D13. No change history** (mine). Most installs have one superuser, so the panel keeps no history of who changed what.
- **D14. Server and CLI text stops quoting old numbers and keys** (mine, from review).
  - The bootstrap PIN command no longer hits the request limit (D12), so its rate-limit message (`backend/mathion/superuser/__main__.py:40-44`) goes. What it prints for a PIN says the real minutes from the saved settings.
  - `mathion pin`'s help (`cli/cmd/pin.go:12, 24`) stops quoting "10 min" and "3/hour" and says the panel's Settings set them.
  - The README (`README.md:171, 201, 230, 259-261, 297`) stops telling operators to set the moved keys in `.env`.
  - The Users/Courses spec's backlog line on stale emails (`2026-11-03-superuser-users-courses-design.md:243`) gets a note that D10a of this spec settles it.

## 4. Constraints

- **No new packages,** backend or frontend (user's standing rules). Svelte 5 runes; no JS or CSS dependencies. Python only from the standard library and the existing dependencies.
- **Postgres only.** The migration must run on an existing install with data, and with any `.env`: missing, odd or non-numeric values (D2a).
- **Panel calls** go through the token guard like the other panel endpoints. Their query strings are redacted in the access log like the rest of the panel (rev 7 of the Users/Courses spec).
- **Password safety:** the password is never in a response, a log line, an error sentence, a 422 body, or an exception message that reaches a log (D9b).
- **UI patterns:**
  - same tab, modal dialogs, one pencil per card (user's rules);
  - plain sentences in UI copy, never she or he;
  - the panel's existing components: `Modal`, `Button`, `Switch`, `PanelHead`, plus the login page's segmented control, extracted or copied (D12).
- **Tests:** Vitest with mount/unmount/flushSync, no testing-library; `npm test` (it pins the TZ); backend tests via `backend/.venv`.
- **The CLI change** (D11c, D14) ships as a `mathion` CLI release by the usual tag pipeline. The release itself is the user's step.
- **Screen widths:** the panel is laptop-only. The 400 px rule is for student screens, and the login page (D10b, D12) and `MiniProjectDetailPage` (D11b) are student-facing.

## 5. Inputs a person will meet (for the plan's Review Focus)

- **Odd `.env` values on update:**
  - a 2 GB file limit;
  - a non-numeric port;
  - `smtp` mode with no mail server;
  - a username with no password;
  - no `MATHION_EMAIL_FROM` at all.
- **A fresh install:** the app starts before the migration has run (D2). Nothing may fail, and the login page shows the email-off form.
- **A restore of a pre-slice backup, then an update,** after someone removed the ignored keys from `.env`: the copy gives the defaults, email off. D2a's log lines name each key that got its default.
- **A restore onto a server with a different secret key:** the password can't be read (D8).
- **Mail servers that misbehave:**
  - a test or save after changing the mail server, with the password field left empty (D8a);
  - a campus relay with a self-signed certificate (D7a), on a fresh setting and on a copied one;
  - a test that hangs: a firewall dropping packets to port 25 rather than refusing (D9's 20 s);
  - a campus relay with no login on port 25, and a 465 server that refuses STARTTLS;
  - a From address the mail server refuses, saved without a test: refused as the sender, the queue keeps its messages (D9c); refused after the body (Microsoft 365's SendAsDenied), each message is retried and fails after five tries, with the card saying why (D9c, D9d).
- **File limits:**
  - the total limit set below the largest file;
  - a lowered limit with courses already over it;
  - a 40 MB upload through the bundled proxy, with an up-to-date CLI and with an old one (D11c);
  - a file of 20 MB and one byte (D11a);
  - a copied byte limit that isn't whole MB (D2).
- **Sign-in:** a longest sign-in lowered to 1 day while a login page is open showing 30 days. The person still signs in, for 1 day (D12).
- **Email turned on** with a queue full of messages from while it was off (D10a): none of them goes out.
- **Email turned off and on again** within 30 seconds: nothing from the off time goes out, and messages from before it still do.
- **A bad From or login saved without a test:** the queue stops, keeps every message, and the card says why (D9c, D9d). A From refused only after the body is the exception: each message is retried and fails after five tries, and the card names the From (D9c, D9d).
- **The developer `file` mode:** the outbox gets every message (D10c).
- **Two browser tabs** with the Settings page open, each saving a different card: one card's save never overwrites another card's values.

## 6. What's left to the builder

- **The table shape.** My suggestion: one row with typed columns. The two test records (D9a), the stuck-queue line (D9d) and D10a's two times live with it.
- **The exact HTTP shape** of the settings endpoints and the test-email endpoint. Each card saves only its own fields (§5, two tabs). Two tabs saving the same card: the last save wins, as with the panel's other dialogs.
- **MB on the page:** the panel shows limits as whole MB of 1,048,576 bytes. If `frontend/src/lib/format.ts` shows sizes elsewhere in a different unit, the plan makes the Settings card and D11a's sentences agree with the limit as set.
- **How a tick reads the settings,** as long as it tolerates a missing table (D10).

## 7. Out of scope, noted for the next project (Branding)

User's decisions so far, for the Branding spec:
- **Logo image:** the superuser uploads one PNG holding the logo and the name. It replaces the drawn mark and the "Mathion" wordmark.
  - It shows in a fixed-size box at today's lockup height: about 20 px in the header, 28 px on the login page.
  - It's scaled to fit (`object-fit: contain`), sits at the left, and is never stretched.
  - My guess for the header box is 160×20 px. The user's own `logo.png` (838×174) shows as about 96×20.
- **Site name:** a plain-text name, used only for the browser tab, the email subject and sign-off, and the image's alt text. It defaults to "Mathion" and is never drawn on the page while the image is there. Its seam is `frontend/src/lib/branding.ts`.
- **Theme:** a `.css` upload that overrides any of the tokens in `frontend/src/styles/theme-default.css`.
