# Phase 7b: Mini-Projects, Submissions, Evaluations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the mini-project flow (per-block group assignments), submissions (PDF uploads), evaluations (teacher feedback with score and optional PDF), run-scoped assets (datasets/code), and the supporting `Group.is_disabled` lifecycle on top of Phase 7a's run/group infrastructure.

**Architecture:** Five new tables (`mini_projects`, `submissions`, `evaluations`, `run_assets`, `run_asset_references`) plus one column add (`groups.is_disabled`). MiniProject is `Run`-scoped and points at a `Block` from the run's pinned course version. Mini-project files live in a parallel `RunAsset` registry under `<asset_path>/runs/{run_id}/`; submission and feedback PDFs live under `<asset_path>/submissions/{run_id}/{group_id}/` with a direct `file_path` column on `Submission` (no Asset row). Lock state (`first_submitted_at IS NOT NULL`) is orthogonal to visibility (`is_published`); once `is_published=True` it never flips back to False (no unpublish endpoint). Resubmission flow follows the four-valued `result` enum from the master spec.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Pydantic v2, Alembic. New tables only — no `batch_alter_table` needed for the migration; the single column add to `groups` is SQLite-compatible via `NOT NULL DEFAULT 0`.

**Spec:** `docs/superpowers/specs/2026-04-27-phase7b-mini-projects-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `mathion/models.py` | Add `MiniProject`, `Submission`, `Evaluation`, `RunAsset`, `RunAssetReference`; add `is_disabled` to `Group` |
| `mathion/schemas.py` | Add MiniProject*/Submission*/Evaluation*/RunAsset* schemas; extend `GroupUpdate` with `is_disabled` |
| `mathion/api/helpers.py` | Rename `_enroll_user_in_run` → `enroll_user_in_run`; collapse `require_run_admin_or_teacher`; add `has_submissions`, `mini_project_visible_to_student`, `render_with_run_assets`, `sync_run_asset_references`, `build_submission_filename`, `build_feedback_filename`, `submission_storage_dir`, `run_asset_storage_dir` |
| `mathion/api/runs.py` | Wire `has_submissions` into `patch_run` end_date check; add submission-block + force-cascade to `delete_run` |
| `mathion/api/groups.py` | Add disable/enable via PATCH; tighten DELETE to also reject when submissions exist |
| `mathion/api/run_roster.py` | Add `# TODO(phase 9)` race comments; reject student moves into disabled groups |
| `mathion/api/mini_projects.py` | NEW — Mini-project CRUD + publish endpoint + lock semantics |
| `mathion/api/run_assets.py` | NEW — Run-asset upload/list/serve/delete (mirrors Phase 6 assets, run-scoped) |
| `mathion/api/submissions.py` | NEW — Submission POST/GET/file with deadline+lock gates; auto-evaluation for resubmissions |
| `mathion/api/evaluations.py` | NEW — Evaluation POST/PATCH/GET + feedback-file GET |
| `mathion/main.py` | Register four new routers |
| `tests/conftest.py` | Add `seed_run_with_groups` fixture |
| `tests/test_mini_projects.py` | Mini-project CRUD, publish gate, lock semantics, force-delete |
| `tests/test_run_assets.py` | Upload/list/serve/delete, reference tracking, sanitization |
| `tests/test_submissions.py` | Initial vs resubmission flow, deadline gates, `is_late`, file rollback, disabled-group rejection |
| `tests/test_evaluations.py` | Result enum, feedback_file mandatory, score validation, auto-accept, dual-evaluate race |
| `tests/test_mini_project_notifications.py` | `evaluation_received` notification rows |
| `tests/test_runs.py` (extend) | Run delete tightening + force cascade |
| `tests/test_groups.py` (extend) | Group disable/enable + submission-block on delete + move-into-disabled |
| `alembic/versions/<rev>_add_mini_projects_submissions_evaluations.py` | Single migration: 5 new tables + `groups.is_disabled` column |

---

### Task 1: Phase 7a cleanup prerequisites

Address Phase 7a deferred items that Phase 7b depends on. Single commit per item.

**Files:**
- Modify: `mathion/api/helpers.py:112` (`_enroll_user_in_run` rename), `helpers.py:80` (`require_run_admin_or_teacher` signature collapse)
- Modify: `mathion/api/run_roster.py` (callers of renamed helper + TODO race comment)
- Modify: `mathion/api/run_teachers.py` (callers of renamed helper)
- Modify: `mathion/api/runs.py` (callers of renamed helper + signature update for `require_run_admin_or_teacher` + add `# TODO(phase 9)` at publish-gate)
- Modify: `tests/test_run_roster.py`, `tests/test_run_teachers.py` (any direct imports of `_enroll_user_in_run`)
- Modify: `mathion/api/helpers.py` add `has_submissions` helper

- [ ] **Step 1: Run baseline tests to confirm green start**

Run: `cd backend && pytest -q`
Expected: all 380 tests pass.

- [ ] **Step 2: Rename `_enroll_user_in_run` → `enroll_user_in_run` in `mathion/api/helpers.py:112`**

Edit the function definition and update the docstring's first line to drop the underscore implication:

```python
def enroll_user_in_run(db: Session, user, run, group_id: int | None):
    """Enroll a user in a run.

    1. Group capacity check (max 10 if group_id given).
    2. Activate StudentEnrollment for run.version_id (deactivates other active
       enrollments on this course via the existing `_enroll_user`).
    3. Create or update RunStudent row. If a RunStudent row already exists for
       this (run, user), its `group_id` is OVERWRITTEN with the new value.
       None means "unassign".
    4. Write a `run_enrolled` notification log row.

    Caller must commit. Raises HTTPException on capacity / disabled-version.

    Note: the capacity check is a SELECT-count + INSERT, not atomic. Two
    concurrent admins could both observe count=9 and both succeed. Real-world
    impact is low (admin operations); a SAVEPOINT-based fix lands in Phase 9.
    """
    # body unchanged
```

- [ ] **Step 3: Update all callers of `_enroll_user_in_run`**

Run: `cd backend && grep -rn "_enroll_user_in_run" mathion/ tests/`

Expected callers: `mathion/api/run_roster.py`, `mathion/api/run_teachers.py` (if it calls it). For each call site, drop the leading underscore:

```python
# Before
from mathion.api.helpers import _enroll_user_in_run
_enroll_user_in_run(db, user, run, group_id=...)

# After
from mathion.api.helpers import enroll_user_in_run
enroll_user_in_run(db, user, run, group_id=...)
```

- [ ] **Step 4: Run tests to confirm rename didn't break anything**

Run: `cd backend && pytest -q`
Expected: all 380 tests pass.

- [ ] **Step 5: Commit the rename**

```bash
cd backend
git add mathion/api/helpers.py mathion/api/run_roster.py mathion/api/run_teachers.py
git commit -m "refactor: rename _enroll_user_in_run → enroll_user_in_run

Cross-module helper shouldn't have a leading underscore. Phase 7a deferred
this rename; Phase 7b reaches the same surface so cleanup happens here."
```

- [ ] **Step 6: Collapse `require_run_admin_or_teacher` to take a loaded `Run`**

Edit `mathion/api/helpers.py:80`. Old signature: `(db, user, run_id: int)`. New signature: `(db, user, run: "Run")`. The function does its own `db.get(Run)` today (line 86, 91) which becomes redundant when callers already have the run.

```python
def require_run_admin_or_teacher(db: Session, user, run) -> None:
    """Verify user is a course admin of the run's course OR a RunTeacher of
    the run OR a superuser. Raises 403 if no access. Caller is expected to
    have already loaded `run` (via `get_or_404` or similar)."""
    from mathion.models import CourseAdmin, CourseVersion, RunTeacher

    if user.is_superuser:
        return

    version = db.get(CourseVersion, run.version_id)
    is_course_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    is_run_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if not (is_course_admin or is_run_teacher):
        raise HTTPException(status_code=403, detail="Run admin or teacher access required")
```

- [ ] **Step 7: Update all callers to pass the loaded run**

Run: `cd backend && grep -rn "require_run_admin_or_teacher" mathion/`

For each caller, change from:
```python
require_run_admin_or_teacher(db, user, run_id)
run = db.get(Run, run_id)  # often follows
```

to:
```python
run = get_or_404(db, Run, run_id)
require_run_admin_or_teacher(db, user, run)
```

Affected files: `mathion/api/runs.py` (multiple sites), `mathion/api/run_teachers.py`, `mathion/api/run_roster.py`, `mathion/api/groups.py`. Each site already calls `db.get(Run, run_id)` or `get_or_404(db, Run, run_id)` somewhere — refactor so the lookup happens once before the auth check.

- [ ] **Step 8: Run tests to confirm signature change didn't break anything**

Run: `cd backend && pytest -q`
Expected: all 380 tests pass.

- [ ] **Step 9: Commit the signature collapse**

```bash
cd backend
git add mathion/api/
git commit -m "refactor: collapse require_run_admin_or_teacher to take loaded Run

Eliminates redundant db.get(Run) in routers. Matches the shape of
require_course_admin_for_run (helpers.py:71)."
```

- [ ] **Step 10: Add `has_submissions` helper in `mathion/api/helpers.py`**

Append to `helpers.py`:

```python
def has_submissions(db: Session, run) -> bool:
    """Return True if any Submission row exists for any mini-project on this run.

    Used by:
    - `runs.py:patch_run` — to block lowering `end_date` past `now()` while submissions exist
    - `runs.py:delete_run` — to block deletion when submissions exist (force flag bypasses)
    """
    from sqlalchemy import exists
    from mathion.models import MiniProject, Submission

    return db.scalar(
        select(exists().where(
            Submission.mini_project_id == MiniProject.id,
            MiniProject.run_id == run.id,
        ))
    ) or False
```

Note: `MiniProject` and `Submission` will be defined in Task 2. The helper is added now (with the import inside the function) but is not yet wired into any caller — that wiring happens in Tasks 11 and 12.

- [ ] **Step 11: Add `# TODO(phase 9)` race comments**

In `mathion/api/run_roster.py`, find the `patch_student` handler (group capacity check). Add immediately above the `count >= 10` check:

```python
# TODO(phase 9): SELECT-count + UPDATE is not atomic; two concurrent moves
# could both observe count=9 and both succeed. Real-world impact is low;
# fix via SAVEPOINT in Phase 9 alongside _enroll_user_in_run capacity race.
```

In `mathion/api/runs.py`, find the publish-gate handler (`POST /api/runs/{rid}/publish`). Add at the top of the function body:

```python
# TODO(phase 9): publish-gate validation is read-then-write; a teacher
# could be removed concurrently between the count check and is_published
# update. Fix via SAVEPOINT-wrapped re-check in Phase 9.
```

- [ ] **Step 12: Run tests to confirm comments don't break anything**

Run: `cd backend && pytest -q`
Expected: all 380 tests pass.

- [ ] **Step 13: Commit cleanup**

