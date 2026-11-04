# Superuser panel: Settings — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the superuser panel gets a **Settings** page (email with a test, file limits, sign-in rules, the read-only site address). These settings move from `.env` into the database, and every reader follows them at once, with no restart.

**Architecture:**
- **Data (Task 1).** One Alembic revision creates a one-row `site_settings` table and copies today's `.env` values into it (D2, D2a). `mathion/secret_box.py` holds D8's sealed password and D9a's keyed fingerprint. `mathion/site_settings.py` loads the row (a missing table or row means the defaults with email off), with the ranges in one place.
- **Readers (Task 2).** Limits, PIN rules and sign-in length read `site_settings`. The moved keys leave `Settings`. `GET /api/auth/config` grows. `mathion pin` skips the request limit.
- **Email (Task 3).** The mailer handles three encryptions and checks certificates. One helper turns SMTP failures into sentences. The queue's loop runs at every boot and decides mode, interval and backoff. `tick()` stays pure.
- **API (Task 4).** `api/superuser_settings.py`: read the page, save each card, send a test.
- **Frontend (Tasks 5, 6).** A Settings pill, page and three Edit dialogs. Then the login page, and the live file limit on every upload screen.
- **CLI and docs (Task 7).** Proxy cap `60M`, `GenerateEnv`, `mathion pin` text, README.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic, PostgreSQL 17, Alembic, pytest (via `backend/.venv`); Svelte 5 runes, Vitest with jsdom (`mount`/`unmount`/`flushSync`); Go (the `mathion` CLI); the zsh gate `frontend/scripts/visual-refresh-gate.sh`. No new npm, pip or Go packages.

**Spec:** `docs/superpowers/specs/2026-11-04-superuser-settings-design.md`, rev 5 (`2733311`), approved by the user on 2026-11-04. Its decisions D1–D14 are binding. This plan cites them by name and doesn't repeat their reasoning. Mockup: `$SDD/settings-mock.html` (since then the email dialog has gained the certificate box, D7a).

**Line numbers** are from `2733311`. An earlier task shifts them in files it also touches; find the place by the quoted text.

## Global Constraints

- **Branch:** `feat/superuser-settings` (off main `c51e0c9`). Local only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`.
  - `$SDD` = `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-11-04-superuser-settings`.
  - Probes go in `probe/`, logs and gate temp files in `tmp/`, screenshots in `shots/`. Never `/tmp`.
  - Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. Component tests use `mount` / `unmount` / `flushSync` from `svelte`, never `@testing-library/svelte`.
  - Python, pytest and alembic only through `backend/.venv`.
  - Match the surrounding comment density. A comment may carry the decision tag (`D10a`), never "added in this slice".
- **Colours:** theme tokens only, no literal colours, no `opacity` to dim.
- **UI (D5):**
  - same tab only;
  - one pencil per card opens one `Modal` dialog;
  - nothing is edited in place;
  - nothing in the panel links out of it.
- **Copy:** plain words, never "he"/"she". Every quoted sentence in the spec (D2, D3, D6, D7, D7a, D7b, D8, D8a, D9, D9d, D10b, D11a, D11c) is copied verbatim into code and tests.
- **Status codes (D25 of the Users/Courses spec):**
  - the guard's 404 means only "link expired";
  - a refused value is 422, and its `detail` holds the sentence with no `input` echoed (D9b);
  - "A test is already running." is 409.
- **The password never** appears in a response, a log line, a 422 body, the queue's `error` column, or an exception message that reaches a log (D9b). Every task that touches email has a test asserting this with a sentinel password `"S3ntinel-pw"`.
- **Pinned CSS rules are single-selector blocks** (the gate's `d` helper matches `.cls.svelte-HASH{…}`). No apostrophe inside the gate's `node -e '…'` payload.
- **Commands** (write `$SDD` out in full when you run them):
  - **Backend:** `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/pytest.log`. One file: `.venv/bin/pytest -q tests/<file>`.
  - **Frontend tests:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. Never bare `npx vitest`, which drops the TZ pin.
  - **Typecheck:** `npx svelte-check --output machine | tail -1`. Expect 0 errors, and no more warnings than the baseline recorded at Task 1 start (13 at `2733311`).
  - **Gate:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It ends `VISUAL-REFRESH GATE: ALL PASS (N checks)`. Bump `EXPECTED_CHECKS` (line 90, now 2717) by the rows a task adds.
  - **Go:** `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go test ./... > $SDD/tmp/go.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/go.log`.
  - **Baselines at `2733311`:** gate 2717, vitest 2854 tests, backend 1439, svelte-check 0/13. Record the exact counts and the Go result at Task 1 start.
- **If an iCloud " 2" copy appears** (`find . -name "* 2.*"`), `cmp` it with its original and ask the user before deleting.
- **Per task, in this order** (the user's loop):
  1. TDD, step by step as written.
  2. The suites the task names, all green.
  3. Tasks 5 and 6: agent-browser shots at 1280 wide, and at 400 wide for the student screens, of the screens the task names. Show them in an agterm overlay (`--size-percent 60`, base64 images, the HTML in `$SDD`), and get the user's OK on the look.
  4. Two review lanes on the UNCOMMITTED diff: Opus (high effort) and Fable.
     - Fix every Critical and Important, then re-run both lanes after EVERY fix until both are clean.
     - Push back on a wrong finding with evidence.
     - Minors go to `docs/backlog/superuser-settings-debt.md` (created in Task 1) under the task's heading.
     - Never edit the tree while a lane reviews.
  5. With the user's commit OK: exact paths (never `git add -A`, never `logo.png`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no session line.
  6. A ledger line in `$SDD/progress.md`, a memory update, then WAIT for the user's "go".
- **Dev servers and dev data:**
  - Start dev servers only with the user's yes: backend uvicorn :8000 (`MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"`, `--reload`), vite `http://localhost:5174`.
  - The dev DB needs Task 1's migration: run `backend/.venv/bin/alembic upgrade head` against dev only with the user's yes.
  - Signing in, minting a panel token and every panel write in dev change shared data: ask first. Never print the panel token.
  - The ledger lists the rows to delete at the slice's end.

