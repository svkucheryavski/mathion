# Superuser panel: Users and Courses — design

**Status:** rev 2, 2026-11-03, for the user's review (rev 2 folds in the builder check: D12a, D12b).
**Branch:** `feat/superuser-users-courses` (local).
**Builds on:** `docs/superpowers/specs/2026-07-11-superuser-panel-slice-1-design.md` (panel access, shell, dashboard) and the 2026-11-03 restyle (`55abe4a`).
**Source of the requirement:** platform spec §8, `docs/superpowers/specs/2026-04-19-mathion-platform-design.md:548-556`.
**Mockups:** `.superpowers/sdd/2026-11-03-superuser-users-courses/mock-1.html` (the user said "Looks good").

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
- Granting or removing superuser rights in the panel. It stays the server command (`python -m mathion.superuser create-superuser`, later `mathion superuser`). The user's decision.
- Several admins per course. One admin per course is the user's decision.
- Any authoring in the panel (versions, content, runs): the admin does that in the existing editor.
- Pages or "load more" in the Users list (see §4.1).

**Anti-goals (would make it a failure even if it works)**
- The panel can lock everyone out: it must never disable, delete or demote a superuser.
- A delete that loses students' work: a course with runs cannot be deleted, and an account with any data cannot be deleted.
- A teacher or admin who is disabled keeps working in an open tab.

## 3. Decisions

Each decision is marked as the **user's** or **mine** (a call a sensible builder could also make; the user can overrule it).

