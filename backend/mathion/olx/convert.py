"""The pure converter: an export bundle becomes a plan of blocks, sequences and items, with its report."""
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from mathion.api.blocks import MAX_BLOCKS, MAX_SEQUENCES
from mathion.api.text_utils import slugify
from mathion.markdown import extract_asset_filenames, render_markdown
from mathion.olx.bundle import CheckBody
from mathion.olx.files import Counters, Limits, Upload, next_free, plan_files
from mathion.olx.html_md import Node, html_to_markdown, parse_html
from mathion.olx.quiz import OPTION_MAX, TEXT_MAX, PlanQuestion, convert_problem
from mathion.olx.report import Report
from mathion.olx.tree import SEP, Component, CourseTree, Unit, load_course
from mathion.olx.video import VIDEO_URL_MAX, PageKind, classify_html, video_component

TITLE_MAX = 200
SLUG_MAX = 80
SLUG_CUT = 76                                        # leaves room for a -NN suffix
LABEL_MAX = 200
ATTEMPTS_MAX = 10
NUMERIC_LIMIT = Decimal(10) ** 10                    # Numeric(20, 10)
UNFINISHED = "Open edX (unfinished): "
_DIGITS = re.compile(r"[0-9]{1,9}")


@dataclass
class PlanItem:
    type: str
    title: str
    slug: str
    where: str
    content_md: str | None = None
    video_url: str | None = None
    app_target: str | None = None
    questions: list[PlanQuestion] = field(default_factory=list)


@dataclass
class PlanSequence:
    title: str
    slug: str
    items: list[PlanItem]


@dataclass
class PlanBlock:
    title: str
    slug: str
    sequences: list[PlanSequence]


@dataclass
class Plan:
    course_name: str
    label: str
    max_quiz_attempts: int
    blocks: list[PlanBlock]
    uploads: list[Upload]
    linked_assets: set[str]
    used_app_targets: set[str]
    report: Report
    summary: dict[str, int]
    not_uploaded: set[str] = field(default_factory=set)   # filled by apply: sources missing from the draft


def make_slug(title: str, fallback: str, taken: set[str], counters: Counters | None = None) -> str:
    """A slug unique in taken (which it joins), cut to fit 80 with its suffix."""
    slug = slugify(title)
    if len(slug) > SLUG_CUT:
        # cut at a word end within 76, or at 76 when there is none
        dash = slug.rfind("-", 0, SLUG_CUT + 1)
        slug = slug[:dash] if dash > 0 else slug[:SLUG_CUT]
    slug = slug.strip("-") or fallback
    out = slug if slug not in taken else next_free(slug, "", SLUG_MAX, taken, counters)
    taken.add(out)
    return out


def _fit(name: str, room: int) -> str:
    return name[:room].rstrip()


def unfinished_label(course_name: str) -> str:
    return UNFINISHED + _fit(course_name, LABEL_MAX - len(UNFINISHED))


def final_label(course_name: str, day: date) -> str:
    head, tail = "Open edX: ", f" ({day.isoformat()})"
    return head + _fit(course_name, LABEL_MAX - len(head) - len(tail)) + tail


def _title(base: str, suffix: str = "") -> str:
    # the base is cut, never the suffix
    return _fit(base, TITLE_MAX - len(suffix)) + suffix


def _join(*parts: str) -> str:
    return SEP.join(p for p in parts if p)


def _attempts(value: str | None) -> int | None:
    # only 1-9 ASCII digits count; anything else is treated as absent and never quoted
    if value is not None and _DIGITS.fullmatch(value.strip()):
        return int(value.strip())
    return None


def _clamp(n: int) -> int:
    return max(1, min(ATTEMPTS_MAX, n))


def _version_attempts(raw: str | None) -> tuple[int, str | None]:
    """The version's attempts and the line to report when the course has quizzes."""
    n = _attempts(raw)
    if n is None:
        why = "unlimited attempts" if raw is None or not raw.strip() else "an attempts setting Mathion could not read"
        return ATTEMPTS_MAX, f"The course allows {why}; quizzes now allow {ATTEMPTS_MAX} attempts, Mathion's maximum"
    if _clamp(n) != n:
        return _clamp(n), f"The course allows {n} quiz attempts; Mathion allows 1 to {ATTEMPTS_MAX}, so quizzes now allow {_clamp(n)}"
    return n, None


