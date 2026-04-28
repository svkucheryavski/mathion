# Phase 7b — Mini-Projects, Submissions, Evaluations

**Date:** 2026-04-27
**Status:** Approved for implementation planning
**Phase:** 7b (builds on 7a, foundation for 7c dashboards)
**Parent specs:**
- `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` (sections 6, 7 — mini-projects, notifications)
- `docs/superpowers/specs/2026-04-25-phase7a-runs-teachers-groups-design.md` (runs, groups, roster cascade)

## Goal

Add the mini-project flow on top of Phase 7a's run/group infrastructure: teachers create per-block mini-projects on a run, groups submit PDF reports against them, teachers evaluate with one of four outcomes (`rejected`, `major_revision`, `minor_revision`, `accepted`), and resubmissions follow the spec's flow. Add a parallel `RunAsset` registry for run-specific datasets/code referenced from mini-project markdown.

Phase 7b ships standalone backend functionality. No frontend, no scheduled deadline reminders, no teacher dashboard yet.

## Non-Goals

- Teacher progress dashboard, CSV export, bulk roster ops UI (Phase 7c)
- Scheduled deadline-approaching notifications, teacher summary emails (Phase 9 — needs scheduler)
- Email delivery (Phase 9 — Phase 7b writes `notification_log` rows with `sent_at = NULL`)
- Student-facing run/mini-project UI (Phase 7c, when there is content to display)
- Frontend (any phase)
- **Mini-project unpublish** (out of scope by design — once `is_published=True`, the flag is permanent; the only way to remove a mini-project is `?force=true` delete. Effective student visibility still depends on `run.is_published`, so a Phase 7a run-unpublish hides all mini-projects on that run.)

## Architecture

```
Course (existing)
└── CourseVersion (existing)
    ├── Block ─── (FK target only) ─── MiniProject (NEW)
    └── Run (Phase 7a)
        ├── RunTeacher / Group / RunStudent (Phase 7a)
        ├── MiniProject (NEW)            one per (run, block)
        │   └── Submission (NEW)         many per (mini_project, group)
        │       └── Evaluation (NEW)     1:1 with submission
        ├── RunAsset (NEW)               run-specific files (datasets, code)
        └── RunAssetReference (NEW)      tracks references from mini-project markdown
```

A mini-project belongs to a `Run` (cohort-scoped) and points at a `Block` from the run's pinned course version. Files attached to a mini-project (datasets, code) are run-specific via the new `RunAsset` table — they are *not* course-version assets and not managed by course admins.

## Decisions Already Fixed by Master Spec

These come from `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` §6 (lines 440-466) and §7 (lines 514-521). They are not open for re-litigation in this phase.

| Decision | Source |
|---|---|
| One mini-project per (run, block) | line 442 |
| MiniProject fields: `id, run_id, block_id, assignment_md, assignment_html, soft_deadline, hard_deadline, resubmission_deadline` | line 442 |
| Submission fields: `id, mini_project_id, group_id, submitted_by, submitted_at, file_path, is_resubmission` | line 448 |
| Submission rule: any group member can submit on behalf of the group | line 451 |
| Submission rule: no initial submission after `hard_deadline` | line 452 |
| Submission rule: no resubmission after `resubmission_deadline` | line 453 |
| Submission rule: resubmission after `major_revision` or `minor_revision` is auto-accepted | line 454 |
| Evaluation fields: `id, submission_id (UNIQUE), evaluated_by, evaluated_at, result, score (optional 0-100), feedback_text (optional), feedback_file (optional, mandatory if result ≠ accepted)` | line 458 |
| Result values: `rejected | major_revision | minor_revision | accepted` | line 458 |
| Resubmission flow: `rejected` resets to fresh initial; `major_revision`/`minor_revision` allow one auto-accepted resubmit; `accepted` ends it | lines 460-466 |
| Run-specific asset directory for additional files | line 444 |
| Notification kind in scope for 7b: `evaluation_received` (event-triggered) | line 521 |
| Notifications deferred to Phase 9: deadline reminders (soft / hard / resubmission), teacher summary | lines 517-521 |

## Phase 7b Extensions to the Master Spec

These are decisions made during Phase 7b brainstorming that go beyond the master spec but are consistent with it. Each is justified inline.

