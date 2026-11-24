# VR-B12 (user, 2026-11-14): stored content_html re-renders only on save, publish
# and clone. From the beta on, a renderer change that alters stored output ships
# an Alembic data migration that re-renders it. Before the beta: no backfill.
import html
import re
import types
import unicodedata

import markdown_it.rules_block.list as _list_rule
import nh3
from markdown_it import MarkdownIt
from markdown_it.rules_core import StateCore
from markdown_it.rules_block import StateBlock
from markdown_it.rules_inline import StateInline
from markdown_it.token import Token
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.dollarmath.index import math_block_dollar

from mathion.latex_mathml import LatexError, latex_to_mathml

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


def _nests(url: str, c: str, o: str) -> bool:
    """Whether every closer c in url follows its own opener o."""
    depth = 0
    for ch in url:
        depth += (ch == o) - (ch == c)
        if depth < 0:
            return False
    return True


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


def _split_text(state: StateCore, tok: Token, glued: bool, next_glues: bool) -> tuple[list[Token], bool]:
    """Link the bare addresses in one text token.

    glued: the token continues a word that D66 left plain, up to its first space.
    next_glues: the next token continues the word: text, an escape or an entity
    starting with a letter (&uuml; is a separate token here), or emphasis, code
    or math right after it (#object.__init__). A line break does not.
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
        url = _trim_url(m.group())   # trimming never reaches the "://"
        cut = m.group()[len(url):]
        before = content[m.start() - 1] if m.start() else ""
        # VR-B: (url) or [url] ends at its closer; a trimmed "." still glues (object.__init__).
        if not any(c in cut and before == o and _nests(url, c, o) for c, o in _PAIRS.items()) and (
            _runs_into_word(content[m.end()]) if m.end() < len(content) else next_glues
        ):
            skip_to = _NON_SPACE.match(content, m.end()).end()
            skipping = True
            continue
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


_BREAKS = ("softbreak", "hardbreak")


def _glues(kids: list[Token], i: int) -> bool:
    """Whether the token after kids[i] continues the same word (D66).

    Closing delimiters are looked past: in **https://x.org** the address is
    whole, while in *https://x.org/caf*é the letter after them glues.
    """
    i += 1
    # VR-B: an empty text token (a spent delimiter) is looked past too.
    while i < len(kids) and (kids[i].nesting == -1 or (kids[i].type == "text" and not kids[i].content)):
        i += 1
    tok = kids[i] if i < len(kids) else None
    if tok is None or tok.type in _BREAKS:
        return False
    if tok.type in ("text", "text_special"):
        return _runs_into_word(tok.content[:1])
    return True


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
                split, glued = _split_text(state, tok, glued, _glues(kids, i))
                children.extend(split)
            else:
                children.append(tok)
                # Escapes, entities, emphasis, code and math inside a plain word keep
                # it plain; a line break, a space entity or link text ends it.
                glued = glued and tok.type not in _BREAKS and tok.type != "text" and not tok.content.isspace()
        block.children = children


def _href_survives(href: str) -> bool:
    """Whether nh3 keeps this href, asked of nh3 itself with the same schemes."""
    probe = nh3.clean(
        f'<a href="{html.escape(href, quote=True)}">x</a>',
        tags={"a"}, attributes={"a": {"href"}}, url_schemes=_URL_SCHEMES, link_rel=None,
    )
    return "href=" in probe


def _drop_bad_links(state: StateCore) -> None:
    """Polish 3 C11: nh3 drops an href it cannot parse (a bad port, a bad escape,
    no host) and would keep an <a> with none, a dead link. Such a link, bare or
    authored, stays its text. Checked on the tokens, not on nh3's output: nh3
    leaves < and > unescaped inside attribute values, so no pattern over its
    HTML is exact. Links do not nest, so the next link_close is the partner.
    """
    for block in state.tokens:
        if block.type != "inline" or not block.children:
            continue
        children: list[Token] = []
        dropping = False
        for tok in block.children:
            if tok.type == "link_open" and not _href_survives(tok.attrGet("href") or ""):
                dropping = True
                continue
            if tok.type == "link_close" and dropping:
                dropping = False
                continue
            children.append(tok)
        block.children = children


_mark_tight = _list_rule.markTightParagraphs


def _mark_tight_list(state, idx: int) -> None:
    # VR-B: record markdown-it's own tight call; the list rule has no other output for it.
    state.tokens[idx].meta["tight"] = True
    _mark_tight(state, idx)


_list_rule.markTightParagraphs = _mark_tight_list


def _loose_lists(state: StateCore) -> None:
    """VR-B: a loose list gets class="loose", seen even with no paragraph inside."""
    for tok in state.tokens:
        if tok.type in ("bullet_list_open", "ordered_list_open") and not tok.meta.get("tight"):
            tok.attrSet("class", "loose")


def _escaped(src: str, pos: int) -> bool:
    """Whether src[pos] follows an odd run of backslashes."""
    n = 0
    while pos - n > 0 and src[pos - n - 1] == "\\":
        n += 1
    return n % 2 == 1


def _next_dollar(src: str, start: int, mark: str) -> int:
    """The first unescaped `mark` at or after start, or -1."""
    pos = src.find(mark, start)
    while pos != -1 and _escaped(src, pos):
        pos = src.find(mark, pos + 1)
    return pos


def _digit(ch: str) -> bool:
    return "0" <= ch <= "9"


_RUN = re.compile(r"`+")


def _in_code(src: str, start: int, end: int) -> bool:
    """Whether src[end] sits inside a code span opened after start, paired as markdown-it pairs runs."""
    pos = start
    while m := _RUN.search(src, pos, end):
        if _escaped(src, m.start()):
            pos = m.start() + 1                       # \` is a literal backtick
            continue
        n = len(m.group())
        close = next((r for r in _RUN.finditer(src, m.end()) if len(r.group()) == n), None)
        if close is None:
            pos = m.end()                             # an unmatched run stays text
            continue
        if close.start() > end:
            return True
        pos = close.end()                             # no escapes inside code
    return False


def math_inline_rule(state: StateInline, silent: bool, code_spans: bool = True) -> bool:
    """Mathion's dollar rule: `$$…$$` first, then a pandoc-like `$…$`."""
    src, pos = state.src, state.pos
    if src[pos] != "$":
        return False
    if src.startswith("$$", pos):
        close = _next_dollar(src, pos + 2, "$$")
        if close == -1 or (code_spans and _in_code(src, pos + 2, close)):
            return False                              # an unclosed $$ stays text
        kind, mark = "math_inline_double", "$$"
    else:
        if pos and src[pos - 1] == "$" and not _escaped(src, pos - 1):
            return False                              # never half of a failed $$
        after = src[pos + 1] if pos + 1 < state.posMax else ""
        if (pos and _digit(src[pos - 1])) or not after or after.isspace():
            return False
        close = _next_dollar(src, pos + 1, "$")
        if close == -1 or close >= state.posMax or src[close - 1].isspace() or (code_spans and _in_code(src, pos + 1, close)):
            return False
        if close + 1 < len(src) and (src[close + 1] == "$" or _digit(src[close + 1])):
            return False
        kind, mark = "math_inline", "$"
    if close + len(mark) > state.posMax:
        return False
    if not silent:
        token = state.push(kind, "math", 0)
        token.markup = mark
        token.content = src[pos + len(mark):close]
    state.pos = close + len(mark)
    return True


