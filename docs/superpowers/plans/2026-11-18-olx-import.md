# Open edX Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A course admin imports an Open edX course export (`.tar.gz`) into
a new draft version from the Versions page. Pages, videos, quizzes, Graasta
apps and static files come through, and a report names everything skipped or
changed.

**Architecture:**
- The browser unpacks the archive with its own tar reader and
  `DecompressionStream`.
- The browser sends only the XML/HTML/JSON text to a server **check** call.
  A pure converter turns that text into a `Plan`.
- The browser uploads each static and app file through the existing asset
  upload. A server **build** call then re-runs the converter and applies the
  plan in one transaction.
- New backend package `backend/mathion/olx/` holds the pure converter, plus
  `apply`. The routes live in `backend/mathion/api/olx_import.py`.
- New frontend folder `frontend/src/lib/olx/` holds the reader and the
  upload/build runner. `OlxImportModal.svelte` is opened from
  `VersionsPage.svelte`.

**Tech Stack:**
- Backend: Python 3.13, FastAPI, SQLAlchemy, PostgreSQL, standard-library
  `xml.etree.ElementTree` and `html.parser`, pytest.
- Frontend: Svelte 5, TypeScript, vitest (jsdom).
- Gate: the zsh visual-refresh CSS gate.

**Spec:** `docs/superpowers/specs/2026-11-18-olx-import-design.md` (rev 10).
Plan rev 2 answered Codex round 1 (12 Important findings, coverage gaps and
minors). Plan rev 3 answered round 2 (9 Important, 2 minors). Plan rev 4 answered
round 3 (3 Important, 2 minors). Plan rev 5 moves the page navigation tests
to the real-router test file (round 4).
Every task reads the spec sections it names; the spec is binding where this
plan is silent. Line numbers in this plan point at the code as of
2026-11-18 and may drift by a few lines.

**Depends on:** the math typesetting feature
(`docs/superpowers/plans/2026-11-18-math-typesetting.md`) merged into `main`.
It provides:
- `mathion.latex_mathml.latex_to_mathml(src: str, display: bool) -> str`;
- `LatexError(ValueError)` with `.reason: str`;
- `AnswerOption.text_html`, filled by the `@validates("text")` hook;
- Mathion's dollar rules in `render_markdown`;
- token-based `extract_asset_filenames`.

## Global Constraints

- No new Python or JS dependencies. The standard library only: `xml.etree`,
  `html.parser`, `json`, `decimal`; in the browser, `DecompressionStream`,
  `Blob`, `TextDecoder`.
- Svelte 5. Component tests use `mount`/`unmount`/`flushSync` from `svelte`,
  never `@testing-library/svelte`.
- Python only via `backend/.venv` (`backend/.venv/bin/pytest`,
  `…/python`).
- Code comments are one short plain line; reasoning goes in the ledger.
- Same tab; edits open modals. Dense UI tokens. New modal styles are pinned
  in the gate like other modals.
- Course admin permission everywhere (`require_course_admin`); no
  superuser-only path.
- Existing limits stay unchanged:
  - per-file 20 MB and per-version 500 MB by default (`load_site(db)`);
  - the proxy's 60 MB request cap and 30 s response-header timeout.
- **Private data:** nothing from the owner's courses is committed or quoted.
  The probe at `.superpowers/sdd/2026-11-17-olx-import/probe/` is used only
  for the manual end-to-end run in Task 11. Test fixtures are synthetic.
- Stay inside the repo: absolute `cd` only, no `/tmp`. Probes go in
  `.superpowers/sdd/2026-11-18-olx-import/probe/`.
- The branch is `feat/olx-import`, cut from `main` **after** the math
  typesetting branch merges. No push or merge without the owner's OK.
- Per task, before each commit:
  1. Opus + Fable review lanes and Codex (`model_reasoning_effort=high`) on
     the uncommitted diff;
  2. fix every Critical/Important finding, then re-review;
  3. commit only on the owner's OK.

  The commit trailer is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `logo.png` or `favicon.svg`.
- **Test commands:**
  - backend: `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q`
  - one backend file: `… && .venv/bin/pytest tests/test_olx_<name>.py -q`
  - frontend: `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test && npm run check`
    (always `npm test`, never bare `npx vitest`: it pins the time zone).

    Green means exit 0, and no "Errors" or "Unhandled" line.
  - gate: `zsh /Users/svkucheryavski/Documents/Developing/mathion/frontend/scripts/visual-refresh-gate.sh`

## Plan calls (Claude's, within the spec)

- **Check response.** It gains `blockers: [{where, text}]`, and
  `blocking = bool(blockers)`. The modal lists blockers above the report.
  The spec's three report levels stay as they are.
- **Report order.** Lines are sorted stably by level (`skipped`, `changed`,
  `note`), then by `where`. Once-per-course lines have `where = ""`, so they
  come first in their level.
- **`where`.** The format is `"<block> › <sequence> › <unit>"`, built from
  the Open edX display names after fallbacks. Course-level lines use `""`.
- **Synthetic fixture.** It lives in `backend/tests/fixtures/olx/course/`.
  A script builds `frontend/src/tests/fixtures/olx-course.tar.gz` from it,
  and both are committed. A backend test fails when the tar and the folder
  disagree.

## Review Focus

1. **Non-Latin and duplicate titles.** Danish or Cyrillic unit names (`Øvelse
   1`, `Задача`) and three units called "Video" in one sequence. Titles must
   stay exactly as written. Slugs must be valid, unique and never empty.
   Owned by Task 6: `test_titles_and_slugs_non_latin_and_duplicates`.
2. **File names that collide after sanitising.** `Fig 1.PNG`, `fig-1.png`
   and `fig_1.png` in different subfolders. Each must get its own target,
   and each page link must resolve to the right one. Owned by Task 6:
   `test_colliding_static_names_resolve_links`.
3. **Link targets with spaces and parentheses.** `/static/my fig (1).png`
   in an `<img>` and in an `<a>`. The image must show, the link must work,
   and the rendered page must reference the asset. Owned by Task 3:
   `test_link_destination_with_spaces_and_parens_renders`.
4. **A large course.** 8 blocks × 8 sequences × 30 units of mixed kinds. The
   check and the build must each finish well inside the proxy's 30 s.
   Owned by Task 7: `test_large_synthetic_course_is_fast` (convert + apply
   under 10 s on the dev machine).
5. **The same export imported twice.** Two drafts in one course, each with
   its own files and no slug or asset clash. Deleting one must leave the
   other intact. Owned by Task 7: `test_import_twice_into_one_course`.

---

### Task 1: Bundle, report and course tree

**Spec sections:** "The server calls" (the bodies), "XML safety",
"Tree walks", "Pointer vs inline", "The report", "Smaller details ›
Encoding".

**Files:**
- Create: `backend/mathion/olx/__init__.py` (empty).
- Create: `backend/mathion/olx/bundle.py`, `backend/mathion/olx/report.py`
  and `backend/mathion/olx/tree.py`.
- Create: the fixture course `backend/tests/fixtures/olx/course/…`:
  - `course.xml`;
  - `course/<run>.xml`;
  - `policies/<run>/policy.json`;
  - `chapter/`, `sequential/`, `vertical/`, `html/`, `video/` and
    `problem/` files;
  - `static/img/fig 1.png` (a 67-byte PNG);
  - `static/notes.pdf` (a small PDF).

  It needs two chapters, three sequentials, about 12 units, and:
  - one staff-only unit;
  - one Graasta page `https://graasta.com/apps/sine-demo/`;
  - one problem of each response type in both layouts (text before the
    response, and text inside it);
  - one inline (non-pointer) vertical.
- Create: `backend/tests/fixtures/olx/build_tar.py`, which writes
  `frontend/src/tests/fixtures/olx-course.tar.gz`. For reproducible bytes:
  - tar members are sorted, with mtime 0, uid/gid 0, empty uname/gname and
    mode 0644/0755;
  - the gzip layer is `gzip.GzipFile(filename="", mtime=0, …)`, with no
    name in its header.
- Create: `backend/tests/fixtures/olx/apps/sine-demo.js`, a tiny synthetic
  app (draws into `#app-root`, no network). Task 11 uses it to show a
  working app.
- Test: `backend/tests/test_olx_tree.py`.

**Interfaces:**
- Produces, in `bundle.py`:
  ```python
  class StaticEntry(BaseModel): path: str; size: int; skipped: Literal["empty", "type", "size"] | None = None
  class AppEntry(BaseModel): name: str; size: int
  class ReportLineIn(BaseModel): level: Literal["skipped", "changed", "note"]; where: str = Field(max_length=600); text: str = Field(max_length=2000)
  class CheckBody(BaseModel): files: dict[str, str]; static: list[StaticEntry]; apps: list[AppEntry]
  class BuildBody(CheckBody): report: list[ReportLineIn] = Field(max_length=20000); date: datetime.date
  ```
  All models use `extra="forbid"`. `CheckBody` validates the caps: at most
  20 000 entries in `files`, 20 MB of text in total, and a path with no
  `..` segment and no leading `/`.
