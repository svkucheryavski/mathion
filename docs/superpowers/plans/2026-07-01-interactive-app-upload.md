# Interactive App — Upload Model (redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the merged URL-embed `interactive_app` model with an upload-a-single-JS-file model where the authenticated Mathion page fetches the asset text and inlines it into a strict-sandboxed iframe.

**Architecture:** Admin uploads one self-contained classic/IIFE `.js` file as a normal version `Asset`; `Item.script_url` is repurposed from "external URL" to "the filename of the app's JS asset in this version." The authenticated page fetches `/assets/{version_id}/{filename}` as text (credentialed same-origin GET — the `SameSite=Lax` cookie attaches) and inlines the escaped source into `InteractiveFrame`'s `srcdoc` as a classic `<script>` inside `sandbox="allow-scripts"` (opaque origin, no `allow-same-origin`) with a CSP that blocks all connections and subresource loads (`connect-src`/`default-src` `'none'`; the one residual, frame self-navigation, leaks no Mathion session/cookie/cross-origin data — see the `InteractiveFrame` note). No new endpoint; reuses the version-asset upload/serve pipeline. A dedicated `AssetReference` helper maintains delete-protection, and the markdown publish loop skips `interactive_app` items so it can't wipe that reference.

**Tech Stack:** Backend — FastAPI, SQLAlchemy, Pydantic v2, pytest (run via `backend/.venv`). Frontend — Svelte 5 (runes only, no JS/CSS deps), Vitest (`mount`/`unmount`/`flushSync`/`tick` from `svelte`, NOT `@testing-library`), svelte-check.

**Design spec:** `docs/superpowers/specs/2026-07-01-interactive-app-upload-design.md` (approved). Every task cites the spec section it implements.

## Global Constraints

- **Sandbox is a non-configurable literal:** `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">`. NEVER add `allow-same-origin` (or `allow-top-navigation*`, `allow-popups-to-escape-sandbox`, `allow-downloads`, `allow-modals`, `allow-storage-access-by-user-activation`). No `allowfullscreen`. (spec §4, §6)
- **CSP (host-page meta), verbatim:** `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'` — `'unsafe-eval'` is NOT granted. (spec §6)
- **`</script>` escaping is the one correctness-critical transform:** `source.replace(/<(\/script)/gi, '<\\$1')` — global AND case-preserving. A first-occurrence-only or case-lowercasing replace is a defect. (spec §6, §11)
- **`scriptSource` NEVER reaches the main document:** only escaped-and-inlined into the sandboxed `srcdoc`. NEVER `{@html}` / `innerHTML` it into a Mathion page. Markdown never renders an uploaded `.js` (`html:False` + `nh3.clean` allowlist). (spec §4, §6)
- **Filename validation (endpoint):** an anchored `re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.js", name)` AND `".." not in name`. (spec §5)
- **Attach is PATCH-only:** the create schema REJECTS a non-null create-body `script_url` for `interactive_app`. (spec §5)
- **Frontend:** Svelte 5 runes only; no new JS/CSS dependencies. Tests use `mount`/`unmount`/`flushSync`/`tick` from `svelte`.
- **Backend invocations:** always via `backend/.venv` (e.g. `backend/.venv/bin/pytest`), never bare.
- **Git:** work on a feature branch off `main` (create `feat/interactive-app-upload` before Task 1 — this is a normal checkout, NOT a worktree). Commit only the files each task names — use explicit paths, NEVER `git add -A`/`git add .`. Every commit ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **NEVER stage these three pre-existing untracked files** (unrelated work): `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`.

## File Structure

**Backend**
- `backend/mathion/schemas.py` — MODIFY: drop `script_url` from both `validate_url` copies; invert the `ItemCreate` `check_type_fields` `interactive_app` branch. (Task 1)
- `backend/mathion/api/helpers.py` — ADD `sync_script_reference(...)` next to `sync_asset_references`. (Task 2)
- `backend/mathion/api/items.py` — MODIFY `update_item`: filename validation + call the ref helper + remove the null guard; `import re` + import the helper. (Task 2)
- `backend/mathion/api/assets.py` — MODIFY `upload_asset`: add the server-side non-empty guard (spec §8). (Task 2)
- `backend/mathion/api/versions.py` — MODIFY the publish re-render loop to skip `interactive_app` items. (Task 3)
- `backend/tests/test_items.py` — MODIFY/ADD tests across Tasks 1–3.

**Frontend**
- `frontend/src/lib/interactiveHost.ts` — NEW: `escapeScriptClose`, `buildAppSrcdoc`. (Task 4)
- `frontend/src/lib/appSourceScan.ts` — NEW: `scanAppSource`. (Task 4)
- `frontend/src/lib/assets.ts` — ADD `fetchAssetSource`. (Task 4)
- `frontend/src/lib/types.ts` — MODIFY: `InteractiveAppItem.script_url` → `string | null`. (Task 4)
- `frontend/src/components/items/InteractiveFrame.svelte` — REWORK: `src` → `scriptSource`; build `srcdoc`. (Task 5)
- `frontend/src/components/items/InteractiveAppItem.svelte` — REWORK: fetch source; async-coverage restructure. (Task 5)
- `frontend/src/components/items/InteractiveAppEditor.svelte` — NEW: render states (Task 5) + upload/Remove (Task 6).
- `frontend/src/pages/editor/ItemEditPage.svelte` — REWORK: delegate `interactive_app` to `InteractiveAppEditor`; drop URL machinery. (Task 5)
- `frontend/src/lib/safeIframeUrl.ts` — MODIFY doc-comment (drop interactive-app mention). (Task 5)
- `frontend/src/components/editor/SequenceAccordion.svelte` — REWORK create flow: remove the App-URL field. (Task 7)
- `frontend/src/lib/safeAppUrl.ts` + `frontend/src/tests/safeAppUrl.test.ts` — DELETE. (Task 8)
- Test files: `frontend/src/tests/{interactiveHost,appSourceScan,fetchAssetSource,InteractiveFrame,InteractiveAppItem,InteractiveAppEditor,ItemEditPage.interactive,ItemRouter,SequenceAccordion.interactive}.*test.ts`.

**Design note (component extraction):** the editor's `interactive_app` UX changes from tracker-based text editing to an atomic upload flow that doesn't fit `ItemEditPage`'s dirty-tracker/`save()` model. It is extracted into a focused `InteractiveAppEditor.svelte` (already-453-line `ItemEditPage` stays coherent, and the editor logic is unit-testable in isolation). `InteractiveFrame` remains the single hardened frame — the sole authority for sandbox + CSP + escaping — used by both the player and the editor.

---

## Task 1: Backend — schema create-rejection

**Files:**
- Modify: `backend/mathion/schemas.py` (`ItemCreate` `validate_url` :104-109 + `check_type_fields` :117-118; `ItemUpdate` `validate_url` :140-145)
- Test: `backend/tests/test_items.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ItemCreate` now REJECTS a non-null `script_url` for `interactive_app` (422) and no longer applies the `http(s)://` rule to `script_url`; `ItemUpdate` no longer applies the `http(s)://` rule to `script_url` (endpoint validates the filename — Task 2). `video_url` still requires `http(s)://` in both.

Implements spec §5 (Backend changes — Schema) and §9 (Backend).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_items.py`: **(a)** delete `test_api_patch_interactive_app_nullify_script_url_returns_422` (:187-194) — its premise (create an `interactive_app` *with* a create-body `script_url`, then PATCH it to null) is now invalid: create-with-`script_url` is rejected at create, and clearing `script_url` is *allowed* (Task 2 covers the clear path). Leaving it in makes Steps 4–5 below error (`item['id']` KeyError on the now-422 create). **(b)** replace `test_api_create_item_invalid_script_url` (currently :206-212) with the two tests below. **(c)** update the ORM test `test_create_interactive_app` (:49-55) to use a filename value:

```python
def test_api_create_interactive_app_without_script_url(admin_client):
    """interactive_app is created empty; the app is attached later via PATCH."""
    seq, version = _setup_sequence(admin_client)
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "type": "interactive_app",
    })
    assert resp.status_code == 201
    assert resp.json()["type"] == "interactive_app"
    assert resp.json()["script_url"] is None


def test_api_create_interactive_app_with_script_url_rejected(admin_client):
    """Attach is PATCH-only: a create-body script_url is rejected (422)."""
    seq, version = _setup_sequence(admin_client)
    resp = admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "type": "interactive_app", "script_url": "app.js",
    })
    assert resp.status_code == 422
    # Pin the create-rejection reason, not the incidental URL-format 422 that the
    # pre-Step-3 code produces — this is what makes the test RED-first for the inversion.
    assert "must not be set on create" in resp.text
```

And change `test_create_interactive_app` (:49-55) `script_url` from `"https://example.com/app.js"` to `"app.js"` in both the `Item(...)` constructor and the assertion (it exercises the ORM column directly, which accepts any string; the value should reflect the new "filename" meaning):

```python
def test_create_interactive_app(db):
    seq = _make_sequence(db)
    item = Item(sequence_id=seq.id, title="Simulation", slug="simulation", order=1, type="interactive_app", script_url="app.js")
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.script_url == "app.js"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest tests/test_items.py::test_api_create_interactive_app_without_script_url tests/test_items.py::test_api_create_interactive_app_with_script_url_rejected -v` (from `backend/`)
Expected: BOTH FAIL. `test_..._without_script_url` FAILS (currently `not script_url` → "script_url is required" → 422, not 201). `test_..._with_script_url_rejected` also FAILS: the pre-Step-3 code returns 422 but with the URL-format detail ("URL must start with http…"), so the `"must not be set on create"` assertion is RED. After Step 3 the detail becomes the create-rejection message and it goes green — so the assertion discriminates the inversion, not just the incidental 422.

- [ ] **Step 3: Apply the schema changes**

In `backend/mathion/schemas.py`, `ItemCreate.validate_url` (:104): change the decorator field list from `("video_url", "script_url", mode="before")` to `("video_url", mode="before")`:

```python
    @field_validator("video_url", mode="before")
    @classmethod
    def validate_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v
```

In `ItemCreate.check_type_fields` (:117-118), invert the `interactive_app` branch (keep the `static_page`/`video` branches unchanged):

```python
        if self.type == "interactive_app" and self.script_url is not None:
            raise ValueError(
                "script_url must not be set on create — upload the .js file and attach it via PATCH"
            )
