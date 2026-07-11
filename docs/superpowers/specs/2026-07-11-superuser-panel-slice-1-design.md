# Superuser Panel — Slice 1: Access + Shell + Dashboard (Design)

**Status:** approved design, pre-plan.
**Scope of this document:** the first sub-slice of platform spec §8 (Superuser Panel). It delivers the token-gated access mechanism, an authenticated panel shell, a system-stats dashboard, and interim bootstrap tooling — the foundation every later superuser sub-area hangs off.

---

## 1. Context

Platform design spec §8 (`docs/superpowers/specs/2026-04-19-mathion-platform-design.md`) defines a token-gated superuser panel at `/superuser/{token}` covering: system-stats dashboard, user management, course creation + admin assignment, settings (SMTP/file-limits/session-durations), and a first-run setup checklist. None of it is built.

What already exists in the codebase:
- `User` model with `is_superuser` (`backend/mathion/models_auth.py`); the `require_superuser` FastAPI dependency; a superuser-gated `POST /api/courses` (`backend/mathion/api/courses.py`).
- `Session` model in `models_auth.py` (table `sessions`) with `last_active_at`, updated with a 5-minute throttle in `backend/mathion/auth.py:148`.
- PIN service in `backend/mathion/auth.py`: `generate_pin()`, `request_pin(db, email) -> str | None`, `verify_pin(...)`. Logout at `backend/mathion/api/auth.py:86`.
- Asset registries with `file_size`: `Asset` (course, `models.py:161`) and `RunAsset` (`models.py:351`).
- Frontend SPA routing in `frontend/src/lib/router.svelte.ts` + `App.svelte`; `formatFileSize` in `frontend/src/lib/format.ts`.

What is missing (and blocks everything): **no superuser account can exist today** — every seed sets `is_superuser=False` and there is no create/promote path — and there is no panel, no access mechanism, and no settings-as-data.

**§8 is decomposed into sub-slices** (each its own spec → plan → build). This slice is the foundation. Later slices: user management; course/admin-assignment UI; settings-as-data; setup checklist. The real `mathion` CLI + Docker deployment belong to the separate Deployment slice (platform §9/§10 item 10).

### Resolved decisions (from brainstorming)
1. **Decompose §8, foundation first** — this slice = access + shell + dashboard.
2. **Full token-gate now** with an interim activator command (not deferred to the CLI slice).
3. **Interim tooling = full bootstrap** — `create-superuser`, `pin`, `activate`, each a 1:1 stand-in for a future `mathion` CLI verb.
4. **Token architecture = dedicated table + FastAPI dependency.**

---

## 2. Scope

**In scope**
- `SuperuserPanelToken` model + migration.
- Panel token service (mint / validate / destroy-active) + `require_superuser_panel` dependency.
- `GET /api/superuser/{token}/stats` endpoint + response schema.
- Interim `python -m mathion.superuser` command group (`create-superuser`, `pin`, `activate`).
- Logout hook (superuser sessions only) that destroys the active panel token. No background purge task — the single-row table self-limits via per-request inactivity expiry + delete-on-logout + delete-on-reactivate.
- Frontend `/superuser/:token` area: shell + dashboard + guard handling.
- **Login-PIN delivery:** `request_pin` prints the PIN to the server console under `MATHION_DEBUG` (as today); the `/api/auth/request-pin` endpoint additionally **sends the PIN by email synchronously** when debug is off and a mailer is configured (new `login_pin` email). The CLI `pin` prints the PIN directly regardless, for bootstrap. (Today no login PIN is ever emailed — this closes that gap.)
- **PIN-delivery-aware login:** a public `GET /api/auth/config` → `{ send_pin_enabled }` + `Login.svelte` showing the normal two-step "Send PIN" flow whenever a Send-PIN would deliver a retrievable PIN (email configured, or `MATHION_DEBUG` console), or direct email+PIN entry on a fresh server where it would not (→ operator uses the CLI-generated PIN).

**Out of scope (later slices)** — user management; course/admin-assignment UI; settings-as-data (env→DB); setup checklist; the real `mathion` CLI + Docker deployment.

---

## 3. Access & Authentication Model

### 3.1 Token
- A single active panel token at a time. Generated with `secrets.token_urlsafe(32)` (≥43 URL-safe chars). Only its **hash** is stored (same hashing scheme used for session tokens in `auth.py`); the plaintext is shown once, by the activator. Validation is a hashed-token DB equality lookup (as for sessions, `auth.py:131`) — not constant-time, but the 256-bit token entropy makes timing side-channels irrelevant.
- `activate` deletes any existing token row and inserts the new one **within a single transaction** (one commit) — minting a new token invalidates the old URL. The "single active token" invariant is service-enforced, not a DB constraint; a fresh 256-bit `token_hash` makes a unique collision effectively impossible, and concurrent `activate` runs are out of scope for a single-operator CLI.

### 3.2 `require_superuser_panel` dependency (guards every panel route)
Layered failure codes, chosen so the panel is not revealed to the wrong caller. **Checks run in this order** (so a bad token never leaks that a session/role would have mattered): (1) token → (2) session presence → (3) superuser role.