- Produces, in `report.py`:
  ```python
  Level = Literal["skipped", "changed", "note"]
  @dataclass(frozen=True) class ReportLine: level: Level; where: str; text: str
  class Report:
      def add(self, level: Level, where: str, text: str) -> None
      def once(self, key: str, level: Level, text: str, unit: str) -> None   # counts; emits "text: N unit"
      def block(self, where: str, text: str) -> None
      @property blockers -> list[ReportLine]       # level "skipped"
      def lines(self, extra: Iterable[ReportLine] = ()) -> list[ReportLine]  # merged, deduped, sorted
  ```
  In `lines()`, once-keys become one line each, for example "Video end
  times dropped: 14 videos". An `extra` line equal to an existing one is
  dropped (Smaller details › Uploads).
- Produces, in `tree.py`:
  ```python
  class OlxError(Exception): ...           # .where, .text
  def parse_xml(text: str, path: str) -> ET.Element      # raises OlxError
  @dataclass class Component: tag: str; display_name: str; node: ET.Element; html: str | None; path: str
  @dataclass class Unit: display_name: str; components: list[Component]; path: str
  @dataclass class Subsection: display_name: str; units: list[Unit]
  @dataclass class Chapter: display_name: str; subsections: list[Subsection]
  @dataclass class CourseTree: display_name: str; run: str; max_attempts: str | None; chapters: list[Chapter]
  def load_course(files: dict[str, str], report: Report) -> CourseTree | None   # None when blocked
  ```
  Display-name fallbacks such as "Untitled chapter 2" are applied here and
  reported. `html` is the loaded `html/<filename>.html` text for `html`
  components.

- [ ] **Step 1: Write the fixture course and its tar builder**, then run
  `backend/.venv/bin/python backend/tests/fixtures/olx/build_tar.py` twice,
  with `touch` on the fixture files in between.
  Expected: the `.tar.gz` file exists, and both runs give identical bytes
  (`cmp`).

- [ ] **Step 2: Write the failing tests** in `test_olx_tree.py`:
  ```python
  def test_fixture_tar_matches_folder()            # tar member names+bytes == folder files
  def test_load_course_fixture_structure()         # 2 chapters, 3 sequentials, unit/component counts, order kept
  def test_course_xml_always_points_to_course_run()  # <course url_name org course> → course/<run>.xml
  def test_pointer_vs_inline()                     # url_name-only element loads <tag>/<url_name>.xml; with children → inline
  def test_html_filename_loads_html_file()
  def test_doctype_or_entity_rejected()            # .xml with <!DOCTYPE or <!ENTITY → component skipped, reported; in course.xml → blocks
  def test_html_doctype_html_allowed_entity_rejected()
  def test_depth_cap_and_cycle_skip_node()         # depth 21 and a vertical pointing at itself → skipped, reported, no recursion error
  def test_staff_only_skipped_at_every_level()
  def test_missing_pointer_file_skips_unit()       # reported with its where
  def test_broken_chapter_sequential_or_course_blocks()   # each of the three: report.blockers non-empty, load_course → None
  def test_pointer_with_extra_attributes_is_inline()
  def test_empty_display_name_fallback()           # "Untitled chapter 1", reported
  def test_drafts_and_about_ignored()              # files under drafts/ about/ never read
  def test_report_once_counts_and_sorts()          # once() x3 → one line ": 3 videos"; lines() order skipped<changed<note, then where
  def test_bundle_caps()                           # 20001 entries / 20 MB+1 / "../x" → ValidationError
  ```

- [ ] **Step 3: Run them to verify they fail.**
  Run: `cd …/backend && .venv/bin/pytest tests/test_olx_tree.py -q`.
  Expected: they fail because the `mathion.olx` modules do not exist yet.

- [ ] **Step 4: Implement `bundle.py`, `report.py` and `tree.py`.**
  - `parse_xml` refuses any text containing `<!DOCTYPE` or `<!ENTITY`
    before calling `ET.fromstring`.
  - The walk keeps a visited set of `(tag, url_name)` and a depth counter
    capped at 20.
  - The course run comes from `course.xml`'s `url_name`.
  - `max_attempts` is read from `policies/<run>/policy.json`
    (`["course/<run>"]["max_attempts"]`), then from the course element.
  - Unknown component tags are kept as `Component`s; Task 6 skips them.

- [ ] **Step 5: Run the tests to verify they pass.** Same command.
  Expected: PASS.

- [ ] **Step 6: Commit** (after the review loop and the owner's OK):
  `feat(olx): bundle, report and course tree reader`.

### Task 2: Math and text for Markdown

**Spec sections:** "HTML → Markdown" bullets "Order: math first", "Text
escaping", "Math"; "Superscripts and subscripts"; "Choices" (escaping in
choices).

**Files:**
- Create: `backend/mathion/olx/mdtext.py`.
- Test: `backend/tests/test_olx_mdtext.py`.

**Interfaces:**
- Consumes: `latex_to_mathml` and `LatexError` (math feature).
- Produces:
  ```python
  @dataclass class Seg: kind: Literal["text", "math", "code"]; text: str; display: bool = False
  def split_math(text: str) -> list[Seg]        # \( \) \[ \] [mathjaxinline] [mathjax]; code segs untouched
  def normalize_segments(segs: list[Seg]) -> list[Seg]   # trim, control space, whitespace runs, $ → \$, pull numbers, merge, repeat until stable
  def escape_text(text: str) -> str             # Markdown escaping for one text run (no line structure)
  def escape_line_starts(md: str) -> str        # #, >, +, -, =, |, N. N) and ~~~ at line starts
  def render_segments(segs: list[Seg], *, choice: bool = False) -> str
  def formula_errors(segs: list[Seg]) -> list[tuple[str, str]]   # (source, LatexError.reason)
  ```
  The HTML converter (Task 3) builds `Seg`s. `<sup>`/`<sub>` arrive as math
  segs (`^{2}`, `_{\text{max}}`) that `normalize_segments` merges with
  touching formulas and numbers.

- [ ] **Step 1: Write the failing tests** as one parametrised table,
  `test_math_text_cases`, with `(input segments or HTML-free text, expected
  Markdown)`. It holds at least these rows from the spec:
  - `"\\( x \\)"` → `$x$`;
  - `"\\(\\)"` → `""` (an empty formula is dropped);
  - `"95\\(\\%\\)"` → `$95\%$`;
  - `"0.05\\(x\\)"` → `$0.05x$`;
  - `"\\(a\\)\\(b\\)"` → `$a{}b$`;
  - `"\\(a\\)2\\(b\\)"` → `$a{}2{}b$`: one formula. It is pulled, then
    merged, until stable;
  - a `\(x\)` math seg followed by a `^{2}` math seg → `$x^{2}$`;
  - `"R"` text, then a `^{2}` seg → `R$^{2}$`;
  - `"10"` text, then a `^{3}` seg → `$10^{3}$`;
  - `"\\[ a \\]"` mid-text → `$$a$$`;
  - inline touching display → one space between them;
  - `"\\( x\\ \\)"` → `$x$`, but a body ending `\\\\ ` keeps `\\\\`;
  - a body with a newline and `- b` → one space: `$a - b$`;
  - a bare `$` inside a body → `\$`;
  - `"It costs $5"` → `It costs \$5`;
  - text `*a* _b_ [c] <d> ! & \\` → every one escaped;
  - a line starting `# `, `1. `, `- `, `> ` or `~~~` → escaped;
  - choice mode: only `$` and a `\` before punctuation are escaped, so
    `a*b` stays `a*b`;
  - `[mathjaxinline]y[/mathjaxinline]` → `$y$`;
  - `[mathjax]y[/mathjax]` → `$$y$$`.

  Each row also carries `outcome: Literal["plain", "math", "error"]`:
  - `plain`: no formula left (empty formula, escaped price, plain text);
  - `math`: every formula typesets;
  - `error`: the trailing-`\\` row, because the math feature rejects `\\`
    ("line breaks are not supported yet").

  Also write:
  ```python
  def test_rendered_output_matches_expected_outcome(case)   # plain: no <math>, no math-error; math: <math>, no math-error; error: math-error span and formula_errors lists it
  def test_empty_group_merge_typesets()            # render_markdown("$a{}b$") and "$\\alpha{}b$" → <math>, no math-error
  def test_formula_errors_reports_unsupported()    # "\\begin{align}x\\end{align}", "\\color{red}x" → reasons listed
  def test_script_text_ok()                        # script_text_ok("max") is True; "a{b", "x$", "50%" are False
  ```

- [ ] **Step 2: Run them to verify they fail.**
  Run: `.venv/bin/pytest tests/test_olx_mdtext.py -q`.
  Expected: they fail because `mdtext` does not exist.

- [ ] **Step 3: Implement `mdtext.py`.**
  - Numbers are matched with `\d+([.,]\d+)*` (spec).
  - The loop applies "pull numbers, then merge touching inline formulas"
    until a pass changes nothing.
  - Display formulas are never merged.
  - `script_text_ok(text: str) -> bool` returns False when the text holds
    any of `\ { } $ % & # ^ _ ~`.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit:** `feat(olx): math and text escaping for Markdown`.

