# Superuser Panel Slice 2 (Security Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two security fixes deferred from Superuser Panel Slice 1 — redact the panel token from uvicorn access logs, and move the `/request-pin` login-PIN send off the response path — as one small backend-only slice.

**Architecture:** Two independent changes. (1) A `logging.Filter` on the `uvicorn.access` logger rewrites the token segment of panel request lines to `[redacted]`; it is installed at `main.py` import time (top level, not in the lifespan) so it is active under every uvicorn `--lifespan` mode. (2) The one-shot login-PIN email send is extracted into a module-level helper and scheduled via FastAPI `BackgroundTasks.add_task`, so the blocking SMTP send runs after the response is sent instead of inline.

**Tech Stack:** FastAPI 0.136.0 + Starlette 1.0.0 + uvicorn 0.44.0 (Python 3.14), SQLAlchemy 2.0. No new dependencies, no DB/schema/Alembic changes, no frontend changes.

**Source spec:** `docs/superpowers/specs/2026-07-14-superuser-slice2-hardening-design.md` (converged after eight review rounds + two codex passes).

## Global Constraints

Binding for every task (copy exact values verbatim into task briefs):

- **Backend only.** No frontend changes. No new runtime dependencies. No DB schema / Alembic migration.
- Backend commands run from `backend/` via the venv, never bare: `.venv/bin/pytest`, `.venv/bin/python`.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Commit trailer MUST end EXACTLY with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Stage only each task's listed files, by path. Never `git add -A`. Never stage the three pre-existing untracked files: `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`.
- Preserve every Slice-1 invariant: uniform `/request-pin` response `{"message": "PIN sent"}` for all outcomes; the raw PIN is never written to the auth DB or the notification log, and never emitted to non-debug logging (the `FileMailer` `.eml` sink and the `settings.debug` stdout print are pre-existing dev/test facilities, out of scope, unchanged); `send_pin_enabled` honesty; the single-active-token model.
- The redaction filter is **fail-open**: it always returns `True` (never drops a record) and never raises. The `install()` idempotency guard uses `isinstance(args, tuple)`, NOT `Sequence` (a `str` is a `Sequence` — widening would corrupt string args).
- Item #1 **closes** the log leak; Item #2 **mitigates** (does not fully close) the timing oracle — a smaller residual DB-work delta remains, accepted and documented in the spec. Do not add constant-time padding (YAGNI).

---

## File Structure

- **Create** `backend/mathion/superuser/log_redaction.py` — the pure redaction module: regex, `redact_panel_path`, `PanelAccessLogFilter`, `install`. Imports only `re` and `logging` (no DB / app imports), so wiring it into `main.py` pulls nothing heavy into the import graph.
- **Create** `backend/tests/test_panel_log_redaction.py` — unit + integration + install-wiring tests for Item #1.
- **Modify** `backend/mathion/main.py` — import `install` and call it once at module top level.
- **Modify** `backend/mathion/api/auth.py` — add `_send_login_pin` helper; add `BackgroundTasks` to the handler and schedule the send.
- **Modify** `backend/tests/test_login_pin_delivery.py` — add the off-path scheduling tests; keep the 7 existing tests unchanged.
- **Untouched:** `backend/mathion/superuser/__init__.py` is empty (0 bytes) and MUST stay empty — do not add any eager import of `log_redaction` there.

---

## Task 1: Item #1 — panel-log redaction module + behaviour tests

**Files:**
- Create: `backend/mathion/superuser/log_redaction.py`
- Test: `backend/tests/test_panel_log_redaction.py`

**Interfaces:**
- Consumes: nothing (leaf module; stdlib `re`, `logging`, and `uvicorn.logging.AccessFormatter` in tests only).
- Produces (Task 2 and the tests rely on these exact names):
  - `redact_panel_path(path: str) -> str`
  - `class PanelAccessLogFilter(logging.Filter)` with `filter(self, record) -> bool`
  - `install() -> None` — idempotently attaches a `PanelAccessLogFilter` to the `uvicorn.access` logger.

