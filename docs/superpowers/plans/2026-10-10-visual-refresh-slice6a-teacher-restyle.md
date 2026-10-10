# Slice 6a: the teacher screens, restyled (runs lists, run frame, six tabs) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bring the runs lists, the run page frame and six of its tabs (Progress, Submissions, Groups, Teachers, Mini-projects, Assets) to the design. Runs move under `/teaching` for everyone, the open tab lives in the address, and the Teaching list shows the runs a user teaches or administers.

**Architecture:**
- **Navigation.** Run pages move to `/teaching/:courseSlug(/runs/:runId)`. The old `/courses/…/runs…` routes render a small `RunsRedirect` page that replaces the address once the user is signed in. The header shows "Teaching" to teachers and course admins.
- **Tab in the address.** `RunDetailPage` derives the open tab from `?tab=`. Every tab switch goes through one `setTab()`, which calls `navigate(…, { replace: true })`, so the registered unsaved-changes guards run.
- **Shared pieces.** New `ui/Avatar`, `ui/DangerConfirm`, `ui/InlineName`, `ui/SortMark` and `runs/RunStatusChip`, plus small additions to `IconButton`, `Button`, `StatusBadge`, `ErrorState`, `InlineConfirm` and four libraries. The tabs are restyled on top of them.
- **Backend.** `GET /api/teaching/runs` returns the runs a user teaches, the runs of courses they administer, or every run for a superuser.

**Tech Stack:**
- **Svelte:** Svelte 5.55, runes only, no JS/CSS dependencies.
- **Tests:** Vitest + jsdom, with `mount` / `unmount` / `flushSync` from `svelte`.
- **Backend:** FastAPI + SQLAlchemy 2 on PostgreSQL 17, tested with pytest through `backend/.venv`.
- **Gate:** the zsh gate `frontend/scripts/visual-refresh-gate.sh`.

**Spec:** `docs/superpowers/specs/2026-10-10-visual-refresh-slice6a-teacher-restyle-design.md` (rev 4, commit `e371368`, approved by the user on 2026-10-10). Its D1–D10 and R1–R14 are binding; this plan cites them by number.
**Design authority:** `docs/design/visual-refresh/` (screens 10e, 2d, 9a, 10c, 10d, 10j, 10i). Image copies: `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/ref/*.png`.

## Global Constraints