```

In `ItemUpdate.validate_url` (:140), change the decorator field list the same way — from `("video_url", "script_url", mode="before")` to `("video_url", mode="before")`.

- [ ] **Step 4: Run the interactive_app + video schema tests**

Run: `backend/.venv/bin/pytest tests/test_items.py -k "interactive_app or video_url or invalid_video" -v` (from `backend/`)
Expected: PASS — the two new create tests, `test_api_create_item_invalid_video_url` (ftp → 422, unchanged), and any existing video tests.

- [ ] **Step 5: Run the full items suite**

Run: `backend/.venv/bin/pytest tests/test_items.py -v` (from `backend/`)
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/schemas.py backend/tests/test_items.py
git commit -m "feat(items): reject create-body script_url for interactive_app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — endpoint attach/replace/clear + AssetReference helper

**Files:**
- Modify: `backend/mathion/api/helpers.py` (ADD `sync_script_reference` after `sync_asset_references`, ends :366)
- Modify: `backend/mathion/api/items.py` (`import re`; import helper; `update_item` :173-207 region)
- Modify: `backend/mathion/api/assets.py` (`upload_asset` — add the non-empty guard, :45-50 region)
- Test: `backend/tests/test_items.py`

**Interfaces:**
- Consumes: Task 1's schema (create rejects non-null `script_url`).
- Produces:
  - `sync_script_reference(db: Session, version_id: int, item_id: int, filename: str | None) -> None` — deletes any existing `AssetReference` for `item_id`; if `filename` is given, points a fresh reference at the matching `Asset` in the version (raises `HTTPException(422)` if no such asset). Repoint-on-replace and clear-on-remove both fall out of delete-then-optional-add.
  - `PATCH /api/items/{id}` with `{script_url: "<name>.js"}` validates the filename (anchored charset + no `..`) and asset existence, then maintains the reference; `{script_url: null}` clears it; the old `script_url is None → 422` guard is gone.
  - `POST /api/versions/{id}/assets` rejects an empty (or whitespace-only) upload with 400 — the spec §8 server-side non-empty guard for the direct-API path (applies to all asset types; an empty file of any type is meaningless).

Implements spec §5 (Backend changes — Endpoint; dedicated AssetReference helper) + §8 (server-side non-empty guard).

- [ ] **Step 1: Write the failing tests**

Add these tests to `backend/tests/test_items.py` (Task 1 Step 1 already deleted the obsolete `test_api_patch_interactive_app_nullify_script_url_returns_422`). Add a small upload helper if one isn't already in the file (place it near `_setup_sequence`). `test_api_patch_interactive_app_clear_script_url_allowed` below is the new coverage for the now-allowed null (clear) path.

```python
def _upload_js(admin_client, version_id, name="app.js", body=b"//app\ndocument.getElementById('app-root');"):
    resp = admin_client.post(
        f"/api/versions/{version_id}/assets",
        files={"file": (name, body, "application/javascript")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["filename"]


def _make_interactive_app(admin_client, seq):
    return admin_client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "App", "type": "interactive_app",
    }).json()


def test_api_patch_interactive_app_attach_valid_filename(admin_client):
    seq, version = _setup_sequence(admin_client)
    item = _make_interactive_app(admin_client, seq)
    fn = _upload_js(admin_client, version["id"])
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"script_url": fn})
    assert resp.status_code == 200
    assert resp.json()["script_url"] == fn
    # AssetReference created → asset now referenced → force-free delete is blocked.
    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    assert next(a for a in assets if a["filename"] == fn)["is_referenced"] is True


def test_api_patch_interactive_app_url_or_traversal_rejected(admin_client):
    seq, version = _setup_sequence(admin_client)
    item = _make_interactive_app(admin_client, seq)
    _upload_js(admin_client, version["id"])
    for bad in ["https://example.com/app.js", "../app.js", "..%2fapp.js", "app.txt", "missing.js"]:
        resp = admin_client.patch(f"/api/items/{item['id']}", json={"script_url": bad})
        assert resp.status_code == 422, f"{bad!r} should be rejected"


def test_api_patch_interactive_app_clear_script_url_allowed(admin_client):
    seq, version = _setup_sequence(admin_client)
    item = _make_interactive_app(admin_client, seq)
    fn = _upload_js(admin_client, version["id"])
    admin_client.patch(f"/api/items/{item['id']}", json={"script_url": fn})
    # Clear → allowed, reference dropped, asset becomes force-free deletable.
    resp = admin_client.patch(f"/api/items/{item['id']}", json={"script_url": None})
    assert resp.status_code == 200
    assert resp.json()["script_url"] is None
    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    assert next(a for a in assets if a["filename"] == fn)["is_referenced"] is False


def test_api_patch_interactive_app_replace_repoints_reference(admin_client):
    seq, version = _setup_sequence(admin_client)
    item = _make_interactive_app(admin_client, seq)
    a = _upload_js(admin_client, version["id"], name="a.js")
    b = _upload_js(admin_client, version["id"], name="b.js")
    admin_client.patch(f"/api/items/{item['id']}", json={"script_url": a})
    admin_client.patch(f"/api/items/{item['id']}", json={"script_url": b})
    assets = {x["filename"]: x for x in admin_client.get(f"/api/versions/{version['id']}/assets").json()}
    assert assets["a.js"]["is_referenced"] is False   # superseded → now free
    assert assets["b.js"]["is_referenced"] is True
    # The superseded asset is force-free deletable; the current one is protected.
    aid = assets["a.js"]["id"]; bid = assets["b.js"]["id"]
    assert admin_client.delete(f"/api/assets/{aid}").status_code == 204
    assert admin_client.delete(f"/api/assets/{bid}").status_code == 409
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/pytest tests/test_items.py -k "interactive_app_attach or interactive_app_url_or_traversal or interactive_app_clear or interactive_app_replace" -v` (from `backend/`)
Expected: FAIL — attach returns 200 but creates no `AssetReference`, so the `is_referenced is True` assertion fails (no charset/existence validation, no ref yet); the url/traversal test fails (nothing rejects those values); the replace test's `is_referenced`/409 assertions fail; the clear test hits the old `script_url is None → 422` guard.

- [ ] **Step 3: Add the `sync_script_reference` helper**

In `backend/mathion/api/helpers.py`, add after `sync_asset_references` (after :366):

```python
def sync_script_reference(
    db: Session,
    version_id: int,
    item_id: int,
    filename: str | None,
) -> None:
    """Maintain the single AssetReference for an interactive_app item's script.

    Deletes any existing reference for the item, then (when `filename` is given)
    points a fresh reference at the matching Asset in this version. Repoint-on-
    replace and clear-on-remove both fall out of delete-then-optional-add. This
    is the interactive_app counterpart to the markdown-driven
    `sync_asset_references` — kept separate because an interactive_app item has
    no content_md to extract filenames from.

    Raises 422 when `filename` names an asset that doesn't exist in the version.
    """
    from sqlalchemy import delete as sa_delete
    from mathion.models import Asset, AssetReference

    db.execute(sa_delete(AssetReference).where(AssetReference.item_id == item_id))
    if filename is None:
        return
    asset_id = db.scalar(
        select(Asset.id).where(Asset.version_id == version_id, Asset.filename == filename)
    )
    if asset_id is None:
        raise HTTPException(
            status_code=422,
            detail=f"No uploaded asset named '{filename}' in this version",
        )
    db.add(AssetReference(asset_id=asset_id, item_id=item_id))
```

(`select`, `HTTPException`, and `Session` are already imported in `helpers.py`.)

- [ ] **Step 4: Wire the endpoint + remove the null guard**

In `backend/mathion/api/items.py`:

1. Add `import re` as a new top line (`items.py` opens directly with `from fastapi import …` — there is no existing stdlib-import block to join).
2. Extend the helpers import (:6) to include `sync_script_reference`:

```python
from mathion.api.helpers import bump_content_updated_at, get_or_404, render_with_assets, require_course_admin, slugify, sync_asset_references, sync_script_reference
```

3. In `update_item`, after the type-invariant comment block (:189-198) and immediately **before** the type-invariant checks — i.e. insert after :198, before the `static_page` invariant at :199 — insert:

```python
    if item.type == "interactive_app" and "script_url" in updates:
        filename = updates["script_url"]
        if filename is not None and (
            not re.fullmatch(r"[a-z0-9][a-z0-9.-]*\.js", filename) or ".." in filename
        ):
            db.rollback()
            raise HTTPException(
                status_code=422,
                detail="script_url must be the filename of an uploaded .js asset",
            )
        try:
            sync_script_reference(db, version.id, item.id, filename)
        except HTTPException:
            db.rollback()
            raise
```

4. Remove the now-obsolete post-flush guard (:205-207):

```python
    if item.type == "interactive_app" and item.script_url is None:
        db.rollback()
        raise HTTPException(status_code=422, detail="script_url cannot be null for interactive_app items")
```

(Keep the `static_page` and `video` invariant checks.)

- [ ] **Step 5: Run the new tests**

Run: `backend/.venv/bin/pytest tests/test_items.py -k "interactive_app_attach or interactive_app_url_or_traversal or interactive_app_clear or interactive_app_replace" -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 6: Run the full items + assets suites (regression)**

Run: `backend/.venv/bin/pytest tests/test_items.py tests/test_assets_api.py -v` (from `backend/`)
Expected: PASS (title-only PATCH on an interactive_app no longer 422s; delete-protection unchanged for markdown assets).

- [ ] **Step 7: Write the failing empty-upload test**

Spec §8 requires a server-side non-empty guard for the direct-API upload path (the client scan is bypassable). Add to `backend/tests/test_items.py`:

```python
def test_upload_empty_asset_rejected(admin_client):
    """Direct-API guard: an empty (or whitespace-only) upload is rejected (400)."""
    seq, version = _setup_sequence(admin_client)
    resp = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("empty.js", b"", "application/javascript")},
    )
    assert resp.status_code == 400
    resp2 = admin_client.post(
        f"/api/versions/{version['id']}/assets",
        files={"file": ("blank.js", b"   \n\t", "application/javascript")},
    )
    assert resp2.status_code == 400
```

- [ ] **Step 8: Run it to verify it fails**

Run: `backend/.venv/bin/pytest tests/test_items.py::test_upload_empty_asset_rejected -v` (from `backend/`)
Expected: FAIL — `upload_asset` currently accepts empty content (201).