## Review Focus

These are the inputs most likely to bite a person that no step below would otherwise pin. Each has its test in the owning task.

1. **The update breaks a working install.** A server with `MATHION_EMAIL_MODE=smtp` and no `MATHION_EMAIL_FROM` must keep sending: copied "on", From = the config default, both D10a times NULL, the certificate box ticked (D2, D7a). → Task 1, `test_copy_smtp_without_from_keeps_sending`.
2. **The password leaks through an error.** A refused login whose server reply echoes the password must not put it in the log, the queue's `error`, or the test's answer (D9b). → Task 3, `test_auth_failure_reply_never_logged`; Task 4, `test_test_endpoint_answer_has_no_server_text`.
3. **The saved password goes to a new server.** A test or save with a changed host and an empty password field is refused (D8a). → Task 4, `test_changed_host_needs_password_again`.
4. **Turning email on floods people, or drops messages it shouldn't** (D10a). → Task 3, `test_off_interval_skips_only_rows_born_off`, `test_late_commit_in_off_interval_not_sent`.
5. **A login page left open across a shorter "longest sign-in"** must still sign the person in, for the new longest, without counting a wrong try (D12). → Task 2, `test_longer_duration_is_shortened_not_refused`.

---

### Task 1: the `site_settings` table, the copy from `.env`, the sealed password

**Files:**
- Create: `backend/mathion/secret_box.py`, `backend/mathion/site_settings.py`
- Create: `backend/alembic/versions/e8c4f2a6b1d7_site_settings.py`
- Modify: `backend/mathion/models_auth.py` (add `SiteSettings`)
- Create: `docs/backlog/superuser-settings-debt.md` (the heading only)
- Test: `backend/tests/test_secret_box.py`, `backend/tests/test_site_settings.py`, `backend/tests/test_migration_site_settings.py`

**Interfaces:**
- **Produces** `secret_box`:
  - `seal(plain: str, secret: str) -> str`, giving `"v1:" + b64(nonce16 ‖ ct ‖ tag32)`;
  - `unseal(blob: str, secret: str) -> str`, which raises `SealError` on a bad tag, an unknown prefix or bad base64;
  - `fingerprint(fields: Mapping[str, str | int | bool | None], secret: str) -> str` (hex HMAC-SHA256 over a canonical JSON).
  - The three keys are `HMAC-SHA256(secret, b"mathion-smtp-stream")`, `…b"mathion-smtp-tag"` and `…b"mathion-smtp-fingerprint"`. The tag covers `b"v1" ‖ nonce ‖ ct` and is checked with `hmac.compare_digest` before decrypting.
- **Produces** the `SiteSettings` model, table `site_settings`, `id` with `CHECK (id = 1)`:
  - **email:** `email_on` bool; `smtp_host` str; `smtp_port` int; `smtp_encryption` str (`"starttls" | "ssl" | "none"`); `smtp_skip_cert_check` bool; `smtp_username` str; `smtp_password_sealed` str|None; `email_from` str;
  - **limits:** `max_file_mb` int; `max_total_mb` int;
  - **sign-in:** `pin_minutes` int; `pin_requests_per_hour` int; `pin_failures_per_hour` int; `longest_sign_in_days` int;
  - **D10a times:** `email_off_at` and `email_on_at` (timestamptz|None);
  - **the latest test:** `test_fp` str|None; `test_at`; `test_ok` bool|None; `test_message` str|None;
  - **the card's test:** `card_test_at`; `card_test_ok`; `card_test_message`;
  - **the stuck queue:** `send_failure_message` str|None; `send_failure_at`; `send_retry_at`; `send_backoff_step` int (default 0).
- **Produces** `site_settings`:
  - `MB = 1_048_576`;
  - `RANGES`: `max_file_mb (1, 50)`, `max_total_mb (max_file_mb, 102_400)`, `pin_minutes (5, 60)`, `pin_requests_per_hour (3, 20)`, `pin_failures_per_hour (3, 20)`, `longest_sign_in_days {1, 7, 30}`;
  - `DEFAULTS`: email off, port 587, `starttls`, From `""`, 20 / 500 MB, 10 / 3 / 5, 30 days;
  - `load(db) -> SiteSettingsView`: a frozen dataclass of the row's values. Defaults when the table is missing or empty (catch `ProgrammingError`/`UndefinedTable`, roll back);
  - `get_row(db) -> SiteSettings` creates the row from `DEFAULTS` if absent, for writers.
