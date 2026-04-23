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
