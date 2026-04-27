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
| **`mini_projects.is_published` per-mini-project flag** | Visibility = `run.is_published AND mini_project.is_published`. Lets teachers stage mini-projects ahead and roll them out as the term progresses. Mirrors Phase 7a's run publish pattern at finer grain. |
| **`mini_projects.first_submitted_at` lock marker** | Atomic lock for "free-but-immutable-after-submission" lifecycle. Set via `UPDATE … WHERE first_submitted_at IS NULL` at first submission. PATCH endpoint reads this to decide which fields are still mutable. |
| **`submissions.submission_number` (int, ≥1)** | Sequential per `(mini_project_id, group_id)`. Drives filename uniqueness ("submission 1.pdf", "submission 2.pdf") and resubmission ordering. Combined with UNIQUE constraint to catch duplicate-numbered races. |
| **`submissions.file_size`** | Standard for any file-storing column. |
| **`submissions.is_late`** | Bool, set at insert time when `submitted_at > soft_deadline`. Cheap denormalization for teacher dashboard queries (Phase 7c). |
| **`evaluations.feedback_file_size`** | Sidecar for `feedback_file`. |
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
| `hard_deadline` | datetime tz nullable | initial-submission cutoff |
| `resubmission_deadline` | datetime tz nullable | resubmission cutoff |
| `is_published` | bool NOT NULL default False | per-mini-project visibility |
| `first_submitted_at` | datetime tz nullable | atomic lock marker |
| `created_at` | datetime tz | server_default now() |
| `updated_at` | datetime tz | server_default now(), onupdate now() |

**Constraints:**
- UNIQUE `(run_id, block_id)` — `uq_mini_project_run_block`
- CHECK `soft_deadline IS NULL OR hard_deadline IS NULL OR soft_deadline <= hard_deadline`
- CHECK `hard_deadline IS NULL OR resubmission_deadline IS NULL OR hard_deadline <= resubmission_deadline`
- INDEX `(run_id, is_published)` for student-side listing

**App-level rules** (enforced on publish):
- `hard_deadline IS NOT NULL`
- `hard_deadline > now()` at publish time (warn if missing; reject if past)
- `hard_deadline <= run.end_date`
- If `resubmission_deadline IS NOT NULL`, must be `<= run.end_date`

### `submissions`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `mini_project_id` | int FK ON DELETE CASCADE | indexed |
| `group_id` | int FK `groups.id`, ON DELETE RESTRICT | indexed; RESTRICT preserves submission history if a group is mistakenly deleted |
| `submission_number` | int NOT NULL | sequential per `(mini_project_id, group_id)`, starting at 1 |
| `submitted_by` | int FK `users.id`, ON DELETE RESTRICT | who clicked submit (group member) |
| `submitted_at` | datetime tz | server_default now() |
| `file_path` | str(512) NOT NULL | relative path under `<asset_path>/submissions/` |
| `file_size` | int NOT NULL, CHECK > 0 | |
| `is_late` | bool NOT NULL default False | computed vs `mini_project.soft_deadline` at insert |
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
| `evaluated_by` | int FK `users.id`, ON DELETE RESTRICT | audit trail |
| `evaluated_at` | datetime tz | server_default now() |
| `result` | str(20) NOT NULL | one of `rejected`, `major_revision`, `minor_revision`, `accepted` |
| `score` | int nullable | optional per spec; CHECK 0–100 |
| `feedback_text` | text nullable | optional short feedback |
| `feedback_file` | str(512) nullable | path to feedback PDF |
| `feedback_file_size` | int nullable | sidecar |
| `created_at` / `updated_at` | datetime tz | |

**Constraints:**
- CHECK `result IN ('rejected', 'major_revision', 'minor_revision', 'accepted')`
- CHECK `score IS NULL OR (score BETWEEN 0 AND 100)`
- CHECK `result = 'accepted' OR feedback_file IS NOT NULL` — feedback file mandatory unless accepted (spec line 458)
- CHECK `(feedback_file IS NULL AND feedback_file_size IS NULL) OR (feedback_file IS NOT NULL AND feedback_file_size > 0)` — null consistency

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

### Existing-table touches (none structural)

No modifications to existing tables. `AssetReference` is *not* extended; mini-project files use the parallel `RunAssetReference` table.

## Lifecycle

### Mini-project state

A mini-project's *current state* is **derived** from columns:

```
draft       = NOT is_published
published   = is_published AND first_submitted_at IS NULL
locked      = is_published AND first_submitted_at IS NOT NULL
```

