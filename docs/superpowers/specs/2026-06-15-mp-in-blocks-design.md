# MP-in-Blocks Student Surface — Design

**Status:** draft rev 14
**Date:** 2026-06-15 (rev 1), 2026-06-16 (rev 2 + rev 3 + rev 4 + rev 5 + rev 6 + rev 7 + rev 8 + rev 9 + rev 10), 2026-06-17 (rev 11 + rev 12 + rev 13 + rev 14)
**Branch:** `mp-in-blocks` (to be created)
**Predecessor:** notifications-email (merged 2026-06-14)
**Surfaced during:** notifications-email smoke walkthrough — students get emails about MPs but have no UI to submit.

## Rev history

**Rev 1 → Rev 2:** addressed convergent findings from 5 internal Opus reviewers (backend / frontend / UX / security / test) + codex R1.

- **C1 `_resolve_student_run` was under-specified:** rev 1 claimed it mirrored `student.py:216` (`/my-version`) but that endpoint resolves only a *version*, not a *run*. Rev 2 specifies the exact SQL (§4.1) and locks in the **invariant** that a student has at most one active `RunStudent` row per course (decision §10 D1). Resolver is 0-or-1 in normal flow; defensive `ORDER BY Run.start_date DESC LIMIT 1` + warning log if 2+ ever appear (legacy data, future bug).
- **C2 Constraint enforcement added to slice scope (D1):** §3.3 — `POST /api/runs/{rid}/students`, bulk, and `POST /api/runs/{rid}/publish` reject adding/publishing a student who already has an active `RunStudent` row on another published run of the same course (409).
- **C3 `can_submit` was incomplete:** rev 1 had 5 branches; rev 2 has the exact 7-step ladder mirroring `submissions.py:53-104` including `mini_project_visible_to_student`, `Group.is_disabled`, accepted, pending, and the initial/resubmission deadline split.
- **C4 IDOR via cross-version block_slug:** rev 2 mandates the version-scoped lookup `Block.version_id == run.version_id AND Block.slug == block_slug` (§4.2). Specific test added.
- **C5 Detail status pill source:** added `latest_status: Literal[...]` to `StudentMiniProjectDetail` (§3.2). Single source of truth — server derives from history, client renders.
- **C6 `filename` missing from submission history entry:** added `filename: str` (safe basename of `Submission.file_path`).
- **C7 `full_name` nullability:** `User.full_name` is nullable (`models_auth.py:13-14`). Rev 2 changes all `_full_name` fields to `str` with email-local-part fallback at serialization time (mirrors `notifications/templates.py:24-25`). Spec'd at §3.2.
- **C8 `App.svelte` componentMap registration:** rev 1 missed this. Added to §2 file list and §6.
- **C9 Stale-write guard with 3-element `Promise.all`:** rev 2 specifies the catch-point is inside the wire module (`fetchListSwallow403`), not the outer `loadCourse` try/catch (§7). (Note: rev 1 wording said "4th parallel fetch"; corrected in rev 5/rev 6 to "3-element" since there are 3 parallel fetches after the initial `my-version` await: content, state, and the new mini-projects list.)
- **C10 `encodeURIComponent` on hrefs and API URLs:** mandated in §5 + §6 + studentMiniProjects wire module.
- **C11 Submission history order changed from ASC to DESC** (newest first) — decision §10 D2.
- **C12 Peer emails dropped** from `StudentGroupMember` — decision §10 D3.
- **C13 Ungrouped student UX:** read-only preview with friendly banner — decision §10 D4. Backend returns 200 with `group=null, can_submit=false, reason="pending_group_assignment"`. List endpoint surfaces a `latest_status='pending_group_assignment'` value (now 7 statuses).
- **C14 Status pill colorblind signal:** added leading text token (no color-only signal) per UX reviewer (§5).
- **C15 Mid-upload state machine:** explicit `idle | submitting | error | success` states with button/input disable rules + file preservation policy (§6).
- **C16 `aria-live` placement:** dedicated `<div class="sr-only" aria-live="polite">` separate from the visual pill — avoids re-mount suppression (§6).
- **C17 Date fixture mandate:** §8 explicitly requires `NEAR_DEADLINE_ISO` / `FAR_DEADLINE_ISO` from `conftest.py:30-38`. No hardcoded YYYY-MM-DD strings.
- **C18 Disabled group case:** §3.2 `can_submit` ladder now short-circuits with `reason="group_disabled"` before the latest-result check.
- **C19 Concurrent-submission 503 path:** existing `submissions.py:148-171` retries once then returns 503. Frontend handles 503 the same as network error (banner + retry).
- **C20 Alembic path corrected:** `backend/alembic/versions` (not `backend/migrations/versions`).
- **C21 `Block.is_disabled` doesn't exist** in the schema (`models.py`). Removed from open questions.
- **C22 `BlockGroup.svelte.test.ts` doesn't exist yet.** §8 mandates creating it, not "if present".
- **C23 Sanitizer chain documented:** `assignment_html` flows through `nh3.clean()` via `render_markdown` → `render_with_run_assets` (`markdown.py:7-49`, `helpers.py:424-462`, `mini_projects.py:96-101, 180-182`). `{@html}` is safe (§5 trust-boundary note).
- **C24 Run-asset link rewriting:** `assignment_html` already embeds `/api/runs/{run_id}/assets/{filename}` URLs (rewritten by `render_with_run_assets`, `helpers.py:456-462`). Student access to those URLs is gated by `run_assets.py:240-297`. No new endpoint required.
- **C25 Multiple submitters in same group:** history `submitter_is_me` + `submitted_by_full_name` test added. Auto-accepted resubmission test added.
- **C26 Test promote `_make_published_mp`:** existing helper at `test_submissions.py:7-22` is promoted to `conftest.py` as `seed_run_with_published_mp` factory; `test_submissions.py` updated to import.
- **C27 Cross-version block_slug positive test added.**
- **C28 Cross-course positive test added:** student in courses X and Y with separate active runs — list returns only X's MPs.

**Rev 2 → Rev 3:** addressed 4 R2 reviewer concerns (1 backend FAIL, 1 frontend CONCERN x2, 1 test FAIL) + polish.

