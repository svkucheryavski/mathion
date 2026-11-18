# Open edX course import — design (rev 6)

Rev 6 folds in the rev 5 delta check:
- a question's text excludes its solution and hints;
- unknown limits stop the import instead of being guessed;
- `//` and `http:` embed URLs become `https:`;
- small order and size rules.

Rev 5 folds in the rev 4 re-review:
- what a failed check does;
- the build checks only the files it needs;
- math is found before text is escaped;
- touching formulas are merged;
- whole numbers are pulled into formulas;
- formula errors are reported;
- embed-form video iframes are accepted;
- the browser learns the version limit;
- the body cap streams;
- a list of smaller details.

The math dependency is pinned to its rev 5.

Rev 4 folds in the spec review (Opus and Fable lanes) and two owner calls:
- **Numeric answers** are graded as strictly as Open edX: its default
  tolerance is 0.001% relative.
- **Checkbox questions** keep Mathion's partial credit, reported once.

Fixes:
- videos are stored in embed form (watch URLs refuse to load in an iframe);
- every link and image target is classified, so an unknown one no longer
  rolls back the build after the upload;
- the check validates what the build will validate;
- uploads retry and resume;
- an unfinished draft is labelled as such;
- the quiz structure, string-answer and slug rules are written down;
- Markdown escaping, the math edge cases, and the browser reader caps are
  specified.

No private sample content is quoted.

Rev 3: math in choices is typeset (the math typesetting feature ships first).
Rev 2 answered the builder check: the 8-block / 8-sequence caps stop an
import at the check (owner's call); tables become text (Claude's call,
reported).

## Intent

The owner teaches 6 courses on Open edX and wants to move them into Mathion
without rebuilding each one by hand.
- Open edX exports a course as a `.tar.gz` holding OLX: XML and HTML files
  plus a `static/` folder.
- Mathion should read that export and build a **draft course version** from
  the parts Mathion supports:
  - the structure: blocks, sequences, items;
  - items of three kinds (pages, videos and quizzes), plus their files.
- The owner's Graasta apps, which Open edX embeds as iframes, become Mathion
  **interactive app** items.

The feature is for any course admin, not only the owner: other Open edX
teachers on a Mathion site (the beta audience) should be able to bring their
courses too. Mathion exists to fix Open edX's pain points, so leaving Open edX
must be easy.

**Sample.** The owner's private export: 4 chapters, 11 sequentials, 167 units,
each with exactly one component (107 video, 33 html, 27 problem), and 95 MB of
static files.
- The probe copy lives in `.superpowers/sdd/2026-11-17-olx-import/probe/`
  (git-ignored).
- Its content is never committed or quoted.

## Goals

- A course admin imports an Open edX export into a new draft version of a
  course they administer, from the Versions page, in the same tab.
- Pages, videos, quizzes and Graasta apps come through with titles and order,
  and they work for students exactly like hand-made items.
- Files from `static/` come through, and links to them in pages work.
- The owner's single-file app builds (`<app-name>.js`), picked alongside the
  export, attach to their interactive app items automatically.
- Nothing is dropped silently: a report lists everything skipped or changed.
- It works within today's limits:
  - the bundled HTTPS proxy's 60 MB request cap and 30 s response-header
    timeout (`cli/internal/compose/docker-compose.yml`, `MAX_SIZE: "60M"`,
    `TIMEOUT_RESP_HEADER`);
  - the site's per-file limit (default 20 MB) and per-version file limit
    (default 500 MB).

## Non-goals

- Dates, grading, weights, certificates, enrollment, cohorts, discussions,
  the about/overview page, updates, handouts sidebar, wiki, tabs.
- Problem types Mathion has no equivalent for: formula, custom/Python-graded
  or scripted, regular-expression answers, drag-and-drop, image, ORA, LTI,
  polls, word clouds, ….
- Updating an existing version from a re-export (a re-import makes a new draft).
- Resuming an import after the tab was closed: the admin deletes the
  unfinished draft and imports again.
- Creating the course itself. The superuser still creates courses and assigns
  admins (superuser panel, Courses); the import fills a version.
