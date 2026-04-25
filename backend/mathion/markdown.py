import re

import nh3
from markdown_it import MarkdownIt
from mdit_py_plugins.dollarmath import dollarmath_plugin

_md = MarkdownIt("commonmark", {"html": False})
dollarmath_plugin(_md)

_ALLOWED_TAGS = {
    "p", "br", "strong", "em", "b", "i", "u", "s",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a", "img",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "sup", "sub",
    "span", "div",  # for math wrappers
}

_ALLOWED_ATTRS = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title"},
    "span": {"class"},
    "div": {"class"},
}

_URL_SCHEMES = {"http", "https", "mailto"}


def render_markdown(text: str | None) -> str:
    """Convert Markdown to sanitized HTML.

    LaTeX math ($...$ and $$...$$) is rendered as <span class="math"> and
    <div class="math"> for client-side KaTeX rendering.
    Links get rel="noopener noreferrer" automatically via nh3.
    javascript: URIs in href/src are stripped by nh3's url_schemes filter.
    """
    if not text:
        return ""
    html = _md.render(text)
    return nh3.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        url_schemes=_URL_SCHEMES,
        link_rel="noopener noreferrer",
        strip_comments=True,
    )


_IMG_REF = re.compile(r'!\[[^\]]*\]\(([^)\s]+)\)')
_LINK_REF = re.compile(r'(?<!!)\[[^\]]*\]\(([^)\s]+)\)')
_SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")


def extract_asset_filenames(text: str) -> set[str]:
    """Extract non-URL filenames from markdown image and link references."""
    if not text:
        return set()
    filenames: set[str] = set()
    for pattern in (_IMG_REF, _LINK_REF):
        for m in pattern.finditer(text):
            ref = m.group(1)
            if not ref.startswith(_SKIP_PREFIXES):
                filenames.add(ref)
    return filenames


def resolve_asset_urls(html: str, version_id: int, asset_filenames: set[str]) -> str:
    """Replace bare asset filenames with /assets/{version_id}/{filename} paths.

    Only replaces filenames in asset_filenames. Must be called AFTER
    render_markdown() / nh3 sanitization.
    """
    for filename in asset_filenames:
        html = html.replace(f'src="{filename}"', f'src="/assets/{version_id}/{filename}"')
        html = html.replace(f'href="{filename}"', f'href="/assets/{version_id}/{filename}"')
    return html
