"""Classify an imported page's link or image address: a web link, an uploaded course file, or text only."""
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import unquote, urlsplit


@dataclass
class LinkTargets:
    static: dict[str, str]          # source path relative to static/ → target asset name
    skipped: dict[str, str]         # source path → "empty" | "type" | "size"
    _maps: dict | None = field(default=None, init=False, repr=False, compare=False)

    def keyed(self, how: str) -> tuple[dict[str, str], dict[str, str]]:
        # "nfc": é typed as one or two characters; "under": c4x/asset-v1 write a subfolder "/" as "_"; "clean": Studio's key also turns odd characters into "_"
        if self._maps is None:
            self._maps = {}
            # one table per key form, so an exact spelling is found before any composed one
            for name, fn in (("nfc", _nfc), ("under", _under), ("under-nfc", lambda p: _under(_nfc(p))),
                             ("clean", _clean), ("clean-nfc", lambda p: _clean(_nfc(p)))):
                pair = ({}, {})
                for table, out in ((self.static, pair[0]), (self.skipped, pair[1])):
                    for path in sorted(table):
                        out.setdefault(fn(path), path)
                self._maps[name] = pair
        return self._maps[how]


@dataclass
class Link:
    kind: Literal["web", "asset", "text"]
    url: str | None
    blocked: bool = False
    note: str | None = None


_C0 = "".join(map(chr, range(0x21)))
_CLEAN = re.compile(r"[^\w.%-]")
_SCHEME = re.compile(r"([a-z][a-z0-9+.-]*):")
_STATIC = re.compile(r"(?:(?:\.\./)+|/)?static/(.+)", re.S)
_C4X = re.compile(r"/c4x/[^/]+/[^/]+/asset/(.+)", re.S)
_ASSET_V1 = re.compile(r"/?asset-v1:[^/]*?\+type@asset\+block@(.+)", re.S)
_COURSEWARE = re.compile(r"/assets/courseware/(.+)", re.S)
_WHY = {"empty": "the file is empty", "type": "Mathion does not allow this file type", "size": "the file is over the per-file limit"}


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _under(s: str) -> str:
    return s.replace("/", "_")


def _clean(s: str) -> str:
    # Studio's cleaned key; a decomposed accent's mark becomes "_"
    return _CLEAN.sub("_", _under(s))


def _static_name(path: str) -> tuple[str, str] | None:
    """("path", relative to static/) or ("under", an underscore asset name) for an Open edX static form."""
    path = unquote(path)
    if m := _STATIC.fullmatch(path):
        return "path", m.group(1)
    if m := (_C4X.fullmatch(path) or _ASSET_V1.fullmatch(path)):
        return "under", m.group(1)
    if m := _COURSEWARE.fullmatch(path):
        rest = m.group(1)
        return "under", rest.split("type@asset+block/", 1)[1] if "type@asset+block/" in rest else rest.rsplit("/", 1)[-1]
    return None


def _lookup(form: tuple[str, str], targets: LinkTargets) -> tuple[str, str] | None:
    """("asset", target) or ("skipped", reason) with the matched source path, or None."""
    how, name = form
    for table, kind in ((targets.static, "asset"), (targets.skipped, "skipped")):
        if name in table:
            return kind, name
    for keys, key in (("under", name), ("nfc", _nfc(name)), ("under-nfc", _nfc(name)),
                      ("clean", _clean(name)), ("clean-nfc", _clean(_nfc(name)))):
        if keys.startswith("under") and how != "under":
            continue
        static, skipped = targets.keyed(keys)
        for table, kind in ((static, "asset"), (skipped, "skipped")):
            if key in table:
                return kind, table[key]
    return None


def clean_address(url: str) -> str:
    """An address as browsers read it: tab/LF/CR removed, C0 controls and space trimmed."""
    return re.sub(r"[\t\n\r]", "", url).strip(_C0)


def classify_link(url: str, targets: LinkTargets, *, image: bool) -> Link:
    what = "An image" if image else "A link"
    u = clean_address(url)
    if not u:
        return Link("text", None)
    low = u.lower()
    if low.startswith("//"):
        u, low = "https:" + u, "https:" + low
    scheme = _SCHEME.match(low)
    if scheme and scheme.group(1) in ("http", "https"):
        u = scheme.group(1) + u[len(scheme.group(1)):]
        try:
            if not low.startswith(scheme.group(1) + "://"):
                raise ValueError("no host")            # "https:x" reads as a relative file name
            parts = urlsplit(u)
        except ValueError:
            return Link("text", None, note=f"{what} to “{u}” was removed because the address is not valid; its text was kept")
        form = _static_name(parts.path)
        if form is None:
            return Link("web", u)
        found = _lookup(form, targets)
        if found and found[0] == "asset":
            return Link("asset", targets.static[found[1]])
        host = parts.hostname or parts.netloc
        return Link("web", u, note=f"{what} to a file on the old course site ({host}) was kept as a web address: {u}")
    if scheme and scheme.group(1) == "mailto" and not image:
        return Link("web", "mailto" + u[6:])
    form = None if scheme and not low.startswith("asset-v1:") else _static_name(re.split(r"[?#]", u, maxsplit=1)[0])
    if form is None:
        if image and low.startswith("data:"):
            return Link("text", None, note="An image pasted into the page as a data: URL was removed; its text was kept")
        return Link("text", None, note=f"{what} to “{u}” was removed (only web addresses and course files can be linked); its text was kept")
    found = _lookup(form, targets)
    if found is None:
        return Link("text", None, note=f"{what} to “{u}” was removed because the file is not in the export; upload the file and re-link it")
    kind, path = found
    if kind == "asset":
        return Link("asset", targets.static[path])
    reason = targets.skipped[path]
    if reason == "size":
        return Link("text", None, blocked=True,
                    note=f"The file “{path}” is linked from this page but is over the per-file limit; make it smaller in Studio and export the course again")
    return Link("text", None, note=f"{what} to “{path}” was removed because the file was not uploaded ({_WHY[reason]}); upload the file and re-link it")