### Task 3: HTML to Markdown, links and images

**Spec sections:** "HTML → Markdown (pages and quiz text)", all bullets;
"Smaller details › Static links"; "Files" (link loses its link).

**Files:**
- Create: `backend/mathion/olx/html_md.py` and `backend/mathion/olx/links.py`.
- Test: `backend/tests/test_olx_html_md.py`.

**Interfaces:**
- Consumes: Task 2's `Seg`, `normalize_segments`, `render_segments`,
  `formula_errors` and `script_text_ok`; Task 1's `Report`.
- Produces, in `links.py`:
  ```python
  @dataclass class LinkTargets:
      static: dict[str, str]          # source path relative to static/ → target asset name
      skipped: dict[str, str]         # source path → "empty" | "type" | "size"
  @dataclass class Link: kind: Literal["web", "asset", "text"]; url: str | None; blocked: bool = False; note: str | None = None
  def classify_link(url: str, targets: LinkTargets, *, image: bool) -> Link
  ```
  Rules (spec):
  - **Schemes.** `http:`, `https:` and `mailto:` are kept, with the scheme
    written in lowercase. `//host` becomes `https://host`.
  - **Static forms.** `/static/`, `../static/`, `static/`, `/c4x/…/asset/`,
    `asset-v1:…+type@asset+block@` and `/assets/courseware/…/` are
    percent-decoded, with `?…`/`#…` stripped.
    - In the `c4x` and `asset-v1` forms, a subfolder `/` is matched as `_`.
    - A match gives `kind="asset"`, whose url is the target name.
    - A linked `"size"` file gives `blocked=True`.
    - A linked `"empty"` or `"type"` file gives `kind="text"` with a note.
  - **Absolute old-site links.** The same static forms are matched inside
    an absolute `http(s)` URL's path. With no match, or with a match on a
    skipped file, the link stays `web` with a note naming the host; it
    never blocks.
  - **Everything else** gives `kind="text"` with a note: `#…`, `data:`,
    `tel:`, `javascript:`, relative `page.html`, bare `www.…`,
    `/jump_to_id/…` and `/courses/…`.
- Produces, in `html_md.py`:
  ```python
  @dataclass class Node: tag: str | None; attrs: dict[str, str]; children: list["Node"]; text: str = ""
  def parse_html(text: str) -> Node                  # own tree over html.parser; entities decoded once
  @dataclass class MdResult: markdown: str; linked_assets: set[str]; segs: list[Seg]
  def html_to_markdown(root: Node, targets: LinkTargets, report: Report, where: str) -> MdResult
  def text_only(root: Node) -> str                    # visible text, for titles of links and choices
  ```
  `html_to_markdown` reports and blocks through `report`, with `where`.
  Blocking means a linked `"size"` file (spec: Files › Limits).

- [ ] **Step 1: Write the failing tests:**
  ```python
  def test_converted_tags()           # p br h1-h6 strong/b em/i a ul/ol/li nested code pre blockquote img hr → expected Markdown
  def test_table_becomes_rows()       # cells joined " · ", one paragraph per row, reported "changed"
  def test_unwrapped_and_unknown_tags()   # div/span/section unwrapped; <foo>x</foo> → "x", tag reported once per page
  def test_script_style_dropped()     # with content, reported once per page
  def test_br_hard_break_and_whitespace_collapse()   # no line starts with 4 spaces; <br> → "\\\n"
  def test_code_and_pre_untouched()   # no escaping, no math inside; fences longer than any backtick run
  def test_math_skips_code_and_pre()  # \( \) inside <code> stays literal
  def test_sup_sub()                  # R<sup>2</sup> → R$^{2}$; x<sub>max</sub> → x$_{\text{max}}$; <sup>a{b</sup> → plain "a{b", reported
  def test_links_classified(url, expected)   # parametrised over every spec form above
  def test_link_scheme_lowercased_and_protocol_relative()
  def test_static_match_with_subfolder_and_suffix()   # "img/fig 1.png" → target "fig-1-2.png" from LinkTargets
  def test_c4x_and_asset_v1_underscore_subfolders()
  def test_old_site_absolute_link_stays_web_with_host_note()
  def test_linked_size_skipped_file_blocks()  # report.blockers has its where
  def test_linked_empty_or_type_file_loses_link()
  def test_image_without_match_becomes_alt_text()
  def test_target_attribute_dropped()
  def test_link_destination_with_spaces_and_parens_renders()   # Review Focus 3: "my fig (1).png" → md references target "my-fig-1.png"; extract_asset_filenames(md) == {"my-fig-1.png"}; render_markdown has src="my-fig-1.png" and href="my-fig-1.png"
  def test_destinations_written_in_angle_brackets()   # "<…>" with < > percent-encoded
  def test_escaped_brackets_never_links()   # "\\[a\\](b)" and "`[x](y)`" → extract_asset_filenames == set()
  def test_iframe_inside_content_becomes_link()   # [<title or host>](<src>), reported, src through classify_link
  def test_math_spanning_inline_nodes()           # <p>\(a <em>b</em> c\)</p> → one formula over the joined text
  def test_entities_decoded_once()                # "&amp;lt;" → text "&lt;" (escaped &), never "<"
  def test_sup_sub_reported_once_per_course()
  ```

- [ ] **Step 2: Run them to verify they fail.**
  Run: `.venv/bin/pytest tests/test_olx_html_md.py -q`.
  Expected: FAIL (the modules are missing).

- [ ] **Step 3: Implement `links.py` and `html_md.py`.**
  - `parse_html` builds `Node`s from `HTMLParser` callbacks. Void elements
    (`br`, `img`, `hr`, `input`, `source`, `meta`, `link`) do not nest.
    Unclosed tags close at their parent's end.
  - The converter walks blocks. For each block it builds text/math/code
    `Seg`s over the joined inline text, then calls `normalize_segments`
    and `render_segments`, and finally `escape_line_starts`.
  - `formula_errors` results are reported as `"Formula could not be
    typeset: <reason>"`. The formula stays in the content.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit:** `feat(olx): HTML to Markdown with classified links`.

### Task 4: Videos and Graasta pages

**Spec sections:** "Mapping" rows `video`, Graasta `html`, video-iframe
`html`; "Graasta detection"; "Smaller details › Video".

**Files:**
- Create: `backend/mathion/olx/video.py`.
- Create: `frontend/src/lib/videoUrlCases.json`, the shared cases:
  `[{input, output}]`, only for YouTube and Vimeo inputs both functions
  accept. Rejections are tested per language: Python returns `None`, and
  TS passes unsupported URLs through.
- Modify: `frontend/src/tests/normalizeVideoUrl.test.ts`. It also loops
  over the JSON cases. The TS function is unchanged; only its YouTube and
  Vimeo results are pinned.
- Test: `backend/tests/test_olx_video.py`.

**Interfaces:**
- Consumes: Task 3's `parse_html`, `Node` and `text_only`.
- Produces:
  ```python
  def to_https(url: str) -> str                      # //… and http: → https:, scheme lowercased
  def embed_url(url: str) -> str | None              # Python port of normalizeVideoUrl's YouTube/youtu.be/Vimeo branches; None if not YouTube/Vimeo
  def with_start(url: str, seconds: int) -> str      # YouTube ?start=N (any path); Vimeo #t=Ns; 0 → unchanged
  def video_component(node: ET.Element) -> tuple[str | None, list[str]]   # (url, dropped-feature notes)
  @dataclass class PageKind: kind: Literal["graasta", "video", "page"]; value: str | None
  def classify_html(root: Node) -> PageKind
  ```
  `video_component` follows the spec's order:
  1. `youtube_id_1_0` matching `^[A-Za-z0-9_-]{11}$` gives
     `https://www.youtube.com/embed/<id>`.
  2. Otherwise the first `html5_sources` URL that `embed_url` accepts,
     after `to_https`.
  3. `start_time` (`HH:MM:SS`) becomes seconds.
  4. Notes are returned for end time, transcripts and download settings.

  `classify_html` returns `graasta` with the app name only when the page's
  only meaningful content is one iframe. Its `src`, after `to_https`, a
  lowercase host and dropping `www.`, must match
  `^https://graasta\.com/apps/([a-z0-9-]+)/?$`. It returns `video` for a
  single YouTube or Vimeo iframe, and `page` otherwise.

- [ ] **Step 1: Write the failing tests:**
  ```python
  def test_shared_cases_match_ts(case)       # every videoUrlCases.json row: embed_url(input) == output
  def test_youtube_id_and_start()            # youtube_id_1_0 + start_time 00:01:05 → …/embed/<id>?start=65
  def test_bad_youtube_id_falls_back_to_html5_sources()
  def test_html5_http_and_protocol_relative_become_https()
  def test_vimeo_start_fragment()            # #t=65s
  def test_player_vimeo_passthrough_counts()
  def test_dropped_features_listed()         # end_time, transcripts, download → notes
  def test_classify_graasta_canonical_and_normalised()   # //graasta.com, http:, WWW.Graasta.com → graasta "sine-demo"
  def test_classify_graasta_with_query_is_page()
  def test_classify_graasta_with_other_content_is_page()
  def test_classify_video_iframe_embed_forms()   # youtube-nocookie, player.vimeo, // and http: → https
  ```
  On the TS side, add a test in `normalizeVideoUrl.test.ts` that loops over
  the JSON file.