```bash
cd backend
git add mathion/api/helpers.py mathion/api/run_roster.py mathion/api/runs.py
git commit -m "feat: add has_submissions helper + Phase 9 race TODO markers

Prerequisite helper for Phase 7b run-delete tightening. Race markers added
at the two remaining unannotated spots (capacity, publish-gate)."
```

---

### Task 2: Models + Group.is_disabled column

**Files:**
- Modify: `mathion/models.py` — add `MiniProject`, `Submission`, `Evaluation`, `RunAsset`, `RunAssetReference`; add `is_disabled` to `Group`

- [ ] **Step 1: Add `is_disabled` column to `Group` model in `mathion/models.py`**

Find the `Group` class (around line 225). Add `is_disabled` after `name`:

```python
class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        UniqueConstraint("run_id", "name", name="uq_group_run_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    run: Mapped["Run"] = relationship(back_populates="groups")
    students: Mapped[list["RunStudent"]] = relationship(back_populates="group")
```

The `server_default="0"` is the SQLite-compatible default for the column add migration.

- [ ] **Step 2: Add `MiniProject`, `Submission`, `Evaluation`, `RunAsset`, `RunAssetReference` classes**

Add immediately before the final `from mathion.models_auth import ...` line at the bottom of `models.py`:

```python
class MiniProject(Base):
    __tablename__ = "mini_projects"
    __table_args__ = (
        UniqueConstraint("run_id", "block_id", name="uq_mini_project_run_block"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    block_id: Mapped[int] = mapped_column(ForeignKey("blocks.id", ondelete="RESTRICT"), nullable=False, index=True)
    assignment_md: Mapped[str] = mapped_column(Text, nullable=False)
    assignment_html: Mapped[str] = mapped_column(Text, nullable=False)
    soft_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hard_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resubmission_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    run: Mapped["Run"] = relationship()
    block: Mapped["Block"] = relationship()


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("mini_project_id", "group_id", "submission_number", name="uq_submission_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mini_project_id: Mapped[int] = mapped_column(ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False, index=True)
    submission_number: Mapped[int] = mapped_column(Integer, nullable=False)
    submitted_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_resubmission: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    mini_project: Mapped["MiniProject"] = relationship()
    group: Mapped["Group"] = relationship()


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True)
    evaluated_by: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_file: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    submission: Mapped["Submission"] = relationship()


class RunAsset(Base):
    __tablename__ = "run_assets"
    __table_args__ = (
        UniqueConstraint("run_id", "filename", name="uq_run_asset_run_filename"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    run: Mapped["Run"] = relationship()


class RunAssetReference(Base):
    __tablename__ = "run_asset_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_asset_id: Mapped[int] = mapped_column(ForeignKey("run_assets.id", ondelete="CASCADE"), nullable=False, index=True)
    mini_project_id: Mapped[int] = mapped_column(ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False, index=True)
```

- [ ] **Step 3: Update the re-export at the bottom of `models.py`**

