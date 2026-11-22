"""Open edX page HTML as Mathion Markdown: blocks, inline formatting, formulas and classified links."""
import itertools
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urlsplit

from mathion.olx.links import Link, LinkTargets, classify_link, clean_address
from mathion.olx.mdtext import (
    Seg, escape_line_starts, escape_text, formula_errors, normalize_segments, render_segments,
    script_text_ok, split_math,
)
from mathion.olx.report import Report

MAX_HTML_DEPTH = 100
MAX_MD_NEST = 16                                      # the renderer stops at 20 levels; a list takes 2, a quote 1
VOID = {"br", "img", "hr", "input", "source", "meta", "link", "wbr", "area", "base", "col", "embed", "param", "track", "bgsound", "basefont"}
DROPPED = {"script", "style"}
SILENT_DROP = {"head", "title", "template", "noscript", "noembed", "noframes"}   # never shown (scripting on)
# tags a browser keeps inside head; anything else closes it
HEAD_OK = {"base", "basefont", "bgsound", "link", "meta", "title", "noscript", "noframes", "style", "script", "template", "head"}
SPECIAL_BLOCKS = {"h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "pre", "blockquote", "hr", "table"}
BOUNDARIES = {"p", "div", "section", "li", "html", "body", "tr", "td", "th", "thead", "tbody", "tfoot", "caption"}
DEEP = "#deep"                                        # a too-deep link's address; no HTML tag starts with "#"
INLINE = {"strong", "b", "em", "i", "a", "code", "br", "img", "sup", "sub", "iframe", DEEP}
ADDRESS = {"a": "href", "img": "src", "iframe": "src"}
# not converted, but they end a paragraph like the block elements they are
UNKNOWN_BOUNDARIES = {
    "center", "article", "aside", "header", "footer", "main", "nav", "figure", "figcaption", "dl", "dt", "dd",
    "details", "summary", "address", "form", "fieldset", "legend", "hgroup", "dir", "menu", "noscript",
}
QUIET = {"span", "html", "body", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"}
SENT = "￼"                                       # stands for one ready piece in the joined text
_WS = re.compile(r"[ \t\n\r\f\v]+")
_BREAK_SPACES = re.compile(r"(?<! ) *\\\n *")   # starts only at a run's first space: linear
_SCRIPT_DIGITS = re.compile(r"[0-9+\-−]+")
_ITEM_START = re.compile(r"(?:[-*] |\d+[.)] )")
_FINAL_HASHES = re.compile(r"(^|\s)(#+)$")


@dataclass
class Node:
    tag: str | None
    attrs: dict[str, str]
    children: list["Node"]
    text: str = ""


class _Parser(HTMLParser):
    CDATA_CONTENT_ELEMENTS = tuple(dict.fromkeys(HTMLParser.CDATA_CONTENT_ELEMENTS + ("iframe", "noscript")))   # frame content is raw text

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._support_cdata = False                     # HTML reads <![CDATA[ as a comment ending at ">"
        self.root = Node("root", {}, [])
        self.stack = [self.root]
        self.excess: dict[str, int] = {}

    def _close_implied(self, tag: str) -> None:
        # a new item or cell ends the open one, as browsers do
        rule = {"li": ({"li"}, {"ul", "ol"}), "td": ({"td", "th"}, {"tr", "table"}),
                "th": ({"td", "th"}, {"tr", "table"}), "tr": ({"tr"}, {"table"})}.get(tag)
        if rule is None:
            return
        targets, stops = rule
        for i in range(len(self.stack) - 1, 0, -1):
            t = self.stack[i].tag
            if t in targets:
                del self.stack[i:]
                return
            if t in stops:
                return

    def _close_head(self) -> None:
        while self.stack[-1].tag == "head":
            self.stack.pop()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in HEAD_OK:
            self._close_head()
        self._close_implied(tag)
        node = Node(tag, {}, [])
        for k, v in attrs:
            node.attrs.setdefault(k, v or "")
        if tag in VOID:
            self.stack[-1].children.append(node)
        elif len(self.stack) >= MAX_HTML_DEPTH and tag not in DROPPED:
            self.excess[tag] = self.excess.get(tag, 0) + 1   # too deep: its content joins the parent
            if ADDRESS.get(tag) in node.attrs:
                self.stack[-1].children.append(Node(DEEP, {"tag": tag, ADDRESS[tag]: node.attrs[ADDRESS[tag]]}, []))
        else:
            self.stack[-1].children.append(node)
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        rcdata = getattr(self, "RCDATA_CONTENT_ELEMENTS", ())
        foreign = any(n.tag in ("svg", "math") for n in self.stack)   # svg/math honour "/>"
        if (tag in self.CDATA_CONTENT_ELEMENTS or tag in rcdata or tag == "plaintext") and not foreign:
            self.handle_starttag(tag, attrs)           # in HTML a browser ignores the "/" and reads raw text
            self.set_cdata_mode(tag, escapable=tag in rcdata)
            return
        if tag not in HEAD_OK:
            self._close_head()
        node = Node(tag, {}, [])
        for k, v in attrs:
            node.attrs.setdefault(k, v or "")
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag: str) -> None:
        if self.excess.get(tag):
            self.excess[tag] -= 1
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data: str) -> None:
        if data.strip(" \t\n\f\r"):
            self._close_head()                         # visible text closes head, as browsers do
        if data:
            self.stack[-1].children.append(Node(None, {}, [], data))


