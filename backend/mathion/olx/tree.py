"""Read the course tree from an export's text files: pointers, inline nodes, staff-only nodes, depth and loop guards."""
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
import xml.parsers.expat as expat
from dataclasses import dataclass

from mathion.olx.report import Report

MAX_DEPTH = 20
MAX_XML_DEPTH = 200
SEP = " › "
_XML_BANNED = re.compile(r"<!(DOCTYPE|ENTITY)", re.IGNORECASE)
_HTML_BANNED = re.compile(r"<!ENTITY", re.IGNORECASE)
_INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x84\x86-\x9f\u202a-\u202e\u2060-\u206f\ufeff]")
_BLANK_LETTERS = frozenset("\u115f\u1160\u3164\uffa0\u2800")
MAX_NAME = 200
# breaking whitespace only: no-break and ideographic spaces stay as typed
_SPACES = re.compile(r"[^\S\u00a0\u2007\u202f\u3000]+")


class OlxError(Exception):
    def __init__(self, where: str, text: str):
        super().__init__(text)
        self.where = where
        self.text = text


def parse_xml(text: str, path: str) -> ET.Element:
    if _XML_BANNED.search(text):
        raise OlxError(path, f"{path} declares a DOCTYPE or ENTITY, which exports never use")
    # no namespace processing: prefixed names stay as written and never expand
    builder = ET.TreeBuilder()
    parser = expat.ParserCreate()
    parser.buffer_text = True
    parser.StartElementHandler = builder.start
    parser.EndElementHandler = builder.end
    parser.CharacterDataHandler = builder.data
    try:
        parser.Parse(text, True)
        root = builder.close()
    except expat.ExpatError as exc:
        raise OlxError(path, f"{path} is not valid XML ({exc})") from None
    stack = [iter(root)]
    while stack:
        child = next(stack[-1], None)
        if child is None:
            stack.pop()
        elif len(stack) >= MAX_XML_DEPTH:
            raise OlxError(path, f"{path} is nested more than {MAX_XML_DEPTH} levels deep")
        else:
            stack.append(iter(child))
    return root


@dataclass
class Component:
    tag: str
    display_name: str
    node: ET.Element
    html: str | None
    path: str


@dataclass
class Unit:
    display_name: str
    components: list[Component]
    path: str


@dataclass
class Subsection:
    display_name: str
    units: list[Unit]


@dataclass
class Chapter:
    display_name: str
    subsections: list[Subsection]


@dataclass
class CourseTree:
    display_name: str
    run: str
    max_attempts: str | None
    chapters: list[Chapter]


def _clean(text: str) -> str:
    # one line cut to the title limit; controls and direction overrides dropped
    name = _SPACES.sub(" ", _INVISIBLE.sub("", text[: MAX_NAME * 10])).strip()[:MAX_NAME].rstrip()
    visible = any(unicodedata.category(c)[0] not in "ZC" or unicodedata.category(c) in ("Cn", "Co")
                  for c in name if c not in _BLANK_LETTERS)
    return name if visible else ""


def _name(node: ET.Element) -> str:
    return _clean(node.get("display_name") or "")


def _staff_only(*nodes: ET.Element) -> bool:
    return any((n.get("visible_to_staff_only") or "").strip().lower() == "true" for n in nodes)


def _is_pointer(el: ET.Element) -> bool:
    return bool(el.get("url_name")) and set(el.attrib) == {"url_name"} and len(el) == 0 and not (el.text or "").strip()


def _join(*parts: str) -> str:
    return SEP.join(p for p in parts if p)


