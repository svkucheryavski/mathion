"""Task 3: HTML to Markdown, links and images (OLX import)."""
import time

import pytest

from mathion.markdown import extract_asset_filenames, render_markdown
from mathion.olx.html_md import html_to_markdown, parse_html, text_only
from mathion.olx.links import Link, LinkTargets, classify_link
from mathion.olx.report import Report
from tests.conftest import secs

TARGETS = LinkTargets(
    static={"img/fig 1.png": "fig-1-2.png", "notes.pdf": "notes.pdf", "i.png": "i.png",
            "my fig (1).png": "my-fig-1.png", "a_b.png": "a_b.png", "a/b.png": "b-2.png"},
    skipped={"big.mp4": "size", "empty.txt": "empty", "x.exe": "type"},
)


def conv(html, report=None, where="W", targets=TARGETS):
    return html_to_markdown(parse_html(html), targets, report if report is not None else Report(), where)


def md(html, report=None, where="W", targets=TARGETS):
    return conv(html, report, where, targets).markdown


def texts(rep):
    return [ln.text for ln in rep.lines()]


def test_converted_tags():
    html = (
        "<h1>T</h1><h3>S</h3><p>a <strong>b</strong> <b>c</b> <em>d</em> <i>e</i><br>f</p>"
        "<ul><li>x<ul><li>y</li></ul></li><li>z</li></ul><ol><li>one</li><li>two</li></ol>"
        "<pre>p `q`\n  r</pre><blockquote><p>q1</p><p>q2</p></blockquote>"
        '<p><code>c*d</code> <a href="https://e.com/">link</a> <img src="/static/i.png" alt="I"></p><hr>'
    )
    assert md(html) == (
        "# T\n\n### S\n\na **b** **c** *d* *e*\\\nf\n\n- x\n  - y\n- z\n\n1. one\n2. two\n\n"
        "```\np `q`\n  r\n```\n\n> q1\n>\n> q2\n\n`c*d` [link](<https://e.com/>) ![I](<i.png>)\n\n___"
    )
    out = render_markdown(md(html))
    for tag in ("<h1>", "<h3>", "<strong>b</strong>", "<em>d</em>", "<br", "<ul>", "<ol>", "<pre>", "<blockquote>", "<code>c*d</code>", "<hr", 'src="i.png"'):
        assert tag in out, tag


def test_table_becomes_rows():
    rep = Report()
    assert md("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>\\(x\\)</td></tr></table>"
              "<table><tbody><tr><td>c</td><td></td><td>d</td></tr></tbody></table>", rep) == "A · B\n\n1 · $x$\n\nc · d"
    assert [ln.level for ln in rep.lines() if "table" in ln.text] == ["changed"]


def test_unwrapped_and_unknown_tags():
    rep = Report()
    assert md("<div>a <span>b</span></div><section>c</section><p><foo>x</foo><foo>y</foo></p>", rep) == "a b\n\nc\n\nxy"
    assert len([t for t in texts(rep) if "foo" in t]) == 1


def test_script_style_dropped():
    rep = Report()
    assert md("<p>a<script>var x = 1 < 2;</script><style>p { }</style>b</p><script>z</script>", rep) == "ab"
    assert len([t for t in texts(rep) if "Scripts" in t]) == 1


def test_br_hard_break_and_whitespace_collapse():
    out = md("<p>  a\n\n    b <br>   c<br></p><p><br>d<br><br>e</p>")
    assert out == "a b\\\nc\n\nd\\\n\\\ne"
    assert not any(line.startswith("    ") for line in out.splitlines())
    assert render_markdown(out).count("<br") == 3 and "\\" not in render_markdown(out)


def test_code_and_pre_untouched():
    out = md("<p><code>*a* `b` $c$</code></p><pre>``x``\n*y* \\(z\\)</pre>")
    assert out == "``*a* `b` $c$``\n\n```\n``x``\n*y* \\(z\\)\n```"
    html = render_markdown(out)
    assert "<code>*a* `b` $c$</code>" in html and "<math" not in html


def test_code_edges_and_adjacent_code():
    assert md("<p><code>`a</code> <code> b </code></p>") == "`` `a `` `  b  `"
    assert md("<p><code>a</code><code>b</code></p>") == "`ab`"


def test_math_skips_code_and_pre():
    assert md("<p><code>\\(x\\)</code> \\(y\\)</p>") == "`\\(x\\)` $y$"


def test_sup_sub():
    rep = Report()
    assert md("<p>R<sup>2</sup>, x<sub>max</sub>, H<sub>2</sub>O, Fe<sup>3+</sup>, <sup>a{b</sup></p>", rep) == \
        "R$^{2}$, x$_{\\text{max}}$, H$_{2}$O, Fe$^{3+}$, a{b"
    assert any("a{b" in t for t in texts(rep))
    assert md("<p>10<sup>3</sup> and \\(x\\)<sup>2</sup></p>") == "$10^{3}$ and $x^{2}$"


