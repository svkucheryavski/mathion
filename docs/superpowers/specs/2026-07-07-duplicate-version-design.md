# Duplicate Version — Design Spec

**Date:** 2026-07-07
**Status:** Approved (brainstorm complete) — rev 4, converged after three review rounds (5 + 4 + 3 independent reviewers, round 3 unanimous APPROVE) **and a codex second opinion (APPROVE, one Minor folded in)**. Ready for the implementation plan pending user sign-off + the disabled-source decision.
**Author:** brainstorm with Claude

## Revision log

- **rev 4** — third review round (3 reviewers, **unanimous APPROVE = convergence**). Only Minor polish, no design change: (1) quota `SUM` wrapped in `coalesce(...,0)` so an empty source doesn't 500 the documented empty-source→201 path; (2) `db.refresh(new); return new` pinned **outside** the step-4 try (a post-commit refresh failure must not trigger the abort `rmtree`); (3) frontend-types bullet corrected — only `Version`+`AdminTreeVersion` exist (no frontend `VersionResponse`/`VersionCreate`/duplicate type; POST bodies are inline untyped); (4) `collect_referenced_filenames(db, source)` call arg aligned; (5) `sentLabel` race-pin note for `VersionMetaForm`.
- **rev 3** — second review round (4 reviewers; near-convergence, one APPROVE). Fixes: (1) **on-abort cleanup captures `new_id` as a plain int after flush** (avoids relying on `new.id` post-`rollback`) and the **try/except now covers `commit()`** too (a commit failure previously left copied files orphaned); (2) **`VersionUpdate.label` strip validator None-guards** so an explicit `label=null` no-op can't `AttributeError`→500; (3) **the `/duplicate` body param is defaulted** (`= VersionDuplicateRequest()`) so an omitted body yields 201 with `label=""` (a required body would 422); (4) preflight skips `script_url=None`; (5) prefill clamped to 200 chars in JS (HTML `maxlength` doesn't bound a bound value); (6) misc test/wiring tightening (byte-equality assertion, 409 test deletes a *referenced* asset, header renders `{label}`, extra fixtures enumerated, rollback ownership pinned).
- **rev 2** — first review round (5 reviewers, all found issues; all verified against code). Material changes: item clone copies `content_md` for every non-`interactive_app` type; disabled source blocked (403); whole-tree asset preflight before any disk write; best-effort cleanup of the new version's dir on abort; full `label` wiring across every surface incl. the hand-built admin-tree serializer; validation/per-row-state/tests pinned. Non-blocking risks (course-wide disk cap, Postgres torn-read, rowid-reuse dir, existence oracle) documented + routed to Phase 9.

## Goal

Let a CourseAdmin **duplicate an existing version of a course into a fresh editable draft** (`state="created"`), so they can revise a released course and publish it as the next version — without hand-rebuilding the content tree. Today `create_version` produces an *empty* version (copies assets only, never content).

## Primary use case

**Iterate on a released course:** duplicate a **published** (or **archived**) version → fresh draft → revise → publish as the next version. A **draft** source is also allowed (fork a WIP). A **disabled** source is **rejected** (403).

## Decisions

1. **Use case:** iterate on a released course (source typically published/archived).
2. **Version label:** optional human label on `CourseVersion` (small migration). Editable while `state=="created"` only; a published version displays the label it carried at publish (no post-publish relabeling in v1).
3. **Entry point:** a **per-row Duplicate button** on the version list (`VersionsPage`) prompting for the new draft's label. The existing "+ New version" empty-create form stays.
4. **Clone engine:** a **dedicated `POST /api/versions/{id}/duplicate` endpoint** + an extracted shared asset-copy helper + a new content-clone service, reusing existing render/reference helpers. Both new functions live in a **new module `mathion/api/version_clone.py`** (keeps the oversized `helpers.py` from growing); the endpoint is added to `versions.py`.
5. **Disabled source blocked (403):** matches every other admin op and `serve_asset`'s admin-403-on-disabled. Enable first (unguarded) to fork a disabled version. Archived (not disabled) sources remain allowed.

## Scope

**In scope**
- Deep copy of the full content tree `Block → Sequence → Item` (all four types) `→ Question → AnswerOption`, every meaningful column.
- Version meta (`info_md`, `max_quiz_attempts`) and uploaded **assets** (DB rows + disk files).
- New optional `label` on `CourseVersion`, wired through every read/write surface.
- Per-row Duplicate button; label in the list + **version header** + version meta form.

