# Phase 9 Security Tightening — Slice B (submissions/evaluations) — Design

**Status:** Draft, revised after codex pass 1 (CHANGES REQUIRED → all findings verified against code and folded in: scope expanded to 6 endpoints; fixture inventory corrected to 40/6 files; timing residual acknowledged; byte-identity test; signature-screening wording). Awaiting codex pass 2 + user approval. First slice of the Phase 9 hardening arc.

**Goal:** Close two backend-only security gaps on the submissions/evaluations surface:
1. **#1 — Existence enumeration oracle:** six endpoints keyed by a submission/evaluation row id (`sid`/`eid`) return `403` when the caller is unauthorized, which confirms the row exists (a nonexistent id returns `404`). Probing ids and watching 403-vs-404 enumerates other groups' submissions/evaluations. Fix: on the unauthorized branch return a `404` whose **status code and response body** are identical to the missing-row `404`, so forbidden ≡ absent (status/body oracle closed; see the timing residual below).
2. **#2 — No PDF signature check:** both PDF uploads validate only the filename *extension*, then store and serve the bytes as `application/pdf`. A renamed non-PDF sails through. Fix: require the `%PDF-` file-header signature (a header screen, not full PDF validity).

**Architecture:** Backend-only edits to two API modules plus one small helper. No new components.

**Tech stack:** FastAPI 0.136.0 + Starlette 1.0.0 + SQLAlchemy 2.0 (unchanged). No new dependencies.

## Global Constraints

- Backend-only. **No** schema change, **no** Alembic migration, **no** new dependency, **no** frontend change.
- Follow the codebase's established uniform-response security posture: the superuser panel returns `404` (not `403`) to hide route existence; `/request-pin` returns a uniform body for all outcomes; the Slice-B submission-thread endpoint (`GET /api/runs/{rid}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions`) authorizes immediately after loading the run and returns a probe-safe uniform `404`. This slice brings the older submission/evaluation-keyed endpoints in line.
- TDD: each behavioural change lands with a failing test first.
- Commit trailer EXACTLY: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Never stage the three long-standing untracked files (`docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`).

## Current State (grounded in code, 2026-07-16)

### #1 — the 403 existence leak (six endpoints keyed by `sid`/`eid`)

`mathion/api/helpers.py:get_or_404` raises `404` with detail `f"{Model.__name__} not found"` for a missing row (the classes are named `Submission` and `Evaluation`). Six endpoints load a `Submission`/`Evaluation` by id **before** their authorization decision, so an existing-but-forbidden row returns `403` while an absent one returns `404`:

| Endpoint | Method / path | Key | `get_or_404` on | Current unauthorized `403` |
|---|---|---|---|---|
| `get_submission` | GET `/api/submissions/{sid}` | `sid` | `Submission` (`:273`) | `submissions.py:279,282` |
| `get_submission_file` | GET `/api/submissions/{sid}/file` | `sid` | `Submission` (`:292`) | `submissions.py:297,300` |
| `get_evaluation` | GET `/api/submissions/{sid}/evaluation` | `sid` | `Submission` (`:162`) | `evaluations.py:167,170` |
| `get_feedback_file` | GET `/api/evaluations/{eid}/feedback-file` | `eid` | `Evaluation` (`:211`) | `evaluations.py:216,219` |
| `create_evaluation` | POST `/api/submissions/{sid}/evaluation` | `sid` | `Submission` (`:64`) | `require_run_admin_or_teacher` at `:67` |
| `patch_evaluation` | PATCH `/api/evaluations/{eid}` | `eid` | `Evaluation` (`:184`) | `require_run_admin_or_teacher` at `:188` |

(Line numbers are indicative anchors against the 2026-07-16 tree; the plan matches on surrounding code.)