- [ ] **Step 2: Run them to verify they fail.**
  Backend: FAIL, because `video.py` is missing. Frontend: the new JSON loop
  passes at once; that is expected, because it pins the existing function.

- [ ] **Step 3: Implement `video.py`.** Port the branches of
  `frontend/src/lib/normalizeVideoUrl.ts` (YouTube hosts, `/embed/`
  pass-through, `/watch?v=`, `/shorts/`, `youtu.be`, `vimeo.com/<digits>`)
  line for line.

- [ ] **Step 4: Run both suites to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit:** `feat(olx): videos and Graasta pages`.

### Task 5: Quizzes

**Spec sections:** "Quizzes", all bullets and the table; "Smaller details ›
Numeric answers", "› Quizzes".

**Files:**
- Create: `backend/mathion/olx/quiz.py`.
- Test: `backend/tests/test_olx_quiz.py`.

**Interfaces:**
- Consumes: Task 3's `parse_html`, `html_to_markdown` and `LinkTargets`;
  Task 2's `Seg` helpers, used for choice text.
- Produces:
  ```python
  @dataclass class PlanOption: text: str; is_correct: bool
  @dataclass class PlanQuestion:
      type: Literal["single_choice", "multiple_choice", "numeric_answer", "text_answer"]
      text_md: str; explanation_md: str | None
      options: list[PlanOption] = field(default_factory=list)
      correct_numeric: Decimal | None = None; precision: int | None = None; correct_text: str | None = None
  def convert_problem(node: ET.Element, targets: LinkTargets, report: Report, where: str) -> list[PlanQuestion]
  def numeric_answer(answer: str, tolerance: str | None) -> tuple[Decimal, int, str | None]   # (correct, p, report note); raises ValueError to skip
  def precision_for(width: Decimal) -> tuple[int, bool]   # smallest p in 0..10 with 5e-(p+1) <= width; (10, True) when even 10 is wider
  ```
  Question text is the HTML of the problem's children since the previous
  response, plus the response's own children minus the spec's exclusion
  list:
  - the inputs: `choicegroup`, `checkboxgroup`, `optioninput`, `textline`,
    `formulaequationinput`;
  - `solution`;
  - the hint elements: `correcthint`, `choicehint`, `stringequalhint`,
    `optionhint`, `hintgroup`, `demandhint`;
  - `additional_answer` and `responseparam`.

  That HTML is serialised back and run through `html_to_markdown`.

- [ ] **Step 1: Write the failing tests:**
  ```python
  def test_multiplechoice_single_and_several_correct()   # several → multiple_choice, reported
  def test_optionresponse_both_forms()                    # <option correct="True"> and options="('a','b')" correct="a"
  def test_choiceresponse_partial_credit_reported_once()
  def test_numeric_default_tolerance()                    # "80" → (80, 3); "0" → (0, 10), not reported widened
  def test_numeric_absolute_and_percent_tolerance()       # default="0.01" → p=2; "5%" on 80 → width 4 → p=0
  def test_numeric_range()                                # "[0.026, 0.029]" → (0.0275, 3), "range narrowed to …"; midpoint rounded to min(p+1,10)
  def test_numeric_widened_and_narrowed_notes()           # tolerance 1e-13 → p=10 "tolerance widened"; t > 0.5 → "tolerance narrowed"
  def test_numeric_skips()                                # "x+1", "$a", 1e10, 11 decimals (after trailing-zero normalise) → ValueError
  def test_scientific_notation()                          # "1.5e-3" → Decimal("0.0015")
  def test_stringresponse()                               # first answer; additional_answer reported; regexp skipped; case-sensitive reported once
  def test_unsupported_response_and_script_skipped()      # formularesponse, customresponse, <script> problem
  def test_question_text_both_layouts()                   # siblings before the response and children inside it
  def test_question_text_excludes_solution_hints_inputs() # previous solution never included
  def test_explanation_minus_leading_explanation_paragraph()
  def test_text_after_last_response_appended_to_explanation()
  def test_choice_rules()                                 # empty choice / >500 chars / <2 choices / none correct → question skipped, reported
  def test_choice_text_math_and_escapes()                 # "\\(x^2\\) is *big*" → "$x^2$ is *big*" (choice mode)
  def test_choicehint_and_code_lost_reported_once_per_quiz()
  def test_empty_question_text_skipped()
  def test_dropped_attributes_reported_once()             # weight, rerandomize dropped silently; shuffle and showanswer reported once per course
  def test_unsupported_choice_math_reported_with_where()  # "\\(\\color{red}x\\)" in a choice → formula error line with its where
  def test_demandhint_reported_once_per_quiz()
  def test_skipped_question_says_what_to_do()             # text ends "add this question in the quiz editor"
  ```

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL (the module
  is missing).

- [ ] **Step 3: Implement `quiz.py`** with `decimal.Decimal` throughout.
  Use no `float`, so `0.0275` stays exact.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit:** `feat(olx): quiz conversion`.

### Task 6: Files, structure and `convert`

**Spec sections:** "Mapping" (all rows, the caps), "Item titles", "Slugs",
"App file matching", "Files", "The server calls › check" (what it
validates), "Smaller details › Labels", "› Item titles", "› Uploads"
(names within 255, sorted processing).

**Files:**
- Create: `backend/mathion/olx/files.py` and `backend/mathion/olx/convert.py`.
- Test: `backend/tests/test_olx_convert.py`.

**Interfaces:**
- Consumes: Tasks 1–5; `sanitize_filename` and `validate_extension` from
  `mathion.assets`; `slugify` from `mathion.api.text_utils`;
  `render_markdown` and `extract_asset_filenames` from `mathion.markdown`.
- Produces, in `files.py`:
  ```python
  @dataclass(frozen=True) class Limits: max_file_bytes: int; max_total_bytes: int
  @dataclass class Upload: source: str; target: str; kind: Literal["static", "app"]; size: int
  @dataclass class FilePlan: uploads: list[Upload]; targets: LinkTargets; app_targets: dict[str, str]; total: int
  def unique_name(name: str, taken: set[str]) -> str      # -2, -3 … before the extension, total ≤ 255
  def plan_files(static: list[StaticEntry], apps: list[AppEntry], graasta_names: set[str], limits: Limits, report: Report) -> FilePlan
  ```
  `plan_files` works in this order:
  1. App targets first: `sanitize_filename(<name>.js)` for every Graasta
     name that has a picked app file. Unused picked app files are reported
     and not planned.
  2. Then static entries with `skipped is None`, sorted by path. Each gets
     `unique_name(sanitize_filename(basename))`.
  3. `targets.skipped` gets every skipped entry.
  4. Totals: over `max_total_bytes` blocks. A used app file over the
     per-file limit blocks.
- Produces, in `convert.py`:
  ```python
  @dataclass class PlanItem: type: str; title: str; slug: str; where: str
      content_md: str | None = None; video_url: str | None = None; app_target: str | None = None
      questions: list[PlanQuestion] = field(default_factory=list)
  @dataclass class PlanSequence: title: str; slug: str; items: list[PlanItem]
  @dataclass class PlanBlock: title: str; slug: str; sequences: list[PlanSequence]
  @dataclass class Plan:
      course_name: str; label: str; max_quiz_attempts: int
      blocks: list[PlanBlock]; uploads: list[Upload]
      linked_assets: set[str]; used_app_targets: set[str]
      report: Report; summary: dict[str, int]
  def make_slug(title: str, fallback: str, taken: set[str]) -> str   # slugify, cut at last dash ≤76 or at 76, fallback, -2/-3
  def unfinished_label(course_name: str) -> str        # "Open edX (unfinished): <name>", name cut to fit 200
  def final_label(course_name: str, day: date) -> str  # "Open edX: <name> (YYYY-MM-DD)", name cut, never the date
  def convert(body: CheckBody, limits: Limits) -> Plan
  ```
  The `summary` keys are blocks, sequences, items, videos, pages, apps,
  quizzes, files and bytes.

  `convert` runs these steps:
  1. `load_course`.
  2. Pre-scan the `html` components with `classify_html` for Graasta names.
  3. `plan_files`.
  4. Walk chapters, subsections and units, and map each component by the
     spec's table.
  5. Drop the sequences and blocks left empty, reported.
  6. Then apply the caps: 8 blocks, and 8 sequences per block, counted
     after skipping and pruning. Going over a cap blocks, naming the
     chapters past the 8th.
  7. Run the column checks: title 200, with the base cut and never the
     `(2)` suffix; slug 80; option 500; correct_text 500; video_url 500;
     `Numeric(20,10)`. A failing check blocks.
  8. Check that every `extract_asset_filenames` name in every Markdown
     string is in the planned targets; otherwise it blocks.
  9. Check that every Markdown string renders with `render_markdown`.
  10. Set `max_quiz_attempts`: clamped to 1–10; empty or unlimited gives
      10, reported; a problem's own `max_attempts` that differs is reported.
  11. Block when nothing is left to import.