LINK_CASES = [
    ("https://e.com/a", Link("web", "https://e.com/a")),
    ("HTTPS://E.com/a", Link("web", "https://E.com/a")),
    ("//e.com/a", Link("web", "https://e.com/a")),
    ("mailto:a@b.c", Link("web", "mailto:a@b.c")),
    ("MAILTO:a@b.c", Link("web", "mailto:a@b.c")),
    ("/static/notes.pdf", Link("asset", "notes.pdf")),
    ("../static/notes.pdf", Link("asset", "notes.pdf")),
    ("../../static/notes.pdf", Link("asset", "notes.pdf")),
    ("static/notes.pdf", Link("asset", "notes.pdf")),
    ("/static/img/fig%201.png?raw=1#x", Link("asset", "fig-1-2.png")),
    ("/c4x/Org/C1/asset/img_fig%201.png", Link("asset", "fig-1-2.png")),
    ("asset-v1:Org+C1+R+type@asset+block@img_fig%201.png", Link("asset", "fig-1-2.png")),
    ("/asset-v1:Org+C1+R+type@asset+block@notes.pdf", Link("asset", "notes.pdf")),
    ("/assets/courseware/v1/abc/asset-v1:Org+C1+R+type@asset+block/notes.pdf", Link("asset", "notes.pdf")),
    ("https://old.edx.org/asset-v1:Org+C+R+type@asset+block@notes.pdf", Link("asset", "notes.pdf")),
]


@pytest.mark.parametrize(("url", "expected"), LINK_CASES)
def test_links_classified(url, expected):
    got = classify_link(url, TARGETS, image=False)
    assert (got.kind, got.url, got.blocked) == (expected.kind, expected.url, expected.blocked)
    assert got.note is None


@pytest.mark.parametrize("url", ["#sec", "data:text/plain,x", "tel:123", "javascript:alert(1)", " JavaScript:alert(1)",
                                 "page.html", "www.e.com", "/jump_to_id/abc", "/courses/course-v1:x/about",
                                 "/static/missing.png", "/static/empty.txt", "/static/x.exe"])
def test_links_that_lose_their_link(url):
    got = classify_link(url, TARGETS, image=False)
    assert got.kind == "text" and got.url is None and not got.blocked and got.note


def test_empty_href_is_plain_text_without_note():
    assert classify_link("  ", TARGETS, image=False) == Link("text", None)


def test_mailto_image_and_data_image_lose_their_link():
    for url in ("mailto:a@b.c", "data:image/png;base64,AAAA"):
        assert classify_link(url, TARGETS, image=True).kind == "text"


DATA_NOTE = "An image pasted into the page as a data: URL was removed; its text was kept"


@pytest.mark.parametrize("url", ["data:image/png;base64,AAAA", "DATA:image/png;base64,AAAA"])
def test_olx_data_image_note_is_short(url):
    assert classify_link(url, TARGETS, image=True) == Link("text", None, note=DATA_NOTE)


def test_olx_data_link_and_ftp_image_keep_their_note():
    for url, image in (("data:text/plain,x", False), ("ftp://e.com/p.png", True)):
        note = classify_link(url, TARGETS, image=image).note
        assert note and note != DATA_NOTE and url in note


def test_link_scheme_lowercased_and_protocol_relative():
    assert md('<p><a href="HTTPS://E.com/x">a</a> <a href="//e.com/y">b</a></p>') == "[a](<https://E.com/x>) [b](<https://e.com/y>)"


def test_static_match_with_subfolder_and_suffix():
    assert classify_link("/static/img/fig 1.png", TARGETS, image=True) == Link("asset", "fig-1-2.png")


def test_c4x_and_asset_v1_underscore_subfolders():
    assert classify_link("/c4x/O/C/asset/a_b.png", TARGETS, image=True).url == "a_b.png"
    assert classify_link("/static/a/b.png", TARGETS, image=True).url == "b-2.png"
    only_sub = LinkTargets(static={"a/b.png": "b.png"}, skipped={})
    assert classify_link("asset-v1:O+C+R+type@asset+block@a_b.png", only_sub, image=True).url == "b.png"


def test_old_site_absolute_link_stays_web_with_host_note():
    for url in ("https://old.edx.org/static/missing.png", "https://old.edx.org/static/big.mp4"):
        got = classify_link(url, TARGETS, image=False)
        assert got.kind == "web" and got.url == url and not got.blocked and "old.edx.org" in got.note
    rep = Report()
    assert md('<p><a href="https://old.edx.org/static/missing.png">m</a></p>', rep) == "[m](<https://old.edx.org/static/missing.png>)"
    assert any("old.edx.org" in t for t in texts(rep))


def test_linked_size_skipped_file_blocks():
    rep = Report()
    assert md('<p><a href="/static/big.mp4">v</a></p>', rep) == "v"
    assert rep.blockers and rep.blockers[0].where == "W" and "big.mp4" in rep.blockers[0].text
    assert classify_link("/static/big.mp4", TARGETS, image=False).blocked


def test_linked_empty_or_type_file_loses_link():
    rep = Report()
    assert md('<p><a href="/static/empty.txt">e</a> <a href="/static/x.exe">x</a></p>', rep) == "e x"
    assert len([t for t in texts(rep) if "upload the file and re-link it" in t]) == 2 and not rep.blockers


def test_image_without_match_becomes_alt_text():
    rep = Report()
    assert md('<p>A <img src="/static/nope.png" alt="Fig [1]"> B <img src="/static/nope.png"></p>', rep) == "A Fig \\[1\\] B"
    assert any("nope.png" in t for t in texts(rep))