- **Branch:** `feat/visual-refresh-slice6-teacher` (HEAD `e371368` when this plan was written). LOCAL only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`. Scratch files go in `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/` (probes in `probe/`, gate temp files in `tmp/`), never `/tmp`. Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. No new npm or pip dependencies.
  - Component tests use `mount` / `unmount` / `flushSync` from `svelte`, NOT `@testing-library/svelte`.
  - Match the surrounding comment density. No comments that narrate the change ("restyled in 6a").
- **Colours and glyphs:**
  - No literal colours in component CSS or inline `style=`; theme tokens only (`src/styles/theme-default.css`). No `hsl(`, no hex fallbacks in `var(--x, #…)`.
  - No `opacity` to dim anything.
  - No emoji and no glyph characters from the gate's `emoji_scan` set in component or library code: no `▲ ▼ × → ↻ ✎ 🗑 ✓ ✗`. The scan strips comments and does not read test files, so glyphs in test names are fine; new comments still use words ("trash", "pencil"). Icons come from `IconButton` glyphs (`pencil trash plus close check refresh download …`) and `SortMark`.
  - Numerals (counts, dates, versions, sizes, emails) are mono: `font-family: var(--font-mono)`.
- **Gate collisions to keep:**
  - Keep the class names `.submission-grid` (RunSubmissionTab) and `.run-assets-tab` (RunAssetsTab): gate section (q) uses them as exclusion anchors.
  - Keep exactly one top-level `.empty-state` rule in RunSubmissionTab and in RunAssetsTab: gate section (q) pins the three authors of `.empty-state` (EmptyState, RunAssetsTab, RunSubmissionTab).
- **Commands:**
  - Frontend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run > /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp/vitest.log; grep -cE "Errors|Unhandled" /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. One file: `npx vitest run src/tests/<File>.test.ts` from the same directory, with the same `TZ`.
  - Typecheck: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --threshold error` must show 0 errors. 13 warnings is the baseline.
  - Gate: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp zsh scripts/visual-refresh-gate.sh > /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp/gate.log; tail -1 /Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/tmp/gate.log`. It must end `VISUAL-REFRESH GATE: ALL PASS (N checks)` with the N the task names. Never run it in two lanes at once.
  - Backend tests: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`. Never call a bare `pytest` or `python`.
- **Per task, in this order** (the user's per-task loop; it overrides "continuous execution"):
  1. TDD, step by step as written.
  2. vitest (green as defined above), svelte-check (0 errors), the gate (the task's N).
  3. If the screen changed: agent-browser screenshots of the real screens (dev data, run 8, plus network mocks) in an agterm overlay with `--size-percent 60`, images as base64, files in the 6a sdd dir. Then the user's OK on the look.
  4. Two review lanes, Opus (high) and Fable, on the UNCOMMITTED diff. Fix every Critical and Important finding, then re-run both lanes after EVERY fix until both are clean. Minors go to `docs/backlog/slice6a-teacher-restyle-debt.md` under the task's heading. Do not edit the tree while a lane reviews.
  5. Commit with exact paths (never `git add -A`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (no session line).
  6. Ledger line in `.superpowers/sdd/2026-10-10-visual-refresh-slice6-teacher/progress.md`, update memory, then WAIT for the user's "go" before the next task.
- **Dev servers for screenshots** (both already run in this session; never start a second copy):
  - Backend: uvicorn with `MATHION_DEBUG=1`; the PIN appears in `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/backend.log`.
  - Frontend: vite on `http://localhost:5174`.
  - Logins: `dev@mathion.test` (course admin, not superuser) and `teacher@mathion.test` (run teacher). Run 8 "Demo Run (Slice-3 surfaces)" in `demo-course`.
  - Never write to shared dev data without the user's yes; never spend real quiz attempts; never press Enter in a real field during screenshots; use network mocks for states the data lacks.
- **Texts, verbatim** (spec, or today's code where the spec says "today's"):
  - Discard prompt (DirtyGuard, unchanged): `Discard unsaved changes and continue?`
  - Runs list 🗑 reason: `Only a draft run can be deleted`; New-run reason: `Publish a course version before creating a run.`
  - Teaching list empty: `No runs yet. Runs you teach or administer appear here.`; per pill: `No {label} runs.` (lowercase label, e.g. `No finished runs.`).
  - Course-runs errors: `Course not found.`, `You don't have access to this course's runs.`
  - DangerConfirm unarmed title: `Tick “I understand” first` (curly quotes).
  - Mini-projects ✎ reasons: `Has submissions — editing is off` and `This run's course version is disabled.`; non-admin Force delete reason: `Only a course admin can force delete.`
  - Assets non-admin Force delete reason (today's): `Only course admins can force-delete a referenced asset.`
  - Groups 🗑 reason: `Move students out before deleting.`; 409 add: `A group with that name already exists in this run.`
  - Version-disabled banner (frame): admin `This run's course version is disabled. Re-enable it under Course Editor before publishing.`; teacher `This run's course version is disabled. Some editing actions are locked until a course admin re-enables it.`
  - Progress extra line (R7): `Coverage data reflects last-known state.`

## Rulings made while planning

Each states what it costs if wrong. P-numbers avoid a clash with the spec's R-numbers.

- **P1 — The tab keys and helpers live in `src/lib/runTabs.ts`** (`ActiveTab`, `RUN_TABS`, `parseTab`, `withTab`, `withoutTab`, `isTabKey`). `RunRosterTab` imports `ActiveTab` from there instead of from `RunDetailPage.svelte`. *Cost:* one import line.
- **P2 — `IconButton` and `Button` forward `data-action`, and `Button` gets a bindable `element`.** Today's tests find many controls by `data-action`, and focus returns to text buttons ("Delete N selected"). *Cost:* two optional props on shared components.
- **P3 — `InlineConfirm` gains an opt-in `takeFocus` prop:** with it, Cancel takes focus on mount and Esc inside the confirm cancels. Callers outside 6a (Overview, Roster, side panel, MiniProjectModal) do not pass it and are unchanged. *Cost:* one prop.
- **P4 — The focus fallback (spec §Focus) is one helper, `focusFirst(candidates)` in `src/lib/focusFirst.ts`:** it focuses the first candidate that is connected, not `disabled` and not `aria-disabled="true"`. Each caller lists its candidates in the spec's order. *Cost:* none; it is 8 lines.
- **P5 — Block and sequence numbers (R13) come from `blockPositions(blocks)` in `src/lib/blockNumbers.ts`:** block id → 1-based index in the list as given. `listBlocks` returns blocks ordered by `order, id` (`backend/mathion/api/blocks.py`), so "as given" is list position. *Cost:* none.
- **P6 — Sort arrows become `ui/SortMark.svelte`** (a 10px SVG chevron, `aria-hidden`). `▲`/`▼` are in the gate's `emoji_scan` set, which 6a runs over every touched file; the column's `aria-sort` already carries the state. *Cost:* one tiny component.
- **P7 — "Overview → Settings" becomes "Overview › Settings"** in the Groups-disabled text: `→` is in the `emoji_scan` set. `›` is the breadcrumb character the app already uses. *Cost:* one character.
- **P8 — `ErrorState` gains `retryLabel` (default `Retry`)** so the Teaching list keeps its "Try again" text (spec: "kept, restyled with `ErrorState`"). *Cost:* one prop.
- **P9 — `DangerConfirm` owns its "I understand" state.** The checkbox carries `data-role="danger-ack"`. After `onConfirm` settles (success or failure) the box un-ticks. Callers drop their own checkbox state (`forceCheckbox`, `checkboxChecked`); what they send does not change. *Cost:* the existing Assets/Mini-projects tests that tick `data-role="force-confirm"` / `"bulk-confirm"` move to `danger-ack` (listed in T10/T11).
- **P10 — The Assets "Edit" jump focuses the Mini-projects tab first and then opens the editor modal,** so the modal's `FocusTrap` returns focus to that tab when it closes. Every other in-panel jump just focuses the new tab. *Cost:* none.
- **P11 — The unknown-`?tab` rewrite passes `force: true`:** nothing is open on a tab that was never shown, so no guard should ask. *Cost:* none.
- **P12 — Mini-projects:** the plain delete confirm stays in the actions cell and the danger panel goes in a full-width row under its row, mirroring R14. *Cost:* a position change.
- **P13 — Gate rows land with the task that owns the code.** T2 opens section (aj) with `FILES_6A` and the two scans; each later task appends its files to `FILES_6A` (the scans print one line each, whatever the list size) and adds its own pins. Each task bumps `EXPECTED_CHECKS` by the exact count it states. If the gate prints a different count, the plan miscounted: recount the PASS lines the new block prints and ledger a ruling. *Cost:* none.
- **P14 — `InlineName`'s ✓ shows "busy" as disabled with the title `Saving…`** (as 5d R5): `IconButton` has no loading state. *Cost:* one tooltip.
- **P15 — Runs lists format dates "01 Sep 2026" with `formatShortDate(yyyyMmDd)` in `lib/datetime.ts`** (fixed English months, no time zone: the value is a calendar date). *Cost:* none.
- **P16 — The version rank code in `RunDetailPage` and `RunListPage` is deleted** (R3): both show `v. {run.version_id}`. *Cost:* none.
- **P17 — The backlog file `docs/backlog/slice6a-teacher-restyle-debt.md` is created in T1** and each task appends its minors under its own heading.
- **P18 — Overview is the address without `?tab`.** `withTab(search, 'overview')` drops the parameter, so the canonical run address stays short and a click on Overview gives the same address as a fresh visit. *Cost:* none; `?tab=overview` still parses to Overview.
- **P19 — Progress and Submissions have no `<h2>` header row.** 2d and 9a draw the toolbar straight under the tabs, and neither tab has a primary action; the panel is already named by its tab (`aria-labelledby`). The spec's "common to all six" header row applies to the four tabs with a + (Groups, Teachers, Mini-projects, Assets). *Cost if wrong:* one heading per tab, added later.
- **P20 — In Mini-projects and Assets the row's icons stay visible next to an open plain confirm**, as today (both tabs render the buttons and the confirm side by side). An existing Assets test opens Delete while Replace's confirm is open, and Cancel returns focus to a 🗑 that never left. *Cost:* a wider actions cell while a confirm is open.
- **P21 — Assets' header row holds the `<h2>` "Assets", its mono file count and `+ Upload`; the filter pills sit under it.** The spec asks for both the shared header row ("Common to all six") and a toolbar with the pills and Upload; one Upload button serves both. *Cost:* a position change.
- **P22 — `FilterPills`' gate pins anchor on `.fp`, not `.filter-pills`:** RunAssetsTab authors its own `.filter-pills` rules until T11 replaces them. *Cost:* none.
- **P23 — Mini-projects row buttons are named "Edit mini-project for Block {n}" / "Delete mini-project for Block {n}"** (the spec's example). The "used by" list in Assets shows the mini-project's own title when its block is missing from `blocks` (R13's fallback "the title alone"); a Mini-projects row whose block is missing stays hidden, as today. A non-admin's 409 on a plain delete still closes the confirm and shows today's banner, although R5 now lets them open the danger panel on a locked row. *Cost:* none.

## Review Focus

These are the five failure modes most likely to bite a teacher or admin. Each is pinned by a test in the owning task.

1. **A tab switch with a half-written grade.** Cancel on the prompt keeps the tab, the address, no Roster prefilter and no pending edit; OK switches. → T5 "a cancelled guard keeps the tab, the address, no prefilter and no pending edit" and "an accepted guard switches".
2. **An old bookmark while signed out.** Login comes first, and after login the old address lands on the new one; while signed out, the redirect never moves the login page. → T4 "goes through login with one ?next=, then lands on the new address" and "while session.user is null it calls no navigate, then redirects once the user is known".
3. **Focus never drops to `<body>` after a row action.** Deleting the last row lands on + (or the h2 when + is disabled); Cancel returns to the 🗑 that opened it. → T6 "deleting the only draft run moves focus to + New run", T9 "deleting the last group moves focus to the + toggle (Review Focus 3)", T10 "deleting the only mini-project moves focus to +", T11 "Cancel on the danger panel returns focus to the row's Delete (Review Focus 3)".
4. **The Teaching list for admins and superusers.** Each run appears once, and the student count is not multiplied when an admin also teaches the run. → T1 `test_course_admin_who_also_teaches_sees_the_run_once_with_its_student_count`.
5. **Deadlines across daylight saving.** A summer and a winter deadline give "Deadlines (local time)", each part keeps its own offset in its `title`, and month names are English whatever the browser locale. → T2 `datetime` tests; T10 "mixed offsets give "Deadlines (local time)"; each part keeps its own offset (Review Focus 5)".

## File map

**Backend**
- Modify `backend/mathion/api/teaching.py` (`list_teaching_runs`).
- Modify `backend/tests/test_teaching.py` (two inverted tests, three new ones).

**Frontend libraries**
- Create `src/lib/runTabs.ts` (tab keys and address helpers) + `src/tests/runTabs.test.ts`.
- Create `src/lib/blockNumbers.ts` (`blockPositions`) + `src/tests/blockNumbers.test.ts`.
- Create `src/lib/focusFirst.ts` + `src/tests/focusFirst.test.ts`.
- Modify `src/lib/datetime.ts` (`formatShortDeadline`, `formatShortDate`, `deadlinesHeader`) + `src/tests/datetime.test.ts`.
- Modify `src/lib/dashboards.ts` (`STATUS_SHORT_LABEL`, `heatToken`) + `src/tests/dashboards.test.ts`.
- Modify `src/lib/runStatus.ts` (`RUN_STATUS_LABEL`) + `src/tests/runStatus.test.ts`.

**Frontend shared UI**
- Modify `src/components/ui/IconButton.svelte` (glyphs `refresh`, `download`; `data-action`).
- Modify `src/components/ui/Button.svelte` (`data-action`, bindable `element`).
- Modify `src/components/ui/StatusBadge.svelte` (`label`).
- Modify `src/components/ui/ErrorState.svelte` (`retryLabel`).
- Modify `src/components/ui/InlineConfirm.svelte` (`takeFocus`).
- Create `src/components/ui/Avatar.svelte`, `ui/DangerConfirm.svelte`, `ui/InlineName.svelte`, `ui/SortMark.svelte`, `ui/FilterPills.svelte`, `runs/RunStatusChip.svelte`, `runs/TeachingCrumbs.svelte`, each with a test file.

**Frontend navigation**
- Modify `src/routes.ts`, `src/App.svelte`; create `src/pages/runs/RunsRedirect.svelte`.
- Modify `src/components/chrome/AppHeader.svelte` (pill condition).
- Modify the link lines in `src/components/course/CourseCard.svelte:9`, `src/components/runs/NewRunModal.svelte:57`, `src/pages/runs/RunDetailPage.svelte:276,330`, `src/pages/runs/RunListPage.svelte:116,122`, `src/pages/teaching/TeacherRunListPage.svelte:78`.

**Frontend pages and tabs**
- Modify `src/pages/runs/RunDetailPage.svelte` (frame, tab in the address), `src/pages/runs/RunListPage.svelte`, `src/pages/teaching/TeacherRunListPage.svelte`.
- Modify `src/components/runs/RunProgressTab.svelte`, `RunSubmissionTab.svelte`, `RunGroupsTab.svelte`, `RunTeachersTab.svelte`, `RunMiniProjectsTab.svelte`, `RunAssetsTab.svelte`.
- Modify `src/components/runs/RunRosterTab.svelte` (the `ActiveTab` import only).

**Frontend tests** (modified unless noted)
- `AppHeader`, `NewRunModal`, `TeacherRunListPage`, `RunListPage`, `RunDetailPage`, `RunDetailPage.publish`, `RunProgressTab`, `RunSubmissionTab`, `RunGroupsTab`, `RunTeachersTab`, `RunMiniProjectsTab`, `RunAssetsTab` (`.svelte.test.ts`).
- Create `RunsRedirect.svelte.test.ts`, `App.runsRedirect.svelte.test.ts`, `RunDetailPage.tabs.svelte.test.ts`, and one test file per new component (`Avatar`, `DangerConfirm`, `InlineName`, `SortMark`, `FilterPills`, `RunStatusChip`, `TeachingCrumbs`).

**Gate and docs**
- Modify `frontend/scripts/visual-refresh-gate.sh`: new section (aj) at the end, grown task by task.
- Create `docs/backlog/slice6a-teacher-restyle-debt.md`; add the R13 note to `docs/backlog/slice5c-constructor-polish-debt.md` (T11).

---

### Task 1: Backend — the Teaching list includes administered courses, and everything for superusers (D3, D9, R9)

**Files:**
- Modify: `backend/mathion/api/teaching.py` (imports; `list_teaching_runs` at :14-52)
- Modify: `backend/tests/test_teaching.py` (invert `test_superuser_sees_only_own_teacher_rows` at :719 and `test_excludes_runs_where_user_is_course_admin_but_not_teacher` at :736; add three tests at the end of `TestTeachingRunsEndpoint`)
- Create: `docs/backlog/slice6a-teacher-restyle-debt.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /api/teaching/runs` keeps the `TeachingRunRow` shape (`run`, `course_id`, `course_name`, `course_slug`, `student_count`) and the `Run.id ASC` order. It returns the runs where the user has a `RunTeacher` row OR is a `CourseAdmin` of the run's course; a superuser gets every run. T4 (header) and T6 (both runs lists) rely on it.

- [ ] **Step 1: Invert the two old tests and add the three new ones (they fail)**

In `backend/tests/test_teaching.py`, replace the whole `test_superuser_sees_only_own_teacher_rows` method (:719-734) with:

```python
    def test_superuser_sees_every_run(
        self, admin_client, seed_publishable_version,
    ):
        # D9 / R9 (2026-10-10): a superuser's Teaching list shows every run,
        # including runs they neither teach nor administer through a row.
        course_a, _ = seed_publishable_version(slug="sa", name="SA")
        course_b, _ = seed_publishable_version(slug="sb", name="SB")
        ra = admin_client.post(
            f"/api/courses/{course_a['id']}/runs",
            json={"title": "A", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        rb = admin_client.post(
            f"/api/courses/{course_b['id']}/runs",
            json={"title": "B", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        r = admin_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert [row["run"]["id"] for row in r.json()] == [ra["id"], rb["id"]]
```

Replace the whole `test_excludes_runs_where_user_is_course_admin_but_not_teacher` method (:736-752) with:

```python
    def test_includes_runs_of_courses_the_user_administers(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        # D3: a course admin's Teaching list holds the runs of the courses
        # they administer, without a RunTeacher row.
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course["id"]))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        body = r.json()
        assert [row["run"]["id"] for row in body] == [run["id"]]
        assert body[0]["course_slug"] == course["slug"]
```

Append these three methods at the end of `class TestTeachingRunsEndpoint` (after `test_returns_run_when_user_is_one_of_multiple_teachers`):

```python
    def test_course_admin_who_also_teaches_sees_the_run_once_with_its_student_count(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        # Both branches of the OR match this run: it must still come back once,
        # and the student count must not be multiplied by the join.
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course["id"]))
        db.commit()
        assert admin_client.post(f"/api/runs/{run['id']}/publish").status_code == 200
        for email in ("s1@x", "s2@x"):
            assert admin_client.post(f"/api/runs/{run['id']}/students",
                                     json={"email": email}).status_code in (200, 201)
        body = teacher_client.get("/api/teaching/runs").json()
        assert [row["run"]["id"] for row in body] == [run["id"]]
        assert body[0]["student_count"] == 2

    def test_admin_of_another_course_sees_none_of_this_courses_runs(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course_a, _ = seed_publishable_version(slug="ca", name="CA")
        course_b, _ = seed_publishable_version(slug="cb", name="CB")
        admin_client.post(
            f"/api/courses/{course_a['id']}/runs",
            json={"title": "A", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        )
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course_b["id"]))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []

    def test_teacher_of_one_course_and_admin_of_another_sees_both(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course_a, _ = seed_publishable_version(slug="ta", name="TA")
        course_b, _ = seed_publishable_version(slug="tb", name="TB")
        ra = admin_client.post(
            f"/api/courses/{course_a['id']}/runs",
            json={"title": "A", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        admin_client.post(
            f"/api/courses/{course_a['id']}/runs",
            json={"title": "A-other", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        )
        rb = admin_client.post(
            f"/api/courses/{course_b['id']}/runs",
            json={"title": "B", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=ra["id"], user_id=teacher_user.id))
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course_b["id"]))
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        assert [row["run"]["id"] for row in body] == [ra["id"], rb["id"]]
        assert [row["course_id"] for row in body] == [course_a["id"], course_b["id"]]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_teaching.py -k "TestTeachingRunsEndpoint"`
Expected: 3 failed — `test_superuser_sees_every_run` (gets `[]`), `test_includes_runs_of_courses_the_user_administers` (gets `[]`), `test_teacher_of_one_course_and_admin_of_another_sees_both` (gets only `ra`). The admin-who-also-teaches test and the other-course test pass today; they pin what the new query must keep (one row, an unmultiplied count, no leak across courses).

- [ ] **Step 3: Implement the union query**

In `backend/mathion/api/teaching.py`, change the imports and the function:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Course, CourseAdmin, CourseVersion, Run, RunStudent, RunTeacher
from mathion.models_auth import User
from mathion.schemas import RunResponse, TeachingRunRow

router = APIRouter(tags=["teaching"])


@router.get("/api/teaching/runs", response_model=list[TeachingRunRow])
def list_teaching_runs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TeachingRunRow]:
    """Return the runs the current user teaches or administers.

    A run is listed when the user holds a RunTeacher row on it OR a
    CourseAdmin row on its course. Superusers see every run. Each run appears
    once and its student count is not multiplied by the role join (the role
    test is a WHERE ... IN, not a join). Ordered by Run.id ASC; the frontend
    re-groups and re-sorts client-side.
    """
    stmt = (
        select(
            Run,
            Course.id,
            Course.name,
            Course.slug,
            func.count(RunStudent.id),
        )
        .select_from(Run)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .join(Course, Course.id == CourseVersion.course_id)
        .outerjoin(RunStudent, RunStudent.run_id == Run.id)
    )
    if not user.is_superuser:
        stmt = stmt.where(
            or_(
                Run.id.in_(select(RunTeacher.run_id).where(RunTeacher.user_id == user.id)),
                CourseVersion.course_id.in_(
                    select(CourseAdmin.course_id).where(CourseAdmin.user_id == user.id)
                ),
            )
        )
    rows = db.execute(stmt.group_by(Run.id, Course.id).order_by(Run.id.asc())).all()

    return [
        TeachingRunRow(
            run=RunResponse.model_validate(run),
            course_id=course_id,
            course_name=course_name,
            course_slug=course_slug,
            student_count=student_count,
        )
        for (run, course_id, course_name, course_slug, student_count) in rows
    ]
```

- [ ] **Step 4: Run the file, then the whole backend suite**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q tests/test_teaching.py`
Expected: all pass.

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
Expected: all pass (1188 before this task, now 1191).

- [ ] **Step 5: Create the backlog file**

Create `docs/backlog/slice6a-teacher-restyle-debt.md`:

```markdown
# Slice 6a — teacher screens restyle: deferred minors

Collected from the per-task review lanes (T1–T11). Each line: what, where, why it was deferred.

## Carried to the browser pass (spec §Carried to the browser pass)
- The run frame and the tabs at a normal laptop width and at about 1000px; the Progress table scrolls sideways inside its card, never the page.
- Sticky Student/Group columns in Safari while scrolling sideways.
- The redirects from old bookmarks.
- The interim mixed look (spec §Why) is expected, not a finding.

## Minors
<!-- one heading per task, one bullet per deferred review minor -->
```

- [ ] **Step 6: Review lanes, commit, ledger**

Follow the per-task loop (no screenshots: no screen changed). Commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add backend/mathion/api/teaching.py backend/tests/test_teaching.py docs/backlog/slice6a-teacher-restyle-debt.md && git commit -m "feat(teaching): the Teaching list includes administered courses; superusers see every run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Small shared pieces — glyphs, labels, formatters, Avatar, SortMark, RunStatusChip

**Files:**
- Modify: `src/lib/runStatus.ts`, `src/lib/dashboards.ts`, `src/lib/datetime.ts`
- Create: `src/lib/blockNumbers.ts`, `src/lib/focusFirst.ts`
- Modify: `src/components/ui/IconButton.svelte`, `ui/Button.svelte`, `ui/StatusBadge.svelte`, `ui/ErrorState.svelte`
- Create: `src/components/ui/Avatar.svelte`, `ui/SortMark.svelte`, `src/components/runs/RunStatusChip.svelte`
- Test (modify): `src/tests/runStatus.test.ts`, `dashboards.test.ts`, `datetime.test.ts`, `IconButton.svelte.test.ts`, `Button.svelte.test.ts`, `StatusBadge.svelte.test.ts`, `ErrorState.svelte.test.ts`
- Test (create): `src/tests/blockNumbers.test.ts`, `focusFirst.test.ts`, `Avatar.svelte.test.ts`, `SortMark.svelte.test.ts`, `RunStatusChip.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (open section (aj); `EXPECTED_CHECKS` 1420 → 1447)

All paths below are relative to `/Users/svkucheryavski/Documents/Developing/mathion/frontend/` unless they start with `docs/` or `backend/`.

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks import these exact names):
  - `RUN_STATUS_LABEL: Record<RunStatus, string>` in `lib/runStatus.ts` — `{ active: 'active', upcoming: 'upcoming', ended: 'finished', draft: 'draft' }`.
  - `STATUS_SHORT_LABEL: Record<MpGroupStatus, string>` and `heatToken(ratio: number | null): string | null` in `lib/dashboards.ts`.
  - `formatShortDeadline(iso: string): string` ("07 Aug 23:59"), `formatShortDate(yyyyMmDd: string): string` ("01 Sep 2026"), `deadlinesHeader(isos: string[]): string` in `lib/datetime.ts`.
  - `blockPositions(blocks: { id: number }[]): Map<number, number>` in `lib/blockNumbers.ts`.
  - `focusFirst(candidates: (HTMLElement | null | undefined)[]): boolean` in `lib/focusFirst.ts`.
  - `IconButton` glyphs `refresh` and `download`; `IconButton` and `Button` accept `'data-action'?: string`; `Button` accepts a bindable `element?: HTMLButtonElement`.
  - `StatusBadge` accepts `label?: string`; `ErrorState` accepts `retryLabel?: string` (default `'Retry'`).
  - `<Avatar />` (no props), `<SortMark dir="asc" | "desc" />`, `<RunStatusChip status={RunStatus} />`.

- [ ] **Step 1: Write the library tests (they fail)**

Append to `src/tests/runStatus.test.ts`:

```ts
import { RUN_STATUS_LABEL } from '../lib/runStatus';

describe('RUN_STATUS_LABEL', () => {
  it('labels each status in lowercase; the key "ended" reads "finished"', () => {
    expect(RUN_STATUS_LABEL).toEqual({
      active: 'active', upcoming: 'upcoming', ended: 'finished', draft: 'draft',
    });
  });
});
```

Append to `src/tests/dashboards.test.ts` (add `STATUS_SHORT_LABEL, heatToken` to its existing `import { … } from '../lib/dashboards'` list):

```ts
describe('STATUS_SHORT_LABEL (6a Submissions cells)', () => {
  it('holds the lowercase short labels', () => {
    expect(STATUS_SHORT_LABEL).toEqual({
      accepted: 'accepted',
      needs_revision: 'needs revision',
      awaiting_eval: 'awaiting eval',
      not_submitted: 'not submitted',
      rejected: 'rejected',
    });
  });
});

describe('heatToken (6a Progress heatmap, five steps)', () => {
  it('no data → null (no fill)', () => {
    expect(heatToken(null)).toBeNull();
  });
  it('0 → --surface-muted', () => {
    expect(heatToken(0)).toBe('--surface-muted');
  });
  it('the step edges', () => {
    expect(heatToken(0.01)).toBe('--heat-1');
    expect(heatToken(0.25)).toBe('--heat-1');
    expect(heatToken(0.26)).toBe('--heat-2');
    expect(heatToken(0.5)).toBe('--heat-2');
    expect(heatToken(0.75)).toBe('--heat-3');
    expect(heatToken(0.76)).toBe('--heat-4');
    expect(heatToken(1)).toBe('--heat-4');
  });
});
```

In `src/tests/datetime.test.ts`, extend the import to `import { localInputToISO, isoToLocalInput, formatLocalWithTz, localTzLabel, formatShortDeadline, formatShortDate, deadlinesHeader } from '../lib/datetime';` and append:

```ts
describe('formatShortDeadline (R12)', () => {
  it('summer: local day, English month, 24-hour time', () => {
    // 21:59Z on 7 Aug = 23:59 CEST.
    expect(formatShortDeadline('2026-08-07T21:59:00Z')).toBe('07 Aug 23:59');
  });
  it('winter: the winter offset applies to that date', () => {
    // 22:59Z on 10 Jan = 23:59 CET.
    expect(formatShortDeadline('2026-01-10T22:59:00Z')).toBe('10 Jan 23:59');
  });
  it('the month is English whatever the browser locale', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    expect(formatShortDeadline('2026-12-01T08:05:00Z')).toBe('01 Dec 09:05');
    // No Intl month formatting: a German or Danish browser still reads "Dec".
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('formatShortDate (P15)', () => {
  it('a calendar date, no time zone', () => {
    expect(formatShortDate('2026-09-01')).toBe('01 Sep 2026');
    expect(formatShortDate('2027-01-31')).toBe('31 Jan 2027');
  });
});

describe('deadlinesHeader (R12)', () => {
  it('no deadlines → plain "Deadlines"', () => {
    expect(deadlinesHeader([])).toBe('Deadlines');
  });
  it('one shared offset → "Deadlines (GMT+2)"', () => {
    expect(deadlinesHeader(['2026-08-07T21:59:00Z', '2026-08-14T21:59:00Z'])).toBe('Deadlines (GMT+2)');
  });
  it('a summer and a winter deadline → "Deadlines (local time)"', () => {
    expect(deadlinesHeader(['2026-08-07T21:59:00Z', '2026-01-10T22:59:00Z'])).toBe('Deadlines (local time)');
  });
});
```

and add `vi` to the file's first import: `import { describe, it, expect, beforeAll, vi } from 'vitest';`.

Create `src/tests/blockNumbers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { blockPositions } from '../lib/blockNumbers';

describe('blockPositions (R13)', () => {
  it('numbers by list position, not by the stored order', () => {
    // Stored orders 1 and 3 (a block was deleted in between): B1, B2.
    const m = blockPositions([{ id: 10 }, { id: 30 }]);
    expect(m.get(10)).toBe(1);
    expect(m.get(30)).toBe(2);
  });
  it('a block not in the list has no number', () => {
    expect(blockPositions([]).get(5)).toBeUndefined();
  });
});
```

Create `src/tests/focusFirst.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { focusFirst } from '../lib/focusFirst';

afterEach(() => { document.body.innerHTML = ''; });

function btn(attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement('button');
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  document.body.appendChild(b);
  return b;
}

describe('focusFirst (spec §Focus order)', () => {
  it('skips null, disconnected, disabled and aria-disabled candidates', () => {
    const gone = document.createElement('button');            // never connected
    const off = btn({ disabled: '' });
    const ariaOff = btn({ 'aria-disabled': 'true' });
    const ok = btn();
    expect(focusFirst([null, undefined, gone, off, ariaOff, ok])).toBe(true);
    expect(document.activeElement).toBe(ok);
  });
  it('focuses an h2 with tabindex=-1 as the last resort', () => {
    const h2 = document.createElement('h2');
    h2.tabIndex = -1;
    document.body.appendChild(h2);
    expect(focusFirst([btn({ disabled: '' }), h2])).toBe(true);
    expect(document.activeElement).toBe(h2);
  });
  it('returns false when nothing can take focus', () => {
    expect(focusFirst([null, btn({ disabled: '' })])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the library tests to see them fail**

Run (from `frontend/`): `TZ=Europe/Copenhagen npx vitest run src/tests/runStatus.test.ts src/tests/dashboards.test.ts src/tests/datetime.test.ts src/tests/blockNumbers.test.ts src/tests/focusFirst.test.ts`
Expected: FAIL — `RUN_STATUS_LABEL`, `STATUS_SHORT_LABEL`, `heatToken`, `formatShortDeadline`, `formatShortDate`, `deadlinesHeader` are not exported; `../lib/blockNumbers` and `../lib/focusFirst` do not exist.

- [ ] **Step 3: Implement the libraries**

Append to `src/lib/runStatus.ts`:

```ts
// The chip and filter-pill labels (spec §Run status chip). The key `ended`
// stays; only the visible word is "finished".
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  active: 'active',
  upcoming: 'upcoming',
  ended: 'finished',
  draft: 'draft',
};
```

In `src/lib/dashboards.ts`, after `STATUS_LABEL`, add:

```ts
// Lowercase short labels for the Submissions grid cells (spec §Submissions).
// STATUS_LABEL stays for the side panel, the thread entries and cell names.
export const STATUS_SHORT_LABEL: Record<MpGroupStatus, string> = {
  not_submitted: 'not submitted',
  awaiting_eval: 'awaiting eval',
  needs_revision: 'needs revision',
  accepted: 'accepted',
  rejected: 'rejected',
};
```

and after `resultToStatus`, add:

```ts
// The Progress heatmap's five steps (spec §Heatmap): the token that fills a
// cell, or null for a cell with no data (no fill).
export function heatToken(ratio: number | null): string | null {
  if (ratio === null) return null;
  if (ratio <= 0) return '--surface-muted';
  if (ratio <= 0.25) return '--heat-1';
  if (ratio <= 0.5) return '--heat-2';
  if (ratio <= 0.75) return '--heat-3';
  return '--heat-4';
}
```

Append to `src/lib/datetime.ts`:

```ts
// Fixed English month abbreviations: the short forms never follow the
// browser's locale (spec R12).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

// A UTC ISO deadline in browser-local time: "07 Aug 23:59".
export function formatShortDeadline(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// A calendar date "YYYY-MM-DD" (no time, no zone): "01 Sep 2026".
export function formatShortDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return `${pad2(d)} ${MONTHS[m - 1]} ${y}`;
}

// The Deadlines column header: the zone when every shown deadline shares one
// offset, "(local time)" when daylight saving splits them, bare otherwise.
export function deadlinesHeader(isos: string[]): string {
  const zones = new Set(isos.map((iso) => localTzLabel(new Date(iso))));
  if (zones.size === 0) return 'Deadlines';
  if (zones.size === 1) return `Deadlines ${[...zones][0]}`;
  return 'Deadlines (local time)';
}
```

Create `src/lib/blockNumbers.ts`:

```ts
// R13: a block's number is its 1-based position in the pinned version's block
// list (the API orders it by `order`, then id), never the stored `order`,
// which keeps gaps after a delete.
export function blockPositions(blocks: { id: number }[]): Map<number, number> {
  return new Map(blocks.map((b, i) => [b.id, i + 1]));
}
```

Create `src/lib/focusFirst.ts`:

```ts
// The spec's focus fallback: focus the first candidate that can take focus —
// connected, not disabled, not aria-disabled. Callers list candidates in order
// (the opener, the same action on the next / previous row, the section's +,
// the section's h2 with tabindex=-1).
export function focusFirst(candidates: (HTMLElement | null | undefined)[]): boolean {
  for (const el of candidates) {
    if (!el || !el.isConnected) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    if (el.getAttribute('aria-disabled') === 'true') continue;
    el.focus();
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the library tests to see them pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Write the component tests (they fail)**

In `src/tests/IconButton.svelte.test.ts`, extend `GLYPHS` with `'refresh','download'`:

```ts
const GLYPHS = ['pencil','duplicate','disable','enable','trash','plus','up','down','chevron','close','back','check','chevron-right','refresh','download'] as const;
```

and add inside `describe('IconButton', …)`:

```ts
  it('forwards data-action (6a P2)', () => {
    const btn = render({ glyph: 'trash', title: 'Delete', 'data-action': 'delete-run' });
    expect(btn.getAttribute('data-action')).toBe('delete-run');
  });
  it('omits data-action when not given', () => {
    const btn = render({ glyph: 'trash', title: 'Delete' });
    expect(btn.hasAttribute('data-action')).toBe(false);
  });
```

Add inside `describe('Button', …)` in `src/tests/Button.svelte.test.ts`:

```ts
  it('forwards data-action (6a P2)', () => {
    const btn = render({ 'data-action': 'download-csv' });
    expect(btn.getAttribute('data-action')).toBe('download-csv');
  });
```

Add inside `describe('StatusBadge', …)` in `src/tests/StatusBadge.svelte.test.ts`:

```ts
  it('a label prop overrides the text; the status and colours stay (6a)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(StatusBadge, { target: host, props: { status: 'awaiting_eval', label: 'awaiting eval' } });
    flushSync();
    const el = host.querySelector('.status-badge') as HTMLElement;
    expect(el.textContent).toBe('awaiting eval');
    expect(el.getAttribute('data-status')).toBe('awaiting_eval');
  });
```

Add inside the top `describe` in `src/tests/ErrorState.svelte.test.ts`:

```ts
  it('retryLabel renames the inline Retry button (6a P8)', () => {
    const h = render({ title: 'Could not load runs.', onretry: () => {}, retryLabel: 'Try again' });
    const btns = Array.from(h.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(btns).toEqual(['Try again']);
  });
```

Create `src/tests/Avatar.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Avatar from '../components/ui/Avatar.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

describe('Avatar (D7)', () => {
  it('is the drawn silhouette: an inline SVG, aria-hidden, never an <img>', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(Avatar, { target: host });
    flushSync();
    const el = host.querySelector('.avatar') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('img')).toBeNull();
    expect(el.querySelector('svg circle')?.getAttribute('r')).toBe('2.7');
    expect(el.querySelector('svg path')?.getAttribute('d')).toBe('M2.6 14.4c.5-3 2.7-4.6 5.4-4.6s4.9 1.6 5.4 4.6z');
  });
});
```

Create `src/tests/SortMark.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SortMark from '../components/ui/SortMark.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

function render(dir: 'asc' | 'desc'): SVGElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(SortMark, { target: host, props: { dir } });
  flushSync();
  return host.querySelector('svg.sort-mark') as SVGElement;
}

describe('SortMark (P6)', () => {
  it('asc points up, desc points down; decorative', () => {
    const up = render('asc');
    expect(up.getAttribute('aria-hidden')).toBe('true');
    expect(up.getAttribute('data-dir')).toBe('asc');
    expect(up.querySelector('polyline')?.getAttribute('points')).toBe('2,6.5 5,3.5 8,6.5');
    unmount(component!); component = null; host.remove();
    const down = render('desc');
    expect(down.querySelector('polyline')?.getAttribute('points')).toBe('2,3.5 5,6.5 8,3.5');
  });
  it('carries no text, so it never changes a header button name', () => {
    expect(render('asc').textContent).toBe('');
  });
});
```

Create `src/tests/RunStatusChip.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunStatusChip from '../components/runs/RunStatusChip.svelte';
import type { RunStatus } from '../lib/runStatus';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

const CASES: [RunStatus, string][] = [
  ['active', 'active'], ['upcoming', 'upcoming'], ['ended', 'finished'], ['draft', 'draft'],
];

describe('RunStatusChip (spec §Run status chip)', () => {
  for (const [status, label] of CASES) {
    it(`${status} reads "${label}" and carries its class`, () => {
      host = document.createElement('div');
      document.body.appendChild(host);
      component = mount(RunStatusChip, { target: host, props: { status } });
      flushSync();
      const el = host.querySelector('.run-chip') as HTMLElement;
      expect(el.textContent).toBe(label);
      expect(el.getAttribute('data-status')).toBe(status);
      expect(el.classList.contains(`run-chip-${status}`)).toBe(true);
    });
  }
});
```

(The token per status is pinned by the gate rows in Step 9; jsdom cannot see colours.)

- [ ] **Step 6: Run the component tests to see them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/IconButton.svelte.test.ts src/tests/Button.svelte.test.ts src/tests/StatusBadge.svelte.test.ts src/tests/ErrorState.svelte.test.ts src/tests/Avatar.svelte.test.ts src/tests/SortMark.svelte.test.ts src/tests/RunStatusChip.svelte.test.ts`
Expected: FAIL — the two new glyphs render no `data-glyph` geometry check ("distinct geometry" test fails for `refresh`/`download`), `data-action` absent, StatusBadge shows "Awaiting evaluation", Retry not renamed, and the three new component files do not exist.

- [ ] **Step 7: Implement the components**

`src/components/ui/IconButton.svelte`:
- In the header comment, the glyph list line becomes `// chevron-right | close | back | check | refresh | download.`
- `Glyph` union: add `| 'refresh' | 'download'` to the second line: `| 'chevron' | 'chevron-right' | 'close' | 'back' | 'check' | 'refresh' | 'download';`
- `Props`: after `id?: string;` add `'data-action'?: string;`
- Destructuring: after `id = undefined,` add `'data-action': dataAction = undefined,`
- On the `<button>`: after `{id}` add `data-action={dataAction}`.
- In the glyph chain, before `{/if}` add:

```svelte
    {:else if glyph === 'refresh'}
      <path d="M12.4 8a4.4 4.4 0 1 1-1.3-3.1" /><polyline points="11.4,2.4 11.4,5.1 8.7,5.1" />
    {:else if glyph === 'download'}
      <line x1="8" y1="2.8" x2="8" y2="9.6" /><polyline points="5,6.8 8,9.8 11,6.8" /><path d="M3 10.8v2h10v-2" />
```

`src/components/ui/Button.svelte` — the props block becomes:

```ts
  let {
    variant = 'primary' as Variant,
    type = 'button' as 'button' | 'submit',
    disabled = false,
    loading = false,
    title = undefined as string | undefined,
    // Forward aria-label so icon-only buttons (reorder ↑/↓) can announce
    // their purpose to screen readers. Visible glyph stays for sighted
    // users; the title attribute also supplies a tooltip.
    'aria-label': ariaLabel = undefined as string | undefined,
    // Slice-6a: a test and gate hook, and a ref for callers that return focus.
    'data-action': dataAction = undefined as string | undefined,
    element = $bindable(undefined as HTMLButtonElement | undefined),
    onclick = undefined as (() => void) | undefined,
    full = false,
    children,
  } = $props();
```

(Keep the existing comment's wording; only the two new lines and their comment are added. If the existing comment mentions `↑/↓`, replace those two characters with the words "up/down" — the gate's emoji scan runs over this file from this task on.)

and the `<button>` gains `bind:this={element}` and `data-action={dataAction}`:

```svelte
<button
  bind:this={element}
  {type}
  class="btn {variant}"
  class:full={full}
  data-variant={variant}
  data-action={dataAction}
  {disabled}
  {title}
  aria-label={ariaLabel}
  {onclick}
>
```

`src/components/ui/StatusBadge.svelte` — props and text:

```svelte
<script lang="ts">
  import { STATUS_LABEL, type MpGroupStatus } from '../../lib/dashboards';

  // `label` overrides the text only (Slice-6a Submissions passes the short label).
  let { status, label = undefined }: { status: MpGroupStatus; label?: string } = $props();

  // Map status enum to CSS variable name (underscores → dashes).
  const cssKey = $derived(status.replace(/_/g, '-'));
</script>

<span
  class="status-badge"
  data-status={status}
  style="--badge-bg: var(--status-{cssKey}-bg); --badge-fg: var(--status-{cssKey}-fg);"
>{label ?? STATUS_LABEL[status]}</span>
```

`src/components/ui/ErrorState.svelte`:
- Props: add `retryLabel = 'Retry',` after `onretry = undefined,` and `retryLabel?: string;` to the type.
- The Retry line becomes `{#if variant === 'inline' && onretry}<Button variant="secondary" onclick={onretry}>{retryLabel}</Button>{/if}`.

Create `src/components/ui/Avatar.svelte`:

```svelte
<script lang="ts">
  // Teacher avatar (D7): the drawn silhouette from base.css "Teacher avatar",
  // inline SVG so a missing photo never renders a broken tile. Decorative:
  // the row's name and email name the person.
</script>

<span class="avatar" aria-hidden="true">
  <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
    <circle class="fig" cx="8" cy="5.9" r="2.7" />
    <path class="fig" d="M2.6 14.4c.5-3 2.7-4.6 5.4-4.6s4.9 1.6 5.4 4.6z" />
  </svg>
</span>

<style>
  .avatar {
    display: inline-flex;
    flex: 0 0 auto;
    box-sizing: border-box;
    width: var(--avatar);
    height: var(--avatar);
    border-radius: 50%;
    background: var(--avatar-bg);
    border: 1px solid var(--border-strong);
    overflow: hidden;
  }
  svg { width: 100%; height: 100%; }
  .fig { fill: var(--avatar-fig); }
</style>
```

Create `src/components/ui/SortMark.svelte`:

```svelte
<script lang="ts">
  // The sort direction mark in a sortable column header. Decorative: the
  // header cell's aria-sort carries the state (6a P6).
  let { dir }: { dir: 'asc' | 'desc' } = $props();
</script>

<svg class="sort-mark" viewBox="0 0 10 10" aria-hidden="true" focusable="false" data-dir={dir}>
  {#if dir === 'asc'}<polyline points="2,6.5 5,3.5 8,6.5" />{:else}<polyline points="2,3.5 5,6.5 8,3.5" />{/if}
</svg>

<style>
  .sort-mark {
    width: 10px;
    height: 10px;
    margin-left: 4px;
    vertical-align: middle;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
```

Create `src/components/runs/RunStatusChip.svelte`:

```svelte
<script lang="ts">
  // One chip for a run's status (spec §Run status chip): the run frame and
  // both runs lists. The label is in the text, so colour is never the only signal.
  import { RUN_STATUS_LABEL, type RunStatus } from '../../lib/runStatus';

  let { status }: { status: RunStatus } = $props();
</script>

<span class="run-chip run-chip-{status}" data-status={status}>{RUN_STATUS_LABEL[status]}</span>

<style>
  .run-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
  }
  .run-chip-active { background: var(--status-awaiting-eval-bg); color: var(--status-awaiting-eval-fg); }
  .run-chip-upcoming { background: var(--primary-soft); color: var(--primary); }
  .run-chip-ended { background: var(--state-archived-bg); color: var(--state-archived-fg); }
  .run-chip-draft { background: var(--state-created-bg); color: var(--state-created-fg); }
</style>
```

- [ ] **Step 8: Run the component tests to see them pass**

Run: same command as Step 6.
Expected: PASS.

- [ ] **Step 9: Open gate section (aj)**

In `frontend/scripts/visual-refresh-gate.sh`, set `EXPECTED_CHECKS=1447` (was 1420), and insert this block right before the closing lines `# The summary line is the parent process's (see the re-exec at the top).` / `exit $fail`:

```zsh
echo
echo "--- (aj) Slice-6a — the teacher screens: shared pieces, run frame, tabs ---"
# Every component Slice 6a restyles or creates; each later task appends its files.
FILES_6A=(
  src/components/ui/Avatar.svelte src/components/ui/SortMark.svelte
  src/components/runs/RunStatusChip.svelte src/components/ui/IconButton.svelte
  src/components/ui/Button.svelte src/components/ui/StatusBadge.svelte
  src/components/ui/ErrorState.svelte
)
LIB_6A=(src/lib/runStatus.ts src/lib/dashboards.ts src/lib/datetime.ts src/lib/blockNumbers.ts src/lib/focusFirst.ts)
emoji_scan "all Slice-6a files" $FILES_6A $LIB_6A
colour_scan 6a-teacher $FILES_6A

own avatar Avatar.svelte
uniq1 avatar
if [[ -n $REPLY ]]; then
  N=Avatar; H=$REPLY
  d '\.avatar' '' 'width:var\(--avatar\)' 'height:var\(--avatar\)' 'border-radius:50%' 'background:var\(--avatar-bg\)' 'border:1px solid var\(--border-strong\)'
  d '\.fig' '' 'fill:var\(--avatar-fig\)'
  sweep Avatar $H
fi

own run-chip RunStatusChip.svelte
uniq1 run-chip
if [[ -n $REPLY ]]; then
  N=RunStatusChip; H=$REPLY
  d '\.run-chip' '' 'border-radius:var\(--radius-pill\)' 'font-size:11px' 'font-weight:500'
  d '\.run-chip-active' '' 'background:var\(--status-awaiting-eval-bg\)' 'color:var\(--status-awaiting-eval-fg\)'
  d '\.run-chip-upcoming' '' 'background:var\(--primary-soft\)' 'color:var\(--primary\)'
  d '\.run-chip-ended' '' 'background:var\(--state-archived-bg\)' 'color:var\(--state-archived-fg\)'
  d '\.run-chip-draft' '' 'background:var\(--state-created-bg\)' 'color:var\(--state-created-fg\)'
  sweep RunStatusChip $H
fi
```

Count: 2 scans + Avatar (own 1 + uniq1 1 + 5 + 1 + sweep 2 = 10) + RunStatusChip (1 + 1 + 3 + 8 + 2 = 15) = 27 → 1447.

Later tasks append to `FILES_6A` and `LIB_6A` by editing these two arrays, and insert their own blocks after the last block of section (aj), before the summary lines.

- [ ] **Step 10: Full verification**

Run the frontend suite, svelte-check and the gate (Global Constraints → Commands).
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1447 checks)`.

- [ ] **Step 11: Screenshots, lanes, commit, ledger**

Screenshots: none (no screen uses the new pieces yet); say so to the user and ask for the go to the lanes. Then lanes, then:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/runStatus.ts frontend/src/lib/dashboards.ts frontend/src/lib/datetime.ts frontend/src/lib/blockNumbers.ts frontend/src/lib/focusFirst.ts frontend/src/components/ui/IconButton.svelte frontend/src/components/ui/Button.svelte frontend/src/components/ui/StatusBadge.svelte frontend/src/components/ui/ErrorState.svelte frontend/src/components/ui/Avatar.svelte frontend/src/components/ui/SortMark.svelte frontend/src/components/runs/RunStatusChip.svelte frontend/src/tests/runStatus.test.ts frontend/src/tests/dashboards.test.ts frontend/src/tests/datetime.test.ts frontend/src/tests/blockNumbers.test.ts frontend/src/tests/focusFirst.test.ts frontend/src/tests/IconButton.svelte.test.ts frontend/src/tests/Button.svelte.test.ts frontend/src/tests/StatusBadge.svelte.test.ts frontend/src/tests/ErrorState.svelte.test.ts frontend/src/tests/Avatar.svelte.test.ts frontend/src/tests/SortMark.svelte.test.ts frontend/src/tests/RunStatusChip.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(ui): 6a shared pieces — refresh/download glyphs, labels, short formatters, Avatar, SortMark, RunStatusChip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: DangerConfirm, InlineName, and InlineConfirm's focus option

**Files:**
- Create: `src/components/ui/DangerConfirm.svelte`, `src/components/ui/InlineName.svelte`
- Modify: `src/components/ui/InlineConfirm.svelte` (`takeFocus`)
- Test (create): `src/tests/DangerConfirm.svelte.test.ts`, `src/tests/InlineName.svelte.test.ts`
- Test (modify): `src/tests/InlineConfirm.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1447 → 1467)

**Interfaces:**
- Consumes: `IconButton` (glyphs `close`, `check`), `ApiError` from `lib/api`.
- Produces:
  - `<DangerConfirm message={Snippet} confirmLabel?="Force delete" busy?={boolean} disabledReason?={string} onConfirm={() => void | Promise<void>} onCancel={() => void} />` — root `.danger-confirm[role=group]`; checkbox `input[data-role="danger-ack"]`; Force delete `button[data-action="force-delete"]` (text = `confirmLabel`); Cancel button text `Cancel`. Focus goes to the checkbox on mount. It owns the ticked state (P9).
  - `<InlineName label value? maxlength? onSave={(v: string) => Promise<void>} onCancel saveTitle?="Save" aside?={Snippet} />` — root `.inline-name`; input `.in-input`; then the optional `aside` snippet (T9 puts the Groups capacity badge there, so it keeps its place while renaming); then `IconButton` × (`data-glyph="close"`, title `Cancel`) and ✓ (`data-glyph="check"`); error `p.in-err[role=alert]`. Focus goes to the input on mount. `onSave` receives the trimmed value; a rejection's message is shown (`ApiError.displayMessage`, else `Error.message`).
  - `InlineConfirm` gains `takeFocus?: boolean` (default `false`): Cancel takes focus on mount; Esc on either button calls `onCancel`.

- [ ] **Step 1: Write the DangerConfirm tests (they fail)**

Create `src/tests/DangerConfirm.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import DangerConfirm from '../components/ui/DangerConfirm.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

const message = createRawSnippet(() => ({
  render: () => '<span>Deleting it will leave their <code>![ref]</code> markdown broken.</span>',
}));

function render(props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  component = mount(DangerConfirm, {
    target: host,
    props: { message, onConfirm, onCancel, ...props } as ComponentProps<typeof DangerConfirm>,
  });
  flushSync();
  const box = host.querySelector('input[data-role="danger-ack"]') as HTMLInputElement;
  const force = host.querySelector('button[data-action="force-delete"]') as HTMLButtonElement;
  const cancel = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel')!;
  return { onConfirm, onCancel, box, force, cancel };
}

function tick(box: HTMLInputElement) {
  box.click();
  flushSync();
}

async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); }

describe('DangerConfirm (handoff §4 Confirm-then-act)', () => {
  it('focus goes to the "I understand" box on open', () => {
    const { box } = render();
    expect(document.activeElement).toBe(box);
  });

  it('renders the message snippet with its markup; the group is described by it', () => {
    render();
    const group = host.querySelector('.danger-confirm') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const msg = document.getElementById(group.getAttribute('aria-describedby')!)!;
    expect(msg.querySelector('code')?.textContent).toBe('![ref]');
  });

  it('unarmed: Force delete is aria-disabled with its title, not natively disabled, and does nothing', () => {
    const { force, onConfirm } = render();
    expect(force.textContent?.trim()).toBe('Force delete');
    expect(force.disabled).toBe(false);
    expect(force.getAttribute('aria-disabled')).toBe('true');
    expect(force.getAttribute('title')).toBe('Tick “I understand” first');
    force.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('armed: calls onConfirm once, then the box un-ticks when it settles', async () => {
    const { box, force, onConfirm } = render();
    tick(box);
    expect(force.hasAttribute('aria-disabled')).toBe(false);
    expect(force.classList.contains('armed')).toBe(true);
    force.click();
    await settle();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(box.checked).toBe(false);
  });

  it('a rejected onConfirm also un-ticks the box', async () => {
    const { box, force } = render({ onConfirm: vi.fn().mockRejectedValue(new Error('x')) });
    tick(box);
    force.click();
    await settle();
    expect(box.checked).toBe(false);
  });

  it('disabledReason: natively disabled with that title; the box can still be ticked', () => {
    const { box, force, onConfirm } = render({ disabledReason: 'Only a course admin can force delete.' });
    expect(force.disabled).toBe(true);
    expect(force.getAttribute('title')).toBe('Only a course admin can force delete.');
    tick(box);
    expect(box.checked).toBe(true);
    expect(force.disabled).toBe(true);
    expect(force.classList.contains('armed')).toBe(false);
    force.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('busy: Force delete and Cancel are disabled', () => {
    const { force, cancel } = render({ busy: true });
    expect(force.disabled).toBe(true);
    expect(force.getAttribute('aria-busy')).toBe('true');
    expect(cancel.disabled).toBe(true);
  });

  it('Esc inside the panel calls onCancel; Cancel does too', () => {
    const { box, cancel, onCancel } = render();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('Esc while busy does nothing', () => {
    const { force, onCancel } = render({ busy: true });
    force.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the InlineName tests (they fail)**

Create `src/tests/InlineName.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet, type ComponentProps } from 'svelte';
import InlineName from '../components/ui/InlineName.svelte';
import { ApiError } from '../lib/api';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

function render(props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  component = mount(InlineName, {
    target: host,
    props: { label: 'Group name', value: 'Group A', maxlength: 80, onSave, onCancel, ...props } as ComponentProps<typeof InlineName>,
  });
  flushSync();
  const input = host.querySelector('input.in-input') as HTMLInputElement;
  const close = host.querySelector('button[data-glyph="close"]') as HTMLButtonElement;
  const check = host.querySelector('button[data-glyph="check"]') as HTMLButtonElement;
  return { onSave, onCancel, input, close, check };
}

function type(input: HTMLInputElement, v: string) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(el: HTMLElement, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); }

describe('InlineName (handoff §4 Inline field editing)', () => {
  it('takes focus, holds the value, is named by its label', () => {
    const { input } = render();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Group A');
    expect(input.getAttribute('aria-label')).toBe('Group name');
    expect(input.getAttribute('maxlength')).toBe('80');
  });

  it('× comes before ✓', () => {
    render();
    const glyphs = Array.from(host.querySelectorAll('button')).map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['close', 'check']);
  });

  it('the aside snippet renders between the field and ×', () => {
    render({ aside: createRawSnippet(() => ({ render: () => '<span class="probe">7/10</span>' })) });
    const row = host.querySelector('.in-row') as HTMLElement;
    expect(Array.from(row.children).map((c) => c.className.split(' ')[0])).toEqual(['in-input', 'probe', 'icon-btn', 'icon-btn']);
  });

  it('Enter saves the trimmed value', async () => {
    const { input, onSave } = render();
    type(input, '  Group B  ');
    key(input, 'Enter');
    await settle();
    expect(onSave).toHaveBeenCalledWith('Group B');
  });

  it('✓ saves too', async () => {
    const { input, check, onSave } = render();
    type(input, 'Group C');
    check.click();
    await settle();
    expect(onSave).toHaveBeenCalledWith('Group C');
  });

  it('Esc and × cancel', () => {
    const { input, close, onCancel } = render();
    key(input, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    close.click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('an unchanged value cancels without a request', async () => {
    const { input, onSave, onCancel } = render();
    type(input, ' Group A ');
    key(input, 'Enter');
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('an empty value keeps ✓ disabled and Enter does nothing', async () => {
    const { input, check, onSave, onCancel } = render();
    type(input, '   ');
    expect(check.disabled).toBe(true);
    key(input, 'Enter');
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('while saving: read-only, ✓ busy, Esc does nothing', async () => {
    let resolve!: () => void;
    const { input, check, onCancel } = render({ onSave: vi.fn(() => new Promise<void>((r) => { resolve = r; })) });
    type(input, 'Group D');
    key(input, 'Enter');
    await settle();
    expect(input.readOnly).toBe(true);
    expect(check.disabled).toBe(true);
    expect(check.getAttribute('title')).toBe('Saving…');
    key(input, 'Escape');
    expect(onCancel).not.toHaveBeenCalled();
    resolve();
    await settle();
    expect(input.readOnly).toBe(false);
  });

  it('a rejection keeps the field open with the error; typing clears it', async () => {
    const { input } = render({
      onSave: vi.fn().mockRejectedValue(new Error('A group with that name already exists in this run.')),
    });
    type(input, 'Group E');
    key(input, 'Enter');
    await settle();
    const msg = host.querySelector('p.in-err') as HTMLElement;
    expect(msg.getAttribute('role')).toBe('alert');
    expect(msg.textContent).toBe('A group with that name already exists in this run.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(msg.id);
    expect(input.value).toBe('Group E');
    expect(document.activeElement).toBe(input);
    type(input, 'Group F');
    expect(host.querySelector('p.in-err')).toBeNull();
  });

  it('an ApiError shows its displayMessage', async () => {
    const { input } = render({ onSave: vi.fn().mockRejectedValue(new ApiError(500, 'Server exploded')) });
    type(input, 'Group G');
    key(input, 'Enter');
    await settle();
    expect(host.querySelector('p.in-err')?.textContent).toBe(new ApiError(500, 'Server exploded').displayMessage);
  });
});
```

- [ ] **Step 3: Write the InlineConfirm tests (they fail)**

Append inside `describe('InlineConfirm', …)` in `src/tests/InlineConfirm.svelte.test.ts`:

```ts
  it('takeFocus: Cancel takes focus on mount (6a P3)', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {}, onCancel: () => {}, takeFocus: true } });
    flushSync();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  });

  it('takeFocus: Esc on either button cancels', () => {
    const onCancel = vi.fn();
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {}, onCancel, takeFocus: true } });
    flushSync();
    const [confirm, cancel] = Array.from(target.querySelectorAll('button'));
    cancel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    confirm!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('without takeFocus: focus is untouched and Esc is ignored', () => {
    const onCancel = vi.fn();
    const before = document.activeElement;
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {}, onCancel } });
    flushSync();
    expect(document.activeElement).toBe(before);
    target.querySelectorAll('button')[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run them to see them fail**

Run: `TZ=Europe/Copenhagen npx vitest run src/tests/DangerConfirm.svelte.test.ts src/tests/InlineName.svelte.test.ts src/tests/InlineConfirm.svelte.test.ts`
Expected: FAIL — the two components do not exist; `takeFocus` is ignored.

- [ ] **Step 5: Implement DangerConfirm**

Create `src/components/ui/DangerConfirm.svelte`:

```svelte
<script lang="ts">
  // The danger panel (handoff §4 Confirm-then-act): the consequence, an
  // "I understand" box, Force delete and Cancel. Unarmed, Force delete keeps
  // its slot in the muted red family and does nothing; ticking arms it. A
  // missing right (disabledReason) disables it natively, with the reason.
  // The box un-ticks when onConfirm settles, so a failure has to be re-armed.
  import { onMount, type Snippet } from 'svelte';

  let {
    message,
    confirmLabel = 'Force delete',
    busy = false,
    disabledReason = undefined,
    onConfirm,
    onCancel,
  }: {
    message: Snippet;
    confirmLabel?: string;
    busy?: boolean;
    disabledReason?: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  const uid = $props.id();
  const msgId = `${uid}-msg`;
  let armed = $state(false);
  let boxEl = $state<HTMLInputElement>();
  onMount(() => boxEl?.focus());

  const blocked = $derived(busy || disabledReason !== undefined);
  const forceTitle = $derived(disabledReason ?? (armed ? undefined : 'Tick “I understand” first'));

  async function confirm() {
    if (!armed || blocked) return;
    try {
      await onConfirm();
    } finally {
      armed = false;
    }
  }

  // Esc anywhere in the panel = Cancel. stopPropagation so an enclosing modal
  // or panel does not close as well.
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onCancel();
  }
</script>

<div class="danger-confirm" role="group" aria-describedby={msgId}>
  <p class="dc-msg" id={msgId}>{@render message()}</p>
  <label class="dc-ack">
    <input type="checkbox" data-role="danger-ack" bind:this={boxEl} bind:checked={armed} disabled={busy} onkeydown={onKeydown} />
    I understand
  </label>
  <div class="dc-actions">
    <button
      type="button"
      class="dc-force"
      class:armed={armed && disabledReason === undefined}
      data-action="force-delete"
      disabled={blocked}
      aria-disabled={!armed && !blocked ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      title={forceTitle}
      onclick={confirm}
      onkeydown={onKeydown}
    >{#if busy}<span class="dc-spin" aria-hidden="true"></span>{/if}{confirmLabel}</button>
    <button type="button" class="dc-cancel" disabled={busy} onclick={onCancel} onkeydown={onKeydown}>Cancel</button>
  </div>
</div>

<style>
  .danger-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--status-rejected-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
  }
  .dc-msg { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--status-rejected-fg); }
  .dc-msg :global(code) { font-family: var(--font-mono); background: var(--surface); padding: 0 4px; border-radius: var(--radius-pill); }
  .dc-ack { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-2); }
  .dc-actions { display: flex; gap: 6px; }
  .dc-force, .dc-cancel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--btn-pad);
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 500;
  }
  /* Unarmed (and natively disabled): the muted red family, never grey. */
  .dc-force {
    background: var(--danger-off-bg);
    color: var(--danger-off-text);
    border: 1px solid var(--danger-off-border);
    cursor: not-allowed;
  }
  .dc-force.armed {
    background: var(--danger);
    color: var(--primary-text);
    border-color: var(--danger);
    cursor: pointer;
  }
  .dc-cancel {
    background: var(--surface);
    color: var(--text-3);
    border: 1px solid var(--border-strong);
    cursor: pointer;
  }
  .dc-cancel:disabled {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
  .dc-spin {
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: dc-spin 0.6s linear infinite;
  }
  @keyframes dc-spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 6: Implement InlineName**

Create `src/components/ui/InlineName.svelte`:

```svelte
<script lang="ts">
  // A one-line name editor (handoff §4 Inline field editing): the field, then
  // Cancel and Save icons. Enter / Save stores the trimmed value, Esc / Cancel
  // closes. An unchanged value cancels without a request; an empty one keeps
  // Save disabled. A failed
  // save keeps the field open with the error under it. Nothing saves on blur.
  import { onMount, untrack, type Snippet } from 'svelte';
  import { ApiError } from '../../lib/api';
  import IconButton from './IconButton.svelte';

  let {
    label,
    value = '',
    maxlength = undefined,
    onSave,
    onCancel,
    saveTitle = 'Save',
    aside = undefined,
  }: {
    label: string;
    value?: string;
    maxlength?: number;
    onSave: (value: string) => Promise<void>;
    onCancel: () => void;
    saveTitle?: string;
    aside?: Snippet;
  } = $props();

  const uid = $props.id();
  const errId = `${uid}-err`;
  let text = $state(untrack(() => value));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement>();
  const trimmed = $derived(text.trim());
  onMount(() => inputEl?.focus());

  async function save() {
    if (saving || !trimmed) return;
    if (trimmed === value.trim()) { onCancel(); return; }
    saving = true;
    error = null;
    try {
      await onSave(trimmed);
    } catch (e) {
      error = e instanceof ApiError ? e.displayMessage
        : e instanceof Error && e.message ? e.message
        : 'Could not save.';
      inputEl?.focus();
    } finally {
      saving = false;
    }
  }

  function cancel() {
    if (!saving) onCancel();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
</script>

<div class="inline-name">
  <div class="in-row">
    <input
      class="in-input"
      type="text"
      aria-label={label}
      {maxlength}
      readonly={saving}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? errId : undefined}
      bind:this={inputEl}
      bind:value={text}
      oninput={() => { error = null; }}
      onkeydown={onKeydown}
    />
    {@render aside?.()}
    <IconButton glyph="close" size="sm" title="Cancel" disabled={saving} onclick={cancel} />
    <IconButton glyph="check" size="sm" primary title={saving ? 'Saving…' : saveTitle}
                disabled={!trimmed || saving} onclick={() => void save()} />
  </div>
  {#if error}<p class="in-err" id={errId} role="alert">{error}</p>{/if}
</div>

<style>
  .inline-name { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }
  .in-row { display: flex; align-items: center; gap: 4px; }
  .in-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .in-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .in-input[aria-invalid='true'] { border: 1.5px solid var(--danger); }
  .in-err { margin: 0; font-size: 12px; color: var(--danger); }
</style>
```

- [ ] **Step 7: Add `takeFocus` to InlineConfirm**

Replace the `<script>` and markup of `src/components/ui/InlineConfirm.svelte` (the `<style>` stays):

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  // `takeFocus` (Slice-6a): Cancel takes focus when the confirm opens, so Esc
  // reaches it, and Esc on either button cancels. Callers that pass it return
  // focus to their opener in onCancel.
  let {
    confirmLabel = 'Confirm',
    confirmDataAction,
    warning,
    onConfirm,
    onCancel,
    takeFocus = false,
  }: {
    confirmLabel?: string;
    confirmDataAction?: string;
    warning?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    takeFocus?: boolean;
  } = $props();

  let cancelEl = $state<HTMLButtonElement>();
  onMount(() => { if (takeFocus) cancelEl?.focus(); });

  function onKeydown(e: KeyboardEvent) {
    if (!takeFocus || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel?.();
  }
</script>

<div class="inline-confirm">
  {#if warning}<div class="warning">{warning}</div>{/if}
  <div class="actions">
    <button type="button" class="confirm" data-action={confirmDataAction} onclick={onConfirm} onkeydown={onKeydown}>{confirmLabel}</button>
    <button type="button" class="cancel" bind:this={cancelEl} onclick={() => onCancel?.()} onkeydown={onKeydown}>Cancel</button>
  </div>
</div>
```

- [ ] **Step 8: Run the tests to see them pass**

Run: same command as Step 4.
Expected: PASS.

- [ ] **Step 9: Gate rows**

In section (aj) of the gate: add `src/components/ui/DangerConfirm.svelte src/components/ui/InlineName.svelte src/components/ui/InlineConfirm.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1467`, and append after the RunStatusChip block:

```zsh
own danger-confirm DangerConfirm.svelte
uniq1 danger-confirm
if [[ -n $REPLY ]]; then
  N=DangerConfirm; H=$REPLY
  d '\.danger-confirm' '' 'background:var\(--status-rejected-bg\)' 'border-left:3px solid var\(--danger\)'
  d '\.dc-force' '' 'background:var\(--danger-off-bg\)' 'color:var\(--danger-off-text\)' 'border:1px solid var\(--danger-off-border\)'
  d '\.dc-force\.armed' '' 'background:var\(--danger\)' 'color:var\(--primary-text\)'
  sweep DangerConfirm $H
fi

own inline-name InlineName.svelte
uniq1 inline-name
if [[ -n $REPLY ]]; then
  N=InlineName; H=$REPLY
  d '\.in-input' '' 'height:var\(--control-h-sm\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  d '\.in-err' '' 'font-size:12px' 'color:var\(--danger\)'
  sweep InlineName $H
fi
```

Count: DangerConfirm 1 + 1 + 2 + 3 + 2 + 2 = 11; InlineName 1 + 1 + 3 + 2 + 2 = 9; total 20 → 1467.

- [ ] **Step 10: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors, still 13 warnings; gate `ALL PASS (1467 checks)`.

- [ ] **Step 11: Screenshots, lanes, commit, ledger**

No screen uses these yet; tell the user and go to the lanes. Then:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/ui/DangerConfirm.svelte frontend/src/components/ui/InlineName.svelte frontend/src/components/ui/InlineConfirm.svelte frontend/src/tests/DangerConfirm.svelte.test.ts frontend/src/tests/InlineName.svelte.test.ts frontend/src/tests/InlineConfirm.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(ui): DangerConfirm and InlineName; InlineConfirm can take focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Run pages move under `/teaching`; old addresses redirect; the header pill (D3, §Navigation)

**Files:**
- Modify: `src/routes.ts` (:15-16 plus two new rows), `src/App.svelte` (import + `componentMap`)
- Create: `src/pages/runs/RunsRedirect.svelte`
- Modify: `src/components/chrome/AppHeader.svelte` (:35 pill condition)
- Modify (link targets only; T5/T6 restyle the markup around them): `src/components/course/CourseCard.svelte:9`, `src/components/runs/NewRunModal.svelte:57`, `src/pages/runs/RunDetailPage.svelte:276,330`, `src/pages/runs/RunListPage.svelte:116,122`, `src/pages/teaching/TeacherRunListPage.svelte:78`
- Test (create): `src/tests/RunsRedirect.svelte.test.ts`, `src/tests/App.runsRedirect.svelte.test.ts`
- Test (modify): `src/tests/AppHeader.svelte.test.ts` (:90-96 and :108-115, plus three new tests), `src/tests/NewRunModal.svelte.test.ts:89`, `src/tests/TeacherRunListPage.svelte.test.ts:199,209,483`, `src/tests/CourseList.svelte.test.ts` (one new test), `src/tests/RunDetailPage.svelte.test.ts` (one new test)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1467 → 1468)

**Interfaces:**
- Consumes: T1's `/api/teaching/runs` (admins now have runs there, so the pill is never empty for them).
- Produces:
  - Routes `/teaching/:courseSlug` → `RunListPage` and `/teaching/:courseSlug/runs/:runId` → `RunDetailPage` (same props as before: `courseSlug`, `runId`).
  - `RunsRedirect` (props `courseSlug: string`, `runId?: string`), mapped to the two old routes.
  - Every in-app run link uses `/teaching/{slug}` or `/teaching/{slug}/runs/{id}`. T5 and T6 build on these addresses.

- [ ] **Step 1: Write the RunsRedirect tests (they fail)**

Create `src/tests/RunsRedirect.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunsRedirect from '../pages/runs/RunsRedirect.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import * as router from '../lib/router.svelte';

const user = {
  id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
  has_course_admin: true, has_run_teacher: false,
};

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function at(url: string) {
  history.replaceState(null, '', url);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

beforeEach(() => {
  __resetGuardsForTests();
  target = document.createElement('div');
  document.body.appendChild(target);
  session.user = { ...user };
  session.loading = false;
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  vi.restoreAllMocks();
});

describe('RunsRedirect (spec §Navigation, Redirects)', () => {
  it('/courses/s/runs → /teaching/s, replacing the entry', async () => {
    at('/courses/s/runs');
    const before = history.length;
    component = mount(RunsRedirect, { target, props: { courseSlug: 's' } });
    await settle();
    expect(location.pathname).toBe('/teaching/s');
    expect(currentRoute.path).toBe('/teaching/s');
    expect(history.length).toBe(before);
  });

  it('/courses/s/runs/8?tab=groups#x → /teaching/s/runs/8?tab=groups#x', async () => {
    at('/courses/s/runs/8?tab=groups#x');
    component = mount(RunsRedirect, { target, props: { courseSlug: 's', runId: '8' } });
    await settle();
    expect(location.pathname + location.search + location.hash).toBe('/teaching/s/runs/8?tab=groups#x');
  });

  it('re-encodes the decoded slug', async () => {
    at('/courses/a%20b/runs');
    component = mount(RunsRedirect, { target, props: { courseSlug: 'a b' } });
    await settle();
    expect(location.pathname).toBe('/teaching/a%20b');
  });

  it('renders nothing', async () => {
    at('/courses/s/runs');
    const spy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
    component = mount(RunsRedirect, { target, props: { courseSlug: 's' } });
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(target.innerHTML.replace(/<!---->/g, '').trim()).toBe('');
  });

  it('while session.user is null it calls no navigate, then redirects once the user is known', async () => {
    session.user = null;
    at('/courses/s/runs?x=1');
    const spy = vi.spyOn(router, 'navigate');
    component = mount(RunsRedirect, { target, props: { courseSlug: 's' } });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/courses/s/runs');
    session.user = { ...user };
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(location.pathname + location.search).toBe('/teaching/s?x=1');
  });
});
```

- [ ] **Step 2: Write the App-level signed-out test (it fails)**

Create `src/tests/App.runsRedirect.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';

// Review Focus 2: an old bookmark while signed out. App sends the visitor to
// login with `next`; RunsRedirect must not move the login page; after login
// the old address lands on the new one. Only fetch is stubbed, and it never
// resolves, so the pages behind the redirect stay in their loading state.
vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));

const originalFetch = globalThis.fetch;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

beforeEach(() => {
  __resetGuardsForTests();
  globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  globalThis.fetch = originalFetch;
  session.user = null;
});

describe('App: an old run address while signed out', () => {
  it('goes through login with one ?next=, then lands on the new address', async () => {
    session.user = null;
    session.loading = false;
    history.replaceState(null, '', '/courses/s/runs/8?tab=groups#x');
    currentRoute.path = location.pathname;
    currentRoute.search = location.search;
    currentRoute.hash = location.hash;
    component = mount(App, { target });
    await settle();
    await settle();
    expect(location.pathname).toBe('/login');
    expect(new URLSearchParams(location.search).getAll('next')).toEqual(['/courses/s/runs/8?tab=groups#x']);

    // Login succeeds: the session gains a user and Login navigates to `next`.
    session.user = {
      id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
      has_course_admin: false, has_run_teacher: true,
    };
    await navigate('/courses/s/runs/8?tab=groups#x', { replace: true });
    await settle();
    await settle();
    expect(location.pathname + location.search + location.hash).toBe('/teaching/s/runs/8?tab=groups#x');
  });
});
```

(Calling `navigate(next)` stands in for `Login.svelte:46-50`; the test is about the redirect, not the PIN form.)

- [ ] **Step 3: Update and add the header, link and address tests (they fail)**

In `src/tests/AppHeader.svelte.test.ts`:

Replace the test `'renders only Authoring when only has_course_admin'` (:90-96) with:

```ts
  it('an admin who teaches nothing gets Authoring and Teaching (D3)', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Authoring')).not.toBeNull();
    expect(linkByText(target, 'Teaching')).not.toBeNull();
  });

  it('a superuser gets the Teaching pill', () => {
    setSession({ is_superuser: true, has_course_admin: true, has_run_teacher: false });
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Teaching')).not.toBeNull();
  });
```

In the test `'marks Authoring active on deep /courses routes'` (:108-115) change `currentRoute.path = '/courses/foo/runs/bar';` to `currentRoute.path = '/courses/foo/edit';`.

Add after `'marks Teaching active on deep /teaching routes (startsWith, not ===)'`:

```ts
  it('a run page is under Teaching, not Authoring', () => {
    setSession({ has_course_admin: true, has_run_teacher: false });
    currentRoute.path = '/teaching/s/runs/8';
    component = mount(AppHeader, { target });
    flushSync();
    expect(linkByText(target, 'Teaching')?.getAttribute('aria-current')).toBe('page');
    expect(linkByText(target, 'Authoring')?.getAttribute('aria-current')).toBeNull();
  });
```

In `src/tests/NewRunModal.svelte.test.ts:89` change the expectation to `expect(location.pathname).toBe('/teaching/algebra/runs/42');`.

In `src/tests/TeacherRunListPage.svelte.test.ts`:
- :199 rename the test to `'cell-anchor href points to /teaching/:slug/runs/:rid'`;
- :209 expect `'/teaching/calc/runs/42'`;
- :483 expect `navSpy` to have been called with `'/teaching/calc/runs/42'`.

In `src/tests/CourseList.svelte.test.ts`, add inside `describe('CourseCard §2b (rendered through CourseList)', …)`:

```ts
  it('the Runs link points to /teaching/:slug (6a D3)', async () => {
    const t = seed([courseStub(2, { is_admin: true })]);
    await settle();
    expect((t.querySelector('a[aria-label="Runs for Course 2"]') as HTMLAnchorElement).getAttribute('href')).toBe('/teaching/c2');
  });
```

In `src/tests/RunDetailPage.svelte.test.ts`, add `import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';` to the imports, then add inside `describe('RunDetailPage shell', …)`:

```ts
  it('deleting a run from Overview lands on /teaching/:slug (6a D3)', async () => {
    __resetGuardsForTests();
    history.replaceState(null, '', '/teaching/algebra/runs/10');
    currentRoute.path = location.pathname;
    currentRoute.search = '';
    currentRoute.hash = '';
    mockHappyPath();
    const inner = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'DELETE' && /\/api\/runs\/10$/.test(url) ? jres(null, 204) : inner(url, init));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    (target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement).click();
    flushSync();
    (target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await settle();
    expect(location.pathname).toBe('/teaching/algebra');
    unmount(cmp);
  });
```

(`api.ts:64` returns `undefined` on a 204 without reading the body, so `jres(null, 204)` is enough.)

- [ ] **Step 4: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunsRedirect.svelte.test.ts src/tests/App.runsRedirect.svelte.test.ts src/tests/AppHeader.svelte.test.ts src/tests/NewRunModal.svelte.test.ts src/tests/TeacherRunListPage.svelte.test.ts src/tests/CourseList.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts`
Expected: FAIL — `RunsRedirect.svelte` does not exist (both new files fail to import); the admin-without-teaching and superuser pill tests, the run-page pill test, and every new address expectation fail. The rest pass.

- [ ] **Step 5: Implement RunsRedirect and the routes**

Create `src/pages/runs/RunsRedirect.svelte`:

```svelte
<script lang="ts">
  // Old run addresses (/courses/:slug/runs[/:runId]) moved under /teaching.
  // The routes stay (auth: true) so a signed-out bookmark still goes through
  // login with `next`; App owns that case, so nothing happens here until the
  // session has a user. search and hash are read inside untrack: the effect
  // depends only on the params and the user.
  import { untrack } from 'svelte';
  import { currentRoute, navigate } from '../../lib/router.svelte';
  import { session } from '../../stores/session.svelte';

  let { courseSlug, runId = undefined }: { courseSlug: string; runId?: string } = $props();

  $effect(() => {
    const slug = courseSlug;
    const rid = runId;
    if (session.user === null) return;
    const base = `/teaching/${encodeURIComponent(slug)}`
      + (rid !== undefined ? `/runs/${encodeURIComponent(rid)}` : '');
    untrack(() => {
      void navigate(base + currentRoute.search + currentRoute.hash, { replace: true });
    });
  });
</script>
```

In `src/routes.ts`, replace lines :15-16 with:

```ts
  { path: '/courses/:courseSlug/runs', component: 'RunsRedirect', auth: true },
  { path: '/courses/:courseSlug/runs/:runId', component: 'RunsRedirect', auth: true },
  { path: '/teaching/:courseSlug', component: 'RunListPage', auth: true },
  { path: '/teaching/:courseSlug/runs/:runId', component: 'RunDetailPage', auth: true },
```

In `src/App.svelte`, add `import RunsRedirect from './pages/runs/RunsRedirect.svelte';` after the `RunDetailPage` import, and `RunsRedirect: RunsRedirect as Component<Record<string, string>>,` after the `RunDetailPage` entry of `componentMap`.

- [ ] **Step 6: The header pill**

In `src/components/chrome/AppHeader.svelte` change `{#if session.user?.has_run_teacher}` to:

```svelte
      {#if session.user?.has_run_teacher || session.user?.has_course_admin}
```

- [ ] **Step 7: The link targets**

Change only the address in each line:
- `CourseCard.svelte:9`: ``const runsHref = $derived(`/teaching/${course.course.slug}`);``
- `NewRunModal.svelte:57`: ``navigate(`/teaching/${course.slug}/runs/${run.id}`);``
- `RunDetailPage.svelte:276`: ``navigate(`/teaching/${encodeURIComponent(courseSlug)}`);`` (`courseSlug` is the decoded route param, `router.svelte.ts:196`).
- `RunDetailPage.svelte:330`: both `/courses/${course.slug}/runs` → `/teaching/${course.slug}` (T5 replaces this breadcrumb).
- `RunListPage.svelte:116,122`: the four `/courses/${course.slug}/runs/${run.id}` / `/courses/${course!.slug}/runs/${run.id}` → `/teaching/${course.slug}/runs/${run.id}` / `/teaching/${course!.slug}/runs/${run.id}` (T6 replaces these rows).
- `TeacherRunListPage.svelte:78`: ``const runUrl = (slug: string, id: number) => `/teaching/${slug}/runs/${id}`;``

Slugs from the API are URL-safe (`[a-z0-9-]`), so only the decoded route param in `RunDetailPage:276` needs encoding.

- [ ] **Step 8: Run the tests to see them pass**

Run: same command as Step 4.
Expected: PASS.

- [ ] **Step 9: Gate row**

In section (aj) of the gate: add `src/components/chrome/AppHeader.svelte src/pages/runs/RunsRedirect.svelte` to `FILES_6A` (`CourseCard.svelte` stays out: its "Continue →" is 2b's copy and would fail the emoji scan), set `EXPECTED_CHECKS=1468`, and append:

```zsh
# D3: every in-app link to a run list or run page uses /teaching. API paths
# start with /api/ and do not match; routes.ts keeps the two redirect routes.
old_links=$(grep -rnE "['\"\`]/courses/[^'\"\`]*/runs" src --include='*.svelte' --include='*.ts' \
  | grep -v '^src/tests/' | grep -v '^src/routes\.ts:')
if [[ -z $old_links ]]; then
  echo "PASS  no page link to an old /courses/…/runs address (6a D3)"
else
  echo "FAIL  page links to old run addresses remain:"; echo "$old_links"; fail=1
fi
```

Count: 1 → 1468.

- [ ] **Step 10: Full verification**

Run the frontend suite, svelte-check and the gate (Global Constraints).
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1468 checks)`.

- [ ] **Step 11: Screenshots, lanes, commit, ledger**

Screenshots: the header as `dev@mathion.test` (course admin) with the Teaching pill, and `/courses/demo-course/runs/8` landing on `/teaching/demo-course/runs/8`. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/routes.ts frontend/src/App.svelte frontend/src/pages/runs/RunsRedirect.svelte frontend/src/components/chrome/AppHeader.svelte frontend/src/components/course/CourseCard.svelte frontend/src/components/runs/NewRunModal.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/pages/runs/RunListPage.svelte frontend/src/pages/teaching/TeacherRunListPage.svelte frontend/src/tests/RunsRedirect.svelte.test.ts frontend/src/tests/App.runsRedirect.svelte.test.ts frontend/src/tests/AppHeader.svelte.test.ts frontend/src/tests/NewRunModal.svelte.test.ts frontend/src/tests/TeacherRunListPage.svelte.test.ts frontend/src/tests/CourseList.svelte.test.ts frontend/src/tests/RunDetailPage.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(teaching): run pages live under /teaching; old addresses redirect; Teaching pill for admins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The run frame, and the open tab in the address (R1, R2, R3, R7, R10, §The run frame, §The tab in the address)

**Files:**
- Create: `src/lib/runTabs.ts`, `src/components/runs/TeachingCrumbs.svelte`
- Modify: `src/pages/runs/RunDetailPage.svelte` (script: tab state, `setTab`, run-change effect, version rank code; markup :315-482; the whole `<style>`)
- Modify: `src/components/runs/RunRosterTab.svelte:14` (the `ActiveTab` import)
- Test (create): `src/tests/runTabs.test.ts`, `src/tests/TeachingCrumbs.svelte.test.ts`, `src/tests/RunDetailPage.tabs.svelte.test.ts`
- Test (modify): `src/tests/RunDetailPage.svelte.test.ts`, `src/tests/RunDetailPage.publish.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1468 → 1485)

**Interfaces:**
- Consumes: T2 `RunStatusChip` (`status: RunStatus`), `Button` with `data-action` (P2), `ErrorState` (page variant, `action` snippet); T3 nothing; T4 the `/teaching/...` addresses.
- Produces:
  - `src/lib/runTabs.ts`:
    - `type ActiveTab = 'overview' | 'progress' | 'submissions' | 'roster' | 'groups' | 'mini-projects' | 'assets' | 'teachers'`;
    - `RUN_TABS: readonly { key: ActiveTab; label: string }[]` in R2 order;
    - `isTabKey(v: string | null): v is ActiveTab`;
    - `rawTab(search: string): string | null`;
    - `parseTab(search: string): ActiveTab` (missing or unknown → `'overview'`);
    - `withTab(search: string, tab: ActiveTab): string` and `withoutTab(search: string): string` (both return `''` or `'?…'`, keep the other parameters in order);
    - `isRunPath(path: string): boolean` (`/teaching/:slug/runs/:id`).
  - `<TeachingCrumbs course={{ slug, name }} runTitle?={string} />` — `nav.teach-crumbs[aria-label="Breadcrumb"]`: "Teaching" → `/teaching`, then the course. With `runTitle`, the course links to `/teaching/{slug}` and the run title is the `aria-current` item; without it, the course name is the `aria-current` item. T6 uses it on `RunListPage`.
  - `RunDetailPage` tab buttons: `button.run-tab[role=tab]#run-tab-{key}`; panel `section#run-panel[role=tabpanel]`. T7–T11 render inside the panel; T9's Groups card calls a new `onGotoOverview` that T9 wires to `setTab('overview', { focusTab: true })`.

**Ruling for this task (add to the plan's rulings when executing):**
- **P18 — Overview is the address without `?tab`.** `withTab(search, 'overview')` drops the parameter, so the canonical run address stays short and a click on Overview gives the same address as a fresh visit. *Cost:* none; `?tab=overview` still parses to Overview.

- [ ] **Step 1: Write the runTabs tests (they fail)**

Create `src/tests/runTabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RUN_TABS, isTabKey, rawTab, parseTab, withTab, withoutTab, isRunPath } from '../lib/runTabs';

describe('runTabs (R1, R2, R10)', () => {
  it('RUN_TABS is the R2 order and names', () => {
    expect(RUN_TABS.map((t) => t.label)).toEqual(
      ['Overview', 'Progress', 'Submissions', 'Roster', 'Groups', 'Mini-projects', 'Assets', 'Teachers']);
    expect(RUN_TABS.map((t) => t.key)).toEqual(
      ['overview', 'progress', 'submissions', 'roster', 'groups', 'mini-projects', 'assets', 'teachers']);
  });

  it('isTabKey accepts only the eight keys', () => {
    expect(isTabKey('mini-projects')).toBe(true);
    expect(isTabKey('submission')).toBe(false);
    expect(isTabKey('')).toBe(false);
    expect(isTabKey(null)).toBe(false);
  });

  it('parseTab: missing or unknown → overview', () => {
    expect(parseTab('')).toBe('overview');
    expect(parseTab('?tab=progress')).toBe('progress');
    expect(parseTab('?x=1&tab=groups')).toBe('groups');
    expect(parseTab('?tab=nope')).toBe('overview');
    expect(rawTab('?tab=nope')).toBe('nope');
    expect(rawTab('?x=1')).toBeNull();
  });

  it('withTab keeps the other parameters; overview drops the parameter (P18)', () => {
    expect(withTab('', 'roster')).toBe('?tab=roster');
    expect(withTab('?x=1&tab=groups&y=2', 'assets')).toBe('?x=1&tab=assets&y=2');
    expect(withTab('?tab=groups', 'overview')).toBe('');
    expect(withTab('?x=1&tab=groups', 'overview')).toBe('?x=1');
  });

  it('withoutTab drops only tab', () => {
    expect(withoutTab('?tab=nope')).toBe('');
    expect(withoutTab('?a=1&tab=nope&b=2')).toBe('?a=1&b=2');
    expect(withoutTab('')).toBe('');
  });

  it('isRunPath matches only a run page', () => {
    expect(isRunPath('/teaching/algebra/runs/10')).toBe(true);
    expect(isRunPath('/teaching/algebra')).toBe(false);
    expect(isRunPath('/teaching/algebra/runs/10/x')).toBe(false);
    expect(isRunPath('/courses/algebra/runs/10')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the TeachingCrumbs tests (they fail)**

Create `src/tests/TeachingCrumbs.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TeachingCrumbs from '../components/runs/TeachingCrumbs.svelte';
import * as router from '../lib/router.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); vi.restoreAllMocks(); });

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(TeachingCrumbs, { target: host, props: props as never });
  flushSync();
  return host.querySelector('nav') as HTMLElement;
}

describe('TeachingCrumbs (spec §The breadcrumb)', () => {
  it('on a run page: Teaching / Course / Run', () => {
    const nav = render({ course: { slug: 'algebra', name: 'Algebra' }, runTitle: 'Spring' });
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Teaching', '/teaching'], ['Algebra', '/teaching/algebra'],
    ]);
    const current = nav.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.tagName).toBe('SPAN');
    expect(current.textContent).toBe('Spring');
    const seps = Array.from(nav.querySelectorAll('.tc-sep'));
    expect(seps.map((s) => [s.textContent, s.getAttribute('aria-hidden')])).toEqual([['/', 'true'], ['/', 'true']]);
  });

  it('on a course page: Teaching / Course (current)', () => {
    const nav = render({ course: { slug: 'algebra', name: 'Algebra' } });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim())).toEqual(['Teaching']);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Algebra');
    expect(nav.querySelectorAll('.tc-sep')).toHaveLength(1);
  });

  it('links navigate in-app', () => {
    const spy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
    const nav = render({ course: { slug: 'algebra', name: 'Algebra' }, runTitle: 'Spring' });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    nav.querySelectorAll('a')[1]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(spy).toHaveBeenCalledWith('/teaching/algebra');
  });
});
```

- [ ] **Step 3: Write the tab-in-the-address tests (they fail)**

Create `src/tests/RunDetailPage.tabs.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunDetailPage from '../pages/runs/RunDetailPage.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, registerNavigationGuard, __resetGuardsForTests } from '../lib/router.svelte';

// R1/R10: the open tab lives in ?tab=, every switch goes through setTab and the
// registered unsaved-changes guards. Review Focus 1 is the cancelled-guard case.
const fetchSpy = vi.fn();
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const course = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true };
const runFx = (id = 10) => ({
  id, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: true, groups_enabled: true,
});
const version = { id: 99, course_id: 1, created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false };
const block = { id: 1, version_id: 99, title: 'Vectors', slug: 'vectors', order: 0, info: '', info_html: '' };
const mp = {
  id: 5, run_id: 10, block_id: 1, title: 'Vectors project', assignment_md: 'See ![fig](fig.png)',
  assignment_html: '', soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
  is_published: false, first_submitted_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};
const asset = {
  id: 1, run_id: 10, filename: 'fig.png', file_size: 10, mime_type: 'image/png',
  uploaded_at: '2026-01-01T00:00:00Z', uploaded_by: 1, uploaded_by_email: 'a@x', is_referenced: true,
};
const teacher = { id: 1, run_id: 10, user_id: 1, user_email: 't@x', user_full_name: 'T', created_at: '2026-01-01' };
const unassigned = { id: 1, run_id: 10, user_id: 7, user_email: 's@x', user_full_name: 'S', group_id: null, created_at: '2026-01-01' };

function mockRun() {
  fetchSpy.mockImplementation((url: string) => {
    if (url.includes('/courses/by-slug/')) return jres(course);
    const m = url.match(/\/api\/runs\/(\d+)$/);
    if (m) return jres(runFx(Number(m[1])));
    if (url.includes('/versions/99/blocks')) return jres([block]);
    if (url.match(/\/api\/runs\/\d+\/mini-projects$/)) return jres([mp]);
    if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([asset]);
    if (url.includes('/versions')) return jres([version]);
    if (url.includes('/teachers')) return jres([teacher]);
    if (url.includes('/groups')) return jres([]);
    if (url.includes('/students')) return jres([unassigned]);
    return jres([]);
  });
}
const runLoads = () => fetchSpy.mock.calls.filter(([u]) => /\/api\/runs\/\d+$/.test(u as string)).length;
const versionLoads = () => fetchSpy.mock.calls.filter(([u]) => /\/versions$/.test(u as string)).length;

function at(url: string) {
  history.replaceState(null, '', url);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
function open(props: { courseSlug: string; runId: string } = { courseSlug: 'algebra', runId: '10' }) {
  target = document.createElement('div');
  document.body.appendChild(target);
  cmp = mount(RunDetailPage, { target, props });
}
const tab = (key: string) => target.querySelector(`#run-tab-${key}`) as HTMLButtonElement;
const selected = () => target.querySelector('[role="tab"][aria-selected="true"]')?.id;
const address = () => location.pathname + location.search + location.hash;

beforeEach(() => {
  __resetGuardsForTests();
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  session.user = {
    id: 1, email: 't@x', full_name: 'T', is_superuser: false, is_disabled: false, photo_url: null,
    has_course_admin: true, has_run_teacher: true,
  };
  mockRun();
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  target?.remove();
  __resetGuardsForTests();
});

describe('RunDetailPage — the tab in the address', () => {
  it('?tab=groups on first load opens Groups, not Overview', async () => {
    at('/teaching/algebra/runs/10?tab=groups');
    open();
    await settle();
    expect(selected()).toBe('run-tab-groups');
    const panel = target.querySelector('#run-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('run-tab-groups');
  });

  it('an unknown tab opens Overview and rewrites the address once, keeping the rest', async () => {
    at('/teaching/algebra/runs/10?a=1&tab=nope#x');
    const before = history.length;
    open();
    await settle();
    expect(selected()).toBe('run-tab-overview');
    expect(address()).toBe('/teaching/algebra/runs/10?a=1#x');
    expect(history.length).toBe(before);
  });

  it('a missing ?tab is not rewritten', async () => {
    at('/teaching/algebra/runs/10?a=1');
    open();
    await settle();
    expect(address()).toBe('/teaching/algebra/runs/10?a=1');
  });

  it('a tab click replaces the address, keeps focus on the tab, and does not reload the run', async () => {
    at('/teaching/algebra/runs/10');
    const before = history.length;
    open();
    await settle();
    const runs = runLoads();
    const vers = versionLoads();
    tab('roster').focus();
    tab('roster').click();
    await settle();
    expect(address()).toBe('/teaching/algebra/runs/10?tab=roster');
    expect(history.length).toBe(before);
    expect(selected()).toBe('run-tab-roster');
    expect(document.activeElement).toBe(tab('roster'));
    tab('overview').click();
    await settle();
    expect(address()).toBe('/teaching/algebra/runs/10');
    expect(runLoads()).toBe(runs);
    expect(versionLoads()).toBe(vers);
    expect(target.textContent).not.toContain('Loading run…');
  });

  it('Overview "open Roster" lands on Roster with the Unassigned prefilter, ?tab=roster, focus on the Roster tab', async () => {
    at('/teaching/algebra/runs/10');
    open();
    await settle();
    (target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('run-tab-roster');
    expect(location.search).toBe('?tab=roster');
    expect(target.textContent).toContain('Showing: Unassigned');
    expect(document.activeElement).toBe(tab('roster'));
  });

  it('Assets "Edit" lands on Mini-projects and opens that mini-project; the tab has focus underneath', async () => {
    at('/teaching/algebra/runs/10?tab=assets');
    open();
    await settle();
    (target.querySelector('button[aria-controls="uses-1"]') as HTMLButtonElement).click();
    flushSync();
    const edit = Array.from(target.querySelectorAll('#uses-1 button')).find((b) => b.textContent?.trim() === 'Edit') as HTMLButtonElement;
    edit.click();
    await settle();
    await settle();
    expect(selected()).toBe('run-tab-mini-projects');
    expect(location.search).toBe('?tab=mini-projects');
    expect(document.querySelector('[role="dialog"][aria-labelledby="mp-modal-title"]')).not.toBeNull();
  });

  it('a cancelled guard keeps the tab, the address, no prefilter and no pending edit', async () => {
    at('/teaching/algebra/runs/10');
    open();
    await settle();
    const dispose = registerNavigationGuard(() => false);
    (target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('run-tab-overview');
    expect(address()).toBe('/teaching/algebra/runs/10');

    tab('assets').click();
    await settle();
    expect(selected()).toBe('run-tab-overview');
    dispose();

    // The guard is gone: Roster opens WITHOUT the dropped prefilter.
    tab('roster').click();
    await settle();
    expect(selected()).toBe('run-tab-roster');
    expect(target.textContent).not.toContain('Showing: Unassigned');

    // A cancelled Assets → Edit leaves no pending edit behind.
    tab('assets').click();
    await settle();
    (target.querySelector('button[aria-controls="uses-1"]') as HTMLButtonElement).click();
    flushSync();
    const again = registerNavigationGuard(() => false);
    (Array.from(target.querySelectorAll('#uses-1 button')).find((b) => b.textContent?.trim() === 'Edit') as HTMLButtonElement).click();
    await settle();
    expect(selected()).toBe('run-tab-assets');
    again();
    tab('mini-projects').click();
    await settle();
    expect(selected()).toBe('run-tab-mini-projects');
    expect(document.querySelector('[role="dialog"][aria-labelledby="mp-modal-title"]')).toBeNull();
  });

  it('an accepted guard switches', async () => {
    at('/teaching/algebra/runs/10');
    open();
    await settle();
    const guard = vi.fn(() => true);
    registerNavigationGuard(guard);
    tab('teachers').click();
    await settle();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(selected()).toBe('run-tab-teachers');
    expect(location.search).toBe('?tab=teachers');
  });

  it('a different :runId resets the per-run state; the tab still comes from the address', async () => {
    at('/teaching/algebra/runs/10');
    const props = $state({ courseSlug: 'algebra', runId: '10' });
    open(props);
    await settle();
    (target.querySelector('button[data-action="goto-unassigned"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Showing: Unassigned');
    at('/teaching/algebra/runs/11?tab=roster');
    props.runId = '11';
    await settle();
    await settle();
    expect(selected()).toBe('run-tab-roster');
    expect(target.textContent).not.toContain('Showing: Unassigned');
  });
});
```

- [ ] **Step 4: Update the existing RunDetailPage tests (they fail)**

In `src/tests/RunDetailPage.svelte.test.ts`:

1. Add `import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';` (T4 already added it — keep one copy) and replace the `beforeEach` line `location.hash = '#/courses/algebra/runs/10';` with:

```ts
  __resetGuardsForTests();
  history.replaceState(null, '', '/teaching/algebra/runs/10');
  currentRoute.path = '/teaching/algebra/runs/10';
  currentRoute.search = '';
  currentRoute.hash = '';
```

   Then delete the four address lines at the top of T4's delete-run test (`__resetGuardsForTests();` through `currentRoute.hash = '';`): the `beforeEach` does it now.

2. Delete the test `'resets activeTab to overview and rosterPrefilter to null on runId change'` (:143-159). The tabs file's runId test replaces it: the tab now comes from the address.

3. Replace the test `'renders version label "vN (YYYY-MM-DD)" in the header (spec §7 step 4)'` (:161-185) with:

```ts
  it('the meta line names the pinned version by id, not rank (R3)', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ version_id: 102 }));
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([
        versionFixture({ id: 100, created_at: '2026-01-01' }),
        versionFixture({ id: 102, created_at: '2026-03-15' }),
      ]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([]);
      if (url.includes('/students')) return jres([]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.querySelector('p.run-meta')?.textContent?.trim()).toBe('0 students · v. 102');
    unmount(cmp);
  });

  it('the meta line: singulars, and "· N groups" only with groups on', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres(courseFixture);
      if (url.match(/\/api\/runs\/10$/)) return jres(runFixture({ groups_enabled: true }));
      if (url.includes('/versions') && url.includes('/blocks')) return jres([]);
      if (url.includes('/mini-projects')) return jres([]);
      if (url.match(/\/api\/runs\/\d+\/assets$/)) return jres([]);
      if (url.includes('/versions')) return jres([versionFixture()]);
      if (url.includes('/teachers')) return jres([]);
      if (url.includes('/groups')) return jres([{ id: 3, run_id: 10, name: 'A', is_disabled: false, student_count: 1 }]);
      if (url.includes('/students')) return jres([{ id: 1, run_id: 10, user_id: 7, user_email: 's@x', user_full_name: 'S', group_id: 3, created_at: '2026-01-01' }]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    expect(target.querySelector('p.run-meta')?.textContent?.trim()).toBe('1 student · 1 group · v. 99');
    unmount(cmp);
  });
```

4. In `'shows disabled-version banner when pinned version is disabled'`, after the `toContain` line add:

```ts
    expect(target.querySelectorAll('.run-banner-warn')).toHaveLength(1);
```

5. Replace the test `'renders status badge in the header (spec §3.5 + §7 step 20)'` (:240-262) body's two assertions with:

```ts
    const chip = target.querySelector('.run-title-row .run-chip') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('draft');
    expect(chip.getAttribute('data-status')).toBe('draft');
    expect(target.querySelector('h1')?.textContent?.trim()).toBe('Spring');
```

   and rename it `'the title row: h1 run title and the run status chip'`.

6. In `'renders 6th "Assets" tab; …'` replace `flushSync();` after `assetsBtn.click();` with `await settle();`.

7. In both TD1 tests change `=== 'Submission'` to `=== 'Submissions'`.

8. Add inside `describe('RunDetailPage shell', …)`:

```ts
  it('errors use the page ErrorState with a link back to Teaching', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return jres({ detail: 'Course not found' }, 404);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: '10' } });
    await settle();
    const card = target.querySelector('.error-state.page') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe('Course not found');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/teaching');
    unmount(cmp);
  });

  it('"Invalid run." uses the page ErrorState too', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunDetailPage, { target, props: { courseSlug: 'algebra', runId: 'abc' } });
    await settle();
    expect(target.querySelector('.error-state.page h1')?.textContent).toBe('Invalid run.');
    unmount(cmp);
  });
```

In `src/tests/RunDetailPage.publish.svelte.test.ts`:
- In `'teacher (is_admin=false) sees status badge and version label but NOT publish/unpublish buttons'` and `'admin (is_admin=true) sees publish or unpublish button + badge + label'`, replace `[data-testid="status-badge"]` with `.run-chip` and `[data-testid="version-label"]` with `p.run-meta`; rename both titles from "status badge and version label" / "badge + label" to "the chip and the meta line".
- Replace the whole `describe('breadcrumb fix for teachers', …)` block with:

```ts
describe('breadcrumb: Teaching / Course / Run for everyone (spec §The breadcrumb)', () => {
  for (const isAdmin of [false, true]) {
    it(`${isAdmin ? 'admin' : 'teacher'}: Teaching / Algebra / Spring, no /courses link`, async () => {
      const { target, cmp } = setup({ course: { is_admin: isAdmin } });
      await settle();
      const nav = target.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
      expect(Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/teaching', '/teaching/algebra']);
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Spring');
      expect(linkByText(target, 'Courses')).toBeNull();
      unmount(cmp);
    });
  }
});
```

- [ ] **Step 5: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/runTabs.test.ts src/tests/TeachingCrumbs.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.publish.svelte.test.ts`
Expected: FAIL — `runTabs` and `TeachingCrumbs` do not exist; the tabs file finds no `#run-tab-*`; the meta-line, chip, banner-class, ErrorState, TD1 and breadcrumb tests fail. The other existing tests pass.

- [ ] **Step 6: Implement `runTabs.ts`**

Create `src/lib/runTabs.ts`:

```ts
// The run page's tabs (R2 order) and the ?tab= address helpers (R1, R10).
// Overview is the address without ?tab (P18).

export type ActiveTab =
  | 'overview' | 'progress' | 'submissions' | 'roster'
  | 'groups' | 'mini-projects' | 'assets' | 'teachers';

export const RUN_TABS: readonly { key: ActiveTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'progress', label: 'Progress' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'roster', label: 'Roster' },
  { key: 'groups', label: 'Groups' },
  { key: 'mini-projects', label: 'Mini-projects' },
  { key: 'assets', label: 'Assets' },
  { key: 'teachers', label: 'Teachers' },
];

export function isTabKey(v: string | null): v is ActiveTab {
  return v !== null && RUN_TABS.some((t) => t.key === v);
}

export function rawTab(search: string): string | null {
  return new URLSearchParams(search).get('tab');
}

export function parseTab(search: string): ActiveTab {
  const v = rawTab(search);
  return isTabKey(v) ? v : 'overview';
}

function serialize(p: URLSearchParams): string {
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function withTab(search: string, tab: ActiveTab): string {
  const p = new URLSearchParams(search);
  if (tab === 'overview') p.delete('tab');
  else p.set('tab', tab);
  return serialize(p);
}

export function withoutTab(search: string): string {
  const p = new URLSearchParams(search);
  p.delete('tab');
  return serialize(p);
}

export function isRunPath(path: string): boolean {
  return /^\/teaching\/[^/]+\/runs\/[^/]+$/.test(path);
}
```

In `src/components/runs/RunRosterTab.svelte:14` change the import to `import type { ActiveTab } from '../../lib/runTabs';`.

- [ ] **Step 7: Implement TeachingCrumbs**

Create `src/components/runs/TeachingCrumbs.svelte`:

```svelte
<script lang="ts">
  // Teaching / Course [/ Run] (spec §The breadcrumb). The last item is plain
  // text with aria-current; the drawn "/" separators are hidden from AT.
  import { navigate } from '../../lib/router.svelte';

  let { course, runTitle = undefined }: {
    course: { slug: string; name: string };
    runTitle?: string;
  } = $props();

  const courseHref = $derived(`/teaching/${course.slug}`);

  function go(e: MouseEvent, href: string) {
    e.preventDefault();
    void navigate(href);
  }
</script>

<nav class="teach-crumbs" aria-label="Breadcrumb">
  <a href="/teaching" onclick={(e) => go(e, '/teaching')}>Teaching</a>
  <span class="tc-sep" aria-hidden="true">/</span>
  {#if runTitle !== undefined}
    <a href={courseHref} onclick={(e) => go(e, courseHref)}>{course.name}</a>
    <span class="tc-sep" aria-hidden="true">/</span>
    <span class="tc-current" aria-current="page">{runTitle}</span>
  {:else}
    <span class="tc-current" aria-current="page">{course.name}</span>
  {/if}
</nav>

<style>
  .teach-crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .teach-crumbs a { color: var(--muted); text-decoration: none; }
  .teach-crumbs a:hover { color: var(--text); text-decoration: underline; }
  .tc-sep { color: var(--faint); }
  .tc-current { color: var(--text-2); }
</style>
```

- [ ] **Step 8: Rework RunDetailPage's script**

In `src/pages/runs/RunDetailPage.svelte`:

1. Imports: add `import { tick, untrack } from 'svelte';` as the first import, change `import { navigate } from '../../lib/router.svelte';` to `import { currentRoute, navigate } from '../../lib/router.svelte';`, and add:

```ts
  import { RUN_TABS, isRunPath, isTabKey, parseTab, rawTab, withTab, withoutTab, type ActiveTab } from '../../lib/runTabs';
  import Button from '../../components/ui/Button.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';
  import TeachingCrumbs from '../../components/runs/TeachingCrumbs.svelte';
```

2. Delete `export type ActiveTab = …;` (:31) and `let activeTab = $state<ActiveTab>('overview');` (:52). Put in its place:

```ts
  // R1/R10: the address is the one source of truth for the open tab.
  const activeTab = $derived(parseTab(currentRoute.search));
  const tabEls: Partial<Record<ActiveTab, HTMLButtonElement>> = {};

  // An unknown ?tab is rewritten once, dropping only `tab` (P11: force, since
  // nothing can be open on a tab that was never shown). A missing one is left.
  $effect(() => {
    const path = currentRoute.path;
    const search = currentRoute.search;
    if (!isRunPath(path)) return;
    const raw = rawTab(search);
    if (raw === null || isTabKey(raw)) return;
    untrack(() => {
      void navigate(path + withoutTab(search) + currentRoute.hash, { replace: true, force: true });
    });
  });

  // Every tab switch. The registered unsaved-changes guards may cancel the
  // navigate; the extras apply only when the address really shows `tab`.
  // focusTab is for jumps from inside a panel (the clicked control unmounts);
  // a tab-button click keeps its own focus. P10: focus first, then the edit
  // target, so the modal's FocusTrap returns focus to the tab.
  async function setTab(
    tab: ActiveTab,
    opts: { prefilter?: 'unassigned' | null; editTarget?: MiniProjectResponse; focusTab?: boolean } = {},
  ): Promise<void> {
    await navigate(currentRoute.path + withTab(currentRoute.search, tab) + currentRoute.hash, { replace: true });
    if (parseTab(currentRoute.search) !== tab) return;
    if (opts.prefilter !== undefined) rosterPrefilter = opts.prefilter;
    if (!opts.focusTab && !opts.editTarget) return;
    await tick();
    if (opts.focusTab) tabEls[tab]?.focus();
    if (opts.editTarget) pendingEditTarget = opts.editTarget;
  }
```

3. The run-change effect (:165-172): delete the line `activeTab = 'overview';`. The other five lines stay.

4. Replace `gotoTab` (:174-177) with:

```ts
  function gotoTab(tab: ActiveTab, prefilter?: 'unassigned' | null) {
    void setTab(tab, { prefilter: prefilter ?? null, focusTab: true });
  }
```

5. Replace `const runStatusBadge = …` and the whole `versionLabel` block (:183-192) with (P16):

```ts
  const metaLine = $derived.by(() => {
    if (!run || !students || !groups) return '';
    const parts = [`${students.length} ${students.length === 1 ? 'student' : 'students'}`];
    if (run.groups_enabled) parts.push(`${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`);
    parts.push(`v. ${run.version_id}`);
    return parts.join(' · ');
  });
```

6. `onDeleteRun` keeps T4's `/teaching/${encodeURIComponent(courseSlug)}`.

- [ ] **Step 9: Rework RunDetailPage's markup and style**

Replace everything from `{#if runIdInt === null}` down to the closing `{/if}` before `<PublishConflictsModal` with:

```svelte
{#snippet backToTeaching()}
  <a href="/teaching" onclick={(e) => { e.preventDefault(); void navigate('/teaching'); }}>Back to Teaching</a>
{/snippet}

{#if runIdInt === null}
  <ErrorState variant="page" title="Invalid run." action={backToTeaching} />
{:else if loadError}
  <ErrorState variant="page" title={loadError.displayMessage} action={backToTeaching} />
{:else if course === null || run === null || versions === null || teachers === null || groups === null || students === null || blocks === null || miniProjects === null || assets === null}
  <LoadingPlaceholder label="Loading run…" />
{:else}
  <header class="run-head">
    <TeachingCrumbs course={course} runTitle={run.title} />
    <div class="run-title-row">
      <h1>{run.title}</h1>
      <RunStatusChip status={runStatus(run)} />
      {#if course.is_admin}
        <div class="publish-bar">
          {#if !run.is_published}
            <Button variant="primary" data-action="publish" disabled={publishBlocked} title={publishTooltip} onclick={doPublish}>Publish</Button>
          {:else if unpublishConfirmOpen}
            <InlineConfirm
              confirmLabel="Confirm Unpublish"
              warning="Students will lose access immediately. Their progress data is preserved."
              onConfirm={doUnpublish}
              onCancel={() => (unpublishConfirmOpen = false)}
            />
          {:else}
            <Button variant="secondary" data-action="unpublish" onclick={() => (unpublishConfirmOpen = true)}>Unpublish</Button>
          {/if}
        </div>
      {/if}
    </div>
    <p class="run-meta">{metaLine}</p>
  </header>

  {#if showDisabledBanner}
    <div class="run-banner-warn">
      {#if course.is_admin}
        This run's course version is disabled. Re-enable it under Course Editor before publishing.
      {:else}
        This run's course version is disabled. Some editing actions are locked until a course admin re-enables it.
      {/if}
    </div>
  {/if}

  <div class="run-tabs" role="tablist" aria-label="Run sections">
    {#each RUN_TABS as t (t.key)}
      <button
        type="button"
        class="run-tab"
        role="tab"
        id="run-tab-{t.key}"
        aria-selected={activeTab === t.key}
        aria-controls="run-panel"
        bind:this={tabEls[t.key]}
        onclick={() => void setTab(t.key)}
      >{t.label}</button>
    {/each}
  </div>

  <section class="run-panel" id="run-panel" role="tabpanel" aria-labelledby="run-tab-{activeTab}">
    <!-- the eight {#if activeTab === …} branches, as today, with these changes -->
  </section>
{/if}
```

Inside the panel keep today's eight branches (:404-481) with exactly these edits:
- the `'submission'` branch becomes `{:else if activeTab === 'submissions'}`;
- Roster: `onNavigateToTab={(t) => void setTab(t, { focusTab: true })}`;
- Mini-projects: `onNavigateToTab={(t) => void setTab(t, { focusTab: true })}`;
- Assets: `onEditMiniProject={(mp) => void setTab('mini-projects', { editTarget: mp, focusTab: true })}`.

Order the branches as the tabs (Overview, Progress, Submissions, Roster, Groups, Mini-projects, Assets, Teachers); the order of `{#if}` branches does not change behaviour, it only keeps the file readable.

Replace the whole `<style>` block with:

```css
<style>
  .run-head { display: flex; flex-direction: column; gap: 8px; }
  .run-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .run-title-row h1 { margin: 0; font-size: 22px; font-weight: 600; color: var(--text); }
  .publish-bar { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .run-meta { margin: 0; font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .run-banner-warn {
    margin: 12px 0 0;
    padding: 10px 12px;
    background: var(--status-needs-revision-bg);
    color: var(--status-needs-revision-fg);
    border-left: 3px solid var(--gold);
    border-radius: var(--radius);
    font-size: 13px;
  }
  .run-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 16px; border-bottom: 1px solid var(--border); }
  .run-tab {
    padding: 9px 12px;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .run-tab:hover { color: var(--text); }
  .run-tab[aria-selected='true'] { color: var(--text); border-bottom-color: var(--primary); }
  .run-panel { padding: 16px 0; }
</style>
```

- [ ] **Step 10: Run the tests to see them pass**

Run: same command as Step 5.
Expected: PASS.

- [ ] **Step 11: Gate rows**

In section (aj): add `src/pages/runs/RunDetailPage.svelte src/components/runs/TeachingCrumbs.svelte src/components/runs/RunRosterTab.svelte` to `FILES_6A` and `src/lib/runTabs.ts` to `LIB_6A`, set `EXPECTED_CHECKS=1485`, and append:

```zsh
own run-tabs RunDetailPage.svelte
uniq1 run-tabs
if [[ -n $REPLY ]]; then
  N=RunDetailPage; H=$REPLY
  d '\.run-tab' '' 'border-bottom:2px solid transparent' 'color:var\(--muted\)'
  chk "\.run-tab(\.${H})?\[aria-selected=['\"]?true['\"]?\](\.${H})?" 'color:var\(--text\)' 'border-bottom-color:var\(--primary\)'
  d '\.run-banner-warn' '' 'background:var\(--status-needs-revision-bg\)' 'border-left:3px solid var\(--gold\)'
  d '\.run-meta' '' 'font-family:var\(--font-mono\)' 'color:var\(--muted\)'
  sweep RunDetailPage $H
fi

own teach-crumbs TeachingCrumbs.svelte
uniq1 teach-crumbs
if [[ -n $REPLY ]]; then
  N=TeachingCrumbs; H=$REPLY
  d '\.tc-sep' '' 'color:var\(--faint\)'
  sweep TeachingCrumbs $H
fi
```

Count: RunDetailPage 1 + 1 + 2 + 2 + 2 + 2 + 2 = 12; TeachingCrumbs 1 + 1 + 1 + 2 = 5; total 17 → 1485.

`RunRosterTab` joins `FILES_6A` because its import line changed; if its existing CSS or text fails `colour_scan` or `emoji_scan`, take it back out of `FILES_6A` and ledger a ruling (6c restyles Roster; 6a only touched one import).

- [ ] **Step 12: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1485 checks)`.

- [ ] **Step 13: Screenshots, lanes, commit, ledger**

Screenshots of run 8 as `dev@mathion.test`: Overview, `?tab=groups` loaded directly, and a version-disabled banner (network mock). Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/lib/runTabs.ts frontend/src/components/runs/TeachingCrumbs.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/components/runs/RunRosterTab.svelte frontend/src/tests/runTabs.test.ts frontend/src/tests/TeachingCrumbs.svelte.test.ts frontend/src/tests/RunDetailPage.tabs.svelte.test.ts frontend/src/tests/RunDetailPage.svelte.test.ts frontend/src/tests/RunDetailPage.publish.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(runs): the run frame restyled; the open tab lives in the address

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The two runs lists — `/teaching` and `/teaching/:courseSlug` (10e, R3, R5, R6, D4, §The runs lists, §Focus)

**Files:**
- Create: `src/components/ui/FilterPills.svelte`
- Rewrite: `src/pages/teaching/TeacherRunListPage.svelte`, `src/pages/runs/RunListPage.svelte`
- Test (create): `src/tests/FilterPills.svelte.test.ts`
- Test (modify): `src/tests/TeacherRunListPage.svelte.test.ts`, `src/tests/RunListPage.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1485 → 1507)

**Interfaces:**
- Consumes: T1 `/api/teaching/runs` (admin rows); T2 `RUN_STATUS_LABEL`, `formatShortDate`, `focusFirst`, `RunStatusChip`, `IconButton`/`Button` `data-action`, `ErrorState` `retryLabel`; T3 `InlineConfirm` `takeFocus`; T5 `TeachingCrumbs`.
- Produces:
  - `<FilterPills label options value onchange />` — `options: { key: string; label: string; count?: number }[]`; root `div.filter-pills[role=group][aria-label]`; each option a `button.fp[aria-pressed]` whose text is `Label (n)` (count in a mono span) or `Label`. T11 (Assets) reuses it.
  - Both lists' rows link to `/teaching/{slug}/runs/{id}`.

- [ ] **Step 1: Write the FilterPills tests (they fail)**

Create `src/tests/FilterPills.svelte.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import FilterPills from '../components/ui/FilterPills.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

function render(value = 'a') {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onchange = vi.fn();
  component = mount(FilterPills, {
    target: host,
    props: {
      label: 'Filter by status',
      options: [{ key: 'a', label: 'Active', count: 2 }, { key: 'all', label: 'All' }],
      value, onchange,
    },
  });
  flushSync();
  return { onchange, buttons: Array.from(host.querySelectorAll('button')) };
}

describe('FilterPills (handoff §4 filter pills)', () => {
  it('a labelled group of toggle buttons; the count is mono', () => {
    const { buttons } = render();
    const group = host.querySelector('.filter-pills') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Filter by status');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Active (2)', 'All']);
    expect(buttons[0]!.querySelector('.fp-n')?.textContent).toBe('(2)');
  });

  it('aria-pressed follows value; a click reports the key', () => {
    const { buttons, onchange } = render('all');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    buttons[0]!.click();
    expect(onchange).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Update the TeacherRunListPage tests (they fail)**

In `src/tests/TeacherRunListPage.svelte.test.ts`:

1. `'error state renders banner with Try again button that re-fetches'`: after `await settle();` (the first one) add

```ts
    expect(target.querySelector('.error-state.inline')).not.toBeNull();
    expect(target.textContent).toContain('Could not load runs.');
```

2. `'renders all 5 pills …'`: change every `/^Ended \(0\)$/` to `/^Finished \(0\)$/` (two places).

3. `'empty response renders page-level empty state …'`: change the text expectation to

```ts
    expect(pageTextContains(target, 'No runs yet. Runs you teach or administer appear here.')).toBe(true);
```

4. Replace `'Status column renders title-cased badge label'` with:

```ts
  it('Status column renders the run status chip (lowercase label)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    const chip = target.querySelector('tbody .run-chip') as HTMLElement;
    expect(chip.getAttribute('data-status')).toBe('active');
    expect(chip.textContent?.trim()).toBe('active');
  });
```

5. In `'with 0 active + other groups non-empty, default pill stays Active and shows cross-counts'`: rename it `'with 0 active runs the default pill stays Active and says "No active runs."'`, and replace the four "Cross-counts message visible" expectations with

```ts
    expect(pageTextContains(target, 'No active runs.')).toBe(true);
    expect(pageTextContains(target, /You have/)).toBe(false);
```

6. In `'switching to a non-default empty pill renders inline empty-filter with cross-counts'`: rename it `'an empty non-default pill says "No draft runs."'`, and replace its five text expectations with

```ts
    expect(pageTextContains(target, 'No draft runs.')).toBe(true);
    expect(pageTextContains(target, /You have/)).toBe(false);
```

7. Append inside `describe('TeacherRunListPage', …)`:

```ts
  it('h1 "Teaching"; columns Title, Course, Status, Students, Start, End', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({
      run: makeRun({ id: 42, title: 'Spring', start_date: '2026-09-01', end_date: '2099-12-31' }),
      course_name: 'Calc 101', course_slug: 'calc', student_count: 12,
    })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(target.querySelector('h1')?.textContent?.trim()).toBe('Teaching');
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => th.textContent?.trim()))
      .toEqual(['Title', 'Course', 'Status', 'Students', 'Start', 'End']);
    const cells = Array.from(target.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent?.trim());
    expect(cells).toEqual(['Spring', 'Calc 101', 'active', '12', '01 Sep 2026', '31 Dec 2099']);
  });

  it('the Course column links to /teaching/:slug', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({ course_name: 'Calc 101', course_slug: 'calc' })]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(linkByText(target, 'Calc 101')?.getAttribute('href')).toBe('/teaching/calc');
  });

  it('one link per row cell that links (no whole-row anchors)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [row({})]));
    component = mount(TeacherRunListPage, { target });
    flushSync();
    await settle();
    expect(target.querySelectorAll('tbody tr:first-child a')).toHaveLength(2);
  });
