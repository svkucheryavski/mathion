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
- Panel token service (mint / validate / purge) + `require_superuser_panel` dependency.
- `GET /api/superuser/{token}/stats` endpoint + response schema.
- Interim `python -m mathion.superuser` command group (`create-superuser`, `pin`, `activate`).
- Logout hook that destroys the active panel token; periodic-cleanup purge of expired tokens.
- Frontend `/superuser/:token` area: shell + dashboard + guard handling.

**Out of scope (later slices)** — user management; course/admin-assignment UI; settings-as-data (env→DB); setup checklist; the real `mathion` CLI + Docker deployment.

---

## 3. Access & Authentication Model

### 3.1 Token
- A single active panel token at a time. Generated with `secrets.token_urlsafe(32)` (≥43 URL-safe chars). Only its **hash** is stored (same hashing scheme used for session tokens in `auth.py`); the plaintext is shown once, by the activator.
- `activate` deletes any existing token row before inserting the new one — minting a new token invalidates the old URL.

### 3.2 `require_superuser_panel` dependency (guards every panel route)
Layered failure codes, chosen so the panel is not revealed to the wrong caller. **Checks run in this order** (so a bad token never leaks that a session/role would have mattered): (1) token → (2) session presence → (3) superuser role.

| Step | Condition | Result |
|------|-----------|--------|
| 1 | Token absent / wrong / expired | **404** — the URL simply does not exist |
| 2 | Token valid, but no authenticated session | **401** — log in first |
| 3 | Token valid, authenticated, but **not** a superuser | **404** — do not reveal to normal users |
| — | Token valid + authenticated superuser session | **200** — proceed |

On success, enforce the **30-minute sliding inactivity window**: if `now − last_active_at > 30 min`, delete the row and return 404; otherwise bump `last_active_at` (throttled write, mirroring the session `last_active_at` pattern in `auth.py:148`).

### 3.3 Lifecycle
- **Manual superuser logout** (`api/auth.py:86`) deletes the active panel token.
- The existing periodic session-cleanup task also purges expired panel tokens.
- The token is **not** bound to a specific user — access is "valid token **+** any authenticated superuser session," per platform §8.

### 3.4 CSRF / transport
Panel API calls reuse the existing auth cookie (`SameSite=Lax`) + `X-Requested-With` header already enforced app-wide. The token-in-URL model is per platform §8 (32-char URL-safe, hashed at rest, short inactivity window, superuser-session-gated, destroyed on logout).

---

## 4. Data Model

New table `superuser_panel_tokens` (model in `models_auth.py`, the auth-domain module):

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `token_hash` | `String(64)`, unique, indexed | sha256 hex of the URL-safe token — mirrors `Session.token_hash`; plaintext never stored |
| `created_at` | datetime (tz) | server default now |
| `last_active_at` | datetime (tz) | sliding 30-min inactivity window |

Alembic migration adds the table (down_revision = current head). At most one row exists in practice (`activate` replaces), but no DB-level singleton constraint is imposed — the service enforces "delete-then-insert."

---

## 5. Backend API

`GET /api/superuser/{token}/stats` — gated by `require_superuser_panel`. Token in the path keeps validation uniform with the page route.

Response `SuperuserStatsResponse`:

| Field | Definition |
|-------|-----------|
| `total_users` | `count(User)` |
| `total_courses` | `count(Course)` |
| `storage_bytes` | `coalesce(sum(Asset.file_size),0) + coalesce(sum(RunAsset.file_size),0)` (user photos excluded — negligible, not registry-tracked) |
| `active_users_24h` | distinct `Session.user_id` with `last_active_at ≥ now − 24h` |
| `active_users_7d` | distinct `Session.user_id` with `last_active_at ≥ now − 7d` |

All plain aggregate queries; no N+1. Empty DB → zeros.

---

## 6. Interim Bootstrap CLI — `python -m mathion.superuser`

A small `argparse` command group in `backend/mathion/superuser/__main__.py`. Each verb is a forward-compatible stand-in for a future `mathion` CLI verb (the CLI will call the same underlying functions — zero behavior change):

| Verb | Behavior | Future CLI verb |
|------|----------|-----------------|
| `create-superuser <email>` | Create the user if absent, or promote an existing one (`is_superuser=True`). Idempotent. Prints confirmation. | part of `mathion install` |
| `pin <email>` | Call `auth.request_pin(db, email)` and print the raw PIN. Errors clearly if the email is unknown or rate-limited (`None`). | `mathion superuserpin` |
| `activate` | Replace the active panel token; print `{base_url}/superuser/{token}`. Independent of any specific user. | `mathion superuser` |