def parse_html(text: str) -> Node:
    """Own tree over html.parser; entities are decoded once, unclosed tags close at their parent's end."""
    parser = _Parser()
    try:
        parser.feed(text)
        parser.close()
    except Exception:                                  # keep what was read
        pass
    return parser.root


def _walk_text(root: Node, br: str, boundary: object | None) -> str:
    parts: list[str] = []
    stack: list = [iter(root.children)]
    while stack:
        n = next(stack[-1], None)
        if n is None:
            stack.pop()
            continue
        if n is boundary:
            parts.append(" ")
        elif n.tag is None:
            parts.append(n.text)
        elif n.tag == "br":
            parts.append(br)
        elif n.tag not in DROPPED | SILENT_DROP | {"iframe"}:
            if boundary and (n.tag in BOUNDARIES | SPECIAL_BLOCKS | UNKNOWN_BOUNDARIES):
                stack.append(itertools.chain([boundary], n.children, [boundary]))
            else:
                stack.append(iter(n.children))
    return "".join(parts)


_EDGE = object()


def text_only(root: Node) -> str:
    """Visible text, for titles of links and choices."""
    return _WS.sub(" ", _walk_text(root, " ", _EDGE)).strip()


@dataclass
class _Raw:
    md: str           # ready Markdown
    plain: str        # what it reads as inside a formula
    kind: str         # "break", "mark", "link", "image", "code" or "script"
    pair: int = 0     # opening and closing marks of one element share it
    asset: str = ""   # the uploaded file it links, counted only if it stays


Piece = str | _Raw


@dataclass
class MdResult:
    markdown: str
    linked_assets: set[str]
    segs: list[Seg]


def _visible(pieces: list[Piece]) -> bool:
    return any((p.strip() if isinstance(p, str) else p.kind != "break") for p in pieces)


def _blank(p: Piece) -> bool:
    return (isinstance(p, _Raw) and p.kind == "break") or (isinstance(p, str) and not p.strip())


def _trim(pieces: list[Piece]) -> tuple[list[Piece], list[Piece], list[Piece]]:
    """Leading and trailing whitespace (NBSP included, as CommonMark counts it) and breaks split off the pieces."""
    i, j = 0, len(pieces)
    while i < j and _blank(pieces[i]):
        i += 1
    while j > i and _blank(pieces[j - 1]):
        j -= 1
    lead, mid, trail = list(pieces[:i]), list(pieces[i:j]), list(pieces[j:])
    if mid and isinstance(mid[0], str):
        rest = mid[0].lstrip()
        lead.append(mid[0][: len(mid[0]) - len(rest)])
        mid[0] = rest
    if mid and isinstance(mid[-1], str):
        rest = mid[-1].rstrip()
        trail.insert(0, mid[-1][len(rest):])
        mid[-1] = rest
    return lead, mid, trail