def test_target_attribute_dropped():
    assert md('<p><a href="https://e.com" target="_blank">e</a></p>') == "[e](<https://e.com>)"


def test_link_destination_with_spaces_and_parens_renders():
    out = md('<p><img src="/static/my fig (1).png" alt="F"> <a href="/static/my%20fig%20(1).png">x</a></p>')
    assert out == "![F](<my-fig-1.png>) [x](<my-fig-1.png>)"
    assert extract_asset_filenames(out) == {"my-fig-1.png"}
    html = render_markdown(out)
    assert 'src="my-fig-1.png"' in html and 'href="my-fig-1.png"' in html


def test_destinations_written_in_angle_brackets():
    out = md('<p><a href="https://e.com/a&lt;b&gt;c d\\e">x</a></p>')
    assert out == "[x](<https://e.com/a%3Cb%3Ec d%5Ce>)"
    assert 'href="https://e.com/a%3Cb%3Ec%20d%5Ce"' in render_markdown(out)


def test_escaped_brackets_never_links():
    out = md("<p>[a](b) <code>[x](y)</code></p>")
    assert out == "\\[a\\](b) `[x](y)`"
    assert extract_asset_filenames(out) == set() and "<a " not in render_markdown(out)


def test_iframe_inside_content_becomes_link():
    rep = Report()
    res = conv('<p>See <iframe src="https://maps.example.com/e?x=1" title="Map">fallback</iframe> and '
               '<iframe src="//maps.example.com/f"></iframe> <iframe src="/static/notes.pdf"></iframe></p>', rep)
    assert res.markdown == ("See [Map](<https://maps.example.com/e?x=1>) and [maps.example.com](<https://maps.example.com/f>) "
                            "[notes.pdf](<notes.pdf>)")
    assert res.linked_assets == {"notes.pdf"}
    assert len([t for t in texts(rep) if "frame" in t]) == 3


def test_math_spanning_inline_nodes():
    assert md("<p>\\(a <em>b</em> c\\)</p>") == "$a b c$"
    assert md("<p>Let <em>\\(x\\)</em> be</p>") == "Let *$x$* be"


def test_entities_decoded_once():
    out = md("<p>&amp;lt; &lt;b&gt; &amp;copy;</p>")
    assert out == "\\&lt; \\<b\\> \\&copy;"
    assert render_markdown(out) == "<p>&amp;lt; &lt;b&gt; &amp;copy;</p>\n"


def test_sup_sub_reported_once_per_course():
    rep = Report()
    md("<p>R<sup>2</sup> x<sup>3</sup></p>", rep, where="A")
    md("<p>H<sub>2</sub>O</p>", rep, where="B")
    lines = [t for t in texts(rep) if "cript" in t]
    assert len(lines) == 1 and lines[0].endswith(": 2 pages")


def test_formula_errors_reported():
    rep = Report()
    assert md("<p>\\(\\color{red}x\\)</p>", rep) == "$\\color{red}x$"
    assert any(t.startswith("Formula could not be typeset: unknown command") for t in texts(rep))


def test_emphasis_whitespace_moves_outside_markers():
    assert md("<p>a<em> b </em>c <strong> </strong>d</p>") == "a *b* c d"
    assert md("<p><em><em>x</em></em></p>") == "*x*"


def test_links_with_no_text_or_nested():
    assert md('<p><a href="https://e.com"></a> <a href="https://e.com/1"><a href="https://e.com/2">in</a></a></p>') == \
        "[https://e.com](<https://e.com>) [in](<https://e.com/1>)"


def test_lists_loose_and_consecutive():
    assert md("<ul><li><p>a</p><p>b</p></li><li>c</li></ul>") == "- a\n\n  b\n\n- c"
    out = md("<ul><li>a</li></ul><ul><li>b</li></ul><ol><li>c</li></ol><ol><li>d</li></ol>")
    assert out == "- a\n\n* b\n\n1. c\n\n1) d"
    assert render_markdown(out).count("<ul>") == 2 and render_markdown(out).count("<ol>") == 2


def test_implied_end_tags():
    assert md("<ul><li>a<li>b</ul>") == "- a\n- b"
    assert md("<table><tr><td>a<td>b<tr><td>c</table>") == "a · b\n\nc"


def test_html_body_unwrapped_without_report():
    rep = Report()
    assert md("<html><head><title>t</title></head><body><p>x</p></body></html>", rep) == "x"
    assert not texts(rep)


def test_linked_assets_collected():
    res = conv('<p><img src="/static/i.png"> <a href="/static/notes.pdf">n</a> <a href="https://e.com">w</a></p>')
    assert res.linked_assets == {"i.png", "notes.pdf"}
    assert any(s.kind == "text" for s in res.segs)


def test_text_only():
    root = parse_html("<p>a <b>b</b><script>x</script><br>c &amp; d</p><p>e<img alt='no'></p><iframe>f</iframe>")
    assert text_only(root) == "a b c & d e"


def test_deep_nesting_and_large_page_are_fast():
    start = time.perf_counter()
    out = md("<div>" * 50_000 + "x" + "</div>" * 50_000)
    assert out == "x" and time.perf_counter() - start < secs(3)
    start = time.perf_counter()
    out = md("<p>a <em>b</em> \\(c\\) <a href='https://e.com'>d</a><br></p>" * 20_000)
    assert time.perf_counter() - start < secs(5) and out.count("$c$") == 20_000


