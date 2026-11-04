# Superuser panel: Users and Courses — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the superuser panel gets a **Courses** page (create a course with its admin, rename, change address, change/remove the admin, delete a course with no runs) and a **Users** page (find, create, rename, change email, disable/enable, delete an unused account), so a new install is set up from the browser.

**Architecture:**
- **Data (Task 1).** One Alembic revision: exactly one admin per course (keep the earliest row, unique `course_admins.course_id`) and a nullable `users.last_seen_at`, set at sign-in and on the throttled session bump.
- **Email (Task 2).** The dispatcher gains a course-scoped context and a skip branch; a new kind `course_admin_assigned`. The panel gets a write guard (token → session → superuser → CSRF).
- **API (Tasks 3, 4).** Two new routers under `/api/superuser/{token}/…`: `api/superuser_courses.py` and `api/superuser_users.py`. Request/response models live in `schemas.py`. The old `DELETE /api/courses/{id}` goes.
- **Frontend (Tasks 5–7).** `SuperuserShell` gets three nav pills and owns the 401/404 handling for every panel page. Shared pieces: `FieldDialog` (the one-field edit dialog), `NoteStrip` (the note under the page title), `lib/slugify.ts`, `lib/relativeTime.ts`. Then `SuperuserCourses.svelte` and `SuperuserUsers.svelte`.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Pydantic, PostgreSQL 17, Alembic, pytest (via `backend/.venv`); Svelte 5 runes, Vitest + jsdom (`mount`/`unmount`/`flushSync`); the zsh gate `frontend/scripts/visual-refresh-gate.sh`. No new npm or pip packages.

**Spec:** `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md`, rev 5 (`554f36c`), approved by the user on 2026-11-03. Its decisions D1–D25 are binding; this plan cites them by name and does not repeat their reasoning. Mockups: `$SDD/mock-1.html`, `$SDD/mock-2.html` (with the changes the spec lists under **Mockups**).

**Line numbers** are from `554f36c`. An earlier task shifts them in files it also touches; find the place by the quoted text.

## Global Constraints

- **Branch:** `feat/superuser-users-courses` (off main `55abe4a`). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`; absolute `cd` only, never `cd ..`. `$SDD` = `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-11-03-superuser-users-courses`: probes in `probe/`, logs and gate temp files in `tmp/`, screenshots in `shots/`. Never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. Component tests use `mount` / `unmount` / `flushSync` from `svelte`, never `@testing-library/svelte`.
  - Python, pytest and alembic only through `backend/.venv`.
  - Match the surrounding comment density. A comment may carry the decision tag (`D12c`), never "added in this slice".
- **Colours:** theme tokens only; no literal colours; no `opacity` to dim.
- **No new tabs, no in-cell editing (D24).** Edits open `FieldDialog`; Disable/Enable/Remove admin/Delete account confirm in an `InlineConfirm` strip under the row; only Delete course is a dialog. Nothing in the panel links out of it.
- **Copy (§4):** plain words, never "he"/"she". "Sign out" stays. The exact strings in D5a, D11, D12, D12a, D15, D18, D19 are copied verbatim into code and tests.
- **Status codes (D25):** the guard's 404 means only "link expired/invalid". A gone course/account and every fixable conflict is **409** with a `detail`. A refused action on a superuser account is **403** with a `detail`. The frontend shows `ApiError.displayMessage` as it is.
- **Pinned CSS rules are single-selector blocks** (the gate's `d` helper matches `.cls.svelte-HASH{…}`). No apostrophe inside the gate's `node -e '…'` payload.
- **Commands** (write `$SDD` out in full when you run them):
  - **Backend:** `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/pytest.log`. One file: `.venv/bin/pytest -q tests/<file>`.
  - **Frontend tests:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green = `exit 0` AND the last count `0`.
  - **Typecheck:** `npx svelte-check --output machine | tail -1`: 0 errors, and no more warnings than the baseline recorded at Task 1 start (13 at `554f36c`).
  - **Gate:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. Ends `VISUAL-REFRESH GATE: ALL PASS (N checks)`; bump `EXPECTED_CHECKS` (line 90, now 2522) by the rows a task adds.
  - Baselines at `554f36c`: gate 2522, vitest 172 files / 2705 tests, svelte-check 0/13. Record the backend count at Task 1 start.
- **If an iCloud " 2" copy appears** (`find . -name "* 2.*"`), `cmp` it with its original and ask the user before deleting.
- **Per task, in this order** (the user's loop):
  1. TDD, step by step as written.
  2. Backend suite (Tasks 1–4) / vitest + svelte-check + gate (Tasks 5–7), all green.
  3. Tasks 5–7: agent-browser shots at 1280 wide of the screens the task names, shown in an agterm overlay (`--size-percent 60`, base64 images, the HTML in `$SDD`); the user's OK on the look.
  4. Two review lanes on the UNCOMMITTED diff: Opus (high effort) and Fable. Fix every Critical and Important, then re-run both lanes after EVERY fix until both are clean. Push back on a wrong finding with evidence. Minors go to `docs/backlog/superuser-users-courses-debt.md` (created in Task 1) under the task's heading. Never edit the tree while a lane reviews.
  5. With the user's commit OK: exact paths (never `git add -A`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no session line.
  6. A ledger line in `$SDD/progress.md`, a memory update, then WAIT for the user's "go".
- **Dev servers** (already running; never start a second copy): backend uvicorn :8000 (`MATHION_DEBUG=1 MATHION_ASSET_PATH="$HOME/mathion-assets"`, `--reload`; email off), vite `http://localhost:5174`. The dev DB needs the Task 1 migration before the new pages work: run `backend/.venv/bin/alembic upgrade head` against dev only with the user's yes. Signing in, minting a panel token, and every panel write in dev write shared data: ask first. Rows to delete at slice end are listed in the ledger.

