# Phase 9 Security Tightening — Slice B (submissions/evaluations) — Design

**Status:** Draft (pre-codex, pre-plan). First slice of the Phase 9 hardening arc.

**Goal:** Close two backend-only security gaps on the submissions/evaluations surface:
1. **#1 — Existence enumeration oracle:** four GET-by-id read endpoints return `403` when a student is unauthorized, which confirms the row exists (a nonexistent id returns `404`). Probing ids and watching 403-vs-404 enumerates other groups' submissions/evaluations. Fix: return a `404` that is **byte-indistinguishable** from the missing-row `404`.
2. **#2 — No PDF content validation:** both PDF uploads validate only the filename *extension*, then store and serve the bytes as `application/pdf`. A renamed non-PDF sails through. Fix: require the `%PDF-` file signature.

**Architecture:** Backend-only edits to two API modules plus one small helper. No new components.

**Tech stack:** FastAPI + Starlette + SQLAlchemy 2.0 (unchanged). No new dependencies.

## Global Constraints

- Backend-only. **No** schema change, **no** Alembic migration, **no** new dependency, **no** frontend change.
- Follow the codebase's established uniform-response security posture: the superuser panel returns `404` (not `403`) to hide route existence; `/request-pin` returns a uniform body for all outcomes; the Slice-B submission-thread endpoint (`GET /api/runs/{rid}/dashboard/mini-projects/{mp_id}/groups/{group_id}/submissions`) already returns a **probe-safe uniform 404**. This slice brings the older read-by-id endpoints in line with that precedent.
- TDD: each behavioural change lands with a failing test first.
- Commit trailer EXACTLY: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Never stage the three long-standing untracked files (`docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`).

## Current State (grounded in code, 2026-07-16)

### #1 — the 403 existence leak

`mathion/api/helpers.py:get_or_404` raises `404` with detail `f"{Model.__name__} not found"` for a missing row. The four read-by-id endpoints, however, raise `403` on the *unauthorized* branch, so an existing-but-forbidden row is distinguishable from an absent one:

| Endpoint | Path | Key | Current 403 sites |
|---|---|---|---|
| `get_submission` | `GET /api/submissions/{sid}` | `sid` | `submissions.py:279` ("Not visible"), `:282` ("Not a member of submitting group") |
| `get_submission_file` | `GET /api/submissions/{sid}/file` | `sid` | `submissions.py:297` ("Not visible"), `:300` ("Not a member of submitting group") |
| `get_evaluation` | `GET /api/submissions/{sid}/evaluation` | `sid` | `evaluations.py:167` ("Not visible"), `:170` ("Not a group member") |
| `get_feedback_file` | `GET /api/evaluations/{eid}/feedback-file` | `eid` | `evaluations.py:216` ("Not visible"), `:219` ("Not a group member") |

(Line numbers are indicative anchors against the 2026-07-16 tree; the plan matches on surrounding code, not raw line numbers.)

Attack: a student in group A guesses a `sid`/`eid`. If it belongs to group B, the current code passes `get_or_404` (row exists), fails the visibility/membership gate, and returns `403` — confirming the row exists. A truly-absent id returns `404`. The 403/404 split is the oracle.

### #2 — no PDF content check

`mathion/assets.py:validate_extension(filename)` returns the lowercase extension if it is in `ALLOWED_EXTENSIONS`, else `None`. Both PDF uploads additionally require `ext == "pdf"` but never inspect the bytes:
- `create_submission` (`submissions.py:107-121`): extension + size checks, then stores `content`.
- `create_evaluation` (`evaluations.py:76-89`): same for the optional feedback file.

Both are served back via `FileResponse(..., media_type="application/pdf")`. A file named `x.pdf` whose content is an executable/HTML/etc. is accepted and stored as a "PDF".

## Design

### Change 1 — Uniform 404 on unauthorized reads

**Principle:** an unauthorized read must be indistinguishable from a missing row — identical **status (404)** *and* identical **body**. The body must carry the exact `detail` string `get_or_404` emits for that endpoint's key model, so the `detail` cannot itself re-leak existence.

Flip the eight sites above from `403` to `404` with these details:

| Endpoint | New response on unauthorized | Detail (must equal the missing-row 404) |
|---|---|---|
| `get_submission` (`:279`,`:282`) | `404` | `"Submission not found"` |
| `get_submission_file` (`:297`,`:300`) | `404` | `"Submission not found"` |
| `get_evaluation` (`:167`,`:170`) | `404` | `"Submission not found"` — endpoint is keyed by submission `sid`; its `get_or_404` at `evaluations.py:162` is on `Submission` |
| `get_feedback_file` (`:216`,`:219`) | `404` | `"Evaluation not found"` — keyed by `eid`; its `get_or_404` at `evaluations.py:211` is on `Evaluation` |

The forbidden-path 404 must be produced with the **same** string as `get_or_404`'s (`f"{Model.__name__} not found"`). The implementation plan chooses the exact mechanism (an inline literal identical to the model's name, or a tiny shared "not found" helper), but a test asserts the forbidden-id and nonexistent-id responses are **byte-identical** (status + JSON body), so any drift fails CI.

**Explicitly preserved (NOT changed):**
- The post-authorization-gate 404s (`File not found` / `File missing` at `submissions.py:307,309` and `evaluations.py:228,230`; `No feedback file` at `evaluations.py:222`). These fire only after the caller is authorized, so they reveal nothing cross-tenant.
- `create_submission` visibility/membership 403s (`submissions.py:64,68`) and `create_evaluation`/`patch_evaluation` authz 403s (`require_run_admin_or_teacher`). These are action errors on POST/PATCH, out of scope, and covered by three existing tests that must keep asserting `403`.
- Admin/teacher branches, which return the resource unchanged.