- **D1 `full_name` fallback inconsistency (backend FAIL):** rev 2 claimed "Mirrors `notifications/templates.py:24-25`" but that uses `u.full_name or u.email` (FULL email). Corrected: rev 3 keeps the email-local-part choice (no domain leakage in student-facing UI) and removes the incorrect `templates.py` citation. Also pins the Pydantic v2 mechanism to **pre-construction composition in the route handler** (build display name via `_display_name(user)` helper, pass into Pydantic constructor) — `@computed_field` rejected because the source `User` object isn't on the response model.
- **D2 `_resolve_student_run` `is_active` divergence from `/my-version`:** rev 2 said the resolver matches `/my-version` 404 semantics but added an `is_active == True` filter that `/my-version` lacks (`student.py:223-234`). Rev 3 documents this as a **deliberate divergence**: inactive enrollments must NOT see MPs (consistent with revocation-on-removal). Comment in §4.1 updated.
- **D3 Frontend double-announcement (frontend CONCERN):** rev 2 had `aria-label="Status: {LABEL}"` on the visual pill PLUS a separate sr-only `aria-live="polite"` region. Both could fire. Rev 3 **drops the pill's `aria-label`** — the visual pill text alone is enough; the sr-only live region is the sole status announcer.
- **D4 `loadCourse` non-abort error on detail page (frontend CONCERN):** rev 2 said breadcrumb stays placeholder if `loadCourse` aborts, but didn't specify behavior for 401/5xx. Rev 3 §6 specifies: detail page swallows DOMException AbortError; on 401 propagates (auth bounce); on 5xx surfaces a non-fatal "Couldn't load course details" toast and leaves breadcrumb as placeholder.
- **D5 `fetchDetail` missing 401/403/404 wire tests (test FAIL):** rev 2 wire tests covered `submit` and `fetchListSwallow403` thoroughly but only "builds correct URL" for `fetchDetail`. Rev 3 §8 adds 4 explicit tests: 401 → `emitUnauthorized`; 403 → ApiError thrown; 404 → ApiError thrown; network → ApiError thrown.
- **D6 `_resolve_student_run` 2+ defensive fallback test:** rev 3 §8 adds a test that seeds 2 active `RunStudent` rows (simulating legacy data), asserts the resolver picks the most-recent-by-start_date AND emits the `logger.warning(...)` (via `caplog`).
- **D7 `assert_student_not_active_elsewhere` self-skip test:** rev 3 §8 adds an explicit test for `publish_run` calling the helper with `exclude_run_id=rid` — the run being published is not counted against itself even if students are already on it (since `is_published==True` doesn't apply yet, the redundancy is defensive).
- **D8 8-codes-but-7-listed typo:** §3.2 corrected to "The 7 codes are:".
- **D9 `StatusPill.svelte` props interface:** rev 3 §5 declares `interface Props { status: LatestStatus }` explicitly.
- **D10 File-pick-during-error transition:** rev 3 §6 state machine table adds row: "User picks new file while in `error` state → stay `error`; new file is staged for next Submit attempt."
- **D11 Frontend date fixture scope:** rev 3 §8 clarifies "frontend test fixtures hardcode ISO strings opaque to UI assertions; backend fixtures use `NEAR_DEADLINE_ISO`/`FAR_DEADLINE_ISO`."
- **D12 `MAX_FILE_SIZE` drift risk:** rev 3 §6 adds an inline comment for the constant: `// Mirrors backend settings.max_file_size; update both together. Backend rejects definitively — this is a UX guard only.`
- **D13 Stale BlockGroup pill after submit:** rev 3 §6 + §7 — detail page WRITES BACK to `currentCourse.value.miniProjectsByBlockId[blockId].latest_status` on submit success. Avoids stale pill on return to course view.
- **D14 `pending_group_assignment` copy softened:** rev 3 §3.2 `REASON_LABELS` → "Your teacher will assign you to a group soon."
- **D15 Late pill positioning:** rev 3 §6 step 4 — Late pill rendered as sibling next to `<h3>` heading, not inside it.
- **D16 Empty block_title fallback:** rev 3 §6 step 1 + §5 — both use "Untitled block" if `block_title` is empty/whitespace.
- **D17 `submission_history=[]` explicit test:** rev 3 §8 adds explicit assertion of empty-list shape.
- **D18 Bulk all-OK + all-conflict tests:** rev 3 §8 adds both cases for `POST /students/bulk`.
- **D19 Test count alignment:** rev 3 §8 header rounded down to "~30 tests" matching the enumeration.
- **D20 `publish_run` "first violation wins" tightening:** rev 3 §3.3 — "Iterate roster; first call that raises `HTTPException(409)` propagates and aborts the publish."
- **D21 publish_run transactional consistency:** rev 3 §3.3 — adds explicit note that the constraint check + `is_published=True` flip share a single SQLAlchemy session (no commits between).
- **D22 BlockGroup test convention explicit:** rev 3 §8 — `BlockGroup.svelte.test.ts` uses mount/unmount/flushSync (mandated, not inferred).
- **D23 visibilitychange "hidden→visible" sequence test:** rev 3 §8 adds an explicit sequence test (not just single visible event).
- **D24 404 not-enrolled on detail endpoint:** rev 3 §8 adds the `404 student not enrolled` test for the detail endpoint (was only on list).
- **D25 `exclude_run_id` redundancy note:** rev 3 §3.3 documents as defense-in-depth for future Postgres `FOR UPDATE` migration; not removed.

**Rev 3 → Rev 4:** addressed codex R2 — 3 Criticals + 4 Importants + 2 Minors that the prior rounds missed (real codebase checks).

- **E1 — Roster 409 error_code shape (codex Critical 1):** rev 3 used `HTTPException(status_code=409, detail={"error_code": ..., "message": ..., "conflicting_run_id": ...})`. FastAPI nests dict-detail under `"detail"`, but `frontend/src/lib/api.ts:46` reads `body.error_code` from the TOP level. The existing `run_unpublished` 409 at `run_roster.py:60-63` already uses the correct pattern: `JSONResponse(status_code=409, content={"detail": "...", "error_code": "..."})`. Rev 4 §3.3 switches to this pattern for all three call sites.
- **E2 — Wrong batch route name (codex Critical 2):** rev 3 said `POST /api/runs/{rid}/students/bulk`. Actual endpoint is `POST /api/runs/{rid}/students/batch` (`run_roster.py:131`). Frontend calls it via `runRoster.ts:31`. Rev 4 §2, §3.3, §8 all corrected to `/students/batch`.
- **E3 — `RunStudentBatchResultRow` is missing `error_code` (codex Critical 3):** existing schema at `schemas.py:478-482` has `email/status/group_id/detail` only. Rev 4 §2 + §3.3 mandate (a) adding `error_code: BulkRosterErrorCode | None = None` to that schema, AND (b) extending `BulkRosterErrorCode` (currently `not_in_run | capacity_reached | internal_error` at `schemas.py:500-504`) with the new literal `student_already_active_in_course`.
- **E4 — `add_student` check ordering (codex Important 1):** rev 3 placed the constraint check AFTER `get_or_create_user`. Existing `run_roster.py:57-72` checks `is_published` (line 59) BEFORE `get_or_create_user` (line 71). Rev 4 §3.3 reorders: constraint check goes immediately AFTER the existing `is_published` check and BEFORE `get_or_create_user` — so users aren't created for rejected adds.
- **E5 — `_resolve_student_run` second-stage version-disabled filter (codex Important 2):** rev 3's `enr_exists` check filters `CourseVersion.is_disabled == False`, but the subsequent `RunStudent → Run → CourseVersion` query does NOT. A stale published run on a disabled version could be picked when the student has another enrollment in the same course. Rev 4 §4.1 adds the same filter to the second SQL.
- **E6 — `can_submit_reason_if_not` type union (codex Important 3):** schema says `str | None`, but frontend `REASON_LABELS[code]` indexing requires a key-typed value. Rev 4 §3.2 changes Pydantic field type to `Literal[...the 7 codes...] | None`, and frontend declares `type CanSubmitReason = keyof typeof REASON_LABELS` for type-safe lookup.
- **E7 — `publish_run` aggregate-conflicts UX (codex Important 4):** rev 3 spec said "first violation wins" — admin would have to publish/fix/retry iteratively. Rev 4 §3.3 changes `publish_run` to iterate the full roster, collect ALL conflicts, and return 409 with `{"detail": "...", "error_code": "student_already_active_in_course", "conflicts": [{"user_id": ..., "email": ..., "conflicting_run_id": ..., "conflicting_run_title": ...}]}`. (The per-row `add_student` and `students/batch` paths remain first-conflict-or-per-row.)
- **E8 — Group rename/reshuffle immutability note (codex R2 verification item 10 FAIL):** rev 4 §4.3 adds: "Historical submission filenames embed the group name at submit-time (`submissions.py:132`, `build_submission_filename`); they are immutable across renames. The detail page renders the CURRENT group name in context and the HISTORICAL filename in the download row — both correct."
- **E9 — Filename explicit test assertion (codex Minor 1):** rev 4 §8 mandates an explicit `submission_history[0].filename == "<expected basename>"` assertion, not just "all fields populated."
- **E10 — Route collision acknowledgment (codex Minor 2):** rev 4 §11 adds a one-line note that `frontend/src/lib/router.svelte.ts:188-201` matches by exact segment count, so the new 4-segment route does not collide with existing routes.

**Rev 4 → Rev 5:** addressed 3 R3 internal reviewer Criticals + 4 Importants + 2 Minors (Backend R3, Frontend+UX R3, Integration R3).

- **F1 — Batch path `error_code` plumbing (Backend R3 + Integration R3 Critical):** rev 4 claimed the existing `except HTTPException` branch at `run_roster.py:180-182` would write `error_code` to the result row. Read actual code: that branch only writes `{email, status, detail}`. Rev 5 §3.3 SHORT-CIRCUITS before the `enroll_user_in_run` call: check `find_student_active_conflicts` per-row, append result row DIRECTLY with `error_code='student_already_active_in_course'`, skip the existing exception path. The existing `except HTTPException` branch is left UNCHANGED — backwards compatible.
- **F2 — Publish-confirm modal implementation surface (Frontend+UX R3 Critical):** rev 4 §3.3 mandated a publish-confirm UX but §2 listed neither a new component nor a `RunDetailPage.svelte` edit. Rev 5 §2 adds `frontend/src/components/runs/PublishConflictsModal.svelte` (new, ~150 lines) and `frontend/src/components/runs/RunDetailPage.svelte` (modified, ~+40 lines) with the modal mount + props. §3.3 + §6 + §8 reference the modal explicitly.
- **F3 — `ApiError` `conflicts` carrier (Integration R3 Critical):** `frontend/src/lib/api.ts:46` currently extracts `body.error_code` and `body.detail` only. The structured `conflicts` array from publish 409 would be discarded. Rev 5 mandates extending `ApiError` with `body: unknown` (parsed JSON body on non-2xx) and updates `api.ts` parse logic accordingly. Frontend consumes via `apiError.body?.conflicts`.
- **F4 — Helper naming alignment (Integration R3 Critical):** rev 4 mentioned `assert_student_not_active_elsewhere` in §2 + §12 + §13 but §3.3 defined `find_student_active_conflicts` + `make_already_active_409_body`. Implementer can't tell which exists. Rev 5: DROP `assert_student_not_active_elsewhere` entirely. The two concrete helpers `find_student_active_conflicts(...) -> list[tuple[int, str]]` and `make_already_active_409_body(conflicts, *, user_email=None) -> dict` are the only API. §12/§13 updated.
- **F5 — `publish_run` 409 detail template (Backend R3 Important):** rev 4 reused `make_already_active_409_body` which anchors detail on `conflicts[0]` — loses info for N-user case. Rev 5 §3.3 specifies a separate template for publish: `f"{N} student(s) cannot be added — they're already active in other runs of this course."` with `make_already_active_409_body` having an optional `summary_override: str | None` param.
- **F6 — Cross-course write-back race (Integration R3 Important):** rev 4 §6 step 6 wrote back to `currentCourse.value.miniProjectsByBlockId[blockId].latest_status` if `currentCourse.value !== null`. But if user navigated to a DIFFERENT course mid-detail, `currentCourse.value` could be the new course's snapshot. Rev 5 §6 adds the slug guard: `if (currentCourse.value?.slug === courseSlug) { ... }`.
- **F7 — `render_with_run_assets` 422 path (Integration R3 Important):** rev 4 §6 enumerated 200/401/403/404 only. If a teacher deletes a referenced `RunAsset` post-publish, the detail endpoint returns 422 (`helpers.py:451-454`). Rev 5 §3.2 adds 422 to the status table; §6 step 7 specifies a page-level banner: "This mini-project references missing assets. Contact your teacher."
- **F8 — External-link policy in `assignment_html` (Integration R3 Important):** `nh3.clean` allows `<a href="https://...">` (teacher-trusted). To mitigate accidental session-hijacking patterns + new-tab UX, rev 5 §5 mandates wrapping the rendered HTML: an extra DOM-walk after `{@html}` mount adds `target="_blank" rel="noopener noreferrer"` to all external `<a>` links. Same-origin links (run-asset URLs starting with `/api/runs/...`) untouched. Documented as defense-in-depth; teachers remain the auth boundary.
- **F9 — `_display_name` policy locked (Integration R3 Suspicious):** rev 4's "reduce email-domain enumeration" justification was post-hoc. Rev 5 keeps email local-part as the fallback with the actual rationale: less screen real estate, less visual noise in group-member lists, consistent with D3 (no peer emails). Documented as the chosen policy, NOT framed as security.
- **F10 — `StudentGroupSummary.is_disabled` exposure (Integration R3 Suspicious):** rev 4 had `can_submit_reason='group_disabled'` but no UI signal on the group block itself. Rev 5 §3.2 adds `is_disabled: bool` to `StudentGroupSummary`. §6 step 3 renders the group block with a `.group-disabled` style + inline notice when `is_disabled=true`.
- **F11 — Helper constant location (Backend R3 Minor):** `STUDENT_ALREADY_ACTIVE_ERROR_CODE` declared in `helpers.py` (consistent with the existing `RUN_UNPUBLISHED_ERROR_CODE` at `run_roster.py:33` — module-level constant near use). Cross-imported into `schemas.py` for `BulkRosterErrorCode` literal. Rev 5 §3.3 spec'd the import path.
- **F12 — `JSONResponse` `response_model` bypass note (Backend R3 Minor):** rev 5 §3.3 adds a one-liner: "FastAPI bypasses `response_model` for explicit `JSONResponse` returns (matches the existing `run_unpublished` precedent at `run_roster.py:60-63`); the 409 path's body shape is enforced by the test suite, not Pydantic."
- **F13 — `data.email.lower()` redundancy (Backend R3 Minor):** Pydantic validator at `schemas.py:457-460` normalizes already. Rev 5 §3.3 spec'd as a footnote — kept defensive but acknowledged.
- **F14 — §12/§13 stale references (Integration R3 Critical):** rev 5 updated self-review and reviewer-notes sections to use new helper names + new file references.
- **F15 — §8 test mis-categorization (Frontend+UX R3 Important):** frontend tests for `RosterImportModal` + publish-confirm modal moved out of the backend `test_run_roster_active_constraint.py` block into the frontend test section. New file `RosterImportModal.svelte.test.ts` added to §2 if not already present.
- **F16 — `fetchListSwallow403` 5xx behavior decision (Integration R3):** rev 5 §7 explicitly states "5xx propagates up to `loadCourse` outer try/catch, surfacing as ApiError in the CourseView page-level error state. This is intentional: 5xx on `/mini-projects` indicates a server bug worth surfacing, not silently hiding." Locks the choice.
- **F17 — `fetchListSwallow403` AbortError note (Integration R3 Minor):** rev 5 §7 adds: "DOMException AbortError propagates naturally; `loadCourse` outer try/catch already handles it (`stores/currentCourse.svelte.ts:63`)."
- **F18 — `Run.start_date` nullability note (Integration R3 Minor):** rev 5 §4.1 documents `Run.start_date` is non-nullable per `models.py:197`, so the `ORDER BY ... DESC` defensive pick has no NULL-sort concern.
- **F19 — `document.visibilityState` jsdom seam (Integration R3 Test Gap):** rev 5 §8 adds an inline note for the visibilitychange test: "Use `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })` to mock the readonly getter in vitest jsdom."
- **F20 — 4th-fetch vs 3-element wording cleanup (Integration R3 Cosmetic):** rev 5 changelog C9 says "3rd parallel fetch added to the existing 2-fetch Promise.la", not "4th".

**Rev 5 → Rev 6:** addressed codex R3 — 1 Critical (helper inconsistency) + 5 Importants + 3 Minors.

- **G1 — F4 incomplete (codex R3 Critical):** §2 still listed deleted `assert_student_not_active_elsewhere`; §3.3 invoked `make_already_active_409_body(..., user_email=...)` but the rev 5 helper signature was `(conflicts, *, summary_override=None)` (no `user_email`). Rev 6 §2 deletes the stale name; §3.3 either uses `summary_override` for the customized message OR builds the detail string at the call site BEFORE calling the helper. Concretely: `add_student` builds its detail string itself, then calls `make_already_active_409_body(conflicts, summary_override=detail)`.
- **G2 — F7 422 detail-endpoint path (codex R3 Important 1):** rev 5 claimed deleted RunAssets surface 422 at read time, but the existing detail serializer reads stored `mp.assignment_html` from DB (`mini_projects.py:50-67`), which was rendered at write time. A deleted asset only surfaces 422 at NEXT WRITE. Rev 6 **DROPS** the 422 case from the student detail endpoint (cleaner than adding re-render on every read). UX consequence: broken image tags in `assignment_html` if a referenced asset was deleted post-publish. Teacher fixes via edit/save flow. Documented as accepted trade-off.
- **G3 — PublishConflictsModal grouping key (codex R3 Important 2):** rev 5 grouping branch keyed on `run_title`. Run titles are not unique. Rev 6 §3.3 + §6 + §8 group by `run_id` (with `run_title` as display).
- **G4 — `ApiError.body` parse-failure (codex R3 Important 3):** rev 5 didn't specify what happens when `await res.json()` throws (HTML error page, truncation). Rev 6 §2: `body` is `undefined` on parse failure; existing callers reading `body?.x` work. Spec'd explicitly.
- **G5 — `rewriteExternalLinks` must rerun on `assignment_html` updates (codex R3 Important 4):** rev 5 said "post-mount DOM walk." That misses refetch updates. Rev 6 §5: implement via Svelte 5 `$effect` that depends on `data.assignment_html` AND the container element ref; runs after each render.
- **G6 — "Rejects before user creation" test contradicts logic (codex R3 Important 5):** rev 5 §8 test: "when target email doesn't exist as a User yet, no User row is created on 409". But if the User doesn't exist, no `RunStudent` exists for them, so no conflict possible → no 409 → test impossible. Rev 6 §8 rewrites to: "409 when target User EXISTS (in another active run) — the existing User row is NOT modified/duplicated. Assert via `db.execute(select(func.count(User.id)).where(User.email == ...))` before and after."
- **G7 — §1 scope still said `/students/bulk` (codex R3 Minor 1):** rev 6 §1 corrected to `/students/batch`.
- **G8 — `student(s)` plural copy (codex R3 Minor 2):** rev 6 §3.3 publish_run summary uses explicit singular/plural: `"1 student cannot be added"` vs `"{N} students cannot be added"`.
- **G9 — 0-conflict PublishConflictsModal test deleted (codex R3 Minor 3):** rev 5 §8 had a defensive test for 0 conflicts. Codex flags it as dead weight (parent component never opens the modal with empty array). Rev 6 §8 drops that test; if needed, parent has a fallback toast for missing/empty `conflicts`.
- **G10 — F20 changelog C9 wording also fixed:** rev 6 updates the rev 1→rev 2 C9 line to "3-element Promise.all" too, for consistency.

**Rev 6 → Rev 7:** addressed codex R4 — 1 Critical (forward-reference NameError) + 3 Importants + 2 Minors.

- **H1 — `BulkRosterErrorCode` forward reference (codex R4 Critical):** rev 6 mandates `RunStudentBatchResultRow.error_code: BulkRosterErrorCode \| None = None` at `schemas.py:478-482`, but `BulkRosterErrorCode = Literal[...]` is defined later at `schemas.py:500-504`. Without `from __future__ import annotations`, this fails at module load with `NameError`. Rev 7 §2 mandates adding the future-annotations import at the top of `schemas.py` (single-line, doesn't churn declaration order). Validation note added: `backend/.venv/bin/python -c "import mathion.schemas"`.
- **H2 — `conflict_dicts` undefined in `add_student` (codex R4 Important 1):** `find_student_active_conflicts()` returns `list[tuple[int, str]]`; `make_already_active_409_body()` expects `list[dict]`. The add_student row in §3.3 referenced `conflict_dicts` without defining it. Rev 7 §3.3 explicitly spells the tuple→dict conversion: `conflict_dicts = [{"run_id": rid_other, "run_title": title} for (rid_other, title) in conflicts]` BEFORE building the detail string.
- **H3 — TS strict on `unknown` (codex R4 Important 2):** `apiError.body?.conflicts` does not compile under the codebase's strict TS + `svelte-check` setup (`tsconfig.json:12`). The `(apiError.body as any)?.conflicts` pattern in rev 6 also bypasses strictness intent. Rev 7 spec'd the proper narrowing: `(apiError.body as { conflicts?: Conflict[] } \| undefined)?.conflicts ?? []`. Applied in both §3.3 frontend surfaces section and the §2 modal description. Field type on `ApiError` stays `unknown` — narrowing happens at access sites only.
- **H4 — Legacy duplicate-RunStudent rows (codex R4 Important 3):** the invariant assumes ≤1 active RunStudent per (course, user), but legacy data may already violate (cleanup is out-of-scope per §11). Rev 7 §3.3 adds a defensive-behavior note: if a single user has 2+ legacy active rows, all conflicts surface; frontend grouping by `run_id` (G3) means the same email may appear in 2 run-groups — this is correct UX (each conflicting run shown), not a duplicate-display bug. No new tests required.
- **H5 — Stale 422 in §6 step 7 (codex R4 Minor 1):** rev 6 dropped the 422 case from §3.2 + §8 but §6 step 7 still said "backend returns 403/404/422". Rev 7 rewrites step 7: 403/404 only, plus a dedicated "asset-deleted mid-session" sub-bullet documenting the broken-image-icon fallback (no banner).
- **H6 — §2 PublishConflictsModal test count mismatch (codex R4 Minor 2 / G9 FAIL):** rev 6 §8 dropped the 0-conflict test (G9) but §2 file list still said `4 tests` including `0 conflicts edge`. Rev 7 §2 corrects to `3 tests` matching §8: 1 conflict (singular), N on same run_id, N across distinct run_ids.

**Rev 7 → Rev 8:** addressed codex R5 — 0 Critical + 4 Importants + 1 Minor.

- **I1 — `Conflict` type undeclared (codex R5 Important 1):** rev 7 narrowing/modal references `Conflict[]` but `frontend/src/lib/types.ts:324-338` has no such type. Rev 8 §2 mandates adding `export type PublishConflict = { user_id: number; email: string; run_id: number; run_title: string }` to `types.ts`. All spec references updated: `Conflict[]` → `PublishConflict[]` in §3.3 ApiError narrowing + PublishConflictsModal section + §2 modal-file entry.
- **I2 — `types.ts` mirror incomplete for batch error_code (codex R5 Important 2):** backend Pydantic mirror at `schemas.py` gets extended (H1) but rev 7 §2 didn't say to update `frontend/src/lib/types.ts:326-336` (`RunStudentBatchResultRow` is missing `error_code` field; `BulkRosterErrorCode` union missing `student_already_active_in_course`). Without this, `svelte-check` blocks. Rev 8 §2 spells the mirror update explicitly.
- **I3 — Add-student conflict shape mismatched §8 test (codex R5 Important 3):** rev 7 H2 conversion was `[{"run_id", "run_title"}]` only, but §8 test at line 826 asserts `{user_id, email, run_id, run_title}` for the POST /students 409 body. Rev 8 §3.3 makes the add_student `conflict_dicts` shape UNIFORM with publish_run aggregate: `[{"user_id", "email", "run_id", "run_title"}]`. This also keeps the frontend `PublishConflict` type universal across all 409 paths.
- **I4 — Legacy duplicate count/heading inconsistency (codex R5 Important 4):** backend `publish_run` summary detail dedupes by `user_id` (G8: `n = len({c['user_id'] for c in aggregate})`), but the rev 7 modal heading copied raw `{N}` from `conflicts.length`. A legacy student with 2 active rows would render as "2 students can't be added" with the same email twice. Rev 8 §3.3 modal copy uses `studentCount = new Set(conflicts.map(c => c.user_id)).size` for headings, mirroring backend dedupe. §8 adds an explicit legacy-duplicate-user test (2 conflicts same `user_id`, different `run_id` → heading "1 student"). §2 modal test count → 4 tests.
- **I5 — Validation hint cwd-sensitive (codex R5 Minor 1):** rev 7 H1 hint `backend/.venv/bin/python -c "import mathion.schemas"` doesn't resolve `mathion` from repo root. Rev 8 fixes to `cd backend && .venv/bin/python -c "import mathion.schemas"` (or `PYTHONPATH=backend ...`).

**Rev 8 → Rev 9:** addressed codex R6 — 0 Critical + 1 Important + 1 Minor.

- **J1 — Stale §2 ApiError.body wording (codex R6 Important 1):** rev 8 §3.3 documented the strict-TS narrowing pattern correctly, but §2's file-list entries for `RunDetailPage.svelte` (~line 194) and `api.ts` (~line 196) still said `apiError.body.conflicts` / `apiError.body?.conflicts` (direct property access on `unknown`). Either would fail `svelte-check` under `tsconfig.json:12` strict. Rev 9 §2 rewrites both to the canonical narrowing and cross-references §3.3 as the single source of truth.
- **J2 — Empty-conflicts modal open-guard contradiction (codex R6 Minor 1):** rev 8 §3.3 modal section said `?? []` (defaulting to `[]` then rendering modal); G9 + §8 said "parent never opens modal with empty conflicts" + "no 0-conflict test." Contradictory: a malformed response (`apiError.body` undefined or `conflicts` missing) would default to `[]` and open the modal anyway. Rev 9 §3.3 + §2 RunDetailPage entry add an explicit open guard: `if (conflicts.length === 0) { pushToast(e.displayMessage); return; }` — preserves G9, no defensive 0-conflict modal render path needed.

**Rev 9 → Rev 10:** addressed codex R7 — 0 Critical + 1 Important (real) + 1 Minor.

- **K2 — Stale §2 modal-entry wording (codex R7 Important 2):** rev 9 §2 modal file-list entry (line 185) still said the modal "renders the publish-conflict list from `ApiError.body.conflicts`", implying the modal itself reads `ApiError`. Per §3.3 (canonical), the parent (`RunDetailPage.doPublish`) does ALL `ApiError` narrowing and passes an already-typed `conflicts: PublishConflict[]` prop. Rev 10 §2 modal entry rewritten: modal has NO `ApiError` import, NO body parsing, NO empty-state branch (parent's J2 guard prevents `conflicts.length === 0` mounts). Single responsibility = grouped-render UI.
- **K3 — `pushToast` kind missing (codex R7 Minor 1):** rev 9 J2 fallback used `pushToast(e.displayMessage)` which defaults to `'info'` (`toasts.svelte.ts:9`); the existing `doPublish` error path uses `pushToast(e.displayMessage, 'error')` at `RunDetailPage.svelte:252`. Rev 10 §2 + §3.3 fallback both explicitly use `'error'` kind, matching the existing pattern. Otherwise the 409 would render as a neutral info toast.
- **K1 false positive note (codex R7 Important 1):** R7 prompt asked codex to verify "§8 has only 3 frontend tests" — that target was stale from R6 (rev 8 I4 added a 4th test for legacy-duplicate-user dedupe). §2 + §8 both correctly say 4 tests; the contradiction codex flagged was in the R7 prompt, not the spec. No spec change.

**Rev 10 → Rev 11:** addressed R4 internal review (3 parallel Opus reviewers: backend + frontend + integration) — 0 Critical + 4 real Importants (rest were doc-clarity gaps documented inline).

- **L1 — `bind:this` placement for `rewriteExternalLinks` $effect (Frontend R4 Important 1):** rev 10 §5 G5 said the effect depends on `data.assignment_html` + container ref but didn't constrain WHERE the `bind:this` div lives. If implementer puts `bind:this` on an outer layout wrapper, the effect's dep tracking still works but reasoning about timing gets harder. Rev 11 §5 adds explicit constraint: `bind:this={assignmentEl}` MUST be on the SAME `<div>` whose content is `{@html data.assignment_html}` — no intermediate wrapper. Also locks the effect implementation: `$effect(() => { if (!assignmentEl) return; data.assignment_html; rewriteExternalLinks(assignmentEl); })` (bare `data.assignment_html` read tracks dep) + `data-testid="assignment-html"` for test seam.
- **L2 — `add_student` constraint-check order vs. existing group_id validation (Backend R4 Important 1):** rev 10 §3.3 said "After is_published check, BEFORE get_or_create_user" but was silent on order vs. existing `group_id` validation at `run_roster.py:64-69` (400 on bad group / 409 on disabled group). Rev 11 §3.3 locks order: input-validation 400 takes precedence over business 409, so new check runs AFTER `run_roster.py:64-69`. Matches existing FastAPI 422 → 400 → 409 convention.
- **L3 — `publish_run` student-row fetch query (Backend R4 Important 2):** rev 10 §3.3 publish_run row said "Iterate ALL RunStudent.run_id == rid users" and accumulate `{user_id, email, run_id, run_title}` — but `publish_run` (`runs.py:172-219`) never loads students. Implementer would have to guess the query. Rev 11 §3.3 spells the query: `student_rows = db.execute(select(RunStudent.user_id, User.email).join(User, User.id == RunStudent.user_id).where(RunStudent.run_id == rid)).all()`. Also folds in Backend R4 Minor 1 (resolve `course_id = run.version.course_id` ONCE before loop to avoid per-call lazy SELECT).
- **L4 — `enroll_user_in_run` side-effect enumeration (Integration R4 Important 2):** rev 10 §3.3 said "User is NOT created on rejected adds" but didn't enumerate the OTHER side effects (notification log row, StudentEnrollment activation, RunStudent insert). Rev 11 §3.3 adds explicit "Side-effects bypassed on 409" block enumerating: `_enroll_user` StudentEnrollment activation, `NotificationLogEntry(kind='run_enrolled')` write (from notifications-email predecessor), `enrollment.last_active_at`/`RunStudent` writes. Future reviewers comparing against the notifications surface won't assume the `run_enrolled` notification fires for rejected adds.
- **Clarity notes documented but not separately versioned:** the remaining R4 findings (Frontend Imp 2 — `ApiError(0,...)` non-HTTP throws never set `body` is correct behavior per §2 J1 / J2 fallback; Frontend Imp 3 — K3 fallback loses structured signal is acknowledged UX gap; Integration Imp 1 — add-student email source canonicalization is implementation-detail; Integration Imp 3 — student-side endpoint role-gating matches `/my-version` pattern; backend N+1 helper hint baked into L3) are accepted as implementation-time clarifications, not spec changes.

**Rev 11 → Rev 12:** addressed codex R8 — 0 Critical + 3 Importants + 4 Minors.

- **M1 — L1 `data-testid="assignment-html"` not referenced by §6 markup or §8 tests (codex R8 L1 CONCERN):** rev 11 §5 added the testid mandate but §6 step 2 still showed bare `<div class="assignment">{@html ...}</div>` without `bind:this` / testid, and §8 had no test using the seam. Rev 12 §6 step 2 updated to `<div class="assignment-html" data-testid="assignment-html" bind:this={assignmentEl}>{@html data.assignment_html}</div>` plus inline effect wiring. §8 adds two external-link rewrite tests using the testid seam (initial mount + refetch re-run).
- **M2 — L4 stale `enrollment.last_active_at` reference (codex R8 L4 CONCERN):** no such field exists on `StudentEnrollment` (`models_auth.py:49-61` has only id/user_id/version_id/is_active/created_at; `last_active_at` lives on `Session` per `models_auth.py:31`). Rev 12 §3.3 L4 block removes the stale reference, replaces with `RunStudent` row insert (the actual write that gets bypassed), and adds an explicit M2 note documenting the correction.
- **M3 — `find_student_active_conflicts` helper signature ambiguity (codex R8 Important 1):** rev 11 helper definition took `run: Run` and computed `course_id = run.version.course_id` internally, while callers were told to resolve `course_id` once before the loop. Two signatures contradict. Rev 12 locks ONE signature: `find_student_active_conflicts(db, user_id, *, course_id, exclude_run_id)` — both `course_id` and `exclude_run_id` required kwargs. Callers always resolve `course_id = run.version.course_id` ONCE and pass it in. Symmetric: avoids N+1 in publish_run loop, eliminates the "Run vs course_id" choice for the implementer.
- **M4 — `rid` vs `run_id` parameter name in publish_run query (codex R8 Important 2):** rev 11 query used `rid` but `publish_run` parameter is `run_id` per `runs.py:172`. Rev 12 §3.3 publish_run row uses `run_id` consistently.
- **M5 — Batch-path insertion point insufficiently precise (codex R8 Important 3):** rev 11 said "after `get_or_create_user`, BEFORE `enroll_user_in_run`" but the existing batch code mutates `target.full_name` AND creates `Group` rows between those two calls (`run_roster.py:160-177`). Without specificity, an implementer might do the conflict check AFTER the name mutation and orphan-Group creation — exactly the side effects L4 promises to bypass on 409. Rev 12 §3.3 batch row locks: check goes IMMEDIATELY after `get_or_create_user(...)`, BEFORE name mutation / Group creation / enroll call. L4 §3.3 block also updated to enumerate the batch-specific bypasses (full_name + Group).
- **M6 — Incorrect "FastAPI 422 → 400 → 409 convention" claim (codex R8 Minor 2):** rev 11 §3.3 add_student row claimed the order matched a codebase-wide convention. Counter-examples exist: `mini_projects.py:79-84` raises 409 (`groups_enabled`) before block-version 400; `submissions.py:69-112` raises 409 preconditions before file 400s. Rev 12 §3.3 weakens the wording: order is locked for THIS slice only, no codebase-wide rule claimed. Cites the counter-examples explicitly.
- **M7 — `void` idiom for `$effect` dep-tracking (codex R8 Minor 3):** rev 11 used bare `data.assignment_html;` as a dep-tracking expression. Local convention (`ItemEditPage.svelte:238`) is `void <expr>;`. Rev 12 §5 + §6 step 2 both use `void data.assignment_html;` instead.
- **Minor 4 (table row density) is cosmetic — no fix.** §3.3 publish_run row is dense but readable; splitting into a sub-table would lose the at-a-glance scan. Documented as accepted.

**Rev 12 → Rev 13:** addressed codex R9 — 0 Critical + 3 Importants + 1 Minor.

- **N1 — §2 helper signature stale (codex R9 Important 1):** rev 12 §3.3 locked the helper to `find_student_active_conflicts(db, user_id, *, course_id, exclude_run_id)` but §2 file list at `helpers.py` line still showed the old `(db, user_id, run, *, exclude_run_id=None)` signature. Implementers reading §2 first would code the wrong API. Rev 13 §2 helper line updated to the locked signature, with the M3 note inline.
- **N2 — Helper imports incomplete (codex R9 Important 2):** rev 12 helper docstring said "Imports needed: `CourseVersion`" but the body uses `RunStudent`, `Run`, AND `CourseVersion`; `helpers.py:1-9` has none of those. Rev 13 docstring lists the full set: `from sqlalchemy import select` (if not already imported), `from mathion.models import RunStudent, Run, CourseVersion`. Also clarifies `User` is needed only at the publish_run CALL SITE (for the JOINed student-row fetch), not in the helper.
- **N3 — Refetch external-link test seam unspecified (codex R9 Important 3):** rev 12 said "swap `data.assignment_html`" but `data` is page-internal `$state` set from `fetchDetail`, not a prop — parent test can't mutate it. Rev 13 §8 specifies using the existing visibilitychange refetch path as the seam: mock `fetchDetail` twice (initial + new), dispatch visibilitychange with F19 jsdom `Object.defineProperty` mock, flushSync, assert new links rewritten. Exercises real refetch path + `$effect` re-run trigger in one test — no test-only `__test__setData` seam needed.
- **N4 — `assignmentEl` declaration not explicit (codex R9 Minor 1):** rev 12 §6 step 2 used `bind:this={assignmentEl}` but never said where to declare `assignmentEl`. Rev 13 §6 step 2 adds the script-block declaration `let assignmentEl: HTMLDivElement | undefined = $state();` (matches `FocusTrap.svelte:14` precedent).

**Rev 13 → Rev 14:** addressed codex R10 — 0 Critical + 2 Importants + 3 Minors.

- **P1 — `User` import contradiction in §2 (codex R10 Important 1):** rev 13 §2 helpers entry told implementers to add `from mathion.models_auth import User` to `helpers.py`, but §3.3 helper docstring said `User` is needed only at the publish_run call site. Rev 14 §2 + §3.3 docstring both consistently exclude `User` from `helpers.py` imports (only Run+RunStudent+CourseVersion). Also corrected: `from sqlalchemy import select` is ALREADY at `helpers.py:7` (no add needed) — earlier "if not already imported" hedge replaced with the verified fact.
- **P2 — Single-flight guard test interaction (codex R10 Important 2):** rev 13 N3 test sequence (mount → visibilitychange dispatch → assert) could race with the in-flight initial `fetchDetail`. The §6 step 6 single-flight guard skips refetch if a fetch is in-flight, so the visibilitychange dispatch could be silently dropped. Rev 14 §8 inserts explicit step 2: `await` initial `fetchDetail` AND `flushSync()` BEFORE dispatching visibilitychange (assert initial state THEN swap the mock).
- **P3 — Wrong `$state()` precedent cite (codex R10 Minor 1):** rev 13 cited `FocusTrap.svelte:14` for `let x = $state()`, but that file uses plain `let x: T | undefined;` (no `$state()` call). Correct precedent for `$state()`-with-no-arg is `RunTeachersTab.svelte:20`. Rev 14 §6 step 2 cites the correct file; also notes that the plain-`let` form is ALSO valid for `bind:this` in Svelte 5 (binding updates the var directly) — the `$state()` form is preferred only because it makes the reactivity explicit.
- **P4 — `focus`-event vs `visibilitychange` wording inconsistency (codex R10 Minor 2):** rev 13 §3.2 still said "Mitigated by `focus`-event refetch (§6)" while §6 + §8 use `visibilitychange` on `document.visibilityState === 'visible'`. Rev 14 §3.2 corrected to `visibilitychange`-event refetch with cross-reference to §6 step 6.
- **Status pill verification (codex R10 Minor 3):** PASS — §5 StatusPill covers all 7 `latest_status` values + has color-blind leading text token per C14. No spec change.

---

## 1. Scope

Add the **student-side** surface for mini-projects, inside the existing course view, plus enforce a **roster invariant**:

> A student has at most ONE active `RunStudent` row across all published runs of the same course.
> (A student CAN be on multiple active StudentEnrollments across different courses.)

**Student-side surface:**

1. **Block link** — at the end of each block's sequence list in `CourseView` → `BlockGroup`, render a `MiniProjectLink` `<li>` iff the block has a published MP on the student's active run. The link shows title + status pill.
2. **Detail page** — `/courses/<slug>/blocks/<blockSlug>/mini-project`, rendering: assignment HTML, group context (or pending-group state), submission history (DESC), and submit/resubmit section gated by `can_submit_reason_if_not`.

**Constraint enforcement (new in rev 2):**

3. `POST /api/runs/{rid}/students` rejects 409 if the user already has an active `RunStudent` on another published run of the same course.
4. `POST /api/runs/{rid}/students/batch` (NOT `/bulk` — actual route name per `run_roster.py:131`) rejects per-row with the same check.
5. `POST /api/runs/{rid}/publish` rejects 409 if any roster student is already on another published run of the same course.

**Backend reuse (rev 1 → rev 2 correction):** Existing student-side endpoints (POST submissions, GET file, GET feedback-file, etc.) are unchanged. They already enforce `mini_project_visible_to_student(run, mp)` + `get_submitter_group(db, run_id, user_id)`. The two NEW endpoints synthesize data for the discovery + detail UIs.

No model changes. No migration. The `RunStudent` unique constraint already at `(run_id, user_id)` (`models.py:245`) is sufficient — the new invariant is enforced at the application layer in three write paths, not at DB level.

## 2. Files touched

**Backend — new:**
- `backend/mathion/api/student_mini_projects.py` (~200 lines) — `GET /api/courses/{slug}/mini-projects` + `GET /api/courses/{slug}/blocks/{block_slug}/mini-project` + resolver helper.
- `backend/tests/test_student_mini_projects.py` (~600 lines, ~35 tests).
- `backend/tests/test_run_roster_active_constraint.py` (~200 lines, ~10 tests) — covers constraint enforcement on add/bulk/publish.

**Backend — modified:**
- `backend/mathion/main.py` (+1 line) — include the new router.
- `backend/mathion/schemas.py` (~+85 lines) — `StudentMiniProjectListItem`, `StudentMiniProjectDetail`, `StudentGroupMember`, `StudentGroupSummary`, `StudentSubmissionHistoryEntry`, `StudentSubmissionHistoryEvaluation`, **plus extending `BulkRosterErrorCode` (currently `not_in_run | capacity_reached | internal_error` at `schemas.py:500-504`) with the new literal `student_already_active_in_course`, AND adding `error_code: BulkRosterErrorCode | None = None` to `RunStudentBatchResultRow` (`schemas.py:478-482`).** **H1 — declaration order:** `RunStudentBatchResultRow` at line 478 references `BulkRosterErrorCode` (defined at 500-504), which is a forward reference at module-load time. Fix EITHER by (a) moving the `BulkRosterErrorCode = Literal[...]` alias ABOVE `RunStudentBatchResultRow`, OR (b) adding `from __future__ import annotations` at the top of `schemas.py` (preferred — single-line, doesn't churn unrelated lines). Pick (b). Implementer note (I5): after adding the import, run `cd backend && .venv/bin/python -c "import mathion.schemas"` (cwd MUST be `backend/` so `mathion` resolves on `sys.path`; alternative: `PYTHONPATH=backend backend/.venv/bin/python -c "import mathion.schemas"` from repo root). Should print nothing → no `NameError`.
- `backend/mathion/api/run_roster.py` (~+50 lines) — constraint check inserted at two call sites: `add_student` (single) AND `add_students_batch` (existing endpoint at `run_roster.py:131`, route is `/students/batch`, NOT `/students/bulk`). 409 surface uses `JSONResponse(status_code=409, content={"detail": "...", "error_code": "student_already_active_in_course", ...})` — matches the existing `run_unpublished` pattern at `run_roster.py:60-63`, NOT nested `HTTPException(detail={...})`.
- `backend/mathion/api/runs.py` (~+20 lines) — same check in `publish_run` (before flipping `is_published=True`).
- `backend/mathion/api/helpers.py` (~+50 lines) — new helpers `find_student_active_conflicts(db, user_id, *, course_id: int, exclude_run_id: int) -> list[tuple[int, str]]` (M3 — both kwargs REQUIRED; callers resolve `course_id = run.version.course_id` once and pass it) and `make_already_active_409_body(conflicts: list[dict], *, summary_override: str | None = None) -> dict`. Plus module-level constant `STUDENT_ALREADY_ACTIVE_ERROR_CODE = "student_already_active_in_course"`. (G1: NO `assert_student_not_active_elsewhere` exists; rev 4 mentioned one but rev 5 removed it. The two concrete helpers above are the only API.) **N2+P1 — new imports required in `helpers.py`** (currently lacks the model imports per `helpers.py:1-9`; `from sqlalchemy import select` is ALREADY imported at `helpers.py:7` so no add needed): `from mathion.models import RunStudent, Run, CourseVersion`. `User` is NOT imported into `helpers.py` — it's needed only at the `publish_run` call site (in `runs.py`) for the JOINed student-row fetch query. The helper itself only joins Run+CourseVersion via RunStudent.
- `backend/tests/conftest.py` (~+30 lines) — promote `_make_published_mp` from `test_submissions.py` as `seed_run_with_published_mp` factory.
- `backend/tests/test_submissions.py` — import promoted helper, delete local copy.

**Frontend — new:**
- `frontend/src/lib/studentMiniProjects.ts` (~180 lines) — wire module + types + `fetchListSwallow403` + `fetchDetail` + `submit` + `rewriteExternalLinks` helper (F8).
- `frontend/src/components/course/MiniProjectLink.svelte` (~80 lines) — `<li>` with title + status pill + href.
- `frontend/src/components/course/StatusPill.svelte` (~50 lines) — shared pill component used by both link and detail page (single source of truth for label + class + glyph).
- `frontend/src/components/runs/PublishConflictsModal.svelte` (~150 lines, NEW, F2, I1, K2) — admin-facing modal. **The modal does NOT read `ApiError` itself** — it receives an already-narrowed `conflicts: PublishConflict[]` array from its parent (`RunDetailPage.doPublish`, see §3.3 for the canonical narrowing pattern). Props: `{ open: boolean; conflicts: PublishConflict[]; onClose: () => void }` (`PublishConflict` is the type added to `types.ts`). The component renders only the grouped UI defined in §3.3 modal copy; it has no `ApiError` import, no body-parsing logic, and no empty-state branch (parent's J2 open guard prevents `conflicts.length === 0` mounts).
- `frontend/src/pages/MiniProjectDetailPage.svelte` (~520 lines) — detail page.
- `frontend/src/tests/MiniProjectLink.svelte.test.ts` (~100 lines, 5 tests).
- `frontend/src/tests/MiniProjectDetailPage.svelte.test.ts` (~600 lines, ~20 tests).
- `frontend/src/tests/studentMiniProjects.test.ts` (~180 lines, 12 tests).
- `frontend/src/tests/BlockGroup.svelte.test.ts` (~120 lines, 5 tests) — new file (does not exist).
- `frontend/src/tests/PublishConflictsModal.svelte.test.ts` (~120 lines, 4 tests, F2, G9, I4) — 1 conflict (singular copy), 3 conflicts on same `run_id`, 3 conflicts across 2 distinct `run_id`s, legacy-duplicate-user dedupe (I4 — 2 conflicts same `user_id` different `run_id` → heading "1 student"). (G9: 0-conflict test removed — parent never opens modal with empty `conflicts`.)
- `frontend/src/tests/RosterImportModal.svelte.test.ts` (NEW if not present; ~+60 lines if present — extends existing for new error code branch).

**Frontend — modified:**
- `frontend/src/App.svelte` (+2 lines) — register `MiniProjectDetailPage` in `componentMap`.
- `frontend/src/routes.ts` (~+5 lines) — add `/courses/:courseSlug/blocks/:blockSlug/mini-project` → `MiniProjectDetailPage` with `auth: true`.
- `frontend/src/components/course/BlockGroup.svelte` (~+25 lines) — new optional `mpByBlockId` prop; render `MiniProjectLink` `<li>` after sequences when block has an entry.
- `frontend/src/pages/CourseView.svelte` (~+5 lines) — pass `mpByBlockId` from `currentCourse.value.miniProjectsByBlockId` down to `BlockGroup`.
- `frontend/src/pages/runs/RunDetailPage.svelte` (~+40 lines, F2, J1, K3) — replace `doPublish`'s direct `pushToast(e.displayMessage, 'error')` (existing pattern at `RunDetailPage.svelte:252`) with: if `apiError.errorCode === 'student_already_active_in_course'` narrow the body inline (`const conflicts = (apiError.body as { conflicts?: PublishConflict[] } | undefined)?.conflicts ?? []`), then show `<PublishConflictsModal open={conflicts.length > 0} conflicts={conflicts} ... />` (J2 — empty-array fallback: if narrowing yields `[]`, fall back to `pushToast(e.displayMessage, 'error')` and do NOT open the modal — preserves G9 "parent never opens modal with empty conflicts" invariant; K3 — `'error'` kind matches the existing `doPublish` error-path call, not the default `'info'`); else toast as before. See §3.3 for the canonical narrowing pattern.
- `frontend/src/stores/currentCourse.svelte.ts` (~+30 lines) — add `miniProjectsByBlockId` to snapshot; load alongside content + state via `Promise.all`; uses `fetchListSwallow403` so 403 → `{}`, never aborts content/state.
- `frontend/src/lib/api.ts` (~+10 lines, F3, J1) — extend `ApiError` with `public readonly body?: unknown`; populate on non-2xx from `await res.json()` (G4 — `undefined` on parse failure). Callers narrow via the strict-TS pattern documented in §3.3 (`(apiError.body as { conflicts?: PublishConflict[] } | undefined)?.conflicts ?? []`) — do NOT use `apiError.body?.conflicts` directly (fails `svelte-check` under `tsconfig.json:12` strict).
- `frontend/src/lib/types.ts` (~+55 lines, I1+I2) — student MP types (mirroring `StudentMiniProjectListItem`, `StudentMiniProjectDetail`, `StudentGroupSummary`, `StudentGroupMember`, `StudentSubmissionHistoryEntry`, `StudentSubmissionHistoryEvaluation`, `CanSubmitReason`); **I1 — new exported type `PublishConflict = { user_id: number; email: string; run_id: number; run_title: string }`** (used by `PublishConflictsModal` props and the `apiError.body` narrowing in §3.3); **I2 — extending `BulkRosterErrorCode` union with `'student_already_active_in_course'` AND adding `error_code?: BulkRosterErrorCode | null` to existing `RunStudentBatchResultRow` (mirrors the backend Pydantic change at `schemas.py:478-482`, current TS file at `types.ts:326-336`).** Without these mirror updates, the existing `RosterImportModal` typed handler + new batch-error-row tests would fail `svelte-check`.

**No changes** (still): `submissions.py`, `evaluations.py`, all existing student-gated endpoints, all auth helpers, all models, all migrations.

## 3. Backend contracts

### 3.1 `GET /api/courses/{slug}/mini-projects` → `list[StudentMiniProjectListItem]`

Resolves the student's active run for this course (§4.1), returns one row per published MP, sorted by `block.order ASC`.

**Auth:** logged-in user (`get_current_user`). Same body as §4.1 resolver.

**Status codes:**
| Code | Trigger |
| --- | --- |
| 200 | success (may be empty list) |
| 401 | no session |
| 403 | course exists, user is enrolled in version, but no active published run with the user as `RunStudent` |
| 404 | course slug doesn't exist OR user has no `StudentEnrollment` on any version of this course |

**Response shape:**
```python
class StudentMiniProjectListItem(BaseModel):
    mp_id: int
    block_id: int
    block_slug: str
    block_order: int
    block_title: str
    hard_deadline: datetime | None
    soft_deadline: datetime | None
    resubmission_deadline: datetime | None
    latest_status: Literal[
        'pending_group_assignment',  # student has no group_id on this run
        'not_submitted',             # has group, no submission yet
        'awaiting_evaluation',       # submission exists, no eval
        'rejected',
        'major_revision',
        'minor_revision',
        'accepted',
    ]
```

**`latest_status` derivation:**
1. If `get_submitter_group(...)` is None → `'pending_group_assignment'`.
2. Else look up latest submission for `(mp_id, group_id)`:
   - No submissions → `'not_submitted'`
   - Latest submission has no `Evaluation` → `'awaiting_evaluation'`
   - Latest submission has eval → use `eval.result` directly (`rejected | major_revision | minor_revision | accepted`)

### 3.2 `GET /api/courses/{slug}/blocks/{block_slug}/mini-project` → `StudentMiniProjectDetail`

Synthesizes everything the detail page needs in one round-trip.

**Auth:** same as 3.1, plus the block must belong to the resolved run's version (§4.2), plus the MP must exist on `(run, block)` with `is_published=True`.

**Status codes:**
| Code | Trigger |
| --- | --- |
| 200 | success — INCLUDING the ungrouped case (`group=null`) |
| 401 | no session |
| 403 | resolver fails (no active run, etc.) |
| 404 | block slug doesn't exist on run's version OR MP doesn't exist on (run, block) OR MP not published |

**G2 — Deleted-RunAsset note:** the existing detail serializer reads stored `mp.assignment_html` (`mini_projects.py:50-67`), rendered at write time. If a teacher deletes a referenced asset post-publish, the student detail endpoint does NOT 422 — they see broken image tags in the HTML. Surfacing 422 here would require re-rendering on every read (`render_with_run_assets(db, run_id, mp.assignment_md)` per request), a non-trivial per-request cost for an edge case. **DROPPED from this slice.** Teacher fix path: edit/save the MP → render rejects → teacher fixes. Documented as accepted trade-off.

**Response shape:**
```python
class StudentGroupMember(BaseModel):
    user_id: int
    full_name: str  # see fallback rule below — NEVER null
    is_me: bool

class StudentGroupSummary(BaseModel):
    id: int
    name: str
    is_disabled: bool  # F10: surfaces Group.is_disabled so UI can render group block with visual cue
    members: list[StudentGroupMember]

class StudentSubmissionHistoryEvaluation(BaseModel):
    eval_id: int
    result: Literal['rejected', 'major_revision', 'minor_revision', 'accepted']
    score: int | None
    feedback_text: str | None
    has_feedback_file: bool
    evaluated_by_full_name: str  # fallback rule below
    evaluated_at: datetime

class StudentSubmissionHistoryEntry(BaseModel):
    submission_id: int
    submission_number: int
    filename: str  # safe basename of Submission.file_path
    submitted_by_full_name: str  # fallback rule below
    submitter_is_me: bool
    submitted_at: datetime
    file_size: int
    is_late: bool
    is_resubmission: bool
    evaluation: StudentSubmissionHistoryEvaluation | None

class StudentMiniProjectDetail(BaseModel):
    mp_id: int
    run_id: int
    block_id: int
    block_slug: str
    block_title: str
    assignment_html: str
    soft_deadline: datetime | None
    hard_deadline: datetime | None
    resubmission_deadline: datetime | None
    group: StudentGroupSummary | None  # None when student has no group_id (pending assignment); is_disabled field on summary (F10)
    submission_history: list[StudentSubmissionHistoryEntry]  # DESC by submission_number (newest first)
    latest_status: Literal[
        'pending_group_assignment', 'not_submitted', 'awaiting_evaluation',
        'rejected', 'major_revision', 'minor_revision', 'accepted',
    ]
    can_submit: bool
    can_submit_reason_if_not: Literal[
        'mp_not_visible', 'pending_group_assignment', 'group_disabled',
        'already_accepted', 'awaiting_evaluation',
        'hard_deadline_passed', 'resubmission_deadline_passed',
    ] | None  # null only when can_submit=true; typed union for client key-safety
```

**`full_name` fallback rule:** schema fields declare `str` (non-nullable). The endpoint MUST compose the display name BEFORE constructing the Pydantic instance — `@computed_field` is rejected because the source `User` object isn't on the response model. Helper:

```python
def _display_name(user: User) -> str:
    """Return user-facing display name. Falls back to email LOCAL-PART if
    full_name is unset. Rationale (F9): less screen real estate + visual noise
    in group-member lists than the full email; consistent with D3 (no peer
    emails). NOT a security control — chosen for UX clarity, not domain hiding.
    user.email is already lowercased by Pydantic validator (schemas.py:457-460),
    so split('@')[0] returns 'john.smith' (not 'John.Smith'). This is deliberate."""
    name = (user.full_name or "").strip()
    if name:
        return name
    return user.email.split('@')[0]
```

Used uniformly for all `_full_name` fields in `StudentGroupMember`, `StudentSubmissionHistoryEntry`, `StudentSubmissionHistoryEvaluation`.

**`can_submit` 7-step ladder** (mirrors POST enforcement at `submissions.py:53-104` exactly; ORDER MATTERS):

```
1. If not mini_project_visible_to_student(run, mp):
       can_submit=False, reason="mp_not_visible"   # only possible mid-session: run/mp unpublished after detail load
2. If group is None (no group_id):
       can_submit=False, reason="pending_group_assignment"
3. If group.is_disabled:
       can_submit=False, reason="group_disabled"
4. Let (latest_result, prior_evaluator) = _latest_evaluation_result(...)
   If latest_result == 'accepted':
       can_submit=False, reason="already_accepted"
5. If latest_result is None and a prior submission exists:
       can_submit=False, reason="awaiting_evaluation"
6. If latest_result in (None, 'rejected'):    # initial submission path
       If mp.hard_deadline and now > mp.hard_deadline:
           can_submit=False, reason="hard_deadline_passed"
       else:
           can_submit=True, reason=None
7. If latest_result in ('major_revision', 'minor_revision'):  # resubmission path
       If mp.resubmission_deadline and now > mp.resubmission_deadline:
           can_submit=False, reason="resubmission_deadline_passed"
       else:
           can_submit=True, reason=None
```

**`can_submit_reason_if_not` is a STABLE CODE STRING, not a human label.** Frontend maps codes → localized strings (today: English; tomorrow: i18n table). The 7 codes are: `mp_not_visible`, `pending_group_assignment`, `group_disabled`, `already_accepted`, `awaiting_evaluation`, `hard_deadline_passed`, `resubmission_deadline_passed`. **No free-text reasons** — locked policy.

Frontend label map (single source of truth in `studentMiniProjects.ts`):

```ts
export type CanSubmitReason = keyof typeof REASON_LABELS;

export const REASON_LABELS = {
  mp_not_visible: 'This mini-project is no longer available.',
  pending_group_assignment: "Your teacher will assign you to a group soon. You'll be able to submit then.",
  group_disabled: 'Your group is disabled. Contact your teacher.',
  already_accepted: 'Your project has been accepted — no further submission needed.',
  awaiting_evaluation: 'Your previous submission is awaiting evaluation.',
  hard_deadline_passed: 'The submission deadline has passed.',
  resubmission_deadline_passed: 'The resubmission deadline has passed.',
} as const;
```

**Read ordering inside detail endpoint** (avoids partial-update race):
1. Resolve run (§4.1).
2. Resolve block (§4.2). Lock in `block_id`.
3. Load MP, check `mini_project_visible_to_student`. 404 if not.
4. Resolve group via `get_submitter_group`. May be None.
5. If group: load group members; load submissions ordered by `submission_number DESC`; load evaluations for those submissions.
6. Compute `can_submit` per ladder above.
7. Compute `latest_status` (same logic as §3.1).
8. Return.

A teacher evaluating between step 5a and 5b can cause minor UI inconsistency (history shows submission without eval, but server already has eval). Mitigated by `visibilitychange`-event refetch (§6 step 6 — P4: prior wording said "focus", but spec actually uses `visibilitychange` on `document.visibilityState === 'visible'`). Documented; not a security issue.

### 3.3 Constraint enforcement (new endpoints touched)

**Two helpers** (in `helpers.py`, imported into `schemas.py` for the `BulkRosterErrorCode` literal):

```python
STUDENT_ALREADY_ACTIVE_ERROR_CODE = "student_already_active_in_course"


def find_student_active_conflicts(
    db: Session,
    user_id: int,
    *,
    course_id: int,
    exclude_run_id: int,
) -> list[tuple[int, str]]:
    """Return [(conflicting_run_id, conflicting_run_title), ...] for OTHER
    published runs of the same course where the user is an active RunStudent.
    `exclude_run_id` is the run we're checking (defensive: `Run.is_published==True`
    already excludes the target in current sqlite usage, but callers always pass
    `run.id` or the target rid). N2+P1 — required imports at top of `helpers.py`:
    `from mathion.models import RunStudent, Run, CourseVersion`. (`from
    sqlalchemy import select` is already at `helpers.py:7` — no add needed.
    `User` import is only needed at the publish_run call site in `runs.py` for
    the JOINed student-row fetch query, NOT inside this helper.)

    M3 — signature locked: BOTH `course_id` and `exclude_run_id` are required
    keyword args. Callers resolve `course_id = run.version.course_id` ONCE and
    pass it in (avoids the per-call lazy SELECT in `publish_run`'s loop)."""
    excluded = exclude_run_id
    rows = db.execute(
        select(RunStudent.run_id, Run.title)
        .join(Run, Run.id == RunStudent.run_id)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .where(
            RunStudent.user_id == user_id,
            CourseVersion.course_id == course_id,
            Run.is_published == True,
            Run.id != excluded,
        )
    ).all()
    return [(row[0], row[1]) for row in rows]


def make_already_active_409_body(
    conflicts: list[dict], *, summary_override: str | None = None
) -> dict:
    """Build the JSONResponse content for the 409. Top-level `error_code` so
    `ApiError` in `frontend/src/lib/api.ts:46` picks it up.

    `conflicts` is a list of dicts, each containing `{run_id, run_title}` plus
    optional `{user_id, email}` (the per-user metadata for publish_run aggregate
    payloads). Empty list is allowed for defensive callers.

    `summary_override` lets `publish_run` supply an aggregate-shaped detail
    string instead of the single-conflict anchor used by `add_student`."""
    if summary_override is not None:
        detail = summary_override
    elif conflicts:
        c = conflicts[0]
        detail = (
            f"Student is already active in run \"{c['run_title']}\" of the same course."
        )
    else:
        detail = "Student is already active in another run of the same course."
    return {
        "detail": detail,
        "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE,
        "conflicts": conflicts,
    }
```

NO `assert_student_not_active_elsewhere` exists. The two functions above are the only constraint helpers. F4 — rev 4 mentioned a wrapper; rev 5 deletes that name from the spec entirely.

**Callers:**

| Endpoint | Hook point | Behavior |
|---|---|---|
| `POST /api/runs/{rid}/students` (`run_roster.py:46`) | After `require_run_admin_or_teacher` + the EXISTING `is_published` check (`run_roster.py:59-63`) + the EXISTING `group_id` validation block (`run_roster.py:64-69`, raises 400 on bad group / 409 on disabled group), BEFORE `get_or_create_user` (`run_roster.py:71`). **L2 (M6) — check ordering:** the new check runs AFTER `run_roster.py:64-69` so that input-validation 400 (bad group_id) precedes the new business 409 (already-active-elsewhere). Local convention only — codebase has counter-examples (e.g. `mini_projects.py:79-84` and `submissions.py:69-112` raise 409 before some 400s); spec locks add_student order explicitly for this slice, no codebase-wide rule claimed. User is NOT created on rejected adds. Resolves email to existing user via `db.execute(select(User).where(User.email == data.email))` (Pydantic already normalized — F13). **If user doesn't exist yet, no conflict possible (no `RunStudent` row to compare against) — fall through to existing flow that calls `get_or_create_user`.** Otherwise call `conflicts = find_student_active_conflicts(db, existing_user.id, course_id=run.version.course_id, exclude_run_id=run.id)` (M3 — locked keyword-arg signature). If non-empty, **convert tuples → dicts with uniform shape** (H2+I3): `conflict_dicts = [{"user_id": existing_user.id, "email": existing_user.email, "run_id": rid_other, "run_title": title} for (rid_other, title) in conflicts]`. Then build detail string and return 409 (see code below). | 409 via `JSONResponse(status_code=409, content=make_already_active_409_body(conflict_dicts, summary_override=detail))` where `detail = f'{data.email} is already active in run \"{conflict_dicts[0]["run_title"]}\" of the same course.'` Top-level `error_code` consumed by `api.ts:46`. Response body shape (test in §8): `conflicts: [{user_id, email, run_id, run_title}, ...]` — uniform with publish_run. |
| `POST /api/runs/{rid}/students/batch` (`run_roster.py:131`) — note correct route name | **M5 — precise insertion point in batch loop:** existing batch code at `run_roster.py:160-177` does `target = get_or_create_user(db, row.email)`, then mutates `target.full_name`, then resolves/creates a `Group` row, then finally calls `enroll_user_in_run`. The new conflict check goes **immediately after `get_or_create_user(...)` and BEFORE the `full_name` mutation, Group creation, or `enroll_user_in_run` call** — so rejected rows skip ALL existing side effects (no orphan Group rows, no name overwrites for users on other runs). F1 short-circuit: call `conflicts = find_student_active_conflicts(db, target.id, course_id=run.version.course_id, exclude_run_id=run.id)` (resolve `course_id` ONCE before the loop). If non-empty, append the result row DIRECTLY: `results.append({"email": row.email, "status": "error", "detail": f"Already active in '{conflicts[0][1]}'", "error_code": STUDENT_ALREADY_ACTIVE_ERROR_CODE})` and `continue`. Skip the rest of the row body and the existing `except HTTPException` branch entirely for this case. The existing branch at `run_roster.py:180-182` is UNCHANGED — only NEW result-row append paths set `error_code`. Requires (a) extending `BulkRosterErrorCode` literal in `schemas.py:500-504` with `"student_already_active_in_course"` and (b) adding `error_code: BulkRosterErrorCode \| None = None` field to `RunStudentBatchResultRow` (`schemas.py:478-482`). | Per-row error row with `error_code='student_already_active_in_course'`. Other rows continue normally. |
| `POST /api/runs/{rid}/publish` (`runs.py:172`) | After existing teacher-count + group-size checks, BEFORE `is_published=True` flip. **L3 — student-row fetch query:** `publish_run` does not currently load students. Add a JOINed query (avoid N+1) BEFORE the loop (M4 — parameter is `run_id`, not `rid`; `publish_run(run_id: int, ...)` per `runs.py:172`): `student_rows = db.execute(select(RunStudent.user_id, User.email).join(User, User.id == RunStudent.user_id).where(RunStudent.run_id == run_id)).all()`. Resolve `course_id = run.version.course_id` ONCE before the loop (M3 — required by the locked helper signature; also avoids per-call lazy SELECT). Then iterate `for (uid, user_email) in student_rows: ...` accumulating `find_student_active_conflicts(db, uid, course_id=course_id, exclude_run_id=run_id)` results into a single aggregate list of dicts: `{"user_id": uid, "email": user_email, "run_id": rid_other, "run_title": title}`. If aggregate is non-empty, build a summary string with explicit singular/plural (G8): `n = len({c['user_id'] for c in aggregate})`; `summary = f"1 student cannot be added — already active in another run of this course." if n == 1 else f"{n} students cannot be added — already active in other runs of this course."` Return `JSONResponse(status_code=409, content=make_already_active_409_body(aggregate, summary_override=summary))`. **Aggregate-all (not first-conflict-wins)** so admin sees the full picture in one request. | 409 with ALL conflicts; admin can fix in one pass. |

**Transactional consistency:** the publish loop and the eventual `is_published=True` flip share the SAME SQLAlchemy session — no commits between. If a concurrent admin adds a conflicting student between the loop and the flip, sqlite's session lock serializes them; in Postgres a follow-up will move to `SELECT ... FOR UPDATE` on the relevant rows.

**L4 + M2 — Side-effects bypassed on 409 (single-add + batch paths):** when add_student / add_students_batch 409 short-circuits before `enroll_user_in_run` (`helpers.py:159-210`), the following are ALSO bypassed — intentional, since enrollment never occurs:
- `_enroll_user` → `StudentEnrollment` activation on the run's version (would deactivate other active enrollments on the same course).
- `NotificationLogEntry(kind='run_enrolled')` write (from the just-merged notifications-email predecessor).
- `RunStudent` row insert.
- For the BATCH path specifically (M5): `target.full_name` overwrite AND any new `Group` row creation are ALSO bypassed (the check runs immediately after `get_or_create_user` and BEFORE those mutations at `run_roster.py:160-177`).

(M2 — earlier draft listed `enrollment.last_active_at`; no such field exists on `StudentEnrollment` (`models_auth.py:49-61` has only id/user_id/version_id/is_active/created_at). Removed.)

This is the correct "no enrollment ⇒ no side effects" semantic. Spec is explicit so future reviewers comparing against the notifications-email surface don't assume the `run_enrolled` notification fires for rejected adds. The publish_run 409 path bypasses NO existing side effects (the check runs before the flip; if 409, no flip).

**H4 + I4 — Legacy duplicate-RunStudent defensive behavior:** the new invariant says "≤1 active RunStudent per (course, user)" but legacy data may already violate it (cleanup is out-of-scope per §11). `find_student_active_conflicts` returns a list — if a single user has 2+ legacy active rows on different runs of the same course, all conflicts surface. The publish 409 aggregate then has multiple `{user_id, email, run_id, run_title}` rows for ONE student. Backend `detail` already dedupes via `n = len({c['user_id'] for c in aggregate})`, and **I4** mandates the frontend modal heading mirror this: `studentCount = new Set(conflicts.map(c => c.user_id)).size`. Frontend grouping (G3) is by `run_id`, so the same email may appear in two run-groups; this is the correct UX (each conflicting run is shown) — NOT a duplicate-display bug. Heading consistently reflects unique student count. Admin must unpublish the older conflicting run(s) before retrying publish. Documented as accepted behavior; tests in §8 do NOT need to cover the legacy case end-to-end (out of scope), but the modal's `studentCount` dedupe logic IS unit-tested via a synthetic 2-row-same-user fixture (added below).

**`exclude_run_id` defense-in-depth:** in the `publish_run` case, the predicate `Run.is_published == True` already excludes the target run (still unpublished at check time). The `exclude_run_id` parameter is kept defensively for the future Postgres migration where the publish flow may run in a SAVEPOINT after the flip; documenting now to avoid future "what's this redundant param" questions.

**F12 — `JSONResponse` bypass:** FastAPI bypasses `response_model` validation for explicit `JSONResponse` returns (matches the existing `run_unpublished` precedent at `run_roster.py:60-63`); the 409 path's body shape is enforced by the test suite, not Pydantic.

**F13 — Pydantic-normalized email:** `RunStudentCreate.email` is already `.strip().lower()`'d at validation time (`schemas.py:457-460`); explicit `.lower()` in lookups is defensive but harmless.

**F11 — Constant location:** `STUDENT_ALREADY_ACTIVE_ERROR_CODE` is declared in `mathion/api/helpers.py` (near use), then imported into `schemas.py` as the value for the new `BulkRosterErrorCode` literal member. `RUN_UNPUBLISHED_ERROR_CODE` lives at `run_roster.py:33` — pattern is "constant near callsite, imported elsewhere as needed".

**Frontend surfaces (F2, F3):**

- **RosterImportModal + add-student modal** (existing): `apiError.errorCode === 'student_already_active_in_course'` branch displays `apiError.detail` verbatim (which is the email-anchored sentence per the backend `summary_override`).
- **PublishConflictsModal** (NEW, F2, H3, I1, I4, J2): when `doPublish` catches `apiError.errorCode === 'student_already_active_in_course'`, narrow the body inline: `const conflicts = (apiError.body as { conflicts?: PublishConflict[] } | undefined)?.conflicts ?? []`. **J2 + K3 — open guard:** if `conflicts.length === 0` (malformed response, parse failure, or missing body), fall back to `pushToast(e.displayMessage, 'error')` (K3 — `'error'` variant matches existing `doPublish` error-path call at `RunDetailPage.svelte:252`; default `'info'` would render as a neutral toast which is wrong for a 409) and DO NOT open the modal. Otherwise render `<PublishConflictsModal open={true} conflicts={conflicts} onClose={...} />`. Preserves the G9 "modal never opens with empty conflicts" invariant — the modal component itself has no empty-state code path (no 0-conflict test in §8). Do NOT use `as any` — the codebase enables strict TS and `svelte-check` in CI. The conflict shape is `{user_id, email, run_id, run_title}`. Grouping is by `run_id` (G3 — run_title is NOT unique). **I4 — heading count dedupes by `user_id`**: `const studentCount = new Set(conflicts.map(c => c.user_id)).size`. This mirrors the backend summary string at §3.3 publish_run row (`n = len({c['user_id'] for c in aggregate})`). Without dedupe, a legacy student with 2 active rows would show as "2 students" in the heading while displaying the same email twice. With dedupe, heading says "1 student" and body shows the same email under 2 run groups (correct UX — admin sees each conflicting run). Modal copy:
  - **studentCount=1**: heading `"1 student can't be added"`, body `"{email} is already active in <strong>{run_title}</strong>."` (if conflicts.length=1) or `"{email} is already active in:"` + grouped list (if conflicts.length≥2, legacy duplicate case).
  - **studentCount≥2, all conflicts share the SAME `run_id`**: heading `"{studentCount} students can't be added"`, body `"They are already active in <strong>{run_title}</strong>:"` + bullet list of emails (deduped by `user_id`).
  - **studentCount≥2, multiple distinct `run_id`s**: heading `"{studentCount} students can't be added"`, body `"They are already active in other runs:"` + grouped list — group by `run_id`, render each group as `<strong>{run_title}</strong>` followed by bullet list of emails for that group.
  - Single `[Close]` button. No retry affordance from this modal (admin must unpublish the conflicting run first).
- **`ApiError` extension (F3, G4, H3, I1):** `frontend/src/lib/api.ts` extends `ApiError` with `public readonly body?: unknown`. On non-2xx, the existing parse path `await res.json()` is wrapped: success → pass parsed `body` to constructor; failure (non-JSON response, HTML error page, truncation) → pass `body = undefined`. **H3 — TS strict mode access:** property access on `unknown` does NOT compile under strict TS (the codebase uses `tsconfig.json:12` strict + `svelte-check`). Callers MUST cast at the access point using the `PublishConflict` type from `types.ts` (I1): `const conflicts = (apiError.body as { conflicts?: PublishConflict[] } | undefined)?.conflicts ?? []`. Inline type narrowing only at consumption sites; do NOT widen the field type on `ApiError`. Backwards compatible: existing callers ignoring `body` work unchanged.

## 4. Auth & resolver

### 4.1 `_resolve_student_run(db, user, course_slug) -> Run`

```python
def _resolve_student_run(db: Session, user: User, course_slug: str) -> Run:
    """Locate the student's active run for this course. Raises HTTPException
    on miss/violation."""
    course = db.execute(select(Course).where(Course.slug == course_slug)).scalar_one_or_none()
    if course is None:
        raise HTTPException(404, "Course not found")

    # Any active enrollment on any version of this course?
    enr_exists = db.execute(
        select(StudentEnrollment.id)
        .join(CourseVersion, CourseVersion.id == StudentEnrollment.version_id)
        .where(
            StudentEnrollment.user_id == user.id,
            StudentEnrollment.is_active == True,
            CourseVersion.course_id == course.id,
            CourseVersion.is_disabled == False,
        )
        .limit(1)
    ).scalar_one_or_none()
    if enr_exists is None:
        # DELIBERATE DIVERGENCE from /my-version: this resolver requires
        # is_active==True, while /my-version (student.py:223-234) accepts
        # inactive enrollments. Rationale: an inactive enrollment means the
        # student was removed/deactivated; they should NOT see MPs going
        # forward, consistent with revocation-on-removal semantics.
        raise HTTPException(404, "Not enrolled in this course")

    # Active RunStudent rows on published runs of this course (INVARIANT: 0 or 1).
    # Also filter CourseVersion.is_disabled == False on this query (E5: rev 3
    # only filtered on the enr_exists pre-check; a stale published run on a
    # disabled version could still be picked otherwise).
    rows = db.execute(
        select(Run)
        .join(CourseVersion, CourseVersion.id == Run.version_id)
        .join(RunStudent, RunStudent.run_id == Run.id)
        .where(
            CourseVersion.course_id == course.id,
            CourseVersion.is_disabled == False,
            Run.is_published == True,
            RunStudent.user_id == user.id,
        )
        .order_by(Run.start_date.desc())
    ).scalars().all()

    if len(rows) == 0:
        # Enrolled but no published run with RunStudent — could be pre-publish.
        raise HTTPException(403, "No active run for this course")
    # F18: Run.start_date is non-nullable (`models.py:197`); no NULL-sort concern in the ORDER BY DESC.
    if len(rows) > 1:
        logger.warning(
            "invariant violation: user_id=%s has %d active RunStudent rows for course_slug=%r",
            user.id, len(rows), course_slug,
        )
        # Defensive: pick the most recent by start_date (already ordered DESC).
    return rows[0]
```

**Invariant:** §3.3's enforcement makes the 2+ case impossible going forward, but the resolver tolerates legacy data with a warning + deterministic pick. Reviewers explicitly noted this is the safest "loud but don't 500" stance.

### 4.2 `_resolve_block(db, run, block_slug) -> Block`

```python
def _resolve_block(db: Session, run: Run, block_slug: str) -> Block:
    block = db.execute(
        select(Block).where(
            Block.version_id == run.version_id,  # version-scoped lookup
            Block.slug == block_slug,
        )
    ).scalar_one_or_none()
    if block is None:
        raise HTTPException(404, "Block not found")
    return block
```

Block.slug is unique only within a version (`models.py:57-61`). The version-scoped query closes the cross-version IDOR.

### 4.3 Information disclosure (locked) + immutability semantics

- Group member full names visible to peers (no emails — D3).
- Evaluator full name visible to students (locked in brainstorm §4).
- Submission history scoped to viewer's CURRENT group via `get_submitter_group`. Group change immediately revokes access — confirmed by reviewers.
- No teacher rosters, run admin info, or other-group data.

**Group rename / membership reshuffle immutability** (E8): submission filenames embed the group name AT SUBMIT TIME via `build_submission_filename` (`submissions.py:132`, `helpers.py:364-372`). Renaming the group does NOT rewrite stored filenames; reshuffling members does NOT re-attribute historical submissions. The detail page renders:
- the CURRENT group name in `data.group.name` (the live `Group.name`);
- the HISTORICAL filename in each history row's `filename` (the stored `Submission.file_path` basename).
Both are correct: peers see today's group identity AND can verify what was actually submitted. No backfill needed; no special UX. Documented to prevent implementer surprise.

## 5. Block view UI changes (`BlockGroup.svelte`)

**Current** (`components/course/BlockGroup.svelte:19-23`):
```svelte
<ul>
  {#each block.sequences as s (s.id)}
    <li><SequenceLink {courseSlug} sequence={s} state={vstate} /></li>
  {/each}
</ul>
```

**Change:** add new optional prop `mpByBlockId: Record<string, StudentMiniProjectListItem> | undefined`. Render an extra `<li>` containing `<MiniProjectLink>` after the sequences when `mpByBlockId?.[String(block.id)]` exists.

**`MiniProjectLink.svelte`** renders:
```svelte
<a class="row row-mp" href={detailHref}
   aria-label="Mini-project: {titleForLabel}, Status: {statusLabel}">
  <span class="row-glyph" aria-hidden="true">📋</span>
  <span class="row-title">Mini-project: {titleForLabel}</span>
  <StatusPill status={item.latest_status} />
</a>
```

Where:
- `detailHref = `/courses/${encodeURIComponent(courseSlug)}/blocks/${encodeURIComponent(item.block_slug)}/mini-project``
- `titleForLabel = item.block_title.trim() || 'Untitled block'` (defensive against empty/whitespace titles from malformed drafts)
- `statusLabel` looked up from the same map used by `StatusPill.svelte` (single source of truth)

The link's `aria-label` is the ONE place AT users hear status (since the pill itself has no `aria-label` per §5, and the visual pill text would be read as link content but ordering varies by implementation). The `📋` glyph is `aria-hidden="true"`.

**`StatusPill.svelte`** (shared by link + detail page):

| `latest_status` | Pill label | Class | Leading token |
|---|---|---|---|
| `pending_group_assignment` | "Pending group" | `pill-neutral` | `…` |
| `not_submitted` | "Not yet submitted" | `pill-neutral` | `·` |
| `awaiting_evaluation` | "Awaiting evaluation" | `pill-info` | `~` |
| `rejected` | "Rejected" | `pill-danger` | `×` |
| `major_revision` | "Needs revision (major)" | `pill-warning` | `!` |
| `minor_revision` | "Needs revision (minor)" | `pill-warning` | `!` |
| `accepted` | "Accepted" | `pill-success` | `✓` |

The leading token provides a non-color signal for colorblind users. Each pill is `<span class="pill pill-X"><span class="pill-token" aria-hidden="true">{TOKEN}</span> {LABEL}</span>`. **No `aria-label` on the pill** — the visible text suffices, and adding one would double-announce against the dedicated sr-only `aria-live` region on the detail page (§6). Screen readers hear "Accepted" naturally from text content; the token glyph is hidden.

**`StatusPill.svelte` prop interface:**
```ts
type LatestStatus =
  | 'pending_group_assignment' | 'not_submitted' | 'awaiting_evaluation'
  | 'rejected' | 'major_revision' | 'minor_revision' | 'accepted';
interface Props { status: LatestStatus }
```
No slots, no children, no event dispatch.

**Empty state**: block has no MP → `MiniProjectLink` does not render (silent, decision §10 D5 carried over from brainstorm).

**Trust boundary note for `{@html assignment_html}`** (rendered on detail page, not here, but documented once): `assignment_html` is produced by `render_with_run_assets(run.id, mp.assignment_md)` (`mini_projects.py:96-101, 180-182`), which calls `render_markdown()` → `nh3.clean()` with raw HTML disabled (`markdown.py:7-49`). All `<script>` / `<iframe>` / event-handler attributes are stripped. The asset-URL rewrite (`helpers.py:456-462`) is internal-only. `{@html}` here is safe against XSS.

**F8 — External-link policy:** `nh3.clean` permits `<a href="https://...">` (teachers are trusted). To prevent accidental session-hijacking patterns and improve UX, the detail page wires `rewriteExternalLinks(containerEl)` (`studentMiniProjects.ts`) inside a Svelte 5 `$effect` that depends on BOTH `data.assignment_html` AND the container `bind:this` ref (G5). After each `{@html}` update (initial mount, refetch, visibilitychange-driven refresh), the effect re-runs: for each `<a>` whose href starts with `http://`, `https://`, or `//`, set `target="_blank"` and `rel="noopener noreferrer"`. Same-origin / asset URLs (`/api/runs/...`) and `mailto:` / `tel:` schemes are untouched. No `MutationObserver` needed — Svelte's reactivity is the change trigger. No visual flag — teachers remain the authoring trust boundary; this is defense-in-depth.

**L1 — `bind:this` placement constraint:** the `bind:this={assignmentEl}` MUST be on the SAME `<div>` whose content is `{@html data.assignment_html}` — NO intermediate wrapper between them. If implementer puts `bind:this` on an outer layout div (e.g. `<div class="page-section" bind:this={assignmentEl}><div>{@html ...}</div></div>`), the rewriter's `assignmentEl.querySelectorAll('a')` still finds the links by descendant traversal — but reasoning about `$effect` dep timing gets harder when the bound element and the `{@html}` target are different. Keep them on the same node: `<div class="assignment-html" bind:this={assignmentEl}>{@html data.assignment_html}</div>`. The effect: `$effect(() => { if (!assignmentEl) return; void data.assignment_html; rewriteExternalLinks(assignmentEl); })` — the `void data.assignment_html` read tracks the dep without using the value (M7 — `void` idiom matches the local convention at `ItemEditPage.svelte:238`; Svelte's content commit happens before the effect fires, so the links exist in the DOM by then). Add a `data-testid="assignment-html"` attribute on the same div for test seam.

## 6. Detail page (`MiniProjectDetailPage.svelte`)

**Route:** `/courses/:courseSlug/blocks/:blockSlug/mini-project` → `MiniProjectDetailPage` (registered in `App.svelte` componentMap, declared in `routes.ts` with `auth: true`).

**Page-mount sequencing:**
- Calls `loadCourse(courseSlug)` AND `studentMiniProjects.fetchDetail(courseSlug, blockSlug)` in parallel.
- Course load is for breadcrumb context only. Behavior by error class:
  - DOMException `AbortError` (another `loadCourse` superseded): silently leaves breadcrumb at `<Course Name>` placeholder.
  - ApiError 401: propagates via `emitUnauthorized()` (auth bounce; no in-page handling).
  - ApiError 4xx/5xx OR network: surfaces a non-fatal toast `"Couldn't load course details."` and leaves breadcrumb at placeholder. Page still renders if detail fetch succeeds.
- Detail fetch is independent: own `AbortController`, no piggyback on `loadCourse`. If detail fetch fails → page-level error state per §6 step 7.

**Layout (top to bottom):**

1. **Header**: breadcrumb (`< Courses › <Course Name>`); H1 `<Block Title> — Mini-project` (fallback `<Untitled block> — Mini-project` if `block_title` is empty/whitespace); `StatusPill` (visual); `<div class="sr-only" aria-live="polite" data-testid="sr-live">Status: {label}</div>` separate live region — sole status announcer (the visual pill has no `aria-label`, see §5). Plus deadline summary:
   - If `hard_deadline`: "Hard deadline: 15 Aug 2026, 23:59 — 12 days remaining" (relative client-side; past framing: "passed 3 days ago").
   - If `soft_deadline`: "(Soft deadline: 10 Aug 2026)" inline.
   - If `resubmission_deadline` AND `latest_status` ∈ {major_revision, minor_revision}: "Resubmission deadline: ..." takes prominence over hard_deadline.

   Breadcrumb segments: `Courses` → `/courses`. `<Course Name>` → `/courses/<slug>`. Block title is current page, not a link.

2. **Assignment** (M1, N4, P3): in `<script lang="ts">` declare `let assignmentEl: HTMLDivElement | undefined = $state();` (Svelte 5 — `bind:this` writes to this var reactively; matches the `$state()`-with-no-arg precedent at `frontend/src/components/runs/RunTeachersTab.svelte:20`. Note: `FocusTrap.svelte:14` uses the plain `let containerEl: HTMLDivElement | undefined;` form WITHOUT `$state()` — also valid in Svelte 5 for `bind:this` since the binding updates the var directly, but using `$state()` makes the reactivity explicit and is the convention used in other run-page components). Markup: `<div class="assignment-html" data-testid="assignment-html" bind:this={assignmentEl}>{@html data.assignment_html}</div>`. The `bind:this` MUST be on the SAME div as `{@html}` per L1 — no intermediate wrapper. Run-asset links inside the HTML (`/api/runs/{run_id}/assets/{filename}`) remain functional via `run_assets.py:240-297`. Wire `rewriteExternalLinks(assignmentEl)` inside `$effect(() => { if (!assignmentEl) return; void data.assignment_html; rewriteExternalLinks(assignmentEl); })` (M7 — `void` idiom matches the local convention at `ItemEditPage.svelte:238`).

3. **Group context** — three rendering branches; when `data.group.is_disabled === true`, the group block wraps in a `.group-disabled` class with an inline notice "This group is disabled — contact your teacher." (F10):
   - `data.group === null`: friendly banner "You're not yet assigned to a group. Once your teacher assigns you, you'll be able to submit." No member list. (D4)
   - `data.group !== null && members.length === 1` (solo, only `is_me`): "Group {name}: You ({your name}) — you're the only member so far."
   - `data.group !== null && members.length > 1`: "Group {name}: {name1} (you), {name2}, {name3}" — current user always rendered first as "{name} (you)".

4. **Submission history** (rendered only if `submission_history.length > 0`) — **DESC, newest first**:

   For each entry (the Late pill is a sibling of the heading, NOT inside it — AT readers should hear "Submission 2" as a heading, then the pill as a separate announcement):
   ```
   <div class="history-entry-header">
     <h3>Submission #{n}</h3>
     {is_late && <Pill label="Late" class="pill-warning" title="Submitted past the soft deadline ({soft_deadline date})"/>}
   </div>
   By {submitter}{submitter_is_me ? ' (you)' : ''} on {date}
   File: {filename} ({formatted_size}) [Download]
   ```
   Below, the evaluation (if any):
   ```
   Evaluated: {result_label}{score ? ` — score ${score}/100` : ''}
   By {evaluator_full_name} on {date}
   Feedback: {feedback_text || 'No written feedback'}
   {has_feedback_file && [Download feedback]}
   ```
   Each entry uses `<section><h3>` so screen readers can heading-nav between entries. Newest at top.

   **`is_late` semantics**: per `submissions.py:134`, `is_late = now > soft_deadline` at submit time. UI tooltip on the "Late" pill: "Submitted past the soft deadline ({soft_deadline date})".

   **Download links**:
   - Submission file: `GET /api/submissions/{submission_id}/file` (existing).
   - Feedback file: `GET /api/evaluations/{eval_id}/feedback-file` (existing).
   - Browser's `Content-Disposition: attachment; filename=...` is set by backend; no client-side filename munging.

5. **Submit / Resubmit section** — visible when `data.group !== null` AND `can_submit !== null`:

   - If `can_submit === true`:
     - Heading: "Submit" (initial) or "Submit revision" (when `latest_status ∈ {major_revision, minor_revision}`).
     - File picker (PDF only, max 20MB — mirrors `settings.max_file_size`).
     - [Submit] button. Disabled when no file picked.
     - State machine driven (below).
   - If `can_submit === false`:
     - No file picker, no button.
     - `<div class="banner banner-info">` showing `REASON_LABELS[can_submit_reason_if_not]`.

   **State machine** (single `$state<'idle' | 'submitting' | 'error' | 'success'>`):

   | State | File input | Submit button | Banner | File preservation on transition |
   |---|---|---|---|---|
   | idle | enabled | enabled (if file picked) | none | n/a |
   | submitting | disabled | disabled + spinner | none | file kept |
   | error | enabled | enabled (if file still picked) | error banner from response | file kept (retry without re-pick) |
   | success | reset | reset | none | file cleared (detail refetched) |

   **File replacement while in `error` state:** picking a new file in `error` does NOT clear the error banner and does NOT change state. State stays `error` until the next Submit attempt. On next submit, state → `submitting` and the error banner is dismissed.

   **Constants** (in `studentMiniProjects.ts`):
   ```ts
   // Mirrors backend settings.max_file_size; update both together.
   // Backend rejects definitively — this is a UX guard only.
   export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
   ```

   **Error sources & banner copy:**
   - 400 PDF/size: backend message verbatim.
   - 401: `emitUnauthorized()` (existing wire-pattern); ApiError thrown.
   - 403: should not happen mid-flow (verified by detail fetch); show "Permission lost — refresh."
   - 409 (race: another group member just submitted): "Submission state changed — refreshing." Detail refetched; state → idle.
   - 503 (concurrent retry exhausted, `submissions.py:148-171`): same UX as network failure.
   - Network: "Couldn't submit — retry?" [Retry] button.

   Client-side validation BEFORE POST:
   - Extension check: `file.name.toLowerCase().endsWith('.pdf')`. Ignore `File.type` (browser-dependent — Linux Firefox empty).
   - Size check: `file.size <= 20 * 1024 * 1024` (= `MAX_FILE_SIZE` constant in studentMiniProjects.ts).
   - On fail: error banner "Only PDF files are accepted." / "File too large — 20 MB maximum." No POST sent.

6. **State refresh:**
   - On successful submit (201): `fetchDetail` again → state → success → idle on next pick. ALSO write back the new `latest_status` (derived from the freshly fetched detail) into `currentCourse.value.miniProjectsByBlockId[String(blockId)].latest_status` so the BlockGroup pill is fresh on return to the course view. **F6 — Slug guard:** write-back only fires when `currentCourse.value?.slug === courseSlug` (the detail page's `courseSlug` prop). Protects against the cross-course race: user is on Course A detail page, opens Course B which triggers `loadCourse(B)` reassigning `currentCourse.value`, then Course A's submit completes — without the guard, write-back would mutate Course B's snapshot. No-op if `currentCourse.value === null` (detail page deep-linked, course never loaded).
   - On `window.addEventListener('visibilitychange', ...)` when `document.visibilityState === 'visible'`: refetch detail. `$effect` returns cleanup. Single-flight guard (skip if already fetching).
   - sr-only `aria-live` region announces "Status: {label}" on every status change.

7. **Run-unpublished / MP-unpublished mid-session** — on next interaction (refetch or submit), backend returns 403/404. Frontend shows:
   - On detail refetch 403: full-page banner "This mini-project is no longer accessible. The run may have been closed."
   - On detail refetch 404: full-page banner "This mini-project doesn't exist or has been unpublished."
   - On submit 4xx: in-section banner per state machine.
   - **Asset-deleted mid-session** (G2): detail endpoint does NOT return 422 — it serves the stored `assignment_html` which now references a deleted asset. The browser renders a missing-image icon (default `<img>` broken-asset behavior) inside the assignment content. No banner, no special handling. Teacher fix surfaces on next edit/save of the MP.

## 7. State plumbing — `currentCourse` extension

**`loadCourse(slug)` change** (`stores/currentCourse.svelte.ts:36-73`):

Currently `Promise.all([content, state])`. Change to `Promise.all([content, state, fetchListSwallow403(slug, controller.signal)])` where:

```ts
// In studentMiniProjects.ts:
export async function fetchListSwallow403(
  slug: string,
  signal: AbortSignal
): Promise<Record<string, StudentMiniProjectListItem>> {
  try {
    const list = await api.get<StudentMiniProjectListItem[]>(
      `/api/courses/${encodeURIComponent(slug)}/mini-projects`,
      { signal },
    );
    const map: Record<string, StudentMiniProjectListItem> = {};
    for (const item of list) map[String(item.block_id)] = item;
    return map;
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) return {};
    throw e;  // 401/500/network propagate up to loadCourse outer catch
  }
}
```

`miniProjectsByBlockId` added to `CourseSnapshot`. Existing stale-write guard at line 53 (`if (inflight?.slug !== startedSlug) return;`) protects all 3 results in the `Promise.all`.

**F16 — 5xx is NOT swallowed:** `fetchListSwallow403` ONLY catches 403. Any 401, 4xx other than 403, 5xx, or network error propagates up to `loadCourse`'s outer try/catch (`stores/currentCourse.svelte.ts:62-68`) and surfaces in the `CourseView` page-level error state. **Rationale:** 5xx on `/mini-projects` indicates a server bug worth surfacing to the student (a stuck page is better than silent half-load); a 401 must trigger auth bounce; 404 from a missing route is a deploy bug. Only 403 has the legitimate "you're enrolled but no active run yet" meaning that should NOT block the rest of the course view.

**F17 — AbortError handling:** `DOMException` with `name === 'AbortError'` (controller aborted by a newer `loadCourse`) propagates as-is; `loadCourse`'s outer catch already filters it (`stores/currentCourse.svelte.ts:63`). `fetchListSwallow403` does NOT need its own AbortError branch.

**`CourseView.svelte`** passes `currentCourse.value.miniProjectsByBlockId` as `mpByBlockId` prop into each `BlockGroup`.

**Detail page** does NOT read `currentCourse.value.miniProjectsByBlockId` — its own fetch is the source of truth, including `latest_status`. The course-level cache is for the block-link list only. The detail page DOES write back `latest_status` on submit success (§6 step 6) to keep the BlockGroup pill fresh.

## 8. Testing

### Backend (`backend/tests/test_student_mini_projects.py`, ~600 lines, ~30 tests)

**Test fixture rule — backend** (CRITICAL): all dates MUST use `NEAR_DEADLINE_ISO`/`FAR_DEADLINE_ISO`/`RUN_END_DATE`/`RUN_END_DATE_FAR` from `conftest.py:30-38`. For "deadline passed" tests, construct the `MiniProject` row directly (bypassing publish-gate) with a hardcoded past datetime — follow `test_submissions.py:71-92` pattern. No `2026-XX-XX` strings.

**Test fixture rule — frontend**: frontend test fixtures may hardcode ISO date strings since they're opaque to UI assertions (the UI renders the date relative to `new Date()` at click time). If a frontend test asserts relative-time text, use a date derived at compile-time from `new Date().toISOString()`-style helpers; do NOT hardcode `2026-XX-XX` strings.

**`GET /api/courses/{slug}/mini-projects`:**
- 200 happy: 2 blocks, 1 has published MP → list of 1
- 200 sorted by block_order ASC
- 200 hides UNPUBLISHED MPs
- 200 each of 7 `latest_status` values asserted (one test per value)
- 200 multi-block: pending_group_assignment status surfaces even though group=null
- 401 unauthenticated
- 403 student has enrollment but no active published run with RunStudent
- 404 course doesn't exist
- 404 student has no `StudentEnrollment` on this course
- 200 cross-course: student in courses X (run with 1 MP) AND Y (run with 1 MP) → list for X has only X's MP
- 200 defensive 2+ fallback: 2 active `RunStudent` rows seeded for same student + same course (legacy data); resolver returns the MP for the most-recent-by-`start_date` run AND `caplog` shows `WARNING ... invariant violation: user_id=...`.

**`GET /api/courses/{slug}/blocks/{block_slug}/mini-project`:**
- 200 happy with all fields populated, history DESC
- 200 history filtered to viewer's group only
- 200 group members rendered with `is_me=true` for requester
- 200 `evaluated_by_full_name` populated when eval exists
- 200 `submitter_is_me=true` when current user submitted, false otherwise
- 200 each of 7 `can_submit_reason_if_not` code paths (one test per code)
- 200 `latest_status` derivation for each of 7 values
- 200 `has_feedback_file=true/false` cases
- 200 group=null returned for ungrouped student (D4)
- 200 with 3+ submissions (initial → minor_revision → auto-accepted resubmit) — exercises auto-accept eval visible in history
- 200 explicit `submission_history[0].filename == build_submission_filename(...)` assertion (E9: not just "fields populated")
- 200 with `group.is_disabled=True` — assert `data.group.is_disabled === True` AND `data.can_submit === False, data.can_submit_reason_if_not === 'group_disabled'` (F10)
- (G2: 422 test for deleted RunAsset REMOVED — detail endpoint uses stored `assignment_html`, no re-render; deleted asset surfaces as broken image, not 422.)
- 200 `full_name` null fallback: user with `full_name=None` → response shows email local-part
- 200 `is_late=true` history entry
- 200 `submission_history=[]` (empty list, explicit shape assertion)
- 401 unauthenticated
- 403 resolver fails (no active run)
- 404 course doesn't exist
- 404 student has no active `StudentEnrollment` on this course
- 404 block slug doesn't exist on run's version
- 404 IDOR: same block_slug exists on another version; student on v1 supplies block from v2 → 404
- 404 MP not published
- State transition: 200 → admin un-publishes run → 200 (next call) returns 403
- State transition: 200 → admin un-publishes MP → 200 → 404

**Constraint enforcement (`test_run_roster_active_constraint.py`):**
- POST `/api/runs/{rid}/students` happy when student is not on another active run of same course
- POST `/api/runs/{rid}/students` 409 returns body `{"detail": "...", "error_code": "student_already_active_in_course", "conflicts": [{"user_id": ..., "email": ..., "run_id": ..., "run_title": "..."}]}` at the TOP LEVEL (assert `body["error_code"]` directly, not `body["detail"]["error_code"]`)
- POST `/api/runs/{rid}/students` 409 user existed in another run; no NEW User row is created or duplicated (G6): pre-count `db.scalar(select(func.count(User.id)).where(User.email == ...))`, call endpoint expecting 409, post-count, assert equal.
- POST `/api/runs/{rid}/students` when target email is a NEW user (no existing User row), the existing flow creates the user normally — assert no 409, 201 succeeds, User row created.
- POST `/api/runs/{rid}/students` 200 when student is on a DRAFT run of same course (only published conflicts)
- POST `/api/runs/{rid}/students` 200 when student is on a published run of a DIFFERENT course
- POST `/api/runs/{rid}/students/batch` all-OK: 3 students, no conflicts → 3 inserts, 0 errors (NOTE: route is `/batch`, not `/bulk`)
- POST `/api/runs/{rid}/students/batch` partial-success: 2 students OK, 1 conflict → 1 row with `result_row.error_code == 'student_already_active_in_course'` (asserts the new field on `RunStudentBatchResultRow`)
- POST `/api/runs/{rid}/students/batch` all-conflict: 3 students, all conflicting → 0 inserts, 3 rows with error_code
- POST `/api/runs/{rid}/publish` 409 ALL-conflicts aggregated: 3 roster students, 2 conflicting on different runs → response body has `conflicts: [{user_id, email, run_id, run_title}, {user_id, email, run_id, run_title}]` (both, not just first)
- POST `/api/runs/{rid}/publish` 200 when no conflicts
- POST `/api/runs/{rid}/publish` checks BEFORE flipping is_published (assert `run.is_published == False` after 409 response)
- POST `/api/runs/{rid}/publish` self-skip: a student already on RunStudent for THIS run is NOT counted as conflict — `find_student_active_conflicts(..., exclude_run_id=rid)` excludes target run
- POST `/api/runs/{rid}/publish` aggregate detail template: response `body.detail` matches singular form for N=1: `"1 student cannot be added — already active in another run of this course."` (G8)
- POST `/api/runs/{rid}/publish` aggregate detail template: response `body.detail` matches plural form for N≥2: `"<N> students cannot be added — already active in other runs of this course."` (G8)

### Frontend wire (`studentMiniProjects.test.ts`, ~180 lines, 12 tests)

- `fetchListSwallow403` returns map on 200
- `fetchListSwallow403` returns `{}` on 403 (NO `emitUnauthorized` called)
- `fetchListSwallow403` propagates 401 (calls `emitUnauthorized` once)
- `fetchListSwallow403` propagates 5xx (F16: no swallow; ApiError thrown)
- `fetchListSwallow403` propagates network/non-ApiError (no swallow)
- `fetchDetail` builds correct URL + returns parsed
- `fetchDetail` 401 → `emitUnauthorized` called + ApiError thrown
- `fetchDetail` 403 → ApiError(403) thrown
- `fetchDetail` 404 → ApiError(404) thrown
- `fetchDetail` network → non-ApiError propagates
- `submit` builds correct multipart POST + returns 201
- `submit` 401 → `emitUnauthorized` + ApiError thrown
- `submit` 409 → ApiError preserved
- `submit` 503 → ApiError preserved

### Frontend component — `MiniProjectLink.svelte.test.ts` (mount/unmount/flushSync — explicit)

Uses the pattern from `MiniProjectModal.publish.svelte.test.ts:1-50`. No `@testing-library/svelte`.

- Renders all 7 statuses with correct label + class + leading token (one assertion per status)
- href is `/courses/{encoded}/blocks/{encoded}/mini-project`
- `aria-label` on link = "Mini-project: {block_title or 'Untitled block'}, Status: {statusLabel}"
- NO `aria-label` on the visual pill (drop confirmed in §5)
- glyph span has `aria-hidden="true"`
- Empty/whitespace `block_title` → link aria-label and visible text both use "Untitled block"

### Frontend component — `MiniProjectDetailPage.svelte.test.ts` (mount/unmount/flushSync — explicit)

7 fixture scenarios:
1. **Empty + grouped + can_submit=true**: submit visible, banner absent.
2. **Pending evaluation**: 1 submission, no eval, banner shows `REASON_LABELS.awaiting_evaluation`.
3. **Accepted**: 2 submissions, last eval result=accepted, history DESC.
4. **Rejected**: 1 submission, eval result=rejected, can_submit=true (fresh initial path).
5. **Minor revision required**: 1 submission, eval result=minor_revision, can_submit=true (resubmit path), section heading = "Submit revision".
6. **Pending group assignment (D4)**: `data.group === null`, friendly banner shown, no submit section, history absent.
7. **Late submission**: history entry shows "Late" pill.

**Submit flow tests:**
- Happy: file pick → submit → mocked 201 → fetchDetail called → state → success → idle on next pick
- 409: mocked 409 → banner "Submission state changed" + fetchDetail called once
- 401: mocked 401 → emitUnauthorized called once
- 503: mocked 503 → "Couldn't submit — retry?" banner with [Retry]
- Network: mocked non-ApiError → same retry banner
- Client-side rejection: non-pdf file → "Only PDF files are accepted." (no POST sent)
- Client-side rejection: 25MB file → "File too large — 20 MB maximum." (no POST sent)

**External-link rewrite tests (F8, L1, M1)** — use `data-testid="assignment-html"` seam:
- Mount with `assignment_html='<p><a href="https://example.com">ext</a><a href="/api/runs/1/assets/x.png">asset</a><a href="mailto:t@x">mail</a></p>'`. After flushSync, `document.querySelector('[data-testid="assignment-html"] a[href="https://example.com"]')` has `target="_blank"` and `rel="noopener noreferrer"`. Same-origin `/api/runs/...` and `mailto:` links UNCHANGED (no `target`, no `rel`).
- **Refetch re-run (N3+P2 test seam):** `data` is page-internal `$state` (set from `fetchDetail` response), NOT a prop, so a parent test cannot mutate it directly. Use the existing visibilitychange refetch path as the seam: (1) mock `fetchDetail` to return INITIAL detail with 1 external link; mount the page. **(2) `await` the initial `fetchDetail` promise completion AND `flushSync()` so `data` is set AND the assignment HTML is rendered with rewritten links BEFORE step 3** (P2 — the §6 step 6 single-flight guard skips refetch if a fetch is in-flight; without explicit await, the visibilitychange dispatch could land mid-initial-fetch and be silently dropped). Assert initial link has `target/rel`. (3) Re-mock `fetchDetail` to return NEW detail with 2 different external links. (4) Use the F19 jsdom seam: `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })`, then `document.dispatchEvent(new Event('visibilitychange'))`. (5) `await` the mocked `fetchDetail` promise; flushSync. (6) Assert NEW links have `target/rel`; OLD link is gone (replaced by Svelte's `{@html}` swap when `data` reassigns). This exercises the real refetch path AND the `$effect` re-run trigger (G5+L1) in one test — no test-only `__test__setData` seam needed.

**State machine:**
- During `submitting`: file input AND submit button both have `disabled` attribute (assert via DOM)
- On `error` from 409: file is still in input (preserved)
- On `success`: file is cleared

**Run-unpublished / asset-deleted mid-session:**
- Initial mount → fetchDetail 200 → renders
- `document.visibilityState` flips: hidden → visible → fetchDetail mocked to throw ApiError(403) → full-page banner "This mini-project is no longer accessible."
- visibility refresh → fetchDetail mocked to throw ApiError(404) → full-page banner "This mini-project doesn't exist or has been unpublished."
- (G2: 422 test deleted)
- Cross-course write-back race (F6): mount on Course A detail; simulate `loadCourse('course-b')` reassigning `currentCourse.value` (test seam: `__test__setSlots`); submit succeeds; assert `currentCourse.value.miniProjectsByBlockId` is UNCHANGED (write-back skipped because slug mismatch).
- Sequence test: dispatch `visibilitychange` while `visibilityState='hidden'` → assert NO fetch. Then flip to `'visible'` + dispatch → assert fetch fires once.
- F19 — jsdom seam for `visibilityState`: use `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' /* or 'hidden' */ });` before dispatching `new Event('visibilitychange')`. Restore the original `Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')` in test teardown.

**aria-live container identity:**
- Render with `awaiting_evaluation` → status change to `accepted` → assert the same DOM node for the live region (test seam: `data-testid="sr-live"`); only text content changed (no re-mount).

### Frontend component — `PublishConflictsModal.svelte.test.ts` (NEW file, F2, I4, ~120 lines, 4 tests, mount/unmount/flushSync)

- 1 conflict (studentCount=1): heading "1 student can't be added"; body cites email + run_title in `<strong>`.
- N conflicts grouped by SAME `run_id` (G3 — not `run_title`): heading "{studentCount} students can't be added"; body shows a single run_title with bullet list of emails under it.
- N conflicts across MULTIPLE distinct `run_id`s: heading "{studentCount} students can't be added"; body shows groups per run_id, each with its run_title heading + emails. Two conflicts on runs with the SAME title but DIFFERENT IDs must render as TWO groups.
- **I4 — Legacy duplicate-user dedupe:** fixture `[{user_id: 1, email: 'a@x', run_id: 10, run_title: 'Spring'}, {user_id: 1, email: 'a@x', run_id: 11, run_title: 'Summer'}]` (same user_id, two run_ids — legacy data). Assert: heading reads "1 student can't be added" (NOT "2 students"); body shows email `a@x` once per group (two groups: Spring + Summer). Validates the `new Set(conflicts.map(c => c.user_id)).size` dedupe logic.
- (G9: 0-conflict modal test removed — parent component never opens the modal with empty `conflicts`.)

### Frontend component — `RosterImportModal.svelte.test.ts` (existing file extension OR new, F15)

- Existing tests preserved.
- NEW test: when `apiError.errorCode === 'student_already_active_in_course'` AND `apiError.detail = "<email> is already active..."`, banner renders with detail verbatim.
- NEW test: when error_code is some OTHER value, falls through to existing handling.

### Frontend component — `BlockGroup.svelte.test.ts` (NEW file, ~120 lines, 5 tests, mount/unmount/flushSync)

- Block with sequences only (no MP in `mpByBlockId`): renders sequence `<li>`s, no MP `<li>` (parity with existing behavior)
- Block with sequences + MP: renders sequences + MP `<li>` AFTER sequences (ordering test, DOM-order assertion)
- Block with no sequences but MP: renders just MP `<li>`
- `mpByBlockId` is undefined (prop omitted) → no MP `<li>` ever
- `mpByBlockId[blockId]` lookup uses string id (`String(block.id)`) — fixture asserts key type

### Manual smoke (§16 runbook addition)

1. Login as student.
2. Navigate to course → expand block with published MP → see "Mini-project: <Block>" link with "Not yet submitted" pill.
3. Click → detail page; see assignment HTML, group context, no history, [Submit] button.
4. Upload PDF → see "Awaiting evaluation" pill (aria-live announces), history shows submission with download link.
5. Teacher (separate terminal) evaluates with result=`rejected` + feedback file.
6. Student tabs back → visibilitychange triggers refetch → see "Rejected" pill, history shows eval.
7. Student submits new PDF (fresh initial path) → "Awaiting evaluation".
8. Teacher evaluates with result=`minor_revision` → student refetches → submits again → see auto-accepted Evaluation in history → "Accepted".
9. Switch to admin: un-publish the run → student refresh → full-page banner "Mini-project is no longer accessible."
10. Switch to admin: try to assign same student to a 2nd published run of same course → see 409 banner with conflicting run name.
11. Try `MATHION_DEBUG=true` PIN; `MATHION_ASSET_PATH=/tmp/mathion-assets/`; `alembic upgrade head` (§16 runbook polish).

## 9. Migration & rollout

**No alembic migration.** No schema changes. The `RunStudent` table already has `UniqueConstraint("run_id", "user_id")` (`models.py:245`); the new invariant is enforced at the application layer via §3.3, not at DB level (would require a partial unique index conditional on `run.is_published`, which sqlite doesn't support).

**Alembic path note (rev 1 correction):** repo path is `backend/alembic/versions/`, not `backend/migrations/versions/`. No new revision file added.

**Rollout:** single PR, single merge. No feature flag. Gates: `MiniProject.is_published`, `Run.is_published`.

**Compat with notifications-email:** email URLs already point to `/courses/<slug>` (per `_student_url` in `notifications/templates.py`). No template churn needed. The just-merged work continues to function identically.

**In-flight runs (rev 1 note carried):** runs with published MPs already running will suddenly show MP links to students — fixes the gap.

**Constraint enforcement & legacy data:** If, at deploy time, a student is already on 2+ published runs of the same course (legacy data), the resolver picks the most-recently-started one with a warning log. The roster endpoints will reject future violations. Existing legacy duplicates are NOT actively cleaned by this slice; an admin tool / one-off script can be a follow-up.

**Rollback:** `git revert`. No data to undo.

## 10. Locked-in decisions

- **D1 — Constraint enforcement in slice**: enforced at three write paths (§3.3). Resolver tolerant of legacy data.
- **D2 — Submission history DESC** (newest first).
- **D3 — Peer emails DROPPED** from `StudentGroupMember`. Names only.
- **D4 — Ungrouped student**: read-only preview. Detail returns 200 with `group=null, can_submit=false, reason="pending_group_assignment"`. List returns `latest_status='pending_group_assignment'`. Link still renders.
- **D5 — Empty state on course view: SILENT** (no banner) — brainstorm-locked.
- **D6 — `can_submit_reason_if_not` is a CODE STRING**, not a human label. Frontend label map.
- **D7 — Evaluator full name visible to students** — brainstorm-locked.
- **D8 — Status pill has leading text token + label** (non-color signal).
- **D9 — `aria-live` is a separate visually-hidden region**, not the visual pill.

## 11. Out of scope

**Route collision note (E10):** the new `/courses/:courseSlug/blocks/:blockSlug/mini-project` is a 4-segment route. `frontend/src/lib/router.svelte.ts:188-201` `matchPattern` requires exact segment count, so no existing route shadows it. Verified during rev 1 self-review; codified here for the implementer.



- Mobile-specific PDF preview (Download is sufficient).
- Reorderable / filterable submission history.
- Per-block published-MP count badge on the courses-list page.
- Teacher-side MP UX inside the course view (this slice is student-only).
- Cleanup of legacy duplicate `RunStudent` rows (separate follow-up).
- i18n / l10n of `REASON_LABELS` (English only this slice).
- Visibilitychange-debounce beyond the single-flight guard.

## 12. Self-review notes

- Verified `_resolve_student_run` against `models.py:191-258` (Run, RunStudent, version FK) + F18 (`Run.start_date` non-nullable at `models.py:197`).
- Verified `_resolve_block` against `models.py:57-61` — `Block.slug` unique per `(version_id, slug)`, so version-scoped query is correct.
- Verified `can_submit` ladder against `submissions.py:53-104` line by line; ORDER matches POST exactly (visibility → group → disabled → accepted → pending → initial-deadline → resubmission-deadline).
- Verified `find_student_active_conflicts` + `make_already_active_409_body` — `Run.is_published == True` + `Run.id != excluded` covers add + batch + publish cases. F4: no `assert_student_not_active_elsewhere` exists; the two concrete helpers are the only API.
- Verified `assignment_html` sanitation chain: `mini_projects.py:96-101, 180-182` → `helpers.py:424-462` → `markdown.py:7-49` (`nh3.clean` with raw HTML disabled). F8: `rewriteExternalLinks` adds `target/rel` post-mount.
- Verified `nh3.clean` strips `<script>`, event-handlers, `<iframe>`. `{@html}` safe.
- Verified `_display_name` policy (F9) — email local-part fallback, deliberate UX choice not security control.
- Verified `App.svelte` componentMap layout (lines 21-32, 66-69). New entry needed.
- Verified `routes.ts` route pattern accepts multi-param routes (precedent in editor routes).
- Verified `currentCourse.svelte.ts:53` stale-write guard runs after all `Promise.all` results — 3-element tuple `[content, state, miniProjectsByBlockId]` (F20: "3rd parallel fetch added to existing 2-fetch", NOT "4th").
- Verified `MiniProjectModal.publish.svelte.test.ts` for mount/unmount/flushSync pattern; project-rule citation OK.
- Verified `RunStudentCreate.email` normalized to `.strip().lower()` at `schemas.py:457-460` (F13).
- Verified existing `run_unpublished` 409 pattern at `run_roster.py:60-63` for `JSONResponse` shape consistency (F12).
- Verified existing batch `except HTTPException` branch at `run_roster.py:180-182` writes `{email, status, detail}` only — F1 fix bypasses this branch by appending result rows BEFORE the existing exception path.

## 13. Notes for reviewers (rev 5)

Rev 5 incorporates 5 review rounds (R1 5 Opus + codex, R2 4 Opus + codex, R3 3 Opus). Outstanding for the next reviewer/codex pass:

1. **F1 — batch short-circuit:** does the implementer have enough detail to wire the "append result row directly, skip exception path" approach? Verify against `run_roster.py:155-189` (the per-row loop).
2. **F2 — PublishConflictsModal:** does the modal need additional context props beyond `conflicts[]`? Current spec: `{ open, conflicts, onClose }`. Any state the parent should pass?
3. **F3 — `ApiError.body`:** verify backwards compatibility — does extending `ApiError` constructor with optional `body` arg break any existing throws elsewhere in `api.ts`?
4. **F4 — helper rename:** `find_student_active_conflicts` + `make_already_active_409_body` are the ONLY constraint helpers. Verify §2, §3.3, §8, §12, §13 are all consistent. No `assert_student_not_active_elsewhere` anywhere.
5. **F8 — external-link rewriter:** does `rewriteExternalLinks` need a MutationObserver to handle dynamic `assignment_html` updates? Or is one-shot post-mount enough?
6. **F10 — `is_disabled` field:** does it conflict with any existing Group-shape consumers? Should it be on a separate object or inline on `StudentGroupSummary`?
7. **F16 — 5xx behavior:** if a deployment has `/mini-projects` 502 for a minute (deploy in progress), every student loading the course view sees the page-level error. Acceptable? Or should we add a soft-retry?

Rev 5 changelog F1-F20 enumerates concrete edits. Next round verifies these against actual source + flags any new gaps.
