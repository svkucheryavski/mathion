# Course Archive — Part 1: Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A course admin downloads any version of a course as `<course-slug>-v<id>.tar.gz` holding `mathion-course.json` and `assets/<filename>`.

**Architecture:** A new `mathion/archive/` package owns the format (`format.py`, pydantic models Part 2 will also validate with) and the export (`export.py`: build the document, preflight the files, stream the tar.gz). A new router `api/version_archive.py` serves a JSON check and the streamed archive. The Versions page gets a Download slot that runs the check, then hands the archive URL to the browser.

**Tech Stack:** FastAPI, SQLAlchemy, stdlib `tarfile`/`json`; Svelte 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-course-archive-design.md` (sections "The archive" and "Download"; Part 2 = "Upload", its own plan later).

## Global Constraints

- No new Python or JavaScript dependencies.
- Python only via `backend/.venv`. One-line code comments.
- The archive never holds rendered HTML, database ids, timestamps, states, `uploaded_by`, or anything about runs or people.
- `format` is the integer `1`; `made_by` is `settings.version`.
- File name: `<course-slug>-v<version-id>.tar.gz` (course slugs match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, `schemas.py:26`, so it is header-safe).
- Any version downloads: draft, published, archived, disabled. Course admins of the course (and the superuser, via `require_course_admin`) only.
- No full copy of the archive on disk or in memory; at most one file's compressed bytes are buffered at a time (the site's per-file cap, at most 50 MB).

## Review Focus

1. A file removed from disk after the check but before it is streamed → the stream stops with an error (the browser shows a failed download); it never sends a truncated or zero-filled entry. Test in Task 2 (`test_stream_stops_when_a_file_vanishes`).
2. Non-ASCII titles, Markdown and file names survive byte-for-byte (JSON written as UTF-8, `ensure_ascii=False`). Test in Task 1 (`test_document_keeps_unicode`).
3. A draft edited while its archive is built → text and file list come from one moment. As built: one REPEATABLE READ snapshot instead of `lock_draft` (asset upload and delete do not take `lock_draft`), pinned by `test_reads_share_one_repeatable_read_snapshot`.
4. A numeric answer keeps its exact digits (`Decimal` → string). Test in Task 1 (full-fidelity test asserts `"4.0000000000"`).
5. Double click on Download → one check, one download. Test in Task 3 (`a second click while checking does nothing`).

---

### Task 1: Archive format and document builder

**Files:**
- Create: `backend/mathion/archive/__init__.py` (empty), `backend/mathion/archive/format.py`, `backend/mathion/archive/export.py`
- Test: `backend/tests/test_archive_export.py`

**Interfaces:**
- Produces (`format.py`): `FORMAT = 1`; `DOC_NAME = "mathion-course.json"`; `ASSET_DIR = "assets/"`; pydantic models, all `model_config = ConfigDict(extra="forbid")`:
  - `ArchiveOption(text: str, is_correct: bool)`
  - `ArchiveQuestion(type: str, text_md: str, explanation_md: str | None, correct_numeric: Decimal | None, precision: int | None, correct_text: str | None, options: list[ArchiveOption])`
  - `ArchiveItem(title: str, slug: str, type: str, content_md: str | None, video_url: str | None, script: str | None, questions: list[ArchiveQuestion])`
  - `ArchiveSequence(title, slug, items: list[ArchiveItem])`, `ArchiveBlock(title, slug, info: str, sequences: list[ArchiveSequence])`
  - `ArchiveCourse(name, slug, description)`, `ArchiveVersion(label: str, info_md: str, max_quiz_attempts: int)`
  - `ArchiveDoc(format: int, made_by: str, course: ArchiveCourse, version: ArchiveVersion, blocks: list[ArchiveBlock])`
  - Field limits and type literals are Part 2's job; Part 1 only writes.
- Produces (`export.py`):
  - `build_document(db: Session, version: CourseVersion) -> ArchiveDoc` — lists in `order, id` order (as `clone_version_content`); `script` = `Item.script_url` for an app item, else `None`; `content_md` = `None` for an app item.
  - `document_bytes(doc: ArchiveDoc) -> bytes` — `json.dumps(doc.model_dump(mode="json"), ensure_ascii=False, indent=2).encode("utf-8")`; `Decimal` dumps as a string.
  - `ArchiveFile` = dataclass `(filename: str, path: str, mtime: float)`
  - `preflight(db: Session, version: CourseVersion) -> list[ArchiveFile]` — every Asset row of the version, sorted by filename; raises `HTTPException(409)` with exact details:
    - text refers to files the version lacks (`collect_referenced_filenames` minus Asset filenames): `"This version links to files it does not hold: a.png, b.png"`
    - a file is missing on disk: `"These files of the version are missing on the server: a.png, b.png"`
    - (names sorted, joined with `", "`; the dangling check runs first)
  - `archive_filename(course_slug: str, version_id: int) -> str` → `f"{course_slug}-v{version_id}.tar.gz"`

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_archive_export.py`, seeding with `from tests.test_version_clone import _build_full_source`:
  - `test_document_full_fidelity`: `doc = build_document(db, version)`; `d = json.loads(document_bytes(doc))`; assert `d["format"] == 1`, `d["made_by"] == settings.version`, `d["course"] == {"name": "F", "slug": "full", "description": ""}`, `d["version"] == {"label": "L", "info_md": "Welcome ![logo](logo.png)", "max_quiz_attempts": 3}`; one block `{"title": "Blk", "slug": "blk", "info": "Block info", ...}`; item types in order `["static_page", "video", "quiz", "interactive_app"]`; video item `video_url == "https://e.com/v"` and `content_md == "Notes ![x](vid.png)"`; app item `script == "app.js"`, `content_md is None`; quiz questions' types in order `["single_choice", "numeric_answer", "text_answer", "multiple_choice"]`; numeric `correct_numeric == "4.0000000000"`, `precision == 0`; text `correct_text == "ada"`; choice options `[{"text": "A", "is_correct": True}, {"text": "B", "is_correct": False}]`, explanation `"Why ![e](exp.png)"`.
  - `test_document_has_nothing_about_people_or_rendering`: walk every dict key in `d` recursively; assert none ends with `_html` and none is in `{"id", "order", "uploaded_by", "created_at", "updated_at", "published_at", "archived_at", "state", "is_disabled"}`.
  - `test_document_keeps_unicode`: block title `"Ünïcode ∑"`, item `content_md` `"Привет $x^2$"`; assert both appear verbatim in `document_bytes(doc).decode("utf-8")` (not `\u` escapes).
  - `test_empty_version_document`: a version with no blocks → `d["blocks"] == []`; `preflight` → `[]`.
  - `test_preflight_lists_every_file_sorted`: full source plus an unreferenced `zz.png` → filenames `== sorted(all 7 + "zz.png")`, each `path` exists.
  - `test_preflight_dangling_reference_409`: force-delete `logo.png` as `test_version_duplicate.py:70-82` does → `HTTPException` 409, detail `"This version links to files it does not hold: logo.png"`.
  - `test_preflight_missing_on_disk_409`: `os.remove` `sp.png` under `settings.asset_path/courses/<id>/` → 409, detail `"These files of the version are missing on the server: sp.png"`.
  - `test_archive_filename`: `archive_filename("calc-1", 15) == "calc-1-v15.tar.gz"`.

