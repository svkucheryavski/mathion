# Interactive App — Upload Model (redesign) Design

**Date:** 2026-07-01
**Status:** Approved (design) — pending implementation plan
**Supersedes:** the URL-embed model shipped in `docs/superpowers/specs/2026-06-28-interactive-app-items-design.md` (merged, commits `92f5126..1671cba`). This branch **rewrites** that feature.

## 1. Motivation

The merged `interactive_app` type embedded an admin-supplied **external URL** in a sandboxed iframe. Real-world testing (graasta.com statistics apps) exposed two problems:

1. **Functional:** a compiled Svelte/Vite app loads its entry as an **ES module** (`<script type="module">`). ES modules are always CORS-fetched; under the strict sandbox the iframe has an **opaque origin**, so the request carries `Origin: null` and the app's own host rejects it (`Access-Control-Allow-Origin` failure) — the app never loads. This is the exact `Origin null is not allowed` error observed in the browser console.
2. **Security:** allowing arbitrary external URLs, combined with `script_url` accepting any `http(s)://` value and Mathion serving uploaded assets from its **own origin** (`/assets/{version_id}/{filename}`), meant an app could be pointed at a same-origin URL. Loosening the sandbox with `allow-same-origin` to fix (1) would then let a same-origin app read the viewing student's session — the precise escape the sandbox exists to prevent.

