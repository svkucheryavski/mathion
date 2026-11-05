# Superuser panel: Users and Courses — design

**Status:** rev 10, 2026-11-04.
- Rev 2 folded in the builder check (D12a, D12b).
- Rev 3 folded in spec review round 1, three lanes (`.superpowers/sdd/2026-11-03-superuser-users-courses/spec-r1-*.md`), and the user's answers on mockup 2.
- Rev 4 folded in spec review round 2 (`spec-r2-*.md`) and the user's answer on confirms (D24).
- Rev 5 folds in the small points from round 3 (`spec-r3-*.md`).
- Rev 6 folds in the user's answer on the Task 6 shots ("too many pencils"): one Edit dialog per row (D24); removing the admin is clearing the email in it (D9).
- Rev 7 redacts a panel path's query string in the access log (§4, final review).
- Rev 8 gives D14 short role chips with hover lists and greyed disabled rows (Safari pass).
- Rev 9 caps the D14 hover list (Safari pass, user's: "looks very busy").
- Rev 10 words the course-delete confirm for a course with no versions (D12) and the address warning for one with no runs or students (D11), both from the Safari pass.

**Branch:** `feat/superuser-users-courses` (local).

**Builds on:** `docs/superpowers/specs/2026-07-11-superuser-panel-slice-1-design.md` (panel access, shell, dashboard) and the 2026-11-03 restyle (`55abe4a`).

**Source of the requirement:** platform spec §8, `docs/superpowers/specs/2026-04-19-mathion-platform-design.md:548-556`.

**Mockups:** `.superpowers/sdd/2026-11-03-superuser-users-courses/`
- `mock-1.html`: the pages ("Looks good").
- `mock-2.html`: the row actions ("as drawn"), the no-email note ("as drawn"). Changes since mock-2 was drawn:
  - edits open dialogs (D24);
  - course names are not links (D7);
  - the course-delete confirm is a dialog (D24);
  - the note's text follows D5a and never says she or he.

## 1. Why

Nothing in the app can create a course or make someone a course admin. `POST /api/courses` exists (`backend/mathion/api/courses.py:28`, superuser only), but no screen calls it, and no application code creates a `CourseAdmin` row; only seed scripts do. On a fresh install the first course therefore needs scripts. The superuser panel was always meant to cover this (platform §8: Users, Courses), and only its Dashboard was built.

This slice adds the panel's **Users** and **Courses** pages, so a superuser can set up a new install from the browser. They create a course, name its admin by email, and from then on the admin works in the course editor that already exists. The superuser also looks after accounts: creates, disables, enables, fixes and deletes them.

## 2. Goals, non-goals, anti-goals

**Goals**
- Create a course with its admin in one dialog; a colleague without an account gets one.
- Change, assign or remove a course's admin; rename a course; change its address; delete a course that has no runs.
- See every account, find one by email or name, and disable, enable, rename, fix the email of, or delete an unused one.

**Non-goals (later slices or never)**
- Settings (SMTP, file limits, session lengths) and the first-run setup checklist: later slices (platform §8).
- Granting or removing superuser rights in the panel. It stays the server command (`mathion superuser <email>`, `cli/cmd/superuser.go`; in dev, `python -m mathion.superuser create-superuser`). The user's decision.
- Several admins per course. One admin per course is the user's decision.
- Any authoring in the panel (versions, content, runs): the admin, or the superuser through Authoring on the main site, does that in the existing editor.
- Pages or "load more" in the Users list (D15).

**Anti-goals (would make it a failure even if it works)**
- The panel can lock everyone out: it must never disable, delete or demote a superuser.
- A delete that silently loses someone's work:
  - a course with runs cannot be deleted;
  - leftover student progress is counted in the course-delete confirm (D12a);
  - an account with any data cannot be deleted.
- A teacher or admin who is disabled keeps working in an open tab.
- An update that fails on an existing install because of this slice's migration.

## 3. Decisions

Each decision is marked as the **user's** or **mine** (a call a sensible builder could also make; the user can overrule it).

### Admin model
- D1 (user's): "Admin" stays **per course** (a `course_admins` row); there is no account-level admin flag. An account is an admin because it administers a course.
- D2 (user's): **exactly one admin per course.** Assigning replaces the current admin. A course may be left with **no admin**. The superuser can still work on it through Authoring on the main site, since superusers see every course (`courses.py:44-49`).
- D3 (user's): admins are given and taken **only on the Courses page**. The Users list shows "Admin · <course>" as a role and does not edit it.
- D4 (user's): the superuser assigns an admin by **typing an email**.
  - An existing account is used; a missing one is created on the spot with `get_or_create_user` (`backend/mathion/api/lookups.py:22`).
  - That function does no normalising, so the panel's request schemas normalise with `_normalize_email` (`schemas.py:10-21`), as `RunTeacherCreate` does (`schemas.py:491-496`).
  - They also reject an empty value after normalising, and anything without a minimal `local@domain` shape.
- D5 (user's): the new admin gets **a short email**, "You are now the admin of <course>", with a sign-in link to the course in the editor (`/courses/<slug>/edit`, `frontend/src/routes.ts:10`). This needs work in the email queue:
  - Today it can only render run emails. `_build_render_context` requires `run_id` and loads a `Run` (`notifications/dispatcher.py:55-65`), and `RenderContext.run` is mandatory (`templates.py:11-21`). A course-level row would fail on its first tick as a permanent error and never be sent.
  - So the dispatcher gains a course-scoped context: `run` becomes optional, and a `course` is added.
  - The new kind, `course_admin_assigned`, reads the course's **current** slug at send time.
  - At send time it **skips** the row, with no mail, if the recipient is no longer that course's admin, is disabled, or the course is gone. A skipped row is marked with `error = "skipped: <reason>"`, not `sent_at`, so the log stays honest. A skip is its own branch in `tick()`, not an exception: the error path (`dispatcher.py:162-195`) adds to the retry count and logs "flagged permanently" with a traceback, which would fill the operator log with false failures.
  - A `tick()` test with `MemoryMailer` covers the kind.
- D5a (user's, mockup 2; rev 4 detail mine): the panel always tells the superuser whether the colleague was told.
  - "Email is set up" means **a mailer exists**: `email_mode != "disabled"`. That is the same condition that starts the email queue (`main.py:84-88`, `mailer.py:86-88`). It is **not** `send_pin_enabled`, which is also true in debug with email off (`api/auth.py:53`), when nothing would ever be sent. The `memory` test sink counts as set up on purpose, so the `tick()` test sees the row; don't narrow this to `in ("smtp", "file")`.
  - The create and assign answers say what happened to the email: queued, email off, not sent because the account is disabled, or not sent because nothing changed (the same admin again). When more than one applies, the first in this order wins: unchanged, disabled, email off, queued (a disabled account can't use `mathion pin`).
  - The panel shows one note per case. Each opens with the result: "Anna Holm is now the admin of Statistics 101." after an assign, "Statistics 101 is created; Anna Holm is its admin." after New course. Then:
    - queued: "An email with a sign-in link is on its way to <email>."
    - email off: "Email isn't set up on this server, so tell them yourself. They sign in at <base_url>/courses/<slug>/edit with a PIN: run `mathion pin <email>` on the server (the PIN lasts <pin_expiry_minutes> minutes)." The number comes from `settings.pin_expiry_minutes` (`auth.py:70`). (`cli/cmd/pin.go`; in dev the same is `python -m mathion.superuser pin <email>`.)
    - disabled: "No email sent: this account is disabled. Enable it on the Users page so they can sign in."
    - unchanged: "They are already the admin; nothing changed." (With no change, there is no result sentence before it.)
  - The note is a strip that stays on the page until it is closed or the next action replaces it, not a toast that fades away, so the superuser can copy the command.
  - With email off, nothing is queued.
- D6 (user's, rev 3): one admin per course is enforced **in the database**.
  - The migration **keeps the earliest admin row (lowest `id`) per course and removes the others**, printing one line per removed row. It then adds a unique constraint on `course_admins.course_id`, and drops the now-redundant `uq_course_admin` and the non-unique `ix_course_admins_course_id` (`alembic/versions/*initial_schema*.py:65-67`). The model changes to match.
  - The migration must never fail on existing data: `mathion update` rolls back on any migration failure (`cli/cmd/update.go:456-462`).
  - `tests/test_teaching.py:915-916` puts two admins on one course on purpose, for the "2×2×2 role join" regression. The test already has two teachers, so the rewrite drops the second admin row; the two teachers still catch a bad join.
  - Assigning takes a course-row lock (`SELECT … FOR UPDATE`) **before** `get_or_create_user`, following the lock-before-index rule (`run_roster.py:68-77`). Two concurrent assigns then serialise instead of one failing with a 500.
  - Replacing an admin **updates the existing row's `user_id` in place**. An ORM delete plus add in one flush would not work: SQLAlchemy writes the INSERT before the DELETE, so the new unique constraint fails every time.

### Courses page
- D7 (user's): a table with the course name, address, admin (name and email, "No admin", or the admin marked as disabled), number of versions and number of runs. The course name is **plain text, not a link**: nothing in the panel leads away from it.
- D8 (user's): **New course** dialog with name, address (filled in from the name, editable) and admin's email (**required**). A hint under the email says whether an account will be created, or that the account is disabled (§5).
  - Everything happens in one transaction: insert the course, flush, then `get_or_create_user`, the admin row, the notification (D5) and the commit.
  - A taken address gives a 409, "This address is already used by another course".
  - Use a SAVEPOINT or a pre-check so a slug conflict isn't confused with the user-insert recovery.
- D9 (user's, rev 6): the admin is changed, assigned or removed in the course's **Edit** dialog (D24), in its admin's-email field with the same hint. The old admin keeps their account and loses only this course. **Clearing the email** removes the admin: the dialog then says "<course> will have no admin." before Save, and Save leaves the course with none.
- D10 (user's): **Rename** a course (its name).
- D11 (user's): **Change the address** (slug). The dialog warns that links people saved or shared with the old address will stop working, with the counts: "2 runs, 37 students". A course with no runs and no students, such as one just created, gives no counts: "Links people saved or shared with the old address will stop working." (rev 10, user's; the Safari pass would have shown "0 runs, 0 students"). The students are the distinct accounts on the rosters (`run_students`) of the course's runs (mine). That includes links in emails Mathion already sent and links inside the course's own pages. Old addresses are not remembered or forwarded.
- D12 (user's): **Delete** a course only when it has **no runs**. With runs, the trash button is greyed and says why ("2 runs: can't be deleted"). It uses `aria-disabled` with a `title`, as `IconButton` supports (`IconButton.svelte:37,164`), not a native `disabled`, so the reason can still be focused and read. The confirm is a dialog in which the course name must be typed (D24). The typed name is trimmed and must match exactly, case included; Delete stays off until it does. The dialog is built on `Modal`, not on the tick-box `DangerConfirm` the run screens use. Deleting also removes the course's files from disk (`<asset_path>/courses/<version_id>/` for each version, `api/assets.py:27`). The confirm reads "Delete <name>? Its N versions and their files go too. This can't be undone.", singular for one ("Its 1 version and its files go too."). A course with no versions, such as one just created, leaves that sentence out: "Delete <name>? This can't be undone." (rev 10, mine; the Safari pass showed "Its 0 versions").
  - D12c (mine, rev 3; review lane A I3): the order is fixed, so the runs check is atomic and the file list is complete:
    1. `SELECT courses … FOR UPDATE`. This blocks new versions and new admin rows.
    2. `SELECT course_versions WHERE course_id … FOR UPDATE`. This blocks new runs, enrollments and assets on those versions.
    3. Count runs. If there are any, answer 409.
    4. Collect the version ids.
    5. Delete the course with Core SQL (`delete(Course)`), letting the database's ON DELETE CASCADE do the rest. The ORM cascade would load every row and delete bottom-up (lane A M7).
    6. Commit.
    7. Only then remove each `courses/<vid>` directory, best-effort, as `runs.py:200-205` does.

    An `IntegrityError` that still slips through maps to 409, never 500.
- D12a (user's, builder check): a course with no runs can still hold **students' progress**. An admin can remove students from a run and then delete the run; their `user_item_states` and inactive `student_enrollments` stay tied to the course's versions and cascade away with the course.
  - Delete stays **allowed**, and the confirm says what will be lost: "Also deletes the progress of 14 students (pages visited, quiz answers)."
  - The count is of distinct accounts with `user_item_states` in the course's items, **excluding the current admin and every superuser** (their own preview clicks).
  - Once the runs are gone, Mathion no longer records who taught them, so a former teacher's preview progress counts like anyone else's; that is accepted.
  - Accounts enrolled at course level with no progress aren't counted.
  - The count only informs the confirm; it never blocks.
- D12b (user's, builder check): the old main-site endpoint `DELETE /api/courses/{id}` (`courses.py:143`) is **removed**. Deleting a course happens only in the panel, behind its token.
  - Three tests call it (`tests/test_courses.py:79-85`, `tests/test_access_control.py:110-114` and `:148-152`). They are deleted or re-pointed to the panel endpoint. After the removal that path answers 404 (the `/api/{rest:path}` catch-all in `main.py`; Task 3 ruling), not 403.
  - The old `POST /api/courses` (`courses.py:28`) **stays** as it is. It makes only an empty course and is used about 160 times as test setup.
- D13 (mine; transliteration is the user's, rev 3): address rules are the existing course slug rules, `CourseCreate.slug` in `backend/mathion/schemas.py:25`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1-80 characters, unique (`models.py:15`).
  - Filling the address from the name first transliterates **æ→ae, ø→oe, å→aa** (and their capitals), then strips the accents from other letters (é→e, ü→u).
  - Then it lower-cases, turns each run of other characters into one hyphen, and trims hyphens at the ends. For example, "Kemometri på dansk" becomes `kemometri-paa-dansk`.
  - A long result is cut to 80 characters and its end hyphens trimmed again, so a long name never gives a 422 with nothing marked wrong.
  - A name that gives an empty address leaves the field empty for the superuser to fill.
  - The address follows the name only until the superuser edits the address field; after that it is left alone.

### Users page
- D14 (user's, rev 8 from the Safari pass): a table with name, email, roles, last active and row actions. The **roles** are worked out, not stored, and each is one short chip with no course names and no words "course" or "run":
  - "Superuser";
  - "Admin (N)": N courses they administer (one admin per course does not mean one course per admin);
  - "Teacher (N)": N runs (`run_teachers`);
  - "Student (N)": N runs (`run_students`);
  - the number shows even at 1: "Admin (1)";
  - an account with no role shows "—".

  **Hovering a chip shows its list** in the browser's own tooltip (`title`), one item per line: Admin lists the course names; Teacher and Student list their runs as "<course> · <run title>". Superuser has none.

  The **tooltip is capped** (user's, rev 9; a 40-run list "looks very busy"):
  - each line starts with "- ";
  - at most ten items; a longer list shows the first ten, then one more line "… and N more", with no bullet;
  - a course name is cut to at most 24 characters and a run title to at most 20, the "…" included (so a cut name keeps up to 23 or 19 characters, a trailing space dropped, then "…"); Admin's course names are cut the same way to 30 (the numbers are mine; the user asked for 20-30). Cutting the two parts apart keeps the run title, which tells two runs of one course apart, in view.

  The same list, complete and uncut, is in visually hidden text inside the chip, so a screen reader reads it (mine). The users list therefore sends the teacher and student runs as lists of `{id, title, course_name}`, not counts.

  A **disabled account's row is greyed** (user's; a Disabled column with a disc was tried in the Safari pass and dropped): the row's cells take the `--disabled-bg` fill (#FBFBFC, the theme's disabled-control fill; user asked for "#fafafa or similar", and #F5F6F9 was too dark), the name turns the muted grey and loses its weight, and the role chips take the disabled-state grey; email and last active are muted already. The icons stay as they are, since Enable and Edit are what a superuser needs there. A screen reader hears "Disabled" after the name (visually hidden). There is no "Disabled" chip and no Disabled column. The Disable warning (D18) still names the courses and says "teaches N runs".
- D15 (user's): **no pages.** The list shows the **20 most recently created** accounts, newest first. Typing in the search box filters on the server and shows up to 20 matches. Filter pills (All, Admins, Teachers, Students, Disabled) combine with the search.

  A line under the table always says how many are shown (exact copy mine, rev 4). The noun follows the pill: "accounts", "admins", "teachers", "students", "disabled accounts", and is singular for one ("1 account").
  - no search, more than 20: "Showing the 20 newest of 42 accounts. Search to find others."
  - no search, 20 or fewer: "12 accounts".
  - searching, more than 20 matches: "20 of 57 match. Keep typing to narrow."
  - searching, 20 or fewer: "5 match".
  - searching, none: "No accounts match", the noun following the pill ("No students match").
  - no search and an empty pill: "No disabled accounts" (or "No admins", and so on).
  - D15a (mine, rev 3; review lane B I4):
    - Pill counts are **totals** and don't follow the search.
    - A disabled account still counts in its role pills, and in Disabled too.
    - "Admins" means "admin of a course", "Teachers" means "teacher of at least one run", and "Students" means "in at least one run's roster".
    - The search fires after a 250 ms pause, and a reply that arrives after a newer request is dropped.
    - Search terms escape `%` and `_` (`ilike(…, escape='\\')`).
- D16 (mine): the search matches the email **or** the name, as a case-insensitive substring. The user asked for email; matching the name as well costs nothing.
- D17 (user's): **New account** takes an email and an optional name. Creating it sends no email; the account isn't tied to anything yet. An email that already has an account gets a 409, "An account with this email already exists".
- D18 (user's): **Disable / Enable**, with a confirm strip under the row (D24) that names what the person loses: "Disable Anna Holm? Anna Holm is the admin of Statistics 101 and teaches 2 runs. They'll be signed out and can't sign in until enabled; tell them yourself." Mathion stores no gender, so the text never says she or he.
  - Disabling also **deletes the person's sessions**, in the same transaction as the flag (lane A M9: `invalidate_all_sessions` commits on its own, `auth.py:162-167`, so don't call it mid-handler).
  - `validate_session` already rejects a disabled user (`auth.py:143`), so an open tab stops working at its next request, and unsaved editor work in that tab is lost. That is accepted.
  - The login page keeps its usual answer ("PIN sent", no reason given); that is accepted.
  - Disabling an admin does **not** remove them from the course (mine): enabling them again restores everything. The Courses page marks the admin as disabled, and admin emails skip disabled accounts (D5).
- D19 (user's): **Edit the name** and **change the email**.
  - A changed email must not belong to another account. The server checks first, and also maps an `IntegrityError` on the update to 409 inside a SAVEPOINT, because a roster import can create the same address in between.
  - Changing the email **deletes the account's sessions and unused PINs**, in the same transaction (lane A I5, lane C). A mistyped address may belong to a stranger who has already signed in, and PINs are keyed by `user_id`, so an old-address PIN would otherwise still work.
  - The dialog says: "They will need to sign in again with the new address." The person keeps all their history.
- D20 (user's): **Delete** only an **unused** account. The rule (mine, rev 3) counts every reference to `users.id`:
  - **Blocks the delete:** any `course_admins`, `run_teachers`, `run_students`, `student_enrollments` or `user_item_states` row; any `submissions.submitted_by` or `evaluations.evaluated_by`; and any `runs.created_by`, `assets.uploaded_by` or `run_assets.uploaded_by` (stricter than the bare minimum, so authorship is never lost).
  - **Doesn't block** (deleted with the account): `sessions`, `login_pins`, `notification_log`.
  - Sign-ins don't survive logout (session rows are deleted), so "has no data" is the test, not "has never signed in". Anything else can only be disabled.
  - The delete locks the user row (`SELECT … FOR UPDATE`) **before** the check. A roster import or an assign that commits in between then makes the delete wait and refuse, instead of being cascaded away (lane A I2).
  - The trash shows **only** on an account with no data; it is hidden, not greyed, otherwise (mock-2). This differs from the Courses trash on purpose: a course with runs is worth explaining, while an account with data is simply disabled instead.
  - The confirm is a strip under the row (D24).
- D21 (user's): **superusers are shown but untouchable.** Their row has no Disable, Delete or email change, and the server refuses those actions for a superuser account too. The name can still be edited (mine).

### Edits are dialogs
- D24 (user's, rev 3, 4 and 6): **no new tabs, no in-cell editing, one Edit dialog per row.** Cells are plain text. A row's last column holds one pencil (Edit) and the trash. The pencil opens one small dialog, built on the shared `ui/Modal.svelte`, with **all** the row's editable fields, Cancel/Save, and the warnings and hints inside it (rev 6: the user saw a pencil per field and said "too many pencils"). The dialogs are:
  - **Edit course:** Course name, Address, Admin's email (D9-D11). The address warning (D11) shows only while the address differs from the saved one. Save is off until something changed and name and address are filled. Save sends only what changed: the name and address in one request, then the admin (set, or removed when the email is cleared). If the second request fails, the dialog stays open with the server's sentence; what already saved becomes the dialog's new starting point, so Save retries only the rest (mine). The D5a note shows only when the admin changed.
  - **Edit account:** Name and Email (D19), on the same rules.

  New course and New account are dialogs too.
  - `Modal` defaults to 920 px wide (`Modal.svelte:51-52`), so these dialogs pass a small width.
  - **Confirms** (user's, rev 4): Disable, Enable and Delete account confirm in a **strip under the row**, the app's `InlineConfirm` pattern, as mock-2 drew them. Only **Delete course**, where the name is typed, is a dialog.

### Last active
- D22 (mine): "Last active" needs a value that survives logout, and sessions are deleted at logout. Add a nullable `users.last_seen_at`:
  - set it at sign-in, when the session is created in `verify_pin` (`auth.py:115-125`);
  - bump it together with the session's throttled `last_active_at` update (`auth.py:148`, at most every 5 minutes);
  - in the migration, backfill it from the later of `max(sessions.last_active_at)` and the user's **newest** sign-in PIN when it is used (`login_pins`). PINs are never pruned, so this dates people who signed out before the update (user, Task 1 review). Only the newest PIN counts: `request_pin` marks older unused PINs used, so an older used PIN proves no sign-in. The PIN's time is its request time, up to the PIN lifetime before the sign-in.

  Show it as relative text ("2 hours ago", "never").

### Panel shell
- D23 (user's, from the mockup): the panel bar's gold "Superuser" label becomes three nav pills, **Dashboard, Users and Courses**, with the active pill in the gold look. Routes: `/superuser/{token}`, `/superuser/{token}/users`, `/superuser/{token}/courses`. The bar still has no links that leave the panel.
- D25 (mine, rev 3; lane B I3): **the token's 404 keeps one meaning.** A 404 from the panel guard means the link has expired or is invalid (`superuser.py:25-35`).
  - Every new endpoint answers "the course or account is gone" with **409** and a message ("This course was deleted"), never 404.
  - 409 therefore means several things: gone, has runs (D12c), address taken (D8), email taken (D17, D19). The frontend shows the server's `detail` text as it is, never a sentence picked by status. On any 409 a dialog stays open with the input kept and shows the message, and the list reloads in the background, so a row that is gone disappears once the dialog is cancelled. A confirm strip that gets a 409 (an account that gained data, an admin already removed, a row gone) closes; the server's message shows in the note strip (D5a), and the list reloads.
  - The shell handles the guard's 401 (go and sign in) and 404 (the expired-link page) once, for every panel page.
  - An expired link loses an open dialog's input. That is accepted: the inactivity window is 30 minutes, and every save resets it.

## 4. Constraints

- **Access and CSRF.** Every new endpoint is guarded the way the stats endpoint is: `require_superuser_panel` (`backend/mathion/api/superuser.py:20`) checks the token, then the session, then the superuser flag.
  - Every **mutating** endpoint also enforces the CSRF header, reusing `_require_csrf` (`api/auth.py:41`). The order is token → session → superuser → CSRF, so a request without the header still sees the route-hiding 404 first, for example through a `require_superuser_panel_write` dependency.
  - Every new endpoint lives under `/api/superuser/{token}/…`. The middleware already sets `Cache-Control: no-store` and `no-referrer` on every `/api/superuser/` response (`backend/mathion/main.py:113-122`), and the frontend routes add `/superuser/:token/users` and `/superuser/:token/courses` beside the existing `/superuser/:token` (`frontend/src/routes.ts:19`).
- **Access log** (rev 7, final review). The Users search sends what the superuser typed, often an email, as `?q=`. The access-log filter (`mathion/superuser/log_redaction.py`) therefore redacts a panel path's whole query string to `?[redacted]`, as well as the token. This supersedes the 2026-07-14 hardening spec's "query string preserved"; other paths are unchanged.
- **Concurrency.** The locks and orders in D6, D12c, D19 and D20. Follow the existing patterns: lock before `get_or_create_user`, SAVEPOINT recovery, Phase 9-A2.
- **One page column, no new dependencies.** Svelte 5, no new JS, CSS or Python packages. Reuse the shared UI pieces: Button, IconButton (pencil, ×, trash, as `RunTeachersTab.svelte:121-127` does), Modal, InlineConfirm, FilterPills and Skeleton. The table copies the teaching list's look (`TeacherRunListPage.svelte:153-170`).
- **Width.** The panel is laptop-only; the 400px rule is for student screens. Nothing may overflow at narrower widths, though.
- **Gate.** The visual-refresh gate (`frontend/scripts/visual-refresh-gate.sh`) covers new components as it covers the rest.
- **Copy.** Plain words ("admin", "course", "account", "Disable", "Delete"), and no he or she. The panel's sign-out button stays "Sign out" (user, 2026-11-03).

## 5. Inputs a person will meet (for the plan's Review Focus)

- **An email with capitals or spaces, or not an email at all:** normalise as login does; refuse an empty value or one without `@` (D4).
- **A disabled account given as admin:** allowed (mine), with the hint "This account is disabled: they can't sign in until you enable it", and no email is sent (D5).
- **The course's current admin assigned again:** a no-op, with no email.
- **An admin replaced or removed while they have the editor open:** their next save gets the editor's usual "no access" answer, with no crash.
- **A course deleted while someone has it in the editor:** their next save gets a clean "not found".
- **A run created, or a version duplicated, while a course is being deleted:** handled by the D12c order. The delete either refuses with 409 or removes everything, files included.
- **The superuser's own row:** no action can lock the acting superuser out (D21).
- **A search with `_` or `%`:** matched literally (D15a).
- **A course's address changed while people have it open:** saves keep working, since they use ids. The next in-app navigation or a reload shows "not found" (`SequencePlayer.svelte:80,102,127`), and a student on a mini-project page breaks at once, since it fetches by address (`studentMiniProjects.ts:68,89`). That is what D11's warning covers; no design change.
- **A roster import racing an unused account's delete:** the import found the account before the delete's lock, then fails on its insert once the delete commits. That gives a 500 today. It is narrow (the account had no data, so it was on no roster) and accepted.
- **Email off on a debug server:** the admin note says email is off, not "on its way" (D5a).

## 6. What's left to the builder

- API shape (paths, payloads), within the access, CSRF and status-code rules above.
- How the role counts and pill totals are computed: one query, or a small set of them.
- The exact empty, loading and error states, in the app's existing patterns (Skeleton, ErrorState).
- How to split the work into tasks.

## 7. Out of scope, noted for the backlog

- **Files left on disk:** `delete_version` (`versions.py:398-407`) and a non-force `delete_run` (`runs.py:166-176`) leave `courses/<vid>` and `runs/<rid>` behind. The course delete can't see those (lane A M15).
- **Stale emails:** with email off, the other email kinds still pile up in `notification_log` and all go out once email is set up (lane A M16). D5a avoids this for the admin email only. *Settled by D10a of the Settings spec (`2026-11-04-superuser-settings-design.md`): what is queued while email is off is never emailed.*
- **Roster email checks:** the roster schemas have the same email-shape gap as D4 (lane A M3).