def test_sentinel_character_in_text_is_removed():
    assert md("<p>a￼b <em>c</em></p>") == "ab *c*"


# review round 1


def test_sentinel_in_attributes_is_removed():
    out = md('<p><img src="/static/nope.png" alt="a\ufffcb"> <a href="https://e.com/x\ufffc"></a> <b>c</b> '
             '<iframe src="https://e.com/" title="t\ufffc"></iframe> x<sup>a{\ufffcb</sup></p>')
    assert "\ufffc" not in out.replace("(<https://e.com/x\ufffc>)", "") and "**c**" in out and "ab" in out   # the address stays as written


def test_malformed_web_address_loses_its_link():
    rep = Report()
    assert md('<p><a href="http://[bad/x">a</a> <img src="https://[x/y.png" alt="b"></p>', rep) == "a b"
    assert classify_link("http://[bad/x", TARGETS, image=False).kind == "text" and texts(rep)


def test_long_code_and_break_runs_are_fast():
    for html in ("<p>" + "<code>a</code>" * 100_000 + "</p>", "<p>" + "<br>" * 300_000 + "x" + "<br>" * 300_000 + "</p>",
                 "<p>x<em>" + "<span> </span>" * 100_000 + "y</em></p>"):
        start = time.perf_counter()
        md(html)
        assert time.perf_counter() - start < secs(5)


def test_cleaned_studio_names_match():
    t = LinkTargets(static={"img/Figure 1 (a).png": "figure-1-a.png", "a b.png": "a-b.png", "a_b.png": "a_b.png"}, skipped={"Big File.mp4": "size"})
    assert classify_link("/static/img_Figure_1__a_.png", t, image=True) == Link("asset", "figure-1-a.png")
    assert classify_link("asset-v1:O+C+R+type@asset+block@img_Figure_1__a_.png", t, image=True).url == "figure-1-a.png"
    assert classify_link("/static/a_b.png", t, image=True).url == "a_b.png"          # an exact name wins
    assert classify_link("/static/Big_File.mp4", t, image=False).blocked


def test_composed_and_decomposed_names_match():
    nfd, nfc = "cafe\u0301.png", "caf\u00e9.png"
    for stored, linked in ((nfd, nfc), (nfc, nfd)):
        t = LinkTargets(static={f"img/{stored}": "x.png"}, skipped={f"big {stored}": "size"})
        assert classify_link(f"/static/img/{linked}", t, image=True) == Link("asset", "x.png")
        assert classify_link(f"asset-v1:O+C+R+type@asset+block@img_{linked}", t, image=True).url == "x.png"
        assert classify_link(f"/static/big {linked}", t, image=False).blocked
    # Studio cleans a decomposed name with the mark as "_", as before the NFC tier
    t = LinkTargets(static={f"img/{nfd[:-4]} 1.png": "y.png"}, skipped={})
    assert classify_link("asset-v1:O+C+R+type@asset+block@img_cafe__1.png", t, image=True).url == "y.png"
    # each tier on its own: the composed form, under, clean, and both clean tries in the lookup
    t = LinkTargets(static={f"img/{nfd}": "x.png", f"img {nfc}": "z.png"}, skipped={})
    assert classify_link(f"/static/img/{nfc}", t, image=True).url == "x.png"
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@img_{nfc}", t, image=True).url == "x.png"
    assert classify_link(f"/static/big {nfd}", LinkTargets(static={"big_cafe_.png": "b.png"}, skipped={}), image=True).url == "b.png"
    assert classify_link("/static/file.png", LinkTargets(static={"\ufb01le.png": "f.png"}, skipped={}), image=True).kind == "text"
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@my_img_{nfd}", LinkTargets(static={f"my img/{nfc}": "a.png"}, skipped={}), image=True).url == "a.png"
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@my_img_{nfc}", LinkTargets(static={f"my img/{nfd}": "a.png"}, skipped={}), image=True).url == "a.png"
    # a folder holding both spellings: the exact spelling wins
    twins = LinkTargets(static={f"a/{nfd}": "d.png", f"a/{nfc}": "c.png"}, skipped={})
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@a_{nfc}", twins, image=True).url == "c.png"
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@a_{nfd}", twins, image=True).url == "d.png"
    # a flattened folder name in its exact spelling beats a composed top-level twin
    flat = LinkTargets(static={f"x_{nfd}": "p1.png", f"x/{nfc}": "p2.png"}, skipped={})
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@x_{nfc}", flat, image=True).url == "p2.png"
    # each step in its place: under nfc before clean, clean raw before clean nfc
    t = LinkTargets(static={f"img/{nfc}": "x.png", f"img {nfc}": "z.png"}, skipped={})
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@img_{nfd}", t, image=True).url == "x.png"
    spaced = LinkTargets(static={f"a b/{nfd}": "d.png", f"a b/{nfc}": "c.png"}, skipped={})
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@a_b_{nfc}", spaced, image=True).url == "c.png"
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@a_b_{nfd}", spaced, image=True).url == "d.png"
    # a skipped file in the link's own spelling stays blocked, though its twin was uploaded
    for folder, link in (("a", "a_"), ("a b", "a_b_")):
        mixed = LinkTargets(static={f"{folder}/{nfd}": "d.png"}, skipped={f"{folder}/{nfc}": "size"})
        assert classify_link(f"asset-v1:O+C+R+type@asset+block@{link}{nfc}", mixed, image=True).blocked
    # a /static/ path never uses the under tables; nfc comes before clean-nfc and before under-nfc
    t = LinkTargets(static={f"a/{nfd}": "u.png", f"a {nfc}": "s.png"}, skipped={})
    assert classify_link(f"/static/a_{nfc}", t, image=True).url == "s.png"
    t = LinkTargets(static={f"img/{nfc}": "x.png", f"img {nfc}": "z.png"}, skipped={})
    assert classify_link(f"/static/img/{nfd}", t, image=True).url == "x.png"
    t = LinkTargets(static={f"x_{nfd}": "p1.png", f"x/{nfd}": "p2.png"}, skipped={})
    assert classify_link(f"asset-v1:O+C+R+type@asset+block@x_{nfc}", t, image=True).url == "p1.png"


