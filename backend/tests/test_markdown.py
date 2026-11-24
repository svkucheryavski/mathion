import random
import time
import xml.etree.ElementTree as ET

import pytest

import mathion.markdown as markdown_mod
from mathion.latex_mathml import latex_to_mathml
from mathion.markdown import MATHML_ALLOWED, _clean, extract_asset_filenames, render_markdown
from tests.test_latex_mathml import ACCEPTANCE


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
    """Inline LaTeX $x_i$ becomes MathML, not corrupted by emphasis."""
    result = render_markdown("The variable $x_i$ is important")
    assert "<math><semantics>" in result and "x_i</annotation>" in result
    assert "<em>" not in result  # underscore must not trigger emphasis


def test_render_latex_block():
    result = render_markdown("$$E = mc^2$$")
    assert result.startswith('<div class="math-display"><math display="block">')
    assert "E = mc^2</annotation>" in result


def test_url_inside_math_is_typeset_not_linked():
    out = render_markdown("Math $x = https://example.org$ inline.")
    assert out.count("<math") == 1 and "<a " not in out


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
    assert "<a " not in render_markdown(md)  # not <annotation


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
    # VR-B: a trimmed "." before a seam still glues, as in object.__init__ above.
    "See https://x.org.**Note** that",
    # VR-B: past the empty token a ** closer leaves, math or code still glues.
    "See **https://x.org**$x$ here.",
    "See **https://x.org**`c` here.",
    # VR-B: a closer whose opener is not right before the address is no boundary.
    "See https://x.org/path)\u00e9/more here.",
    "See https://x.org/a)b(c)\u00e9 here.",
    "(see https://x.org)\u00e9",
    "See (https://x.org/caf\u00e9) here.",
    "See [https://b\u00fccher.de] here.",
    # VR-B: the opener must partner the trimmed closer, not one the address keeps.
    "(https://x.org/a)b)\u00e9 here",
    "(https://x.org)(https://y.org)\u00e9",
    "(see https://x.org.)__init__",
    "https://x.org\u00e9/https://a.org/(x https://b.org)\u00e9 here",
    "https://a.org/\u00e9/https://b.org/(x https://c.org)\u00e9",
    "*https://x.org/caf*\u00e9/(x https://b.org)\u00e9 here",
    "*https://x.org/caf*$x$",
])
def test_render_address_of_non_url_characters_stays_plain(md):
    assert "<a " not in render_markdown(md)  # not <annotation


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


# Polish 3 C11: a link whose address nh3 strips stays plain text, not an
# <a> with no href.
@pytest.mark.parametrize("url", [
    "https://a.b:99999999",
    "https://%zz.org",
    "https:///",
    "https://[::1]/x",
])
def test_bare_urls_nh3_strips_stay_plain_text(url):
    result = render_markdown(f"see {url} here")
    assert "<a" not in result
    assert url in result


@pytest.mark.parametrize("src,text", [
    ("[t](https://%zz.org)", "t"),
    ("<https://%zz.org>", "https://%zz.org"),
    ('[**bold** t](https://%zz.org "a title")', "<strong>bold</strong> t"),
    # nh3 does not escape < or > inside an attribute value (probed), so the
    # check is not a pattern over its output.
    ('[t](https://%zz.org "a>b")', "<p>t</p>"),
    ('[t](https://%zz.org "<a href=x>")', "<p>t</p>"),
    ('[![pic](x.png "</a>")](https://%zz.org)', '<img src="x.png" alt="pic" title="</a>">'),
])
def test_authored_link_with_a_bad_href_stays_plain_text(src, text):
    result = render_markdown(src)
    assert "<a" not in result
    assert text in result


def test_good_links_next_to_a_stripped_one_keep_their_href():
    result = render_markdown("[ok](https://example.com) and [bad](https://%zz.org) and https://x.org")
    assert result.count("<a ") == 2
    assert 'href="https://example.com"' in result and 'href="https://x.org"' in result
    assert "bad" in result


def test_loose_list_gets_class():
    # VR-B: a loose list is marked by the renderer, even with no paragraph in it.
    loose = render_markdown("- ```\n  a\n  ```\n\n- ```\n  b\n  ```\n")
    assert '<ul class="loose">' in loose
    assert "<p>" not in loose
    assert '<ol class="loose">' in render_markdown("1. ```\n   a\n   ```\n\n2. ```\n   b\n   ```\n")
    assert '<ol start="3" class="loose">' in render_markdown("3. a\n\n4. b\n")
    tight = render_markdown("- a\n- b\n\n1. c\n2. d\n")
    assert "<ul>" in tight and "<ol>" in tight
    assert "class=" not in tight


