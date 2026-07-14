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
        ("/superuser/SECRET?x=1", "/superuser/[redacted]?x=1"),      # token directly before ? -> [^/?]+ stops at ?
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
    # Full 5-tuple: only index 2 changed, the other four fields byte-identical.
    assert rec.args == ("127.0.0.1:0", "HEAD", "/api/superuser/[redacted]/stats", "1.1", 200)


def test_filter_passes_list_args_unchanged():
    # A 5-element LIST is NOT a tuple; guard must skip it. Guards against a
    # future widening of the isinstance(args, tuple) check to Sequence.
    args = ["127.0.0.1:0", "GET", "/api/superuser/SECRET/stats", "1.1", 200]
    rec = _make_access_record(args)
    assert PanelAccessLogFilter().filter(rec) is True
    assert rec.args == ["127.0.0.1:0", "GET", "/api/superuser/SECRET/stats", "1.1", 200]


def test_filter_passes_str_args_unchanged():
    # A str is a Sequence but not a tuple; guard must skip it (no per-char indexing).
    args = "/api/superuser/SECRET/stats"
    rec = _make_access_record(args)
    assert PanelAccessLogFilter().filter(rec) is True
    assert rec.args == "/api/superuser/SECRET/stats"


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