**Context:** uvicorn's access record `record.args` is the 5-tuple `(client_addr, method, full_path, http_version, status_code)`; the path (with query string) is index 2. Formatting happens after filtering, so a filter that mutates `record.args[2]` before formatting cleanly redacts the emitted line. The token alphabet is `secrets.token_urlsafe` (`A–Za–z0–9_-`), none percent-encoded, so `[^/?]+` consumes the whole token and stops at the next `/` or `?`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_panel_log_redaction.py`:

```python
import logging

import pytest
from uvicorn.logging import AccessFormatter

from mathion.superuser.log_redaction import (
    redact_panel_path,
    PanelAccessLogFilter,
    install,
)

UVICORN_ACCESS_FMT = '%s - "%s %s HTTP/%s" %d'  # uvicorn's exact access format string


def _make_access_record(args):
    """Build a real uvicorn.access LogRecord with the given args tuple.
    exc_info is a required positional (pass None). Construction does not format,
    so a placeholder-bearing msg with mismatched args does not raise here."""
    return logging.getLogger("uvicorn.access").makeRecord(
        "uvicorn.access", logging.INFO, __file__, 0, UVICORN_ACCESS_FMT, args, None
    )


# ---- Unit: redact_panel_path (every spec example row) --------------------
@pytest.mark.parametrize(
    "path, expected",
    [
        ("/superuser/tok-EN_abc", "/superuser/[redacted]"),          # url-safe token (- and _)
        ("/superuser/SECRET/", "/superuser/[redacted]/"),            # trailing slash preserved
        ("/api/superuser/SECRET/stats", "/api/superuser/[redacted]/stats"),
        ("/api/superuser/SECRET/stats?x=1", "/api/superuser/[redacted]/stats?x=1"),  # query preserved
        ("/superuser/", "/superuser/"),                              # empty token -> unchanged
        ("/superuserfoo", "/superuserfoo"),                          # no trailing / -> unchanged
        ("/api/courses/abc-123", "/api/courses/abc-123"),            # non-panel -> unchanged
    ],
)
def test_redact_panel_path(path, expected):
    out = redact_panel_path(path)
    assert out == expected
    if "SECRET" in path or path.startswith("/superuser/tok"):
        assert "SECRET" not in out and "tok-EN_abc" not in out


# ---- Unit: filter robustness (fail-open, method-agnostic) ----------------
def test_filter_passes_none_args_unchanged():
    rec = _make_access_record(None)
    assert PanelAccessLogFilter().filter(rec) is True
    assert rec.args is None


def test_filter_passes_wrong_length_tuple_unchanged():
    args = ("127.0.0.1:0", "GET", "/api/superuser/SECRET/stats")  # 3-tuple, not 5
    rec = _make_access_record(args)
    assert PanelAccessLogFilter().filter(rec) is True
    assert rec.args == args  # untouched, no raise


def test_filter_redacts_head_method():
    args = ("127.0.0.1:0", "HEAD", "/api/superuser/SECRET/stats", "1.1", 200)
    rec = _make_access_record(args)
    assert PanelAccessLogFilter().filter(rec) is True
    assert rec.args[2] == "/api/superuser/[redacted]/stats"  # keys on args[2], not method


# ---- Integration: through uvicorn's real AccessFormatter -----------------
def _integration_record():
    return _make_access_record(
        ("127.0.0.1:0", "GET", "/api/superuser/SECRET/stats", "1.1", 200)
    )


def _request_line_formatter():
    # request_line format routes args[2] through AccessFormatter.formatMessage's
    # real unpack path (same path production uses). NOT the bare default
    # AccessFormatter(), whose %(message)s collapses to msg % args and discards
    # the request_line.
    return AccessFormatter(
        '%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False
    )


def test_integration_redacts_through_uvicorn_formatter():
    record = _integration_record()
    fmt = _request_line_formatter()
    PanelAccessLogFilter().filter(record)
    out = fmt.format(record)
    assert "SECRET" not in out
    assert "[redacted]" in out


def test_integration_without_filter_leaks_token():
    # Non-vacuity guard: same record, no filter -> SECRET present in the output.
    record = _integration_record()
    fmt = _request_line_formatter()
    out = fmt.format(record)
    assert "SECRET" in out


# ---- Install idempotency (sub-test a) ------------------------------------
@pytest.fixture
def clean_uvicorn_access_filters():
    """Snapshot uvicorn.access filters, strip any pre-existing
    PanelAccessLogFilter so the count assertion starts clean, restore in
    teardown. Scoped to the idempotency test ONLY (the import-wiring test in
    Task 2 must NOT strip)."""
    log = logging.getLogger("uvicorn.access")
    snapshot = list(log.filters)
    log.filters = [f for f in log.filters if not isinstance(f, PanelAccessLogFilter)]
    yield log
    log.filters = snapshot


def test_install_is_idempotent(clean_uvicorn_access_filters):
    log = clean_uvicorn_access_filters
    sentinel = logging.Filter()
    log.addFilter(sentinel)
    install()
    install()
    panel_filters = [f for f in log.filters if isinstance(f, PanelAccessLogFilter)]
    assert len(panel_filters) == 1          # idempotent: exactly one, not two
    assert sentinel in log.filters          # unrelated filter left in place
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_panel_log_redaction.py -v`
Expected: FAIL at collection — `ModuleNotFoundError: No module named 'mathion.superuser.log_redaction'`.

