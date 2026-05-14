# Auto-Slug-From-Title Design

**Date:** 2026-05-14
**Scope:** Replace manual slug entry on Block / Sequence / Item with server-side derivation from the title. Slug becomes a server-controlled identifier; admins never see or set it directly.

---

## Goal

Every block, sequence, and item slug is auto-generated from its title by the backend. Admins type only a title; the backend derives `slug = slugify(title)` on create and on every update that includes a new title. Database-level uniqueness within the parent (existing `uq_*_slug` constraints) and a length ≥ 1 check enforce the two correctness invariants the admin needs to know about. The frontend stops sending or rendering slug input fields and surfaces server-side errors against the title field where the admin can act on them.

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

**Update.** Client sends `{ title?, ... }` (still no `slug`). The whitelist for published-state edits runs first on the client-provided keys (which never contain `slug`, so the whitelist is satisfied). After the whitelist passes, if `"title"` is in the updates, the server adds `slug = slugify(updates["title"])` to its own copy of the update payload, with the same empty-check → 422 and collision → 409 mapping. The pre-existing `_BLOCK_EDITABLE_PUBLISHED` / `_SEQUENCE_EDITABLE_PUBLISHED` / `_ITEM_EDITABLE_PUBLISHED` sets do not need slug added — the whitelist never sees the server-derived field.

If the title is not in the update payload, the server doesn't touch the slug. An admin who saves a block without editing the title preserves the existing slug, even if the existing slug differs from what `slugify(title)` would produce today. (Opt-in re-derivation by editing the title.)

---

## Frontend changes

Three create forms shed their slug `<input>`, their `newSlug` state, their slug field-error rendering, and their slug value from the createTracker's "dirty?" check:

- `pages/editor/VersionEditPage.svelte` — block create. Submit body becomes `{ title, info: '' }`.
- `components/editor/BlockAccordion.svelte` — sequence create. Submit body becomes `{ title }`.
- `components/editor/SequenceAccordion.svelte` — item create. Submit body becomes `{ title, type, content_md?, video_url?, script_url? }` depending on type.

`lib/formErrors.ts` — the 409 detect regex relaxes from `/slug/i` to `/slug|title/i`, and the resulting error keys on `fieldErrors.title`. Each of the three create-form callers drops `'slug'` from its `knownFields` array.

Edit panels (block-meta, sequence-meta, item edit) — no UI change. Their save bodies never included slug; they continue not to. Server re-derives slug on update when the payload includes a title; otherwise leaves it alone.

Slug rendering surfaces — `AccordionHeader`'s `/{slug}` and `ItemRow`'s `/{slug}` — are unchanged. After a save, the refetched admin tree carries the updated slug; the existing display renders it.

---

## Backend changes

**Schemas** (`backend/mathion/schemas.py`):

- `BlockCreate` — remove the `slug: str = Field(...)` line.
- `SequenceCreate` — same.
- `ItemCreate` — same.
- All three get `model_config = ConfigDict(extra="forbid")` so a client that still sends `slug` gets a clean 422 rather than a silent ignore.
- `BlockUpdate` / `SequenceUpdate` / `ItemUpdate` already lack `slug`; no change.

**Endpoints.**

- `create_block` (`api/blocks.py:41`) — compute `slug = slugify(data.title)`; on `""`, raise 422 with `[{"loc":["body","title"],"msg":"Title must contain at least one Latin letter or digit","type":"value_error"}]`; build the row with that slug. The existing `IntegrityError → 409` wrapper around `db.commit()` is kept; the human-readable detail becomes **"A block with the same auto-generated slug already exists in this version — choose a different title."**
- `create_sequence` (`api/blocks.py:156`) — same pattern; message: **"A sequence with the same auto-generated slug already exists in this block — choose a different title."**
- `create_item` (`api/items.py:39`) — same pattern; message: **"An item with the same auto-generated slug already exists in this sequence — choose a different title."** `ItemCreate`'s existing `@model_validator(mode="after")` that requires `content_md` for `static_page`, `video_url` for `video`, and `script_url` for `interactive_app` is **unchanged** — slug derivation runs in the endpoint *after* Pydantic validation, so type-specific requirements still gate before slug.
- `update_block`, `update_sequence`, `update_item` — after `updates = data.model_dump(exclude_unset=True)` and after the published-state whitelist check, if `"title" in updates`: compute `new_slug = slugify(updates["title"])`; on `""`, raise the same 422; otherwise assign `updates["slug"] = new_slug`. Wrap the final `db.commit()` in `try/except IntegrityError → 409` with the same title-focused message (this wrapper is new on the update endpoints since slug-on-update used to be impossible).

Whitelists (`_BLOCK_EDITABLE_PUBLISHED = {"title", "info"}` etc.) stay as-is.

---

## Error UX

**Create form, empty slug.** Server returns 422 with the detail keyed to `loc=["body","title"]`. `mapCreateError` (per spec) writes it into `fieldErrors.title`; the inline `<small class="field-err">` under the title input shows "Title must contain at least one Latin letter or digit". User edits the title and resubmits.

**Create form, collision.** Server returns 409 with the title-focused detail string. `mapCreateError`'s relaxed regex matches and writes the detail into `fieldErrors.title`. Same rendering location.

**Edit panel, empty slug or collision.** Existing edit flows already use `pushToast(e.displayMessage)` for all errors; no inline field errors on the edit side. The friendlier title-focused server message becomes the toast text. Consistent with the slice-2 pattern.

**Anything else.** Falls through to the existing `globalMessage` path (toast or banner depending on the form).

---

## Testing

**Backend.** Add `backend/tests/test_slugify.py` — one parametrized test covering: pure-Latin alphanumeric, mixed punctuation runs, the user's example, leading/trailing punctuation, all-uppercase, all-Cyrillic (→ `""`), empty input, single dash, whitespace-only. Update existing endpoint tests:

- `test_blocks.py` / `test_sequences.py` / `test_items.py` — create-body payloads drop `slug`; add assertions that the response's `slug` equals `slugify(title)`. New cases for: extra-forbid rejection when client sends `slug`, empty-title-slug 422, collision 409 on create, collision 409 on update, title-edit-on-published also re-derives slug.

**Frontend.** Update `frontend/src/tests/formErrors.test.ts` — the collision case now asserts `fieldErrors.title` (not `.slug`); add a case for a 422 with `loc=["body","title"]`. Component-level smoke (the three create forms still submit successfully without a slug input) is covered by the manual smoke pass.

---

## Migration concerns

No DB migration. Existing rows keep their existing slugs. If an admin re-opens an old entity and saves without touching the title, the slug stays at its historical value. If they edit the title, the slug snaps to the auto-derived form for the new title. This is deliberate — opt-in re-derivation, no surprise mass-rename.

**Deploy ordering matters.** With `extra="forbid"` on the new create schemas, the new backend rejects the old frontend's `slug`-bearing payloads with 422; with `slug` removed from the schemas, the old backend (which still has `slug: str = Field(min_length=1, ...)`) rejects the new frontend's slug-less payloads with 422. Both single-side-deployed states break the create flow. Deploy frontend and backend together (e.g., one PR / one release) — Mathion's deploy story already does this since the two live in one repo.

---

## Out of scope

- Live slug preview under the title input in create forms.
- Slug back-fill / re-derivation for existing rows.
- Migrating any pre-existing custom slugs that don't match `slugify(title)`.
- Algorithm extensions (Unicode transliteration, etc.) — Cyrillic / non-Latin titles are rejected at create with a clear message; the admin can either add a Latin word to the title or pick a different title. If transliteration becomes a real need, it's a separate spec.