```

- [ ] **Step 3: Update the RunListPage tests (they fail)**

In `src/tests/RunListPage.svelte.test.ts`:

1. Add `import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';` and `import { session } from '../stores/session.svelte';`, and replace the `beforeEach` line `location.hash = '#/courses/algebra/runs';` with

```ts
  __resetGuardsForTests();
  history.replaceState(null, '', '/teaching/algebra');
  currentRoute.path = '/teaching/algebra';
  currentRoute.search = '';
  currentRoute.hash = '';
```

2. Add these fixtures under `settle()`:

```ts
const adminCourse = { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: true };
const draftRun = { id: 10, course_id: 1, version_id: 99, title: 'Spring 2026', start_date: '2026-06-01', end_date: '2026-06-30', is_published: false, groups_enabled: false };
const pubRun = { id: 11, course_id: 1, version_id: 98, title: 'Fall 2026', start_date: '2026-09-01', end_date: '2026-12-15', is_published: true, groups_enabled: true };
const v99 = { id: 99, course_id: 1, label: 'Autumn', created_at: '2026-01-01', published_at: '2026-01-02', is_disabled: false };
const v98 = { id: 98, course_id: 1, label: '', created_at: '2025-01-01', published_at: '2025-01-02', is_disabled: false };

function adminFetch(runs: unknown[], versions: unknown[] = [v99, v98], extra?: (url: string, init?: RequestInit) => Promise<Response> | null) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const hit = extra?.(url, init);
    if (hit) return hit;
    if (url.includes('/courses/by-slug/')) return ok(adminCourse);
    if (url.endsWith('/runs')) return ok(runs);
    if (url.includes('/versions')) return ok(versions);
    return Promise.reject(new Error('unexpected ' + url));
  });
}
function err(status: number, detail: string) {
  return Promise.resolve({
    ok: false, status,
    json: () => Promise.resolve({ detail }),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
function open() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(RunListPage, { target, props: { courseSlug: 'algebra' } });
  return { target, cmp };
}
const trash = (t: HTMLElement) => Array.from(t.querySelectorAll('button[data-action="delete-run"]')) as HTMLButtonElement[];
```

