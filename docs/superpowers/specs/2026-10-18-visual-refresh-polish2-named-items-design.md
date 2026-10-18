# Visual refresh — Polish 2: named items

**Status:** rev 1 (2026-10-18), in review.
**Branch:** `feat/visual-refresh-polish2-named-items`, cut from the Polish 1 tip `ba8ace4`. It stays local: no push, no merge.
**Workspace:** `.superpowers/sdd/2026-10-17-visual-refresh-polish2-named-items/` (`decisions.md`, the mock-ups `page-ground-mock.html` and `content-scale-mock.html`).

## Goal

Earlier slices deferred six named items "to the end". Polish 2 closes them:
- a keyboard focus ring people can see, also in High Contrast;
- reduced motion;
- a page ground that reads as depth;
- one style for the content teachers write;
- a styled 404 page;
- clickable bare URLs.

Polish 1 (confirms) is done. Polish 3 (triage of the reviewers' minors) follows.

## Scope

**In:**
- the focus ring and reduced motion (D48, D49);
- the page ground (D50);
- authored content at two scales (D51, D52);
- the 404 page (D53);
- bare URLs linkified (D54, D55).

**Not in** (Polish 3 candidates; the Polish 1 backlog lists them):
- the error banners' `--status-rejected-*` pinks beside the danger panel;
- the VersionsPage create form's silent discard on Cancel and links;
- the reviewers' minors from every slice;
- the existing per-component forced-colors rules, which stay even where the new global rule makes them redundant.

## Decisions

All of these are the user's, made in the brainstorm on 2026-10-17 and 2026-10-18.

- **D48 — Focus ring: a ring on controls, and fields keep theirs.**
  - Buttons, links, icon buttons, cards, accordion headers and the strip icons show `outline: 2px solid var(--primary); outline-offset: 2px`. This is the Polish 1 confirm ring.
  - Text fields (`input`, `textarea`, `select`) keep today's look: a `--primary` border with the soft halo.
  - In High Contrast (`forced-colors: active`) every `:focus-visible` gets an outline.
  - This is a deliberate departure from the design handoff (`docs/design/visual-refresh/base.css:132`), whose halo measures 1.16:1 against `--surface`.
- **D49 — Reduced motion: the knob jumps and the spinners keep turning.**
  - Under `prefers-reduced-motion: reduce`, the Switch knob moves without its 0.12s slide.
  - The four spinners (Button, InlineConfirm, DangerConfirm, Spinner) keep rotating. They are the only sign that something is busy, which is essential motion.
- **D50 — The page ground is a clear tint, `#F2F3F6`.** The user chose it from a three-way mock-up (`page-ground-mock.html`).
  - Every page shares the editor's existing `--focus-page` shade.
  - White cards and the white header read as steps above it.
  - Whether the student player's reading column needs a white sheet is checked in the Safari pass (user: "check it in the browser pass").
- **D51 — One shared style for authored content, on every surface.**
  - It applies wherever teachers write markdown: page content, quiz prompts, explanations, course and version info, mini-project assignments, and the editor's preview and question cards.
  - Smaller surfaces use a compact scale.
- **D52 — The build is one global stylesheet plus a class.**
  - `styles/content.css` defines `.md` (the page scale) and `.md.compact`.
  - Each surface keeps its own element, binding and attachments, and adds the class.
  - The scattered per-surface `:global` content rules go.
- **D53 — The 404 page uses ErrorState, and its button names the place.**
  - The card reads "Page not found" with one line and one secondary button.
  - The button reads "Back to courses" or "Back to teaching", whichever is the person's start page. Signed out, it reads "Sign in".
- **D54 — Linkify only full URLs.**
  - Text starting with `http://` or `https://` becomes a link, and so does `www.` (see §Bare URLs).
  - Bare domains (`example.org`), file-like names (`numpy.py`) and e-mail addresses stay plain text.
- **D55 — Stored HTML changes only on the next save.**
  - Existing content gets links when it is next edited, published or cloned.
  - There is no backfill or migration, because no real courses exist yet (pre-beta).

## Focus ring and reduced motion (Task 1)

### The global rule
- **Today.** `base.css:22-26` is the only focus indicator for most controls: `:focus-visible { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }`.
  - The ring (`#EAEFF4`) measures 1.16:1 against `--surface`.
  - Forced-colors mode drops `box-shadow` and keeps `outline: none`, so these controls show no indicator at all (backlog `global-focus-ring-invisible-in-forced-colors.md`).
- **New rules.** In `base.css` they replace the old one, in this order:
  ```css
  :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  :is(input, textarea, select):focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  @media (forced-colors: active) {
    :focus-visible { outline: 2px solid Highlight !important; }
  }
  ```
- **Why `!important`.** About 18 components set `outline: none` in their own scoped `:focus-visible` rules: the inline inputs, the run tabs' fields, the modal inputs and others. A scoped rule beats a global one, so without `!important` those controls would stay invisible in High Contrast.
  - The forced-colors rule sets only `outline` (width, style, colour), never `outline-offset`. Components that draw an inset ring with a negative offset keep it.
  - The 21 existing per-component forced-colors rules become redundant. They stay, out of scope.
- **Components with their own ring keep it.** 28 files author `:focus-visible`. These include:
  - the inset `--primary` rings: SequenceLink, MiniProjectLink, Login, the four quiz question components, ItemMark and ItemTypePicker;
  - the Polish 1 confirm buttons (InlineConfirm, DangerConfirm);
  - Button `.secondary` (D44);
  - the text-field rules (InlineInput and others).

  A scoped rule wins over the global one, so nothing changes for them in normal mode.
- **Button's halo.** Button `.primary` and `.ghost` have no own focus rule. They now take the global ring, which retires the Polish 1 spec's note that they keep the halo "until Polish 2" (`2026-10-14-…-polish1-confirms-design.md:203`).
- **The tight places.** These are checked in the Safari pass:
  - the 22px `ItemIcon` squares in the sequence strip: a 2px ring at a 2px offset on a wrapped line must not touch the neighbouring icon;
  - IconButton `primary` (filled), whose ring sits off the fill.

### Reduced motion
- `Switch.svelte` gets: `@media (prefers-reduced-motion: reduce) { .knob { transition: none; } }`.
- No other rule changes. Nothing in the app scrolls smoothly.

### Gate
- **The (b4) hashless freeze** (`visual-refresh-gate.sh:524-…`) re-pins `:focus-visible` and records two new rows: the `:is(input, textarea, select):focus-visible` rule and the `@media (forced-colors: active)` rule. The comment block explains the change, as it has for every earlier move.
- **Switch:** one row for the reduced-motion rule.
- **Polish 1's rows** that assert the halo on primary and ghost Buttons, if any exist, are updated to the ring.

## The page ground (Task 2)

- **Tokens** (`theme-default.css`):
  - `--bg: #F2F3F6`, was `#FBFBFC`.
  - `--focus-page: var(--bg)`. It is kept so the 5c focus-by-depth names still read.
  - `--disabled-bg: #FBFBFC` is new and holds today's disabled fill.
  - `--surface-3` keeps `#FCFCFD`. Its comment becomes "a near-white tint inside a white surface". Every use is inside a white surface, never on the page ground:
    - the modal foot (`Modal.svelte:251`);
    - the CourseCard footer;
    - SubmissionCards;
    - AssetSidebar;
    - the App and Video bodies;
    - the mini-project file rows.
- **Disabled fills move to `--disabled-bg`.** Otherwise disabled controls would darken and blend into the ground:
  - `Button.svelte:70`, `:78`;
  - `IconButton.svelte:213`, `:220`;
  - `InlineConfirm.svelte:149` (`.cancel[aria-disabled="true"]`);
  - `DangerConfirm.svelte:156`;
  - `QuestionTypePicker.svelte:48`;
  - `MiniProjectDetailPage.svelte:695`.
- **The Toast** (`Toast.svelte:19`) uses `--bg` as its text colour and switches to `--surface`, `#FFFFFF`. The difference is not visible.
- **Two rules become redundant and go:**
  - `VersionsPage.svelte:384`: `:global(body):has(.page) { background: var(--focus-page); }`;
  - `VersionEditPage.svelte:800`: `:global(body):has(.canvas.d0) { background: var(--focus-page); }`.

  Their gate rows and `:global` allow-list entries go too. The VersionEditPage comment at `:763` keeps its meaning.
- **Contrast.** `--muted` `#5A616E` on `#F2F3F6` is about 5.6:1, and body text is far higher. `--ordinal` is decorative by design.
- **Gate.** The (b4) `:root` hash moves once more, with the usual note in the comment: `--bg` changed, `--focus-page` aliased, `--disabled-bg` added, the `--surface-3` comment changed. Rows pin:
  - `--disabled-bg` in each of the eight recipes;
  - the Toast colour;
  - the absence of the two `body:has` rules.

## Authored content (Tasks 3 and 4)

### `styles/content.css`
- **The file.** A new global stylesheet, imported in `app.css` after `base.css`. Each surface keeps its own `font-size`, `line-height` and `color`. The file sets only structure. Every rule is scoped under `.md`, and there are no bare element rules.
  ```css
  .md { overflow-wrap: anywhere; }
  .md > * { margin: 0; }
  .md :is(h1, h2, h3, h4, h5, h6) { font-weight: 600; color: var(--text); }
  .md h1 { font-size: 1.5em; letter-spacing: -.015em; }
  .md h2 { font-size: 1.15em; }
  .md h3 { font-size: 1em; }
  .md h4 { font-size: 1em; color: var(--text-3); }
  .md h5 { font-size: .93em; color: var(--muted); }
  .md h6 { font-size: .86em; color: var(--muted); letter-spacing: .02em; }
  .md.compact h1 { font-size: 1.15em; }
  .md.compact h2 { font-size: 1.05em; }
  /* Spacing: :where() keeps every spacing rule at (0,1,0) or (0,2,0), so the
     source order below decides, and the first/last-child rules come last. */
  .md :where(p, ul, ol, pre, blockquote) { margin-bottom: var(--space-3); }
  .md :where(h1, h2, h3) { margin: var(--space-4) 0 var(--space-2); }
  .md :where(h4, h5, h6) { margin: var(--space-3) 0 var(--space-1); }
  .md.compact :where(p, ul, ol, pre, blockquote) { margin-bottom: var(--space-2); }
  .md.compact :where(h1, h2, h3, h4, h5, h6) { margin: .75rem 0 var(--space-1); }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md :where(ul, ol) { padding-left: var(--space-4); }
  .md ul > li { list-style: disc; }
  .md ol > li { list-style: decimal; }
  .md blockquote { border-left: 3px solid var(--border-strong); padding: 2px 0 2px 12px; color: var(--text-3); }
  .md code { background: var(--surface-2); padding: 2px 4px; border-radius: var(--radius); font-family: var(--font-mono); }
  .md pre { background: var(--surface-2); padding: var(--control-pad-textarea); border-radius: var(--radius); overflow-x: auto; max-width: 100%; }
  .md pre code { padding: 0; background: none; }
  .md a { color: var(--primary); }
  .md img { max-width: 100%; height: auto; }
  ```
- **What the scale does.** On the 14px page, h1–h3 come out at today's 21/16/14px (`PageItem.svelte:82-85`). h6 at 0.86em of 14px is 12px, so no heading falls below 12px on any surface.
- **Math.** Math wrappers (`span.math`, `div.math`) keep their own rules. `.md > *` zeroes margins only on direct children.
- **The `:first-child` / `:last-child` rules** replace the per-surface `p:last-child { margin: 0 }` rules. They come after the scale rules at equal specificity, so a prompt that opens with a heading has no top margin on either scale (a gate row pins that the first/last-child rules come after the compact rules).

### Who gets which scale
| Surface | File | Element | Scale |
|---|---|---|---|
| Page content | `items/PageItem.svelte:35` | `div.content` | `.md` |
| Mini-project assignment | `pages/MiniProjectDetailPage.svelte:504-506` | `div.assignment-html` | `.md` |
| Quiz prompts | `items/quiz/{SingleChoice,MultiChoice,Numeric,Text}Question.svelte:20/26` | `div.text` | `.md.compact` |
| Explanation | `items/QuizItem.svelte:169` | `div.exp` | `.md.compact` |
| Course info | `pages/CourseView.svelte:89`, `:94` | `div.info` | `.md.compact` |
| Version info | `pages/editor/VersionEditPage.svelte:633` | `div.vinfo` | `.md.compact` |
| Editor question card | `editor/quiz/QuestionCard.svelte:83`, `:129` | `div.qtext`, `div.qexpl-body` | `.md.compact` |
| Editor preview | `editor/MarkdownEditor.svelte:327` | `div.preview` | from the host's new `scale` prop |

- **MarkdownEditor's prop.** `scale?: 'page' | 'compact'` defaults to `'page'`.
  - `'page'`: `PageBody` and the `MiniProjectModal` assignment.
  - `'compact'`: `NewQuestionModal`, `QuestionTextModal` and `ExplanationModal`.

### What goes and what stays
- **Go:** each surface's `:global` rules for `p`, `ul`, `ol`, `li`, `code`, `pre`, `pre code`, `a`, `img`, the headings and `p:last-child`, which content.css now covers. Examples:
  - `PageItem.svelte:81-119`;
  - the quiz prompts' `p` rules;
  - `MiniProjectDetailPage.svelte:664-668`;
  - `QuestionCard.svelte:160-163`, including its `font-size: inherit` heading rule;
  - the 5c `.vinfo` backlog fix, which is now moot.
- **Stay:** rules that are not content structure:
  - `pre:focus-visible` rings (`TextQuestion.svelte:92` and the others);
  - each surface's own `font-size`, `line-height`, `color` and `text-wrap`;
  - `newTabLinks` and the mini-project link rewrite;
  - the trust-boundary comments;
  - `overflow-wrap` on surfaces where the box itself needs it.

  The surfaces keep their `p` spacing only where a spacing rule differs on purpose. Each such case is a Task 3/4 ruling, recorded in the ledger.
- **Spacing changes.** The surfaces had their own paragraph spacing: 10px, `space-2`, `space-3` and 6px. One style means one spacing per scale. The screenshots in Tasks 3 and 4 show each surface before and after.

### Gate
- `content.css` joins the reviewed global files, and its rules join the (b4) freeze.
- One row per surface pins its class, `md` or `md compact`.
- The `:global` allow-list loses the entries that are removed.
- A `none` row checks that no surface re-declares a content rule (`:global(p|ul|ol|code|pre|blockquote|h[1-6])`) beside `.md`.

## The 404 page (Task 5)

- **`NotFound.svelte`** renders in the shared page column:
  ```svelte
  <div class="page">
    <ErrorState variant="page" title="Page not found" message="The address may be mistyped, or the page has moved." action={back} />
  </div>
  ```
  - The `back` snippet is a `Button variant="secondary"` that calls `navigate(target)`.
- **Target and label:**
  - signed in: `defaultLandingPath(session.user)`. `/teaching` reads "Back to teaching", and anything else reads "Back to courses";
  - signed out (`session.user === null`): `/login`, labelled "Sign in".
- **Header.** Signed out there is no AppHeader, as today (`App.svelte:64`).
- **Tests:**
  - the three labels and targets;
  - the ErrorState `<h1>`;
  - an unknown path rendering NotFound through `App.svelte:74`.

## Bare URLs (Task 6, backend)

- **The renderer.** `backend/mathion/markdown.py:7` becomes `MarkdownIt("commonmark", {"html": False, "linkify": True}).enable("linkify")`, and `_md.linkify.set({"fuzzy_link": False, "fuzzy_email": False, "fuzzy_ip": False})`.
  - New dependency: `linkify-it-py` in `backend/pyproject.toml`, which also goes into the Docker image.
- **`www.`** The plan's first step checks whether `www.example.org` links with `fuzzy_link` off.
  - If it does not, the plan rules between two options, and the tests pin the result:
    - (a) a custom `www.` schema (`linkify.add("www.", …)`, with linkify-it's own `www.` validator);
    - (b) `http(s)://` only.
  - In either case bare domains stay plain.
- **Output and sanitising.**
  - Links come out as `<a href="…">…</a>`. They pass `nh3` with the existing `_ALLOWED_TAGS` and `_ALLOWED_ATTRS`, and the `_URL_SCHEMES = {http, https, mailto}` filter.
  - `www.` links get `http://` from linkify-it's normaliser.
  - On every surface the frontend treats them like an authored `[text](url)`: the editor's `newTabLinks`, the mini-project page's `rewriteExternalLinks`, and the default elsewhere.
- **Not linked.** Each case is pinned by a test:
  - a URL inside inline code or a code block;
  - inside math (`$…$`, `$$…$$`);
  - an existing `[text](url)` or `<url>`;
  - bare domains;
  - `numpy.py`;
  - e-mail addresses;
  - trailing punctuation: "see https://x.org." links without the full stop.
- **Stored HTML (D55).** No migration. The two backlog items (`bare-urls-not-autolinked-in-markdown.md`, `stored-content-html-not-rerendered-after-renderer-change.md`) are updated to say linkify shipped, and that stored HTML picks it up on the next save, publish or clone.
- **Tests.** `backend/tests/test_markdown.py` (or the existing renderer test file) covers each case above. One API-level test checks that saving page content with a bare URL stores a link.

## Process

Six tasks, each run as in Polish 1:
1. TDD;
2. vitest (`TZ=Europe/Copenhagen`), svelte-check and the gate (absolute `TMPDIR`); for Task 6 also `backend/.venv` pytest;
3. screenshots or a look check;
4. the user's OK;
5. Opus and Fable review lanes on the uncommitted diff, re-run after every fix until clean;
6. commit with exact paths and the trailer;
7. a ledger line;
8. wait for "go".

The tasks:
1. **Focus ring and reduced motion:** the `base.css` rules, the forced-colors outline, Switch, the (b4) re-freeze. Screenshots: a Tab-focused primary Button, a ghost Button, an IconButton, a CourseCard, an accordion header, the strip icons and a text field.
2. **The page ground:** the tokens, `--disabled-bg`, the Toast, the two `body:has` removals. Screenshots: a course list, the player, the versions page, a disabled Button and IconButton on the ground.
3. **Authored content, page scale:** `content.css`, PageItem and the mini-project assignment. Screenshots: a page with h1–h6, a blockquote, a list and code, before and after.
4. **Authored content, compact surfaces:** the quiz prompts, the explanation, course and version info, the editor's question cards, the preview's `scale`. Screenshots: each surface with a heading and a quote.
5. **The 404 page:** ErrorState, the labels, the tests.
6. **Bare URLs:** linkify, the dependency, the tests, the backlog notes.

Then a whole-branch review (fresh Opus and Fable), and a Safari pass, one step at a time.

## Carried to the Safari pass
- **The focus ring.**
  - ⌥Tab through the header, a course card, the strip icons (the 22px squares, on a wrapped line), a primary and a ghost Button, an IconButton, a filled IconButton, and an accordion header.
  - Text fields keep the border and halo.
  - A mouse click shows no ring.
- **High Contrast.** Use Chrome's DevTools forced-colors emulation if it is practical. Otherwise note it for the beta pass.
- **Reduced motion.** With macOS "Reduce motion" on, the Switch knob jumps.
- **The page ground.**
  - Every screen family: course list, course view, player, mini-project page, Teaching, the editor and the versions page.
  - Does the player's reading column feel grey on the tint? If so, a white sheet is a follow-up (D50).
  - Disabled controls are still distinct.
- **Authored content.** A page and a quiz prompt with every heading level, a quote, lists and code. The editor's preview matches the student view.
- **404.** A typed bad URL, signed in and signed out.
- **Bare URLs.** A page body with a pasted URL, after a save. The link opens, and a URL inside code stays plain.

No VoiceOver steps; those are collected for the beta pass.
