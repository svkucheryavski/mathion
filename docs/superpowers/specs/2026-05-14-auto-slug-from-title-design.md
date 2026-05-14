# Auto-Slug-From-Title Design

**Date:** 2026-05-14
**Scope:** Replace manual slug entry on Block / Sequence / Item with server-side derivation from the title. Slug becomes a server-controlled identifier; admins never see or set it directly.

---

## Goal

Every block, sequence, and item slug is auto-generated from its title by the backend. Admins type only a title; the backend derives `slug = slugify(title)` on create and on every update where the submitted title actually changes the stored title. The frontend stops sending or rendering slug input fields and surfaces server-side errors against the title field where the admin can act on them.

Three invariants the server enforces:

1. **Length ≥ 1** — `slugify(title)` returns `""` for titles with no Latin letters or digits (Cyrillic, emoji, punctuation only). Reject with 422 keyed to `body.title`.
2. **Length ≤ 80** — the `slug` column is `String(80)` in the DB. Reject with 422 keyed to `body.title` so admins fix the title rather than the server silently truncating into a colliding suffix.
3. **Uniqueness within parent** — the parent is the version for blocks, the block for sequences, the sequence for items. Enforced at the DB level by existing `uq_block_version_slug`, `uq_sequence_block_slug`, `uq_item_sequence_slug` constraints; `IntegrityError → 409`.

---

## Algorithm

