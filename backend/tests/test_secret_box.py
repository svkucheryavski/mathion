"""D8: the SMTP password sealed with keys derived from the secret key, and
D9a's keyed fingerprint of what a test email tested."""
import base64

import pytest

from mathion.secret_box import SealError, fingerprint, seal, unseal

K = "k" * 48
K2 = "q" * 48


def test_round_trip():
    assert unseal(seal("pässwörd", K), K) == "pässwörd"


def test_wrong_secret_raises():
    with pytest.raises(SealError):
        unseal(seal("x", K), K2)


def test_tampered_blob_raises():
    blob = seal("secret", K)
    raw = bytearray(base64.b64decode(blob[3:]))
    raw[16] ^= 1  # the first ciphertext byte
    with pytest.raises(SealError):
        unseal("v1:" + base64.b64encode(bytes(raw)).decode(), K)


def test_unknown_prefix_raises():
    with pytest.raises(SealError):
        unseal("v2:" + seal("x", K)[3:], K)


def test_bad_base64_raises():
    with pytest.raises(SealError):
        unseal("v1:not base64!", K)


def test_nonce_is_random():
    assert seal("same", K) != seal("same", K)


def test_fingerprint_keyed_and_stable():
    fields = {"host": "mail.uni.dk", "port": 587, "password": "pw", "skip": False}
    assert fingerprint(fields, K) == fingerprint(dict(reversed(list(fields.items()))), K)
    assert fingerprint(fields, K) != fingerprint(fields, K2)
    assert fingerprint(fields, K) != fingerprint({**fields, "password": "pw2"}, K)