- [ ] **Step 3: Implement the module**

Create `backend/mathion/superuser/log_redaction.py`:

```python
"""Redact the superuser panel token from uvicorn access-log request lines.

The panel token is carried in the URL path (`/superuser/{token}` and
`/api/superuser/{token}/...`). uvicorn's access logger logs the full request
line including that path, so without this filter the raw token is written to
access logs. A logging.Filter on the `uvicorn.access` logger rewrites the token
segment to `[redacted]` before the record is formatted.
"""

import logging
import re

# Matches /superuser/<token> and /api/superuser/<token>..., capturing the route
# prefix in group 1 and consuming the token segment (stops at the next / or ?),
# so a trailing path (e.g. /stats) and any query string are preserved. Bare
# /superuser, /superuserfoo, and /superuser/ (empty token) do NOT match.
_PANEL_TOKEN_RE = re.compile(r"^(/(?:api/)?superuser/)[^/?]+")


def redact_panel_path(path: str) -> str:
    """Return `path` with the panel token replaced by `[redacted]`.

    Pure function, unit-testable in isolation. Non-panel paths, bare
    `/superuser`, and empty-token `/superuser/` are returned unchanged.
    """
    return _PANEL_TOKEN_RE.sub(r"\1[redacted]", path)


class PanelAccessLogFilter(logging.Filter):
    """Redacts the panel token from a uvicorn.access record's request line.

    Fail-open: any record whose `args` is not uvicorn's expected 5-tuple passes
    through untouched, the filter never raises, and it always returns True
    (never drops a record). The guard is deliberately `isinstance(args, tuple)`,
    NOT `Sequence` — a `str` is a `Sequence`, and widening would risk corrupting
    string args.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) == 5:
            path = args[2]
            if isinstance(path, str):
                redacted = redact_panel_path(path)
                if redacted != path:
                    record.args = (args[0], args[1], redacted, args[3], args[4])
        return True


def install() -> None:
    """Idempotently attach a PanelAccessLogFilter to the `uvicorn.access` logger.

    No-op if a PanelAccessLogFilter is already attached (guards double-install
    when multiple app instances are created in one test process). Any unrelated
    pre-existing filter is left in place.
    """
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, PanelAccessLogFilter) for f in logger.filters):
        logger.addFilter(PanelAccessLogFilter())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_panel_log_redaction.py -v`
Expected: PASS — all rows of `test_redact_panel_path`, the three robustness tests, both integration tests, and `test_install_is_idempotent`.

- [ ] **Step 5: Commit**