| Step | Condition | Result |
|------|-----------|--------|
| 1 | Token absent / wrong / expired | **404** — the URL simply does not exist |
| 2 | Token valid, but no authenticated session | **401** — log in first |
| 3 | Token valid, authenticated, but **not** a superuser | **404** — do not reveal to normal users |
| — | Token valid + authenticated superuser session | **200** — proceed |

On success, enforce the **30-minute sliding inactivity window**: if `now − last_active_at > 30 min`, delete the row and return 404; otherwise bump `last_active_at` (throttled write, mirroring the session `last_active_at` pattern in `auth.py:148`).

**Wiring (critical):** the dependency MUST validate the token itself first, then resolve the current user **inline** by reusing the *service function* `auth.validate_session(db, session_token)` (reading the `session_token` cookie directly) — **not** by declaring `Depends(get_current_user)` / `Depends(require_superuser)`. FastAPI resolves declared sub-dependencies *before* the dependency body, which would fire the session/role check ahead of the token check and surface **401** (no session) / **403** (non-superuser) — leaking that the route exists and breaking the ordering above. Map "no user" → **401** and "user but not `is_superuser`" → **404** (deliberately not the existing 403). This slice's only panel endpoint is a GET (`/stats`), so the CSRF `X-Requested-With` check that `get_current_user` performs is not needed here; future mutating panel endpoints must add it explicitly.