- Open edX's own `.tar.gz` of a **library**, or a course **draft** export
  (`drafts/` is ignored).
- All-or-nothing grading for checkbox questions (owner: Mathion's partial
  credit applies).

## Anti-goals (a failure even if it "works")

- A half-imported course that looks complete. Any failure leaves a draft
  labelled unfinished, which the modal offers to delete, right away or the
  next time it opens.
- Silent loss: a skipped component, question, file or link that the report
  does not name.
- An import that passes the check and then fails in the build for a reason
  the check could have seen.
- Weakening security to make content fit: no iframes in pages, no loosening
  of the interactive app sandbox, no raised proxy or file limits.
- New Python or JavaScript dependencies (project rule).

## Approaches considered

1. **The browser opens the archive (chosen by the owner).**
   - The browser unpacks the export and uploads each file through the
     existing file upload, one request per file, each under the limits.
   - It sends only the course's XML/HTML text to the server, which converts
     it and builds the version.
   - This works under the 60 MB proxy cap with no setting changes. The cost
     is a small in-browser tar reader (gzip via the built-in
     `DecompressionStream`).
2. **Upload the whole archive to the server.** The code is simplest, but the
   95 MB sample is over the bundled proxy's 60 MB cap, so the cap would have
   to rise for every site. One long upload can also time out, with no resume.
3. **A server command (`mathion import-olx`).** No limits and no UI, but only
   the server operator can run it, from a terminal. A teacher on a hosted site
   could not import their own course.

## Design

### Flow (one modal, same tab)

On `frontend/src/pages/editor/VersionsPage.svelte` a course admin gets an
**Import from Open edX** action beside the existing new-version action. It
opens a modal (edits open modals, per the project rule) with four states.

1. **Pick.** One file input for the export (`.tar.gz`, `.tgz` or `.tar`), and
   one optional multi-file input for app files (`.js`). Nothing is sent yet.