def _strip_edge_breaks(text: str) -> str:
    # linear: a regex with a "$" branch retries inside every break run
    i, j = 0, len(text)
    while i < j:
        if text.startswith("\\\n", i):
            i += 2
        elif text[i] == " ":
            i += 1
        else:
            break
    while j > i:
        if text.endswith("\\\n", i, j):
            j -= 2
        elif text[j - 1] == " ":
            j -= 1
        else:
            break
    return text[i:j]


def _rows(children: list[Node]) -> list[Node]:
    # cells straight inside a table or its sections form one row, as browsers show them
    out: list[Node] = []
    run: list[Node] = []
    for c in children:
        if c.tag in ("td", "th"):
            run.append(c)
            continue
        if run and c.tag is None and not c.text.strip():
            continue
        if run:
            out.append(Node("tr", {}, run))
            run = []
        out.append(c)
    if run:
        out.append(Node("tr", {}, run))
    return out


def _host(url: str) -> str:
    # a frame's fallback label: the web host, else the address itself
    try:
        return (urlsplit(url).hostname or url) if url.startswith(("http://", "https://")) else url
    except ValueError:
        return url


def _code_md(text: str) -> str:
    fence = "`" * (max((len(m) for m in re.findall(r"`+", text)), default=0) + 1)
    pad = " " if text[0] == "`" or text[-1] == "`" or (text[0] == text[-1] == " " and text.strip()) else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _dest(url: str) -> str:
    for ch, enc in (("&", "&amp;"), ("\\", "%5C"), ("<", "%3C"), (">", "%3E"), ("\n", "%0A"), ("\r", "%0D")):
        url = url.replace(ch, enc)                    # & as &amp; so no entity is decoded in the address
    return f"<{url}>"


