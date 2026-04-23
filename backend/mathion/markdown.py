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