- [ ] **Step 9: Add the non-empty guard to `upload_asset`**

In `backend/mathion/api/assets.py`, after the size upper-bound check (after :50, before the version-quota check at :52), insert:

```python
    if not content.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
```

(`content` is `bytes`; `b"".strip()` / `b"  \n".strip()` are falsy, so empty and whitespace-only files are rejected. A valid asset of any type is never whitespace-only, so this is safe for images/PDFs too.)

- [ ] **Step 10: Run the empty-upload test + the assets regression suite**

Run: `backend/.venv/bin/pytest tests/test_items.py::test_upload_empty_asset_rejected tests/test_assets_api.py -v` (from `backend/`)
Expected: PASS (no existing test uploads an empty file — verified: test_assets_api.py:112 writes bytes to disk, not via the endpoint).

- [ ] **Step 11: Commit**

```bash
git add backend/mathion/api/helpers.py backend/mathion/api/items.py backend/mathion/api/assets.py backend/tests/test_items.py
git commit -m "feat(items): attach/replace/clear interactive_app script; reject empty uploads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend — publish loop skips interactive_app (reference survives publish)

**Files:**
- Modify: `backend/mathion/api/versions.py` (publish re-render loop :271-273)
- Test: `backend/tests/test_items.py`

**Interfaces:**
- Consumes: Task 2's `sync_script_reference` (the reference it must protect).
- Produces: `publish_version` no longer runs the markdown `sync_asset_references` for `interactive_app` items, so a script `AssetReference` survives publish.

Implements spec §5 (the publish loop is the load-bearing wipe site).

Background: `sync_asset_references` deletes-all-rows-for-`item_id` then rebuilds only from `content_md`. The publish loop (`versions.py:271-273`) calls it for **every** item; an `interactive_app` has no `content_md`, so it would delete-then-rebuild-nothing → wipe the script reference. Per spec §5 the publish loop is the only live wipe vector (the create path has no reference yet; a content-PATCH never carries `content_md` for `interactive_app`), so guarding it here is the complete fix.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_items.py` (reuses the `_upload_js` / `_make_interactive_app` helpers from Task 2):

```python
def test_interactive_app_reference_survives_publish(admin_client):
    """The script AssetReference must not be wiped by the publish re-render loop."""
    seq, version = _setup_sequence(admin_client)
    item = _make_interactive_app(admin_client, seq)
    fn = _upload_js(admin_client, version["id"])
    admin_client.patch(f"/api/items/{item['id']}", json={"script_url": fn})
    pub = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert pub.status_code == 200, pub.text
    assets = admin_client.get(f"/api/versions/{version['id']}/assets").json()
    assert next(a for a in assets if a["filename"] == fn)["is_referenced"] is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `backend/.venv/bin/pytest tests/test_items.py::test_interactive_app_reference_survives_publish -v` (from `backend/`)
Expected: FAIL — `is_referenced` is `False` after publish (the reference was wiped).

- [ ] **Step 3: Skip interactive_app in the publish loop**

In `backend/mathion/api/versions.py`, change the item re-render loop (:271-273):

```python
    for item in items_to_render:
        if item.type == "interactive_app":
            # No content_md; its script AssetReference is maintained by the
            # item endpoint (sync_script_reference), not the markdown sync.
            # Running sync_asset_references here would delete-then-rebuild-
            # nothing and wipe that reference.
            continue
        item.content_html = render_with_assets(db, version_id, item.content_md)
        sync_asset_references(db, version_id, [item.content_md], {"item_id": item.id})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `backend/.venv/bin/pytest tests/test_items.py::test_interactive_app_reference_survives_publish -v` (from `backend/`)
Expected: PASS.

- [ ] **Step 5: Run the versions + items suites (regression)**

Run: `backend/.venv/bin/pytest tests/test_items.py tests/test_versions.py -v` (from `backend/`)
Expected: PASS (markdown items still re-render + re-sync at publish).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/api/versions.py backend/tests/test_items.py
git commit -m "fix(versions): publish loop skips interactive_app to preserve script ref

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — host/scan/fetch libs + nullable type

**Files:**
- Create: `frontend/src/lib/interactiveHost.ts`
- Create: `frontend/src/lib/appSourceScan.ts`
- Modify: `frontend/src/lib/assets.ts` (ADD `fetchAssetSource` after `uploadAsset`, :77)
- Modify: `frontend/src/lib/types.ts` (`InteractiveAppItem.script_url` :95 → `string | null`)
- Test: `frontend/src/tests/interactiveHost.test.ts`, `frontend/src/tests/appSourceScan.test.ts`, `frontend/src/tests/fetchAssetSource.test.ts`

**Interfaces:**
- Consumes: nothing (leaf libs).
- Produces:
  - `escapeScriptClose(source: string): string`
  - `buildAppSrcdoc(scriptSource: string): string`
  - `scanAppSource(source: string): string[]`
  - `fetchAssetSource(versionId: number, filename: string, signal?: AbortSignal): Promise<string>`
  - `InteractiveAppItem.script_url: string | null`

These are pure additions/compatible changes: existing consumers already null-tolerate `script_url` (`?? ''` / nullable params), so the type change keeps the tree green.

Implements spec §6 (host page), §7 (fetch helper), §8 (heuristic scan), §9 (type).

- [ ] **Step 1: Write the failing tests**

`frontend/src/tests/interactiveHost.test.ts`:

```typescript
import { it, expect } from 'vitest';
import { escapeScriptClose, buildAppSrcdoc } from '../lib/interactiveHost';

it('escapes EVERY </script>, case-preserving', () => {
  const src = "a</script>b</SCRIPT>c</ScRiPt>d";
  const out = escapeScriptClose(src);
  // No raw closing tag survives (case-insensitive) — none may terminate the host <script>.
  expect(/<\/script/i.test(out)).toBe(false);
  // Case is preserved (a lowercasing replace would corrupt mixed-case string literals).
  expect(out).toContain('<\\/script>');
  expect(out).toContain('<\\/SCRIPT>');
  expect(out).toContain('<\\/ScRiPt>');
});

it('does not alter a source without a closing tag', () => {
  const src = "const x = '<script-ish but not closing>';";
  expect(escapeScriptClose(src)).toBe(src);
});

// The exact CSP the Global Constraints mandate (verbatim). Asserting the whole
// string — not a few substrings — makes a dropped/reordered directive (e.g. a
// missing `worker-src`/`object-src`) FAIL rather than slip through.
const EXPECTED_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; " +
  "worker-src 'none'; object-src 'none'";

it('buildAppSrcdoc inlines the escaped source with #app-root and the exact CSP', () => {
  const doc = buildAppSrcdoc("console.log('hi')");
  expect(doc).toContain('id="app-root"');
  expect(doc).toContain("console.log('hi')");
  expect(doc).toContain(`content="${EXPECTED_CSP}"`);  // full policy, verbatim
  expect(doc).not.toContain("'unsafe-eval'");
  // Exactly ONE raw </script> — the host terminator. The app source is escaped,
  // so any </script> it contained cannot appear raw (discriminates a first-
  // occurrence-only / case-lowercasing escape that would leak a second one).
  expect(doc.match(/<\/script/gi)?.length).toBe(1);   // no trailing `>` → also counts a `</script `-style variant
});

it('an app source containing </script> yields exactly one raw terminator', () => {
  const doc = buildAppSrcdoc("var s = '</script><script>evil()</script>';");
  expect(doc.match(/<\/script/gi)?.length).toBe(1);   // no trailing `>` → also counts a `</script `-style variant
});
```

`frontend/src/tests/appSourceScan.test.ts`:

```typescript
import { it, expect } from 'vitest';
import { scanAppSource } from '../lib/appSourceScan';

it('warns on ES-module tokens', () => {
  expect(scanAppSource("import x from 'y';").some((w) => w.includes('ES module'))).toBe(true);
  expect(scanAppSource("export const a = 1;").some((w) => w.includes('ES module'))).toBe(true);
});

it('warns when #app-root is not referenced', () => {
  expect(scanAppSource("console.log(1)").some((w) => w.includes('app-root'))).toBe(true);
});

it('does not warn about app-root when present', () => {
  expect(scanAppSource("document.getElementById('app-root')").some((w) => w.includes('app-root'))).toBe(false);
});

it('warns on network/external calls', () => {
  for (const s of ['fetch(1)', 'new XMLHttpRequest()', 'new WebSocket(x)', 'new EventSource(x)', 'navigator.sendBeacon(x)', "import('x')", 'https://cdn.example.com/x.js']) {
    expect(scanAppSource(s).some((w) => w.includes('Network')), s).toBe(true);
  }
});

it('a clean self-contained file yields no warnings', () => {
  const clean = "const r = document.getElementById('app-root'); r.textContent = 'ok';";
  expect(scanAppSource(clean)).toEqual([]);
});
```

`frontend/src/tests/fetchAssetSource.test.ts`:

```typescript
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAssetSource } from '../lib/assets';
import { ApiError } from '../lib/api';
import * as events from '../lib/events';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; vi.restoreAllMocks(); });

function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}

it('returns the response body text on success', async () => {
  fetchSpy.mockImplementation(() => tres("console.log(1)"));
  await expect(fetchAssetSource(5, 'app.js')).resolves.toBe("console.log(1)");
  const [url, init] = fetchSpy.mock.calls[0];
  expect(String(url)).toBe('/assets/5/app.js');
  expect((init as RequestInit).credentials).toBe('include');
});

it('emits unauthorized and throws ApiError(401) on 401', async () => {
  const emit = vi.spyOn(events, 'emitUnauthorized').mockImplementation(() => {});
  fetchSpy.mockImplementation(() => tres('', 401));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toBeInstanceOf(ApiError);
  expect(emit).toHaveBeenCalledOnce();
});

it('throws ApiError on other non-2xx', async () => {
  fetchSpy.mockImplementation(() => tres('', 404));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toMatchObject({ status: 404 });
});

it('rethrows AbortError untouched', async () => {
  fetchSpy.mockImplementation(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  await expect(fetchAssetSource(5, 'app.js')).rejects.toMatchObject({ name: 'AbortError' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/tests/interactiveHost.test.ts src/tests/appSourceScan.test.ts src/tests/fetchAssetSource.test.ts`
Expected: FAIL — modules/exports not defined.

- [ ] **Step 3: Create `lib/interactiveHost.ts`**

