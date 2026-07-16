# Phase 9 Security Tightening — Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two backend-only security gaps on the submissions/evaluations surface: (#1) an existence-enumeration oracle where six `sid`/`eid`-keyed endpoints return `403` (existing) vs `404` (absent); (#2) missing PDF content validation on the two PDF uploads.

**Architecture:** Backend-only edits to `mathion/api/submissions.py`, `mathion/api/evaluations.py`, and one helper in `mathion/assets.py`. #1 makes every unauthorized branch raise a `404` byte-identical to the missing-row `404` (`get_or_404` emits `f"{Model.__name__} not found"`). #2 adds a strict `%PDF-` header screen after the existing size check. No new components.

**Tech Stack:** FastAPI 0.136.0 + Starlette 1.0.0 + SQLAlchemy 2.0, pytest. Tests run via `backend/.venv/bin/pytest`.

**Spec:** `docs/superpowers/specs/2026-07-16-phase9-security-tightening-design.md` (codex-APPROVED, pass 3).

## Global Constraints

- Backend-only. **No** schema change, **no** Alembic migration, **no** new dependency, **no** frontend change.
- Run all Python tooling via `backend/.venv/bin/...` (never bare `pytest`/`python`).
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- Uniform-404 detail strings must equal `get_or_404`'s exactly: `"Submission not found"` for Submission-keyed endpoints, `"Evaluation not found"` for Evaluation-keyed. The byte-identity test guards drift.
- PDF screen is `content.startswith(b"%PDF-")` — a header screen, not full PDF validity.
- Commit trailer EXACTLY: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- NEVER stage the three long-standing untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`. `git add` only the exact files named per task.

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `mathion/assets.py` | add `PDF_MAGIC` + `looks_like_pdf` | 1 |
| `mathion/api/submissions.py` | magic-byte screen in `create_submission`; 404 flip in `get_submission` + `get_submission_file` | 1, 2 |
| `mathion/api/evaluations.py` | magic-byte screen in `create_evaluation`; 404 flip in `get_evaluation` + `get_feedback_file`; authz→404 swap in `create_evaluation` + `patch_evaluation`; drop unused import | 1, 2, 3 |
| `tests/conftest.py` | add `_assert_hidden` byte-identity helper | 2 |
| `tests/test_assets.py` | unit tests for `looks_like_pdf` | 1 |
| `tests/test_submissions.py` | magic-byte + 404 tests; `b"%PDF"`→`b"%PDF-1.4"` fixture sweep | 1, 2 |
| `tests/test_evaluations.py` | magic-byte + 404 tests; fixture sweep | 1, 2, 3 |
| `tests/{test_groups,test_runs,test_student_mini_projects,test_mini_project_notifications}.py` | `b"%PDF"`→`b"%PDF-1.4"` fixture sweep only | 1 |

**Task order:** Task 1 (PDF screen) first — it includes the fixture sweep, so all later submission-creating tests use valid `%PDF-` uploads. Tasks 2 and 3 (the 404 flips) are independent of each other and of Task 1.

---

### Task 1: PDF `%PDF-` header screen (#2)

**Files:**
- Modify: `mathion/assets.py` (append `PDF_MAGIC` + `looks_like_pdf`)
- Modify: `mathion/api/submissions.py` (import + screen in `create_submission` after the size check ~line 121)
- Modify: `mathion/api/evaluations.py` (import + screen in `create_evaluation` after the size check ~line 89)
- Test: `tests/test_assets.py` (unit), `tests/test_submissions.py` + `tests/test_evaluations.py` (endpoint)
- Fixture sweep: `tests/test_submissions.py`, `tests/test_evaluations.py`, `tests/test_groups.py`, `tests/test_runs.py`, `tests/test_student_mini_projects.py`, `tests/test_mini_project_notifications.py`

**Interfaces:**
- Produces: `mathion.assets.looks_like_pdf(content: bytes) -> bool` and `mathion.assets.PDF_MAGIC: bytes`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing unit test**

Add to `tests/test_assets.py`:

```python
def test_looks_like_pdf():
    from mathion.assets import looks_like_pdf
    assert looks_like_pdf(b"%PDF-1.4 stuff") is True
    assert looks_like_pdf(b"%PDF") is False        # 4 bytes, no hyphen
    assert looks_like_pdf(b"MZ\x90\x00") is False
    assert looks_like_pdf(b"") is False
    assert looks_like_pdf(b"%PD") is False
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd backend && .venv/bin/pytest tests/test_assets.py::test_looks_like_pdf -q`
Expected: FAIL — `ImportError: cannot import name 'looks_like_pdf'`.

- [ ] **Step 3: Implement the helper**

Append to `mathion/assets.py`:

```python
PDF_MAGIC = b"%PDF-"