```bash
cd backend && git add mathion/superuser/log_redaction.py tests/test_panel_log_redaction.py
git commit -m "$(cat <<'EOF'
feat(superuser): redact panel token from uvicorn access-log lines

logging.Filter on uvicorn.access rewrites the token segment of
/superuser/<token> and /api/superuser/<token> request lines to [redacted].
Fail-open (never raises, always returns True); method-agnostic; preserves
trailing path + query. install() is idempotent. Wiring lands in Task 2.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Item #1 — wire `install()` into `main.py` at import time + import-wiring test

**Files:**
- Modify: `backend/mathion/main.py:33-38` (import block) and add a top-level `install()` call before the lifespan.
- Test: `backend/tests/test_panel_log_redaction.py` (append the import-wiring test).

**Interfaces:**
- Consumes: `install` from `mathion.superuser.log_redaction` (Task 1).
- Produces: redaction is active in the running app — `uvicorn.access` carries a `PanelAccessLogFilter` process-wide once `mathion.main` is imported.

**Context:** `install()` must run at `main.py` module top level (NOT in the lifespan): uvicorn runs `configure_logging()` before importing the app for a string-app launch (every production mode) and always imports the app regardless of `--lifespan`, so an import-time install runs after logging is configured and is active under every `--lifespan` mode — closing the `--lifespan off` bypass a lifespan-startup install would leave open. `conftest.py:17` imports `mathion.main` at collection, so once wired the filter is present process-globally before any test runs; a cached re-`import mathion.main` inside a test does NOT re-run `install()`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_panel_log_redaction.py`:

```python
# ---- Install wiring (sub-test b): importing mathion.main installs it ------
def test_app_import_wires_panel_log_filter():
    """Importing mathion.main runs install() at module top level, so the
    uvicorn.access logger carries a PanelAccessLogFilter process-globally.
    Assert PRESENCE on the live logger WITHOUT stripping (a cached re-import is
    a no-op that cannot re-install, so stripping would remove the very filter
    this checks for). Robust to run order relative to the idempotency test,
    whose fixture restores its snapshot in teardown."""
    import mathion.main  # noqa: F401  (cached no-op here; documents the dependency)

    log = logging.getLogger("uvicorn.access")
    assert any(isinstance(f, PanelAccessLogFilter) for f in log.filters)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_panel_log_redaction.py::test_app_import_wires_panel_log_filter -v`
Expected: FAIL — `assert any(...)` is False, because `main.py` does not yet call `install()` (no `PanelAccessLogFilter` on `uvicorn.access`).

- [ ] **Step 3: Wire `install()` into `main.py`**

In `backend/mathion/main.py`, add the import at the end of the import group (after the `from mathion.notifications import (...)` block that ends at line 38):

```python
from mathion.notifications import (
    run_forever,
    acquire_singleton_lock,
    SHUTDOWN_TIMEOUT_SECONDS,
    build_mailer_from_settings,
)
from mathion.superuser.log_redaction import install as install_log_redaction

# Redact the panel token from uvicorn access logs. Installed at IMPORT TIME
# (top level, NOT in the lifespan) so it is active under every uvicorn
# --lifespan mode — importing this module wires it for the whole process.
install_log_redaction()
```

The `install_log_redaction()` call sits at module top level, before the `@asynccontextmanager`/`lifespan` definition. Do NOT put it inside the lifespan. Do NOT add any import of `log_redaction` to `mathion/superuser/__init__.py` (it must stay empty).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_panel_log_redaction.py -v`
Expected: PASS — the new `test_app_import_wires_panel_log_filter` plus all Task-1 tests (the idempotency test still passes: its fixture strips the now-present ambient filter, exercises install(), and restores the snapshot).

- [ ] **Step 5: Commit**

```bash
cd backend && git add mathion/main.py tests/test_panel_log_redaction.py
git commit -m "$(cat <<'EOF'
feat(superuser): install access-log redaction at main.py import time

Wire install() at module top level (not the lifespan) so redaction is
active under every uvicorn --lifespan mode, closing the --lifespan off
bypass. Import-wiring test asserts the filter is present on uvicorn.access
after importing mathion.main.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Item #2 — move the `/request-pin` PIN send off the response path

**Files:**
- Modify: `backend/mathion/api/auth.py:3` (import), and `backend/mathion/api/auth.py:57-72` (handler + new helper).
- Test: `backend/tests/test_login_pin_delivery.py` (append off-path tests; keep the 7 existing tests unchanged).

**Interfaces:**
- Consumes: `request_pin`, `settings`, `build_mailer_from_settings`, `build_login_pin_message`, `logger` (all already imported in `auth.py`); `BackgroundTasks` (new import).
- Produces: `_send_login_pin(email: str, raw_pin: str) -> None` (module-level helper in `auth.py`); `api_request_pin` gains a `background_tasks: BackgroundTasks` parameter.

