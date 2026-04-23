import bleach
from markdown_it import MarkdownIt

_md = MarkdownIt("commonmark", {"html": False})

_ALLOWED_TAGS = [
    "p", "br", "strong", "em", "b", "i", "u", "s",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a", "img",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "sup", "sub",
]

_ALLOWED_ATTRS = {
    "a": ["href", "title"],
    "img": ["src", "alt", "title"],
}


def render_markdown(text: str | None) -> str:
    """Convert Markdown to sanitized HTML.

    LaTeX delimiters ($...$ and $$...$$) are preserved as-is
    for client-side rendering with KaTeX.
    """
    if not text:
        return ""
    html = _md.render(text)
    return bleach.clean(html, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)