def test_loose_is_the_only_class_kept_on_lists():
    from mathion.markdown import _clean

    out = _clean('<ul class="loose x"><li class="loose">a</li></ul><p class="loose">b</p>'
                 '<ol class="tight"><li>c</li></ol><span class="math math-error">m</span>')
    assert out == ('<ul class="loose"><li>a</li></ul><p>b</p>'
                   '<ol class=""><li>c</li></ol><span class="math-error">m</span>')


@pytest.mark.parametrize("md", [
    "(https://x.org)*note*",
    "[https://x.org]*note*",
    "(https://x.org.)__init__",
    "(https://x.org)\u00e9",
    # A stray closer earlier in the text does not cancel the address's opener.
    "a) see (https://x.org)\u00e9",
    ":-) (https://x.org)\u00e9",
    "Options: a) foo (https://x.org)*note*",
])
def test_bare_url_trimmed_boundary_links(md):
    # VR-B: a trimmed closer whose opener sits right before the address ends it, even at a seam.
    result = render_markdown(md)
    assert 'href="https://x.org"' in result
    assert result.count("<a ") == 1


def test_bare_url_opener_is_used_once():
    # VR-B: the "(" closed after the first address does not open the second.
    result = render_markdown("(https://a.org) https://b.org/p)\u00e9 here")
    assert result.count("<a ") == 1
    assert 'href="https://a.org"' in result


@pytest.mark.parametrize("md, first", [
    ("See https://a.org/(x https://b.org)\u00e9 here", "https://a.org/(x"),
    ("(see https://a.org/x)y and https://b.org)\u00e9 here", "https://a.org/x)y"),
    ("See https://a.org/[x https://b.org]\u00e9 here", "https://a.org/%5Bx"),
])
def test_bare_url_bracket_inside_an_address_is_not_prose(md, first):
    # VR-B: a "(" in the first address does not open the second.
    result = render_markdown(md)
    assert result.count("<a ") == 1
    assert f'href="{first}"' in result


def test_bare_url_wrapped_keeps_its_inner_pair():
    result = render_markdown("(https://x.org/(a))\u00e9 here")
    assert 'href="https://x.org/(a)"' in result
    assert result.count("<a ") == 1


def test_bare_url_skips_empty_text_token():
    # VR-B: a spent delimiter's empty text token does not end the look-past.
    assert "<a" not in render_markdown("*https://x.org/caf*__é__")


def test_bare_url_entity_ends_link():
    # VR-B (call 11): an &amp; ends the link, as in markdown-it's own linkify.
    result = render_markdown("https://x.org/?a=1&amp;b=2")
    assert 'href="https://x.org/?a=1"' in result
    assert result.count("<a ") == 1


# Math typesetting (Task 4): Mathion's own dollar rule, render rules and sanitiser.
@pytest.mark.parametrize("md,has_math,raw_kept", [
    (r"$n$ is the sample size, here 30", 1, None),
    (r"$\alpha$=0.05", 1, None),
    ("With $n$ = 30", 1, None),
    ("It costs $5 and $10", 0, "$5 and $10"),
    ("$5-$10", 0, "$5-$10"),
    ("2$x$", 0, "2$x$"),
    ("$ x $", 0, "$ x $"),
    ("$5 and $10 and $x$", 1, "$5 and $10 and "),
    (r"$x = 5\$$", 1, None),
    (r"\$$x$", 1, None),
    (r"a \$ b", 0, "a $ b"),
    ("see $$ x $$ here", 1, None),
    ("text\n$$\nx\n$$", 1, None),
    ("costs $$5", 0, "costs $$5"),
    ("`$x$`", 0, "$x$"),
    # review round 1: each test of the rule on its own
    ("$ x$", 0, "$ x$"),
    ("$x$$", 0, "$x$$"),
    ("$x$$y$", 0, "$x$$y$"),
])
def test_dollar_rule_cases(md, has_math, raw_kept):
    out = render_markdown(md)
    assert out.count("<math") == has_math
    if raw_kept:
        assert raw_kept in out


