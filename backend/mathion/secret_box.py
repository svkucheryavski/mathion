"""The SMTP password at rest (D8) and the test-email fingerprint (D9a).

Standard library only: the keystream is HMAC-SHA256 in counter mode over a
random 16-byte nonce, encrypt-then-MAC with a separate HMAC-SHA256 tag. The
three keys come from the server's secret key with distinct labels, so a
database backup (which never holds `.env`) reveals neither the password nor a
hash of it. The stored form is `v1:` + base64(nonce ‖ ciphertext ‖ tag).

The site_settings migration carries a frozen copy of `seal`; change the
format only with a new prefix.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
from collections.abc import Mapping

_PREFIX = "v1:"
_NONCE = 16
_TAG = 32


class SealError(Exception):
    """The sealed text can't be opened with this secret (another server's key,
    a damaged value, or an unknown format)."""


def _key(secret: str, label: bytes) -> bytes:
    return hmac.new(secret.encode(), label, hashlib.sha256).digest()


def _stream(key: bytes, nonce: bytes, n: int) -> bytes:
    out = bytearray()
    i = 0
    while len(out) < n:
        out += hmac.new(key, nonce + i.to_bytes(4, "big"), hashlib.sha256).digest()
        i += 1
    return bytes(out[:n])


def seal(plain: str, secret: str) -> str:
    data = plain.encode()
    nonce = os.urandom(_NONCE)
    ct = bytes(a ^ b for a, b in zip(data, _stream(_key(secret, b"mathion-smtp-stream"), nonce, len(data))))
    tag = hmac.new(_key(secret, b"mathion-smtp-tag"), b"v1" + nonce + ct, hashlib.sha256).digest()
    return _PREFIX + base64.b64encode(nonce + ct + tag).decode()


def unseal(blob: str, secret: str) -> str:
    if not blob.startswith(_PREFIX):
        raise SealError("unknown format")
    try:
        raw = base64.b64decode(blob[len(_PREFIX):], validate=True)
    except (binascii.Error, ValueError):
        raise SealError("not base64") from None
    if len(raw) < _NONCE + _TAG:
        raise SealError("too short")
    nonce, ct, tag = raw[:_NONCE], raw[_NONCE:-_TAG], raw[-_TAG:]
    want = hmac.new(_key(secret, b"mathion-smtp-tag"), b"v1" + nonce + ct, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, want):
        raise SealError("tag mismatch")
    data = bytes(a ^ b for a, b in zip(ct, _stream(_key(secret, b"mathion-smtp-stream"), nonce, len(ct))))
    try:
        return data.decode()
    except UnicodeDecodeError:
        raise SealError("not text") from None


def fingerprint(fields: Mapping[str, str | int | bool | None], secret: str) -> str:
    """A keyed digest of what a test email tested (D9a): equal fields give the
    same value, and without the secret it can't be used to guess the password."""
    canonical = json.dumps(dict(fields), sort_keys=True, separators=(",", ":"))
    return hmac.new(_key(secret, b"mathion-smtp-fingerprint"), canonical.encode(), hashlib.sha256).hexdigest()