def test_nbsp_at_emphasis_edges_and_after_breaks():
    out = md("<p><strong>Bold&nbsp;</strong>text and <em>&nbsp;it</em> x</p><p>text<br>&nbsp;</p><p>&nbsp;</p><p>next</p>")
    assert out == "**Bold**\xa0text and \xa0*it* x\n\ntext\n\nnext"
    html = render_markdown(out)
    assert "<strong>Bold</strong>" in html and "<em>it</em>" in html and "\\" not in html


def test_touching_same_emphasis_merges():
    assert md("<p><strong>Step 1</strong><strong>:</strong> go. <b>a</b><b>b</b> <i>c</i><i>d</i></p>") == "**Step 1:** go. **ab** *cd*"


def test_formula_swallowing_half_a_pair_drops_its_partner():
    rep = Report()
    assert md("<p><em>a \\(x</em> y\\) <a href='https://e.com'>see \\(z</a>\\)</p>", rep) == "a $x y$ see $z$"
    assert any("inside a formula" in t for t in texts(rep))


def test_heading_with_final_hashes_and_hr_in_list():
    assert md("<h2>Problem #</h2><h3>Step 1 ##</h3>") == "## Problem \\#\n\n### Step 1 \\##"
    out = md("<ul><li><hr>after</li></ul>")
    assert out == "- ___\n\n  after" and "<li>" in render_markdown(out)


def test_line_starts_escaped_in_blocks():
    assert md("<p>1. x</p><p>a<br>- b</p><h2>1. Intro</h2><ul><li>+ y</li></ul>") == "1\\. x\n\na\\\n\\- b\n\n## 1\\. Intro\n\n- \\+ y"


def test_pre_fence_and_edges():
    assert md("<pre>\na\n```\nb\n</pre><pre>  </pre>") == "````\na\n```\nb\n````"


def test_same_link_problem_reported_once_per_page():
    rep = Report()
    md('<p><a href="#a">a</a> <a href="#a">b</a> <a href="/static/big.mp4">c</a> <a href="/static/big.mp4">d</a></p>', rep)
    assert len([t for t in texts(rep) if "#a" in t]) == 1 and len(rep.blockers) == 1


def test_ampersand_in_destination_survives():
    out = md('<p><a href="https://x.org/?a=1&amp;b=2&amp;copy;">x</a></p>')
    assert 'href="https://x.org/?a=1&amp;b=2&amp;copy;"' in render_markdown(out)


def test_table_text_outside_cells_kept():
    assert md("<table><td>direct</td><tr>text in tr<td>cell</td></tr>stray<tbody><tr><td>z</td></tr></tbody></table>") == \
        "direct\n\ntext in tr · cell\n\nstray\n\nz"


def test_wording_and_levels():
    assert classify_link("#x", TARGETS, image=False).note.startswith("A link")
    assert classify_link("#x", TARGETS, image=True).note.startswith("An image")
    rep = Report()
    md('<p><a href="https://old.edx.org/static/missing.png">m</a> <a href="#q">q</a></p>', rep)
    assert sorted(ln.level for ln in rep.lines()) == ["changed", "note"]


def test_structure_details():
    assert md("<p>a<center>b</center>c</p>") == "a\n\nb\n\nc"
    assert md("<ul><li>a</li><ul><li>b</li></ul>stray</ul>") == "- a\n  - b\n- stray"
    assert md("<p>x<a>plain</a> y<sup>\u22122</sup> <code> a\n b </code></p>") == "xplain y$^{-2}$ `  a b  `"
    assert md('<p><a href="https://e.com"><iframe src="https://f.com/"></iframe></a> <iframe src=""></iframe>z</p>') == \
        "[f.com](<https://e.com>) z"
    assert md("<p>h<br>i</p><h2>a<br>b</h2>") == "h\\\ni\n\n## a b"
    assert md('<p><img src="/static/i.png" alt="a*b"></p>') == "![a\\*b](<i.png>)"


def test_link_forms_details():
    assert classify_link("/static/no\ttes.pdf", TARGETS, image=False).url == "notes.pdf"
    assert classify_link("/assets/courseware/v1/h/notes.pdf", TARGETS, image=False).url == "notes.pdf"
    t = LinkTargets(static={}, skipped={"d/big.mp4": "size"})
    assert classify_link("/c4x/O/C/asset/d_big.mp4", t, image=False).blocked
    assert "(old.edx.org)" in classify_link("https://user@old.edx.org/static/m.png", TARGETS, image=False).note


