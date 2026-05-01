# Phase 7d — Bulk Roster Operations

**Date:** 2026-05-01
**Status:** Design approved, ready for implementation plan
**Predecessors:** Phase 7a (single-row roster CRUD + `/batch` for adds); Phase 7c (dashboards)

---

## Goal

Add two new bulk endpoints to the run-roster API so teachers can delete or move many students in one HTTP call. The existing `POST /api/runs/{id}/students/batch` already covers bulk *adds* via structured row paste. Phase 7d closes the gap by adding bulk *delete* and bulk *move*.

**One-sentence summary:** two new POST endpoints (`bulk-move`, `bulk-delete`) that loop the existing single-row semantics inside per-row SAVEPOINTs and return 207 multi-status — additive, no schema change, no migration.

## Non-Goals

- **CSV file upload (server-side parse).** By the same logic Phase 7c used for export, CSV import is a frontend concern: locale-dependent delimiter (`,` vs `;`), encoding (UTF-8/UTF-8 BOM/legacy), header language. The frontend parses the CSV in the browser and posts a JSON array to `/batch` (for adds) or to the new bulk endpoints (for moves/deletes). Backend stays format-agnostic.
- **Per-row move targets** (`{rows: [{user_id, group_id}, ...]}`). The 90% case is "all selected → one target group" (merging, redistributing). Per-row reshuffling can be done by calling bulk-move once per target group, or by single PATCH. Reconsider only if usage shows the multi-target case is common.
- **Bulk add of existing users by user_id.** The existing `/batch` already creates users from emails. There is no "bulk add by user_id" need.
- **Concurrency hardening.** Capacity check (`SELECT count + UPDATE`) is non-atomic across concurrent requests. Same Phase 9 TODO already documented at `run_roster.py:87` for single PATCH. Bulk-move *does* widen the window: the outer transaction commits only after the whole loop, so concurrent reads from a sibling bulk request see the pre-loop state until the final commit. Phase 9 (`SELECT FOR UPDATE` on Postgres) covers both. Documented inline; not solved here.

## Architecture

Both new endpoints live in the existing `mathion/api/run_roster.py`. Same router, same tags, same auth. No new module. No DB schema change. No Alembic migration.

```
mathion/api/run_roster.py          (extend, ~+80 LOC)
mathion/api/helpers.py             (extend, +1 helper: remove_run_student)
mathion/schemas.py                 (extend, +6 schemas)
tests/test_run_roster_bulk.py      (new file, ~250 LOC)
```

**Helper extraction:** the cascade-to-enrollment logic in single `DELETE /api/runs/{id}/students/{user_id}` (`run_roster.py:111-137`) is promoted to `helpers.py` as `remove_run_student(db, run, user_id) -> bool`. Returns `True` if a row was deleted, `False` if no `RunStudent` matched. The single endpoint and bulk-delete both call this — no duplication. Parallels the existing `enroll_user_in_run` helper that already unifies single-add and `/batch` add.

**Auth:** `require_run_admin_or_teacher(db, user, run)` — identical to every other roster endpoint.

**Run-state gates:** none beyond the existing single-row endpoint behavior. Specifically:
- Runs whose version is disabled, unpublished, or past end-date are still accessible to admin/teacher (matches existing single PATCH/DELETE).
- **Asymmetry note:** single ADD (`POST /api/runs/{id}/students`) goes through `enroll_user_in_run`, which raises 403 `"Run version is disabled"` if the version is disabled (`helpers.py:166-167`). Bulk-move and bulk-delete do *not* invoke `enroll_user_in_run` (they only mutate or delete existing `RunStudent` rows), so the disabled-version check does not fire on these paths. This is intentional: editing the roster of an already-disabled-version run (e.g., to remove a graduating student) should remain possible without forcing the teacher to re-enable the version.

## API Contract

### `POST /api/runs/{run_id}/students/bulk-delete`

**Request:**
```json
{
  "user_ids": [12, 34, 56]
}
```

Validation:
- `user_ids`: `min_length=1, max_length=200`. Empty or oversize → 422.
- Duplicate `user_ids` in the request body → 422 (`"user_ids must not contain duplicates"`). A duplicate is a UI bug; surface it loudly.

**Response 207 Multi-Status:**
```json
{
  "results": [
    {"user_id": 12, "status": "ok"},
    {"user_id": 34, "status": "error", "detail": "Student not in run"},
    {"user_id": 56, "status": "ok"}
  ]
}
```