- Alembic head `e8c4f2a6b1d7`, `down_revision = 'd5b1e7a3c9f4'`.

- [ ] **Step 1: Write the failing tests**

`test_secret_box.py`:
- `test_round_trip`: `unseal(seal("pässwörd", K), K) == "pässwörd"`.
- `test_wrong_secret_raises`: `unseal(seal("x", K), K2)` raises `SealError`.
- `test_tampered_blob_raises`: flip one byte of the ciphertext → `SealError`.
- `test_unknown_prefix_raises`: `"v2:…"` → `SealError`.
- `test_nonce_is_random`: two seals of the same text differ.
- `test_fingerprint_keyed_and_stable`: the same fields and secret give the same value, another secret gives another value, and a changed password gives another value.

`test_site_settings.py`:
- `test_load_without_row_gives_defaults`: an empty table → `DEFAULTS`, `email_on is False`.
- `test_get_row_creates_once`: two calls return the same `id == 1`.
- `test_second_row_violates_check`: inserting `id=2` raises `IntegrityError`.

`test_migration_site_settings.py` (the `test_migration_one_admin_last_seen.py` pattern: `command.downgrade(_cfg(), "d5b1e7a3c9f4")`, set env with `monkeypatch.setenv`, `command.upgrade(_cfg(), "head")`):
- `test_copy_smtp_full`: `smtp`, host, port 2525, user, password `"S3ntinel-pw"`, From. Expect on, `starttls`, skip cert `True`, `unseal(...) == "S3ntinel-pw"`, both D10a times `None`.
- `test_copy_smtp_without_from_keeps_sending`: `smtp` without `MATHION_EMAIL_FROM` → on, From `"Mathion <noreply@mathion.test>"`, and the log names the default.
- `test_copy_disabled_gives_empty_from_and_epoch_off`: `disabled` → off, From `""`, `email_off_at == 1970-01-01T00:00Z`, `email_on_at is None`, skip cert `False`.
- `test_copy_smtp_without_host_is_off`: `smtp` with no host → off, and the log line names `MATHION_SMTP_HOST`.
- `test_copy_smtp_username_without_password_is_off`.
- `test_copy_clamps_and_logs`: `MATHION_MAX_FILE_SIZE=2147483648` → `max_file_mb == 50`, logged with old and new.
- `test_copy_non_numeric_gets_default`: `MATHION_SMTP_PORT=abc` → 587, logged.
- `test_copy_total_below_file_is_raised`.
- `test_copy_rounds_bytes_up`: `MATHION_MAX_FILE_SIZE=20971521` → 21.
- `test_copy_missing_keys_get_defaults`.

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/bin/pytest -q tests/test_secret_box.py tests/test_site_settings.py tests/test_migration_site_settings.py`
Expected: FAIL with `ModuleNotFoundError: mathion.secret_box`.

- [ ] **Step 3: Implement `secret_box.py`, the model, `site_settings.py` and the migration**

- **Encryption:** the keystream block `i` is `HMAC-SHA256(k_stream, nonce ‖ i.to_bytes(4, "big"))`, XORed over the UTF-8 bytes.
- **The migration is self-contained (D2):**
  - its own frozen copy of `seal`;
  - the From default and today's numbers as literals;
  - `os.environ` read raw, with `MATHION_SECRET_KEY` falling back to `"dev-secret-key-change-in-production"`.
- **Logs** go to `logging.getLogger("alembic.runtime.migration")`.
- **Downgrade** drops the table.

- [ ] **Step 4: Run the three files, then the whole backend suite**

Expected: the new tests PASS, and the suite is green at the baseline plus the new tests.

- [ ] **Step 5: Review lanes, user OK, commit**

```bash
git add backend/mathion/secret_box.py backend/mathion/site_settings.py backend/mathion/models_auth.py \
  backend/alembic/versions/e8c4f2a6b1d7_site_settings.py backend/tests/test_secret_box.py \
  backend/tests/test_site_settings.py backend/tests/test_migration_site_settings.py docs/backlog/superuser-settings-debt.md