## Review Focus

The inputs most likely to bite a person that no step below would otherwise pin. Each has its test in the owning task.

1. **The acting superuser locks themselves out.** Disable, delete or email change on their own row (or any superuser) must be refused by the server, not only hidden (D21). → Task 4, `test_superuser_rows_refuse_disable_delete_email`.
2. **Email off on a debug server says "on its way".** The dev setup is `MATHION_DEBUG=1` + email disabled; the answer must be `email_off` (D5a). → Task 3, `test_assign_with_email_disabled_in_debug_reports_email_off`.
3. **A skipped admin email is logged as a failure.** A skip must not raise, retry, or log "flagged permanently" (D5). → Task 2, `test_skip_does_not_touch_retry_or_log_warning`.
4. **A 409 in a confirm strip or note looks like a note.** Errors in the note strip carry `role="alert"` and the error look; info notes carry `role="status"` (spec r4 lane B). An admin without a name is named by email in the result sentence. → Task 5, `NoteStrip` tests; Task 6, `result sentence falls back to email`.
5. **A long or non-Latin course name gives an unusable address.** `slugFromName` must transliterate æøå, strip accents, cut to 80 and re-trim, and return `''` for a name with no letters (D13). → Task 5, `slugify.test.ts`.

---

### Task 1: one admin per course, `last_seen_at`

**Files:**
- Create: `backend/alembic/versions/d5b1e7a3c9f4_one_admin_per_course_last_seen.py`
- Modify: `backend/mathion/models.py:23-35` (CourseAdmin), `backend/mathion/models_auth.py:9-20` (User), `backend/mathion/auth.py:115-125` (verify_pin) and `:146-157` (validate_session bump)
- Modify: `backend/tests/test_teaching.py:915-916`
- Create: `backend/tests/test_migration_one_admin_last_seen.py`, `docs/backlog/superuser-users-courses-debt.md`
- Test: `backend/tests/test_auth_last_seen.py` (new)

**Interfaces:**
- Produces: `CourseAdmin` with `UniqueConstraint("course_id", name="uq_course_admins_course_id")` and no separate `course_id` index; `User.last_seen_at: Mapped[datetime | None]` (`DateTime(timezone=True)`, nullable). Alembic head `d5b1e7a3c9f4`, `down_revision = 'c7e2a4f9d1b3'`.

- [ ] **Step 1: Write the failing tests**

`tests/test_migration_one_admin_last_seen.py` (same pattern as `test_migration_version_label_backfill.py`: write rows, `db.close()`, `command.downgrade(_cfg(), "c7e2a4f9d1b3")`, insert the pre-migration shape with raw SQL, `command.upgrade(_cfg(), "head")`):
- `test_keeps_lowest_id_admin_per_course`: a course with admin rows ids a<b<c (raw `INSERT` after downgrade, since the new constraint is gone), another course with one row → after upgrade only `a` and the single row remain.
- `test_backfills_last_seen_from_latest_session`: user U with sessions at `last_active_at` t1<t2, user V with none → `U.last_seen_at == t2`, `V.last_seen_at is None`.
- `test_second_admin_row_violates_unique`: after head, adding a second `CourseAdmin` for the same course raises `IntegrityError`.

`tests/test_auth_last_seen.py`:
- `test_verify_pin_sets_last_seen`: `request_pin` + `verify_pin` → `user.last_seen_at` within 5 s of now.
- `test_throttled_bump_updates_last_seen`: set the session's `last_active_at` and the user's `last_seen_at` to now − 10 min, call `validate_session` → both are now within 5 s of now.
- `test_no_bump_inside_throttle`: last_active 1 min ago → `last_seen_at` unchanged.

- [ ] **Step 2: Run them; they fail** (`.venv/bin/pytest -q tests/test_migration_one_admin_last_seen.py tests/test_auth_last_seen.py`: no column `last_seen_at`; duplicate admin insert succeeds).

- [ ] **Step 3: Write the migration `d5b1e7a3c9f4`**

`upgrade()`:
1. Select and print one line per admin row to drop: `SELECT id, course_id, user_id FROM course_admins ca WHERE ca.id > (SELECT min(id) FROM course_admins WHERE course_id = ca.course_id) ORDER BY id`; print `f"one-admin-per-course: removed course_admins id={id} (course {course_id}, user {user_id})"`. Then delete exactly those ids.
2. `op.drop_constraint('uq_course_admin', 'course_admins', type_='unique')`; `op.drop_index('ix_course_admins_course_id', table_name='course_admins')`; `op.create_unique_constraint('uq_course_admins_course_id', 'course_admins', ['course_id'])`.
3. `op.add_column('users', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))`; backfill `UPDATE users u SET last_seen_at = s.m FROM (SELECT user_id, max(last_active_at) AS m FROM sessions GROUP BY user_id) s WHERE s.user_id = u.id`.

`downgrade()`: drop the column, drop `uq_course_admins_course_id`, recreate `ix_course_admins_course_id` (non-unique) and `uq_course_admin (course_id, user_id)`. Removed admin rows are not restored (say so in the docstring).

Docstring: why (D6, D22), and that it never fails on existing data (`update.go:456-462` rolls back on failure).

- [ ] **Step 4: Change the models.** `CourseAdmin.__table_args__ = (UniqueConstraint("course_id", name="uq_course_admins_course_id"),)`, `course_id` loses `index=True`. `User.last_seen_at`. `test_pg_schema_gates.py::test_no_schema_drift` is the check that model and migration agree.