Per-row processing delegates to the new `remove_run_student(db, run, user_id) -> bool` helper (extracted from the existing single DELETE handler — see Architecture):
1. Each row in its own SAVEPOINT.
2. Call `remove_run_student(db, run, uid)`. The helper:
   - Looks up `RunStudent` for `(run.id, user_id)`. Missing → returns `False`.
   - Otherwise deletes the `RunStudent` row, then checks for sibling `RunStudent` rows on any version of the same course (joins `Run` → `CourseVersion` → `course_id`).
   - If none remain, flips `StudentEnrollment.is_active = False` for `(user_id, version_id)`.
   - Returns `True`.
3. Helper returned `False` → bulk row records `error: "Student not in run"`. Helper returned `True` → bulk row records `ok`.
4. Outer transaction commits after the loop.

The single `DELETE /api/runs/{run_id}/students/{user_id}` is refactored to call the same helper, so single and bulk share one implementation. This parallels the existing `enroll_user_in_run` helper used by both single ADD and `/batch`.

Submissions are not blocked or cascaded — `Submission` is FK to `Group`, not to `RunStudent`. Removing a student leaves their group's submissions intact (same as today's single DELETE).

### `POST /api/runs/{run_id}/students/bulk-move`

**Request:**
```json
{
  "user_ids": [12, 34, 56],
  "group_id": 7
}
```

`group_id: null` is the explicit "unassign" signal (each listed student becomes group-less in this run). Validation as above.

**Pre-flight (whole-call failure):**
- `group_id` does not belong to this run → 400 `"Group not in this run"`.
- `group_id` refers to a disabled group → 409 `"Cannot move student into disabled group"` (string verbatim from existing single PATCH at `run_roster.py:86`).
- A bad target is a bad request, not a per-row failure.

**Response 207 Multi-Status:**
```json
{
  "results": [
    {"user_id": 12, "status": "ok",    "group_id": 7},
    {"user_id": 34, "status": "error", "detail": "Group capacity reached"},
    {"user_id": 56, "status": "ok",    "group_id": 7}
  ]
}
```

Per-row processing:
1. Look up `RunStudent` for `(run_id, user_id)`. Missing → `error: "Student not in run"`.
2. If `rs.group_id == data.group_id` → `ok` no-op (no capacity charge). Already in target.
3. If `data.group_id is not None`: count current size; if `>= 10` → `error: "Group capacity reached"`.
4. Set `rs.group_id = data.group_id`. Flush so the next iteration's count reflects the change.
5. Each row in its own SAVEPOINT.

**Capacity behavior — process in submitted order:** if a target group has room for 7 and the request lists 10 movers (none currently in target), rows 1–7 succeed and rows 8–10 fail with `"Group capacity reached"`. The count is recomputed per iteration and includes prior loop additions.

The "no-op + fill mix" case is locked behavior:
- Target B has 9 students (room for 1). user_X is in B; user_Y is in C; user_Z is in C.
- Request: `[user_X, user_Y, user_Z]`.
- Result: `ok(user_X)` *(no-op, B unchanged at 9)*; `ok(user_Y)` *(B → 10)*; `error(user_Z, "Group capacity reached")`.

## Schemas

Six new models — request/response pairs per endpoint, with separate result-row models so each one's schema reflects only the fields it actually populates.

```python
# Bulk move
class RunStudentBulkMoveRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)
    group_id: int | None = None

    @field_validator("user_ids")
    @classmethod
    def no_duplicates(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("user_ids must not contain duplicates")
        return v

class RunStudentBulkMoveResultRow(BaseModel):
    user_id: int
    status: Literal["ok", "error"]
    group_id: int | None = None     # populated on success (target group, or null for unassign)
    detail: str | None = None       # populated on error

class RunStudentBulkMoveResponse(BaseModel):
    results: list[RunStudentBulkMoveResultRow]

# Bulk delete
class RunStudentBulkDeleteRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)

    @field_validator("user_ids")
    @classmethod
    def no_duplicates(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("user_ids must not contain duplicates")
        return v

class RunStudentBulkDeleteResultRow(BaseModel):
    user_id: int
    status: Literal["ok", "error"]
    detail: str | None = None       # populated on error

class RunStudentBulkDeleteResponse(BaseModel):
    results: list[RunStudentBulkDeleteResultRow]
```

**Why split result/response models per endpoint:** delete results never carry a `group_id`; sharing one model would leave a permanently-null `group_id` field on every delete response, polluting the OpenAPI schema and confusing clients. Two narrow models cost ~8 LOC and document intent precisely.

