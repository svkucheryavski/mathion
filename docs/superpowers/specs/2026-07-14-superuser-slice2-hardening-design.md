# Superuser Panel — Slice 2 (Security Hardening) Design

**Status:** Approved design (2026-07-14)

**Goal:** Close the two security findings deliberately deferred from Superuser Panel Slice 1 (merged `e0da5a4`): the panel token leaking into uvicorn access logs, and the `/request-pin` user-enumeration *timing* oracle.

**Architecture:** Two independent, backend-only changes shipped as one small slice. (1) A `logging.Filter` on the `uvicorn.access` logger redacts the panel token from logged request lines. (2) The one-shot login-PIN email send moves off the `/request-pin` response path into a FastAPI `BackgroundTask`, so response latency no longer depends on whether the email was a real, eligible user.

**Tech Stack:** FastAPI + Starlette + uvicorn 0.44.0 (Python 3.14), SQLAlchemy 2.0. No new dependencies. No database/schema/Alembic changes. No frontend changes.

**Non-goals (deferred / out of scope):**
- Reverse-proxy / non-uvicorn access-log redaction (infra concern; documented as a known limit).
- Constant-time response padding for `/request-pin` (the residual sub-millisecond DB-work delta is not a practical network-observable oracle; explicitly YAGNI).
- Any change to the Slice-1 token model, guard, bootstrap CLI, or panel UI.

---

## Global Constraints

Binding requirements for every task in this slice (copy exact values verbatim into task briefs):

- **Backend only.** No frontend changes. No new runtime dependencies. No DB schema / Alembic migration.
- Backend commands run from `backend/` via the venv, never bare: `.venv/bin/pytest`, `.venv/bin/python` (from repo root: `backend/.venv/bin/...`).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Commit trailer MUST end EXACTLY with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Stage only each task's listed files, by path. Never `git add -A`. Never stage the three pre-existing untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`.
- Preserve every Slice-1 invariant: uniform `/request-pin` response for all outcomes; the raw PIN is never persisted or logged; `send_pin_enabled` honesty; the single-active-token model.

---

## Item #1 — Redact the panel token from uvicorn access logs

### Problem
The panel token is carried in the URL path (`/superuser/{token}` document and `/api/superuser/{token}/stats` API). uvicorn's access logger is on by default and logs the full request line including the path, so the raw token is written to access logs. The Slice-1 protections (no-referrer meta, `no-store`) do not touch server-side logs.

### Grounding (verified against the installed uvicorn 0.44.0)
- The access logger is named `uvicorn.access`.
- Each access record's `record.args` is the 5-tuple `(client_addr, method, full_path, http_version, status_code)`. `uvicorn/logging.py:AccessFormatter.formatMessage` unpacks exactly this order; `full_path` (index 2) is the path-with-query-string and is where the token appears.
- Formatting happens *after* filtering, so a filter that mutates `record.args` before the record is formatted cleanly redacts the emitted line.

### Design
New focused module `backend/mathion/superuser/log_redaction.py`:

- `_PANEL_TOKEN_RE = re.compile(r"^(/(?:api/)?superuser/)[^/?]+")` — matches `/superuser/<token>` and `/api/superuser/<token>...`, capturing the route prefix in group 1 and consuming the token segment (stops at the next `/` or `?`, so trailing path like `/stats` and any query string are preserved). `/superuser` alone and `/superuserfoo` do NOT match (the trailing `/` is required), mirroring the Slice-1 `_panel_cache_headers` prefix rule.
- `redact_panel_path(path: str) -> str` — returns `_PANEL_TOKEN_RE.sub(r"\1[redacted]", path)`. Pure function, unit-testable in isolation.
- `class PanelAccessLogFilter(logging.Filter)` with:
  ```
  def filter(self, record):
      args = record.args
      if isinstance(args, tuple) and len(args) == 5:
          path = args[2]
          if isinstance(path, str):
              redacted = redact_panel_path(path)
              if redacted != path:
                  record.args = (args[0], args[1], redacted, args[3], args[4])
      return True
  ```
  It **always returns `True`** (never drops a record) and **never raises** — any record whose `args` is not the expected 5-tuple (other loggers, custom records) passes through untouched. A throwing filter would break logging, so the shape checks are mandatory, not defensive niceties.
- `def install() -> None` — idempotently attaches the filter to the `uvicorn.access` logger: fetch `logging.getLogger("uvicorn.access")`; if it has no `PanelAccessLogFilter` already attached, `addFilter(PanelAccessLogFilter())`. Idempotency guards against double-install when multiple app instances are created in a test process. (Even without the guard the redaction is idempotent — re-running it on an already-redacted path is a no-op — but avoiding duplicate filters keeps the logger clean.)

Wiring: call `install()` once from the existing `main.py` lifespan **startup** (before/alongside the notifications dispatcher setup). Lifespan runs after uvicorn has configured its logging, so the `uvicorn.access` logger already exists when we attach.

### Redaction examples
| Logged path | After filter |
|---|---|
| `/superuser/SECRET` | `/superuser/[redacted]` |
| `/api/superuser/SECRET/stats` | `/api/superuser/[redacted]/stats` |
| `/api/superuser/SECRET/stats?x=1` | `/api/superuser/[redacted]/stats?x=1` |
| `/superuserfoo` | `/superuserfoo` (unchanged) |
| `/api/courses/abc-123` | `/api/courses/abc-123` (unchanged) |

