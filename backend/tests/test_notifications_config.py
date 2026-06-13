import pytest
from pydantic import ValidationError
from mathion.config import Settings


@pytest.mark.parametrize("bad_url,reason", [
    ("javascript:alert(1)",                       "non-http scheme"),
    ("http:///",                                  "empty netloc"),
    ("file:///etc/passwd",                        "non-http scheme"),
    ("http://example.com\r\nX-Inject:1",          "CRLF control chars"),
    ("http://example.com\x00",                    "NUL byte"),
    ("http://example.com /path",                  "embedded space"),
    ("http://example.com\t",                      "TAB"),
    ("https://mathion.example.com@attacker.com",  "userinfo phishing form"),
    ("http://user:pass@example.com",              "userinfo bare"),
    ("http://example.com:bad",                    "invalid port"),
    ("http://example.com:99999",                  "port out of range"),
    ("http://example.com?utm=x",                  "query string"),
    ("http://example.com#frag",                   "fragment"),
    ("http://example.com/admin",                  "path-prefix"),
])
def test_base_url_rejects_bad(bad_url, reason):
    with pytest.raises(ValidationError):
        Settings(base_url=bad_url)


@pytest.mark.parametrize("good_url,expected", [
    ("http://example.com/",       "http://example.com"),
    ("http://example.com",        "http://example.com"),
    ("https://example.com",       "https://example.com"),
    ("http://example.com:8080",   "http://example.com:8080"),
])
def test_base_url_accepts_good(good_url, expected):
    s = Settings(base_url=good_url)
    assert s.base_url == expected


@pytest.mark.parametrize("bad_path", ["./mathion.lock", "mathion.lock"])
def test_dispatcher_lock_path_rejects_relative(bad_path):
    with pytest.raises(ValidationError):
        Settings(dispatcher_lock_path=bad_path)


@pytest.mark.parametrize("good_path", [
    "/tmp/mathion.dispatcher.lock",
    "/var/run/mathion/dispatcher.lock",
])
def test_dispatcher_lock_path_accepts_absolute(good_path):
    s = Settings(dispatcher_lock_path=good_path)
    assert s.dispatcher_lock_path == good_path