**Inactivity-window semantics:** the window is measured from `last_active_at`, seeded to `now` at mint. A token opened for the first time >30 min after `activate` is therefore already expired (deleted + 404) — the operator re-runs `activate`, a cheap local command. This is intentional: a minted-but-unused token does not stay valid indefinitely (matches platform §8's "short inactivity window"). The bump is throttled to at most once per **5 min (300 s)**, mirroring `auth.py:154`; the throttle interval (5 min) is deliberately shorter than the expiry window (30 min) so an in-use token is always bumped before it can expire. Comparisons use `datetime.now(timezone.utc)` and replicate the SQLite naive-datetime handling in `auth.py:150-153`.

### 3.3 Lifecycle
- **Manual logout** (`api/auth.py:86`) deletes the active panel token **only when the logging-out session belongs to a superuser** — resolve the user from the `session_token` first and gate on `is_superuser`, otherwise a normal user's logout would destroy the panel token.
- **No background purge task exists** (and the notifications dispatcher `run_forever` is mailer-gated — `main.py:46` — so it does not even run on the email-less interim deployment this slice targets). Expired-token cleanup relies entirely on the per-request inactivity check (§3.2, delete + 404), delete-on-logout, and `activate`'s delete-then-insert. Because at most one token row ever exists (§4), this is sufficient — no orphan accumulation.
- The token is **not** bound to a specific user — access is "valid token **+** any authenticated superuser session," per platform §8. Consequently any superuser's logout destroys the shared token (see the logout hook above); with a single operator this is the intended "destroyed on logout" behavior.

### 3.4 CSRF / transport
Panel API calls reuse the existing session cookie (`SameSite=Lax`). This slice's only endpoint is a GET (`/stats`), so the app-wide `X-Requested-With` CSRF check (enforced on mutating requests via `get_current_user`) does not apply; later slices adding mutating panel endpoints must enforce it explicitly (see §3.2). The token-in-URL model is per platform §8 (32-char URL-safe, hashed at rest, short inactivity window, superuser-session-gated, destroyed on logout).

---

## 4. Data Model

New table `superuser_panel_tokens` (model in `models_auth.py`, the auth-domain module):

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `token_hash` | `String(64)`, unique, indexed | sha256 hex of the URL-safe token — mirrors `Session.token_hash`; plaintext never stored |
| `created_at` | datetime (tz) | server default now |
| `last_active_at` | datetime (tz) | sliding 30-min inactivity window |

Alembic migration adds the table with `down_revision = "4e17d3637814"` (the current head — `4e17d3637814_add_course_version_label.py`; confirm it is still head at implementation time). At most one row exists in practice (`activate` replaces), but no DB-level singleton constraint is imposed — the service enforces "delete-then-insert" in a single transaction (§3.1).

---

## 5. Backend API

`GET /api/superuser/{token}/stats` — gated by `require_superuser_panel`. Token in the path keeps validation uniform with the page route.

Response `SuperuserStatsResponse`:

| Field | Definition |
|-------|-----------|
| `total_users` | `count(User)` |
| `total_courses` | `count(Course)` |
| `storage_bytes` | `coalesce(sum(Asset.file_size),0) + coalesce(sum(RunAsset.file_size),0) + coalesce(sum(Submission.file_size),0)` — course assets + run assets + **student submission files** (`Submission.file_size`, `models.py:312`), the three registry tables with a tracked size. Excludes user photos (`photo_url` — no size column) and evaluation feedback files (`Evaluation.feedback_file` — path, no size column); both are genuinely un-summable, not merely "negligible." **Compute as three separate single-table scalar aggregates** (matching `api/assets.py:56` / `api/run_assets.py:55`), summed in Python — NOT one joined query (a naive `join` across the three tables would cartesian-multiply the sizes). |
| `active_users_24h` | `count(distinct Session.user_id)` where `last_active_at ≥ now − 24h`, **regardless of `Session.expires_at`** (a session touched in the window was non-expired when last validated). Disabled users are **not** explicitly excluded — their stale sessions are purged lazily on next validation (`auth.py:143`). (This is a documented consequence, not a filter to implement — do not add an `is_disabled` join.) |
| `active_users_7d` | as `active_users_24h` with a 7-day window. |

All plain aggregate queries; no N+1. Empty DB → zeros. Time comparisons use `datetime.now(timezone.utc)` with the same SQLite naive-datetime handling as `auth.py:150-153`. The `/stats` response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer` as **defense-in-depth**, but since the token lives in the **document** URL the primary leak protection is document-level (§7): a `no-referrer` meta in `index.html` plus `Cache-Control: no-store` on the SPA `index.html` response for panel paths.

### Public config endpoint (bootstrap enabler)

`GET /api/auth/config` — **unauthenticated**, no token, no CSRF (GET). Returns `{ send_pin_enabled: bool }` where `send_pin_enabled = settings.debug or settings.email_mode != "disabled"` — i.e. **true whenever clicking "Send PIN" yields a retrievable PIN**: the server console under `MATHION_DEBUG`, or the user's inbox when email is configured. (It is deliberately NOT `email_mode != "disabled"` alone: under `MATHION_DEBUG` the two-step "Send PIN" flow prints the PIN to the console via `request_pin`, `auth.py:74`, so two-step is still the correct retrievable path in debug — matching today's dev login. A flag of `email_mode` alone would show the inbox-implying two-step in debug while emailing nothing, or force direct-entry+CLI and drop the familiar Send-PIN→console dev flow.) Exposing this operational boolean is not sensitive: `false` only reveals "no email configured and not in debug" (a fresh/unprovisioned server), and it does not cleanly leak debug state since `true` is ambiguous between debug and email-configured. Lives in `api/auth.py` (a general auth concern, not superuser-specific), but is in scope for this slice because the bootstrap depends on it.

### Login-PIN delivery (new)

Today `request_pin` only prints the PIN under `MATHION_DEBUG` (`auth.py:74`) and **never emails it** — no login PIN is deliverable to a real inbox in any mode (verified: the notification pipeline has no `login_pin` kind and `request_pin`/`/request-pin` invoke no mailer). This slice adds delivery, matching the config flag so `send_pin_enabled` is truthful:

| Condition | PIN delivered via |
|-----------|-------------------|
| `MATHION_DEBUG=1` | server console (unchanged); **no** email |
| debug off **+** mailer configured (`email_mode != "disabled"`) | **email, sent synchronously** by the `/api/auth/request-pin` endpoint |
| debug off **+** no mailer | not delivered automatically — obtainable only via the CLI `pin` (bootstrap) |

Under `MATHION_DEBUG`, `send_pin_enabled` is `true` (whether or not email is configured), so the login screen shows the **two-step "Send PIN"** flow exactly as today: the dev enters their email, clicks Send PIN — which calls `request_pin`, printing the PIN to the server console (`auth.py:74`) — reads it from the console, and enters it. No email is sent in debug (the send is gated on `not settings.debug`), which is precisely why the flag folds in `debug`: the PIN is retrievable (console), so two-step is the correct screen. `MATHION_DEBUG` is dev-only. (Direct-entry therefore appears only on a genuinely non-delivering server: debug off **and** email off — the fresh-prod bootstrap, where the operator uses the CLI `pin`.)

The email send is **synchronous** (in the endpoint), NOT through the `NotificationLogEntry` queue, for two reasons: (1) login PINs are latency-critical — the dispatcher batches on a tick, so a queued PIN could arrive minutes late; (2) the queue persists its payload in `notification_log` (`models_auth.py:100`), which would put the **raw PIN in the DB in plaintext** — PINs are otherwise only stored hashed. The endpoint builds a **one-shot mailer from settings** (`build_mailer_from_settings(settings)`), **NOT** the shared `app.state.mailer`, for two reasons: (a) that instance is used concurrently by the notifications dispatcher's `tick()` on a worker thread (`dispatcher.py`, via `asyncio.to_thread`) and `SMTPMailer.session()` mutates a single `self._smtp` connection (`mailer.py:69,79`), so sharing it would race a dispatcher batch and corrupt the connection; (b) `app.state.mailer` is only set inside the lifespan (`main.py:44`), so reading it raises `AttributeError` (not `None`) under the lifespan-less test client (`conftest.py:105`) — which would break the existing `/request-pin` path. The raw PIN is put into an `EmailMessage` in memory (`X-Mathion-Kind: login_pin`, set by the builder itself; `To` = the normalized request email, which — because `request_pin` returned a PIN — is a matched, stored `User.email`, `auth.py:36`) and sent inside a one-shot `with mailer.session(): mailer.send(msg)` (SMTPMailer opens/closes a connection per send — fine at login frequency); it is **never persisted or logged**.

**Non-oracle response + failure handling.** The endpoint attempts the send only when `request_pin` returned a **non-`None`** PIN (it returns `None` for unknown/disabled/rate-limited, `auth.py:37,50`). The endpoint response stays **uniform** — `{"message": "PIN sent"}` regardless of whether the user exists, whether a PIN was minted, or whether the send succeeded — preserving the existing non-oracle property (`api/auth.py:44`). A send failure (SMTP down) is **logged server-side only, never surfaced to the caller**: surfacing a "couldn't send" error would leak which addresses are real users, because only real, enabled users reach the send (`request_pin` returns `None` for unknown/disabled *before* the rate-limit check, `auth.py:37` precedes `:50`, so a rate-limit signal is itself user-existence). Ordering consequence: `request_pin` commits the minted PIN + the `pin_request:{email}` rate-limit slot **before** the send (`auth.py:64,73`), so a failed send does **not** roll them back — repeated SMTP failure can consume the 3/hr cap. The CLI `pin` shares that same rate-limit key (`auth.py:46`), so it is **not** an escape hatch under a persistent outage; the remedies are §6's `RateLimited` note (wait an hour, raise `MATHION_MAX_PIN_REQUESTS_PER_HOUR`, or clear `rate_limit_entries`). Because the send is synchronous, the "Send PIN" request blocks up to the SMTP timeout (~30 s, `mailer.py:69`) on a slow host, so `Login.svelte` shows a pending state on submit (§7). Delivery lives in the endpoint, not in `request_pin` itself, so the CLI `pin` path (operator bootstrap) never emails.

---

## 6. Interim Bootstrap CLI — `python -m mathion.superuser`

A small `argparse` shim in `backend/mathion/superuser/__main__.py` over importable business-logic functions in `backend/mathion/superuser/service.py`, each returning a **structured result** (not a printed string) so that `__main__.py` — and the future `mathion` CLI — are thin format-only shims and §9 can test the logic directly:
- `create_or_promote_superuser(db, email) -> User` (raises on an invalid email — see the verb row).
- `issue_bootstrap_pin(db, email) -> PinIssued(pin) | UnknownUser | DisabledUser | RateLimited` — wraps `auth.request_pin` and performs the follow-up disambiguation read; the shim maps each variant to a message.
- `activate_panel(db) -> ActivateResult(token, url, has_superuser)` — mints the token (delete-then-insert, one transaction) and reports whether any superuser exists (for the warning).

`__main__.py` opens a DB session via `mathion.database.SessionLocal` (as the seed scripts do) so it targets the configured `MATHION_DATABASE_URL`, calls these functions, and **only formats/prints** — no business logic, no DB decisions in the shim. This makes the future `mathion` CLI a zero-behavior-change wrapper over the same functions.

| Verb | Behavior | Future CLI verb |
|------|----------|-----------------|
| `create-superuser <email>` | Via `create_or_promote_superuser`: **normalize the email (`strip().lower()`, matching `auth.py:35`)** then **validate it is non-empty and ≤254 chars** — reject whitespace-only (normalizes to `""`) or oversized input with an actionable error (SQLite does not reliably enforce the `String(254)` limit, so an oversized value could pass tests and fail on PostgreSQL; an empty email yields an unusable account). The normalization also prevents a mixed-case/whitespace arg creating a duplicate row against the normalized-email unique index (`models_auth.py:13`). Then create the user if absent, or promote an existing one (`is_superuser=True`). If the user exists but is **disabled**, re-enable it (`is_disabled=False`) as part of promotion — a bootstrap command's job is to yield a *usable* superuser, and disabled users cannot log in (`auth.py:37,143`). If already an enabled superuser, print "already a superuser (no change)". Idempotent. | part of `mathion install` |
| `pin <email>` | Via `issue_bootstrap_pin` (wraps `auth.request_pin`): on `PinIssued`, print the raw PIN. `request_pin` returns `None` for three distinct causes — unknown email, disabled user, or rate-limited (≥ 3/hr, `auth.py:37,50`); the service does a follow-up read (query `User` by the **normalized** `strip().lower()` email) and returns `UnknownUser` / `DisabledUser` / `RateLimited`, which the shim prints as "unknown email" / "user is disabled" / "rate-limited: try again later — bootstrap can trip the 3/hr cap (PINs expire in 10 min); wait an hour, raise `MATHION_MAX_PIN_REQUESTS_PER_HOUR`, or clear `rate_limit_entries`". `request_pin` never sends email — it returns the PIN directly — so this works with `email_mode=disabled` and without `MATHION_DEBUG`. | `mathion superuserpin` |
| `activate` | Via `activate_panel`: replace the active panel token (single transaction) and print `{settings.base_url}/superuser/{token}`. Independent of any specific user. If **no superuser account exists yet** (`has_superuser=false`), still mint but warn ("no superuser accounts exist — run create-superuser first, or this URL will 404"). The printed URL reflects `MATHION_BASE_URL` (default `http://localhost:8000`); it must be set for non-local access. | `mathion superuser` |

The three verbs make the panel reachable end-to-end without email configured — **but only because the login is delivery-aware** (§7). Critical gotcha this avoids: the two-step login screen's "Send PIN" calls `auth.request_pin`, which **marks every prior unused PIN as used** (`auth.py:53`) and mints a replacement that is **neither emailed nor printed** (`email_mode=disabled`, no `MATHION_DEBUG`) — silently killing a CLI-generated PIN and burning a rate-limit slot (`auth.py:50`, 3/hr). On this fresh server (email off **and** not debug → `send_pin_enabled=false`), the delivery-aware login (§7) shows the direct-entry form and skips "Send PIN", so the terminal-printed PIN stays valid and is entered directly.

**Recommended bootstrap:** `create-superuser <email>` → `activate` (copy the printed URL) → open the URL → on the fresh-server direct-entry login screen (`send_pin_enabled=false`), enter your email; run `pin <email>` in the terminal and read the printed PIN; enter it → panel. (PINs expire in 10 min, so run `pin` when you are ready to type it.)

---

## 7. Frontend

New SPA area at `/superuser/:token`, wired into `routes.ts` / `App.svelte`. The existing router is **flat** — one component per route, no nested-router / `Outlet` concept; `App.svelte` renders a single `componentMap[route.component]` (`App.svelte:69`). So the route registers the **shell** as its component and the shell renders the dashboard itself:

- Register `{ path: '/superuser/:token', component: 'SuperuserShell', auth: false }` in `routes.ts` and add `SuperuserShell` to `App.svelte`'s `componentMap`. `auth: false` is required so App.svelte's guard (`matched.route.auth && session.user === null`, `App.svelte:53`) does not pre-empt the route and encode the token into `?next=`.
- **`SuperuserShell.svelte`** — panel chrome + minimal nav (only **Dashboard** now; nav grows in later slices) + a sign-out action. Receives `token` as a route-param prop and **renders `SuperuserDashboard` internally**, passing `token` down. Reuses the app auth/session.
- **`SuperuserDashboard.svelte`** — on mount fetches stats via `lib/superuser.ts`, renders five stat cards (Users, Courses, Storage via `formatFileSize`, Active 24h, Active 7d) with loading + error states. Stats are numeric — no `@html`.
- **`lib/superuser.ts`** — typed `getSuperuserStats(token)` wrapper over the existing api client, calling `/api/superuser/${token}/stats` with **`skipAuthRedirect: true`** so the app-wide 401 handler (the `onUnauthorized` callback in `main.ts`, fed by `emitUnauthorized` in `api.ts`) does not hijack the 401 — the dashboard handles both failure codes itself.

**Global header:** `App.svelte` renders `<AppHeader />` whenever `session.user && path !== '/login'` (`App.svelte:62`). Extend that condition to **also exclude `/superuser/…` paths**, so the main app header does not stack on top of the panel's own chrome/sign-out (double header + duplicate logout otherwise).

**Guard handling in the SPA** (owned by `SuperuserDashboard`'s stats-fetch `catch`, branching on `ApiError.status`):
- **404** (bad/expired token, or non-superuser) → render a **panel-specific expired/not-found state** inline ("This panel link is not valid or has expired — re-run `activate` to mint a new one"), NOT the generic `NotFound` page (whose "Back" goes to `/courses`, a dead-end for an operator). This also covers **mid-session expiry** — a refetch after the 30-min window returns 404 while the operator is already viewing the panel.
- **401** (valid token, no session) → `sessionStorage.setItem('superuser_return_path', currentRoute.path)` **then** `navigate('/login', { replace: true, force: true })`. The panel path (which contains the token) is stashed in `sessionStorage`, **never** in a `?next=` query param. `Login.svelte` **captures the stashed path into component-local state on mount and immediately deletes the `sessionStorage` key** (NOT on successful login). This read-and-clear must be **synchronous — at component init or the first line of `onMount`, before any `await`** — and independent of the (async) `getAuthConfig` fetch below; sequencing the clear *after* the awaited config fetch would let an unmount during the in-flight fetch skip the clear, reintroducing the stale-key hazard. On successful verification it navigates to the captured path (precedence over `?next=`), else falls back to the current `?next=` / `defaultLandingPath` logic. Capturing-and-clearing at *mount* bounds the key's lifetime to a single Login mount, so an **abandoned** panel redirect cannot leave a stale key that hijacks a later ordinary login — the next login mounts fresh with the key already gone.

**PIN-delivery-aware login (bootstrap enabler):** `Login.svelte` fetches `GET /api/auth/config` (§5) on mount. When `send_pin_enabled` is **false** (a fresh server — email off and not in debug — where a "Send PIN" would deliver nowhere), it skips the "Send PIN" step entirely and presents a combined **email + PIN** form with an explanatory message ("Email delivery isn't configured — enter your email and the PIN shown in the server terminal"), submitting straight to `verify-pin` **without** calling `request-pin`. When `send_pin_enabled` is **true**, the two-step flow (email → Send PIN → PIN) is used — the PIN is delivered to the user's inbox (email configured) or printed to the server console (`MATHION_DEBUG`), per §5; because the send is synchronous when it occurs (email configured, debug off), the "Send PIN" button shows a **pending state** while the request is in flight (worst case ~30 s on a slow SMTP host, §5) so the wait is not read as a frozen UI. **Until `/api/auth/config` resolves, Login renders neither form** — it shows a loading state and picks the form shape only after `send_pin_enabled` is known (a *render-gate*, mirroring the whole-subtree block of the app's `session.loading` gate at `App.svelte:66` — NOT merely a disabled button, which an Enter key can bypass). `onSubmitEmail` additionally early-returns while config is unresolved (`if (sendPinEnabled === undefined) return;`) as belt-and-suspenders — otherwise a "Send PIN" before config lands would fire `request_pin` prematurely. **If the config fetch fails (network/5xx), resolve the gate into the standard two-step flow** (set the resolved state in the `catch` so submit re-enables — no infinite spinner) — the production-normal path; if the server is actually the fresh-bootstrap case, the operator just re-runs `pin`. This is what makes the terminal-printed bootstrap PIN usable (§6) — the fresh-server direct-entry screen never fires the PIN-invalidating `request_pin` (`auth.py:53`). The adaptation is not superuser-specific: on a fresh server no one can receive a PIN via Send-PIN, so direct entry is the correct behavior for everyone until email (or debug) makes a PIN retrievable.

**Sign-out:** the shell's sign-out does `await logout(); navigate('/login', { replace: true, force: true })` — it does **not** return to the panel path (the backend logout hook has destroyed the token, §3.3, so that path now 404s). `replace: true` keeps the now-dead token out of the current history entry.

**Token-in-URL scope (accurate statement):** the token is unavoidably in the operator's own address bar and browser history — inherent to the platform §8 token-in-URL model, which this slice cannot change. The guarantee above is narrower: the token never enters the `/login` URL, any `?next=` query string, server logs of the login navigation, or (via the document referrer policy below) the `Referer` header / document cache.

**Document-level token protection:** because the secret lives in the *document* URL (`/superuser/{token}`), leak protection must sit on the **document**, not the JSON API response. Add `<meta name="referrer" content="no-referrer">` to `frontend/index.html` (covers every SPA route uniformly), and have the SPA fallback (`main.py` `_spa_fallback`) attach `Cache-Control: no-store` to the `index.html` response for `/superuser/…` paths. The same headers on the `/stats` API response (§5) are defense-in-depth only — they do not protect the document URL.

---

## 8. Error Handling (consolidated)

- Guard failure codes as in §3.2 (token→404, no-session→401, non-superuser→404; wired via `validate_session`, not `Depends(require_superuser)`).
- Inactivity expiry checked per request (delete + 404). No background purge — the single-row table self-limits (§3.3).
- Manual logout deletes the active panel token only for superuser sessions (§3.3).
- CLI: `create-superuser` idempotent (create / promote / re-enable disabled / no-op if already superuser); `pin` disambiguates the `None` return (unknown / disabled / rate-limited); `activate` replaces the prior token in a single transaction and warns if no superuser exists.
- Stats endpoint is read-only; empty DB coalesces to zeros; the `/stats` response sets `Cache-Control: no-store` + `Referrer-Policy: no-referrer` (defense-in-depth), while the document-level `no-referrer` meta + SPA `index.html` `no-store` (§7) are the primary token-leak protection.

---

## 9. Testing

**Backend**
- Token: `activate` stores only the hash; wrong/absent token → 404; single-active-token replacement (old token 404s after re-activate).
- Two-factor matrix: valid + superuser session → 200; valid + no session → **401**; valid + non-superuser session → **404** (explicitly not 403, guarding against a `Depends(require_superuser)` mis-wire); bad token + superuser session → 404.
- 30-min expiry: a token last-active >30 min ago is deleted and 404s; a request inside the window bumps `last_active_at` (throttled — a second request inside 5 min does not re-write); a freshly-minted token opened >30 min after `activate` 404s on first load.
- Logout: a **superuser** logout destroys the active panel token; a **non-superuser** logout leaves it intact.
- Stats correctness: counts; `storage_bytes` sums course + run **+ submission** files; a submission-only DB reports non-zero storage; active-window boundary users (just inside vs. just outside 24h / 7d); an expired-but-recently-active session still counts; a disabled user's residual session is not specially excluded.
- CLI **service functions** (tested directly against the `conftest.py` DB fixture, asserting returned result objects + DB state — not printed strings): `create_or_promote_superuser` creates, idempotently promotes, **re-enables a disabled** user, no-ops an already-superuser, **collapses a mixed-case email to a single row** (no duplicate), and **rejects empty/whitespace-only and >254-char emails**; `issue_bootstrap_pin` returns `PinIssued` (a PIN that `verify_pin` accepts) vs `UnknownUser` / `DisabledUser` / `RateLimited` (after 3 requests); `activate_panel` returns `has_superuser=false` when none exists and a token that validates + supersedes a prior one.
- Two sessions for the **same** user count **once** in `active_users_24h/7d` (the `DISTINCT` is load-bearing).
- Response headers: the `/stats` response sets `Cache-Control: no-store` + `Referrer-Policy: no-referrer`; the SPA document response for a panel path carries the `no-referrer` policy (meta present) + `Cache-Control: no-store`.
- `GET /api/auth/config` returns `send_pin_enabled` across all four `debug`×`email_mode` combinations: **false** only when `debug` is off AND `email_mode=disabled`; **true** when `debug` is on OR `email_mode != disabled` (i.e. debug-on+email-off is `true`); no auth required.
- Login-PIN delivery (the test injects the mailer by patching `build_mailer_from_settings` to return a `MemoryMailer` it holds — NOT by reading `app.state`): under `MATHION_DEBUG` the PIN is console-printed and **not** emailed; with debug off + a `MemoryMailer`, `/api/auth/request-pin` sends **exactly one** `login_pin` message containing a PIN that `verify_pin` accepts, and **no raw PIN is written to `notification_log`**; with debug off + no mailer (`email_mode=disabled`), nothing is sent; for an **unknown / rate-limited** email (`request_pin` → `None`) **no email is sent**; a mailer send failure is **logged server-side and the response stays uniform `{"message": "PIN sent"}`** — asserted identical to the unknown-email response, so there is no user-enumeration oracle; and — regression guard for the removed `app.state.mailer` read — the existing `/request-pin` returns **200** under the plain (lifespan-less) `client` fixture with email disabled.

**Frontend** (mount/unmount/flushSync, Svelte 5 runes; no `@testing-library`)
- Shell renders nav + sign-out.
- Dashboard fetches + renders the five cards; loading + error states; storage formatted.
- Shell is the route component and renders the Dashboard; `AppHeader` is suppressed on `/superuser/…` paths.
- 404 → panel-specific expired/not-found state (NOT the generic `NotFound`); 401 → panel path stashed in `sessionStorage['superuser_return_path']` (assert the token is NOT present in any `?next=`/URL) and `navigate('/login', { replace, force })`; `Login.svelte` captures + clears the key **on mount** and, on successful verification, navigates to the captured path (precedence over `?next=`).
- Sign-out calls `logout()` then navigates to `/login` (replace), NOT back to the panel path.
- A **stale** `superuser_return_path` from an abandoned panel redirect does NOT misroute a later ordinary login — because Login captures + clears on mount, a fresh login mount sees no key and follows `?next=`/default.
- **PIN-delivery-aware login:** with `send_pin_enabled=false` the login screen skips "Send PIN" and submits email+PIN directly to `verify-pin` (no `request-pin` call); with `send_pin_enabled=true` the two-step flow is unchanged; while config is in flight **neither form is rendered** (render-gate) and mounting with an unresolved config fetch fires **no** `request-pin` even on an Enter/submit attempt; on a config-fetch failure Login resolves into the two-step flow **and submit becomes enabled** (no infinite spinner).
- **Bootstrap end-to-end** (integration): a PIN from the CLI `issue_bootstrap_pin` service logs the operator in via the fresh-server direct-entry login screen (`send_pin_enabled=false`) and lands on the panel (survives the 401 redirect).
- Token threaded into the stats request URL; the stats call uses `skipAuthRedirect: true`.

---

## 10. Unit Boundaries / File Structure

**Backend**
- `models_auth.py` — add `SuperuserPanelToken`.
- `alembic/versions/<rev>_add_superuser_panel_token.py` — migration (`down_revision = "4e17d3637814"`).
- `superuser/__init__.py` — package marker (regular-package convention, matching `api/` and `notifications/`).
- `superuser/service.py` — panel-token service (`mint()` = **delete-existing-then-insert in a single transaction / one commit**; `validate(db, token) -> SuperuserPanelToken | raises` — validates + bumps `last_active_at`, raises 404 on bad/expired, returns the **token row, not a user** (tokens are not user-bound); `destroy_active(db)`) + bootstrap logic returning structured results: `create_or_promote_superuser(db, email) -> User`, `issue_bootstrap_pin(db, email) -> PinIssued|UnknownUser|DisabledUser|RateLimited`, `activate_panel(db) -> ActivateResult(token, url, has_superuser)`. (No `purge_expired` — no background purge; §3.3.)
- `api/superuser.py` — router: `require_superuser_panel` dependency (validates the token via `service.validate` → 404; then resolves the session inline via `auth.validate_session` → 401; then checks `is_superuser` → 404; **returns the `User`** — **not** `Depends(require_superuser)`) + `GET /api/superuser/{token}/stats`.
- `superuser/__main__.py` — interim CLI shim over `service.py` (`create-superuser`, `pin`, `activate`); opens `SessionLocal`; parses args + formats the structured results, no business logic.
- `main.py` — wire `superuser_router` into the `include_router` block (**before** the `/api/{rest:path}` catch-all at `main.py:109`, else the endpoint silently 404s), and attach `Cache-Control: no-store` to the `_spa_fallback` `index.html` response for `/superuser/…` paths.
- `api/auth.py` — (1) add public `GET /api/auth/config` → `{ send_pin_enabled }` (= `settings.debug or settings.email_mode != "disabled"`); (2) in `/request-pin`, **capture** `request_pin`'s return value; when it is a **non-`None`** PIN **and** `not settings.debug`, build a **one-shot mailer** via `build_mailer_from_settings(settings)` (NOT `app.state.mailer` — avoids the dispatcher race + the lifespan-less `AttributeError`, §5) and, if that mailer is not `None`, send a `login_pin` `EmailMessage` synchronously (`with mailer.session(): mailer.send(msg)`); **catch and log send failures server-side (never the raw PIN)** and keep the endpoint response **uniform** `{"message": "PIN sent"}` regardless of send outcome (no enumeration oracle, §5); never persist the raw PIN; (3) wire the logout hook to destroy the active panel token only when the logging-out session's user `is_superuser`.
- `notifications/templates.py` (or a small auth-side helper) — a `login_pin` message builder: a plain `(email, pin) -> EmailMessage` that builds the message via `EmailMessage` (default policy — rejects CR/LF-injected headers, `templates.py:100`, and guard an empty recipient), sets **`To` = the resolved `User.email`** (the normalized address `request_pin` matched) and **`X-Mathion-Kind: login_pin` on the message itself** (the builder is NOT routed through `_build_email_message`, `templates.py:94`, the only current setter of that header). Do **NOT** add it to the `TEMPLATES` dict — those are `RenderContext → (subject, body)` callables consumed by `render()`, a different contract. `FileMailer._allowed_kinds` is a `@functools.cache`d frozenset derived from `TEMPLATES.keys()` (`mailer.py:41-49`); extend the frozenset the method returns to `frozenset(TEMPLATES.keys()) | {"login_pin"}` (in the method body, so the cache seeds with it) so file-mode names the `.eml` `login_pin` rather than `unknown` (cosmetic — the MemoryMailer used by the delivery test in §9 ignores `_allowed_kinds`).
- `schemas.py` — `SuperuserStatsResponse` (+ the `AuthConfigResponse` `{ send_pin_enabled }` shape).

**Frontend**
- `pages/superuser/SuperuserShell.svelte` (route component; renders `SuperuserDashboard` internally), `pages/superuser/SuperuserDashboard.svelte`.
- `lib/superuser.ts` — typed stats wrapper (passes `skipAuthRedirect: true`).
- `routes.ts` + `componentMap` in `App.svelte` — register `SuperuserShell` (`auth: false`); extend `App.svelte`'s `AppHeader` condition to exclude `/superuser/…` paths.
- `pages/Login.svelte` — capture + clear `sessionStorage['superuser_return_path']` **synchronously at init / first line of `onMount`, before any `await`** (precedence over `?next=` at successful verification); fetch `GET /api/auth/config` on mount and **render-gate** (render neither form until it resolves), then when `send_pin_enabled=false` present the combined email+PIN form (skip "Send PIN"), with an `onSubmitEmail` early-return while config is unresolved; show a pending state on "Send PIN" during the synchronous send.
- `lib/auth.svelte.ts` — add `getAuthConfig() -> { send_pin_enabled }` (used by Login); **no `skipAuthRedirect` needed** — the endpoint is public and never 401s, so the flag would be inert (do not rely on it swallowing errors).
- `index.html` — add `<meta name="referrer" content="no-referrer">`.

---

## 11. Future Slices (explicitly deferred)

- **User management** — list/search/create/disable/assign-superuser. When multiple concurrent superusers become possible here, **revisit the unbound-token ↔ any-superuser-logout coupling** (§3.3): with >1 superuser it becomes a cross-superuser self-DoS (B's logout kills A's active panel). Bind the active token to the activating operator, or only destroy it on that operator's logout.
- **Course + admin-assignment UI** — create courses (backend endpoint exists), assign/remove `CourseAdmin`.
- **Settings-as-data** — move SMTP / file-limits / session-durations from `.env` into DB-backed, panel-editable config (architecturally the trickiest — env override precedence, hot-reload).
- **Setup checklist** — first-login: configure SMTP, test email delivery, create first course.
- **Deployment / CLI** — Docker Compose stack + the real `mathion` CLI (`install`, `superuserpin`, `superuser`, `update`, `backup`, `status`, `start`/`stop`), which subsumes the interim `python -m mathion.superuser` verbs. **Deployment must set a real `MATHION_SECRET_KEY` before the first `create-superuser`/`activate`** — panel tokens and PINs are salted with `secret_key` (`auth.py:13`), so any minted under the `"dev-secret-key-change-in-production"` default would silently carry into production.