class _Converter:
    def __init__(self, body: CheckBody, limits: Limits, tree: CourseTree, report: Report) -> None:
        self.report = report
        self.tree = tree
        self.pages: dict[int, tuple[Node, PageKind]] = {}
        names: set[str] = set()
        for comp in self._components():
            if comp.tag == "html" and comp.html is not None:
                root = parse_html(comp.html)
                kind = classify_html(root)
                self.pages[id(comp)] = (root, kind)
                if kind.kind == "graasta" and kind.value:
                    names.add(kind.value)
        self.files = plan_files(body.static, body.apps, names, limits, report)
        self.attempts, self.attempts_note = _version_attempts(tree.max_attempts)
        self.used_apps: set[str] = set()

    def _components(self):
        for ch in self.tree.chapters:
            for sub in ch.subsections:
                for unit in sub.units:
                    yield from unit.components

    def component(self, comp: Component, where: str) -> PlanItem | None:
        name = comp.display_name

        def the(kind: str) -> str:
            return f"The {kind} “{name}”" if name else f"This {kind}"
        if comp.tag == "video":
            url, notes = video_component(comp.node)
            if url is None:
                self.report.add("skipped", where, f"{the('video')} has no YouTube or Vimeo address Mathion can show, "
                                                  "so it was not imported; add the video by hand")
                return None
            for note in notes:
                self.report.once(note, "changed", note, "video|videos")
            return PlanItem("video", name, "", where, video_url=url)
        if comp.tag == "html":
            root, kind = self.pages[id(comp)]
            if kind.kind == "graasta":
                target = self.files.app_targets.get(kind.value or "")
                if target is None:
                    self.report.add("changed", where, f"The app at https://graasta.com/apps/{kind.value}/ had no picked app file, "
                                                      "so its item is empty; add the app file in the item editor")
                else:
                    self.used_apps.add(target)
                return PlanItem("interactive_app", name, "", where, app_target=target)
            if kind.kind == "video":
                return PlanItem("video", name, "", where, video_url=kind.value)
            md = html_to_markdown(root, self.files.targets, self.report, where).markdown.strip()
            if not md:
                self.report.add("skipped", where, f"{the('page')} is empty after conversion, so it was not imported")
                return None
            return PlanItem("static_page", name, "", where, content_md=md)
        if comp.tag == "problem":
            questions = convert_problem(comp.node, self.files.targets, self.report, where)
            if not questions:                            # convert_problem already said why
                return None
            own = _attempts(comp.node.get("max_attempts"))
            if own is not None and _clamp(own) != self.attempts:
                self.report.add("changed", where, f"This quiz's own attempts setting ({own}) differs from the course's; "
                                                  f"Mathion uses one value per course version ({self.attempts})")
            return PlanItem("quiz", name, "", where, questions=questions)
        self.report.add("skipped", where, f"{the(comp.tag + ' component')} is not supported, so it was not imported; "
                                          "recreate it by hand if students need it")
        return None

    def unit(self, unit: Unit, where: str, taken: set[str], counters: Counters, counter: list[int]) -> list[PlanItem]:
        made = [it for it in (self.component(c, where) for c in unit.components) if it is not None]
        if not made:
            self.report.add("skipped", where, "Nothing in this unit could be imported (empty unit)")
        for k, item in enumerate(made, 1):
            if len(made) == 1:
                item.title = _title(unit.display_name)
            elif item.title:
                item.title = _title(item.title)
            else:
                item.title = _title(unit.display_name, f" ({k})" if k > 1 else "")
            counter[0] += 1
            item.slug = make_slug(item.title, f"item-{counter[0]}", taken, counters)
        return made

    def blocks(self) -> list[PlanBlock]:
        blocks: list[PlanBlock] = []
        block_slugs: set[str] = set()
        block_counters: Counters = {}
        for bn, ch in enumerate(self.tree.chapters, 1):
            seqs: list[PlanSequence] = []
            seq_slugs: set[str] = set()
            seq_counters: Counters = {}
            for sn, sub in enumerate(ch.subsections, 1):
                where = _join(ch.display_name, sub.display_name)
                taken: set[str] = set()
                counters: Counters = {}
                counter = [0]
                items = [it for u in sub.units
                         for it in self.unit(u, _join(where, u.display_name), taken, counters, counter)]
                if not items:
                    self.report.add("skipped", where, "The subsection has no items left, so it was not created")
                    continue
                title = _title(sub.display_name)
                seqs.append(PlanSequence(title, make_slug(title, f"sequence-{sn}", seq_slugs, seq_counters), items))
            if not seqs:
                self.report.add("skipped", ch.display_name, "The chapter has no subsections left, so it was not created")
                continue
            title = _title(ch.display_name)
            blocks.append(PlanBlock(title, make_slug(title, f"block-{bn}", block_slugs, block_counters), seqs))
        return blocks


