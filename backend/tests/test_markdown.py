from mathion.markdown import render_markdown


def test_render_basic_markdown():
    result = render_markdown("**bold** and *italic*")
    assert "<strong>bold</strong>" in result
    assert "<em>italic</em>" in result


def test_render_heading():
    result = render_markdown("# Title")
    assert "<h1>" in result


def test_render_sanitize_script():
    result = render_markdown('<script>alert("xss")</script>')
    assert "<script>" not in result


def test_render_empty_string():
    result = render_markdown("")
    assert result == ""


def test_render_none():
    result = render_markdown(None)
    assert result == ""


def test_render_code_block():
    result = render_markdown("```python\nprint('hello')\n```")
    assert "<code>" in result


def test_render_latex_inline():
    """Inline LaTeX $x_i$ should be wrapped in math span, not corrupted by emphasis."""
    result = render_markdown("The variable $x_i$ is important")
    # dollarmath plugin wraps in <span class="math">
    assert "x_i" in result
    assert "<em>" not in result  # underscore must not trigger emphasis


def test_render_latex_block():
    result = render_markdown("$$E = mc^2$$")
    assert "E = mc^2" in result


def test_render_javascript_uri_not_linked():
    """javascript: URIs must not appear in href attributes."""
    result = render_markdown("[click](javascript:alert(1))")
    assert 'href="javascript:' not in result
    assert "<a" not in result  # markdown-it refuses to create the link entirely


def test_render_link_preserved():
    result = render_markdown("[example](https://example.com)")
    assert 'href="https://example.com"' in result


def test_render_image_preserved():
    result = render_markdown("![alt text](https://example.com/img.png)")
    assert 'src="https://example.com/img.png"' in result


def test_render_ordered_list_start_preserved():
    """`start` survives sanitisation, so a resumed list keeps its own numbers.

    markdown-it emits `<ol start="3">` for a list beginning at 3, but nh3 drops
    any attribute not in the allow-list. While the frontend forced bullets onto
    every `<ol>` this was invisible; once ordered lists render as numbers, a
    stripped `start` silently renumbers a teacher's "3. 4. 5." to "1. 2. 3." —
    a wrong statement in a maths derivation rather than merely unstyled markup.
    """
    result = render_markdown("3. third\n4. fourth\n5. fifth\n")
    assert '<ol start="3">' in result
    assert "<li>third</li>" in result


def test_render_ordered_list_start_absent_when_list_starts_at_one():
    """No spurious attribute on the ordinary case — markdown-it omits it."""
    result = render_markdown("1. first\n2. second\n")
    assert "<ol>" in result
    assert "start=" not in result


def test_render_ordered_list_start_is_the_only_ol_attribute():
    """The allow-list widened by exactly one attribute, not by a wildcard.

    Asserted against the allow-list itself rather than through a rendered
    `<ol class=...>`: `_md` is built with `html=False`, so raw HTML is escaped
    to text and never reaches nh3 at all — a round-trip test here would pass no
    matter what the allow-list said.
    """
    from mathion.markdown import _ALLOWED_ATTRS

    assert _ALLOWED_ATTRS["ol"] == {"start"}
