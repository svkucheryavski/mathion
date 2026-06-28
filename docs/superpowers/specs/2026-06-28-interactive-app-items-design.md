# Interactive-App Items — Design (Phase 8)

**Status:** approved 2026-06-28 (brainstorming).

**Goal:** Let course admins author `interactive_app` items (an external app embedded by URL) and let students view them, completing the last unimplemented content type. The backend already models this; this slice is **frontend-only**.

## Context

`interactive_app` is one of the four `Item` types (`static_page`, `video`, `quiz`, `interactive_app`). The backend is already complete:

- `Item.script_url` (`String(500)`, nullable) — the app URL (`models.py:114`).
- `ItemCreate`/`ItemUpdate`/`ItemResponse` carry `script_url`; create **requires** it for interactive_app and validates `http(s)://` (`schemas.py:99–119`). `_ITEM_EDITABLE_PUBLISHED` includes `script_url`, so it is editable on **published** versions too (`items.py:16`), exactly like `video_url`.
- The student content endpoint serves `script_url` (`content.py:205–206`).
- `frontend/src/lib/types.ts` already declares `InteractiveAppItem = ItemBase & { type: 'interactive_app'; script_url: string }` (lines 93–95) and includes it in the `Item` union — **no types change needed**.

The frontend is the gap:
- **Student render:** `ItemRouter.svelte` maps `interactive_app` → `<UnsupportedItem>` (a placeholder).
- **Authoring create:** `ItemTypePicker`'s union is `'static_page' | 'video' | 'quiz'` — interactive_app is not offerable.
- **Authoring edit:** `ItemEditPage` excludes interactive_app from `editable` and shows a read-only *"Interactive-app editing lands in slice 2"* branch (`ItemEditPage.svelte:127, 344`).

The closest existing analog is the **`video`** item type: a URL → iframe on the student side, a required-URL create field, and a URL edit form with live preview. This slice mirrors `video` throughout, with four deliberate differences (sandbox, no URL normalization, auto-coverage, fixed sizing).

## Decisions (from brainstorming)

1. **App source:** external URL only. Admin hosts the app elsewhere and pastes a URL. Asset-hosted bundles are out of scope.
2. **Coverage:** auto-covered **on mount** (no "mark as done" button). Opening the item marks it covered.
3. **Sizing:** full width × a fixed height (`600px` as a sensible default; exact value is a later styling pass); content scrolls within the frame. No per-item height field (no backend change).
4. **Sandbox:** `sandbox="allow-scripts"` **without** `allow-same-origin`, per the platform spec's trust model (`docs/superpowers/specs/2026-04-19-mathion-platform-design.md` §interactive). `allow-scripts` + `allow-same-origin` together would void the sandbox, so same-origin is deliberately excluded. Apps are admin-trusted; the sandbox blocks parent-DOM/cookie/storage access (not network).
5. **Approach:** dedicated components that mirror `video`; **do not** refactor `video`/`VideoFrame` into a shared abstraction (the four differences would make it leaky and would risk the working video path).

## Architecture & components

### Student player
- **`components/items/InteractiveFrame.svelte`** (new, parallels `VideoFrame`): a fixed-height (`600px` default), full-width iframe wrapper. Renders `<iframe {src} {title} sandbox="allow-scripts">`. Shared by the student player and the editor's live preview (as `VideoFrame` is). Caller passes a sanitized `src`.
- **`components/items/InteractiveAppItem.svelte`** (new, parallels `VideoItem`): receives `{ item: InteractiveAppItem; isCovered: boolean }`. Renders the title + `<InteractiveFrame src={safeIframeUrl(item.script_url)} title={item.title} />`. **On mount**, if `!isCovered`, marks coverage via `createCoverageTracker(item.id)` → `markCovered()` then `markItemCovered(item.id)` (the store write that flips the sidebar/progress). If `safeIframeUrl` returns `null` (unsafe/blank URL), render a small "This interactive app can't be displayed" notice instead of an iframe and do **not** auto-cover.
- **`components/items/ItemRouter.svelte`**: replace `<UnsupportedItem type="interactive_app"/>` with `<InteractiveAppItem {item} {isCovered} />`.