- [ ] **Step 5: Set `last_seen_at` in `auth.py`.** In `verify_pin`, set `user.last_seen_at = datetime.now(timezone.utc)` before the commit that creates the session. In `validate_session`'s throttled branch, set `user.last_seen_at = now` together with `session.last_active_at = now` (one commit).

- [ ] **Step 6: Rewrite `tests/test_teaching.py:915-916`.** Drop `db.add(CourseAdmin(user_id=other.id, course_id=course["id"]))`; the two `RunTeacher` rows keep the 2×2 join check (D6). Keep the comment that names the regression.

- [ ] **Step 7: Create `docs/backlog/superuser-users-courses-debt.md`** with one item per spec §7 bullet (files left on disk, stale emails with email off, roster email checks), backlog-skill format (`worth: later`, `where`, `added: 2026-11-03`), each body naming the unknown that would settle it. Leave a `## Task minors` heading for review minors.

- [ ] **Step 8: Run the backend suite.** All green; record the count in the ledger.

- [ ] **Step 9: Review loop and commit** per Global Constraints. Message: `feat(superuser): one admin per course in the database, users.last_seen_at (D6, D22)`.

---

### Task 2: panel write guard, the course-admin email

**Files:**
- Modify: `backend/mathion/api/superuser.py` (add `require_superuser_panel_write`)
- Modify: `backend/mathion/notifications/templates.py:11-21` (`RenderContext`), the `TEMPLATES` dict, `backend/mathion/notifications/dispatcher.py:55-91` (`_build_render_context`) and `tick()` (`:136-150`)
- Test: `backend/tests/test_superuser_api.py`, `backend/tests/test_notifications_dispatcher.py`, `backend/tests/test_notifications_templates.py`

**Interfaces:**
- Produces:
  - `require_superuser_panel_write(request: Request, user: User = Depends(require_superuser_panel)) -> User` in `api/superuser.py`; calls `_require_csrf(request)` (imported from `mathion.api.auth`) after the guard.
  - `RenderContext.run: Optional[Run] = None`, `RenderContext.course: Optional[Course] = None`; `course_slug` uses `run.version.course.slug` when `run` is set, else `course.slug`. Field order: `user, base_url, run=None, course=None, mp=None, sub=None` — update every `RenderContext(...)` call to keywords.
  - Kind `COURSE_ADMIN_ASSIGNED = "course_admin_assigned"` (module constant in `templates.py`), payload `{"course_id": int}`.
  - `skip_reason(db, row: NotificationLogEntry) -> str | None` in `dispatcher.py`: for `course_admin_assigned` only; returns `"course gone"`, `"recipient disabled"` or `"no longer admin"`, else `None`.

- [ ] **Step 1: Write the failing tests**

`test_superuser_api.py`:
- `test_write_guard_order`: mount a tiny router in the test (`APIRouter` with `POST /api/superuser/{token}/_probe` depending on `require_superuser_panel_write`) on a fresh `FastAPI()` with the same `get_db` override, and call it with a plain `TestClient` so the CSRF header is only sent when the test adds it. Assert: bad token + no CSRF header → 404; good token, no session → 401; good token + non-superuser → 404; good token + superuser + no header → 403 `"Missing CSRF header"`; with header → 200.

`test_notifications_templates.py`:
- `test_course_admin_assigned_renders`: `RenderContext(user=U(full_name=None, email="a@x"), base_url="https://m.x", course=Course(name="Statistics 101", slug="stat"))` → subject `"You are now the admin of Statistics 101"`; body contains `"Hi a@x,"` and `"https://m.x/courses/stat/edit"`.

`test_notifications_dispatcher.py` (with `MemoryMailer`):
- `test_course_admin_assigned_is_sent`: admin row + log row → `tick` sends one message to the admin; `sent_at` set.
- `test_skip_when_no_longer_admin` / `test_skip_when_recipient_disabled` / `test_skip_when_course_gone` (payload `course_id` of a deleted course): nothing sent; `error == "skipped: no longer admin"` (etc.), `sent_at is None`, `retry_count == 0`; a second `tick` does not pick the row again.
- `test_skip_does_not_touch_retry_or_log_warning` (Review Focus 3): with `caplog` at WARNING on `mathion.notifications`, a skipped row logs no record containing `"flagged permanently"`.
- `test_course_slug_read_at_send_time`: queue, rename the slug, `tick` → the body has the new slug.
- Existing `_build_render_context` tests still pass (run kinds unchanged).

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**
  - `_build_render_context`: when `row.kind == COURSE_ADMIN_ASSIGNED`, load the `Course` by `payload["course_id"]` and return `RenderContext(user=…, base_url=settings.base_url, course=course)`; other kinds keep today's path (they still require `run_id`).
  - `tick()`: before `_build_render_context`, `reason = skip_reason(db, row)`; when set, `row.error = f"skipped: {reason}"`, commit (rollback on `SQLAlchemyError`, as the success branch does), log one `logger.info("notification id=%s skipped: %s", …)`, `continue`. No exception, no retry count.
  - Template `_course_admin_assigned(ctx)`: subject `f"You are now the admin of {ctx.course.name}"`; body: `f"Hi {_name(ctx.user)},\n\nYou are now the admin of \"{ctx.course.name}\" on Mathion. You can work on it in the course editor.\n\nOpen it: {ctx.base_url}/courses/{ctx.course_slug}/edit\n\n— Mathion\n"`.

