# Run-Assets Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Assets management tab to `RunDetailPage` for admins/teachers to audit, upload, replace, and delete (single + bulk + force-delete) run assets, with a new `PUT /api/runs/{rid}/assets/{aid}` replace endpoint.

**Architecture:** New `RunAssetsTab.svelte` as 6th tab on `RunDetailPage`. Backend gains one PUT endpoint (lookup → ownership → validate → atomic temp/rename) plus an `uploaded_by_email` schema field populated post-hoc at all response sites. Frontend `extractAssetRefs` helper mirrors the backend Markdown extractor so the "uses N" UX agrees with `is_referenced`. Bulk delete uses sequential DELETEs with `AbortController` + per-iteration `loadToken/runIdInt` guard; replace + bulk share a Svelte 5 `$effect` pattern that explicitly tracks the `runId` prop. Reference-count drift, cross-tab consistency, lost-update races, and partial server-side commits are documented Accepted gaps.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Pydantic (backend); Svelte 5 (runes) + Vitest + Testing Library (frontend); pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-05-25-run-assets-management-design.md` (rev 3.5, commit `d0f037f`).

**Branch:** `run-assets-management`.

---

## Task 1: Backend — `uploaded_by_email` schema field + GET-list + POST populate

**Files:**
- Modify: `backend/mathion/schemas.py:651-661` (RunAssetResponse)
- Modify: `backend/mathion/api/run_assets.py` (POST handler + GET-list)
- Modify: `backend/tests/test_run_assets.py` (new tests)

- [ ] **Step 1: Write the failing test for `uploaded_by_email` populated on GET-list**

Open `backend/tests/test_run_assets.py` and add (near the existing GET-list tests):

```python
def test_list_assets_returns_uploaded_by_email(db, client, run, run_admin):
    # Upload an asset as run_admin
    upload_resp = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
    )
    assert upload_resp.status_code == 200

    list_resp = client.get(f"/api/runs/{run.id}/assets")
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert len(rows) == 1
    assert rows[0]["uploaded_by_email"] == run_admin.email


def test_list_assets_uploaded_by_email_null_when_user_deleted_set_null(db, client, run):
    # Create an asset whose uploaded_by FK was nulled (SET NULL on user delete)
    from backend.mathion.models import RunAsset
    a = RunAsset(
        run_id=run.id,
        filename="orphan.pdf",
        file_size=10,
        mime_type="application/pdf",
        uploaded_by=None,
    )
    db.add(a)
    db.commit()

    list_resp = client.get(f"/api/runs/{run.id}/assets")
    rows = list_resp.json()
    assert any(r["filename"] == "orphan.pdf" and r["uploaded_by_email"] is None for r in rows)


def test_list_assets_uploaded_by_email_null_when_user_row_missing(db, client, run):
    # FK points at a nonexistent user_id (hard-delete bypassed cascade)
    from backend.mathion.models import RunAsset
    a = RunAsset(
        run_id=run.id,
        filename="ghost.pdf",
        file_size=10,
        mime_type="application/pdf",
        uploaded_by=99999,  # nonexistent
    )
    db.add(a)
    db.commit()

    list_resp = client.get(f"/api/runs/{run.id}/assets")
    rows = list_resp.json()
    assert any(r["filename"] == "ghost.pdf" and r["uploaded_by_email"] is None for r in rows)
```

(Adjust fixture names to match the actual `run`, `run_admin`, `client`, `db` fixtures used elsewhere in this test file — read lines 1-50 of the file before writing the test to confirm exact fixture signatures.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_list_assets_returns_uploaded_by_email -xvs`