def test_display_block_own_paragraph():
    out = render_markdown("$$\nx^2\n$$")
    assert out.startswith('<div class="math-display"><math display="block">')


def test_display_inside_paragraph_is_span():
    out = render_markdown("a $$x$$ b")
    assert '<p>a <span class="math-display"><math display="block">' in out and "</span> b</p>" in out


def test_blockquote_display_drops_markers():
    out = render_markdown("> $$\n> x\n> $$")
    assert '<blockquote>\n<div class="math-display"><math display="block"><semantics><mrow><mi>x</mi></mrow>' in out


def test_list_item_display():
    assert '<li>\n<div class="math-display"><math display="block">' in render_markdown("- $$\n  x\n  $$")


def test_unclosed_display_stops_at_blank_line():
    out = render_markdown("$$\nx\n\nnext para")
    assert "<p>next para</p>" in out


def test_backslash_parity():
    assert render_markdown(r"\\$x$").count("<math") == 1      # escaped backslash, live dollar
    assert render_markdown(r"\$x$").count("<math") == 0


def test_display_error_inside_paragraph_is_span():
    assert '<p>a <span class="math-error"' in render_markdown(r"a $$\foo$$ b")


def test_two_displays_on_one_line_fall_through():
    assert render_markdown("$$a$$ and $$b$$").count('<span class="math-display">') == 2


def test_escaped_closing_double_dollar_falls_through():
    out = render_markdown(r"$$x\$$")
    assert "<math" not in out and "math-error" not in out and out.startswith("<p>")


def test_error_span_escapes_source_and_reason():
    out = render_markdown(r"$\foo<b>$")
    assert out.count('class="math-error"') == 1 and "<b>" not in out
    assert 'title="unknown command `\\foo`"' in out


def test_error_block_is_div():
    assert render_markdown("$$\n\\foo\n$$").startswith('<div class="math-error"')


def test_unexpected_converter_exception_becomes_error_span(monkeypatch):
    monkeypatch.setattr(markdown_mod, "latex_to_mathml", lambda s, d: 1 / 0)
    assert 'title="formula could not be read"' in render_markdown("$x$")


def test_sanitiser_keeps_mathml_and_drops_unknown_classes():
    out = _clean('<span class="evil math-error" title="r">x</span><math><mi onclick="x">a</mi></math>')
    assert 'class="math-error"' in out and "evil" not in out and "onclick" not in out and 'title="r"' in out
    assert "<math><mi>a</mi></math>" in out
    out = _clean('<math><mo class="math-acc evil">a</mo><mrow class="math-overline math-underline evil">b</mrow><mi class="math-acc">c</mi></math>')
    assert '<mo class="math-acc">' in out and '<mrow class="math-overline math-underline">' in out
    assert "evil" not in out and '<mi class' not in out
    assert '<mo class="math-vec">' in _clean('<math><mo class="math-vec evil">→</mo></math>')


SANITISE = ACCEPTANCE + [r"\binom{n}{k}", r"\big(\dfrac{a}{b}\big)", r"\underline{x}",
    r"\lim_{n\to\infty}", r"a\,b", r"\sqrt[3]{x}", r"\text{a b}", r"\mathrm{d}x", r"\tfrac12",
    r"\left(-x\right)", r"\hat{\beta}", r"\sum\limits_i", r"\overline{x}", r"\bar{x}",
    r"\vec{v}", r"\Big(x\Big)", r"x^{\displaystyle y}", r"\dfrac ab"]


def _tree(markup):                       # nested tags, attributes, exact text and tails
    def walk(e):
        return (e.tag, sorted(e.attrib.items()), e.text or "", [walk(c) for c in e], e.tail or "")
    return walk(ET.fromstring(markup.replace("&nbsp;", " ")))


@pytest.mark.parametrize("src", SANITISE)
@pytest.mark.parametrize("display", [False, True])
def test_sanitiser_keeps_every_emitted_tag_and_attribute(src, display):
    raw = latex_to_mathml(src, display)
    assert _tree(_clean(raw)) == _tree(raw)