**Resolution:** stop embedding external URLs. Instead, the admin **uploads a single self-contained JavaScript file**; Mathion serves it and renders it inside a Mathion-controlled host page in the **original strict sandbox**. Because Mathion controls the host page and runs the JS as a **classic (inlined) script** — not an ES module — the opaque-origin sandbox works with **zero CORS relaxation** — more secure *and* functional. The `allow-same-origin` change is abandoned. (See §4 for why the source is *inlined* rather than `<script src>`'d: the `SameSite=Lax` session cookie would not attach to a subresource load from the opaque-origin sandbox.)

## 2. Goals / Non-goals

**Goals**
- Admin uploads one JS file per `interactive_app` item; Mathion stores, serves, and renders it sandboxed.
- Keep the **strict sandbox** (`sandbox="allow-scripts"`, no `allow-same-origin`): no student session / cookie / storage / parent-DOM access.
- Enforce "self-contained, no network" via a Content-Security-Policy on the host page.
- Best-effort **upload-time validation** to catch honest packaging mistakes (not a security control).
- Reuse the existing **version-asset** upload/serve/versioning infrastructure.
- Establish a clear **author contract** suitable for a future public tutorial: any framework that compiles to a single classic JS file (vanilla JS, Svelte, etc.).

**Non-goals (follow-ups)**
- App → Mathion `postMessage` signalling (e.g. explicit "mounted" / "completed") — deferred.
- Multi-file app bundles, ES-module entries, web workers, external CDN dependencies, network access.
- Server-side JavaScript parsing / AST validation (dependency + modern-syntax false-reject risk).
- A separate apps origin / subdomain (documented as a future scale-out if isolation-between-apps or heavier apps are ever needed).

## 3. Author contract (the tutorial contract)

An interactive app is **one JavaScript file** that:
1. Is a **self-executing classic bundle (IIFE/UMD)** — it runs on load, with **no top-level `import`/`export`** (not an ES module). Vanilla JS satisfies this automatically; Svelte/React/Vue/etc. must build with a single-file classic/IIFE target (`format: 'iife'`, everything inlined).
2. **Mounts into `#app-root`** — Mathion provides `<div id="app-root"></div>` in the host page; the app finds it (e.g. `document.getElementById('app-root')`) and does everything inside it.
3. Is **fully self-contained**: no network calls, no external resources, no reliance on cookies/storage. It may compute, draw (canvas/SVG/DOM), and handle interaction; it may inline images as `data:`/`blob:` URIs.
4. Does **not use `eval` / `new Function`** (blocked by CSP `script-src` without `'unsafe-eval'`). Note for authors of statistics/plotting apps: some expression-evaluation libraries (e.g. `mathjs` `evaluate`/`compile`) compile via `Function` and will silently fail — bundle a non-`eval` alternative, or request the `'unsafe-eval'` CSP knob (§12 #2).

Rationale surfaced to authors: Mathion inlines the file as a **classic inline script** inside the opaque-origin sandbox, so it runs with no network fetch and no CORS; the file itself stays behind normal enrollment auth (fetched by the authenticated page, never exposed publicly). An ES-module entry can't run as an inline classic script and would need the network/CORS the sandbox denies.

## 4. Security & trust model

- **Sandbox (unchanged from the hardened original):** the app renders inside `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">`. No `allow-same-origin` → the document is an **opaque origin**: it cannot read `document.cookie`, `localStorage`, the parent DOM, or the Mathion session, and cannot remove its own sandbox. Each iframe instance is its own opaque origin, so apps (and instances) are mutually isolated for free.
- **Authenticated fetch + inline (not `<script src>`):** the session cookie is `SameSite=Lax` (`backend/mathion/api/auth.py`), and a subresource request from a **sandboxed opaque-origin iframe is treated as cross-site**, so a Lax cookie is *not* attached — a `<script src="/assets/…">` from inside the sandbox would 401. Therefore the **authenticated Mathion page** (main document, mathion origin) fetches the JS itself via a credentialed same-origin `fetch` of the existing auth-gated `/assets/{version_id}/{filename}` endpoint (cookie attaches normally; GET needs no CSRF header), and **inlines the returned source** into the sandboxed iframe's `srcdoc` as an inline `<script>`. Consequences: the enrollment auth gate is **preserved** (only an authorized viewer can fetch the source), the app JS is **never made public** and needs no new endpoint, and the sandbox performs **no subresource loads at all**. The running app, being opaque-origin, still cannot read the session cookie or reach the parent.
- **CSP (defense-in-depth + no subresource/connection egress):** the host page carries a `<meta http-equiv="Content-Security-Policy">` (see §6). `connect-src 'none'` blocks fetch/XHR/WebSocket/EventSource/beacon; `script-src 'unsafe-inline'` permits *only* the inlined app script and, by omitting any host source, blocks external `<script src>`; `img-src`/`media-src` are `data:`/`blob:` and `font-src` is `data:` only; `default-src 'none'` denies every other source type. `'unsafe-eval'` is **not** granted (Svelte/React runtimes don't need it — see the §3 author caveat). **Residual:** a same-frame self-navigation (`window.location = 'https://…?d=…'`) is not a CSP-covered "connection" and remains possible — but the frame is opaque-origin with no session/cookie/parent access, so it holds no privileged data to leak; acceptable under the admin-trusted model, revisit only if apps ever become untrusted.
- **Markdown cannot execute an uploaded `.js`:** `render_markdown` uses `MarkdownIt(..., {html: False})` (raw HTML disabled) and `nh3.clean` with a tag allowlist that excludes `<script>`/`<iframe>`; asset references only rewrite `src`/`href` on `img`/`a`. A `.js` asset is therefore reachable only through the sandboxed host iframe — never as a same-origin `<script>` in a student page. (Confirmed against `backend/mathion/markdown.py`.)
- **Trust framing:** apps remain admin-authored, admin-trusted content ("comparable to installing a plugin"). Upload validation catches honest mistakes; the sandbox + CSP are the actual boundary and assume the file may be arbitrary.

## 5. Data model, storage & serving

- **Storage:** the uploaded JS is a normal version **`Asset`** — stored at `{asset_path}/courses/{version_id}/{filename}`, MIME `application/javascript`. `.js` is already in `ALLOWED_EXTENSIONS`. No new table or disk layout.
- **Item reference:** `Item.script_url` (`String(500)`, existing column) is **repurposed** from "external URL" to "the **filename** of the app's JS asset in *this* version." The asset fetch URL is built as `/assets/{version_id}/{filename}`.
- **Versioning (corrected):** `create version` with `copy_assets_from` copies only `Asset` rows + files (+ `info_md`) — **not** the content tree (`Item`/`Sequence`/`Block`) and **not** `AssetReference` rows (`versions.py:49-83`; no item-tree copy exists). So the JS *file* travels, but the `interactive_app` item, its `script_url`, and its reference are authored **per version**. The reference (below) is therefore created when the script is set *within a version*; there is no cross-version reference-copy to implement or test.
- **Delete-protection (dedicated mechanism — do NOT reuse the markdown sync):** `is_referenced` / the 409-unless-`force` delete guard key off `AssetReference` count (`assets.py:121-125, 202-210`), and the model supports `item_id` (`models.py:186`). A **dedicated helper** maintains one `AssetReference(item_id → the script asset)`: created on attach, **re-pointed on replace** (old asset row's ref removed, new one added — so the superseded `.js` becomes unreferenced/deletable), and removed on clear. **Item-delete needs no hook** — `AssetReference.item_id` is `ondelete="CASCADE"` (`models.py:186`) with FK enforcement on. **Critical constraint:** the generic `sync_asset_references` (`helpers.py:318`) is markdown-driven — it **deletes all rows for an `item_id`** then rebuilds only from `content_md`. The **load-bearing wipe site is the publish loop** (`versions.py:271-273`), which syncs **every** item unconditionally; an `interactive_app` item has no `content_md`, so it deletes-then-rebuilds-nothing → **wipes** the script reference. (The content-PATCH site runs sync only when `content_md` is in the update, which never happens for `interactive_app`, so it is not a live vector — but guarding both is harmless.) The plan must make the markdown sync **skip `interactive_app` items**, and a regression test asserts the reference **survives `publish_version`**.
- **Serving:** unchanged `GET /assets/{version_id}/{filename}` — auth-gated (superuser / course admin / active enrollment / run-teacher pinned to the version), blocks disabled versions, path-traversal-defended. Fetched by the **authenticated Mathion page** as text (§4), not `<script src>`'d from the sandbox, so the auth gate holds and no `Access-Control-Allow-Origin`/`nosniff` changes are needed.

### Backend changes — where each check lives
`ItemUpdate` has **no `type` field** and field-validators have no DB session (`schemas.py:133-146`), so type-branching and asset-existence cannot live in the schema. Split accordingly:
- **Schema (`schemas.py`):** drop `script_url` from the `validate_url` field-validator in **both** copies (`ItemCreate` schemas.py:104-109 **and** `ItemUpdate` schemas.py:140-145) — the `http(s)://` rule stays only for `video_url`; `script_url` becomes a plain optional string. In the `ItemCreate` `check_type_fields` model_validator, **invert the `interactive_app` branch** (`schemas.py:117-118`): instead of *requiring* `script_url`, **reject a non-null `script_url` at create** (422, "attach the app via upload after creation") — **keep** the `static_page`→`content_md` and `video`→`video_url` branches. This closes the create-time bypass: `create_item` stores `data.script_url` directly (`items.py:70`), so a create body with a valid existing filename would otherwise make a rendering item with **no `AssetReference`** (delete-protection bypass).
- **Endpoint (`items.py` `update_item`):** for an `interactive_app` item, when `script_url` is set it must (a) match an **anchored** allowed-filename pattern — `re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.js', name)` **and** `'..' not in name` (traversal/URL-smuggle guard; anchored, not `re.search`) and (b) reference an **existing `Asset`** in the item's version → else `422`; then maintain the dedicated `AssetReference`. **Also remove the existing post-flush guard** `if item.type == "interactive_app" and item.script_url is None: 422` (`items.py:205-207`) and its test (`tests/test_items.py`) so the **Remove/clear** path (`PATCH {script_url: null}`) is allowed and drops the reference. Attach is **PATCH-only by design** — the create schema now *rejects* a create-body `script_url` for `interactive_app` (above), so no valid-but-unreferenced script can be created. File paths: the router/upload/serve/delete-guard live in `backend/mathion/api/assets.py`; `sanitize_filename` in `backend/mathion/assets.py`.

## 6. Host page (rendered by `InteractiveFrame`)

Built client-side as the iframe's `srcdoc` (no new backend route), with the app source **inlined** (§4). `{SCRIPT_SOURCE}` = the fetched JS text (the `scriptSource` prop), escaped so it cannot break out of the host `<script>` element by neutralizing **every** occurrence of `</script`, case-insensitively **and case-preservingly** — `source.replace(/<(\/script)/gi, '<\\$1')` (inserts a backslash after `<` while keeping the matched `/script`/`/SCRIPT` exactly, so a mixed-case sequence inside a JS string literal is not altered — a naive `'<\\/script'` replacement would lowercase `</SCRIPT>` and corrupt the code). This global replace is the security-complete transform: `</script` is the only sequence that can terminate the host script, and `\/`≡`/` inside the string/regex/comment literals where such a sequence occurs in a real bundle, so the code stays equivalent. (The earlier `<!--` transform is dropped: it is unnecessary once every `</script` is neutralized, and would corrupt legacy `<!--` line-comment syntax.)

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'">
<style>html,body{margin:0;height:100%}#app-root{width:100%;height:100%}</style>
</head>
<body>
<div id="app-root"></div>
<script>{SCRIPT_SOURCE}</script>
</body>
</html>
```

- `script-src 'unsafe-inline'` permits the inlined app script and — by omitting any host source — blocks the app from loading any external `<script src>`; `style-src 'unsafe-inline'` covers Svelte's runtime `<style>` injection; `'unsafe-eval'` is deliberately **not** granted.
- `worker-src 'none'` / `img-src data: blob:` / `connect-src 'none'` are the tunable knobs if a real app later needs workers, asset-served images, or network — each a documented follow-up, not v1.
- The `</script>` escaping is the one correctness-critical string transform; it has a dedicated test (§11) covering **multiple** occurrences and **mixed case** (a first-occurrence-only `String.replace` would be a breakout). Setting the iframe's `srcdoc` via Svelte's `{srcdoc}` binding handles HTML-attribute escaping of the whole document automatically.
- **`scriptSource` must NEVER reach the main document** — it is only ever escaped-and-inlined into the sandboxed `srcdoc`, never `{@html}`'d or `innerHTML`'d into a Mathion page. (An srcdoc iframe *without* the sandbox attribute inherits the parent origin; the strict `sandbox` is what forces the opaque origin, so it must stay a non-configurable literal.)
- `InteractiveFrame` remains the **single hardened frame** and the sole authority for the sandbox + CSP + escaping. Props: `{ scriptSource: string /* fetched JS text */, title: string }`; it escapes the source, builds the `srcdoc`, and renders `<iframe srcdoc={...} sandbox="allow-scripts" referrerpolicy="no-referrer">` at fixed `600px` height, full width, no `allowfullscreen`. It never receives or emits a URL.

## 7. Flow — create then attach in the editor

Mirrors how `static_page` is created empty then edited.

- **Create** (`SequenceAccordion`): pick type `interactive_app` + title only. The App-URL field is **removed**; no `script_url` in the create body. Before a file is attached the item is valid but empty.
- **Edit** (`ItemEditPage`, editable version): a **file-upload widget**. Pre-attach empty state: **"No app uploaded yet. Choose a `.js` file to upload."** On selection:
  1. Client-side **heuristic scan** (§8) → show non-blocking warnings.
  2. Upload via existing `POST /api/versions/{version_id}/assets` (returns the sanitized filename).
  3. PATCH the item `{script_url: filename}` (the endpoint validates charset + asset existence and maintains the `AssetReference` — §5).
  4. **Live preview**: `fetchAssetSource(versionId, filename)` → source text → `InteractiveFrame scriptSource=...` in the real sandbox.
  - **Replace:** upload a new file, then PATCH `script_url` to it (the reference is re-pointed — §5). The upload endpoint 409s on a duplicate sanitized filename (`assets.py:75-77`), so re-uploading a fixed file under the **same** name fails; the author either uploads under a new name (the superseded `.js` is left in the version's asset library, removable via the asset manager — mirrors markdown-image behavior, no auto-delete) or deletes the old asset first. The plan should surface the 409 as a clear "a file with that name already exists" message.
  - **Remove:** PATCH `{script_url: null}` (now allowed — §5) → the reference is dropped → the widget returns to the empty state.
- **Player** (`InteractiveAppItem` via `ItemRouter`): `script_url` set → `fetchAssetSource(...)` → `InteractiveFrame scriptSource=...`. `script_url` unset → **"No app uploaded yet."** Fetch failure (404/403/network) → **"This app couldn't be loaded."**
- **Readonly** (disabled/archived version in `ItemEditPage`): same fetch→inline path if `script_url` set, else **"No app."** **Never** a link or raw URL.
- **Async coverage (restructured — the effect is NOT unchanged):** because the source now loads asynchronously, the auto-cover moves into the fetch-**success** continuation (not synchronous mount). Requirements: the `$effect` reads `item.id`, `script_url`, and `version_id` **reactively** (so navigation/replace tears down the prior run); an `AbortController` + stale-run guard so a late-resolving fetch (after teardown, navigation, or a `script_url` change mid-flight) can neither `start()` a tracker nor cover; coverage credited on a **successful source fetch** (a fetched-but-broken app still counts — mount-detection is deferred to follow-up #1); **no** coverage on unset `script_url` or on fetch failure; keep the once-only `untrack` guard. This is the phantom-coverage-sensitive area — specify the abort/teardown semantics in the plan, do not treat the effect as a straight port.
- **`version_id` wiring:** `InteractiveAppItem` currently receives only `{item, isCovered}` (`ItemRouter.svelte:23`); it needs the version id to build the fetch URL. Read it (null-safe: `currentCourse.value?.versionId`) from the **`currentCourse` store** — the same `stores/currentCourse.svelte` module `InteractiveAppItem` already imports `markItemCovered` from (the plan adds `currentCourse` to that import) — so **`ItemRouter` stays unchanged** (§9). Do not add an `ItemRouter` prop.
- **Shared fetch helper:** add `fetchAssetSource(versionId, filename, signal?: AbortSignal): Promise<string>` in `lib/assets.ts` — a raw credentialed `fetch('/assets/{versionId}/{filename}', {credentials:'include', signal}).then(r => r.text())` with 401/abort handling (mirror the existing `uploadAsset` raw-fetch pattern in the same file). It **cannot** use `api.get` (which always does `res.json()`, `api.ts:64`). Player, live preview, and readonly preview all use it; the editor's **live preview applies the same AbortController/stale-guard** so an out-of-order Replace can't flash the old source.

Reuse the generic asset-upload endpoint + a PATCH rather than a new dedicated endpoint (both already exist; `.js` already allowed). A dedicated `POST /api/items/{id}/script` is a possible future refinement (§12).

## 8. Validation

Framed as **catching honest mistakes, not enforcing security** (sandbox + CSP + preview do that).

- **Hard gate:** the existing `POST /api/versions/{version_id}/assets` enforces only **`.js` extension + upper size bound + version quota** — it does **not** reject empty files or non-text bytes (`assets.py:45-62`). The plan **adds a non-empty check** (client-side before upload, and a small server-side guard for the direct-API path); the client-side heuristic scan reads the file as UTF-8 text, so a binary/empty file also fails to scan meaningfully and surfaces as a blank preview.
- **Advisory heuristic scan (client-side util, non-blocking warnings):**
  - contains `import`/`export` tokens → "Looks like an ES module — must be a single classic/IIFE bundle."
  - no `app-root` substring → "Doesn't reference `#app-root` — make sure your app mounts into it."
  - matches `fetch(` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` / `import(` / `https?://` → "Network/external calls are blocked by the sandbox — the app must be self-contained."
  These are string scans (evadable, false-positive-prone) → **warnings only**, never blocking.
- **Authoritative functional check = the live preview.** The editor renders the file in the real strict-sandboxed iframe; the author sees whether it mounts. When the preview is blank, show a hint ("didn't render — most common cause: built as an ES module instead of a classic/IIFE bundle; see the tutorial").
- **Deferred (follow-up #1):** an explicit ✓ mounted / ✗ errored badge via a host-wrapper `postMessage`.
- **Deliberately excluded:** any server-side JS parser / `node --check`.

## 9. Removed / migrated from the merged feature

**Remove:** `lib/safeAppUrl.ts` (+ test); the App-URL field, its `safeAppUrl` gate, pre-POST bail, `script_url`-in-create-body, and its 422 inline-mapping in `SequenceAccordion`; the URL-editing + debounced external-preview + readonly external-link machinery in `ItemEditPage`.

**Revert:** the doc-comment on `lib/safeIframeUrl.ts` that mentions interactive-app consumers (video still uses it, untouched).

**Rework:** `InteractiveFrame.svelte` (external `src` → `{ scriptSource, title }`; inlines the escaped source into `srcdoc` + CSP; sandbox already `allow-scripts`); `InteractiveAppItem.svelte` (fetch the asset text from `/assets/{version_id}/{filename}` → pass `scriptSource`; "No app" / "couldn't be loaded" states; keep coverage `$effect`); `ItemEditPage.svelte` (URL editing → upload widget + heuristic warnings + fetch→inline sandboxed preview; readonly never links); **`lib/types.ts`** (`InteractiveAppItem.script_url` → `string | null` — it can now be unset; guards/tests must handle null before fetching).

**Keep unchanged:** `ItemRouter` wiring; `ItemTypePicker` (the 4th type).

**Backend (all per §5):** drop `script_url` from **both** `validate_url` copies (`ItemCreate` + `ItemUpdate`); **invert the `interactive_app` branch** of the `ItemCreate` `check_type_fields` model_validator to **reject a non-null create-body `script_url`** (keep the static_page/video branches); **remove the `update_item` post-flush `script_url is None → 422` guard** (`items.py:205-207`) and its test; add endpoint-level charset + asset-existence validation for `interactive_app`; add a **dedicated `AssetReference` helper** for the script asset (create/repoint/clear) and **make the markdown `sync_asset_references` skip `interactive_app` items** so publish doesn't wipe it; update `backend/tests/test_items.py`. (Serving is unchanged.)

**Existing data:** a dev `interactive_app` item with a legacy external `script_url` is a non-null string, so the player *fetches* `/assets/{version_id}/{that-string}`, which 404s → **"This app couldn't be loaded."** (not "No app", which is `null`-only). No data migration (dev-only); clear it (Remove) or delete the item and re-add as an upload. This feature is **full-stack** (the merged one was frontend-only).

## 10. Error handling & edge cases

- Upload rejected (bad extension / too large / over course quota) → surfaced inline from the existing endpoint's 400s; item keeps its previous `script_url` (or none).
- PATCH with a `script_url` filename that has no matching asset → `422` (dangling-reference guard).
- Disabled version → upload endpoint already 403s; the editor shows the readonly branch.
- Missing asset on disk / lost access at render → credentialed `fetch` returns 404/403 → player and preview show "This app couldn't be loaded."; coverage not credited.
- **Inactive enrollment:** content access allows *inactive*-enrolled users to read the course (`content.py:41`), but asset serving requires an **active** enrollment (`assets.py:150`). So an inactive user sees the item but the app-JS fetch 403s → "This app couldn't be loaded." This matches existing asset behavior (markdown images 403 identically for inactive users); `serve_asset` is **not** widened — documented, not changed.
- App source containing one or more `</script>` (any case) → every occurrence neutralized by the §6 global case-insensitive escaping before inlining (dedicated test); none may terminate the host `<script>` early.
- Blank preview (e.g. author uploaded a module) → the hint in §8; no hard error.
- Benign self-truncation: a source containing `<!--` followed by `<script` can push the HTML tokenizer into the double-escaped state so the host template's own closing `</script>` is swallowed, leaving the frame's script open. This breaks only that one app inside its own sandbox (no escape, nothing sensitive follows the tag) — the `</script` neutralization still guarantees no breakout. Awareness note, not a guard.

## 11. Testing

- **Heuristic-scan util (unit):** module tokens → warn; `#app-root` present → no warn; `fetch`/`http(s)://`/`import(` → warn; clean file → clean.
- **`InteractiveFrame`:** `srcdoc` contains `#app-root`, the **inlined app source**, the CSP meta, and the fixed `600px` frame; `sandbox` is exactly `allow-scripts` (regression guard against `allow-same-origin`); `referrerpolicy=no-referrer`; no `allowfullscreen`. **Escaping test:** the host template contains its own closing `</script>` terminator, so "no `</script>` in the `srcdoc`" is impossible — instead (a) test the **escape helper directly**: a source with **multiple** `</script>` in **mixed case** (`</script>…</SCRIPT>`) yields output with **no** `</script`/`</SCRIPT` and the **case-preserved** escaped forms (`<\/script`, `<\/SCRIPT`) present; and (b) for the assembled `srcdoc`, assert it contains **exactly one** raw `</script>` (the host terminator). This discriminates a first-occurrence-only *and* a case-lowercasing `.replace`. (jsdom does not execute srcdoc scripts / enforce CSP — assertions are on constructed markup + attributes; real execution via manual smoke.)
- **`InteractiveAppItem`:** `script_url` set → `fetchAssetSource` (stubbed `fetch`) → frame with inlined source + auto-covers on fetch success; fetch failure → "This app couldn't be loaded.", no frame, **not** covered; `script_url` unset → "No app uploaded yet.", no frame, **not** covered; **late fetch after unmount** (abort/stale guard) → no tracker start, no cover. The `fetch` stub must **branch by URL** (`/assets/…` → JS text vs `/api/items/:id/track` → track response) so the two async layers settle and negative "not covered" assertions aren't vacuous. Keep once-only-`untrack` + deterministic-teardown (pinned `performance.now`) patterns.
- **`ItemEditPage`:** pre-attach empty state; upload on an editable version sets `script_url` + shows preview (stubbed upload + `fetchAssetSource`); module-ish/networky file surfaces warnings; **preview fetch-failure** → "couldn't be loaded"; Remove → `PATCH {script_url:null}` clears to empty state; readonly/disabled → preview or "No app", never a link (security guard).
- **`SequenceAccordion`:** creating `interactive_app` sends only type + title (no `script_url`, no URL field); picker still shows the 4th type.
- **Backend (pytest, `test_items.py`):** create `interactive_app` **without** `script_url` allowed; create **with** any `script_url` → `422` (attach is PATCH-only); setting `script_url` via PATCH to a valid existing filename works, to a URL or `../`-traversal or non-existent filename → `422`; **clearing** `script_url` (`PATCH {script_url:null}`) succeeds and drops the reference (invert the old `nullify → 422` test); `AssetReference` created on attach, **re-pointed on replace** (attach A → replace with B → A is now unreferenced/force-free-deletable, B referenced), and **survives `publish_version`** (the wipe-regression guard); asset delete blocked while referenced (409); serve stays auth-gated. `video_url` still requires `http(s)://` (unchanged). **Existing tests to update:** repurpose `test_api_create_item_invalid_script_url` to assert the create-with-`script_url` → 422 PATCH-only rule (it still 422s, but now for the reject-non-null reason, not URL validation), and revisit `test_create_interactive_app`'s ORM-level `script_url` assumption.

## 12. Follow-ups (out of scope)
1. `postMessage` channel: explicit mount/error badge in the editor + app "completed" signalling for coverage. **Security note for that plan:** the parent listener must authenticate messages by `event.source === iframeEl.contentWindow` — **never** by `event.origin`, which is the spoofable string `"null"` for every opaque-origin frame.
2. Relaxable CSP knobs (`'unsafe-eval'` for expression-eval libraries, `worker-src`, asset-served images, `webrtc 'block'`) if a real app needs them.
3. Separate apps origin / per-app subdomains if app-vs-app isolation or heavier (multi-file/module) apps become a requirement.
4. A dedicated `POST /api/items/{id}/script` upload endpoint if the two-step reuse proves awkward.
5. Public author tutorial documenting the §3 contract with per-framework single-file build recipes.