- [ ] **Step 4: Run the touched files, then the backend suite.** Green.

- [ ] **Step 5: Review loop and commit.** `feat(superuser): panel write guard; course-admin email with send-time skips (D5, §4)`.

---

### Task 3: Courses API

**Files:**
- Create: `backend/mathion/api/superuser_courses.py`
- Modify: `backend/mathion/main.py` (include the router next to `superuser_router`, `:148`), `backend/mathion/schemas.py` (new models below), `backend/mathion/api/courses.py:143-…` (remove `delete_course`)
- Modify tests: `backend/tests/test_courses.py:79-85`, `backend/tests/test_access_control.py:110-114`, `:148-152` (D12b: re-point to the panel or assert 405)
- Test: `backend/tests/test_superuser_courses.py` (new)

**Interfaces:**
- Consumes: `require_superuser_panel`, `require_superuser_panel_write` (Task 2); `get_or_create_user` (`api/lookups.py:22`); `COURSE_ADMIN_ASSIGNED` (Task 2).
- Produces (`schemas.py`):
  - `def _normalize_panel_email(v: str) -> str`: `_normalize_email(v)`, then `ValueError("Enter an email address")` if empty or not matching `^[^@\s]+@[^@\s]+$`. Used by every panel email field (D4).
  - `PanelAdmin {id: int, email: str, full_name: str | None, is_disabled: bool}`
  - `PanelCourse {id, name, slug, admin: PanelAdmin | None, version_count: int, run_count: int, student_count: int}` (`student_count` = distinct `run_students.user_id` over the course's runs, D11)
  - `AdminEmail = Literal["queued", "email_off", "disabled", "unchanged"]`
  - `AdminAssignResult {course: PanelCourse, admin: PanelAdmin, admin_email: AdminEmail, pin_minutes: int, sign_in_url: str}` (`pin_minutes` = `settings.pin_expiry_minutes`; `sign_in_url` = `f"{settings.base_url}/courses/{slug}/edit"`; both for the D5a note)
  - `PanelCourseCreate {name: str (1-200, stripped), slug: str (CourseCreate.slug rules), admin_email: str}`
  - `PanelCourseUpdate {name: str | None (1-200, stripped), slug: str | None (slug rules)}`; at least one field, else 422.
  - `PanelEmail {email: str}` (assign, lookup)
  - `AccountLookup {status: Literal["new", "existing", "disabled"], full_name: str | None}`
  - `CourseDeleteImpact {progress_students: int}`
- Produces (routes, all `response_model`ed; writes depend on `require_superuser_panel_write`):
  - `GET /api/superuser/{token}/courses` → `list[PanelCourse]`, ordered by `lower(name)`, `id`.
  - `POST /api/superuser/{token}/courses` → 201 `AdminAssignResult`.
  - `PATCH /api/superuser/{token}/courses/{course_id}` → `PanelCourse`.
  - `PUT /api/superuser/{token}/courses/{course_id}/admin` → `AdminAssignResult`.
  - `DELETE /api/superuser/{token}/courses/{course_id}/admin` → 204.
  - `GET /api/superuser/{token}/courses/{course_id}/delete-impact` → `CourseDeleteImpact`.
  - `DELETE /api/superuser/{token}/courses/{course_id}` → 204.
  - `POST /api/superuser/{token}/accounts/lookup` (body `PanelEmail`, write guard for CSRF; POST keeps addresses out of access logs) → `AccountLookup`. Reads only.
  - Helper `email_is_set_up() -> bool`: `settings.email_mode != "disabled"` (D5a; the `memory` sink counts on purpose — say so in a comment).
  - Helper `_admin_email_outcome(target: User, changed: bool) -> AdminEmail`: order unchanged → disabled → email_off → queued (D5a). Only `"queued"` adds a `NotificationLogEntry(user_id=target.id, kind=COURSE_ADMIN_ASSIGNED, payload={"course_id": course.id})`.
  - Gone course → 409 `"This course was deleted"` (D25).

- [ ] **Step 1: Write the failing tests** (`test_superuser_courses.py`; a `panel` fixture mints a token and returns `(admin_client, token)`; `monkeypatch.setattr(settings, "email_mode", …)` per test):
- **List:** `test_list_shape_and_counts` (two courses, one with an admin, a version, a run with 2 students → exact `PanelCourse` dicts); `test_list_requires_panel` (no token → 404, non-superuser → 404).
- **Create:** `test_create_with_new_admin_creates_account_and_queues` (email_mode `"memory"`: 201, `admin_email == "queued"`, a `User` with that email, one `CourseAdmin`, one log row with payload `{"course_id": id}`); `test_create_normalises_email` (`"  Anna@X.DK "` → `anna@x.dk`); `test_create_rejects_bad_email` (`"anna"`, `"  "` → 422); `test_create_taken_slug_409` (detail `"This address is already used by another course"`, no user created); `test_create_existing_disabled_admin_reports_disabled` (no log row).
- **Email outcome (Review Focus 2):** `test_assign_with_email_disabled_in_debug_reports_email_off` (`settings.debug=True`, `email_mode="disabled"` → `"email_off"`, no log row); `test_result_carries_pin_minutes_and_sign_in_url` (`pin_minutes == settings.pin_expiry_minutes`, `sign_in_url == f"{settings.base_url}/courses/<slug>/edit"`).
- **Assign/remove:** `test_assign_replaces_in_place` (same `CourseAdmin.id`, new `user_id`; old account kept); `test_assign_same_admin_is_unchanged` (no log row); `test_assign_to_course_without_admin_creates_row`; `test_remove_admin` (204, no row); `test_remove_when_none_409` (`"This course has no admin"`); `test_assign_gone_course_409`.
- **Update:** `test_rename`; `test_change_slug`; `test_change_slug_taken_409`; `test_update_empty_body_422`.
- **Delete:** `test_delete_refuses_with_runs_409` (detail `"This course has runs and can't be deleted"`); `test_delete_removes_course_versions_and_files` (create `asset_tmpdir/courses/<vid>/x.txt` → gone after 204; versions, admin row, enrollments, item states gone); `test_delete_impact_counts_progress_excluding_admin_and_superusers` (3 students + admin + a superuser with `user_item_states` → 3); `test_delete_gone_409`.
- **Lookup:** `test_lookup_new_existing_disabled`.
- **CSRF:** `test_writes_need_csrf` — each write route without the header → 403 (use `client.request(..., headers={})` on a plain `TestClient`, not `CSRFTestClient`).
- **D12b:** `test_old_course_delete_is_gone` — `DELETE /api/courses/{id}` → 405.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement `api/superuser_courses.py`.** Order and locks are fixed by the spec:
  - **create (D8):** check the slug first (409); `db.add(Course(...)); db.flush()` inside `with db.begin_nested()`, mapping `IntegrityError` on the slug to the same 409; then `get_or_create_user`, the `CourseAdmin`, the outcome/log row, one `commit`.
  - **assign (D6):** `select(Course).where(id).with_for_update()` **before** `get_or_create_user`; update `CourseAdmin.user_id` in place when a row exists, else add one.
  - **remove:** lock the course row, delete the admin row.
  - **delete (D12c):** the seven steps in order; Core `db.execute(delete(Course).where(Course.id == …))`; `shutil.rmtree(asset_root / "courses" / str(vid), ignore_errors=True)` per version after commit, with the asset root resolved as `api/assets.py:27` does; `IntegrityError` → 409.
  - **delete-impact (D12a):** distinct `UserItemState.user_id` joined `Item → Sequence → Block → CourseVersion` on the course, excluding the current admin's id and every `is_superuser` account.
  - **update:** slug pre-check plus `IntegrityError` → 409 inside a SAVEPOINT.
  - `_course_row(db, course) -> PanelCourse` builds one row; the list builds all rows with grouped count queries (no per-row N+1).

- [ ] **Step 4: Remove `delete_course` from `api/courses.py`; fix the three D12b tests** (delete the delete-specific asserts, or point them at `test_superuser_courses.py`; the access-control rows assert 405).

- [ ] **Step 5: Run the file, then the backend suite.** Green.

- [ ] **Step 6: Review loop and commit.** `feat(superuser): Courses API — create with admin, rename, address, admin, delete (D4-D13)`.

---

### Task 4: Users API

**Files:**
- Create: `backend/mathion/api/superuser_users.py`
- Modify: `backend/mathion/main.py`, `backend/mathion/schemas.py`
- Test: `backend/tests/test_superuser_users.py` (new)

**Interfaces:**
- Consumes: Task 2 guards; `_normalize_panel_email`, `PanelEmail` (Task 3).
- Produces (`schemas.py`):
  - `PanelUserRole = Literal["all", "admins", "teachers", "students", "disabled"]`
  - `PanelCourseRef {id: int, name: str}`
  - `PanelUser {id, email, full_name: str | None, is_superuser: bool, is_disabled: bool, created_at: datetime, last_seen_at: datetime | None, admin_of: list[PanelCourseRef], teacher_runs: int, student_runs: int, has_data: bool}`
  - `PanelUserCounts {all: int, admins: int, teachers: int, students: int, disabled: int}`
  - `PanelUserList {users: list[PanelUser], total: int, counts: PanelUserCounts}` — `total` counts pill + search; `users` is at most 20.
  - `PanelUserCreate {email: str, full_name: str | None}` (name stripped; empty → `None`)
  - `PanelUserUpdate {full_name: str | None = <unset>, email: str | None = <unset>}`; use `model_fields_set` to tell "clear the name" from "not sent".
- Produces (routes):
  - `GET /api/superuser/{token}/users?q=&role=` → `PanelUserList`, newest `created_at` first, then `id` desc.
  - `POST /api/superuser/{token}/users` → 201 `PanelUser`; 409 `"An account with this email already exists"`.
  - `PATCH /api/superuser/{token}/users/{user_id}` → `PanelUser`.
  - `POST /api/superuser/{token}/users/{user_id}/disable` and `/enable` → `PanelUser`.
  - `DELETE /api/superuser/{token}/users/{user_id}` → 204.
  - Gone account → 409 `"This account was deleted"`. Superuser target for disable/email/delete → 403 `"A superuser account can't be changed here"`.
  - `_has_data(db, user_id) -> bool` — the exact D20 list.

- [ ] **Step 1: Write the failing tests** (`test_superuser_users.py`):
- **List:** `test_newest_twenty_and_total` (25 users → 20, newest first, `total` 25 + the superuser); `test_search_email_or_name_case_insensitive`; `test_search_escapes_like` (`"a_b"` matches only the literal); `test_role_filters_and_totals` (admin/teacher/student/disabled fixtures → each pill's list and `counts`; a disabled teacher counts in both); `test_counts_ignore_search`; `test_row_shape` (`admin_of` lists every course, `teacher_runs`, `student_runs`, `has_data`, `last_seen_at`).
- **Create:** `test_create_account_sends_no_email` (no log row); `test_create_duplicate_409`; `test_create_bad_email_422`.
- **Edit:** `test_edit_name_and_clear_name`; `test_change_email_ends_sessions_and_pins` (the user's `Session` and unused `LoginPIN` rows gone); `test_change_email_taken_409`; `test_edit_gone_409`.
- **Disable/enable:** `test_disable_ends_sessions_keeps_admin_row` (sessions gone, `CourseAdmin` kept, a later `validate_session` with the old token returns `None`); `test_enable`.
- **Delete:** `test_delete_unused_account` (its sessions, PINs and log rows go); `test_delete_refused_for_each_kind_of_data` — parametrized over the nine blocking references in D20 → 409 `"This account has data and can only be disabled"`.
- **D21 (Review Focus 1):** `test_superuser_rows_refuse_disable_delete_email` (403 for each, including the acting superuser's own id); `test_superuser_name_can_be_edited`.
- **CSRF:** every write without the header → 403.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement `api/superuser_users.py`.**
  - Search: `or_(User.email.ilike(p, escape="\\"), User.full_name.ilike(p, escape="\\"))` with `p = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"`; `q` stripped, empty = no search.
  - Role filters with `exists()` subqueries; `counts` from five scalar queries; rows built for the ≤20 users with grouped queries.
  - **disable (D18):** set the flag and `db.execute(delete(Session).where(Session.user_id == id))` in one commit (never `invalidate_all_sessions`, which commits on its own).
  - **email change (D19):** pre-check, then the update and the deletes of `Session` and unused `LoginPIN` rows inside `begin_nested()`; `IntegrityError` → 409 `"Another account already uses this email"`.
  - **delete (D20):** `select(User).where(id).with_for_update()` first, then `_has_data`, then `db.delete(user)`, commit.

- [ ] **Step 4: Run the file, then the backend suite.** Green.

- [ ] **Step 5: Review loop and commit.** `feat(superuser): Users API — list and search, create, edit, disable, delete (D14-D21)`.

---

### Task 5: the panel shell, routes, and shared pieces

**Files:**
- Modify: `frontend/src/routes.ts:19`, `frontend/src/pages/superuser/SuperuserShell.svelte`, `frontend/src/pages/superuser/SuperuserDashboard.svelte`, `frontend/src/lib/superuser.ts`
- Create: `frontend/src/lib/slugify.ts`, `frontend/src/lib/relativeTime.ts`, `frontend/src/components/superuser/FieldDialog.svelte`, `frontend/src/components/superuser/NoteStrip.svelte`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (superuser section, `EXPECTED_CHECKS`), `frontend/src/components/chrome/AppHeader.svelte` (the cross-reference comment names the pills too)
- Test: `frontend/src/tests/SuperuserShell.svelte.test.ts`, `SuperuserDashboard.svelte.test.ts`, new `slugify.test.ts`, `relativeTime.test.ts`, `FieldDialog.svelte.test.ts`, `NoteStrip.svelte.test.ts`

**Interfaces:**
- Consumes: the Task 3/4 routes and JSON shapes.
- Produces:
  - `routes.ts`: `/superuser/:token/users` and `/superuser/:token/courses` → `SuperuserShell` (auth false), next to `/superuser/:token`.
  - `type PanelPage = 'dashboard' | 'users' | 'courses'`; `SuperuserShell` derives it from `currentRoute.path` (`/users`, `/courses` suffix).
  - `lib/superuser.ts`: the TS types mirroring Task 3/4 schemas (`PanelCourse`, `PanelAdmin`, `AdminEmail`, `AdminAssignResult`, `AccountLookup`, `PanelUser`, `PanelUserList`, `PanelUserRole`, `PanelUserCounts`), and one function per route: `listCourses(token)`, `createCourse(token, body)`, `updateCourse(token, id, body)`, `assignAdmin(token, id, email)`, `removeAdmin(token, id)`, `getDeleteImpact(token, id)`, `deleteCourse(token, id)`, `lookupAccount(token, email)`, `listUsers(token, q, role)`, `createUser(token, body)`, `updateUser(token, id, body)`, `disableUser(token, id)`, `enableUser(token, id)`, `deleteUser(token, id)`. All pass `skipAuthRedirect: true`.
  - `panelError(err: unknown, onAuth: (kind: 'signin' | 'expired') => void): string | null` in `lib/superuser.ts`: 401 → `onAuth('signin')`, 404 → `onAuth('expired')`, both return `null`; anything else returns `ApiError.displayMessage` or `OFFLINE_MESSAGE` (fetch `TypeError`).
  - `type PanelOnAuth = (kind: 'signin' | 'expired') => void`. Every panel page (`SuperuserDashboard`, `SuperuserUsers`, `SuperuserCourses`) takes props `{ token: string; onAuth: PanelOnAuth }`; `SuperuserShell` passes them; `onAuth('signin')` stores `superuser_return_path` and navigates to `/login` (today's dashboard code moves here); `onAuth('expired')` shows the expired-link text (today's `.panel-error` text) instead of the page.
  - `slugFromName(name: string): string` (D13).
  - `lastActiveText(iso: string | null, now: Date): string`: `null` → `"never"`; < 1 min `"just now"`; minutes `"N minute(s) ago"`; < 24 h `"N hour(s) ago"`; < 48 h `"yesterday"`; < 30 d `"N days ago"`; < 365 d `"N month(s) ago"` (days / 30, floored); else `"N year(s) ago"`. Singular for 1.
  - `FieldDialog.svelte` props: `{ title: string; label: string; value: string; type?: 'text' | 'email'; hint?: Snippet; warning?: string; saveLabel?: string; onSave: (value: string) => Promise<void>; onClose: () => void }`. Built on `Modal` with `width={440}`; the input has `data-autofocus`; Save is `loading` while `onSave` runs and blocked (`aria-disabled`) while the trimmed value is empty or unchanged; when `onSave` throws, the message from `panelError` shows in the dialog (`role="alert"`) and the input keeps its value (D25).
  - `NoteStrip.svelte` props: `{ tone: 'info' | 'error'; onClose: () => void; children: Snippet }`; `info` → `role="status"`, gold-soft look; `error` → `role="alert"`, the danger look; a × `IconButton` (`glyph="close"`) closes it.

- [ ] **Step 1: Write the failing tests**
- `slugify.test.ts`: `"Kemometri på dansk"` → `"kemometri-paa-dansk"`; `"Æble Østers Ål"` → `"aeble-oesters-aal"`; `"Café Über"` → `"cafe-uber"`; `"  --Hello,  World!--  "` → `"hello-world"`; `"!!!"` → `""`; `"Ωμέγα"` → `""`; a 120-letter name with a hyphen at position 80 → length ≤ 80, no end hyphen (Review Focus 5).
- `relativeTime.test.ts`: each band above, singular and plural, `null`.
- `FieldDialog.svelte.test.ts`: autofocus on the input; Save blocked when unchanged; a rejected `onSave` with `ApiError(409, "This address is already used by another course")` shows that text in `[role="alert"]` and keeps the typed value; Esc calls `onClose`.
- `NoteStrip.svelte.test.ts` (Review Focus 4): `info` has `role="status"`, `error` has `role="alert"`; × calls `onClose`.
- `SuperuserShell.svelte.test.ts`: three pills `Dashboard`, `Users`, `Courses` as links (`href="/superuser/T"`, `/superuser/T/users`, `/superuser/T/courses`), the current one with `aria-current="page"`; a plain click navigates in the same tab (no `target`); the h1 follows the page; a 404 from a page's load shows the expired text and no page; a 401 sets `superuser_return_path` and navigates to `/login`. Keep the existing tests (bar contents, Sign out, no links out of the panel — now "no links outside `/superuser/T`").
- `SuperuserDashboard.svelte.test.ts`: the dashboard calls `onAuth` instead of handling 401/404 itself.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**
  - The pills copy AppHeader's `.links a` / `[aria-current="page"]` look (D23); they replace `.su-label`. `routeClick` for same-tab navigation.
  - The shell renders `SuperuserDashboard`, `SuperuserUsers` or `SuperuserCourses` (the last two land in Tasks 6/7; until then render a placeholder `<p>` so the routes exist).
  - `slugFromName`: replace `æ/Æ→ae`, `ø/Ø→oe`, `å/Å→aa`, then `normalize('NFKD')` and drop `\p{M}`, lower-case, `[^a-z0-9]+` → `-`, trim `-`, `slice(0, 80)`, trim `-` again.

- [ ] **Step 4: Gate rows.** Replace the `.su-label` row with rows for the pill (`a` inactive: `color:var(--muted)`, `padding:4px 10px`, `border-radius:4px`; active: `color:var(--gold-text)`, `background:var(--gold-soft)`, `font-weight:500`), `FieldDialog` (its input row), and `NoteStrip` (`info`/`error` backgrounds from tokens). Write them first and watch them fail against the old build; bump `EXPECTED_CHECKS`.

- [ ] **Step 5: vitest, svelte-check, gate.** Green.

- [ ] **Step 6: Shots** (1280): Dashboard with the pills; the Users and Courses placeholders' bar. Needs a signed-in superuser and a panel token in dev — ask the user first.

- [ ] **Step 7: Review loop and commit.** `feat(superuser): panel pills and routes; shared field dialog and note strip (D23-D25)`.

---

### Task 6: the Courses page

**Files:**
- Create: `frontend/src/pages/superuser/SuperuserCourses.svelte`, `frontend/src/components/superuser/NewCourseDialog.svelte`, `frontend/src/components/superuser/AdminEmailField.svelte`, `frontend/src/components/superuser/DeleteCourseDialog.svelte`
- Modify: `SuperuserShell.svelte` (render the page), the gate
- Test: `frontend/src/tests/SuperuserCourses.svelte.test.ts`, `NewCourseDialog.svelte.test.ts`, `DeleteCourseDialog.svelte.test.ts`

**Interfaces:**
- Consumes: Task 5 (`lib/superuser.ts`, `FieldDialog`, `NoteStrip`, `slugFromName`, `panelError`).
- Produces:
  - `AdminEmailField.svelte` props `{ token: string; value: string; onAuth: PanelOnAuth; oninput: (v: string) => void }`: the email input plus its hint, from `lookupAccount` after a 250 ms pause, newest reply wins: `new` → "No account yet: one will be created."; `existing` → nothing; `disabled` → "This account is disabled: they can't sign in until you enable it" (§5).
  - `adminNote(result: AdminAssignResult, kind: 'create' | 'assign'): string` in `lib/superuser.ts`, exact D5a text, built from `result.course`, `result.admin`, `result.pin_minutes` and `result.sign_in_url`. The person is named `admin.full_name ?? admin.email` (Review Focus 4).

- [ ] **Step 1: Write the failing tests**
- **Table:** rows show name (plain text, no `<a>`), address, admin (`full_name` + email, `"No admin"`, or `"disabled"` mark), versions, runs; sorted as the API sends.
- **New course:** the address follows the name until the address field is edited, then stays; Create is blocked until name, address and email are filled; a 201 closes the dialog, reloads the list, and shows the D5a note per outcome — four tests, one per `admin_email`, with the exact strings, including the `mathion pin <email>` and the `sign_in_url` in `email_off`; `result sentence falls back to email` (admin `full_name: null`).
- **Rename / Change address:** pencils open `FieldDialog`; the address dialog's warning reads `"Links people saved or shared with the old address will stop working: 2 runs, 37 students."` (from `run_count`, `student_count`; singular forms for 1); a 409 keeps the dialog open with the server text and reloads the list behind it.
- **Change / Assign admin:** the button says "Change admin" with an admin and "Assign admin" without; it opens a dialog with `AdminEmailField`; the result note as above; "unchanged" shows only "They are already the admin; nothing changed."
- **Remove admin:** × opens an `InlineConfirm` strip under the row, `"<course> will have no admin"`; confirm → 204 → list reloads; a 409 closes the strip and shows the server text in an `error` `NoteStrip`.
- **Delete:** with runs, the trash has `aria-disabled="true"` and `title="2 runs: can't be deleted"` and opens nothing; without runs it opens `DeleteCourseDialog`, which fetches `getDeleteImpact` and says `"Also deletes the progress of 14 students (pages visited, quiz answers)."` only when the count > 0; Delete stays blocked until the trimmed typed name equals the course name exactly (case matters); success closes it and reloads.
- **Auth:** a 404 on any call calls `onAuth('expired')`.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.** The table copies `TeacherRunListPage.svelte:153-170` (`.table-scroll` wrapper, header row, cell padding, `.num` columns). "New course" is a primary `Button` beside the h1. One note at a time, under the h1; the next action replaces it.

- [ ] **Step 4: Gate rows** for the table wrapper and cells, the disabled-admin mark, the dialogs' hint line; written first, red, then green; bump `EXPECTED_CHECKS`.

- [ ] **Step 5: vitest, svelte-check, gate.** Green.

- [ ] **Step 6: Shots** (1280): the list; New course with a hint; the email-off note; Change address with its warning; the remove-admin strip; the delete dialog. Writes in dev (a test course, an admin) need the user's yes; otherwise mock with `agent-browser network route`.

- [ ] **Step 7: Review loop and commit.** `feat(superuser): the Courses page (D7-D13)`.

---

### Task 7: the Users page

**Files:**
- Create: `frontend/src/pages/superuser/SuperuserUsers.svelte`, `frontend/src/components/superuser/NewAccountDialog.svelte`
- Modify: `SuperuserShell.svelte`, the gate
- Test: `frontend/src/tests/SuperuserUsers.svelte.test.ts`, `NewAccountDialog.svelte.test.ts`

**Interfaces:**
- Consumes: Task 5 pieces, `lastActiveText`.
- Produces: `countLine(list: PanelUserList, role: PanelUserRole, searching: boolean): string` in `lib/superuser.ts` (the D15 text; nouns `account(s)`, `admin(s)`, `teacher(s)`, `student(s)`, `disabled account(s)`); `roleChips(u: PanelUser): string[]` (D14 order: Superuser, Admin chips — one per course, or `"Admin · N courses"` above two — Teacher, Student, Disabled; `["—"]` when empty).

- [ ] **Step 1: Write the failing tests**
- `countLine`: all six D15 cases, each with a pill noun and singular/plural (`"1 account"`, `"Showing the 20 newest of 33 students. Search to find others."`, `"No students match"`, `"No disabled accounts"`, `"20 of 57 match. Keep typing to narrow."`, `"5 match"`).
- `roleChips`: superuser; admin of 1, 2, 3 courses; teacher 1 run / 2 runs; student; disabled; none → `["—"]`.
- **Page:** pills show `counts` (totals, unchanged by search); typing fires one `listUsers` after 250 ms; a slower older reply arriving after a newer one is ignored; rows show name, email, chips, `lastActiveText`.
- **Row actions:** a superuser row has only the name pencil (no Disable, trash or email pencil); a row with `has_data` has no trash; Disable opens a strip with the D18 text: `"Disable <name>?"`, then a sentence from the parts that apply — `"is the admin of <course>"` (`"of <n> courses"` above two, `"of A and B"` for two) and `"teaches <n> run(s)"`, joined with "and" — then `"They'll be signed out and can't sign in until enabled; tell them yourself."` Tests: the spec's exact example, admin-only, teacher-only, and no role (no middle sentence). `<name>` is `full_name ?? email`; Enable confirms in a strip too; delete strip → 204 → reload; a 409 in a strip closes it and shows an `error` `NoteStrip`.
- **Edits:** name pencil → `FieldDialog` (empty clears the name); email pencil → `FieldDialog` with `"They will need to sign in again with the new address."`; a 409 keeps the dialog open.
- **New account:** email + optional name; 409 text shown in the dialog; success reloads and closes.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.** Search input above the pills (`FilterPills` with `count`), the table in the Courses page's look, the count line under it.

- [ ] **Step 4: Gate rows** for the role chips and the count line; red, then green; bump `EXPECTED_CHECKS`.

- [ ] **Step 5: vitest, svelte-check, gate.** Green. Then the backend suite once more (nothing should have moved).

- [ ] **Step 6: Shots** (1280): the list (All and one pill), a search with few matches, the disable strip, the email dialog. Same write rule as Task 6.

- [ ] **Step 7: Review loop and commit.** `feat(superuser): the Users page (D14-D21)`.

---

## After Task 7

- Whole-branch review `554f36c..HEAD`: one fresh Opus + Fable, fixes re-reviewed.
- Browser pass in Safari, one step at a time in the terminal (no VoiceOver steps).
- Dev cleanup with the user's yes (the ledger lists the rows), then the finishing-a-development-branch menu.
