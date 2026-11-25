# Beta Gate Round Implementation Plan (rev 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Rev 2 applies the plan review (Opus + Fable, 2026-11-24) and two owner calls: item `empty-run-upload-delete-race` is settled "no" (no 500 exists: every run table cascades in the database and a late insert is the handled 404), and the OLX import's report line for a `data:` image is shortened. Rev 3 applies the rev 2 re-review (timing sizes pinned, data: note for images only, golden uploads under target names, Docker cleanup, runes test file).

**Goal:** Fix the 11 backlog items the owner chose in the 2026-11-24 walk, so the backlog's "yes" list is empty before the beta.

**Architecture:** Six independent tasks: render-path fixes in `markdown.py`/`asset_render.py`/`olx/links.py`, upload-path fixes in `assets.py`, row-write order in publish/reorder/info edits, one golden OLX contract test, one shared frontend `settle()` helper, and a backend dependency bump last. No new features, no schema change.

**Tech Stack:** FastAPI + SQLAlchemy 2 + PostgreSQL 17 (backend, pytest), Svelte 5 + vitest (frontend), markdown-it-py + nh3.

**Spec:** the item files in `docs/backlog/` (as corrected by `88373d83`) plus the walk decisions in `.superpowers/sdd/2026-11-24-beta-backlog-walk/decisions.md`. Where the two differ, the decisions file wins.

## Global Constraints

- No new dependencies, Python or JS (T6 bumps existing pins only).
- Code comments: one short plain line.
- Python only through `backend/.venv/bin/python -I` (pytest: `cd backend && .venv/bin/python -I -m pytest -q -p no:cacheprovider`); never two pytest processes at once.
- Frontend tests: `cd frontend && TZ=Europe/Copenhagen npm test`; green = exit 0 and no "Errors"/"Unhandled" line. Type check: `npm run check` → 0 errors. Visual gate: `zsh frontend/scripts/visual-refresh-gate.sh` → ALL PASS.
- Never read, list or quote `.superpowers/sdd/2026-11-17-olx-import/` or `.superpowers/sdd/2026-11-18-olx-import/`; never grep `.superpowers/sdd` recursively.
- Each fixed item's file is `git rm`'d in the commit that lands its fix. Commits only on the owner's OK; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never stage `logo.png` / `favicon.svg`.
- Per task: Opus (high) + Fable until clean, then Codex (high), then the owner's OK, then commit.
- Exact copy (T1): save refusal `Images pasted as data: URLs are not supported. Upload the file under Assets and link it by name.`; OLX report note `An image pasted into the page as a data: URL was removed; its text was kept`.
- A test that pins existing behaviour and passes before the change is allowed; ledger it as "pin, green before".

## Review Focus

1. An asset used both as an image and as a link target in one text (and an image inside a link) — both rewritten, nothing else touched. → T1 `test_asset_rewrite_image_and_link_same_name` (pin).
2. Empty targets `[a]()` / `![b]()` keep `href=""` / `src=""`. → T1 `test_empty_targets_not_rewritten`.
3. The faster backtick scan answers exactly as before at every `$` the parser asks about. → T1 `test_in_code_matches_old_scan` + `test_render_matches_old_scan`.
4. A `data:` target that markdown-it does not turn into a link (`[x](data:text/html,hi)`) stays plain text and is not refused. → T1 `test_data_link_text_is_not_refused` (pin).
5. `settle()` under fake timers advances 0 ms only: a 300 ms timer must not fire. → T5 `settle under fake timers runs no due timer`.

---

### Task 1: Markdown and asset render (items asset-scan-data-uri, asset-url-rewrite-reaches-text, missing-asset-message-decodes-names, markdown-backtick-scan-superlinear)

**Files:**
- Modify: `backend/mathion/markdown.py` (`_in_code` ~255, `render_markdown` ~452, `extract_asset_filenames` ~512, `resolve_asset_urls` ~528 removed)
- Modify: `backend/mathion/api/asset_render.py` (`_names` :9, `render_with_assets` ~14-47, `render_with_run_assets` ~180-212)
- Modify: `backend/mathion/olx/links.py` (`classify_link`, the "was removed (only web addresses…)" note ~:125)
- Test: `backend/tests/test_markdown.py`, `backend/tests/test_asset_markdown.py` (convert its `resolve_asset_urls` callers :41-112 to `render_markdown(asset_url=…)`), `backend/tests/test_run_render.py`, `backend/tests/test_olx_html_md.py` (or wherever `classify_link` notes are tested)
- Delete: the four item files