def test_parser_depth_and_duplicates():
    out = md("<div>" * 150 + "<b>x</b>" + "</div>" * 150 + "<p>after</p>")
    assert out == "x\n\nafter"                      # formatting below depth 100 is flattened (ruling)
    assert md('<p><a href="https://a.com" href="https://b.com">a</a></p>') == "[a](<https://a.com>)"
    assert md("<div>" * 120 + "<script>bad()</script>ok" + "</div>" * 120) == "ok"


# review round 2


def test_mid_paragraph_break_run_is_fast():
    start = time.perf_counter()
    out = md("<p>x" + "<br>" * 200_000 + "y</p>")
    assert time.perf_counter() - start < secs(3) and out.startswith("x\\\n") and out.endswith("\\\ny")


def test_empty_formula_next_to_break_leaves_no_backslash():
    assert md("<p>a<br>\\( \\)</p>") == "a"


def test_different_marks_touching_do_not_cancel():
    assert md("<p><em>a</em><b>b</b></p>") == "*a***b**"


def test_link_half_swallowed_by_formula():
    rep = Report()
    res = conv('<p><a href="/static/notes.pdf">l \\(c</a> d\\)</p>', rep)
    assert res.markdown == "l $c d$" and res.linked_assets == set()
    assert any("inside a formula" in t for t in texts(rep))


def test_cancelled_marks_with_half_swallowed():
    assert md("<p><b>a</b><b>\\(x</b> y\\) z</p>") == "a$x y$ z"
    assert md("<p><em>a \\(x</em><em>b</em> y\\) z</p>") == "a $xb y$ z"


def test_nbsp_only_piece_at_emphasis_edge():
    assert md("<p><b>x<span>&nbsp;</span></b>y</p>") == "**x**\xa0y"
    assert md("<p><b>x<br><span>&nbsp;</span></b>y</p>") == "**x**\\\n\xa0y"   # the break leaves the marks too


def test_sentinel_only_alt_is_empty():
    assert md('<p><b><img src="/static/nope.png" alt="\ufffc"></b>z</p>') == "z"


def test_cells_without_rows_form_one_row():
    assert md("<table><td>a</td><td>b</td></table>") == "a · b"


def test_iframe_losing_its_link_is_reported_as_text():
    rep = Report()
    assert md('<p><iframe src="/jump_to_id/x" title="T"></iframe></p>', rep) == "T"
    assert any("plain text" in t for t in texts(rep)) and not any("plain link" in t for t in texts(rep))


def test_clash_prefers_uploaded_file_then_alphabetical():
    t = LinkTargets(static={"a(b.png": "ab-1.png", "a)b.png": "ab-2.png"}, skipped={"a b.png": "size"})
    assert classify_link("/static/a_b.png", t, image=True).url == "ab-1.png"
    pct = LinkTargets(static={"a%b c.png": "pct.png", "a_b c.png": "under.png"}, skipped={})
    assert classify_link("/static/a_b_c.png", pct, image=True).url == "under.png"    # "%" is kept by the cleaned key


def test_pair_drop_through_cancel_chains():
    assert md("<p><b>a</b><b>b</b><b>\\(x</b> y\\)</p>") == "ab$x y$"
    assert md("<p>\\(x <b>y\\) a</b><b>b</b> c</p>") == "$x y$ ab c"


def test_leading_empty_formula_before_break():
    assert md("<p>\\( \\)<br>b</p>") == "b"


def test_bare_cells_inside_sections():
    assert md("<table><tbody><td>a</td> <td>b</td><tr><td>c</td></tr><td>d</td></tbody><th>e</th>\n<td>f</td></table>") == \
        "a · b\n\nc\n\nd\n\ne · f"


def test_swallowed_emphasis_alone_is_reported():
    rep = Report()
    assert md("<p><em>a \\(x</em> y\\)</p>", rep) == "a $x y$"
    assert any("inside a formula" in t for t in texts(rep))


def test_round_one_unpinned_details():
    rep = Report()
    assert md("<table><tr><td>  a  </td><td> b</td></tr></table><p>x<center>y</center></p>", rep) == "a · b\n\nx\n\ny"
    assert any("<center>" in t for t in texts(rep))
    assert md("<p><b>a<hr>b</b> <b>c<div>d</div>e</b></p>") == "**a b** **c d e**"
    assert md('<p>a<iframe src=""></iframe>b <iframe src="https://f.com/"></iframe>c</p>') == "ab [f.com](<https://f.com/>) c"
    assert md("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>") == "- a\n- b"
    assert md("<div>" * 120 + "<b>x</b>" + "</div>" * 120 + "<p>y</p>") == "x\n\ny"


def test_cell_edge_breaks_and_deep_end_tags():
    assert md("<table><tr><td>a<br></td><td><br>b</td></tr></table>") == "a · b"
    assert md("<p><em>" + "<span>" * 120 + "<em>x</em>y" + "</span>" * 120 + "z</em> w</p>") == "*xyz* w"   # a too-deep end tag closes nothing


# Codex round 1


def test_spaces_inside_an_address_are_fast():
    start = time.perf_counter()
    out = md('<p><a href="https://e.com/' + " " * 200_000 + 'x">l</a></p>')
    assert time.perf_counter() - start < secs(3) and out.endswith(" x>)")


