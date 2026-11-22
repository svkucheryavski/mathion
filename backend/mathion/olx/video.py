"""Video items and Graasta pages from Open edX: embed URLs, start times and page kinds."""
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from mathion.olx.html_md import DEEP, DROPPED, SILENT_DROP, Node
from mathion.olx.links import clean_address

# ported from frontend/src/lib/normalizeVideoUrl.ts
YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
KNOWN_HOSTS = YT_HOSTS | {"youtu.be", "vimeo.com", "player.vimeo.com"}
NOCOOKIE_HOSTS = {"youtube-nocookie.com", "www.youtube-nocookie.com"}
VIDEO_URL_MAX = 500                                    # the video_url column
_YT_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]+")          # stricter than the TS port: nothing that needs encoding
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
_START_T = re.compile(r"([0-9]{1,9})s?")             # capped: int() refuses huge digit runs
_HMS = re.compile(r"([0-9]{1,6}):([0-9]{1,2}):([0-9]{1,2})(?:\.[0-9]+)?")
_GRAASTA = re.compile(r"https://graasta\.com/apps/([a-z0-9-]+)/?")
_SRC_PARTS = re.compile(r"https://([^/?#]*)(.*)", re.S)
_UNSAFE = re.compile("[\x00-\x1f\x7f\ud800-\udfff]")      # controls and lone halves from JSON escapes
# elements that show something even without text
VISIBLE = {"img", "video", "audio", "object", "embed", "input", "select", "textarea", "button", "svg", "canvas", "hr", "math", "picture"}
# characters a browser shows as nothing (TinyMCE leaves U+FEFF caret markers)
_INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿­"))


def to_https(url: str) -> str:
    """A protocol-relative or http: address as https:, its scheme lowercased."""
    u = clean_address(url)
    if u.startswith("//"):
        return "https:" + u
    m = re.match(r"(?i)https?:", u)
    return "https:" + u[m.end():] if m else u


def _lower_scheme(u: str) -> str:
    return re.sub(r"(?i)^https?://", lambda m: m.group().lower(), u)


def _youtube(video_id: str | None, query: str) -> str | None:
    if not video_id or not _VIDEO_ID.fullmatch(video_id):
        return None
    t = next((v for k, v in parse_qsl(query, keep_blank_values=True) if k == "t"), "")
    m = _START_T.fullmatch(t)
    return f"https://www.youtube.com/embed/{video_id}" + (f"?start={int(m.group(1))}" if m else "")


def _dot_segments(path: str) -> bool:
    # a browser resolves these, also percent-encoded or after a backslash, before loading
    return any(seg.lower().replace("%2e", ".") in (".", "..") for seg in path.replace("\\", "/").split("/"))


def _kept(u: str, parts, host: str) -> str | None:
    # an address kept as written: no port, userinfo or backslash a browser would read differently
    return u if parts.netloc.lower() == host else None


def embed_url(url: str) -> str | None:
    """The embed form of a YouTube or Vimeo address, else None."""
    u = clean_address(url)
    if not u or _UNSAFE.search(u):
        return None
    if not _SCHEME.match(u):
        if re.split(r"[/?#]", u, maxsplit=1)[0].lower() not in KNOWN_HOSTS:
            return None
        u = "https://" + u                                 # a scheme-less address on a known host
    u = _lower_scheme(u)
    try:
        parts = urlsplit(u)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").lower()
    path = parts.path
    if _dot_segments(path):
        return None
    if host in YT_HOSTS:
        if path.startswith("/embed/"):
            ok = _VIDEO_ID.fullmatch(path[len("/embed/"):].split("/")[0])
            return _kept(u, parts, host) if ok else None
        if path == "/watch":
            vid = next((v for k, v in parse_qsl(parts.query, keep_blank_values=True) if k == "v"), None)
            return _youtube(vid, parts.query)
        if path.startswith("/shorts/"):
            return _youtube(path[len("/shorts/"):].split("/")[0], parts.query)
        return None
    if host == "youtu.be":
        return _youtube(path[1:].split("/")[0], parts.query)
    if host == "vimeo.com":
        seg = path[1:].split("/")[0]
        return f"https://player.vimeo.com/video/{seg}" if re.fullmatch(r"[0-9]+", seg) else None
    if host == "player.vimeo.com":
        return _kept(u, parts, host) if re.fullmatch(r"/video/[0-9]+/?", path) else None
    return None