### Authoring — create
- **`components/editor/ItemTypePicker.svelte`**: widen `ItemType` to include `'interactive_app'` and add a fourth radio (glyph 🧩, label "Interactive app"). (The component comment already invites this.)
- **`components/editor/SequenceAccordion.svelte`**: when `newType === 'interactive_app'`, show a **required** "App URL" `<input type="url" placeholder="https://…">` (mirrors the existing video_url input), send `body.script_url = newScriptUrl`, and add `script_url` to that branch's validated-field list. Reuse the existing per-field error pattern (`createErrors.script_url`).

### Authoring — edit
- **`pages/editor/ItemEditPage.svelte`**:
  - Add `interactive_app` to the `editable` derived.
  - Add an `InteractiveAppForm = { title: string; script_url: string }` tracker (parallels `VideoForm`), seeded/reset on load, save, and discard (mirror every `video` branch in `ensureLoaded`/`save`/reset).
  - Add an edit branch: title input + App URL `<input type="url" required>` + a **debounced live preview** (`scriptPreviewUrl = safeIframeUrl(current.script_url)` → `<InteractiveFrame>`), mirroring the video preview debounce.
  - Save gated on non-empty `script_url` (a `scriptUrlEmpty` derived, parallel to `videoUrlEmpty`) with the same disabled-button + title-tooltip treatment.
  - Send `script_url` **as-is** in the PATCH body (no normalization — `safeIframeUrl` is preview-only; the backend enforces `http(s)://`).
  - Remove the read-only *"lands in slice 2"* branch.
  - Published behavior: interactive_app edits are allowed on published versions (backend `_ITEM_EDITABLE_PUBLISHED`), same as video.

## Data flow

Create (`POST /items`, `type=interactive_app` + `script_url`) → edit (`PATCH /items/{id}` `script_url`; allowed on created **and** published) → student `GET` content serves `script_url` → `InteractiveAppItem` sanitizes via `safeIframeUrl` and embeds in the sandboxed `InteractiveFrame` → auto-marks coverage on mount.

## Error handling & edge cases

- **Unsafe/blank `script_url` at render:** `safeIframeUrl` returns `null` → show a "can't be displayed" notice, skip the iframe, and skip auto-coverage (don't credit coverage for an app the student can't see).
- **Create/edit validation:** client requires a non-empty URL and blocks Save when empty; the backend is the source of truth for `http(s)://` (surface its 422 inline, as the video branch does).
- **Already-covered:** auto-coverage is guarded by `isCovered` so re-opening a covered item issues no redundant write.
- **Disabled version:** the whole editor is already read-only on disabled versions (existing gating); interactive_app inherits it.

## Testing

Frontend component tests in the established `mount`/`unmount`/`flushSync` style (no `@testing-library`), mirroring the video/quiz tests. No backend changes → no new pytest.

- **`InteractiveAppItem`**: renders an iframe whose `src` is the sanitized URL and whose `sandbox` is exactly `allow-scripts`; auto-calls `markItemCovered(item.id)` on mount when `!isCovered`; does **not** call it when `isCovered`; on an unsafe URL renders the notice and does not auto-cover.
- **`ItemRouter`**: `interactive_app` dispatches to `InteractiveAppItem` (not `UnsupportedItem`).
- **`ItemTypePicker`**: exposes the interactive_app option and binds it.
- **`SequenceAccordion`**: selecting interactive_app shows the required App URL field and includes `script_url` in the create body; empty URL blocks create.
- **`ItemEditPage`**: interactive_app is editable; Save sends `script_url`; Save is disabled when the URL is empty; the live preview reflects the typed URL; published version still allows the edit.

## Out of scope (future slices)

- Asset-hosted app bundles (upload HTML/JS to course assets) — external URL only here.
- A `postMessage` completion/scoring protocol — apps are exploratory, not graded.
- Per-item configurable height (would require a new backend column).
- Relaxing the sandbox (`allow-same-origin`, or adding `allow-forms`/`allow-popups`) — revisit only if a real, trusted app needs it; `allow-forms`/`allow-popups` can be added without breaching parent isolation, `allow-same-origin` cannot.
- Fullscreen control for the embed.
