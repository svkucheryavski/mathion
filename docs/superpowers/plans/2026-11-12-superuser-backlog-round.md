# Superuser Backlog Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every "real" item left in the three superuser backlog files (71 bullets, sorted 2026-11-12 in `4944e89`), plus the two open copy calls the user has now decided, and delete each bullet in the commit that fixes it.

**Architecture:** Five tasks, one per area. Each changes only the files its bullets name, adds a failing test per bullet first, and removes that bullet from `docs/backlog/superuser-*-debt.md` in its own commit. Copy is fixed below and is used verbatim.

**Tech Stack:** Svelte 5 runes + TypeScript (vitest, jsdom), FastAPI + SQLAlchemy + Postgres 17 (pytest), Alembic, Go CLI (`cli/`, `go test`).

**Spec:** the bullets themselves in `docs/backlog/superuser-users-courses-debt.md`, `docs/backlog/superuser-branding-debt.md` and `docs/backlog/superuser-settings-debt.md` (each one names its fix), plus the user's calls copied into Global Constraints below. Design context: `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (rev 10), `2026-11-04-superuser-settings-design.md` (rev 7), `2026-11-05-superuser-branding-design.md` (rev 14), `2026-11-06-superuser-setup-design.md` (rev 19).

## Global Constraints

**Rules (the user's):**
- Branch `feat/superuser-backlog-round` off `main`. No push or merge without the user. Stage exact paths, never `git add -A`. Never stage `logo.png` or `favicon.svg`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with no session line.
- Stay inside the repo: use absolute `cd`. Probes, logs and shots go in `$SDD` = `.superpowers/sdd/2026-11-12-superuser-backlog-round/` (`probe`, `tmp`, `shots`).
- Python, pytest and alembic only via `backend/.venv`.
- No new npm, pip or Go packages. Use theme tokens only, Svelte 5 runes only, and test with mount/unmount/flushSync (no testing-library).
- Copy: plain words, they/them, never he/she. Comments may carry decision tags, never "added in this slice".
- Never print the panel token.

**Per-task loop:**
1. Write the RED tests and watch them fail.
2. Implement.
3. Run the suites.
4. Take shots when something visible changes (agterm overlay, `--size-percent 60`, base64 images).
5. Opus (general-purpose, effort high; runs the suites and mutations) and Fable (read-only) review the UNCOMMITTED diff. Never edit while a review runs. Re-run both after every fix, and fix all minors.
6. Commit only on the user's OK, then update the ledger and memory, then wait for "go".

**Suites (green = all of these):**
- backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo $?` gives 0.
- frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp npm test > $SDD/tmp/vitest.log 2>&1; echo $?` gives 0, AND `grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log` gives 0.
- svelte-check: 0 errors (11 warnings today).
- gate: `TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh` from `frontend/` gives 3028 or more, with 0 failures.
- Go (Task 5 only): `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go test ./...`.
- Svelte autofixer on each touched `.svelte` file: `npx @sveltejs/mcp svelte-autofixer <path>`.

**The user's copy calls, verbatim (2026-11-12):**
- Disable warning: `Anna is the admin of Algebra and Geometry, teaches 2 runs and is a student in 1 run.`
- Edit course, another admin typed: `<old admin> will no longer be the admin.`
- Big numbers use English grouping: `4,213`.
- Email greeting with no name: `Hi,`. With a name: `Hi <full name>,` (all email kinds).
- Admin note: `An email with a link to the course is on its way to <email>.`
- Over the limit: `<name> is over the <N> MB limit.` where a file name is shown, and `This file is over the <N> MB limit.` where none is.
- File sizes are shown 1024-based. Display only; limits are unchanged.
- PIN command in the panel's notes: keep `mathion pin` only. The README gets the docker-compose form.
- Branding, an empty value: `Line <n>: the value is empty.` followed by the existing help (`Use a hex colour, rgb(), hsl() (like `hsl(210deg 30% 36%)`), a colour name or var(--another-colour).`).
- Email sentences:
  - server takes no login: `The mail server doesn't take a login: clear the username and password.`
  - no SMTPUTF8: `The mail server can't take an address with letters like æ, ø or å.`
  - timeout during the greeting: the timeout sentence, `The mail server didn't answer within <timeout> seconds.<hint>`
  - 4xx at MAIL FROM: `The mail server asked Mathion to try again later.`
  - comma or colon in the From name: `Put a name with a comma or colon in quotes.`
  - underscore in the From domain: `The From address's domain can't contain _.`
  - non-ASCII username: `The username can't contain letters like æ, ø or å.`
  - test asked again while one runs: `The last test is still finishing. Try again in a minute.`
  - card refusal, no username saved: `The mail server refused a message: check that it accepts mail from <From> without a login.`
  - card refusal, with a login: `The mail server refused a message: check that the login may send as <From> and that it accepts Mathion's messages.`
  - Send test, same refusal: the card's sentence above.

**Two sentences the user has NOT seen yet; confirm them at plan review:**
- (T3.9) A relay that refuses every recipient: `The mail server refused every recipient: check that it lets Mathion send to other addresses.`
- (T4.1) Under the password field, when the username is cleared and a password is saved: `Without a username, the saved password isn't used.`

**Calls made by the planner (marked "my call" where used):**
- Identical tooltip lines get the course address or the run id added: `Algebra (algebra-2)`, `Algebra · Spring (run 14)`.
- Tooltip cuts go by visible character, using `Intl.Segmenter`.
- `DELETE …/courses/{id}/admin` with no admin answers 204, not 409, so a second remove is done, not an error.
- The migrations' print lines are edited in place. Both migrations are on `origin`, but only what they print changes, never the schema.

## Review Focus

- **Real smtplib shapes.** The new sentences in T3.1–T3.3 key on how smtplib wraps a failure (`SMTPNotSupportedError`'s text, `SMTPServerDisconnected` wrapping a timeout). A test built from a hand-made exception passes even if a real server takes another path. T3 drives real `smtplib.SMTP` against a local socket stub for the no-AUTH and greeting-timeout cases.
- **1024-based sizes reach student screens.** `formatFileSize` feeds submission, asset and evaluation lists. A test or gate line that pins a 1000-based string elsewhere has to change on purpose, not by accident. T4 greps for every caller and checks each screen's expected string.
- **The remove-admin 204 has other callers.** The grep in T1 found the Courses page is the only caller of `removeAdmin` outside the tests (Set up step 2 doesn't call it). It may not still treat a 409 as "someone else removed it".
- **Branding's last-good copy across threads.** `load_branding` runs in many request threads. The read counter has to be taken under `_lock` and compared under `_lock`. T2 tests two interleaved reads with a barrier, not by sleeping.
- **Duplicate tooltip lines also go to the screen-reader list.** The hidden `items` list and the `tip` have to disambiguate the same way, or VoiceOver reads two identical lines. T1's test asserts both.

---

### Task 1: Users and Courses

**Files:**
- Modify: `frontend/src/lib/superuser.ts` (`disableWarning`, `countLine`, `cut`, `roleChips`, `adminNote`, `PanelCourseRef`)
- Modify: `frontend/src/lib/slugify.ts`
- Modify: `frontend/src/pages/superuser/SuperuserUsers.svelte`, `frontend/src/pages/superuser/SuperuserCourses.svelte`
- Modify: `frontend/src/components/superuser/EditCourseDialog.svelte`, `frontend/src/components/superuser/DeleteCourseDialog.svelte`
- Modify: `backend/mathion/notifications/templates.py` (`_name` → `_greeting`), `backend/mathion/api/superuser_courses.py` (`_assigned`, `remove_admin`), `backend/mathion/schemas.py` (the panel's course ref gains `slug`), `backend/mathion/panel_people.py` (where the ref is built)
- Modify: `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (rev 11)
- Test: `frontend/src/tests/superuserApi.test.ts`, `slugify.test.ts`, `SuperuserUsers.svelte.test.ts`, `SuperuserCourses.svelte.test.ts`; `backend/tests/test_notifications_templates.py`, `test_superuser_courses.py`, `test_superuser_users.py`
- Backlog: delete the fixed bullets from `docs/backlog/superuser-users-courses-debt.md`. Its §7 "Files left on disk" and "Roster email checks" stay. The migration bullets go in Task 5.

**Interfaces:**
- Produces: `formatCount(n: number): string` in `lib/superuser.ts` (`n.toLocaleString('en-US')`). `PanelCourseRef = { id: number; name: string; slug: string }`. `DeleteCourseDialog` prop `onStale: () => void`.

- [ ] **Step 1: Write the RED tests, one per bullet**

  1. `disableWarning lists what the person loses with commas` (superuserApi). Cases:
     - 2 courses + 2 teacher runs + 1 student run gives `Disable Anna? Anna is the admin of Algebra and Geometry, teaches 2 runs and is a student in 1 run. They'll be signed out and can't sign in until enabled; tell them yourself.`
     - 2 courses + 2 teacher runs gives `…admin of Algebra and Geometry, and teaches 2 runs.`
     - 1 course + 1 student run gives `…admin of Algebra and is a student in 1 run.`
     - only 3 student runs gives `…Anna is a student in 3 runs.`

     Rule: parts are joined by `, `, and the last joiner is ` and `, or `, and ` when the part before it already contains ` and `.
  2. `countLine groups thousands`: total 4213, shown 20, gives `Showing the 20 newest of 4,213 accounts. Search to find others.`. The search form gives `20 of 4,213 match. Keep typing to narrow.`
  3. `adminNote names a link to the course`: the queued case contains `An email with a link to the course is on its way to anna@school.dk.`
  4. `roleChips disambiguates identical lines` (my call): two admin courses named "Algebra" (slugs `algebra`, `algebra-2`) give tip lines `- Algebra (algebra)` and `- Algebra (algebra-2)`, and `items` holds the same two strings. Two runs "Algebra · Spring" with ids 14 and 15 give `(run 14)` / `(run 15)`. Unique lines stay unchanged.
  5. `cut never splits a visible character`: a 31-character string ending in a flag (🇩🇰) or `é` is cut before it, never inside it. The old 31×"𝔸" test still passes.
  6. `slugFromName maps ß ł đ`: `Straße` gives `strasse`, `Łódź` gives `lodz`, `Đorđe` gives `dorde`.
  7. SuperuserUsers:
     - `Last active follows each load`: fake timers; load at T, advance 10 min, search. The row reads "10 minutes ago", not "just now".
     - `a failed reload after Disable keeps the table`: the second `listUsers` rejects; the table stays, and no "Could not load accounts." appears.
     - `a confirm finishing doesn't close another row's strip`: open row 1's Disable, confirm (held), open row 2's Delete strip, release. Row 2's strip is still open.
  8. EditCourseDialog (via SuperuserCourses):
     - `typing another admin says who stops being admin`: saved admin Anna Berg; type `bo@school.dk`; the note `Anna Berg will no longer be the admin.` shows. Retyping `ANNA@school.dk` shows no note and leaves Save not ready (the case-only retype).
     - `the no-admin line uses the typed name`: rename to "Algebra II" and clear the email; the note shows `Algebra II will have no admin.`
  9. SuperuserCourses:
     - `quiet reloads keep only the newest reply`: two quick saves; the first `listCourses` resolves last; the second's list stays.
     - `a 409 from the delete-impact lookup reloads the list`.
  10. Backend:
      - `test_greeting_without_a_name_is_plain_hi`: every template with `full_name=None` starts `Hi,\n\n`; with a name, `Hi Anna Berg,`.
      - `test_reassign_back_queues_one_email`: assign A, then B, then A with email on gives exactly one unsent `course_admin_assigned` row for A and that course. Rows already sent are kept.
      - `test_remove_admin_twice_is_done`: the second DELETE gives 204.
      - `test_users_admin_of_has_slug`.

- [ ] **Step 2: Run them; each fails for its own reason** (wrong text, a missing field, 409 instead of 204).

- [ ] **Step 3: Implement**
  - `disableWarning`: the join rule above; student part `is a student in ${runs(n)}`.
  - `countLine`: `formatCount` on `shown` and `total` in every branch.
  - `adminNote`: the new sentence.
  - `roleChips`: after building the full lines, add a suffix to each line whose full text repeats. Courses get ` (${slug})`; runs get ` (run ${id})`. Apply it to both `items` and the `tip` source. The backend adds `slug` to the ref.
  - `cut`: `Intl.Segmenter(undefined, { granularity: 'grapheme' })`. Fix the comment: "never splits a visible character".
  - `slugFromName`: replace `ß→ss, ł/Ł→l, đ/Đ→d` before NFKD.
  - Users page:
    - `shown` gains `now: Date`, set in `load()`; the template uses `shown.now`.
    - `load(quiet = false)` as on the Courses page; quiet after strip actions and saves.
    - `confirmAsk` clears `ask` only if it is still the confirmed one.
  - EditCourseDialog:
    - `emailChanged` compares lowercased.
    - The replace note shows while `saved.email !== ''`, the typed email is not empty, and the two differ in lowercase. The name comes from a `savedAdmin` kept beside `saved` (`full_name ?? email`).
    - The no-admin note uses `name.trim() || saved.name`.
  - Courses page: a `latest` counter in `load` as on the Users page (D15a).
  - DeleteCourseDialog: calls `onStale()` when the lookup fails with `ApiError` 409; the page passes `() => void load(true)`.
  - `_greeting(u)` in templates.py replaces `_name` in every `Hi …,` line.
  - `_assigned`: before adding the queued row, delete this user's unsent rows of the kind `COURSE_ADMIN_ASSIGNED` whose `payload["course_id"] == course.id`. Filter in Python; the payload is JSON.
  - `remove_admin`: no row gives 204.
  - Spec rev 11: D18's example, D5a's note sentence, D15's number grouping, the remove-admin 204, D14's duplicate suffix; status line and a history line.

- [ ] **Step 4: Suites green**, plus `grep -rn "removeAdmin" frontend/src --include='*.ts' --include='*.svelte'`. Check that no caller still expects a 409 (Review Focus).
- [ ] **Step 5: Shots**: the Users disable strip; Edit course with the replace note; a tooltip with duplicate lines.
- [ ] **Step 6: Reviews** (Opus + Fable), fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**, with the fixed bullets deleted: `fix(panel): the Users and Courses backlog items`.

### Task 2: Branding

**Files:**
- Modify: `backend/mathion/theme_css.py` (`_cut`, `_shown` → one `_echo`, the five problem helpers, `changes_in_use`)
- Modify: `backend/mathion/branding.py` (`load_branding`, `read_in`, a new `has_read()`), `backend/mathion/api/branding.py` (`favicon_ico`)
- Modify: `frontend/src/lib/pngCheck.ts` (export `pngTooBig(kind)`), `frontend/src/lib/panelForms/logoPick.svelte.ts` (`choose`)
- Modify: `docs/superpowers/specs/2026-11-05-superuser-branding-design.md` (rev 15)
- Test: `backend/tests/test_theme_css.py`, `test_branding.py`, `test_branding_files.py`; `frontend/src/tests/pngCheck.test.ts`, `SuperuserBranding.svelte.test.ts`
- Backlog: every bullet in `superuser-branding-debt.md` is fixed here, so the file is `git rm`'d.

**Interfaces:**
- Produces: `_echo(raw: str) -> str` (theme_css). `has_read() -> bool` (branding). `pngTooBig(kind: 'logo' | 'icon'): string` (pngCheck), the same sentence `checkPngBytes` gives.

- [ ] **Step 1: RED tests**
  1. `test_empty_value_says_it_is_empty`: `--bg: ;` on line 2 gives `Line 2: the value is empty. Use a hex colour, …`.
  2. `test_echo_cuts_before_escaping`: a 39-char value plus ` ` plus more is shown as 39 chars plus ` ` plus `…`, never a split code. `🙂` shows as `\U0001f642`.
  3. `test_backtick_in_an_echo_is_escaped`: a value containing `` ` `` is shown with ```, so the sentence has exactly two backticks around the echo.
  4. `test_names_are_echoed_like_values`: name `--bg​` gives `` `--bg​` isn't a theme variable. ``
  5. `test_changes_in_use_keeps_theme_order`: stored keys in the order `--primary, --bg, --muted` come back in `THEME_VARS` order.
  6. `test_changes_in_use_drops_values_equal_to_the_default`: a stored value equal to the current default is left out and logged once.
  7. `test_an_older_read_never_replaces_a_newer_copy`: two `load_branding` calls; the first `_read` is held on a `threading.Event` while the second completes with newer data, then the first finishes. `last_good()` is the newer one.
  8. `test_a_panel_save_refreshes_the_last_good_copy`: `read_in(db)` after a save, then an outage; `load_branding()` answers the saved name.
  9. `test_favicon_before_any_read_during_an_outage_is_503_unless_default`: before any read, during an outage, with an icon stored: `If-None-Match` other than the default's ETag gives 503; the default's ETag (or none) gives the default as today.
  10. Frontend `picking a file over 1 MB is refused without reading it`: `File.size` 5 MB; `FileReader` is never constructed (spy); the sentence is `The logo can be at most 1 MB.`
- [ ] **Step 2: Run; each fails for its own reason.**
- [ ] **Step 3: Implement**
  - `_echo`: collapse whitespace, cut to 40 characters with `…`, then show each character outside printable ASCII, or a backtick, as `\uXXXX` (`\UXXXXXXXX` above U+FFFF). It is used for every echoed value and name.
  - `_not_a_colour`: the empty-value sentence when the shown value is `''`.
  - `changes_in_use`: build `in_use` by walking `THEME_VARS`; skip and log once a value equal to that variable's default (compare `canonical` forms).
  - `branding.py`: an `itertools.count` read ticket, taken under `_lock` before `_read()`. Store only when the ticket is newer than the stored one (under `_lock`). `read_in` stores its result the same way. `has_read()` is True after the first stored read.
  - `favicon_ico`: on `BrandingUnavailable` with `not has_read()` and `If-None-Match` other than the default's ETag, answer `_unavailable(request, "icon")`.
  - `LogoPick.choose`: `if (file.size > PNG_MAX_BYTES) { this.refuse(pngTooBig(kind)); return; }` before reading.
  - Spec rev 15: note each changed behaviour where D10/D13/D5 describe it.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shot**: the Colours dialog with an empty-value and a backtick problem.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK** (and `git rm` the backlog file): `fix(branding): the Branding backlog items`.

### Task 3: Settings: email sentences and the send queue

**Files:**
- Modify: `backend/mathion/notifications/smtp_errors.py` (`describe`, the mid-send stop set), `backend/mathion/notifications/dispatcher.py` (`refusal_on_card`, `TickResult`, `_record`, `record_send_outcome`, `_charge`)
- Modify: `backend/mathion/api/superuser_settings.py` (`_from_problem`, a username check, `_TEST_RUNNING`, `_run_test`), `backend/mathion/api/auth.py` (`_send_login_pin` logging)
- Modify: `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (rev 8: the new sentences in D7/D9/D9c)
- Test: `backend/tests/test_smtp_errors.py`, `test_notifications_dispatcher.py`, `test_dispatcher_settings.py`, `test_superuser_settings.py`, `test_login_pin_delivery.py`
- Backlog: delete the fixed Task 3, Task 4 and Whole-branch bullets in `superuser-settings-debt.md`. These stay: "Cancel mid-test" (open), "The PIN email ignores the queue's back-off" (open), and "An old CLI's `mathion pin` still prints 10 min" (open).

**Interfaces:**
- Produces: `refusal_on_card(send_exc, failure, sender, *, has_login: bool) -> SmtpFailure | None`; `TickResult.connected: bool`.

- [ ] **Step 1: RED tests**
  1. `test_no_auth_server_says_no_login`: real `smtplib.SMTP` against a local socket stub that never offers AUTH, then `login()` gives the no-login sentence, `batch_level` True.
  2. `test_smtputf8_missing_says_letters`: `SMTPNotSupportedError("SMTPUTF8 not supported by server")` gives the æ/ø/å sentence. `SMTPNotSupportedError` stops the batch mid-send (the copied non-ASCII From bullet).
  3. `test_greeting_timeout_says_did_not_answer`: a stub that accepts and never sends a banner, with a 1 s timeout, gives `The mail server didn't answer within 1 seconds.` (whatever `timeout` is passed). Assert it is not the `Couldn't reach` sentence.
  4. `test_4xx_sender_refused_is_try_later`: `SMTPSenderRefused(451, …)` gives `The mail server asked Mathion to try again later.`, batch True. A 550 still says `refused <from> as the sender`.
  5. `test_non_smtp_failures_log_class_only`: a `UnicodeEncodeError` in the PIN send and in `_charge` logs one line with the class name and no traceback (`caplog`, `record.exc_info is None`).
  6. `test_session_with_nothing_sent_clears_the_red_line`: a stored failure; a tick that connects and logs in, but every row is skipped, clears `send_failure_message` and leaves `last_sent_at` unchanged.
  7. `test_refusal_after_body_clears_the_backoff`: a stored back-off (`send_retry_at`, step 3); a 554 `SMTPDataError` refusal clears both.
  8. `test_card_refusal_without_login` / `test_card_refusal_with_login_is_hedged`: the exact sentences.
  9. `test_relay_refusing_everyone_shows_on_card` (sentence awaiting the user's OK): two or more rows in one session, all refused at RCPT with 5xx and none sent, give that card line. A single refused recipient still doesn't.
  10. `test_send_test_reuses_the_card_refusal`: the test endpoint's answer for a 554 data refusal is the card sentence.
  11. `test_second_test_says_still_finishing`: the 409 detail is `The last test is still finishing. Try again in a minute.`
  12. From checks: `Mathion, AAU <m@uni.dk>` and `Aalborg Universitet: Institut <m@aau.dk>` give the quotes sentence. `"Mathion, AAU" <m@uni.dk>` is accepted. `m@uni.dk​` is accepted, saved without the trailing invisible character. `m@my_school.dk` gives the underscore sentence.
  13. `test_username_must_be_plain_ascii`: `jørgen@uni.dk` as the username, on save and on test, gives the username sentence.
- [ ] **Step 2: Run; each fails for its own reason.**
- [ ] **Step 3: Implement**
  - `describe`:
    - a `SMTPNotSupportedError` branch before the SSL branch: "SMTPUTF8" in `str(exc)` gives the letters sentence, otherwise the no-login sentence.
    - `SMTPServerDisconnected` whose `__cause__`/`__context__` is a `TimeoutError` or whose text ends with "timed out" gives the timeout sentence.
    - `SMTPSenderRefused` with a 4xx code gives the try-later sentence.
    - Add `SMTPNotSupportedError` to the mid-send stop set.
  - `refusal_on_card`: the `has_login` keyword chooses the sentence; callers pass `bool(view.smtp_username)`.
  - `TickResult.connected`: set once the mailer session is open and logged in. In `_record`, no failure, not sent and no refusal, but `connected`, clears the failure fields without touching `last_sent_at`. Share one `_clear_failure(row)` helper with `_record_sent`.
  - The refusal path also sets `send_retry_at = None` and `send_backoff_step = 0`.
  - Every-recipient refusal: count RCPT refusals with 5xx per session; with two or more, all refused and none sent, the result carries the card sentence through `record_send_outcome`.
  - `_run_test`: a data refusal uses `refusal_on_card(..., has_login=bool(data.username))`.
  - `_TEST_RUNNING`: the new sentence.
  - `_from_problem`:
    - strip U+200B, U+200C, U+200D, U+2060 and U+FEFF from the ends before the checks.
    - Refuse when the parsed header has a group display name or an unquoted comma in the name, with the quotes sentence.
    - An `_` in the domain gives the underscore sentence.
  - A username check (save and test): every character must be in printable ASCII.
  - `logger.exception` → `logger.error("…: %s", type(exc).__name__)` at `auth.py:110` and `dispatcher.py:182`.
  - Spec rev 8: the sentences, and a D9c note for the every-recipient line.
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Reviews**, fix, re-review until clean (no shots: no screen change beyond sentences).
- [ ] **Step 6: Commit on the user's OK**: `fix(settings): clearer email failures and a steadier send queue`.

### Task 4: Settings page and the upload screens

**Files:**
- Modify: `frontend/src/lib/panelForms/emailForm.svelte.ts` (placeholder rule), `frontend/src/components/superuser/fields/EmailFields.svelte`, `frontend/src/components/superuser/EditEmailDialog.svelte`, `frontend/src/components/superuser/setup/StepEmail.svelte` (Send test while saving), `frontend/src/components/ui/Segmented.svelte` (a `frozen` prop like `Switch`'s)
- Modify: `frontend/src/pages/superuser/SuperuserSettings.svelte` (and the Set up step that saves limits, if any) to set `uploadLimit.mb` after a limits save
- Modify: `frontend/src/lib/uploadLimit.svelte.ts` (`overLimitSentence(name?: string): string`), `frontend/src/lib/format.ts` (`formatFileSize`), `DashboardSidePanel.svelte`, `AssetSidebar.svelte`, `RunAssetsTab.svelte`, `MiniProjectDetailPage.svelte`, `AppBody.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (pin the greyed border)
- Test: `EditEmailDialog.svelte.test.ts`, `Segmented.svelte.test.ts`, `SuperuserSettings.svelte.test.ts`, `SuperuserSetup.svelte.test.ts`, `uploadLimit.test.ts`, `format.test.ts`, and the four upload-screen tests plus an AppBody case in the item editor's test
- Backlog: delete the fixed Task 5 and Task 6 bullets and the Whole-branch "red hint with the switch off" bullet. "Check by hand in the Safari pass" (proxy drop) stays.

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces: `overLimitSentence(name?: string): string`; `Segmented` prop `frozen?: boolean`.

- [ ] **Step 1: RED tests**
  1. `the saved-password hint follows the re-type rule`: change the host; the placeholder is no longer `Saved: type a new one to replace it`. Clear the username; `Without a username, the saved password isn't used.` shows (sentence awaiting the user's OK).
  2. `the unreadable-password hint hides with email off`.
  3. `Send test waits while Save runs` (dialog and Set up step 1): with Save held, a click on Send test sends no request.
  4. `the encryption choice and the certificate box hold still during Save`: no `disabled` attribute while busy; `aria-disabled="true"`; a click changes nothing.
  5. `only the newer of a save error and a test result shows`.
  6. `the test answer scrolls into view` (`scrollIntoView` spy called with `{ block: 'nearest' }`).
  7. `a limits save updates the upload limit in this tab`: after save, `uploadLimit.mb` is the saved value.
  8. `overLimitSentence`: `a.png is over the 20 MB limit.` / `This file is over the 20 MB limit.`. Each of the five screens shows it, and AppBody refuses an over-limit file before upload (no `uploadAsset` call).
  9. `formatFileSize is 1024-based`: 1023 gives `1023 B`; 1024 gives `1.0 kB`; 20.5 × 1,048,576 gives `20.5 MB`.
  10. Gate: a line asserting `.ee-input:disabled` uses `--border-faint`.
- [ ] **Step 2: Run; each fails for its own reason.**
- [ ] **Step 3: Implement**
  - Placeholder: shown only when the saved password still applies (no D8a re-type condition). The username-cleared note when a password is saved and the username is empty.
  - Red hint: `form.on && form.saved.password_unreadable`.
  - `onTest` returns while busy; the button's `aria-disabled={testing || busy}`.
  - `Segmented frozen` and the checkbox (`aria-disabled`, click `preventDefault`) while busy; `disabled` stays only for email off.
  - Save start clears `form.result`; test start clears `form.error`.
  - `{@attach}` on the result box to scroll it into view when it appears.
  - `.ee-input:disabled { border-color: var(--border-faint); }`.
  - After a limits save, `uploadLimit.mb = settings.limits.max_file_mb`.
  - `overLimitSentence` in all six places (the existing four screens' sentences replaced).
  - `formatFileSize` divides by 1024.
  - `grep -rn "formatFileSize\|MB\b" frontend/src/tests` to find every expected string that changes (Review Focus).
- [ ] **Step 4: Suites green.**
- [ ] **Step 5: Shots**: Edit email while saving; Edit email with the username cleared; an upload screen's over-limit sentence.
- [ ] **Step 6: Reviews**, fix, re-review until clean.
- [ ] **Step 7: Commit on the user's OK**: `fix(settings): the Settings page and upload-screen backlog items`.

### Task 5: Migration printouts, the CLI and operator docs

**Files:**
- Modify: `backend/alembic/versions/d5b1e7a3c9f4_one_admin_per_course_last_seen.py` (print), `backend/alembic/versions/e8c4f2a6b1d7_site_settings.py` (`_note`, `_text`, `_int`, `_mb`, `_copy`)
- Modify: `backend/mathion/superuser/__main__.py` (`pin` exit code), `cli/cmd/pin.go` (if its test needs it)
- Modify: `deploy/man/mathion.1`, `README.md` (Operations), `docs/release-notes/settings-release-order.md`, `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (D11c sentence)
- Test: `backend/tests/test_migration_one_admin_last_seen.py`, `test_migration_site_settings.py`, `test_superuser_cli.py`; `cli/cmd/pin_test.go`
- Backlog: delete these bullets:
  - the UC Task 1 bullets
  - the Settings Task 1 and Task 7 bullets
  - "Restoring a pre-update backup" and the Cleanup bullet
  - "The Email-off card names only `mathion pin`": closed by the user's call plus the README line

  "An old CLI's `mathion pin` still prints 10 min" stays. If `superuser-settings-debt.md` then holds only open items, keep it.

- [ ] **Step 1: RED tests**
  1. `test_removed_admin_lines_name_email_and_course` (capsys): `one-admin-per-course: removed anna@x.dk as admin of algebra (course_admins id=…)`, printed with `flush=True`.
  2. Settings migration (`rerun`):
     - `MATHION_MAX_FILE_SIZE=0` prints `MATHION_MAX_FILE_SIZE=0 is out of range; using 1 MB`.
     - The course-size line shows the old value: `MATHION_MAX_COURSE_SIZE=<raw> is below the largest file; using 20 MB`.
     - A username over 254 characters gives email copied as off, no sealed password, and the line `…; it is not copied, so email is copied as off`.
     - An over-long host prints no following "is empty" line.
     - `MATHION_MAX_FILE_SIZE=20MB` prints `…is not a number; using the default 20 MB`.
     - A 5000-digit value's echo is cut to 40 characters plus `…`.
  3. `test_pin_unknown_email_exits_non_zero`; `test_pin_disabled_user_exits_non_zero`.
  4. Go: `TestPinSkipsAdviceOnFailure`: a non-zero exec prints no "Log in at…".
- [ ] **Step 2: Run; each fails for its own reason.**
- [ ] **Step 3: Implement**
  - The migrations print as above, every print with `flush=True`.
  - `_text` returns why it dropped a value, so `_copy` writes one line per key and sets email off for a dropped host or username.
  - Size keys report the default in MB.
  - `pin`: `return 1` for an unknown or disabled user.
  - Man page: `Manage the superuser, issue a sign-in PIN, print versions, remove the deployment.`
  - README Operations: add the manual path's form, `docker compose … exec app python -m mathion.superuser pin <email>`, written with the same compose flags the README's manual install section already uses.
  - Release note, five sentences:
    - run `sudo mathion version` before `mathion update`
    - startup names the leftover `.env` keys in one INFO line in `sudo mathion logs app`
    - manual docker-compose operators pull the new image and run the commands themselves
    - restoring a pre-update backup with the old image needs the old email keys still in `.env`
    - an old CLI's proxy gives a 502 at 5 s for a slow email test and cuts uploads at 30 s until `mathion self-update`
  - The last of those also goes in spec D11c.
- [ ] **Step 4: Suites green** (backend, Go; frontend untouched, so the vitest run is a sanity pass).
- [ ] **Step 5: Reviews**, fix, re-review until clean.
- [ ] **Step 6: Commit on the user's OK**: `fix(ops): clearer migration printouts, pin exit codes and operator docs`.

## After Task 5

Whole-branch review (Opus + Fable, fresh). Then a short Safari pass on the screens Tasks 1, 2 and 4 change, one step at a time, on a throwaway DB. Then cleanup and the finishing menu.