**Out of scope (deliberate)**
- Runs, groups, students, mini-projects, submissions, evaluations — all run-scoped; a duplicate starts with none (verified: content models have no relationship into run data; clone uses manual field-by-field inserts, never cascade copies).
- Cross-course duplication (structurally impossible: no target-course param; new version written under `source.course_id`).
- Async/background processing; post-publish relabeling; a course-wide disk cap (Phase 9).

**Non-destructive:** the source version — rows, `AssetReference`s, on-disk files — is untouched.

## Global constraints (project-wide)

- **Backend:** pytest/alembic/python via `backend/.venv` only. No new backend deps.
- **Frontend:** Svelte 5 runes only; no new JS/CSS deps; component tests use `mount`/`unmount`/`flushSync`/`tick` from `svelte`, not `@testing-library`.
- **Never stage** these three untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`. Never `git add -A` — explicit paths only.

## Data model change (version label)

Add to `CourseVersion` (`mathion/models.py`):

```python
label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
```

- Mirrors the `info_md`/`info_html` empty-string-not-null pattern. **Alembic migration** adds it with `server_default=""` (backfills existing rows); SQLite needs `batch_alter_table`.
- **Wiring — every surface (each implemented + tested):**
  - `VersionResponse` (`schemas.py`): add `label: str` — **required, non-null** (column never NULL; verified no manual `VersionResponse(...)` construction exists — all producers are ORM `from_attributes`).
  - `VersionCreate` (`schemas.py`): add `label: str = ""` (optional); wire `label=data.label` into the `CourseVersion(...)` constructor in `create_version` (`versions.py:40-45`).
  - `VersionUpdate` (`schemas.py`): add `label: str | None = None`. In `update_version` the existing `{k: v … if v is not None}` filter (`versions.py:104`) already lets `label=""` (explicit clear) through and no-ops `null`/omitted. There is **no generic assignment loop** — each field has its own explicit branch (`versions.py:107,111`), so add a parallel one: `if "label" in updates: version.label = updates["label"]`.
  - **`VersionDuplicateRequest`** (new schema): `label: str = ""`.
  - **Validation:** `Field(max_length=200)` + a shared **strip** validator on `VersionCreate.label`, `VersionUpdate.label`, `VersionDuplicateRequest.label`. The validator MUST **None-guard** (`mode="before"`, `return v.strip() if isinstance(v, str) else v`) so `VersionUpdate.label=None` (the no-op/clear path) doesn't `AttributeError`→500. Order: **strip before** the length check (a 201-char value with trailing spaces should pass after trim). `field_validator` is already an established pattern (`schemas.py:104,147`).
  - **Admin-tree serializer** (`content.py:132-144`, the hand-built dict behind `get_admin_tree`): add `"label": version.label`. This is the `AdminTreeVersion` the version **header** (`VersionEditPage.svelte:298`) and **meta form** (`VersionMetaForm.svelte`) read. The student tree dict (`content.py:66-76`) is correctly excluded. `list_versions` (`versions.py:134`) returns `list[VersionResponse]` → auto-includes label, no edit.
  - **Frontend types:** only `Version` (the `VersionResponse` mirror) and `AdminTreeVersion` exist in `types.ts` — there is no frontend `VersionResponse`/`VersionCreate`/duplicate-request type (both POST bodies are inline untyped literals; `api.post` body is `unknown`). Add **required** `label: string` to `Version`; `AdminTreeVersion = Version & {…}` (`types.ts:220`) cascades it automatically. **Fixture budget:** the required `label` cascade — update fixtures in `versionsPageLoader.test.ts`, `currentEditorVersion.test.ts`, `deriveExpansion.test.ts`, `QuizEditor.svelte.test.ts`, `ItemEditPage.interactive.svelte.test.ts`, `SequenceAccordion.interactive.svelte.test.ts` (svelte-check gates this; no production literal constructs a `Version`).
  - **`VersionMetaForm`:** add `label` to its `makeDirtyTracker<Meta>` `Meta` type, all four `tracker.reset(...)`/`discard()` sites, and the PATCH body; editable via the existing `perms.canEditVersionMeta` (created-only) gate. Mirror the existing race-pin (`sentInfoMd`/`sentAttempts`) with a `sentLabel` feeding both the PATCH body and the refresh-failed reset (functionally optional — inputs are `disabled` while `busy` — but keeps the pattern uniform).
- **XSS note:** render `label` only as escaped Svelte text (`{label}`) — never `@html`, never through `render_markdown`/`render_with_assets`. (Verified: every existing `@html` site renders `info_html`/`content_html`/`text_html`/`explanation_html`/`assignment_html`, none near label.)

## Backend clone engine

### Endpoint

`POST /api/versions/{version_id}/duplicate` → **201**, body **`data: VersionDuplicateRequest = VersionDuplicateRequest()`** (defaulted, so an omitted/empty body yields `label=""` and 201 — a non-defaulted required body would 422), returns `VersionResponse`.
- `source = get_or_404(CourseVersion, version_id)`; `require_course_admin(source.course_id)` → **403**.
- **`if source.is_disabled: raise 403`** (Decision 5).
- Source may be `created` / `published` / `archived`.

### New module `mathion/api/version_clone.py`

1. **`copy_version_assets(db, src_version_id, dst_version_id, uploaded_by) -> None`** — lifted from `create_version` (`versions.py:49-79`): preflight every source file exists (**raise on missing; the caller owns rollback — see below**) → `makedirs(dest)` → per asset insert `Asset` row + `shutil.copy2`. Refactor `create_version`'s `copy_assets_from` path to call it. **Rollback ownership:** the helper does NOT roll back internally; each caller owns it — the `/duplicate` endpoint via its step-4 try/except (below), and `create_version` by keeping its existing `db.rollback(); raise` at the call site (preserves "no behavior change" for the missing-file 500 path).
2. **`collect_referenced_filenames(db, source) -> set[str]`** — aggregate every referenced filename: `source.info_md`; each item `content_md`; each question `text_md` + `explanation_md` (via `markdown.extract_asset_filenames`); each `interactive_app` item's `script_url` **when non-None** (skip `None`). Used by the preflight.
3. **`clone_version_content(db, source, new) -> None`** — deep-copies the tree.

### Order of operations (single transaction, cleanup-wrapped)

1. **Quota check** (before allocating an id, parity with `create_version`): `func.coalesce(func.sum(Asset.file_size), 0)` over `version_id==source.id` `> settings.max_course_size` → **400**. The `coalesce(...,0)` is load-bearing — an empty source's `SUM` is `NULL`→`None`, and `None > int` would 500 the documented empty-source path (matches `create_version` at `versions.py:29-34`).
2. **Asset preflight:** `missing = collect_referenced_filenames(db, source) − {source Asset filenames}`; if non-empty → **409** with the missing names, **before any disk write**. Closes the dangling-ref case (a published source can lose an asset via `delete_asset(force=True)`, which gates only `is_disabled`, not `state`) so `render_with_assets` can't 422 mid-clone.
3. Insert `CourseVersion(course_id=source.course_id, state="created", is_disabled=False, label=<body>, info_md=source.info_md, info_html="", max_quiz_attempts=source.max_quiz_attempts)`; `flush()`; **capture `new_id = new.id` (plain int)** for cleanup. (Timestamps default fresh; `published_at`/`archived_at` NULL.)
4. **`try:` steps 4.x AND step 5 `commit()`; `except: db.rollback(); shutil.rmtree(os.path.join(asset_path,'courses',str(new_id)), ignore_errors=True); raise`.** Using the captured int `new_id` (not `new.id`, which may be reset by `rollback`) and covering `commit()` (a commit failure — e.g. Postgres serialization_failure, disk-full at checkpoint — otherwise orphans the copied files). `courses/{new_id}/` is the clone's exclusive dir, so cleanup can never touch a sibling.
   1. `copy_version_assets(db, source.id, new.id, user.id)`.
   2. Version info: `new.info_html = render_with_assets(db, new.id, new.info_md)`; `sync_asset_references(db, new.id, [new.info_md], {"info_version_id": new.id})`.
   3. `clone_version_content(db, source, new)` — for each **Block** (ordered) → **Sequence** → **Item** → **Question** → **AnswerOption**:
      - Insert-and-`flush()` **parents** (block/sequence/item/question) for child ids; **`AnswerOption` is a leaf** → add without per-row flush (flush once per question / at end).
      - **Verbatim copy** (no version-scoped assets — blocks render via plain `render_markdown` at `blocks.py:81,174`; `AssetReference` has no `block_id`): Block `title/slug/order/info/info_html`; Sequence `title/slug/order`; Item base `title/slug/order/type/video_url`; AnswerOption `text/is_correct/order`.
      - **Item content (single branch):**
        - **`interactive_app`**: copy `script_url`; set `content_html=""`; `sync_script_reference(db, new.id, ni.id, script_url)` (`script_url` may be `None` → safe no-op). Do NOT call `sync_asset_references` (would wipe the script ref).
        - **all other types** (static_page, video, quiz): copy `content_md`; `content_html = render_with_assets(db, new.id, content_md)` (returns `""` for `None`, matching `create_item`); `sync_asset_references(db, new.id, [content_md], {"item_id": ni.id})`. (Rationale: `content_md` is permitted on video/quiz — `schemas.py:113-121` forbids it only for `interactive_app`; `items.py:19,87,171` render it unconditionally. A static-page-only branch drops authored markdown, leaves `content_html` NULL vs `""`, and skips the item's refs.)
      - **Question**: copy `text_md/type/order/explanation_md/correct_numeric/precision/correct_text`; `text_html = render_with_assets(db, new.id, text_md)`; `explanation_html = render_with_assets(db, new.id, explanation_md)`; `sync_asset_references(db, new.id, [text_md, explanation_md], {"question_id": nq.id})`.
5. `commit()` — **the last statement inside the step-4 try**. Then, **outside** the try/except: `db.refresh(new); return new`. (Refresh/return MUST NOT sit inside the try: `commit()` already succeeded, so a refresh failure there would run the `except`'s unconditional `rmtree(courses/{new_id})` and delete a committed version's files, orphaning committed `Asset` rows against a missing dir.)

### Why correct

- **Slugs copy verbatim** — uniqueness is scoped to the fresh (empty) new version/block/sequence → no collision.
- `render_with_assets` resolves against the just-copied assets → every `_html` URL + `AssetReference` points at the **new** version's asset ids; no cross-version leakage. Only block `info_html` is copied verbatim, and block html has no asset URLs.
- **`sync_script_reference` cannot GC a copied asset** — a freshly-flushed `ni` has an **empty prior-reference set**, so its delete/GC loop acts on nothing (the GC loop *does* run with a non-None filename; the empty prev-set is what makes it safe).
- A duplicated draft of a *publishable* source is itself publishable (every `publish_version` completeness check maps to a copied column — verified).

## Errors & edge cases

- **403** non-admin; **403** disabled source. **404** missing source. **400** over-quota. **409** asset preflight failure (source references a filename with no backing `Asset`). **500** + rollback if a source file is missing on disk.
- **409 vs 422 note:** the preflight returns **409 Conflict** ("the source's asset set conflicts with its saved content — cannot duplicate"), distinct from `render_with_assets`'s 422 for the same missing-asset class; the preflight fires first so clients only ever see the 409. (Rationale stated so the two codes for one condition aren't mistaken for a bug.)
- **Cleanup on abort AND commit failure:** the step-4 try/except (`db.rollback()` + `shutil.rmtree(courses/{new_id})`, using the captured int) covers mid-copy IO errors, residual render errors, and `commit()` failure.
- **Empty / degenerate sources** → empty-child draft, **201**. **interactive_app `script_url=None`** → safe no-op. **Multiple drafts allowed** (no one-draft invariant today).

**Known non-blocking risks — routed to Phase 9 (documented, not solved):**
- **No course-wide disk cap** — `max_course_size` is per-version; unlimited drafts × full-asset copy = unbounded course disk (shared volume). Parity with existing `create_version(copy_assets_from)`; backlog: per-course aggregate byte cap and/or draft-count cap.
- **Postgres torn read** — clone reads the source tree piecewise interleaved with inserts; SQLite serializes today (safe); under Postgres READ COMMITTED a concurrent source edit mid-clone could tear → run under REPEATABLE READ / snapshot ids up front when migrating.
- **rowid reuse** — `CourseVersion.id` is a plain SQLite rowid; `delete_version` does no disk cleanup, so `courses/{reused_id}/` may hold a deleted version's files a new version inherits. On-abort `rmtree` partially mitigates; consider disk cleanup in `delete_version`.
- **404-vs-403 existence oracle** on `get_or_404`→`require_course_admin` (systemic; accept as parity).

## Frontend

- **`VersionsPage.svelte`:** per-row **Duplicate** action (non-disabled rows only — matches the backend 403). Per-row inline state (NOT the page-singleton `.create` pattern):
  - `duplicatingId: number | null` (single-open invariant) + `dupLabel: string`.
  - Opening a row recomputes the prefill and **clamps it to 200 chars in JS**: `dupLabel = ('Copy of ' + (v.label || 'v'+v.id)).slice(0, 200)` (HTML `maxlength="200"` bounds typing, not a bound value). `maxlength="200"` also set on the input.
  - Submit → **pin `savedSlug` (and `savedId=v.id`) before the await** (prop-change-mid-await guard, mirroring `createVersion` at `VersionsPage.svelte:64-69`) → `POST /api/versions/{savedId}/duplicate {label: dupLabel}` → success: `navigate('/courses/{savedSlug}/edit/v/{newId}')` + toast; **error: toast `ApiError.displayMessage`, no navigate**. Reuses the `busy` guard.
- **List display:** `{v.label}` beside `v{id}` + state badge when non-empty (escaped text).
- **Version header:** render `{v.label}` in the header (`VersionEditPage.svelte:298` `<h1>`) when non-empty.
- **Meta editing:** `label` in `VersionMetaForm` (tracker `Meta` + reset/discard sites + PATCH body), created-only.
- **Empty-create form:** optional `label` input on "+ New version".

## Testing

**Backend (pytest via `.venv`) — copy fidelity.** Source with all four item types — **including a `video` item and a `quiz` item that each carry `content_md` with an embedded image asset** — plus static_page with an image, interactive_app with a JS asset, quiz with numeric + single-choice + multiple-choice questions + options, version `info_md` referencing an asset, and a block with `info`. Duplicate, then assert:
- New version `state="created"`, `is_disabled=False`, `label` set, distinct id, `new.course_id == source.course_id`, no copied row carries a source-scoped id.
- Tree counts + ordering + field values identical (incl. `content_md`/`content_html` on video/quiz items, `correct_numeric`/`precision`/`correct_text`, `is_correct`, `video_url`, `script_url`).
- `content_html`/`text_html`/`info_html` URLs reference the **new** version id.
- `AssetReference` rows for new items/questions/version-info point at the **copied** assets; **interactive_app: assert the new item's script ref points at the NEW JS `Asset.id`**.
- Asset files on disk under `courses/{new_id}/`; **assert byte-equality** of at least one copied file (not just existence, not size).
- **Source unchanged:** counts + a spot field **and** the source's `AssetReference` rows + on-disk files intact (interactive_app source script ref/asset/file survive — no GC).
- **No runs / mini-projects** created.

**Backend — errors & defaults:** 403 non-admin; 403 disabled source; 404 missing source; 400 over-quota (lower `max_course_size` in-test); **409 dangling-asset source** — force-delete an asset **that the source content references** on a published source, then duplicate → clean 409, **no orphaned `courses/{new_id}/` dir**; empty-source → empty draft; **omitted body → 201, `new.label == ""`** (relies on the defaulted body param); label >200 chars → 422 (not 500). Plus a **regression** test that `create_version`'s `copy_assets_from` still works after the extraction (incl. its missing-file 500 rollback path).

**Frontend (vitest, `mount`/`unmount`/`flushSync`):** Duplicate POSTs to `/api/versions/{id}/duplicate` with the label + navigates + toasts; **error path (fail → toast, no navigate)**; label-prefill default (+ clamp); per-row single-open (opening one row doesn't open others / bleed prefill); label renders in the row + header; `VersionMetaForm` label edit (created-only).

## Decisions (all settled)

- **Disabled-source blocking (Decision 5) — RESOLVED: block with 403.** The user confirmed (2026-07-08) that duplicating a disabled version returns **403**, for consistency with every other admin op and to avoid the `serve_asset` admin-403-on-disabled asymmetry. To fork a disabled version, enable it first (enable is unguarded); archived-but-not-disabled sources remain allowed.
- Everything else is settled; non-blocking risks are documented + routed to Phase 9.