class _Converter:
    def __init__(self, targets: LinkTargets, report: Report, where: str) -> None:
        self.targets, self.report, self.where = targets, report, where
        self.assets: set[str] = set()
        self.segs: list[Seg] = []
        self.told: set = set()
        self.marks: dict[str, int] = {"*": 0, "**": 0}
        self.pairs = 0
        self.nest = 0

    def tell(self, key, level: str, text: str) -> None:
        # once per page
        if key not in self.told:
            self.told.add(key)
            self.report.add(level, self.where, text)

    def tell_tag(self, tag: str) -> None:
        self.tell(("tag", tag), "changed", f"The <{tag}> tag is not supported; its text was kept")

    def audit(self, n: Node) -> None:
        # links in content flattened to text (code, pre, sup/sub, too deep) are still checked and reported
        found = False
        stack = [n]
        while stack:
            c = stack.pop()
            if c.tag in DROPPED:
                continue
            tag = c.attrs.get("tag", "") if c.tag == DEEP else c.tag or ""
            attr = ADDRESS.get(tag)
            if attr and (c is not n or c.tag == DEEP) and attr in c.attrs:
                link = classify_link(c.attrs[attr], self.targets, image=tag == "img")
                self.note_link(link)
                found = found or link.kind != "text" or link.note is not None
            stack.extend(reversed(c.children))
        if found:
            self.tell("flat", "changed", "Links or images inside code, preformatted text, superscripts or very deep nesting were kept as plain text")

    def note_link(self, link: Link) -> None:
        # the same problem once per page
        if link.note and ("link", link.note) not in self.told:
            self.told.add(("link", link.note))
            if link.blocked:
                self.report.block(self.where, link.note)
            else:
                self.report.add("note" if link.kind == "web" else "changed", self.where, link.note)

    # blocks

    def blocks(self, nodes: list[Node]) -> list[str]:
        out: list[str] = []
        run: list[Piece] = []
        flush = object()

        def end_run() -> None:
            if run:
                text = self.para(run)
                run.clear()
                if text:
                    out.append(text)

        stack: list = [iter(nodes)]
        while stack:
            n = next(stack[-1], None)
            if n is None:
                stack.pop()
                continue
            if n is flush:
                end_run()
                continue
            t = n.tag
            if t is None or t in INLINE:
                run.extend(self.inline([n]))
            elif t in DROPPED:
                self.tell("script", "changed", "Scripts and styles were dropped with their content")
            elif t in SILENT_DROP:
                continue
            elif t in SPECIAL_BLOCKS:
                end_run()
                out.extend(self.special(n, out))
            elif t in BOUNDARIES or t in UNKNOWN_BOUNDARIES:
                if t not in BOUNDARIES:
                    self.tell_tag(t)
                end_run()
                stack.append(itertools.chain(n.children, [flush]))
            else:
                if t not in QUIET:
                    self.tell_tag(t)
                stack.append(iter(n.children))     # span and unknown inline tags: their content joins the flow
        end_run()
        return out

    def special(self, n: Node, before: list[str]) -> list[str]:
        t = n.tag or ""
        if t in ("ul", "ol"):
            return self.list_block(n, before)
        if t == "pre":
            self.audit(n)
            text = _walk_text(n, "\n", None).replace("\r\n", "\n").replace("\r", "\n")
            text = text.removeprefix("\n").rstrip("\n")
            if not text.strip():
                return []
            fence = "`" * max(3, max((len(m) for m in re.findall(r"`+", text)), default=0) + 1)
            return [f"{fence}\n{text}\n{fence}"]
        if t == "blockquote":
            flat = self.nest + 1 > MAX_MD_NEST
            self.nest += 0 if flat else 1
            try:
                inner = self.blocks(n.children)
            finally:
                self.nest -= 0 if flat else 1
            if flat:
                self.tell_nest()
            if not inner or flat:
                return inner
            return ["\n".join(f"> {ln}" if ln else ">" for ln in "\n\n".join(inner).split("\n"))]
        if t == "hr":
            return ["___"]                            # "---" after a list marker would end the list
        if t == "table":
            return self.table(n)
        pieces = [" " if isinstance(p, _Raw) and p.kind == "break" else p for p in self.inline(n.children)]
        text = _FINAL_HASHES.sub(r"\1\\\2", self.para(pieces))   # a closing # run would vanish
        return [f"{'#' * int(t[1])} {text}"] if text else []

    def tell_nest(self) -> None:
        self.tell("nest", "changed", "Lists or quotes nested too deep were flattened")

    def list_block(self, n: Node, before: list[str]) -> list[str]:
        ordered = n.tag == "ol"
        groups: list[list[Node]] = []
        for c in n.children:
            if c.tag == "li":
                groups.append(list(c.children))
            elif c.tag in ("ul", "ol") and groups:
                groups[-1].append(c)                  # a list right inside a list belongs to the item before
            elif c.tag is None and not c.text.strip(" \t\n\r\f\v"):
                continue
            else:
                groups.append([c])
        flat = self.nest + 2 > MAX_MD_NEST
        self.nest += 0 if flat else 2
        try:
            items = [b for b in (self.blocks(g) for g in groups) if b]
        finally:
            self.nest -= 0 if flat else 2
        if flat and items:
            self.tell_nest()
            return [b for blocks in items for b in blocks]
        if not items:
            return []
        prev = before[-1] if before else ""
        if ordered:
            delim = ")" if re.match(r"\d+\. ", prev) else "."
        else:
            delim = "*" if prev.startswith("- ") else "-"   # a new marker starts a new list
        loose = False
        rendered = []
        for k, blocks in enumerate(items):
            marker = f"{k + 1}{delim} " if ordered else f"{delim} "
            pad = " " * len(marker)
            text = blocks[0]
            for b in blocks[1:]:
                tight = bool(_ITEM_START.match(b))
                loose = loose or not tight
                text += ("\n" if tight else "\n\n") + b
            lines = text.split("\n")
            rendered.append("\n".join([marker + lines[0]] + [pad + ln if ln else "" for ln in lines[1:]]))
        return [("\n\n" if loose else "\n").join(rendered)]

    def table(self, n: Node) -> list[str]:
        out = []
        stack: list = [iter(_rows(n.children))]
        while stack:
            c = next(stack[-1], None)
            if c is None:
                stack.pop()
            elif c.tag in ("thead", "tbody", "tfoot"):
                stack.append(iter(_rows(c.children)))
            elif c.tag in ("tr", "caption") or c.tag is not None or c.text.strip():
                # a row's cells; anything else in the table reads as a row of its own
                cells = [x for x in c.children] if c.tag == "tr" else [c]
                pieces: list[Piece] = []
                for cell in cells:
                    cp = self.inline(cell.children if cell.tag in ("td", "th", "caption", "tr") else [cell])
                    if _visible(cp):
                        if pieces:
                            pieces.append(" · ")
                        pieces.extend(_trim(cp)[1])
                text = self.para(pieces)
                if text:
                    out.append(text)
        if out:
            self.tell("table", "changed", "A table was turned into rows of text (Mathion pages have no tables)")
        return out

    # inline

    def inline(self, nodes: list[Node], in_link: bool = False) -> list[Piece]:
        out: list[Piece] = []
        for n in nodes:
            t = n.tag
            if t is None:
                out.append(n.text.replace(SENT, ""))
            elif t in DROPPED:
                self.tell("script", "changed", "Scripts and styles were dropped with their content")
            elif t in SILENT_DROP:
                continue
            elif t == "br":
                out.append(_Raw("\\\n", " ", "break"))
            elif t in ("strong", "b", "em", "i"):
                out.extend(self.emphasis(n, "**" if t in ("strong", "b") else "*", in_link))
            elif t == "a":
                out.extend(self.link(n, in_link))
            elif t in ("code", "pre"):
                self.audit(n)
                text = _WS.sub(" ", _walk_text(n, " ", None))
                if text:
                    out.append(_Raw(_code_md(text), text, "code") if text.strip() else " ")
            elif t == "img":
                out.extend(self.image(n))
            elif t in ("sup", "sub"):
                out.extend(self.script(n))
            elif t == "iframe":
                out.extend(self.iframe(n, in_link))
            elif t == DEEP:
                self.audit(n)
            elif t == "hr":
                out.append(" ")
            elif t in BOUNDARIES or t in SPECIAL_BLOCKS or t in UNKNOWN_BOUNDARIES:
                if t not in BOUNDARIES | SPECIAL_BLOCKS:
                    self.tell_tag(t)
                out.extend([" ", *self.inline(n.children, in_link), " "])
            else:
                if t not in QUIET:
                    self.tell_tag(t)
                out.extend(self.inline(n.children, in_link))
        return out

    def emphasis(self, n: Node, mark: str, in_link: bool) -> list[Piece]:
        if self.marks[mark]:
            return self.inline(n.children, in_link)    # nested same emphasis adds nothing
        self.marks[mark] += 1
        try:
            inner = self.inline(n.children, in_link)
        finally:
            self.marks[mark] -= 1
        lead, inner, trail = _trim(inner)
        if not _visible(inner):
            return lead + inner + trail
        self.pairs += 1
        return [*lead, _Raw(mark, "", "mark", self.pairs), *inner, _Raw(mark, "", "mark", self.pairs), *trail]

    def _linked(self, link: Link, inner: list[Piece], label: str) -> list[Piece]:
        lead, inner, trail = _trim(inner)
        if not _visible(inner):
            inner = [label]
        asset = (link.url or "") if link.kind == "asset" else ""
        self.pairs += 1
        return [*lead, _Raw("[", "", "link", self.pairs, asset), *inner, _Raw(f"]({_dest(link.url or '')})", "", "link", self.pairs), *trail]

    def link(self, n: Node, in_link: bool) -> list[Piece]:
        href = n.attrs.get("href")
        if href is None:
            return self.inline(n.children, in_link)
        if in_link:
            self.note_link(classify_link(href, self.targets, image=False))   # plain text, but an over-limit file still blocks
            return self.inline(n.children, in_link)
        link = classify_link(href, self.targets, image=False)
        self.note_link(link)
        if link.kind == "text":
            return self.inline(n.children, in_link)
        return self._linked(link, self.inline(n.children, True), link.url or "")

    def image(self, n: Node) -> list[Piece]:
        alt = n.attrs.get("alt", "").replace(SENT, "")
        link = classify_link(n.attrs.get("src", ""), self.targets, image=True)
        self.note_link(link)
        if link.kind == "text":
            return [alt] if alt.strip() else []
        asset = (link.url or "") if link.kind == "asset" else ""
        return [_Raw(f"![{escape_text(alt).strip()}]({_dest(link.url or '')})", "", "image", 0, asset)]

    def iframe(self, n: Node, in_link: bool) -> list[Piece]:
        src = n.attrs.get("src", "")
        link = classify_link(src, self.targets, image=False)
        if link.kind == "text" and link.note is None:
            return []
        became = "plain text" if link.kind == "text" else "a plain link"
        self.report.add("changed", self.where, f"An embedded frame was turned into {became}: {clean_address(src)}")
        self.note_link(link)
        label = n.attrs.get("title", "").strip()
        if not label:
            label = _host(link.url) if link.kind == "web" and link.url else (link.url or clean_address(src))
        if link.kind == "text" or in_link:
            return [" ", label, " "]
        return [" ", *self._linked(link, [label], label), " "]

    def script(self, n: Node) -> list[Piece]:
        sup = n.tag == "sup"
        self.audit(n)
        text = text_only(n)
        if not text:
            return []
        if _SCRIPT_DIGITS.fullmatch(text):
            body = text.replace("−", "-")
        elif script_text_ok(text):
            body = "\\text{" + text + "}"
        else:
            self.report.add("changed", self.where, f"A {'superscript' if sup else 'subscript'} was kept as plain text: “{text}”")
            return [text]
        if ("script",) not in self.told:
            self.told.add(("script",))
            self.report.once("supsub", "changed", "Superscripts and subscripts were turned into formula scripts", "page|pages")
        return [_Raw(("^{" if sup else "_{") + body + "}", text, "script")]

    # one paragraph

    def para(self, pieces: list[Piece]) -> str:
        merged: list[Piece] = []
        code: list[str] = []
        alias: dict[int, int] = {}                    # a cancelled open's pair → the run's first pair
        for p in pieces:
            if isinstance(p, _Raw) and p.kind == "code":
                code.append(p.plain)                  # back-to-back code spans would fuse; join them
                continue
            if code and p == "":
                continue
            if code:
                text = "".join(code)
                merged.append(_Raw(_code_md(text), text, "code"))
                code = []
            if p == "":
                continue
            last = merged[-1] if merged else None
            if isinstance(p, _Raw) and p.kind == "mark" and isinstance(last, _Raw) and last.kind == "mark" and last.md == p.md:
                merged.pop()                          # a close and an open of the same emphasis: one run
                alias[p.pair] = alias.get(last.pair, last.pair)
                continue
            merged.append(p)
        if code:
            text = "".join(code)
            merged.append(_Raw(_code_md(text), text, "code"))
        _, merged, _ = _trim(merged)
        if not _visible(merged):
            return ""
        joined: list[str] = []
        raws: list[_Raw] = []
        for p in merged:
            if isinstance(p, str):
                joined.append(p.replace(SENT, ""))
            else:
                joined.append(SENT)
                raws.append(p)
        split = split_math("".join(joined))
        consumed: set[int] = set()                    # pairs with one half inside a formula
        k = 0
        lost = False
        for s in split:
            n = s.text.count(SENT)
            if s.kind == "math":
                for raw in raws[k:k + n]:
                    lost = lost or raw.kind in ("link", "image", "code", "mark")
                    if raw.pair:
                        consumed.add(alias.get(raw.pair, raw.pair))
            k += n
        ready = iter(raws)
        segs: list[Seg] = []
        for s in split:
            parts = s.text.split(SENT)
            if s.kind == "math":
                body = parts[0]
                for part in parts[1:]:
                    body += next(ready).plain + part
                segs.append(Seg("math", body, s.display))
                continue
            for i, part in enumerate(parts):
                if i:
                    raw = next(ready)
                    if not (raw.pair and alias.get(raw.pair, raw.pair) in consumed):
                        segs.append(Seg("math" if raw.kind == "script" else "code", raw.md))
                        if raw.asset:
                            self.assets.add(raw.asset)
                if part:
                    segs.append(Seg("text", part))
        if lost:
            self.tell("lost", "changed", "Formatting, links, images or code inside a formula were dropped")
        segs = normalize_segments(segs)
        self.segs.extend(segs)
        for src, reason in formula_errors(segs):
            self.report.add("changed", self.where, f"Formula could not be typeset: {reason} (“{src}”)")
        text = _strip_edge_breaks(_BREAK_SPACES.sub("\\\\\n", render_segments(segs)))
        return escape_line_starts(text)


def html_to_markdown(root: Node, targets: LinkTargets, report: Report, where: str) -> MdResult:
    conv = _Converter(targets, report, where)
    blocks = conv.blocks(root.children)
    return MdResult("\n\n".join(blocks), conv.assets, conv.segs)