def test_deep_lists_and_quotes_keep_text_and_links():
    for html in ("<ul><li>" * 12 + 'KEEP <a href="/static/notes.pdf">download</a>' + "</li></ul>" * 12,
                 "<blockquote><ul><li>" * 8 + 'KEEP <a href="/static/notes.pdf">download</a>' + "</li></ul></blockquote>" * 8):
        rep = Report()
        res = conv(html, rep)
        out = render_markdown(res.markdown)
        assert "KEEP" in out and 'href="notes.pdf"' in out
        assert extract_asset_filenames(res.markdown) == res.linked_assets == {"notes.pdf"}
        assert any("nested" in t for t in texts(rep))


def test_links_inside_code_pre_and_scripts_are_checked():
    for html in ('<p><code><a href="/static/big.mp4">download</a></code></p>', '<pre><a href="/static/big.mp4">download</a></pre>',
                 '<p>x<sup><a href="/static/big.mp4">1</a></sup></p>'):
        rep = Report()
        md(html, rep)
        assert rep.blockers and "big.mp4" in rep.blockers[0].text
    rep = Report()
    assert md('<p><code><a href="https://e.com">e</a></code> <code><img src="/static/i.png" alt="i"></code></p>', rep) == "`e`"
    assert len([t for t in texts(rep) if "kept as plain text" in t]) == 1


def test_nesting_counter_and_boundary():
    rep = Report()
    out = md("<ul><li>x</li></ul><p>p</p>" * 9, rep)
    assert out.count("- x") + out.count("* x") == 9 and not any("nested" in t for t in texts(rep))
    rep = Report()
    out = md("<ul><li>" * 8 + "d8" + "</li></ul>" * 8, rep)
    assert out.count("- ") == 8 and out.endswith("- d8") and not any("nested" in t for t in texts(rep))
    rep = Report()
    out = md("<ul><li>" * 9 + "d9" + "</li></ul>" * 9, rep)
    assert out.count("- ") == 8 and "d9" in render_markdown(out) and any("nested" in t for t in texts(rep))   # the 9th level joins the 8th item


def test_deep_quotes_flattened():
    rep = Report()
    out = md("<blockquote>" * 25 + "KEEP" + "</blockquote>" * 25, rep)
    assert "KEEP" in render_markdown(out) and out.count(">") == 16 and any("nested" in t for t in texts(rep))


def test_audit_details():
    rep = Report()
    assert md('<pre><script><a href="/static/big.mp4">s</a></script>x</pre>', rep) == "```\nx\n```"
    assert not rep.blockers and not texts(rep)
    rep = Report()
    md('<p><code><img src="/static/big.mp4"> <iframe src="https://f.com/"></iframe>c</code></p>', rep)
    assert rep.blockers and len([t for t in texts(rep) if "kept as plain text" in t]) == 1
    rep = Report()
    md('<p><code><a href="">e</a></code></p>', rep)
    assert not texts(rep)
    rep = Report()
    md('<p><code><a href="#x">e</a></code></p>', rep)
    assert any("kept as plain text" in t for t in texts(rep))


def test_sibling_quotes_are_not_flattened():
    rep = Report()
    out = md("<blockquote><p>q</p></blockquote><p>p</p>" * 17, rep)
    assert out.count("> q") == 17 and not any("nested" in t for t in texts(rep))


# Codex round 2


def test_link_inside_link_is_still_checked():
    rep = Report()
    assert md('<p><a href="https://e.com">outer <a href="/static/big.mp4">download</a></a></p>', rep) == "[outer download](<https://e.com>)"
    assert rep.blockers and "big.mp4" in rep.blockers[0].text


def test_too_deep_addresses_are_still_checked():
    for inner in ('<a href="/static/big.mp4">download</a>', '<iframe src="/static/big.mp4"></iframe>', '<b><img src="/static/big.mp4"></b>'):
        rep = Report()
        out = md("<div>" * 110 + inner + "</div>" * 110, rep)
        assert rep.blockers and "big.mp4" in rep.blockers[0].text, inner
        assert "big" not in out
    rep = Report()
    assert md("<div>" * 110 + '<a href="https://e.com">w</a> x' + "</div>" * 110, rep) == "w x"
    assert any("kept as plain text" in t for t in texts(rep))


# Codex round 3


def test_control_characters_at_address_edges_are_stripped():
    for url in ("\x0b/static/big.mp4", "\x00\x1f /static/big.mp4\x01\x0b", "/static/b\tig.mp4"):
        assert classify_link(url, TARGETS, image=False).blocked, repr(url)
    rep = Report()
    md('<p><a href="\x0b/static/big.mp4">download</a></p>', rep)
    assert rep.blockers
    assert classify_link("\x1fhttps://e.com/a\x1f", TARGETS, image=False) == Link("web", "https://e.com/a")


def test_frame_label_trimmed_like_addresses():
    assert md('<p>a <iframe src="\x01/jump_to_id/x\x01"></iframe> b</p>') == "a /jump\\_to\\_id/x b"