- [ ] **Step 1: Write the failing tests:**
  ```python
  def test_convert_fixture_summary()            # exact counts for the fixture; zero blockers
  def test_item_titles_single_and_multi_component()   # unit name vs component names, "(2)" fallback
  def test_titles_and_slugs_non_latin_and_duplicates()   # Review Focus 1
  def test_slug_cut_and_fallbacks()             # 90-char title; no dash in 76; "Задача" → item-N
  def test_caps_block_after_skipping()          # 9 chapters with one staff-only → ok; 9 real → blocked naming the 9th
  def test_caps_after_pruning_empty()           # 9 chapters, one holding only unsupported components → ok
  def test_sequence_cap()                       # 9 subsections in one chapter → blocked naming the chapter
  def test_used_app_over_file_limit_blocks()
  def test_app_names_matched_in_sanitized_form()   # picked "Sine Demo.js" matches graasta "sine-demo"
  def test_long_collision_suffix_within_255()
  def test_problem_max_attempts_differs_reported()
  def test_title_cut_keeps_suffix()             # 210-char unit title in a 2-component unit → "...(2)" kept, ≤ 200
  def test_empty_sequence_and_block_dropped()
  def test_graasta_app_matched_and_missing()    # app present → app_target; absent → empty app item, reported with address
  def test_unused_app_reported_not_uploaded()
  def test_app_name_wins_over_static_clash()    # static/sine-demo.js → sine-demo-2.js
  def test_colliding_static_names_resolve_links()   # Review Focus 2
  def test_skipped_entries_not_planned()        # skipped "empty"/"type"/"size" never in uploads
  def test_total_over_limit_blocks()
  def test_unsupported_components_skipped_with_unit_title()
  def test_column_overflow_blocks()             # 600-char option text that slipped past quiz rules → blocks
  def test_unknown_asset_reference_blocks()
  def test_max_attempts_policy_clamp_and_unlimited()
  def test_labels_cut_name_not_date()           # 250-char name → both labels ≤ 200, date intact
  def test_nothing_left_blocks()
  def test_unlinked_files_reported()            # uploaded, "not linked from any page"
  def test_skipped_lines_say_what_to_do()       # a linked file that lost its link: "upload the file and re-link it"
  ```

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL (the modules
  are missing).

- [ ] **Step 3: Implement `files.py` and `convert.py`.** `convert` never
  touches the database. It takes `Limits` from the caller.

- [ ] **Step 4: Run the tests to verify they pass**, then the whole backend
  suite. Expected: PASS.

- [ ] **Step 5: Commit:** `feat(olx): file planning and the pure converter`.

### Task 7: Routes, body cap, build and `/api/auth/config`

**Spec sections:** "The server calls", all bullets, including "Body cap";
"Limits the browser knows"; "Flow › Import" step 3.

**Files:**
- Create: `backend/mathion/olx/apply.py` and `backend/mathion/api/olx_import.py`.
- Modify:
  - `backend/tests/test_auth_config.py:28` and `:40`: the exact response
    and key-set assertions gain `max_total_mb`, for both the default (500)
    and a saved value.
  - `backend/mathion/main.py`: import the router and
    `app.include_router(olx_import_router)` with the other routers
    (~line 167), before the SPA routes.
  - `backend/mathion/schemas.py:982`: `AuthConfigResponse` gains
    `max_total_mb: int`.
  - `backend/mathion/api/auth.py:55`: fill `max_total_mb` from `load_site(db)`.
- Test: `backend/tests/test_olx_routes.py`.

**Interfaces:**
- Consumes: Task 6's `convert`, `Plan` and `Limits`; `load_site`,
  `require_course_admin`, `get_or_404`, `get_current_user` and `get_db`;
  `render_with_assets`, `sync_asset_references`, `sync_script_reference`
  and `bump_content_updated_at`.
- Produces:
  ```python
  # olx/apply.py
  class ApplyRefused(Exception): ...       # .status (403/404/409), .detail
  def apply(plan: Plan, version_id: int, db: Session, day: date) -> list[str]   # returns files to unlink after commit
  # api/olx_import.py
  MAX_BODY = 45 * 1024 * 1024
  def olx_course_admin(course_id: int, user=Depends(get_current_user), db=Depends(get_db)) -> Course      # sync; ends with db.rollback()
  def olx_version_admin(version_id: int, user=Depends(get_current_user), db=Depends(get_db)) -> int       # sync; 403 disabled; ends with db.rollback()
  async def capped_body(request: Request) -> bytes   # Content-Length > MAX_BODY → 413; stream count > MAX_BODY → 413
  POST /api/courses/{course_id}/olx-import/check   -> CheckResponse
  POST /api/versions/{version_id}/olx-import/build -> BuildResponse
  GET  /api/versions/{version_id}/olx-import/status -> {"state": "running" | "built" | "empty"}
  POST /api/versions/{version_id}/olx-import/discard -> 204
  ```
  The **status** route checks course admin, then runs `SELECT … FOR UPDATE
  NOWAIT` on the version row:
  - it catches `sqlalchemy.exc.OperationalError`, and only when
    `exc.orig.sqlstate == "55P03"` it rolls back and answers `running`;
    any other error is re-raised;
  - otherwise it answers `built` when the version has blocks, else `empty`;
  - it then rolls back.

  The **discard** route checks course admin, then runs `SELECT … FOR UPDATE`
  (waiting) on the version. Under the lock it requires all of:
  - not disabled (else 403);
  - `state == "created"`;
  - the label starts with `Open edX (unfinished):`;
  - no blocks.

  When one of the last three fails it answers 409 `"This import finished;
  the draft was kept."`. Otherwise it deletes the version exactly as
  `delete_version` does (`api/versions.py:395`): `db.delete`, commit,
  then `shutil.rmtree` of the version's asset folder.
  The route signatures put the admin dependency before `capped_body`, for
  example `def check(course: Course = Depends(olx_course_admin), raw: bytes
  = Depends(capped_body), db = Depends(get_db))`. FastAPI resolves them in
  order, so the body is read only after the admin check. The routes are
  sync `def`s, so parsing and converting run in the thread pool. Check
  parses with `CheckBody.model_validate_json(raw)` and build with
  `BuildBody.model_validate_json(raw)`; a `ValidationError` becomes 422.

  Response schemas, added to `schemas.py`:
  ```python
  class OlxReportLine(BaseModel): level: str; where: str; text: str
  class OlxUpload(BaseModel): source: str; target: str; kind: str; size: int
  class OlxCheckResponse(BaseModel): summary: dict[str, int]; report: list[OlxReportLine]; blockers: list[OlxReportLine]
      uploads: list[OlxUpload]; linked: list[str]; max_quiz_attempts: int; label: str; blocking: bool
  class OlxBuildResponse(BaseModel): report: list[OlxReportLine]; label: str
  ```

  The **build route** validates the body and runs `convert(body,
  limits)`. A blocker gives 409 with the blockers. It then calls `apply`,
  commits, and only then unlinks the returned files. On any exception it
  rolls back and unlinks nothing:
  - `ApplyRefused` becomes `HTTPException(exc.status, exc.detail)`;
  - an `HTTPException` from `render_with_assets` keeps its status;
  - anything else is re-raised (500).

  It returns `report.lines(body.report)` and the final label.

  `apply` runs inside that transaction, in this order:
  1. `SELECT … FOR UPDATE` on the version. No row (a discard deleted it)
     raises `ApplyRefused(404)`.
  2. Under the lock, recheck: not disabled (403), `state == "created"`
     (409), and no blocks yet (409). These raise `ApplyRefused`.
  3. Every linked asset and every used app target must exist as an `Asset`
     row in the version; otherwise `ApplyRefused(409)` naming them. A
     missing unlinked planned file is reported.
  4. Create the Block/Sequence/Item/Question/AnswerOption rows. The order
     goes 1, 2, 3, …; `Block.info_html` is `""`. Content goes through
     `render_with_assets` and `sync_asset_references`, exactly as
     `api/items.py:37` and `api/questions.py:84` do. App items go through
     `sync_script_reference`, inside the transaction.
  5. Set the final label and call `bump_content_updated_at`.

  Only the file deletions that `sync_script_reference` returns happen
  after commit.