### Known limit (documented)
This covers the `uvicorn.access` logger only. A deployment behind a reverse proxy (nginx, etc.) or on a non-uvicorn server must redact those access logs separately — out of application scope.

### Testing (`backend/tests/test_panel_log_redaction.py`, new)
- `redact_panel_path` / filter redacts the document and API panel paths (assert the token string is absent, the prefix + trailing path + query are preserved).
- Non-panel paths (`/api/courses/abc`, `/superuserfoo`, `/`) pass through unchanged.
- A record with `args=None` and a wrong-length tuple pass through without raising and unchanged.
- The filter always returns `True`.
- `install()` attaches exactly one `PanelAccessLogFilter` to `uvicorn.access` and is idempotent on a second call.

---

## Item #2 — Move the `/request-pin` PIN send off the response path

### Problem
`POST /api/auth/request-pin` returns a uniform body/status for all outcomes, but the response *latency* leaks user existence: a real, enabled, non-rate-limited user triggers a synchronous mailer build + SMTP send (the `SMTPMailer` session uses a 30 s timeout) on the response path, while an unknown / disabled / rate-limited email returns immediately (`request_pin` returns `None`, no send). Under real SMTP an attacker can distinguish registered eligible users by timing. (The status/body enumeration oracle was the Slice-1 Task-5 CRITICAL and is already fixed; this is the residual *timing* channel.)

### Design
In `backend/mathion/api/auth.py`:

- Extract today's inline send into a module-level helper:
  ```
  def _send_login_pin(email: str, raw_pin: str) -> None:
      try:
          mailer = build_mailer_from_settings(settings)
          if mailer is not None:
              msg = build_login_pin_message(email, raw_pin)
              with mailer.session():
                  mailer.send(msg)
      except Exception:
          logger.exception("login PIN email send failed")  # static message; never the raw PIN
  ```
  This is byte-for-byte the current behaviour (one-shot mailer, best-effort, log-on-failure, never the raw PIN in the log), just relocated.
- The handler gains a `BackgroundTasks` parameter and schedules the send instead of running it inline:
  ```
  def api_request_pin(request, data, background_tasks: BackgroundTasks, db=Depends(get_db)):
      _require_csrf(request)
      raw_pin = request_pin(db, data.email)
      if raw_pin is not None and not settings.debug:
          background_tasks.add_task(_send_login_pin, data.email.strip().lower(), raw_pin)
      return {"message": "PIN sent"}
  ```
- FastAPI runs the **sync** `_send_login_pin` in its threadpool **after** the response has been sent, so: (a) the client's observed latency is uniform across unknown / disabled / real / rate-limited outcomes; (b) blocking `smtplib` never blocks the event loop.

### Invariants preserved (unchanged from Slice 1)
- Uniform response `{"message": "PIN sent"}` for every outcome.
- The raw PIN is never persisted — it is passed in-memory to the background task and discarded after send.
- `not settings.debug` still gates the send: in debug there is no send (the PIN is printed to the console by `request_pin`), so debug timing is already uniform.
- Best-effort, no retry (matching today). A background-send failure is logged via the helper's `try/except` and does not affect the already-sent response.

### Residual channel (accepted, documented)
A real, eligible user still performs slightly more on-path DB work (`request_pin` does an extra rate-limit `SELECT` + PIN `INSERT` + `commit`) than an unknown email (one `SELECT`, return). This is a sub-millisecond delta and not a practical network-observable oracle; equalizing it (constant-time padding) is explicitly out of scope.

### Testing (`backend/tests/test_login_pin_delivery.py`, extend)
- **Off-path scheduling (the key new regression):** assert the send is *scheduled on `BackgroundTasks`, not executed inline*. Direct-call `api_request_pin` with a real `BackgroundTasks()` instance (and a stubbed CSRF-valid `Request` + db) and assert `background_tasks.tasks` holds exactly one task bound to `_send_login_pin` with `(normalized_email, raw_pin)` for an eligible user, and is **empty** for an unknown email, a disabled user, and debug mode.
- **Behaviour preserved (keep/extend existing):** the send actually happens for an eligible user (via a memory/stub mailer, exercised through the background task) and does not happen for unknown / disabled / rate-limited; the response body/status is uniform in every case; a mailer-build failure still yields a uniform response and is logged, not raised.

---

## Files touched
- **New:** `backend/mathion/superuser/log_redaction.py`
- **New:** `backend/tests/test_panel_log_redaction.py`
- **Edit:** `backend/mathion/main.py` — call `log_redaction.install()` in lifespan startup.
- **Edit:** `backend/mathion/api/auth.py` — `_send_login_pin` helper + `BackgroundTasks` scheduling in `api_request_pin`.
- **Edit:** `backend/tests/test_login_pin_delivery.py` — off-path scheduling test + behaviour-preserved coverage.

## Success criteria
- **#1:** An access-log record for any panel path never contains the raw token; non-panel paths are logged unchanged; a malformed record never crashes logging; `install()` attaches the filter to `uvicorn.access`.
- **#2:** The PIN send is scheduled as a background task, so `/request-pin` response latency is independent of whether the email is a real, eligible user; every Slice-1 `/request-pin` invariant (uniform response, PIN never persisted/logged, debug short-circuit, best-effort) still holds.