git commit -m "feat(settings): site_settings table, copied once from .env, sealed SMTP password (D2, D8)"
```

---

### Task 2: limits and sign-in rules read `site_settings`

**Files:**
- Modify: `backend/mathion/config.py:11-16` (drop `max_file_size`, `max_course_size`, `pin_expiry_minutes`, `max_pin_requests_per_hour`, `max_pin_failures_per_hour`; the email keys go in Task 3)
- Modify: `backend/mathion/auth.py:33-127` (limits from `load(db)`; `request_pin(…, *, operator: bool = False)` skips the request count; `verify_pin` takes the effective duration)
- Modify: `backend/mathion/api/auth.py:47-54, 79-105` (`/config`, duration shortening)
- Modify: `backend/mathion/schemas.py` (`AuthConfigResponse` gains `longest_sign_in_days: int`, `max_file_mb: int`)
- Modify: `backend/mathion/superuser/service.py:111-123` (`issue_bootstrap_pin` uses `operator=True` and clears `pin_failure:{email}` rows; drop `RateLimited`)
- Modify: `backend/mathion/superuser/__main__.py:36-46` (drop the rate-limit branch; print the saved minutes)
- Modify: the upload readers `api/assets.py:45-66`, `api/run_assets.py:40-60, 144-170`, `api/evaluations.py:75-85`, `api/submissions.py:70-78`, `api/versions.py:36-42, 84-89` (limits from `load(db)`; D11a sentences; `assets.py` reads at most limit+1 bytes)
- Modify: `backend/mathion/main.py` (lifespan: D2's one log line for ignored keys)
- Modify: `backend/mathion/notifications/templates.py:118-142` and `api/superuser_courses.py:117` (minutes from `load(db)`; From is Task 3's)
- Test: `backend/tests/test_auth_config.py`, `test_auth.py`, `test_superuser_service.py`, `test_superuser_cli.py`, `test_assets_api.py`, `test_run_assets.py`, `test_startup_db_log.py`, and the existing tests that monkeypatch the dropped `settings.*` fields (find them with `grep -rn "max_file_size\|max_course_size\|pin_expiry_minutes\|max_pin_" backend/tests`); new `backend/tests/test_upload_limits.py`

**Interfaces:**
- **Consumes:** Task 1's `load`, `get_row`, `MB`.
- **Produces:**
  - `GET /api/auth/config` → `{"send_pin_enabled": bool, "longest_sign_in_days": int, "max_file_mb": int}`. `send_pin_enabled` is temporarily today's rule over the saved switch; Task 3 finishes it.
  - Test helper `set_site(db, **fields)` in `backend/tests/conftest.py`, which writes the row via `get_row`.

- [ ] **Step 1: Write the failing tests**

- `test_auth_config.py::test_config_reports_longest_and_file_limit`: `set_site(longest_sign_in_days=7, max_file_mb=33)` → the response holds both.
- `test_auth.py::test_pin_limits_follow_site_settings`: `set_site(pin_requests_per_hour=3)` → the 4th request returns `None`. `pin_minutes=5` → the PIN's `expires_at` is 5 min out.
- `test_auth.py::test_longer_duration_is_shortened_not_refused`: `longest=1`, verify with `duration_days=30` and a valid PIN → 200, the cookie's `max_age == 86400`, the session expires in 1 day, no `pin_failure` row.
- `test_superuser_service.py::test_bootstrap_pin_skips_request_limit_and_clears_failures`: 5 requests plus 5 failures in the hour → `issue_bootstrap_pin` returns `PinIssued`, and the failure rows for that email are gone.
- `test_upload_limits.py` (one test per path: course asset, run asset, submission, evaluation):
  - `set_site(max_file_mb=1)`, upload 1 MB + 1 byte → 413, and `detail == "This file is over the 1 MB limit."`;
  - a total over → `"This would take the files of this version past its 2 MB limit."` (`run` for run assets);
  - a version copy over → `"This version's files are over the 2 MB limit, so it can't be copied."`
- `test_upload_limits.py::test_course_asset_read_is_bounded`: patch `UploadFile.file.read` to record its argument → called with `limit + 1`.
- `test_startup_db_log.py::test_ignored_env_keys_logged_once`: `MATHION_MAX_FILE_SIZE` set → one line `"These .env keys are ignored since this version; the panel's Settings page sets them: MATHION_MAX_FILE_SIZE."`. With only `MATHION_EMAIL_MODE=disabled` set → no line.
- `test_auth.py::test_typo_in_ignored_key_does_not_stop_startup`: `MATHION_MAX_FILE_SIZE=abc` → `Settings()` loads. (Task 3 adds the same test for `MATHION_SMTP_PORT=abc`.)

- [ ] **Step 2: Run them to verify they fail**

Run each named file. Expected: FAIL (missing fields, 422 on a long duration, `RateLimited`, byte-count messages).

- [ ] **Step 3: Implement**

- **Shortening (D12):** in `api_verify_pin`, before `verify_pin`: `days = min(data.duration_days, load(db).longest_sign_in_days)`, and use `days` for both the session and the cookie.
- **Status codes:** keep each path's current status (400 or 413).
- **The lifespan log** reads `os.environ` for the moved key names.

- [ ] **Step 4: Run the whole backend suite**

Expected: green. Every test that monkeypatched a dropped `settings.*` field now uses `set_site`.

- [ ] **Step 5: Review lanes, user OK, commit** (exact paths of every file touched)

`feat(settings): limits and sign-in rules from site_settings; mathion pin skips the request limit (D10b, D11, D11a, D12)`

---

### Task 3: email follows the panel

**Files:**
- Modify: `backend/mathion/config.py:31-35` (drop `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `email_from`; keep `email_mode`, `email_outbox`)
- Modify: `backend/mathion/notifications/mailer.py:61-99` (`SMTPMailer(host, port, encryption, username, password, verify_cert, timeout=30)`; `build_mailer(view, secret, mode) -> Mailer | None`)
- Create: `backend/mathion/notifications/smtp_errors.py` (`describe(exc, *, host, port, sender, recipient) -> SmtpFailure(cls, code, sentence, batch_level: bool)`)
- Modify: `backend/mathion/notifications/errors.py:8-20` (`classify` keeps per-message kinds; `SMTPSenderRefused` is no longer permanent there; D9c's batch-level set lives in `smtp_errors`)
- Modify: `backend/mathion/notifications/dispatcher.py:124-275` (`tick(db, mailer, *, now, off_interval: tuple[datetime | None, datetime | None] | None = None)`; `run_forever` decides mode, settings, interval, backoff and `send_failure_*`)
- Modify: `backend/mathion/main.py:86-92` (the loop and lock at every boot)
- Modify: `backend/mathion/api/auth.py:47-69` (`send_pin_enabled`; `_send_login_pin` opens `SessionLocal()`)
- Modify: `backend/mathion/api/superuser_courses.py:35-39` (`email_is_set_up(db)`)
- Modify: `backend/mathion/notifications/templates.py:118, 136` (From from the settings)
- Test: `test_notifications_mailer.py`, `test_notifications_errors.py`, `test_notifications_dispatcher.py`, `test_notifications_lifespan.py`, `test_notifications_lock.py`, `test_auth_config.py`, `test_superuser_courses.py`; new `test_smtp_errors.py`, `test_dispatcher_settings.py`

**Interfaces:**
- **Consumes:** Task 1's `load`, `get_row`, `unseal`, `SealError`.
- **Produces:**
  - `smtp_errors.describe(...)`, whose sentences are exactly D9's list. `batch_level` is True for: a connect or session failure, `SMTPAuthenticationError`, `ssl.SSLError` / `SSLCertVerificationError`, `SealError`, and `SMTPSenderRefused`.
  - `build_mailer(view, secret, mode)`: `file` and `memory` follow `.env` (D2c); otherwise `None` when off, else an `SMTPMailer`. An unreadable password raises `SealError` at session start.
  - `off_interval_for(view) -> tuple | None`.
  - `email_is_set_up(db) -> bool`.

- [ ] **Step 1: Write the failing tests**

`test_notifications_mailer.py` (patch `smtplib.SMTP` / `SMTP_SSL` with recorders):
- `test_starttls_uses_default_context`: `starttls(context=…)` gets a context with `verify_mode == CERT_REQUIRED`.
- `test_skip_cert_uses_unverified_context`.
- `test_ssl_uses_smtp_ssl`.
- `test_none_never_calls_starttls_or_login`.
- `test_login_only_with_username`.

`test_smtp_errors.py`:
- `test_auth_failure_reply_never_logged`: an `SMTPAuthenticationError(535, b"bad S3ntinel-pw")` → the sentence is `"The mail server refused the login."`, and no `"S3ntinel"` appears in `caplog` or the returned text.
- One test per sentence of D9, including the port hint for SSL/TLS on 587.

`test_dispatcher_settings.py` (drives `run_forever`'s per-tick function, `_tick_once(app_state, now)`, extracted for tests):
- `test_off_sends_nothing_marks_nothing`.
- `test_turn_on_skips_rows_born_off`: rows at t1 (on), t2 (off interval), t3 (after on) → t2 is `skipped: email was off`, and t1 and t3 are sent.
- `test_late_commit_in_off_interval_not_sent`: a row inserted with `created_at` inside the interval after the turn-on → not sent.
- `test_off_interval_skips_only_rows_born_off`: off/on twice → the rows from the first on-interval are still sent.
- `test_copied_on_null_times_sends_whole_queue` (including a row in backoff, once due).
- `test_file_mode_sends_all` (D10c).
- `test_batch_level_failure_keeps_messages`: a refused sender → no row's `retry_count` changes, `send_failure_message` is set, `send_retry_at == now + 5 min`; the next failure → 10 min, capped at 60.
- `test_success_clears_failure_and_backoff`.
- `test_disconnect_mid_batch_charges_one_row_and_stops`.
- `test_unreadable_password_logged_once`.
- `test_failure_text_in_db_has_no_server_reply`.

The existing `test_notifications_dispatcher.py` stays unchanged and green: `tick()` with no interval behaves as today.

- `test_notifications_lifespan.py::test_lifespan_disabled_mode_takes_lock` (flipped from `…_no_lock`): the loop starts and the lock is taken.
- `test_auth_config.py::test_send_pin_follows_saved_switch`: off → `False`; on → `True`; on with an unreadable sealed password → `False`; debug → `True`.
- `test_superuser_courses.py::test_admin_note_follows_saved_switch`.
- `test_notifications_config.py::test_smtp_port_typo_does_not_stop_startup`: `MATHION_SMTP_PORT=abc` → `Settings()` loads.

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL (no `encryption` parameter, no `smtp_errors`, no interval).

- [ ] **Step 3: Implement**

- **The interval filter:** in the select, `NOT (created_at >= off_at AND (on_at IS NULL OR created_at < on_at))`, applied only when `off_at` is set. While email is off there's no mailer, so nothing is sent at all. After a later turn-off, `on_at < off_at`, so the filter excludes nothing until the next turn-on. Skipping happens at the turn-on in Task 4 and by this filter.
- **Backoff state** lives in the row (`send_retry_at`, `send_backoff_step`).
- **Logging:** one log line per change of `send_failure_message`.
- **The lock path:** the tests that boot the app (`test_startup_db_log.py`, `test_startup_secret_guard.py`) set `MATHION_DISPATCHER_LOCK_PATH` under `tmp_path`.

- [ ] **Step 4: Run the whole backend suite.** Expected: green.

- [ ] **Step 5: Review lanes, user OK, commit**

`feat(settings): email follows the panel: three encryptions, checked certificates, off interval, batch backoff (D7, D9b, D9c, D10)`

---

### Task 4: the Settings API

**Files:**
- Create: `backend/mathion/api/superuser_settings.py`
- Modify: `backend/mathion/schemas.py` (`PanelSettings`, `EmailSettingsIn`, `LimitsIn`, `SignInIn`, `EmailTestResult`)
- Modify: `backend/mathion/main.py` (include the router; a `RequestValidationError` handler that, for paths under `/api/superuser/`, answers `{"detail": [{"loc": …, "msg": …}]}` with no `input`)
- Test: `backend/tests/test_superuser_settings.py`

**Interfaces:**
- **Consumes:** Tasks 1–3; `require_superuser_panel`, `require_superuser_panel_write` (`api/superuser.py:21, 40`).
- **Produces** (all under `/api/superuser/{token}`):
  - `GET /settings` → `PanelSettings`:
    - `email {on, host, port, encryption, skip_cert_check, username, password_saved, password_unreadable, from_address, dev_mode: "file"|"memory"|null, card_test: {at, ok, message}|null, failing: {since, message}|null}`;
    - `limits {max_file_mb, max_total_mb}`;
    - `sign_in {pin_minutes, pin_requests_per_hour, pin_failures_per_hour, longest_sign_in_days}`;
    - `site {base_url}`.
  - `PATCH /settings/email`: an `EmailSettingsIn` with every field, `password` optional. `{"on": false}` alone writes only the switch (D7c). Returns `PanelSettings`.
  - `PATCH /settings/limits`, `PATCH /settings/sign-in`: each returns `PanelSettings`.
  - `POST /settings/email/test`: the email fields without `on` → `EmailTestResult {ok, message}`. 409 `"A test is already running."`.

- [ ] **Step 1: Write the failing tests** (`test_superuser_settings.py`, with the panel fixtures of `test_superuser_courses.py`)

- **Reading:**
  - `test_get_never_returns_password`: a sealed `"S3ntinel-pw"` → the body has `password_saved: true` and no `"S3ntinel"`.
  - `test_dev_mode_reported`: `MATHION_EMAIL_MODE=file` → `dev_mode == "file"`.
- **Turning email on and off:**
  - `test_turn_on_needs_host_and_from`.
  - `test_login_needs_encryption`.
  - `test_username_needs_password`.
  - `test_password_ascii_only`.
  - `test_from_checked`.
  - `test_port_range`.
  - Each asserts its D7, D7a or D7b sentence verbatim.
  - `test_turn_on_marks_off_rows_skipped_and_sets_times`.
  - `test_off_writes_only_switch`: off with a changed host in the body → the host is unchanged.
  - `test_off_needs_no_password_even_unreadable`.
- **The saved password (D8a):**
  - `test_changed_host_needs_password_again`.
  - `test_changed_username_needs_password_again`.
  - `test_newly_ticked_cert_box_needs_password_again`.
  - `test_changed_port_keeps_password`.
- **The card's test (D9a):**
  - `test_test_of_saved_values_reaches_card`.
  - `test_test_then_save_reaches_card`.
  - `test_test_other_values_leaves_card`.
  - `test_save_clears_card_test_when_fingerprint_differs`.
- **The test itself (D9):**
  - `test_test_endpoint_answer_has_no_server_text`.
  - `test_second_test_while_running_409`.
  - `test_timeout_answer_recorded_and_late_result_discarded`: patch the send to block → after 20 s (patched clock and timeout) the answer is `"The mail server didn't answer within 20 seconds."`, and the late success doesn't overwrite it.
- **Saving resets the stuck queue:** `test_save_email_clears_failure_and_backoff`.
- **Limits and sign-in:**
  - `test_limits_ranges`.
  - `test_total_below_file_refused` with `"The total can't be smaller than the largest file."`.
  - `test_sign_in_ranges` (3–20 floors).
- **No echo:** `test_422_echoes_no_input`: a body with `password: "S3ntinel-pw"` and a bad port → 422, and no `"S3ntinel"` in the body.
- **The guard:** `test_guard_and_csrf` (404 without a token, 403 without the CSRF header on writes).

- [ ] **Step 2: Run to verify it fails.** Expected: 404 for every route.

- [ ] **Step 3: Implement**

- **The test** runs in `asyncio.to_thread`, with a module-level lock (non-blocking acquire → 409).
- **The timeout:** `asyncio.wait_for(…, 20)`, and `smtplib` gets `timeout=20`. A result from the thread after the timeout is dropped by comparing an attempt id.
- **The recipient** is the signed-in superuser's email.

- [ ] **Step 4: Run the whole backend suite.** Expected: green.

- [ ] **Step 5: Review lanes, user OK, commit**

`feat(settings): the panel's Settings API: read, save per card, test email (D5-D9a)`

---

### Task 5: the Settings page and its three dialogs

**Files:**
- Create: `frontend/src/components/ui/Segmented.svelte` (extracted from `pages/Login.svelte:71-82, 133-147`: radiogroup, `options: {value, label}[]`, `value` bindable, `name`, `label`)
- Modify: `frontend/src/pages/Login.svelte` (use `Segmented`; no visual change)
- Modify: `frontend/src/lib/superuser.ts` (`PanelPage` gains `'settings'`; types and calls for Task 4's endpoints)
- Modify: `frontend/src/pages/superuser/SuperuserShell.svelte:20-29, 92-97` (the fourth pill, the route, the page)
- Create: `frontend/src/pages/superuser/SuperuserSettings.svelte`, `frontend/src/components/superuser/EditEmailDialog.svelte`, `EditLimitsDialog.svelte`, `EditSignInDialog.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (rows for the cards and dialogs; bump `EXPECTED_CHECKS`)
- Test: `frontend/src/tests/Segmented.svelte.test.ts`, `SuperuserSettings.svelte.test.ts`, `EditEmailDialog.svelte.test.ts`, `EditLimitsDialog.svelte.test.ts`, `EditSignInDialog.svelte.test.ts`, `superuserApi.test.ts`, `SuperuserShell.svelte.test.ts`, `Login.svelte.test.ts` (unchanged and green)

**Interfaces:**
- **Consumes:** Task 4's endpoints; `Modal`, `Button`, `Switch`, `PanelHead`, `panelError` (`lib/superuser.ts:255`).
- **Produces:** `getSettings(token)`, `saveEmail(token, body)`, `saveLimits(token, body)`, `saveSignIn(token, body)`, `testEmail(token, body) -> {ok, message}`; `Segmented` for Task 6.

- [ ] **Step 1: Write the failing tests**

- `SuperuserShell`: the four pills in order, and `/superuser/T/settings` renders the Settings page.
- **`SuperuserSettings`:**
  - a skeleton while loading;
  - the four cards in D4's order;
  - the Email card's rows per D6 (On/Off badge, "password saved" / "No login" / "password can't be read", "certificate not checked", Last test red when failed, D9d's "Sending is failing since …: …");
  - the off sentence verbatim;
  - the dev-mode sentence with no pencil;
  - Site has the address and the sentence, and no pencil;
  - a 404 → `onAuth('expired')`.
- **`EditEmailDialog`:**
  - Encryption picks set the port to 587, 465 or 25;
  - the switch off greys the fields and hides Send test email;
  - the password placeholder appears only when a password is saved;
  - `autocomplete` attributes;
  - Save is blocked until a change;
  - the body sends `password` only when typed;
  - the test result shows above the buttons;
  - the spinner while testing, with Save and Cancel still usable;
  - a 409 test answer shows its sentence;
  - the server's 422 sentence shows in the dialog.
- **`EditLimitsDialog`:** whole MB; the D11c proxy sentence verbatim under Largest file; the server's sentence.
- **`EditSignInDialog`:** the Longest sign-in segments 1/7/30; the ranges sent as numbers.

- [ ] **Step 2: Run `npm test` to verify the new files fail.** Expected: FAIL (missing modules).

- [ ] **Step 3: Implement**

Follow `EditCourseDialog.svelte`'s pattern: the saved values, then `untrack`, then the deriveds for "changed". The cards follow `settings-mock.html`.

- [ ] **Step 4: vitest, svelte-check, gate.** Expected: all green at the new counts.

- [ ] **Step 5: Shots at 1280 wide** of:
  - the page with email on;
  - the page with email off;
  - the dev mode;
  - the stuck-queue line;
  - each dialog, and the email dialog with a test result.

  These use a fetch stub in `probe/` (no dev writes), the way Task 6 of the Users/Courses plan did. Get the user's OK on the look.

- [ ] **Step 6: Review lanes, user OK, commit**

`feat(settings): the panel's Settings page, cards and Edit dialogs (D4-D9, D11, D12)`

---

### Task 6: the login page and the live file limit

**Files:**
- Modify: `frontend/src/lib/auth.svelte.ts:47-50` (`getAuthConfig` → `{send_pin_enabled, longest_sign_in_days, max_file_mb}`)
- Create: `frontend/src/lib/uploadLimit.svelte.ts` (`uploadLimit.mb: number | null`; `loadUploadLimit()` fetches once per page load; a failure leaves `null`)
- Modify: `frontend/src/pages/Login.svelte:30-40, 89-93` (lengths ≤ longest; preselect 7 or the longest; D10b's email-off sentence)
- Modify: `frontend/src/lib/runAssets.ts:9`, `lib/evaluations.ts:8`, `lib/studentMiniProjects.ts:24` (the check reads `uploadLimit.mb`, skipped when `null`)
- Modify: the messages in `components/editor/AssetSidebar.svelte:200`, `DashboardSidePanel.svelte:602, 856`, `pages/MiniProjectDetailPage.svelte:353-354`, `RunAssetsTab.svelte:195, 287` (the saved number; "PDF only" with no number while `null`)
- Modify: `RunAssetsTab.svelte:229, 506` (show the server's 413 sentence; with none, "This file is over the server's upload limit.")
- Test: `Login.svelte.test.ts`, `runAssets.test.ts`, `evaluations.test.ts`, `studentMiniProjects.test.ts`, `AssetSidebar.svelte.test.ts`, `DashboardSidePanel.svelte.test.ts`, `MiniProjectDetailPage.svelte.test.ts`, `RunAssetsTab.svelte.test.ts`; new `uploadLimit.test.ts`

**Interfaces:**
- **Consumes:** Task 2's `/api/auth/config`; Task 5's `Segmented`.

- [ ] **Step 1: Find every hard-coded limit**

Run `grep -rnE "20 ?MB|20MB|20 \* 1024|20971520" frontend/src --include=*.ts --include=*.svelte | grep -v tests`. Add any hit the Files list misses to this task, and record it in the ledger.

- [ ] **Step 2: Write the failing tests**

- **`Login`:**
  - `longest_sign_in_days: 7` → segments 1 and 7, with 7 selected;
  - `1` → only 1;
  - `30` → 1/7/30 with 7 selected;
  - `send_pin_enabled: false` → D10b's sentence verbatim.
- **The limit in checks and messages:**
  - each lib check: with `uploadLimit.mb = 50`, a 30 MB file passes and a 51 MB file is refused with the saved number;
  - with `null`, no check;
  - each message: the saved number, or no number while `null`.
- **`RunAssetsTab`:** a 413 with the detail `"This file is over the 20 MB limit."` shows it; a 413 without a detail shows the proxy sentence; never "storage quota" for a too-big file.

- [ ] **Step 3: Run `npm test`.** Expected: the new tests FAIL.

- [ ] **Step 4: Implement**

- [ ] **Step 5: vitest, svelte-check, gate.** Expected: green.

- [ ] **Step 6: Shots** of:
  - the login page at 1280 and 400 wide, with the email on, off and longest = 1;
  - `MiniProjectDetailPage` at 400 wide with a 50 MB limit;
  - the run files tab with the proxy sentence.

  Get the user's OK.

- [ ] **Step 7: Review lanes, user OK, commit**

`feat(settings): the login page and every upload screen follow the saved settings (D10b, D11a, D11b, D12)`

---

### Task 7: CLI, deploy files and docs

**Files:**
- Modify: `docker-compose.prod.yml:78` and `cli/internal/compose/docker-compose.yml:78` (`MAX_SIZE: "60M"`); `cli/internal/compose/embed_test.go:174`
- Modify: `cli/internal/config/env.go:18-36` (drop `MATHION_MAX_FILE_SIZE` and `MATHION_MAX_COURSE_SIZE`; keep `MATHION_EMAIL_MODE=disabled`), its test `env_test.go`; `deploy/.env.prod.example:22-25`
- Modify: `cli/cmd/pin.go:12, 24` (no fixed minutes or rate; "the panel's Settings page sets how long a PIN lasts")
- Modify: `README.md:171, 201, 230, 259-261, 297` (D14, D11c)
- Modify: `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md:243` (a note that D10a of the Settings spec settles stale emails)
- Create: `docs/release-notes/settings-release-order.md` (D11c's order: push the image tag first, then the CLI tag with `APP_IMAGE` in `.github/workflows/release-cli.yml:92` and `amd64-smoke.yml` raised to it. Tell operators to run `mathion update`. The release itself is the user's step.)
- Test: `cli/internal/compose/embed_test.go`, `cli/internal/config/env_test.go`, `cli/cmd/pin_test.go` (if it exists, else the help text test the CLI already has)

- [ ] **Step 1: Write the failing Go tests**

- `embed_test.go`: the embedded compose holds `"MAX_SIZE": "60M"`.
- `env_test.go::TestGenerateEnvDropsMovedKeys`: neither size key is present, and `MATHION_EMAIL_MODE=disabled` still is.
- The pin help: there's no `"10 min"` or `"3/hour"`.

- [ ] **Step 2: Run `go test ./...`.** Expected: FAIL on those three.

- [ ] **Step 3: Implement**, including the README and the docs.

- [ ] **Step 4: Run `go test ./...`, then the backend and frontend suites once more.** Expected: all green.

- [ ] **Step 5: Review lanes, user OK, commit**

`chore(settings): bundled proxy allows 60M, CLI and docs point to the panel's Settings (D2b, D11c, D14)`

---

After Task 7, the slice's finish follows the Users/Courses slice:
1. a whole-branch review (fresh Opus and Fable);
2. the dev migration and a Safari pass, one step at a time, with the user's yes for each dev write;
3. dev cleanup;
4. the finishing menu.
