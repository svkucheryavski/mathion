"""Which export files get uploaded, under which names."""
import posixpath
from dataclasses import dataclass
from typing import Literal

from mathion.assets import sanitize_filename, validate_extension
from mathion.olx.bundle import AppEntry, StaticEntry
from mathion.olx.links import LinkTargets
from mathion.olx.report import Report

NAME_MAX = 255                                       # Asset.filename


@dataclass(frozen=True)
class Limits:
    max_file_bytes: int
    max_total_bytes: int


@dataclass
class Upload:
    source: str                                      # path under static/, or the picked app file's name
    target: str
    kind: Literal["static", "app"]
    size: int


@dataclass
class FilePlan:
    uploads: list[Upload]
    targets: LinkTargets
    app_targets: dict[str, str]                      # Graasta name → target asset name
    total: int


Counters = dict[tuple[str, str, int], int]


def next_free(base: str, tail: str, cap: int, taken: set[str], counters: Counters | None = None) -> str:
    """The first free base-N + tail (N = 2, 3 …) within cap characters; the caller takes it."""
    n = 2
    while True:
        suffix = f"-{n}"
        # the cut never leaves a dash before the suffix, so cleaning keeps the name
        stem = base[: max(0, cap - len(tail) - len(suffix))].rstrip("-")
        # counters: next number to try per cut stem and suffix width, so repeats stay linear
        key = (stem, tail, len(suffix))
        if counters is not None and counters.get(key, n) > n:
            n = counters[key]
            continue
        candidate = stem + suffix + tail
        if counters is not None:
            counters[key] = n + 1                    # n is taken now or by the caller
        if candidate not in taken:
            return candidate
        n += 1


def unique_name(name: str, taken: set[str], counters: Counters | None = None) -> str:
    """name, or name with -2, -3 … before the extension, within 255 characters."""
    if name not in taken:
        return name
    base, dot, ext = name.rpartition(".")
    if not dot:
        base, ext = name, ""
    return next_free(base, f".{ext}" if dot else "", NAME_MAX, taken, counters)


def _app_key(name: str) -> str:
    # app files and Graasta names are compared without .js
    clean = sanitize_filename(name)
    return clean[:-3] if clean.endswith(".js") else clean


def _mb(n: int) -> str:
    return f"{n / (1024 * 1024):.1f} MB"


def plan_files(static: list[StaticEntry], apps: list[AppEntry], graasta_names: set[str], limits: Limits,
               report: Report) -> FilePlan:
    uploads: list[Upload] = []
    taken: set[str] = set()
    app_targets: dict[str, str] = {}
    by_key: dict[str, AppEntry] = {}
    for app in sorted(apps, key=lambda a: a.name):
        by_key.setdefault(_app_key(app.name), app)
    used: set[str] = set()
    for name in sorted(graasta_names):
        target = sanitize_filename(name + ".js")
        app = by_key.get(_app_key(target))
        if app is None:
            continue
        app_targets[name] = target
        if target in taken:                          # another Graasta name cleaned to the same file
            continue
        used.add(app.name)
        taken.add(target)
        uploads.append(Upload(app.name, target, "app", app.size))
        if app.size == 0:
            report.block("", f"The app file “{app.name}” is empty; pick the right file again")
        elif app.size > limits.max_file_bytes:
            report.block("", f"The app file “{app.name}” is over the per-file limit ({_mb(limits.max_file_bytes)}); "
                             "make it smaller and pick it again")
    for app in sorted(apps, key=lambda a: a.name):
        if app.name in used:
            continue
        twin = by_key[_app_key(app.name)]
        if twin.name in used:
            report.add("note", "", f"The app file “{app.name}” has the same name as “{twin.name}” once cleaned, "
                                   "so it was not uploaded")
        else:
            report.add("note", "", f"The app file “{app.name}” is not used by any page, so it was not uploaded")

    static_map: dict[str, str] = {}
    skipped: dict[str, str] = {}
    counters: Counters = {}
    for entry in sorted(static, key=lambda e: e.path):
        reason = entry.skipped
        basename = posixpath.basename(entry.path)
        # the browser's checks are repeated here
        if reason is None and validate_extension(basename) is None:
            reason = "type"
            report.add("skipped", "", f"The file “{entry.path}” has a type Mathion does not accept, so it was not uploaded; "
                                      "convert it to an accepted type and upload it by hand")
        elif reason is None and entry.size == 0:
            reason = "empty"
            report.add("skipped", "", f"The file “{entry.path}” is empty, so it was not uploaded; "
                                      "upload it by hand if a page needs it")
        elif reason is None and entry.size > limits.max_file_bytes:
            reason = "size"
            report.add("skipped", "", f"The file “{entry.path}” is over the per-file limit, so it was not uploaded; "
                                      "make it smaller and upload it by hand")
        if reason == "size" and entry.skipped is None:   # the limit may differ at build; the other names stay put
            taken.add(unique_name(sanitize_filename(basename), taken, counters))
        if reason is not None:
            skipped[entry.path] = reason
            continue
        target = unique_name(sanitize_filename(basename), taken, counters)
        taken.add(target)
        static_map[entry.path] = target
        uploads.append(Upload(entry.path, target, "static", entry.size))

    total = sum(u.size for u in uploads)
    if total > limits.max_total_bytes:
        report.block("", f"The files add up to {_mb(total)}, over the course version limit of "
                         f"{_mb(limits.max_total_bytes)}; remove some files in Studio and export the course again")
    return FilePlan(uploads, LinkTargets(static_map, skipped), app_targets, total)
