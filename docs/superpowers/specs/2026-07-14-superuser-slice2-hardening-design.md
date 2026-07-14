# Superuser Panel — Slice 2 (Security Hardening) Design

**Status:** Approved design (2026-07-14); converged after eight spec-review rounds (32 Opus-xhigh reviewers total) plus two codex passes. The first codex pass incorporated 4 Important + 1 Minor (import-time install closing the `--lifespan off` bypass; strengthened off-path proof; scoped PIN-persistence invariant; honest residual-timing framing; corrected `--log-config` wording). Round 7 (4 reviewers) fixed 1 Important + 1 Minor: the install-wiring sub-test was scoped so the strip fixture no longer defeats its live-logger presence assertion, and the install-timing prose was made precise about the dev-only reversed ordering (safe via `dictConfig(disable_existing_loggers=False)` preserving the attached filter). Round 8 (3 reviewers) + a final gate reviewer verified both fixes — all APPROVE. A final codex pass over the converged spec found nothing blocking; its two Minor wording narrowings are incorporated (success criterion #1 scoped to the filter's fail-open guarantee rather than uvicorn's formatter; `config.load()` timing made precise for the pre-imported-object case).

**Goal:** Address the two security findings deliberately deferred from Superuser Panel Slice 1 (merged `e0da5a4`): **close** the panel-token leak into uvicorn access logs (full redaction), and **mitigate** the `/request-pin` user-enumeration *timing* oracle by removing its dominant, network-observable tier (the SMTP send). Item #2 reduces — does not claim to fully eliminate — the timing channel; a smaller residual DB-work delta remains, accepted and documented below.

**Architecture:** Two independent, backend-only changes shipped as one small slice. (1) A `logging.Filter` on the `uvicorn.access` logger redacts the panel token from logged request lines. (2) The one-shot login-PIN email send moves off the `/request-pin` response path — scheduled via FastAPI `BackgroundTasks.add_task` and run after the response is sent — so the send no longer runs on the response path.

**Tech Stack:** FastAPI 0.136.0 + Starlette 1.0.0 + uvicorn 0.44.0 (Python 3.14), SQLAlchemy 2.0. No new dependencies. No database/schema/Alembic changes. No frontend changes.

**Non-goals (deferred / out of scope):**
- Access-log redaction *outside* the `uvicorn.access` logger — a reverse proxy's own access logs, a non-uvicorn ASGI server, a custom `--log-config` / `--no-access-log`, or a `root_path` URL prefix (infra concerns; documented precisely under Item #1 "Known limits", which distinguishes the true-no-op cases from the filter-runs-but-under-covers cases).
- Constant-time response padding for `/request-pin` (the residual on-path DB-work delta is small and local — a few queries + one SQLite `commit()` — and judged not worth equalizing on the current single-node deployment; explicitly YAGNI — see "Residual channel").
- Any change to the Slice-1 token model, guard, bootstrap CLI, or panel UI.

---

## Global Constraints

Binding requirements for every task in this slice (copy exact values verbatim into task briefs):

- **Backend only.** No frontend changes. No new runtime dependencies. No DB schema / Alembic migration.
- Backend commands run from `backend/` via the venv, never bare: `.venv/bin/pytest`, `.venv/bin/python` (from repo root: `backend/.venv/bin/...`).
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Commit trailer MUST end EXACTLY with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Stage only each task's listed files, by path. Never `git add -A`. Never stage the three pre-existing untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`.
- Preserve every Slice-1 invariant: uniform `/request-pin` response for all outcomes; the raw PIN is never written to the auth DB or the notification log, and never emitted to non-debug logging (the `FileMailer` `.eml` sink under `email_mode=file` and the `settings.debug` stdout print are intentional dev/test delivery facilities, out of scope for this invariant — and unchanged by this slice); `send_pin_enabled` honesty; the single-active-token model.

---

## Item #1 — Redact the panel token from uvicorn access logs

### Problem
The panel token is carried in the URL path (`/superuser/{token}` document and `/api/superuser/{token}/stats` API). uvicorn's access logger is on by default and logs the full request line including the path, so the raw token is written to access logs. The Slice-1 protections (no-referrer meta, `no-store`) do not touch server-side logs.

### Grounding (verified against installed uvicorn 0.44.0 / Starlette 1.0.0)
- The access logger is named `uvicorn.access` (`uvicorn/protocols/http/{h11_impl,httptools_impl}.py`, `config.py`).
- Each access record's `record.args` is the 5-tuple `(client_addr, method, full_path, http_version, status_code)`; `uvicorn/logging.py:AccessFormatter.formatMessage` unpacks exactly this order. `full_path` (index 2) is the path-with-query-string and is where the token appears. The access line is emitted on **every** status (200/401/404/4xx/5xx) via the same call, so guard-exception panel requests are redacted identically to a 200.
- Formatting happens *after* filtering (stdlib `logging` contract), so a filter that mutates `record.args` before the record is formatted cleanly redacts the emitted line.
- uvicorn logs the path via `urllib.parse.quote`. The panel prefixes contain no chars that get encoded, and the token alphabet is `secrets.token_urlsafe` (`A–Za–z0–9_-`, no `/` or `?`), so `[^/?]+` consumes the whole real token whether or not any char is percent-encoded.
- **`record.args` contract is verified-by-inspection against uvicorn 0.44.0, not enforced by the runtime.** A future uvicorn that changed the tuple shape/order is a known blind spot. The integration test below builds a `makeRecord` replica frozen at this shape, so it guards *our* filter+formatter pipeline but does **not** auto-detect such a future change (it never invokes uvicorn's emission code); the contract remains inspection-verified.

### Design
New focused module `backend/mathion/superuser/log_redaction.py`:

- `_PANEL_TOKEN_RE = re.compile(r"^(/(?:api/)?superuser/)[^/?]+")` — matches `/superuser/<token>` and `/api/superuser/<token>...`, capturing the route prefix in group 1 and consuming the token segment (stops at the next `/` or `?`, so a trailing path like `/stats` and any query string are preserved). `/superuser` (bare) and `/superuserfoo` do NOT match (the trailing `/` is required); `/superuser/` (empty token) does NOT match either (`[^/?]+` requires ≥1 char) — correct, because there is no token to redact.
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
  It **always returns `True`** (never drops a record) and **never raises** — any record whose `args` is not the expected 5-tuple passes through untouched (fail-open on redaction). The guard is deliberately `isinstance(args, tuple)`, **not** `Sequence`: a `str` is a `Sequence`, and widening the check would risk catching/corrupting string args. Do not broaden it.
- `def install() -> None` — idempotently attaches the filter to the `uvicorn.access` logger: get `logging.getLogger("uvicorn.access")`; if none of its existing `.filters` is a `PanelAccessLogFilter` (iterate + `isinstance`), `addFilter(PanelAccessLogFilter())`. Idempotency guards double-install when multiple app instances are created in one test process, and must leave any unrelated pre-existing filter in place.

Wiring: call `install()` at **module-import time in `main.py`** (top level, not inside the lifespan) — `from mathion.superuser.log_redaction import install` then `install()`. Keep the call in `main.py` (not at `log_redaction.py` module level), so importing `log_redaction` for its pure functions in unit tests does **not** mutate the global logger; and keep `mathion/superuser/__init__.py` from eagerly importing `log_redaction` in a way that pulls panel-service/DB modules into `main.py`'s import graph.

**Install timing / robustness (verified):** uvicorn calls `Config.configure_logging()` (which runs `dictConfig`) in `Config.__init__` — *before* the app module is loaded for the normal **string-app** launch (`uvicorn mathion.main:app` / `uvicorn.run("mathion.main:app")`, i.e. every production mode) — and re-runs it in the `--reload`/worker subprocess before loading the app there too. uvicorn **always** calls `config.load()` to serve, regardless of the `--lifespan` setting: for a string app (every production mode) that imports the app module, running its top-level `install()`; for a pre-imported app object, `config.load()`/`import_from_string` just returns the already-imported object, whose module (hence `install()`) ran when the caller imported it. Either way the app module has executed by the time uvicorn serves. So installing at `main.py` **import time** runs after `configure_logging()` (never wiped), in every process (single / `--workers N` / `--reload` child), and — crucially — under **every `--lifespan` mode**. (In any ordering where import-time `install()` would run *before* `configure_logging()` — e.g. the dev-only **pre-imported app object** `uvicorn.run(app_object)`, which uvicorn forbids alongside reload/workers — it is still safe, because uvicorn's `dictConfig` runs with `disable_existing_loggers: False`, which replaces handlers but **preserves an already-attached filter** — verified empirically. The safety argument holds for every reversed ordering, not just this one launch mode.) This is why import-time install is chosen over lifespan-startup install: `uvicorn --lifespan off` makes `LifespanOff.startup()` a no-op (verified: its body is literally `pass`), so a *lifespan*-installed filter would never run while `uvicorn.access` still emits — a silent redaction bypass. Import-time install closes that gap; a lifespan-startup install would leave it open.

### Redaction examples
| Logged path | After filter |
|---|---|
| `/superuser/tok-EN_abc` (URL-safe token) | `/superuser/[redacted]` |
| `/superuser/SECRET/` (trailing slash) | `/superuser/[redacted]/` |
| `/api/superuser/SECRET/stats` | `/api/superuser/[redacted]/stats` |
| `/api/superuser/SECRET/stats?x=1` | `/api/superuser/[redacted]/stats?x=1` |
| `/superuser/` (empty token) | `/superuser/` (unchanged — no token) |
| `/superuserfoo` | `/superuserfoo` (unchanged) |
| `/api/courses/abc-123` | `/api/courses/abc-123` (unchanged) |

Redaction is **method-agnostic** — it keys on `args[2]` (the path), not the method, so GET / HEAD / OPTIONS on a panel route are all redacted. The token appears only in the **path**, never the query string; query strings are preserved verbatim and are assumed token-free.

### Known limits (documented; this spec is the record for these — no separate runbook file in scope)
- Covers the `uvicorn.access` logger only, and only for paths that begin at the panel prefix. Two distinct out-of-scope cases — do not conflate them:
  - **`install()` is a true no-op** only when nothing is emitted through the `uvicorn.access` logger at all: a **non-uvicorn ASGI server** (no such logger), `--no-access-log`, or a custom `--log-config` that *silences* `uvicorn.access` (raises its level or disables it so it emits nothing). Note the filter is attached at the **logger** level, so it runs in `Logger.handle()` regardless of which handlers/formatters a `--log-config` sets — you cannot "rename" uvicorn's hard-coded `getLogger("uvicorn.access")`, and merely changing its handlers or formatting does **not** defeat redaction; only silencing the logger does. In the no-op case the filter attaches to a logger that produces no records — harmless, never crashes, and no token leaks *via that logger* (any other server logs elsewhere, separately).
  - **The filter runs but does not cover** two cases where `uvicorn.access` *does* emit: (a) a **reverse proxy's own access logs** (nginx, etc.) are a separate log our filter cannot reach — uvicorn's own access line is still redacted correctly, but the proxy must redact its log itself; (b) a **`root_path` URL prefix** makes the logged path e.g. `/app/superuser/<token>`, and since `_PANEL_TOKEN_RE` is `^`-anchored to `/superuser` / `/api/superuser` it under-matches and the token leaks. uvicorn logs `scope["path"]` = `config.root_path + path`, so the prefix is governed by **uvicorn's own `Config.root_path`** (settable via the `--root-path` CLI flag or `uvicorn.run(root_path=...)`) — **not** by a FastAPI app-level `root_path=`, which sets only `scope["root_path"]` and leaves `scope["path"]` (hence the logged line) unprefixed (verified against FastAPI 0.136.0: `FastAPI.__call__` does `if self.root_path: scope["root_path"] = self.root_path` and never touches `scope["path"]`). The other way a prefixed path reaches uvicorn's own logged line is a path-preserving reverse proxy that forwards an already-prefixed request target (so `scope["path"]` itself carries the prefix) — the same under-match as the `root_path` case, **not** the separate-log case (a). The current build sets no uvicorn `root_path` (`main.py` constructs `FastAPI(...)` without `root_path`, and no run script passes `--root-path`), so the logged path always starts at the panel prefix; a future uvicorn-level `root_path` (or a prefix-forwarding proxy) would require widening the anchor.
- Redaction is **unconditional**: it applies in both debug and production and is independent of the separate debug-mode stdout PIN print in `request_pin` (`auth.py`), which is itself a dev-only facility (`settings.debug` "MUST be off in production").
- The `record.args` tuple contract is verified against uvicorn 0.44.0 by inspection; the integration test below exercises our filter+formatter against that shape but uses a hardcoded `makeRecord` replica, so a future uvicorn that changes the tuple is a known blind spot the integration test does **not** surface (that would need an end-to-end request through a live uvicorn).

### Testing (`backend/tests/test_panel_log_redaction.py`, new)
- **Unit — `redact_panel_path` / filter:** every redaction-example row above (assert the token string is absent and the prefix + trailing path + query preserved), including a real `token_urlsafe`-shaped token with `-`/`_`, the trailing-slash case, and the empty-token/`/superuserfoo`/non-panel pass-throughs. These are non-vacuous (without the `.sub`, the token remains, so the assertions fail).
- **Unit — filter robustness:** `args=None` and a wrong-length tuple pass through unchanged without raising; the filter always returns `True`; a HEAD-method record is redacted like any other (redaction keys on `args[2]`, not the method).
- **Integration — exercise the current tuple shape through uvicorn's real formatter:** build a real record via `logging.getLogger("uvicorn.access").makeRecord(name, level, fn, lno, msg, args, None)`, passing uvicorn's actual access template as `msg` and the real 5-tuple as `args`:
  - `msg = '%s - "%s %s HTTP/%s" %d'` (uvicorn's exact access format string)
  - `args = ("127.0.0.1:0", "GET", "/api/superuser/SECRET/stats", "1.1", 200)` (concrete values, matching the worked example below)

  `makeRecord` notes: `exc_info` is a required positional (pass `None`); `args[4]` (status) must be int-coercible (use `200`, since `AccessFormatter` calls `int(status_code)`); and `msg` **must** be that exact 5-placeholder template, because `.format()` always runs `record.getMessage()` (= `msg % args`) *first* — an empty or non-matching `msg` raises `TypeError`/`ValueError` before any assertion. Run the record through the filter, then format it through a **`request_line`-based `AccessFormatter`** and assert the token is absent:
  ```
  fmt = AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False)
  PanelAccessLogFilter().filter(record)
  out = fmt.format(record)
  assert "SECRET" not in out and "[redacted]" in out
  ```
  Use this `request_line` format string, **not** the bare default `AccessFormatter()`: under the default `_fmt='%(message)s'`, `.format()` collapses to `record.getMessage()` == `msg % args` and uvicorn's positionally-unpacked `request_line` is discarded — so the default formatter adds nothing over `getMessage()`. The `request_line` format routes the filter-redacted `full_path` (`args[2]`) through `AccessFormatter.formatMessage`'s real unpack→`request_line` path, i.e. the same path production uses (the trailing `200 OK` status text confirms `formatMessage` ran). Do **not** call `AccessFormatter().formatMessage(record)` directly on a fresh record: it raises `ValueError: Formatting field not found in record: 'message'` (`record.message` is populated only by `format()`) — verified empirically against uvicorn 0.44.0.

  **What this proves — and does not.** Non-vacuous for *our* code: the same record without the filter, or with the filter redacting the wrong index, formats with `SECRET` present (verified: a wrong-index bug leaves the request line `GET /api/superuser/SECRET/stats` — `SECRET` present, no `[redacted]` — since `redact_panel_path` applied to a non-path arg is a no-op), so the assertion's `"SECRET" not in out` / `"[redacted]" in out` clauses fail — it guards `PanelAccessLogFilter` + `redact_panel_path` against regressions, rendered through uvicorn's real formatter. It does **not** auto-detect a *future* uvicorn tuple-shape/reorder change: `makeRecord` never invokes uvicorn's emission code, so `msg`/`args` are a hardcoded replica frozen at uvicorn 0.44.0's shape — a future reorder would leave this test green. The `record.args` contract therefore stays **verified-by-inspection** (see Grounding); a genuine runtime tripwire would require an end-to-end request through a live uvicorn, out of scope. (That `install()` targets the correct logger *name* is proven separately by the install-wiring test below, not here.)
- **Install wiring** — two sub-tests, and only **(a)** mutates the process-global `uvicorn.access` logger, so wrap **(a) alone** in a fixture that snapshots `logging.getLogger("uvicorn.access").filters` (a list copy) at setup, **removes any pre-existing `PanelAccessLogFilter` instances** so it starts genuinely clean, and restores the snapshot in teardown so nothing leaks onward. (Because `install()` runs at `main.py` **import time** and `conftest.py` imports `mathion.main` at collection, a `PanelAccessLogFilter` is already present process-globally before any test in this file runs — hence the strip.) **(a) idempotency:** after the strip, add an unrelated filter, call `install()` twice, assert exactly one `PanelAccessLogFilter` is present and the unrelated one survives (the exact-count assertion is safe because setup stripped any pre-existing panel filter, and `install()` is idempotent regardless). **(b) import wiring:** assert **presence** on the **live** logger, **without** the strip fixture — `any(isinstance(f, PanelAccessLogFilter) for f in logging.getLogger("uvicorn.access").filters)`. This observes the ambient `install()` that already ran when `mathion.main` was imported; a re-`import mathion.main` inside the test is a cached no-op that does **not** re-install, which is exactly why (b) must **not** be wrapped by the strip fixture — stripping would remove the very filter (b) checks for, and the cached import would not put it back (the round-7 test review caught this). (b) is read-only (no teardown needed) and robust to run-order relative to (a): (a)'s teardown restores its snapshot, which carried the panel filter (conftest imported `main` pre-collection), so the filter is present whether (b) runs before or after (a). Non-vacuous: a wrong logger *name* in `install()`, or a missing `install()` call in `main.py`, makes the presence assertion `False`. This is the check that closes the "wired at app import, for every `--lifespan` mode" link otherwise only asserted by inspection.

---

## Item #2 — Move the `/request-pin` PIN send off the response path

### Problem
`POST /api/auth/request-pin` returns a uniform body/status for all outcomes, but the send currently runs **on the response path**: a real, enabled, non-rate-limited user triggers a synchronous mailer build + SMTP send (the `SMTPMailer` session uses a 30 s timeout) inline, while an unknown / disabled / rate-limited email returns immediately (`request_pin` returns `None`, no send). Under real SMTP an attacker can distinguish registered eligible users by response *latency*. (The status/body enumeration oracle was the Slice-1 Task-5 CRITICAL and is already fixed; this is the residual *timing* channel.)

### Design
In `backend/mathion/api/auth.py`:

- Extract today's inline send into a module-level helper (byte-for-byte the current behaviour — one-shot mailer, best-effort, log-on-failure, never the raw PIN in the log):
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
- The handler gains a `BackgroundTasks` parameter and schedules the send instead of running it inline:
  ```
  def api_request_pin(request: Request, data: PinRequestSchema,
                      background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
      _require_csrf(request)
      raw_pin = request_pin(db, data.email)
      if raw_pin is not None and not settings.debug:
          # data.email is already stripped+lowercased by PinRequestSchema.normalize_email;
          # the .strip().lower() here is belt-and-suspenders (a no-op post-schema).
          background_tasks.add_task(_send_login_pin, data.email.strip().lower(), raw_pin)
      return {"message": "PIN sent"}
  ```
  (Param order is valid Python — `background_tasks` has no default and precedes the defaulted `db`; FastAPI injects `BackgroundTasks` by type.) Add `BackgroundTasks` to the `fastapi` import — `auth.py` currently imports `from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response`, so append `BackgroundTasks`.
- FastAPI runs the **sync** `_send_login_pin` in its threadpool (`run_in_threadpool`, a pool separate from the notifications dispatcher's `asyncio.to_thread` pool) **after** the response body is sent (Starlette `Response.__call__` awaits `self.background()` after the body), so blocking `smtplib` neither runs on the response path nor blocks the event loop.

### Invariants preserved (unchanged from Slice 1)
- Uniform response `{"message": "PIN sent"}` for every outcome.
- This change adds no new PIN-persistence path: the raw PIN is passed in-memory to the background task and discarded after send, never written to the auth DB or notification log. (The pre-existing dev/test sinks — the `FileMailer` `.eml` file under `email_mode=file`, and the `settings.debug` stdout print inside `request_pin` — write the PIN by design; they are out of scope and untouched here.)
- `not settings.debug` still gates the send. Note: in debug, `request_pin` still **returns a real PIN** (it only *also* prints it to the console); it is the handler's `not settings.debug` gate — not a `request_pin` short-circuit — that suppresses scheduling. The debug stdout print stays inside `request_pin`, so no new PIN-to-stdout path is introduced.
- Best-effort, no retry (matching today).

### Error boundary (changed — state explicitly)
After the move, `_send_login_pin`'s own `try/except` is the **sole** error boundary; the handler no longer wraps the send. A send/build exception is caught inside the task and never reaches the already-sent response. This is load-bearing: `test_send_failure_stays_uniform` (a mailer whose `send` raises) and `test_mailer_build_failure_stays_uniform` (a `build_mailer_from_settings` that raises) pass after the move only because the exception is caught in `_send_login_pin` — an *uncaught* background exception would propagate out of the response cycle and (under `TestClient`, which runs the task in-request with `raise_server_exceptions=True`) surface as a test error instead of a uniform 200.

### Residual channel (accepted, documented accurately)
Moving the send off-path removes the dominant, network-observable timing tier (the up-to-30 s SMTP send). A smaller on-path (pre-response) DB-work delta remains, and it is **multi-tier**, not a single extra query:
- **unknown / disabled user:** one `SELECT`, return (fastest);
- **rate-limited user:** `SELECT` user + `SELECT` count, return (middle);
- **eligible user:** `SELECT` user + count `SELECT` + existing-PIN `SELECT` + N `UPDATE`s + 2 `INSERT`s + a synchronous `commit()` (fsync) (slowest) — plus the O(1) `background_tasks.add_task(...)` list-append, the one extra on-path op the other tiers skip; it is orders of magnitude smaller than this tier's `commit()`/fsync and adds no separately distinguishable timing tier.

On the current single-node deployment the DB is file-backed SQLite with `journal_mode=delete` / `synchronous=FULL`, so the eligible-path `commit()` does a real fsync — the residual delta is small and local but is **not** benchmarked to a specific bound (this spec deliberately does not claim "sub-millisecond"). It is judged not worth equalizing (constant-time padding) on this deployment: YAGNI. Two honest caveats: **(i)** a registered user who exhausts the hourly cap transitions from the eligible (write/commit) tier to the rate-limited tier, a cross-tier shift that repeated probing could exploit statistically; **(ii)** in **debug** mode the eligible-only `print(..., flush=True)` inside `request_pin` is itself an on-path, account-dependent signal — dev-only (`settings.debug` MUST be off in production), so out of scope for the production oracle but noted here for completeness. Revisit all of this if the app moves to a remote database, where the `commit()` fsync and network round-trips could make the delta observable.

### Testing (`backend/tests/test_login_pin_delivery.py`, extend)
- **Off-path scheduling (new, the core regression):** direct-call `api_request_pin` with a real `BackgroundTasks()` and a minimal CSRF-valid request. `_require_csrf` only checks one header, so `Request({"type": "http", "headers": [(b"x-requested-with", b"mathion")]})` satisfies it — **no CSRF monkeypatch needed**. A direct call *collects* tasks into `background_tasks.tasks` but does **not** run them, which lets this test prove BOTH halves of "off-path": the send is scheduled **and** it did not execute inline. Using the real `db` fixture, assert:
  - eligible user → **(no inline send)** with a `MemoryMailer` installed (`monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)`), `mailer.sent == []` **immediately after** the direct handler call — since the direct call collects but never runs tasks, an empty outbox proves the send did not execute inline (the observation `.tasks` alone cannot make); **(scheduled)** `background_tasks.tasks` has exactly one task with `.func is _send_login_pin` and `.args == ("real@example.com", raw_pin)` — a plain recipient-identity assertion (the scheduled task targets the right address and PIN). This deliberately does **not** claim to test the handler's own `.strip().lower()`: `PinRequestSchema.normalize_email` (a Pydantic `@field_validator`, `schemas.py:200-203`) already strips+lowercases, so `data.email` is normalized *before* the handler runs and the handler's re-normalization is a redundant no-op the test cannot detect (verified: `PinRequestSchema(email="  Real@Example.com ").email == "real@example.com"`). Recipient/lookup consistency is guaranteed upstream (schema validator + `request_pin`'s own internal `strip().lower()`); the assertion just pins the scheduled args. Do not dress this up as a normalization test. To obtain the expected PIN without circularity (the handler computes `raw_pin = request_pin(db, data.email)` internally and does not return it): either spy on `request_pin` — `monkeypatch.setattr(auth_api, "request_pin", spy)` capturing its return — and assert `.args == ("real@example.com", captured_pin)`, **or** validate the scheduled value directly with `verify_pin(db, "real@example.com", task.args[1], 1) is not None` (the pattern `test_sends_exactly_one_login_pin` already uses at `test_login_pin_delivery.py:45-46`). Never write `raw_pin = task.args[1]; assert task.args == (..., raw_pin)` — that is circular and vacuous for the PIN component.
  - unknown user, disabled user, **rate-limited** user (seed `settings.max_pin_requests_per_hour` `RateLimitEntry` rows for `pin_request:{email}` first, or monkeypatch the cap lower), and **debug mode** (`settings.debug = True`, eligible user — exercises the handler gate, since `request_pin` still returns a PIN) → `background_tasks.tasks` is empty.
  A `TestClient`-based test cannot prove this: Starlette's `TestClient` runs background tasks *within* the request before `client.post(...)` returns, so it cannot distinguish inline from background. The direct-call test (scheduled task in `.tasks` + empty outbox after the call) is the only non-vacuous vehicle for the off-path claim.
- **Behaviour preserved (existing `test_login_pin_delivery.py` tests kept as-is — do not rewrite):** `test_sends_exactly_one_login_pin`, `test_unknown_email_sends_nothing`, `test_debug_console_no_email`, `test_no_mailer_sends_nothing`, `test_send_failure_stays_uniform`, `test_mailer_build_failure_stays_uniform`, `test_request_pin_still_200_under_lifespanless_client`. These continue to pass after the move because (a) `_send_login_pin` catches send/build failures and (b) `TestClient` runs the background task in-request, so the post-`POST` `mailer.sent` / uniform-response assertions still hold. They verify the send still occurs, the message is correct, the PIN is never persisted, and the response is uniform — but they deliberately do **not** (cannot) distinguish scheduling; that distinction is owned solely by the direct-call test above. Do not conflate the two.

---

## Files touched
- **New:** `backend/mathion/superuser/log_redaction.py`
- **New:** `backend/tests/test_panel_log_redaction.py`
- **Edit:** `backend/mathion/main.py` — `from mathion.superuser.log_redaction import install`; call `install()` at module-import time (top level), **not** in the lifespan (so it runs for every `--lifespan` mode).
- **Edit:** `backend/mathion/api/auth.py` — `_send_login_pin` helper + `BackgroundTasks` scheduling in `api_request_pin`.
- **Edit:** `backend/tests/test_login_pin_delivery.py` — add the off-path scheduling test (covering eligible, unknown, disabled, rate-limited, and debug cases); keep the existing behaviour tests unchanged.

## Success criteria
- **#1:** An access-log record for any panel path never contains the raw token (unit + real-`uvicorn.access`-`LogRecord` integration test); non-panel paths are logged unchanged; the filter never raises on a malformed record — it fail-opens, passing an unexpected-shape record through untouched (formatting such a record is uvicorn's own concern, and uvicorn 0.44.0 only ever emits the 5-tuple, so this is theoretical); `install()` attaches the filter to `uvicorn.access`, and importing the app (`mathion.main`) actually calls it — so redaction is active under every `--lifespan` mode, not only when the lifespan runs.
- **#2:** The PIN send is moved off the response path — scheduled on `BackgroundTasks`, not executed inline (proven by the direct-call test: the scheduled task appears in `.tasks` while the mailer outbox stays empty immediately after the handler returns, since a direct call does not run background tasks). Every Slice-1 `/request-pin` invariant (uniform response, PIN not written to DB/notification-log or non-debug logging, debug gate, best-effort) still holds. Latency uniformity is *argued* (the dominant SMTP tier is removed), not asserted; the residual multi-tier DB-work delta is accepted and documented — this **mitigates, not fully closes**, the timing oracle.