```typescript
// Builds the sandboxed host document for an interactive app. The app's JS
// SOURCE is INLINED into a classic <script> inside an opaque-origin iframe
// srcdoc (upload-model spec §4/§6). InteractiveFrame is the only caller; this
// module is the sole authority for the CSP + the </script> escaping.

// Neutralize EVERY sequence that could terminate the host <script>. `</script`
// (case-insensitive) is the only such sequence. Insert a backslash after `<`
// while PRESERVING the matched case: `\/`≡`/` inside the string/regex/comment
// literals where such a sequence legally occurs in a bundle, so the code stays
// equivalent. A naive '<\\/script' replacement would lowercase `</SCRIPT>` and
// corrupt a mixed-case literal; a first-occurrence-only .replace is a breakout.
export function escapeScriptClose(source: string): string {
  return source.replace(/<(\/script)/gi, '<\\$1');
}

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; " +
  "worker-src 'none'; object-src 'none'";

export function buildAppSrcdoc(scriptSource: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>html,body{margin:0;height:100%}#app-root{width:100%;height:100%}</style>
</head>
<body>
<div id="app-root"></div>
<script>${escapeScriptClose(scriptSource)}</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Create `lib/appSourceScan.ts`**

```typescript
// Client-side heuristic scan of an uploaded interactive-app JS file. ADVISORY
// warnings to catch honest packaging mistakes (ES-module entry, missing
// #app-root mount, network calls) — NOT a security control (the sandbox + CSP
// are). String scans are evadable and false-positive-prone, so every hit is a
// non-blocking warning. See the upload-model spec §8.
export function scanAppSource(source: string): string[] {
  const warnings: string[] = [];
  if (/\b(import|export)\b/.test(source)) {
    warnings.push('Looks like an ES module — must be a single classic/IIFE bundle.');
  }
  if (!source.includes('app-root')) {
    warnings.push("Doesn't reference `#app-root` — make sure your app mounts into it.");
  }
  if (/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(|https?:\/\//.test(source)) {
    warnings.push('Network requests (fetch, XHR, WebSocket, EventSource, beacons) and external/CDN scripts are blocked by the CSP — the app must be self-contained.');
  }
  return warnings;
}
```

- [ ] **Step 5: Add `fetchAssetSource` to `lib/assets.ts`**

Insert after `uploadAsset` (after :77), before `listAssets`:

```typescript
// Fetch an asset's raw text via a credentialed same-origin GET. Used to inline
// an interactive-app's JS SOURCE into the sandboxed InteractiveFrame srcdoc
// (upload-model spec §4/§7). Cannot use api.get — that always does res.json();
// this needs res.text(). The session cookie is SameSite=Lax and this GET is
// same-origin from the authenticated main document, so the cookie attaches and
// the /assets auth gate holds (no CSRF header needed for GET). On 401 mirror
// api.ts:request → emitUnauthorized with the full location.
export async function fetchAssetSource(
  versionId: number,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response;
  try {
    // encodeURIComponent is defensive: the endpoint only ever stores sanitized
    // filenames (`[a-z0-9.-]`, so it is a no-op for real data), but it keeps the
    // client from depending on that server invariant if a write path ever loosens.
    res = await fetch(`/assets/${versionId}/${encodeURIComponent(filename)}`, { credentials: 'include', signal });
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach server. Check your connection.');
  }
  if (res.status === 401) {
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }
  return res.text();
}
```

(`ApiError` and `emitUnauthorized` are already imported at the top of `assets.ts`.)

- [ ] **Step 6: Make the student `InteractiveAppItem` type nullable**

In `frontend/src/lib/types.ts`, change `script_url: string;` (:95, inside `export type InteractiveAppItem`) to:

```typescript
  script_url: string | null;
```

(Leave the `AdminTreeItem.script_url` at :234 unchanged — it is already `string | null`.)

- [ ] **Step 7: Run the tests + type check**

Run: `cd frontend && npm test -- src/tests/interactiveHost.test.ts src/tests/appSourceScan.test.ts src/tests/fetchAssetSource.test.ts`
Expected: PASS.
Run: `cd frontend && npm run check`
Expected: 0 errors (existing consumers already null-tolerate `script_url`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/interactiveHost.ts frontend/src/lib/appSourceScan.ts frontend/src/lib/assets.ts frontend/src/lib/types.ts frontend/src/tests/interactiveHost.test.ts frontend/src/tests/appSourceScan.test.ts frontend/src/tests/fetchAssetSource.test.ts
git commit -m "feat(interactive-app): add host-srcdoc, source-scan, and fetch helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — frame flip + player + editor delegation (render pipeline)

This is the atomic frame-signature flip: `InteractiveFrame`'s two live consumers (the player and `ItemEditPage`) must switch off the old `src` prop in the same commit, or the suite goes red. `InteractiveAppEditor` is introduced here in RENDER-ONLY form (preview / empty / readonly); its upload UX is added in Task 6.

**Files:**
- Modify: `frontend/src/components/items/InteractiveFrame.svelte`
- Modify: `frontend/src/components/items/InteractiveAppItem.svelte`
- Create: `frontend/src/components/items/InteractiveAppEditor.svelte`
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte`
- Modify: `frontend/src/lib/safeIframeUrl.ts` (doc-comment)
- Test: `frontend/src/tests/InteractiveFrame.svelte.test.ts` (rewrite), `frontend/src/tests/InteractiveAppItem.svelte.test.ts` (rewrite), `frontend/src/tests/InteractiveAppEditor.svelte.test.ts` (new), `frontend/src/tests/ItemEditPage.interactive.svelte.test.ts` (rewrite), `frontend/src/tests/ItemRouter.svelte.test.ts` (rewrite — its interactive_app routing test mounts the reworked player)

**Interfaces:**
- Consumes: `buildAppSrcdoc`, `fetchAssetSource` (Task 4); `currentCourse`/`markItemCovered` (`stores/currentCourse.svelte`); `createCoverageTracker` (`lib/coverage.svelte`).
- Produces:
  - `InteractiveFrame` props `{ scriptSource: string; title: string }` — renders `<iframe srcdoc={buildAppSrcdoc(scriptSource)} sandbox="allow-scripts" referrerpolicy="no-referrer">` at 600px.
  - `InteractiveAppItem` (player) fetches source and covers on fetch success (async-coverage restructure).
  - `InteractiveAppEditor` props `{ item: AdminTreeItem; versionId: number; editable: boolean }` — preview / empty / readonly render states (no upload yet).
  - `ItemEditPage` delegates `interactive_app` to `InteractiveAppEditor`.

Implements spec §6 (`InteractiveFrame`), §7 (player async-coverage; version_id from `currentCourse`; empty/error copy), §9 (rework list; safeIframeUrl doc revert).

- [ ] **Step 1: Rewrite the `InteractiveFrame` test**

Replace `frontend/src/tests/InteractiveFrame.svelte.test.ts` entirely:

```typescript
import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveFrame from '../components/items/InteractiveFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { scriptSource: string; title: string }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state(props);
  const cmp = mount(InteractiveFrame, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector('iframe') as HTMLIFrameElement;
}

it('inlines the source into a srcdoc with #app-root and the CSP', () => {
  const f = mountFrame({ scriptSource: "console.log('hi')", title: 'My app' });
  const doc = f.getAttribute('srcdoc') ?? '';
  expect(doc).toContain('id="app-root"');
  expect(doc).toContain("console.log('hi')");
  expect(doc).toContain("connect-src 'none'");
  expect(f.getAttribute('title')).toBe('My app');
  expect(f.hasAttribute('src')).toBe(false);   // never a URL
  expect(f.parentElement?.classList.contains('frame')).toBe(true);  // fixed-height (600px) wrapper present; exact px is manual-smoke (jsdom has no layout)
});

it('sandbox is exactly allow-scripts (no allow-same-origin)', () => {
  const f = mountFrame({ scriptSource: 'x', title: 't' });
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
});

it('sets referrerpolicy=no-referrer and omits allowfullscreen', () => {
  const f = mountFrame({ scriptSource: 'x', title: 't' });
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(f.hasAttribute('allowfullscreen')).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm test -- src/tests/InteractiveFrame.svelte.test.ts`
Expected: FAIL — `InteractiveFrame` still takes `src`.

- [ ] **Step 3: Rework `InteractiveFrame.svelte`**

Replace the file with:

```svelte
<script lang="ts">
  // Shared fixed-height (600px) sandboxed iframe for interactive apps. The app
  // JS SOURCE (not a URL) is inlined into the iframe srcdoc as a classic
  // <script> (see lib/interactiveHost + the upload-model spec §6). Used by the
  // student player and the editor preview.
  //
  // sandbox="allow-scripts" WITHOUT allow-same-origin keeps the app in an
  // opaque origin (no parent DOM / cookie / storage / session access). NEVER
  // add allow-same-origin (de-isolation), allow-top-navigation*,
  // allow-popups-to-escape-sandbox, allow-downloads, allow-modals, or
  // allow-storage-access-by-user-activation. No allowfullscreen (out of scope).
  // scriptSource is ONLY ever inlined into this sandboxed srcdoc — never
  // {@html}'d / innerHTML'd into a Mathion page.
  //
  // Network egress: the CSP (connect-src 'none' + default-src 'none') blocks all
  // fetch/XHR/WebSocket/beacon/subresource loads. The ONE residual is SELF-
  // navigation (`location = 'https://…'`): no sandbox token or well-supported CSP
  // directive blocks a frame navigating its OWN context (allow-top-navigation*
  // stays off, so it can't touch the top window). Accepted: the frame is
  // opaque-origin and stays sandboxed across the navigation, so there is no
  // Mathion-origin/session/cookie/parent-DOM exfil. Self-navigation CAN transmit
  // data the app itself sees IN-FRAME (its own source, plus any student input or
  // interaction telemetry it collects) — accepted because the upload is
  // admin-authored (the app legitimately observes its own in-frame interaction).
  import { buildAppSrcdoc } from '../../lib/interactiveHost';
  let { scriptSource, title }: { scriptSource: string; title: string } = $props();
  const srcdoc = $derived(buildAppSrcdoc(scriptSource));
</script>

<div class="frame">
  <iframe {srcdoc} {title} sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
</div>

<style>
  .frame { width: 100%; height: 600px; margin-bottom: var(--space-3); }
  .frame iframe { width: 100%; height: 100%; border: 0; }
</style>
```

- [ ] **Step 4: Run the frame test to verify it passes**

Run: `cd frontend && npm test -- src/tests/InteractiveFrame.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the player test**

Replace `frontend/src/tests/InteractiveAppItem.svelte.test.ts` entirely. The `fetch` stub branches by URL (`/assets/…` → JS text, `/api/items/7/track` → track json) so both async layers settle and negative "not covered" assertions aren't vacuous. `currentCourse` is seeded (via `__test__setSlots`) so the player has a `versionId` to build the fetch URL and `markItemCovered` finds the item's state slot.

```typescript
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppItem from '../components/items/InteractiveAppItem.svelte';
import { __test__setSlots } from '../stores/currentCourse.svelte';
import type { InteractiveAppItem as IAItem } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}
function jres(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
}
// Branch by URL so both the source fetch and the coverage POST settle.
function routed(sourceOrStatus: string | number = "getElementById('app-root')") {
  return (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/assets/')) return typeof sourceOrStatus === 'number' ? tres('', sourceOrStatus) : tres(sourceOrStatus);
    if (u.includes('/track')) return jres({ item_id: 7, is_covered: true, time_spent: 0 });
    return jres({});
  };
}
// 12 microtask drains suffice ONLY because lib/api is module-warm: this file
// statically imports __test__setSlots from currentCourse.svelte, which imports
// lib/api, so the tracker's `await import('./api')` resolves without a macrotask.
// The added fetchAssetSource fetch→text() hops still settle within 12. Do NOT
// drop the currentCourse import to "clean up".
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const appItem = (over: Partial<IAItem> = {}): IAItem => ({
  id: 7, sequence_id: 3, title: 'Sandbox', slug: 'sandbox', order: 1,
  type: 'interactive_app', script_url: 'app.js', ...over,
});