**Interfaces:**
- Produces: `_asset_ref(ref: str | None, is_link: bool) -> str | None` in `markdown.py` — the one predicate (`ref and _is_asset_target(ref, is_link)`) used by both extraction and rewrite.
- Produces: `render_markdown(text: str | None, asset_url: Callable[[str], str] | None = None) -> str` — when given, every image `src` / link `href` that `_asset_ref` accepts becomes `asset_url(ref)` on the parsed tokens before rendering. `resolve_asset_urls` is deleted.
- Produces: `is_data_url(ref: str) -> bool` in `markdown.py` (case-insensitive `data:` prefix).
- Produces: `DATA_URL_REFUSAL: str` in `asset_render.py`.

- [ ] **Step 1: Write the tests**
  - `test_asset_rewrite_skips_code_and_math`: pool `{pic.png}`, text ``![p](pic.png) and `src="pic.png"` and $\text{src="pic.png"}$`` → exactly one `/assets/{vid}/pic.png`; the same for a run (`/api/runs/{rid}/assets/pic.png`) in `test_run_render.py`.
  - `test_asset_rewrite_image_and_link_same_name` (pin): `[![p](pic.png)](pic.png)` → `src` and `href` both rewritten.
  - `test_empty_targets_not_rewritten`: `[a]() ![b]()` with `asset_url` given → output equals `render_markdown` without it.
  - `test_data_image_refused_with_short_message`: saving `![a](data:image/png;base64,AAAA)` (an item, and a run mini-project) → 422, `detail == DATA_URL_REFUSAL`; also `DATA:image/png;…`.
  - `test_data_link_text_is_not_refused` (pin): `[x](data:text/html,hi)` saves 200.
  - `test_missing_names_keep_typed_spelling`: missing `{"p%69c.png", "pic.png"}` → message lists `p%69c.png, pic.png`. Rule: show `unquote(n)` unless unquoting changes an ASCII letter or digit, then show `n`; dedupe; sort. The existing `my%20file.png` → `my file.png` test keeps passing.
  - `test_backtick_scan_scales_linearly`: input `"$x " + " ".join("`"*k for k in range(2, K)) + " a`" * N + " y$"`; size S uses K=350, N=20000; size 2S uses K=495, N=40000; best of 3 each; assert `t(2S) < 0.5 s` (today ~1.27 s) and, loosely, `t(2S) / t(S) < 3`. Ledger the fixed scan's times at GREEN.
  - `test_in_code_matches_old_scan`: copy today's `_in_code` into the test as `_old_in_code`; 2000 seeded random strings over ``"`$\\a "`` (length ≤ 40); for every `$` at `i` and every later `$` at `j`, `new(src, i+1, j) == old(src, i+1, j)` (the only shape the parser calls).
  - `test_render_matches_old_scan`: monkeypatch `markdown._in_code` to `_old_in_code`, render the same 2000 strings plus ``[x](a`b) $c ` d$ ` `` → identical HTML with and without the patch.
  - `test_olx_data_image_note_is_short`: `classify_link("data:image/png;base64,AAAA", …, image=True)` → note equals the OLX copy in Global Constraints; also `DATA:`; an `ftp:` image and a `data:` link keep today's note.

- [ ] **Step 2: Run them, see RED**
  Run: `cd backend && .venv/bin/python -I -m pytest -q -p no:cacheprovider tests/test_markdown.py tests/test_asset_markdown.py tests/test_run_render.py tests/test_olx_html_md.py`
  Expected FAIL: code/math rewrite (4 rewrites), empty targets (`/assets/{vid}/` after the hook exists; before, collect error because `asset_url` is unknown — note which), data refusal (blob quoted), typed spelling (`pic.png, pic.png`), the 0.5 s bound, OLX note. Pins and the two differential tests are green before.

- [ ] **Step 3: Implement**
  - `_in_code`: keep the loop exactly; replace only the closer search with a lookup: per `src` (small `functools.lru_cache` on the string), a dict `length -> sorted list of starts of maximal backtick runs`; the closer is the first start `>= m.end()` in the list for `n` (bisect). Escapes stay as today.
  - `render_markdown(..., asset_url=None)`: `tokens = _md.parse(text)`; when `asset_url`, walk as `_targets` does and set `src`/`href` where `_asset_ref` accepts; `_clean(_md.renderer.render(tokens, _md.options, {}))`.
  - `extract_asset_filenames` uses `_asset_ref`.
  - `render_with_assets` / `render_with_run_assets`: refs first; any `is_data_url` ref → 422 `DATA_URL_REFUSAL`; missing check as today; then `render_markdown(content_md, asset_url=lambda n: f"/assets/{version_id}/{n}")` (run: `/api/runs/{run_id}/assets/{n}`).
  - `_names`: the rule above.
  - `classify_link`: a `data:` image (any case, `image=True`) gets the short OLX note; a `data:` link keeps today's note.

- [ ] **Step 4: GREEN, then the backend suite**
  Expected: all PASS; full suite = previous + new, 0 failed.

- [ ] **Step 5: Review loop, owner OK, commit**
  ```bash
  git rm docs/backlog/asset-scan-data-uri.md docs/backlog/asset-url-rewrite-reaches-text.md docs/backlog/missing-asset-message-decodes-names.md docs/backlog/markdown-backtick-scan-superlinear.md
  git add backend/mathion/markdown.py backend/mathion/api/asset_render.py backend/mathion/olx/links.py backend/tests
  git commit -m "fix(markdown): asset links rewritten on tokens, data: images refused plainly, linear backtick scan"
  ```

### Task 2: Asset upload (items asset-upload-commits-row-before-disk-write, sanitize-filename-cap-leaves-trailing-dash)

**Files:**
- Modify: `backend/mathion/api/assets.py:68-115` (`upload_asset`)
- Modify: `backend/mathion/assets.py:49-55` (`sanitize_filename` cap)
- Modify: `backend/mathion/olx/files.py:69-74` (`clean_name` becomes a plain `sanitize_filename` call; replace its 4 call sites :79, :97, :142, :146 and delete it)
- Test: `backend/tests/test_assets_api.py`, `backend/tests/test_assets.py`
- Delete: the two item files

**Interfaces:**
- Produces: `sanitize_filename(name: str) -> str` is idempotent.

- [ ] **Step 1: Write the tests**
  - `test_upload_row_invisible_until_file_written`: wrap `os.replace` so it counts `Asset` rows for the version from a second session (`SessionLocal()`) before calling the real one; assert the count seen was 0.
  - `test_upload_disk_failure_leaves_no_row_and_no_file`: `os.replace` raises `OSError` → 500 `Failed to write asset to disk`; no `Asset` row, no file, no `.upload-*.tmp`.
  - `test_upload_duplicate_name_still_409` (pin).
  - `test_sanitize_cap_trims_dash`: `"a" * 250 + "-b.png"` → `"a" * 250 + ".png"`.
  - `test_sanitize_is_idempotent`: the known case plus 500 seeded names whose base is 245–300 characters of letters and dashes (a dash within 10 characters of the cut) plus random spaces/dots → cleaning twice equals cleaning once.

- [ ] **Step 2: RED**
  Run: `cd backend && .venv/bin/python -I -m pytest -q -p no:cacheprovider tests/test_assets_api.py tests/test_assets.py`
  Expected FAIL: row visibility, trailing dash, idempotence.

- [ ] **Step 3: Implement**
  - `upload_asset`: `db.flush()` (409 on `IntegrityError` as today), temp + `os.replace`, then `db.commit()`; on a write failure `db.rollback()` and remove the temp file. Mirror `run_assets.py:108-139`.
  - `sanitize_filename`: `base[:keep].rstrip("-") or "file"`.

- [ ] **Step 4: GREEN, then the backend suite** (incl. `tests/test_olx_*` unchanged).

- [ ] **Step 5: Review loop, owner OK, commit**
  ```bash
  git rm docs/backlog/asset-upload-commits-row-before-disk-write.md docs/backlog/sanitize-filename-cap-leaves-trailing-dash.md
  git add backend/mathion/api/assets.py backend/mathion/assets.py backend/mathion/olx/files.py backend/tests/test_assets_api.py backend/tests/test_assets.py
  git commit -m "fix(assets): upload writes the file before committing its row; name cap leaves no trailing dash"
  ```

### Task 3: Row-write order (items publish-item-render-order, publish-version-info-lock-order)

**Files:**
- Modify: `backend/mathion/api/versions.py` (`update_version` :159-162; `publish_version` items select :331-336 and version info :364-365)
- Modify: the five reorders: `blocks.py:212` `reorder_blocks`, `blocks.py:396` `reorder_sequences`, `items.py:296` `reorder_items`, `questions.py:188` `reorder_questions`, `questions.py:324` `reorder_options`
- Test: new `backend/tests/test_write_order.py`
- Delete: the two item files

**Interfaces:** none shared.

- [ ] **Step 1: Write the tests** (a `before_cursor_execute` listener on the test engine collects `(statement, params)`)
  - `test_publish_renders_items_in_id_order`: a draft with three stale formula items; assert the items SELECT in publish ends with `ORDER BY items.id` and the `UPDATE items` ids ascend.
  - `test_reorder_writes_in_id_order` (parametrized over the five endpoints): a reversed payload → `UPDATE` ids ascend; stored orders equal the payload's.
  - `test_info_patch_writes_references_before_version`: info text linking an asset → in `PATCH /api/versions/{id}` the first `DELETE FROM asset_references` precedes the first `UPDATE course_versions`.
  - `test_publish_writes_info_references_before_version`: an info whose stored HTML is stale (edit `info_html` directly in the DB) → in publish, the info `DELETE FROM asset_references` precedes the first `UPDATE course_versions`.

- [ ] **Step 2: RED**
  Run: `cd backend && .venv/bin/python -I -m pytest -q -p no:cacheprovider tests/test_write_order.py`
  Expected FAIL: no ORDER BY; descending reorder writes; version row first in PATCH and stale publish.

- [ ] **Step 3: Implement**
  - Publish: `.order_by(Item.id)` on `items_to_render`; version info: render and sync references, then assign `version.info_html`.
  - `update_version`: render and sync references from `updates["info_md"]` first, then assign `info_md` / `info_html`.
  - Reorders: `for entry in sorted(data.order, key=lambda e: e.id)`.

- [ ] **Step 4: GREEN, then the backend suite** (existing `test_reorder.py` and concurrency tests unchanged).

- [ ] **Step 5: Review loop, owner OK, commit**
  ```bash
  git rm docs/backlog/publish-item-render-order.md docs/backlog/publish-version-info-lock-order.md
  git add backend/mathion/api/versions.py backend/mathion/api/blocks.py backend/mathion/api/items.py backend/mathion/api/questions.py backend/tests/test_write_order.py
  git commit -m "fix(locks): one row order for publish, reorders and course-info edits"
  ```

### Task 4: OLX golden contract test (item olx-golden-contract-test)

**Files:**
- Create: `frontend/src/tests/fixtures/olx-golden/body.json`, `check.json` (committed goldens)
- Create: `frontend/src/tests/olxGolden.test.ts`, `backend/tests/test_olx_golden.py`
- Delete: `docs/backlog/olx-golden-contract-test.md`

**Interfaces:**
- Consumes: `readExport`, `uploadAll`, `assembleBuildBody` (`frontend/src/lib/olx/`); backend `POST /api/courses/{id}/olx-import/check`, `POST /api/versions/{id}/olx-import/build`.
- Produces: `GOLDEN_UPDATE=1` regenerates the goldens (vitest writes `body.json`, pytest writes `check.json`); without it both only compare.

- [ ] **Step 1: Write the tests**
  - vitest `reader output equals the committed body`: `readExport(olx-course.tar.gz, [sine-demo.js], LIMITS)` → `res.body` deep-equals `body.json` (Node `Blob`/`File`/`DecompressionStream` stubbed as `olxReadExport.test.ts:10-20`).
  - pytest `test_check_of_golden_body_equals_golden_check`: POST `body.json` to `/check` on a fresh course → equals `check.json`.
  - vitest `uploads follow the golden plan`: stub `FormData` with a small Map-based class (jsdom's rejects Node blobs) and `fetch`; `uploadAll` over `check.json`'s uploads with the reader's own blobs → targets in plan order, each sent body's bytes equal the source blob's.
  - pytest `test_golden_build_succeeds`: a draft, every planned upload posted under its planned `target` name (not the source basename) from `backend/tests/fixtures/olx/course/static` / `apps`, then `/build` with `body.json` + `report: []` + a date → 200.
  - vitest blob-key twin (frontend only): build a tar in the test with `support/tarWriter.ts` holding the fixture course plus `static/sine-demo.js` and `static/app:sine-demo.js`, pick app `sine-demo.js` → three distinct blob keys, and the planned `app` upload sends the picked bytes.

- [ ] **Step 2: Generate once, read the JSON, then compare**
  Run with `GOLDEN_UPDATE=1` (vitest, then pytest), read both files, run both again without it → PASS. RED check: change one character in `body.json` → vitest and pytest FAIL; revert.

- [ ] **Step 3: Full suites green.**

- [ ] **Step 4: Review loop, owner OK, commit**
  ```bash
  git rm docs/backlog/olx-golden-contract-test.md
  git add frontend/src/tests/olxGolden.test.ts frontend/src/tests/fixtures/olx-golden backend/tests/test_olx_golden.py
  git commit -m "test(olx): golden contract from reader to build, plus the blob-key twin"
  ```

### Task 5: settle() instead of counted turns (item tests-settle-by-microtask-count)

**Files:**
- Create: `frontend/src/tests/support/settle.ts`, `frontend/src/tests/settle.svelte.test.ts` (runes need `.svelte.ts`)
- Modify: every test file with counted waits: `await Promise.resolve()` (loops, braced loops, repeated lines — 90 files incl. `MarkdownEditor.svelte.test.ts` (58 lines) and `AssetSidebar.svelte.test.ts:588, 631, 984, 1014, 1029`), counted `await tick()` loops (`MiniProjectDetailPage:104`, `SuperuserBranding:115, 530`), and the ~20 local `async function settle()` helpers (delete them, import the shared one)
- Delete: `docs/backlog/tests-settle-by-microtask-count.md`

**Interfaces:**
- Produces: `export async function settle(): Promise<void>` — one macrotask (`setTimeout(0)` under real timers; `vi.advanceTimersByTimeAsync(0)` when `vi.isFakeTimers()`), then `flushSync()`.

- [ ] **Step 1: Helper tests, RED**
  - `settle waits for a stubbed fetch json`: `fetch` stub → `Response.json()` → a `$state` set → after `await settle()` it is set.
  - `settle under fake timers runs no due timer`: fake timers; a 300 ms timer has not fired after `settle()`, a 0 ms one has.
  Run: `cd frontend && TZ=Europe/Copenhagen npx vitest run src/tests/settle.svelte.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `settle()`; helper tests PASS.**

- [ ] **Step 3: Convert in batches of ~15 files**
  Replace each counted wait with `await settle()` (twice where a reply schedules a timer; ledger those files). Allow-list (left as single turns, each with a one-line comment): `InlineConfirm` (2), `router`, `Segmented`, `VideoItem`, `RosterImportModal.scaffold` (1 each) — re-check each before listing. After each batch the batch's files are green. Expect a few tests that asserted a "before the 0 ms timer" state; fix the test's intent, ledger each.
  Mutation sample: in 5 converted files (incl. RunProgressTab, SuperuserUsers, MarkdownEditor) remove the awaited stub reply → FAIL; restore.

- [ ] **Step 4: Full checks**
  `TZ=Europe/Copenhagen npm test`, `npm run check`; `grep -rnE "await Promise\.resolve\(\)|for \(.*\) *\{? *await tick\(\)" frontend/src/tests` → only allow-listed lines.

- [ ] **Step 5: Review loop, owner OK, commit**
  ```bash
  git rm docs/backlog/tests-settle-by-microtask-count.md
  git add frontend/src/tests
  git commit -m "test: wait with settle() instead of counting microtask turns"
  ```

### Task 6: Backend dependency round (item backend-dependency-round) — LAST

**Files:**
- Modify: `backend/constraints.txt` (and `backend/pyproject.toml` lower bounds only if a bump needs it)
- Modify: tests the bump moves, at least `test_bare_urls_nh3_strips_stay_plain_text` (the `[::1]` case) and the `title="</a>"` case in `backend/tests/test_markdown.py`
- Delete: `docs/backlog/backend-dependency-round.md`

- [ ] **Step 1: Advisories** — nh3 / ammonia (RUSTSEC), python-multipart, Starlette, FastAPI between pinned and latest; one ledger line per package.
- [ ] **Step 2: Bump** — `pip install -U` every pinned package into `backend/.venv` (undo: `pip install -r` the committed `constraints.txt`); `pip freeze` → `constraints.txt` (same header, greenlet line kept); backend suite. Expected failures: the two markdown cases (plus SQLAlchemy 2.1 fallout, if any).
- [ ] **Step 3: Decide** — `https://[::1]/x` linked: accept, update the test. nh3 title escaping: update the expected string. SQLAlchemy 2.1 needing more than a line or two: pin newest 2.0.x, file `sqlalchemy-2-1-upgrade.md` (worth: yes) in its own `docs(backlog)` commit.
- [ ] **Step 4: Linux run** — `docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -e MATHION_TEST_ALLOW_NONLOCAL=1 -e <CI's test DB vars with host host.docker.internal> -v "$PWD":/w -w /w python:3.13 sh -c "pip install -q -c backend/constraints.txt './backend[dev]' && cd backend && pytest -q -p no:cacheprovider"` → same count as macOS, 0 failed; then remove any root-owned `backend/build/` / `*.egg-info` it left and check `git status` is clean apart from the bump. Then frontend suite and gate.
- [ ] **Step 5: Review loop, owner OK, commit**
  ```bash
  git rm docs/backlog/backend-dependency-round.md
  git add backend/constraints.txt backend/tests/test_markdown.py
  git commit -m "build(backend): bump all pinned packages"
  ```