def _caps(blocks: list[PlanBlock], report: Report) -> None:
    if len(blocks) > MAX_BLOCKS:
        past = ", ".join(f"“{b.title}”" for b in blocks[MAX_BLOCKS:])
        report.block("", f"The course has {len(blocks)} chapters with content; Mathion allows {MAX_BLOCKS} per version. "
                         f"Chapters past the {MAX_BLOCKS}th: {past}; restructure the course in Studio and export it again")
    for b in blocks:
        if len(b.sequences) > MAX_SEQUENCES:
            report.block(b.title, f"The chapter “{b.title}” has {len(b.sequences)} subsections with content; Mathion allows "
                                  f"{MAX_SEQUENCES} per chapter; restructure it in Studio and export the course again")


def _numeric_fits(x: Decimal | None) -> bool:
    if x is None:
        return False
    exp = x.as_tuple().exponent
    return x.is_finite() and abs(x) < NUMERIC_LIMIT and isinstance(exp, int) and exp >= -10


def _markdown(item: PlanItem) -> list[str]:
    out = [item.content_md] if item.content_md else []
    for q in item.questions:
        out.append(q.text_md)
        if q.explanation_md:
            out.append(q.explanation_md)
    return out


def _check(blocks: list[PlanBlock], planned: set[str], report: Report) -> set[str]:
    """Column, asset and rendering checks; returns the asset names the Markdown links to."""
    linked: set[str] = set()

    def bad(where: str, what: str) -> None:
        report.block(where, f"{what}; fix it in Studio and export the course again")

    for b in blocks:
        rows = [(b.title, b.slug, b.title)] + [(s.title, s.slug, _join(b.title, s.title)) for s in b.sequences]
        for title, slug, where in rows:
            if not title or len(title) > TITLE_MAX or not slug or len(slug) > SLUG_MAX:
                bad(where, "A title or slug does not fit")
        for s in b.sequences:
            for it in s.items:
                where = it.where
                if not it.title or len(it.title) > TITLE_MAX or not it.slug or len(it.slug) > SLUG_MAX:
                    bad(where, "An item title or slug does not fit")
                if it.video_url is not None and len(it.video_url) > VIDEO_URL_MAX:
                    bad(where, f"A video address is longer than {VIDEO_URL_MAX} characters")
                for n, q in enumerate(it.questions, 1):
                    if not q.text_md.strip():
                        bad(where, f"Question {n} has no text")
                    if any(not o.text or len(o.text) > OPTION_MAX for o in q.options):
                        bad(where, f"Question {n} has a choice that is empty or longer than {OPTION_MAX} characters")
                    if q.correct_text is not None and not 0 < len(q.correct_text) <= TEXT_MAX:
                        bad(where, f"Question {n} has an answer that is empty or longer than {TEXT_MAX} characters")
                    if q.type == "numeric_answer" and (not _numeric_fits(q.correct_numeric) or q.precision is None
                                                       or not 0 <= q.precision <= 10):
                        bad(where, f"Question {n} has a number Mathion cannot store")
                for md in _markdown(it):
                    names = extract_asset_filenames(md)
                    linked |= names
                    for name in sorted(names - planned):
                        bad(where, f"The content refers to a file “{name}” that is not among the files to upload")
                    try:
                        render_markdown(md)
                    except Exception:                    # noqa: BLE001 — any failure blocks with its place
                        bad(where, "The content could not be rendered")
    return linked


def _summary(blocks: list[PlanBlock], uploads: list[Upload]) -> dict[str, int]:
    all_items = [it for b in blocks for s in b.sequences for it in s.items]
    kinds = {"video": "videos", "static_page": "pages", "interactive_app": "apps", "quiz": "quizzes"}
    out = {"blocks": len(blocks), "sequences": sum(len(b.sequences) for b in blocks), "items": len(all_items)}
    out.update({key: sum(it.type == t for it in all_items) for t, key in kinds.items()})
    out.update({"files": len(uploads), "bytes": sum(u.size for u in uploads)})
    return out


def convert(body: CheckBody, limits: Limits) -> Plan:
    """Convert without touching the database; blockers are in plan.report.blockers."""
    report = Report()
    tree = load_course(body.files, report)
    if tree is None:
        return Plan("", unfinished_label("Untitled course"), ATTEMPTS_MAX, [], [], set(), set(), report, _summary([], []))
    conv = _Converter(body, limits, tree, report)
    blocks = conv.blocks()
    if conv.attempts_note and any(it.type == "quiz" for b in blocks for s in b.sequences for it in s.items):
        report.add("changed", "", conv.attempts_note)
    _caps(blocks, report)
    uploads = conv.files.uploads
    linked = _check(blocks, {u.target for u in uploads}, report)
    for u in uploads:
        if u.kind == "static" and u.target not in linked:
            report.add("note", "", f"The file “{u.source}” was uploaded as “{u.target}” but is not linked from any page")
    if not blocks:
        report.block("", "Nothing in the course could be imported")
    return Plan(tree.display_name, unfinished_label(tree.display_name), conv.attempts, blocks, uploads, linked,
                conv.used_apps, report, _summary(blocks, uploads))