SPEC_MAP = {   # copied from the spec's sanitiser map, independent of markdown.py
    "math": {"display"}, "semantics": set(), "annotation": {"encoding"}, "mrow": set(),
    "mi": {"mathvariant"}, "mn": set(), "mtext": set(), "mspace": {"width", "height", "depth"},
    "mo": {"stretchy", "largeop", "movablelimits", "fence", "form", "lspace", "rspace", "minsize", "maxsize"},
    "msup": set(), "msub": set(), "msubsup": set(), "mfrac": {"linethickness"}, "msqrt": set(),
    "mroot": set(), "mover": {"accent"}, "munder": {"accentunder"}, "munderover": set(),
    "mstyle": {"displaystyle", "scriptlevel"},
}


def test_allowlist_matches_spec():
    assert MATHML_ALLOWED == SPEC_MAP


@pytest.mark.parametrize("tag,attrs", SPEC_MAP.items())
def test_every_allowed_tag_and_attribute_survives_clean(tag, attrs):
    inner = "<" + tag + "".join(f' {a}="v"' for a in sorted(attrs)) + ">t</" + tag + ">"
    snippet = inner if tag == "math" else "<math>" + inner + "</math>"
    assert _tree(_clean(snippet)) == _tree(snippet)


def test_render_markdown_never_raises():
    rng = random.Random(1118)
    pool = [chr(c) for c in range(32, 0x2FFF, 37)] + list("$\\{}^_\n") + ["$$", r"\frac", r"\left", r"\sqrt"]
    for n in (1, 50, 400, 1990, 2010):
        for _ in range(60):
            render_markdown("".join(rng.choice(pool) for _ in range(n)))


def test_asset_extraction_ignores_math_code_and_escapes():
    assert extract_asset_filenames(r"$E[X](t)$ and ![a](pic.png)") == {"pic.png"}
    assert extract_asset_filenames("`[x](y)` and \\[a\\](b)") == set()


@pytest.mark.parametrize("md,code", [
    ("The fee is $5. In R use `df$col`.", "<code>df$col</code>"),    # owner: never end inside code
    ("It costs $5, see `$price`", "<code>$price</code>"),
    ("Cost $5 and ``a$b`` here", "<code>a$b</code>"),
    ("see $$a `b$$` c", "<code>b$$</code>"),
])
def test_formula_never_ends_inside_a_code_span(md, code):
    out = render_markdown(md)
    assert code in out and "<math" not in out and "math-error" not in out


def test_formula_before_a_code_span_still_works():
    out = render_markdown("Use $x$ and `df$col` here")
    assert out.count("<math") == 1 and "<code>df$col</code>" in out


def test_double_dollar_right_after_another_formula():
    assert render_markdown("$$a$$$$b$$").count('<span class="math-display">') == 2


@pytest.mark.parametrize("md,items", [
    ("- $$a\n- b$$", 2),
    ("1. $$\n   x\n2. y $$", 2),
])
def test_display_block_stops_at_the_list_item_edge(md, items):
    out = render_markdown(md)
    assert out.count("<li>") == items and "<math" not in out


def test_display_block_inside_a_list_item_still_works():
    out = render_markdown("- $$\n  x\n  $$\n- b")
    assert out.count("<li>") == 2 and out.count('<div class="math-display">') == 1


@pytest.mark.parametrize("md", [r"$$a\ $$", "$$\na\\ \n$$"])
def test_trailing_control_space_is_kept(md):
    out = render_markdown(md)
    assert "<math" in out and "math-error" not in out


def test_backslash_parity_at_the_closer():
    out = render_markdown(r"$x\\$ y$")            # \\ is a backslash pair, so this $ closes
    assert out.count('class="math-error"') + out.count("<math") == 1 and " y$" in out
    assert render_markdown(r"\\$$x$$").count('<span class="math-display">') == 1


def test_error_reason_quotes_are_escaped():
    out = render_markdown(r'$\begin{" x="}$')
    assert "x=&quot;" in out and ' x="' not in out.split(">", 2)[1]


def test_formula_in_a_link_label():
    out = render_markdown("[$x$](u)")
    assert out.startswith('<p><a href="u"') and "<math" in out
    out = render_markdown("[a $x](u) b$")
    assert "<a " not in out and out.count("<math") == 1



