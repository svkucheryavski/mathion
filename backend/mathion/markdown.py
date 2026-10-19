import re
import unicodedata

import nh3
from markdown_it import MarkdownIt
from markdown_it.rules_core import StateCore
from markdown_it.token import Token
from mdit_py_plugins.dollarmath import dollarmath_plugin

# D54/D64: a bare http:// or https:// address becomes a link. Our own small rule
# on markdown-it-py, not linkify-it-py: www., bare domains, ftp:, //host and
# e-mail addresses are never matched. D65: only the characters URLs use (RFC
# 3986) belong to an address, so it ends at a space, a letter like é or п, |, {,
# ^ or \. Linear: one character class, no nesting. No re.IGNORECASE: it would
# let the Kelvin sign, a long s and a dotted I match k, s and i, so the scheme's
# case is spelled out. Not re.ASCII either, which would make \w ASCII-only.
_BARE_URL = re.compile(r"(?<!\w)[Hh][Tt][Tt][Pp][Ss]?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")
_TRAILING = set(".,;:!?'*_~")
_PAIRS = {")": "(", "]": "["}
# D66: an address that runs straight into a letter, digit or combining mark
# (bücher.de, café, a Kelvin sign) stays plain as a whole, up to the next space,
# never a cut link to another site or page. Checked after the match, not as a
# lookahead, so the regex cannot back off to a shorter address.
_WORD_CHAR = re.compile(r"\w")
_NON_SPACE = re.compile(r"\S*")


def _runs_into_word(ch: str) -> bool:
    return bool(ch) and (_WORD_CHAR.match(ch) is not None or unicodedata.category(ch).startswith("M"))


def _trim_url(url: str) -> str:
    """Drop trailing punctuation, and a closing bracket with no partner inside.

    One pass from the end with running counts, so it stays linear on input
    like "https://x.org/)))…".
    """
    counts = {c: url.count(c) for c in "()[]"}
    end = len(url)
    while end:
        last = url[end - 1]
        if last in _TRAILING:
            end -= 1
        elif last in _PAIRS and counts[last] > counts[_PAIRS[last]]:
            counts[last] -= 1
            end -= 1
        else:
            break
    return url[:end]


def _link_tokens(state: StateCore, url: str, level: int) -> list[Token] | None:
    scheme, rest = url.split("://", 1)
    if not rest:
        return None
    href = state.md.normalizeLink(scheme.lower() + "://" + rest)
    if not state.md.validateLink(href):
        return None
    link_open = Token("link_open", "a", 1, attrs={"href": href}, level=level, markup="autolink", info="auto")
    # D65: the text is the address as typed. An autolink's normalizeLinkText would
    # decode %20 to a space and an xn-- host to look-alike letters.
    text = Token("text", "", 0, content=url, level=level + 1)
    link_close = Token("link_close", "a", -1, level=level, markup="autolink", info="auto")
    return [link_open, text, link_close]


def _split_text(state: StateCore, tok: Token, glued: bool, next_char: str) -> tuple[list[Token], bool]:
    """Link the bare addresses in one text token.

    glued: the token continues a word that D66 left plain, up to its first space.
    next_char: the first character of the next token when it is text or an
    escape or entity (a letter written as &uuml; is a separate token here).
    Returns the tokens, and whether the plain word runs on into the next token.
    """
    content = tok.content
    out: list[Token] = []
    pos = 0
    skip_to = _NON_SPACE.match(content).end() if glued else 0
    skipping = glued
    for m in _BARE_URL.finditer(content):
        if m.start() < skip_to:
            continue
        after = content[m.end()] if m.end() < len(content) else next_char
        if _runs_into_word(after):
            skip_to = _NON_SPACE.match(content, m.end()).end()
            skipping = True
            continue
        url = _trim_url(m.group())   # trimming never reaches the "://"
        link = _link_tokens(state, url, tok.level)
        if link is None:
            continue
        if m.start() > pos:
            out.append(Token("text", "", 0, content=tok.content[pos:m.start()], level=tok.level))
        out.extend(link)
        pos = m.start() + len(url)
    runs_on = skipping and skip_to == len(content)
    if not out:
        return [tok], runs_on
    if pos < len(content):
        out.append(Token("text", "", 0, content=content[pos:], level=tok.level))
    return out, runs_on


def _bare_urls(state: StateCore) -> None:
    """Link bare addresses in inline text, outside any existing link.

    Runs before text_join, as markdown-it's own linkify does: a backslash escape
    is still a separate text_special token, so `http\\://x` never forms an
    address. Code spans, code blocks and math are other token types.
    """
    for block in state.tokens:
        if block.type != "inline" or not block.children:
            continue
        kids = block.children
        children: list[Token] = []
        in_link = 0
        glued = False
        for i, tok in enumerate(kids):
            if tok.type == "link_open":
                in_link += 1
            elif tok.type == "link_close":
                in_link -= 1
            if tok.type == "text" and not in_link and (glued or "://" in tok.content):
                nxt = kids[i + 1] if i + 1 < len(kids) else None
                next_char = nxt.content[:1] if nxt is not None and nxt.type in ("text", "text_special") else ""
                split, glued = _split_text(state, tok, glued, next_char)
                children.extend(split)
            else:
                children.append(tok)
                # An escape or entity inside a plain word keeps it plain; anything else ends it.
                glued = glued and tok.type == "text_special" and not tok.content.isspace()
        block.children = children


_md = MarkdownIt("commonmark", {"html": False})
_md.core.ruler.before("text_join", "bare_url", _bare_urls)
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
    # A list that resumes after a paragraph carries `start`, which markdown-it
    # emits and nh3 would otherwise drop. Harmless while the frontend forced
    # bullets onto every <ol>; once ordered lists render as numbers, a stripped
    # `start` renumbers a teacher's "3. 4. 5." to "1. 2. 3." — wrong content,
    # not just unstyled markup. Value-restricted by nh3 to the attribute name
    # only; the numeral itself is markdown-it's, never author HTML (html=False).
    "ol": {"start"},
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


_TITLE = r'(?:\s+(?:"[^"]*"|\'[^\']*\'|\([^)]*\)))?'
_IMG_REF = re.compile(r'!\[[^\]]*\]\(\s*([^)\s]+)' + _TITLE + r'\s*\)')
_LINK_REF = re.compile(r'(?<!!)\[[^\]]*\]\(\s*([^)\s]+)' + _TITLE + r'\s*\)')
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