The three verbs together make the panel reachable and testable end-to-end without email configured: create/promote a superuser → mint a login PIN → mint the panel URL.

---

## 7. Frontend

New SPA area at `/superuser/:token` (nested index = Dashboard), wired into `lib/router.svelte.ts` / `App.svelte`.

- **`SuperuserShell.svelte`** — panel chrome + minimal nav (only **Dashboard** now; nav grows in later slices) + a sign-out action (hits the existing logout). Reuses the app auth/session.
- **`SuperuserDashboard.svelte`** — on mount fetches stats via `lib/superuser.ts`, renders five stat cards (Users, Courses, Storage via `formatFileSize`, Active 24h, Active 7d) with loading + error states. Stats are numeric — no `@html`.
- **`lib/superuser.ts`** — typed `getSuperuserStats(token)` wrapper over the existing api client, calling `/api/superuser/${token}/stats`.

**Guard handling in the SPA:**
- **404** from the panel (bad/expired token, or non-superuser) → render NotFound (do not reveal the panel).
- **401** (valid token, no session) → redirect to Login with a return path back to the panel URL.

---

## 8. Error Handling (consolidated)

- Guard failure codes as in §3.2.
- Inactivity expiry checked per request (delete + 404); periodic cleanup also purges expired tokens.
- Manual superuser logout deletes the active panel token.
- CLI: `create-superuser` idempotent (create or promote); `pin` errors clearly on unknown/rate-limited email; `activate` replaces the prior token atomically.
- Stats endpoint is read-only; empty DB coalesces to zeros.

---

## 9. Testing

**Backend**
- Token: `activate` stores only the hash; wrong/absent token → 404; single-active-token replacement (old token 404s after re-activate).
- Two-factor matrix: valid + superuser session → 200; valid + no session → 401; valid + non-superuser session → 404; bad token + superuser session → 404.
- 30-min expiry: a token last-active >30 min ago is deleted and 404s; a request inside the window bumps `last_active_at`.
- Logout destroys the active panel token.
- Stats correctness: counts; `storage_bytes` sums course + run assets; active-window boundary users (just inside vs. just outside 24h / 7d).
- CLI verbs: `create-superuser` creates and (idempotently) promotes; `pin` returns a PIN that `verify_pin` accepts; `activate` prints a URL whose token validates and supersedes a prior one.

**Frontend** (mount/unmount/flushSync, Svelte 5 runes; no `@testing-library`)
- Shell renders nav + sign-out.
- Dashboard fetches + renders the five cards; loading + error states; storage formatted.
- 404 → NotFound; 401 → redirect to Login with a return path.
- Token threaded into the stats request URL.

---

## 10. Unit Boundaries / File Structure

**Backend**
- `models_auth.py` — add `SuperuserPanelToken`.
- `alembic/versions/<rev>_add_superuser_panel_token.py` — migration.
- `superuser_token.py` (or a section of a new `superuser/` package) — token service: `mint()`, `validate(token) -> None | raises`, `purge_expired()`, `destroy_active()`.
- `api/superuser.py` — router: `require_superuser_panel` dependency + `GET /api/superuser/{token}/stats`.
- `superuser/__main__.py` — interim CLI (`create-superuser`, `pin`, `activate`).
- Logout hook wiring in `api/auth.py` (destroy active token on superuser logout) + purge in the periodic cleanup task.
- `schemas.py` — `SuperuserStatsResponse`.

**Frontend**
- `pages/superuser/SuperuserShell.svelte`, `pages/superuser/SuperuserDashboard.svelte`.
- `lib/superuser.ts` — typed stats wrapper.
- Route wiring in `lib/router.svelte.ts` / `App.svelte`.

---

## 11. Future Slices (explicitly deferred)

- **User management** — list/search/create/disable/assign-superuser.
- **Course + admin-assignment UI** — create courses (backend endpoint exists), assign/remove `CourseAdmin`.
- **Settings-as-data** — move SMTP / file-limits / session-durations from `.env` into DB-backed, panel-editable config (architecturally the trickiest — env override precedence, hot-reload).
- **Setup checklist** — first-login: configure SMTP, test email delivery, create first course.
- **Deployment / CLI** — Docker Compose stack + the real `mathion` CLI (`install`, `superuserpin`, `superuser`, `update`, `backup`, `status`, `start`/`stop`), which subsumes the interim `python -m mathion.superuser` verbs.
