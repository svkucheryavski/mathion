"""site_settings: the panel's Settings, copied once from .env

D2 (superuser Settings spec): email, file limits and sign-in rules move from
`.env` into one database row, which the panel's Settings page edits. This
migration creates the row from the current environment, read raw (never
through `Settings()`), so no value in `.env` can make it fail (D2a): a number
out of range is clamped, one that isn't a number gets the default, and email
"on" without a mail server, or with a login but no password, is copied as off.
Each such case prints one line (`mathion update` shows the output).

Everything it needs is frozen here, so later code changes can't change what it
writes: the v1 password seal (`mathion/secret_box.py`), the From default and
today's numbers.

Revision ID: e8c4f2a6b1d7
Revises: d5b1e7a3c9f4
Create Date: 2026-11-04 22:00:00.000000

"""
import base64
import hashlib
import hmac
import os
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e8c4f2a6b1d7'
down_revision: Union[str, Sequence[str], None] = 'd5b1e7a3c9f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MB = 1_048_576
_DEV_SECRET = "dev-secret-key-change-in-production"
_FROM_DEFAULT = "Mathion <noreply@mathion.test>"
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _seal_v1(plain: str, secret: str) -> str:
    """Frozen copy of secret_box.seal (v1)."""
    def key(label: bytes) -> bytes:
        return hmac.new(secret.encode(), label, hashlib.sha256).digest()
    data = plain.encode()
    nonce = os.urandom(16)
    stream = bytearray()
    i = 0
    while len(stream) < len(data):
        stream += hmac.new(key(b"mathion-smtp-stream"), nonce + i.to_bytes(4, "big"), hashlib.sha256).digest()
        i += 1
    ct = bytes(a ^ b for a, b in zip(data, stream))
    tag = hmac.new(key(b"mathion-smtp-tag"), b"v1" + nonce + ct, hashlib.sha256).digest()
    return "v1:" + base64.b64encode(nonce + ct + tag).decode()


def _note(text: str) -> None:
    print(f"site-settings: {text}")


def _text(key: str, max_len: int) -> str:
    """A text value as it can be stored, or "" with a printed line."""
    raw = os.environ.get(key, "")
    try:
        raw.encode()
    except UnicodeEncodeError:
        _note(f"{key} is not valid UTF-8 text; it is not copied")
        return ""
    value = raw.strip()
    if len(value) > max_len:
        _note(f"{key} is longer than {max_len} characters; it is not copied")
        return ""
    return value


def _int(key: str, default: int) -> tuple[int, str | None]:
    raw = os.environ.get(key)
    if raw is None or raw.strip() == "":
        return default, None
    try:
        return int(raw.strip()), raw
    except ValueError:
        _note(f"{key}={raw!r} is not a number; using the default {default}")
        return default, None


def _clamp(key: str, raw: str | None, value: int, lo: int, hi: int, unit: str = "") -> int:
    new = min(max(value, lo), hi)
    if new != value:
        _note(f"{key}={raw} is out of range; using {new}{unit}")
    return new