- [ ] **Step 2: Run to verify they fail**
  Run: `cd backend && .venv/bin/pytest tests/test_archive_export.py -q`
  Expected: collection error, `ModuleNotFoundError: mathion.archive`.

- [ ] **Step 3: Implement `format.py` and `export.py`** with the interfaces above.

- [ ] **Step 4: Run to verify they pass**
  Run: `cd backend && .venv/bin/pytest tests/test_archive_export.py -q`
  Expected: all pass.

- [ ] **Step 5: Commit** (after Opus + Fable are clean and the owner says OK)
  ```bash
  git add backend/mathion/archive backend/tests/test_archive_export.py
  git commit -m "feat(archive): the course archive document and its file preflight"
  ```

### Task 2: Check and download endpoints, streamed tar.gz

**Files:**
- Create: `backend/mathion/api/version_archive.py`
- Modify: `backend/mathion/archive/export.py` (add `stream_archive`), `backend/mathion/main.py` (include the router next to `olx_import_router`)
- Test: `backend/tests/test_version_archive.py`

**Interfaces:**
- Consumes: Task 1's `build_document`, `document_bytes`, `preflight`, `archive_filename`, `ArchiveFile`, `DOC_NAME`, `ASSET_DIR`.
- Produces:
  - `stream_archive(doc: bytes, files: list[ArchiveFile]) -> Iterator[bytes]` in `export.py` — `tarfile.open(fileobj=<sink>, mode="w|gz")`; `DOC_NAME` first (mode `0o644`, mtime = now), then `ASSET_DIR + filename` for each file (mode `0o644`, mtime = `ArchiveFile.mtime`, size from `os.fstat` of the opened file); after each entry, yield what the sink holds; a file that cannot be opened raises (no entry is written for it). uid/gid 0, empty uname/gname.
  - `GET /api/versions/{version_id}/archive/check` → `200 {"filename": "<slug>-v<id>.tar.gz"}`
  - `GET /api/versions/{version_id}/archive` → `StreamingResponse`, `media_type="application/gzip"`, header `Content-Disposition: attachment; filename="<slug>-v<id>.tar.gz"`.
  - Both endpoints share one helper `_prepare(db, user, version_id) -> tuple[bytes, list[ArchiveFile], str]`: `lock_draft(db, version_id)` first (as built: commit the auth transaction, then open a REPEATABLE READ transaction instead — see Review Focus 3), then `get_or_404(db, CourseVersion, version_id)`, `require_course_admin`, `preflight`, `build_document` → `document_bytes`, then `db.rollback()` (releases the snapshot and the connection) before returning. The generator never touches `db`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_version_archive.py` (seed with `_build_full_source`; read the body into `tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz")`):
  - `test_download_contains_document_and_every_file`: 200; names `== {"mathion-course.json"} | {f"assets/{n}" for n in files}`; each asset's bytes equal what was uploaded (`name.encode() * 4`, `b"console.log(1)"`); the JSON's `version.label == "L"`; `mathion-course.json` is the first member.
  - `test_download_headers`: `content-type` starts with `application/gzip`; `content-disposition == f'attachment; filename="full-v{vid}.tar.gz"'`.
  - `test_check_returns_filename`: `GET …/archive/check` → `{"filename": f"full-v{vid}.tar.gz"}`.
  - `test_any_state_downloads`: parametrized over `("published", True)`, `("archived", True)`, `("created", True)`: set `state` and `is_disabled` through the ORM and commit → check 200 and download 200.
  - `test_needs_course_admin`: `auth_client` (plain user) → 403 on both; unknown id → 404 on both.
  - `test_refusals_are_json_before_any_byte`: dangling reference → both endpoints 409 with Task 1's exact detail; the download's body is JSON, not gzip.
  - `test_stream_stops_when_a_file_vanishes`: call `stream_archive(b"{}", [ArchiveFile("a.png", <tmp path>, 0.0), ArchiveFile("b.png", <missing path>, 0.0)])`; consuming it raises `FileNotFoundError`, and the chunks yielded before the raise do not form a readable `b.png` entry.
  - `test_stream_yields_per_entry`: two files → the generator yields more than one non-empty chunk.

