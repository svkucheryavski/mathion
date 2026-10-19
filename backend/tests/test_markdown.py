import time

import pytest

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


# D54: only text that starts with http:// or https:// becomes a link.
@pytest.mark.parametrize("md, href", [
    ("Read https://example.org/path?q=1 first.", "https://example.org/path?q=1"),
    ("Plain http://example.org here.", "http://example.org"),
    ("A paren URL https://en.wikipedia.org/wiki/Function_(mathematics) works.",
     "https://en.wikipedia.org/wiki/Function_(mathematics)"),
    ("(see https://en.wikipedia.org/wiki/Function_(mathematics))",
     "https://en.wikipedia.org/wiki/Function_(mathematics)"),
    ("see https://x.org.", "https://x.org"),
    ("Mail <a@b.org> on purpose.", "mailto:a@b.org"),
])
def test_render_bare_url_becomes_one_link(md, href):
    result = render_markdown(md)
    assert f'href="{href}"' in result
    assert result.count("<a ") == 1
    assert 'rel="noopener noreferrer"' in result


def test_render_bare_url_keeps_trailing_punctuation_outside_the_link():
    result = render_markdown("see https://x.org.")
    assert 'href="https://x.org."' not in result
    assert "</a>." in result


def test_render_bare_url_in_parentheses_keeps_the_closing_paren_outside():
    result = render_markdown("(see https://en.wikipedia.org/wiki/Function_(mathematics))")
    assert "</a>)" in result


def test_render_bare_url_uppercase_scheme_is_linked():
    # The renderer keeps the scheme's case; the frontend's URL parser lowercases it (D58).
    assert "<a " in render_markdown("HTTPS://X.ORG/A")


@pytest.mark.parametrize("md", [
    "`https://example.org` in code",
    "```\nhttps://example.org\n```",
    "    https://example.org indented code",
    "Math $x = https://example.org$ inline.",
    "$$\nhttps://example.org\n$$",
    "Escaped http\\://example.com/ stays text.",
    "Visit www.example.org today.",
    "Visit example.org today.",
    "Run numpy.py now.",
    "Write to a@b.org please.",
    "Write to mailto:a@b.org please.",
    "Get ftp://files.example.org/x here.",
    "Load //cdn.example.org/x here.",
])
def test_render_text_that_is_not_a_full_url_stays_plain(md):
    assert "<a" not in render_markdown(md)


@pytest.mark.parametrize("md", [
    "[text](https://example.org)",
    "<https://example.org>",
])
def test_render_existing_link_stays_one_link(md):
    assert render_markdown(md).count("<a ") == 1


# D64: the rule is our own (no linkify-it-py); these pin its edges.
def test_render_bare_url_href_has_a_lowercase_scheme_and_the_text_as_written():
    result = render_markdown("HTTPS://X.ORG/A")
    assert 'href="https://X.ORG/A"' in result
    assert ">HTTPS://X.ORG/A</a>" in result


def test_render_bare_url_keeps_underscores_and_stars_inside_the_address():
    result = render_markdown("See https://x.org/a_b_c*d for it.")
    assert 'href="https://x.org/a_b_c*d"' in result
    assert "<em>" not in result


def test_render_bare_url_in_brackets_keeps_the_closing_bracket_outside():
    result = render_markdown("[see https://x.org]")
    assert 'href="https://x.org"' in result
    assert "</a>]" in result


@pytest.mark.parametrize("md", [
    "A scheme alone https:// is not an address.",
    "Glued foohttps://x.org stays text.",
])
def test_render_scheme_without_an_address_or_glued_to_a_word_stays_plain(md):
    assert "<a" not in render_markdown(md)


def test_render_bare_url_next_to_an_autolink_makes_two_links():
    result = render_markdown("<https://x.org> and https://y.org")
    assert result.count("<a ") == 2
    assert 'href="https://y.org"' in result


def test_render_bare_url_inside_emphasis_is_linked():
    result = render_markdown("*see https://x.org now*")
    assert "<em>" in result
    assert 'href="https://x.org"' in result


def test_render_bare_url_with_many_closing_parens_stays_fast():
    start = time.perf_counter()
    result = render_markdown("https://x.org/" + ")" * 20000)
    assert time.perf_counter() - start < 1.0
    assert 'href="https://x.org/"' in result