3. Replace `'renders rows in backend order with status badge and version label'` with:

```ts
  it('admin: breadcrumb, h1 "Runs" with a count, rows in backend order, no ✎ and no Open (D4, R6)', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    const nav = target.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Algebra');
    expect(target.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Runs 2');
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => th.textContent?.trim()))
      .toEqual(['Title', 'Status', 'Version', 'Start', 'End', '']);
    const rows = target.querySelectorAll('tbody tr');
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('/teaching/algebra/runs/10');
    expect(rows[0]!.textContent).toContain('Spring 2026');
    expect(rows[1]!.textContent).toContain('Fall 2026');
    expect(target.querySelector('button[data-glyph="pencil"]')).toBeNull();
    expect(Array.from(target.querySelectorAll('a')).some((a) => a.textContent?.trim() === 'Open')).toBe(false);
    unmount(cmp);
  });

  it('Version column: "Label · v. N", or "v. N" alone for an empty label (R3)', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    const versionCells = Array.from(target.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[2]!.textContent?.trim());
    expect(versionCells).toEqual(['Autumn · v. 99', 'v. 98']);
    expect(target.querySelector('tbody tr td:nth-child(3) .ver-id')?.textContent).toBe('v. 99');
    unmount(cmp);
  });

  it('🗑 on every row: enabled for a draft, disabled with its reason otherwise, named by the run', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    const [d, p] = trash(target);
    expect(d!.disabled).toBe(false);
    expect(d!.getAttribute('aria-label')).toBe('Delete run Spring 2026');
    expect(d!.getAttribute('title')).toBe('Delete');
    expect(p!.disabled).toBe(true);
    expect(p!.getAttribute('title')).toBe('Only a draft run can be deleted');
    expect(p!.getAttribute('aria-label')).toBe('Delete run Fall 2026');
    unmount(cmp);
  });

  it('🗑 → confirm takes focus on Cancel; Cancel returns focus to the 🗑', async () => {
    adminFetch([draftRun, pubRun]);
    const { target, cmp } = open();
    await settle();
    trash(target)[0]!.click();
    await settle();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(trash(target)[0]);
    unmount(cmp);
  });

  it('deleting the only draft run moves focus to + New run (Review Focus 3)', async () => {
    adminFetch([draftRun], [v99], (url, init) =>
      init?.method === 'DELETE' && url.endsWith('/api/runs/10')
        ? Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null), headers: new Headers() } as unknown as Response)
        : null);
    const { target, cmp } = open();
    await settle();
    trash(target)[0]!.click();
    await settle();
    (Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Confirm Delete') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(target.querySelector('tbody')).toBeNull();
    expect(document.activeElement).toBe(target.querySelector('button[data-action="new-run"]'));
    unmount(cmp);
  });

  it('a failed delete returns focus to the 🗑', async () => {
    adminFetch([draftRun, pubRun], [v99, v98], (url, init) =>
      init?.method === 'DELETE' ? err(409, 'Clear roster first') : null);
    const { target, cmp } = open();
    await settle();
    trash(target)[0]!.click();
    await settle();
    (Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Confirm Delete') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(trash(target)[0]);
    unmount(cmp);
  });

  it('+ New run is a 28px primary icon button titled "New run"', async () => {
    adminFetch([]);
    const { target, cmp } = open();
    await settle();
    const btn = target.querySelector('button[data-action="new-run"]') as HTMLButtonElement;
    expect(btn.getAttribute('data-glyph')).toBe('plus');
    expect(btn.classList.contains('primary')).toBe(true);
    expect(btn.classList.contains('md')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('New run');
    expect(btn.getAttribute('title')).toBe('New run');
    unmount(cmp);
  });

  it('teacher (not admin): a read-only list of their runs of this course; no + and no 🗑 (R5)', async () => {
    session.user = {
      id: 5, email: 't@x', full_name: 'T', is_superuser: false, is_disabled: false, photo_url: null,
      has_course_admin: false, has_run_teacher: true,
    };
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ok({ ...adminCourse, is_admin: false });
      if (url.endsWith('/api/teaching/runs')) return ok([
        { run: { ...pubRun, created_at: '2026-01-01T00:00:00Z', updated_at: null }, course_id: 1, course_name: 'Algebra', course_slug: 'algebra', student_count: 7 },
        { run: { ...draftRun, id: 77, course_id: 2, title: 'Other course', created_at: '2026-01-01T00:00:00Z', updated_at: null }, course_id: 2, course_name: 'Geo', course_slug: 'geo', student_count: 1 },
      ]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const { target, cmp } = open();
    await settle();
    expect(Array.from(target.querySelectorAll('thead th')).map((th) => th.textContent?.trim()))
      .toEqual(['Title', 'Status', 'Students', 'Start', 'End']);
    const rows = target.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Fall 2026');
    expect(rows[0]!.querySelectorAll('td')[2]!.textContent?.trim()).toBe('7');
    expect(target.querySelector('button[data-action="new-run"]')).toBeNull();
    expect(trash(target)).toHaveLength(0);
    unmount(cmp);
  });
```

4. Replace `'403 from by-slug redirects to /courses/:courseSlug (per spec §7 step 1 + §B row 1055)'` with:

```ts
  it('403 → ErrorState "You don\'t have access to this course\'s runs." with a link to /teaching, no breadcrumb', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.includes('/courses/by-slug/') ? err(403, 'Access denied') : Promise.reject(new Error('unexpected ' + url)));
    const navigateSpy = vi.spyOn(routerModule, 'navigate');
    const { target, cmp } = open();
    await settle();
    expect(navigateSpy).not.toHaveBeenCalled();
    const card = target.querySelector('.error-state.page') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe("You don't have access to this course's runs.");
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/teaching');
    expect(target.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    navigateSpy.mockRestore();
    unmount(cmp);
  });

  it('404 → ErrorState "Course not found." with a link to /teaching', async () => {
    fetchSpy.mockImplementation((url: string) =>
      url.includes('/courses/by-slug/') ? err(404, 'Not found') : Promise.reject(new Error('unexpected ' + url)));
    const { target, cmp } = open();
    await settle();
    const card = target.querySelector('.error-state.page') as HTMLElement;
    expect(card.querySelector('h1')?.textContent).toBe('Course not found.');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/teaching');
    unmount(cmp);
  });

  it('another load error → inline ErrorState with "Try again", which reloads', async () => {
    let calls = 0;
    fetchSpy.mockImplementation((url: string) => {
      if (url.includes('/courses/by-slug/')) return ++calls === 1 ? err(500, 'Boom') : ok(adminCourse);
      if (url.endsWith('/runs')) return ok([]);
      if (url.includes('/versions')) return ok([v99]);
      return Promise.reject(new Error('unexpected ' + url));
    });
    const { target, cmp } = open();
    await settle();
    const retry = Array.from(target.querySelectorAll('.error-state.inline button')).find((b) => b.textContent?.trim() === 'Try again') as HTMLButtonElement;
    retry.click();
    await settle();
    expect(target.textContent).toContain('Create the first run');
    unmount(cmp);
  });
```

The empty-state test and the disabled New-run test stay as they are (`btn.title` still contains "Publish a course version").

- [ ] **Step 4: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/FilterPills.svelte.test.ts src/tests/TeacherRunListPage.svelte.test.ts src/tests/RunListPage.svelte.test.ts`
Expected: FAIL — `FilterPills` does not exist; the new and changed tests fail on today's markup.

- [ ] **Step 5: Implement FilterPills**

Create `src/components/ui/FilterPills.svelte`:

```svelte
<script lang="ts">
  // Filter pills (handoff §4): a labelled group of toggle buttons. Selected:
  // --primary-soft fill and --primary text; the others a --surface pill with
  // a --border-strong ring. Counts are mono.
  let { label, options, value, onchange }: {
    label: string;
    options: { key: string; label: string; count?: number }[];
    value: string;
    onchange: (key: string) => void;
  } = $props();
</script>