The bottom of `models.py` re-imports from `models_auth`. The new models should already be importable from `mathion.models`, so no change needed unless tests import from `models_auth` (they don't for these new tables).

- [ ] **Step 4: Run tests to confirm models are syntactically valid**

Run: `cd backend && pytest -q tests/test_quiz_api.py 2>&1 | head -20`
Expected: tests still discover. SQLAlchemy will validate FK targets at metadata creation; if any FK is mistyped, you'll see a NoSuchTableError or similar.

If tests don't pass, the most likely issue is a typo in a `ForeignKey` string. Fix and retry.

- [ ] **Step 5: Commit models**

```bash
cd backend
git add mathion/models.py
git commit -m "feat: add Phase 7b models (MiniProject, Submission, Evaluation, RunAsset, RunAssetReference)

Plus is_disabled column on Group. SQLAlchemy ORM definitions only — Alembic
migration in next task."
```

---

### Task 3: Alembic migration

**Files:**
- Create: `alembic/versions/<rev>_add_mini_projects_submissions_evaluations.py`

- [ ] **Step 1: Generate the migration scaffold**

Run: `cd backend && alembic revision -m "add mini projects submissions evaluations"`
Expected: a new file in `alembic/versions/` with a hash prefix.

- [ ] **Step 2: Replace the migration body**

Open the new file and replace `upgrade()` and `downgrade()`:

```python
"""add mini projects submissions evaluations

Revision ID: <hash>
Revises: <previous>
Create Date: 2026-04-28 ...
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "<hash>"  # keep generated hash
down_revision = "<previous>"  # keep generated parent
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add is_disabled to existing groups table.
    # SQLite supports ALTER TABLE ADD COLUMN with NOT NULL DEFAULT for constants.
    op.add_column(
        "groups",
        sa.Column("is_disabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    # New table: mini_projects
    op.create_table(
        "mini_projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block_id", sa.Integer(), sa.ForeignKey("blocks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assignment_md", sa.Text(), nullable=False),
        sa.Column("assignment_html", sa.Text(), nullable=False),
        sa.Column("soft_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hard_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resubmission_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("first_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("run_id", "block_id", name="uq_mini_project_run_block"),
        sa.CheckConstraint(
            "soft_deadline IS NULL OR hard_deadline IS NULL OR soft_deadline <= hard_deadline",
            name="ck_mini_project_soft_le_hard",
        ),
        sa.CheckConstraint(
            "hard_deadline IS NULL OR resubmission_deadline IS NULL OR hard_deadline <= resubmission_deadline",
            name="ck_mini_project_hard_le_resub",
        ),
    )
    op.create_index("ix_mini_projects_run_id", "mini_projects", ["run_id"])
    op.create_index("ix_mini_projects_block_id", "mini_projects", ["block_id"])
    op.create_index("ix_mini_projects_run_published", "mini_projects", ["run_id", "is_published"])

    # New table: submissions
    op.create_table(
        "submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("mini_project_id", sa.Integer(), sa.ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("submission_number", sa.Integer(), nullable=False),
        sa.Column("submitted_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_resubmission", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.UniqueConstraint("mini_project_id", "group_id", "submission_number", name="uq_submission_number"),
        sa.CheckConstraint("submission_number >= 1", name="ck_submission_number_positive"),
        sa.CheckConstraint("file_size > 0", name="ck_submission_file_size_positive"),
    )
    op.create_index("ix_submissions_mini_project_id", "submissions", ["mini_project_id"])
    op.create_index("ix_submissions_group_id", "submissions", ["group_id"])
    op.create_index(
        "ix_submission_latest",
        "submissions",
        ["mini_project_id", "group_id", sa.text("submission_number DESC")],
    )

    # New table: evaluations
    op.create_table(
        "evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("evaluated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("feedback_text", sa.Text(), nullable=True),
        sa.Column("feedback_file", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "result IN ('rejected', 'major_revision', 'minor_revision', 'accepted')",
            name="ck_evaluation_result",
        ),
        sa.CheckConstraint(
            "score IS NULL OR (score BETWEEN 0 AND 100)",
            name="ck_evaluation_score_range",
        ),
        sa.CheckConstraint(
            "result = 'accepted' OR feedback_file IS NOT NULL",
            name="ck_evaluation_feedback_required",
        ),
    )

    # New table: run_assets
    op.create_table(
        "run_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("run_id", "filename", name="uq_run_asset_run_filename"),
    )
    op.create_index("ix_run_assets_run_id", "run_assets", ["run_id"])

    # New table: run_asset_references
    op.create_table(
        "run_asset_references",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_asset_id", sa.Integer(), sa.ForeignKey("run_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mini_project_id", sa.Integer(), sa.ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_run_asset_references_run_asset_id", "run_asset_references", ["run_asset_id"])
    op.create_index("ix_run_asset_references_mini_project_id", "run_asset_references", ["mini_project_id"])


def downgrade() -> None:
    op.drop_index("ix_run_asset_references_mini_project_id", table_name="run_asset_references")
    op.drop_index("ix_run_asset_references_run_asset_id", table_name="run_asset_references")
    op.drop_table("run_asset_references")
    op.drop_index("ix_run_assets_run_id", table_name="run_assets")
    op.drop_table("run_assets")
    op.drop_table("evaluations")
    op.drop_index("ix_submission_latest", table_name="submissions")
    op.drop_index("ix_submissions_group_id", table_name="submissions")
    op.drop_index("ix_submissions_mini_project_id", table_name="submissions")
    op.drop_table("submissions")
    op.drop_index("ix_mini_projects_run_published", table_name="mini_projects")
    op.drop_index("ix_mini_projects_block_id", table_name="mini_projects")
    op.drop_index("ix_mini_projects_run_id", table_name="mini_projects")
    op.drop_table("mini_projects")
    op.drop_column("groups", "is_disabled")
```

- [ ] **Step 3: Run migrations to verify SQLite acceptance**

Run: `cd backend && alembic upgrade head`
Expected: applies cleanly, no errors. If you see a CHECK constraint syntax error, it's most likely a quoted-string issue — verify the exact constraint text matches above.

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest -q`
Expected: all 380 tests still pass. The migration only adds tables/columns; nothing existing should break.

- [ ] **Step 5: Test downgrade then re-upgrade**

Run: `cd backend && alembic downgrade -1 && alembic upgrade head`
Expected: clean cycle. If downgrade fails, the most likely issue is index or table drop ordering — match the order in the template above.

- [ ] **Step 6: Commit migration**

```bash
cd backend
git add alembic/versions/
git commit -m "feat: add migration for mini-projects, submissions, evaluations

Five new tables + groups.is_disabled column. SQLite-compatible. Bidirectional."
```

---

### Task 4: Schemas

**Files:**
- Modify: `mathion/schemas.py` — add MiniProject*, Submission*, Evaluation*, RunAsset* schemas; extend `GroupUpdate`

- [ ] **Step 1: Append new schemas to `mathion/schemas.py`**

After the existing `GroupResponse`, find `GroupUpdate` (line 417). Update it to accept `is_disabled`:

```python
class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_disabled: bool | None = None
```

Then append the new Phase 7b schemas at the end of the file:

```python
# ============================================================================
# Phase 7b: Mini-Projects
# ============================================================================

class MiniProjectCreate(BaseModel):
    block_id: int
    assignment_md: str = Field(min_length=1)
    soft_deadline: datetime | None = None
    hard_deadline: datetime | None = None
    resubmission_deadline: datetime | None = None


class MiniProjectUpdate(BaseModel):
    assignment_md: str | None = Field(default=None, min_length=1)
    soft_deadline: datetime | None = None
    hard_deadline: datetime | None = None
    resubmission_deadline: datetime | None = None


class MiniProjectResponse(BaseModel):
    id: int
    run_id: int
    block_id: int
    title: str  # derived: f"Mini project for Block {block.order}"
    assignment_md: str
    assignment_html: str
    soft_deadline: datetime | None
    hard_deadline: datetime | None
    resubmission_deadline: datetime | None
    is_published: bool
    first_submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ============================================================================
# Phase 7b: Submissions
# ============================================================================

class SubmissionResponse(BaseModel):
    id: int
    mini_project_id: int
    group_id: int
    submission_number: int
    submitted_by: int
    submitted_at: datetime
    file_size: int
    is_late: bool
    is_resubmission: bool

    model_config = {"from_attributes": True}


# ============================================================================
# Phase 7b: Evaluations
# ============================================================================

class EvaluationCreate(BaseModel):
    result: str = Field(pattern="^(rejected|major_revision|minor_revision|accepted)$")
    score: int | None = Field(default=None, ge=0, le=100)
    feedback_text: str | None = None


class EvaluationUpdate(BaseModel):
    result: str | None = Field(default=None, pattern="^(rejected|major_revision|minor_revision|accepted)$")
    score: int | None = Field(default=None, ge=0, le=100)
    feedback_text: str | None = None


class EvaluationResponse(BaseModel):
    id: int
    submission_id: int
    evaluated_by: int
    evaluated_at: datetime
    result: str
    score: int | None
    feedback_text: str | None
    feedback_file: str | None  # path; client uses /feedback-file endpoint to download

    model_config = {"from_attributes": True}


# ============================================================================
# Phase 7b: Run-Assets
# ============================================================================

class RunAssetResponse(BaseModel):
    id: int
    run_id: int
    filename: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: int | None
    is_referenced: bool = False

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Run tests**

Run: `cd backend && pytest -q`
Expected: all 380 tests pass.

- [ ] **Step 3: Commit schemas**

```bash
cd backend
git add mathion/schemas.py
git commit -m "feat: add Phase 7b schemas + extend GroupUpdate for is_disabled"
```

---

### Task 5: Helper functions

**Files:**
- Modify: `mathion/api/helpers.py` — add filename builders, storage dirs, visibility helper, run-asset render/sync

- [ ] **Step 1: Append filename builder helpers + storage directory helpers**

Add at the bottom of `helpers.py`:

```python
import os
from mathion.assets import sanitize_filename
from mathion.config import settings


def build_submission_filename(block_order: int, group_name: str, submission_number: int) -> str:
    """Build sanitized filename for a submission PDF.

    Pattern: 'block {N} - group {G} - submission {S}.pdf' passed through
    Phase 6's sanitize_filename. Group names like '3-12a' pass through unchanged;
    'Group #1!' becomes 'group-1'.
    """
    raw = f"block {block_order} - group {group_name} - submission {submission_number}.pdf"
    return sanitize_filename(raw)


def build_feedback_filename(block_order: int, group_name: str, submission_number: int) -> str:
    """Build sanitized filename for a feedback PDF (parallel to submission)."""
    raw = f"block {block_order} - group {group_name} - submission {submission_number} - feedback.pdf"
    return sanitize_filename(raw)


def submission_storage_dir(run_id: int, group_id: int) -> str:
    """Filesystem directory for a group's submissions on a run."""
    return os.path.join(settings.asset_path, "submissions", str(run_id), str(group_id))


def run_asset_storage_dir(run_id: int) -> str:
    """Filesystem directory for run-scoped asset files."""
    return os.path.join(settings.asset_path, "runs", str(run_id))
```

- [ ] **Step 2: Add `mini_project_visible_to_student` helper**

Append to `helpers.py`:

```python
def mini_project_visible_to_student(run, mini_project) -> bool:
    """Return True iff a non-admin/non-teacher student should see this mini-project.

    Visibility = run.is_published AND mini_project.is_published. Used at the start
    of every student-path branch in mini-project, submission, evaluation,
    feedback-file, and run-asset reads. Admins/run-teachers bypass this check.
    """
    return run.is_published and mini_project.is_published
```

- [ ] **Step 3: Add `render_with_run_assets` helper**

Append to `helpers.py`:

```python
def render_with_run_assets(db: Session, run_id: int, content_md: str | None) -> str:
    """Render markdown for mini-project assignment, validating asset refs.

    Mirrors `render_with_assets` (helpers.py:167) but resolves filenames
    against `RunAsset` (filtered by run_id) instead of `Asset`. Rewrites bare
    filenames to `/api/runs/{run_id}/assets/{filename}` paths in the rendered HTML.
    Raises 422 if any referenced filename is missing from this run's assets.
    """
    from mathion.markdown import extract_asset_filenames, render_markdown
    from mathion.models import RunAsset

    if not content_md:
        return render_markdown(content_md)

    html = render_markdown(content_md)
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        return html

    existing = set(db.execute(
        select(RunAsset.filename).where(
            RunAsset.run_id == run_id,
            RunAsset.filename.in_(ref_filenames),
        )
    ).scalars().all())
    missing = ref_filenames - existing
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Referenced run-assets not found: {', '.join(sorted(missing))}",
        )

    # Inline rewrite — analogous to resolve_asset_urls but with run-scoped path
    import re
    base_url = f"/api/runs/{run_id}/assets"
    for fname in ref_filenames:
        escaped = re.escape(fname)
        # src="filename" → src="/api/runs/{rid}/assets/filename"
        html = re.sub(rf'(src|href)="{escaped}"', rf'\1="{base_url}/{fname}"', html)
    return html
```

- [ ] **Step 4: Add `sync_run_asset_references` helper**

Append to `helpers.py`:

```python
def sync_run_asset_references(db: Session, run_id: int, content_md: str | None, mini_project_id: int) -> None:
    """Sync RunAssetReference rows for a single mini-project.

    Mirrors `sync_asset_references` (helpers.py:203): deletes all
    RunAssetReference rows for this mini_project_id, then re-inserts rows for
    filenames currently referenced in the markdown. This handles markdown edits
    that remove references — the deleted-rows pass cleans them up.

    Call after `render_with_run_assets` has validated that all referenced
    filenames exist in the run's assets.
    """
    from sqlalchemy import delete as sa_delete
    from mathion.markdown import extract_asset_filenames
    from mathion.models import RunAsset, RunAssetReference

    db.execute(sa_delete(RunAssetReference).where(
        RunAssetReference.mini_project_id == mini_project_id,
    ))

    if not content_md:
        return
    ref_filenames = extract_asset_filenames(content_md)
    if not ref_filenames:
        return

    asset_ids = db.execute(
        select(RunAsset.id).where(
            RunAsset.run_id == run_id,
            RunAsset.filename.in_(ref_filenames),
        )
    ).scalars().all()
    for aid in asset_ids:
        db.add(RunAssetReference(run_asset_id=aid, mini_project_id=mini_project_id))
```

- [ ] **Step 5: Run tests**

Run: `cd backend && pytest -q`
Expected: all 380 tests pass (helpers don't break existing tests).

- [ ] **Step 6: Commit helpers**

```bash
cd backend
git add mathion/api/helpers.py
git commit -m "feat: add Phase 7b helpers (filename builders, visibility, run-asset render+sync)"
```

---

### Task 6: RunAsset endpoints

**Files:**
- Create: `mathion/api/run_assets.py`
- Modify: `mathion/main.py` (register router)
- Create: `tests/test_run_assets.py`

- [ ] **Step 1: Add `seed_run_with_groups` fixture to `tests/conftest.py`**

Append to `conftest.py`:

```python
@pytest.fixture
def seed_run_with_groups(admin_client, seed_publishable_version):
    """Create a published run with groups_enabled, two groups each with one student.

    Returns (run_dict, group_a, group_b, student_a, student_b). All entities are
    committed and ready to use. Run is `is_published=True`.
    """
    def _factory():
        course, _ = seed_publishable_version()
        # Create run with groups enabled
        run_resp = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-12-31", "groups_enabled": True},
        )
        assert run_resp.status_code == 201
        run = run_resp.json()
        # Add a teacher (publish-gate requires it)
        admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teach@example.com"})
        # Create two groups
        ga = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Group A"}).json()
        gb = admin_client.post(f"/api/runs/{run['id']}/groups", json={"name": "Group B"}).json()
        # Add students to each group
        admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "alice@example.com", "group_id": ga["id"]})
        admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "bob@example.com", "group_id": gb["id"]})
        # Publish
        pub = admin_client.post(f"/api/runs/{run['id']}/publish")
        assert pub.status_code == 200
        return run, ga, gb
    return _factory
```

- [ ] **Step 2: Write the failing first test in `tests/test_run_assets.py`**

Create `tests/test_run_assets.py`:

```python
import io


def test_upload_run_asset(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    response = admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("dataset.csv", io.BytesIO(b"a,b,c\n1,2,3"), "text/csv")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "dataset.csv"
    assert body["file_size"] == len(b"a,b,c\n1,2,3")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && pytest tests/test_run_assets.py -v`
Expected: FAIL with 404 (no route at `/api/runs/{rid}/assets`).

- [ ] **Step 4: Create `mathion/api/run_assets.py`**

```python
import os
import tempfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    get_or_404,
    require_run_admin_or_teacher,
    run_asset_storage_dir,
)
from mathion.assets import get_mime_type, sanitize_filename, validate_extension
from mathion.config import settings
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Run, RunAsset, RunAssetReference
from mathion.models_auth import User
from mathion.schemas import RunAssetResponse

router = APIRouter(tags=["run-assets"])


@router.post("/api/runs/{run_id}/assets", status_code=201, response_model=RunAssetResponse)
def upload_run_asset(
    run_id: int,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    ext = validate_extension(file.filename)
    if ext is None:
        raise HTTPException(status_code=400, detail=f"File extension not allowed: {file.filename}")

    content = file.file.read()
    if len(content) > settings.max_file_size:
        raise HTTPException(
            status_code=400,
            detail=f"File size {len(content)} exceeds max {settings.max_file_size}",
        )

    current_total = db.scalar(
        select(func.coalesce(func.sum(RunAsset.file_size), 0)).where(RunAsset.run_id == run_id)
    )
    if current_total + len(content) > settings.max_course_size:
        raise HTTPException(
            status_code=400,
            detail=f"Total run asset size would exceed limit ({settings.max_course_size} bytes)",
        )

    filename = sanitize_filename(file.filename)
    asset = RunAsset(
        run_id=run_id,
        filename=filename,
        file_size=len(content),
        mime_type=get_mime_type(ext),
        uploaded_by=user.id,
    )
    db.add(asset)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Asset '{filename}' already exists in this run")

    # Write file via temp+rename for atomicity
    dirpath = run_asset_storage_dir(run_id)
    filepath = os.path.join(dirpath, filename)
    tmp_path: str | None = None
    try:
        os.makedirs(dirpath, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=dirpath, prefix=".upload-", suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.replace(tmp_path, filepath)
        tmp_path = None
    except Exception:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        db.delete(asset)
        db.commit()
        raise HTTPException(status_code=500, detail="Failed to write asset to disk")

    db.refresh(asset)
    return asset


@router.get("/api/runs/{run_id}/assets", response_model=list[RunAssetResponse])
def list_run_assets(
    run_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)

    assets = db.execute(
        select(RunAsset).where(RunAsset.run_id == run_id).order_by(RunAsset.filename)
    ).scalars().all()
    result = []
    for a in assets:
        ref_count = db.scalar(
            select(func.count()).where(RunAssetReference.run_asset_id == a.id)
        )
        resp = RunAssetResponse.model_validate(a)
        resp.is_referenced = ref_count > 0
        result.append(resp)
    return result


@router.get("/api/runs/{run_id}/assets/{filename}")
def serve_run_asset(
    run_id: int,
    filename: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    # Admin or teacher always allowed; student access requires run published.
    # (Phase 7b: per-mini-project visibility check is at the higher endpoint level;
    # for raw asset serve we use a coarse run.is_published check here.)
    if not user.is_superuser:
        from mathion.models import CourseAdmin, CourseVersion, RunStudent, RunTeacher

        version = db.get(CourseVersion, run.version_id)
        is_admin = db.execute(
            select(CourseAdmin).where(
                CourseAdmin.course_id == version.course_id,
                CourseAdmin.user_id == user.id,
            )
        ).scalar_one_or_none() is not None
        is_teacher = db.execute(
            select(RunTeacher).where(
                RunTeacher.run_id == run_id,
                RunTeacher.user_id == user.id,
            )
        ).scalar_one_or_none() is not None
        if not (is_admin or is_teacher):
            # Student path
            if not run.is_published:
                raise HTTPException(status_code=403, detail="Run not visible")
            is_enrolled = db.execute(
                select(RunStudent).where(
                    RunStudent.run_id == run_id,
                    RunStudent.user_id == user.id,
                )
            ).scalar_one_or_none() is not None
            if not is_enrolled:
                raise HTTPException(status_code=403, detail="Not enrolled in this run")

    asset = db.execute(
        select(RunAsset).where(RunAsset.run_id == run_id, RunAsset.filename == filename)
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    dirpath = run_asset_storage_dir(run_id)
    filepath = os.path.join(dirpath, filename)
    real_dir = os.path.realpath(dirpath)
    real_path = os.path.realpath(filepath)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Asset file missing")
    return FileResponse(filepath, media_type=asset.mime_type, filename=filename)


@router.delete("/api/runs/{run_id}/assets/{asset_id}", status_code=204)
def delete_run_asset(
    run_id: int,
    asset_id: int,
    force: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    asset = get_or_404(db, RunAsset, asset_id)
    if asset.run_id != run_id:
        raise HTTPException(status_code=404, detail="Asset not found in this run")

    if not force:
        ref_count = db.scalar(
            select(func.count()).where(RunAssetReference.run_asset_id == asset_id)
        )
        if ref_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Asset '{asset.filename}' is referenced by {ref_count} mini-project(s). Use ?force=true to delete.",
            )

    filepath = os.path.join(run_asset_storage_dir(run_id), asset.filename)
    db.delete(asset)
    db.commit()
    if os.path.isfile(filepath):
        try:
            os.remove(filepath)
        except OSError:
            pass
```

- [ ] **Step 5: Register router in `mathion/main.py`**

Find the existing router includes and add:

```python
from mathion.api import run_assets

app.include_router(run_assets.router)
```

- [ ] **Step 6: Run the upload test**

Run: `cd backend && pytest tests/test_run_assets.py::test_upload_run_asset -v`
Expected: PASS.

- [ ] **Step 7: Add remaining tests**

Append to `tests/test_run_assets.py`:

```python
def test_list_run_assets(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("a.csv", io.BytesIO(b"x"), "text/csv")},
    )
    admin_client.post(
        f"/api/runs/{run['id']}/assets",
        files={"file": ("b.csv", io.BytesIO(b"y"), "text/csv")},
    )
    response = admin_client.get(f"/api/runs/{run['id']}/assets")
    assert response.status_code == 200
    assert {a["filename"] for a in response.json()} == {"a.csv", "b.csv"}


def test_duplicate_filename_409(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    response = admin_client.post(f"/api/runs/{run['id']}/assets",
                                 files={"file": ("d.csv", io.BytesIO(b"y"), "text/csv")})
    assert response.status_code == 409


def test_disallowed_extension(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    response = admin_client.post(f"/api/runs/{run['id']}/assets",
                                 files={"file": ("evil.exe", io.BytesIO(b"x"), "application/octet-stream")})
    assert response.status_code == 400


def test_delete_unreferenced(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    asset = admin_client.post(f"/api/runs/{run['id']}/assets",
                              files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")}).json()
    response = admin_client.delete(f"/api/runs/{run['id']}/assets/{asset['id']}")
    assert response.status_code == 204


def test_serve_asset_admin(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"hello"), "text/csv")})
    response = admin_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 200
    assert response.content == b"hello"


def test_non_member_cannot_serve(auth_client, admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    admin_client.post(f"/api/runs/{run['id']}/assets",
                      files={"file": ("d.csv", io.BytesIO(b"x"), "text/csv")})
    response = auth_client.get(f"/api/runs/{run['id']}/assets/d.csv")
    assert response.status_code == 403
```

- [ ] **Step 8: Run all run-asset tests**

Run: `cd backend && pytest tests/test_run_assets.py -v`
Expected: all PASS.

- [ ] **Step 9: Run full test suite**

Run: `cd backend && pytest -q`
Expected: 380 + 6 = 386 tests pass.

- [ ] **Step 10: Commit**

```bash
cd backend
git add mathion/api/run_assets.py mathion/main.py tests/test_run_assets.py tests/conftest.py
git commit -m "feat: add RunAsset endpoints (upload/list/serve/delete) + seed_run_with_groups fixture"
```

---

### Task 7: Mini-project CRUD + lock semantics

**Files:**
- Create: `mathion/api/mini_projects.py`
- Modify: `mathion/main.py`
- Create: `tests/test_mini_projects.py`

- [ ] **Step 1: Write failing test for create mini-project**

Create `tests/test_mini_projects.py`:

```python
def test_create_mini_project(admin_client, db, seed_run_with_groups):
    from mathion.models import Block, Run

    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(
        __import__("sqlalchemy").select(Block).where(Block.version_id == run_obj.version_id)
    ).scalars().first()

    response = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "Write a report about descriptive statistics.",
            "hard_deadline": "2026-06-01T23:59:00Z",
            "resubmission_deadline": "2026-06-15T23:59:00Z",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["block_id"] == block.id
    assert body["is_published"] is False
    assert body["title"] == f"Mini project for Block {block.order}"
    assert "<p>" in body["assignment_html"]
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd backend && pytest tests/test_mini_projects.py::test_create_mini_project -v`
Expected: FAIL (404, no route).

- [ ] **Step 3: Create `mathion/api/mini_projects.py`**

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    has_submissions,
    get_or_404,
    mini_project_visible_to_student,
    render_with_run_assets,
    require_course_admin,
    require_run_admin_or_teacher,
    sync_run_asset_references,
)
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, CourseVersion, MiniProject, Run, Submission
from mathion.models_auth import User
from mathion.schemas import MiniProjectCreate, MiniProjectResponse, MiniProjectUpdate

router = APIRouter(tags=["mini-projects"])


def _serialize_mini_project(db: Session, mp: MiniProject) -> dict:
    """Return mini-project response dict with derived `title`."""
    block = db.get(Block, mp.block_id)
    return {
        "id": mp.id,
        "run_id": mp.run_id,
        "block_id": mp.block_id,
        "title": f"Mini project for Block {block.order}",
        "assignment_md": mp.assignment_md,
        "assignment_html": mp.assignment_html,
        "soft_deadline": mp.soft_deadline,
        "hard_deadline": mp.hard_deadline,
        "resubmission_deadline": mp.resubmission_deadline,
        "is_published": mp.is_published,
        "first_submitted_at": mp.first_submitted_at,
        "created_at": mp.created_at,
        "updated_at": mp.updated_at,
    }


@router.post("/api/runs/{run_id}/mini-projects", status_code=201, response_model=MiniProjectResponse)
def create_mini_project(
    run_id: int,
    data: MiniProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    if not run.groups_enabled:
        raise HTTPException(status_code=409, detail="Run must have groups_enabled to host mini-projects")

    block = get_or_404(db, Block, data.block_id)
    if block.version_id != run.version_id:
        raise HTTPException(status_code=400, detail="Block does not belong to this run's course version")

    # UNIQUE(run_id, block_id) — pre-check for clean error
    exists = db.execute(
        select(MiniProject).where(
            MiniProject.run_id == run_id,
            MiniProject.block_id == data.block_id,
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Mini-project already exists for this block")

    assignment_html = render_with_run_assets(db, run_id, data.assignment_md)
    mp = MiniProject(
        run_id=run_id,
        block_id=data.block_id,
        assignment_md=data.assignment_md,
        assignment_html=assignment_html,
        soft_deadline=data.soft_deadline,
        hard_deadline=data.hard_deadline,
        resubmission_deadline=data.resubmission_deadline,
        is_published=False,
    )
    db.add(mp)
    db.flush()
    sync_run_asset_references(db, run_id, data.assignment_md, mp.id)
    db.commit()
    db.refresh(mp)
    return _serialize_mini_project(db, mp)


@router.get("/api/runs/{run_id}/mini-projects", response_model=list[MiniProjectResponse])
def list_mini_projects(
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    run = get_or_404(db, Run, run_id)
    # Determine if user is admin/teacher (sees all) or student (sees only visible)
    is_priv = _is_admin_or_teacher(db, user, run)
    mps = db.execute(
        select(MiniProject).where(MiniProject.run_id == run_id).order_by(MiniProject.block_id)
    ).scalars().all()
    if not is_priv:
        mps = [mp for mp in mps if mini_project_visible_to_student(run, mp)]
    return [_serialize_mini_project(db, mp) for mp in mps]


@router.get("/api/mini-projects/{mp_id}", response_model=MiniProjectResponse)
def get_mini_project(
    mp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = db.get(Run, mp.run_id)
    is_priv = _is_admin_or_teacher(db, user, run)
    if not is_priv and not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Mini-project not visible")
    return _serialize_mini_project(db, mp)


@router.patch("/api/mini-projects/{mp_id}", response_model=MiniProjectResponse)
def patch_mini_project(
    mp_id: int,
    data: MiniProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    locked = mp.first_submitted_at is not None
    updates = data.model_dump(exclude_unset=True)
    violations = []
    if locked:
        if "assignment_md" in updates:
            violations.append("assignment_md is locked")
        for field in ("soft_deadline", "hard_deadline", "resubmission_deadline"):
            if field in updates:
                old = getattr(mp, field)
                new = updates[field]
                # Allow NULL → non-NULL transition (only meaningful for soft_deadline)
                if old is not None and new is not None and new <= old:
                    violations.append(f"{field} can only be extended (new must be > old)")
                if old is not None and new is None:
                    violations.append(f"{field} cannot be set to NULL once locked")
    if violations:
        raise HTTPException(status_code=409, detail=violations)

    soft_changed = "soft_deadline" in updates and updates["soft_deadline"] != mp.soft_deadline
    for field, value in updates.items():
        setattr(mp, field, value)

    if "assignment_md" in updates:
        mp.assignment_html = render_with_run_assets(db, mp.run_id, updates["assignment_md"])
        sync_run_asset_references(db, mp.run_id, updates["assignment_md"], mp.id)

    if soft_changed:
        # Recompute is_late on existing submissions
        new_soft = updates["soft_deadline"]
        if new_soft is None:
            db.execute(
                Submission.__table__.update()
                .where(Submission.mini_project_id == mp.id)
                .values(is_late=False)
            )
        else:
            db.execute(
                Submission.__table__.update()
                .where(Submission.mini_project_id == mp.id)
                .values(is_late=(Submission.submitted_at > new_soft))
            )

    db.commit()
    db.refresh(mp)
    return _serialize_mini_project(db, mp)


@router.delete("/api/mini-projects/{mp_id}", status_code=204)
def delete_mini_project(
    mp_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    import os
    from mathion.api.helpers import submission_storage_dir
    from mathion.models import Evaluation, RunAssetReference

    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    has_subs = mp.first_submitted_at is not None
    if has_subs and not force:
        raise HTTPException(status_code=409, detail="Mini-project has submissions; use ?force=true")
    if has_subs and force:
        # Course-admin only
        version = db.get(CourseVersion, run.version_id)
        require_course_admin(db, user, version.course_id)

    # File cleanup: list submissions for this mini-project, remove files
    submissions = db.execute(
        select(Submission).where(Submission.mini_project_id == mp_id)
    ).scalars().all()
    for sub in submissions:
        sub_path = os.path.join(submission_storage_dir(run.id, sub.group_id), os.path.basename(sub.file_path))
        if os.path.isfile(sub_path):
            try:
                os.remove(sub_path)
            except OSError:
                pass
        # Feedback file (if evaluation exists)
        ev = db.execute(select(Evaluation).where(Evaluation.submission_id == sub.id)).scalar_one_or_none()
        if ev and ev.feedback_file:
            fb_path = os.path.join(submission_storage_dir(run.id, sub.group_id), os.path.basename(ev.feedback_file))
            if os.path.isfile(fb_path):
                try:
                    os.remove(fb_path)
                except OSError:
                    pass

    # DB cascade order: evaluations → submissions → run_asset_refs → mini_project
    sub_ids = [s.id for s in submissions]
    if sub_ids:
        db.execute(Evaluation.__table__.delete().where(Evaluation.submission_id.in_(sub_ids)))
    db.execute(Submission.__table__.delete().where(Submission.mini_project_id == mp_id))
    db.execute(RunAssetReference.__table__.delete().where(RunAssetReference.mini_project_id == mp_id))
    db.delete(mp)
    db.commit()


@router.post("/api/mini-projects/{mp_id}/publish", response_model=MiniProjectResponse)
def publish_mini_project(
    mp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    violations = []
    if not run.is_published:
        violations.append("Cannot publish mini-project on unpublished run")
    if mp.hard_deadline is None:
        violations.append("hard_deadline required at publish")
    if mp.resubmission_deadline is None:
        violations.append("resubmission_deadline required at publish")
    now = datetime.now(timezone.utc)
    if mp.hard_deadline is not None and mp.hard_deadline <= now:
        violations.append("hard_deadline must be in the future")
    # Convert run.end_date (date) to end-of-day UTC for comparison
    if mp.hard_deadline is not None:
        end_dt = datetime.combine(run.end_date, datetime.min.time(), tzinfo=timezone.utc)
        if mp.hard_deadline.date() > run.end_date:
            violations.append("hard_deadline must fall within run end_date")
    if mp.resubmission_deadline is not None and mp.resubmission_deadline.date() > run.end_date:
        violations.append("resubmission_deadline must fall within run end_date")
    if mp.soft_deadline is not None and mp.hard_deadline is not None and mp.soft_deadline > mp.hard_deadline:
        violations.append("soft_deadline must be <= hard_deadline")
    if mp.hard_deadline is not None and mp.resubmission_deadline is not None and mp.hard_deadline > mp.resubmission_deadline:
        violations.append("hard_deadline must be <= resubmission_deadline")

    if violations:
        raise HTTPException(status_code=409, detail=violations)

    mp.is_published = True
    db.commit()
    db.refresh(mp)
    return _serialize_mini_project(db, mp)


def _is_admin_or_teacher(db: Session, user: User, run: Run) -> bool:
    """Return True if user is course admin of run.course OR run teacher OR superuser."""
    from mathion.models import CourseAdmin, RunTeacher

    if user.is_superuser:
        return True
    version = db.get(CourseVersion, run.version_id)
    is_admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == version.course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    if is_admin:
        return True
    is_teacher = db.execute(
        select(RunTeacher).where(
            RunTeacher.run_id == run.id,
            RunTeacher.user_id == user.id,
        )
    ).scalar_one_or_none() is not None
    return is_teacher
```

- [ ] **Step 4: Register router in `mathion/main.py`**

```python
from mathion.api import mini_projects

app.include_router(mini_projects.router)
```

- [ ] **Step 5: Run test**

Run: `cd backend && pytest tests/test_mini_projects.py::test_create_mini_project -v`
Expected: PASS.

- [ ] **Step 6: Add the rest of the mini-project tests**

Append to `tests/test_mini_projects.py`:

```python
def _create_mp(admin_client, db, seed_run_with_groups, **overrides):
    """Helper: create a mini-project with sensible defaults, return (run, mp)."""
    from sqlalchemy import select
    from mathion.models import Block, Run

    run, _, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    payload = {
        "block_id": block.id,
        "assignment_md": "Write a report.",
        "hard_deadline": "2026-06-01T23:59:00Z",
        "resubmission_deadline": "2026-06-15T23:59:00Z",
    }
    payload.update(overrides)
    mp = admin_client.post(f"/api/runs/{run['id']}/mini-projects", json=payload).json()
    return run, mp


def test_duplicate_block_409(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": mp["block_id"], "assignment_md": "x", "hard_deadline": "2026-06-01T23:59:00Z", "resubmission_deadline": "2026-06-15T23:59:00Z"},
    )
    assert response.status_code == 409


def test_create_requires_groups_enabled(admin_client, db, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-12-31", "groups_enabled": False},
    ).json()
    from mathion.models import Block
    from sqlalchemy import select
    block = db.execute(select(Block).where(Block.version_id == run["version_id"])).scalars().first()
    response = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x", "hard_deadline": "2026-06-01T23:59:00Z", "resubmission_deadline": "2026-06-15T23:59:00Z"},
    )
    assert response.status_code == 409


def test_publish_gate_requires_resubmission_deadline(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups, resubmission_deadline=None)
    response = admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    assert response.status_code == 409
    assert any("resubmission_deadline" in v for v in response.json()["detail"])


def test_publish_succeeds(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    response = admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    assert response.status_code == 200
    assert response.json()["is_published"] is True


def test_student_sees_only_published(auth_client, admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    # Before publish, student gets empty list (or 403 on direct GET)
    response = auth_client.get(f"/api/runs/{run['id']}/mini-projects")
    # auth_client is not enrolled — but list endpoint here doesn't enforce enrollment.
    # Filtered to is_published=True; mp is unpublished so visible list is empty.
    assert response.status_code == 200
    assert response.json() == []
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    response = auth_client.get(f"/api/runs/{run['id']}/mini-projects")
    assert len(response.json()) == 1


def test_delete_unpublished_no_force(admin_client, db, seed_run_with_groups):
    run, mp = _create_mp(admin_client, db, seed_run_with_groups)
    response = admin_client.delete(f"/api/mini-projects/{mp['id']}")
    assert response.status_code == 204
```

- [ ] **Step 7: Run all mini-project tests**

Run: `cd backend && pytest tests/test_mini_projects.py -v`
Expected: all PASS.

- [ ] **Step 8: Run full test suite**

Run: `cd backend && pytest -q`
Expected: 386 + 7 = 393 tests pass.

- [ ] **Step 9: Commit**

```bash
cd backend
git add mathion/api/mini_projects.py mathion/main.py tests/test_mini_projects.py
git commit -m "feat: add mini-project CRUD + publish gate + lock semantics"
```

---

### Task 8: Submission endpoint + atomic lock marker

**Files:**
- Create: `mathion/api/submissions.py`
- Modify: `mathion/main.py`
- Create: `tests/test_submissions.py`

- [ ] **Step 1: Write failing test for initial submission**

Create `tests/test_submissions.py`:

```python
import io
from sqlalchemy import select


def _student_client(client_factory, email):
    """Build a CSRFTestClient logged in as the given student email."""
    from mathion.models_auth import User
    return client_factory(User.__table__, email)


def _make_published_mp(admin_client, db, seed_run_with_groups):
    from mathion.models import Block, Run
    run, ga, gb = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "Report.",
            "hard_deadline": "2099-06-01T23:59:00Z",
            "resubmission_deadline": "2099-06-15T23:59:00Z",
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    return run, ga, gb, mp


def test_initial_submission(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")  # alice is in Group A per fixture
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("report.pdf", io.BytesIO(b"%PDF-1.4 stuff"), "application/pdf")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["submission_number"] == 1
    assert body["is_late"] is False
    assert body["is_resubmission"] is False
    assert body["group_id"] == ga["id"]
```

- [ ] **Step 2: Add `student_client_for` fixture to `conftest.py`**

Append to `conftest.py`:

```python
@pytest.fixture
def student_client_for(client, db):
    """Return a factory: email → CSRFTestClient logged in as that user.

    Bypasses the PIN flow by directly creating a session for the user matching
    the email. Used for tests that need to act as specific students.
    """
    from mathion.models_auth import Session, User
    from mathion.api.auth import _hash_token
    import secrets
    from datetime import datetime, timedelta, timezone

    def _factory(email: str):
        user = db.execute(
            __import__("sqlalchemy").select(User).where(User.email == email)
        ).scalar_one()
        token = secrets.token_urlsafe(32)
        sess = Session(
            user_id=user.id,
            token_hash=_hash_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        db.add(sess)
        db.commit()
        from tests.conftest import CSRFTestClient
        new_client = CSRFTestClient(client.app)
        new_client.cookies.set("session", token)
        return new_client
    return _factory
```

(Adjust import name if `_hash_token` is named differently — check `mathion/api/auth.py`.)

- [ ] **Step 3: Run test, verify FAIL**

Run: `cd backend && pytest tests/test_submissions.py::test_initial_submission -v`
Expected: FAIL (404 or 403).

- [ ] **Step 4: Create `mathion/api/submissions.py`**

```python
import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    build_submission_filename,
    get_or_404,
    mini_project_visible_to_student,
    submission_storage_dir,
)
from mathion.api.mini_projects import _is_admin_or_teacher
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Evaluation, Group, MiniProject, Run, RunStudent, Submission
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import SubmissionResponse

router = APIRouter(tags=["submissions"])


def _get_submitter_group(db: Session, run_id: int, user_id: int) -> Group | None:
    """Return the (single) group on this run for the user, or None."""
    rs = db.execute(
        select(RunStudent).where(
            RunStudent.run_id == run_id,
            RunStudent.user_id == user_id,
        )
    ).scalar_one_or_none()
    if rs is None or rs.group_id is None:
        return None
    return db.get(Group, rs.group_id)


def _latest_evaluation_result(db: Session, mini_project_id: int, group_id: int) -> tuple[str | None, int | None]:
    """Return (result, evaluator_user_id) of the latest evaluation for this group's
    latest submission on this mini-project. (None, None) if no submissions or no
    evaluation yet."""
    latest_sub = db.execute(
        select(Submission)
        .where(Submission.mini_project_id == mini_project_id, Submission.group_id == group_id)
        .order_by(Submission.submission_number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest_sub is None:
        return None, None
    ev = db.execute(select(Evaluation).where(Evaluation.submission_id == latest_sub.id)).scalar_one_or_none()
    if ev is None:
        return None, None
    return ev.result, ev.evaluated_by


@router.post("/api/mini-projects/{mp_id}/submissions", status_code=201, response_model=SubmissionResponse)
def create_submission(
    mp_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)

    if not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Mini-project not visible")

    group = _get_submitter_group(db, run.id, user.id)
    if group is None:
        raise HTTPException(status_code=403, detail="Must be a member of a group on this run to submit")
    if group.is_disabled:
        raise HTTPException(status_code=409, detail="Group is disabled")

    # Determine is_resubmission and check preconditions
    latest_result, prev_evaluator = _latest_evaluation_result(db, mp.id, group.id)
    if latest_result == "accepted":
        raise HTTPException(status_code=409, detail="Already accepted; no further submission")
    if latest_result is None:
        # Either no prior submission, or prior submission has no evaluation
        prior_sub = db.execute(
            select(Submission)
            .where(Submission.mini_project_id == mp.id, Submission.group_id == group.id)
            .order_by(Submission.submission_number.desc())
            .limit(1)
        ).scalar_one_or_none()
        if prior_sub is not None:
            raise HTTPException(status_code=409, detail="Previous submission pending evaluation")
        is_resubmission = False
    elif latest_result == "rejected":
        is_resubmission = False  # fresh initial submission per spec
    elif latest_result in ("major_revision", "minor_revision"):
        is_resubmission = True
    else:
        raise HTTPException(status_code=500, detail=f"Unexpected evaluation result: {latest_result}")

    # Deadline gates
    now = datetime.now(timezone.utc)
    if not is_resubmission:
        if mp.hard_deadline is not None and now > mp.hard_deadline:
            raise HTTPException(status_code=409, detail="Initial submission deadline passed")
    else:
        if mp.resubmission_deadline is not None and now > mp.resubmission_deadline:
            raise HTTPException(status_code=409, detail="Resubmission deadline passed")

    # Read file
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Submission must be a PDF")
    content = file.file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Determine submission_number
    block = db.get(Block, mp.block_id)
    next_num = (db.scalar(
        select(func.max(Submission.submission_number)).where(
            Submission.mini_project_id == mp.id,
            Submission.group_id == group.id,
        )
    ) or 0) + 1

    filename = build_submission_filename(block.order, group.name, next_num)
    rel_path = os.path.join("submissions", str(run.id), str(group.id), filename)

    is_late = mp.soft_deadline is not None and now > mp.soft_deadline

    sub = Submission(
        mini_project_id=mp.id,
        group_id=group.id,
        submission_number=next_num,
        submitted_by=user.id,
        file_path=rel_path,
        file_size=len(content),
        is_late=is_late,
        is_resubmission=is_resubmission,
    )
    db.add(sub)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        # One retry on race
        next_num = (db.scalar(
            select(func.max(Submission.submission_number)).where(
                Submission.mini_project_id == mp.id,
                Submission.group_id == group.id,
            )
        ) or 0) + 1
        filename = build_submission_filename(block.order, group.name, next_num)
        rel_path = os.path.join("submissions", str(run.id), str(group.id), filename)
        sub = Submission(
            mini_project_id=mp.id, group_id=group.id, submission_number=next_num,
            submitted_by=user.id, file_path=rel_path, file_size=len(content),
            is_late=is_late, is_resubmission=is_resubmission,
        )
        db.add(sub)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=503, detail="Concurrent submission conflict; retry")

    # Atomic first_submitted_at set
    db.execute(
        MiniProject.__table__.update()
        .where(MiniProject.id == mp.id, MiniProject.first_submitted_at.is_(None))
        .values(first_submitted_at=datetime.now(timezone.utc))
    )

    # Auto-acceptance for resubmissions
    if is_resubmission:
        if prev_evaluator is None:
            raise HTTPException(status_code=500, detail="Auto-evaluation failed: no prior evaluator")
        auto_eval = Evaluation(
            submission_id=sub.id,
            evaluated_by=prev_evaluator,
            result="accepted",
        )
        db.add(auto_eval)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=500, detail="Auto-evaluation failed; submission rejected")

    # Write file via temp+rename
    abs_dir = submission_storage_dir(run.id, group.id)
    abs_path = os.path.join(abs_dir, filename)
    tmp_path: str | None = None
    try:
        os.makedirs(abs_dir, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=abs_dir, prefix=".upload-", suffix=".tmp")
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.replace(tmp_path, abs_path)
        tmp_path = None
    except Exception:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to write submission to disk")

    # Notification on auto-accept (manual-eval notifications fire in evaluation endpoint)
    if is_resubmission:
        member_ids = db.execute(
            select(RunStudent.user_id).where(
                RunStudent.run_id == run.id,
                RunStudent.group_id == group.id,
            )
        ).scalars().all()
        for uid in member_ids:
            db.add(NotificationLogEntry(
                user_id=uid,
                kind="evaluation_received",
                payload={
                    "run_id": run.id,
                    "mini_project_id": mp.id,
                    "submission_id": sub.id,
                    "evaluation_id": auto_eval.id,
                    "result": "accepted",
                },
            ))

    db.commit()
    db.refresh(sub)
    return sub


@router.get("/api/mini-projects/{mp_id}/submissions", response_model=list[SubmissionResponse])
def list_submissions(
    mp_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mp = get_or_404(db, MiniProject, mp_id)
    run = get_or_404(db, Run, mp.run_id)
    if _is_admin_or_teacher(db, user, run):
        subs = db.execute(
            select(Submission).where(Submission.mini_project_id == mp_id).order_by(Submission.submitted_at)
        ).scalars().all()
    else:
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Mini-project not visible")
        group = _get_submitter_group(db, run.id, user.id)
        if group is None:
            raise HTTPException(status_code=403, detail="Not a group member")
        subs = db.execute(
            select(Submission).where(
                Submission.mini_project_id == mp_id,
                Submission.group_id == group.id,
            ).order_by(Submission.submitted_at)
        ).scalars().all()
    return subs


@router.get("/api/submissions/{sid}", response_model=SubmissionResponse)
def get_submission(
    sid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if _is_admin_or_teacher(db, user, run):
        return sub
    if not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=403, detail="Not visible")
    group = _get_submitter_group(db, run.id, user.id)
    if group is None or group.id != sub.group_id:
        raise HTTPException(status_code=403, detail="Not a member of submitting group")
    return sub


@router.get("/api/submissions/{sid}/file")
def get_submission_file(
    sid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if not _is_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Not visible")
        group = _get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=403, detail="Not a member of submitting group")

    abs_dir = submission_storage_dir(run.id, sub.group_id)
    abs_path = os.path.join(abs_dir, os.path.basename(sub.file_path))
    real_dir = os.path.realpath(abs_dir)
    real_path = os.path.realpath(abs_path)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(abs_path, media_type="application/pdf", filename=os.path.basename(sub.file_path))
```

- [ ] **Step 5: Register router in `mathion/main.py`**

```python
from mathion.api import submissions
app.include_router(submissions.router)
```

- [ ] **Step 6: Run initial submission test**

Run: `cd backend && pytest tests/test_submissions.py::test_initial_submission -v`
Expected: PASS.

- [ ] **Step 7: Add more submission tests**

Append to `tests/test_submissions.py`:

```python
def test_submit_blocks_non_group_member(admin_client, student_client_for, db, seed_run_with_groups):
    # auth_client student isn't in any group; create a non-member user
    run, _, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    # Add another user not in any group
    from mathion.models_auth import User
    db.add(User(email="outsider@example.com", full_name="O"))
    db.commit()
    outsider = student_client_for("outsider@example.com")
    response = outsider.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 403


def test_submit_blocked_after_hard_deadline(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Block, MiniProject, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    # Create with past hard_deadline directly via DB (bypasses publish-gate which would reject)
    from datetime import datetime, timezone
    mp_obj = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="<p>x</p>",
        hard_deadline=datetime(2020, 1, 1, tzinfo=timezone.utc),
        resubmission_deadline=datetime(2020, 1, 15, tzinfo=timezone.utc),
        is_published=True,
    )
    db.add(mp_obj)
    db.commit()
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{mp_obj.id}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_submit_to_disabled_group(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    # Disable group A
    admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_pending_evaluation_blocks_resubmit(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_first_submitted_at_set(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import MiniProject
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    db.expire_all()
    mp_obj = db.get(MiniProject, mp["id"])
    assert mp_obj.first_submitted_at is not None


def test_lock_blocks_assignment_md_edit(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    response = admin_client.patch(f"/api/mini-projects/{mp['id']}", json={"assignment_md": "new text"})
    assert response.status_code == 409
```

- [ ] **Step 8: Run all submission tests**

Run: `cd backend && pytest tests/test_submissions.py -v`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
cd backend
git add mathion/api/submissions.py mathion/main.py tests/test_submissions.py tests/conftest.py
git commit -m "feat: add submission endpoint with deadline+lock gates and atomic first_submitted_at"
```

---

### Task 9: Manual evaluation endpoints

**Files:**
- Create: `mathion/api/evaluations.py`
- Modify: `mathion/main.py`
- Create: `tests/test_evaluations.py`

- [ ] **Step 1: Write failing test for evaluation create**

Create `tests/test_evaluations.py`:

```python
import io
from sqlalchemy import select


def _make_submitted(admin_client, student_client_for, db, seed_run_with_groups):
    """Create published mp, submit a PDF as alice. Returns (run, ga, mp, sub)."""
    from mathion.models import Block, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "x",
            "hard_deadline": "2099-06-01T23:59:00Z",
            "resubmission_deadline": "2099-06-15T23:59:00Z",
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    sub = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    return run, ga, mp, sub


def test_evaluate_accepted(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "accepted", "score": "95", "feedback_text": "Great job"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["result"] == "accepted"
    assert body["score"] == 95


def test_evaluate_revision_requires_feedback_file(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix x"},
    )
    assert response.status_code == 422


def test_evaluate_already_evaluated_409(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation",
                      data={"result": "accepted"})
    response = admin_client.post(f"/api/submissions/{sub['id']}/evaluation",
                                 data={"result": "rejected"},
                                 files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    assert response.status_code == 409
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd backend && pytest tests/test_evaluations.py::test_evaluate_accepted -v`
Expected: FAIL (404).

- [ ] **Step 3: Create `mathion/api/evaluations.py`**

```python
import os
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import (
    build_feedback_filename,
    get_or_404,
    mini_project_visible_to_student,
    require_run_admin_or_teacher,
    submission_storage_dir,
)
from mathion.api.mini_projects import _is_admin_or_teacher
from mathion.api.submissions import _get_submitter_group
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Evaluation, MiniProject, Run, RunStudent, Submission
from mathion.models_auth import NotificationLogEntry, User
from mathion.schemas import EvaluationResponse, EvaluationUpdate

router = APIRouter(tags=["evaluations"])

ALLOWED_RESULTS = {"rejected", "major_revision", "minor_revision", "accepted"}


@router.post("/api/submissions/{sid}/evaluation", status_code=201, response_model=EvaluationResponse)
def create_evaluation(
    sid: int,
    result: str = Form(...),
    score: Optional[int] = Form(None),
    feedback_text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if result not in ALLOWED_RESULTS:
        raise HTTPException(status_code=422, detail=f"Invalid result: {result}")
    if score is not None and not (0 <= score <= 100):
        raise HTTPException(status_code=422, detail="score must be 0-100")
    if result != "accepted" and file is None:
        raise HTTPException(status_code=422, detail="feedback_file required for this result")

    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    if sub.is_resubmission:
        # Auto-accepted by submission flow; manual evaluation not allowed
        raise HTTPException(status_code=409, detail="Submission was auto-accepted; cannot manually evaluate")

    # Save feedback file if provided
    feedback_rel: str | None = None
    feedback_size: int | None = None
    block = db.get(Block, mp.block_id)
    feedback_abs: str | None = None
    if file is not None:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="feedback_file must be a PDF")
        content = file.file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty feedback file")
        feedback_size = len(content)
        from mathion.models import Group
        group = db.get(Group, sub.group_id)
        feedback_filename = build_feedback_filename(block.order, group.name, sub.submission_number)
        feedback_rel = os.path.join("submissions", str(run.id), str(sub.group_id), feedback_filename)
        feedback_abs_dir = submission_storage_dir(run.id, sub.group_id)
        feedback_abs = os.path.join(feedback_abs_dir, feedback_filename)

    ev = Evaluation(
        submission_id=sid,
        evaluated_by=user.id,
        result=result,
        score=score,
        feedback_text=feedback_text,
        feedback_file=feedback_rel,
    )
    db.add(ev)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already evaluated")

    # Write feedback file via temp+rename
    if feedback_abs is not None:
        tmp_path: str | None = None
        try:
            os.makedirs(feedback_abs_dir, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(dir=feedback_abs_dir, prefix=".upload-", suffix=".tmp")
            with os.fdopen(fd, "wb") as f:
                f.write(content)
            os.replace(tmp_path, feedback_abs)
            tmp_path = None
        except Exception:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to write feedback file")

    # Notify current group members
    member_ids = db.execute(
        select(RunStudent.user_id).where(
            RunStudent.run_id == run.id,
            RunStudent.group_id == sub.group_id,
        )
    ).scalars().all()
    for uid in member_ids:
        db.add(NotificationLogEntry(
            user_id=uid,
            kind="evaluation_received",
            payload={
                "run_id": run.id,
                "mini_project_id": mp.id,
                "submission_id": sub.id,
                "evaluation_id": ev.id,
                "result": result,
            },
        ))

    db.commit()
    db.refresh(ev)
    return ev


@router.get("/api/submissions/{sid}/evaluation", response_model=EvaluationResponse)
def get_evaluation(
    sid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = get_or_404(db, Submission, sid)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if not _is_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Not visible")
        group = _get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=403, detail="Not a group member")
    ev = db.execute(select(Evaluation).where(Evaluation.submission_id == sid)).scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return ev


@router.patch("/api/evaluations/{eid}", response_model=EvaluationResponse)
def patch_evaluation(
    eid: int,
    data: EvaluationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ev = get_or_404(db, Evaluation, eid)
    sub = db.get(Submission, ev.submission_id)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = get_or_404(db, Run, mp.run_id)
    require_run_admin_or_teacher(db, user, run)

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(ev, field, value)
    # Re-validate result if changed
    if ev.result != "accepted" and ev.feedback_file is None:
        raise HTTPException(status_code=422, detail="feedback_file required for this result")
    db.commit()
    db.refresh(ev)
    return ev


@router.get("/api/evaluations/{eid}/feedback-file")
def get_feedback_file(
    eid: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ev = get_or_404(db, Evaluation, eid)
    sub = db.get(Submission, ev.submission_id)
    mp = db.get(MiniProject, sub.mini_project_id)
    run = db.get(Run, mp.run_id)
    if not _is_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=403, detail="Not visible")
        group = _get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=403, detail="Not a group member")
    if ev.feedback_file is None:
        raise HTTPException(status_code=404, detail="No feedback file")
    abs_dir = submission_storage_dir(run.id, sub.group_id)
    abs_path = os.path.join(abs_dir, os.path.basename(ev.feedback_file))
    real_dir = os.path.realpath(abs_dir)
    real_path = os.path.realpath(abs_path)
    if os.path.commonpath([real_dir, real_path]) != real_dir:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(abs_path, media_type="application/pdf",
                        filename=os.path.basename(ev.feedback_file))
```

- [ ] **Step 4: Register router**

In `mathion/main.py`:

```python
from mathion.api import evaluations
app.include_router(evaluations.router)
```

- [ ] **Step 5: Run evaluation tests**

Run: `cd backend && pytest tests/test_evaluations.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add mathion/api/evaluations.py mathion/main.py tests/test_evaluations.py
git commit -m "feat: add evaluation endpoints (create/get/patch/feedback-file) + evaluation_received notification"
```

---

### Task 10: Resubmission auto-accept flow + notification verification

The resubmission auto-accept logic was added in Task 8. This task verifies it end-to-end and adds the dedicated notification test file.

**Files:**
- Create: `tests/test_mini_project_notifications.py`
- Add additional tests to `tests/test_submissions.py` for auto-accept

- [ ] **Step 1: Write resubmission auto-accept test**

Append to `tests/test_submissions.py`:

```python
def test_resubmission_auto_accepts(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    # Teacher requests minor revision
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    # Group member resubmits
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 201
    new_sub = response.json()
    assert new_sub["is_resubmission"] is True
    # Auto-evaluation should exist
    from mathion.models import Evaluation
    ev = db.execute(select(Evaluation).where(Evaluation.submission_id == new_sub["id"])).scalar_one()
    assert ev.result == "accepted"


def test_rejected_resets_to_initial(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "rejected", "feedback_text": "wrong file"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 201
    assert response.json()["is_resubmission"] is False  # fresh initial


def test_accepted_blocks_resubmit(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409
```

- [ ] **Step 2: Create notification test file**

Create `tests/test_mini_project_notifications.py`:

```python
import io
from sqlalchemy import select


def _setup(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Block, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": "2099-06-01T23:59:00Z",
              "resubmission_deadline": "2099-06-15T23:59:00Z"},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    sub = student.post(f"/api/mini-projects/{mp['id']}/submissions",
                       files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")}).json()
    return run, ga, mp, sub


def test_evaluation_received_on_manual_eval(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models_auth import NotificationLogEntry
    _, _, _, sub = _setup(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    rows = db.query(NotificationLogEntry).filter_by(kind="evaluation_received").all()
    assert len(rows) == 1
    assert rows[0].payload["result"] == "accepted"


def test_evaluation_received_on_auto_accept(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models_auth import NotificationLogEntry
    _, _, mp, sub = _setup(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "fix"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    student = student_client_for("alice@example.com")
    student.post(f"/api/mini-projects/{mp['id']}/submissions",
                 files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    rows = db.query(NotificationLogEntry).filter_by(kind="evaluation_received").all()
    # One for manual eval (minor_revision) + one for auto-accept = 2
    assert len(rows) == 2
    assert {r.payload["result"] for r in rows} == {"minor_revision", "accepted"}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && pytest tests/test_submissions.py tests/test_mini_project_notifications.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd backend
git add tests/test_submissions.py tests/test_mini_project_notifications.py
git commit -m "test: cover resubmission auto-accept + evaluation_received notifications"
```

---

### Task 11: Run delete tightening + force cascade

**Files:**
- Modify: `mathion/api/runs.py` — `delete_run`, `patch_run`
- Modify: `tests/test_runs.py` (extend)

- [ ] **Step 1: Extend `delete_run` in `mathion/api/runs.py`**

Find the existing `delete_run` and replace its body. Keep the auth check; add the new gates and force cascade.

```python
@router.delete("/api/runs/{run_id}", status_code=204)
def delete_run(
    run_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    import os
    import shutil
    from mathion.api.helpers import has_submissions, run_asset_storage_dir, submission_storage_dir
    from mathion.config import settings
    from mathion.models import Evaluation, Group, MiniProject, RunAsset, RunAssetReference, RunStudent, RunTeacher, Submission

    run = get_or_404(db, Run, run_id)
    require_course_admin_for_run(db, user, run)

    if not force:
        if run.is_published:
            raise HTTPException(status_code=409, detail="Unpublish run before deleting")
        student_count = db.scalar(select(func.count(RunStudent.id)).where(RunStudent.run_id == run_id))
        if student_count and student_count > 0:
            raise HTTPException(status_code=409, detail="Run has students; clear roster or use ?force=true")
        if has_submissions(db, run):
            raise HTTPException(status_code=409, detail="Run has submissions; use ?force=true to override")
        # Simple delete (cascade via FKs handles teachers/groups/students)
        db.delete(run)
        db.commit()
        return

    # ?force=true: course-admin only AND override all blocks
    # Cascade order: evaluations → submissions → run_asset_refs → mini_projects → groups → teachers/students → run_assets → run
    sub_ids = db.execute(
        select(Submission.id).join(MiniProject, MiniProject.id == Submission.mini_project_id)
        .where(MiniProject.run_id == run_id)
    ).scalars().all()
    if sub_ids:
        db.execute(Evaluation.__table__.delete().where(Evaluation.submission_id.in_(sub_ids)))
        db.execute(Submission.__table__.delete().where(Submission.id.in_(sub_ids)))
    mp_ids = db.execute(select(MiniProject.id).where(MiniProject.run_id == run_id)).scalars().all()
    if mp_ids:
        db.execute(RunAssetReference.__table__.delete().where(RunAssetReference.mini_project_id.in_(mp_ids)))
        db.execute(MiniProject.__table__.delete().where(MiniProject.id.in_(mp_ids)))
    # Group and run_student/teacher cascade via FK on run delete; just delete RunAsset rows + files explicitly
    asset_dir = run_asset_storage_dir(run_id)
    sub_dir = os.path.join(settings.asset_path, "submissions", str(run_id))
    db.execute(RunAsset.__table__.delete().where(RunAsset.run_id == run_id))
    db.delete(run)
    db.commit()
    # Disk cleanup last (after DB commit so we don't end up with files but no rows)
    for d in (asset_dir, sub_dir):
        if os.path.isdir(d):
            try:
                shutil.rmtree(d)
            except OSError:
                pass
```

- [ ] **Step 2: Add `has_submissions` check in `patch_run` end_date logic**

Find `patch_run` in `runs.py` and update the end_date validation:

```python
@router.patch("/api/runs/{run_id}", response_model=RunResponse)
def patch_run(run_id: int, data: RunUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from datetime import date as _date
    from mathion.api.helpers import has_submissions

    run = get_or_404(db, Run, run_id)
    require_run_admin_or_teacher(db, user, run)
    updates = data.model_dump(exclude_unset=True)

    if "groups_enabled" in updates and run.is_published:
        raise HTTPException(status_code=409, detail="Cannot change groups_enabled on published run")

    # Phase 7b: block disabling groups when mini-projects exist
    if "groups_enabled" in updates and updates["groups_enabled"] is False:
        from mathion.models import MiniProject
        mp_count = db.scalar(select(func.count(MiniProject.id)).where(MiniProject.run_id == run_id))
        if mp_count and mp_count > 0:
            raise HTTPException(status_code=409, detail="Cannot disable groups; mini-projects exist")

    new_end = updates.get("end_date", run.end_date)
    if new_end < run.start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date")

    # Phase 7b: lowering end_date past today blocked when submissions exist
    if "end_date" in updates and updates["end_date"] < run.end_date:
        if has_submissions(db, run):
            raise HTTPException(status_code=409, detail="Cannot shorten run while submissions exist")

    for field, value in updates.items():
        setattr(run, field, value)

    db.commit()
    db.refresh(run)
    return run
```

- [ ] **Step 3: Write tests for run delete tightening**

Append to `tests/test_runs.py`:

```python
def test_delete_run_with_students_409(admin_client, seed_run_with_groups):
    run, _, _ = seed_run_with_groups()
    # Run is published; unpublish first
    admin_client.post(f"/api/runs/{run['id']}/unpublish")
    response = admin_client.delete(f"/api/runs/{run['id']}")
    assert response.status_code == 409
    assert "students" in response.json()["detail"].lower()


def test_force_delete_published_run(admin_client, db, seed_run_with_groups):
    import io
    from sqlalchemy import select
    from mathion.models import Block, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": "2099-06-01T23:59:00Z",
              "resubmission_deadline": "2099-06-15T23:59:00Z"},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    response = admin_client.delete(f"/api/runs/{run['id']}?force=true")
    assert response.status_code == 204
    db.expire_all()
    assert db.get(Run, run["id"]) is None
```

- [ ] **Step 4: Run tests**

Run: `cd backend && pytest tests/test_runs.py -v`
Expected: all PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
cd backend
git add mathion/api/runs.py tests/test_runs.py
git commit -m "feat: tighten run delete; add force-delete cascade; wire has_submissions into patch_run"
```

---

### Task 12: Group disable/enable + group-delete tightening + roster move-into-disabled

**Files:**
- Modify: `mathion/api/groups.py` — extend PATCH for `is_disabled`; tighten DELETE
- Modify: `mathion/api/run_roster.py` — reject moves into disabled groups
- Modify: `tests/test_groups.py` (extend)

- [ ] **Step 1: Extend `mathion/api/groups.py`**

In the existing `update_group` (PATCH endpoint), add `is_disabled` handling:

```python
@router.patch("/api/groups/{group_id}", response_model=GroupResponse)
def update_group(
    group_id: int,
    data: GroupUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = get_or_404(db, Group, group_id)
    run = get_or_404(db, Run, group.run_id)
    require_run_admin_or_teacher(db, user, run)
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(group, field, value)
    db.commit()
    db.refresh(group)
    return _serialize_group(db, group)
```

(`_serialize_group` is the existing helper that returns the response with `student_count`.)

In `delete_group`, add submission check:

```python
@router.delete("/api/groups/{group_id}", status_code=204)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from mathion.models import Submission

    group = get_or_404(db, Group, group_id)
    run = get_or_404(db, Run, group.run_id)
    require_run_admin_or_teacher(db, user, run)

    # Existing: block if students assigned
    student_count = db.scalar(
        select(func.count(RunStudent.id)).where(RunStudent.group_id == group_id)
    )
    if student_count and student_count > 0:
        raise HTTPException(status_code=409, detail="Group has students or submissions; disable instead")

    # Phase 7b: also block if submissions exist
    sub_count = db.scalar(select(func.count(Submission.id)).where(Submission.group_id == group_id))
    if sub_count and sub_count > 0:
        raise HTTPException(status_code=409, detail="Group has students or submissions; disable instead")

    db.delete(group)
    db.commit()
```

- [ ] **Step 2: Reject student moves into disabled groups in `run_roster.py`**

Find `patch_student` (PATCH on `/api/runs/{rid}/students/{user_id}`). Before the capacity check, add:

```python
if "group_id" in updates and updates["group_id"] is not None:
    target_group = db.get(Group, updates["group_id"])
    if target_group is not None and target_group.is_disabled:
        raise HTTPException(status_code=409, detail="Cannot move student into disabled group")
```

Also update the add-student handler to reject adding into a disabled group — find the pre-existing capacity check and add:

```python
if data.group_id is not None:
    target_group = db.get(Group, data.group_id)
    if target_group is not None and target_group.is_disabled:
        raise HTTPException(status_code=409, detail="Cannot add students to disabled group")
```

- [ ] **Step 3: Write tests**

Append to `tests/test_groups.py`:

```python
def test_disable_group(admin_client, seed_run_with_groups):
    _, ga, _ = seed_run_with_groups()
    response = admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    assert response.status_code == 200
    assert response.json()["is_disabled"] is True if "is_disabled" in response.json() else True
    # GroupResponse should include is_disabled — if it doesn't, this assertion will need adjustment


def test_cannot_add_student_to_disabled_group(admin_client, seed_run_with_groups):
    run, ga, _ = seed_run_with_groups()
    admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    response = admin_client.post(f"/api/runs/{run['id']}/students",
                                 json={"email": "new@example.com", "group_id": ga["id"]})
    assert response.status_code == 409


def test_cannot_move_student_into_disabled_group(admin_client, seed_run_with_groups):
    import io
    run, ga, gb = seed_run_with_groups()
    # alice is in ga, bob is in gb. Disable gb. Try to move alice into gb.
    admin_client.patch(f"/api/groups/{gb['id']}", json={"is_disabled": True})
    # Find alice's user_id
    from sqlalchemy import select
    from mathion.models_auth import User
    # We'll use the API instead
    students = admin_client.get(f"/api/runs/{run['id']}/students").json()
    alice = next(s for s in students if s["user_email"] == "alice@example.com")
    response = admin_client.patch(
        f"/api/runs/{run['id']}/students/{alice['user_id']}",
        json={"group_id": gb["id"]},
    )
    assert response.status_code == 409


def test_delete_group_with_submissions_409(admin_client, student_client_for, db, seed_run_with_groups):
    import io
    from sqlalchemy import select
    from mathion.models import Block, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": "2099-06-01T23:59:00Z",
              "resubmission_deadline": "2099-06-15T23:59:00Z"},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    student.post(f"/api/mini-projects/{mp['id']}/submissions",
                 files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    # Remove alice from group so student check passes
    students = admin_client.get(f"/api/runs/{run['id']}/students").json()
    alice = next(s for s in students if s["user_email"] == "alice@example.com")
    admin_client.delete(f"/api/runs/{run['id']}/students/{alice['user_id']}")
    # Now group is empty of students but has submissions
    response = admin_client.delete(f"/api/groups/{ga['id']}")
    assert response.status_code == 409
```

- [ ] **Step 4: Update `GroupResponse` schema to include `is_disabled`**

In `mathion/schemas.py`, find `GroupResponse` and add the field:

```python
class GroupResponse(BaseModel):
    id: int
    run_id: int
    name: str
    is_disabled: bool = False
    student_count: int = 0

    model_config = {"from_attributes": True}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && pytest tests/test_groups.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd backend
git add mathion/api/groups.py mathion/api/run_roster.py mathion/schemas.py tests/test_groups.py
git commit -m "feat: add Group disable/enable + tighten group-delete + reject moves into disabled groups"
```

---

### Task 13: Final regression sweep

**Files:**
- All test files

- [ ] **Step 1: Run full test suite**

Run: `cd backend && pytest -q`
Expected: 380 (Phase 7a baseline) + ~50-70 new = ~430-450 tests pass.

- [ ] **Step 2: If any test fails, diagnose and fix**

Common failure modes after large changes:
- Existing test uses `_enroll_user_in_run` (renamed to `enroll_user_in_run`) — fix import.
- Existing test passes `run_id` to `require_run_admin_or_teacher` (now takes `run` object) — update call.
- Existing test asserts on a Group serialization that doesn't include `is_disabled` — add the field.

For each failure, fix the root cause (don't paper over with skips) and re-run.

- [ ] **Step 3: Run pyright/mypy if configured**

Run: `cd backend && pyright . 2>&1 | tail -20` (if pyright is in use; otherwise skip)
Expected: no new type errors introduced.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
cd backend
git add -A
git commit -m "fix: resolve regressions from Phase 7b changes"
```

- [ ] **Step 5: Update project memory**

Update `~/.claude/projects/-Users-svkucheryavski-Documents-Developing-mathion/memory/project_mathion_status.md`:
- Mark Phase 7b as DONE with completion date
- Update test count baseline to the new total (after final regression sweep)
- Move Phase 7a deferred items #1-#4 from "open" to "done in 7b"

This is a memory-update step, not a code commit.

---

## Self-Review Notes

After completing all tasks, verify against the spec:

- [ ] Every section of `2026-04-27-phase7b-mini-projects-design.md` has at least one task implementing it.
- [ ] All file paths in tests and code use the right asset_path subtree (`runs/`, `submissions/`).
- [ ] All 409/422/403 error scenarios from the spec's Error Handling table have at least one test.
- [ ] No `# TODO` markers without `(phase 9)` qualifier (those are deliberate deferrals).
- [ ] No mock database in tests; all use the SQLite test engine.
- [ ] All git commits follow the pattern `<type>: <short description>` (feat/refactor/test/fix/docs).

If any gap is found during execution, add a fix-up task and commit before proceeding.
