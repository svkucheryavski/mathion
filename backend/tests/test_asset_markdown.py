from mathion.markdown import extract_asset_filenames, render_markdown


def _url(name):
    return f"/assets/42/{name}"


def test_extract_image_references():
    md = "Some text ![diagram](chart.png) and more"
    assert extract_asset_filenames(md) == {"chart.png"}


def test_extract_link_references():
    md = "Download [slides](slides.pdf) here"
    assert extract_asset_filenames(md) == {"slides.pdf"}


def test_extract_ignores_urls():
    md = "![img](https://example.com/pic.png) and [link](http://example.com)"
    assert extract_asset_filenames(md) == set()


def test_extract_ignores_mailto():
    md = "[email](mailto:test@example.com)"
    assert extract_asset_filenames(md) == set()


def test_extract_ignores_anchors():
    md = "[section](#heading)"
    assert extract_asset_filenames(md) == set()


def test_extract_multiple_refs():
    md = "![a](one.png) text ![b](two.jpg) and [c](three.pdf)"
    assert extract_asset_filenames(md) == {"one.png", "two.jpg", "three.pdf"}


def test_extract_no_refs():
    md = "Just plain text with no references"
    assert extract_asset_filenames(md) == set()


def test_resolve_image_urls():
    assert 'src="/assets/42/chart.png"' in render_markdown("![diagram](chart.png)", asset_url=_url)


def test_resolve_link_urls():
    assert 'href="/assets/42/slides.pdf"' in render_markdown("[download](slides.pdf)", asset_url=_url)


def test_resolve_leaves_external_urls():
    assert 'href="https://example.com"' in render_markdown("[link](https://example.com)", asset_url=_url)


def test_full_render_with_asset_resolution():
    html = render_markdown("See ![chart](data.png) for details", asset_url=lambda n: f"/assets/99/{n}")
    assert 'src="/assets/99/data.png"' in html


def test_extract_link_with_title():
    md = '[slides](slides.pdf "the title")'
    assert extract_asset_filenames(md) == {"slides.pdf"}


def test_extract_image_with_title():
    md = "![chart](chart.png 'caption')"
    assert extract_asset_filenames(md) == {"chart.png"}


def test_resolve_does_not_overwrite_inside_text():
    """A bare filename in plain text is never rewritten; only image and link targets."""
    md = "The file is `data.png`"
    assert render_markdown(md, asset_url=_url) == render_markdown(md)


def test_asset_rewrite_skips_code_and_math():
    md = '![p](pic.png) and `src="pic.png"` and $\\text{src="pic.png"}$ and $\\bad{src="pic.png"}$'
    assert render_markdown(md, asset_url=_url).count("/assets/42/pic.png") == 1


def test_asset_rewrite_image_and_link_same_name():
    html = render_markdown("[![p](pic.png)](pic.png)", asset_url=_url)
    assert 'src="/assets/42/pic.png"' in html and 'href="/assets/42/pic.png"' in html
    assert html.count("/assets/42/pic.png") == 2


def test_empty_targets_not_rewritten():
    md = "[a]() ![b]()"
    assert render_markdown(md, asset_url=_url) == render_markdown(md)


def test_root_relative_link_is_not_an_asset():
    # VR-B: a root-relative link is a page; a protocol-relative target is another site.
    md = "[All courses](/courses) and [x](//host/a) and ![p](//host/p.png)"
    assert extract_asset_filenames(md) == set()


def test_root_relative_image_and_file_paths_stay_assets():
    # VR-B: a root-relative image and an /assets/ or /api/ link are still checked.
    md = "![p](/logo.png) [f](/assets/7/x.pdf) [d](/api/runs/3/assets/x.csv)"
    assert extract_asset_filenames(md) == {"/logo.png", "/assets/7/x.pdf", "/api/runs/3/assets/x.csv"}


def test_file_paths_need_the_exact_prefix():
    # VR-B: only /assets/... and /api/... links are file paths; these are pages.
    assert extract_asset_filenames("[a](/assets) [b](/api) [c](/Assets/x)") == set()


def test_angle_bracket_target_is_unwrapped():
    # VR-B: <...> is markdown's wrapper, not part of the target.
    md = "[x](<foo.pdf>) [a](</courses>) ![p](<https://x.org/p.png>)"
    assert extract_asset_filenames(md) == {"foo.pdf"}
    html = render_markdown("[x](<foo.pdf>)", asset_url=lambda n: f"/assets/7/{n}")
    assert 'href="/assets/7/foo.pdf"' in html


def test_backslash_escapes_are_removed():
    # VR-B: markdown drops a backslash before punctuation in a link target.
    assert extract_asset_filenames("[x](my\\_file.pdf) [a](\\/courses)") == {"my_file.pdf"}


def test_extraction_ignores_code_blocks():
    assert extract_asset_filenames("```\n[a](x.pdf)\n```\n\n    [b](y.pdf)") == set()


def test_extraction_reads_reference_links_and_images_in_links():
    assert extract_asset_filenames("[a][r]\n\n[r]: file.pdf") == {"file.pdf"}
    assert extract_asset_filenames("[![a](i.png)](f.pdf)") == {"i.png", "f.pdf"}


def test_extracted_names_are_the_rendered_targets():
    # validation and the rewrite must agree, so no decoding
    assert extract_asset_filenames("![chart](p%69c.png)") == {"p%69c.png"}
    for md in ("![chart](p%69c.png)", "[a](<my file.pdf>)", "![x](a.png) [y](b.pdf)"):
        out = render_markdown(md)
        assert all(f'src="{n}"' in out or f'href="{n}"' in out for n in extract_asset_filenames(md))


def test_reference_link_inside_image_alt_is_not_an_asset():
    assert extract_asset_filenames("![[caption][r]](pic.png)\n\n[r]: missing.pdf") == {"pic.png"}


def test_capitalised_url_schemes_are_not_assets():
    md = "see <Https://example.org/a> and <HTTPS://EXAMPLE.ORG> and [a](Https://x.org) <Mailto:a@b.c>"
    assert extract_asset_filenames(md) == set()
