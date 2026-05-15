import pytest

from mathion.api.helpers import slugify


@pytest.mark.parametrize(
    "title,expected",
    [
        # Pure-Latin alphanumeric
        ("hello", "hello"),
        ("Hello", "hello"),
        ("HELLO123", "hello123"),
        # Mixed punctuation runs collapse to single dashes
        ("Confidence intervals (part 1)", "confidence-intervals-part-1"),
        ("foo   bar", "foo-bar"),
        ("foo---bar", "foo-bar"),
        ("foo  -  bar", "foo-bar"),
        # Leading / trailing punctuation strips
        ("  hello  ", "hello"),
        ("---hello---", "hello"),
        ("!hello!", "hello"),
        # All-uppercase → lowercase
        ("HELLO WORLD", "hello-world"),
        # All-Cyrillic → ""
        ("Привет мир", ""),
        # Empty string
        ("", ""),
        # Single dash / whitespace
        ("-", ""),
        ("   ", ""),
        # Punctuation only
        ("!!!", ""),
        ("---", ""),
        # Mixed Cyrillic + Latin keeps only Latin
        ("Привет hello мир 1", "hello-1"),
        # 200-char Latin title — slugify itself does NOT truncate
        ("a" * 200, "a" * 200),
    ],
)
def test_slugify(title, expected):
    assert slugify(title) == expected


def test_slugify_does_not_truncate_long_titles():
    # Confirms the endpoint is responsible for length rejection, not slugify.
    long_input = "x" * 500
    assert slugify(long_input) == "x" * 500
