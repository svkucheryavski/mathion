# Duplicate Version — Design Spec

**Date:** 2026-07-07
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Author:** brainstorm with Claude

## Goal

Let a CourseAdmin **duplicate any existing version of a course into a fresh editable draft** (`state="created"`), so they can revise a released course and publish it as the next version — without hand-rebuilding the content tree. Today `create_version` produces an *empty* version (it copies assets only, never content), so iterating on a published course means recreating every block/sequence/item by hand.

## Primary use case

**Iterate on a released course:** duplicate a published (or archived) version → fresh draft → revise → publish as the next version. Source may also be a draft (branch a work-in-progress) or a disabled version; the copy engine is identical regardless of source state.

## Decisions (locked during brainstorm)

1. **Use case:** iterate on a released course (source = typically published/archived; any state allowed).
2. **Version label:** add an **optional** human label to `CourseVersion` (small migration). Editable while `state=="created"` only (consistent with existing meta rules); a published version displays the label it carried at publish. No post-publish relabeling in v1.
3. **Entry point:** a **per-row Duplicate button** on the version list (`VersionsPage`) that prompts for the new draft's label. The existing "+ New version" empty-create form stays.
4. **Clone engine:** a **dedicated `POST /api/versions/{id}/duplicate` endpoint** plus an extracted shared asset-copy helper and a new content-clone service, reusing the existing render/reference helpers.

## Scope

**In scope**
- Deep copy of the full version content tree: `Block → Sequence → Item` (all four types: static_page, video, interactive_app, quiz) `→ Question → AnswerOption`.
- Version meta (`info_md`, `max_quiz_attempts`) and uploaded **assets** (DB rows + disk files).
- New optional `label` on `CourseVersion`.
- Per-row Duplicate button on the version list; label surfaced in the list + version header + version meta form.

**Out of scope (deliberate)**
- Runs, groups, students, mini-projects, submissions, evaluations — all run-scoped, so a duplicate starts with none (clean draft, no student data).
- Cross-course duplication.
- Async/background processing (course sizes are small — ~4–5 blocks × 3–4 sequences — so synchronous is fine).
- Post-publish relabeling.

**Non-destructive:** the source version is untouched.

## Global constraints (project-wide)