**Context:** Today the send runs inline in `api_request_pin` (auth.py:64-71), on the response path. Moving it to `background_tasks.add_task(...)` runs the sync `_send_login_pin` in FastAPI's threadpool AFTER the response body is sent (Starlette `Response.__call__` awaits `self.background()` after the body), so blocking `smtplib` no longer runs inline. A DIRECT call to `api_request_pin` (not via TestClient) *collects* tasks into `background_tasks.tasks` but does NOT run them — this is the only vehicle that can prove off-path (TestClient runs the task in-request). `PinRequestSchema.normalize_email` (schemas.py) already strips+lowercases `data.email`, so the handler's `.strip().lower()` is a redundant no-op — do NOT dress the test up as a normalization test.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_login_pin_delivery.py` (add the three new imports at the top of the file alongside the existing imports, then the tests):

```python
# add near the existing imports at the top of the file:
from fastapi import BackgroundTasks
from starlette.requests import Request as StarletteRequest

from mathion.schemas import PinRequestSchema
```

```python
def _csrf_request():
    # _require_csrf only checks the X-Requested-With header; this minimal scope
    # satisfies it with no monkeypatch.
    return StarletteRequest(
        {"type": "http", "headers": [(b"x-requested-with", b"mathion")]}
    )


def test_eligible_user_schedules_send_off_path(db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)

    bg = BackgroundTasks()
    result = auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )

    assert result == {"message": "PIN sent"}
    # (no inline send) a direct call collects but never runs tasks, so an empty
    # outbox proves the send did not execute inline.
    assert mailer.sent == []
    # (scheduled) exactly one _send_login_pin task, right recipient, valid PIN.
    assert len(bg.tasks) == 1
    task = bg.tasks[0]
    assert task.func is auth_api._send_login_pin
    assert task.args[0] == "real@example.com"
    # validate the scheduled PIN non-circularly (same pattern as
    # test_sends_exactly_one_login_pin), not by reading task.args[1] back.
    assert verify_pin(db, "real@example.com", task.args[1], 1) is not None


def test_unknown_user_schedules_nothing(db, monkeypatch):
    monkeypatch.setattr(settings, "debug", False)
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)
    bg = BackgroundTasks()
    auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="nobody@example.com"), bg, db=db
    )
    assert bg.tasks == []
    assert mailer.sent == []


def test_disabled_user_schedules_nothing(db, monkeypatch):
    u = _make_user(db)
    u.is_disabled = True
    db.commit()
    monkeypatch.setattr(settings, "debug", False)
    bg = BackgroundTasks()
    auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )
    assert bg.tasks == []


def test_rate_limited_user_schedules_nothing(db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "max_pin_requests_per_hour", 0)  # any count >= 0 -> limited
    bg = BackgroundTasks()
    auth_api.api_request_pin(
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )
    assert bg.tasks == []