Attack paths (all reachable by any authenticated student; these endpoints have no CSRF gate, and `create_evaluation`/`patch_evaluation` are probeable trivially):
- The four GETs: request `sid`/`eid`; other-group row → `403`, absent → `404`.
- `create_evaluation`: `result` validation (`:56-62`) runs **before** `get_or_404` and is `sid`-independent, so a probe sends `result=accepted` (needs no file), passes those `422` gates, then observes `403` (existing `sid`) vs `404 "Submission not found"` (absent).
- `patch_evaluation`: `EvaluationUpdate` is all-optional, so an empty body `{}` reaches `get_or_404` and observes `403` (existing `eid`) vs `404 "Evaluation not found"` (absent). No mutation occurs on the unauthorized path.

**Not part of this leak (correctly out of scope):** `create_submission` and `list_submissions` are keyed by `mp_id`, so their 403/404 split leaks *mini-project* existence, a different resource. The dashboard thread endpoint authorizes right after loading the run (before loading mp/group/submissions), so it does not expose submission/evaluation existence (it retains a separate *run-id* 403/404 oracle — see Non-goals).

### #2 — no PDF signature check

`mathion/assets.py:validate_extension(filename)` returns the lowercase extension if it is in `ALLOWED_EXTENSIONS`, else `None`. Both PDF uploads additionally require `ext == "pdf"` but never inspect the bytes:
- `create_submission` (`submissions.py:107-121`): extension + empty + size checks, then stores `content`.
- `create_evaluation` (`evaluations.py:76-89`): same for the optional feedback file.

Both are served back via `FileResponse(..., media_type="application/pdf")`. A file named `x.pdf` whose content is an executable/HTML/etc. is accepted and stored as a "PDF".

## Design

### Change 1 — Uniform 404 on unauthorized submission/evaluation access

**Principle:** an unauthorized access must be indistinguishable from a missing row — identical **status (404)** *and* identical **body**. The body must carry the exact `detail` string `get_or_404` emits for that endpoint's key model, so the `detail` cannot itself re-leak existence.

Change the six unauthorized branches to `404`:

| Endpoint | Mechanism | 404 detail (== missing-row body) |
|---|---|---|
| `get_submission` (`:279,282`) | replace `403` raises with `404` | `"Submission not found"` |
| `get_submission_file` (`:297,300`) | replace `403` raises with `404` | `"Submission not found"` |
| `get_evaluation` (`:167,170`) | replace `403` raises with `404` | `"Submission not found"` |
| `get_feedback_file` (`:216,219`) | replace `403` raises with `404` | `"Evaluation not found"` |
| `create_evaluation` (`:67`) | replace `require_run_admin_or_teacher(...)` with `if not is_run_admin_or_teacher(db, user, run): raise HTTPException(404, "Submission not found")` | `"Submission not found"` |
| `patch_evaluation` (`:188`) | same swap → `raise HTTPException(404, "Evaluation not found")` | `"Evaluation not found"` |

`is_run_admin_or_teacher` (`helpers.py:139`) is the exact boolean equivalent of `require_run_admin_or_teacher` (superuser / course-admin / run-teacher → authorized), so the swap only changes the failure status (403→404) and preserves authorized-staff behaviour. It is already the pattern the read endpoints use for their staff branch.

The forbidden-path 404 must be produced with the **same** string as `get_or_404`'s (`f"{Model.__name__} not found"`). The plan chooses the exact mechanism (inline literal matching the model name, or a tiny shared "not-found" raiser), but a test asserts the forbidden-id and nonexistent-id responses are byte-identical (see Testing).

**Explicitly preserved (NOT changed):**
- Post-authorization-gate 404s (`File not found` / `File missing` at `submissions.py:307,309` and `evaluations.py:228,230`; `No feedback file` at `evaluations.py:222`). These fire only after the caller is authorized, so they reveal nothing cross-tenant. (In `get_evaluation`, an unauthorized prober is rejected at `:167/:170` before the evaluation query at `:171`, so they never reach `"Evaluation not found"` at `:173`.)
- `create_submission` visibility/membership 403s (`submissions.py:64,68`) and `list_submissions` 403s — `mp_id`-keyed, different resource.
- The `422` pre-validation in `create_evaluation` (`:56-62`) — `sid`-independent, so it does not leak existence; kept as-is.
- The `409`/`422` business rules that run *after* the authorization gate in both mutation endpoints (resubmission-locked, transition rule) — reachable only by authorized staff.