def _mb(key: str, default_mb: int) -> tuple[int, str | None]:
    value, raw = _int(key, default_mb * _MB)
    return max(1, -(-value // _MB)), raw  # whole MB, rounded up; exact for any size


def _copy() -> dict:
    env = os.environ
    mode = env.get("MATHION_EMAIL_MODE", "disabled").strip()
    host = _text("MATHION_SMTP_HOST", 253)
    username = _text("MATHION_SMTP_USERNAME", 254)
    password = env.get("MATHION_SMTP_PASSWORD", "")
    try:
        password.encode()
    except UnicodeEncodeError:
        _note("MATHION_SMTP_PASSWORD is not valid UTF-8 text; it is not copied")
        password = ""
    port, raw_port = _int("MATHION_SMTP_PORT", 587)
    port = _clamp("MATHION_SMTP_PORT", raw_port, port, 1, 65535)

    email_on = mode == "smtp"
    if email_on and not host:
        _note("MATHION_EMAIL_MODE=smtp but MATHION_SMTP_HOST is empty; email is copied as off")
        email_on = False
    if email_on and username and not password:
        _note("MATHION_SMTP_USERNAME is set but MATHION_SMTP_PASSWORD is empty; email is copied as off")
        email_on = False

    email_from = _text("MATHION_EMAIL_FROM", 320)
    if not email_from:
        if email_on:
            _note(f"MATHION_EMAIL_FROM is not set; email stays on with the default From {_FROM_DEFAULT}")
            email_from = _FROM_DEFAULT
        else:
            email_from = ""

    file_mb, raw = _mb("MATHION_MAX_FILE_SIZE", 20)
    file_mb = _clamp("MATHION_MAX_FILE_SIZE", raw, file_mb, 1, 50, " MB")
    total_mb, raw = _mb("MATHION_MAX_COURSE_SIZE", 500)
    if total_mb < file_mb:
        _note(f"MATHION_MAX_COURSE_SIZE is below the largest file; using {file_mb} MB")
        total_mb = file_mb
    total_mb = _clamp("MATHION_MAX_COURSE_SIZE", raw, total_mb, file_mb, 102_400, " MB")

    pin_minutes, raw = _int("MATHION_PIN_EXPIRY_MINUTES", 10)
    pin_minutes = _clamp("MATHION_PIN_EXPIRY_MINUTES", raw, pin_minutes, 5, 60)
    requests, raw = _int("MATHION_MAX_PIN_REQUESTS_PER_HOUR", 3)
    requests = _clamp("MATHION_MAX_PIN_REQUESTS_PER_HOUR", raw, requests, 3, 20)
    failures, raw = _int("MATHION_MAX_PIN_FAILURES_PER_HOUR", 5)
    failures = _clamp("MATHION_MAX_PIN_FAILURES_PER_HOUR", raw, failures, 3, 20)

    secret = env.get("MATHION_SECRET_KEY", _DEV_SECRET)
    return {
        "id": 1,
        "email_on": email_on,
        "smtp_host": host,
        "smtp_port": port,
        "smtp_encryption": "starttls",  # what Mathion uses today (mailer.py)
        "smtp_skip_cert_check": email_on,  # D7a: a server that sends today still sends
        "smtp_username": username,
        "smtp_password_sealed": _seal_v1(password, secret) if password else None,
        "email_from": email_from,
        "max_file_mb": file_mb,
        "max_total_mb": total_mb,
        "pin_minutes": pin_minutes,
        "pin_requests_per_hour": requests,
        "pin_failures_per_hour": failures,
        "longest_sign_in_days": 30,
        # D10a: a copied "on" has no off interval; a copied "off" skips everything before its first turn-on.
        "email_off_at": None if email_on else _EPOCH,
        "email_on_at": None,
        "send_backoff_step": 0,
    }


def upgrade() -> None:
    """Create site_settings and copy today's .env values into its one row."""
    ts = lambda name: sa.Column(name, sa.DateTime(timezone=True), nullable=True)  # noqa: E731
    table = op.create_table(
        'site_settings',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('email_on', sa.Boolean(), nullable=False),
        sa.Column('smtp_host', sa.String(length=253), nullable=False),
        sa.Column('smtp_port', sa.Integer(), nullable=False),
        sa.Column('smtp_encryption', sa.String(length=10), nullable=False),
        sa.Column('smtp_skip_cert_check', sa.Boolean(), nullable=False),
        sa.Column('smtp_username', sa.String(length=254), nullable=False),
        sa.Column('smtp_password_sealed', sa.Text(), nullable=True),
        sa.Column('email_from', sa.String(length=320), nullable=False),
        sa.Column('max_file_mb', sa.Integer(), nullable=False),
        sa.Column('max_total_mb', sa.Integer(), nullable=False),
        sa.Column('pin_minutes', sa.Integer(), nullable=False),
        sa.Column('pin_requests_per_hour', sa.Integer(), nullable=False),
        sa.Column('pin_failures_per_hour', sa.Integer(), nullable=False),
        sa.Column('longest_sign_in_days', sa.Integer(), nullable=False),
        ts('email_off_at'),
        ts('email_on_at'),
        sa.Column('test_fp', sa.String(length=64), nullable=True),
        ts('test_at'),
        sa.Column('test_ok', sa.Boolean(), nullable=True),
        sa.Column('test_message', sa.Text(), nullable=True),
        ts('card_test_at'),
        sa.Column('card_test_ok', sa.Boolean(), nullable=True),
        sa.Column('card_test_message', sa.Text(), nullable=True),
        sa.Column('send_failure_message', sa.Text(), nullable=True),
        ts('send_failure_at'),
        ts('send_retry_at'),
        sa.Column('send_backoff_step', sa.Integer(), nullable=False),
        sa.CheckConstraint('id = 1', name='ck_site_settings_one_row'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.bulk_insert(table, [_copy()])


def downgrade() -> None:
    op.drop_table('site_settings')