def with_start(url: str, seconds: int) -> str:
    """YouTube ?start=N on any path, Vimeo #t=Ns; 0 leaves the address as it is."""
    if seconds <= 0:
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    host = (parts.hostname or "").lower()
    if host in YT_HOSTS | NOCOOKIE_HOSTS | {"youtu.be"}:
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "start"]
        return urlunsplit(parts._replace(query=urlencode(query + [("start", str(seconds))])))
    if host in ("vimeo.com", "player.vimeo.com"):
        return urlunsplit(parts._replace(fragment=f"t={seconds}s"))
    return url


def _sources(node: ET.Element) -> list[str]:
    out: list[str] = []
    try:
        listed = json.loads(node.get("html5_sources") or "[]")
    except (ValueError, RecursionError):
        listed = []
    if isinstance(listed, list):
        out += [s for s in listed if isinstance(s, str)]
    out += [s.get("src", "") for s in node.findall("source")]
    return [s for s in dict.fromkeys(out) if s.strip()]


def _youtube_id(node: ET.Element) -> str | None:
    yid = (node.get("youtube_id_1_0") or "").strip()
    if _YT_ID.fullmatch(yid):
        return yid
    for entry in (node.get("youtube") or "").split(","):  # older form: "0.75:id,1.00:id,…"
        speed, _, yid = entry.partition(":")
        if speed.strip() in ("1", "1.0", "1.00") and _YT_ID.fullmatch(yid.strip()):
            return yid.strip()
    return None


def video_component(node: ET.Element) -> tuple[str | None, list[str]]:
    """(embed URL, report lines for dropped features) for an Open edX video; no lines when there is no URL."""
    yid = _youtube_id(node)
    url = f"https://www.youtube.com/embed/{yid}" if yid else None
    if url is None:
        url = next((e for e in (embed_url(to_https(s)) for s in _sources(node)) if e), None)
    if url is None:
        return None, []
    notes = []
    start = (node.get("start_time") or "").strip()
    if m := _HMS.fullmatch(start):
        url = with_start(url, int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)))
    elif start.strip("0:."):                             # a zero start in any form means none
        notes.append("Video start times that could not be read were dropped")
    if len(url) > VIDEO_URL_MAX:
        return None, []
    end = (node.get("end_time") or "").strip()
    if end.strip("0:."):                               # a zero end time means none
        notes.append("Video end times dropped")
    transcripts = (node.get("transcripts") or "").strip()
    if (node.get("sub") or "").strip() or transcripts not in ("", "{}") or node.find("transcript") is not None:
        notes.append("Video transcripts dropped")
    if "true" in ((node.get("download_video") or "").lower(), (node.get("download_track") or "").lower()):
        notes.append("Video download settings dropped")
    return url, notes


@dataclass
class PageKind:
    kind: Literal["graasta", "video", "page"]
    value: str | None


def _only_iframe(root: Node) -> Node | None:
    """The page's one iframe when nothing else on it shows; fallback content inside it is ignored."""
    frames: list[Node] = []
    stack = list(root.children)
    while stack:
        n = stack.pop()
        if n.tag is None:
            if n.text.translate(_INVISIBLE).strip():
                return None
        elif n.tag == "iframe":
            frames.append(n)
            if len(frames) > 1:
                return None
        elif n.tag in VISIBLE:
            return None
        elif n.tag not in DROPPED and n.tag not in SILENT_DROP and n.tag != DEEP:
            stack.extend(n.children)
    return frames[0] if frames else None


def _graasta(src: str) -> str | None:
    m = _SRC_PARTS.fullmatch(src)
    if not m or "@" in m.group(1) or ":" in m.group(1):
        return None
    host = m.group(1).lower()
    host = host[4:] if host.startswith("www.") else host
    g = _GRAASTA.fullmatch(f"https://{host}{m.group(2)}")
    return g.group(1) if g else None


def _video(src: str) -> str | None:
    try:
        parts = urlsplit(src)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if host in NOCOOKIE_HOSTS:
        ok = parts.path.startswith("/embed/") and _VIDEO_ID.fullmatch(parts.path[len("/embed/"):].split("/")[0]) \
            and not _dot_segments(parts.path)
        url = _kept(src, parts, host) if ok else None
    else:
        url = embed_url(src)
    return url if url and len(url) <= VIDEO_URL_MAX else None


def classify_html(root: Node) -> PageKind:
    """graasta (app name) or video (URL) when the page holds only one such iframe, else page."""
    frame = _only_iframe(root)
    if frame is None or "srcdoc" in frame.attrs:       # a browser shows srcdoc instead of src
        return PageKind("page", None)
    src = to_https(frame.attrs.get("src", ""))
    if not src.startswith("https://") or _UNSAFE.search(src):
        return PageKind("page", None)
    if name := _graasta(src):
        return PageKind("graasta", name)
    if url := _video(src):
        return PageKind("video", url)
    return PageKind("page", None)