**Why the "Evaluation not found" and "No feedback file" details do not leak:** in `get_evaluation`, an authorized student on their own submission with no evaluation yet gets `404 "Evaluation not found"` (`evaluations.py:173`); an unauthorized probe gets `404 "Submission not found"` (matching the missing-`sid` 404). The two are different strings but only reachable by different actors — an unauthorized prober never sees "Evaluation not found". Likewise `get_feedback_file`'s `"No feedback file"` (`:222`) is reachable only after the auth gate passes.

### Change 2 — Strict PDF magic-byte on uploads

Add, in `mathion/assets.py` next to `validate_extension`:

```python
PDF_MAGIC = b"%PDF-"

def looks_like_pdf(content: bytes) -> bool:
    """True if the bytes begin with the PDF file signature (%PDF-)."""
    return content.startswith(PDF_MAGIC)
```

Wire it into both uploads **immediately after the existing size check** (the full `content` is already in memory, so no extra read):
- `create_submission` — after the `File size ... exceeds max` check: `if not looks_like_pdf(content): raise HTTPException(status_code=400, detail="Submission must be a valid PDF")`.
- `create_evaluation` — after the corresponding size check: `if not looks_like_pdf(content): raise HTTPException(status_code=400, detail="feedback_file must be a valid PDF")`.

Short (`<5` byte) and empty files fail naturally (empty is already caught earlier with `"Empty file"`/`"Empty feedback file"`). The `400` message is distinct and descriptive: this is the uploader's own file, not an enumeration oracle, so a clear message is preferred over obscurity.

## Response Contract Summary

- Unauthorized read of an existing row → `404` with the same body as a missing-row `404` (per table above).
- Upload of a `.pdf`-named file whose content does not start with `%PDF-` → `400` with a clear "must be a valid PDF" message.
- All other existing status codes (`200`/`201`/`400`/`409`/`422`/`500`/post-auth `404`) unchanged.

## Testing (TDD)

1. **#1 indistinguishability (new tests, RED→GREEN).** For each of the four read endpoints, one test where an unauthorized student (a member of a *different* group, or with no group) requests (a) a real id belonging to another group and (b) a nonexistent id, asserting the two responses have **identical `status_code` and identical JSON body**. These fail today (real id → 403) and pass after the flip. The read endpoints currently have no unauthorized-path tests, so these are additions, not edits.
2. **#2 magic-byte.**
   - Unit tests for `looks_like_pdf`: `b"%PDF-1.4 ..."` → True; `b"%PDF"` (4 bytes) → False; `b"MZ\x90\x00"` → False; `b""` → False; `b"%PD"` → False.
   - Endpoint tests: a `.pdf`-named upload with non-PDF content (`b"MZ\x90\x00"`, mime `application/pdf`) → `400` for both `create_submission` and `create_evaluation` (distinct from the existing extension test at `test_submissions.py:193` which uploads `malware.exe`); a real `%PDF-`-prefixed upload → success (`201`).
3. **Fixture update (required by the strict `%PDF-` choice).** Existing happy-path uploads use `b"%PDF"` (4 bytes, no hyphen), which the strict check rejects. Update every such literal to `b"%PDF-"` (≈17 occurrences across `tests/test_submissions.py` and `tests/test_evaluations.py`). This makes the fixtures more realistic (real PDF headers are `%PDF-1.x`).
4. **Regression.** The three existing create/authz 403 tests (`test_submit_blocks_non_group_member`, `test_submit_enrolled_but_no_group`, `test_post_evaluation_requires_admin_or_teacher`) must still assert `403`.
5. Full backend suite green at the end.

## Files Touched

- `mathion/assets.py` — add `PDF_MAGIC` + `looks_like_pdf`.
- `mathion/api/submissions.py` — flip 4 sites to 404; add magic-byte gate in `create_submission`.
- `mathion/api/evaluations.py` — flip 4 sites to 404; add magic-byte gate in `create_evaluation`.
- `tests/test_submissions.py`, `tests/test_evaluations.py` — new #1 + #2 tests; fixture literal updates.

## Success Criteria

1. An unauthorized student cannot distinguish a forbidden submission/evaluation id from a nonexistent one on any of the four read endpoints (identical status + body), verified by test.
2. A file named `*.pdf` whose bytes do not begin with `%PDF-` is rejected with `400` on both upload endpoints, verified by test.
3. No change to authorized behaviour (students reading their own group's data; admins/teachers) and no change to the preserved 403/404 sites.
4. No schema/migration/dependency/frontend change; full backend suite green.

## Risks & Considerations

- **Frontend:** the four unauthorized branches are not reached in normal UI flows (the UI only requests the student's own group's data), so flipping 403→404 has no user-facing effect for legitimate users. No frontend change; a plan step notes verifying no client code branches on `403` from these endpoints.
- **Message-drift on #1:** the whole value of #1 depends on the forbidden 404 body matching the missing-row 404 body exactly. The indistinguishability test is the guard; the plan must include it, not just the status flip.
- **Leniency trade-off on #2:** strict `%PDF-` may reject an exotic-but-valid PDF that begins with leading bytes before the signature; this is vanishingly rare and accepted (the lenient scan-first-1KB alternative was considered and declined for simplicity).

## Non-goals (explicitly deferred)

- The `list_submissions` / `create_submission` visibility 403s and any full-API 403-on-read audit.
- Content validation for non-PDF asset types (run-assets, course-assets: csv/xls/xlsx/ppt/pptx/images) — needs a per-type signature table; some formats (csv) have no reliable magic bytes.
- The Phase 9 concurrency `TODO(phase 9)` markers (sub-project A) and architecture cleanup (sub-project C).

## Review Record

- (to be filled) Codex pass on this spec.
- (to be filled) User approval.