No formal state machine. `is_published` flips via `POST /api/mini-projects/{mid}/publish` and `POST /api/mini-projects/{mid}/unpublish` (matching Phase 7a's run publish pattern).

### Edit rules

| Field | Pre-publish | Published, no submissions | Post first submission |
|---|---|---|---|
| `assignment_md` / `assignment_html` | editable | editable | **locked** |
| `soft_deadline` / `hard_deadline` / `resubmission_deadline` | editable | editable | **extend-only** (new value ≥ current value, both nullable→non-null allowed) |
| Mini-project files (RunAssets) | add+remove freely | add+remove freely | add allowed; remove blocked if `assignment_md` references the file |
| `is_published` (publish action) | editable | editable | editable |
| `is_published` (unpublish action) | editable | editable | **blocked unless `?force=true`** (course admin only) |

Locks gated by `mini_projects.first_submitted_at IS NOT NULL`, set atomically at first successful submission via:

```sql
UPDATE mini_projects SET first_submitted_at = COALESCE(first_submitted_at, now()) WHERE id = ?
```

PATCH endpoint reads `first_submitted_at` within the same transaction as the field update; rejects locked-field changes if non-null.

### Publish-gate

`POST /api/mini-projects/{mid}/publish` enforces:
1. `hard_deadline IS NOT NULL`
2. `hard_deadline > now()`
3. `hard_deadline <= run.end_date`
4. `resubmission_deadline IS NULL OR resubmission_deadline <= run.end_date`
5. `soft_deadline <= hard_deadline` (if set)
6. `run.is_published = True` (cannot publish a mini-project on an unpublished run)

If any condition fails, return 409 with violations list. Otherwise `is_published := True`.

### Unpublish

`POST /api/mini-projects/{mid}/unpublish` is course-admin or run-teacher.

- If `first_submitted_at IS NULL`: succeeds. Flips `is_published` back to False.
- If `first_submitted_at IS NOT NULL` AND no `?force=true`: returns 409 ("Mini-project has submissions; use ?force=true to override").
- If `first_submitted_at IS NOT NULL` AND `?force=true`: course-admin only (not teacher); succeeds. Submissions and evaluations preserved; students lose visibility until republished.

### Delete

`DELETE /api/mini-projects/{mid}` is course-admin or run-teacher.

- If `is_published=True` AND no `?force=true`: 409 ("Unpublish before deleting").
- If `first_submitted_at IS NOT NULL` AND no `?force=true`: 409 ("Mini-project has submissions; use ?force=true").
- With `?force=true` (course-admin only): cascades through submissions, evaluations, attached run-asset references; files on disk cleaned up in app code.

### Run delete (extended from Phase 7a)

`DELETE /api/runs/{rid}` (course-admin only) is now blocked if any of:
1. `is_published=True` (Phase 7a — must unpublish first)
2. **`RunStudent` count > 0** (new — admin must clear roster via existing per-student remove endpoint)
3. **Any submission exists for any mini-project on this run** (new)

`DELETE /api/runs/{rid}?force=true` (course-admin only) cascades through everything: students, mini-projects, submissions, evaluations, run-assets, files on disk. UI surfaces high-risk confirmation per the platform spec line 59 pattern.

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
    safe_name = sanitize_filename(f"block {block_order} - group {group_name} - submission {submission_number}.pdf")
    return safe_name

def build_feedback_filename(block_order: int, group_name: str, submission_number: int) -> str:
    safe_name = sanitize_filename(f"block {block_order} - group {group_name} - submission {submission_number} - feedback.pdf")
    return safe_name

def submission_storage_dir(run_id: int, group_id: int) -> str:
    return os.path.join(settings.asset_path, "submissions", str(run_id), str(group_id))

def run_asset_storage_dir(run_id: int) -> str:
    return os.path.join(settings.asset_path, "runs", str(run_id))
```

`sanitize_filename` from `mathion/assets.py:29-49` collapses spaces to hyphens and strips non-alphanumerics. Group name `"3-12a"` passes through unchanged; `"Group #1!"` becomes `"group-1"`. Result: filenames are safe by construction.

### Path-traversal defense

Same realpath/commonpath check as Phase 6's `serve_asset` (`api/assets.py:175-178`). Replicated for submission download and run-asset download endpoints.

### Markdown rendering for `assignment_md`

New helper `render_with_run_assets(db, run_id, content_md)` in `helpers.py`, mirroring `render_with_assets` (`helpers.py:167`) but resolving against `RunAsset` (filtered by `run_id`) instead of `Asset`. Rewrites bare filenames to `/api/runs/{run_id}/assets/{filename}` paths in the rendered HTML. Used at mini-project save time.

`sync_run_asset_references(db, run_id, content_md, mini_project_id)` mirrors `sync_asset_references` (`helpers.py:203`), keeping `RunAssetReference` rows in sync with what the markdown actually references.

## API Surface

All endpoints require an authenticated user. Authorization in the right column. Helpers in parentheses.

### Mini-project CRUD

| Method | Path | Auth |
|---|---|---|
| POST | `/api/runs/{rid}/mini-projects` | course admin OR run teacher (`require_run_admin_or_teacher`) |
| GET | `/api/runs/{rid}/mini-projects` | course admin OR run teacher OR enrolled student (filtered to `is_published`) |
| GET | `/api/mini-projects/{mid}` | as above |
| PATCH | `/api/mini-projects/{mid}` | course admin OR run teacher |
| DELETE | `/api/mini-projects/{mid}` | course admin OR run teacher; `?force=true` course-admin-only |
| POST | `/api/mini-projects/{mid}/publish` | course admin OR run teacher |
| POST | `/api/mini-projects/{mid}/unpublish` | course admin OR run teacher; `?force=true` course-admin-only |

### Mini-project file management (RunAsset)

| Method | Path | Auth |
|---|---|---|
| POST | `/api/runs/{rid}/assets` | course admin OR run teacher |
| GET | `/api/runs/{rid}/assets` | course admin OR run teacher |
| GET | `/api/runs/{rid}/assets/{filename}` | course admin OR run teacher OR enrolled student |
| DELETE | `/api/runs/{rid}/assets/{aid}` | course admin OR run teacher; 409 if referenced unless `?force=true` (course admin) |

Mirrors Phase 6's asset endpoints (`api/assets.py`) with run-level authorization and run-scoped storage.

### Submission

| Method | Path | Auth |
|---|---|---|
| POST | `/api/mini-projects/{mid}/submissions` | group member of any group on the run |
| GET | `/api/mini-projects/{mid}/submissions` | course admin OR run teacher (lists all groups); group member (their group only) |
| GET | `/api/submissions/{sid}` | course admin OR run teacher OR member of the submitting group |
| GET | `/api/submissions/{sid}/file` | as above (returns the PDF) |

`POST` body is `multipart/form-data` with the PDF file. Server validates:
- `mini_project.is_published == True` AND `mini_project.run.is_published == True`
- Submitter is a member of exactly one group on `mini_project.run_id` (spec line 438: "one group per student per run"). Submission is recorded against that group. Submitters with no group membership on the run get 403.
- Group precondition for new initial submission:
  - No prior submission OR latest evaluation `result = 'rejected'`
- Group precondition for resubmission:
  - Latest evaluation `result IN ('major_revision', 'minor_revision')`
- Deadline:
  - If `is_resubmission=False`: `now() <= hard_deadline`
  - If `is_resubmission=True`: `now() <= resubmission_deadline`

Determines `submission_number = MAX(...) + 1` over the (mini_project, group). UNIQUE constraint catches concurrent races; retry once on IntegrityError, then 503.

Sets `is_late = (submitted_at > mini_project.soft_deadline)`. Sets `is_resubmission = True` if latest evaluation is `major_revision` or `minor_revision`, else `False`.

Atomically updates `mini_projects.first_submitted_at` via `UPDATE … WHERE first_submitted_at IS NULL`.

### Evaluation

| Method | Path | Auth |
|---|---|---|
| POST | `/api/submissions/{sid}/evaluation` | course admin OR run teacher |
| GET | `/api/submissions/{sid}/evaluation` | course admin OR run teacher OR member of submitting group |
| PATCH | `/api/evaluations/{eid}` | course admin OR run teacher |
| GET | `/api/evaluations/{eid}/feedback-file` | course admin OR run teacher OR member of submitting group |

`POST` body includes `result`, optional `score`, optional `feedback_text`, and optional `feedback_file` (PDF, multipart). The `feedback_file` field is required iff `result != 'accepted'`.

**Auto-acceptance for resubmissions** (per spec lines 462-464): if `submission.is_resubmission == True`, the system creates an evaluation with `result = 'accepted'` *atomically inside the submission transaction* — teachers do not evaluate auto-accepted resubmissions; the manual evaluation POST endpoint returns 409 in that case. The auto-evaluation row carries:
- `evaluated_by` = the previous evaluator (the teacher who set `major_revision`/`minor_revision`)
- `evaluated_at` = the submission timestamp
- `result` = `'accepted'`
- `score`, `feedback_text`, `feedback_file` = NULL
- An `evaluation_received` notification fires immediately to the group.

UNIQUE on `submission_id` catches concurrent dual-create → 409 ("Already evaluated").

`evaluation_received` notification log row is written for each member of the submitting group.

## Notifications

Phase 7b adds exactly **one** event-triggered notification kind. Scheduled reminders (deadline-approaching, teacher summary) deferred to Phase 9 with the email scheduler.

| `kind` | Trigger | Recipients | Payload |
|---|---|---|---|
| `evaluation_received` | Teacher posts evaluation (or auto-accept fires) | All members of the submitting group | `{run_id, mini_project_id, submission_id, evaluation_id, result}` |

Phase 7a's three kinds (`run_enrolled`, `run_published`, `run_teacher_assigned`) remain unchanged.

## Error Handling

| Scenario | Status | Detail |
|---|---|---|
| Create mini-project on run with `groups_enabled=False` | 409 | "Run must have groups_enabled to host mini-projects" |
| Edit `groups_enabled` on run with mini-project | 409 | "Cannot disable groups; mini-projects exist" |
| Mini-project create on (run, block) where block.version_id ≠ run.version_id | 400 | "Block does not belong to this run's course version" |
| Duplicate (run_id, block_id) on create | 409 | "Mini-project already exists for this block" |
| PATCH locked field while submissions exist | 409 | List violations: "assignment_md is locked", "deadline can only be extended" |
| Publish mini-project while run is unpublished | 409 | "Cannot publish mini-project on unpublished run" |
| Publish without `hard_deadline` | 409 | "hard_deadline required at publish" |
| Publish with deadline past run.end_date | 409 | "Deadlines must fall within run end_date" |
| Submit without group membership on the run | 403 | "Must be a member of a group on this run to submit" |
| Submit before mini-project published (or run unpublished) | 403 | "Mini-project not visible" |
| Initial submission after `hard_deadline` | 409 | "Initial submission deadline passed" |
| Resubmission after `resubmission_deadline` | 409 | "Resubmission deadline passed" |
| Resubmission while evaluation status is `accepted` | 409 | "Already accepted; no further submission" |
| Submission while previous submission has no evaluation | 409 | "Previous submission pending evaluation" |
| Cross-run group/mini-project mismatch | 400 | "Group does not belong to this run" |
| Evaluate already-evaluated submission | 409 | "Already evaluated" |
| Evaluate without `feedback_file` when result ≠ accepted | 422 | "feedback_file required for this result" |
| Delete RunAsset still referenced by `assignment_md` | 409 | "Asset is referenced by mini-project N. Use ?force=true to delete." |
| Delete mini-project with submissions, no force | 409 | "Mini-project has submissions; use ?force=true" |
| Unpublish mini-project with submissions, no force | 409 | "Mini-project has submissions; use ?force=true" |
| Delete run with students or submissions, no force | 409 | "Run has students/submissions; clear roster or use ?force=true" |

## Concurrency Notes

Phase 7b follows Phase 7a's precedent: DB UNIQUE constraints preserve data integrity; app-level checks provide clean UX in the common case; remaining races are documented for the Phase 9 SAVEPOINT cleanup.

**Row-lock note (`SELECT … FOR UPDATE`):** Used in PATCH endpoints to read `first_submitted_at` atomically with the update. SQLite ignores the clause silently — dev tests use a single connection so the race never manifests. Production Postgres applies the row lock as expected. The window where two concurrent transactions could observe `first_submitted_at IS NULL` is small (single submission insert) and matches Phase 7a's documented precedent (`helpers.py:125-127`). A SQLite-portable mechanism is deferred to Phase 9. `# TODO(phase 9)` markers placed at:

- `submissions.py` submit handler (resubmission gate race: two members observing same `revision_requested`)
- `mini_projects.py` PATCH handler (lock-marker race against first submission)
- New marker not needed in `helpers.py:_enroll_user_in_run` — Phase 7a already has it.

**Submission-number race:** `MAX(n)+1` races between two concurrent submitters from the same group. Caught by UNIQUE `(mini_project_id, group_id, submission_number)` → app retries once on IntegrityError → second failure returns 503.

**Evaluation duplicate race:** UNIQUE `submission_id` catches; app translates IntegrityError → 409.

## Phase 7a Cleanup Items Bundled into Phase 7b

These items were deferred from Phase 7a's final review and are addressed here because Phase 7b touches the same surface anyway:

1. **Rename `_enroll_user_in_run` → `enroll_user_in_run`** (`helpers.py:112`). Cross-module helper shouldn't have leading underscore.
2. **Replace `_has_submissions(run)` stub with real implementation** in `helpers.py`. Used by:
   - `runs.py:patch_run` — existing end_date-lowering check (Phase 7a hook returned False)
   - `runs.py:delete_run` — new check from Phase 7b's run-delete tightening
3. **Add `# TODO(phase 9)` race comments** at `run_roster.py:patch_student` capacity check and `runs.py` publish-gate (currently only at `helpers.py:_enroll_user_in_run`).
4. **Collapse `require_run_admin_or_teacher`** to take a loaded `Run` object (matching `require_course_admin_for_run`'s shape — `helpers.py:71`). Eliminates redundant `db.get(Run)` calls in routers.

Phase 7a item #5 (`run_teachers.py:add_teacher` SELECT-then-INSERT alignment) is purely cosmetic and unrelated to Phase 7b — left for a focused cleanup later.

## Migration Strategy

One Alembic migration adding five tables: `mini_projects`, `submissions`, `evaluations`, `run_assets`, `run_asset_references`. SQLite-compatible: all new tables, no `batch_alter_table` required. CHECK constraints declared inline. Designed to apply cleanly on Postgres.

Migration file: `<rev>_add_mini_projects_submissions_evaluations.py`.

## Testing Strategy

Test files (TDD, mirroring Phase 7a structure):

| File | Coverage |
|---|---|
| `tests/test_mini_projects.py` | CRUD, publish/unpublish gate, edit rules, lock semantics post-submission, force-unpublish |
| `tests/test_run_assets.py` | Upload, list, serve, delete, reference tracking via assignment_md, force-delete-when-referenced |
| `tests/test_submissions.py` | Initial vs resubmission flow, deadline enforcement, file storage layout, filename sanitization, late detection, cross-run integrity, group-member auth, retry-on-IntegrityError |
| `tests/test_evaluations.py` | Evaluate with each result, feedback_file mandatory unless accepted, score validation, auto-accept for resubmissions, dual-evaluate race |
| `tests/test_mini_project_notifications.py` | `evaluation_received` notification rows written |
| Existing `tests/test_runs.py` extension | Run delete tightening (students-block, submissions-block, force) |
| Existing `tests/test_groups.py` extension | Group delete blocked by submissions |

Use existing `admin_client`, `auth_client`, `teacher_client`, and `seed_publishable_version` fixtures from `conftest.py`. Add `seed_run_with_groups` fixture that stages a published run with one group of two students. Test count delta target: ~50-70 tests.

## Open Questions / Deferred to 7c / Phase 9

- **Bulk operations** (move multiple students between groups, bulk submission download, ZIP export of all submissions): deferred to 7c.
- **Student-facing mini-project view** (`/api/runs/{rid}/my-mini-projects`, my-submissions, my-evaluations): deferred to 7c.
- **Scheduled deadline-approaching notifications** (soft / hard / resubmission): deferred to Phase 9 with the email scheduler.
- **Teacher summary email** (after soft deadline): deferred to Phase 9.
- **`INDEX evaluations.result`** for dashboard aggregation: deferred to 7c when actual query patterns are known.
- **SQLite-portable concurrency (SAVEPOINT-based)**: deferred to Phase 9 SAVEPOINT cleanup.
- **Phase 7a item #5** (`run_teachers.py` SELECT-then-INSERT pattern alignment): deferred to a focused cleanup later.

## Implementation Sequence (preview for the plan)

1. Models + migration (MiniProject, Submission, Evaluation, RunAsset, RunAssetReference)
2. Phase 7a cleanup: rename `_enroll_user_in_run`, replace `_has_submissions` stub, collapse `require_run_admin_or_teacher` signature, add Phase 9 TODO race markers
3. Schemas (MiniProjectCreate/Update/Response, SubmissionResponse, EvaluationCreate/Update/Response, RunAssetResponse)
4. RunAsset endpoints (parallel to Phase 6 assets, run-scoped)
5. `render_with_run_assets` and `sync_run_asset_references` helpers
6. Mini-project CRUD endpoints + publish/unpublish + lock semantics
7. Submission endpoint with deadline/lifecycle gates
8. Evaluation endpoint + auto-accept on resubmission
9. `evaluation_received` notification row writes
10. Run-delete tightening + group-delete extension (both with force flag)
11. File-storage helpers (filename builders, path defenses) wired through endpoints
12. Final regression sweep against Phase 6/7a baseline

Each step is its own commit with TDD red-green cycle.