**On `status: "ok"` vs existing `/batch` "added":** existing `RunStudentBatchResultRow` (`schemas.py:457`) uses `"added"`. The new endpoints use `"ok"` because the verb is implied by the URL. This introduces a second multi-status convention; we accept the mild inconsistency rather than break the established `/batch` contract by renaming.

## Edge Cases & Validation

**Auth & top-level (apply to both endpoints):**

| Case | Expected |
|---|---|
| Anonymous → endpoint | 401 |
| Student of run → endpoint | 403 |
| Teacher of *another* run → endpoint | 403 |
| Run not found | 404 |
| Empty `user_ids` | 422 |
| `len(user_ids) > 200` | 422 |
| Duplicate `user_ids` | 422 (`"user_ids must not contain duplicates"`) |

**Bulk-move pre-flight (whole-call failure):**

| Case | Expected |
|---|---|
| `group_id` belongs to a different run | 400 |
| `group_id` refers to a disabled group | 409 |

**Bulk-move per-row:**

| Case | Result row |
|---|---|
| user_id not in run | `error: "Student not in run"` |
| Already in target group | `ok` (no-op, no capacity charge) |
| Capacity full at this row | `error: "Group capacity reached"` |
| `group_id: null` (unassign) | `ok` (capacity check skipped) |
| Successful move | `ok, group_id: <target>` |

**Bulk-delete per-row:**

| Case | Result row | Side effect |
|---|---|---|
| user_id not in run | `error: "Student not in run"` | none |
| Successful delete, user has other runs on this course | `ok` | enrollment stays active |
| Successful delete, last run on this course | `ok` | `enrollment.is_active = False` |
| User has prior submissions | `ok` | submissions retained, tied to group (same as single DELETE) |

## Frontend Contract

The backend is the authoritative gate, but the UI should never let a teacher submit a request the backend will reject for trivially-knowable reasons.

- **Before `bulk-move`:** client computes `target_count + len(unique_user_ids_not_already_in_target) ≤ 10` and refuses to send otherwise. Per-row 409 capacity errors should not appear in normal use; they indicate a UI race or stale data.
- **Before either endpoint:** non-empty list, ≤ 200 items.
- A 422 response from the backend means the UI has a bug. Treat it as such.

## Testing

New file `backend/tests/test_run_roster_bulk.py`. Reuses fixtures from `test_run_roster.py` (`_publish_run` is *not* needed — roster endpoints work on unpublished runs).

**Bulk-move (8 tests):**
1. Non-admin/teacher → 403
2. Run not found → 404
3. `group_id` belongs to other run → 400
4. `group_id` is disabled group → 409
5. Empty / over-200 list → 422
6. Happy path: 3 students moved; response shape correct; DB reflects new `group_id`
7. Mixed result: not-in-run + already-in-target + capacity-full + success in one call (the regression-prone matrix above)
8. `group_id: null` unassigns; capacity skipped; no-op for already-unassigned

**Bulk-delete (5 tests):**
1. Non-admin/teacher → 403
2. Run not found → 404
3. Empty / over-200 list → 422
4. Happy path: 3 students removed; per-row results; 2 had `StudentEnrollment.is_active = False`, 1 stayed active (had a sibling-version run)
5. Some user_ids not in run → mixed `ok`/`error` results

**Shared (2 tests):**
- Duplicate `user_ids` → 422
- 207 status code returned even when all rows succeed

## Race & Concurrency Notes

The same single-PATCH race documented at `run_roster.py:87` applies to bulk-move: two concurrent bulk requests targeting the same near-full group can both pass the per-row count check and both succeed past 10 students.

**Widened window (worse than single PATCH):** the outer transaction commits only after the whole loop, so concurrent reads from a sibling bulk request see the pre-loop state of the target group until the final commit. The race window scales with batch size — O(N rows) instead of O(1). At Mathion's scale (admin-only roster operations, single-school deployment, runs capped at ~200) this is acceptable, but it must be documented honestly so the Phase 9 fix is properly scoped.

Mark a TODO inline at the bulk-move handler matching the existing pattern at `run_roster.py:87`. Phase 9 covers both single and bulk via `SELECT FOR UPDATE` on Postgres roster mutations.

## Open Items / Phase 9 Backlog (deferred)

- CSV file upload server-side (frontend covers).
- Per-row move targets (`{rows: [{user_id, group_id}, ...]}`).
- `SELECT count + UPDATE` capacity race (already in 7a backlog).
- `run_roster.py` size: ~270 LOC after this phase. Still fine, but Phase 9's "split helpers.py / re-organize routers" sweep should consider whether bulk + single + batch belong in one file.