def test_debug_mode_schedules_nothing(db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", True)  # request_pin still returns a PIN;
    bg = BackgroundTasks()                          # the handler's `not settings.debug`
    auth_api.api_request_pin(                        # gate suppresses scheduling.
        _csrf_request(), PinRequestSchema(email="real@example.com"), bg, db=db
    )
    assert bg.tasks == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_login_pin_delivery.py -k "schedules" -v`
Expected: FAIL — `api_request_pin()` currently takes `(request, data, db)` (no `background_tasks` positional), so the direct calls raise `TypeError`, and `_send_login_pin` does not exist (`AttributeError` on import of the name / `auth_api._send_login_pin`).

- [ ] **Step 3: Implement the helper + handler change**

In `backend/mathion/api/auth.py`, first add `BackgroundTasks` to the fastapi import (line 3):

```python
from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response
```

Then replace the current `api_request_pin` (lines 57-72) with the helper + rewired handler:

```python
def _send_login_pin(email: str, raw_pin: str) -> None:
    """Build a one-shot mailer and send the login PIN. Best-effort: any
    build/send failure is caught and logged with a static message (never the
    raw PIN). This is the SOLE error boundary for the send after it moved
    off the response path."""
    try:
        mailer = build_mailer_from_settings(settings)  # one-shot; NOT app.state.mailer
        if mailer is not None:
            msg = build_login_pin_message(email, raw_pin)
            with mailer.session():
                mailer.send(msg)
    except Exception:
        logger.exception("login PIN email send failed")  # static message; never the raw PIN


@router.post("/request-pin")
def api_request_pin(
    request: Request,
    data: PinRequestSchema,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    _require_csrf(request)
    raw_pin = request_pin(db, data.email)
    # Schedule the send OFF the response path (not inline) only for a real,
    # enabled, non-rate-limited user (request_pin returned a PIN) and only when
    # debug is off. Response stays uniform regardless.
    if raw_pin is not None and not settings.debug:
        # data.email is already stripped+lowercased by PinRequestSchema.normalize_email;
        # the .strip().lower() here is belt-and-suspenders (a no-op post-schema).
        background_tasks.add_task(_send_login_pin, data.email.strip().lower(), raw_pin)
    return {"message": "PIN sent"}
```

(`background_tasks` has no default and precedes the defaulted `db` — valid Python; FastAPI injects `BackgroundTasks` by type and does not treat it as a body field.)

- [ ] **Step 4: Run the full delivery test file to verify pass (new + existing)**

Run: `cd backend && .venv/bin/pytest tests/test_login_pin_delivery.py -v`
Expected: PASS — the 5 new off-path tests AND the 7 existing tests. The existing tests still pass because `_send_login_pin` catches send/build failures and `TestClient` runs the scheduled task in-request (so `mailer.sent` / uniform-response assertions still hold).

- [ ] **Step 5: Commit**

```bash
cd backend && git add mathion/api/auth.py tests/test_login_pin_delivery.py
git commit -m "$(cat <<'EOF'
feat(auth): move /request-pin login-PIN send off the response path

Extract the inline send into _send_login_pin and schedule it via
BackgroundTasks.add_task, so the blocking SMTP send runs after the response
is sent instead of inline — mitigating the user-enumeration timing oracle.
Uniform response and all Slice-1 invariants preserved; the helper's
try/except is the sole error boundary.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

- [ ] Run the two touched test files together: `cd backend && .venv/bin/pytest tests/test_panel_log_redaction.py tests/test_login_pin_delivery.py -v` — all pass.
- [ ] Run the whole backend suite to confirm no regression: `cd backend && .venv/bin/pytest -q` — green.
- [ ] Confirm working tree: only the 5 planned files changed across the 3 commits; the three forbidden untracked files are still untracked and unstaged.

---

## Self-Review

**1. Spec coverage:**
- Item #1 design (module, regex, `redact_panel_path`, `PanelAccessLogFilter`, `install`) → Task 1. ✓
- Item #1 fail-open filter / `isinstance(args, tuple)` guard → Task 1 module + robustness tests + Global Constraints. ✓
- Item #1 import-time install / `--lifespan off` rationale → Task 2 wiring + context. ✓
- Item #1 unit + integration (makeRecord + `request_line` AccessFormatter) + non-vacuity → Task 1 Step 1 (`test_integration_*`). ✓
- Item #1 install-wiring: idempotency (strip fixture, sub-test a) → Task 1; import-wiring (presence, no strip, sub-test b) → Task 2. ✓ (Fixture scoped to (a) only — the round-7/8 fix.)
- Item #2 `_send_login_pin` helper (byte-for-byte behaviour) + `BackgroundTasks` scheduling + import → Task 3. ✓
- Item #2 off-path test (direct-call, empty outbox + scheduled task, non-circular PIN) covering eligible/unknown/disabled/rate-limited/debug → Task 3 Step 1. ✓
- Item #2 existing 7 tests kept unchanged and still green → Task 3 Step 4. ✓
- Invariants (uniform response, PIN not persisted/logged, debug gate, single-token, no eager `__init__` import) → Global Constraints + task notes. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step shows the full code and every run step shows the exact command + expected outcome. ✓

**3. Type consistency:** `redact_panel_path(path: str) -> str`, `PanelAccessLogFilter`, `install() -> None`, `_send_login_pin(email: str, raw_pin: str) -> None`, and `verify_pin(db, email, raw_pin, duration_days)` used identically in every task and test. The `api_request_pin(request, data, background_tasks, db=Depends(get_db))` signature matches the direct-call sites in Task 3's tests. ✓