class _Walk:
    def __init__(self, files: dict[str, str], report: Report):
        self.files = files
        self.report = report
        self.visited: set[str] = set()
        self.failed: dict[str, str] = {}
        self.told: set[tuple[str, str]] = set()

    def fail(self, blocking: bool, where: str, label: str, problem: str) -> None:
        if blocking:
            self.report.block(where, f"{label}: {problem}; fix it in Studio and export the course again")
        else:
            self.report.add("skipped", where, f"{label}: {problem}, so it was not imported; add it by hand")

    def tell_once(self, target: str, where: str) -> bool:
        # one line per file and place, however often it is referenced there
        key = (target, where)
        if key in self.told:
            return False
        self.told.add(key)
        return True

    def resolve(self, el: ET.Element, path: str, where: str, blocking: bool, label: str) -> tuple[ET.Element, str] | None:
        """The node an element stands for, with the file it came from; None when it cannot be used."""
        if not _is_pointer(el):
            return el, path
        url_name = el.get("url_name", "")
        target = f"{el.tag}/{url_name.replace(':', '/')}.xml"
        if target in self.visited:
            if self.tell_once(target, where):
                self.report.add("skipped", where, f"{label}: {target} is used more than once, so only its first use was read; add the others by hand")
            return None
        if target not in self.failed:
            text = self.files.get(target)
            try:
                if text is None:
                    raise OlxError(target, f"the file {target} is missing")
                node = parse_xml(text, target)
                if node.tag != el.tag:
                    raise OlxError(target, f"the file {target} holds a “{node.tag}”, not a “{el.tag}”")
            except OlxError as exc:
                self.failed[target] = exc.text
            else:
                self.visited.add(target)
                return node, target
        if self.tell_once(target, where):
            self.fail(blocking, where, label, self.failed[target])
        return None

    def html_text(self, node: ET.Element, node_path: str, where: str) -> str | None:
        filename = (node.get("filename") or "").strip().replace(":", "/")
        if not filename:
            # leading text stays unescaped, as Open edX reads it (CDATA bodies)
            return (node.text or "") + "".join(ET.tostring(c, encoding="unicode") for c in node)
        name = filename if filename.endswith(".html") else filename + ".html"
        if node_path.startswith("html/"):
            folder = node_path.rsplit("/", 1)[0]
        else:
            folder = ("html/" + (node.get("url_name") or "").replace(":", "/")).rsplit("/", 1)[0]
        candidates = [f"{folder}/{name}", f"html/{name}"]
        target = next((c for c in candidates if c in self.files), candidates[0])
        label = f"Page “{_name(node) or _clean(filename)}”"
        if target in self.visited:
            if self.tell_once(target, where):
                self.report.add("skipped", where, f"{label}: {target} is used more than once, so only its first use was read; add the others by hand")
            return None
        if target not in self.failed:
            text = self.files.get(target)
            if text is None:
                self.failed[target] = f"the page file {target} is missing"
            elif _HTML_BANNED.search(text):
                self.failed[target] = f"{target} declares an ENTITY"
            else:
                self.visited.add(target)
                return text
        if self.tell_once(target, where):
            self.report.add("skipped", where, f"{label}: {self.failed[target]}; add it by hand")
        return None

    def components(self, parent: ET.Element, path: str, depth: int, where: str, out: list[Component]) -> None:
        if depth > MAX_DEPTH and len(parent):
            self.report.add("skipped", where, f"Content nested too deeply (over {MAX_DEPTH} levels) was not imported; add it by hand")
            return
        for el in parent:
            got = self.resolve(el, path, where, False, f"Component “{_name(el) or _clean(el.get('url_name') or '') or el.tag}”")
            if got is None:
                continue
            node, node_path = got
            if _staff_only(el, node):
                text = f"Staff-only component “{_name(node)}”" if _name(node) else f"A staff-only {node.tag} component"
                self.report.add("skipped", where, f"{text} was not imported")
                continue
            if node.tag == "vertical":
                self.components(node, node_path, depth + 1, where, out)
                continue
            html = None
            if node.tag == "html":
                html = self.html_text(node, node_path, where)
                if html is None:
                    continue
            out.append(Component(node.tag, _name(node), node, html, node_path))

    def named(self, node: ET.Element, kind: str, n: int, where: str) -> str:
        name = _name(node)
        if not name:
            name = f"Untitled {kind} {n}"
            self.report.add("changed", _join(where, name), f"The {kind} had no name; it is called “{name}”")
        self.report.place(_join(where, name))
        return name

    def staff_skip(self, el: ET.Element, node: ET.Element, kind: str, n: int, where: str) -> bool:
        if not _staff_only(el, node):
            return False
        label = f"“{_name(node)}”" if _name(node) else str(n)
        self.report.add("skipped", where, f"Staff-only {kind} {label} was not imported")
        return True

    def misplaced(self, el: ET.Element, where: str, place: str) -> None:
        label = _name(el) or _clean(el.get("url_name") or "")
        name = f"The {el.tag} “{label}”" if label else f"A “{el.tag}” element"
        self.report.add("skipped", where, f"{name} {place} was not imported; add it by hand")

    def course(self) -> CourseTree | None:
        text = self.files.get("course.xml")
        if text is None:
            self.report.block("", "course.xml is missing; export the whole course from Studio")
            return None
        try:
            root = parse_xml(text, "course.xml")
        except OlxError as exc:
            self.report.block("", f"{exc.text}; fix it in Studio and export the course again")
            return None
        if root.tag != "course":
            self.fail(True, "", "Course", f"course.xml holds a “{root.tag}”, not a “course”")
            return None
        run = (root.get("url_name") or "").strip()
        if not run:
            self.fail(True, "", "Course", "course.xml does not name the course run")
            return None
        course_path = f"course/{run.replace(':', '/')}.xml"
        if course_path not in self.files:
            self.fail(True, "", "Course", f"the file {course_path} is missing")
            return None
        try:
            node = parse_xml(self.files[course_path], course_path)
        except OlxError as exc:
            self.fail(True, "", "Course", exc.text)
            return None
        if node.tag != "course":
            self.fail(True, "", "Course", f"the file {course_path} holds a “{node.tag}”, not a “course”")
            return None
        if _staff_only(root, node):
            self.report.block("", "The whole course is staff-only, so nothing can be imported; make it visible in Studio and export it again")
            return None
        policy = self.policy(run)
        policy_name = policy.get("display_name")
        name = _name(node) or (_clean(policy_name) if isinstance(policy_name, str) else "")
        if not name:
            name = "Untitled course"
            self.report.add("changed", "", f"The course had no name; it is called “{name}”")
        if "max_attempts" in policy:
            attempts = None if policy["max_attempts"] is None else str(policy["max_attempts"])
        else:
            attempts = node.get("max_attempts")
        chapters = [ch for ch in self.chapters(node, course_path) if ch is not None]
        if self.report.blockers:
            return None
        return CourseTree(name, run, attempts, chapters)

    def policy(self, run: str) -> dict:
        path = f"policies/{run}/policy.json"
        if path not in self.files:
            return {}
        try:
            data = json.loads(self.files[path])
            entry = data.get(f"course/{run}") if isinstance(data, dict) else None
        except (ValueError, RecursionError):
            entry = None
        if not isinstance(entry, dict):
            self.report.add("note", "", f"{path} could not be read; the course settings in it were ignored")
            return {}
        return entry

    def chapters(self, course: ET.Element, path: str):
        for n, el in enumerate((c for c in course if c.tag == "chapter"), 1):
            got = self.resolve(el, path, "", True, f"Chapter {n}")
            if got is None:
                continue
            node, node_path = got
            if self.staff_skip(el, node, "chapter", n, ""):
                continue
            name = self.named(node, "chapter", n, "")
            yield Chapter(name, list(self.subsections(node, node_path, name)))

    def subsections(self, chapter: ET.Element, path: str, where: str):
        n = 0
        for el in chapter:
            if el.tag != "sequential":
                self.misplaced(el, where, "directly in the chapter")
                continue
            n += 1
            got = self.resolve(el, path, where, True, f"Subsection {n}")
            if got is None:
                continue
            node, node_path = got
            if self.staff_skip(el, node, "subsection", n, where):
                continue
            name = self.named(node, "subsection", n, where)
            yield Subsection(name, list(self.units(node, node_path, _join(where, name))))

    def units(self, seq: ET.Element, path: str, where: str):
        n = 0
        for el in seq:
            if el.tag != "vertical":
                self.misplaced(el, where, "outside a unit")
                continue
            n += 1
            got = self.resolve(el, path, where, False, f"Unit {n}")
            if got is None:
                continue
            node, node_path = got
            if self.staff_skip(el, node, "unit", n, where):
                continue
            name = self.named(node, "unit", n, where)
            comps: list[Component] = []
            self.components(node, node_path, 4, _join(where, name), comps)
            yield Unit(name, comps, node_path)


def load_course(files: dict[str, str], report: Report) -> CourseTree | None:
    return _Walk(files, report).course()