- [ ] **Step 1: Write the failing tests.**
  Helpers: `_admin_course(db, test_user)` (a Course, a CourseAdmin and a
  created version), the CSRF-aware `auth_client`, and `_upload(client,
  vid, name, data)` posting to `/api/versions/{vid}/assets` as in
  `tests/test_assets_api.py`.
  ```python
  def test_auth_config_has_max_total_mb(client)
  def test_check_returns_plan_and_writes_nothing()     # fixture bundle → summary, uploads, label "Open edX (unfinished): …"; no rows added
  def test_check_needs_course_admin()                  # other user → 403; anonymous → 401
  def test_csrf_header_missing_403()                   # a plain TestClient, not CSRFTestClient (it adds the header)
  def test_build_and_status_need_course_admin()
  # The body tests call the ASGI app directly through a helper
  # _asgi_post(path, chunks, headers) that runs app(scope, receive, send)
  # under asyncio and counts receive() calls (TestClient buffers the body).
  def test_body_not_read_for_non_admin()               # 403 with 0 receive() calls
  def test_no_connection_held_while_streaming()        # inside receive(): engine.pool.checkedout() == baseline
  def test_content_length_over_cap_413()               # 413 with 0 receive() calls
  def test_streamed_body_over_cap_413()                # no Content-Length; stops receiving just past 45 MB
  def test_invalid_json_422()
  def test_build_creates_content_and_final_label()     # upload fixture files first; then build; tree matches plan; label "Open edX: … (2026-11-18)"
  def test_build_items_equal_hand_made()               # imported static page content_html == render_with_assets(same md); AssetReference rows exist; option.text_html set
  def test_build_refuses_published_disabled_or_nonempty()   # 409 / 403 / 409
  def test_build_twice_is_409_no_duplicates()
  def test_simultaneous_builds_one_wins()              # two threads, separate SessionLocal sessions; one 200, one 409; blocks created once
  def test_render_error_after_partial_inserts_rolls_back()   # monkeypatch the plan after the asset precheck: a later item's md names a missing asset; real render_with_assets → 422; no block/item rows
  def test_script_files_unlinked_only_after_commit()   # monkeypatch apply to return a sentinel path; spy on os.unlink: called after commit; never on a rolled-back build
  def test_apply_refused_maps_to_http()                # disabled → 403, published → 409, version gone → 404 (not 500)
  def test_build_body_with_report_and_date_parses()    # BuildBody fields accepted; extra field → 422
  def test_app_script_reference_persisted()            # Item.script_url set, AssetReference row present after commit
  def test_status_running_built_empty()                # running: a second session holds FOR UPDATE; built: after build; empty: fresh draft
  def test_status_other_db_error_is_not_running()      # an OperationalError with another sqlstate is re-raised
  def test_discard_deletes_unfinished_empty_draft()    # version row gone, asset folder gone
  def test_discard_refuses_built_or_relabelled()       # built draft → 409 kept; label without the prefix → 409; published → 409
  def test_discard_waits_for_build_and_keeps_it()      # session A holds FOR UPDATE and adds blocks; discard in a thread waits; A commits → discard 409, draft kept
  def test_build_after_discard_is_404()                # status empty → discard → build → 404 (admin dependency), no rows
  # Pre-lock race: the real build runs in a thread; a monkeypatched hook in
  # apply() blocks on a threading.Event after authorisation and before the
  # FOR UPDATE. Status in the main thread answers "empty" meanwhile.
  def test_prelock_race_discard_first()                # discard commits; release → apply finds no row → 404, no rows
  def test_prelock_race_build_first()                  # release build, it commits; discard → 409, content kept
  def test_discard_needs_course_admin()
  def test_build_missing_linked_file_409_unlinked_reported()
  def test_build_rollback_on_error_leaves_no_rows()   # monkeypatch apply to raise mid-way
  def test_build_merges_browser_report_lines()        # dedupe + sort
  def test_large_synthetic_course_is_fast()           # Review Focus 4: generated 8x8x30 bundle, convert+apply < 10 s
  def test_import_twice_into_one_course()             # Review Focus 5
  ```

  `linked` in the check response is `sorted(plan.linked_assets |
  plan.used_app_targets)`.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `.venv/bin/pytest tests/test_olx_routes.py -q`.
  Expected: FAIL (404 on the routes; `max_total_mb` missing).

- [ ] **Step 3: Implement `apply.py`, the routes and the config field.**

- [ ] **Step 4: Run the file, then the whole backend suite.** Expected:
  PASS. Record the measured time of `test_large_synthetic_course_is_fast`
  in the ledger.

- [ ] **Step 5: Commit:** `feat(olx): check and build routes with a streamed body cap`.

### Task 8: Reading the archive in the browser

**Spec sections:** "Reading the archive in the browser", all bullets;
"Smaller details › Encoding", "› Uploads" (the whitespace rule).

**Files:**
- Create: `frontend/src/lib/olx/tar.ts` and `frontend/src/lib/olx/readExport.ts`.
- Create: `frontend/src/lib/olx/types.ts`, holding the shared TS types for
  the bundle, the plan response and report lines.
- Modify: `frontend/src/lib/auth.svelte.ts:49-57`: `AuthConfig` gains
  `max_total_mb: number`.