### Change 2 — Strict PDF header (signature) screen on uploads

Add, in `mathion/assets.py` next to `validate_extension`:

```python
PDF_MAGIC = b"%PDF-"

def looks_like_pdf(content: bytes) -> bool:
    """True if the bytes begin with the PDF file-header signature (%PDF-).
    This is a header screen, not a full PDF parse: it rejects obviously
    non-PDF content but does not guarantee structural validity."""
    return content.startswith(PDF_MAGIC)
```

Wire it into both uploads **immediately after the existing size check** (the full `content` is already in memory, so no extra read):
- `create_submission` — after the `File size ... exceeds max` check: `if not looks_like_pdf(content): raise HTTPException(status_code=400, detail="Submission is not a valid PDF (missing %PDF- header)")`.
- `create_evaluation` — after the corresponding size check: `if not looks_like_pdf(content): raise HTTPException(status_code=400, detail="feedback_file is not a valid PDF (missing %PDF- header)")`.

Empty files are already caught earlier (`"Empty file"` / `"Empty feedback file"`); short (`<5` byte) files fail naturally. The message names the header so the failure is self-explanatory (this is the uploader's own file, not an enumeration oracle).

## Response Contract Summary

- Unauthorized access to an existing submission/evaluation row → `404` with the same body as a missing-row `404` (per table).
- Upload of a `.pdf`-named file whose content does not start with `%PDF-` → `400` "…not a valid PDF (missing %PDF- header)".
- All other existing status codes (`200`/`201`/`400`/`409`/`422`/`500`/post-auth `404`) unchanged.

## Residual (accepted, documented — not closed by this slice)

- **Timing side-channel on #1.** A missing id short-circuits after one `db.get` in `get_or_404`; a forbidden existing id loads the submission/evaluation, mini-project, run, and runs membership/authorization queries before the uniform 404. Repeated measurements can therefore still distinguish absent from forbidden even though status, body, and deterministic headers match. This slice closes the **status/body** oracle only; equalizing timing (a single access-scoped query, or dummy work on the not-found path) is out of scope and low practical exploitability for a DB-bound delta over the network. This mirrors the Slice-2 `/request-pin` timing framing ("mitigates, does not fully close").

## Testing (TDD)

1. **#1 indistinguishability (new tests, RED→GREEN).** For each of the six endpoints, one test where an unauthorized actor requests (a) a real id belonging to another group/run and (b) a nonexistent id, asserting the two responses are byte-identical: equal `status_code`, equal raw `response.content`, and equal `Content-Type` / `Content-Length` headers (not just `.json()`; volatile Date/Server headers excluded). For the two mutation endpoints the probe uses the trivial payloads above (`result=accepted`; `{}`). These fail today (real id → 403) and pass after the flip.
2. **#2 signature screen.**
   - Unit tests for `looks_like_pdf`: `b"%PDF-1.4 ..."` → True; `b"%PDF"` (4 bytes) → False; `b"MZ\x90\x00"` → False; `b""` → False; `b"%PD"` → False.
   - Endpoint tests: a `.pdf`-named upload with non-PDF content (`b"MZ\x90\x00"`, mime `application/pdf`) → `400` for both `create_submission` and `create_evaluation` (distinct from the existing extension test at `test_submissions.py:193`, which uploads `malware.exe`); a real `%PDF-`-prefixed upload → success (`201`).
3. **Fixture update (required by the strict `%PDF-` choice) — 40 occurrences across 6 files.** Existing happy-path uploads use `b"%PDF"` (4 bytes, no hyphen), which the strict screen rejects. Update **every** such literal to a valid header (e.g. `b"%PDF-1.4\n..."`). Verified counts: `tests/test_submissions.py`, `tests/test_evaluations.py`, `tests/test_groups.py`, `tests/test_runs.py`, `tests/test_student_mini_projects.py`, `tests/test_mini_project_notifications.py` (40 total; the 18 already-hyphenated `b"%PDF-…"` literals need no change).
4. **Regression / expected flips.** The two `create_submission` `mp_id`-keyed 403 tests (`test_submit_blocks_non_group_member`, `test_submit_enrolled_but_no_group`) stay `403`. `test_post_evaluation_requires_admin_or_teacher` flips `403`→`404` (create_evaluation now hides existence); add a `patch_evaluation` non-staff probe test asserting `404`.
5. Full backend suite green at the end.

## Files Touched

- `mathion/assets.py` — add `PDF_MAGIC` + `looks_like_pdf`.
- `mathion/api/submissions.py` — flip 4 read sites to 404; add signature screen in `create_submission`.
- `mathion/api/evaluations.py` — flip `get_evaluation` (2) + `get_feedback_file` (2) reads to 404; swap `create_evaluation` + `patch_evaluation` authz to `is_run_admin_or_teacher`→404; add signature screen in `create_evaluation`.
- Tests: `tests/test_submissions.py`, `tests/test_evaluations.py` (new #1/#2 tests + fixture updates); `tests/test_groups.py`, `tests/test_runs.py`, `tests/test_student_mini_projects.py`, `tests/test_mini_project_notifications.py` (fixture updates only).

## Success Criteria

1. On all six submission/evaluation-keyed endpoints, an unauthorized caller cannot distinguish a forbidden id from a nonexistent one **by status code or response body** (byte-identical), verified by test. (Timing is a documented residual, not claimed closed.)
2. A file named `*.pdf` whose bytes do not begin with `%PDF-` is rejected with `400` on both upload endpoints, verified by test. (Header screen — structural validity / malicious-PDF detection remain out of scope.)
3. No change to authorized behaviour (students reading their own group's data; admins/teachers evaluating) and no change to the preserved 403/404 sites.
4. No schema/migration/dependency/frontend change; full backend suite green.

## Risks & Considerations

- **Frontend:** the unauthorized branches are not reached in normal UI flows (the UI only requests the student's own group's data; evaluation create/patch are admin/teacher surfaces). No frontend code branches on `403` from these endpoints. Effect on legitimate users is nil in-flow; a stale or now-forbidden link (e.g. after group removal or version unpublish) returns `404` instead of `403` — the intended security behaviour, not literally zero user-visible change. A plan step confirms no client dependency on these 403s.
- **Message-drift on #1:** the value of #1 depends on the forbidden 404 body matching the missing-row 404 body exactly. The byte-identity test is the guard; the plan must include it, not just the status flip.
- **Strictness trade-off on #2:** ISO 32000-1 requires the `%PDF-<version>` header on the first line, but permissive readers historically accept the header anywhere in the first ~1024 bytes. Strict `startswith(b"%PDF-")` is standards-aligned and rejects such non-conforming-but-reader-tolerated files — an intentional simplicity/compatibility trade-off (the lenient scan-first-1KB alternative was considered and declined).

## Non-goals (explicitly deferred)

- The `create_submission` / `list_submissions` `mp_id` 403s and the dashboard thread's separate run-id 403/404 oracle — a broader full-API 403-on-read audit (user declined that scope).
- Content validation for non-PDF asset types (run-assets, course-assets: csv/xls/xlsx/ppt/pptx/images) — needs a per-type signature table; some formats (csv) have no reliable magic bytes.
- Timing-channel equalization on #1 (documented residual above).
- The Phase 9 concurrency `TODO(phase 9)` markers (sub-project A) and architecture cleanup (sub-project C).

## Review Record

- Codex pass 1 (2026-07-16): CHANGES REQUIRED. All findings verified against code and folded in — Critical (POST/PATCH oracle) → scope expanded to 6 endpoints; Important (fixtures 40/6 files; timing overclaim; `.json()` vs byte-identity) and Minors (signature-vs-validity wording; false-reject framing; "no user-facing effect" absolute) → applied. User approved the 6-endpoint scope expansion.
- Codex pass 2 (pending) on this revised spec.
- User approval (pending).