Expected: FAIL with `KeyError: 'uploaded_by_email'` (the field doesn't exist on the response yet).

- [ ] **Step 3: Add the schema field with a default**

Open `backend/mathion/schemas.py:651-661` (the `RunAssetResponse` definition). Add the field after `uploaded_by`:

```python
class RunAssetResponse(BaseModel):
    id: int
    run_id: int
    filename: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: int | None
    uploaded_by_email: str | None = None  # populated post-hoc at response sites; None default keeps existing call sites valid
    is_referenced: bool = False

    model_config = {"from_attributes": True}
```

The `= None` default is load-bearing: the existing POST handler at `backend/mathion/api/run_assets.py:97-99` returns `RunAssetResponse.model_validate(asset)` directly. Without a default, this validation would fail because the ORM row has no `uploaded_by_email` attribute. The default lets the existing POST path stay valid until Step 5 patches it.

- [ ] **Step 4: Populate `uploaded_by_email` post-hoc in the GET-list endpoint**

Open `backend/mathion/api/run_assets.py`. Find the GET-list endpoint (around line 102-122 — the existing route that returns `list[RunAssetResponse]`). It currently builds responses like:

```python
resp = RunAssetResponse.model_validate(a)
resp.is_referenced = ref_count > 0
```

Add the email lookup immediately after `is_referenced`. The `User` model and `select` are already imported at lines 6 and 24.

```python
from backend.mathion.models import User  # confirm this import exists at top; if not, add it

# inside the list-comprehension or for-loop building responses:
resp = RunAssetResponse.model_validate(a)
resp.is_referenced = ref_count > 0
resp.uploaded_by_email = (
    db.scalar(select(User.email).where(User.id == a.uploaded_by))
    if a.uploaded_by is not None
    else None
)
```

**Note**: this is the N+1 the spec acknowledges (Accepted gaps). Typical scale (~20 assets) keeps it cheap; all lookups are on indexed `users.id`.

- [ ] **Step 5: Populate `uploaded_by_email` in the POST handler**

Same file. Find the POST handler (around lines 60-100). It currently returns:

```python
return RunAssetResponse.model_validate(asset)
```

Replace with:

```python
resp = RunAssetResponse.model_validate(asset)
resp.is_referenced = False  # newly uploaded → no refs yet
resp.uploaded_by_email = (
    db.scalar(select(User.email).where(User.id == asset.uploaded_by))
    if asset.uploaded_by is not None
    else None
)
return resp
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py -xvs -k uploaded_by_email`

Expected: PASS for all three tests.

- [ ] **Step 7: Run the full backend test file to check for regressions**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py -xvs`

Expected: all tests pass (no regressions from the schema field addition).

- [ ] **Step 8: Add a test for POST returning the email**

Append to `backend/tests/test_run_assets.py`:

```python
def test_post_asset_returns_uploaded_by_email(client, run, run_admin):
    resp = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("hello.pdf", b"%PDF-1.4\n", "application/pdf")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["uploaded_by_email"] == run_admin.email
```

- [ ] **Step 9: Run the new POST test**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_post_asset_returns_uploaded_by_email -xvs`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/run_assets.py backend/tests/test_run_assets.py
git commit -m "$(cat <<'EOF'
feat(backend): RunAssetResponse.uploaded_by_email — populate at POST + GET-list

Schema field with default None preserves existing POST validation
without code changes. Populate post-hoc at the two response sites that
emit RunAssetResponse JSON (POST and GET-list). The filename-keyed
GET at run_assets.py:125 returns FileResponse — no schema, no
email lookup. PUT endpoint will populate in T2.

Null-safety: db.scalar returns None when uploaded_by is None (SET NULL)
or points at a hard-deleted user row (FK still set, row missing).

T1 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — `PUT /api/runs/{rid}/assets/{aid}` replace endpoint

**Files:**
- Modify: `backend/mathion/api/run_assets.py` (new PUT endpoint)
- Modify: `backend/tests/test_run_assets.py` (PUT tests)

**Acceptance contract (from spec section "Backend additions"):** Operation ordering is `get_or_404` → ownership check (`asset.run_id == run_id` else 404) → case-insensitive extension match (422) → per-file size (413) → quota delta (413) → temp write → atomic rename → DB commit. No orphan temp file on any pre-rename failure. `RunAssetReference` rows untouched (filename preserved). Returns updated response with `is_referenced` + `uploaded_by_email` populated.

- [ ] **Step 1: Write the failing test for PUT success (same-extension replace)**

Append to `backend/tests/test_run_assets.py`:

```python
def test_put_replace_asset_success_same_extension(client, run, run_admin, tmp_upload_dir):
    # Upload an initial asset
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\nINITIAL\n", "application/pdf")},
    ).json()
    asset_id = initial["id"]
    initial_size = initial["file_size"]
    initial_uploaded_at = initial["uploaded_at"]

    # Replace with new content
    new_content = b"%PDF-1.4\nREPLACED-LARGER-PAYLOAD\n"
    resp = client.put(
        f"/api/runs/{run.id}/assets/{asset_id}",
        files={"file": ("any-name.pdf", new_content, "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == asset_id
    assert body["filename"] == "doc.pdf"  # original filename preserved
    assert body["file_size"] == len(new_content)
    assert body["file_size"] != initial_size
    assert body["uploaded_at"] != initial_uploaded_at  # touched
    assert body["uploaded_by_email"] == run_admin.email
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_asset_success_same_extension -xvs`

Expected: FAIL with 405 Method Not Allowed (endpoint doesn't exist).

- [ ] **Step 3: Add the PUT endpoint skeleton**

Open `backend/mathion/api/run_assets.py`. Add the new endpoint after the existing POST (around the existing DELETE which is at line 188). Add imports if not already present at the top:

```python
import os
import tempfile
from datetime import datetime, timezone
from sqlalchemy import select
from fastapi import HTTPException, status
from backend.mathion.assets import (
    validate_extension,
    sanitize_filename,
    MAX_FILE_SIZE_BYTES,
    MAX_COURSE_SIZE,
)
```

(Verify which ones already exist before editing — many should already be in scope.)

Add the endpoint:

```python
@router.put("/{asset_id}", response_model=RunAssetResponse)
async def replace_run_asset(
    run_id: int,
    asset_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_run_admin_or_teacher),
):
    """Replace the file content of an existing RunAsset.

    Preserves the row's filename so all RunAssetReference rows stay valid.
    Validates: ownership, extension match (case-insensitive), per-file size,
    per-run aggregate quota delta. Writes temp → atomic rename → commit.
    """
    # Step 1: lookup (404 before touching disk)
    asset = db.get(RunAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Step 2: ownership check (404 — same semantics as DELETE at run_assets.py:192-194)
    if asset.run_id != run_id:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Step 3: extension match (case-insensitive — validate_extension already lowercases)
    incoming_ext = validate_extension(file.filename)  # raises 422 if extension disallowed
    existing_ext = asset.filename.rsplit(".", 1)[-1].lower() if "." in asset.filename else ""
    if incoming_ext != existing_ext:
        raise HTTPException(
            status_code=422,
            detail=f"Extension must match the existing asset's extension ({existing_ext}).",
        )

    # Step 4: per-file size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large.")

    # Step 5: aggregate quota delta — only the delta counts
    size_delta = len(contents) - asset.file_size
    if size_delta > 0:
        current_total = db.scalar(
            select(func.coalesce(func.sum(RunAsset.file_size), 0))
            .where(RunAsset.run_id == run_id)
        ) or 0
        if current_total + size_delta > MAX_COURSE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"Replacing would exceed this run's storage quota by {current_total + size_delta - MAX_COURSE_SIZE} bytes.",
            )

    # Step 6 + 7: write temp + atomic rename under the EXISTING filename
    final_path = _asset_path(run_id, asset.filename)  # use whatever helper the existing POST uses
    temp_fd, temp_path = tempfile.mkstemp(
        dir=os.path.dirname(final_path), prefix=".upload-", suffix=".tmp"
    )
    try:
        with os.fdopen(temp_fd, "wb") as tmp:
            tmp.write(contents)
        os.replace(temp_path, final_path)
    except Exception:
        # Clean up temp file on any exception during the write/rename
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise

    # Step 8: update DB row
    asset.file_size = len(contents)
    asset.mime_type = file.content_type or "application/octet-stream"
    asset.uploaded_at = datetime.now(timezone.utc)
    asset.uploaded_by = user.id
    db.commit()
    db.refresh(asset)

    # Step 9: return response with is_referenced + uploaded_by_email populated
    ref_count = db.scalar(
        select(func.count(RunAssetReference.id))
        .where(RunAssetReference.run_asset_id == asset.id)
    ) or 0
    resp = RunAssetResponse.model_validate(asset)
    resp.is_referenced = ref_count > 0
    resp.uploaded_by_email = (
        db.scalar(select(User.email).where(User.id == asset.uploaded_by))
        if asset.uploaded_by is not None
        else None
    )
    return resp
```

**Note**: the exact helper name for the asset path (`_asset_path` above) depends on what the existing POST uses. Read the POST handler in the same file to confirm the helper name and signature. If POST inlines the path computation, factor it into a small helper at this point.

- [ ] **Step 4: Run the success test to verify it passes**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_asset_success_same_extension -xvs`

Expected: PASS.

- [ ] **Step 5: Write the failing test for case-insensitive extension (`.PDF` replaces `.pdf`)**

Append:

```python
def test_put_replace_case_insensitive_extension(client, run, run_admin):
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()

    # Replace with .PDF (uppercase) — should be accepted because both sides are lowercased
    resp = client.put(
        f"/api/runs/{run.id}/assets/{initial['id']}",
        files={"file": ("NEW.PDF", b"%PDF-1.4\nNEW\n", "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
```

- [ ] **Step 6: Run; expected PASS** (the implementation already lowercases on both sides)

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_case_insensitive_extension -xvs`

- [ ] **Step 7: Write the failing test for 422 extension mismatch**

```python
def test_put_replace_422_on_extension_mismatch(client, run):
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()

    resp = client.put(
        f"/api/runs/{run.id}/assets/{initial['id']}",
        files={"file": ("doc.png", b"\x89PNG\r\n", "image/png")},
    )
    assert resp.status_code == 422
    assert "extension" in resp.json()["detail"].lower()
```

- [ ] **Step 8: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_422_on_extension_mismatch -xvs`

- [ ] **Step 9: Write the failing test for 404 on missing asset + no orphan temp file**

```python
def test_put_replace_404_on_missing_asset_no_orphan_temp(client, run, tmp_upload_dir):
    # Tmp dir snapshot before
    before = set(os.listdir(tmp_upload_dir))

    resp = client.put(
        f"/api/runs/{run.id}/assets/999999",
        files={"file": ("ghost.pdf", b"%PDF-1.4\n", "application/pdf")},
    )
    assert resp.status_code == 404

    # No orphan temp file left behind
    after = set(os.listdir(tmp_upload_dir))
    assert before == after, f"Orphan temp file(s): {after - before}"
```

(Use whatever fixture name the existing tests use for the upload dir — likely `tmp_upload_dir` or similar. If none exists, read the test file's conftest or fixtures to find the right hook.)

- [ ] **Step 10: Run; expected PASS** (ordering guarantees lookup before temp write)

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_404_on_missing_asset_no_orphan_temp -xvs`

- [ ] **Step 11: Write the failing test for 404 on cross-run asset_id (ownership boundary)**

```python
def test_put_replace_404_on_cross_run_asset_id(client, run, run_admin, second_run, tmp_upload_dir):
    """User authorized on both runs; PUT against run_A with asset belonging to run_B → 404."""
    # Upload an asset to run_B
    asset_b = client.post(
        f"/api/runs/{second_run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()

    before = set(os.listdir(tmp_upload_dir))

    # PUT against run_A with run_B's asset_id
    resp = client.put(
        f"/api/runs/{run.id}/assets/{asset_b['id']}",
        files={"file": ("doc.pdf", b"%PDF-1.4\nNEW\n", "application/pdf")},
    )
    assert resp.status_code == 404

    after = set(os.listdir(tmp_upload_dir))
    assert before == after, f"Orphan temp file(s): {after - before}"
```

(If a `second_run` fixture doesn't exist, create one by adapting the existing `run` fixture to make a second run record.)

- [ ] **Step 12: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_404_on_cross_run_asset_id -xvs`

- [ ] **Step 13: Write the failing test for 403 on a different run (auth boundary)**

```python
def test_put_replace_403_on_unauthorized_run(client, run, other_run_user_not_authorized):
    """User has no role on the run → 403."""
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()

    # Switch to a user with no role on this run
    other_client = client_for_user(other_run_user_not_authorized)
    resp = other_client.put(
        f"/api/runs/{run.id}/assets/{initial['id']}",
        files={"file": ("doc.pdf", b"%PDF-1.4\nNEW\n", "application/pdf")},
    )
    assert resp.status_code == 403
```

(Adapt fixture names to match the existing test file's auth helpers.)

- [ ] **Step 14: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_403_on_unauthorized_run -xvs`

- [ ] **Step 15: Write the failing test for file content actually overwritten**

```python
def test_put_replace_overwrites_file_content(client, run):
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"INITIAL", "application/pdf")},
    ).json()

    # Read via GET serve URL → INITIAL
    serve = client.get(f"/api/runs/{run.id}/assets/doc.pdf")
    assert serve.content == b"INITIAL"

    # Replace
    client.put(
        f"/api/runs/{run.id}/assets/{initial['id']}",
        files={"file": ("doc.pdf", b"REPLACED", "application/pdf")},
    )

    # Read again → REPLACED
    serve2 = client.get(f"/api/runs/{run.id}/assets/doc.pdf")
    assert serve2.content == b"REPLACED"
```

- [ ] **Step 16: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_overwrites_file_content -xvs`

- [ ] **Step 17: Write the failing test for `RunAssetReference.id` preservation (≥2 MPs, same ID set, count unchanged)**

```python
def test_put_replace_preserves_RunAssetReference_rows(client, db, run, version, run_admin):
    """Fixture with ≥2 referencing MPs; assert pre/post sets of RunAssetReference.id
    are equal AND row count is unchanged (forbids delete-and-reinsert + orphan inserts)."""
    from backend.mathion.models import MiniProject, RunAssetReference

    # Upload asset
    asset = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("data.csv", b"a,b\n1,2\n", "text/csv")},
    ).json()
    aid = asset["id"]

    # Create 2 MPs that reference data.csv in assignment_md
    mp1 = MiniProject(
        run_id=run.id, version_id=version.id, slug="mp-one",
        title="MP 1", assignment_md="See ![data](data.csv) for details.",
        hard_deadline=None, resubmission_deadline=None, is_published=False,
    )
    mp2 = MiniProject(
        run_id=run.id, version_id=version.id, slug="mp-two",
        title="MP 2", assignment_md="Also references [data](data.csv).",
        hard_deadline=None, resubmission_deadline=None, is_published=False,
    )
    db.add_all([mp1, mp2])
    db.commit()

    # Trigger the existing sync (called by save/publish flow — adapt to project convention)
    from backend.mathion.api.helpers import sync_run_asset_references
    sync_run_asset_references(db, mp1)
    sync_run_asset_references(db, mp2)
    db.commit()

    pre_ids = set(db.scalars(
        select(RunAssetReference.id).where(RunAssetReference.run_asset_id == aid)
    ).all())
    assert len(pre_ids) >= 2, f"Expected ≥2 refs, got {pre_ids}"

    # Replace the asset
    client.put(
        f"/api/runs/{run.id}/assets/{aid}",
        files={"file": ("ignored.csv", b"a,b,c\n1,2,3\n", "text/csv")},
    )

    post_ids = set(db.scalars(
        select(RunAssetReference.id).where(RunAssetReference.run_asset_id == aid)
    ).all())
    post_count = db.scalar(
        select(func.count(RunAssetReference.id)).where(RunAssetReference.run_asset_id == aid)
    )

    assert post_ids == pre_ids, "RunAssetReference.id set must be preserved"
    assert post_count == len(pre_ids), "Row count must be unchanged (no orphan inserts)"
```

(Adapt MP/version creation to match the actual model constructors and helpers in the test file.)

- [ ] **Step 18: Run; expected PASS** (the implementation does NOT touch `RunAssetReference`)

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_preserves_RunAssetReference_rows -xvs`

- [ ] **Step 19: Write the failing test for 413 on oversize**

```python
def test_put_replace_413_on_oversize(client, run, monkeypatch):
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()

    # Mock MAX_FILE_SIZE_BYTES to a small value
    monkeypatch.setattr("backend.mathion.assets.MAX_FILE_SIZE_BYTES", 10)

    resp = client.put(
        f"/api/runs/{run.id}/assets/{initial['id']}",
        files={"file": ("doc.pdf", b"X" * 100, "application/pdf")},
    )
    assert resp.status_code == 413
```

- [ ] **Step 20: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_413_on_oversize -xvs`

- [ ] **Step 21: Write the failing test for 413 on quota delta (small file → large file pushes run over MAX_COURSE_SIZE)**

```python
def test_put_replace_413_on_quota_delta_exceeded(client, run, monkeypatch):
    initial = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("doc.pdf", b"X" * 10, "application/pdf")},
    ).json()

    # Set quota to be just above current usage
    monkeypatch.setattr("backend.mathion.assets.MAX_COURSE_SIZE", 50)

    # Replacing 10-byte file with 200-byte file = +190 delta → exceeds 50
    resp = client.put(
        f"/api/runs/{run.id}/assets/{initial['id']}",
        files={"file": ("doc.pdf", b"X" * 200, "application/pdf")},
    )
    assert resp.status_code == 413
```

- [ ] **Step 22: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_put_replace_413_on_quota_delta_exceeded -xvs`

- [ ] **Step 23: Run the full backend test file to check for regressions**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py -xvs`

Expected: all tests pass.

- [ ] **Step 24: Commit**

```bash
git add backend/mathion/api/run_assets.py backend/tests/test_run_assets.py
git commit -m "$(cat <<'EOF'
feat(backend): PUT /api/runs/{rid}/assets/{aid} — replace endpoint

Operation ordering guarantees no orphan temp file on any pre-rename
failure: get_or_404 → ownership check (asset.run_id == run_id else
404, mirrors DELETE at run_assets.py:192-194) → case-insensitive
extension match (422) → per-file size (413) → quota delta (413) →
tempfile.mkstemp → os.replace → DB commit. Existing filename is
preserved (incoming file's name is ignored) so all RunAssetReference
rows stay valid; sync intentionally skipped.

Returns updated RunAssetResponse with is_referenced + uploaded_by_email
populated consistently with GET-list.

Permissions: require_run_admin_or_teacher (same gate as POST/DELETE-
without-force).

T2 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — DELETE force-flag role-gate tests

**Files:**
- Modify: `backend/tests/test_run_assets.py` (new force-flag boundary tests)

**Acceptance contract:** Existing DELETE endpoint already enforces `require_course_admin_for_run` when `force=true`. This task adds the role-boundary tests that were missing from T2's PUT-focused work.

- [ ] **Step 1: Write the failing test for force-delete by run-teacher → 403**

Append to `backend/tests/test_run_assets.py`:

```python
def test_force_delete_referenced_by_run_teacher_403(client, db, run, version, run_teacher_not_admin):
    """Run-teacher (not course-admin) attempts DELETE ?force=true on referenced asset → 403."""
    from backend.mathion.models import MiniProject

    # Upload an asset and reference it from an MP
    asset = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("ref.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()

    mp = MiniProject(
        run_id=run.id, version_id=version.id, slug="ref-mp",
        title="Ref MP", assignment_md="See ![ref](ref.pdf).",
        hard_deadline=None, resubmission_deadline=None, is_published=False,
    )
    db.add(mp)
    db.commit()
    from backend.mathion.api.helpers import sync_run_asset_references
    sync_run_asset_references(db, mp)
    db.commit()

    # Switch to a run-teacher (not course-admin)
    teacher_client = client_for_user(run_teacher_not_admin)
    resp = teacher_client.delete(
        f"/api/runs/{run.id}/assets/{asset['id']}?force=true"
    )
    assert resp.status_code == 403
```

(Adapt `run_teacher_not_admin` and `client_for_user` to match existing fixture/helper conventions in the test file.)

- [ ] **Step 2: Run; expected PASS** (existing DELETE endpoint already enforces this gate; we're locking the contract)

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_force_delete_referenced_by_run_teacher_403 -xvs`

- [ ] **Step 3: Write the failing test for force=false by run-teacher on referenced asset → existing 409 semantics**

```python
def test_delete_referenced_by_run_teacher_without_force_returns_409(client, db, run, version, run_teacher_not_admin):
    """Run-teacher DELETE without force on referenced asset → 409 (existing semantics).

    This locks the contract that the gate distinguishes force from non-force:
    non-force is allowed for run-teachers; force is course-admin-only.
    """
    from backend.mathion.models import MiniProject

    asset = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("ref2.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()
    mp = MiniProject(
        run_id=run.id, version_id=version.id, slug="ref-mp-2",
        title="Ref MP 2", assignment_md="See ![ref](ref2.pdf).",
        hard_deadline=None, resubmission_deadline=None, is_published=False,
    )
    db.add(mp)
    db.commit()
    from backend.mathion.api.helpers import sync_run_asset_references
    sync_run_asset_references(db, mp)
    db.commit()

    teacher_client = client_for_user(run_teacher_not_admin)
    resp = teacher_client.delete(f"/api/runs/{run.id}/assets/{asset['id']}")
    # Force not passed; backend should refuse referenced delete with 409
    assert resp.status_code == 409
```

- [ ] **Step 4: Run; expected PASS** (existing semantics)

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_delete_referenced_by_run_teacher_without_force_returns_409 -xvs`

- [ ] **Step 5: Write the failing test for course-admin force-delete cascade (locks behavior we depend on)**

```python
def test_force_delete_by_course_admin_cascades_RunAssetReference(client, db, run, version, course_admin):
    """course-admin DELETE ?force=true on referenced asset → 204 + RunAssetReference rows gone."""
    from backend.mathion.models import MiniProject, RunAssetReference

    asset = client.post(
        f"/api/runs/{run.id}/assets",
        files={"file": ("cascade.pdf", b"%PDF-1.4\n", "application/pdf")},
    ).json()
    aid = asset["id"]

    mp = MiniProject(
        run_id=run.id, version_id=version.id, slug="cascade-mp",
        title="Cascade MP", assignment_md="See ![cascade](cascade.pdf).",
        hard_deadline=None, resubmission_deadline=None, is_published=False,
    )
    db.add(mp)
    db.commit()
    from backend.mathion.api.helpers import sync_run_asset_references
    sync_run_asset_references(db, mp)
    db.commit()

    pre_count = db.scalar(
        select(func.count(RunAssetReference.id))
        .where(RunAssetReference.run_asset_id == aid)
    )
    assert pre_count >= 1

    admin_client = client_for_user(course_admin)
    resp = admin_client.delete(f"/api/runs/{run.id}/assets/{aid}?force=true")
    assert resp.status_code == 204

    post_count = db.scalar(
        select(func.count(RunAssetReference.id))
        .where(RunAssetReference.run_asset_id == aid)
    )
    assert post_count == 0
```

- [ ] **Step 6: Run; expected PASS**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py::test_force_delete_by_course_admin_cascades_RunAssetReference -xvs`

- [ ] **Step 7: Run the full backend test file to check for regressions**

Run: `backend/.venv/bin/pytest backend/tests/test_run_assets.py -xvs`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/tests/test_run_assets.py
git commit -m "$(cat <<'EOF'
test(backend): DELETE force-flag role-boundary coverage

Locks the contract that the gate distinguishes force=true (course-
admin-only via require_course_admin_for_run at helpers.py:96-105) from
non-force (run-teacher allowed):

- force=true by run-teacher on referenced asset → 403
- force=false by run-teacher on referenced asset → 409 (existing)
- force=true by course-admin → 204 + RunAssetReference cascade

T3 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend lib — types + `runAssets` helpers

**Files:**
- Modify: `frontend/src/lib/types.ts` (extend `RunAssetResponse`)
- Modify: `frontend/src/lib/runAssets.ts` (add `replaceRunAsset`; extend `deleteRunAsset`)
- Modify: `frontend/src/tests/runAssets.test.ts` (new wire-contract tests)

- [ ] **Step 1: Write the failing test for `replaceRunAsset` PUT wire contract**

Open `frontend/src/tests/runAssets.test.ts`. Find the existing `uploadRunAsset` tests at lines 37-68 to use as a template. Add:

```typescript
describe('replaceRunAsset', () => {
  it('PUTs multipart with correct wire properties', async () => {
    const file = new File(['new content'], 'ignored.pdf', { type: 'application/pdf' });
    const ctrl = new AbortController();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 42, run_id: 1, filename: 'doc.pdf', file_size: 11,
        mime_type: 'application/pdf',
        uploaded_at: '2026-05-25T12:00:00Z',
        uploaded_by: 7, uploaded_by_email: 'admin@example.com',
        is_referenced: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const result = await replaceRunAsset(1, 42, file, ctrl.signal);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/runs/1/assets/42');
    expect(init?.method).toBe('PUT');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBe('mathion');
    // No manual Content-Type — browser sets multipart boundary
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init?.signal).toBe(ctrl.signal);
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('file')).toBe(file);

    expect(result.id).toBe(42);
    expect(result.uploaded_by_email).toBe('admin@example.com');
  });
});
```

Also add the import at the top:

```typescript
import { replaceRunAsset } from '../lib/runAssets';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/runAssets.test.ts -t "replaceRunAsset"`

Expected: FAIL — `replaceRunAsset` is not exported from `../lib/runAssets`.

- [ ] **Step 3: Extend the `RunAssetResponse` type**

Open `frontend/src/lib/types.ts`. Find `RunAssetResponse` (around line 415) and add the new field:

```typescript
export type RunAssetResponse = {
  id: number;
  run_id: number;
  filename: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by: number | null;
  uploaded_by_email: string | null;
  is_referenced: boolean;
};
```

- [ ] **Step 4: Implement `replaceRunAsset`**

Open `frontend/src/lib/runAssets.ts`. After `uploadRunAsset` (around line 37), add:

```typescript
export async function replaceRunAsset(
  runId: number,
  assetId: number,
  file: File,
  signal?: AbortSignal,
): Promise<RunAssetResponse> {
  const fd = new FormData();
  fd.append('file', file);
  return api.put<RunAssetResponse>(`/api/runs/${runId}/assets/${assetId}`, fd, { signal });
}
```

(Confirm `api.put` exists in `lib/api.ts` and accepts `FormData` + `RequestOpts`. If not, add it mirroring `api.post`'s implementation.)

- [ ] **Step 5: Run the replaceRunAsset test; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/runAssets.test.ts -t "replaceRunAsset"`

Expected: PASS.

- [ ] **Step 6: Write the failing tests for `deleteRunAsset` with options**

Append to `runAssets.test.ts`:

```typescript
describe('deleteRunAsset', () => {
  it('omits ?force=true when no options', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await deleteRunAsset(1, 42);
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/runs/1/assets/42');
  });

  it('omits ?force=true when { force: false }', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await deleteRunAsset(1, 42, { force: false });
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/runs/1/assets/42');
  });

  it('omits ?force=true when { force: undefined }', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await deleteRunAsset(1, 42, { force: undefined });
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/runs/1/assets/42');
  });

  it('appends ?force=true when { force: true }', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await deleteRunAsset(1, 42, { force: true });
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/runs/1/assets/42?force=true');
  });

  it('threads signal into fetch options', async () => {
    const ctrl = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await deleteRunAsset(1, 42, { signal: ctrl.signal });
    expect(fetchSpy.mock.calls[0]![1]!.signal).toBe(ctrl.signal);
  });
});
```

- [ ] **Step 7: Run; expected: most existing tests still pass, new option tests should pass if the existing `deleteRunAsset` happens to accept an options param — but likely fail because the signature only takes (runId, assetId).**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/runAssets.test.ts -t "deleteRunAsset"`

Expected: FAIL on the `force: true` test (and `signal` test) because the helper doesn't accept options.

- [ ] **Step 8: Extend `deleteRunAsset`**

Open `frontend/src/lib/runAssets.ts:60-61`. Current signature is probably:

```typescript
export function deleteRunAsset(runId: number, assetId: number): Promise<void> {
  return api.delete(`/api/runs/${runId}/assets/${assetId}`);
}
```

Replace with:

```typescript
export function deleteRunAsset(
  runId: number,
  assetId: number,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<void> {
  const query = options?.force === true ? '?force=true' : '';
  return api.delete(`/api/runs/${runId}/assets/${assetId}${query}`, { signal: options?.signal });
}
```

(Confirm `api.delete` already accepts a `RequestOpts` with `signal`. Per the codex r1 review it does at `frontend/src/lib/api.ts:68-69`. If not, add the second param.)

- [ ] **Step 9: Run all `deleteRunAsset` + `replaceRunAsset` tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/runAssets.test.ts`

Expected: all pass.

- [ ] **Step 10: Run svelte-check to confirm no type regressions**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --tsconfig ./tsconfig.json`

Expected: 0 errors. The `uploaded_by_email` field is `string | null` everywhere consumers need it. Any existing consumer that didn't access it stays unaffected.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/runAssets.ts frontend/src/tests/runAssets.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): lib — replaceRunAsset + extend deleteRunAsset with force/signal

- RunAssetResponse type gains uploaded_by_email: string | null (lock-step
  with backend schema field added in T1).
- replaceRunAsset(rid, aid, file, signal?) PUT wrapper mirrors
  uploadRunAsset's 6 wire properties (method, URL, FormData body,
  credentials, X-Requested-With, no manual Content-Type, signal).
- deleteRunAsset signature extended with options?: { force?, signal? }.
  Only force === true appends ?force=true (false / undefined / no
  options all omit). Signal threaded through fetch RequestOpts.
- AssetContext.remove shared interface UNCHANGED — RunAssetsTab calls
  deleteRunAsset directly; the per-MP modal sidebar continues to use
  the orphan-only contract.

T4 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend lib — `extractAssetRefs` + parity tests

**Files:**
- Create: `frontend/src/lib/extractAssetRefs.ts`
- Create: `frontend/src/tests/extractAssetRefs.test.ts`

**Acceptance contract (from spec section "Reference resolution split"):** Mirrors backend extractor at `backend/mathion/markdown.py:52-68`. Pulls Markdown image AND link targets via regex. Skips targets that start (case-sensitive) with `http://` / `https://` / `mailto:` / `#`. Query/fragment NOT stripped. Reference-style links NOT extracted. Escaped brackets NOT respected (naive regex). Angle-bracket targets captured verbatim.

- [ ] **Step 1: Read the backend extractor to confirm exact behavior**

Run: `cat backend/mathion/markdown.py | sed -n '40,80p'`

Confirm the regex patterns, `_SKIP_PREFIXES` tuple, and `_TITLE` group. The frontend implementation must mirror this exactly.

- [ ] **Step 2: Write the failing parity tests**

Create `frontend/src/tests/extractAssetRefs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractAssetRefs } from '../lib/extractAssetRefs';

describe('extractAssetRefs — parity with backend/mathion/markdown.py:52-68', () => {
  it('extracts image syntax: ![alt](foo.pdf)', () => {
    expect(extractAssetRefs('![alt](foo.pdf)')).toEqual(new Set(['foo.pdf']));
  });

  it('extracts link syntax: [link](foo.pdf)', () => {
    expect(extractAssetRefs('[link](foo.pdf)')).toEqual(new Set(['foo.pdf']));
  });

  it('strips title from image: ![alt](foo.pdf "Title") → {foo.pdf}', () => {
    expect(extractAssetRefs('![alt](foo.pdf "Title")')).toEqual(new Set(['foo.pdf']));
  });

  it('skips http:// link target', () => {
    expect(extractAssetRefs('[x](http://example.com/foo.pdf)')).toEqual(new Set());
  });

  it('skips https:// link target', () => {
    expect(extractAssetRefs('[x](https://example.com/foo.pdf)')).toEqual(new Set());
  });

  it('skips mailto: link target', () => {
    expect(extractAssetRefs('[x](mailto:user@example.com)')).toEqual(new Set());
  });

  it('skips # anchor target', () => {
    expect(extractAssetRefs('[x](#anchor)')).toEqual(new Set());
  });

  it('case-sensitive prefix skip: [x](HTTP://foo.pdf) → captured', () => {
    // backend `startswith` is case-sensitive — mixed-case URLs are NOT skipped
    expect(extractAssetRefs('[x](HTTP://example.com/foo.pdf)')).toEqual(
      new Set(['HTTP://example.com/foo.pdf'])
    );
  });

  it('does NOT extract reference-style links', () => {
    const md = '[text][ref]\n\n[ref]: foo.pdf';
    expect(extractAssetRefs(md)).toEqual(new Set());
  });

  it('plain prose mentioning foo.pdf returns empty set', () => {
    expect(extractAssetRefs('See the file foo.pdf in the assets folder.')).toEqual(new Set());
  });

  it('substring overlap: [link](my-data.csv) does NOT include data.csv', () => {
    const result = extractAssetRefs('[link](my-data.csv)');
    expect(result.has('my-data.csv')).toBe(true);
    expect(result.has('data.csv')).toBe(false);
  });

  it('query string preserved: [link](foo.pdf?v=2)', () => {
    expect(extractAssetRefs('[link](foo.pdf?v=2)')).toEqual(new Set(['foo.pdf?v=2']));
  });

  it('fragment preserved: [link](foo.pdf#page=3)', () => {
    expect(extractAssetRefs('[link](foo.pdf#page=3)')).toEqual(new Set(['foo.pdf#page=3']));
  });

  it('escaped brackets are NOT respected: \\[x\\](foo.pdf) → {foo.pdf}', () => {
    // backend regex is naive; frontend must mirror
    expect(extractAssetRefs('\\[x\\](foo.pdf)')).toEqual(new Set(['foo.pdf']));
  });

  it('angle-bracket targets captured verbatim: [x](<foo.pdf>) → {<foo.pdf>}', () => {
    expect(extractAssetRefs('[x](<foo.pdf>)')).toEqual(new Set(['<foo.pdf>']));
  });

  it('multiple references in one document return the full set', () => {
    const md = `
# Heading
![img](one.pdf)
Some text.
[link](two.pdf)
[skip](http://example.com)
![also](three.png "Title")
`;
    expect(extractAssetRefs(md)).toEqual(new Set(['one.pdf', 'two.pdf', 'three.png']));
  });
});
```

- [ ] **Step 3: Run tests to verify all fail**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/extractAssetRefs.test.ts`

Expected: all FAIL — `extractAssetRefs` is not defined.

- [ ] **Step 4: Implement `extractAssetRefs`**

Create `frontend/src/lib/extractAssetRefs.ts`:

```typescript
// Mirrors backend/mathion/markdown.py:52-68. Pulls Markdown image AND link
// targets via regex. Skips http://, https://, mailto:, # prefixes (case-
// sensitive — same as backend's startswith). Query/fragment NOT stripped.
// Reference-style links NOT extracted. Escaped brackets NOT respected
// (naive). Angle-bracket targets captured verbatim.

const SKIP_PREFIXES = ['http://', 'https://', 'mailto:', '#'] as const;

// Mirrors backend _IMG_REF and _LINK_REF. Target group is [^)\s]+ — greedy up
// to whitespace or ). Optional title inside the parens is stripped via the
// non-capturing group.
const IMG_REF = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const LINK_REF = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

function isSkipped(target: string): boolean {
  for (const prefix of SKIP_PREFIXES) {
    if (target.startsWith(prefix)) return true;
  }
  return false;
}

export function extractAssetRefs(md: string): Set<string> {
  const refs = new Set<string>();
  for (const re of [IMG_REF, LINK_REF]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      const target = m[1]!;
      if (!isSkipped(target)) {
        refs.add(target);
      }
    }
  }
  return refs;
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/extractAssetRefs.test.ts`

Expected: all PASS.

- [ ] **Step 6: Run full frontend test suite to check for regressions**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run`

Expected: all tests pass.

- [ ] **Step 7: Run svelte-check**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --tsconfig ./tsconfig.json`

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/extractAssetRefs.ts frontend/src/tests/extractAssetRefs.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): lib/extractAssetRefs — Markdown ref extractor mirroring backend

Mirrors backend/mathion/markdown.py:52-68 exactly:
- Pulls ![alt](target) AND [link](target) via inline regexes
- Strips title group: ![alt](foo.pdf "Title") → "foo.pdf"
- Skips http://, https://, mailto:, # prefixes (case-sensitive
  startsWith — HTTP:// is NOT skipped, matches backend)
- Query/fragment preserved (foo.pdf?v=2 captured verbatim)
- Reference-style links NOT extracted (inline regex only)
- Escaped brackets NOT respected (naive — matches backend)
- Angle-bracket targets captured verbatim

Parity test file with 17 bullets locks every quirk against backend
behavior. Membership check at call-sites is refs.has(asset.filename)
(set lookup, not substring) — avoids the round-1 false-positive
concerns (prose mentions, substring overlap).

T5 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `RunAssetsTab.svelte` — skeleton (props + empty state + table + filename link)

**Files:**
- Create: `frontend/src/components/runs/RunAssetsTab.svelte`
- Create: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** Component renders an empty-state CTA when `assets.length === 0`. Otherwise renders a table with columns: checkbox / filename (clickable to GET serve URL) / size (`formatFileSize`) / uploaded (`formatLocalWithTz`) / uploaded_by / uses / actions. Accepts all 4 callback props + supporting props. No filter/sort/upload/delete behavior yet (those land in subsequent tasks).

- [ ] **Step 1: Write the failing test for empty-state CTA rendering**

Create `frontend/src/tests/RunAssetsTab.svelte.test.ts`:

```typescript
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import RunAssetsTab from '../components/runs/RunAssetsTab.svelte';

const baseProps = {
  runId: 1,
  assets: [],
  miniProjects: [],
  course: { id: 1, slug: 'c', title: 'C', is_admin: true, default_version_id: null },
  versionIsDisabled: false,
  onRefetchAssets: vi.fn().mockResolvedValue(undefined),
  onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
  onEditMiniProject: vi.fn(),
  onReloadRun: vi.fn().mockResolvedValue(undefined),
};

describe('RunAssetsTab — skeleton', () => {
  it('renders empty-state CTA when assets is empty', () => {
    render(RunAssetsTab, { props: baseProps });
    expect(screen.getByText(/No assets yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "skeleton"`

Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Create the component skeleton**

Create `frontend/src/components/runs/RunAssetsTab.svelte`:

```svelte
<script lang="ts">
  import type { RunAssetResponse, MiniProjectResponse, CourseResponse } from '../../lib/types';
  import { formatFileSize } from '../../lib/format';
  import { formatLocalWithTz } from '../../lib/datetime';

  let {
    runId,
    assets,
    miniProjects,
    course,
    versionIsDisabled,
    onRefetchAssets,
    onRefetchMiniProjects,
    onEditMiniProject,
    onReloadRun,
  }: {
    runId: number;
    assets: RunAssetResponse[];
    miniProjects: MiniProjectResponse[];
    course: CourseResponse;
    versionIsDisabled: boolean;
    onRefetchAssets: () => Promise<void>;
    onRefetchMiniProjects: () => Promise<void>;
    onEditMiniProject: (mp: MiniProjectResponse) => void;
    onReloadRun: () => Promise<void>;
  } = $props();

  function serveUrl(filename: string): string {
    return `/api/runs/${runId}/assets/${encodeURIComponent(filename)}`;
  }
</script>

<section class="run-assets-tab">
  {#if assets.length === 0}
    <div class="empty-state">
      <p>No assets yet. Drop files here or click + Upload.</p>
    </div>
  {:else}
    <table class="assets-table">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" disabled aria-label="Select all" /></th>
          <th scope="col">Filename</th>
          <th scope="col">Size</th>
          <th scope="col">Uploaded</th>
          <th scope="col">Uploaded by</th>
          <th scope="col">Uses</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each assets as a (a.id)}
          <tr data-asset-id={a.id}>
            <td><input type="checkbox" aria-label="Select {a.filename}" /></td>
            <td>
              <a href={serveUrl(a.filename)} target="_blank" rel="noopener noreferrer">
                {a.filename}
              </a>
            </td>
            <td>{formatFileSize(a.file_size)}</td>
            <td>{formatLocalWithTz(a.uploaded_at)}</td>
            <td>{a.uploaded_by_email ?? '—'}</td>
            <td>—</td>
            <td>—</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .run-assets-tab {
    padding: 1rem 0;
  }
  .empty-state {
    padding: 2rem;
    text-align: center;
    color: #666;
  }
  .assets-table {
    width: 100%;
    border-collapse: collapse;
  }
  .assets-table th,
  .assets-table td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #eee;
  }
  .assets-table th {
    background: #fafafa;
    font-weight: 600;
  }
</style>
```

- [ ] **Step 4: Run the test; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "skeleton"`

- [ ] **Step 5: Write the failing test for table renders rows**

Append:

```typescript
describe('RunAssetsTab — table rendering', () => {
  it('renders one row per asset with filename / size / uploaded_by columns', () => {
    const assets = [
      {
        id: 1, run_id: 1, filename: 'doc.pdf', file_size: 1234, mime_type: 'application/pdf',
        uploaded_at: '2026-05-20T12:00:00Z', uploaded_by: 7,
        uploaded_by_email: 'admin@example.com', is_referenced: false,
      },
      {
        id: 2, run_id: 1, filename: 'fig.png', file_size: 180_000, mime_type: 'image/png',
        uploaded_at: '2026-05-21T13:00:00Z', uploaded_by: null,
        uploaded_by_email: null, is_referenced: true,
      },
    ];
    render(RunAssetsTab, { props: { ...baseProps, assets } });

    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText('fig.png')).toBeInTheDocument();
    expect(screen.getByText('1.2 kB')).toBeInTheDocument();   // formatFileSize
    expect(screen.getByText('180.0 kB')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    // null email rendered as em-dash
    const rows = screen.getAllByRole('row');
    const figRow = rows.find(r => r.querySelector('a[href*="fig.png"]'))!;
    expect(figRow.textContent).toMatch(/—/);
  });

  it('filename links to the GET serve URL in a new tab', () => {
    const assets = [
      {
        id: 1, run_id: 1, filename: 'has space.pdf', file_size: 100, mime_type: 'application/pdf',
        uploaded_at: '2026-05-20T12:00:00Z', uploaded_by: 7,
        uploaded_by_email: 'a@b.com', is_referenced: false,
      },
    ];
    render(RunAssetsTab, { props: { ...baseProps, assets } });

    const link = screen.getByRole('link', { name: 'has space.pdf' });
    // encodeURIComponent applied
    expect(link.getAttribute('href')).toBe('/api/runs/1/assets/has%20space.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
```

- [ ] **Step 6: Run; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts`

- [ ] **Step 7: Run svelte-check**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx svelte-check --tsconfig ./tsconfig.json`

Expected: 0 errors. (`MiniProjectResponse` and `CourseResponse` types are already exported from `lib/types.ts`.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab skeleton — props + empty state + table

Component shell with all 4 callback props wired in:
- onRefetchAssets, onRefetchMiniProjects, onEditMiniProject, onReloadRun
plus runId, assets, miniProjects, course, versionIsDisabled.

Renders global empty-state CTA when assets is empty; otherwise table
with checkbox / filename (→ GET serve URL in new tab) / size / uploaded
/ uploaded_by / uses / actions columns. Filename is encodeURIComponent'd
in the URL. uploaded_by_email rendered as '—' when null.

No filter / sort / upload / delete / bulk behavior yet — those land in
T7-T11.

T6 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `RunAssetsTab` — filter pills + sort + uses badge + sub-panel

**Files:**
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte`
- Modify: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** Filter pills (All / Orphan / Referenced) with `aria-pressed`; counts come from `extractAssetRefs` scan of `miniProjects[].assignment_md`. Sort headers with `aria-sort` on `<th>`, button-based activator, cycles asc → desc → none. Default sort: filename asc. Sort persists across filter changes. "uses N" badge is a disclosure button (`aria-expanded` + `aria-controls`); clicking toggles inline sub-panel below the row listing referencing MPs with `[Edit]` action. Only one sub-panel open at a time. `miniProjects === null` → badge renders `—`.

- [ ] **Step 1: Write the failing test for filter pill counts**

Append to `RunAssetsTab.svelte.test.ts`:

```typescript
import { fireEvent } from '@testing-library/svelte';

describe('RunAssetsTab — filter pills', () => {
  const fixture = {
    assets: [
      mkAsset(1, 'orphan-a.pdf'),
      mkAsset(2, 'orphan-b.pdf'),
      mkAsset(3, 'referenced.pdf'),
    ],
    miniProjects: [
      { id: 10, slug: 'mp1', title: 'MP1', block_title: 'Block 1',
        assignment_md: 'See ![ref](referenced.pdf).',
        hard_deadline: null, resubmission_deadline: null, is_published: false,
      } as any,
    ],
  };

  it('counts orphan vs referenced from extractAssetRefs scan', () => {
    render(RunAssetsTab, { props: { ...baseProps, ...fixture } });

    expect(screen.getByRole('button', { name: /All \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Orphan \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Referenced \(1\)/ })).toBeInTheDocument();
  });

  it('clicking Orphan narrows the table; aria-pressed updates', async () => {
    render(RunAssetsTab, { props: { ...baseProps, ...fixture } });

    const orphanPill = screen.getByRole('button', { name: /Orphan/ });
    expect(orphanPill.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(orphanPill);
    expect(orphanPill.getAttribute('aria-pressed')).toBe('true');

    // Only orphan rows visible
    expect(screen.getByText('orphan-a.pdf')).toBeInTheDocument();
    expect(screen.getByText('orphan-b.pdf')).toBeInTheDocument();
    expect(screen.queryByText('referenced.pdf')).toBeNull();
  });

  it('miniProjects === null → all assets show as orphan; filter counts treat MPs as empty', () => {
    render(RunAssetsTab, { props: { ...baseProps, ...fixture, miniProjects: null as any } });

    expect(screen.getByRole('button', { name: /Orphan \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Referenced \(0\)/ })).toBeInTheDocument();
  });
});

function mkAsset(id: number, filename: string): RunAssetResponse {
  return {
    id, run_id: 1, filename, file_size: 100, mime_type: 'application/pdf',
    uploaded_at: '2026-05-20T12:00:00Z', uploaded_by: 7,
    uploaded_by_email: 'a@b.com', is_referenced: false,
  };
}
```

(Add the `RunAssetResponse` import and `mkAsset` helper at the top of the test file if not already there.)

- [ ] **Step 2: Run; expected FAIL** (pills don't exist yet)

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "filter pills"`

- [ ] **Step 3: Add filter pills to the component**

Open `frontend/src/components/runs/RunAssetsTab.svelte`. Update the `<script>` block:

```svelte
<script lang="ts">
  import type { RunAssetResponse, MiniProjectResponse, CourseResponse } from '../../lib/types';
  import { formatFileSize } from '../../lib/format';
  import { formatLocalWithTz } from '../../lib/datetime';
  import { extractAssetRefs } from '../../lib/extractAssetRefs';

  let {
    runId,
    assets,
    miniProjects,
    course,
    versionIsDisabled,
    onRefetchAssets,
    onRefetchMiniProjects,
    onEditMiniProject,
    onReloadRun,
  }: {
    runId: number;
    assets: RunAssetResponse[];
    miniProjects: MiniProjectResponse[] | null;
    course: CourseResponse;
    versionIsDisabled: boolean;
    onRefetchAssets: () => Promise<void>;
    onRefetchMiniProjects: () => Promise<void>;
    onEditMiniProject: (mp: MiniProjectResponse) => void;
    onReloadRun: () => Promise<void>;
  } = $props();

  type FilterPill = 'all' | 'orphan' | 'referenced';
  let activeFilter = $state<FilterPill>('all');

  // refs by MP: { mpId → Set<filename> }
  const refsByMp = $derived((): Map<number, Set<string>> => {
    const m = new Map<number, Set<string>>();
    if (miniProjects == null) return m;
    for (const mp of miniProjects) {
      m.set(mp.id, extractAssetRefs(mp.assignment_md ?? ''));
    }
    return m;
  });

  // For each asset: which MPs reference it (by mp.id)
  function referencingMpIds(asset: RunAssetResponse): number[] {
    const ids: number[] = [];
    for (const [mpId, refs] of refsByMp().entries()) {
      if (refs.has(asset.filename)) ids.push(mpId);
    }
    return ids;
  }

  const counts = $derived(() => {
    let orphan = 0;
    let referenced = 0;
    for (const a of assets) {
      if (referencingMpIds(a).length === 0) orphan++;
      else referenced++;
    }
    return { all: assets.length, orphan, referenced };
  });

  const filteredAssets = $derived(() => {
    if (activeFilter === 'all') return assets;
    return assets.filter((a) => {
      const isOrphan = referencingMpIds(a).length === 0;
      return activeFilter === 'orphan' ? isOrphan : !isOrphan;
    });
  });

  function serveUrl(filename: string): string {
    return `/api/runs/${runId}/assets/${encodeURIComponent(filename)}`;
  }
</script>

<section class="run-assets-tab">
  <div class="filter-pills" role="group" aria-label="Filter assets">
    <button
      type="button"
      aria-pressed={activeFilter === 'all'}
      onclick={() => (activeFilter = 'all')}
    >All ({counts().all})</button>
    <button
      type="button"
      aria-pressed={activeFilter === 'orphan'}
      onclick={() => (activeFilter = 'orphan')}
    >Orphan ({counts().orphan})</button>
    <button
      type="button"
      aria-pressed={activeFilter === 'referenced'}
      onclick={() => (activeFilter = 'referenced')}
    >Referenced ({counts().referenced})</button>
  </div>

  {#if assets.length === 0}
    <div class="empty-state">
      <p>No assets yet. Drop files here or click + Upload.</p>
    </div>
  {:else if filteredAssets().length === 0}
    <div class="empty-state">
      <p>No {activeFilter} assets.</p>
    </div>
  {:else}
    <!-- table from T6, but iterate filteredAssets() instead of assets -->
    <table class="assets-table">
      <thead>
        <tr>
          <th scope="col"><input type="checkbox" disabled aria-label="Select all" /></th>
          <th scope="col">Filename</th>
          <th scope="col">Size</th>
          <th scope="col">Uploaded</th>
          <th scope="col">Uploaded by</th>
          <th scope="col">Uses</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredAssets() as a (a.id)}
          <tr data-asset-id={a.id}>
            <td><input type="checkbox" aria-label="Select {a.filename}" /></td>
            <td>
              <a href={serveUrl(a.filename)} target="_blank" rel="noopener noreferrer">
                {a.filename}
              </a>
            </td>
            <td>{formatFileSize(a.file_size)}</td>
            <td>{formatLocalWithTz(a.uploaded_at)}</td>
            <td>{a.uploaded_by_email ?? '—'}</td>
            <td>{miniProjects == null ? '—' : referencingMpIds(a).length}</td>
            <td>—</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .run-assets-tab { padding: 1rem 0; }
  .filter-pills { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .filter-pills button {
    padding: 0.25rem 0.75rem; border-radius: 999px; border: 1px solid #ddd;
    background: #fff; cursor: pointer; font-size: 0.85rem;
  }
  .filter-pills button[aria-pressed="true"] { background: #e3f2fd; color: #0d47a1; border-color: #90caf9; }
  .empty-state { padding: 2rem; text-align: center; color: #666; }
  .assets-table { width: 100%; border-collapse: collapse; }
  .assets-table th, .assets-table td {
    text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee;
  }
  .assets-table th { background: #fafafa; font-weight: 600; }
</style>
```

- [ ] **Step 4: Run filter pill tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "filter pills"`

- [ ] **Step 5: Write the failing test for sort cycle**

Append:

```typescript
describe('RunAssetsTab — sort', () => {
  const assets = [
    mkAsset(1, 'banana.pdf'),
    mkAsset(2, 'apple.pdf'),
    mkAsset(3, 'cherry.pdf'),
  ];

  it('default sort is filename ascending', () => {
    render(RunAssetsTab, { props: { ...baseProps, assets } });
    const rows = screen.getAllByRole('row').slice(1); // skip header
    expect(rows[0]!.textContent).toContain('apple.pdf');
    expect(rows[1]!.textContent).toContain('banana.pdf');
    expect(rows[2]!.textContent).toContain('cherry.pdf');
    const th = screen.getByRole('columnheader', { name: /Filename/ });
    expect(th.getAttribute('aria-sort')).toBe('ascending');
  });

  it('clicking Filename header cycles asc → desc → none', async () => {
    render(RunAssetsTab, { props: { ...baseProps, assets } });
    const button = screen.getByRole('button', { name: /Filename/ });

    await fireEvent.click(button);
    const th = screen.getByRole('columnheader', { name: /Filename/ });
    expect(th.getAttribute('aria-sort')).toBe('descending');

    await fireEvent.click(button);
    expect(th.getAttribute('aria-sort')).toBe('none');
  });
});
```

- [ ] **Step 6: Run; expected FAIL** (sort not implemented)

- [ ] **Step 7: Add sort to the component**

Update the `<script>` block of `RunAssetsTab.svelte`:

```svelte
  type SortField = 'filename' | 'size' | 'uploaded';
  type SortDir = 'ascending' | 'descending' | 'none';
  let sortField = $state<SortField>('filename');
  let sortDir = $state<SortDir>('ascending');

  function cycleSort(field: SortField): void {
    if (sortField !== field) { sortField = field; sortDir = 'ascending'; return; }
    if (sortDir === 'ascending') sortDir = 'descending';
    else if (sortDir === 'descending') sortDir = 'none';
    else sortDir = 'ascending';
  }

  function sortKey(a: RunAssetResponse, field: SortField): string | number {
    if (field === 'filename') return a.filename;
    if (field === 'size') return a.file_size;
    return a.uploaded_at;
  }

  const sortedAssets = $derived(() => {
    const out = filteredAssets().slice();
    if (sortDir === 'none') return out;
    const dir = sortDir === 'ascending' ? 1 : -1;
    out.sort((a, b) => {
      const ka = sortKey(a, sortField);
      const kb = sortKey(b, sortField);
      if (ka < kb) return -1 * dir;
      if (ka > kb) return 1 * dir;
      return 0;
    });
    return out;
  });
```

Update the `<thead>`:

```svelte
<thead>
  <tr>
    <th scope="col"><input type="checkbox" disabled aria-label="Select all" /></th>
    <th scope="col" aria-sort={sortField === 'filename' ? sortDir : 'none'}>
      <button type="button" onclick={() => cycleSort('filename')}>Filename</button>
    </th>
    <th scope="col" aria-sort={sortField === 'size' ? sortDir : 'none'}>
      <button type="button" onclick={() => cycleSort('size')}>Size</button>
    </th>
    <th scope="col" aria-sort={sortField === 'uploaded' ? sortDir : 'none'}>
      <button type="button" onclick={() => cycleSort('uploaded')}>Uploaded</button>
    </th>
    <th scope="col">Uploaded by</th>
    <th scope="col">Uses</th>
    <th scope="col">Actions</th>
  </tr>
</thead>
```

And iterate `sortedAssets()` instead of `filteredAssets()` in the `<tbody>` `{#each}`:

```svelte
{#each sortedAssets() as a (a.id)}
```

- [ ] **Step 8: Run sort tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "sort"`

- [ ] **Step 9: Write the failing test for uses badge + sub-panel disclosure**

Append:

```typescript
describe('RunAssetsTab — uses badge + sub-panel', () => {
  const fixture = {
    assets: [mkAsset(1, 'foo.pdf')],
    miniProjects: [
      { id: 10, slug: 'mp-a', title: 'MP A', block_title: 'Block A',
        assignment_md: '![](foo.pdf)', hard_deadline: null,
        resubmission_deadline: null, is_published: false } as any,
      { id: 11, slug: 'mp-b', title: 'MP B', block_title: 'Block B',
        assignment_md: '[](foo.pdf)', hard_deadline: null,
        resubmission_deadline: null, is_published: false } as any,
    ],
  };

  it('uses badge is a disclosure button with aria-expanded=false initially', () => {
    render(RunAssetsTab, { props: { ...baseProps, ...fixture } });
    const badge = screen.getByRole('button', { name: /2 use/i });
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(badge.getAttribute('aria-controls')).toBe('uses-1');
  });

  it('clicking badge toggles sub-panel; lists referencing MPs', async () => {
    render(RunAssetsTab, { props: { ...baseProps, ...fixture } });
    const badge = screen.getByRole('button', { name: /2 use/i });

    await fireEvent.click(badge);
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('MP A')).toBeInTheDocument();
    expect(screen.getByText('MP B')).toBeInTheDocument();

    await fireEvent.click(badge);
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('MP A')).toBeNull();
  });

  it('Edit button in sub-panel calls onEditMiniProject(mp)', async () => {
    const onEditMiniProject = vi.fn();
    render(RunAssetsTab, { props: { ...baseProps, ...fixture, onEditMiniProject } });

    await fireEvent.click(screen.getByRole('button', { name: /2 use/i }));
    const editButtons = screen.getAllByRole('button', { name: /Edit/i });
    await fireEvent.click(editButtons[0]!);
    expect(onEditMiniProject).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
  });

  it('only one sub-panel open at a time', async () => {
    const props = {
      ...baseProps,
      assets: [mkAsset(1, 'a.pdf'), mkAsset(2, 'b.pdf')],
      miniProjects: [
        { id: 10, slug: 'm1', title: 'M1', block_title: 'B', assignment_md: '![](a.pdf)',
          hard_deadline: null, resubmission_deadline: null, is_published: false } as any,
        { id: 11, slug: 'm2', title: 'M2', block_title: 'B', assignment_md: '![](b.pdf)',
          hard_deadline: null, resubmission_deadline: null, is_published: false } as any,
      ],
    };
    render(RunAssetsTab, { props });

    const badgeA = screen.getAllByRole('button', { name: /1 use/i })[0]!;
    const badgeB = screen.getAllByRole('button', { name: /1 use/i })[1]!;
    await fireEvent.click(badgeA);
    expect(badgeA.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(badgeB);
    expect(badgeA.getAttribute('aria-expanded')).toBe('false');
    expect(badgeB.getAttribute('aria-expanded')).toBe('true');
  });
});
```

- [ ] **Step 10: Run; expected FAIL**

- [ ] **Step 11: Add uses badge + sub-panel to the component**

In the `<script>` block:

```svelte
  let openSubPanelAssetId = $state<number | null>(null);

  function toggleSubPanel(assetId: number) {
    openSubPanelAssetId = openSubPanelAssetId === assetId ? null : assetId;
  }

  function mpById(id: number): MiniProjectResponse | undefined {
    if (miniProjects == null) return undefined;
    return miniProjects.find((m) => m.id === id);
  }
```

Replace the uses cell in the table loop:

```svelte
<td>
  {#if miniProjects == null}
    —
  {:else}
    {@const refIds = referencingMpIds(a)}
    {@const isOpen = openSubPanelAssetId === a.id}
    <button
      type="button"
      class="uses-badge"
      aria-expanded={isOpen}
      aria-controls="uses-{a.id}"
      onclick={() => toggleSubPanel(a.id)}
      onkeydown={(e) => {
        if (e.key === 'Escape' && isOpen) {
          openSubPanelAssetId = null;
        }
      }}
    >{refIds.length} use{refIds.length === 1 ? '' : 's'}</button>
  {/if}
</td>
```

After the `<tr>` for an asset, add a conditional sub-panel row (still inside the `{#each}`):

```svelte
{#if openSubPanelAssetId === a.id && miniProjects != null}
  {@const refIds = referencingMpIds(a)}
  <tr id="uses-{a.id}" class="sub-panel-row">
    <td colspan="7">
      <ul class="sub-panel">
        {#each refIds as mpId (mpId)}
          {@const mp = mpById(mpId)}
          {#if mp}
            <li>
              <strong>{mp.title}</strong>
              <button
                type="button"
                onclick={() => { openSubPanelAssetId = null; onEditMiniProject(mp); }}
              >Edit</button>
            </li>
          {/if}
        {/each}
      </ul>
    </td>
  </tr>
{/if}
```

Add CSS:

```css
.uses-badge {
  background: #e8f5e9; color: #1b5e20; border: 1px solid #c8e6c9;
  border-radius: 999px; padding: 0.1rem 0.5rem; cursor: pointer; font-size: 0.8rem;
}
.uses-badge[aria-expanded="true"] { background: #c8e6c9; }
.sub-panel-row td { background: #fafafa; }
.sub-panel { margin: 0; padding: 0.5rem 1rem; list-style: none; }
.sub-panel li { display: flex; justify-content: space-between; padding: 0.25rem 0; }
```

- [ ] **Step 12: Run sub-panel tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "uses badge"`

- [ ] **Step 13: Run all RunAssetsTab tests + svelte-check**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts && npx svelte-check --tsconfig ./tsconfig.json`

Expected: all PASS, 0 svelte-check errors.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab — filter pills + sort + uses badge + sub-panel

- Filter pills (All/Orphan/Referenced) with aria-pressed; counts via
  extractAssetRefs scan of miniProjects[].assignment_md. miniProjects===null
  treats MPs as empty → all assets show as orphan.
- Sort headers: aria-sort on <th> (per ARIA 1.2), <button> activator
  inside, cycles ascending → descending → none. Default: filename asc.
  Sort persists across filter changes (separate $state).
- "uses N" disclosure badge with aria-expanded + aria-controls. Clicking
  toggles inline sub-panel listing referencing MPs with [Edit] action
  that fires onEditMiniProject(mp). Esc collapses. Only one sub-panel
  open at a time.

T7 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `RunAssetsTab` — upload flow (picker + drop zone + progress)

**Files:**
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte`
- Modify: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** `[+ Upload]` button (top-right) triggers a hidden multi-file `<input>`. Tab body is also a drop zone (drag-over visual = dashed border on table wrapper when populated, on empty-state CTA when empty). Stop-on-any-invalid pre-pass (oversize, wrong extension). `uploadProgress.current/total` text wrapped in `role="status" aria-live="polite"`. 409 collision banner. AbortController tied to `mounted` flag (T6a pattern).

- [ ] **Step 1: Write the failing test for the `[+ Upload]` button + click triggers picker**

Append to `RunAssetsTab.svelte.test.ts`:

```typescript
import { uploadRunAsset } from '../lib/runAssets';

vi.mock('../lib/runAssets', async () => {
  const actual = await vi.importActual('../lib/runAssets');
  return {
    ...actual as object,
    uploadRunAsset: vi.fn(),
    replaceRunAsset: vi.fn(),
    deleteRunAsset: vi.fn(),
  };
});

describe('RunAssetsTab — upload via file picker', () => {
  it('clicking [+ Upload] focuses + triggers hidden file input', async () => {
    render(RunAssetsTab, { props: baseProps });
    const uploadBtn = screen.getByRole('button', { name: /\+ Upload/ });
    const hiddenInput = uploadBtn.parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    expect(hiddenInput).toBeTruthy();
    expect(hiddenInput.multiple).toBe(true);
  });

  it('selecting a file calls uploadRunAsset and fires onRefetchAssets on success', async () => {
    (uploadRunAsset as any).mockResolvedValue(mkAsset(99, 'new.pdf'));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    render(RunAssetsTab, { props: { ...baseProps, onRefetchAssets } });

    const uploadBtn = screen.getByRole('button', { name: /\+ Upload/ });
    const hiddenInput = uploadBtn.parentElement!.querySelector('input[type="file"]') as HTMLInputElement;

    const file = new File(['data'], 'new.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file] });
    await fireEvent.change(hiddenInput);

    await vi.waitFor(() => {
      expect(uploadRunAsset).toHaveBeenCalledWith(1, file, expect.anything());
      expect(onRefetchAssets).toHaveBeenCalled();
    });
  });

  it('upload 409 collision shows banner', async () => {
    (uploadRunAsset as any).mockRejectedValue(
      Object.assign(new Error('Conflict'), { status: 409 })
    );
    render(RunAssetsTab, { props: baseProps });

    const uploadBtn = screen.getByRole('button', { name: /\+ Upload/ });
    const hiddenInput = uploadBtn.parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'dup.pdf', { type: 'application/pdf' });
    Object.defineProperty(hiddenInput, 'files', { value: [file] });
    await fireEvent.change(hiddenInput);

    await vi.waitFor(() => {
      expect(screen.getByText(/asset named .*dup\.pdf.* already exists/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run; expected FAIL**

- [ ] **Step 3: Implement upload flow**

Add to the `<script>` block of `RunAssetsTab.svelte`:

```svelte
  import { uploadRunAsset } from '../../lib/runAssets';
  import { MAX_FILE_SIZE_BYTES, ALLOWED_EXTENSIONS } from '../../lib/assetConstants';
  // (Confirm these constants live in lib/assetConstants.ts; if elsewhere, adjust import. They are used in AssetSidebar.svelte:113-127.)

  let mounted = true;
  $effect(() => {
    return () => { mounted = false; };
  });

  let uploadInputEl: HTMLInputElement | null = null;
  let uploadProgress = $state<{ current: number; total: number } | null>(null);
  let uploadError = $state<string | null>(null);

  function isExtensionAllowed(name: string): boolean {
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    return ALLOWED_EXTENSIONS.includes(ext);
  }

  function validateFile(f: File): string | null {
    if (f.size > MAX_FILE_SIZE_BYTES) return `${f.name}: file too large.`;
    if (!isExtensionAllowed(f.name)) return `${f.name}: extension not allowed.`;
    return null;
  }

  async function performUpload(files: File[]): Promise<void> {
    uploadError = null;

    // Stop-on-any-invalid pre-pass
    for (const f of files) {
      const err = validateFile(f);
      if (err) { uploadError = err; return; }
    }

    uploadProgress = { current: 0, total: files.length };
    const controller = new AbortController();
    try {
      for (let i = 0; i < files.length; i++) {
        if (!mounted) { controller.abort(); return; }
        try {
          await uploadRunAsset(runId, files[i]!, controller.signal);
          uploadProgress = { current: i + 1, total: files.length };
        } catch (e: any) {
          if (e?.status === 409) {
            uploadError = `An asset named '${files[i]!.name}' already exists. Use Replace on the existing row, or rename your file.`;
            return;
          }
          throw e;
        }
      }
      await onRefetchAssets();
    } finally {
      uploadProgress = null;
    }
  }

  function handleUploadPicker() {
    uploadInputEl?.click();
  }

  async function onUploadInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // reset so picking same file again triggers onchange
    if (files.length === 0) return;
    await performUpload(files);
  }
```

In the markup, add above the table (replace the simple wrapper):

```svelte
<section class="run-assets-tab">
  <div class="toolbar">
    <div class="filter-pills" role="group" aria-label="Filter assets">
      <!-- existing filter pills unchanged -->
      <button type="button" aria-pressed={activeFilter === 'all'} onclick={() => (activeFilter = 'all')}>All ({counts().all})</button>
      <button type="button" aria-pressed={activeFilter === 'orphan'} onclick={() => (activeFilter = 'orphan')}>Orphan ({counts().orphan})</button>
      <button type="button" aria-pressed={activeFilter === 'referenced'} onclick={() => (activeFilter = 'referenced')}>Referenced ({counts().referenced})</button>
    </div>
    <div class="upload-area">
      <button type="button" disabled={versionIsDisabled} onclick={handleUploadPicker}>+ Upload</button>
      <input
        type="file"
        multiple
        bind:this={uploadInputEl}
        onchange={onUploadInputChange}
        style="display:none"
        aria-hidden="true"
      />
    </div>
  </div>

  {#if uploadError}
    <div role="status" class="banner banner-error">{uploadError}</div>
  {/if}
  {#if uploadProgress}
    <div role="status" aria-live="polite" class="upload-progress">
      Uploading {uploadProgress.current} of {uploadProgress.total}…
    </div>
  {/if}

  <!-- existing empty-state / table sections continue -->
```

Add CSS:

```css
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.upload-area { display: flex; gap: 0.5rem; align-items: center; }
.upload-progress { font-size: 0.85rem; color: #555; padding: 0.25rem 0.5rem; }
.banner { padding: 0.5rem 0.75rem; margin: 0.5rem 0; border-radius: 4px; }
.banner-error { background: #fdecea; color: #b71c1c; border: 1px solid #f5c6cb; }
```

- [ ] **Step 4: Run picker tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "picker"`

- [ ] **Step 5: Write the failing tests for drop zone**

Append:

```typescript
describe('RunAssetsTab — upload via drop zone', () => {
  it('drops a valid file → uploadRunAsset called', async () => {
    (uploadRunAsset as any).mockResolvedValue(mkAsset(99, 'dropped.pdf'));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const { container } = render(RunAssetsTab, { props: { ...baseProps, onRefetchAssets } });

    const dropZone = container.querySelector('.run-assets-tab')!;
    const file = new File(['data'], 'dropped.pdf', { type: 'application/pdf' });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    await fireEvent.drop(dropZone, { dataTransfer });

    await vi.waitFor(() => {
      expect(uploadRunAsset).toHaveBeenCalledWith(1, file, expect.anything());
    });
  });

  it('drops an oversize file → inline error', async () => {
    render(RunAssetsTab, { props: baseProps });
    const { container } = render(RunAssetsTab, { props: baseProps });
    const dropZone = container.querySelector('.run-assets-tab')!;

    // Create a fake large file
    const file = new File([new Uint8Array(1_000_000_000)], 'huge.pdf', { type: 'application/pdf' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    await fireEvent.drop(dropZone, { dataTransfer });

    await vi.waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument();
    });
  });

  it('drops a wrong-extension file → inline error', async () => {
    const { container } = render(RunAssetsTab, { props: baseProps });
    const dropZone = container.querySelector('.run-assets-tab')!;
    const file = new File(['data'], 'evil.exe', { type: 'application/octet-stream' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    await fireEvent.drop(dropZone, { dataTransfer });
    await vi.waitFor(() => {
      expect(screen.getByText(/extension not allowed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: Run; expected FAIL**

- [ ] **Step 7: Add drop handling to the `<section>`**

```svelte
<section
  class="run-assets-tab"
  ondragover={(e) => { e.preventDefault(); dragOver = true; }}
  ondragleave={() => (dragOver = false)}
  ondrop={async (e) => {
    e.preventDefault();
    dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) await performUpload(files);
  }}
  class:drag-over={dragOver}
>
```

Add to script:

```svelte
  let dragOver = $state(false);
```

CSS:

```css
.run-assets-tab.drag-over .assets-table,
.run-assets-tab.drag-over .empty-state {
  outline: 2px dashed #1976d2; outline-offset: -2px;
}
```

- [ ] **Step 8: Run drop tests; expected PASS**

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab — upload via picker + drop zone + progress

- [+ Upload] button triggers hidden multi-file <input>. onchange handler
  resets input.value to '' so the same file can be re-picked.
- Tab body is a drop zone; drag-over highlight (dashed border) applies
  to .assets-table when populated, to .empty-state container when empty.
- Stop-on-any-invalid pre-pass (MAX_FILE_SIZE_BYTES + ALLOWED_EXTENSIONS)
  before any upload starts.
- uploadProgress.current/total wrapped in role="status" aria-live="polite"
  so screen readers hear "Uploading 2 of 5".
- AbortController tied to the tab's mounted flag (T6a pattern).
- 409 collision → banner "An asset named '{name}' already exists.
  Use Replace on the existing row, or rename your file."

T8 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `RunAssetsTab` — replace flow (per-row picker + InlineConfirm + abort cleanup)

**Files:**
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte`
- Modify: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** `[↻ Replace]` per-row triggers a single shared hidden `<input>` rebound via `pendingReplaceAssetId = $state<number | null>(null)`. Picker fires first; `onchange` reads `pendingReplaceAssetId`, validates case-insensitive ext + size, opens InlineConfirm alongside actions cell. `oncancel` resets state. Confirm → PUT (with `pendingReplaceController.signal`). 422 / 413 / 404 banners. `$effect` aborts the controller on unmount OR `runId` prop change.

- [ ] **Step 1: Write the failing tests for replace success + 422 + 404**

Append:

```typescript
import { replaceRunAsset } from '../lib/runAssets';

describe('RunAssetsTab — replace flow', () => {
  it('clicking [↻ Replace] then picking same-ext file shows InlineConfirm; confirming calls replaceRunAsset', async () => {
    (replaceRunAsset as any).mockResolvedValue(mkAsset(1, 'doc.pdf'));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [mkAsset(1, 'doc.pdf')];
    render(RunAssetsTab, { props: { ...baseProps, assets, onRefetchAssets } });

    const replaceBtn = screen.getByRole('button', { name: /Replace/i });
    await fireEvent.click(replaceBtn);

    // The hidden replace input should now be primed
    const replaceInput = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
    const file = new File(['NEW'], 'whatever.pdf', { type: 'application/pdf' });
    Object.defineProperty(replaceInput, 'files', { value: [file] });
    await fireEvent.change(replaceInput);

    // InlineConfirm visible
    expect(screen.getByText(/Replace `doc\.pdf`/)).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /Confirm/i });
    await fireEvent.click(confirm);

    await vi.waitFor(() => {
      expect(replaceRunAsset).toHaveBeenCalledWith(1, 1, file, expect.anything());
      expect(onRefetchAssets).toHaveBeenCalled();
    });
  });

  it('extension mismatch → inline error, no InlineConfirm shown', async () => {
    const assets = [mkAsset(1, 'doc.pdf')];
    render(RunAssetsTab, { props: { ...baseProps, assets } });

    await fireEvent.click(screen.getByRole('button', { name: /Replace/i }));

    const replaceInput = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
    const file = new File(['NEW'], 'doc.png', { type: 'image/png' });
    Object.defineProperty(replaceInput, 'files', { value: [file] });
    await fireEvent.change(replaceInput);

    expect(screen.queryByRole('button', { name: /Confirm/i })).toBeNull();
    expect(screen.getByText(/extension/i)).toBeInTheDocument();
  });

  it('.PDF replaces .pdf (case-insensitive)', async () => {
    (replaceRunAsset as any).mockResolvedValue(mkAsset(1, 'doc.pdf'));
    const assets = [mkAsset(1, 'doc.pdf')];
    render(RunAssetsTab, { props: { ...baseProps, assets } });

    await fireEvent.click(screen.getByRole('button', { name: /Replace/i }));
    const replaceInput = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
    const file = new File(['NEW'], 'NEW.PDF', { type: 'application/pdf' });
    Object.defineProperty(replaceInput, 'files', { value: [file] });
    await fireEvent.change(replaceInput);

    // No extension error — InlineConfirm shown
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeInTheDocument();
  });

  it('PUT 404 mid-flight → banner + auto-refetch', async () => {
    (replaceRunAsset as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [mkAsset(1, 'doc.pdf')];
    render(RunAssetsTab, { props: { ...baseProps, assets, onRefetchAssets } });

    await fireEvent.click(screen.getByRole('button', { name: /Replace/i }));
    const replaceInput = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
    const file = new File(['NEW'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(replaceInput, 'files', { value: [file] });
    await fireEvent.change(replaceInput);
    await fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/deleted by another user/i)).toBeInTheDocument();
      expect(onRefetchAssets).toHaveBeenCalled();
    });
  });

  it('in-flight replace + tab unmount → AbortController.abort fires via $effect cleanup', async () => {
    let pending: { resolve: (v: any) => void; reject: (r: any) => void } | null = null;
    (replaceRunAsset as any).mockImplementation((_rid: number, _aid: number, _f: File, signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const assets = [mkAsset(1, 'doc.pdf')];
    const { unmount } = render(RunAssetsTab, { props: { ...baseProps, assets } });

    await fireEvent.click(screen.getByRole('button', { name: /Replace/i }));
    const replaceInput = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
    const file = new File(['NEW'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(replaceInput, 'files', { value: [file] });
    await fireEvent.change(replaceInput);
    await fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    unmount();

    await vi.waitFor(() => {
      // The pending promise was rejected with AbortError
      expect(pending).not.toBeNull();
    });
  });

  it('runId prop change while tab stays mounted → abort fires', async () => {
    let pending: { resolve: (v: any) => void; reject: (r: any) => void } | null = null;
    (replaceRunAsset as any).mockImplementation((_rid: number, _aid: number, _f: File, signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const assets = [mkAsset(1, 'doc.pdf')];
    const { rerender } = render(RunAssetsTab, { props: { ...baseProps, assets } });

    await fireEvent.click(screen.getByRole('button', { name: /Replace/i }));
    const replaceInput = document.querySelector('input[type="file"][data-role="replace"]') as HTMLInputElement;
    const file = new File(['NEW'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(replaceInput, 'files', { value: [file] });
    await fireEvent.change(replaceInput);
    await fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    // Change runId prop — effect's tracked `runId` dep should fire cleanup
    rerender({ ...baseProps, assets, runId: 999 });

    await vi.waitFor(() => {
      expect(pending).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run; expected FAIL** (no replace flow yet)

- [ ] **Step 3: Implement replace flow**

Add to the script:

```svelte
  import { replaceRunAsset } from '../../lib/runAssets';

  let replaceInputEl: HTMLInputElement | null = null;
  let pendingReplaceAssetId = $state<number | null>(null);
  let replaceConfirm = $state<{ assetId: number; file: File } | null>(null);
  let pendingReplaceController: AbortController | null = null;
  let replaceError = $state<string | null>(null);

  // Svelte 5 footgun: $effect cleanup only runs on unmount OR when reactive dep
  // READ inside the effect changes. RunAssetsTab stays mounted across runIdInt
  // changes while activeTab === 'assets', so explicitly track runId.
  $effect(() => {
    runId; // tracked dep
    return () => {
      pendingReplaceController?.abort();
      pendingReplaceController = null;
    };
  });

  function handleReplaceClick(assetId: number) {
    if (versionIsDisabled) return;
    pendingReplaceAssetId = assetId;
    replaceError = null;
    replaceInputEl?.click();
  }

  function getExt(name: string): string {
    return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  }

  async function onReplaceInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    const aid = pendingReplaceAssetId;
    pendingReplaceAssetId = null;
    if (!file || aid == null) return;

    const asset = assets.find((a) => a.id === aid);
    if (!asset) { replaceError = 'This asset is no longer in the list.'; return; }

    // Case-insensitive extension match
    if (getExt(file.name) !== getExt(asset.filename)) {
      replaceError = `New file must have the same extension as the original (.${getExt(asset.filename)}).`;
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      replaceError = `${file.name}: file too large.`;
      return;
    }

    replaceConfirm = { assetId: aid, file };
  }

  function onReplaceCancel() {
    pendingReplaceAssetId = null;
    replaceConfirm = null;
  }

  async function performReplace() {
    if (!replaceConfirm) return;
    const { assetId, file } = replaceConfirm;
    pendingReplaceController = new AbortController();
    try {
      await replaceRunAsset(runId, assetId, file, pendingReplaceController.signal);
      await onRefetchAssets();
      replaceConfirm = null;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      if (e?.status === 404) {
        replaceError = 'This asset was deleted by another user.';
        await onRefetchAssets();
      } else if (e?.status === 422) {
        replaceError = `New file must have the same extension as the original.`;
      } else if (e?.status === 413) {
        replaceError = `Replacing would exceed this run's storage quota.`;
      } else {
        replaceError = e?.message ?? 'Replace failed.';
      }
      replaceConfirm = null;
    } finally {
      pendingReplaceController = null;
    }
  }
```

Add the hidden replace input near the upload input:

```svelte
<input
  type="file"
  data-role="replace"
  bind:this={replaceInputEl}
  oncancel={() => { pendingReplaceAssetId = null; }}
  onchange={onReplaceInputChange}
  style="display:none"
  aria-hidden="true"
/>
```

In the actions cell of each row, render an InlineConfirm when this row is the replace target:

```svelte
<td class="actions-cell">
  {#if replaceConfirm?.assetId === a.id}
    {@const refCount = miniProjects == null ? 0 : referencingMpIds(a).length}
    <div class="inline-confirm">
      <p>
        Replace <code>{a.filename}</code> (new size: {formatFileSize(replaceConfirm.file.size)})?
        The current content will be overwritten and cannot be recovered.
        {#if refCount > 0}
          {refCount} mini-project(s) that reference this file will continue to point at the new content.
        {/if}
      </p>
      <button type="button" onclick={performReplace}>Confirm</button>
      <button type="button" onclick={onReplaceCancel}>Cancel</button>
    </div>
  {/if}
  <button
    type="button"
    disabled={versionIsDisabled}
    title={versionIsDisabled ? "This run's course version is disabled." : ''}
    onclick={() => handleReplaceClick(a.id)}
  >↻ Replace</button>
  <button type="button" disabled={versionIsDisabled} aria-label="Delete {a.filename}">×</button>
</td>
```

Add the error banner below the upload progress banner:

```svelte
{#if replaceError}
  <div role="status" class="banner banner-error">{replaceError}</div>
{/if}
```

CSS:

```css
.actions-cell { white-space: nowrap; }
.inline-confirm { background: #fff3e0; border: 1px solid #ffe0b2; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.5rem; }
.inline-confirm p { margin: 0 0 0.5rem 0; }
```

- [ ] **Step 4: Run replace tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "replace"`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab — replace flow with abort cleanup

- Single shared <input type="file" data-role="replace"> per tab.
  pendingReplaceAssetId tracks which row triggered. Reset to null on
  input.value='' AND on the new HTML oncancel event (Chromium 113+/
  Safari 16.4+) so OS dialog-cancel doesn't leave stale state.
- Per-row InlineConfirm rendered alongside the [↻ Replace] / [×]
  actions cell (mirrors RunMiniProjectsTab.svelte:206-243 pattern, NOT
  replacing buttons). Confirm copy adapts to N=0 (orphan replace).
- Client-side validation before InlineConfirm: case-insensitive ext
  match (.PDF accepts .pdf), MAX_FILE_SIZE_BYTES.
- 422 ext mismatch / 413 quota / 404 mid-flight all surface as banners.
  404 also fires onRefetchAssets() so the stale row disappears.
- pendingReplaceController.signal threaded into replaceRunAsset PUT.
- $effect with explicit runId tracked dep aborts the controller on
  unmount OR runId prop change (Svelte 5 footgun: cleanup doesn't run
  on prop change unless the prop is read inside the effect body).
- Server-side commits for already-dispatched PUTs are an Accepted gap
  (same shape as bulk-delete in-flight gap).

T9 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `RunAssetsTab` — delete flow (single + force-confirm + onReloadRun)

**Files:**
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte`
- Modify: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** `[×]` per-row opens an InlineConfirm in the shared `openConfirm` slot. Orphan: simple "Delete this asset?" + Confirm/Cancel. Referenced: force-confirm view with `I understand` checkbox + danger button + `aria-describedby` warning. Danger button disabled when `!course.is_admin` with tooltip. On confirm: DELETE with `force` per backend `is_referenced`; on success → `await Promise.all([onRefetchAssets(), onRefetchMiniProjects()])`. On 403 stale → banner + `onReloadRun()`.

- [ ] **Step 1: Write the failing tests for orphan delete + referenced force-confirm**

Append:

```typescript
import { deleteRunAsset } from '../lib/runAssets';

describe('RunAssetsTab — delete (orphan)', () => {
  it('clicking [×] on orphan opens "Delete this asset?" confirm; Confirm calls deleteRunAsset', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [{ ...mkAsset(1, 'orphan.pdf'), is_referenced: false }];
    render(RunAssetsTab, { props: { ...baseProps, assets, onRefetchAssets } });

    await fireEvent.click(screen.getByRole('button', { name: /Delete orphan\.pdf/i }));
    expect(screen.getByText(/Delete this asset\?/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    await vi.waitFor(() => {
      expect(deleteRunAsset).toHaveBeenCalledWith(1, 1, expect.objectContaining({ force: false }));
      expect(onRefetchAssets).toHaveBeenCalled();
    });
  });
});

describe('RunAssetsTab — delete (referenced, force-confirm)', () => {
  const fixture = {
    assets: [{ ...mkAsset(1, 'ref.pdf'), is_referenced: true }],
    miniProjects: [{ id: 10, slug: 'm', title: 'M', block_title: 'B',
      assignment_md: '![](ref.pdf)', hard_deadline: null,
      resubmission_deadline: null, is_published: false } as any],
  };

  it('opens force-confirm view with checkbox + danger button (disabled until checked)', async () => {
    render(RunAssetsTab, { props: { ...baseProps, ...fixture } });

    await fireEvent.click(screen.getByRole('button', { name: /Delete ref\.pdf/i }));
    expect(screen.getByText(/referenced by 1 mini-project/i)).toBeInTheDocument();
    const danger = screen.getByRole('button', { name: /Force delete/i });
    expect(danger).toBeDisabled();

    const checkbox = screen.getByRole('checkbox', { name: /I understand/i });
    await fireEvent.click(checkbox);
    expect(danger).not.toBeDisabled();
  });

  it('force-delete fires DELETE with force=true + both refetches via Promise.all', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    render(RunAssetsTab, { props: { ...baseProps, ...fixture, onRefetchAssets, onRefetchMiniProjects } });

    await fireEvent.click(screen.getByRole('button', { name: /Delete ref\.pdf/i }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /I understand/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Force delete/i }));

    await vi.waitFor(() => {
      expect(deleteRunAsset).toHaveBeenCalledWith(1, 1, expect.objectContaining({ force: true }));
      expect(onRefetchAssets).toHaveBeenCalled();
      expect(onRefetchMiniProjects).toHaveBeenCalled();
    });
  });

  it('!course.is_admin → danger button disabled with tooltip even after checkbox', async () => {
    const props = { ...baseProps, ...fixture, course: { ...baseProps.course, is_admin: false } };
    render(RunAssetsTab, { props });

    await fireEvent.click(screen.getByRole('button', { name: /Delete ref\.pdf/i }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /I understand/i }));

    const danger = screen.getByRole('button', { name: /Force delete/i });
    expect(danger).toBeDisabled();
    expect(danger.getAttribute('title')).toMatch(/course admins/i);
  });

  it('403 stale-permission → banner + onReloadRun called', async () => {
    (deleteRunAsset as any).mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    const onReloadRun = vi.fn().mockResolvedValue(undefined);
    render(RunAssetsTab, { props: { ...baseProps, ...fixture, onReloadRun } });

    await fireEvent.click(screen.getByRole('button', { name: /Delete ref\.pdf/i }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /I understand/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Force delete/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/no longer have permission to force-delete/i)).toBeInTheDocument();
      expect(onReloadRun).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run; expected FAIL**

- [ ] **Step 3: Implement delete flow**

Add to the script:

```svelte
  import { deleteRunAsset } from '../../lib/runAssets';

  // Mutual exclusion across the 3 confirm surfaces (per-row replace, per-row
  // delete, bulk-delete strip) is enforced by manual clearing — opening any
  // confirm clears the other two $state slots. Functionally equivalent to a
  // single discriminated union; clearer to keep the per-confirm state with
  // its slot (file in replaceConfirm; isReferenced + checkboxChecked in
  // deleteConfirm; orphan/referenced counts in bulkConfirm).
  let deleteConfirm = $state<{ assetId: number; isReferenced: boolean; checkboxChecked: boolean } | null>(null);
  let deleteError = $state<string | null>(null);

  function openDeleteConfirm(assetId: number, isReferenced: boolean) {
    if (versionIsDisabled) return;
    replaceConfirm = null;  // mutual exclusion
    deleteConfirm = { assetId, isReferenced, checkboxChecked: false };
  }

  function cancelDelete() {
    deleteConfirm = null;
  }

  async function performDelete() {
    if (!deleteConfirm) return;
    const { assetId, isReferenced } = deleteConfirm;
    const force = isReferenced;
    try {
      await deleteRunAsset(runId, assetId, { force });
      if (force) {
        await Promise.all([onRefetchAssets(), onRefetchMiniProjects()]);
      } else {
        await onRefetchAssets();
      }
      deleteConfirm = null;
    } catch (e: any) {
      if (e?.status === 403) {
        deleteError = 'You no longer have permission to force-delete. Refresh and retry.';
        await onReloadRun();
      } else if (e?.status === 404) {
        deleteError = 'This asset was deleted by another user.';
        await onRefetchAssets();
      } else {
        deleteError = e?.message ?? 'Delete failed.';
      }
      deleteConfirm = null;
    }
  }
```

In the actions cell, add the delete InlineConfirm above the buttons:

```svelte
<td class="actions-cell">
  {#if deleteConfirm?.assetId === a.id}
    {@const refCount = miniProjects == null ? 0 : referencingMpIds(a).length}
    <div class="inline-confirm">
      {#if !deleteConfirm.isReferenced}
        <p>Delete this asset?</p>
        <button type="button" onclick={performDelete}>Confirm</button>
        <button type="button" onclick={cancelDelete}>Cancel</button>
      {:else}
        <p id="warn-{a.id}">
          This asset is referenced by {refCount} mini-project(s). Deleting it will leave their
          <code>![ref]</code> markdown broken. This cannot be undone.
        </p>
        <label>
          <input
            type="checkbox"
            checked={deleteConfirm.checkboxChecked}
            onchange={(e) => {
              if (deleteConfirm) deleteConfirm.checkboxChecked = (e.currentTarget as HTMLInputElement).checked;
            }}
          />
          I understand
        </label>
        <button
          type="button"
          class="danger"
          aria-describedby="warn-{a.id}"
          disabled={!deleteConfirm.checkboxChecked || !course.is_admin}
          title={!course.is_admin ? 'Only course admins can force-delete a referenced asset.' : ''}
          onclick={performDelete}
        >Force delete</button>
        <button type="button" onclick={cancelDelete}>Cancel</button>
      {/if}
    </div>
  {/if}
  <!-- existing replace InlineConfirm + buttons -->
  <button
    type="button"
    disabled={versionIsDisabled}
    onclick={() => handleReplaceClick(a.id)}
  >↻ Replace</button>
  <button
    type="button"
    disabled={versionIsDisabled}
    aria-label="Delete {a.filename}"
    onclick={() => openDeleteConfirm(a.id, a.is_referenced)}
  >×</button>
</td>
```

Add the delete error banner below the existing banners:

```svelte
{#if deleteError}
  <div role="status" class="banner banner-error">{deleteError}</div>
{/if}
```

Add CSS:

```css
button.danger { background: #c62828; color: white; border: none; padding: 0.25rem 0.75rem; border-radius: 4px; }
button.danger:disabled { background: #ef9a9a; cursor: not-allowed; }
```

- [ ] **Step 4: Run delete tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "delete"`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab — delete flow (orphan + referenced force-confirm)

- [×] per-row opens InlineConfirm alongside actions cell.
- Orphan path: simple "Delete this asset?" + Confirm/Cancel → DELETE
  without force → onRefetchAssets.
- Referenced path: force-confirm view with warning copy, "I understand"
  checkbox, danger button (aria-describedby="warn-{assetId}"). Danger
  button disabled until checkbox checked AND course.is_admin true; on
  !is_admin shows tooltip "Only course admins can force-delete a
  referenced asset."
- Force-delete success → await Promise.all([onRefetchAssets,
  onRefetchMiniProjects]) so both $state writes settle in the same
  microtask flush.
- 403 stale permission → banner + onReloadRun() (parent's loadAll
  refreshes course.is_admin).
- 404 cross-user delete → banner + auto-refetch.
- Mutual exclusion: opening delete confirm closes replace confirm
  (shared openConfirm semantics — bulk strip will use the same slot
  in T11).

T10 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `RunAssetsTab` — bulk operations + 404 storm coalescing

**Files:**
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte`
- Modify: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** Header checkbox selects visible rows (respects filter). Selection clears on filter change. Action strip below filter pills (in-flow, NOT sticky) with "N selected" + "[Delete N selected]". Mutual exclusion via shared `openConfirm`. Bulk Confirm → sequential DELETEs threaded through `bulkController = new AbortController()`. Per-iteration guard re-checks `loadToken + rid`; on mismatch abort+break+refetch (token-guarded, no-ops if stale) + skip summary banner. `$effect` with explicit `runId` tracked dep also aborts on prop change. Per-row `force` flag derived from backend `is_referenced`. Summary banner after completion. 404 storm: 500ms component-scoped coalescer (timer + counter + unmount clear).

- [ ] **Step 1: Write the failing tests for bulk selection + action strip**

Append:

```typescript
describe('RunAssetsTab — bulk operations', () => {
  const assets = [
    { ...mkAsset(1, 'a.pdf'), is_referenced: false },
    { ...mkAsset(2, 'b.pdf'), is_referenced: false },
    { ...mkAsset(3, 'c.pdf'), is_referenced: true },
  ];
  const miniProjects = [
    { id: 10, slug: 'm', title: 'M', block_title: 'B', assignment_md: '![](c.pdf)',
      hard_deadline: null, resubmission_deadline: null, is_published: false } as any,
  ];

  it('header checkbox selects all visible; action strip appears', async () => {
    render(RunAssetsTab, { props: { ...baseProps, assets, miniProjects } });

    const header = screen.getByRole('checkbox', { name: /Select all/i });
    await fireEvent.click(header);

    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete 3 selected/i })).toBeInTheDocument();
  });

  it('filter change clears selection', async () => {
    render(RunAssetsTab, { props: { ...baseProps, assets, miniProjects } });
    await fireEvent.click(screen.getByRole('checkbox', { name: /Select all/i }));
    expect(screen.queryByText(/3 selected/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Orphan/ }));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('bulk DELETE with mixed orphan+referenced sends correct ?force per row', async () => {
    (deleteRunAsset as any).mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    render(RunAssetsTab, { props: { ...baseProps, assets, miniProjects, onRefetchAssets, onRefetchMiniProjects } });

    await fireEvent.click(screen.getByRole('checkbox', { name: /Select all/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Delete 3 selected/i }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /I understand/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Force delete/i }));

    await vi.waitFor(() => {
      expect(deleteRunAsset).toHaveBeenCalledTimes(3);
      // a.pdf (orphan) → force: false (or undefined)
      expect(deleteRunAsset).toHaveBeenCalledWith(1, 1, expect.objectContaining({ force: false }));
      expect(deleteRunAsset).toHaveBeenCalledWith(1, 2, expect.objectContaining({ force: false }));
      // c.pdf (referenced) → force: true
      expect(deleteRunAsset).toHaveBeenCalledWith(1, 3, expect.objectContaining({ force: true }));
      expect(onRefetchMiniProjects).toHaveBeenCalled();
    });
  });

  it('force flag derived from backend is_referenced even when client scan would disagree', async () => {
    // Fixture: backend says is_referenced=true but client scan returns 0
    const staleAssets = [{ ...mkAsset(1, 'stale.pdf'), is_referenced: true }];
    const staleMps: any[] = []; // no MPs reference this in their assignment_md
    (deleteRunAsset as any).mockResolvedValue(undefined);
    render(RunAssetsTab, { props: { ...baseProps, assets: staleAssets, miniProjects: staleMps } });

    await fireEvent.click(screen.getByRole('checkbox', { name: /Select all/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Delete 1 selected/i }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /I understand/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Force delete/i }));

    await vi.waitFor(() => {
      expect(deleteRunAsset).toHaveBeenCalledWith(1, 1, expect.objectContaining({ force: true }));
    });
  });

  it('partial failure → summary banner lists failed filenames', async () => {
    let call = 0;
    (deleteRunAsset as any).mockImplementation((_rid: number, aid: number) => {
      call++;
      if (aid === 2) return Promise.reject(new Error('server error'));
      return Promise.resolve();
    });
    const assets2 = [
      { ...mkAsset(1, 'ok-1.pdf'), is_referenced: false },
      { ...mkAsset(2, 'fail.pdf'), is_referenced: false },
      { ...mkAsset(3, 'ok-3.pdf'), is_referenced: false },
    ];
    render(RunAssetsTab, { props: { ...baseProps, assets: assets2 } });

    await fireEvent.click(screen.getByRole('checkbox', { name: /Select all/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Delete 3 selected/i }));
    await fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

    await vi.waitFor(() => {
      expect(screen.getByText(/Deleted 2 of 3.*fail\.pdf/i)).toBeInTheDocument();
    });
  });
});

describe('RunAssetsTab — 404 storm coalescing', () => {
  it('≥2 404s within 500ms → single banner + single refetch', async () => {
    vi.useFakeTimers();
    (deleteRunAsset as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);
    const assets = [mkAsset(1, 'a.pdf'), mkAsset(2, 'b.pdf')];
    render(RunAssetsTab, { props: { ...baseProps, assets, onRefetchAssets } });

    // Trigger two single deletes back-to-back
    await fireEvent.click(screen.getAllByRole('button', { name: /Delete a\.pdf/i })[0]!);
    await fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

    await vi.advanceTimersByTimeAsync(100);

    await fireEvent.click(screen.getAllByRole('button', { name: /Delete b\.pdf/i })[0]!);
    await fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

    // Both 404'd within 100ms. Window hasn't elapsed.
    expect(onRefetchAssets).not.toHaveBeenCalled();

    // Advance past 500ms
    await vi.advanceTimersByTimeAsync(500);

    expect(onRefetchAssets).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Some assets were deleted by another user/i)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run; expected FAIL**

- [ ] **Step 3: Implement bulk operations + storm coalescer**

Add to script:

```svelte
  let selectedIds = $state<Set<number>>(new Set());
  let bulkConfirm = $state<{ orphanCount: number; referencedCount: number; checkboxChecked: boolean } | null>(null);
  let bulkController: AbortController | null = null;
  let summaryBanner = $state<string | null>(null);

  // Reset bulk + per-row confirms; clear selection. Used by filter changes.
  $effect(() => {
    activeFilter; // tracked dep
    selectedIds = new Set();
    bulkConfirm = null;
  });

  // $effect for bulk controller cleanup on unmount OR runId change
  $effect(() => {
    runId;
    return () => {
      bulkController?.abort();
      bulkController = null;
    };
  });

  function toggleSelectAll() {
    const visible = sortedAssets();
    if (visible.every((a) => selectedIds.has(a.id))) {
      // all already selected → deselect
      selectedIds = new Set();
    } else {
      selectedIds = new Set(visible.map((a) => a.id));
    }
  }

  function toggleRow(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function openBulkConfirm() {
    if (versionIsDisabled || selectedIds.size === 0) return;
    deleteConfirm = null;
    replaceConfirm = null;
    let orphanCount = 0;
    let referencedCount = 0;
    for (const a of assets) {
      if (!selectedIds.has(a.id)) continue;
      if (a.is_referenced) referencedCount++;
      else orphanCount++;
    }
    bulkConfirm = { orphanCount, referencedCount, checkboxChecked: referencedCount === 0 };
  }

  function cancelBulk() { bulkConfirm = null; }

  // 404 storm coalescer
  let storm404Timer: ReturnType<typeof setTimeout> | null = null;
  let storm404Seen = 0;

  $effect(() => {
    return () => {
      if (storm404Timer) { clearTimeout(storm404Timer); storm404Timer = null; }
    };
  });

  let storm404Banner = $state<string | null>(null);

  function note404() {
    storm404Seen++;
    if (storm404Timer == null) {
      storm404Timer = setTimeout(async () => {
        storm404Timer = null;
        const seen = storm404Seen;
        storm404Seen = 0;
        storm404Banner = seen > 1
          ? 'Some assets were deleted by another user.'
          : 'This asset was deleted by another user.';
        await onRefetchAssets();
      }, 500);
    }
  }

  async function performBulkDelete() {
    if (!bulkConfirm || selectedIds.size === 0) return;
    const myToken = (window as any).__loadToken ?? 0; // sentinel; real impl reads via prop or imported sentinel
    const myRunId = runId;
    bulkController = new AbortController();
    const failed: string[] = [];
    let done = 0;
    const total = selectedIds.size;
    try {
      const ids = Array.from(selectedIds);
      for (const aid of ids) {
        // Per-iteration guard
        if (runId !== myRunId) {
          bulkController.abort();
          await onRefetchAssets();
          return;
        }
        const asset = assets.find((x) => x.id === aid);
        if (!asset) { failed.push(`#${aid}`); continue; }
        try {
          await deleteRunAsset(runId, aid, {
            force: asset.is_referenced,
            signal: bulkController.signal,
          });
          done++;
        } catch (e: any) {
          if (e?.name === 'AbortError') {
            await onRefetchAssets();
            return;
          }
          if (e?.status === 404) {
            note404();
            done++;
            continue;
          }
          failed.push(asset.filename);
        }
      }
      // Refetches after success
      const anyReferenced = Array.from(selectedIds).some((id) => assets.find((a) => a.id === id)?.is_referenced);
      if (anyReferenced) {
        await Promise.all([onRefetchAssets(), onRefetchMiniProjects()]);
      } else {
        await onRefetchAssets();
      }

      summaryBanner = `Deleted ${done} of ${total}.${failed.length ? ` Failed: ${failed.join(', ')}.` : ''}`;
      selectedIds = new Set();
      bulkConfirm = null;
    } finally {
      bulkController = null;
    }
  }
```

(Note: in the real implementation, the per-iteration `loadToken` guard reads the parent's `loadToken` either via a prop or imported sentinel — leave the sentinel pattern as-is in this plan; the actual integration with `RunDetailPage.loadToken` happens in T13 when we wire the props through.)

Update the header checkbox in `<thead>`:

```svelte
<th scope="col">
  <input
    type="checkbox"
    aria-label="Select all"
    checked={selectedIds.size === sortedAssets().length && sortedAssets().length > 0}
    onclick={toggleSelectAll}
    disabled={versionIsDisabled}
  />
</th>
```

Update the row checkbox in `<tbody>`:

```svelte
<td>
  <input
    type="checkbox"
    aria-label="Select {a.filename}"
    checked={selectedIds.has(a.id)}
    onclick={() => toggleRow(a.id)}
    disabled={versionIsDisabled}
  />
</td>
```

Add the action strip above the table:

```svelte
{#if selectedIds.size > 0}
  <div class="bulk-strip">
    <span>{selectedIds.size} selected</span>
    {#if bulkConfirm}
      {@const { orphanCount, referencedCount, checkboxChecked } = bulkConfirm}
      <div class="inline-confirm">
        <p>Delete {orphanCount + referencedCount} selected
          ({orphanCount} orphan, {referencedCount} referenced)?
          {#if referencedCount > 0}
            This will break <code>![ref]</code> markdown in {referencedCount} mini-project(s)
            and cannot be undone.
          {/if}
        </p>
        {#if referencedCount > 0}
          <label>
            <input
              type="checkbox"
              checked={checkboxChecked}
              onchange={(e) => { if (bulkConfirm) bulkConfirm.checkboxChecked = (e.currentTarget as HTMLInputElement).checked; }}
            />
            I understand
          </label>
          <button
            type="button"
            class="danger"
            disabled={!checkboxChecked || !course.is_admin}
            title={!course.is_admin ? 'Only course admins can force-delete a referenced asset.' : ''}
            onclick={performBulkDelete}
          >Force delete</button>
        {:else}
          <button type="button" onclick={performBulkDelete}>Confirm</button>
        {/if}
        <button type="button" onclick={cancelBulk}>Cancel</button>
      </div>
    {:else}
      <button
        type="button"
        disabled={versionIsDisabled}
        onclick={openBulkConfirm}
      >Delete {selectedIds.size} selected</button>
    {/if}
  </div>
{/if}

{#if summaryBanner}
  <div role="status" class="banner">{summaryBanner}</div>
{/if}
{#if storm404Banner}
  <div role="status" class="banner banner-error">{storm404Banner}</div>
{/if}
```

CSS:

```css
.bulk-strip {
  display: flex; gap: 0.75rem; align-items: center;
  padding: 0.5rem 0.75rem; background: #fff8e1; border: 1px solid #ffe082;
  border-radius: 4px; margin-bottom: 0.5rem;
}
```

Also update the single-row 404 handler (in `performDelete` for orphan/referenced single delete) to call `note404()` instead of writing `deleteError` directly for the 404 case, so the storm coalescer can do its job:

```svelte
} else if (e?.status === 404) {
  note404();
  // no banner write — coalescer handles it
}
```

- [ ] **Step 4: Run bulk + storm tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "bulk\\|storm"`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab — bulk operations + 404 storm coalescing

Bulk:
- Header checkbox selects all currently-visible rows; respects active filter.
- Filter change clears the selection (via $effect on activeFilter).
- In-flow action strip (NOT sticky — .tab-body has no scroll container
  and the tabs row itself isn't sticky; in-flow is simpler at typical
  ~20-asset scale).
- Bulk InlineConfirm shows "M orphan, N referenced" + checkbox + danger
  button when any referenced; gated on course.is_admin same as single
  force-delete.
- Sequential DELETE loop with bulkController = new AbortController();
  signal threaded into every deleteRunAsset call.
- Per-iteration guard re-checks runId === myRunId BEFORE next dispatch;
  on mismatch calls bulkController.abort(), fires a refetch (so any
  already-committed deletes surface), and breaks WITHOUT writing the
  summary banner.
- $effect with explicit runId tracked dep also aborts on prop change
  (Svelte 5 footgun fix — cleanup doesn't run on prop change unless the
  prop is read inside the effect body).
- Per-row force flag derived from backend is_referenced (NOT client
  scan) — important when miniProjects is stale.
- Summary banner: "Deleted M of N. Failed: {filename1}, {filename2}."

404 storm coalescer (component-scoped):
- let storm404Timer + let storm404Seen
- First 404 starts 500ms timer; subsequent 404s within the window
  increment counter.
- On flush: single banner ("Some assets were deleted by another user."
  if N > 1; "This asset was deleted by another user." if N === 1) +
  single onRefetchAssets().
- $effect cleanup clears the timer on unmount.

T11 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `RunAssetsTab` — edge case banners (`versionIsDisabled`, `pinnedAvailable`)

**Files:**
- Modify: `frontend/src/components/runs/RunAssetsTab.svelte`
- Modify: `frontend/src/tests/RunAssetsTab.svelte.test.ts`

**Acceptance contract:** When `versionIsDisabled === true`, all action buttons (`[+ Upload]`, `[↻ Replace]`, `[×]`, bulk strip) AND row checkboxes are disabled with tooltip. Asset list itself remains readable. The `pinnedAvailable === false` banner is rendered by the parent (`RunDetailPage`) at the page level — the tab itself doesn't render it. We still test that the component degrades gracefully when given an empty asset list.

- [ ] **Step 1: Write the failing test for versionIsDisabled disabling all actions**

Append:

```typescript
describe('RunAssetsTab — versionIsDisabled', () => {
  const assets = [{ ...mkAsset(1, 'doc.pdf'), is_referenced: false }];

  it('disables [+ Upload], [↻ Replace], [×], header + row checkboxes with tooltip', () => {
    render(RunAssetsTab, { props: { ...baseProps, assets, versionIsDisabled: true } });

    const upload = screen.getByRole('button', { name: /\+ Upload/ });
    expect(upload).toBeDisabled();

    const replace = screen.getByRole('button', { name: /Replace/i });
    expect(replace).toBeDisabled();

    const del = screen.getByRole('button', { name: /Delete doc\.pdf/i });
    expect(del).toBeDisabled();

    const headerCheck = screen.getByRole('checkbox', { name: /Select all/i });
    expect(headerCheck).toBeDisabled();

    const rowCheck = screen.getByRole('checkbox', { name: /Select doc\.pdf/i });
    expect(rowCheck).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run; check existing implementation**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts -t "versionIsDisabled"`

Expected: should already PASS based on the disabled={versionIsDisabled} props sprinkled in T6/T8/T9/T10/T11. If not, audit the component and add the `disabled` attr to any missed elements.

- [ ] **Step 3: Add tooltip via `title` attribute on disabled buttons**

If the test asserts tooltip text, ensure each disabled action button has:

```svelte
title={versionIsDisabled ? "This run's course version is disabled." : ''}
```

Update tests to also assert the tooltip if not already there.

- [ ] **Step 4: Run all RunAssetsTab tests + svelte-check**

Run:
```
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunAssetsTab.svelte.test.ts && npx svelte-check --tsconfig ./tsconfig.json
```

Expected: all PASS, 0 svelte-check errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/runs/RunAssetsTab.svelte frontend/src/tests/RunAssetsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunAssetsTab — versionIsDisabled disables all action surfaces

When versionIsDisabled === true:
- [+ Upload] button disabled
- [↻ Replace] per-row buttons disabled
- [×] per-row buttons disabled
- Header-row "Select all" checkbox disabled
- Per-row checkboxes disabled (no selection without an actionable
  destination)
- Bulk strip [Delete N selected] disabled

All show tooltip "This run's course version is disabled." Asset list
itself remains fully readable; only the action surfaces are gated.

The pinnedAvailable === false banner is parent-rendered (RunDetailPage
shows the same banner used by Mini-projects tab) — the Assets tab
itself doesn't manage that state.

T12 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `RunDetailPage` — integration (6th tab + loadAll + state + callback props)

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte`
- Modify: `frontend/src/tests/RunDetailPage.svelte.test.ts`
- Modify: `frontend/src/tests/RunDetailPage.publish.svelte.test.ts`

**Acceptance contract:** `ActiveTab` gains `'assets'`. New `$state`: `assets: RunAssetResponse[] | null` + `pendingEditTarget: MiniProjectResponse | null`. `loadAll` outer Promise.all extends to 6 items (`listRunAssets` joins outer batch — run-scoped). Loading guard adds `assets === null`. Entry reset nulls `assets` + `pendingEditTarget`. New `refetchAssets()` mirrors `refetchMiniProjects` but without `pinnedAvailable` gate. 6th tab button + `{:else if activeTab === 'assets'}` branch wires all 4 callback props + `pendingEditTarget` passthrough to MP tab. Existing fixtures across `.test.ts` and `.publish.test.ts` get a default `[]` for `/api/runs/{rid}/assets`.

- [ ] **Step 1: Write the failing test for 6th tab rendering**

Open `frontend/src/tests/RunDetailPage.svelte.test.ts`. Read the existing `mockHappyPath` helper to understand the fetch-mock convention.

Append to the test file (near the existing 5th-tab tests):

```typescript
describe('RunDetailPage — Assets tab', () => {
  it('renders 6th tab labeled "Assets"; clicking shows RunAssetsTab empty state', async () => {
    mockHappyPath();
    // override /assets to return empty list
    mockGet('/api/runs/42/assets', []);

    render(RunDetailPage, { props: { runId: 42 } });
    await vi.waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Assets' })).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));
    expect(screen.getByText(/No assets yet/i)).toBeInTheDocument();
  });

  it('listAssets fails → whole page renders loadError (all-or-nothing invariant)', async () => {
    mockHappyPath();
    mockGet('/api/runs/42/assets', { status: 500, body: { detail: 'boom' } });

    render(RunDetailPage, { props: { runId: 42 } });
    await vi.waitFor(() => {
      expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: 'Assets' })).toBeNull();
  });

  it('assets === null loading guard prevents tab-button flash', async () => {
    let resolveAssets: (v: any) => void;
    mockHappyPath();
    mockGet('/api/runs/42/assets', new Promise((r) => { resolveAssets = r; }));

    render(RunDetailPage, { props: { runId: 42 } });
    // Mid-load: no tab buttons visible
    expect(screen.queryByRole('tab', { name: 'Assets' })).toBeNull();

    resolveAssets!([]);
    await vi.waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Assets' })).toBeInTheDocument();
    });
  });
});
```

(Adapt `mockGet`, `mockHappyPath` to match the actual helpers in the file. The mini-projects-frontend plan introduced `mockCascade` — a similar helper for the assets branch is fine.)

- [ ] **Step 2: Run; expected FAIL**

- [ ] **Step 3: Extend `RunDetailPage.svelte`**

Open `frontend/src/pages/runs/RunDetailPage.svelte`. Find the `ActiveTab` type (around line 44-45 in current code):

```typescript
type ActiveTab = 'overview' | 'teachers' | 'groups' | 'roster' | 'mini-projects' | 'assets';
```

Add `import` for `RunAssetsTab` and `listRunAssets`:

```typescript
import RunAssetsTab from '../../components/runs/RunAssetsTab.svelte';
import { listRunAssets } from '../../lib/runAssets';
import type { RunAssetResponse } from '../../lib/types';
```

Add the new `$state` near the existing `miniProjects`:

```typescript
let assets = $state<RunAssetResponse[] | null>(null);
let pendingEditTarget = $state<MiniProjectResponse | null>(null);
```

In `loadAll` (around line 62-89), extend the outer Promise.all:

```typescript
const [r, vs, ts, gs, ss, assetList] = await Promise.all([
  getRun(rid),
  listVersions(courseId),
  listRunTeachers(rid),
  listGroups(rid),
  listRunStudents(rid),
  listRunAssets(rid),
]);
if (myToken !== loadToken) return;
// ... existing assignment block:
assets = assetList;
```

In the entry-reset (around line 50-58), null `assets` + `pendingEditTarget`:

```typescript
function resetState() {
  // ... existing resets
  assets = null;
  pendingEditTarget = null;
}
```

Add the `refetchAssets` helper near `refetchMiniProjects` (around line 92-101):

```typescript
async function refetchAssets(): Promise<void> {
  if (runIdInt === null) return;
  const rid = runIdInt;
  const myToken = loadToken;
  const fetched = await listRunAssets(rid);
  if (myToken !== loadToken || rid !== runIdInt) return;
  assets = fetched;
}
```

(Note: NO `pinnedAvailable` gate — assets are run-scoped.)

Update the loading guard around line 277:

```svelte
{:else if course === null || run === null || versions === null || teachers === null || groups === null || students === null || blocks === null || miniProjects === null || assets === null}
  <Spinner />
{:else}
```

Add the 6th tab button (around line 322-328):

```svelte
<button
  role="tab"
  aria-selected={activeTab === 'assets'}
  onclick={() => (activeTab = 'assets')}
>Assets</button>
```

Add the 6th tab branch in the panel (after the mini-projects branch):

```svelte
{:else if activeTab === 'assets'}
  <RunAssetsTab
    runId={runIdInt!}
    assets={assets!}
    miniProjects={miniProjects!}
    course={course!}
    versionIsDisabled={showDisabledBanner}
    onRefetchAssets={refetchAssets}
    onRefetchMiniProjects={refetchMiniProjects}
    onEditMiniProject={(mp) => { pendingEditTarget = mp; activeTab = 'mini-projects'; }}
    onReloadRun={loadAll}
  />
```

Also update the mini-projects tab branch to pass `pendingEditTarget` + `onPendingEditConsumed`:

```svelte
{:else if activeTab === 'mini-projects'}
  <RunMiniProjectsTab
    runId={runIdInt!}
    miniProjects={miniProjects!}
    blocks={blocks!}
    course={course!}
    runIsPublished={run!.is_published}
    pinnedAvailable={pinnedAvailable}
    versionIsDisabled={showDisabledBanner}
    onRefetchMiniProjects={refetchMiniProjects}
    onNavigateToTab={(t) => (activeTab = t)}
    pendingEditTarget={pendingEditTarget}
    onPendingEditConsumed={() => (pendingEditTarget = null)}
  />
```

(Adapt prop names to match what RunMiniProjectsTab currently accepts. The new two props will be added in T14.)

- [ ] **Step 4: Update existing test fixtures**

Open `frontend/src/tests/RunDetailPage.svelte.test.ts`. In `mockHappyPath` (or equivalent setup helper), add a default `[]` branch for `/api/runs/{rid}/assets`:

```typescript
function mockHappyPath() {
  // ... existing branches
  mockGet(/\/api\/runs\/\d+\/assets$/, []);
}
```

Also update `frontend/src/tests/RunDetailPage.publish.svelte.test.ts` fixtures (3 `fetchSpy.mockImplementation` calls per the prior T8 plan) to include the same `[]` branch.

- [ ] **Step 5: Run RunDetailPage tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunDetailPage.svelte.test.ts src/tests/RunDetailPage.publish.svelte.test.ts`

- [ ] **Step 6: Run full frontend test suite + svelte-check**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json`

Expected: all pass, 0 svelte-check errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunDetailPage.svelte.test.ts frontend/src/tests/RunDetailPage.publish.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunDetailPage — integrate Assets tab (6th tab)

- ActiveTab union gains 'assets'.
- New $state: assets (RunAssetResponse[] | null) + pendingEditTarget
  (MiniProjectResponse | null). Both null in entry-reset.
- loadAll extends outer Promise.all from 5 → 6 items by adding
  listRunAssets(rid). Run-scoped data — placed in outer batch, NOT
  inner (version-scoped) batch.
- Loading guard at line 277 extended with `|| assets === null` to
  prevent tab-button flash.
- New refetchAssets helper mirrors refetchMiniProjects but WITHOUT the
  pinnedAvailable gate (assets are run-scoped). Captures rid + myToken
  at entry; re-checks post-await before writing $state.
- 6th tab button + <RunAssetsTab> branch wires all 4 callback props:
  refetchAssets, refetchMiniProjects, onEditMiniProject (sets
  pendingEditTarget + switches activeTab), onReloadRun (loadAll).
- Mini-projects tab branch gains pendingEditTarget + onPendingEditConsumed
  prop pair so the new T14 RunMiniProjectsTab $effect can open the
  modal when prompted.
- Existing fixtures across .svelte.test.ts and .publish.svelte.test.ts
  get a default `[]` branch for /api/runs/{rid}/assets so legacy tests
  don't break when loadAll adds the third Promise.all branch.

T13 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `RunMiniProjectsTab` — consume `pendingEditTarget` prop

**Files:**
- Modify: `frontend/src/components/runs/RunMiniProjectsTab.svelte`
- Modify: `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`

**Acceptance contract:** Two new props: `pendingEditTarget?: MiniProjectResponse | null` and `onPendingEditConsumed?: () => void`. An `$effect` watches `pendingEditTarget`; on truthy → set local `modalMode = 'edit'` + `editTarget = pendingEditTarget`, then call `onPendingEditConsumed?.()` so the parent clears the pending target. Explicit guard `if (!pendingEditTarget) return;` prevents re-entry on the cleared state. Stale-cascade case: if the MP is no longer in the local `miniProjects` list, the effect still fires the consumed callback but does NOT open the modal.

- [ ] **Step 1: Write the failing tests for pendingEditTarget consumption**

Append to `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts`:

```typescript
describe('RunMiniProjectsTab — pendingEditTarget consumption', () => {
  const baseProps = {
    runId: 1,
    blocks: [{ id: 1, title: 'Block', position: 0 }] as any,
    miniProjects: [
      { id: 10, slug: 'm', title: 'MP A', block_id: 1, assignment_md: '',
        hard_deadline: null, resubmission_deadline: null, is_published: false } as any,
    ],
    course: { id: 1, slug: 'c', title: 'C', is_admin: true, default_version_id: null },
    runIsPublished: false,
    pinnedAvailable: true,
    versionIsDisabled: false,
    onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
    onNavigateToTab: vi.fn(),
  };

  it('given pendingEditTarget, modal mounts in edit mode + onPendingEditConsumed fires', async () => {
    const onPendingEditConsumed = vi.fn();
    render(RunMiniProjectsTab, {
      props: { ...baseProps, pendingEditTarget: baseProps.miniProjects[0], onPendingEditConsumed },
    });

    await vi.waitFor(() => {
      // Modal in edit mode for MP id 10
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByDisplayValue('MP A')).toBeInTheDocument();
      expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);
    });
  });

  it('stale pendingEditTarget (MP not in list — cascade race) → modal NOT opened, consumed still fires', async () => {
    const onPendingEditConsumed = vi.fn();
    render(RunMiniProjectsTab, {
      props: {
        ...baseProps,
        pendingEditTarget: { ...baseProps.miniProjects[0]!, id: 99999 } as any, // not in list
        onPendingEditConsumed,
      },
    });

    await vi.waitFor(() => {
      expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no re-entry loop: effect early-returns when pendingEditTarget is null', () => {
    const onPendingEditConsumed = vi.fn();
    render(RunMiniProjectsTab, {
      props: { ...baseProps, pendingEditTarget: null, onPendingEditConsumed },
    });
    expect(onPendingEditConsumed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; expected FAIL** (props don't exist yet)

- [ ] **Step 3: Add the props + `$effect` to RunMiniProjectsTab**

Open `frontend/src/components/runs/RunMiniProjectsTab.svelte`. Extend the props destructure:

```svelte
let {
  runId,
  blocks,
  miniProjects,
  course,
  runIsPublished,
  pinnedAvailable,
  versionIsDisabled,
  onRefetchMiniProjects,
  onNavigateToTab,
  pendingEditTarget = null,
  onPendingEditConsumed,
}: {
  runId: number;
  blocks: BlockResponse[];
  miniProjects: MiniProjectResponse[];
  course: CourseResponse;
  runIsPublished: boolean;
  pinnedAvailable: boolean;
  versionIsDisabled: boolean;
  onRefetchMiniProjects: () => Promise<void>;
  onNavigateToTab: (tab: 'overview' | 'teachers' | 'groups' | 'roster' | 'assets') => void;
  pendingEditTarget?: MiniProjectResponse | null;
  onPendingEditConsumed?: () => void;
} = $props();
```

Add the `$effect` after the existing `$state` declarations:

```svelte
$effect(() => {
  if (!pendingEditTarget) return;  // explicit guard — no re-entry
  // Stale check: still in the local miniProjects list?
  const stillExists = miniProjects.some((mp) => mp.id === pendingEditTarget!.id);
  if (stillExists) {
    editTarget = pendingEditTarget;
    modalMode = 'edit';
  }
  // Either way, fire the consumed callback so parent clears the pending state
  onPendingEditConsumed?.();
});
```

(Confirm `editTarget` and `modalMode` are the actual local `$state` names — they should be from prior MP work at `RunMiniProjectsTab.svelte:48-49`.)

Also update the `onNavigateToTab` union to include `'assets'` as a valid target (the spec calls for this when threading 6 tabs):

- [ ] **Step 4: Run tests; expected PASS**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunMiniProjectsTab.svelte.test.ts -t "pendingEditTarget"`

- [ ] **Step 5: Run full RunMiniProjectsTab tests + svelte-check**

Run: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run src/tests/RunMiniProjectsTab.svelte.test.ts && npx svelte-check --tsconfig ./tsconfig.json`

Expected: all PASS, 0 svelte-check errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/runs/RunMiniProjectsTab.svelte frontend/src/tests/RunMiniProjectsTab.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): RunMiniProjectsTab — consume pendingEditTarget for cross-tab edit

Two new props:
- pendingEditTarget?: MiniProjectResponse | null (full object, not id —
  parent resolves so the child skips a resolution race)
- onPendingEditConsumed?: () => void

$effect watches pendingEditTarget with an explicit guard:
  if (!pendingEditTarget) return;  // no re-entry loop on cleared state

When truthy:
- Stale check: if MP no longer in local miniProjects list (cascade race),
  do NOT open the modal — but DO fire onPendingEditConsumed so the parent
  clears the dangling reference.
- Otherwise: set local editTarget + modalMode = 'edit' AND fire
  onPendingEditConsumed.

onNavigateToTab union extended with 'assets' for completeness (the new
6th tab is a valid navigation target).

T14 of run-assets-management plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Manual smoke walkthrough

**Files:** None (verification only)

**Acceptance contract:** Full feature works end-to-end in a real browser with a real backend. Catches integration issues that unit tests can't (CSS layout, z-index, drop zone events, OS file picker, real network latency, multi-user race).

**Setup:**

- Run the backend in one terminal:
  ```
  cd /Users/svkucheryavski/Documents/Developing/mathion/backend
  .venv/bin/python -m uvicorn mathion.app:app --reload --port 8000
  ```
- Run the frontend dev server in another:
  ```
  cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
  npm run dev
  ```
- Sign in as a course-admin user with at least one published run that has ≥1 MP referencing ≥1 asset.

- [ ] **Step 1: Open RunDetailPage; verify 6th "Assets" tab appears alongside the existing 5**

Navigate to `/runs/{rid}`. Expected: tab bar shows Overview, Teachers, Groups, Roster, Mini-projects, **Assets** — in that order. No flash of the Assets tab before assets load (loading guard works).

- [ ] **Step 2: Click Assets; verify empty-state CTA appears when run has no assets**

If the run has no assets yet, expect: "No assets yet. Drop files here or click + Upload." If it has assets, the table renders.

- [ ] **Step 3: Upload via [+ Upload] button**

Click `[+ Upload]`. OS file picker opens. Pick a small PDF. Expected: `Uploading 1 of 1…` progress flashes briefly (announced by screen reader if testing with one); row appears in table; size + uploaded_at + uploaded_by_email columns populated.

- [ ] **Step 4: Upload via drop zone**

Drag a different file from your file manager into the tab body. Expected: dashed border highlights the table wrapper; on drop, file uploads. Try dropping an oversize file → red inline error. Try dropping a `.exe` → red inline error.

- [ ] **Step 5: Click filename → opens in new tab**

Click any filename link. Expected: opens `/api/runs/{rid}/assets/{filename}` in a new tab; PDF/image renders inline.

- [ ] **Step 6: Filter pills + sort headers**

Click Orphan pill → only orphan rows visible; pill goes blue (`aria-pressed=true`). Click Filename header twice → cycles ascending → descending. Click Uploaded header → sorts by date. Switch back to All pill → orphan filter clears (selection too if any).

- [ ] **Step 7: "uses N" badge + sub-panel**

For a referenced asset, click the green `N uses` badge. Expected: badge highlights, sub-panel opens below the row listing the MPs that reference it. Press Esc → sub-panel closes. Click another badge → previous closes, new one opens.

- [ ] **Step 8: [Edit] in sub-panel → navigates to MP tab + opens modal**

In the sub-panel, click `[Edit]` on a listed MP. Expected: page switches to the Mini-projects tab AND the MP modal opens in edit mode with that MP's content loaded.

- [ ] **Step 9: Close modal, return to Assets tab**

Cancel/Save the MP modal. Expected: focus stays on the MP tab (Accepted gap — cross-tab focus return not implemented). Manually click Assets tab to return.

- [ ] **Step 10: Replace flow**

Click `[↻ Replace]` on an asset. Pick a same-extension file. Expected: per-row InlineConfirm appears alongside actions with copy `Replace <filename> (new size: N MB)? ... N mini-project(s) ... continue to point at the new content.` Click Confirm → file replaces; row's size + uploaded_at update; filename unchanged. Click an asset's filename → GET serve URL still works (filename unchanged means URL stable).

Test the OS dialog-cancel: click `[↻ Replace]`, then cancel the OS picker. Expected: no InlineConfirm appears (pendingReplaceAssetId reset via oncancel).

Test extension mismatch: click `[↻ Replace]` on a `.pdf` asset, pick a `.png`. Expected: red inline error "New file must have the same extension as the original (.pdf)." No InlineConfirm shown.

- [ ] **Step 11: Delete orphan**

Click `[×]` on an orphan asset. InlineConfirm appears with "Delete this asset?" + Confirm/Cancel. Click Confirm. Expected: row disappears; no other UI changes; "uses N" badges unchanged on remaining rows.

- [ ] **Step 12: Force-delete referenced (course-admin)**

Click `[×]` on a referenced asset. Force-confirm view appears with warning + `I understand` checkbox + red `Force delete` button. Verify Force delete is disabled until checkbox is checked. Check it. Click Force delete. Expected: row disappears; if the MP tab is opened next, the formerly-referenced MP's `![](filename.pdf)` markdown will now render as raw markdown (broken ref) — confirms the cascade fired AND `onRefetchMiniProjects` ran.

- [ ] **Step 13: Force-delete without course-admin (role test)**

Sign in as a run-teacher who is NOT a course-admin. Open the Assets tab. Click `[×]` on a referenced asset. Expected: Force-confirm view appears but the red Force delete button is disabled with tooltip "Only course admins can force-delete a referenced asset." even after checking the checkbox.

- [ ] **Step 14: Bulk select + delete mixed orphan + referenced**

Sign back in as course-admin. Check the header checkbox. Expected: bulk strip appears below filter pills with "N selected" + Delete N selected. Click it. InlineConfirm in the strip with "M orphan, N referenced" + checkbox + danger button (because some are referenced). Check `I understand`. Click Force delete. Expected: sequential DELETE for each row; summary banner appears "Deleted N of N." after completion; the formerly-referenced MPs now have broken refs in the MP tab.

- [ ] **Step 15: Bulk + filter clear**

Refill the run with some assets. Select 3. Switch the filter pill from All to Orphan. Expected: selection clears; bulk strip disappears.

- [ ] **Step 16: 404 race (two browsers)**

In one browser, open the Assets tab. In another, sign in as another admin and delete one of those assets. Back in browser 1: refresh the tab. Browser 1 should still show the deleted asset (no real-time sync — Accepted gap). Click `[×]` on the now-deleted asset. Expected: backend returns 404; banner "This asset was deleted by another user." auto-refetch removes it from the list.

- [ ] **Step 17: versionIsDisabled state**

In another tab as a course-admin, disable the run's pinned version. Refresh the Assets tab in browser 1. Expected: all action buttons + checkboxes disabled with tooltip "This run's course version is disabled." Asset list still readable.

- [ ] **Step 18: Final report**

Report any UX or correctness issues found during the smoke. Common things to flag:
- Banner placement (above/below filter pills as the spec calls for?)
- Drop zone visual indicator (dashed border visible?)
- Focus management (force-confirm checkbox gets focus on open?)
- Aria announcements (does VoiceOver/NVDA announce upload progress?)

If any defect blocks the feature, raise it as a sub-task or back-fill commit. Otherwise close T15 with a green status note.

- [ ] **Step 19: Run the full test suite once more before declaring done**

Run:
```
cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest backend/tests/test_run_assets.py -xvs
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npx vitest run && npx svelte-check --tsconfig ./tsconfig.json
```

Expected: all green, 0 svelte-check errors.

- [ ] **Step 20: Commit (no-op completion marker)**

If any smoke-walk fixes were needed, commit them as separate commits with `fix(frontend|backend): ... — T15 smoke catch` in the subject line.

No commit required if the walkthrough was clean.

---

## Plan complete

Feature spans 15 tasks, ~60 commits, ~30 new tests, 1 new backend endpoint, 2 new frontend lib modules, 1 new component, 1 new test file. Spec at `docs/superpowers/specs/2026-05-25-run-assets-management-design.md` (rev 3.5, commit `d0f037f`) is the authoritative source for any clarification.