# D65: the link text is the address exactly as typed (no decoded spaces or
# look-alike letters), and only the characters URLs use (RFC 3986) belong to it.
@pytest.mark.parametrize("md, text", [
    ("See https://x.org/a%20b here.", "https://x.org/a%20b"),
    ("See https://xn--bcher-kva.de/x here.", "https://xn--bcher-kva.de/x"),
])
def test_render_bare_url_text_is_the_address_as_typed(md, text):
    assert f">{text}</a>" in render_markdown(md)


@pytest.mark.parametrize("md, href, rest", [
    ("See https://x.org/a|b here.", "https://x.org/a", "|b here."),
    ("See https://x.org/{a} here.", "https://x.org/", "{a} here."),
    ("See https://x.org/a^b here.", "https://x.org/a", "^b here."),
    # D66: quotes are not letters, so a quoted address still links.
    ("See \u201ehttps://x.org\u201c here.", "https://x.org", "\u201c here."),
    ("See \u00abhttps://x.org\u00bb here.", "https://x.org", "\u00bb here."),
])
def test_render_bare_url_ends_at_a_character_urls_do_not_use(md, href, rest):
    result = render_markdown(md)
    assert f'href="{href}"' in result
    assert f"</a>{rest}" in result


@pytest.mark.parametrize("md", [
    "See https://\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444 here.",
    # Unicode case-fold look-alikes of k, s and i (Kelvin sign, long s, dotted I).
    "See https://\u212a.org here.",
    "See http\u017f://x.org here.",
    "See https://\u0130x.org here.",
    # Glued to a non-ASCII letter: still not the start of an address.
    "See \u00e9https://x.org here.",
    # D66: an address that runs straight into a letter stays plain as a whole,
    # never a cut link to another site or page (https://b, https://x.org/caf).
    "See https://b\u00fccher.de here.",
    "See https://x.org/caf\u00e9 here.",
    "See https://x.org/\u212aelvin here.",
    # D66, the whole address: an address inside the skipped rest is not linked.
    "See https://x.org/caf\u00e9/https://y.org here.",
    "See https://b\u00fccher.de/?u=https://y.org here.",
    # D66 across tokens: a letter written as an entity or escape, then the rest.
    "See https://b&uuml;cher.de here.",
    "See https://x.org/caf&eacute; here.",
    "See https://x.org/a&#49; here.",
    "See https://x.org/a\\_b here.",
    "See https://b&uuml;cher.de/?u=https://y.org here.",
    # D66 with a decomposed accent (a letter, then a combining mark).
    "See https://x.org/a\u0301 here.",
    "See https://bu\u0308cher.de here.",
    # D66 at any inline seam: an address glued to emphasis, a dunder name or code.
    "See https://docs.python.org/3/reference/datamodel.html#object.__init__ here.",
    "See https://example.com/files/__pycache__/x here.",
    "See https://x.org/caf*\u00e9* here.",
    "See https://x.org/`code` here.",
    "See https://x.org/__init__/https://y.org here.",
    # Past a closing delimiter the next token still decides: a letter glues.
    "See *https://x.org/caf*\u00e9 here.",
])
def test_render_address_of_non_url_characters_stays_plain(md):
    assert "<a" not in render_markdown(md)


def test_render_address_after_a_plain_one_still_links():
    # D66 leaves only the glued address plain; the next word starts afresh.
    result = render_markdown("See https://b\u00fccher.de and https://y.org here.")
    assert result.count("<a ") == 1
    assert 'href="https://y.org"' in result



@pytest.mark.parametrize("md", [
    "See https://x.org *note* here.",
    "See https://x.org\nnext line.",
    "See https://x.org  \nnext line.",
    "See https://x.org `code` here.",
])
def test_render_address_before_a_space_or_line_break_still_links(md):
    # D66 leaves plain only what is glued; a space or a line break ends the address.
    assert 'href="https://x.org"' in render_markdown(md)


@pytest.mark.parametrize("md, href", [
    ("**https://x.org**", "https://x.org"),
    ("*https://x.org*", "https://x.org"),
    ("_https://x.org_", "https://x.org"),
    ("*see https://x.org*", "https://x.org"),
    ("Read *https://x.org/paper.pdf*.", "https://x.org/paper.pdf"),
    ("(**https://x.org**)", "https://x.org"),
    ("# **https://x.org**", "https://x.org"),
    ("> *https://x.org*", "https://x.org"),
    ("**Docs**: **https://docs.python.org**", "https://docs.python.org"),
])
def test_render_address_last_inside_emphasis_links(md, href):
    # A closing delimiter is not a letter: the address before it is whole (D66).
    assert f'href="{href}"' in render_markdown(md)