### Admin model
- D1 (user's): "Admin" stays **per course** (a `course_admins` row); there is no account-level admin flag. An account is an admin because it administers a course.
- D2 (user's): **exactly one admin per course.** Assigning replaces the current admin. A course may be left with **no admin**: the superuser can still open it, since superusers see every course (`courses.py:84`).
- D3 (user's): admins are given and taken **only on the Courses page**. The Users list shows "Admin · <course>" as a role and does not edit it.
- D4 (user's): the superuser assigns an admin by **typing an email**. An existing account is used; a missing one is created on the spot (the roster's `get_or_create_user`, `backend/mathion/api/lookups.py:20`, does this already).
- D5 (user's): the new admin gets **a short email**, "You are now the admin of <course>", with a link to the course in the editor. It goes through the existing email queue, as `run_teacher_assigned` does (`run_teachers.py:43`, a `NotificationLogEntry`; template in `backend/mathion/notifications/templates.py`). If email isn't configured on the server, it simply isn't sent, as with the other emails.
- D6 (mine): an existing `course_admins` table may hold more than one row per course: the model allows it (`UniqueConstraint("course_id","user_id")`), and today's dev data has one per course. The builder decides how to enforce one admin per course, for example a unique index on `course_id` with a migration that refuses, or reports, existing duplicates. The rule must hold under two concurrent "assign" requests.

### Courses page
- D7 (user's): a table: course name, address (`/courses/<slug>`), admin (name and email, or "No admin"), number of versions, number of runs, and a row action.
- D8 (user's): **New course** dialog: name, address (filled in from the name, editable), admin's email (**required**). A hint under the email says whether an account will be created.
- D9 (user's): **Change admin / Assign admin** turns the admin cell into an email field with ✓/×, the inline-edit pattern used elsewhere in the app. The old admin keeps their account and loses only this course. The superuser can also **remove** the admin and leave the course with none.
- D10 (user's): **Rename** a course (its name).
- D11 (user's): **Change the address** (slug). The confirm warns that links people saved or shared with the old address will stop working. Old addresses are not remembered or forwarded.
- D12 (user's): **Delete** a course only when it has **no runs**. With runs, Delete is disabled and says why ("2 runs: a course with runs can't be deleted"). The database already enforces this: `runs.version_id` is `ondelete="RESTRICT"` (`models.py:205`). The confirm asks for the course name to be typed. Deleting also removes the course's files from disk (`<asset_path>/courses/<version_id>/` for each version, `api/assets.py:27`).
- D12a (user's, after the builder check): a course with no runs can still hold **students' progress**. An admin can remove students from a run and then delete it; their `user_item_states` and inactive `student_enrollments` stay tied to the course's versions and cascade away with the course. Delete stays **allowed**, and the confirm says what will be lost: "Also deletes the quiz progress of 14 students." The count is of distinct accounts with progress in the course's items, other than the course's current admin (whose own preview progress is not mentioned). Once the runs are deleted, Mathion no longer records who taught them, so a former teacher's preview progress counts like anyone else's; that is accepted. Nothing here ever blocks the delete; it only informs the confirm. The anti-goal "a delete that loses students' work" is met by the runs block plus this explicit count.
- D12b (user's, after the builder check): the old main-site endpoint `DELETE /api/courses/{id}` (`courses.py:142`, superuser session, no runs check, no file cleanup, no screen uses it, no test uses it) is **removed**. Deleting a course happens only in the panel, behind its token. The old `POST /api/courses` (`courses.py:28`) **stays** as it is: it only makes an empty course and is used about 160 times as test setup. No screen calls it, and the panel's create has its own endpoint with the admin rule.
- D13 (mine): address rules are the existing course slug rules, `CourseCreate.slug` in `backend/mathion/schemas.py:25`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1-80 characters, and unique (`models.py:15`). Filling the address in from the name lower-cases it, turns each run of other characters into one hyphen, and trims hyphens at the ends. A name that gives an empty address (all symbols) leaves the field empty for the superuser to fill. A taken address is refused with a clear message.

### Users page
- D14 (user's): a table: name, email, roles, last active, and a row action. The **roles** are worked out, not stored:
  - "Superuser";
  - "Admin · <course>" for each administered course;
  - "Teacher · N runs";
  - "Student · N runs";
  - "Disabled".
- D15 (user's): **no pages.** The list shows the **20 most recently created** accounts. Typing in the search box filters on the server and shows up to 20 matches; if more match, a line says "20 of 57 shown — keep typing to narrow". Filter pills (All, Admins, Teachers, Students, Disabled), each with its total count, combine with the search.
- D16 (mine): the search matches the email **or** the name, case-insensitive substring. The user asked for email; matching the name as well costs nothing.
- D17 (user's): **New account:** an email and an optional name. Creating it sends no email; it isn't tied to anything yet.
- D18 (user's): **Disable / Enable**, with a confirm that names what the person loses, e.g. "Disable Anna Holm? She is the admin of Statistics 101 and teaches 2 runs." Disabling also **deletes the person's sessions**. `validate_session` already rejects a disabled user (`auth.py:143`), so an open tab stops working at its next request either way. Disabling an admin does **not** remove them from the course (mine): enabling them again restores everything, and the Courses page shows the admin as disabled.
- D19 (user's): **Edit the name** and **fix the email**. A changed email must not be in use by another account (refused with a message, mine). The person then signs in with the new address and keeps all their history. Any unused PINs for the old address are dropped (mine).
- D20 (user's): **Delete** only an **unused** account. The rule (mine) is: no `course_admins`, `run_teachers` or `run_students` rows, no submissions, evaluations or item progress (`user_item_states`), and no student enrollments. A record of sign-ins doesn't survive logout (session rows are deleted), so "has never signed in" can't be checked reliably; "has no data" is the test. Anything else can only be disabled.
- D21 (user's): **superusers are shown but untouchable.** Their row has no Disable, Delete or email edit, and the server refuses those actions for a superuser account as well. The name can still be edited (mine).

### Last active
- D22 (mine): "Last active" needs a value that survives logout, and sessions are deleted at logout. Add a nullable `users.last_seen_at`, bumped together with the session's own throttled `last_active_at` update (`auth.py:148`, at most every 5 minutes). Show it as relative text ("2 hours ago", "never"). The builder may pick another source if it gives the same answer.

### Panel shell
- D23 (user's, from the mockup): the panel bar's gold "Superuser" label becomes three nav pills: **Dashboard, Users, Courses**. The active pill uses the gold look. Routes: `/superuser/{token}`, `/superuser/{token}/users`, `/superuser/{token}/courses`. The bar still has no links that leave the panel.

## 4. Constraints

- **Access and CSRF.** Every new endpoint is guarded the way the stats endpoint is: `require_superuser_panel` (`backend/mathion/api/superuser.py:20`) checks the token, then the session, then the superuser flag. Every **mutating** endpoint must also enforce the `X-Requested-With: mathion` CSRF check explicitly, because `require_superuser_panel` doesn't go through `get_current_user` (slice-1 spec §3.2 and line 75; the check itself is `dependencies.py:14-16`).
- **Concurrency.** Assigning an admin and creating an account can race: two tabs, or a roster import creating the same email. Follow the existing patterns: `get_or_create_user`'s SAVEPOINT recovery, and advisory locks where the enrollment paths use them. The Postgres concurrency work (Phase 9-A2) set those patterns.
- **One page column, no new dependencies.** Svelte 5, no new JS, CSS or Python packages (`feedback_frontend_stack`, `feedback_backend_no_new_deps`). Reuse the shared UI pieces (Button, Modal, DangerConfirm, FilterPills, InlineName or the create-row ✓/× pattern, Skeleton) and the teaching table's look (`TeacherRunListPage.svelte:153-170`).
- **Width.** The panel is laptop-only; the 400px phone rule applies to student screens only (`project_min_width_400`). Nothing may overflow at narrower widths, though.
- **Gate.** The visual-refresh gate (`frontend/scripts/visual-refresh-gate.sh`) covers new components as it covers the rest: no bare hex, tokens only, and pins for the new look.
- **Copy.** Plain words: "admin", "course", "account", "Disable", "Delete". The panel's sign-out button stays "Sign out" (user, 2026-11-03).

## 5. Inputs a person will meet (for the plan's Review Focus)

- An email typed with capitals or spaces: normalise it as login does (trim, lower-case).
- An email that belongs to a disabled account, assigned as admin: say so in the hint ("This account is disabled") and decide whether to allow it. Mine: allow it, with the hint, since enabling is one click away.
- Assigning the course's current admin again: a no-op, no email.
- Deleting a course while someone has it open in the editor: their next save gets a clean "not found", not a crash.
- A superuser's own row: no action may lock the acting superuser out (covered by D21).
- A search with no results: "No accounts match".

## 6. What's left to the builder

- API shape (paths, payloads, error codes), within the access and CSRF rules above.
- How the role counts are computed: one query, or a small set of them.
- The exact empty, loading and error states, in the app's existing patterns (Skeleton, ErrorState).
- Whether "New account" and "New course" are modals or inline rows. The mockup shows a modal for New course.
- How to split the work into tasks.