| Extension | Why |
|---|---|
| **`mini_projects.is_published` per-mini-project flag** | Visibility = `run.is_published AND mini_project.is_published`. Lets teachers stage mini-projects ahead and roll them out as the term progresses. Once flipped True, **never flips back** (no unpublish endpoint). Mini-project visibility is "off by default until ready, then permanent." |
| **`mini_projects.first_submitted_at` lock marker** | Atomic lock for "free-but-immutable-after-submission" lifecycle. Set via `UPDATE mini_projects SET first_submitted_at = COALESCE(first_submitted_at, now()) WHERE id = ?` at first submission (the COALESCE makes it a single-statement compare-and-set). Lock is **orthogonal to visibility** — lock state and publish state are independent. |
| **`submissions.submission_number` (int, ≥1)** | Sequential per `(mini_project_id, group_id)`. Drives filename uniqueness ("submission 1.pdf", "submission 2.pdf") and resubmission ordering. UNIQUE constraint catches duplicate-numbered races. |
| **`submissions.file_size`** | Standard for any file-storing column. |
| **`submissions.is_late`** | Bool, set at insert time when `submitted_at > soft_deadline`. **Recomputed when `soft_deadline` is extended** (PATCH endpoint runs `UPDATE submissions SET is_late = (submitted_at > new_soft_deadline) WHERE mini_project_id = ?`). Cheap denormalization for teacher dashboard queries (Phase 7c). |
| **`groups.is_disabled` flag** (Phase 7a table extension) | New bool column. A group is disabled when membership has dissolved but submissions must be preserved (e.g., students dropped out). Disabled groups: read-only — no new students, no new submissions; existing data viewable. Mirrors `User.is_disabled` (`models_auth.py:16`) and `CourseVersion.is_disabled` (`models.py:43`). |
| **`mini_projects` requires `groups_enabled = True`** | Submissions are group-scoped per spec; runs without groups can't host mini-projects. Single-person groups handle the individual-evaluation case. |
| **`run.groups_enabled` lock extends** | Already locked at run publish (Phase 7a); now also locked once any mini-project exists. |
| **`mini_project.title` is *not* a column** | Derived at response-serialization time as `f"Mini project for Block {block.order}"`. Keeps schema minimal. |

## Data Model

### `mini_projects`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `run_id` | int FK `runs.id`, ON DELETE CASCADE | indexed |
| `block_id` | int FK `blocks.id`, ON DELETE RESTRICT | indexed |
| `assignment_md` | text NOT NULL | Markdown source |
| `assignment_html` | text NOT NULL | rendered + sanitized HTML, references resolved against `RunAsset` |
| `soft_deadline` | datetime tz nullable | warning trigger; sets `is_late` on later submissions |
| `hard_deadline` | datetime tz nullable in DB; required at publish | initial-submission cutoff |
| `resubmission_deadline` | datetime tz nullable in DB; required at publish | resubmission cutoff (always set when published) |
| `is_published` | bool NOT NULL default False | one-way flag — once True, can never flip back to False (no unpublish; only force-delete) |
| `first_submitted_at` | datetime tz nullable | atomic lock marker; orthogonal to `is_published` |
| `created_at` | datetime tz | server_default now() |
| `updated_at` | datetime tz | server_default now(), onupdate now() |

**Constraints:**
- UNIQUE `(run_id, block_id)` — `uq_mini_project_run_block`
- CHECK `soft_deadline IS NULL OR hard_deadline IS NULL OR soft_deadline <= hard_deadline`
- CHECK `hard_deadline IS NULL OR resubmission_deadline IS NULL OR hard_deadline <= resubmission_deadline`
- INDEX `(run_id, is_published)` for student-side listing

**App-level rules** (enforced on publish):
- `hard_deadline IS NOT NULL`
- `hard_deadline > now()` at publish time
- `hard_deadline <= run.end_date`
- `resubmission_deadline IS NOT NULL`
- `resubmission_deadline <= run.end_date`
- `hard_deadline <= resubmission_deadline` (already a CHECK, re-asserted at publish)
- `run.is_published = True`

### `submissions`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `mini_project_id` | int FK ON DELETE CASCADE | indexed |
| `group_id` | int FK `groups.id`, ON DELETE RESTRICT | indexed; permanently RESTRICT — submission history is sacred. To wipe submissions, use run-level `?force=true` delete |
| `submission_number` | int NOT NULL | sequential per `(mini_project_id, group_id)`, starting at 1 |
| `submitted_by` | int FK `users.id`, ON DELETE RESTRICT | who clicked submit (group member) |
| `submitted_at` | datetime tz | server_default now() |
| `file_path` | str(512) NOT NULL | relative path under `<asset_path>/submissions/` |
| `file_size` | int NOT NULL, CHECK > 0 | |
| `is_late` | bool NOT NULL default False | computed vs `mini_project.soft_deadline` at insert; recomputed on deadline extension |
| `is_resubmission` | bool NOT NULL default False | per spec line 448 |

**Constraints:**
- UNIQUE `(mini_project_id, group_id, submission_number)` — `uq_submission_number`
- CHECK `submission_number >= 1`
- INDEX `(mini_project_id, group_id, submission_number DESC)` — fast "latest submission per group"

**App-level cross-run integrity:** at submission time, validate `group.run_id == mini_project.run_id`. If not, return 400.

### `evaluations`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `submission_id` | int FK ON DELETE CASCADE, **UNIQUE** | one evaluation per submission per spec line 458 |
| `evaluated_by` | int FK `users.id`, ON DELETE RESTRICT | actor who caused the evaluation outcome (see auto-accept policy below) |
| `evaluated_at` | datetime tz | server_default now() |
| `result` | str(20) NOT NULL | one of `rejected`, `major_revision`, `minor_revision`, `accepted` |
| `score` | int nullable | optional per spec; CHECK 0–100 |
| `feedback_text` | text nullable | optional short feedback |
| `feedback_file` | str(512) nullable | path to feedback PDF |
| `created_at` / `updated_at` | datetime tz | |