def test_nbsp_at_address_edges_is_not_trimmed():
    lead = classify_link("\xa0/static/big.mp4", TARGETS, image=False)
    assert lead.kind == "text" and not lead.blocked and "only web addresses" in lead.note
    trail = classify_link("/static/big.mp4\xa0", TARGETS, image=False)
    assert trail.kind == "text" and not trail.blocked and "not in the export" in trail.note


# Codex round 4


def test_frame_with_odd_mailto_address_does_not_crash():
    assert md('<p>Before<iframe src="mailto://[bad"></iframe>After</p>') == "Before [mailto://\\[bad](<mailto://[bad>) After"
    assert md('<p>a <iframe src="https://[bad"></iframe> b</p>') == "a https://\\[bad b"


def test_web_scheme_without_slashes_is_not_a_link():
    for url in ("https:fig.png", "HTTP:x/fig.png", "https:", "https:/e.com/fig.png", "http:x?u=http://y"):
        got = classify_link(url, TARGETS, image=True)
        assert got.kind == "text" and got.note and "not valid" in got.note, url
    rep = Report()
    res = conv('<p><img src="https:fig.png" alt="a"> <a href="https:notes.pdf">n</a></p>', rep)
    assert res.markdown == "a n" and extract_asset_filenames(res.markdown) == res.linked_assets == set()


def test_frame_labels_by_address_kind():
    assert md('<p><iframe src="mailto://e.com/x"></iframe></p>') == "[mailto://e.com/x](<mailto://e.com/x>)"
    assert md('<p><iframe src="https:///x"></iframe></p>') == "[https:///x](<https:///x>)"
    assert md('<p><iframe src="http://e.com/x"></iframe></p>') == "[e.com](<http://e.com/x>)"


def test_visible_content_closes_head():
    assert md("<head><p>Keep me</p></head><p>x</p>") == "Keep me\n\nx"
    assert md("<head><title>T</title><meta charset='utf-8'><style>p{}</style></head><p>x</p>") == "x"
    assert md("<head>Loose text</head>") == "Loose text"
    assert md("<html><head><title>T</title></head><body><p>a</p></body></html>") == "a"


def test_head_edge_shapes():
    assert md("<head><head><p>Keep me</p></head>") == "Keep me"
    assert md("<head><meta charset='utf-8'><head>Loose</head>") == "Loose"
    assert md("<head><bgsound src='a.mid'><basefont size=3><p>Keep me</p></head>") == "Keep me"
    assert md("<head><p/>Keep</head>") == "Keep"
    assert md("<head>&nbsp;<p>x</p>") == "x"
    assert md("<head>\n <meta charset='utf-8'><link rel=icon href=f.png><style>p{}</style><script>x()</script>"
              "<template><p>t</p></template><noscript>n</noscript><noframes>f</noframes><base href='/'><title>T</title></head><p>b</p>") == "b"


def test_title_and_template_never_show():
    assert md("<head>stray text<title>T</title></head>") == "stray text"
    assert md("<p>a</p><title>T</title><p>b</p>") == "a\n\nb"
    assert md("<template><p>hidden</p></template><p>shown</p>") == "shown"


def test_head_closing_pins():
    assert md("<head>&nbsp;<noscript>n</noscript></head><p>x</p>") == "x"   # noscript is hidden wherever it sits
    assert md("<head><base href='/'><noscript>n</noscript></head><p>b</p>") == "b"


def test_cdata_in_html_is_a_bogus_comment():
    out = md("<p>a</p><![CDATA[<p>Keep me</p>]]>")             # a browser shows "Keep me]]>"
    assert out.startswith("a\n\n") and "Keep me" in out
    assert md("<p>a<![CDATA[x]]>b</p>") == "ab"


def test_noscript_noembed_noframes_are_raw_and_hidden():
    assert md("<noscript><style></noscript><p>Keep me</p>") == "Keep me"
    assert md("<p>a</p><noscript><p>Enable JavaScript</p></noscript><p>b</p>") == "a\n\nb"
    assert md("<noembed><p>x</p></noembed><noframes><b>y</b></noframes><p>z</p>") == "z"


def test_self_closing_raw_text_tags_open_raw_text():
    assert md('<script src="a.js"/><!-- x </script><p>Keep me</p>') == "Keep me"
    assert md("<noscript/><style></noscript><p>Keep me</p>") == "Keep me"
    assert md("<style/><title></style><p>Keep me</p>") == "Keep me"
    assert md("<p>a</p><title/>T</title><p>b</p>") == "a\n\nb"


def test_self_closing_tags_inside_svg_and_math_stay_empty():
    assert md('<p>a</p><svg><style/><text>Label</text></svg><p>after</p>') == "a\n\nLabel\n\nafter"
    assert md('<svg><title/><circle r="1"/></svg><p>after</p>') == "after"
    assert md('<svg viewBox="0 0 1 1"><script/></svg><p>after</p>') == "after"
    assert md("<math><mi>x</mi><style/></math><p>after</p>").endswith("after")


def test_self_closing_plaintext_and_xmp():
    assert "Keep" in md("<plaintext/><script>var Keep = 1;</script>")
    assert md("<xmp/>&lt;b&gt;</xmp>") == "\\&lt;b\\&gt;"               # raw text: entities stay literal


def test_self_closing_tag_deeper_inside_svg_stays_empty():
    out = md("<svg><g><title/><text>L</text></g></svg><p>Keep me</p>")
    assert "L" in out and out.endswith("Keep me")