2. **Check.**
   - The browser unpacks the export and POSTs the text bundle to the server's
     **check** call. The call converts and validates the bundle without
     writing anything, and returns the report plus the upload list.
   - The modal shows a summary ("4 blocks, 11 sequences, 167 items:
     107 videos, 11 pages, 22 apps, 27 quizzes; 20 files, 95 MB"), every
     report line, and **Import** and **Cancel**. The file count is the number
     the progress line will count to.
   - Problems that stop an import show here and disable Import:
     - no `course.xml`;
     - more than 8 blocks, or more than 8 sequences in a block;
     - over the version file limit;
     - a linked file or a used app file over the per-file limit;
     - a text bundle over its caps.
3. **Import**, in order:
   1. **Create the draft version** with the existing
      `POST /api/courses/{id}/versions`.
      - Label: `Open edX (unfinished): <course display_name>`.
      - `max_quiz_attempts` comes from the export; `info_md` is empty.
   2. **Upload every file** through the existing
      `POST /api/versions/{vid}/assets`, under the target name the check
      returned, one at a time with a progress line
      ("Uploading files: 7 of 20").
      - Each file is tried up to 3 times.
      - A 409 (the name already exists) counts as done.
      - If a file still fails, the modal shows **Retry**. Retry first reads
        `GET /api/versions/{vid}/assets` and resumes from the first file not
        yet there.
   3. **POST the same text bundle to the server's build call**, which creates
      all content in one transaction and sets the final label
      `Open edX: <course display_name> (<YYYY-MM-DD>)`, cut to the label
      limit (200).
4. **Done or failed.**
   - **Done:** the report, a **Save report** button (downloads a `.txt`), and
     **Open the draft** (goes to the version editor in the same tab).
   - **Failed:** what failed, then **Delete the unfinished draft** (existing
     `DELETE /api/versions/{vid}`) or **Keep it**. Keep says the import cannot
     be resumed.
   - **Build failed with a network error or timeout:** before offering
     Delete, the modal re-reads the version. If it now has blocks, the build
     committed: the modal shows Done, says the report could not be loaded,
     and offers no Delete.

While an import runs, the modal cannot be closed by Esc or backdrop, and
leaving the page asks for confirmation (the existing dirty guard on
`VersionsPage`, plus `Modal`'s `closeDisabled`). A tab closed mid-import
leaves a draft whose label says "unfinished".

### Reading the archive in the browser (`frontend/src/lib/olx/`)

- **Gzip** is detected by magic bytes (`1f 8b`) and read with
  `DecompressionStream('gzip')`. A plain `.tar` is read as is.
- **Mathion's own small tar reader** handles:
  - 512-byte headers;
  - the ustar `prefix` field;
  - GNU long names (`././@LongLink`);
  - pax `path` and `size` records;
  - base-256 sizes.

  It skips directories, links and other non-regular entries.
- **Limits the browser knows.** `/api/auth/config` gains `max_total_mb` (the
  existing site setting's name) next to `max_file_mb`.
  - The modal re-reads the config when it opens.
  - If the read fails, or a limit is missing, the modal stops with "Could
    not read the site's file limits. Try again." It never guesses, so the
    browser and the server always plan with the same limits.
- **Caps**, so a crafted archive cannot exhaust the tab:
  - **Kept files:** only files that will be uploaded count toward the version
    limit. Reading stops with a plain message when they pass it.
  - **Not buffered:** files of a disallowed type and entries over the
    per-file limit are skipped without being buffered, and reported. An
    over-limit file blocks if a page links to it.
  - **Gzip-bomb guard:** a separate cap of 5 GB total decompressed bytes
    stops reading.
- **Course root:** the folder holding the shallowest `course.xml`.
  - Paths are normalised: `\` → `/`, no leading `/`.
  - Any `..` segment rejects the entry.
- **Text bundle:** every `.xml`, `.html` and `policies/**/*.json` under the
  root, except `static/`, `drafts/`, `about/`, `info/`, `assets/` and
  `tabs/`.
  - Caps: 20 MB of text and 20 000 entries.
  - The browser also measures the JSON-encoded request; over 40 MB the check
    stops with a plain message.
- **Files:** every regular file under `static/` is kept as a `Blob`, so the
  archive is never held twice.
  - Zero-byte files, and files up to 64 bytes that hold only whitespace (the
    upload route refuses both), are skipped and reported.
  - App files come from the second input.
- No file content is executed or rendered while reading.

### The server calls (`backend/mathion/olx/`, new package; routes in `backend/mathion/api/olx_import.py`)

- **`POST /api/courses/{course_id}/olx-import/check`**
  - Body: `{files: {path: text}, static: [{path, size}], apps: [{name, size}]}`.
  - Course admin only.
  - Returns `{summary, report: [...], uploads: [{source, target, kind:
    "static"|"app"}], max_quiz_attempts, label, blocking: bool}`.
  - Writes nothing.
  - **When something fails:**
    - A malformed or missing component or unit (bad XML, a missing pointer
      file) is skipped and reported.
    - A broken `course.xml`, chapter or sequential blocks the import, with
      its location.
    - An empty `display_name` gets a fallback ("Untitled chapter N" and so
      on), reported.
    - An import with nothing left to import blocks.
    - Any other validation failure blocks, with its location.
  - Besides converting, it runs every check the build will run that needs
    no database:
    - every Markdown string renders;
    - every formula goes through `latex_to_mathml`; a formula it cannot
      typeset (`\begin{align}`, `\color`) is reported with its location, and
      stays in the content as the math feature's marked error;
    - every asset name it references is in the planned upload list;
    - every title, slug, text, option and number fits its column. The import
      uses its own slug fallback (`block-N`, …), so it follows the columns,
      not the editors' title rules.
- **`POST /api/versions/{version_id}/olx-import/build`**
  - The same body.
  - Course admin of the version's course.
  - It locks the version row (`SELECT … FOR UPDATE`) and requires
    `state == "created"`, not disabled (403, as in the other version routes),
    and no blocks yet (409 otherwise). A double submit therefore cannot
    duplicate content.
  - It re-runs the same conversion and checks that every **linked** target
    file and every used app file now exists in the version; those block. Any
    other planned file that is missing (an unlinked file refused during
    upload) is reported, not blocking.
  - The browser sends its own report lines with the build request: reader
    skips, upload refusals and `scanAppSource` warnings. The final report
    merges them, sorted by location.
  - It then creates blocks, sequences, items, questions and options in one
    transaction, sets the final label, and attaches app scripts (`Item.script_url`
    plus `sync_script_reference`).
  - It returns the final report.
  - Any error rolls back the whole build; the uploaded files stay in the
    draft until the admin deletes it.
- **Both calls answer within the proxy's 30 s.** The sample-sized course must
  build well under that; the plan measures it.
- **One pure converter is shared:** `convert(bundle) -> Plan` (no DB), then
  `apply(plan, version, db)`.
  - The check call returns the plan's report; the build call applies it.
  - Content goes through the same rendering and validation the editors use
    (`render_with_assets`, `sync_asset_references`, item/question limits), so
    an imported item is indistinguishable from one made by hand.
  - Answer options get their `text_html` through the math feature's single
    setter.
- **Body cap.** The backend has no request-size cap today. These two routes
  get one. The routes declare **no** Pydantic body parameter: FastAPI would
  read the whole body before any dependency ran. They validate the
  dependency's bytes with `model_validate_json`.
  - An async dependency first refuses a `Content-Length` over 45 MB (413).
  - It then reads the body stream, counting against 45 MB, and hands the
    bytes on.
  - The route itself stays a sync `def`, which parses the JSON and converts
    in the thread pool, so a 20 MB conversion never blocks the event loop.

  45 MB is above the browser's 40 MB stop and below the proxy's 60 MB. The
  40 MB stop is measured in UTF-8 bytes for both the check and the build
  request, since the build adds the browser's report lines.
- **XML safety:**
  - Only the standard library `xml.etree.ElementTree` is used.
  - Before parsing, any `.xml` file containing `<!DOCTYPE` or `<!ENTITY` is
    rejected (OLX never uses them), which rules out entity expansion and
    external entities.
  - An `.html` file may start with `<!DOCTYPE html>`, which is ignored;
    `<!ENTITY` in it is rejected.
- **Tree walks:**
  - depth is capped at 20;
  - `url_name` pointers keep a visited set, so a vertical inside a vertical,
    a cycle or a `split_test` cannot loop or recurse without bound;
  - a depth or cycle hit skips that node, reported.
- **HTML** is parsed with the standard library `html.parser` into a small
  tree; no third-party parser.
- **Pointer vs inline.** An element with a `url_name` and no children and no
  other attributes than `url_name` is a pointer: it is loaded from
  `<tag>/<url_name>.xml`. Otherwise it is inline. An `html` component's
  `filename` attribute loads `html/<filename>.html`.

### Mapping

| Open edX | Mathion | Notes |
|---|---|---|
| course (`course.xml` → `course/<run>.xml`) | the new version | `display_name` goes into the version label; nothing else on the course is changed |
| chapter | Block | Title = `display_name`; slug rules below. Max 8 per version (`MAX_BLOCKS`, `backend/mathion/api/blocks.py`): more stops the import at check, naming the chapters past the 8th (owner's call: teachers restructure in Studio and re-export) |
| sequential | Sequence | Title = `display_name`; `format`, `graded` and dates are ignored. Max 8 per block (`MAX_SEQUENCES`): more stops the import at check, naming the chapter. The caps count only chapters and subsections left after skipping; staff-only and empty ones don't count. `apply()` writes rows directly, so it enforces both caps itself |
| vertical (unit) | one Item per supported component, in order | See titles below. A unit with no supported component is reported ("empty unit") |
| `video` | video item | `youtube_id_1_0`, checked against `^[A-Za-z0-9_-]{11}$`, → `https://www.youtube.com/embed/<id>`; the start time becomes `?start=<seconds>`. Otherwise the first `html5_sources` URL that the YouTube or Vimeo branch of `normalizeVideoUrl` turns into an embed URL; those branches are ported to Python, and a test pins the Python output to the TS function's on shared cases. Otherwise skipped and reported. End times, transcripts and download settings are dropped and reported once per course |
| `html` that is only an iframe to `https://graasta.com/apps/<name>/` | interactive app item | App file `<name>.js` from the picked app files. If it is missing, the item is still made, empty, and reported with its Graasta address |
| `html` that is only a YouTube or Vimeo iframe | video item | A URL already in embed form (`www.youtube.com/embed/<id>`, `www.youtube-nocookie.com/embed/<id>`, `player.vimeo.com/video/<id>`) is kept, with a protocol-relative `//…` or an `http:` scheme turned into `https:` and the scheme lowercased. Any other YouTube or Vimeo URL goes through the same embed rule |
| any other `html` | page (`static_page`) | HTML → Markdown, below. A page that comes out empty is skipped and reported |
| `problem` | quiz item | Questions below. A problem with no supported question is skipped and reported |
| anything else (`discussion`, `lti`, `openassessment`, `drag-and-drop-v2`, `library_content`, `split_test`, `conditional`, `poll`, `word_cloud`, …) | — | Skipped and reported with the unit title |
| `visible_to_staff_only="true"` on any level | — | That node and its children are skipped and reported |
| a sequence or block left with no items after skipping | — | Not created, reported (publishing refuses empty ones) |

**Item titles.**
- A unit with one supported component uses the unit's `display_name`. The
  unit name is the one students saw in the course outline; component names
  are often generic ("Video", "Quiz").
- A unit with several components uses each component's own `display_name`,
  falling back to `<unit name> (2)`, `(3)`, ….
- Titles are cut to the item limit (200).

**Slugs** (blocks, sequences, items):
- made from the title with the existing `slugify` (`text_utils.py`);
- cut at a dash to at most 76 characters, which leaves room for a `-NN`
  suffix within the 80-character columns;
- if empty (a title with no Latin letters or digits), `block-N`,
  `sequence-N` or `item-N` instead;
- made unique within their parent by `-2`, `-3`, ….

**Graasta detection** is exact.
- The page's only meaningful content is one `<iframe>` whose `src` matches
  `^https://graasta\.com/apps/([a-z0-9-]+)/?$`. Fallback text inside the
  iframe element is ignored.
- An iframe to any other site (except the YouTube/Vimeo row above), or an
  iframe inside other content, stays in a page as a plain link
  (`[<iframe title or host>](<src>)`) and is reported.

**App file matching.**
- App file names and Graasta names are both compared in `sanitize_filename`
  form, without `.js`.
- The target asset name is `sanitize_filename(<name>.js)`. An app file takes
  its name before any static file; a static file that would clash gets the
  next free suffix.
- Picked app files that no page uses are reported and not uploaded.
- Each app file is run through the existing `scanAppSource` check before
  upload. Its warnings go into the report; they do not block, as in the
  editor today.

### HTML → Markdown (pages and quiz text)

- **Converted:** `p`, `br`, `h1`–`h6`, `strong`/`b`, `em`/`i`, `a`,
  `ul`/`ol`/`li` (nested), `code`, `pre`, `blockquote`, `img`, `hr`.
- **Tables:** a `table` becomes its text, one paragraph per row, with cells
  joined by " · ". This is reported.
  - Mathion's Markdown (`backend/mathion/markdown.py`, commonmark preset)
    does not render tables.
  - Turning tables on for all content is a separate decision.
- **Unwrapped:** `div`, `span`, `section`.
- **Superscripts and subscripts:**
  - `<sup>`/`<sub>` holding digits and signs become a formula script, so `R²`
    keeps its meaning: `R<sup>2</sup>` → `R$^{2}$`.
  - Holding other text, they become `$^{\text{…}}$` / `$_{\text{…}}$`.
  - Digits directly before the formula are pulled into it (see math below).
  - Reported once per course.
- **Dropped with their content:** `script` and `style`, reported once per
  page.
- **Any other tag:** its text is kept and the tag name is reported once per
  page.
- **Order: math first.**
  1. Formula delimiters are found over the joined inline text of each block,
     before any escaping. Text inside `code` and `pre` is left out, as
     MathJax does.
  2. Formula bodies are written verbatim: no Markdown escaping and no entity
     re-encoding inside them. The one exception is a bare `$`, which is
     written `\$` so it does not end the formula.
  3. Then only the text between formulas is escaped.
- **Text escaping:**
  - Whitespace outside `pre` is collapsed, so no line ever starts with four
    spaces (which would make a code block).
  - In text nodes, ``\ ` * _ [ ] < > !`` are backslash-escaped everywhere,
    and `#`, `>`, `+`, `-`, `=`, `|` and `N.`/`N)` at the start of a line.
  - Also escaped: `&` (so text never reads as an entity), and a leading
    `~~~` (a fence).
  - `<br>` becomes a hard break (backslash, newline).
  - Nothing is escaped inside code spans or `pre`. Their fences are longer
    than any run of backticks inside.
  - Character entities are decoded once, by the HTML parser.
  - Escaped brackets and code never count as links. The math feature's
    token-based `extract_asset_filenames` guarantees this, and a test pins
    `\[a\](b)` and `` `[x](y)` ``.
- **Links and images.** Every `href`/`src` is classified:
  - `http:`, `https:` and `mailto:` links stay. `#…` anchors become their
    text.
  - **Static files.** These forms are static links:
    - `/static/<path>`, `../static/<path>` and `static/<path>`;
    - `/c4x/<org>/<course>/asset/<name>`;
    - `asset-v1:…+type@asset+block@<name>`, with or without a leading `/`;
    - `/assets/courseware/…/<name>`.

    The path is percent-decoded and `?…`/`#…` is stripped. It is then
    matched, relative to `static/`, against the source path of an uploaded
    file. A match becomes that file's **target name** from the check, so
    subfolders and `-2` suffixes resolve exactly.
  - Anything else (no match, a disallowed file type, `data:`, `tel:`,
    `javascript:`, a relative `page.html`, a bare `www.…`, and root-relative
    Open edX links such as `/jump_to_id/…` or `/courses/…`) keeps its text,
    loses the link, and is reported. An image becomes its alt text.
  - `target` attributes are dropped (Mathion's own external-link rule
    applies).
- **Math** (pages, question text, explanations, choices):
  - `\(…\)` and `[mathjaxinline]…[/mathjaxinline]` → `$…$`.
  - `\[…\]` and `[mathjax]…[/mathjax]` → `$$…$$`. In the middle of a
    paragraph this is display math, which the math feature renders correctly.
  - The math inside is trimmed (`\( x \)` → `$x$`), because Mathion's dollar
    rule needs no space just inside the `$`. An empty formula is dropped.
  - For **inline** formulas only, a whole number touching a formula on either
    side is moved inside it, as matched by `\d+([.,]\d+)*`. So
    `95\(\%\)` → `$95\%$`, and `0.05\(x\)` → `$0.05x$`. Mathion's dollar
    rule refuses a digit next to `$`; `$$` has no digit test.
  - Touching inline formulas are merged into one: `\(a\)\(b\)` → `$a{}b$`.
    The same applies to a formula and a sup/sub script, so
    `\(x\)<sup>2</sup>` → `$x^{2}$`. Rev 5 of the math feature never reads a
    `$` next to another `$` as a single-dollar delimiter, so `$a$$b$` would
    stay raw.
  - An inline formula touching a display formula gets a space between them.
  - Numbers are pulled first and touching formulas merged after, repeated
    until nothing changes, so `\(a\)2\(b\)` comes out as one formula.
  - A literal `$` in **text** (outside math and code) is written `\$`, so
    prices stay text. Inside math, `\$` stays as written; inside code, `$`
    stays.

### Quizzes

An OLX `problem` holds one or more questions. Each response element starts a
question.
- **Question text** is HTML → Markdown of all text since the previous
  response, plus the response's own text children (`label`, `description`,
  `p`). Studio templates put them inside the response; older exports, like
  the sample, put them before it as siblings.
- **The explanation** is the `<solution>` inside the response or right after
  it, minus a leading paragraph that says only "Explanation".
- A question whose text comes out empty is skipped and reported.

| Response | Mathion question |
|---|---|
| `multiplechoiceresponse` | single choice; if several choices are correct, multiple choice, reported |
| `optionresponse` (dropdown, including the old `optioninput options="('a','b')"` form) | single choice |
| `choiceresponse` (checkboxes) | multiple choice; Mathion's partial credit applies (owner's call), reported once per course |
| `numericalresponse` | numeric answer |
| `stringresponse` | text answer: the first `answer`; dropped `additional_answer`s are reported; `type="regexp"` is skipped; a case-sensitive answer (no `ci` in `type`) is reported once per course, because Mathion ignores case |
| any other, or any problem with a `<script>` (`loncapa/python`), whose answers depend on code | skipped, reported |

- **Choices** are the visible text of each `<choice>`/`<option>`, as plain
  text with math. In choices, only `$` and a `\` before punctuation are
  escaped, so the editor's option input shows no stray backslashes.
  - Formatting such as `<code>` is lost, reported once per quiz.
  - `choicehint`s and feedback are dropped, reported once per quiz.
  - **The question is skipped and reported if:**
    - a choice comes out empty (for example an image-only choice);
    - a choice is longer than the option limit (500);
    - it has fewer than 2 choices;
    - no choice is correct.
  - Math in a choice is converted like page math and typeset by the math
    feature (`docs/superpowers/specs/2026-11-18-math-typesetting-design.md`),
    which ships before this import.
- **Numeric answers** (owner's call: as strict as Open edX). Mathion accepts
  `correct ± 5×10^-(p+1)` for precision `p`, capped at 10; students never
  see `p`.
  - **No tolerance given.** Open edX's default applies: 0.001% relative.
    `p` = the smallest `p` with `5×10^-(p+1) ≤ 0.00001 × |answer|`. So `80`
    → p = 3 (accepts 79.9995–80.0005). An answer of 0 takes p = 10.
  - **Absolute tolerance `t`:** `p` = the smallest `p` with
    `5×10^-(p+1) ≤ t`.
  - **Percentage tolerance:** turned into an absolute one on the answer
    first.
  - **Range `[a, b]` or `(a, b)`:** correct = the midpoint, and `p` = the
    smallest with `5×10^-(p+1) ≤ (b−a)/2`, reported as "range narrowed to …".
    For example `[0.026, 0.029]` → 0.0275 with p = 3 (accepts 0.0270–0.0280).
  - **If even p = 10 is wider than the Open edX tolerance,** it is reported
    as "tolerance widened".
  - **Scientific notation** (`1.5e-3`) is read as a number.
  - **Skipped and reported:**
    - an answer that is not a number (an expression, a `$variable`);
    - an answer of magnitude 10¹⁰ or more;
    - an answer with more than 10 decimals. (`correct_numeric` is
      `Numeric(20,10)`.)
- **Attempts:**
  - `max_attempts` from the course policy (`policies/<run>/policy.json`, or
    the course XML) sets the version's `max_quiz_attempts`, clamped to
    1–10.
  - Empty or unlimited → 10, reported.
  - A problem's own `max_attempts` that differs is reported; Mathion has one
    value per version.
- **Dropped:** `weight`, `showanswer`, `rerandomize`, `shuffle`. Shuffle and
  showanswer are reported once per course.

### Files

- **Uploaded:** every file under `static/` with an extension Mathion allows
  (`ALLOWED_EXTENSIONS`).
  - Other files are reported and skipped. A page link to such a file loses
    its link, reported (intended: the allow-list is the site's rule).
  - Upload names are `sanitize_filename` of the file's base name (uppercase
    `.R` → `.r`).
  - Files that end up with the same name get `-2`, `-3`, … before the
    extension, looping until the name is free. The check decides this, so
    links point at the right one.
- **Unlinked files** are still uploaded, since an author may link them later.
  The report lists them as "not linked from any page".
- **Limits.** The check blocks the import when:
  - the total would exceed the version limit;
  - a linked file or a used app file is over the per-file limit.

  An unlinked over-limit file is skipped and reported, without blocking.
- **Upload errors.** A 4xx refusal of an unlinked file during upload becomes
  a report line, not a failed import.
- `course_image` and other policy-referenced files are not treated specially.

### The report

- A flat list of lines, each
  `{level: "skipped" | "changed" | "note", where: "<block> › <sequence> › <unit>", text}`.
- Lines are grouped by level, in the modal and in the saved `.txt`.
- Repeated causes are reported once per course with a count ("Video end
  times dropped: 14 videos").
- Every "skipped" line says what to do by hand where there is something to
  do: "add this question in the quiz editor", or "upload the file and
  re-link it".

## Smaller details (rev 5)

- **Video:**
  - `start_time` (`HH:MM:SS`) becomes seconds, and a zero start is omitted.
  - YouTube takes `?start=N` on every path; Vimeo takes `#t=Ns`.
  - The cases the TS and Python video tests share live in one fixture file,
    `frontend/src/lib/videoUrlCases.json`, read by both suites.
- **Static links:**
  - In the `/c4x/` and `asset-v1:` forms, Open edX writes a subfolder `/` as
    `_`, so those are matched against the source path with `/` → `_`.
  - Link schemes are compared in lowercase (`HTTPS://` is a web link).
- **Numeric answers:**
  - "tolerance narrowed" is reported when even p = 0 is far tighter than
    the Open edX tolerance (t > 0.5);
  - an answer of 0 is never reported as widened;
  - trailing zeros are normalised before the 10-decimal test;
  - a range midpoint is rounded to p + 1 decimals.
- **Quizzes:**
  - A question's text takes the response's children except:
    - the inputs;
    - `solution`, which becomes the explanation;
    - the hint elements: `correcthint`, `choicehint`, `stringequalhint`,
      `optionhint`, `hintgroup`, `demandhint`;
    - `additional_answer` and `responseparam`.

    The previous response's `solution` is never part of it.
  - Text after the last response is appended to the last question's
    explanation, reported.
  - `demandhint` is dropped, reported once per quiz.
- **Uploads:**
  - Only network errors, 5xx and 429 are retried.
  - Resume skips files already refused with a 4xx.
  - A 409 counts as done only when the listed size matches. Otherwise the
    file counts as failed and shows Retry.
  - The build does not repeat a report line for a file the browser already
    reported.
  - Whitespace-only files under 1 MB are skipped, as the server's
    `bytes.strip()` refuses them; the browser reads only those. A larger one
    gets the server's 400 and is handled as an upload refusal.
  - Names with `-N` suffixes stay within 255 characters.
  - Static files are processed sorted by path, so suffixes are stable.
- **Labels:**
  - Both labels cut the course name, never the date, to fit 200.
  - The date is the browser's local date.
  - The import modal, when opened, lists the course's drafts whose label
    starts with `Open edX (unfinished):`, each with a Delete button. This
    is how an abandoned tab's draft is offered for deletion.
- **Item titles:** the base title is cut, never its `(2)` suffix.
- **Encoding:** a text file that is not valid UTF-8 is skipped and reported.

## Constraints

- No new Python or JS dependencies; Svelte 5; component tests use
  `mount`/`unmount`/`flushSync`.
- Same tab, modal edits; dense UI tokens; the visual-refresh CSS gate stays
  green (new modal styles pinned like other modals).
- Course admin permission everywhere; no superuser-only path.
- Existing limits apply unchanged (per-file, per-version, proxy 60 MB and
  30 s).
- Imported content goes through the same validation and rendering as
  hand-made content.
- The math typesetting feature (design rev 5) is merged first. It provides
  `AnswerOption.text_html`, its setter, `latex_to_mathml`, token-based
  `extract_asset_filenames`, and the dollar rule this converter writes for.

## Left to the builder

- Exact modal copy and layout, within the existing modal and form styles.
- Module boundaries inside `backend/mathion/olx/` and `frontend/src/lib/olx/`.
- Whether the build call takes the bundle again or the check call returns a
  token. Re-sending the bundle is the default.
- **Test fixtures:**
  - a small synthetic course written for the tests, shaped like the sample:
    a few units of each kind, both quiz layouts (sibling and inside the
    response), and one tiny static file in a subfolder;
  - it lives under `backend/tests/fixtures/olx/`, with a tar built from it
    for the frontend reader tests;
  - nothing from the owner's courses is committed;
  - the full sample is used only for a manual end-to-end run from the probe
    folder, which also measures the build time against the 30 s limit.