**Constraints:**
- CHECK `result IN ('rejected', 'major_revision', 'minor_revision', 'accepted')`
- CHECK `score IS NULL OR (score BETWEEN 0 AND 100)`
- CHECK `result = 'accepted' OR feedback_file IS NOT NULL` — feedback file mandatory unless accepted (spec line 458)

### `run_assets`

Parallel to `Asset` (Phase 6) but run-scoped. Storage at `<asset_path>/runs/{run_id}/{filename}`.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `run_id` | int FK ON DELETE CASCADE | indexed |
| `filename` | str(255) NOT NULL | sanitized via `mathion/assets.py:sanitize_filename` |
| `file_size` | int NOT NULL | |
| `mime_type` | str(100) NOT NULL | from `mathion/assets.py:get_mime_type` |
| `uploaded_at` | datetime tz | server_default now() |
| `uploaded_by` | int FK `users.id`, ON DELETE SET NULL | |

UNIQUE `(run_id, filename)` — `uq_run_asset_run_filename`.

Reuses Phase 6's `validate_extension`, `sanitize_filename`, `get_mime_type` from `backend/mathion/assets.py:29-62` directly. Same per-file cap (`settings.max_file_size`); per-run total cap reuses `settings.max_course_size` (configurable separately later if needed).

### `run_asset_references`

Parallel to `AssetReference` (Phase 6, `models.py:176`). Tracks references from mini-project `assignment_md`.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `run_asset_id` | int FK `run_assets.id`, ON DELETE CASCADE | indexed |
| `mini_project_id` | int FK ON DELETE CASCADE | indexed |

Single-arm polymorphism for now (only mini-projects reference run assets in 7b). If Phase 7c or later adds other run-scoped owners, extend with additional nullable arms following Phase 6's pattern (`models.py:185-187`).

### Existing-table touches

- `groups` (Phase 7a) — add `is_disabled BOOLEAN NOT NULL DEFAULT 0` column. Single-column ALTER, SQLite-compatible (no `batch_alter_table` required since no constraint changes).
- `AssetReference` is *not* extended; mini-project files use the parallel `RunAssetReference` table.

## Lifecycle

### Mini-project state (lock orthogonal to visibility)

Two independent dimensions:

```
visibility:  draft       = NOT is_published    (hidden from students)
             published   = is_published        (visible — sticky True)

lock state:  open        = first_submitted_at IS NULL    (editable per rules)
             locked      = first_submitted_at IS NOT NULL  (content frozen)
```

Combined effective states:
- **draft + open** — fully editable; not visible to students
- **published + open** — fully editable; visible to students; no submissions yet
- **published + locked** — content/files frozen; deadlines extend-only; visible to students; one or more groups have submitted

**Note:** `is_published` is one-way True at the mini-project level. There is no `POST /api/mini-projects/{mid}/unpublish` endpoint. Once a mini-project's `is_published` flag is set, it cannot be cleared except via `?force=true` delete (course-admin only). Effective student visibility still depends on `run.is_published` — a Phase 7a run-unpublish hides all mini-projects on that run, but the mini-project's own flag remains True. This deliberate design simplifies the state model and avoids the "lost visibility for already-submitted work" class of bugs.

### Edit rules

| Field | draft + open | published + open | published + locked |
|---|---|---|---|
| `assignment_md` / `assignment_html` | editable | editable | **locked** |
| `soft_deadline` / `hard_deadline` / `resubmission_deadline` | editable | editable | **extend-only** for non-null deadlines (new value > current). `soft_deadline` may also transition NULL→non-NULL since it's not required at publish; the other two are non-null at locked state by publish-gate guarantee |
| Mini-project files (RunAssets) | add+remove freely | add+remove freely | **fully locked** (no add, no remove) |
| `is_published` | editable (False→True only) | locked True | locked True |

Lock semantics gated by `mini_projects.first_submitted_at IS NOT NULL`, set atomically at first successful submission via:

```sql
UPDATE mini_projects
SET first_submitted_at = COALESCE(first_submitted_at, now())
WHERE id = ?
```

PATCH endpoint reads `first_submitted_at` within the same transaction as the field update; rejects locked-field changes if non-null. `SELECT … FOR UPDATE` used to serialize PATCH against concurrent first-submission (see §Concurrency Notes for SQLite caveat).

**Soft-deadline change special case:** any change to `soft_deadline` (including NULL→non-NULL transition or extension to a later value) triggers `is_late` recomputation for all existing submissions on the mini-project, in the same transaction:

```sql
UPDATE submissions
SET is_late = CASE
  WHEN :new_soft_deadline IS NULL THEN 0
  ELSE (submitted_at > :new_soft_deadline)
END
WHERE mini_project_id = :mini_project_id
```

If `soft_deadline` is set to NULL, all submissions become `is_late=False` (no late threshold defined).

### Publish-gate