- [ ] **Step 2: Run to verify they fail**
  Run: `cd backend && .venv/bin/pytest tests/test_version_archive.py -q`
  Expected: 404s / ImportError for `stream_archive`.

- [ ] **Step 3: Implement** `stream_archive`, the router, and register it in `main.py`.

- [ ] **Step 4: Run to verify they pass**
  Run: `cd backend && .venv/bin/pytest tests/test_version_archive.py tests/test_archive_export.py -q`
  Expected: all pass. Then the whole backend suite once: `cd backend && .venv/bin/pytest -q` → no failures.

- [ ] **Step 5: Commit** (after Opus + Fable are clean and the owner says OK)
  ```bash
  git add backend/mathion/api/version_archive.py backend/mathion/archive/export.py backend/mathion/main.py backend/tests/test_version_archive.py
  git commit -m "feat(archive): check and stream a course version's archive"
  ```

### Task 3: The Download slot on the Versions page

**Files:**
- Create: `frontend/src/lib/versionArchive.ts`
- Modify: `frontend/src/pages/editor/VersionsPage.svelte` (row slots, ~line 427)
- Modify: `frontend/src/tests/VersionsPage.slots.svelte.test.ts` (the slot lists gain `download`)
- Test: `frontend/src/tests/versionArchive.test.ts`, `frontend/src/tests/VersionsPage.download.svelte.test.ts`