<div class="filter-pills" role="group" aria-label={label}>
  {#each options as o (o.key)}
    <button type="button" class="fp" aria-pressed={value === o.key} onclick={() => onchange(o.key)}>
      {o.label}{#if o.count !== undefined} <span class="fp-n">({o.count})</span>{/if}
    </button>
  {/each}
</div>

<style>
  .filter-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .fp {
    height: var(--control-h-sm);
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-2);
    border: 1px solid var(--border-strong);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .fp:hover { color: var(--text); }
  .fp[aria-pressed='true'] { background: var(--primary-soft); color: var(--primary); border-color: var(--primary-soft); }
  .fp-n { font-family: var(--font-mono); }
</style>
```

- [ ] **Step 6: Rewrite TeacherRunListPage**

Keep the script's `load`, `cmp`, `withStatus`, `byStatus`, `counts` and `visible` exactly as today. Replace the rest of the script from `const displayLabel …` to `</script>`, and everything after it, with:

```svelte
  const PILLS = ['active', 'upcoming', 'ended', 'draft', 'all'] as const;
  const pillLabel = (p: Status | 'all') => (p === 'all' ? 'all' : RUN_STATUS_LABEL[p]);
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const pillOptions = $derived(PILLS.map((p) => ({ key: p, label: cap(pillLabel(p)), count: counts[p] })));
  const runUrl = (slug: string, id: number) => `/teaching/${slug}/runs/${id}`;
  const courseUrl = (slug: string) => `/teaching/${slug}`;
  function go(e: MouseEvent, href: string) {
    e.preventDefault();
    void navigate(href);
  }
</script>

<h1>Teaching</h1>

{#if loading}
  <LoadingPlaceholder label="Loading runs…" />
{:else if error}
  <ErrorState title="Could not load runs." message={error} onretry={load} retryLabel="Try again" />
{:else if rows.length === 0}
  <EmptyState title="No runs yet. Runs you teach or administer appear here." />
{:else}
  <FilterPills label="Filter by status" options={pillOptions} value={pill} onchange={(k) => (pill = k as Status | 'all')} />

  {#if visible.length === 0}
    <p class="empty">No {pillLabel(pill)} runs.</p>
  {:else}
    <table class="teach-table">
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Course</th>
          <th scope="col">Status</th>
          <th scope="col">Students</th>
          <th scope="col">Start</th>
          <th scope="col">End</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as { row, status } (row.run.id)}
          <tr>
            <td><a href={runUrl(row.course_slug, row.run.id)} onclick={(e) => go(e, runUrl(row.course_slug, row.run.id))}>{row.run.title}</a></td>
            <td><a class="course-link" href={courseUrl(row.course_slug)} onclick={(e) => go(e, courseUrl(row.course_slug))}>{row.course_name}</a></td>
            <td><RunStatusChip {status} /></td>
            <td class="num">{row.student_count}</td>
            <td class="num">{formatShortDate(row.run.start_date)}</td>
            <td class="num">{formatShortDate(row.run.end_date)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  h1 { margin: 0 0 14px; font-size: 22px; font-weight: 600; color: var(--text); }
  .empty { margin: 14px 0 0; color: var(--muted); font-size: 13px; }
  .teach-table { width: 100%; border-collapse: collapse; margin-top: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .teach-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .teach-table td { padding: 8px 12px; border-top: 1px solid var(--border-soft); font-size: 13px; color: var(--text-2); }
  .teach-table td a { color: var(--text); font-weight: 500; text-decoration: none; }
  .teach-table td a.course-link { color: var(--text-2); font-weight: 400; }
  .teach-table td a:hover { text-decoration: underline; }
  .num { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
</style>
```

Update the imports to:

```ts
  import { onMount } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus, RUN_STATUS_LABEL } from '../../lib/runStatus';
  import { formatShortDate } from '../../lib/datetime';
  import { navigate } from '../../lib/router.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import FilterPills from '../../components/ui/FilterPills.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';
```

`RunStatusChip`'s `status` prop is typed `RunStatus`; the page's local `Status` union is the same four strings, so `{status}` type-checks.

- [ ] **Step 7: Rewrite RunListPage**

Replace `src/pages/runs/RunListPage.svelte` with:

```svelte
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ApiError, api } from '../../lib/api';
  import { listRuns, listVersions, deleteRun } from '../../lib/runs';
  import { listTeachingRuns, type TeachingRunRow } from '../../lib/teaching';
  import { runStatus } from '../../lib/runStatus';
  import { formatShortDate } from '../../lib/datetime';
  import { focusFirst } from '../../lib/focusFirst';
  import { navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import NewRunModal from '../../components/runs/NewRunModal.svelte';
  import InlineConfirm from '../../components/ui/InlineConfirm.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Button from '../../components/ui/Button.svelte';
  import EmptyState from '../../components/ui/EmptyState.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';
  import TeachingCrumbs from '../../components/runs/TeachingCrumbs.svelte';
  import type { Course, Version, RunResponse } from '../../lib/types';

  let { courseSlug }: { courseSlug: string } = $props();

  const NEW_RUN_REASON = 'Publish a course version before creating a run.';

  let course: Course | null = $state(null);
  // Admin view (10e): the course's runs and versions. Teacher view (R5): the
  // runs of this course they teach, from the Teaching list.
  let runs: RunResponse[] | null = $state(null);
  let versions: Version[] | null = $state(null);
  let teacherRows: TeachingRunRow[] | null = $state(null);
  let loadError: { title: string; page: boolean } | null = $state(null);
  let showNewRun = $state(false);
  let pendingDelete: number | null = $state(null);

  let headingEl = $state<HTMLElement>();
  let newRunEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  const versionById = $derived(new Map((versions ?? []).map((v) => [v.id, v])));
  const hasPublishedVersion = $derived(
    (versions ?? []).some((v) => v.published_at !== null && !v.is_disabled),
  );
  const count = $derived(course?.is_admin ? (runs?.length ?? 0) : (teacherRows?.length ?? 0));
  const runHref = (id: number) => `/teaching/${course!.slug}/runs/${id}`;

  async function load() {
    loadError = null;
    course = null; runs = null; versions = null; teacherRows = null;
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${courseSlug}`);
      if (c.is_admin) {
        const [rs, vs] = await Promise.all([listRuns(c.id), listVersions(c.id)]);
        runs = rs; versions = vs;
      } else {
        teacherRows = (await listTeachingRuns()).filter((r) => r.course_id === c.id);
      }
      course = c;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        loadError = { title: 'Course not found.', page: true };
      } else if (e instanceof ApiError && e.status === 403) {
        loadError = { title: "You don't have access to this course's runs.", page: true };
      } else {
        loadError = { title: e instanceof ApiError ? e.displayMessage : 'Failed to load runs.', page: false };
      }
    }
  }

  async function cancelDelete(runId: number) {
    pendingDelete = null;
    await tick();
    trashEls[runId]?.focus();
  }

  // §Focus: on success the next row's trash, then the previous row's, then +,
  // then the h1; on failure back to this row's trash.
  async function confirmDelete(runId: number) {
    const before = runs ?? [];
    const idx = before.findIndex((r) => r.id === runId);
    try {
      await deleteRun(runId);
      runs = before.filter((r) => r.id !== runId);
      pendingDelete = null;
      pushToast('Run deleted.', 'success');
      await tick();
      const next = runs[idx];
      const prev = idx > 0 ? runs[idx - 1] : undefined;
      focusFirst([next && trashEls[next.id], prev && trashEls[prev.id], newRunEl, headingEl]);
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
      await tick();
      trashEls[runId]?.focus();
    }
  }

  function go(e: MouseEvent, href: string) {
    e.preventDefault();
    void navigate(href);
  }

  onMount(load);
</script>

{#snippet backToTeaching()}
  <a href="/teaching" onclick={(e) => go(e, '/teaching')}>Back to Teaching</a>
{/snippet}

{#snippet firstRun()}
  <Button variant="primary" data-action="create-first-run" disabled={!hasPublishedVersion}
          title={hasPublishedVersion ? undefined : NEW_RUN_REASON} onclick={() => (showNewRun = true)}>Create the first run</Button>
{/snippet}

{#if loadError?.page}
  <ErrorState variant="page" title={loadError.title} action={backToTeaching} />
{:else if loadError}
  <ErrorState title={loadError.title} onretry={load} retryLabel="Try again" />
{:else if course === null || (course.is_admin ? runs === null || versions === null : teacherRows === null)}
  <LoadingPlaceholder label="Loading runs…" />
{:else}
  <TeachingCrumbs course={course} />
  <div class="runs-head">
    <h1 tabindex="-1" bind:this={headingEl}>Runs <span class="runs-count">{count}</span></h1>
    {#if course.is_admin}
      <IconButton glyph="plus" primary size="md" aria-label="New run" data-action="new-run"
                  title={hasPublishedVersion ? 'New run' : NEW_RUN_REASON}
                  disabled={!hasPublishedVersion} bind:element={newRunEl}
                  onclick={() => (showNewRun = true)} />
    {/if}
  </div>

  {#if course.is_admin && runs}
    {#if runs.length === 0}
      <EmptyState title="No runs yet" action={firstRun} />
    {:else}
      <table class="runs-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Version</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col" aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each runs as run (run.id)}
            {@const status = runStatus(run)}
            {@const v = versionById.get(run.version_id)}
            <tr>
              <td><a href={runHref(run.id)} onclick={(e) => go(e, runHref(run.id))}>{run.title}</a></td>
              <td><RunStatusChip {status} /></td>
              <td>{#if v?.label}{v.label} · {/if}<span class="ver-id">v. {run.version_id}</span></td>
              <td class="num">{formatShortDate(run.start_date)}</td>
              <td class="num">{formatShortDate(run.end_date)}</td>
              <td class="row-actions">
                {#if pendingDelete === run.id}
                  <InlineConfirm takeFocus confirmLabel="Confirm Delete"
                                 onConfirm={() => confirmDelete(run.id)}
                                 onCancel={() => cancelDelete(run.id)} />
                {:else}
                  <IconButton glyph="trash" size="sm" danger data-action="delete-run"
                              aria-label="Delete run {run.title}"
                              title={status === 'draft' ? 'Delete' : 'Only a draft run can be deleted'}
                              disabled={status !== 'draft'} bind:element={trashEls[run.id]}
                              onclick={() => (pendingDelete = run.id)} />
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {:else if teacherRows}
    {#if teacherRows.length === 0}
      <EmptyState title="No runs yet" />
    {:else}
      <table class="runs-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Students</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
          </tr>
        </thead>
        <tbody>
          {#each teacherRows as row (row.run.id)}
            <tr>
              <td><a href={runHref(row.run.id)} onclick={(e) => go(e, runHref(row.run.id))}>{row.run.title}</a></td>
              <td><RunStatusChip status={runStatus(row.run)} /></td>
              <td class="num">{row.student_count}</td>
              <td class="num">{formatShortDate(row.run.start_date)}</td>
              <td class="num">{formatShortDate(row.run.end_date)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  {#if showNewRun && versions}
    <NewRunModal course={course} versions={versions} onClose={() => (showNewRun = false)} />
  {/if}
{/if}

<style>
  .runs-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 14px; }
  .runs-head h1 { margin: 0; font-size: 22px; font-weight: 600; color: var(--text); }
  .runs-head h1:focus { outline: none; }
  .runs-count { font-family: var(--font-mono); font-size: 13px; font-weight: 400; color: var(--muted); }
  .runs-table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .runs-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--surface-2);
    color: var(--text-3);
    font-size: 12px;
    font-weight: 600;
  }
  .runs-table td { padding: 8px 12px; border-top: 1px solid var(--border-soft); font-size: 13px; color: var(--text-2); vertical-align: middle; }
  .runs-table td a { color: var(--text); font-weight: 500; text-decoration: none; }
  .runs-table td a:hover { text-decoration: underline; }
  .ver-id, .num { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .row-actions { text-align: right; white-space: nowrap; }
</style>
```

Notes for the implementer:
- `ErrorState`'s inline variant has `role="alert"`, so a failed load is announced.
- The h1 keeps `tabindex="-1"` only as the last focus fallback; `h1:focus { outline: none }` keeps a programmatic focus from drawing a ring.
- `{#if v?.label}{v.label} · {/if}` renders "Autumn · v. 99"; an empty label renders "v. 98" alone (R3).

- [ ] **Step 8: Run the tests to see them pass**

Run: same command as Step 4.
Expected: PASS.

- [ ] **Step 9: Gate rows**

In section (aj): add `src/components/ui/FilterPills.svelte src/pages/teaching/TeacherRunListPage.svelte src/pages/runs/RunListPage.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1507`, and append:

```zsh
# Anchored on .fp, not .filter-pills: RunAssetsTab still authors its own
# .filter-pills rules until T11 replaces them with this component.
own fp FilterPills.svelte
uniq1 fp
if [[ -n $REPLY ]]; then
  N=FilterPills; H=$REPLY
  d '\.fp' '' 'background:var\(--surface\)' 'border:1px solid var\(--border-strong\)'
  chk "\.fp(\.${H})?\[aria-pressed=['\"]?true['\"]?\](\.${H})?" 'background:var\(--primary-soft\)' 'color:var\(--primary\)'
  d '\.fp-n' '' 'font-family:var\(--font-mono\)'
  sweep FilterPills $H
fi

own teach-table TeacherRunListPage.svelte
uniq1 teach-table
if [[ -n $REPLY ]]; then
  N=TeacherRunListPage; H=$REPLY
  chk "\.teach-table\.${H} th\.${H}" 'background:var\(--surface-2\)' 'color:var\(--text-3\)'
  sweep TeacherRunListPage $H
fi

own runs-table RunListPage.svelte
uniq1 runs-table
if [[ -n $REPLY ]]; then
  N=RunListPage; H=$REPLY
  chk "\.runs-table\.${H} th\.${H}" 'background:var\(--surface-2\)'
  d '\.runs-count' '' 'font-family:var\(--font-mono\)' 'color:var\(--muted\)'
  sweep RunListPage $H
fi
```

Count: FilterPills 1 + 1 + 2 + 2 + 1 + 2 = 9; TeacherRunListPage 1 + 1 + 2 + 2 = 6; RunListPage 1 + 1 + 1 + 2 + 2 = 7; total 22 → 1507.

- [ ] **Step 10: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1507 checks)`.

- [ ] **Step 11: Screenshots, lanes, commit, ledger**

Screenshots: `/teaching` as `dev@mathion.test` (Active and Finished pills) and as `teacher@mathion.test`; `/teaching/demo-course` as admin (with an open 🗑 confirm on a mocked draft row) and as teacher. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/ui/FilterPills.svelte frontend/src/pages/teaching/TeacherRunListPage.svelte frontend/src/pages/runs/RunListPage.svelte frontend/src/tests/FilterPills.svelte.test.ts frontend/src/tests/TeacherRunListPage.svelte.test.ts frontend/src/tests/RunListPage.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(teaching): the runs lists restyled (10e); teachers get a read-only course list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Progress (2d, §Progress, R7, R13)

**Files:**
- Modify: `src/components/runs/RunProgressTab.svelte` (props, three helpers, the whole markup and `<style>`)
- Modify: `src/pages/runs/RunDetailPage.svelte` (the Progress branch passes `blocks`)
- Test (modify): `src/tests/RunProgressTab.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1507 → 1524)

**Interfaces:**
- Consumes: T2 `heatToken`, `blockPositions`, `SortMark`, `IconButton` glyph `refresh`, `Button` `data-action`, `ErrorState`; T5 the panel it renders in.
- Produces: `RunProgressTab` accepts `blocks?: BlockResponse[]` (default `[]`). `RunDetailPage` passes `blocks={blocks ?? []}`.

**Ruling for this task (add to the plan's rulings when executing):**
- **P19 — Progress and Submissions have no `<h2>` header row.** 2d and 9a draw the toolbar straight under the tabs, and neither tab has a primary action; the panel is already named by its tab (`aria-labelledby`). The spec's "common to all six" header row applies to the four tabs with a + (Groups, Teachers, Mini-projects, Assets). *Cost if wrong:* one heading per tab, added later.

- [ ] **Step 1: Update and add the Progress tests (they fail)**

In `src/tests/RunProgressTab.svelte.test.ts`:

1. In `'coverage mode: cells render {covered}/{total} text'` replace the last assertion (the `hsl(` regex) with:

```ts
    const cellsByText = (t: string) => Array.from(host.querySelectorAll('td.cell')).find((td) => td.textContent?.trim() === t) as HTMLElement;
    expect(cellsByText('2/4').getAttribute('style')).toMatch(/--cell-bg:\s*var\(--heat-2\)/);
    expect(cellsByText('4/4').getAttribute('style')).toMatch(/--cell-bg:\s*var\(--heat-4\)/);
```

2. Replace `'disabled user: row has "disabled" badge; row has disabled-row class'` with:

```ts
  it('disabled user: italic muted name + "disabled" chip after the name; no opacity row class', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: true,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: 2, group_name: 'G2', group_is_disabled: true,
          coverage: [{ sequence_id: 10, covered: 2, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: 1, total: 2 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    expect(host.querySelector('tr.disabled-row')).toBeNull();
    const [alice, bob] = Array.from(host.querySelectorAll('tbody tr'));
    expect(alice!.querySelector('th .pg-name')?.classList.contains('off')).toBe(true);
    expect(alice!.querySelector('th .chip-disabled')?.textContent?.trim()).toBe('disabled');
    expect(alice!.querySelector('td.sticky-group .chip-disabled')).toBeNull();
    expect(bob!.querySelector('th .pg-name')?.classList.contains('off')).toBe(true);
    expect(bob!.querySelector('th .chip-disabled')).toBeNull();
    expect(bob!.querySelector('td.sticky-group .chip-disabled')?.textContent?.trim()).toBe('disabled');
  });
```

3. Replace `'disabled version: warning banner renders at top'` with:

```ts
  it('disabled version: one muted line with only the tab\'s own clause (R7)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock({ run: { id: 1, title: 'R', groups_enabled: true, version_is_disabled: true } })));
    mountTab();
    await settle();
    expect(host.querySelector('p.pg-note')?.textContent?.trim()).toBe('Coverage data reflects last-known state.');
    expect(host.textContent).not.toContain('course version is disabled');
  });

  it('enabled version: no note', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    expect(host.querySelector('p.pg-note')).toBeNull();
  });
```

4. Append inside `describe('RunProgressTab', …)`:

```ts
  it('heat steps: 0 → --surface-muted, no data → no fill; text keeps its value', async () => {
    const body = progressMock({
      students: [
        { user_id: 100, full_name: 'Alice', email: 'a@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 4 }],
          quizzes: [{ sequence_id: 10, correct: null, total: null }] },
        { user_id: 101, full_name: 'Bob', email: 'b@x', user_is_disabled: false,
          group_id: 1, group_name: 'G1', group_is_disabled: false,
          coverage: [{ sequence_id: 10, covered: 0, total: 0 }],
          quizzes: [{ sequence_id: 10, correct: 0, total: 0 }] },
      ],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab();
    await settle();
    const [a, b] = Array.from(host.querySelectorAll('td.cell')) as HTMLElement[];
    expect(a!.getAttribute('style')).toMatch(/--cell-bg:\s*var\(--surface-muted\)/);
    expect(a!.textContent?.trim()).toBe('0/4');
    expect(b!.getAttribute('style') ?? '').not.toContain('--cell-bg');
    expect(b!.textContent?.trim()).toBe('—');
  });

  it('the legend: 0%, five swatches in order, 100%; its name follows the mode', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const legend = host.querySelector('.heat-legend') as HTMLElement;
    expect(legend.getAttribute('role')).toBe('img');
    expect(legend.getAttribute('aria-label')).toBe('Coverage scale, 0 to 100 percent');
    expect(Array.from(legend.querySelectorAll('.hl-sw')).map((s) => s.className.match(/\bs\d\b/)?.[0]))
      .toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(legend.textContent?.replace(/\s+/g, ' ').trim()).toBe('0% 100%');
    (Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Quiz') as HTMLButtonElement).click();
    flushSync();
    expect(legend.getAttribute('aria-label')).toBe('Score scale, 0 to 100 percent');
  });

  it('headers number blocks by position in `blocks` and sequences within their block (R13)', async () => {
    const body = progressMock({
      sequences: [
        { sequence_id: 10, sequence_title: 'Vectors', sequence_order: 1, block_id: 5, block_order: 1, block_title: 'Vectors',
          total_items: 4, has_quiz_items: true },
        { sequence_id: 11, sequence_title: 'Spaces', sequence_order: 4, block_id: 5, block_order: 1, block_title: 'Vectors',
          total_items: 4, has_quiz_items: true },
        { sequence_id: 12, sequence_title: 'As a map', sequence_order: 2, block_id: 7, block_order: 3, block_title: 'Matrices',
          total_items: 4, has_quiz_items: true },
      ],
      students: [],
    });
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab(1, { blocks: [
      { id: 5, version_id: 1, title: 'Vectors', slug: 'v', order: 1, info: '', info_html: '' },
      { id: 7, version_id: 1, title: 'Matrices', slug: 'm', order: 3, info: '', info_html: '' },
    ] });
    await settle();
    expect(Array.from(host.querySelectorAll('th.block-header')).map((th) => th.textContent?.trim()))
      .toEqual(['B1 · Vectors', 'B2 · Matrices']);
    expect(Array.from(host.querySelectorAll('th.seq-header')).map((th) => th.textContent?.replace(/\s+/g, ' ').trim()))
      .toEqual(['S1 Vectors', 'S2 Spaces', 'S1 As a map']);
  });

  it('a block missing from `blocks` shows its title without "B{n} · "', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    expect(host.querySelector('th.block-header')?.textContent?.trim()).toBe('B1');
  });

  it('the active sort column shows a SortMark, not a glyph character', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const student = host.querySelector('th.sticky-name') as HTMLElement;
    expect(student.querySelector('svg.sort-mark')?.getAttribute('data-dir')).toBe('asc');
    expect(host.querySelector('thead')?.textContent).not.toMatch(/[▲▼]/);
  });

  it('toolbar: Coverage / Quiz segmented, refresh icon button, Download CSV secondary', async () => {
    vi.stubGlobal('fetch', mockFetch(200, progressMock()));
    mountTab();
    await settle();
    const seg = host.querySelector('.seg') as HTMLElement;
    expect(Array.from(seg.querySelectorAll('button')).map((b) => [b.textContent?.trim(), b.getAttribute('aria-pressed')]))
      .toEqual([['Coverage', 'true'], ['Quiz', 'false']]);
    const refresh = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement;
    expect(refresh.getAttribute('data-glyph')).toBe('refresh');
    const csv = host.querySelector('button[data-action="download-csv"]') as HTMLButtonElement;
    expect(csv.getAttribute('data-variant')).toBe('secondary');
    expect(csv.textContent?.trim()).toBe('Download CSV');
  });
```

The "missing block" test relies on `progressMock`'s block title being `'B1'` and no `blocks` prop: the header is the bare title.

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunProgressTab.svelte.test.ts`
Expected: FAIL — the new and changed tests fail (`hsl` style, `.disabled-row`, no legend, no `B{n}`/`S{n}`, `▲`, text buttons); the other tests pass.

- [ ] **Step 3: Script changes**

In `src/components/runs/RunProgressTab.svelte`:

1. Imports — replace the first five import lines with:

```ts
  import { getProgressDashboard, heatToken,
           type DashboardProgressResponse } from '../../lib/dashboards';
  import { toCSV, downloadCSV, sanitizeTitle } from '../../lib/csvWrite';
  import { blockPositions } from '../../lib/blockNumbers';
  import type { BlockResponse } from '../../lib/types';
  import LoadingPlaceholder from '../ui/LoadingPlaceholder.svelte';
  import ErrorState from '../ui/ErrorState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Button from '../ui/Button.svelte';
  import SortMark from '../ui/SortMark.svelte';
  import DashboardSidePanel from './DashboardSidePanel.svelte';
```

2. Props — add `blocks = [],` after `isTeacher = false,` and `blocks?: BlockResponse[];` to the type.

3. After `blockGroupedSequences` add:

```ts
  // R13: B{n} is the block's position in the pinned version's `blocks`; S{n}
  // the sequence's position within its block in this payload.
  const blockPos = $derived(blockPositions(blocks));
  const seqPos = $derived.by(() => {
    const m = new Map<number, number>();
    for (const bg of blockGroupedSequences) bg.sequences.forEach((s, i) => m.set(s.sequence_id, i + 1));
    return m;
  });
  function blockLabel(blockId: number, title: string): string {
    const n = blockPos.get(blockId);
    return n === undefined ? title : `B${n} · ${title}`;
  }
  const legendName = $derived(`${mode === 'coverage' ? 'Coverage' : 'Score'} scale, 0 to 100 percent`);
```

4. Replace `cellInlineStyle` with:

```ts
  // Five steps (heatToken); no data gives no style, so the cell has no fill.
  function cellInlineStyle(
    s: DashboardProgressResponse['students'][number],
    i: number,
    m: Mode,
  ): string | undefined {
    const cell = m === 'coverage' ? s.coverage[i] : s.quizzes[i];
    if (!cell) return undefined;
    const token = heatToken(computeRatio(cell, m));
    return token === null ? undefined : `--cell-bg: var(${token})`;
  }

  function sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    return sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  }
```

The rest of the script is unchanged.

- [ ] **Step 4: Markup and style**

Replace everything from `<div class="tab-container">` to the end of the file with:

```svelte
<div class="tab-container">
  {#if loading}<LoadingPlaceholder />{/if}
  {#if error}
    <ErrorState title="Could not load progress." message={error} onretry={refresh} />
  {/if}

  {#if data}
    {#if data.run.version_is_disabled}
      <p class="pg-note">Coverage data reflects last-known state.</p>
    {/if}

    <div class="pg-toolbar">
      <div class="seg" role="group" aria-label="Heatmap mode">
        <button type="button" class="seg-btn" aria-pressed={mode === 'coverage'} onclick={() => (mode = 'coverage')}>Coverage</button>
        <button type="button" class="seg-btn" aria-pressed={mode === 'quiz'} onclick={() => (mode = 'quiz')}>Quiz</button>
      </div>

      <select class="pg-control" bind:value={groupFilter} aria-label="Filter by group">
        <option value="all">All groups</option>
        {#if hasUngroupedStudents}
          <option value="ungrouped">(Ungrouped)</option>
        {/if}
        {#each uniqueGroups as g (g.group_id)}
          <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
        {/each}
      </select>

      <input class="pg-control pg-search" type="search" bind:value={nameQuery} placeholder="Search student" aria-label="Search student" />

      <div class="pg-right">
        <span class="heat-legend" role="img" aria-label={legendName}>
          <span class="hl-end">0%</span>
          <span class="hl-bar">
            <span class="hl-sw s0"></span><span class="hl-sw s1"></span><span class="hl-sw s2"></span><span class="hl-sw s3"></span><span class="hl-sw s4"></span>
          </span>
          <span class="hl-end">100%</span>
        </span>
        <IconButton glyph="refresh" title="Refresh" onclick={refresh} />
        <Button variant="secondary" data-action="download-csv" onclick={handleDownloadCSV}>Download CSV</Button>
      </div>
    </div>

    {#if data.sequences.length === 0}
      <div class="empty">No sequences in this run.</div>
    {:else}
    <div class="table-scroll">
      <table class="progress-grid">
        <thead>
          <tr class="block-row">
            <th class="sticky-name" scope="col" rowspan="2" aria-sort={sortAria('name')}>
              <button type="button" onclick={() => toggleSort('name')}>Student{#if sortKey === 'name'}<SortMark dir={sortDir} />{/if}</button>
            </th>
            <th class="sticky-group" scope="col" rowspan="2" aria-sort={sortAria('group')}>
              <button type="button" onclick={() => toggleSort('group')}>Group{#if sortKey === 'group'}<SortMark dir={sortDir} />{/if}</button>
            </th>
            {#each blockGroupedSequences as bg (bg.block_id)}
              <th class="block-header" scope="colgroup" colspan={bg.sequences.length}>{blockLabel(bg.block_id, bg.block_title)}</th>
            {/each}
          </tr>
          <tr class="seq-row">
            {#each data.sequences as seq (seq.sequence_id)}
              <th class="seq-header" scope="col" aria-sort={sortAria(`seq:${seq.sequence_id}`)}>
                <button type="button" onclick={() => toggleSort(`seq:${seq.sequence_id}`)}>
                  <span class="seq-n">S{seqPos.get(seq.sequence_id)}</span> {seq.sequence_title}{#if sortKey === `seq:${seq.sequence_id}`}<SortMark dir={sortDir} />{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each visibleStudents as s (s.user_id)}
            {@const off = s.user_is_disabled || s.group_is_disabled}
            <tr>
              <th scope="row" class="sticky-name">
                <span class="pg-name" class:off>{s.full_name ?? s.email}</span>
                {#if s.user_is_disabled}<span class="chip-disabled">disabled</span>{/if}
              </th>
              <td class="sticky-group">
                {s.group_name ?? '—'}
                {#if s.group_is_disabled}<span class="chip-disabled">disabled</span>{/if}
              </td>
              {#each data.sequences as seq, i (seq.sequence_id)}
                <td class="cell" style={cellInlineStyle(s, i, mode)}>
                  <button class="cell-btn"
                          onclick={() => openPanel(s.user_id, seq.sequence_id)}
                          aria-label={cellAriaLabel(s, seq, i, mode)}>
                    {cellText(s, i, mode)}
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
          {#if visibleStudents.length === 0}
            <tr><td colspan={data.sequences.length + 2} class="empty">
              {data.students.length === 0
                ? 'No students enrolled in this run.'
                : 'No matches for current filters.'}
            </td></tr>
          {/if}
        </tbody>
      </table>
    </div>
    {/if}

    {#if panelOpen && panelTarget}
      <DashboardSidePanel
        target={{ kind: 'progress', runId, ...panelTarget }}
        onClose={closePanel}
        {isAdmin}
        {isTeacher}
        onRefetch={() => {}}
      />
    {/if}
  {/if}
</div>

<style>
  .pg-note { margin: 0 0 10px; font-size: 12.5px; color: var(--muted); }
  .pg-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
  .pg-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }

  .seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; }
  .seg-btn {
    height: var(--control-h-sm);
    padding: 0 12px;
    background: var(--surface);
    color: var(--text-2);
    border: 0;
    font: inherit;
    font-size: var(--control-font);
    cursor: pointer;
  }
  .seg-btn + .seg-btn { border-left: 1px solid var(--border-strong); }
  .seg-btn[aria-pressed='true'] { background: var(--primary-soft); color: var(--primary); font-weight: 600; }

  .pg-control {
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }
  .pg-search { width: 220px; }

  .heat-legend { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
  .hl-bar { display: inline-flex; border: 1px solid var(--border); border-radius: 3px; overflow: hidden; }
  .hl-sw { width: 18px; height: 12px; }
  .hl-sw.s0 { background: var(--surface-muted); }
  .hl-sw.s1 { background: var(--heat-1); }
  .hl-sw.s2 { background: var(--heat-2); }
  .hl-sw.s3 { background: var(--heat-3); }
  .hl-sw.s4 { background: var(--heat-4); }

  .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .progress-grid { border-collapse: separate; border-spacing: 0; min-width: 100%; }
  .progress-grid th, .progress-grid td { padding: 0; border-bottom: 1px solid var(--border-soft); text-align: left; }
  .progress-grid thead th { background: var(--surface-2); color: var(--text-3); font-size: 12px; font-weight: 600; }
  .progress-grid th button { padding: 8px 12px; }
  .sticky-name {
    position: sticky;
    left: 0;
    width: 14rem;
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
    z-index: 2;
  }
  .sticky-group {
    position: sticky;
    left: 14rem;
    width: 6rem;
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
    z-index: 2;
  }
  tbody .sticky-name, tbody .sticky-group { padding: 6px 12px; font-size: 13px; font-weight: 400; color: var(--text); }
  .block-header, .seq-header { position: sticky; top: 0; z-index: 1; }
  .block-row .sticky-name, .block-row .sticky-group { top: 0; z-index: 3; }
  .block-header {
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .seq-header { font-weight: 500; }
  .seq-n { font-family: var(--font-mono); }

  .pg-name.off { font-style: italic; color: var(--muted); }
  .chip-disabled {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-style: normal;
    vertical-align: middle;
  }

  .cell-btn, .progress-grid th button {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: inherit;
    width: 100%;
    height: 100%;
  }
  .cell-btn { padding: 6px 12px; font-family: var(--font-mono); font-size: 11.5px; }
  .cell { background: var(--cell-bg, none); color: var(--heat-fg); }
  .empty { color: var(--muted); padding: 1rem; text-align: center; }
</style>
```

In `src/pages/runs/RunDetailPage.svelte` change the Progress branch to `<RunProgressTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} blocks={blocks ?? []} />`.

- [ ] **Step 5: Run the tests to see them pass**

Run: same command as Step 2, plus `src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts`.
Expected: PASS.

- [ ] **Step 6: Gate rows**

In section (aj): add `src/components/runs/RunProgressTab.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1524`, and append:

```zsh
# Progress: five heat steps replace the hsl() sweep; no opacity on disabled rows.
if grep -q 'hsl(' src/components/runs/RunProgressTab.svelte; then
  echo "FAIL  RunProgressTab still contains hsl("; fail=1
else
  echo "PASS  RunProgressTab has no hsl( (6a heatmap)"
fi
if grep -q 'disabled-row' src/components/runs/RunProgressTab.svelte; then
  echo "FAIL  RunProgressTab still has a .disabled-row rule"; fail=1
else
  echo "PASS  RunProgressTab has no .disabled-row (6a)"
fi
own heat-legend RunProgressTab.svelte
uniq1 heat-legend
if [[ -n $REPLY ]]; then
  N=RunProgressTab; H=$REPLY
  d '\.hl-sw\.s0' '' 'background:var\(--surface-muted\)'
  d '\.hl-sw\.s1' '' 'background:var\(--heat-1\)'
  d '\.hl-sw\.s2' '' 'background:var\(--heat-2\)'
  d '\.hl-sw\.s3' '' 'background:var\(--heat-3\)'
  d '\.hl-sw\.s4' '' 'background:var\(--heat-4\)'
  d '\.cell' '' 'background:var\(--cell-bg, ?none\)' 'color:var\(--heat-fg\)'
  d '\.block-header' '' 'font-family:var\(--font-mono\)' 'text-transform:uppercase'
  d '\.chip-disabled' '' 'background:var\(--state-disabled-bg\)' 'color:var\(--state-disabled-fg\)'
  sweep RunProgressTab $H
fi
```

Count: 1 + 1 + 1 + 1 + 5 + 2 + 2 + 2 + 2 = 17 → 1524.

`.chip-disabled` is also authored in T8 (Submissions); `d` anchors on this component's hash, so the two do not collide. `own` is not used for it.

- [ ] **Step 7: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1524 checks)`.

- [ ] **Step 8: Screenshots, lanes, commit, ledger**

Screenshots: run 8 `?tab=progress` as `dev@mathion.test`, Coverage and Quiz, and a narrow (~1000px) width scrolled sideways. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/runs/RunProgressTab.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunProgressTab.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(runs): Progress restyled (2d) — five-step heatmap with a legend, B/S numbers by position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Submissions (9a, §Submissions, R8, R13)

**Files:**
- Modify: `src/components/runs/RunSubmissionTab.svelte` (imports, props, `formatCountsLine`, the controls and `<thead>`, the row markup, `<style>`)
- Modify: `src/pages/runs/RunDetailPage.svelte` (the Submissions branch passes `blocks`)
- Test (modify): `src/tests/RunSubmissionTab.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1524 → 1532)

**Interfaces:**
- Consumes: T2 `STATUS_SHORT_LABEL`, `StatusBadge` `label`, `blockPositions`, `SortMark`, `IconButton` glyphs `refresh` / `download` + `data-action`, `ErrorState`.
- Produces: `RunSubmissionTab` accepts `blocks?: BlockResponse[]` (default `[]`). `RunDetailPage` passes `blocks={blocks ?? []}`. The root keeps `data-test="run-submission-tab"` and `data-can-write` (T5's TD1 tests read them).

- [ ] **Step 1: Update and add the Submissions tests (they fail)**

In `src/tests/RunSubmissionTab.svelte.test.ts`:

1. Change the import `import { STATUS_LABEL } from '../lib/dashboards';` to `import { STATUS_LABEL, STATUS_SHORT_LABEL } from '../lib/dashboards';`. Change `mountTab` to accept props:

```ts
function mountTab(runId = 1, extraProps: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(RunSubmissionTab, { target: host, props: { runId, ...extraProps } });
  flushSync();
  return host;
}
const BLOCKS = [
  { id: 5, version_id: 1, title: 'Vectors', slug: 'v', order: 1, info: '', info_html: '' },
  { id: 6, version_id: 1, title: 'Matrices', slug: 'm', order: 4, info: '', info_html: '' },
];
```

2. In `'status badge rendering: each of 5 statuses appears correctly in the grid'` change `STATUS_LABEL[status]` to `STATUS_SHORT_LABEL[status]` and add after the loop:

```ts
    expect(Array.from(badges).map((b) => b.textContent?.trim()).sort())
      .toEqual(['accepted', 'awaiting eval', 'needs revision', 'not submitted', 'rejected']);
```

3. Replace `'per-MP counts row renders formatCountsLine output (skip-zero rule)'` with:

```ts
  it('column header: the block title, then "B{n} · parts" with zero parts and "N groups" omitted (R8, R13)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab(1, { blocks: BLOCKS });
    await settle();
    const heads = Array.from(host.querySelectorAll('th.mp-head'));
    expect(heads.map((th) => th.querySelector('button')?.textContent?.trim())).toEqual(['B1', 'B2']);
    // MP1: 1 not submitted + 1 accepted → nothing to count → bare "B1"
    // MP2: 1 awaiting + 1 revision
    expect(heads.map((th) => th.querySelector('.mp-line2')?.textContent?.trim()))
      .toEqual(['B1', 'B2 · 1 awaiting · 1 revision']);
    expect(host.textContent).not.toMatch(/\d groups/);
  });

  it('every in-scope group not submitted reads "B{n} · no submissions"', async () => {
    const body = submissionMock();
    (body.mini_projects as Array<Record<string, unknown>>)[1] = {
      ...(body.mini_projects as Array<Record<string, unknown>>)[1],
      groups: [
        { group_id: 1, group_name: 'G1', group_is_disabled: false, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
        { group_id: 2, group_name: 'G2', group_is_disabled: false, status: 'not_submitted', latest_submission: null, latest_evaluation: null },
      ],
      counts: { total_groups: 2, not_submitted: 2, awaiting_eval: 0, needs_revision: 0, accepted: 0, rejected: 0 },
    };
    vi.stubGlobal('fetch', mockFetch(200, body));
    mountTab(1, { blocks: BLOCKS });
    await settle();
    expect(host.querySelectorAll('.mp-line2')[1]!.textContent?.trim()).toBe('B2 · no submissions');
  });

  it('a block missing from `blocks` drops the "B{n}" prefix', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    expect(Array.from(host.querySelectorAll('.mp-line2')).map((l) => l.textContent?.trim()))
      .toEqual(['', '1 awaiting · 1 revision']);
  });

  it('the cell aria-label names the group and the block title, with the full status label', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab(1, { blocks: BLOCKS });
    await settle();
    const btn = host.querySelector('.status-cell-btn') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe(`G1, B1: ${STATUS_LABEL.not_submitted}`);
  });

  it('toolbar: refresh and download are icon buttons; sort marks are SortMark', async () => {
    vi.stubGlobal('fetch', mockFetch(200, submissionMock()));
    mountTab();
    await settle();
    expect((host.querySelector('button[aria-label="Refresh"]') as HTMLElement).getAttribute('data-glyph')).toBe('refresh');
    const csv = host.querySelector('button[data-action="download-csv"]') as HTMLElement;
    expect(csv.getAttribute('data-glyph')).toBe('download');
    expect(csv.getAttribute('title')).toBe('Download CSV');
    expect(host.querySelector('thead svg.sort-mark')?.getAttribute('data-dir')).toBe('asc');
    expect(host.querySelector('thead')?.textContent).not.toMatch(/[▲▼]/);
  });
```

4. Replace `'disabled group: row has disabled-row class and badge-muted "disabled" label'`'s last four lines (from `const row = …`) with:

```ts
    expect(host.querySelector('tr.disabled-row')).toBeNull();
    const th = host.querySelector('tbody th') as HTMLElement;
    expect(th.querySelector('.g-name')?.classList.contains('off')).toBe(true);
    expect(th.querySelector('.chip-disabled')?.textContent?.trim()).toBe('disabled');
```

and rename it `'disabled group: muted name and a "disabled" chip; no opacity row class'`.

5. The MP sort headers now show the block title, not `mp.title`. Change exactly these lookups:
   - :248 and :595 and :624 — `includes('Block 2')` → `includes('B2')` (that MP's `block_title` is `'B2'`);
   - :676 — `includes('MP1')` → `includes('B1')`;
   - :693 — `includes('MP99')` → `includes('B99')`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunSubmissionTab.svelte.test.ts`
Expected: FAIL — the changed and new tests fail; the rest pass.

- [ ] **Step 3: Script changes**

In `src/components/runs/RunSubmissionTab.svelte`:

1. Imports become:

```ts
  import { getMiniProjectsDashboard, STATUS_LABEL, STATUS_SHORT_LABEL, STATUS_PRIORITY,
           type DashboardMiniProjectsResponse, type DashboardMpRow, type DashboardMpGroupEntry }
    from '../../lib/dashboards';
  import { toCSV, downloadCSV, sanitizeTitle } from '../../lib/csvWrite';
  import { blockPositions } from '../../lib/blockNumbers';
  import type { BlockResponse } from '../../lib/types';
  import LoadingPlaceholder from '../ui/LoadingPlaceholder.svelte';
  import ErrorState from '../ui/ErrorState.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SortMark from '../ui/SortMark.svelte';
  import StatusBadge from '../ui/StatusBadge.svelte';
  import DashboardSidePanel from './DashboardSidePanel.svelte';
```

2. Props: add `blocks = [],` and `blocks?: BlockResponse[];`.

3. Replace `formatCountsLine` with:

```ts
  // R8 + R13: "B2 · 3 awaiting · 1 revision · 1 rejected", zero parts omitted;
  // "B2 · no submissions" when every in-scope group is not submitted; bare
  // "B2" when nothing is left to count. No B{n} when the block is not in `blocks`.
  const blockPos = $derived(blockPositions(blocks));
  function line2(mp: DashboardMpRow): string {
    const n = blockPos.get(mp.block_id);
    const parts: string[] = n === undefined ? [] : [`B${n}`];
    const c = mp.counts;
    if (c.total_groups > 0 && c.not_submitted === c.total_groups) {
      parts.push('no submissions');
    } else {
      if (c.awaiting_eval) parts.push(`${c.awaiting_eval} awaiting`);
      if (c.needs_revision) parts.push(`${c.needs_revision} revision`);
      if (c.rejected) parts.push(`${c.rejected} rejected`);
    }
    return parts.join(' · ');
  }
  function sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    return sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  }
```

- [ ] **Step 4: Markup and style**

Replace the error banner block

```svelte
  {#if error}
    <div class="banner banner-error" role="alert">
      {error} <button onclick={refresh}>Retry</button>
    </div>
  {/if}
```

with `{#if error}<ErrorState title="Could not load submissions." message={error} onretry={refresh} />{/if}`.

Replace the `<div class="controls">…</div>` block with:

```svelte
        <div class="sub-toolbar">
          <select class="sub-control" bind:value={groupFilter} aria-label="Filter by group">
            <option value="all">All groups</option>
            {#each uniqueGroups as g (g.group_id)}
              <option value={g.group_id}>{g.group_name}{g.group_is_disabled ? ' (disabled)' : ''}</option>
            {/each}
          </select>
          <div class="sub-right">
            <IconButton glyph="refresh" title="Refresh" onclick={refresh} />
            <IconButton glyph="download" title="Download CSV" data-action="download-csv" onclick={handleDownloadCSV} />
          </div>
        </div>
```

Replace the whole `<thead>…</thead>` with:

```svelte
            <thead>
              <tr>
                <th class="sticky-group" scope="col" aria-sort={sortAria('group')}>
                  <button type="button" onclick={() => toggleSort('group')}>Group{#if sortKey === 'group'}<SortMark dir={sortDir} />{/if}</button>
                </th>
                {#each data.mini_projects as mp (mp.id)}
                  <th class="mp-head" scope="col" aria-sort={sortAria(`mp:${mp.id}`)}>
                    <button type="button" onclick={() => toggleSort(`mp:${mp.id}`)}>{mp.block_title}{#if sortKey === `mp:${mp.id}`}<SortMark dir={sortDir} />{/if}</button>
                    <span class="mp-line2">{line2(mp)}</span>
                  </th>
                {/each}
              </tr>
            </thead>
```

Replace the `<tr class:disabled-row=…>` row's header cell and the cell button with:

```svelte
                <tr>
                  <th scope="row" class="sticky-group">
                    <span class="g-name" class:off={g.group_is_disabled}>{g.group_name}</span>
                    {#if g.group_is_disabled}<span class="chip-disabled">disabled</span>{/if}
                  </th>
                  {#each data.mini_projects as mp (mp.id)}
                    {@const cell = mp.groups.find((x) => x.group_id === g.group_id)}
                    <td class="status-cell">
                      {#if cell}
                        <button class="status-cell-btn"
                                onclick={() => openPanel(mp, cell)}
                                aria-label={`${g.group_name}, ${mp.block_title}: ${STATUS_LABEL[cell.status]}`}>
                          <StatusBadge status={cell.status} label={STATUS_SHORT_LABEL[cell.status]} />
                        </button>
                      {:else}
                        <span aria-label="No data" class="empty-cell">—</span>
                      {/if}
                    </td>
                  {/each}
                </tr>
```

Replace the whole `<style>` with:

```css
<style>
  .sub-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .sub-right { margin-left: auto; display: flex; gap: 6px; }
  .sub-control {
    box-sizing: border-box;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }

  .table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .submission-grid { border-collapse: separate; border-spacing: 0; min-width: 100%; }
  .submission-grid th, .submission-grid td { border-bottom: 1px solid var(--border-soft); text-align: left; }
  .submission-grid thead th { background: var(--surface-2); color: var(--text-3); font-size: 12px; font-weight: 600; padding: 8px 12px; vertical-align: top; }
  .submission-grid th button {
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .sticky-group {
    position: sticky;
    left: 0;
    width: 12rem;
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
    z-index: 2;
  }
  tbody .sticky-group { padding: 8px 12px; font-size: 13px; font-weight: 400; color: var(--text); }
  .mp-head { position: sticky; top: 0; z-index: 1; min-width: 11rem; }
  .mp-line2 { display: block; margin-top: 2px; font-family: var(--font-mono); font-size: 11px; font-weight: 400; color: var(--muted); }

  .g-name.off { color: var(--muted); }
  .chip-disabled {
    display: inline-block;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
    vertical-align: middle;
  }

  .status-cell { padding: 6px 12px; vertical-align: middle; }
  .status-cell-btn { background: none; border: none; padding: 0; cursor: pointer; }
  .empty-cell { color: var(--muted); }
  .empty { color: var(--muted); padding: 1rem; text-align: center; }
  .empty-state { color: var(--muted); padding: 1rem; }
</style>
```

`.submission-grid` and the single top-level `.empty-state` rule stay (gate section (q)).

In `src/pages/runs/RunDetailPage.svelte` change the Submissions branch to `<RunSubmissionTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} blocks={blocks ?? []} />`.

- [ ] **Step 5: Run the tests to see them pass**

Run: same command as Step 2, plus `src/tests/RunDetailPage.svelte.test.ts`.
Expected: PASS.

- [ ] **Step 6: Gate rows**

In section (aj): add `src/components/runs/RunSubmissionTab.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1532`, and append:

```zsh
if grep -q 'disabled-row' src/components/runs/RunSubmissionTab.svelte; then
  echo "FAIL  RunSubmissionTab still has a .disabled-row rule"; fail=1
else
  echo "PASS  RunSubmissionTab has no .disabled-row (6a)"
fi
uniq1 submission-grid
if [[ -n $REPLY ]]; then
  N=RunSubmissionTab; H=$REPLY
  d '\.mp-line2' '' 'font-family:var\(--font-mono\)' 'color:var\(--muted\)'
  d '\.chip-disabled' '' 'background:var\(--state-disabled-bg\)' 'color:var\(--state-disabled-fg\)'
  sweep RunSubmissionTab $H
fi
```

Count: 1 + 1 + 2 + 2 + 2 = 8 → 1532.

- [ ] **Step 7: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1532 checks)`.

- [ ] **Step 8: Screenshots, lanes, commit, ledger**

Screenshots: run 8 `?tab=submissions` as `dev@mathion.test`, plus a mocked disabled group. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/runs/RunSubmissionTab.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunSubmissionTab.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(runs): Submissions restyled (9a) — block-titled columns, short status labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Groups (10c) and Teachers (10d) (§Groups, §Teachers, R5, R11, §Focus)

**Files:**
- Rewrite: `src/components/runs/RunGroupsTab.svelte`, `src/components/runs/RunTeachersTab.svelte`
- Modify: `src/pages/runs/RunDetailPage.svelte` (the Groups branch passes `onGotoOverview`)
- Test (modify): `src/tests/RunGroupsTab.svelte.test.ts`, `src/tests/RunTeachersTab.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1532 → 1554)

**Interfaces:**
- Consumes: T2 `Avatar`, `focusFirst`, `IconButton` `data-action`; T3 `InlineName` (with `aside`), `InlineConfirm` `takeFocus`; T5 `setTab`.
- Produces:
  - `RunGroupsTab` gains `onGotoOverview?: () => void`; `RunDetailPage` passes `onGotoOverview={() => void setTab('overview', { focusTab: true })}`.
  - `RunTeachersTab` props unchanged. Its form keeps `input[name="email"]` and `<form>` submit; the remove button keeps `data-action="remove"`, the confirm `data-action="confirm-remove"`.
  - Groups keeps `data-action="delete-group"` and `"confirm-delete-group"`; new `data-action="toggle-add-group"` and `"rename-group"`.

- [ ] **Step 1: Rewrite the Groups tests (they fail)**

In `src/tests/RunGroupsTab.svelte.test.ts`:

1. Add helpers under `mountTab`:

```ts
const group = (id: number, name: string, student_count = 0) => ({ id, run_id: 10, name, student_count, is_disabled: false });
const byAction = (t: HTMLElement, a: string) => Array.from(t.querySelectorAll(`button[data-action="${a}"]`)) as HTMLButtonElement[];
function type(input: HTMLInputElement, v: string) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}
```

2. Replace `'adds a group via POST'` with:

```ts
  it('the + toggle opens the add row with focus in the field; aria-expanded; Esc returns focus to the toggle', async () => {
    const { target, cmp } = mountTab({});
    await settle();
    const toggle = byAction(target, 'toggle-add-group')[0]!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Add group');
    expect(toggle.getAttribute('data-glyph')).toBe('plus');
    toggle.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Close');
    expect(toggle.getAttribute('data-glyph')).toBe('close');
    key(input, 'Escape');
    await settle();
    expect(target.querySelector('input[aria-label="New group name"]')).toBeNull();
    expect(document.activeElement).toBe(byAction(target, 'toggle-add-group')[0]);
    unmount(cmp);
  });

  it('adds a group via POST; the field comes back empty and focused for the next name', async () => {
    fetchSpy.mockImplementation(() => jres(group(1, 'Alpha')));
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ onRefetchGroups: refetch });
    await settle();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    type(input, ' Alpha ');
    key(input, 'Enter');
    await settle();
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string)).toEqual({ name: 'Alpha' });
    expect(refetch).toHaveBeenCalled();
    const again = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    expect(again.value).toBe('');
    expect(document.activeElement).toBe(again);
    unmount(cmp);
  });

  it('409 on add shows the text under the field; the field stays open', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'dup' }, 409));
    const { target, cmp } = mountTab({});
    await settle();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="New group name"]') as HTMLInputElement;
    type(input, 'Alpha');
    key(input, 'Enter');
    await settle();
    expect(target.querySelector('.in-err')?.textContent).toBe('A group with that name already exists in this run.');
    expect(target.querySelector('input[aria-label="New group name"]')).not.toBeNull();
    unmount(cmp);
  });
```

3. Replace `'disables Delete on group with students; allows on empty'` with:

```ts
  it('🗑 is disabled with its reason when the group has students; rows are named', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta', 3)] });
    await settle();
    const [a, b] = byAction(target, 'delete-group');
    expect(a!.disabled).toBe(false);
    expect(a!.getAttribute('aria-label')).toBe('Delete group Alpha');
    expect(a!.getAttribute('title')).toBe('Delete');
    expect(b!.disabled).toBe(true);
    expect(b!.getAttribute('title')).toBe('Move students out before deleting.');
    expect(byAction(target, 'rename-group')[0]!.getAttribute('aria-label')).toBe('Rename Alpha');
    unmount(cmp);
  });

  it('capacity badge: class per getCapacityClass, mono n/10, title spelled out', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'A'), group(2, 'B', 7), group(3, 'C', 8), group(4, 'D', 10)] });
    await settle();
    const caps = Array.from(target.querySelectorAll('.cap')) as HTMLElement[];
    expect(caps.map((c) => c.className.match(/cap-(empty|ok|warn|full)/)?.[1])).toEqual(['empty', 'ok', 'warn', 'full']);
    expect(caps.map((c) => c.textContent?.trim())).toEqual(['empty', '7/10', '8/10', '10/10']);
    expect(caps[1]!.getAttribute('title')).toBe('7 of 10 students');
    unmount(cmp);
  });
```

4. Keep `'409 with "has students" triggers groups+students refetch'` (it clicks `delete-group`, then `confirm-delete-group`); after `.click()` on `delete-group` replace `flushSync();` with `await settle();`.

5. Replace `'blur commits rename (PATCHes new name, calls refetch)'` and `'Escape reverts rename to original name without PATCH'` with:

```ts
  it('rename: ✎ opens the field with the name; Enter PATCHes; focus returns to ✎', async () => {
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ name: 'AlphaRenamed' });
      return jres(group(1, 'AlphaRenamed'));
    });
    const refetch = vi.fn().mockResolvedValue(undefined);
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')], onRefetchGroups: refetch });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    expect(input.value).toBe('Alpha');
    expect(document.activeElement).toBe(input);
    // the capacity badge keeps its place between the field and ×
    expect(input.parentElement!.querySelector('.cap')).not.toBeNull();
    expect(byAction(target, 'delete-group')).toHaveLength(0);
    type(input, 'AlphaRenamed');
    key(input, 'Enter');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalled();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    expect(document.activeElement).toBe(byAction(target, 'rename-group')[0]);
    unmount(cmp);
  });

  it('rename: Esc cancels without a request; unchanged closes without a request; nothing saves on blur', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    let input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    type(input, 'Other');
    input.dispatchEvent(new Event('blur'));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    key(input, 'Escape');
    await settle();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    key(input, 'Enter');
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    unmount(cmp);
  });

  it('rename: a failure keeps the field open with the error', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Name taken' }, 409));
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    const input = target.querySelector('input[aria-label="Group name"]') as HTMLInputElement;
    type(input, 'Beta');
    key(input, 'Enter');
    await settle();
    expect(target.querySelector('input[aria-label="Group name"]')).not.toBeNull();
    expect(target.querySelector('.in-err')?.textContent).toBe('Name taken');
    unmount(cmp);
  });

  it('one editor at a time: opening the add row closes an open rename, and the reverse', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    byAction(target, 'rename-group')[0]!.click();
    flushSync();
    byAction(target, 'toggle-add-group')[0]!.click();
    flushSync();
    expect(target.querySelector('input[aria-label="Group name"]')).toBeNull();
    expect(target.querySelector('input[aria-label="New group name"]')).not.toBeNull();
    byAction(target, 'rename-group')[1]!.click();
    flushSync();
    expect(target.querySelector('input[aria-label="New group name"]')).toBeNull();
    expect((target.querySelector('input[aria-label="Group name"]') as HTMLInputElement).value).toBe('Beta');
    unmount(cmp);
  });

  it('🗑 → confirm takes focus; Cancel returns focus to the 🗑', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha')] });
    await settle();
    byAction(target, 'delete-group')[0]!.click();
    await settle();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(byAction(target, 'delete-group')[0]);
    unmount(cmp);
  });

  it('deleting the last group moves focus to the + toggle (Review Focus 3)', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    const props = $state({
      runId: 10, groups: [group(1, 'Alpha')], groupsEnabled: true,
      onRefetchGroups: async () => { props.groups = []; },
      onRefetchGroupsAndStudents: vi.fn().mockResolvedValue(undefined),
      course: baseCourse, runIsPublished: false,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunGroupsTab, { target, props });
    await settle();
    byAction(target, 'delete-group')[0]!.click();
    await settle();
    byAction(target, 'confirm-delete-group')[0]!.click();
    await settle();
    await settle();
    expect(target.textContent).toContain('No groups yet.');
    expect(document.activeElement).toBe(byAction(target, 'toggle-add-group')[0]);
    unmount(cmp);
  });

  it('h2 "Groups" with a mono count', async () => {
    const { target, cmp } = mountTab({ groups: [group(1, 'Alpha'), group(2, 'Beta')] });
    await settle();
    const h2 = target.querySelector('h2') as HTMLElement;
    expect(h2.textContent?.replace(/\s+/g, ' ').trim()).toBe('Groups 2');
    expect(h2.getAttribute('tabindex')).toBe('-1');
    unmount(cmp);
  });
```

6. In `describe('RunGroupsTab — disabled placeholder 3-branch …')`:
   - change `'Enable in Overview → Settings to manage groups.'` to `'Enable in Overview › Settings to manage groups.'` (P7);
   - add to each of the first two tests (`!runIsPublished` and `runIsPublished + admin`), before `unmount`:

```ts
    const link = target.querySelector('button[data-action="goto-overview"]') as HTMLButtonElement;
    expect(link.textContent).toBe('Overview');
```

   - add to the third (teacher) test: `expect(target.querySelector('button[data-action="goto-overview"]')).toBeNull();`
   - append a test:

```ts
  it('the card has the "Groups disabled for this run" strip; the Overview link calls onGotoOverview', async () => {
    const onGotoOverview = vi.fn();
    const { target, cmp } = mountTab({ groupsEnabled: false, runIsPublished: false, onGotoOverview });
    await settle();
    expect(target.querySelector('.go-head')?.textContent?.trim()).toBe('Groups disabled for this run');
    (target.querySelector('button[data-action="goto-overview"]') as HTMLButtonElement).click();
    expect(onGotoOverview).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });
```

7. Replace the body of `'group CRUD section renders for teacher (course.is_admin=false)'` after `await settle();` with:

```ts
    expect(byAction(target, 'toggle-add-group')).toHaveLength(1);
    expect(target.querySelector('.g-name')?.textContent).toBe('Alpha');
    expect(byAction(target, 'rename-group')).toHaveLength(1);
    expect(byAction(target, 'delete-group')).toHaveLength(1);
    unmount(cmp);
```

- [ ] **Step 2: Update the Teachers tests (they fail)**

In `src/tests/RunTeachersTab.svelte.test.ts`:

1. Every `'(invited)'` expectation (:60, :105) becomes `expect(target.querySelector('.chip-invited')?.textContent?.trim()).toBe('invited');`.
2. In `'removes teacher with inline confirm'`, replace the `flushSync();` after the `remove` click with `await settle();`.
3. Append inside `describe('RunTeachersTab', …)`:

```ts
  const tA: RunTeacherResponse = { id: 1, run_id: 10, user_id: 1, user_email: 'a@x.com', user_full_name: 'Ann', created_at: '2026-05-22T00:00:00Z' };
  const tB: RunTeacherResponse = { id: 2, run_id: 10, user_id: 2, user_email: 'b@x.com', user_full_name: null, created_at: '2026-05-21T00:00:00Z' };

  it('rows: avatar (aria-hidden), name or "—" + invited chip, mono email, 🗑 named by email', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [tA, tB], onRefetch: vi.fn(), course: baseCourse } });
    await settle();
    const rows = Array.from(target.querySelectorAll('li.t-row'));
    expect(rows[0]!.querySelector('.avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(rows[0]!.querySelector('.t-name')?.textContent?.trim()).toBe('Ann');
    expect(rows[0]!.querySelector('.t-email')?.textContent?.trim()).toBe('a@x.com');
    expect(rows[1]!.querySelector('.t-name')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('— invited');
    const rm = rows[0]!.querySelector('button[data-action="remove"]') as HTMLButtonElement;
    expect(rm.getAttribute('aria-label')).toBe('Remove a@x.com');
    expect(rm.getAttribute('data-glyph')).toBe('trash');
    expect(target.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Teachers 2');
    unmount(cmp);
  });

  it('the email field does not take focus when the tab opens; it has a hidden label', async () => {
    const before = document.activeElement;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [], onRefetch: vi.fn(), course: baseCourse } });
    await settle();
    expect(document.activeElement).toBe(before);
    const input = target.querySelector('input[name="email"]') as HTMLInputElement;
    expect((target.querySelector(`label[for="${input.id}"]`) as HTMLElement).textContent?.trim()).toBe('Teacher email');
    expect(target.querySelector('button[aria-label="Add teacher"]')?.getAttribute('data-glyph')).toBe('plus');
    unmount(cmp);
  });

  it('after an add the field is cleared and keeps focus', async () => {
    fetchSpy.mockImplementation(() => jres(tA));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props: { runId: 10, teachers: [], onRefetch: vi.fn().mockResolvedValue(undefined), course: baseCourse } });
    await settle();
    const input = target.querySelector('input[name="email"]') as HTMLInputElement;
    input.value = 'a@x.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (target.querySelector('button[aria-label="Add teacher"]') as HTMLButtonElement).click();
    await settle();
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });

  it('after removing the only teacher focus goes to the email field', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    const props = $state({
      runId: 10, teachers: [tA], course: baseCourse,
      onRefetch: async () => { props.teachers = []; },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunTeachersTab, { target, props });
    await settle();
    (target.querySelector('button[data-action="remove"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-remove"]') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('input[name="email"]'));
    unmount(cmp);
  });
```

`jres(null, 204)` relies on `api.ts:64` not reading a 204 body.

- [ ] **Step 3: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunGroupsTab.svelte.test.ts src/tests/RunTeachersTab.svelte.test.ts`
Expected: FAIL — the new and changed tests fail on today's markup.

- [ ] **Step 4: Rewrite RunGroupsTab**

Replace `src/components/runs/RunGroupsTab.svelte` with:

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { createGroup, deleteGroup, getCapacityClass, updateGroup } from '../../lib/runGroups';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import InlineName from '../ui/InlineName.svelte';
  import type { Course, GroupResponse } from '../../lib/types';

  let {
    runId,
    groups,
    groupsEnabled,
    onRefetchGroups,
    onRefetchGroupsAndStudents,
    course,
    runIsPublished,
    onGotoOverview = undefined,
  }: {
    runId: number;
    groups: GroupResponse[];
    groupsEnabled: boolean;
    onRefetchGroups: () => Promise<void>;
    onRefetchGroupsAndStudents: () => Promise<void>;
    course: Course;
    runIsPublished: boolean;
    onGotoOverview?: () => void;
  } = $props();

  // One editor at a time (R11): the add row or one group's rename. Switching
  // drops the open one without saving; nothing registers a dirty guard.
  type Editor = { kind: 'add' } | { kind: 'rename'; id: number } | null;
  let editor = $state<Editor>(null);
  let addKey = $state(0);
  let pendingDelete: number | null = $state(null);

  let headingEl = $state<HTMLElement>();
  let toggleEl = $state<HTMLButtonElement>();
  const pencilEls: Record<number, HTMLButtonElement | undefined> = $state({});
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  const sorted = $derived([...groups].sort((a, b) => a.name.localeCompare(b.name)));
  const addOpen = $derived(editor?.kind === 'add');

  async function closeAdd() {
    editor = null;
    await tick();
    toggleEl?.focus();
  }

  function toggleAdd() {
    if (addOpen) {
      void closeAdd();
      return;
    }
    pendingDelete = null;
    editor = { kind: 'add' };
  }

  async function addGroup(name: string) {
    try {
      await createGroup(runId, name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new Error('A group with that name already exists in this run.');
      }
      throw e;
    }
    await onRefetchGroups();
    addKey += 1; // a fresh, empty, focused field for the next name
  }

  function startRename(id: number) {
    pendingDelete = null;
    editor = { kind: 'rename', id };
  }

  async function endRename(id: number) {
    editor = null;
    await tick();
    pencilEls[id]?.focus();
  }

  async function saveRename(id: number, name: string) {
    await updateGroup(id, { name });
    await onRefetchGroups();
    await endRename(id);
  }

  function askDelete(id: number) {
    editor = null;
    pendingDelete = id;
  }

  async function cancelDelete(id: number) {
    pendingDelete = null;
    await tick();
    trashEls[id]?.focus();
  }

  // §Focus: on success the next row's trash, the previous row's, the + toggle,
  // the h2; on failure this row's trash.
  async function confirmDelete(groupId: number) {
    const idx = sorted.findIndex((g) => g.id === groupId);
    try {
      await deleteGroup(groupId);
      pendingDelete = null;
      await onRefetchGroups();
      await tick();
      const next = sorted[idx];
      const prev = idx > 0 ? sorted[idx - 1] : undefined;
      focusFirst([next && trashEls[next.id], prev && trashEls[prev.id], toggleEl, headingEl]);
    } catch (e) {
      pendingDelete = null;
      if (e instanceof ApiError) {
        const msg = typeof e.detail === 'string' ? e.detail : '';
        pushToast(e.displayMessage, 'error');
        if (e.status === 409 && /students/i.test(msg)) await onRefetchGroupsAndStudents();
        else if (e.status === 409 && /submission/i.test(msg)) await onRefetchGroups();
      }
      await tick();
      trashEls[groupId]?.focus();
    }
  }
</script>

{#snippet overviewLink()}
  {#if onGotoOverview}<button type="button" class="linklike" data-action="goto-overview" onclick={() => onGotoOverview?.()}>Overview</button>{:else}Overview{/if}
{/snippet}

{#snippet cap(g: GroupResponse)}
  {@const n = g.student_count}
  <span class="cap cap-{getCapacityClass(n)}" class:cap-n={n > 0} title="{n} of 10 students">{n === 0 ? 'empty' : `${n}/10`}</span>
{/snippet}

{#if !groupsEnabled}
  <section class="groups-off">
    <p class="go-head">Groups disabled for this run</p>
    <p class="go-body">
      {#if !runIsPublished}
        Groups are disabled for this run. Enable in {@render overviewLink()} › Settings to manage groups.
      {:else if course.is_admin}
        Groups are disabled for this run. Unpublish in {@render overviewLink()} before enabling groups.
      {:else}
        Groups are disabled for this run. Ask a course admin to unpublish the run and enable groups.
      {/if}
    </p>
  </section>
{:else}
  <section class="groups-tab">
    <div class="sec-head">
      <h2 tabindex="-1" bind:this={headingEl}>Groups <span class="sec-count">{groups.length}</span></h2>
      <IconButton glyph={addOpen ? 'close' : 'plus'} primary={!addOpen} size="md"
                  title={addOpen ? 'Close' : 'Add group'} aria-expanded={addOpen}
                  data-action="toggle-add-group" bind:element={toggleEl} onclick={toggleAdd} />
    </div>

    {#if addOpen || sorted.length > 0}
      <ul class="group-list">
        {#if addOpen}
          <li class="g-row g-add">
            {#key addKey}
              <InlineName label="New group name" maxlength={80} saveTitle="Add" onSave={addGroup} onCancel={closeAdd} />
            {/key}
          </li>
        {/if}
        {#each sorted as g (g.id)}
          <li class="g-row">
            {#if editor?.kind === 'rename' && editor.id === g.id}
              <InlineName label="Group name" value={g.name} maxlength={80}
                          onSave={(name) => saveRename(g.id, name)} onCancel={() => endRename(g.id)}>
                {#snippet aside()}{@render cap(g)}{/snippet}
              </InlineName>
            {:else}
              <span class="g-name">{g.name}</span>
              {@render cap(g)}
              <span class="g-actions">
                {#if pendingDelete === g.id}
                  <InlineConfirm takeFocus confirmLabel="Confirm Delete" confirmDataAction="confirm-delete-group"
                                 onConfirm={() => confirmDelete(g.id)} onCancel={() => cancelDelete(g.id)} />
                {:else}
                  <IconButton glyph="pencil" size="sm" title="Rename" aria-label="Rename {g.name}"
                              data-action="rename-group" bind:element={pencilEls[g.id]}
                              onclick={() => startRename(g.id)} />
                  <IconButton glyph="trash" size="sm" danger aria-label="Delete group {g.name}"
                              title={g.student_count > 0 ? 'Move students out before deleting.' : 'Delete'}
                              disabled={g.student_count > 0} data-action="delete-group"
                              bind:element={trashEls[g.id]} onclick={() => askDelete(g.id)} />
                {/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if sorted.length === 0}<p class="empty">No groups yet.</p>{/if}
  </section>
{/if}

<style>
  .groups-tab { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }

  .group-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .g-row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px 12px; border-top: 1px solid var(--border-soft); }
  .g-row:first-child { border-top: 0; }
  .g-name { flex: 1 1 auto; min-width: 0; font-size: 13px; color: var(--text); }
  .g-actions { display: flex; align-items: center; gap: 4px; }

  .cap { padding: 1px 8px; border-radius: var(--radius-pill); font-size: 11.5px; white-space: nowrap; }
  .cap-n { font-family: var(--font-mono); }
  .cap-empty { background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .cap-ok { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .cap-warn { background: var(--status-needs-revision-bg); color: var(--status-needs-revision-fg); }
  .cap-full { background: var(--status-rejected-bg); color: var(--status-rejected-fg); }

  .groups-off { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .go-head {
    margin: 0;
    padding: 8px 12px;
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .go-body { margin: 0; padding: 12px; font-size: 13px; color: var(--text-2); }
  .linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
  .empty { margin: 0; color: var(--muted); font-size: 13px; }
</style>
```

In `src/pages/runs/RunDetailPage.svelte` add `onGotoOverview={() => void setTab('overview', { focusTab: true })}` to the `RunGroupsTab` props.

- [ ] **Step 5: Rewrite RunTeachersTab**

Replace `src/components/runs/RunTeachersTab.svelte` with:

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { addRunTeacher, removeRunTeacher } from '../../lib/runTeachers';
  import { focusFirst } from '../../lib/focusFirst';
  import { pushToast } from '../../stores/toasts.svelte';
  import Avatar from '../ui/Avatar.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, RunTeacherResponse } from '../../lib/types';

  let { runId, teachers, onRefetch, course }: {
    runId: number;
    teachers: RunTeacherResponse[];
    onRefetch: () => Promise<void>;
    course: Course;
  } = $props();

  const uid = $props.id();
  let email = $state('');
  let addError: string | null = $state(null);
  let busy = $state(false);
  let pendingRemove: number | null = $state(null);

  let emailInput = $state<HTMLInputElement>();
  let headingEl = $state<HTMLElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // Newest first: the backend lists by created_at ASC, so a new teacher
  // appears at the top.
  const sortedTeachers = $derived(
    [...teachers].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    addError = null;
    busy = true;
    try {
      await addRunTeacher(runId, email.trim());
      email = '';
      await onRefetch();
      emailInput?.focus();
    } catch (e) {
      if (e instanceof ApiError) {
        addError = e.status === 409 ? 'Teacher already assigned to this run.' : e.displayMessage;
      }
    } finally {
      busy = false;
    }
  }

  async function cancelRemove(userId: number) {
    pendingRemove = null;
    await tick();
    trashEls[userId]?.focus();
  }

  // §Focus: the next row's trash, the previous row's, the email field, the h2.
  async function confirmRemove(userId: number) {
    const idx = sortedTeachers.findIndex((t) => t.user_id === userId);
    try {
      await removeRunTeacher(runId, userId);
      pendingRemove = null;
      await onRefetch();
      await tick();
      const next = sortedTeachers[idx];
      const prev = idx > 0 ? sortedTeachers[idx - 1] : undefined;
      focusFirst([next && trashEls[next.user_id], prev && trashEls[prev.user_id], emailInput, headingEl]);
    } catch (e) {
      pendingRemove = null;
      if (e instanceof ApiError) pushToast(e.displayMessage, 'error');
      await tick();
      trashEls[userId]?.focus();
    }
  }
</script>

<section class="teachers-tab">
  <div class="sec-head">
    <h2 tabindex="-1" bind:this={headingEl}>Teachers <span class="sec-count">{teachers.length}</span></h2>
    {#if course.is_admin}
      <form class="t-add" onsubmit={submit}>
        <label class="vh" for="{uid}-email">Teacher email</label>
        <input
          id="{uid}-email"
          class="t-input"
          name="email"
          type="email"
          maxlength="254"
          placeholder="teacher@example.com"
          aria-invalid={addError ? 'true' : undefined}
          aria-describedby={addError ? `${uid}-err` : undefined}
          bind:this={emailInput}
          bind:value={email}
        />
        <IconButton glyph="plus" primary size="md" type="submit" title="Add teacher" disabled={busy || !email.trim()} />
      </form>
    {/if}
  </div>
  {#if addError}<p class="t-err" id="{uid}-err" role="alert">{addError}</p>{/if}

  {#if teachers.length === 0}
    <p class="empty">No teachers assigned yet{course.is_admin ? '. Add one above.' : '.'}</p>
  {:else}
    <ul class="t-list">
      {#each sortedTeachers as t (t.user_id)}
        <li class="t-row">
          <Avatar />
          <span class="t-who">
            <span class="t-name">{t.user_full_name || '—'}{#if t.user_full_name === null} <span class="chip-invited">invited</span>{/if}</span>
            <span class="t-email">{t.user_email}</span>
          </span>
          {#if course.is_admin}
            <span class="t-actions">
              {#if pendingRemove === t.user_id}
                <InlineConfirm takeFocus confirmLabel="Confirm Remove" confirmDataAction="confirm-remove"
                               onConfirm={() => confirmRemove(t.user_id)} onCancel={() => cancelRemove(t.user_id)} />
              {:else}
                <IconButton glyph="trash" size="sm" danger title="Remove" aria-label="Remove {t.user_email}"
                            data-action="remove" bind:element={trashEls[t.user_id]}
                            onclick={() => (pendingRemove = t.user_id)} />
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .teachers-tab { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }
  .t-add { display: flex; align-items: center; gap: 6px; }
  .t-input {
    box-sizing: border-box;
    width: 260px;
    height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--control-font);
  }
  .t-input[aria-invalid='true'] { border-color: var(--danger); }
  .t-err { margin: 0; font-size: 12px; color: var(--danger); text-align: right; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  .t-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .t-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border-soft); }
  .t-row:first-child { border-top: 0; }
  .t-who { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
  .t-name { font-size: 13px; color: var(--text); }
  .t-email { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
  .chip-invited {
    display: inline-block;
    margin-left: 4px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--state-disabled-bg);
    color: var(--state-disabled-fg);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }
  .t-actions { display: flex; align-items: center; }
  .empty { margin: 0; color: var(--muted); font-size: 13px; }
</style>
```

The old `$effect` that focused the email field on mount is gone (§Teachers).

- [ ] **Step 6: Run the tests to see them pass**

Run: same command as Step 3, plus `src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.tabs.svelte.test.ts`.
Expected: PASS.

- [ ] **Step 7: Gate rows**

In section (aj): add `src/components/runs/RunGroupsTab.svelte src/components/runs/RunTeachersTab.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1554`, and append:

```zsh
own group-list RunGroupsTab.svelte
uniq1 group-list
if [[ -n $REPLY ]]; then
  N=RunGroupsTab; H=$REPLY
  d '\.cap-empty' '' 'background:var\(--status-not-submitted-bg\)' 'color:var\(--status-not-submitted-fg\)'
  d '\.cap-ok' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.cap-warn' '' 'background:var\(--status-needs-revision-bg\)' 'color:var\(--status-needs-revision-fg\)'
  d '\.cap-full' '' 'background:var\(--status-rejected-bg\)' 'color:var\(--status-rejected-fg\)'
  d '\.go-head' '' 'background:var\(--surface-2\)' 'font-family:var\(--font-mono\)' 'text-transform:uppercase'
  sweep RunGroupsTab $H
fi

own t-list RunTeachersTab.svelte
uniq1 t-list
if [[ -n $REPLY ]]; then
  N=RunTeachersTab; H=$REPLY
  d '\.chip-invited' '' 'background:var\(--state-disabled-bg\)' 'color:var\(--state-disabled-fg\)'
  d '\.t-email' '' 'font-family:var\(--font-mono\)'
  sweep RunTeachersTab $H
fi
```

Count: Groups 1 + 1 + 2 + 2 + 2 + 2 + 3 + 2 = 15; Teachers 1 + 1 + 2 + 1 + 2 = 7; total 22 → 1554.

- [ ] **Step 8: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1554 checks)`.

- [ ] **Step 9: Screenshots, lanes, commit, ledger**

Screenshots: run 8 `?tab=groups` (list, add row open, a rename open, a mocked 409 under the field, the disabled card via a mocked `groups_enabled: false`) and `?tab=teachers` as admin and as `teacher@mathion.test`. No real group or teacher is created, renamed or deleted on the dev data: use network mocks for the write requests. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/runs/RunGroupsTab.svelte frontend/src/components/runs/RunTeachersTab.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunGroupsTab.svelte.test.ts frontend/src/tests/RunTeachersTab.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(runs): Groups (10c) and Teachers (10d) restyled — inline names, one editor at a time, focus after row actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Mini-projects (10j) (§Mini-projects, R5, R7, R12, R13, P12)

**Files:**
- Rewrite: `src/components/runs/RunMiniProjectsTab.svelte`
- Test (modify): `src/tests/RunMiniProjectsTab.svelte.test.ts`
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1554 → 1570)

**Interfaces:**
- Consumes: T2 `formatShortDeadline`, `deadlinesHeader`, `blockPositions`, `focusFirst`, `IconButton` `data-action` (glyphs `plus`, `pencil`, `trash`), `Button` `data-action`; T3 `DangerConfirm`, `InlineConfirm` `takeFocus`; T5 already passes `onNavigateToTab={(t) => void setTab(t, { focusTab: true })}`, so the banner links go through `setTab` with no change in `RunDetailPage`.
- Produces: props unchanged. Kept hooks: `button[data-action="new-mp"]`, `tr[data-role="mp-row"]`, `button[data-action="edit"]`, `button[data-action="delete"]`, `button[data-action="confirm-delete"]`, `[data-role="delete-error-banner"]`, `button[data-action="dismiss-delete-error"]`, `button[data-action="nav-overview-groups" | "nav-overview-version" | "nav-overview-publish"]`. The danger panel is T3's (`input[data-role="danger-ack"]`, `button[data-action="force-delete"]`).

**Layout ruling (P20):** the row's ✎ and 🗑 stay visible next to an open plain confirm, as today (`RunMiniProjectsTab.svelte:249-300` renders both), so Cancel returns focus to a 🗑 that never left.

**Cases where + is disabled** (spec: "the plan lists them from the code", `RunMiniProjectsTab.svelte:95-112`), each with today's reason as `title`:
1. groups off and (run unpublished or admin): `Mini-projects require groups. Enable groups on Overview.`
2. groups off, run published, non-admin: `Mini-projects require groups. Ask a course admin to unpublish the run and enable groups.`
3. version disabled: `This run's course version is disabled.`
4. every block already has a mini-project: `All blocks in this course version already have a mini-project.`

Enabled, its `title` is `New mini-project`. Its `aria-label` is always `New mini-project`.

- [ ] **Step 1: Update the existing tests (they fail)**

In `src/tests/RunMiniProjectsTab.svelte.test.ts`:

1. Under `const baseCourse …` add:

```ts
const mpBase: MiniProjectResponse = {
  id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
  assignment_md: 'x', assignment_html: '<p>x</p>',
  soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
  is_published: false, first_submitted_at: null,
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
};
const mkMp = (o: Partial<MiniProjectResponse> = {}): MiniProjectResponse => ({ ...mpBase, ...o });
const byAction = (t: HTMLElement, a: string) => t.querySelector(`button[data-action="${a}"]`) as HTMLButtonElement | null;
```

2. In `'actionable banner when versionIsDisabled; [+ New] disabled with tooltip …'`, rename it `'versionIsDisabled (admin): only the "See Overview" line; [+ New] disabled with tooltip (R7)'` and replace
   `expect(target.textContent).toContain("This run's course version is disabled");`
   with
   ```ts
    // R7: the frame shows the version banner once; the tab keeps only the admin's link.
    expect(target.textContent).not.toContain("This run's course version is disabled");
    expect(target.querySelector('.mp-note button[data-action="nav-overview-version"]')?.textContent).toBe('See Overview');
   ```

3. Replace the whole test `'MP rows sorted by block.order asc; status pill mapping'` with:

```ts
  it('rows sorted by block position, "Block {n} — title" (R13); lowercase state chips; locked ✎ disabled with its reason', async () => {
    const mps = [
      mkMp({ id: 2, block_id: 2, is_published: true }),
      mkMp({ id: 1, block_id: 1, first_submitted_at: '2026-05-22T00:00:00Z' }),
    ];
    const { target } = mountMpTab({ miniProjects: mps });
    await settle();
    const rows = Array.from(target.querySelectorAll('tr[data-role="mp-row"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.mp-block')?.textContent).toBe('Block 1 — Intro');
    expect(rows[0].querySelector('.mp-chip')?.textContent).toBe('locked');
    expect(rows[1].querySelector('.mp-block')?.textContent).toBe('Block 2 — Theory');
    expect(rows[1].querySelector('.mp-chip')?.textContent).toBe('published');
    const lockedEdit = rows[0].querySelector('button[data-action="edit"]') as HTMLButtonElement;
    expect(lockedEdit.disabled).toBe(true);
    expect(lockedEdit.getAttribute('title')).toBe('Has submissions — editing is off');
    expect(lockedEdit.getAttribute('aria-label')).toBe('Edit mini-project for Block 1');
    // Modal-only publish (spec line 553): no row-level Publish button on any state.
    expect(rows[0].querySelector('button[data-action="publish"]')).toBeNull();
    expect(rows[1].querySelector('button[data-action="publish"]')).toBeNull();
  });
```

4. Replace every `'button.danger'` with `'button[data-action="force-delete"]'` (two places: `'409 on non-locked delete …'` and `'force-delete fails (5xx) …'`).

5. Replace the whole test `'teacher + locked MP: no Delete × button rendered for that row, no force-confirm UI'` with:

```ts
  it('teacher + locked MP: 🗑 opens the danger panel with Force delete disabled and its reason (R5)', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [lockedMp],
    });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    expect(target.textContent).toContain('Force delete will permanently remove');
    const force = byAction(target, 'force-delete')!;
    expect(force.disabled).toBe(true);
    expect(force.getAttribute('title')).toBe('Only a course admin can force delete.');
  });
```

6. In `'teacher + versionIsDisabled: "See Overview" link NOT rendered, banner text IS'`, rename it `'teacher + versionIsDisabled: no version line at all (R7)'` and change `toContain("This run's course version is disabled")` to `not.toContain("This run's course version is disabled")`.

7. In `'teacher: 409-race transition …'` change `'.force-confirm'` to `'.danger-confirm'`.

8. Replace the whole test `'teacher: external rowStatus flip to locked while deleteConfirmId is set …'` with (same setup, new expectations):

```ts
  it('teacher: a row that turns locked while its confirm is open swaps to the danger panel with Force delete disabled', async () => {
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const unlocked = mkMp({ is_published: true });
    const locked = mkMp({ is_published: true, first_submitted_at: '2026-04-15T10:00:00Z' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks: localBlocks,
      miniProjects: [unlocked],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
      course: { ...baseCourse, is_admin: false },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    expect(byAction(target, 'confirm-delete')).not.toBeNull();
    propsRef.miniProjects = [locked];
    await settle();
    expect(byAction(target, 'confirm-delete')).toBeNull();
    expect(byAction(target, 'force-delete')!.disabled).toBe(true);
    unmount(cmp);
  });
```

- [ ] **Step 2: Add the 6a tests (they fail)**

Append to the file:

```ts
describe('RunMiniProjectsTab — 6a restyle', () => {
  it('header: h2 with the mono "N of M blocks" count; + is an icon button named "New mini-project"', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp()] });
    await settle();
    const h2 = target.querySelector('h2') as HTMLElement;
    expect(h2.textContent?.replace(/\s+/g, ' ').trim()).toBe('Mini-projects 1 of 2 blocks');
    expect(h2.getAttribute('tabindex')).toBe('-1');
    const plus = byAction(target, 'new-mp')!;
    expect(plus.getAttribute('data-glyph')).toBe('plus');
    expect(plus.getAttribute('aria-label')).toBe('New mini-project');
    expect(plus.getAttribute('title')).toBe('New mini-project');
  });

  it('the count takes its singular at one block', async () => {
    const { target } = mountMpTab({ blocks: [blocks[0]!], miniProjects: [mkMp()] });
    await settle();
    expect(target.querySelector('.sec-count')?.textContent).toBe('1 of 1 block');
  });

  it('"Block {n}" follows list position, not the stored order (R13)', async () => {
    const gapBlocks: BlockResponse[] = [
      { id: 5, version_id: 7, title: 'Vectors', slug: 'v', order: 1, info: '', info_html: '' },
      { id: 9, version_id: 7, title: 'Matrices', slug: 'm', order: 3, info: '', info_html: '' },
    ];
    const { target } = mountMpTab({ blocks: gapBlocks, miniProjects: [mkMp({ id: 1, block_id: 9 }), mkMp({ id: 2, block_id: 5 })] });
    await settle();
    expect(Array.from(target.querySelectorAll('.mp-block')).map((c) => c.textContent))
      .toEqual(['Block 1 — Vectors', 'Block 2 — Matrices']);
  });

  it('deadlines: short English form with time; full value in title; zone in the header (R12)', async () => {
    const { target } = mountMpTab({
      miniProjects: [mkMp({ soft_deadline: '2026-08-07T21:59:00Z', hard_deadline: '2026-08-14T21:59:00Z' })],
    });
    await settle();
    const parts = Array.from(target.querySelectorAll('.mp-dl .dl')) as HTMLElement[];
    expect(parts.map((p) => p.textContent)).toEqual(['soft 07 Aug 23:59', 'hard 14 Aug 23:59']);
    expect(parts[0]!.getAttribute('title')).toBe('2026-08-07 23:59 GMT+2');
    expect(target.querySelectorAll('thead th')[1]!.textContent).toBe('Deadlines (GMT+2)');
  });

  it('mixed offsets give "Deadlines (local time)"; each part keeps its own offset (Review Focus 5)', async () => {
    const { target } = mountMpTab({
      miniProjects: [
        mkMp({ id: 1, block_id: 1, soft_deadline: '2026-08-07T21:59:00Z' }),
        mkMp({ id: 2, block_id: 2, resubmission_deadline: '2026-01-10T22:59:00Z' }),
      ],
    });
    await settle();
    expect(target.querySelectorAll('thead th')[1]!.textContent).toBe('Deadlines (local time)');
    const parts = Array.from(target.querySelectorAll('.mp-dl .dl')) as HTMLElement[];
    expect(parts.map((p) => p.textContent)).toEqual(['soft 07 Aug 23:59', 'resub 10 Jan 23:59']);
    expect(parts[0]!.getAttribute('title')).toBe('2026-08-07 23:59 GMT+2');
    expect(parts[1]!.getAttribute('title')).toBe('2026-01-10 23:59 GMT+1');
  });

  it('no deadlines: the header reads "Deadlines"', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp()] });
    await settle();
    expect(target.querySelectorAll('thead th')[1]!.textContent).toBe('Deadlines');
    expect(target.querySelectorAll('.mp-dl .dl')).toHaveLength(0);
  });

  it('a disabled version: ✎ on a draft row is disabled with the version reason', async () => {
    const { target } = mountMpTab({ versionIsDisabled: true, miniProjects: [mkMp()] });
    await settle();
    const edit = byAction(target, 'edit')!;
    expect(edit.disabled).toBe(true);
    expect(edit.getAttribute('title')).toBe("This run's course version is disabled.");
  });

  it('every row shows its 🗑, named by the block', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [mkMp({ id: 1, block_id: 1, first_submitted_at: '2026-05-22T00:00:00Z' }), mkMp({ id: 2, block_id: 2 })],
    });
    await settle();
    const trash = Array.from(target.querySelectorAll('button[data-action="delete"]'));
    expect(trash.map((b) => b.getAttribute('aria-label'))).toEqual(['Delete mini-project for Block 1', 'Delete mini-project for Block 2']);
  });

  it('the danger panel is a full-width row under its row (P12); Cancel returns focus to the 🗑', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp({ first_submitted_at: '2026-05-22T00:00:00Z' })] });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    const panelRow = target.querySelector('tr.mp-panel-row') as HTMLTableRowElement;
    expect(panelRow.previousElementSibling?.getAttribute('data-role')).toBe('mp-row');
    expect(panelRow.querySelector('td')?.getAttribute('colspan')).toBe('4');
    expect(document.activeElement?.getAttribute('data-role')).toBe('danger-ack');
    (Array.from(panelRow.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('tr.mp-panel-row')).toBeNull();
    expect(document.activeElement).toBe(byAction(target, 'delete'));
  });

  it('the plain confirm sits in the actions cell, takes focus, and Cancel returns focus to the 🗑', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp()] });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    expect(byAction(target, 'confirm-delete')!.closest('td')?.classList.contains('mp-actions')).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(byAction(target, 'delete'));
  });

  it('deleting the only mini-project moves focus to +', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks,
      miniProjects: [mkMp()],
      onRefetchMiniProjects: async () => { propsRef.miniProjects = []; },
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    byAction(target, 'confirm-delete')!.click();
    await settle();
    await settle();
    expect(target.textContent).toContain('No mini-projects yet');
    expect(document.activeElement).toBe(byAction(target, 'new-mp'));
    unmount(cmp);
  });

  it('banners: info banners carry their class; the delete error is an alert with Dismiss', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Boom' }, 500));
    const { target } = mountMpTab({ runIsPublished: false, runGroupsEnabled: false, miniProjects: [mkMp()] });
    await settle();
    expect(target.querySelectorAll('.mp-banner:not(.mp-banner-err)')).toHaveLength(2);
    byAction(target, 'delete')!.click();
    await settle();
    byAction(target, 'confirm-delete')!.click();
    await settle();
    const err = target.querySelector('[data-role="delete-error-banner"]') as HTMLElement;
    expect(err.classList.contains('mp-banner-err')).toBe(true);
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('Boom');
    expect(document.activeElement).toBe(byAction(target, 'delete'));
    byAction(target, 'dismiss-delete-error')!.click();
    flushSync();
    expect(target.querySelector('[data-role="delete-error-banner"]')).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunMiniProjectsTab.svelte.test.ts`
Expected: FAIL — the changed and new tests fail on today's list markup (no `tr[data-role="mp-row"]`, no `.mp-block`, no danger panel).

- [ ] **Step 4: Rewrite RunMiniProjectsTab**

Replace `src/components/runs/RunMiniProjectsTab.svelte` with:

```svelte
<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../../lib/api';
  import { deadlinesHeader, formatLocalWithTz, formatShortDeadline } from '../../lib/datetime';
  import { deleteMiniProject } from '../../lib/miniProjects';
  import { blockPositions } from '../../lib/blockNumbers';
  import { focusFirst } from '../../lib/focusFirst';
  import MiniProjectModal from './MiniProjectModal.svelte';
  import Button from '../ui/Button.svelte';
  import DangerConfirm from '../ui/DangerConfirm.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import type { Course, MiniProjectResponse, BlockResponse } from '../../lib/types';

  let {
    runId,
    runIsPublished,
    runGroupsEnabled,
    runEndDate,
    versionIsDisabled,
    pinnedAvailable,
    blocks,
    miniProjects,
    onRefetchMiniProjects,
    onRefetchAssets,
    onNavigateToTab,
    pendingEditTarget,
    onPendingEditConsumed,
    course,
  }: {
    runId: number;
    runIsPublished: boolean;
    runGroupsEnabled: boolean;
    runEndDate: string | null;
    versionIsDisabled: boolean;
    pinnedAvailable: boolean;
    blocks: BlockResponse[];
    miniProjects: MiniProjectResponse[];
    onRefetchMiniProjects: () => Promise<void>;
    onRefetchAssets?: () => Promise<void>;
    onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster' | 'assets') => void;
    pendingEditTarget?: MiniProjectResponse | null;
    onPendingEditConsumed?: () => void;
    course: Course;
  } = $props();

  async function refetchAll(): Promise<void> {
    await Promise.all([
      onRefetchMiniProjects(),
      onRefetchAssets?.() ?? Promise.resolve(),
    ]);
  }

  type Status = 'draft' | 'published' | 'locked';
  type Row = { mp: MiniProjectResponse; n: number; label: string; aria: string };

  const usedBlockIds = $derived(new Set(miniProjects.map((mp) => mp.block_id)));
  const availableBlocks = $derived(blocks.filter((b) => !usedBlockIds.has(b.id)));
  // R13: "Block {n}" is the block's position in the pinned version. A
  // mini-project whose block is not in the list is not shown (as before).
  const rows = $derived.by((): Row[] => {
    const pos = blockPositions(blocks);
    const out: Row[] = [];
    for (const mp of miniProjects) {
      const block = blocks.find((b) => b.id === mp.block_id);
      const n = pos.get(mp.block_id);
      if (block && n !== undefined) {
        out.push({ mp, n, label: `Block ${n} — ${block.title}`, aria: `mini-project for Block ${n}` });
      }
    }
    return out.sort((a, b) => a.n - b.n);
  });

  function rowStatus(mp: MiniProjectResponse): Status {
    if (mp.first_submitted_at) return 'locked';
    if (mp.is_published) return 'published';
    return 'draft';
  }

  function deadlineParts(mp: MiniProjectResponse): { kind: string; iso: string }[] {
    const parts: { kind: string; iso: string }[] = [];
    if (mp.soft_deadline) parts.push({ kind: 'soft', iso: mp.soft_deadline });
    if (mp.hard_deadline) parts.push({ kind: 'hard', iso: mp.hard_deadline });
    if (mp.resubmission_deadline) parts.push({ kind: 'resub', iso: mp.resubmission_deadline });
    return parts;
  }

  // R12: one zone in the header when every shown deadline shares it.
  const dlHeader = $derived(deadlinesHeader(rows.flatMap((r) => deadlineParts(r.mp).map((p) => p.iso))));

  function editReason(mp: MiniProjectResponse): string | undefined {
    if (rowStatus(mp) === 'locked') return 'Has submissions — editing is off';
    if (versionIsDisabled) return "This run's course version is disabled.";
    return undefined;
  }

  let modalMode = $state<'create' | 'edit' | null>(null);
  let editTarget = $state<MiniProjectResponse | null>(null);
  let deleteConfirmId = $state<number | null>(null);
  let forceBusy = $state(false);
  let deleteError = $state<string | null>(null);

  let headingEl = $state<HTMLElement>();
  let newEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // Parent (RunDetailPage) hands us a MP to open in edit mode when the
  // Assets tab's [Edit] action navigates here. Stale-cascade safe: if the
  // MP is no longer in our local list (refetch dropped it), we skip
  // opening the modal but still fire onPendingEditConsumed so the parent
  // clears the dangling reference. The early-return on null prevents
  // re-entry once the parent clears pendingEditTarget.
  $effect(() => {
    if (!pendingEditTarget) return;
    const target = pendingEditTarget;
    const stillExists = miniProjects.some((mp) => mp.id === target.id);
    if (stillExists) {
      editTarget = target;
      modalMode = 'edit';
    }
    onPendingEditConsumed?.();
  });

  const newDisabled = $derived(
    !runGroupsEnabled || versionIsDisabled || availableBlocks.length === 0,
  );
  // Role-aware tooltip per spec §3.2.4. Teachers viewing a *published* run
  // cannot un-publish or enable groups themselves, so the affordance copy
  // routes them to a course admin; in any other state they (and admins) can
  // act on Overview directly.
  const newDisabledTitle = $derived.by(() => {
    if (!runGroupsEnabled) {
      return (!runIsPublished || course.is_admin)
        ? 'Mini-projects require groups. Enable groups on Overview.'
        : 'Mini-projects require groups. Ask a course admin to unpublish the run and enable groups.';
    }
    if (versionIsDisabled) return "This run's course version is disabled.";
    if (availableBlocks.length === 0)
      return 'All blocks in this course version already have a mini-project.';
    return '';
  });

  async function focusTrash(mpId: number) {
    await tick();
    trashEls[mpId]?.focus();
  }

  // §Focus after a removal: the next row's trash, the previous row's, +, the h2.
  async function focusAfterRemoval(idx: number) {
    await tick();
    const next = rows[idx];
    const prev = idx > 0 ? rows[idx - 1] : undefined;
    focusFirst([next && trashEls[next.mp.id], prev && trashEls[prev.mp.id], newEl, headingEl]);
  }

  function cancelDelete(mpId: number) {
    deleteConfirmId = null;
    void focusTrash(mpId);
  }

  async function handleForceDelete(mpId: number) {
    const idx = rows.findIndex((r) => r.mp.id === mpId);
    deleteError = null;
    forceBusy = true;
    try {
      await deleteMiniProject(mpId, { force: true });
      await refetchAll();
      deleteConfirmId = null;
      forceBusy = false;
      await focusAfterRemoval(idx);
    } catch (e) {
      deleteError =
        e instanceof ApiError
          ? e.displayMessage
          : e instanceof Error
            ? e.message
            : 'Force delete failed';
      forceBusy = false;
      await focusTrash(mpId);
    }
  }

  async function handleDeleteConfirm(mp: MiniProjectResponse) {
    const idx = rows.findIndex((r) => r.mp.id === mp.id);
    deleteError = null;
    try {
      await deleteMiniProject(mp.id);
      await refetchAll();
      deleteConfirmId = null;
      await focusAfterRemoval(idx);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          await onRefetchMiniProjects();
          // Teachers cannot force-delete; close the inline-confirm and
          // surface a banner so they see *some* feedback instead of a
          // silent no-op (admins keep the row open so the refetch can
          // reveal the danger panel).
          if (!course.is_admin) {
            deleteConfirmId = null;
            deleteError =
              'This mini-project now has submissions and cannot be deleted. Ask a course admin to force-delete.';
            await focusTrash(mp.id);
          }
        } catch {
          deleteError = 'Could not refresh. Please retry.';
          deleteConfirmId = null;
          await focusTrash(mp.id);
        }
      } else {
        deleteError =
          e instanceof ApiError
            ? e.displayMessage
            : e instanceof Error
              ? e.message
              : 'Delete failed';
        deleteConfirmId = null;
        await focusTrash(mp.id);
      }
    }
  }
</script>

{#snippet forceMessage()}Force delete will permanently remove all submissions and evaluations for this mini-project. This cannot be undone.{/snippet}

{#if !pinnedAvailable}
  <div class="mp-banner mp-banner-err" role="alert">Cannot load — pinned version not found.</div>
{:else}
  <section class="mp-tab">
    <div class="sec-head">
      <h2 tabindex="-1" bind:this={headingEl}>Mini-projects <span class="sec-count">{rows.length} of {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}</span></h2>
      <IconButton glyph="plus" primary size="md" aria-label="New mini-project"
                  title={newDisabled ? newDisabledTitle : 'New mini-project'} disabled={newDisabled}
                  data-action="new-mp" bind:element={newEl} onclick={() => (modalMode = 'create')} />
    </div>

    {#if versionIsDisabled && course.is_admin}
      <p class="mp-note">
        <button type="button" class="linklike" data-action="nav-overview-version" onclick={() => onNavigateToTab('overview')}>See Overview</button>
      </p>
    {/if}
    {#if !runGroupsEnabled}
      <div class="mp-banner">
        Mini-projects require groups.
        {#if !runIsPublished || course.is_admin}
          <button type="button" class="linklike" data-action="nav-overview-groups" onclick={() => onNavigateToTab('overview')}>Enable on Overview</button>
        {/if}
      </div>
    {/if}
    {#if !runIsPublished}
      <div class="mp-banner">
        Run is not yet published.
        {#if course.is_admin}
          <button type="button" class="linklike" data-action="nav-overview-publish" onclick={() => onNavigateToTab('overview')}>Publish on Overview</button>
        {/if}
      </div>
    {/if}
    {#if deleteError}
      <div class="mp-banner mp-banner-err" role="alert" data-role="delete-error-banner">
        <span>{deleteError}</span>
        <Button variant="ghost" data-action="dismiss-delete-error" onclick={() => (deleteError = null)}>Dismiss</Button>
      </div>
    {/if}

    {#if miniProjects.length === 0}
      <p class="mp-empty">
        No mini-projects yet. A mini-project is a PDF assignment that each group submits and you grade.
        <strong>Click + New mini-project to assign one to a block.</strong>
      </p>
    {:else}
      <table class="mp-table">
        <thead>
          <tr>
            <th scope="col">Block</th>
            <th scope="col">{dlHeader}</th>
            <th scope="col">State</th>
            <th scope="col"><span class="vh">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.mp.id)}
            {@const status = rowStatus(r.mp)}
            {@const reason = editReason(r.mp)}
            <tr data-role="mp-row">
              <td class="mp-block">{r.label}</td>
              <td class="mp-dl">
                {#each deadlineParts(r.mp) as p, i (p.kind)}
                  {#if i > 0}<span class="mp-sep" aria-hidden="true">·</span>{/if}
                  <span class="dl" title={formatLocalWithTz(p.iso)}>{p.kind} {formatShortDeadline(p.iso)}</span>
                {/each}
              </td>
              <td><span class="mp-chip chip-{status}">{status}</span></td>
              <td class="mp-actions">
                {#if deleteConfirmId === r.mp.id && status !== 'locked'}
                  <InlineConfirm takeFocus warning="Delete this mini-project?" confirmLabel="Delete"
                                 confirmDataAction="confirm-delete"
                                 onCancel={() => cancelDelete(r.mp.id)} onConfirm={() => handleDeleteConfirm(r.mp)} />
                {/if}
                <span class="row-icons">
                  <IconButton glyph="pencil" size="sm" aria-label="Edit {r.aria}" title={reason ?? 'Edit'}
                              disabled={reason !== undefined} data-action="edit"
                              onclick={() => { editTarget = r.mp; modalMode = 'edit'; }} />
                  <IconButton glyph="trash" size="sm" danger aria-label="Delete {r.aria}" title="Delete"
                              data-action="delete" bind:element={trashEls[r.mp.id]}
                              onclick={() => (deleteConfirmId = r.mp.id)} />
                </span>
              </td>
            </tr>
            {#if deleteConfirmId === r.mp.id && status === 'locked'}
              <tr class="mp-panel-row">
                <td colspan="4">
                  <DangerConfirm message={forceMessage} busy={forceBusy}
                                 disabledReason={course.is_admin ? undefined : 'Only a course admin can force delete.'}
                                 onConfirm={() => handleForceDelete(r.mp.id)} onCancel={() => cancelDelete(r.mp.id)} />
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if modalMode != null}
    <MiniProjectModal
      {runId}
      mode={modalMode}
      initial={editTarget}
      availableBlocks={modalMode === 'create' ? availableBlocks : []}
      currentBlock={editTarget ? (blocks.find((b) => b.id === editTarget!.block_id) ?? null) : null}
      {runIsPublished}
      {versionIsDisabled}
      {runEndDate}
      {course}
      onClose={() => {
        modalMode = null;
        editTarget = null;
      }}
      onSaved={refetchAll}
      {onNavigateToTab}
    />
  {/if}
{/if}

<style>
  .mp-tab { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }

  .mp-note { margin: 0; font-size: 12.5px; color: var(--muted); }
  .mp-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-left: 3px solid var(--primary);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text-2);
  }
  .mp-banner-err {
    justify-content: space-between;
    background: var(--status-rejected-bg);
    border-left-color: var(--danger);
    color: var(--status-rejected-fg);
  }
  .linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
  .mp-empty { margin: 0; font-size: 13px; color: var(--muted); }

  .mp-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); font-size: 13px; }
  .mp-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .mp-table td { padding: 6px 12px; border-top: 1px solid var(--border-soft); color: var(--text); vertical-align: middle; }
  .mp-dl { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-2); white-space: nowrap; }
  .mp-sep { margin: 0 6px; color: var(--faint); }
  .mp-actions { width: 1%; white-space: nowrap; text-align: right; }
  .row-icons { display: inline-flex; gap: 4px; }
  .mp-panel-row td { padding: 0 12px 10px; border-top: 0; }

  .mp-chip { display: inline-block; padding: 1px 8px; border-radius: var(--radius-pill); font-size: 11.5px; }
  .chip-draft { background: var(--state-created-bg); color: var(--state-created-fg); }
  .chip-published { background: var(--state-published-bg); color: var(--state-published-fg); }
  .chip-locked { background: var(--state-archived-bg); color: var(--state-archived-fg); }

  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
```

Note the old `forceCheckbox` state and its reset effect are gone (P9): the panel owns its box, and it unmounts when its row's confirm closes.

- [ ] **Step 5: Run the tests to see them pass**

Run: same command as Step 3, plus `src/tests/RunDetailPage.tabs.svelte.test.ts src/tests/MiniProjectModal.svelte.test.ts`.
Expected: PASS.

- [ ] **Step 6: Gate rows**

In section (aj): add `src/components/runs/RunMiniProjectsTab.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1570`, and append:

```zsh
# Mini-projects: the danger panel is the shared one (P9), no local checkbox.
if grep -qE 'forceCheckbox|force-confirm' src/components/runs/RunMiniProjectsTab.svelte; then
  echo "FAIL  RunMiniProjectsTab still has its own force-confirm panel"; fail=1
else
  echo "PASS  RunMiniProjectsTab uses DangerConfirm (6a)"
fi
own mp-table RunMiniProjectsTab.svelte
uniq1 mp-table
if [[ -n $REPLY ]]; then
  N=RunMiniProjectsTab; H=$REPLY
  d '\.chip-draft' '' 'background:var\(--state-created-bg\)' 'color:var\(--state-created-fg\)'
  d '\.chip-published' '' 'background:var\(--state-published-bg\)' 'color:var\(--state-published-fg\)'
  d '\.chip-locked' '' 'background:var\(--state-archived-bg\)' 'color:var\(--state-archived-fg\)'
  d '\.mp-dl' '' 'font-family:var\(--font-mono\)'
  d '\.mp-banner' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)'
  d '\.mp-banner-err' '' 'background:var\(--status-rejected-bg\)' 'border-left-color:var\(--danger\)'
  sweep RunMiniProjectsTab $H
fi
```

Count: 1 + 1 + 1 + 2 + 2 + 2 + 1 + 2 + 2 + 2 = 16 → 1570.

- [ ] **Step 7: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1570 checks)`.

- [ ] **Step 8: Screenshots, lanes, commit, ledger**

Screenshots: run 8 `?tab=mini-projects` as `dev@mathion.test` and as `teacher@mathion.test`: the table, a plain confirm open, the danger panel open on a locked row (admin armed and unarmed; teacher with Force delete disabled), and the banners via network mocks (`groups_enabled: false`, unpublished run, a mocked 500 on delete). Nothing is deleted on the dev data: mock every DELETE. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/runs/RunMiniProjectsTab.svelte frontend/src/tests/RunMiniProjectsTab.svelte.test.ts frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(runs): Mini-projects (10j) restyled — table, short deadlines with zone, shared danger panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Assets (10i) (§Assets, R4, R5, R13, R14, P9, P10)

**Files:**
- Modify: `src/components/runs/RunAssetsTab.svelte` (props, a few handlers, the whole template and style; the upload / replace / bulk / 404-storm logic is unchanged)
- Modify: `src/pages/runs/RunDetailPage.svelte` (the Assets branch passes `blocks`)
- Test (modify): `src/tests/RunAssetsTab.svelte.test.ts`
- Modify: `docs/backlog/slice5c-constructor-polish-debt.md` (the R13 note)
- Modify: `frontend/scripts/visual-refresh-gate.sh` (section (aj); `EXPECTED_CHECKS` 1570 → 1585)

**Interfaces:**
- Consumes: T2 `blockPositions`, `focusFirst`, `IconButton` glyph `refresh` + `data-action`, `Button` `data-action` + bindable `element`, `SortMark`; T3 `DangerConfirm`, `InlineConfirm` `takeFocus`; T6 `FilterPills`; T5's `onEditMiniProject={(mp) => void setTab('mini-projects', { editTarget: mp, focusTab: true })}` (P10, unchanged here).
- Produces:
  - `RunAssetsTab` gains `blocks?: BlockResponse[]` (default `[]`); `RunDetailPage` passes `blocks={blocks ?? []}`.
  - Kept hooks (T5's tabs test and this file's tests use them): the Uses `button[aria-controls="uses-{id}"]` with `aria-expanded`, the sub-panel `tr#uses-{id}` with an `Edit` button, `button[aria-label="Delete {filename}"]`, `input[data-role="replace"]`, `input[aria-label="Select all"]`, the classes `.run-assets-tab`, `.drag-over`, `.banner`, `.banner-error`, `.sub-panel`, and exactly one top-level `.empty-state` rule.
  - New hooks: `button[data-action="replace"]` (aria-label `Replace {filename}`), `button[data-action="delete-asset"]`, `button[data-action="upload"]`, `tr.danger-row`, `button.uses-chip.uses-on|.uses-off`, `.sp-head`, `.sp-mp`.

**Layout rulings for this task:**
- **P20:** the row's Replace and Delete icons stay visible while a confirm for that row is open, as today (`RunAssetsTab.svelte:774-788`): the existing test "mutual exclusion: opening delete closes an open replace InlineConfirm" clicks Delete while Replace's confirm is open. Focus therefore returns to a control that still exists (spec §Focus step 1).
- The Replace confirm keeps its own markup (its text holds `<code>`), restyled as `.row-confirm`; its Cancel takes focus when it opens and Esc on either button cancels. The single-row plain delete and the plain bulk delete use `InlineConfirm takeFocus` (their text is plain).
- **P21:** the header row (spec "Common to all six") is an `<h2>` "Assets" with the mono file count and `+ Upload` at the right; the filter pills sit under it, then the bulk strip and the table.
- After a successful single delete, focus goes to the next row's Delete, the previous row's, `+ Upload`, then the `<h2>` (§Focus). After a bulk delete, to `+ Upload`. After a failure, to the row's Delete if it is still there, else `+ Upload`.

- [ ] **Step 1: Update the existing tests (they fail)**

In `src/tests/RunAssetsTab.svelte.test.ts`:

1. Extend the type import to `import type { BlockResponse, Course, MiniProjectResponse, RunAssetResponse } from '../lib/types';` and add `blocks: BlockResponse[];` to the `baseProps` overrides type.

2. Under `findAllButtons` add:

```ts
function replaceBtn(): HTMLButtonElement | null {
  return target.querySelector('button[data-action="replace"]');
}
```

3. Replace every `findButton(target, /↻ Replace/)` with `replaceBtn()` (19 places; `findButton` returned the first match, and so does `replaceBtn`).

4. In `'smoke: upload + list + replace UI render identically regardless of course.is_admin'` replace

```ts
      const replaceBtn = Array.from(target2.querySelectorAll('button')).find((b) =>
        /↻ Replace/.test(b.textContent ?? ''),
      );
      expect(uploadBtn).toBeDefined();
      expect(replaceBtn).toBeDefined();
```

with

```ts
      const replace2 = target2.querySelector('button[data-action="replace"]');
      expect(uploadBtn).toBeDefined();
      expect(replace2).not.toBeNull();
```

5. Replace every `data-role="force-confirm"` and every `data-role="bulk-confirm"` with `data-role="danger-ack"` (P9).

6. In `'opens force-confirm view with checkbox + danger button (disabled until checked)'`: the first `expect(danger.disabled).toBe(true);` becomes `expect(danger.getAttribute('aria-disabled')).toBe('true');` (unarmed is `aria-disabled`, not native `disabled`, T3), and after the last `expect(danger.disabled).toBe(false);` add `expect(danger.getAttribute('aria-disabled')).toBeNull();`.

7. In `'admin: Force delete visible, enabled after acknowledge, empty tooltip'`: `expect(danger.disabled).toBe(true);  // gated by checkbox initially` becomes `expect(danger.getAttribute('aria-disabled')).toBe('true');  // gated by checkbox initially`.

   The non-admin tests keep `expect(danger.disabled).toBe(true)`: with `disabledReason` the button is natively disabled.

8. Replace the whole test `'warning aria-describedby points at the warning paragraph id'` with:

```ts
  it('the danger panel is described by its warning', async () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: refAssets, miniProjects: refMps }),
    });
    flushSync();

    findDeleteBtn('ref.pdf').click();
    flushSync();
    const panel = target.querySelector('.danger-confirm') as HTMLElement;
    const id = panel.getAttribute('aria-describedby')!;
    expect(document.getElementById(id)?.textContent).toMatch(/referenced by 1 mini-project/i);
  });
```

9. Replace both

```ts
      const deleteBtn = target.querySelector('button.row-action-delete') as HTMLButtonElement
        ?? findButton(target, /^×$/);
```

with

```ts
      const deleteBtn = target.querySelector('button[aria-label="Delete a.pdf"]') as HTMLButtonElement;
```

(`'switching filter pill clears the error banner'` and the 30-second auto-dismiss test; both mount the single orphan `a.pdf`).

- [ ] **Step 2: Add the 6a tests (they fail)**

Append to the file:

```ts
describe('RunAssetsTab — 6a restyle', () => {
  beforeEach(() => {
    (deleteRunAsset as any).mockReset();
  });

  // Stored orders 2 and 5: block 1 is second in the list (R13).
  const blocks: BlockResponse[] = [
    { id: 4, version_id: 7, title: 'Vectors', slug: 'v', order: 2, info: '', info_html: '' },
    { id: 1, version_id: 7, title: 'Intro', slug: 'i', order: 5, info: '', info_html: '' },
  ];
  const refAsset = { ...mkAsset(1, 'ref.pdf'), is_referenced: true };
  const refMp = mkMp(10, 'MP A', '![](ref.pdf)');

  it('header row: h2 "Assets" with the mono count and a primary + Upload; the filter pills under it', () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'a.pdf')] }) });
    flushSync();
    const h2 = target.querySelector('.sec-head h2') as HTMLElement;
    expect(h2.textContent?.replace(/\s+/g, ' ').trim()).toBe('Assets 1');
    expect(h2.getAttribute('tabindex')).toBe('-1');
    expect(target.querySelector('.sec-head')?.contains(findButton(target, /\+ Upload/))).toBe(true);
    const pills = target.querySelector('.filter-pills[role="group"]') as HTMLElement;
    expect(pills.getAttribute('aria-label')).toBe('Filter assets');
    expect(Array.from(pills.querySelectorAll('button')).map((b) => b.getAttribute('aria-pressed')))
      .toEqual(['true', 'false', 'false']);
    expect(findButton(target, /\+ Upload/)!.getAttribute('data-variant')).toBe('primary');
  });

  it('row actions are icon buttons named by the file (R4)', () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'a.pdf')] }) });
    flushSync();
    const rep = replaceBtn()!;
    expect(rep.getAttribute('data-glyph')).toBe('refresh');
    expect(rep.getAttribute('aria-label')).toBe('Replace a.pdf');
    expect(rep.getAttribute('title')).toBe('Replace');
    const del = target.querySelector('button[aria-label="Delete a.pdf"]') as HTMLButtonElement;
    expect(del.getAttribute('data-glyph')).toBe('trash');
    expect(del.getAttribute('title')).toBe('Delete');
  });

  it('Uses chip colour follows the count; size, date and email are mono', () => {
    component = mount(RunAssetsTab, {
      target,
      props: baseProps({ assets: [mkAsset(1, 'a.pdf'), mkAsset(2, 'b.pdf')], miniProjects: [mkMp(10, 'M', '![](a.pdf)')] }),
    });
    flushSync();
    const chips = Array.from(target.querySelectorAll('button.uses-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['1 use', '0 uses']);
    expect(chips[0]!.classList.contains('uses-on')).toBe(true);
    expect(chips[1]!.classList.contains('uses-off')).toBe(true);
    expect(target.querySelector('tr[data-asset-id="1"]')!.querySelectorAll('td.num')).toHaveLength(3);
  });

  it('only the sorted column carries a sort mark', () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'a.pdf')] }) });
    flushSync();
    expect(target.querySelectorAll('thead .sort-mark')).toHaveLength(1);
    const th = Array.from(target.querySelectorAll('th')).find((t) => t.textContent?.includes('Filename'))!;
    expect(th.querySelector('.sort-mark')?.getAttribute('data-dir')).toBe('asc');
  });

  it('the "used by" sub-panel sits under its row and names "Block {n} — title" by position (R13, R14)', () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'foo.pdf')], miniProjects: [mkMp(10, 'MP A', '![](foo.pdf)')], blocks }) });
    flushSync();
    findButton(target, /1 use$/)!.click();
    flushSync();
    const sub = target.querySelector('#uses-1') as HTMLElement;
    expect(sub.previousElementSibling?.getAttribute('data-asset-id')).toBe('1');
    expect(sub.querySelector('.sp-head')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('foo.pdf — used by');
    expect(sub.querySelector('.sp-mp')?.textContent).toBe('Block 2 — Intro');
  });

  it('a block missing from blocks drops the "Block {n} — " prefix', () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'foo.pdf')], miniProjects: [mkMp(10, 'MP A', '![](foo.pdf)')] }) });
    flushSync();
    findButton(target, /1 use$/)!.click();
    flushSync();
    expect(target.querySelector('.sp-mp')?.textContent).toBe('MP A');
  });

  it('the danger panel is a full-width row under its row; it and the sub-panel never show together (R14)', () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [refAsset], miniProjects: [refMp] }) });
    flushSync();
    const chip = findButton(target, /1 use$/)!;
    chip.click();
    flushSync();
    expect(target.querySelector('#uses-1')).not.toBeNull();
    (target.querySelector('button[aria-label="Delete ref.pdf"]') as HTMLButtonElement).click();
    flushSync();
    expect(target.querySelector('#uses-1')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    const row = target.querySelector('tr.danger-row') as HTMLElement;
    expect(row.previousElementSibling?.getAttribute('data-asset-id')).toBe('1');
    expect(row.querySelector('td')?.getAttribute('colspan')).toBe('7');
    chip.click();
    flushSync();
    expect(target.querySelector('tr.danger-row')).toBeNull();
    expect(target.querySelector('#uses-1')).not.toBeNull();
  });

  it('Cancel on the danger panel returns focus to the row\'s Delete (Review Focus 3)', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [refAsset], miniProjects: [refMp] }) });
    flushSync();
    const del = target.querySelector('button[aria-label="Delete ref.pdf"]') as HTMLButtonElement;
    del.click();
    flushSync();
    expect(document.activeElement?.getAttribute('data-role')).toBe('danger-ack');
    findButton(target, /^Cancel$/)!.click();
    await settle();
    expect(target.querySelector('tr.danger-row')).toBeNull();
    expect(document.activeElement).toBe(del);
  });

  it('the plain delete confirm is in the actions cell and takes focus; Cancel returns focus to Delete', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'a.pdf')] }) });
    flushSync();
    const del = target.querySelector('button[aria-label="Delete a.pdf"]') as HTMLButtonElement;
    del.click();
    flushSync();
    expect(findButton(target, /^Confirm$/)!.closest('td')?.classList.contains('actions-cell')).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(del);
  });

  it('the replace confirm gives Cancel the focus; Cancel and Esc return it to Replace', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'doc.pdf')] }) });
    flushSync();
    replaceBtn()!.click();
    flushSync();
    pickReplaceFile(new File(['N'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(findButton(target, /^Confirm$/)).toBeNull();
    expect(document.activeElement).toBe(replaceBtn());

    replaceBtn()!.click();
    flushSync();
    pickReplaceFile(new File(['N'], 'doc.pdf', { type: 'application/pdf' }));
    await settle();
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(findButton(target, /^Confirm$/)).toBeNull();
    expect(document.activeElement).toBe(replaceBtn());
  });

  it('deleting the only asset moves focus to + Upload', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const box: any = $state({
      ...baseProps({ assets: [mkAsset(1, 'a.pdf')] }),
      onRefetchAssets: async () => { box.assets = []; },
    });
    component = mount(RunAssetsTab, { target, props: box });
    flushSync();
    (target.querySelector('button[aria-label="Delete a.pdf"]') as HTMLButtonElement).click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();
    await settle();
    expect(target.textContent).toMatch(/No assets yet/);
    expect(document.activeElement).toBe(findButton(target, /\+ Upload/));
  });

  it('bulk: a referenced selection puts the danger panel in the strip; Cancel returns focus to "Delete N selected"', async () => {
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [refAsset], miniProjects: [refMp] }) });
    flushSync();
    (target.querySelector('input[aria-label="Select all"]') as HTMLInputElement).click();
    flushSync();
    findButton(target, /Delete 1 selected/i)!.click();
    flushSync();
    expect(target.querySelector('.bulk-strip .danger-confirm')).not.toBeNull();
    findButton(target, /^Cancel$/)!.click();
    await settle();
    expect(document.activeElement).toBe(findButton(target, /Delete 1 selected/i));
  });

  it('the error banner is an alert; the summary banner is a status', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    component = mount(RunAssetsTab, { target, props: baseProps({ assets: [mkAsset(1, 'a.pdf')] }) });
    flushSync();
    const uploadInput = target.querySelector('input[type="file"]:not([data-role])') as HTMLInputElement;
    Object.defineProperty(uploadInput, 'files', { value: [new File(['x'], 'evil.exe')], configurable: true });
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(target.querySelector('.banner-error')?.getAttribute('role')).toBe('alert');
    (target.querySelector('input[aria-label="Select all"]') as HTMLInputElement).click();
    flushSync();
    findButton(target, /Delete 1 selected/i)!.click();
    flushSync();
    findButton(target, /^Confirm$/)!.click();
    await settle();
    expect(target.querySelector('.banner-info')?.getAttribute('role')).toBe('status');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TZ=Europe/Copenhagen npx vitest run src/tests/RunAssetsTab.svelte.test.ts`
Expected: FAIL — `replaceBtn()` finds nothing (no `data-action="replace"`), no `danger-ack`, no `.uses-chip`, no `tr.danger-row`.

- [ ] **Step 4: Change the script of RunAssetsTab**

In `src/components/runs/RunAssetsTab.svelte`, `<script>`:

1. Replace the first import line and the type import with:

```ts
  import { tick, untrack } from 'svelte';
  import type {
    BlockResponse,
    Course,
    MiniProjectResponse,
    RunAssetResponse,
  } from '../../lib/types';
```

   and after the `../../lib/runAssets` import add:

```ts
  import { blockPositions } from '../../lib/blockNumbers';
  import { focusFirst } from '../../lib/focusFirst';
  import Button from '../ui/Button.svelte';
  import DangerConfirm from '../ui/DangerConfirm.svelte';
  import FilterPills from '../ui/FilterPills.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineConfirm from '../ui/InlineConfirm.svelte';
  import SortMark from '../ui/SortMark.svelte';
```

2. Props: add `blocks = [],` after `onReloadRun,` in the destructuring and `blocks?: BlockResponse[];` after `onReloadRun: () => Promise<void>;` in the type.

3. Replace the `OpenConfirm` type (P9: the panel owns its box):

```ts
  type OpenConfirm =
    | { kind: 'replace'; assetId: number; file: File }
    | { kind: 'delete'; assetId: number; isReferenced: boolean }
    | { kind: 'bulk-delete'; orphanCount: number; referencedCount: number };
  let openConfirm = $state<OpenConfirm | null>(null);

  const VERSION_OFF = "This run's course version is disabled.";
  let headingEl = $state<HTMLElement>();
  let uploadEl = $state<HTMLButtonElement>();
  let bulkBtnEl = $state<HTMLButtonElement>();
  const trashEls: Record<number, HTMLButtonElement | undefined> = $state({});
  const replaceEls: Record<number, HTMLButtonElement | undefined> = $state({});

  // The replace or single-delete confirm open on this row, if any.
  function confirmFor(assetId: number) {
    const c = openConfirm;
    return c && c.kind !== 'bulk-delete' && c.assetId === assetId ? c : null;
  }

  async function focusRow(els: Record<number, HTMLButtonElement | undefined>, assetId: number) {
    await tick();
    focusFirst([els[assetId], uploadEl, headingEl]);
  }
```

4. `onReplaceCancel` becomes:

```ts
  function onReplaceCancel(assetId: number): void {
    pendingReplaceAssetId = null;
    openConfirm = null;
    void focusRow(replaceEls, assetId);
  }
```

5. In `openBulkConfirm`, replace the `openConfirm = { … }` assignment with:

```ts
    openConfirm = { kind: 'bulk-delete', orphanCount, referencedCount };
```

6. `cancelBulk` becomes:

```ts
  async function cancelBulk(): Promise<void> {
    if (openConfirm?.kind !== 'bulk-delete') return;
    openConfirm = null;
    await tick();
    bulkBtnEl?.focus();
  }
```

7. In `performBulkDelete`, after `selectedIds = new Set();` add:

```ts
      await tick();
      focusFirst([uploadEl, headingEl]);
```

8. `handleDeleteClick` and `cancelDelete` become (R14: one panel per row):

```ts
  function handleDeleteClick(assetId: number, isReferenced: boolean): void {
    if (versionIsDisabled) return;
    banner = null;
    if (isReferenced && openSubPanelAssetId === assetId) openSubPanelAssetId = null;
    openConfirm = { kind: 'delete', assetId, isReferenced };
  }

  function cancelDelete(assetId: number): void {
    openConfirm = null;
    void focusRow(trashEls, assetId);
  }
```

9. `performDelete`: after `const force = isReferenced;` add `const idx = sortedAssets.findIndex((a) => a.id === assetId);`. In the `catch`, before each of the three exits add the failure focus — i.e. replace the body of the `catch` after the `AbortError` line with:

```ts
      if (err?.status === 403) {
        banner = 'You no longer have permission to force-delete. Refresh and retry.';
        await onReloadRun();
      } else if (err?.status === 404) {
        // Route through the storm coalescer (spec L212/213) — banner +
        // refetch happen at the 500ms flush.
        note404();
      } else {
        banner = err?.message ?? 'Delete failed.';
      }
      await focusRow(trashEls, assetId);
      return;
```

   and after the final refetch (`await onRefetchAssets();` in the `else` of `if (force)`) append, outside the `if/else`:

```ts
    // §Focus: the next row's Delete, the previous row's, + Upload, the h2.
    await tick();
    const next = sortedAssets[idx];
    const prev = idx > 0 ? sortedAssets[idx - 1] : undefined;
    focusFirst([next && trashEls[next.id], prev && trashEls[prev.id], uploadEl, headingEl]);
```

10. `performReplace`: after `openConfirm = null;` add `void focusRow(replaceEls, assetId);` (the confirm's buttons unmount; focus goes back to Replace while the request runs).

11. `toggleSubPanel` becomes (R14):

```ts
  function toggleSubPanel(assetId: number): void {
    const opening = openSubPanelAssetId !== assetId;
    openSubPanelAssetId = opening ? assetId : null;
    const c = confirmFor(assetId);
    if (opening && c?.kind === 'delete' && c.isReferenced) openConfirm = null;
  }
```

12. After `mpById` add (R13; a block missing from `blocks` shows the mini-project's own title):

```ts
  const positions = $derived(blockPositions(blocks));
  function mpLabel(mp: MiniProjectResponse): string {
    const n = positions.get(mp.block_id);
    const block = blocks.find((b) => b.id === mp.block_id);
    return n !== undefined && block ? `Block ${n} — ${block.title}` : mp.title;
  }

  function onReplaceKeydown(e: KeyboardEvent, assetId: number): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onReplaceCancel(assetId);
  }
```

- [ ] **Step 5: Replace the template and the style of RunAssetsTab**

Replace everything from the `<!-- T6-T7 props that T8-T12 … -->` comment to the end of the file (the `{#if false}` block is no longer needed: every prop is used) with:

```svelte
{#snippet sortTh(field: SortField, label: string)}
  <th scope="col" aria-sort={sortField === field ? sortDir : 'none'}>
    <button type="button" class="sort-btn" onclick={() => cycleSort(field)}>{label}{#if sortField === field && sortDir !== 'none'}<SortMark dir={sortDir === 'ascending' ? 'asc' : 'desc'} />{/if}</button>
  </th>
{/snippet}

<section
  class="run-assets-tab"
  class:drag-over={dragOver}
  aria-label="Run assets"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={async (e) => {
    e.preventDefault();
    dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) await performUpload(files);
  }}
>
  <div class="sec-head">
    <h2 tabindex="-1" bind:this={headingEl}>Assets <span class="sec-count">{assets.length}</span></h2>
    <div class="upload-area">
      <Button variant="primary" data-action="upload" disabled={versionIsDisabled}
              title={versionIsDisabled ? VERSION_OFF : undefined} bind:element={uploadEl}
              onclick={handleUploadPicker}>+ Upload</Button>
      <input
        type="file"
        multiple
        bind:this={uploadInputEl}
        onchange={onUploadInputChange}
        style="display:none"
        aria-hidden="true"
      />
      <input
        type="file"
        data-role="replace"
        bind:this={replaceInputEl}
        oncancel={() => { pendingReplaceAssetId = null; }}
        onchange={onReplaceInputChange}
        style="display:none"
        aria-hidden="true"
      />
    </div>
  </div>

  {#if banner}
    <div role="alert" class="banner banner-error">{banner}</div>
  {/if}
  {#if summaryBanner}
    <div role="status" class="banner banner-info">{summaryBanner}</div>
  {/if}

  <FilterPills
    label="Filter assets"
    value={activeFilter}
    onchange={(k) => (activeFilter = k as FilterPill)}
    options={[
      { key: 'all', label: 'All', count: counts.all },
      { key: 'orphan', label: 'Orphan', count: counts.orphan },
      { key: 'referenced', label: 'Referenced', count: counts.referenced },
    ]}
  />

  {#if selectedIds.size > 0}
    <div class="bulk-strip">
      <span class="bulk-n">{selectedIds.size} selected</span>
      {#if openConfirm?.kind === 'bulk-delete'}
        {@const bc = openConfirm}
        {@const total = bc.orphanCount + bc.referencedCount}
        {#if bc.referencedCount > 0}
          {#snippet bulkMessage()}
            Delete {total} selected ({bc.orphanCount} orphan, {bc.referencedCount} referenced)?
            This will break <code>![ref]</code> markdown in {bc.referencedCount} mini-project{bc.referencedCount === 1 ? '' : 's'}.
            This cannot be undone.
          {/snippet}
          <div class="bulk-panel">
            <DangerConfirm
              message={bulkMessage}
              disabledReason={course.is_admin ? undefined : 'Only course admins can force-delete a referenced asset.'}
              onConfirm={performBulkDelete}
              onCancel={() => void cancelBulk()}
            />
          </div>
        {:else}
          <InlineConfirm takeFocus warning="Delete {total} selected ({bc.orphanCount} orphan, {bc.referencedCount} referenced)?"
                         onConfirm={performBulkDelete} onCancel={() => void cancelBulk()} />
        {/if}
      {:else}
        <Button variant="danger" disabled={versionIsDisabled} title={versionIsDisabled ? VERSION_OFF : undefined}
                bind:element={bulkBtnEl} onclick={openBulkConfirm}>Delete {selectedIds.size} selected</Button>
      {/if}
    </div>
  {/if}
  {#if uploadProgress}
    <div role="status" aria-live="polite" class="upload-progress">
      Uploading {uploadProgress.current} of {uploadProgress.total}…
    </div>
  {/if}

  {#if assets.length === 0}
    <div class="empty-state">
      <p>No assets yet. Drop files here or click + Upload.</p>
    </div>
  {:else if sortedAssets.length === 0}
    <div class="empty-state">
      <p>No {activeFilter} assets.</p>
    </div>
  {:else}
    <table class="assets-table">
      <thead>
        <tr>
          <th scope="col" class="col-check">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={sortedAssets.length > 0 && sortedAssets.every((a) => selectedIds.has(a.id))}
              disabled={versionIsDisabled}
              onclick={toggleSelectAll}
            />
          </th>
          {@render sortTh('filename', 'Filename')}
          {@render sortTh('size', 'Size')}
          {@render sortTh('uploaded', 'Uploaded')}
          <th scope="col">Uploaded by</th>
          <th scope="col">Uses</th>
          <th scope="col"><span class="vh">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each sortedAssets as a (a.id)}
          {@const refIds = miniProjects == null ? [] : referencingMpIds(a)}
          {@const subOpen = openSubPanelAssetId === a.id && miniProjects != null}
          {@const rc = confirmFor(a.id)}
          <tr data-asset-id={a.id}>
            <td class="col-check">
              <input
                type="checkbox"
                aria-label="Select {a.filename}"
                checked={selectedIds.has(a.id)}
                disabled={versionIsDisabled}
                onclick={() => toggleRow(a.id)}
              />
            </td>
            <td class="a-name">
              <a href={serveUrl(a.filename)} target="_blank" rel="noopener noreferrer">{a.filename}</a>
            </td>
            <td class="num">{formatFileSize(a.file_size)}</td>
            <td class="num">{formatLocalWithTz(a.uploaded_at)}</td>
            <td class="num">{a.uploaded_by_email ?? '—'}</td>
            <td>
              {#if miniProjects == null}
                —
              {:else}
                <button
                  type="button"
                  class="uses-chip"
                  class:uses-on={refIds.length > 0}
                  class:uses-off={refIds.length === 0}
                  aria-expanded={subOpen}
                  aria-controls="uses-{a.id}"
                  onclick={() => toggleSubPanel(a.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Escape' && subOpen) openSubPanelAssetId = null;
                  }}
                >{refIds.length} use{refIds.length === 1 ? '' : 's'}</button>
              {/if}
            </td>
            <td class="actions-cell">
              {#if rc?.kind === 'replace'}
                <div class="row-confirm" role="group" aria-label="Replace {a.filename}">
                  <p>
                    Replace <code>{a.filename}</code> (new size: {formatFileSize(rc.file.size)})?
                    The current content will be overwritten and cannot be recovered.
                    {#if refIds.length > 0}
                      {refIds.length} mini-project{refIds.length === 1 ? '' : 's'} that reference this file will continue to point at the new content.
                    {/if}
                  </p>
                  <div class="rc-actions">
                    <button type="button" class="rc-confirm" onclick={performReplace} onkeydown={(e) => onReplaceKeydown(e, a.id)}>Confirm</button>
                    <button type="button" class="rc-cancel" use:autoFocus onclick={() => onReplaceCancel(a.id)} onkeydown={(e) => onReplaceKeydown(e, a.id)}>Cancel</button>
                  </div>
                </div>
              {:else if rc?.kind === 'delete' && !rc.isReferenced}
                <InlineConfirm takeFocus warning="Delete this asset?" onConfirm={performDelete} onCancel={() => cancelDelete(a.id)} />
              {/if}
              <span class="row-icons">
                <IconButton glyph="refresh" size="sm" aria-label="Replace {a.filename}"
                            title={versionIsDisabled ? VERSION_OFF : 'Replace'} disabled={versionIsDisabled}
                            data-action="replace" bind:element={replaceEls[a.id]}
                            onclick={() => handleReplaceClick(a.id)} />
                <IconButton glyph="trash" size="sm" danger aria-label="Delete {a.filename}"
                            title={versionIsDisabled ? VERSION_OFF : 'Delete'} disabled={versionIsDisabled}
                            data-action="delete-asset" bind:element={trashEls[a.id]}
                            onclick={() => handleDeleteClick(a.id, a.is_referenced)} />
              </span>
            </td>
          </tr>
          {#if rc?.kind === 'delete' && rc.isReferenced}
            {#snippet rowMessage()}
              {#if miniProjects == null}
                This asset is referenced by other mini-projects.
              {:else}
                This asset is referenced by {refIds.length} mini-project{refIds.length === 1 ? '' : 's'}.
              {/if}
              Deleting it will leave their <code>![ref]</code> markdown broken. This cannot be undone.
            {/snippet}
            <tr class="danger-row">
              <td colspan="7">
                <DangerConfirm
                  message={rowMessage}
                  disabledReason={course.is_admin ? undefined : 'Only course admins can force-delete a referenced asset.'}
                  onConfirm={performDelete}
                  onCancel={() => cancelDelete(a.id)}
                />
              </td>
            </tr>
          {:else if subOpen}
            <tr id="uses-{a.id}" class="sub-panel-row">
              <td colspan="7">
                <div class="sub-panel">
                  <p class="sp-head"><code>{a.filename}</code> — used by</p>
                  <ul>
                    {#each refIds as mpId (mpId)}
                      {@const mp = mpById(mpId)}
                      {#if mp}
                        <li>
                          <span class="sp-mp">{mpLabel(mp)}</span>
                          <button
                            type="button"
                            class="linklike"
                            onclick={() => {
                              openSubPanelAssetId = null;
                              onEditMiniProject(mp);
                            }}
                          >Edit</button>
                        </li>
                      {/if}
                    {/each}
                  </ul>
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .run-assets-tab { display: flex; flex-direction: column; gap: 10px; }
  .run-assets-tab.drag-over .assets-table,
  .run-assets-tab.drag-over .empty-state { outline: 2px dashed var(--primary); outline-offset: 2px; }

  .banner { margin: 0; padding: 8px 12px; border-left: 3px solid; border-radius: var(--radius); font-size: 13px; }
  .banner-error { background: var(--status-rejected-bg); border-left-color: var(--danger); color: var(--status-rejected-fg); }
  .banner-info { background: var(--surface-2); border-left-color: var(--primary); color: var(--text-2); }

  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sec-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .sec-head h2:focus { outline: none; }
  .sec-count { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted); }
  .upload-area { display: flex; align-items: center; gap: 8px; }
  .upload-progress { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }

  .bulk-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .bulk-n { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-2); }
  .bulk-panel { flex: 1 1 100%; }

  .empty-state {
    padding: 24px 12px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .empty-state p { margin: 0; }

  .assets-table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); font-size: 13px; }
  .assets-table th {
    padding: 8px 10px;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .assets-table td { padding: 6px 10px; border-top: 1px solid var(--border-soft); color: var(--text); vertical-align: middle; }
  .col-check { width: 1%; }
  .sort-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0; background: none; border: 0; font: inherit; color: inherit; cursor: pointer; }
  .a-name a { color: var(--primary); text-decoration: none; }
  .a-name a:hover { text-decoration: underline; }
  .num { font-family: var(--font-mono); font-size: 12px; color: var(--text-2); white-space: nowrap; }

  .uses-chip { padding: 1px 8px; border: 0; border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: 11.5px; cursor: pointer; }
  .uses-on { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .uses-off { background: var(--status-not-submitted-bg); color: var(--status-not-submitted-fg); }
  .uses-chip[aria-expanded='true'] { box-shadow: 0 0 0 1px var(--border-strong); }

  .actions-cell { width: 1%; white-space: nowrap; text-align: right; }
  .row-icons { display: inline-flex; gap: 4px; }
  .row-confirm { display: flex; flex-direction: column; gap: 6px; max-width: 360px; margin-bottom: 6px; white-space: normal; text-align: left; font-size: 12.5px; color: var(--text-2); }
  .row-confirm p { margin: 0; }
  .row-confirm code, .sp-head code { font-family: var(--font-mono); }
  .rc-actions { display: flex; gap: 6px; }
  .rc-confirm, .rc-cancel { padding: var(--btn-pad); border-radius: var(--radius); font: inherit; font-size: var(--control-font); cursor: pointer; }
  .rc-confirm { background: var(--primary); color: var(--primary-text); border: 1px solid var(--primary); }
  .rc-cancel { background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); }

  .danger-row td, .sub-panel-row td { padding: 0 10px 10px; border-top: 0; }
  .sub-panel { padding: 8px 12px; background: var(--surface-2); border-radius: var(--radius); }
  .sp-head { margin: 0 0 6px; font-size: 12px; color: var(--muted); }
  .sub-panel ul { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .sub-panel li { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .linklike { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
```

In `src/pages/runs/RunDetailPage.svelte` add `blocks={blocks ?? []}` to the `RunAssetsTab` props.

- [ ] **Step 6: Run the tests to see them pass**

Run: same command as Step 3, plus `src/tests/RunDetailPage.tabs.svelte.test.ts src/tests/RunDetailPage.svelte.test.ts`.
Expected: PASS.

- [ ] **Step 7: The R13 backlog note**

In `docs/backlog/slice5c-constructor-polish-debt.md`, at the end of the item "**Teacher run screens still label blocks "Block {order}"**" (`:158-161`), append the sentence:

```markdown
  Slice 6a numbers blocks by position on the teacher screens (Progress, Submissions, Mini-projects, the Assets "used by" list); `MiniProjectModal` follows in 6b.
```

- [ ] **Step 8: Gate rows**

In section (aj): add `src/components/runs/RunAssetsTab.svelte` to `FILES_6A`, set `EXPECTED_CHECKS=1585`, and append:

```zsh
# Assets: the shared panel, pills and confirms replace the local ones (P9).
if grep -qE 'force-confirm|bulk-confirm|checkboxChecked|filter-pills|inline-confirm' src/components/runs/RunAssetsTab.svelte; then
  echo "FAIL  RunAssetsTab still has its own confirm panel or pills"; fail=1
else
  echo "PASS  RunAssetsTab uses DangerConfirm, InlineConfirm and FilterPills (6a)"
fi
own assets-table RunAssetsTab.svelte
uniq1 assets-table
if [[ -n $REPLY ]]; then
  N=RunAssetsTab; H=$REPLY
  d '\.bulk-strip' '' 'background:var\(--surface-2\)'
  d '\.uses-on' '' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)'
  d '\.uses-off' '' 'background:var\(--status-not-submitted-bg\)' 'color:var\(--status-not-submitted-fg\)'
  d '\.banner-error' '' 'background:var\(--status-rejected-bg\)' 'border-left-color:var\(--danger\)'
  d '\.banner-info' '' 'background:var\(--surface-2\)' 'border-left-color:var\(--primary\)'
  d '\.num' '' 'font-family:var\(--font-mono\)'
  sweep RunAssetsTab $H
fi
```

Count: 1 + 1 + 1 + 1 + 2 + 2 + 2 + 2 + 1 + 2 = 15 → 1585. Section (q)'s `.empty-state` and `.run-assets-tab` checks must stay green (one top-level `.empty-state` rule here, the class `.run-assets-tab` kept).

- [ ] **Step 9: Full verification**

Run the frontend suite, svelte-check and the gate.
Expected: vitest green; svelte-check 0 errors; gate `ALL PASS (1585 checks)`.

- [ ] **Step 10: Screenshots, lanes, commit, ledger**

Screenshots: run 8 `?tab=assets` as `dev@mathion.test` and as `teacher@mathion.test`: the table, a "used by" sub-panel, the danger panel under a referenced row (admin armed/unarmed, teacher disabled), the plain delete confirm, a bulk selection with the danger panel in the strip, and the banners. Nothing is uploaded, replaced or deleted on the dev data: mock every POST/PUT/DELETE. Then the user's OK, the lanes, and:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion && git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts docs/backlog/slice5c-constructor-polish-debt.md frontend/scripts/visual-refresh-gate.sh && git commit -m "feat(runs): Assets (10i) restyled — icon actions, shared danger panel under its row, block numbers by position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After Task 11

- **Whole-branch review** of `e371368..HEAD`: one fresh Opus (high) reviewer and one Fable reviewer, given the spec, this plan, its Review Focus section verbatim and the ledger's `Ruling:` lines. Fix every Critical and Important finding test-first; minors go to the backlog file.
- **Browser pass with the user** (Safari), one step at a time in the terminal, waiting for each answer; the spec's "Carried to the 6a browser pass" list is the script.
- Then 6b (the four modals onto `ui/Modal`). No push, no merge.