`POST /api/mini-projects/{mid}/publish` enforces:
1. `hard_deadline IS NOT NULL`
2. `hard_deadline > now()`
3. `hard_deadline <= run.end_date`
4. `resubmission_deadline IS NOT NULL`
5. `resubmission_deadline <= run.end_date`
6. `hard_deadline <= resubmission_deadline`
7. `soft_deadline <= hard_deadline` (if `soft_deadline` set)
8. `run.is_published = True` (cannot publish a mini-project on an unpublished run)

If any condition fails, return 409 with violations list. Otherwise `is_published := True`. **There is no unpublish counterpart.**

### Delete

`DELETE /api/mini-projects/{mid}` is course-admin or run-teacher.

- If `first_submitted_at IS NOT NULL` AND no `?force=true`: 409 ("Mini-project has submissions; use ?force=true").
- With `?force=true` (course-admin only): cascades through submissions, evaluations, and `RunAssetReference` rows owned by this mini-project; files on disk cleaned up in app code (paths below).

A draft mini-project (`is_published = False`, `first_submitted_at IS NULL`) deletes without force.
A published mini-project without submissions deletes without force.

**File cleanup on mini-project force-delete:** for each submission belonging to this mini-project, remove `<asset_path>/submissions/{run_id}/{group_id}/<submission_filename>.pdf`. For each evaluation with a `feedback_file`, remove the corresponding feedback PDF. **Shared `RunAsset` files referenced by this mini-project are NOT removed** — they may be referenced by other mini-projects on the run, and removal would break those. To wipe `RunAsset` files, the admin must use either `DELETE /api/runs/{rid}/assets/{aid}?force=true` per-asset, or `DELETE /api/runs/{rid}?force=true` for run-wide cleanup. App-level delete order: evaluations → submissions (with disk cleanup) → run_asset_references → mini_project. (Submissions deleted before group rows is not relevant here since we're only removing this mini-project's submissions, not groups.)

### Run delete (extended from Phase 7a)

`DELETE /api/runs/{rid}` (course-admin only) without `?force=true` is blocked if any of:
1. `is_published=True` (Phase 7a — must unpublish run first via existing endpoint)
2. **`RunStudent` count > 0** (new — admin must clear roster via existing per-student remove endpoint)
3. **Any submission exists for any mini-project on this run** (new — checked via the new `has_submissions` helper)

`DELETE /api/runs/{rid}?force=true` (course-admin only) **overrides all three blocks above** — including a still-published run. The intent of force is "this run is being purged regardless of state." UI surfaces high-risk confirmation per the platform spec line 59 pattern.

**Force-delete cascade order** (app-level, since `submissions.group_id` is RESTRICT):

1. Delete all `evaluations` (cascade-on-delete via `submissions.id` — but explicit for ordering: evaluation files removed from disk first)
2. Delete all `submissions` (with disk cleanup of submission PDFs)
3. Delete all `run_asset_references` (cascade-on-delete via `mini_projects.id`, but ordered before groups to allow further mini_project cleanup)
4. Delete all `mini_projects` (cascade-on-delete via `runs.id` — but ordered now since submissions/refs are gone)
5. Delete all `groups` (now safe; submissions cleared in step 2; `RunStudent.group_id` was already SET NULL on student removal, but force-delete also clears all `run_students`)
6. Delete all `run_teachers`, `run_students` (cascade-on-delete via `runs.id`)
7. Delete `run_assets` rows + wipe `<asset_path>/runs/{run_id}/` directory tree
8. Wipe `<asset_path>/submissions/{run_id}/` directory tree
9. Delete `runs` row

If any step fails mid-cascade, the entire transaction rolls back; no partial state.

### Group disable (new in Phase 7b)

A group whose members have dissolved (e.g., students dropped out) but whose submissions must persist as historical record can be **disabled** rather than deleted.

- `PATCH /api/groups/{gid}` body `{"is_disabled": true}` — flips the flag. Course admin OR run teacher. Allowed regardless of student/submission count.
- `PATCH /api/groups/{gid}` body `{"is_disabled": false}` — re-enables. Same auth.
- Disabled groups: cannot accept new student additions (POST roster → 409); cannot accept new submissions (POST submission → 409). Existing students (if any), submissions, and evaluations remain accessible to admins/teachers.
- `DELETE /api/groups/{gid}` is permanent and now requires the group to be empty of *both* students and submissions (existing Phase 7a check + new submissions check). For groups with submissions, disable instead.

## File Storage

Two disjoint trees under `settings.asset_path`:

```
<asset_path>/
  courses/
    {version_id}/...                    (Phase 6, unchanged)
  runs/
    {run_id}/
      dataset.csv
      analysis-template.r               (RunAsset; mini-project markdown references these)
  submissions/
    {run_id}/
      {group_id}/
        block 1 - group 3-12a - submission 1.pdf
        block 1 - group 3-12a - submission 1 - feedback.pdf
        block 1 - group 3-12a - submission 2.pdf
```

### Filename generation

Helpers in `mathion/api/helpers.py`:

```python
def build_submission_filename(block_order: int, group_name: str, submission_number: int) -> str:
    return sanitize_filename(f"block {block_order} - group {group_name} - submission {submission_number}.pdf")

def build_feedback_filename(block_order: int, group_name: str, submission_number: int) -> str:
    return sanitize_filename(f"block {block_order} - group {group_name} - submission {submission_number} - feedback.pdf")

def submission_storage_dir(run_id: int, group_id: int) -> str:
    return os.path.join(settings.asset_path, "submissions", str(run_id), str(group_id))

def run_asset_storage_dir(run_id: int) -> str:
    return os.path.join(settings.asset_path, "runs", str(run_id))
```

`sanitize_filename` from `mathion/assets.py:29-49` collapses spaces to hyphens and strips non-alphanumerics. Group name `"3-12a"` passes through unchanged; `"Group #1!"` becomes `"group-1"`. Result: filenames are safe by construction.

### Path-traversal defense

Same realpath/commonpath check as Phase 6's `serve_asset` (`api/assets.py:175-178`). Replicated for submission download and run-asset download endpoints.

### File-write rollback pattern

Submission and feedback uploads follow the same temp+rename pattern as Phase 6's asset upload (`api/assets.py:79-99`):

1. Insert DB row inside transaction (gives the `submission_number` / evaluation row).
2. Write file via `tempfile.mkstemp` in the destination directory, then `os.replace` to the final path.
3. On any disk failure: `db.rollback()` (or savepoint rollback for nested transactions) to remove the row, then unlink the temp file. Return 500.
4. On any DB failure after disk write: unlink the file before raising.

Disk and DB are kept consistent: a row with no file, or a file with no row, is never persisted at end-of-transaction.

### Markdown rendering for `assignment_md`

New helper `render_with_run_assets(db, run_id, content_md)` in `helpers.py`, mirroring `render_with_assets` (`helpers.py:167`) but resolving against `RunAsset` (filtered by `run_id`) instead of `Asset`. Rewrites bare filenames to `/api/runs/{run_id}/assets/{filename}` paths in the rendered HTML. Used at mini-project save time. Raises 422 if the markdown references a filename that doesn't exist in `RunAsset` for this run.

`sync_run_asset_references(db, run_id, content_md, mini_project_id)` mirrors `sync_asset_references` (`helpers.py:203`): **deletes all `RunAssetReference` rows for the given `mini_project_id`, then re-inserts rows for filenames currently referenced in the markdown.** This handles markdown edits that remove references (the deleted-rows pass cleans them up).

### Run-asset force-delete + locked mini-project