_plugin_block = math_block_dollar(allow_labels=False, allow_blank_lines=False)


def _has_dollar(text: str) -> bool:
    return _next_dollar(text, 0, "$") != -1


def _block_end(state: StateBlock, startLine: int, endLine: int) -> int:
    """The line after the end marker, or where the block must stop: an outdent or a blank line."""
    n = startLine
    while n < endLine:
        if n > startLine and (state.sCount[n] < state.blkIndent or state.isEmpty(n)):
            return n                                  # the next list item, or a lazy line
        text = state.src[state.bMarks[n] + state.tShift[n]:state.eMarks[n]].strip()
        n += 1
        if text.endswith("$$") and (n - 1 > startLine or len(text) > 3):
            return n
        if n - 1 > startLine and _has_dollar(text):
            return n                                  # a `$` inside makes the block invalid anyway
    return n


def _math_block(state: StateBlock, startLine: int, endLine: int, silent: bool) -> bool:
    """The plugin's `$$` block, with its content rebuilt from the block's own lines."""
    if not state.src.startswith("$$", state.bMarks[startLine] + state.tShift[startLine]):
        return False                                  # cheap first: most blocks hold no math
    count, line = len(state.tokens), state.line
    if not _plugin_block(state, startLine, _block_end(state, startLine, endLine), silent):
        return False                                  # bounded, so a long list stays linear
    text = state.getLines(startLine, state.line, state.blkIndent, False).strip()
    content = text[2:-2] if len(text) >= 4 else ""
    valid = not _has_dollar(content) and not _escaped(text, len(text) - 2)
    if silent or not valid:
        del state.tokens[count:]                      # the plugin pushes even when silent
        state.line = line
        return valid and silent
    state.tokens[-1].content = content
    return True


