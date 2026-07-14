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