If a `RunAsset` is force-deleted while still referenced by a *locked* mini-project's `assignment_md`, the rendered `assignment_html` already on disk is unchanged (it's frozen). A subsequent re-render (by the locked mini-project — which can't happen via PATCH since `assignment_md` is locked) does not occur. New mini-projects in `published + open` or `draft + open` state that reference the deleted file will 422 on next save. Existing locked mini-projects continue to render with the (now-broken) reference; the front-end will surface a missing file when serving the asset URL (404).

This is acceptable: force-delete is the destructive escape hatch; broken historical references in locked content are the documented cost.

## API Surface

All endpoints require an authenticated user. Authorization in the right column. Helpers in parentheses.

### Mini-project CRUD

| Method | Path | Auth |
|---|---|---|
| POST | `/api/runs/{rid}/mini-projects` | course admin OR run teacher (`require_run_admin_or_teacher`) |
| GET | `/api/runs/{rid}/mini-projects` | admins/teachers see all; students see those passing `mini_project_visible_to_student(run, mp)` |
| GET | `/api/mini-projects/{mid}` | as above |
| PATCH | `/api/mini-projects/{mid}` | course admin OR run teacher |
| DELETE | `/api/mini-projects/{mid}` | course admin OR run teacher; `?force=true` course-admin-only |
| POST | `/api/mini-projects/{mid}/publish` | course admin OR run teacher |

There is no `unpublish` endpoint by design (see §Lifecycle).

**Visibility helper** in `helpers.py`:
```python
def mini_project_visible_to_student(run, mini_project) -> bool:
    return run.is_published and mini_project.is_published
```
Applied at the start of every student-path branch in mini-project, submission, **evaluation, feedback-file**, and run-asset reads. Admins and run teachers bypass this check (see auth decorators).

### Mini-project file management (RunAsset)

| Method | Path | Auth |
|---|---|---|
| POST | `/api/runs/{rid}/assets` | course admin OR run teacher |
| GET | `/api/runs/{rid}/assets` | course admin OR run teacher |
| GET | `/api/runs/{rid}/assets/{filename}` | course admin OR run teacher; enrolled student gated by `mini_project_visible_to_student` for *some* mini-project that references this file |
| DELETE | `/api/runs/{rid}/assets/{aid}` | course admin OR run teacher; 409 if referenced unless `?force=true` (course admin) |

Mirrors Phase 6's asset endpoints (`api/assets.py`) with run-level authorization and run-scoped storage.

### Submission

| Method | Path | Auth |
|---|---|---|
| POST | `/api/mini-projects/{mid}/submissions` | group member of any group on the run, gated by `mini_project_visible_to_student` |
| GET | `/api/mini-projects/{mid}/submissions` | course admin OR run teacher (lists all groups); group member (their group only, gated by visibility) |
| GET | `/api/submissions/{sid}` | course admin OR run teacher OR member of the submitting group (gated by visibility for non-admin/teacher) |
| GET | `/api/submissions/{sid}/file` | as above (returns the PDF) |

`POST` body is `multipart/form-data` with the PDF file. Server validates:
- `mini_project_visible_to_student(run, mini_project) == True` (i.e., both `run.is_published` AND `mini_project.is_published`)
- `mini_project.first_submitted_at` does **not** affect submit eligibility (lock is for *editing*, not submitting).
- Submitter is a member of the group on `mini_project.run_id` (spec line 438 + `uq_run_student` constraint guarantee at most one group per student per run). Submission is recorded against that group. Submitters with no group membership on the run get 403.
- Submitter's group is not disabled (`group.is_disabled = False`).
- Group precondition for new initial submission:
  - No prior submission OR latest evaluation `result = 'rejected'`
- Group precondition for resubmission:
  - Latest evaluation `result IN ('major_revision', 'minor_revision')`
- Deadline:
  - If `is_resubmission=False`: `now() <= hard_deadline`
  - If `is_resubmission=True`: `now() <= resubmission_deadline`

Determines `submission_number = MAX(...) + 1` over the (mini_project, group). UNIQUE constraint catches concurrent races; retry once on IntegrityError, then 503.

Sets `is_late = (submitted_at > mini_project.soft_deadline)` if `soft_deadline IS NOT NULL`, else False. Sets `is_resubmission = True` if latest evaluation is `major_revision` or `minor_revision`, else False.

Atomically updates `mini_projects.first_submitted_at` via `UPDATE mini_projects SET first_submitted_at = COALESCE(first_submitted_at, now()) WHERE id = ?`.

### Evaluation

| Method | Path | Auth |
|---|---|---|
| POST | `/api/submissions/{sid}/evaluation` | course admin OR run teacher |
| GET | `/api/submissions/{sid}/evaluation` | course admin OR run teacher OR member of submitting group (member access gated by `mini_project_visible_to_student`) |
| PATCH | `/api/evaluations/{eid}` | course admin OR run teacher |
| GET | `/api/evaluations/{eid}/feedback-file` | course admin OR run teacher OR member of submitting group (member access gated by `mini_project_visible_to_student`) |

`POST` body includes `result`, optional `score`, optional `feedback_text`, and optional `feedback_file` (PDF, multipart). The `feedback_file` field is required iff `result != 'accepted'`.

**Auto-acceptance for resubmissions** (per spec lines 462-464): if `submission.is_resubmission == True`, the system creates an evaluation with `result = 'accepted'` *atomically inside the submission transaction* — teachers do not evaluate auto-accepted resubmissions; the manual evaluation POST endpoint returns 409 in that case. The auto-evaluation row carries:

- `evaluated_by` = the *latest* `major_revision` / `minor_revision` evaluator's user_id (i.e., the actor who caused the revision-pending state). Policy: `evaluated_by` records "actor who caused the outcome" — a User reference, not a current-RunTeacher attestation. If that user has since been removed from the run (RunTeacher row deleted), the audit field still references the original actor; the User row itself is preserved by `ON DELETE RESTRICT`.
- `evaluated_at` = the submission timestamp
- `result` = `'accepted'`
- `score`, `feedback_text`, `feedback_file` = NULL
- An `evaluation_received` notification fires immediately to current group members.

**Auto-evaluation INSERT failure handling:** the auto-evaluation INSERT runs in the same DB transaction as the submission INSERT. If the auto-eval INSERT fails (e.g., the previous evaluator's User row was deleted via some path that bypassed RESTRICT — should not occur but defended in depth), the entire submission transaction rolls back: the submission row is removed, the file on disk is cleaned up via the rollback pattern in §File-write rollback. Group sees 500 with "Auto-evaluation failed; submission rejected"; teacher must investigate the prior-evaluator audit chain.

UNIQUE on `submission_id` catches concurrent dual-create → 409 ("Already evaluated").

`evaluation_received` notification log row is written for each **current** group member at evaluation time (not submission-time members). Rationale: notifications go to people who are currently affected; ex-members removed before evaluation no longer get notified. New members added between submission and evaluation *do* receive the notification (they're now part of the group's responsibility).

## Notifications

Phase 7b adds exactly **one** event-triggered notification kind. Scheduled reminders (deadline-approaching, teacher summary) deferred to Phase 9 with the email scheduler.

| `kind` | Trigger | Recipients | Payload |
|---|---|---|---|
| `evaluation_received` | Teacher posts evaluation OR auto-accept fires | Current members of the submitting group at evaluation time | `{run_id, mini_project_id, submission_id, evaluation_id, result}` |

**Phase 9 deferred filtering:** `resubmission_deadline_approaching` notification (when implemented) fires only for groups whose latest evaluation is `major_revision` or `minor_revision` (no acceptance yet). Groups with accepted initial submissions or no pending revision do not receive this notification. Documented as Phase 9 implementation detail.

Phase 7a's three kinds (`run_enrolled`, `run_published`, `run_teacher_assigned`) remain unchanged.

## Error Handling

| Scenario | Status | Detail |
|---|---|---|
| Create mini-project on run with `groups_enabled=False` | 409 | "Run must have groups_enabled to host mini-projects" |
| Edit `groups_enabled` on run with mini-project | 409 | "Cannot disable groups; mini-projects exist" |
| Mini-project create on (run, block) where `block.version_id != run.version_id` | 400 | "Block does not belong to this run's course version" |
| Duplicate (run_id, block_id) on create | 409 | "Mini-project already exists for this block" |
| PATCH locked field while submissions exist | 409 | List violations: "assignment_md is locked", "deadline can only be extended", "files are locked" |
| Publish mini-project while run is unpublished | 409 | "Cannot publish mini-project on unpublished run" |
| Publish without `hard_deadline` | 409 | "hard_deadline required at publish" |
| Publish without `resubmission_deadline` | 409 | "resubmission_deadline required at publish" |
| Publish with deadline past `run.end_date` | 409 | "Deadlines must fall within run end_date" |
| Submit without group membership on the run | 403 | "Must be a member of a group on this run to submit" |
| Submit while `mini_project_visible_to_student` is False | 403 | "Mini-project not visible" |
| Submit to disabled group | 409 | "Group is disabled" |
| Add student to disabled group | 409 | "Cannot add students to disabled group" |
| Move student into disabled group via PATCH | 409 | "Cannot move student into disabled group" |
| Initial submission after `hard_deadline` | 409 | "Initial submission deadline passed" |
| Resubmission after `resubmission_deadline` | 409 | "Resubmission deadline passed" |
| Resubmission while latest evaluation is `accepted` | 409 | "Already accepted; no further submission" |
| Submission while previous submission has no evaluation | 409 | "Previous submission pending evaluation" |
| Cross-run group/mini-project mismatch | 400 | "Group does not belong to this run" |
| Evaluate already-evaluated submission | 409 | "Already evaluated" |
| Evaluate auto-accepted submission | 409 | "Submission was auto-accepted; cannot manually evaluate" |
| Evaluate without `feedback_file` when result ≠ accepted | 422 | "feedback_file required for this result" |
| Auto-evaluation INSERT failure | 500 | "Auto-evaluation failed; submission rejected" (transaction rolled back, file cleaned up) |
| Delete RunAsset still referenced by `assignment_md` | 409 | "Asset is referenced by mini-project N. Use ?force=true to delete." |
| Delete mini-project with submissions, no force | 409 | "Mini-project has submissions; use ?force=true" |
| Delete run with students or submissions, no force | 409 | "Run has students/submissions; clear roster or use ?force=true" |
| Delete group with students or submissions | 409 | "Group has students or submissions; disable instead" |

## Concurrency Notes

Phase 7b follows Phase 7a's precedent: DB UNIQUE constraints preserve data integrity; app-level checks provide clean UX in the common case; remaining races are documented for the Phase 9 SAVEPOINT cleanup.

**Row-lock note (`SELECT … FOR UPDATE`):** Used in PATCH endpoints to read `first_submitted_at` atomically with the update. SQLite ignores the clause silently — dev tests use a single connection so the race never manifests. Production Postgres applies the row lock as expected. The window where two concurrent transactions could observe `first_submitted_at IS NULL` is small (single submission insert) and matches Phase 7a's documented precedent (`helpers.py:125-127`). A SQLite-portable mechanism is deferred to Phase 9. `# TODO(phase 9)` markers placed at:

- `submissions.py` submit handler (resubmission gate race: two members observing same `revision_requested`)
- `mini_projects.py` PATCH handler (lock-marker race against first submission)
- New marker not needed in `helpers.py:enroll_user_in_run` (renamed from `_enroll_user_in_run` per cleanup item #1) — Phase 7a already has the comment.

**Submission-number race:** `MAX(n)+1` races between two concurrent submitters from the same group. Caught by UNIQUE `(mini_project_id, group_id, submission_number)` → app retries once on IntegrityError → second failure returns 503.

**Evaluation duplicate race:** UNIQUE `submission_id` catches; app translates IntegrityError → 409.

## Phase 7a Cleanup Items Bundled into Phase 7b

These items were deferred from Phase 7a's final review and are addressed here because Phase 7b touches the same surface anyway:

1. **Rename `_enroll_user_in_run` → `enroll_user_in_run`** (`helpers.py:112`). Cross-module helper shouldn't have leading underscore.
2. **Add `has_submissions(db, run) -> bool` helper** in `helpers.py` (does not currently exist in code despite earlier roadmap notes). Wire into:
   - `runs.py:patch_run` — end_date-lowering check (currently unguarded; add the new check)
   - `runs.py:delete_run` — Phase 7b's run-delete tightening (new check)
3. **Add `# TODO(phase 9)` race comments** at `run_roster.py:patch_student` capacity check and `runs.py` publish-gate (currently only at `helpers.py:_enroll_user_in_run`).
4. **Collapse `require_run_admin_or_teacher`** to take a loaded `Run` object (matching `require_course_admin_for_run`'s shape — `helpers.py:71`). Eliminates redundant `db.get(Run)` calls in routers.

Phase 7a item #5 (`run_teachers.py:add_teacher` SELECT-then-INSERT alignment) is purely cosmetic and unrelated to Phase 7b — left for a focused cleanup later.

## Migration Strategy

One Alembic migration adding five tables (`mini_projects`, `submissions`, `evaluations`, `run_assets`, `run_asset_references`) plus one column on `groups` (`is_disabled BOOLEAN NOT NULL DEFAULT 0`).

The column add is SQLite-compatible without `batch_alter_table` because adding a NOT NULL column with a server-side default value is supported. CHECK constraints on new tables declared inline. Designed to apply cleanly on Postgres.

Migration file: `<rev>_add_mini_projects_submissions_evaluations.py`.

## Testing Strategy

Test files (TDD, mirroring Phase 7a structure):

| File | Coverage |
|---|---|
| `tests/test_mini_projects.py` | CRUD, publish gate (incl. resubmission_deadline-required), edit rules pre/post submission, lock semantics, no-unpublish behavior, delete-with-force |
| `tests/test_run_assets.py` | Upload, list, serve, delete, reference tracking via assignment_md, force-delete-when-referenced, sanitization |
| `tests/test_submissions.py` | Initial vs resubmission flow, deadline enforcement, file storage layout, filename sanitization, late detection (incl. recompute on soft_deadline extension), cross-run integrity, group-member auth, retry-on-IntegrityError, file-write rollback on DB failure, disabled-group rejection |
| `tests/test_evaluations.py` | Evaluate with each result, feedback_file mandatory unless accepted, score validation, auto-accept for resubmissions (incl. `evaluated_by` = latest `major_revision`/`minor_revision` evaluator), dual-evaluate race, auto-eval failure rollback |
| `tests/test_mini_project_notifications.py` | `evaluation_received` notification rows written to current group members |
| Existing `tests/test_runs.py` extension | Run delete tightening (students-block, submissions-block, force) |
| Existing `tests/test_groups.py` extension | Group delete blocked by submissions; disable/enable endpoint |

Use existing `admin_client`, `auth_client`, `teacher_client`, and `seed_publishable_version` fixtures from `conftest.py`. Add `seed_run_with_groups` fixture that stages a published run with one group of two students. Test count delta target: ~50-70 tests.

## Open Questions / Deferred to 7c / Phase 9

- **Bulk operations** (move multiple students between groups, bulk submission download, ZIP export of all submissions): deferred to 7c.
- **Student-facing mini-project view** (`/api/runs/{rid}/my-mini-projects`, my-submissions, my-evaluations): deferred to 7c.
- **Scheduled deadline-approaching notifications** (soft / hard / resubmission): deferred to Phase 9 with the email scheduler. Resubmission-deadline reminder filters to groups with pending revision (see §Notifications).
- **Teacher summary email** (after soft deadline): deferred to Phase 9.
- **`INDEX evaluations.result`** for dashboard aggregation: deferred to 7c when actual query patterns are known.
- **SQLite-portable concurrency (SAVEPOINT-based)**: deferred to Phase 9 SAVEPOINT cleanup.
- **Phase 7a item #5** (`run_teachers.py` SELECT-then-INSERT pattern alignment): deferred to a focused cleanup later.

## Implementation Sequence (preview for the plan)

1. Models + migration (MiniProject, Submission, Evaluation, RunAsset, RunAssetReference; Group.is_disabled column add)
2. Phase 7a cleanup: rename `_enroll_user_in_run`, add `has_submissions` helper and wire into patch_run + delete_run, collapse `require_run_admin_or_teacher` signature, add Phase 9 TODO race markers
3. Schemas (MiniProjectCreate/Update/Response, SubmissionResponse, EvaluationCreate/Update/Response, RunAssetResponse, GroupUpdate extension for is_disabled)
4. RunAsset endpoints (parallel to Phase 6 assets, run-scoped, with file-write rollback pattern)
5. `render_with_run_assets` and `sync_run_asset_references` helpers; `mini_project_visible_to_student` helper
6. Mini-project CRUD + publish endpoint + lock semantics (no unpublish)
7. Submission endpoint with deadline/lifecycle gates, file-write rollback, atomic `first_submitted_at` set, `is_late` recompute on `soft_deadline` extension
8. Evaluation endpoint + auto-accept on resubmission (atomic inside submission transaction)
9. `evaluation_received` notification row writes to current group members
10. Run-delete tightening + group-delete check + group disable/enable endpoint
11. File-storage helpers (filename builders, path defenses) wired through endpoints
12. Final regression sweep against Phase 6/7a baseline

Each step is its own commit with TDD red-green cycle.
