from mathion.markdown import extract_asset_filenames, resolve_asset_urls, render_markdown


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
    html = '<p><img src="chart.png" alt="diagram"></p>'
    result = resolve_asset_urls(html, 42, {"chart.png"})
    assert 'src="/assets/42/chart.png"' in result


def test_resolve_link_urls():
    html = '<p><a href="slides.pdf">download</a></p>'
    result = resolve_asset_urls(html, 42, {"slides.pdf"})
    assert 'href="/assets/42/slides.pdf"' in result


def test_resolve_leaves_external_urls():
    html = '<p><a href="https://example.com">link</a></p>'
    result = resolve_asset_urls(html, 42, set())
    assert 'href="https://example.com"' in result


def test_resolve_only_known_filenames():
    html = '<p><img src="unknown.png" alt="x"></p>'
    result = resolve_asset_urls(html, 42, {"known.png"})
    assert 'src="unknown.png"' in result


def test_full_render_with_asset_resolution():
    md = "See ![chart](data.png) for details"
    html = render_markdown(md)
    resolved = resolve_asset_urls(html, 99, {"data.png"})
    assert 'src="/assets/99/data.png"' in resolved