- **Backend:** invoke pytest/alembic/python via `backend/.venv` only. No new backend deps.
- **Frontend:** Svelte 5 runes only; no new JS/CSS deps; component tests use `mount`/`unmount`/`flushSync`/`tick` from `svelte`, not `@testing-library`.
- **Never stage** these three pre-existing untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`. Never `git add -A` — explicit paths only.

## Data model change

Add to `CourseVersion` (`mathion/models.py`):

```python
label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
```

- Mirrors the `info_md`/`info_html` "empty-string, not-null" pattern.
- One Alembic migration adds the column with server default `""` (existing rows backfill to empty).
- Surfaced in `VersionResponse`. Accepted (optional) by `VersionCreate` and the new duplicate request. Editable via `update_version` while `state=="created"` (add `label` to the same created-only meta gate at `versions.py:101`).

## Backend clone engine

### Endpoint

`POST /api/versions/{version_id}/duplicate` → **201**, body `{ "label"?: string }` (trimmed, ≤200 chars), returns `VersionResponse` for the new draft. `require_course_admin(source.course_id)`.

### Extracted / new units

Both clone functions live in a **new module `mathion/api/version_clone.py`** (keeps the already-oversized `helpers.py` from growing — it's a Phase 9 split candidate). The `/duplicate` endpoint itself is added to `versions.py` alongside `create_version`, calling into this module.

1. **`copy_version_assets(db, src_version_id, dst_version_id, uploaded_by) -> None`** — lifted verbatim from `create_version` (`versions.py:49-79`): preflight that every source file exists (else rollback + 500) → `makedirs(dest)` → per asset: insert `Asset` row (same `filename`/`file_size`/`mime_type`, `uploaded_by=<duplicating admin>`) + `shutil.copy2`. Refactor `create_version`'s `copy_assets_from` path to call it (no behavior change; regression-tested).

2. **`clone_version_content(db, source: CourseVersion, new: CourseVersion) -> None`** — deep-copies the tree (below).

### Order of operations (single transaction)

1. Insert `CourseVersion(course_id=source.course_id, state="created", is_disabled=False, label=<body or "">, info_md=source.info_md, info_html="", max_quiz_attempts=source.max_quiz_attempts)`; `flush()`.
2. Quota check (mirror `create_version`): `sum(Asset.file_size where version_id==source.id)`; if `> settings.max_course_size` → **400**.
3. `copy_version_assets(db, source.id, new.id, user.id)` — assets exist **before** any render.
4. Version info: `new.info_html = render_with_assets(db, new.id, new.info_md)`; `sync_asset_references(db, new.id, [new.info_md], {"info_version_id": new.id})`.
5. `clone_version_content(db, source, new)` — for each **Block** (ordered) → **Sequence** → **Item** → **Question** → **AnswerOption**, insert-and-`flush()` to obtain fresh ids, then:
   - **Verbatim copy** (no version-scoped assets — verified: blocks render via plain `render_markdown`, and `AssetReference` has no `block_id`):
     - Block: `title`, `slug`, `order`, `info`, `info_html`
     - Sequence: `title`, `slug`, `order`
     - Item base: `title`, `slug`, `order`, `type`, `video_url`
     - AnswerOption: `text`, `is_correct`, `order`
   - **Re-render + ref-sync** (version-scoped assets):
     - **static_page** Item: copy `content_md`; `content_html = render_with_assets(db, new.id, content_md)`; `sync_asset_references(db, new.id, [content_md], {"item_id": ni.id})`
     - **interactive_app** Item: copy `script_url`; `sync_script_reference(db, new.id, ni.id, script_url)` (asset already copied → repoints; the `filename`-given path never GCs)
     - **video** Item: nothing beyond `video_url`; `content_html` stays null
     - **Question**: copy `text_md`, `type`, `order`, `explanation_md`, `correct_numeric`, `precision`, `correct_text`; `text_html = render_with_assets(db, new.id, text_md)`; `explanation_html = render_with_assets(db, new.id, explanation_md)`; `sync_asset_references(db, new.id, [text_md, explanation_md], {"question_id": nq.id})`
6. `commit()`, `refresh(new)`, return.

### Why correct

- **Slugs copy verbatim** — uniqueness (`uq_block_version_slug`, `uq_sequence_block_slug`, `uq_item_sequence_slug`) is scoped to the new (empty) version/block/sequence, so no collisions.
- `render_with_assets` resolves against the just-copied assets → every `_html` URL and every `AssetReference` points at the **new** version's asset ids; no cross-version leakage.
- All rendering/reference logic is the **existing, proven** code path from `create_version`/`items.py`/`questions.py`; the clone only orchestrates it.

### Verified helper signatures

- `render_with_assets(db, version_id: int, content_md: str | None) -> str` (raises 422 if a referenced asset is absent in the version).
- `sync_asset_references(db, version_id: int, content_mds: list[str | None], owner: dict) -> None` — `owner` is exactly one of `{"item_id": x}` / `{"question_id": x}` / `{"info_version_id": x}`; deletes that owner's existing rows, then adds rows for every referenced filename present as an `Asset` in `version_id`.
- `sync_script_reference(db, version_id: int, item_id: int, filename: str | None) -> list[str]` — delete-then-add; GCs the script asset only when `filename` is None (clear/remove). Clone always passes a filename, so no GC.

## Errors & edge cases

- **403** non-admin (teacher included) via `require_course_admin`.
- **404** missing source.
- **400** source assets over `settings.max_course_size` (near-impossible for a same-size copy; mirrored for parity).
- **500** + rollback if a source asset file is missing on disk (preflight in `copy_version_assets`).
- **Empty source** (no blocks) → empty draft, **201** (not an error).
- **Disabled source** → allowed; the copy is a fresh *enabled* draft.
- **Multiple drafts allowed** — no "one draft per course" invariant exists today (`create_version` permits many); Duplicate is consistent. A course may hold several drafts; the admin deletes extras. (Conscious choice.)
- **Transactionality:** whole clone in one transaction. Pre-existing risk shared with `create_version`: disk files are copied before commit, so a post-copy commit failure orphans files — **mirror** `create_version` (no new cleanup); belongs to the Phase 9 "file-write-before-commit" backlog item.
- **Assumption:** source content only references assets that exist (always true for app-authored content); a dangling ref would surface as 422 from `render_with_assets`.

## Frontend

- **`VersionsPage.svelte`:** add a **Duplicate** action to each version row (all states; most useful on published/archived). Reveals a small inline label field (reusing the existing `.create` inline-form pattern) prefilled with `Copy of {source.label || 'v'+id}` → `POST /api/versions/{id}/duplicate {label}` → on success `navigate('/courses/{slug}/edit/v/{newId}')` + success toast; on error toast `ApiError.displayMessage`. Uses the existing `busy` single-in-flight guard.
- **List display:** show `label` beside `v{id}` + state badge when non-empty (e.g. `v23 · published · Spring 2026`).
- **Meta editing:** add `label` to the version meta form (`VersionMetaForm`/`VersionEditPage`), editable while `state==="created"`. Also add an optional `label` to the "+ New version" empty-create form (`VersionCreate`) so every creation route can set one.
- **Types:** extend `Version` + `VersionResponse` + `VersionCreate` (optional `label`) + a duplicate-request type.

## Testing

**Backend (pytest via `.venv`) — copy fidelity.** Source with all four item types (static_page with an embedded image asset, video, interactive_app with a JS asset, quiz with numeric + single-choice + multiple-choice questions + options), version `info_md` referencing an asset, and a block with `info`. Duplicate, then assert:
- New version: `state="created"`, `is_disabled=False`, `label` set, distinct id, same `course_id`.
- Tree counts + ordering + field values identical (titles, slugs, types, `correct_numeric`/`precision`/`correct_text`, `is_correct`, `video_url`, `script_url`).
- `content_html`/`text_html`/`info_html` URLs reference the **new** version id, not the source.
- `AssetReference` rows exist for the new items/questions/version-info and point at the **copied** assets (new asset ids).
- Asset files present on disk under `courses/{new_id}/`.
- **Source unchanged** (counts + a spot field value).
- **No runs / mini-projects** created.

**Backend — errors:** 403 non-admin; 404 missing source; 400 over-quota (lower `max_course_size` in-test); empty-source → empty draft. Plus a **regression** test that `create_version`'s `copy_assets_from` still works after the helper extraction.

**Frontend (vitest, `mount`/`flushSync`):** Duplicate button POSTs to `/api/versions/{id}/duplicate` with the label and navigates to the new editor + toasts; label-prefill default; label renders in the version row; `VersionMetaForm` label edit (created-only).

## Open questions / assumptions

- None blocking. Label editability is intentionally created-only for v1. Orphan-on-rollback disk risk is intentionally deferred to Phase 9 (parity with existing code).