def render_math(src: str, display: bool, in_paragraph: bool, mark: str | None = None) -> str:
    """MathML for one formula, or the escaped source in an error span or div."""
    try:
        mathml = latex_to_mathml(src, display)
    except LatexError as exc:
        reason = str(exc)
    except Exception:                                  # never break a page over one formula
        reason = "formula could not be read"
    else:
        if not display:
            return mathml
        tag = "span" if in_paragraph else "div"
        return f'<{tag} class="math-display">{mathml}</{tag}>'
    mark = mark or ("$$" if display else "$")
    tag = "div" if display and not in_paragraph else "span"
    title = html.escape(reason, quote=True)
    return f'<{tag} class="math-error" title="{title}">{mark}{html.escape(src, quote=True)}{mark}</{tag}>'


def _source(content: str) -> str:
    """The trimmed formula; a final backslash keeps its control space."""
    text = content.strip()
    return text + " " if _escaped(text + " ", len(text)) else text


def _render_inline(self, tokens, idx, options, env) -> str:
    return render_math(_source(tokens[idx].content), False, False)


def _render_inline_double(self, tokens, idx, options, env) -> str:
    return render_math(_source(tokens[idx].content), True, True)


def _render_block(self, tokens, idx, options, env) -> str:
    return render_math(_source(tokens[idx].content), True, False) + "\n"


def _render_inline_as_text(self, tokens, options, env) -> str:
    """An image's alt text: formulas keep their source, escapes and entities their text."""
    out = ""
    for token in tokens or []:
        if token.type in ("text", "text_special"):
            out += token.content
        elif token.type in ("math_inline", "math_inline_double"):
            out += _source(token.content)
        elif token.type == "image":
            out += self.renderInlineAsText(token.children, options, env)
        elif token.type in ("softbreak", "hardbreak"):
            out += "\n"
    return out


_md = MarkdownIt("commonmark", {"html": False})
_md.renderer.renderInlineAsText = types.MethodType(_render_inline_as_text, _md.renderer)
_md.core.ruler.push("loose_lists", _loose_lists)
_md.core.ruler.before("text_join", "bare_url", _bare_urls)
_md.core.ruler.after("bare_url", "drop_bad_links", _drop_bad_links)
dollarmath_plugin(_md, allow_labels=False, allow_blank_lines=False, double_inline=True)
_md.inline.ruler.at("math_inline", math_inline_rule)
_md.block.ruler.at("math_block", _math_block)
_md.add_render_rule("math_inline", _render_inline)
_md.add_render_rule("math_inline_double", _render_inline_double)
_md.add_render_rule("math_block", _render_block)

# The spec's per-tag MathML map: exactly what the converter emits.
MATHML_ALLOWED: dict[str, set[str]] = {
    "math": {"display"}, "semantics": set(), "annotation": {"encoding"}, "mrow": set(),
    "mi": {"mathvariant"}, "mn": set(), "mtext": set(), "mspace": {"width", "height", "depth"},
    "mo": {"stretchy", "largeop", "movablelimits", "fence", "form", "lspace", "rspace", "minsize", "maxsize"},
    "msup": set(), "msub": set(), "msubsup": set(), "mfrac": {"linethickness"}, "msqrt": set(),
    "mroot": set(), "mover": {"accent"}, "munder": {"accentunder"}, "munderover": set(),
    "mstyle": {"displaystyle", "scriptlevel"},
}

_ALLOWED_TAGS = {
    "p", "br", "strong", "em", "b", "i", "u", "s",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "a", "img",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "hr", "sup", "sub",
    "span", "div",  # for math wrappers
} | set(MATHML_ALLOWED)

