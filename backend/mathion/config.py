from pathlib import Path
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    version: str = "unknown"          # reads MATHION_VERSION via env_prefix="MATHION_"
    database_url: str = "postgresql+psycopg://mathion:mathion@localhost:5432/mathion"
    asset_path: str = "/data/mathion/assets"
    max_file_size: int = 20 * 1024 * 1024  # 20MB
    max_course_size: int = 500 * 1024 * 1024  # 500MB
    secret_key: str = "dev-secret-key-change-in-production"
    pin_expiry_minutes: int = 10
    max_pin_requests_per_hour: int = 3
    max_pin_failures_per_hour: int = 5
    cookie_secure: bool = False  # Set True in production (HTTPS)
    # Dev-only: when MATHION_DEBUG=1, generated login PINs are printed to
    # stdout (visible in the uvicorn terminal). MUST be off in production.
    debug: bool = False
    # Absolute path to the built frontend (Vite dist/). Resolved against the
    # backend package, NOT process CWD, so deploys are deterministic. Override
    # via MATHION_FRONTEND_DIST.
    frontend_dist: str = str(
        (Path(__file__).resolve().parent.parent.parent / "frontend" / "dist")
    )

    # --- Notification / email settings ---
    email_mode: str = "disabled"           # smtp | file | memory | disabled
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    email_from: str = "Mathion <noreply@mathion.test>"
    email_outbox: str = "./outbox/"
    base_url: str = "http://localhost:8000"
    dispatcher_lock_path: str = "/tmp/mathion.dispatcher.lock"

    model_config = {"env_prefix": "MATHION_"}

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, v: str) -> str:
        # Reject CR / LF / NUL / other ASCII control chars AND ANY whitespace
        # BEFORE parsing. `urllib.parse.urlparse` tolerates control chars and
        # whitespace in netloc/path, allowing header-injection-shaped values
        # to reach the email body. `\t`, ` `, `\xa0` (NBSP) all rejected.
        if any(ord(c) < 0x20 or ord(c) == 0x7f or c.isspace() for c in v):
            raise ValueError(
                f"MATHION_BASE_URL contains control or whitespace characters: {v!r}")
        parsed = urlparse(v)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError(
                f"MATHION_BASE_URL scheme must be http or https, got {parsed.scheme!r}")
        if not parsed.netloc:
            raise ValueError(f"MATHION_BASE_URL missing host: {v!r}")
        # Reject userinfo (the `user:pass@host` form). Phishing vector:
        # `https://mathion.example.com@attacker.com` — `parsed.netloc` is
        # `mathion.example.com@attacker.com` (passes the non-empty check),
        # but browsers resolve the host as `attacker.com`. The userinfo
        # form has no legitimate use in a public base URL.
        if parsed.username is not None or parsed.password is not None:
            raise ValueError(
                f"MATHION_BASE_URL must not contain userinfo (user:pass@); got {v!r}")
        # Force `parsed.port` evaluation — raises ValueError on malformed
        # ports like `:bad` or out-of-range integers (urlparse keeps these
        # in netloc and the port property re-parses on access).
        try:
            _ = parsed.port  # accessing .port triggers ValueError for malformed/out-of-range values
        except ValueError as exc:
            raise ValueError(f"MATHION_BASE_URL has invalid port: {v!r}") from exc
        # Reject path-prefix URLs. `MATHION_BASE_URL=http://example.com/admin`
        # would produce links like `http://example.com/admin/courses/<slug>/runs/<id>`,
        # which is almost always a config typo. Path-prefix support is a real
        # but separate feature (reverse-proxy mounting) and would need a
        # dedicated design — out of scope this slice. Accept "" and "/" only.
        if parsed.path not in ("", "/"):
            raise ValueError(
                f"MATHION_BASE_URL must not include a path; got path={parsed.path!r}. "
                "If reverse-proxy path-prefix support is needed, see a follow-up slice.")
        # Reject query string and fragment. Both break URL construction in
        # the notification URL helpers (`_student_url`/`_staff_url`, which
        # append `/courses/...` — concatenating onto `http://example.com?x=y`
        # produces `http://example.com?x=y/courses/...` which routes the path
        # INTO the query string). No legitimate use for either in a base URL.
        if parsed.query:
            raise ValueError(f"MATHION_BASE_URL must not include a query string: {v!r}")
        if parsed.fragment:
            raise ValueError(f"MATHION_BASE_URL must not include a fragment: {v!r}")
        return v.rstrip("/")

    @field_validator("dispatcher_lock_path")
    @classmethod
    def _validate_dispatcher_lock_path(cls, v: str) -> str:
        # Reject relative paths. A relative path (e.g. `./mathion.lock`) is
        # cwd-dependent — two uvicorn processes with different cwds each
        # resolve a DIFFERENT path, each acquires its own lock, and both
        # silently double-send. The whole point of MATHION_DISPATCHER_LOCK_PATH
        # over `/tmp/mathion.dispatcher.lock` is to let deployments pin a
        # known-shared path; admitting relative values defeats that.
        p = Path(v)
        if not p.is_absolute():
            raise ValueError(
                f"MATHION_DISPATCHER_LOCK_PATH must be absolute; got {v!r}. "
                "Use /var/run/mathion/dispatcher.lock or /tmp/mathion.dispatcher.lock.")
        return v


settings = Settings()