@pytest.mark.parametrize("md,codes", [
    ("Price $5. Type `\\` then `df$col`.", ["<code>\\</code>", "<code>df$col</code>"]),   # no escapes inside code
    ("Use $5 for ``a`b`` and `x$y`.", ["<code>a`b</code>", "<code>x$y</code>"]),        # runs pair by length
    ("Cost $5 `` and `df$col`.", ["<code>df$col</code>"]),                               # an unmatched run is text
])
def test_code_spans_pair_as_markdown_it_does(md, codes):
    out = render_markdown(md)
    assert all(c in out for c in codes) and "<math" not in out and "math-error" not in out


@pytest.mark.parametrize("md", [r"$x \text{ is ``big''}$", "$a ` b$", r"$x `a\` b$"])
def test_backticks_that_open_no_code_span_keep_the_formula(md):
    out = render_markdown(md)
    assert out.count("<math") + out.count('class="math-error"') == 1


def test_display_blocks_in_a_long_list_stay_fast():
    start = time.perf_counter()
    render_markdown("- $$x\n" * 8000 + "$$")
    assert time.perf_counter() - start < 2.0


@pytest.mark.parametrize("md", [
    "# Topic\nSome teaching notes.\n" * 8000,
    "```\nx = 1\n```\n" * 8000,
])
def test_math_free_markdown_stays_fast(md):
    start = time.perf_counter()
    render_markdown(md)
    assert time.perf_counter() - start < 2.0


# --- math round 2026-11-24 ---

@pytest.mark.parametrize("md, html", [
    ('$$\nx\n$$',
     '<div class="math-display"><math display="block"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></div>\n'),
    ('$$x$$',
     '<div class="math-display"><math display="block"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></div>\n'),
    ('$$\na\n$b$\n$$',
     '<p><span class="math-display"><math display="block"><semantics><mrow><mi>a</mi><mo lspace="0em" rspace="0em">$</mo><mi>b</mi><mo lspace="0em" rspace="0em">$</mo></mrow><annotation encoding="application/x-tex">a\n$b$</annotation></semantics></math></span></p>\n'),
    ('$$\na\n\\$\n$$',
     '<div class="math-display"><math display="block"><semantics><mrow><mi>a</mi><mo lspace="0em" rspace="0em">$</mo></mrow><annotation encoding="application/x-tex">a\n\\$</annotation></semantics></math></div>\n'),
    ('- $$\n  x\n  $$',
     '<ul>\n<li>\n<div class="math-display"><math display="block"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></div>\n</li>\n</ul>\n'),
    ('> $$\n> x\n> $$',
     '<blockquote>\n<div class="math-display"><math display="block"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></div>\n</blockquote>\n'),
])
def test_dollar_block_bound_keeps_results(md, html):
    assert render_markdown(md) == html


@pytest.mark.parametrize("md, alt", [
    ("![a $x$ b](p.png)", "a x b"),
    ("![a $$ x $$ b](p.png)", "a x b"),
    ("![$\\alpha$](p.png)", "\\alpha"),
    ("![a $\\frac{a}$ b](p.png)", "a \\frac{a} b"),
    ("![price \\$5](p.png)", "price $5"),
    ("![a \\* b](p.png)", "a * b"),
    ("![a &amp; b](p.png)", "a &amp; b"),
    ('![a "q" $x$](p.png)', "a &quot;q&quot; x"),
    ("![a ![b $x$](q.png) c](p.png)", "a b x c"),
    ("![a  \nb](p.png)", "a\nb"),
    ("![a\\\nb](p.png)", "a\nb"),
    ("![a ![b \\$](q.png)](p.png)", "a b $"),
    ("![a *b* c](p.png)", "a b c"),
])
def test_image_alt_keeps_text(md, alt):
    assert f'alt="{alt}"' in render_markdown(md)


def test_formula_output_cap_shows_error_box():
    assert 'title="formula too long"' in render_markdown("$" + "∑" * 1000 + "$")


@pytest.mark.parametrize("src, limit", [
    ("$$x\n# h\n" * 4000, 0.5),
    ("$$x\n# h\n" * 4000 + "$$\n", 0.5),
    ("> $$x\n> # h\n" * 2000, 0.5),
    ("$$x\n\\$ a\n# h\n" * 3000, 0.5),
    ("$$x\n# h\n" * 16000, 2.0),
], ids=["block", "block-closed", "quote", "escaped", "block-128k"])
def test_unclosed_double_dollar_is_linear(src, limit):
    start = time.perf_counter()
    render_markdown(src)
    assert time.perf_counter() - start < limit