_ALLOWED_ATTRS = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title"},
    # A list that resumes after a paragraph carries `start`, which markdown-it
    # emits and nh3 would otherwise drop. Harmless while the frontend forced
    # bullets onto every <ol>; once ordered lists render as numbers, a stripped
    # `start` renumbers a teacher's "3. 4. 5." to "1. 2. 3." — wrong content,
    # not just unstyled markup. Value-restricted by nh3 to the attribute name
    # only; the numeral itself is markdown-it's, never author HTML (html=False).
    "ol": {"start"},
    **{tag: set(attrs) for tag, attrs in MATHML_ALLOWED.items()},
}

_URL_SCHEMES = {"http", "https", "mailto"}
# class lives only here: ammonia panics when it is also an allowed attribute.
_ALLOWED_CLASSES = {
    "ul": {"loose"}, "ol": {"loose"},
    "span": {"math-display", "math-error"}, "div": {"math-display", "math-error"},
    "mo": {"math-acc", "math-vec"}, "mrow": {"math-overline", "math-underline"},
}


def render_markdown(text: str | None) -> str:
    """Convert Markdown to sanitized HTML.

    LaTeX math ($...$ and $$...$$) becomes MathML on the server.
    Links get rel="noopener noreferrer" automatically via nh3.
    javascript: URIs in href/src are stripped by nh3's url_schemes filter.
    """
    if not text:
        return ""
    return _clean(_md.render(text))


_opt = MarkdownIt("zero")
_opt.inline.ruler.push("math_inline", lambda st, sl: math_inline_rule(st, sl, code_spans=False))   # backticks are text here
_opt.enable(["escape", "text", "math_inline"])
_opt.add_render_rule("math_inline", _render_inline)
_opt.add_render_rule("math_inline_double",           # inline, but a broken one shows its $$
                     lambda self, t, i, o, e: render_math(_source(t[i].content), False, False, "$$"))
_opt.add_render_rule("hardbreak", lambda self, t, i, o, e: "\n")   # a backslash before a newline


def render_option_text(text: str) -> str:
    """An answer choice: escaped text with inline math only, no other Markdown."""
    return _clean(_opt.renderInline(text or ""))


def _clean(rendered: str) -> str:
    return nh3.clean(
        rendered,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        url_schemes=_URL_SCHEMES,
        allowed_classes=_ALLOWED_CLASSES,
        link_rel="noopener noreferrer",
        strip_comments=True,
    )


_SKIP_PREFIXES = ("http://", "https://", "mailto:", "#", "//")
# VR-B: a root-relative link is a Mathion page, unless it points at a file.
_FILE_PATHS = ("/assets/", "/api/")


def _is_asset_target(ref: str, is_link: bool) -> bool:
    if ref.lower().startswith(_SKIP_PREFIXES):
        return False                                  # schemes are case-insensitive (<Https://…>)
    return not (is_link and ref.startswith("/") and not ref.startswith(_FILE_PATHS))


def _targets(tokens: list[Token]):
    """Image sources and link targets, as markdown-it parsed them."""
    for tok in tokens:
        if tok.type == "image":
            yield tok.attrGet("src"), False
            continue                                  # its children are alt text, not links
        if tok.type == "link_open":
            yield tok.attrGet("href"), True
        if tok.children:
            yield from _targets(tok.children)


def extract_asset_filenames(text: str) -> set[str]:
    """Extract non-URL filenames from markdown image and link references.

    Read from the parsed tokens, so math, code and escaped brackets never count.
    """
    if not text:
        return set()
    filenames: set[str] = set()
    for ref, is_link in _targets(_md.parse(text)):
        ref = str(ref or "")                          # as rendered, so resolve_asset_urls finds it
        if ref and _is_asset_target(ref, is_link):
            filenames.add(ref)
    return filenames


def resolve_asset_urls(rendered: str, version_id: int, asset_filenames: set[str]) -> str:
    """Replace bare asset filenames with /assets/{version_id}/{filename} paths.

    Only replaces filenames in asset_filenames. Must be called AFTER
    render_markdown() / nh3 sanitization.
    """
    for filename in asset_filenames:
        rendered = rendered.replace(f'src="{filename}"', f'src="/assets/{version_id}/{filename}"')
        rendered = rendered.replace(f'href="{filename}"', f'href="/assets/{version_id}/{filename}"')
    return rendered