Pure helper, added to the existing `backend/mathion/api/helpers.py` (the codebase's helper-collection module, alongside `get_or_404`, `bump_content_updated_at`, etc.):

```python
import re

_NON_SLUG = re.compile(r"[^a-z0-9]+")

def slugify(title: str) -> str:
    """Lowercase, collapse runs of non-[a-z0-9] into single dashes, strip
    leading/trailing dashes. Returns '' if the title has no Latin letters
    or digits — caller is responsible for rejecting empties."""
    return _NON_SLUG.sub("-", title.lower()).strip("-")
```

Example: `"Confidence intervals (part 1)"` → `"confidence-intervals-part-1"`. Cyrillic / emoji / whitespace-only titles → `""` → 422.

No frontend mirror. There's no live preview; the slug surfaces in the accordion header after save and that's enough.

---

## Data flow

**Create.** Client sends `{ title, ... }` (no `slug`). Endpoint computes `slug = slugify(data.title)`. If empty, 422 with `loc=["body","title"]`. Otherwise build the row with that slug and let SQLAlchemy enforce uniqueness; `IntegrityError` from the `uq_*_slug` constraint is mapped to a 409 with a title-focused message.

**Update.** Client sends `{ title?, ... }` (still no `slug`). The whitelist for published-state edits runs first on the client-provided keys (which never contain `slug`, so the whitelist is satisfied). When the whitelist permits a `title` edit — which it does in every state including published, because `title` is in `_BLOCK_EDITABLE_PUBLISHED`, `_SEQUENCE_EDITABLE_PUBLISHED`, and `_ITEM_EDITABLE_PUBLISHED` — the server then decides whether slug also needs to change. The rule is **"submitted title differs from stored title"**, not just "title key present":

- Load the current row's `title` before applying updates.
- If `"title"` is in the update payload AND `updates["title"] != row.title`: compute `new_slug = slugify(updates["title"])`. Enforce length ≥ 1 (else 422) and length ≤ 80 (else 422); assign `updates["slug"] = new_slug`.
- Otherwise (no title key OR title unchanged): the server doesn't touch the slug.

The comparison is **literal Python string equality** — no normalization. A title change that's whitespace-only or case-only ("Foo" → "FOO", "Foo" → "Foo ") *does* trigger the diff branch and writes a recomputed `slug`, but slugify normalizes the input so the new slug is identical to the old one. The DB write is a no-op for slug; the title field still records exactly what the admin typed. The diff rule is about avoiding *spurious* re-derivation when the title hasn't changed at all (the info-only-edit case); equivalent-after-slugify edits cost a redundant write but don't change observable state and don't trip the uniqueness constraint against the row's own existing slug.

**Explicit `{ "title": null }`** in the PATCH body is a client error. The update schemas declare `title: str | None = Field(default=None, min_length=1, ...)`; the `min_length=1` only fires on string values, so Pydantic v2 *accepts* an explicit null. After `model_dump(exclude_unset=True)`, `"title"` is present with value `None` (it was explicitly set). The endpoint's diff branch must therefore guard: `if "title" in updates and updates["title"] is not None and updates["title"] != row.title`. If the title is in updates and is `None`, raise 422 keyed to `body.title` ("Title must be a non-null string") rather than calling `slugify(None)`. A nicer fix is to tighten the schema later (`Field(default=None, json_schema_extra={"nullable": False})` or a model-level validator), but that's out of scope for this spec — the endpoint guard is sufficient.

This matters because the current frontend edit flows always include `title` in their PATCH body even when only `info` or `content_md` changed (see `BlockAccordion.save()` sending `{ title, info }` and `ItemEditPage.save()` building from `{ title }`). A naïve "title-in-payload → re-derive" rule would silently snap historical custom slugs on info-only edits; the diff check prevents that.

The `_*_EDITABLE_PUBLISHED` whitelists themselves are unchanged — they inspect client-provided keys, never see the server-added slug.

**Response.** The endpoint returns the entity in the existing `BlockResponse` / `SequenceResponse` / `ItemResponse` shape, which already includes `slug`. The frontend's existing tree refetch picks up the new value and re-renders the accordion header.

---

## Frontend changes

Three create forms shed their slug `<input>`, their `newSlug` state, their slug field-error rendering, and their slug value from the createTracker's "dirty?" check. The forms are nested one level deeper than the entity they create — read each line as "this component contains the create form for its *child* entity":

- `pages/editor/VersionEditPage.svelte` — **block** create (a version contains blocks). Submit body becomes `{ title, info: '' }`.
- `components/editor/BlockAccordion.svelte` — **sequence** create (a block contains sequences). Submit body becomes `{ title }`.
- `components/editor/SequenceAccordion.svelte` — **item** create (a sequence contains items). Submit body becomes `{ title, type, content_md?, video_url?, script_url? }` depending on type.

`lib/formErrors.ts` — the 409 detect regex relaxes from `/slug/i` to `/slug|title/i`, and the resulting error keys on `fieldErrors.title`. Each of the three create-form callers drops `'slug'` from its `knownFields` array.

Edit panels (block-meta, sequence-meta, item edit) — no UI change. Their save bodies never included slug; they continue not to. The server's title-diff rule (above, in **Data flow**) handles the "title resent but unchanged" case that these forms naturally produce when only `info` / `content_md` / `video_url` changed.

Slug rendering surfaces — `AccordionHeader`'s `/{slug}` and `ItemRow`'s `/{slug}` — are unchanged. After a save, the refetched admin tree carries the updated slug; the existing display renders it.

---

## Backend changes

**Schemas** (`backend/mathion/schemas.py`):

- `BlockCreate` — remove the `slug: str = Field(...)` line.
- `SequenceCreate` — same.
- `ItemCreate` — same.
- All three get `model_config = ConfigDict(extra="forbid")` so a client that still sends `slug` gets a clean 422 rather than a silent ignore.
- `BlockUpdate` / `SequenceUpdate` / `ItemUpdate` already lack `slug`. Also add `model_config = ConfigDict(extra="forbid")` to each — consistency with the create schemas, and a defense-in-depth signal that slug is server-controlled. Without this, a PATCH containing a rogue `slug` field is silently ignored, which weakens the "server-controlled" contract even though no privilege is leaked.

**Endpoints.**

- `create_block` (`api/blocks.py:41`) — compute `slug = slugify(data.title)`; if `slug == ""`, raise 422 with `[{"loc":["body","title"],"msg":"Title must contain at least one Latin letter or digit","type":"value_error"}]`; if `len(slug) > 80`, raise 422 with `[{"loc":["body","title"],"msg":"Title is too long — the auto-generated slug exceeds the 80-character limit. Please shorten the title.","type":"value_error"}]`; otherwise build the row with that slug. The existing `IntegrityError → 409` wrapper around `db.commit()` is kept; the human-readable detail becomes **"A block with the same auto-generated slug already exists in this version — choose a different title."**
- `create_sequence` (`api/blocks.py:156`) — same pattern with the empty-slug AND >80-char checks; collision message: **"A sequence with the same auto-generated slug already exists in this block — choose a different title."**
- `create_item` (`api/items.py:39`) — same pattern; collision message: **"An item with the same auto-generated slug already exists in this sequence — choose a different title."** `ItemCreate`'s existing `@model_validator(mode="after")` that requires `content_md` for `static_page`, `video_url` for `video`, and `script_url` for `interactive_app` is **unchanged** — slug derivation runs in the endpoint *after* Pydantic validation, so type-specific requirements still gate before slug.
- `update_block`, `update_sequence`, `update_item` — after `updates = data.model_dump(exclude_unset=True)` and after the published-state whitelist check, **read the entity's current `title` before mutating**; then if `"title" in updates` AND `updates["title"] != row.title`: compute `new_slug = slugify(updates["title"])`; apply the same empty (422) and >80-char (422) checks as on create; assign `updates["slug"] = new_slug`. If the title is unchanged (same string, or not in payload), the slug is left alone. Wrap the final `db.commit()` in `try/except IntegrityError → 409` with the same title-focused message — this wrapper is new on the update endpoints since slug-on-update used to be impossible, and it handles the concurrent-edit race (two admins simultaneously renaming siblings to titles that slugify to the same string).

Whitelists (`_BLOCK_EDITABLE_PUBLISHED = {"title", "info"}` etc.) stay as-is.

---

## Error UX

**Create form, empty slug.** Server returns 422 with the detail keyed to `loc=["body","title"]`. `mapCreateError` (per spec) writes it into `fieldErrors.title`; the inline `<small class="field-err">` under the title input shows "Title must contain at least one Latin letter or digit". User edits the title and resubmits.

**Create form, collision.** Server returns 409 with the title-focused detail string. `mapCreateError`'s relaxed regex matches and writes the detail into `fieldErrors.title`. Same rendering location.

**Edit panel, empty slug or collision.** Existing edit flows already use `pushToast(e.displayMessage)` for all errors; no inline field errors on the edit side. The friendlier title-focused server message becomes the toast text. Consistent with the slice-2 pattern.

**Anything else.** Falls through to the existing `globalMessage` path (toast or banner depending on the form).

---

## Testing

**Backend.** Add `backend/tests/test_slugify.py` — one parametrized test covering: pure-Latin alphanumeric, mixed punctuation runs, the user's example, leading/trailing punctuation, all-uppercase, all-Cyrillic (→ `""`), empty input, single dash, whitespace-only, **punctuation-only (e.g., `"!!!"` → `""`)**, and a **>80-char-slug case** (a 200-char Latin title) to confirm slugify itself doesn't truncate (the endpoint does the rejection). Update existing endpoint tests:

- `test_blocks.py` / `test_sequences.py` / `test_items.py` — create-body payloads drop `slug`; add assertions that the response's `slug` equals `slugify(title)`. New cases for:
  - `extra="forbid"` rejection when client sends `slug` (both on create AND update).
  - Empty-title-slug 422 (Cyrillic, emoji, punctuation-only).
  - >80-char-slug 422.
  - Collision 409 on create.
  - Collision 409 on update.
  - Title-edit-on-published also re-derives slug.
  - **Info-only PATCH** (title resent but unchanged) does NOT re-derive slug.
  - **Equivalent-after-slugify update** (e.g., title `"Foo Bar!"` → `"Foo Bar"` — both slugify to `"foo-bar"`) — diff fires, slug written, value identical to existing, no IntegrityError.
  - **Explicit `{ "title": null }` on PATCH** → 422 keyed to `body.title` (not a 500 from `slugify(None)`).

**Frontend.** Update `frontend/src/tests/formErrors.test.ts` — the collision case now asserts `fieldErrors.title` (not `.slug`); add a case for a 422 with `loc=["body","title"]`. Component-level smoke (the three create forms still submit successfully without a slug input) is covered by the manual smoke pass.

---

## Migration concerns

No DB migration. Existing rows keep their existing slugs. If an admin re-opens an old entity and saves without changing the title (even though the current frontend includes the title in every save body), the server's "submitted-title vs stored-title" diff check leaves the slug alone. The slug only changes when the admin actually edits the title to a new value. This is deliberate — no surprise mass-rename on the first PATCH after this feature lands.

**Deploy ordering matters for create flows.** Given the schema changes above:

- Backend-only deploy: new backend's `extra="forbid"` rejects the old frontend's `slug`-bearing create payloads with 422.
- Frontend-only deploy: old backend's required `slug` field rejects the new frontend's slug-less payloads with 422.

Both single-side-deployed states break create (update is unaffected — the existing frontend update bodies never sent `slug`). Deploy frontend and backend together — one PR / one release — which Mathion's monorepo deploy story already does.

---

## Out of scope

- Live slug preview under the title input in create forms.
- Slug back-fill / re-derivation for existing rows.
- Migrating any pre-existing custom slugs that don't match `slugify(title)`.
- Algorithm extensions (Unicode transliteration, etc.) — Cyrillic / non-Latin titles are rejected at create with a clear message; the admin can either add a Latin word to the title or pick a different title. If transliteration becomes a real need, it's a separate spec.