**Interfaces:**
- Consumes: Task 2's two endpoints.
- Produces (`versionArchive.ts`):
  - `archiveUrl(versionId: number): string` → `` `/api/versions/${versionId}/archive` ``
  - `checkArchive(versionId: number): Promise<void>` — `api.get` of `…/archive/check`; throws the `ApiError` on refusal.
  - `startDownload(url: string): void` — creates an `<a>` with `href=url` and a `download` attribute, appends it to `document.body`, clicks it, removes it.

- [ ] **Step 1: Write the failing tests**
  - `versionArchive.test.ts`: `archiveUrl(7) === '/api/versions/7/archive'`; `startDownload('/x')` clicks one anchor whose `href` ends with `/x` and has the `download` attribute (spy `HTMLAnchorElement.prototype.click`), and leaves no anchor in `document.body`.
  - `VersionsPage.slots.svelte.test.ts`: the glyph lists become `['pencil', 'duplicate', 'download', 'disable', 'trash']` and `['pencil', 'duplicate', 'download', 'enable', 'trash']`; titles `['Open', 'Duplicate', 'Download', 'Disable', 'Delete']`; the `s[n]` indexes after Duplicate shift by one; the describe title says five slots.
  - `VersionsPage.download.svelte.test.ts` (same mocks as the slots test, plus `vi.mock('../lib/versionArchive', …)` keeping `archiveUrl` real):
    - `the row's Download button is "Download v7", enabled for a disabled archived version`.
    - `a click checks, then starts the download`: `checkArchive` called with `7`, then `startDownload` with `'/api/versions/7/archive'`.
    - `a refusal shows the server's sentence and downloads nothing`: `checkArchive` rejects with `new ApiError(409, …)` whose `displayMessage` is `'These files of the version are missing on the server: a.png'` → a toast of kind `error` with that text; `startDownload` not called.
    - `a second click while checking does nothing`: `checkArchive` pending; two clicks → called once.
    - `disabled while the page is busy` (as the other slots).

- [ ] **Step 2: Run to verify they fail**
  Run: `cd frontend && npm test -- src/tests/versionArchive.test.ts src/tests/VersionsPage.download.svelte.test.ts src/tests/VersionsPage.slots.svelte.test.ts`
  Expected: failures (module missing, four slots found).

- [ ] **Step 3: Implement** `versionArchive.ts`; in `VersionsPage.svelte` add after the Duplicate slot:
  `<IconButton size="sm" glyph="download" title="Download" aria-label="Download v{v.id}" id={`v-${v.id}-download`} disabled={busy} onclick={() => void download(v)} />`
  and `async function download(v: Version)`: a plain `let checkingId: number | null` guard (a second click while checking returns); `await checkArchive(v.id)` then `startDownload(archiveUrl(v.id))`; on error `pushToast(failureText(e, 'Could not download this version'), 'error')`; `finally` clears the guard. The page's `busy` is not set (a download changes nothing).

- [ ] **Step 4: Run to verify they pass**
  Run the Step 2 command → all pass (exit 0, no "Errors"/"Unhandled" line). Then `cd frontend && npm test` and `npm run check` (baseline 0 errors, 11 warnings) and `npx @sveltejs/mcp svelte-autofixer src/pages/editor/VersionsPage.svelte`.

- [ ] **Step 5: Browser check** (dev servers on 127.0.0.1 only, never `docker compose up db`): download `demo-course`'s draft from the Versions page in agent-browser; `tar -tzf` lists `mathion-course.json` first and the version's files under `assets/`; the JSON's labels match the page. Then one Safari step for the owner: click Download on a version and confirm the file arrives as `demo-course-v<id>.tar.gz`.

- [ ] **Step 6: Commit** (after Opus + Fable are clean and the owner says OK)
  ```bash
  git add frontend/src/lib/versionArchive.ts frontend/src/pages/editor/VersionsPage.svelte frontend/src/tests/versionArchive.test.ts frontend/src/tests/VersionsPage.download.svelte.test.ts frontend/src/tests/VersionsPage.slots.svelte.test.ts
  git commit -m "feat(archive): Download on each version row"
  ```