function seedCourse() {
  __test__setSlots({
    slug: 'c', versionId: 5,
    course: { id: 1, slug: 'c', name: 'C' },
    version: { id: 5 } as never,
    blocks: [],
    state: { version_id: 5, current_item_id: null, items: { '7': { is_covered: false, time_spent_seconds: 0, last_visited_at: null, last_answers: null, attempt_count: 0, score_correct: null, score_total: null } } } as never,
    miniProjectsByBlockId: {},
  });
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(routed());
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  seedCourse();
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  __test__setSlots(null);
});

function mountItem(props: { item: IAItem; isCovered: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state(props);
  const cmp = mount(InteractiveAppItem, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
const trackCalls = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/items/7/track'));

it('fetches the source, renders the frame, and auto-covers once on success', async () => {
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  const f = target.querySelector('iframe');
  expect(f).not.toBeNull();
  expect(f?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
  expect(trackCalls().length).toBe(1);
  expect(JSON.parse((trackCalls()[0][1] as RequestInit).body as string).is_covered).toBe(true);
});

it('does NOT cover when already covered', async () => {
  mountItem({ item: appItem(), isCovered: true });
  await settle();
  expect(trackCalls().length).toBe(0);
});

it('shows "couldn\'t be loaded" and does NOT cover on fetch failure', async () => {
  fetchSpy.mockImplementation(routed(404));
  const target = mountItem({ item: appItem(), isCovered: false });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain("couldn't be loaded");
  expect(trackCalls().length).toBe(0);
});

it('shows "No app uploaded yet." and does NOT cover when script_url is null', async () => {
  const target = mountItem({ item: appItem({ script_url: null }), isCovered: false });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain('No app uploaded yet.');
  expect(trackCalls().length).toBe(0);
});

it('a late fetch after unmount neither starts a tracker nor covers (stale guard)', async () => {
  let resolveSrc: (v: Response) => void = () => {};
  fetchSpy.mockImplementation((input: RequestInfo | URL) => {
    if (String(input).includes('/assets/')) return new Promise<Response>((r) => { resolveSrc = r; });
    if (String(input).includes('/track')) return jres({});
    return jres({});
  });
  const target = mountItem({ item: appItem(), isCovered: false });
  flushSync();
  cleanup?.(); cleanup = null;            // unmount BEFORE the source resolves
  resolveSrc({ ok: true, status: 200, statusText: 'x', text: () => Promise.resolve("app-root") } as unknown as Response);
  await settle();
  expect(trackCalls().length).toBe(0);    // stale guard: no cover after teardown
  void target;
});
```

> **Note (why there is no dedicated "untrack regression" test):** in the reworked player the `isCovered` read sits inside the fetch `.then()` continuation, which runs *after* the effect body returns — a reactive read there is **not** registered as an effect dependency (verified empirically: flipping a value read only inside `.then()` does not re-run the `$effect`). So `markItemCovered`'s store flip cannot re-run this effect and cannot double-cover, *regardless* of `untrack`. A test that removed `untrack` would therefore stay green, so it would not discriminate anything. The once-only property is instead guaranteed structurally and is covered by the tests above: **covers exactly once on success** (test 1) and **does not cover when already covered** (test 2). `untrack` is retained in the component as documented belt-and-suspenders (see Step 7).

- [ ] **Step 6: Run it to verify it fails**

Run: `cd frontend && npm test -- src/tests/InteractiveAppItem.svelte.test.ts`
Expected: FAIL — the player still uses `safeAppUrl(item.script_url)` and passes `src`.

- [ ] **Step 7: Rework `InteractiveAppItem.svelte`**

Replace the file with:

```svelte
<script lang="ts">
  import { untrack } from 'svelte';
  import type { InteractiveAppItem } from '../../lib/types';
  import { fetchAssetSource } from '../../lib/assets';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered, currentCourse } from '../../stores/currentCourse.svelte';
  import InteractiveFrame from './InteractiveFrame.svelte';

  let { item, isCovered }: { item: InteractiveAppItem; isCovered: boolean } = $props();

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');

  // The source loads asynchronously, so auto-coverage moves into the fetch-
  // SUCCESS continuation (NOT synchronous mount). The effect reads item.id,
  // script_url, and versionId reactively so navigation/replace tears down the
  // prior run; an AbortController + `stale` guard stop a late-resolving fetch
  // (after teardown, navigation, or a script_url change mid-flight) from
  // starting a tracker or covering. Coverage is credited on a SUCCESSFUL source
  // fetch only — never on unset script_url or on fetch failure. Capture `id`
  // once so the post-await store write can't target the wrong item. The
  // isCovered read via untrack is belt-and-suspenders: it lives in the async
  // .then() continuation, so it is ALREADY outside this effect's synchronous
  // dependency tracking (markItemCovered's store flip cannot re-run this
  // effect). untrack documents the once-only intent and keeps the read
  // untracked even if the check is ever moved into the synchronous effect body.
  $effect(() => {
    const id = item.id;
    const filename = item.script_url;
    const versionId = currentCourse.value?.versionId;

    if (!filename) { status = 'empty'; source = null; return; }
    if (versionId == null) { status = 'loading'; source = null; return; }

    status = 'loading';
    source = null;
    const controller = new AbortController();
    let stale = false;
    let tracker: ReturnType<typeof createCoverageTracker> | null = null;

    void fetchAssetSource(versionId, filename, controller.signal)
      .then((text) => {
        if (stale) return;
        source = text;
        status = 'ready';
        tracker = createCoverageTracker(id);
        tracker.start();
        if (!untrack(() => isCovered)) {
          void tracker.markCovered().then(() => markItemCovered(id));
        }
      })
      .catch((e: unknown) => {
        if (stale || (e as { name?: string })?.name === 'AbortError') return;
        status = 'error';
        source = null;
      });

    return () => {
      stale = true;
      controller.abort();
      if (tracker) void tracker.stop();
    };
  });
</script>

<article class="interactive-app">
  <h2>{item.title}</h2>
  {#if status === 'ready' && source !== null}
    <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} />
  {:else if status === 'error'}
    <p class="notice">This app couldn't be loaded.</p>
  {:else if status === 'empty'}
    <p class="notice">No app uploaded yet.</p>
  {/if}
</article>

<style>
  .interactive-app { padding: var(--space-3); }
  .notice { color: var(--muted); font-style: italic; }
</style>
```

- [ ] **Step 8: Run the player test to verify it passes**

Run: `cd frontend && npm test -- src/tests/InteractiveAppItem.svelte.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the `InteractiveAppEditor` render-state test (new)**

`frontend/src/tests/InteractiveAppEditor.svelte.test.ts`:

```typescript
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppEditor from '../components/items/InteractiveAppEditor.svelte';
import type { AdminTreeItem } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}
// Includes ONE macrotask tick: Task 6's upload path reads the file via
// FileReader, and jsdom fires FileReader.onload on a MACROTASK (verified), so a
// microtask-only drain would never settle the upload. Harmless for the
// fetch-only render tests. Drain microtasks → macrotask → microtasks → flush.
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const item = (over: Partial<AdminTreeItem> = {}): AdminTreeItem => ({
  id: 7, sequence_id: 2, title: 'App', slug: 'app', order: 1, type: 'interactive_app',
  content_md: null, content_html: null, video_url: null, script_url: 'app.js', questions_count: 0, ...over,
});

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => tres("getElementById('app-root')"));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  vi.restoreAllMocks();
});

function mountEditor(props: { item: AdminTreeItem; versionId: number; editable: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state(props);
  const cmp = mount(InteractiveAppEditor, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}

it('previews the stored app by fetching + inlining the source', async () => {
  const target = mountEditor({ item: item(), versionId: 1, editable: true });
  await settle();
  const f = target.querySelector('iframe');
  expect(f).not.toBeNull();
  expect(f?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
});

it('shows the editable empty state when no app is attached', async () => {
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain('No app uploaded yet.');
});

it('shows the readonly empty state ("No app.") when not editable and unset', async () => {
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: false });
  await settle();
  expect(target.textContent).toContain('No app.');
});

it('shows "couldn\'t be loaded" on a preview fetch failure', async () => {
  fetchSpy.mockImplementation(() => tres('', 404));
  const target = mountEditor({ item: item(), versionId: 1, editable: false });
  await settle();
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain("couldn't be loaded");
});

it('never renders a stored script_url as a link (readonly)', async () => {
  fetchSpy.mockImplementation(() => tres('', 404));
  const target = mountEditor({ item: item({ script_url: 'app.js' }), versionId: 1, editable: false });
  await settle();
  expect(target.querySelectorAll('a').length).toBe(0);
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `cd frontend && npm test -- src/tests/InteractiveAppEditor.svelte.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 11: Create `InteractiveAppEditor.svelte` (render-only)**

```svelte
<script lang="ts">
  // Editor-side interactive_app surface: previews the stored app in the real
  // strict-sandboxed frame (fetch → inline). The upload/Remove UX is added in a
  // follow-up task. NEVER renders a stored filename as a link (security §6/§9).
  import type { AdminTreeItem } from '../../lib/types';
  import { fetchAssetSource } from '../../lib/assets';
  import InteractiveFrame from './InteractiveFrame.svelte';

  let { item, versionId, editable }: {
    item: AdminTreeItem; versionId: number; editable: boolean;
  } = $props();

  let source = $state<string | null>(null);
  let status = $state<'empty' | 'loading' | 'ready' | 'error'>('empty');

  // Reactive on item.script_url so Replace/Remove re-previews. AbortController +
  // `stale` guard prevent an out-of-order fetch from flashing old source. No
  // coverage here (editor preview only).
  $effect(() => {
    const filename = item.script_url;
    if (!filename) { status = 'empty'; source = null; return; }
    status = 'loading';
    source = null;
    const controller = new AbortController();
    let stale = false;
    void fetchAssetSource(versionId, filename, controller.signal)
      .then((text) => { if (!stale) { source = text; status = 'ready'; } })
      .catch((e: unknown) => {
        if (stale || (e as { name?: string })?.name === 'AbortError') return;
        status = 'error';
        source = null;
      });
    return () => { stale = true; controller.abort(); };
  });
</script>

<section class="app-editor">
  <h3>{item.title}</h3>
  {#if status === 'ready' && source !== null}
    <InteractiveFrame scriptSource={source} title={item.title || 'Interactive app'} />
  {:else if status === 'error'}
    <p class="notice">This app couldn't be loaded.</p>
  {:else if status === 'empty'}
    <p class="notice">{editable ? 'No app uploaded yet. Choose a `.js` file to upload.' : 'No app.'}</p>
  {/if}
</section>

<style>
  .app-editor { margin: var(--space-4) 0; }
  .notice { color: var(--muted, #666); font-style: italic; }
</style>
```

- [ ] **Step 12: Run the editor render test to verify it passes**

Run: `cd frontend && npm test -- src/tests/InteractiveAppEditor.svelte.test.ts`
Expected: PASS.

- [ ] **Step 13: Rewrite the `ItemEditPage` interactive test**

Replace `frontend/src/tests/ItemEditPage.interactive.svelte.test.ts` entirely. It now asserts delegation to `InteractiveAppEditor` (no URL form; the preview goes through a fetched srcdoc). The `fetch` stub routes `/assets/…` → JS text and `/admin-tree` → the tree.

```typescript
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import ItemEditPage from '../pages/editor/ItemEditPage.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import * as assetsModule from '../lib/assets';
import type { AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
}
function tres(text: string, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', text: () => Promise.resolve(text) } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); await tick(); }

function makeVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return { id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '', max_quiz_attempts: 1, created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over };
}
const appItem: AdminTreeItem = { id: 7, sequence_id: 2, title: 'App', slug: 'app', order: 1, type: 'interactive_app', content_md: null, content_html: null, video_url: null, script_url: 'app.js', questions_count: 0 };
function buildTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  const seq: AdminTreeSequence = { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [item] };
  const block: AdminTreeBlock = { id: 3, version_id: version.id, title: 'Block', slug: 'block', order: 1, info: '', info_html: '', sequences: [seq] };
  return { course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block] };
}
function seedTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  currentEditorVersion.value = buildTree(version, item);
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((input: RequestInfo | URL) => (String(input).includes('/assets/') ? tres("getElementById('app-root')") : jres({})));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  vi.restoreAllMocks();
});

async function mountPage() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ courseSlug: 'c', versionId: '1', blockId: '3', sequenceId: '2', itemId: '7' });
  const cmp = mount(ItemEditPage, { target, props });
  cleanup = () => unmount(cmp);
  await settle();
  return target;
}
const urlInput = (t: HTMLElement) => t.querySelector('input[type="url"]') as HTMLInputElement | null;

it('delegates interactive_app to the upload editor (no URL form) on a created version', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                    // URL editing is gone
  expect(target.querySelector('iframe')).not.toBeNull();  // fetched-source preview
  expect(target.querySelector('iframe')?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
});

it('delegates on a disabled version (readonly), never a URL form; preview is gated (403)', async () => {
  seedTree(makeVersion({ is_disabled: true }));
  // A disabled version's assets are 403 for EVERYONE (serve_asset gate,
  // backend/mathion/api/assets.py:139-140) — admins included, before any
  // enrollment/role check. So the readonly editor shows the error state, not a
  // preview iframe, exactly like every other asset-backed preview on a disabled
  // version. Model that (403), don't stub success.
  fetchSpy.mockImplementation((input: RequestInfo | URL) =>
    (String(input).includes('/assets/') ? tres('Version is disabled', 403) : jres({})));
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                       // delegates — no URL form
  expect(target.querySelector('iframe')).toBeNull();         // no preview: the asset fetch is gated
  expect(target.textContent).toContain("couldn't be loaded");
});

it('shows the empty upload state when no app is attached', async () => {
  seedTree(makeVersion(), { ...appItem, script_url: null });
  const target = await mountPage();
  expect(target.textContent).toContain('No app uploaded yet.');
});
```

- [ ] **Step 14: Run it to verify it fails**

Run: `cd frontend && npm test -- src/tests/ItemEditPage.interactive.svelte.test.ts`
Expected: FAIL — `ItemEditPage` still renders the URL `<input>`.

- [ ] **Step 15: Rework `ItemEditPage.svelte` — delegate interactive_app, drop URL machinery**

Make these edits in `frontend/src/pages/editor/ItemEditPage.svelte`:

1. **Imports (:12, :17):** remove `import InteractiveFrame` (:12) and `import { safeAppUrl }` (:17). Add:

```typescript
  import InteractiveAppEditor from '../../components/items/InteractiveAppEditor.svelte';
```

2. **Type + tracker union (:54-57):** delete `type InteractiveAppForm = ...` (:54) and the `| ReturnType<typeof makeDirtyTracker<InteractiveAppForm>>` member (:57). The union becomes `StaticForm | VideoForm`.

3. **`editable` (:47):** drop `interactive_app` (it gets its own arm):

```typescript
  const editable = $derived(item?.type === 'static_page' || item?.type === 'video');
```

4. **Delete the interactive_app-only derivations/effects:** `scriptUrlInvalid` (:85-89), the `scriptPreviewUrl` state + `$effect` (:114-125), and `readonlyScriptPreviewUrl` (:135-137).

5. **`ensureLoaded` (:160):** delete the `else if (fresh.type === 'interactive_app') tracker = makeDirtyTracker<InteractiveAppForm>(...)` line — interactive_app now falls into the existing `else tracker = null;` (like quiz).

6. **`save()` (:181, :199-209, :230-232, :244-246):** delete the three `interactive_app` branches (the `else if (savedItemType === 'interactive_app')` block that sets `sentScriptUrl`/`body.script_url`; and the two `interactive_app` reset branches in the `'ok'` and `'error'` result arms) **and** delete the now-orphaned declaration `let sentScriptUrl: string | undefined;` (:181) — `tsconfig.json` has `noUnusedLocals: true`, so leaving it fails the Step 18 `npm run check`. (`sentContentMd`:179 / `sentVideoUrl`:180 stay used by the retained static_page/video branches — keep them.) `save()` is only reachable from the tracker Save button, which no longer renders for interactive_app.

7. **`discard()` (:265):** delete the `else if (item.type === 'interactive_app')` reset branch.

8. **Save-button gate (:355, :357):** remove `|| scriptUrlInvalid` from `disabled` and the `scriptUrlInvalid ? ... :` arm from `title` (video-only now):

```svelte
            disabled={!tracker.isDirty || busy || videoUrlEmpty}
            loading={busy}
            title={videoUrlEmpty ? 'Video URL is required' : ''}
```

9. **Template — add a dedicated interactive_app arm and remove the two old ones.** Change the top of the render chain so interactive_app delegates. Replace the opening `{#if editable && tracker && perms.canEditTextFields}` (:323) with:

```svelte
    {#if item.type === 'interactive_app'}
      <InteractiveAppEditor {item} versionId={vid} editable={perms.canEditTextFields} />
    {:else if editable && tracker && perms.canEditTextFields}
```

Then delete the interactive_app branch inside the editable-edit section (:343-350, the `{:else if item.type === 'interactive_app'}` block with the App-URL `<input>` + `<InteractiveFrame src=...>`), and delete the interactive_app branch inside the readonly section (:385-400, the `{:else if item.type === 'interactive_app'}` block with `readonlyScriptPreviewUrl` / the `<code>` fallback). The `{:else if editable}` readonly arm now only handles static_page/video.

- [ ] **Step 16: Revert the `safeIframeUrl` doc-comment**

In `frontend/src/lib/safeIframeUrl.ts` (:3-5), drop the interactive-app mention so it reflects video-only usage (replace the "Used directly by … interactive-app player, editor preview, and readonly preview." sentence spanning :3-5):

```typescript
// malformed URLs the URL constructor refuses. Used by the video-item editor
// preview / readonly preview.
```

- [ ] **Step 17: Rewrite the `ItemRouter` routing test**

`ItemRouter.svelte.test.ts` mounts the reworked player and asserts an iframe **synchronously** (`:57`), with `currentCourse` unseeded. Under the async rework the player early-returns (`versionId` undefined → `loading`) and renders no iframe, so the old assertion fails. But the player still renders `<article class="interactive-app"><h2>{title}</h2>` **synchronously** (outside the load conditionals), which is all a *routing* test needs. Replace the single `it(...)` in `frontend/src/tests/ItemRouter.svelte.test.ts` (lines 27-66) with:

```typescript
it('dispatches an interactive_app item to InteractiveAppItem, not UnsupportedItem', () => {
  const item: InteractiveAppItem = {
    id: 5, sequence_id: 1, title: 'App', slug: 'app', order: 1,
    type: 'interactive_app', script_url: 'app.js',
  };
  const state: VersionState = {
    version_id: 1,
    items: {
      '5': {
        is_covered: true, time_spent_seconds: 0, last_visited_at: null,
        last_answers: null, attempt_count: 0, score_correct: null, score_total: null,
      },
    },
  };
  // Pure routing assertion: InteractiveAppItem renders <article class="interactive-app">
  // + <h2> synchronously (outside the async source-load conditionals). currentCourse is
  // left unseeded, so the player's effect early-returns (versionId undefined) — no
  // tracker, no source fetch, no coverage POST — keeping this a synchronous unit test of
  // ItemRouter's dispatch. The player's async render/coverage is covered by
  // InteractiveAppItem.svelte.test.ts.
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ item, state });   // $state() must initialize a variable (runes rule)
  const cmp = mount(ItemRouter, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  expect(target.querySelector('.interactive-app')).not.toBeNull();
  expect(target.querySelector('.interactive-app h2')?.textContent).toBe('App');
  expect(target.textContent).not.toContain("isn't available");
  expect(fetchSpy).not.toHaveBeenCalled();   // unseeded versionId → no source fetch
});
```

The `performance.now` pin and `is_covered` rationale from the old test are removed — with `currentCourse` unseeded the effect early-returns before creating a tracker, so there is nothing to keep deterministic. `InteractiveAppItem` is imported only as a type here (`import type { InteractiveAppItem }`), which stays valid.

- [ ] **Step 18: Run the interactive test group + type check**

Run: `cd frontend && npm test -- src/tests/InteractiveFrame.svelte.test.ts src/tests/InteractiveAppItem.svelte.test.ts src/tests/InteractiveAppEditor.svelte.test.ts src/tests/ItemEditPage.interactive.svelte.test.ts src/tests/ItemRouter.svelte.test.ts`
Expected: PASS.
Run: `cd frontend && npm run check`
Expected: 0 errors. (If `svelte-check` flags an unused import or `InteractiveAppForm` leftover, remove it.)

- [ ] **Step 19: Commit**

```bash
git add frontend/src/components/items/InteractiveFrame.svelte frontend/src/components/items/InteractiveAppItem.svelte frontend/src/components/items/InteractiveAppEditor.svelte frontend/src/pages/editor/ItemEditPage.svelte frontend/src/lib/safeIframeUrl.ts frontend/src/tests/InteractiveFrame.svelte.test.ts frontend/src/tests/InteractiveAppItem.svelte.test.ts frontend/src/tests/InteractiveAppEditor.svelte.test.ts frontend/src/tests/ItemEditPage.interactive.svelte.test.ts frontend/src/tests/ItemRouter.svelte.test.ts
git commit -m "feat(interactive-app): inline fetched source into sandboxed frame

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — editor upload / Replace / Remove

**Files:**
- Modify: `frontend/src/components/items/InteractiveAppEditor.svelte` (add the upload widget)
- Test: `frontend/src/tests/InteractiveAppEditor.svelte.test.ts` (extend)

**Interfaces:**
- Consumes: `uploadAsset`, `fetchAssetSource` (`lib/assets`); `scanAppSource` (`lib/appSourceScan`); `api`/`ApiError` (`lib/api`); `loadAdminTree` (`stores/currentEditorVersion.svelte`); `pushToast` (`stores/toasts.svelte`); `Button` (`components/ui/Button.svelte`).
- Produces: `InteractiveAppEditor` (editable) now supports upload/Replace (`uploadAsset` → `PATCH {script_url}` → `loadAdminTree`), non-blocking heuristic warnings, empty-file rejection, a 409 duplicate-filename message, and Remove (`PATCH {script_url:null}`).

Implements spec §7 (edit/upload/Replace/Remove flow), §8 (non-empty gate + heuristic warnings).

- [ ] **Step 1: Extend the test file with upload/Remove cases**

Append to `frontend/src/tests/InteractiveAppEditor.svelte.test.ts`. Add these imports at the top and mock the mutation surfaces (`uploadAsset`, `api.patch`, `loadAdminTree`, `pushToast`). The Task 5 version of this file imports only `vitest`/`svelte`/the component/`AdminTreeItem` and drives its render tests through the global `fetchSpy`, so `assetsModule` (spied for `uploadAsset` below) is a NEW import here — omitting it leaves the appended tests referencing an undefined `assetsModule` and the file won't compile:

```typescript
import * as assetsModule from '../lib/assets';
import * as apiModule from '../lib/api';
import * as editorStore from '../stores/currentEditorVersion.svelte';
import * as toasts from '../stores/toasts.svelte';
```

Then add (the preview `fetch` stub from `beforeEach` still serves `/assets/…`):

```typescript
function chooseFile(target: HTMLElement, file: File) {
  const input = target.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  // MUST bubble: Svelte 5 event-delegates `onchange` (verified — a non-bubbling
  // `change` fires the handler 0 times; a bubbling one fires it once).
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

it('uploads a chosen file then PATCHes script_url and refreshes the tree', async () => {
  const upload = vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue({ id: 1, version_id: 1, filename: 'new.js', file_size: 3, mime_type: 'application/javascript', uploaded_at: '', uploaded_by: 1, is_referenced: false });
  const patch = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["getElementById('app-root')"], 'new.js', { type: 'application/javascript' }));
  await settle();
  expect(upload).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledWith('/api/items/7', { script_url: 'new.js' });
  expect(load).toHaveBeenCalledWith(1, { force: true });
});

it('surfaces heuristic warnings for a module-ish / networky file (non-blocking)', async () => {
  vi.spyOn(assetsModule, 'uploadAsset').mockResolvedValue({ id: 1, version_id: 1, filename: 'm.js', file_size: 3, mime_type: 'application/javascript', uploaded_at: '', uploaded_by: 1, is_referenced: false });
  vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["import x from 'y'; fetch('/z')"], 'm.js', { type: 'application/javascript' }));
  await settle();
  expect(target.textContent).toContain('ES module');
  expect(target.textContent).toContain('Network');
});