def looks_like_pdf(content: bytes) -> bool:
    """True if the bytes begin with the PDF file-header signature (%PDF-).

    A header screen, not a full PDF parse: it rejects obviously non-PDF
    content but does not guarantee structural validity.
    """
    return content.startswith(PDF_MAGIC)
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_assets.py::test_looks_like_pdf -q`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint tests**

Add to `tests/test_submissions.py` (module already imports `io`):

```python
def test_submission_rejects_non_pdf_content(student_client_for, seed_run_with_published_mp):
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = student_client_for("alice@example.com")
    resp = alice.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("evil.pdf", io.BytesIO(b"MZ\x90\x00not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Submission is not a valid PDF (missing %PDF- header)"
```

Add to `tests/test_evaluations.py` (uses the existing `_make_submitted` helper):

```python
def test_feedback_file_rejects_non_pdf_content(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    resp = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "x"},
        files={"file": ("fb.pdf", io.BytesIO(b"MZ\x90\x00not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "feedback_file is not a valid PDF (missing %PDF- header)"
```

- [ ] **Step 6: Run them, expect failure**

Run: `cd backend && .venv/bin/pytest tests/test_submissions.py::test_submission_rejects_non_pdf_content tests/test_evaluations.py::test_feedback_file_rejects_non_pdf_content -q`
Expected: FAIL — both currently return `201` (no content check yet).

- [ ] **Step 7: Sweep the 4-byte `b"%PDF"` fixtures to a valid header**

The strict screen rejects the bare 4-byte `b"%PDF"` literal, so update every happy-path fixture (40 occurrences across 6 files) to `b"%PDF-1.4"`. The pattern `b"%PDF"` (closing quote right after `PDF`) does not match already-hyphenated literals like `b"%PDF-feedback"`.

Run:
```bash
cd backend && sed -i '' 's/b"%PDF"/b"%PDF-1.4"/g' \
  tests/test_submissions.py tests/test_evaluations.py tests/test_groups.py \
  tests/test_runs.py tests/test_student_mini_projects.py tests/test_mini_project_notifications.py
```
Verify none remain in the swept files (do NOT grep all of `tests/` — Step 1's `test_assets.py` intentionally keeps a bare `b"%PDF"` in the `looks_like_pdf(b"%PDF") is False` unit case):
```bash
cd backend && grep -rn 'b"%PDF"' \
  tests/test_submissions.py tests/test_evaluations.py tests/test_groups.py \
  tests/test_runs.py tests/test_student_mini_projects.py tests/test_mini_project_notifications.py \
  | grep -v 'b"%PDF-'
```
Expected: no output.

- [ ] **Step 8: Wire the screen into both uploads**

In `mathion/api/submissions.py`, change the import (currently `from mathion.assets import validate_extension`):

```python
from mathion.assets import looks_like_pdf, validate_extension
```

Then insert the screen in `create_submission`, immediately after the max-size check (the block ending `detail=f"File size {len(content)} exceeds max {settings.max_file_size}",` / `)`), before the `# Determine submission_number` comment:

```python
    if not looks_like_pdf(content):
        raise HTTPException(status_code=400, detail="Submission is not a valid PDF (missing %PDF- header)")
```

In `mathion/api/evaluations.py`, change the import (currently `from mathion.assets import validate_extension`):

```python
from mathion.assets import looks_like_pdf, validate_extension
```

Then insert the screen in `create_evaluation`, immediately after that endpoint's max-size check (inside the `if has_file:` block, so indented 8 spaces), before `block = db.get(Block, mp.block_id)`:

```python
        if not looks_like_pdf(content):
            raise HTTPException(status_code=400, detail="feedback_file is not a valid PDF (missing %PDF- header)")
```

- [ ] **Step 9: Run the endpoint tests, expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_submissions.py::test_submission_rejects_non_pdf_content tests/test_evaluations.py::test_feedback_file_rejects_non_pdf_content -q`
Expected: PASS.

- [ ] **Step 10: Run the full backend suite, expect green**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass (the fixture sweep keeps every happy-path upload valid). If any upload test fails with the "missing %PDF- header" 400, a fixture was missed — re-run the Step 7 grep.

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/mathion/assets.py backend/mathion/api/submissions.py backend/mathion/api/evaluations.py \
  backend/tests/test_assets.py backend/tests/test_submissions.py backend/tests/test_evaluations.py \
  backend/tests/test_groups.py backend/tests/test_runs.py backend/tests/test_student_mini_projects.py \
  backend/tests/test_mini_project_notifications.py
git commit -m "$(cat <<'EOF'
feat(security): reject non-PDF uploads via %PDF- header screen

Add assets.looks_like_pdf and screen both PDF uploads (submission +
evaluation feedback) after the size check. Sweep 40 four-byte b"%PDF"
test fixtures across 6 files to a valid b"%PDF-1.4" header.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Uniform 404 on the four GET reads (#1a)

**Files:**
- Modify: `mathion/api/submissions.py` (`get_submission` ~279,282; `get_submission_file` ~297,300)
- Modify: `mathion/api/evaluations.py` (`get_evaluation` ~167,170; `get_feedback_file` ~216,219)
- Modify: `tests/conftest.py` (add `_assert_hidden`)
- Test: `tests/test_submissions.py`, `tests/test_evaluations.py`

**Interfaces:**
- Consumes: `mathion.assets.looks_like_pdf` is live (Task 1), so test uploads use `b"%PDF-1.4"`.
- Produces: `tests.conftest._assert_hidden(forbidden, missing)` (reused by Task 3).

- [ ] **Step 1: Add the byte-identity helper to conftest**

Append to `tests/conftest.py` (module level, not a fixture):

```python
def _assert_hidden(forbidden, missing):
    """A forbidden response must be byte-indistinguishable from the missing-row 404:
    same status, same raw body, same Content-Type/Content-Length."""
    assert missing.status_code == 404
    assert forbidden.status_code == 404
    assert forbidden.content == missing.content
    assert forbidden.headers["content-type"] == missing.headers["content-type"]
    assert forbidden.headers["content-length"] == missing.headers["content-length"]
```

- [ ] **Step 2: Write the failing GET-read tests**

Add to `tests/test_submissions.py` (add `from tests.conftest import _assert_hidden` near the top imports):

```python
def test_get_submission_hides_existence(student_client_for, db, seed_run_with_published_mp):
    from mathion.models import Run
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = student_client_for("alice@example.com")
    sid = alice.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()["id"]
    bob = student_client_for("bob@example.com")
    missing = bob.get("/api/submissions/999999")
    membership = bob.get(f"/api/submissions/{sid}")            # other group -> membership branch
    run_obj = db.get(Run, run["id"]); run_obj.is_published = False; db.commit()
    visibility = alice.get(f"/api/submissions/{sid}")          # run unpublished -> visibility branch
    _assert_hidden(membership, missing)
    _assert_hidden(visibility, missing)


def test_get_submission_file_hides_existence(student_client_for, db, seed_run_with_published_mp):
    from mathion.models import Run
    run, ga, gb, mp = seed_run_with_published_mp()
    alice = student_client_for("alice@example.com")
    sid = alice.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()["id"]
    bob = student_client_for("bob@example.com")
    missing = bob.get("/api/submissions/999999/file")
    membership = bob.get(f"/api/submissions/{sid}/file")
    run_obj = db.get(Run, run["id"]); run_obj.is_published = False; db.commit()
    visibility = alice.get(f"/api/submissions/{sid}/file")
    _assert_hidden(membership, missing)
    _assert_hidden(visibility, missing)
```

Add to `tests/test_evaluations.py` (add `from tests.conftest import _assert_hidden` to the existing conftest import line):

```python
def test_get_evaluation_hides_existence(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Run
    run, ga, mp, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    bob = student_client_for("bob@example.com")
    missing = bob.get("/api/submissions/999999/evaluation")
    membership = bob.get(f"/api/submissions/{sub['id']}/evaluation")
    run_obj = db.get(Run, run["id"]); run_obj.is_published = False; db.commit()
    alice = student_client_for("alice@example.com")
    visibility = alice.get(f"/api/submissions/{sub['id']}/evaluation")
    _assert_hidden(membership, missing)
    _assert_hidden(visibility, missing)


def test_get_feedback_file_hides_existence(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Run
    run, ga, mp, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    ev = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "x"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()
    bob = student_client_for("bob@example.com")
    missing = bob.get("/api/evaluations/999999/feedback-file")
    membership = bob.get(f"/api/evaluations/{ev['id']}/feedback-file")
    run_obj = db.get(Run, run["id"]); run_obj.is_published = False; db.commit()
    alice = student_client_for("alice@example.com")
    visibility = alice.get(f"/api/evaluations/{ev['id']}/feedback-file")
    _assert_hidden(membership, missing)
    _assert_hidden(visibility, missing)
```

- [ ] **Step 3: Run them, expect failure**

Run: `cd backend && .venv/bin/pytest tests/test_submissions.py::test_get_submission_hides_existence tests/test_submissions.py::test_get_submission_file_hides_existence tests/test_evaluations.py::test_get_evaluation_hides_existence tests/test_evaluations.py::test_get_feedback_file_hides_existence -q`
Expected: FAIL — the membership/visibility probes return `403`, not the `404` the missing probe returns.

- [ ] **Step 4: Flip the four GET reads to uniform 404**

In `mathion/api/submissions.py`, `get_submission` — change both raises in this block:

```python
    if not mini_project_visible_to_student(run, mp):
        raise HTTPException(status_code=404, detail="Submission not found")
    group = get_submitter_group(db, run.id, user.id)
    if group is None or group.id != sub.group_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    return sub
```

In `mathion/api/submissions.py`, `get_submission_file` — change both raises in this block:

```python
    if not is_run_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=404, detail="Submission not found")
        group = get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=404, detail="Submission not found")
```

In `mathion/api/evaluations.py`, `get_evaluation` — change both raises in this block:

```python
    if not is_run_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=404, detail="Submission not found")
        group = get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=404, detail="Submission not found")
```

In `mathion/api/evaluations.py`, `get_feedback_file` — change both raises in this block (note: `"Evaluation not found"`, this endpoint is keyed by `eid`):

```python
    if not is_run_admin_or_teacher(db, user, run):
        if not mini_project_visible_to_student(run, mp):
            raise HTTPException(status_code=404, detail="Evaluation not found")
        group = get_submitter_group(db, run.id, user.id)
        if group is None or group.id != sub.group_id:
            raise HTTPException(status_code=404, detail="Evaluation not found")
```

- [ ] **Step 5: Run the new tests, expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_submissions.py::test_get_submission_hides_existence tests/test_submissions.py::test_get_submission_file_hides_existence tests/test_evaluations.py::test_get_evaluation_hides_existence tests/test_evaluations.py::test_get_feedback_file_hides_existence -q`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite, expect green**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass. (No existing test asserts these four reads return `403` — verified during planning.)

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/mathion/api/submissions.py backend/mathion/api/evaluations.py \
  backend/tests/conftest.py backend/tests/test_submissions.py backend/tests/test_evaluations.py
git commit -m "$(cat <<'EOF'
feat(security): hide submission/evaluation existence on GET reads

Flip the four GET-by-id reads (get_submission, get_submission_file,
get_evaluation, get_feedback_file) from 403 to a 404 byte-identical to
the missing-row 404, on both the visibility and membership branches, so
a forbidden row is indistinguishable from an absent one.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Uniform 404 on the two mutation endpoints (#1b)

**Files:**
- Modify: `mathion/api/evaluations.py` (`create_evaluation` authz ~line 67; `patch_evaluation` authz ~line 188; drop unused `require_run_admin_or_teacher` import ~line 16)
- Test: `tests/test_evaluations.py` (rewrite `test_post_evaluation_requires_admin_or_teacher`; add a patch probe)

**Interfaces:**
- Consumes: `tests.conftest._assert_hidden` (Task 2); `mathion.api.helpers.is_run_admin_or_teacher` (already imported in `evaluations.py`).

- [ ] **Step 1: Rewrite the existing authz test as a byte-identity test (failing)**

In `tests/test_evaluations.py`, replace the body of `test_post_evaluation_requires_admin_or_teacher` with:

```python
def test_post_evaluation_requires_admin_or_teacher(auth_client, admin_client, student_client_for, db, seed_run_with_groups):
    """Non-staff cannot create an evaluation, and existence is hidden (404, not 403)."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    missing = auth_client.post("/api/submissions/999999/evaluation", data={"result": "accepted"})
    forbidden = auth_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    _assert_hidden(forbidden, missing)
```

Add a new patch probe test:

```python
def test_patch_evaluation_hides_existence(auth_client, admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    ev = admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"}).json()
    missing = auth_client.patch("/api/evaluations/999999", json={})
    forbidden = auth_client.patch(f"/api/evaluations/{ev['id']}", json={})
    _assert_hidden(forbidden, missing)
```

(`_assert_hidden` was imported into this module in Task 2.)

- [ ] **Step 2: Run them, expect failure**

Run: `cd backend && .venv/bin/pytest tests/test_evaluations.py::test_post_evaluation_requires_admin_or_teacher tests/test_evaluations.py::test_patch_evaluation_hides_existence -q`
Expected: FAIL — the forbidden probes return `403`, not the `404` the missing probes return.

- [ ] **Step 3: Swap both authz gates to `is_run_admin_or_teacher`→404**

In `mathion/api/evaluations.py`, `create_evaluation` — replace `require_run_admin_or_teacher(db, user, run)` (the one following `run = get_or_404(db, Run, mp.run_id)` near the top of `create_evaluation`) with:

```python
    if not is_run_admin_or_teacher(db, user, run):
        raise HTTPException(status_code=404, detail="Submission not found")
```

In `mathion/api/evaluations.py`, `patch_evaluation` — replace `require_run_admin_or_teacher(db, user, run)` (the one following `run = get_or_404(db, Run, mp.run_id)` in `patch_evaluation`) with:

```python
    if not is_run_admin_or_teacher(db, user, run):
        raise HTTPException(status_code=404, detail="Evaluation not found")
```

- [ ] **Step 4: Remove the now-unused import**

In `mathion/api/evaluations.py`, delete the `require_run_admin_or_teacher,` line from the `from mathion.api.helpers import (...)` block. (`is_run_admin_or_teacher` stays — it is now used in all four evaluation reads/mutations.)

- [ ] **Step 5: Run the mutation tests, expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_evaluations.py::test_post_evaluation_requires_admin_or_teacher tests/test_evaluations.py::test_patch_evaluation_hides_existence -q`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite, expect green**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass. (Confirms no other caller relied on `require_run_admin_or_teacher` in `evaluations.py` and no import error.)

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/mathion/api/evaluations.py backend/tests/test_evaluations.py
git commit -m "$(cat <<'EOF'
feat(security): hide existence on create/patch evaluation

Swap create_evaluation + patch_evaluation authz from
require_run_admin_or_teacher (403) to is_run_admin_or_teacher->404,
matching the missing-row body, closing the sid/eid enumeration oracle
on the mutation endpoints. Drop the now-unused import.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- #1 six endpoints: `get_submission`/`get_submission_file` (Task 2), `get_evaluation`/`get_feedback_file` (Task 2), `create_evaluation`/`patch_evaluation` (Task 3). ✅
- #1 both GET branches (visibility + membership): each Task-2 test exercises both. ✅
- #1 byte-identity (status + raw content + Content-Type/Content-Length): `_assert_hidden`. ✅
- #1 detail-string mapping (Submission-keyed → "Submission not found"; `get_feedback_file`/`patch_evaluation` → "Evaluation not found"): ✅
- #1 import cleanup: Task 3 Step 4. ✅
- #2 helper + both uploads + strict `%PDF-`: Task 1. ✅
- #2 fixture sweep 40/6 files: Task 1 Step 7. ✅
- #2 unit + endpoint tests: Task 1. ✅
- Preserved 403s (`create_submission`, `list_submissions`) and post-auth 404s: untouched (no task edits them). ✅
- Timing residual: documented in spec, no code (correct — out of scope). ✅

**2. Placeholder scan:** every code step shows complete code; every run step shows the exact command + expected result. No TBD/TODO. ✅

**3. Type consistency:** `looks_like_pdf(content: bytes) -> bool` defined in Task 1, used verbatim in Task 1 wiring. `_assert_hidden(forbidden, missing)` defined in Task 2 conftest, imported + used identically in Tasks 2 and 3. Detail strings consistent across tasks and match `get_or_404`. `is_run_admin_or_teacher` signature matches its existing definition. ✅

**Note for the implementer:** the four GET-read raises in Task 2 have duplicated string literals within and across the two files (`"Not visible"`, membership messages). Match on the full `if`-block shown, not a bare line, so the correct occurrence is edited. Likewise both `require_run_admin_or_teacher(db, user, run)` calls in Task 3 are identical — disambiguate by the enclosing function (`create_evaluation` vs `patch_evaluation`).