- Test: `frontend/src/tests/olxTar.test.ts` and
  `frontend/src/tests/olxReadExport.test.ts`.

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export type Skipped = 'empty' | 'type' | 'size' | null;
  export type StaticEntry = { path: string; size: number; skipped: Skipped };
  export type ReportLine = { level: 'skipped' | 'changed' | 'note'; where: string; text: string };
  export type CheckBody = { files: Record<string, string>; static: StaticEntry[]; apps: { name: string; size: number }[] };
  export type BuildBody = CheckBody & { report: ReportLine[]; date: string };
  export type PlannedUpload = { source: string; target: string; kind: 'static' | 'app'; size: number };
  export type CheckResponse = { summary: Record<string, number>; report: ReportLine[]; blockers: ReportLine[];
    uploads: PlannedUpload[]; linked: string[]; max_quiz_attempts: number; label: string; blocking: boolean };
  export type ImportLimits = { maxFileBytes: number; maxTotalBytes: number };
  export type ArchiveSource = { name: string; size: number; stream(): ReadableStream<Uint8Array> };   // a File, or a Node Blob in tests
  ```
- Produces, in `tar.ts`:
  ```ts
  export type TarEntry = { path: string; size: number; type: 'file' | 'other'; body: ReadableStream<Uint8Array> | null };
  export async function* readTar(stream: ReadableStream<Uint8Array>): AsyncGenerator<TarEntry>
  ```
  It handles:
  - 512-byte headers, the ustar `prefix`, GNU `././@LongLink` (type `L`),
    pax `path`/`size` (type `x`; `g` is ignored), and base-256 sizes (high
    bit set);
  - the end at two zero blocks.

  An entry's `body` must be consumed or cancelled before the next `next()`.
  `readTar` skips any unread part. A truncated archive throws
  `TarError('truncated')`.
- Produces, in `readExport.ts`:
  ```ts
  export const ALLOWED_EXTENSIONS: ReadonlySet<string>   // same values as backend/mathion/assets.py:4-9
  export type ReadResult = { body: CheckBody; blobs: Map<string, Blob>; report: ReportLine[]; jsonBytes: number };
  export class ReadError extends Error {}               // plain-language message for the modal
  export async function readExport(file: ArchiveSource, apps: (ArchiveSource & Blob)[], limits: ImportLimits): Promise<ReadResult>
  ```
  It reads the archive in **two passes**, opening `file.stream()` twice, so
  nothing is buffered before the root is known:
  1. **Gzip.** Each pass detects the magic bytes `1f 8b` and pipes through
     `DecompressionStream('gzip')`. A plain tar is read as is.
  2. **Pass 1, the course root.** Read headers only, cancelling every body.
     The root is the folder of the shallowest `course.xml`, wherever it
     appears in the archive. Paths: `\` becomes `/`, a leading `/` is
     removed, and any `..` rejects the entry.
  3. **Pass 2, extraction.** Only entries under the root are read. A kept
     file's `Blob` is built from that entry's own chunks, which are then
     released. The whole decompressed archive is never held in memory.
  4. **The 5 GB guard** counts all decompressed bytes in one pass, headers
     and skipped bodies included. The counter restarts for pass 2.
     Skipping an entry drains or cancels only that entry's body, never the
     archive stream.
  5. **Text files.** `.xml`, `.html` and `policies/**/*.json`, outside
     `static/ drafts/ about/ info/ assets/ tabs/`, are decoded with
     `TextDecoder('utf-8', {fatal: true})`. A decode failure skips the
     file, reported.
  6. **Static files** (`static/**`): an entry gets one `skipped` flag:
     - `"type"` when `ALLOWED_EXTENSIONS` lacks its lowercased extension;
     - `"size"` when it is over `maxFileBytes`;
     - `"empty"` when it is 0 bytes, or under 1 MB and only ASCII
       whitespace: bytes 9, 10, 11, 12, 13 and 32, the set Python's
       `bytes.strip()` removes;
     - otherwise it is kept as a `Blob`.
  7. **Caps** stop with a `ReadError`:
     - the kept bytes pass `maxTotalBytes`;
     - more than 5 GB of decompressed bytes;
     - text over 20 MB or 20 000 entries;
     - the UTF-8 length of `JSON.stringify(body)` over 40 MB.
  8. **App files** become `body.apps`, and their `Blob`s are keyed by
     `app:<name>`.

- [ ] **Step 1: Write the failing tests.** Build the test tars in memory
  with a tiny writer helper in `src/tests/support/tarWriter.ts`.
  - jsdom's `File` and `Blob` lack `stream()`, `arrayBuffer()` and
    `text()`. So the reader tests use Node's `File`, `Blob` and
    `DecompressionStream`.
  - The project has no `@types/node` and adds none. So the tests reach
    them through `globalThis.process.getBuiltinModule('node:buffer')` and
    `('node:stream/web')`, typed by a small local declaration in
    `src/tests/support/nodeBuiltins.d.ts`. That file declares only those
    two calls and the members used.
  - The Node classes are installed with `vi.stubGlobal` and restored in
    `afterEach`.
  - `readExport` takes an `ArchiveSource`, so a Node `File` satisfies it
    structurally.
  ```ts
  it('reads the committed fixture tar: course root, text files, static entries')
  it('handles ustar prefix, GNU long names, pax path/size and base-256 sizes')
  it('skips directories and links; truncated archive throws')
  it('rejects .. entries and normalises backslashes')
  it('flags type, size and empty (0 bytes, whitespace-only < 1 MB) static files')
  it('treats each of bytes 9, 10, 11, 12, 13, 32 and a mix as whitespace')
  it('finds a shallower course.xml that appears after a deeper one and after other files')
  it('counts skipped bodies and headers toward the 5 GB guard, per pass')
  it('keeps a whitespace-only file of 1 MB as a kept file (the server refuses it later)')
  it('stops on kept total over the limit, on the 5 GB guard, on text caps, on 40 MB JSON')
  it('skips non-UTF-8 text files with a report line')
  it('ignores drafts/ about/ info/ assets/ tabs/ and static text files')
  it('reads a plain .tar without gzip')
  it('ALLOWED_EXTENSIONS matches the backend list')   // reads backend/mathion/assets.py text, parses the set
  ```

- [ ] **Step 2: Run them to verify they fail.** Run: `npm test`.
  Expected: the new files fail; the rest stay green.

- [ ] **Step 3: Implement `tar.ts`, `readExport.ts` and `types.ts`**, and
  add `max_total_mb` to `AuthConfig`. Nothing read from the archive is
  executed or rendered.

- [ ] **Step 4: Run `npm test && npm run check`.** Expected: green.

- [ ] **Step 5: Commit:** `feat(olx): read Open edX exports in the browser`.

### Task 9: Upload and build runner

**Spec sections:** "Flow › Import", "Flow › Done or failed", "Files ›
Upload errors", "Smaller details › Uploads", "› Labels" (date).

**Files:**
- Create: `frontend/src/lib/olx/run.ts`.
- Test: `frontend/src/tests/olxRun.test.ts`.

**Interfaces:**
- Consumes: Task 8's types; `uploadAsset`, `listAssets` and `AssetResponse`
  from `lib/assets.ts`; `api` and `ApiError` from `lib/api.ts`.
- Produces:
  ```ts
  export const REFUSAL = new Set([400, 413, 415, 422]);
    export type UploadProgress = { outcome: Map<string, 'done' | 'refused'>; lines: ReportLine[] };   // kept across Retry
  export type UploadResult = { kind: 'done' } | { kind: 'retry'; message: string } | { kind: 'failed'; message: string };
  export function checkImport(courseId: number, body: CheckBody): Promise<CheckResponse>
  export function createDraft(courseId: number, label: string, maxQuizAttempts: number): Promise<Version>
  export async function uploadAll(versionId: number, plan: PlannedUpload[], blobs: Map<string, Blob>,
    linked: Set<string>, progress: UploadProgress, onProgress: (done: number, total: number) => void,
    wait?: (ms: number) => Promise<void>): Promise<UploadResult>   // skips targets already in progress.outcome
  export async function markPresent(versionId: number, plan: PlannedUpload[], progress: UploadProgress): Promise<void>   // Retry: listed with matching size → 'done'
  export type BuildOutcome = { kind: 'done'; report: ReportLine[]; label: string } | { kind: 'committed-unknown' }
    | { kind: 'running' } | { kind: 'failed'; message: string; canDiscard: boolean };
  export async function runBuild(versionId: number, body: BuildBody): Promise<BuildOutcome>
  export async function buildStatus(versionId: number): Promise<BuildOutcome>   // GET …/olx-import/status: running | built → committed-unknown | empty → failed
  export function localDate(now?: Date): string          // YYYY-MM-DD in local time
  export const BUILD_CAPS = { bytes: 40 * 1024 * 1024, lines: 20000, where: 600, text: 2000 };
  export function assembleBuildBody(body: CheckBody, readerLines: ReportLine[], progress: UploadProgress, date: string):
    { kind: 'ok'; body: BuildBody } | { kind: 'too-large'; message: string }
  export function reportText(lines: ReportLine[], blockers: ReportLine[]): string   // the .txt, grouped by level
  ```
  Upload rules:
  - At most 3 attempts per file (spec), with a 1 s, then 2 s wait through
    `wait`, only after a network error (status 0), a 5xx or a 429.
  - A 409 counts as done when `listAssets` shows the target with the same
    `file_size`. Otherwise it stops with `retry`.
  - A `REFUSAL` status:
    - on an unlinked static file, it adds a refused report line and goes
      on;
    - on a linked file or an app file, it gives `failed`.
  - Any other 4xx gives `failed`.
  - A 4xx after a retry that followed a network error first re-lists: a
    file now present with the right size counts as done.
  - The `.js` app uploads come from `blobs.get('app:<name>')`. Before each
    one, `scanAppSource(await blob.text())` runs (`lib/appSourceScan.ts`).
    Each warning becomes a `note` line with `where = ""` and text
    `<target>: <warning>`; warnings never block.
  - Refusal and warning lines go into `progress.lines`. Each line is added
    once, since `progress` survives Retry.
  - `linked` comes from `CheckResponse.linked`, as `new Set(check.linked)`.

  `assembleBuildBody` runs just before the build post:
  - The report is the reader lines plus `progress.lines`.
  - `where` is cut to 600 characters and `text` to 2000, with `…` at the
    cut, because file names can be long.
  - Over 20 000 lines, or a `JSON.stringify` UTF-8 size over 40 MB, gives
    `too-large`. Its message is "This export's report is too large to
    build. Delete the draft and import fewer files." It shows in the
    Failed state, which offers Delete.
  - No line is silently dropped.

  `runBuild`:
  - posts to `/api/versions/{vid}/olx-import/build`;
  - on a network error, a timeout or a 502/504, it returns `buildStatus`.
    Only `empty` leads to the Failed state with Delete. `running` shows
    **Check again**, which calls `buildStatus` again. A failed status call
    stays `running`, so no Delete is offered on a guess.
  - a 404 from the build (the draft was discarded) gives `failed` with
    `canDiscard: false`; every other `failed` has `canDiscard: true`. The
    modal shows Delete only when `canDiscard` is true.

  `discardDraft(versionId)` posts to `…/olx-import/discard`:
  - 204 gives `'deleted'`;
  - 409 gives `'built'`: the modal shows Done with "report could not be
    loaded";
  - anything else gives `'failed'`, keeping the draft listed.

  It is exported as `export async function discardDraft(versionId: number):
  Promise<'deleted' | 'built' | 'failed'>`.

- [ ] **Step 1: Write the failing tests** with a scripted `fetch` stub
  (a queue of responses per URL) and an instant `wait`:
  ```ts
  it('uploads in order and reports progress')
  it('makes at most 3 attempts on network errors, 5xx and 429, then returns retry')
  it('keeps refusals and warnings across retry → markPresent → resume, each reported once')
  it('409 with matching size is done; with other size is retry')
  it('refusal of an unlinked file becomes a report line and continues')
  it('refusal of a linked or app file fails at once')
  it('401/403/404 fail at once')
  it('app files get scanAppSource warnings as note lines, never blocking')
  it('a 400 after a network-error retry re-lists and counts a present file as done')
  it('markPresent marks listed files with matching size as done; resume skips done and refused')
  it('runBuild returns done with the report')
  it('runBuild on 504 or network error asks status: running, built → committed-unknown, empty → failed')
  it('a failed status call stays running')
  it('localDate uses local time')
  it('reportText groups blockers, skipped, changed, note')
  it('assembleBuildBody merges reader and upload lines and cuts long where/text')
  it('assembleBuildBody: a check body under 40 MB that passes 40 MB with its report gives too-large')
  it('assembleBuildBody: 20 001 lines gives too-large')
  it('check → upload: a refused file in check.linked fails, one not in it continues')
  it('discardDraft maps 204, 409 and other statuses')
  it('a build 404 gives failed with canDiscard false; a 409 gives canDiscard true')
  ```

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL (the module
  is missing).

- [ ] **Step 3: Implement `run.ts`.**

- [ ] **Step 4: Run `npm test && npm run check`.** Expected: green.

- [ ] **Step 5: Commit:** `feat(olx): upload and build runner`.

### Task 10: The import modal on the Versions page

**Spec sections:** "Flow (one modal, same tab)", all states; "Smaller
details › Labels" (unfinished drafts list); "Constraints" (modal styles,
gate).

**Files:**
- Create: `frontend/src/components/editor/OlxImportModal.svelte`.
- Modify: `frontend/src/pages/editor/VersionsPage.svelte`:
  - an **Import from Open edX** button beside **+ Add version** (~line 470);
  - opening the modal;
  - while an import runs, `navDirty` is true and `askNav` (~line 192)
    returns the modal's registered `GuardAsk` factory's result. The page's
    usual question sits in the create-version form, which is not on screen
    then;
  - a reload of the version list after the modal closes.
- Modify: `frontend/scripts/visual-refresh-gate.sh`. Pin the modal's
  styles the same way as `NewRunModal` and `RosterImportModal`. Raise
  `EXPECTED_CHECKS` by the number of new checks.
- Test: `frontend/src/tests/OlxImportModal.svelte.test.ts`; one case in
  `frontend/src/tests/VersionsPage.slots.svelte.test.ts`; two cases in
  `frontend/src/tests/VersionsPage.realNavigate.svelte.test.ts`, which
  uses the real router.

**Interfaces:**
- Consumes: Task 8's `readExport`, `ReadError` and types; Task 9's
  `checkImport`, `createDraft`, `uploadAll`, `markPresent`, `runBuild`,
  `buildStatus`, `discardDraft`, `assembleBuildBody`, `localDate` and
  `reportText`; `InPlaceAsk`, `refused`, `Ask` and `GuardAsk` from
  `lib/askInPlace.svelte.ts`; `getAuthConfig`; `Modal` (`closeDisabled`,
  `header`, `footer`); `pushToast`; `navigate`.
- Produces:
  `OlxImportModal` props `{ courseId: number; courseSlug: string; versions:
  Version[]; onClose: () => void; onBusyChange: (busy: boolean) => void;
  registerAsk: (guard: (() => GuardAsk) | null) => void }`.

  The modal owns `const navAsk = new InPlaceAsk()` and renders its question
  in the modal footer. The registered factory:
  - while `navAsk.open`, calls `navAsk.focusCancel()` and returns
    `refused()`;
  - otherwise returns `{ promise, dismiss: () => navAsk.dismiss(),
    focusCancel: () => navAsk.focusCancel() }`. Here `promise` is
    `navAsk.ask(IMPORT_NAV_ASK)` mapped to `a === 'confirm'`.

  `IMPORT_NAV_ASK` is a local `Ask`: "An import is running. Leaving stops
  it and leaves an unfinished draft.", confirm label "Leave", tone
  `danger`.

  The modal registers the factory when an import starts, and calls
  `registerAsk(null)` plus `navAsk.dismiss()` when it ends and in
  `onDestroy`.

  Every Delete in the modal (the Failed state and the unfinished-drafts
  list) calls `discardDraft`, never `DELETE /api/versions/{vid}`.
  It passes `closeOnBackdrop={false}` explicitly. `Modal.svelte:126` does
  not check `closeDisabled` on a backdrop click.

  The states are `pick`, `reading`, `check`, `importing`, `done` and
  `failed`. Exact copy is the builder's, within the existing modal and
  form styles. The fixed strings are:
  - "Could not read the site's file limits. Try again.";
  - the summary line, in the spec's format ("4 blocks, 11 sequences,
    167 items: 107 videos, 11 pages, 22 apps, 27 quizzes; 20 files,
    95 MB");
  - "Uploading files: N of M";
  - the Keep note: "this import cannot be resumed";
  - the "report could not be loaded" note for `committed-unknown`.

  On open, the modal:
  - re-reads `getAuthConfig()`. A missing `max_file_mb` or `max_total_mb`
    shows the limits sentence and offers no import;
  - lists the `versions` whose label starts with `Open edX (unfinished):`
    and state is `created`, each with **Delete** (`discardDraft`; a
    `'built'` answer removes the row from the list and says the draft was
    kept).

  While `reading`/`importing`, `closeDisabled` is true and `onBusyChange(true)`.

- [ ] **Step 1: Write the failing tests** with `mount`/`flushSync`, the
  `settle()` helper and a scripted fetch, as in
  `NewCourseDialog.svelte.test.ts`. `vi.mock` the `readExport` module so
  that modal tests need no archive bytes.
  ```ts
  it('stops with the limits sentence when the config lacks a limit')
  it('lists unfinished drafts with Delete and deletes one')
  it('check state shows the summary, blockers and report; Import disabled when blocking')
  it('import runs create → uploads → build and shows Done with Save report and Open the draft')
  it('Open the draft navigates in the same tab')
  it('Esc and backdrop do not close while importing; onBusyChange toggles')
  it('navigating away during an import asks inside the modal; confirm leaves, cancel stays')
  it('the registered factory returns refused() and refocuses while its question is open')
  it('the question is dismissed and unregistered when the import ends or the modal unmounts')
  it('Retry calls markPresent, then uploadAll with the same progress')
  it('a too-large build body shows Failed with Delete')
  it('a build that answers 404 shows Failed without Delete')
  it('Delete in the drafts list uses discard; a 409 keeps the draft and says so')
  it('beforeunload is prevented while importing')
  it('a failed config fetch shows the limits sentence')
  it('reader report lines are visible in the check state before Import')
  it('a timed-out build shows Check again while running, never Delete')
  it('upload retry shows Retry, which resumes from the first missing file')
  it('failed build offers Delete the unfinished draft and Keep')
  it('committed-unknown shows Done without Delete')
  it('Save report downloads a .txt with the report text')
  ```
  In `VersionsPage.slots.svelte.test.ts`, add "the Import from Open edX
  button opens the modal for course admins".

  In `VersionsPage.realNavigate.svelte.test.ts`, which uses the real router
  and its guard, add:
  - "during an import, an in-app navigation asks in the modal; Leave
    navigates, Cancel stays" (through the mounted page and its
    `DirtyGuard`);
  - "a second navigation while the question is open shows one question
    and refocuses Cancel; Cancel refuses both; Leave goes to the latest
    destination" (`DirtyGuard.svelte:38` shares the pending promise).

- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement the modal and the page wiring.** Then add the
  gate pins (RED first: run the gate, see the new checks fail, add the
  styles).

- [ ] **Step 4: Run `npm test && npm run check` and the gate.** Expected:
  green; gate ALL PASS with the new count.

- [ ] **Step 5: Commit:** `feat(olx): Open edX import modal on the Versions page`.

### Task 11: End-to-end run, browser pass and whole-branch review

**Spec sections:** "Goals", "Anti-goals", "Left to the builder › Test
fixtures" (the manual run).

**Files:** none in the product. Ledger lines in
`.superpowers/sdd/2026-11-18-olx-import/progress.md`.

**Interfaces:**
- Consumes: everything above.
- Produces: the ledger evidence.

- [ ] **Step 1: Start the dev servers:**
  - the backend `MATHION_DEBUG=1 MATHION_ASSET_PATH=$HOME/mathion-assets
    …/uvicorn mathion.main:app --port 8000`;
  - vite on `:5180`.

  Create a throwaway dev course with an admin (dev account).

- [ ] **Step 2: Import the synthetic fixture tar in Chrome** with
  agent-browser, at 1512px, picking `backend/tests/fixtures/olx/apps/sine-demo.js`
  as the app file. Check that:
  - the summary counts match `test_convert_fixture_summary`;
  - the draft's tree, a page image, a video, a quiz of each type and the
    Graasta app item work in the student preview;
  - the report lists every fixture skip.

- [ ] **Step 3: Import the owner's private sample** from the probe folder
  (the archive and the app files), in Chrome. Record:
  - the summary;
  - the check and build times, which must be well under 30 s;
  - the report's line counts per level.

  Do not quote any of its content in the ledger, the terminal or a commit.
  Spot-check, with the owner, 3 pages, 3 videos, 3 quizzes and 2 apps
  against Open edX.

- [ ] **Step 4: Failure paths in Chrome:**
  - stop the backend mid-upload, then Retry resumes;
  - make the build fail before it commits: delete a linked asset in a
    second tab between the upload and the build. The build answers 409
    (missing linked file), the modal shows Failed, and Delete works;
  - close the tab mid-import, then reopen the modal: the unfinished draft
    is listed and deletable.

- [ ] **Step 5: The owner's Safari and Firefox steps**, one at a time in the
  terminal. Check:
  - the file picker accepts `.tar.gz`;
  - `DecompressionStream` reads the sample;
  - the progress line, the Done state and Save report.

- [ ] **Step 6: Whole-branch review:** fresh Opus + Fable, then Codex over
  `main..HEAD`. Fix every Critical/Important finding, then re-review. Write
  the minors to the ledger and fix them before the beta (owner's beta
  gate).

- [ ] **Step 7: Cleanup:**
  - delete the throwaway dev course and drafts;
  - delete the probe copies made for the run;
  - stop the servers;
  - ask the owner about the merge.