it('rejects an empty file before uploading', async () => {
  const upload = vi.spyOn(assetsModule, 'uploadAsset');
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File([''], 'empty.js', { type: 'application/javascript' }));
  await settle();
  expect(upload).not.toHaveBeenCalled();
  expect(target.textContent).toContain('empty');
});

it('shows a clear message on a duplicate-filename 409', async () => {
  vi.spyOn(assetsModule, 'uploadAsset').mockRejectedValue(new apiModule.ApiError(409, 'dupe'));
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: null }), versionId: 1, editable: true });
  await settle();
  chooseFile(target, new File(["getElementById('app-root')"], 'dupe.js', { type: 'application/javascript' }));
  await settle();
  expect(target.textContent).toContain('already exists');
});

it('Remove PATCHes script_url:null and refreshes', async () => {
  const patch = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
  const load = vi.spyOn(editorStore, 'loadAdminTree').mockResolvedValue('ok' as never);
  vi.spyOn(toasts, 'pushToast').mockImplementation(() => {});
  const target = mountEditor({ item: item({ script_url: 'app.js' }), versionId: 1, editable: true });
  await settle();
  const remove = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove') as HTMLButtonElement;
  remove.click();
  await settle();
  expect(patch).toHaveBeenCalledWith('/api/items/7', { script_url: null });
  expect(load).toHaveBeenCalledWith(1, { force: true });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm test -- src/tests/InteractiveAppEditor.svelte.test.ts`
Expected: FAIL — no file input / Remove button / upload logic.

- [ ] **Step 3: Add the upload widget to `InteractiveAppEditor.svelte`**

Extend the `<script>` (new imports + state + handlers) and the template (upload row, warnings, error, Remove — editable only).

Add imports:

```typescript
  import { uploadAsset } from '../../lib/assets';
  import { scanAppSource } from '../../lib/appSourceScan';
  import { api, ApiError } from '../../lib/api';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
```

Add state + handlers (after the preview `$effect`):

```typescript
  let uploadBusy = $state(false);
  let warnings = $state<string[]>([]);
  let uploadError = $state<string | null>(null);

  // Read the file as text for the heuristic scan + non-empty gate. Use FileReader,
  // NOT File.prototype.text(): the test env is jsdom, whose File does NOT implement
  // .text() (verified — File.text is undefined; FileReader.readAsText works). Both
  // exist in real browsers, so this is browser-correct too.
  function readText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function onFileChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-choosing the same filename
    if (!file) return;
    uploadError = null;
    warnings = [];
    const text = await readText(file);
    if (text.trim() === '') { uploadError = 'The file is empty — choose a non-empty .js file.'; return; }
    warnings = scanAppSource(text); // advisory, non-blocking
    uploadBusy = true;
    try {
      const asset = await uploadAsset(versionId, file);
      await api.patch(`/api/items/${item.id}`, { script_url: asset.filename });
      await loadAdminTree(versionId, { force: true });
      pushToast('App uploaded', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        uploadError = 'A file with that name already exists. Rename it or remove the old one first.';
      } else {
        uploadError = err instanceof ApiError ? err.displayMessage : 'Upload failed.';
      }
    } finally {
      uploadBusy = false;
    }
  }

  async function removeApp() {
    uploadBusy = true;
    uploadError = null;
    try {
      await api.patch(`/api/items/${item.id}`, { script_url: null });
      await loadAdminTree(versionId, { force: true });
      warnings = [];
      pushToast('App removed', 'success');
    } catch (err) {
      uploadError = err instanceof ApiError ? err.displayMessage : 'Remove failed.';
    } finally {
      uploadBusy = false;
    }
  }
```

Add the upload UI to the template, inside the `<section class="app-editor">`, after the preview `{#if …}` block, guarded by `editable`:

```svelte
  {#if editable}
    <div class="upload">
      <label class="file">
        {item.script_url ? 'Replace app' : 'Upload app'}
        <input type="file" accept=".js,application/javascript" onchange={onFileChosen} disabled={uploadBusy} />
      </label>
      {#if item.script_url}
        <Button variant="ghost" onclick={removeApp} disabled={uploadBusy}>Remove</Button>
      {/if}
    </div>
    {#if uploadError}<p class="form-err" role="alert">{uploadError}</p>{/if}
    {#if warnings.length}
      <ul class="warnings">
        {#each warnings as w}<li>{w}</li>{/each}
      </ul>
    {/if}
    {#if status === 'ready'}
      <!-- Spec §8/§10: we can't detect a blank preview from JS (opaque-origin
           iframe), so surface a static hint alongside a rendered preview. Gated
           on 'ready' so it does NOT show under the error/empty states (a 404 is
           not a blank render). `status` is in scope from the preview effect. -->
      <small class="hint">Blank preview? The most common cause is an ES-module build instead of a single classic/IIFE bundle — see the tutorial.</small>
    {/if}
  {/if}
```

Extend the `<style>`:

```svelte
  .upload { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
  .warnings { color: #8a6d00; background: #fff8e1; border-radius: var(--radius); padding: var(--space-2) var(--space-3); margin: var(--space-2) 0; }
  .form-err { color: #a33; }
  .hint { display: block; margin-top: var(--space-2); color: var(--muted, #666); font-size: 0.85rem; }
```

- [ ] **Step 4: Run the editor test to verify it passes**

Run: `cd frontend && npm test -- src/tests/InteractiveAppEditor.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check**

Run: `cd frontend && npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/items/InteractiveAppEditor.svelte frontend/src/tests/InteractiveAppEditor.svelte.test.ts
git commit -m "feat(interactive-app): upload / replace / remove in the editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend — SequenceAccordion create flow (remove App-URL field)

**Files:**
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte`
- Test: `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts` (rewrite)

**Interfaces:**
- Consumes: nothing new.
- Produces: creating an `interactive_app` sends only `{ title, type }` (no `script_url`, no URL field); the picker still offers the 4th type.

Implements spec §7 (create empty), §9 (remove the App-URL field + `safeAppUrl` gate from SequenceAccordion).

- [ ] **Step 1: Rewrite the create-flow test**

In `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`, **keep the entire scaffolding unchanged** (imports, `fetchSpy`/`jres`/`settle`, the `version`/`seq`/`block` fixtures, `beforeEach`/`afterEach`, and the helpers `mountAccordion()`, `openCreateAsApp()`, `createBtn()`). `openCreateAsApp` clicks "+ New item" then selects the `input[value="interactive_app"]` radio and does NOT touch any URL field, so it is reusable as-is. **Replace all four existing `it(...)` tests** (lines 70-134: the App-URL-field, empty/invalid-URL, POST-script_url, and 422-mapping tests) with these two:

```typescript
it('creates an interactive_app with only title + type — no script_url, no URL field', async () => {
  fetchSpy.mockImplementation(() => jres({ id: 99 }));
  const target = mountAccordion();
  openCreateAsApp(target);
  expect(target.querySelector('input[type="url"]')).toBeNull();   // App-URL field removed
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  createBtn(target).click();
  await settle();
  const post = fetchSpy.mock.calls.find(
    (c) => String(c[0]).includes('/api/sequences/2/items') && (c[1] as RequestInit)?.method === 'POST',
  )!;
  expect(post).toBeTruthy();
  const body = JSON.parse((post[1] as RequestInit).body as string);
  expect(body).toEqual({ title: 'My app', type: 'interactive_app' });   // no script_url key at all
});

it('the type picker still offers interactive_app', () => {
  const target = mountAccordion();
  const newBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('New item'))!;
  newBtn.click(); flushSync();
  expect(target.querySelector('input[value="interactive_app"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm test -- src/tests/SequenceAccordion.interactive.svelte.test.ts`
Expected: FAIL — the App-URL `<input>` still renders and the POST still includes `script_url`.

- [ ] **Step 3: Edit `SequenceAccordion.svelte`**

1. Remove `import { safeAppUrl } from '../../lib/safeAppUrl';` (:9).
2. Remove `let newScriptUrl = $state('');` (:195) and its reset in `resetCreateForm` (:251).
3. In `createTracker.isDirty` (:216), remove the `|| (newType === 'interactive_app' && newScriptUrl.trim() !== '')` clause.
4. Remove the `createScriptUrlInvalid` derivation (:225-227).
5. In `submitCreate`, remove the pre-POST bail (:269-272, the `if (newType === 'interactive_app' && safeAppUrl(newScriptUrl) === null) {...}` block) and the `if (newType === 'interactive_app') body.script_url = newScriptUrl;` line (:280).
6. In the `known` error-field list (:295-296), change the `interactive_app` arm from `['title', 'script_url', 'type']` to `['title', 'type']`.
7. In the template, remove the `{:else if newType === 'interactive_app'}` block with the App-URL `<input>` (:372-376).
8. On the Create `<Button>` (:379), remove `|| createScriptUrlInvalid` from `disabled` and simplify the `title` attribute to `''` (it was only set for the script-url-invalid case): `title=""`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- src/tests/SequenceAccordion.interactive.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check**

Run: `cd frontend && npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/SequenceAccordion.svelte frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
git commit -m "feat(editor): create interactive_app empty, no App-URL field

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Cleanup + full-suite verification

**Files:**
- Delete: `frontend/src/lib/safeAppUrl.ts`, `frontend/src/tests/safeAppUrl.test.ts`
- Verify: full frontend + backend suites, svelte-check.

**Interfaces:**
- Consumes: Tasks 5/6/7 removed every `safeAppUrl` importer.
- Produces: no `safeAppUrl` module; green full suites.

Implements spec §9 (remove `lib/safeAppUrl.ts` + test).

- [ ] **Step 1: Confirm no remaining importers**

Run: `cd frontend && grep -rn "safeAppUrl" src`
Expected: matches ONLY in `src/lib/safeAppUrl.ts` (its own `export function safeAppUrl` + doc-comment) and `src/tests/safeAppUrl.test.ts` (which imports it) — both deleted in Step 2. There must be NO match in any OTHER file (Task 5 removed it from `InteractiveAppItem` + `ItemEditPage`; Task 7 removed it from `SequenceAccordion`). If any other file matches, remove that usage before deleting the module.

- [ ] **Step 2: Delete the module + its test**

```bash
git rm frontend/src/lib/safeAppUrl.ts frontend/src/tests/safeAppUrl.test.ts
```

- [ ] **Step 3: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — all files, no `safeAppUrl` import errors.

- [ ] **Step 4: Type check the whole frontend**

Run: `cd frontend && npm run check`
Expected: 0 errors (no new warnings vs. baseline).

- [ ] **Step 5: Run the full backend suite**

Run: `backend/.venv/bin/pytest -q` (from `backend/`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -u frontend/src/lib/safeAppUrl.ts frontend/src/tests/safeAppUrl.test.ts
git commit -m "chore(interactive-app): remove obsolete safeAppUrl sanitizer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(`git rm` in Step 2 already staged the deletions; if you skipped it, `git add -u <paths>` stages the removals.)

- [ ] **Step 7: Manual smoke checklist (human, at branch finish)**

Deferred to branch completion (automated coverage stands in for CI):
1. Create an `interactive_app` item (title only) → editor shows "No app uploaded yet. Choose a `.js` file to upload."
2. Upload a valid single-file IIFE `.js` that mounts into `#app-root` → live preview renders it in the sandbox; student player renders it and auto-covers.
3. Upload an ES-module build → blank preview + the "Looks like an ES module" warning.
4. Replace under a new filename → preview updates; the superseded asset is removable via the asset manager. Re-upload under the same name → "already exists" message.
5. Remove → returns to the empty state; the app disappears for students.
6. Publish the version → the app still renders (reference survived publish).
7. Disabled version (with an app attached) → editor shows "This app couldn't be loaded." (the `serve_asset` gate 403s a disabled version's assets for everyone, admins included); never a link.
8. Archived version (not disabled) → readonly preview still renders (admins bypass the enrolment check and archived is not asset-gated), or "No app" when none attached; never a link.

---

## Self-Review (checklist run against the spec)

**Spec coverage:**
- §3 author contract → enforced by the sandbox/CSP (Task 5) + advisory scan (Task 4/6); the public tutorial is spec follow-up #5 (out of scope). ✔
- §4 security (fetch-and-inline, strict sandbox, CSP, escaping) → Tasks 4 (`interactiveHost`, `fetchAssetSource`) + 5 (`InteractiveFrame`). ✔
- §5 data model / endpoint / AssetReference / publish-skip → Tasks 1 (create-reject), 2 (endpoint + helper + null-guard removal), 3 (publish-skip). ✔
- §6 host page (srcdoc + CSP + escaping) → Task 4 `buildAppSrcdoc` + Task 5 `InteractiveFrame`. ✔
- §7 flow (create empty / upload / Replace / Remove / player / readonly / async-coverage / version_id / `fetchAssetSource`) → Tasks 5 (player, delegation, version_id from `currentCourse`), 6 (upload/Replace/Remove), 7 (create empty). ✔
- §8 validation (client non-empty gate + **server-side** non-empty guard + heuristic warnings; preview as authoritative check + blank-preview hint) → Tasks 2 (server empty guard), 4 (`scanAppSource`), 6 (client non-empty + warnings + preview + blank hint). ✔
- §9 removed/migrated (safeAppUrl delete, safeIframeUrl doc revert, types nullable, ItemRouter/ItemTypePicker unchanged) → Tasks 4 (types), 5 (doc revert), 8 (delete). ✔
- §10 edge cases (fetch failure copy, inactive-enrollment 403 → "couldn't be loaded", `</script>` escaping, empty state) → Tasks 4/5/6 render states + escape test. ✔
- §11 testing → each task's tests map to the spec's test list (escape helper direct + exactly-one-terminator, player branch-by-URL stub + not-covered + late-fetch, editor upload/Remove/readonly-never-link, create sends only title+type, backend attach/replace/clear/survives-publish/delete-409). ✔

**Placeholder scan:** every code/test step contains complete code or an exact edit list with line anchors; commands have expected outcomes. Task 7's test reuses the existing file's scaffolding (documented) rather than re-inventing selectors — the two changed assertions are given in full. No "TBD"/"add validation"/"similar to". ✔

**Type/name consistency:** `escapeScriptClose`, `buildAppSrcdoc`, `scanAppSource`, `fetchAssetSource(versionId, filename, signal?)`, `sync_script_reference(db, version_id, item_id, filename)`, `InteractiveFrame { scriptSource, title }`, `InteractiveAppEditor { item, versionId, editable }` — used identically across producing and consuming tasks. Player uses `currentCourse.value?.versionId`; editor uses the `versionId` prop. `InteractiveAppItem` type nullable (student); `AdminTreeItem` already nullable (editor). ✔

## Execution Handoff

Two execution options:

**1. Subagent-Driven (recommended)** — fresh implementer subagent per task, task review (spec + quality) between tasks, broad whole-branch review at the end. Fast iteration; preserves controller context.

**2. Inline Execution** — execute tasks in this session via executing-plans, with batch checkpoints for review.
