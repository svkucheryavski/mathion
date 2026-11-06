# Superuser panel: Branding — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the superuser panel gets a **Branding** page (site name, logo, tab icon, colours). Every page, the sign-in page and the panel included, shows the school's branding from the first frame, and gets a "Powered by Mathion" footer.

**Architecture:**
- **Data and read (Task 1).** One Alembic revision adds a small `site_branding` row and a sibling `site_branding_images` table for the bytes (D12). `mathion/branding.py` owns the name rule, the image hashes and `load_branding()`, the one read that never fails, with its last good copy in memory (D13). The default tab icon ships as a generated module (D6).
- **Checks (Tasks 2, 3).** `mathion/theme_vars.py` is generated from `theme-default.css` (D8). `mathion/theme_css.py` parses, checks, compares and writes the colours (D10). `mathion/contrast.py` gives the readability warnings, and `mathion/png_check.py` checks PNGs (D5).
- **Public serving (Task 4).** `/api/branding/…` files with content-hash versions; `/favicon.ico`; the server fills the page's head between markers; `/api/auth/config` carries the public branding (D13).
- **Panel API (Task 5).** One read, one save per item, and a theme check that saves nothing (D2, D10, D14).
- **Email and recovery (Tasks 6, 7).** The three email builders use the name (D3). `mathion branding reset` (Python and Go, D15).
- **Frontend (Tasks 8, 9, 10).** The reactive branding store, the startup, the site logo, the footer shell (D4, D11, D13, D14). Then the Branding page with its name and image dialogs, then the Colours dialog with its check, preview and download.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic, PostgreSQL 17, Alembic, pytest (via `backend/.venv`); Svelte 5 runes, Vitest with jsdom (`mount`/`unmount`/`flushSync`); Go (the `mathion` CLI); the zsh gate `frontend/scripts/visual-refresh-gate.sh`. No new npm, pip or Go packages.

**Spec:** `docs/superpowers/specs/2026-11-05-superuser-branding-design.md`, rev 12 (`de59806`). Its decisions D1–D15 and its sentences are binding. This plan cites them by name and doesn't repeat their reasoning. Mockups: `.superpowers/brainstorm/35964-1793901736/content/where.html` and `dialogs.html`; where they differ from the spec, the spec wins.

**Line numbers** are from `de59806`. An earlier task shifts them in files it also touches; find the place by the quoted text.

## Global Constraints

- **Branch:** `feat/superuser-branding` (off main `aed0056`). Local only: never push, never merge.
- **Directory:** never leave `/Users/svkucheryavski/Documents/Developing/mathion`. Use absolute `cd` only, never `cd ..`.
  - `$SDD` = `/Users/svkucheryavski/Documents/Developing/mathion/.superpowers/sdd/2026-11-05-superuser-branding`.
  - Probes go in `probe/`, logs and gate temp files in `tmp/`, screenshots in `shots/`. Never `/tmp`.
  - Tell every subagent the same.
- **Code style:**
  - Svelte 5 runes only. Component tests use `mount` / `unmount` / `flushSync` from `svelte`, never `@testing-library/svelte`.
  - Python, pytest and alembic only through `backend/.venv`.
  - Match the surrounding comment density. A comment may carry the decision tag (`D10`), never "added in this slice".
- **No new packages** (Python, Go, JavaScript). PNG checks, CRC-32, CSS parsing and contrast are own code.
- **Colours:** theme tokens only, no literal colours in components (the one literal left, Toast's `#0a7ea4`, moves into the theme in Task 2), no `opacity` to dim.
- **UI:**
  - same tab only, except the footer's mathion.org link (the user's one exception, D11);
  - one pencil per card opens one `Modal` dialog; nothing is edited in place;
  - student screens fit at 400 px wide.
- **Copy:** plain words, never "he"/"she". Every quoted sentence in the spec (D3, D4, D5, D6, D9, D10, D15) is copied verbatim into code and tests.
- **Status codes:** the panel guard's 404 means only "link expired". A refused value or file is 422 with the sentence as `detail`, never 413 (D5).
- **Escaping (D3):** the name goes into HTML only through `html.escape(quote=True)`, and into the inline JSON only through `json.dumps` with `<`, `>` and `&` replaced by their `<`, `>` and `&` escapes.
- **Pinned CSS rules are single-selector blocks** (the gate's `d` helper matches `.cls.svelte-HASH{…}`). No apostrophe inside the gate's `node -e '…'` payload.
- **Commands** (write `$SDD` out in full when you run them):
  - **Backend:** `cd /Users/svkucheryavski/Documents/Developing/mathion/backend && .venv/bin/pytest -q > $SDD/tmp/pytest.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/pytest.log`. One file: `.venv/bin/pytest -q tests/<file>`.
  - **Frontend tests:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm test > $SDD/tmp/vitest.log 2>&1; echo "exit $?"; tail -5 $SDD/tmp/vitest.log; grep -cE "^ *Errors +[0-9]|Unhandled (Rejection|Error)" $SDD/tmp/vitest.log`. Green means `exit 0` AND the last count is `0`. Never bare `npx vitest`.
  - **Typecheck:** `npx svelte-check --output machine | tail -1`: 0 errors, no more warnings than the baseline.
  - **Gate:** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && TMPDIR=$SDD/tmp zsh scripts/visual-refresh-gate.sh > $SDD/tmp/gate.log 2>&1; echo "exit $?"; grep -E "^FAIL" $SDD/tmp/gate.log; tail -1 $SDD/tmp/gate.log`. It ends `VISUAL-REFRESH GATE: ALL PASS (N checks)`. Bump `EXPECTED_CHECKS` (line 90, now 2822) by the rows a task adds.
  - **Go:** `cd /Users/svkucheryavski/Documents/Developing/mathion/cli && go test ./... > $SDD/tmp/go.log 2>&1; echo "exit $?"; tail -3 $SDD/tmp/go.log`. `TestInstallRequiresBothFlags` fails while a dev backend holds :8000; stop it first.
  - **Build check (Tasks 4, 8):** `cd /Users/svkucheryavski/Documents/Developing/mathion/frontend && npm run build > $SDD/tmp/build.log 2>&1; echo "exit $?"`.
  - **Baselines:** record the gate, vitest, backend, svelte-check and Go results at Task 1 start in the ledger.
- **If an iCloud " 2" copy appears** (`find . -name "* 2.*"`), `cmp` it with its original and ask the user before deleting.
- **Per task, in this order** (the user's loop):
  1. TDD, step by step as written.
  2. The suites the task names, all green.
  3. Tasks 8, 9 and 10: agent-browser shots at 1280 wide, and at 400 wide for student screens, of the screens the task names. Show them in an agterm overlay (`--size-percent 60`, base64 images, the HTML in `$SDD`), and get the user's OK on the look.
  4. Two review lanes on the UNCOMMITTED diff: Opus (high effort) and Fable.
     - Fix every Critical and Important, then re-run both lanes after EVERY fix until both are clean.
     - Push back on a wrong finding with evidence.
     - Minors go to `docs/backlog/superuser-branding-debt.md` (created in Task 1) under the task's heading.
     - Never edit the tree while a lane reviews.
  5. With the user's commit OK: exact paths (never `git add -A`, never `logo.png`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no session line.
  6. A ledger line in `$SDD/progress.md`, a memory update, then WAIT for the user's "go".
- **Dev servers and dev data:** start dev servers, run the dev migration, sign in, mint a panel token or write in the panel only with the user's yes. Never print the panel token. The ledger lists the rows to delete at the slice's end.

## Review Focus

The inputs most likely to bite a person that no step below would otherwise pin. Each has its test in the owning task.

1. **A name that closes the inline script** (`</script><script>alert(1)</script>`) runs as code on every page, the sign-in page included (D3, D13). → Task 4, `test_fill_escapes_script_close_in_name`.
2. **A colour form a browser drops** (`hsl(210, 30, 36)`, `rgb(50%, 0, 0)`) is stored, and that colour goes blank everywhere while the check says it's fine (D10). → Task 2, `test_refuses_forms_browsers_drop`.
3. **An uploaded tab icon never shows**, because the default SVG link stays next to it, in the filled head or after a panel save (D13). → Task 4, `test_uploaded_icon_drops_svg_link`; Task 8, `applyBranding swaps the icon link set`.
4. **A short database outage** makes every page show Mathion's look, or drops PIN emails (D13, D3). → Task 1, `test_load_branding_keeps_last_good_on_error`; Task 6, `test_pin_email_survives_branding_read_error`.
5. **Short pages scroll, or sticky headers stop sticking**, because of the footer's shell (D11). → Task 8, the gate rows for `.shell` and `.page` (no `overflow`), and the Safari step.

---

### Task 1: Storage, the site name rule, and the read that never fails

**Files:**
- Create: `backend/alembic/versions/f3a9c1e7b2d4_site_branding.py` (revises `e8c4f2a6b1d7`)
- Modify: `backend/mathion/models_auth.py` (after `SiteSettings`, line 125)
- Create: `backend/mathion/branding.py`
- Create: `backend/branding-defaults/icon.svg`, `icon-32.png`, `icon-180.png`
- Create: `backend/scripts/gen_branding_defaults.py`, `backend/mathion/branding_defaults.py` (generated)
- Create: `docs/backlog/superuser-branding-debt.md`
- Test: `backend/tests/test_branding.py`, `backend/tests/test_migration_site_branding.py`

**Interfaces:**
- Produces:
  - models `SiteBranding` (`id` = 1 check like `SiteSettings`; `site_name: str` default "Mathion"; `logo_width/logo_height: int|None`, `logo_hash: str|None`; the same three for `icon_`; `theme_changes: dict[str, str]` JSONB, default `{}`) and `SiteBrandingImage` (`kind: str` PK, `'logo'` or `'icon'`; `data: bytes`).
  - `mathion.branding`: `NAME_DEFAULT = "Mathion"`; `class BrandingRefusal(ValueError)` (its `str` is the sentence); `check_site_name(raw: str) -> str`; `short_hash(data: bytes) -> str` (first 16 hex of SHA-256); `@dataclass(frozen=True) class ImageMeta(width: int, height: int, hash: str)`; `@dataclass(frozen=True) class Branding(name: str, logo: ImageMeta|None, icon: ImageMeta|None, theme_changes: dict[str,str], theme_text: str, theme_hash: str|None)`; `DEFAULT_BRANDING`; `load_branding() -> Branding`; `class BrandingUnavailable(Exception)`; `read_image(kind: str) -> bytes|None` (raises `BrandingUnavailable` on any database error); `last_good() -> Branding`; `reset_cache()` (tests only).
  - `mathion.branding_defaults`: `ICON_SVG: bytes`, `ICON_32_PNG: bytes`, `ICON_180_PNG: bytes`.
  - In Task 1, `theme_text` is `""` and `theme_hash` is `None`; Task 2 makes `load_branding` fill them.

- [ ] **Step 1: Record baselines.** Run every suite from Global Constraints and write the counts into `$SDD/progress.md`. Create `docs/backlog/superuser-branding-debt.md` with a `# Superuser Branding: deferred work` heading.

- [ ] **Step 2: Write the failing name-rule tests** in `test_branding.py`:

```python
@pytest.mark.parametrize("raw, stored", [
    ("  Riverside  ", "Riverside"), ("École", "École"), ("Mathe 🙂", "Mathe 🙂"),
    ("A\tB", "A B"), ("א‏ב", "א‏ב"),
])
def test_name_accepted(raw, stored): assert check_site_name(raw) == stored

@pytest.mark.parametrize("raw", ["", "   ", "x" * 61, "a\nb", "a b", "a\u0085b"])
def test_name_refused_one_line(raw):
    with pytest.raises(BrandingRefusal, match="^The site name must be 1 to 60 characters on one line.$"): check_site_name(raw)

@pytest.mark.parametrize("raw", ["​​", "a‮b", "a⁦b", "a\x07b"])
def test_name_refused_hidden(raw):
    with pytest.raises(BrandingRefusal, match="^The site name has a hidden control character; type it again.$"): check_site_name(raw)
```

- [ ] **Step 3: Run** `.venv/bin/pytest -q tests/test_branding.py`. Expected: FAIL, `mathion.branding` doesn't exist.

- [ ] **Step 4: Implement `check_site_name`** in `mathion/branding.py`: tab → space, `strip()`, NFC, then the D3 order: line split or length → first sentence; Cc/Zl/Zp, U+202A–202E, U+2066–2069, or no character in categories L/N/S/P → second sentence. U+200E/U+200F pass.

- [ ] **Step 5: Run** the file. Expected: PASS.

- [ ] **Step 6: Write the failing storage and read tests:**
  - `test_load_branding_defaults_without_row` (empty table → `DEFAULT_BRANDING`, name "Mathion");
  - `test_load_branding_without_table` (drop the table in a savepoint-free test session, or monkeypatch the query to raise `ProgrammingError(UndefinedTable)` → defaults);
  - `test_load_branding_keeps_last_good_on_error`: save a name "Riverside", `load_branding()` once, then monkeypatch `SessionLocal` to raise `OperationalError` → the answer is still "Riverside"; the log has one warning for two failing reads (`caplog`), and a third read after a success-then-failure logs again;
  - `test_load_branding_never_touches_caller_session`: inside an open caller transaction with uncommitted work, a failing `load_branding()` leaves that work committable;
  - `test_public_read_never_loads_image_bytes`: with SQL echo captured (`event.listen(engine, "before_cursor_execute")`), `load_branding()` never selects from `site_branding_images`;
  - `test_read_image_unavailable_on_error` (raises `BrandingUnavailable`).

- [ ] **Step 7: Run.** Expected: FAIL (no tables, no `load_branding`).

- [ ] **Step 8: Implement** the two models, the migration (create both tables; no data copy), `short_hash`, `load_branding` (its own `SessionLocal()`, every exception caught around the whole read, the last good copy in a module global, one warning per outage) and `read_image`. `load_branding` selects only `site_branding`; image bytes come only through `read_image`.

- [ ] **Step 9: Write `test_migration_site_branding.py`** (upgrade creates both tables with the `id = 1` check; downgrade drops them), as `test_migration_site_settings.py` does. Run both files. Expected: PASS.

- [ ] **Step 10: The default icon (D6).** *Superseded by spec rev 13 (2026-11-06): the default is the user's own drawing, `icon.svg` is a byte copy of it, and the PNGs are made from it as below. The drawing instructions in this step no longer apply.* Draw `backend/branding-defaults/icon.svg`: a 32 × 32 square, `rx` 6, filled `#3F5C77`, with `Logo.svelte`'s two peak paths (its `login` geometry, stroke 4) stroked white (front) and with the `--gold` value from `theme-default.css` (back). Make the PNGs at 32 and 180 px from it once with agent-browser (open the SVG at that size, transparent background, `screenshot`), and save them next to it. Write `scripts/gen_branding_defaults.py` (reads the three files, writes `mathion/branding_defaults.py` with base64 literals decoded at import) and run it.

- [ ] **Step 11: Write `test_branding_defaults_match_files`** (the module's three values equal the files' bytes; the PNGs start with the PNG signature and are 32 × 32 and 180 × 180 by their `IHDR`). Run. Expected: PASS.

- [ ] **Step 12: Backend suite** green. Then the per-task loop (no shots).

---

### Task 2: Theme variables, the toast colour, and the theme parser

**Files:**
- Modify: `backend/mathion/branding.py` (`load_branding` fills the theme fields)
- Modify: `frontend/src/styles/theme-default.css` (add `/* --- toast --- */` with `--toast-info: #0a7ea4;` after the semantic section, line 52), `frontend/src/components/chrome/Toast.svelte:29` (`.info { background: var(--toast-info); }`)
- Create: `backend/scripts/gen_theme_vars.py`, `backend/mathion/theme_vars.py` (generated)
- Create: `backend/mathion/theme_css.py`
- Test: `backend/tests/test_theme_vars.py`, `backend/tests/test_theme_css.py`

**Interfaces:**
- Consumes: Task 1's `load_branding`, `Branding`, `short_hash`.
- Produces:
  - `mathion.theme_vars`: `@dataclass(frozen=True) class ThemeVar(name: str, default: str, heading: str)`; `THEME_VARS: tuple[ThemeVar, ...]` (73, in the file's order); `BY_NAME: dict[str, ThemeVar]`; `NON_COLOUR_NAMES: frozenset[str]` (the 23 others, for the "isn't a colour" sentences).
  - `mathion.theme_css`: `@dataclass(frozen=True) class RGBA(r: float, g: float, b: float, a: float)`; `parse_colour(value: str) -> RGBA|None` (literals only; `None` for `var()`); `canonical(value: str) -> str`; `same_colour(a: str, b: str) -> bool`; `@dataclass class ThemeParse(changes: dict[str,str], problems: list[str], more: int)`; `parse_theme(data: bytes) -> ThemeParse` (changes already stripped of values equal to the default); `changes_in_use(stored: dict[str,str]) -> dict[str,str]`; `resolve(changes: dict[str,str]) -> dict[str, RGBA]` (all 73, through `var()`); `write_stylesheet(changes: dict[str,str]) -> str` (`""` when empty, else `:root:root {\n  --x: v;\n}\n` in `THEME_VARS` order).

- [ ] **Step 1: Write `test_theme_vars.py`:** `test_theme_vars_match_css` re-derives names, order and defaults from `frontend/src/styles/theme-default.css` (a colour = a literal colour or a `var()` of another colour) and compares with `THEME_VARS`; `test_counts` (`len(THEME_VARS) == 73`, `len(NON_COLOUR_NAMES) == 23`, `--focus-shadow` in `NON_COLOUR_NAMES`, `--toast-info` in `BY_NAME` with heading "Toast"); `test_every_section_has_a_heading`. Run. Expected: FAIL.

- [ ] **Step 2: Move the toast colour** (CSS above), write `gen_theme_vars.py` with the hand-kept map from each section comment's first words to the download heading ("surfaces" → "Page and surfaces", "text" → "Text", "lines" → "Borders", "accent" → "Primary", "gold" → "Gold", "semantic" → "Status colours", "toast" → "Toast", "destructive button" → "Danger button", "confirm buttons" → "Confirm buttons", "the danger panel" → "Danger panel", "avatars" → "Avatars", "progress heatmap" → "Progress heat map", "submission status" → "Submission status", "version lifecycle badges" → "Version badges"); it exits non-zero naming any colour under an unmapped section. Generate `theme_vars.py`. Run the test and the frontend suite (the toast change). Expected: PASS.

- [ ] **Step 3: Write the parser tests** in `test_theme_css.py`, each asserting the exact D10 sentences:
  - accepted and canonical: `("#FFF", "#fff")`, `("rgba(63,92,119,0.5)", "rgba(63, 92, 119, 0.5)")`, `("rgb(63 92 119 / .5)", "rgb(63 92 119 / .5)")`, `("hsl(210deg 30% 36%)", "hsl(210deg 30% 36%)")`, `("White", "white")`, `("var( --danger )", "var(--danger)")`, `("hsla(210, 30%, 36%, 50%)", …)`;
  - `test_refuses_forms_browsers_drop`: `rgb(50%, 0, 0)`, `hsl(210, 30, 36)`, `hsl(210 30 36)`, `hsl(30% 40% 50%)`, `rgb(1, 2 3)`, `oklch(0.5 0.1 200)`, `none`, `currentcolor`, `inherit` → each "Line N: `…` isn't a colour. Use a hex colour, rgb(), hsl() (like `hsl(210deg 30% 36%)`), a colour name or var(--another-colour).";
  - outright refusals: `url(https://x)`, `expression(1)`, a quote, `\`, non-ASCII;
  - names: `--backgroud` (set and inside `var()`) → "isn't a theme variable."; `--radius: 12px` → "`--radius` isn't a colour, so it can't be changed here."; `var(--radius)` → "…so it can't be referred to here.";
  - structure: `!important`, `@import`, a selector, a second `:root` → "Line 9: only colour variables inside one `:root { }` are allowed."; `--bg` twice → "is set twice."; an unclosed comment → "Line 7: a comment isn't closed."; `--surface: var(--focus-0)` → "Line 3: `--surface` refers back to itself through `--focus-0`.";
  - file: invalid UTF-8, 64 KB + 1, empty, empty `:root {}` → the D10 file sentences; a BOM and `\r\n` accepted with true line numbers; a comment between two tokens (`rgb(1/**/2 3)`) stays a separator;
  - 30 problems → 20 kept and `more == 10`; an echoed value over 40 characters is cut with "…";
  - equality: `same_colour("#fff", "white")`, `same_colour("#fff", "#ffffff")`; `--cancel-hover` set to its resolved default literal is a change; a value equal to its literal default is dropped; the full download text with three changes → three changes;
  - `changes_in_use({"--primary": "var(--gone)"}) == {}`; a stored loop is dropped;
  - `write_stylesheet` keeps the space form's spaces and uses `:root:root`.
  Run. Expected: FAIL.

- [ ] **Step 4: Implement `theme_css.py`** to the tests: a small tokenizer (comments → a space plus the same line breaks), the closed grammar from D10, clamping for comparison only, canonical spacing (runs → one space; none inside `(`/`)` or before `,`; one after `,` and around `/`), the fixed CSS named-colour table, loop detection through the merged set (upload over defaults). Make `load_branding` fill `theme_changes` with `changes_in_use(stored)`, `theme_text` with `write_stylesheet` of those, and `theme_hash` with `short_hash` of the text (`None` when the text is empty); add `test_load_branding_theme_text` to `test_branding.py`.

- [ ] **Step 5: Run** both files, then the backend suite. Expected: PASS. Then the per-task loop.

---

### Task 3: Readability warnings and the PNG check

**Files:**
- Create: `backend/mathion/contrast.py`, `backend/mathion/png_check.py`
- Test: `backend/tests/test_contrast.py`, `backend/tests/test_png_check.py`

**Interfaces:**
- Consumes: `theme_css.resolve`, `RGBA`.
- Produces:
  - `contrast.PAIRS: tuple[tuple[str, str], ...]` (text, background) covering D10's list; `contrast_warnings(changes: dict[str,str]) -> list[str]`, each "Text may be hard to read: `--muted` on `--surface` is 3.1:1 (4.5:1 recommended)." (ratio to one decimal, rounded down).
  - `png_check`: `class PngRefused(ValueError)`; `check_png(data: bytes) -> tuple[int, int]` (width, height).

- [ ] **Step 1: Write the contrast tests:** `test_defaults_give_no_warning` (`contrast_warnings({}) == []`); `test_muted_on_surface_warns` (a `--muted` that gives 2:1 → the exact sentence); `test_translucent_text_blends_over_background`; `test_translucent_bg_blends_over_white`; `test_var_resolved_through_merged_set`. Every pair's names exist in `BY_NAME`.

- [ ] **Step 2: Write the PNG tests** (build PNGs in the test with `zlib` and `struct`): a valid 2 × 1 → `(2, 1)`; a JPEG header, an SVG, a broken `IHDR` CRC, a broken `IDAT` CRC, a missing `IEND`, a truncated chunk, width 0, a bad bit depth/colour-type pair, `CgBI` before `IHDR` → `PngRefused`; bytes after `IEND` → accepted.

- [ ] **Step 3: Run** both. Expected: FAIL.

- [ ] **Step 4: Implement** WCAG relative luminance and ratio; the blending order from D10; the chunk walk with `zlib.crc32`.

- [ ] **Step 5: Run**, then the backend suite. Expected: PASS. Then the per-task loop.

---

### Task 4: Public files, the filled page head, and the public config

**Files:**
- Create: `backend/mathion/api/branding.py` (public router), `backend/mathion/page_fill.py`
- Modify: `backend/mathion/main.py` (include the router before `_api_not_found`, line 197; `/favicon.ico` beside `/health`; the SPA fallback at lines 222–243), `backend/mathion/api/auth.py:51-65`, `backend/mathion/schemas.py` (`AuthConfigResponse`), `frontend/index.html`
- Test: `backend/tests/test_branding_files.py`, `backend/tests/test_page_fill.py`, `backend/tests/test_auth_config.py`, `backend/tests/test_main_spa.py`, `backend/tests/test_spa_document_headers.py`

**Interfaces:**
- Consumes: `load_branding`, `read_image`, `BrandingUnavailable`, `branding_defaults`, `Branding`.
- Produces:
  - `schemas.BrandingPublic(name: str, logo: LogoPublic|None, icon: str|None, theme: str|None)` with `LogoPublic(version: str, width: int, height: int)`; `icon` and `theme` are versions. `AuthConfigResponse` gains `branding: BrandingPublic`.
  - `page_fill`: `MARKER = "<!--branding-->"`; `class IndexTemplate(text: str)`; `load_index(path: Path) -> IndexTemplate|None` (logs a warning and returns `None` when `<title>Mathion</title>`, the marker or `</head>` is missing); `fill_index(t: IndexTemplate, b: Branding) -> str`; `branding_public(b: Branding) -> BrandingPublic`.
  - Addresses: `/api/branding/logo.png`, `/icon.png`, `/icon-default.svg`, `/icon-default-32.png`, `/icon-default-180.png`, `/theme.css`, and `/favicon.ico`.

- [ ] **Step 1: Put the marker into `frontend/index.html`:** `<!--branding-->` on the line after `<title>Mathion</title>`.

- [ ] **Step 2: Write the fill tests** in `test_page_fill.py`, against the tracked `frontend/index.html` with `<script type="module" crossorigin src="/assets/index-x.js"></script>` and `<link rel="stylesheet" crossorigin href="/assets/index-x.css">` appended before `</head>` (as a build writes them):
  - `test_fill_defaults`: title "Mathion"; the three default icon links (SVG, 32 px PNG with `sizes="32x32"`, apple-touch 180) with `?v=` of the default bytes' hashes; `apple-mobile-web-app-title`; no theme link; no preload; inline JSON `{"name":"Mathion","logo":null,"icon":null,"theme":null}`; every filled tag has `data-branding`;
  - `test_uploaded_icon_drops_svg_link`: only `rel="icon" type="image/png"` and `rel="apple-touch-icon"`, both `/api/branding/icon.png?v=<hash>`; no `image/svg+xml`;
  - `test_logo_preload_and_inline_size`;
  - `test_theme_link_after_built_css`: the theme link is the last tag before `</head>`;
  - `test_fill_escapes_script_close_in_name`: name `</script><script>alert(1)</script>` → the title holds `&lt;/script&gt;…`, the JSON holds `</script>…`, and the page holds no second `<script>` that isn't the app's;
  - `test_missing_marker_warns_and_serves_unfilled`;
  - `test_real_dist_fills` (skipped unless `frontend/dist/index.html` exists).

- [ ] **Step 3: Write the file tests** in `test_branding_files.py`:
  - `logo.png`/`icon.png`: 404 without an upload; with one, `image/png`, `nosniff`, `Content-Security-Policy: sandbox`; `?v=<current>` → `Cache-Control: public, max-age=31536000, immutable`; no or an old `?v=` → `no-cache` with `ETag`; `If-None-Match` → 304; `HEAD` works;
  - the three default files always answer (`image/svg+xml` for the SVG);
  - `theme.css`: empty with no changes, `text/css; charset=utf-8`, `nosniff`;
  - `/favicon.ico`: the upload, else the 32 px default; reached without `frontend/dist`;
  - outage: with `read_image` raising `BrandingUnavailable`, a matching `If-None-Match` → 304, else 503 with `no-store`; `theme.css` still served from the last good copy.

- [ ] **Step 4: Extend `test_auth_config.py`** (the `branding` field, defaults and saved), `test_main_spa.py` (`/`, `/index.html` and an unknown path all answer the filled page), and `test_spa_document_headers.py` (the page: `Cache-Control: no-cache`, no `ETag`/`Last-Modified`; `/superuser/...` keeps `no-store`).

- [ ] **Step 5: Run** the five files. Expected: FAIL.

- [ ] **Step 6: Implement.** `load_index` runs at import next to the `_frontend_dist.is_dir()` check; `_spa_fallback` answers an `HTMLResponse` from `fill_index` for the index (the fallback and `index.html` alike) and `FileResponse` for real files; an unfilled template (`None`) serves the file as today. The image answers may skip gzip with `Content-Encoding: identity` (§6, either is fine).

- [ ] **Step 7: Run** the files, the backend suite, and the build check. Expected: PASS, build exit 0. Then the per-task loop.

---

### Task 5: The panel's Branding API

**Files:**
- Create: `backend/mathion/api/superuser_branding.py`
- Modify: `backend/mathion/main.py` (include after `superuser_settings_router`), `backend/mathion/schemas.py`, `backend/mathion/branding.py` (writers)
- Test: `backend/tests/test_superuser_branding.py`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (all behind `require_superuser_panel` / `require_superuser_panel_write`, like Settings):
  - `GET /api/superuser/{token}/branding` → `PanelBranding(name: str, logo: ImageSize|None, icon: ImageSize|None, colours: PanelColours, public: BrandingPublic)` with `ImageSize(width, height)` and `PanelColours(vars: list[ThemeVarOut(name, default, heading)], changes: dict[str,str], warnings: list[str])`; `changes` are the changes in use.
  - `PUT …/branding/name` JSON `{"name": str}` or `{"reset": true}` → `PanelBranding`.
  - `POST …/branding/logo` and `…/branding/icon`, multipart: a `file` part or a `reset=true` field, never both → `PanelBranding`.
  - `POST …/branding/theme/check`, multipart `file` → `ThemeCheck(changes: dict[str,str], problems: list[str], more: int, warnings: list[str], blocked: str|None)`.
  - `POST …/branding/theme`, multipart `file` or `reset=true` → `PanelBranding`.
  - `branding.save_name(db, name)`, `save_image(db, kind, data, width, height)`, `clear_image(db, kind)`, `save_theme(db, changes)`, `clear_theme(db)`, `reset(db, everything: bool) -> list[str]` (used by Task 7). Each locks the small row (`SELECT … FOR UPDATE`, as `_locked_row`), writes only its own columns, and logs `branding: <item> changed by user <id>`.

- [ ] **Step 1: Write the failing API tests:**
  - read: defaults; after saves; `colours.vars` has 73 entries in order with headings; `changes` excludes a dead `var()`;
  - name: accepted, refused (both sentences, 422), reset;
  - logo: a valid PNG saved with its size and a new hash; refused files with the D5 sentences ("The logo must be a PNG file.", "The logo can be at most 1 MB.", "The logo can be at most 4096 px on a side and 4 million pixels in all."); a 600 × 16 PNG accepted (advice is the browser's); `file` and `reset` together → 422; the server reads at most 1 MB + 1 byte;
  - icon: "The tab icon can be at most 1024 px on a side."; a wide or 16 × 16 icon accepted;
  - theme check: problems and `more`; `warnings` holds contrast sentences and "This file puts back Mathion's colour for `--primary`, which is changed now."; with saved changes, an all-default file → `blocked is None` and the one warning "This file matches Mathion's colours, so saving it removes your changes." (no per-colour "puts back"); without saved changes → `blocked == "This file matches Mathion's colours."`; the saved set again → `blocked == "This file matches the saved colours."`; 64 KB + 1 → the size sentence;
  - theme save: replaces the whole stored set, dead entries included; a refused file → 422 with the first problem as `detail` and nothing written; reset clears all;
  - every save commits, then answers the read (a save's `public` already carries the new version);
  - two saves of different cards at once both land (two sessions, one waits on the row lock);
  - write routes need CSRF; a non-superuser gets the guard's answers.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement** the router and the writers. The image size caps are checked here after `check_png`; the sentences follow D5/D6 with "logo" or "tab icon".

- [ ] **Step 4: Run** the file and the backend suite. Expected: PASS. Then the per-task loop.

---

### Task 6: The site name in every email

**Files:**
- Modify: `backend/mathion/notifications/templates.py` (`RenderContext` line 17, the sign-offs at lines 54–96, `build_login_pin_message` line 130), `backend/mathion/notifications/dispatcher.py` (`_build_render_context` line 81, `_run` line 203, `_tick_once` line 425), `backend/mathion/api/auth.py` (`_send_login_pin`), `backend/mathion/api/superuser_settings.py` (`_test_message` line 344)
- Test: `backend/tests/test_notifications_templates.py`, `backend/tests/test_notifications_dispatcher.py`, `backend/tests/test_superuser_settings.py`, `backend/tests/test_login_pin_delivery.py`

**Interfaces:**
- Consumes: `load_branding`.
- Produces: `RenderContext.site_name: str = "Mathion"`; `build_login_pin_message(email, pin, *, minutes, sender=DEFAULT_FROM, site_name="Mathion")`; `_run(..., site_name: str = "Mathion")`; `_test_message(sender, recipient, site_name)`.

- [ ] **Step 1: Write the failing tests:**
  - every template's sign-off is "— Riverside" and the admin note says "on Riverside" when `site_name="Riverside"`; subjects unchanged;
  - the PIN email: subject "Your Riverside sign-in PIN", the same in the body; an emoji and accented name survive the subject;
  - the test email: "Test email from Riverside", "your Riverside server", "Email from Riverside reaches this inbox.";
  - `test_tick_reads_branding_once`: a tick sending three rows calls `load_branding` once;
  - `test_pin_email_survives_branding_read_error`: with the read failing, the PIN email still goes, signed with the last good name or "Mathion".

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** `_tick_once` reads `load_branding().name` once and passes it down; `_send_login_pin` and the test email read it once per send.

- [ ] **Step 4: Run** the files and the backend suite. Expected: PASS. Then the per-task loop.

---

### Task 7: `mathion branding reset`

**Files:**
- Modify: `backend/mathion/superuser/__main__.py`
- Create: `cli/cmd/branding.go`, `cli/cmd/branding_test.go`
- Modify: `cli/cmd/root.go` (`root.AddCommand`, line 146), `deploy/man/mathion.1`, `README.md`
- Create: `docs/release-notes/branding-release-order.md`
- Test: `backend/tests/test_superuser_cli.py`

**Interfaces:**
- Consumes: `branding.reset(db, everything)`.
- Produces: `python -m mathion.superuser branding-reset [--all]` printing "Removed the colour changes." or "Reset the site name, logo, tab icon and colours."; `mathion branding reset [--all] [--yes]`.

- [ ] **Step 1: Write the failing Python tests:** `branding-reset` removes only the colours (the name stays); `--all` resets everything; each prints its line and exits 0.

- [ ] **Step 2: Write the failing Go tests** with the fake runner the other command tests use:
  - the prompt "This removes the colour changes. Continue? [y/N] " (or "This resets the site name, logo, tab icon and colours. Continue? [y/N] " with `--all`), and "n" cancels without running anything;
  - `--yes` skips the prompt;
  - the call is `Stream` with `exec -T app python -m mathion.superuser branding-reset` (plus `--all`);
  - a `*compose.ExitError{Code: 2, Stderr: "...invalid choice: 'branding-reset'..."}` prints "This server's Mathion is too old for branding reset: run `mathion update` first.";
  - any other `ExitError` prints its captured error output and returns the error.

- [ ] **Step 3: Run** both. Expected: FAIL.

- [ ] **Step 4: Implement** the subcommand and `cli/cmd/branding.go` (prompt on `a.In`/`a.Out` as `reconcile.go` does; `a.Runner.Stream(ctx, a.Out, a.composeArgs(...)...)`). Add the command to the man page's COMMANDS and the README. Write the release-order note: the image first, then the CLI release; until then, `docker compose exec -T app python -m mathion.superuser branding-reset` by hand. The release is the user's step.

- [ ] **Step 5: Run** the Python file, the Go suite and the backend suite. Expected: PASS. Then the per-task loop.

---

### Task 8: The branding store, startup, the site logo and the footer

**Files:**
- Create: `frontend/src/lib/branding.svelte.ts` (replaces `src/lib/branding.ts`, deleted), `frontend/src/components/chrome/SiteLogo.svelte`, `frontend/src/components/chrome/PoweredBy.svelte`
- Modify: `frontend/src/main.ts`, `frontend/src/lib/uploadLimit.svelte.ts`, `frontend/src/lib/auth.svelte.ts:48` (`AuthConfig` gains `branding`), `frontend/src/App.svelte`, `frontend/src/components/chrome/AppHeader.svelte`, `frontend/src/pages/Login.svelte` (logo; "Ask the person who runs this site for one."), `frontend/src/pages/superuser/SuperuserShell.svelte:6,67-68`, `frontend/scripts/visual-refresh-gate.sh`
- Test: `src/tests/branding.svelte.test.ts`, `src/tests/SiteLogo.svelte.test.ts`, `src/tests/App.footer.svelte.test.ts`, `src/tests/uploadLimit.test.ts`, `src/tests/Login.svelte.test.ts`

**Interfaces:**
- Consumes: `BrandingPublic` from `/api/auth/config` and the inline JSON.
- Produces:
  - `branding.svelte.ts`: `PRODUCT_NAME = 'Mathion'`; `type BrandingPublic = { name: string; logo: { version: string; width: number; height: number } | null; icon: string | null; theme: string | null }`; `DEFAULT_BRANDING`; `branding = $state<BrandingPublic>(…)`; `readInlineBranding(doc: Document): BrandingPublic | null`; `applyBranding(b: BrandingPublic, doc: Document): Promise<void>` (sets `branding`, the title, `apple-mobile-web-app-title`, the icon link set, and swaps the theme link, resolving after the new link's `load` or `error`; every tag it writes carries `data-branding`; links to default icon files carry no `?v=`). Never fetches at import.
  - `loadUploadLimit(config?: Promise<AuthConfig>)`: uses the given answer when there is one.
  - `<SiteLogo size="header" | "login" />`: the uploaded `<img src="/api/branding/logo.png?v=…" alt={branding.name} width height>` (CSS `height: 20px; width: auto; max-width: 160px`, or 28/224; `object-fit: contain`, left), or the default lockup (`Logo` + `PRODUCT_NAME`) when `logo` is null or the image fails.
  - `<PoweredBy />`: "Powered by <a href="https://mathion.org" target="_blank" rel="noopener noreferrer">Mathion</a>".

- [ ] **Step 1: Write the failing tests:**
  - `readInlineBranding` reads `#branding`; returns null when missing or unparseable;
  - `applyBranding swaps the icon link set`: defaults → upload leaves no `image/svg+xml` link; upload → reset brings the three default links back; replaced tags carry `data-branding`;
  - the theme link: added before the old one is removed; the promise resolves on `load` or `error`; `theme: null` removes it;
  - `SiteLogo`: default lockup without a logo; the `img` with width/height/alt with one; an `error` event falls back to the lockup;
  - App: the footer shows on the sign-in page, a signed-in page and NotFound; not on the player route; not while the session loads; the link opens a new tab with `noopener noreferrer`;
  - `uploadLimit`: given a config promise, no extra fetch;
  - Login: "Ask the person who runs this site for one." (the old test changes; the config tests stay).

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** `main.ts` becomes an `async function start()` (no top-level `await`): read the inline data; make one `getAuthConfig()` call on every page and hand it to `loadUploadLimit`; when the inline data is missing or unparseable, await that call, then `applyBranding` (falling back to the defaults on failure), then mount. App.svelte: one column `.shell` (`display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh`), `.page` (`flex: 1`), no `overflow` on either; `<PoweredBy />` after the page except on the player route and while loading. The panel's logo, the header's and the sign-in page's use `SiteLogo`.

- [ ] **Step 4: Gate rows** (CSS pins on the built output): `.shell`'s `min-height:100dvh` and no `overflow`; `.page`'s `flex:1` and no `overflow`; SiteLogo's `.logo-header` (`height:20px`, `max-width:160px`) and `.logo-login` (`height:28px`, `max-width:224px`); `.powered`'s font size and `text-align`. Bump `EXPECTED_CHECKS` by the rows added.

- [ ] **Step 5: Run** vitest, svelte-check, the gate and the build check. Expected: green, build exit 0.

- [ ] **Step 6: Shots** (with the user's yes to start the dev servers): the sign-in page and a short signed-in page at 1280 and 400, with and without an uploaded logo (the user's `logo.png`); a teaching Progress table scrolled (sticky headers). Then the per-task loop.

---

### Task 9: The Branding page, the name dialog and the image dialogs

**Files:**
- Create: `frontend/src/pages/superuser/SuperuserBranding.svelte`, `frontend/src/components/superuser/EditSiteNameDialog.svelte`, `frontend/src/components/superuser/EditImageDialog.svelte`, `frontend/src/lib/pngCheck.ts`
- Modify: `frontend/src/lib/superuser.ts` (`PanelPage` line 320 gains `'branding'`; the API functions), `frontend/src/routes.ts` (after line 22), `frontend/src/pages/superuser/SuperuserShell.svelte` (pill and URL check, lines 20–30, 98)
- Test: `src/tests/SuperuserBranding.svelte.test.ts`, `src/tests/pngCheck.test.ts`, `src/tests/superuserApi.test.ts`, `src/tests/SuperuserShell.svelte.test.ts`

**Interfaces:**
- Consumes: Task 5's routes and shapes; `applyBranding`.
- Produces:
  - `superuser.ts`: `getBranding(token)`, `saveSiteName(token, body: {name: string} | {reset: true})`, `saveImage(token, kind: 'logo'|'icon', part: Uint8Array | 'reset', filename?)`, `checkTheme(token, bytes: Uint8Array, filename)`, `saveTheme(token, part: Uint8Array | 'reset', filename?)`; the multipart calls send `FormData` as `lib/runAssets.ts` does, with the CSRF header.
  - `pngCheck.ts`: `checkPngBytes(bytes: Uint8Array, kind: 'logo'|'icon'): { width: number; height: number; advice: string[] } | { refused: string }`, with D5's whole check (own CRC-32), the size caps and the D4/D6 advice sentences.

- [ ] **Step 1: Write the failing tests:**
  - `pngCheck`: the same PNG cases as Task 3 Step 2; the caps' sentences; advice "This logo is 16 px tall, so it may look soft (56 px or more recommended).", "This logo is very wide, so it will show less than 20 px tall.", "This icon is 16 px, so it may look soft in tabs and on phones (180 px or more recommended).", "This icon isn't square, so tabs and phones will squeeze it.";
  - the page: skeleton, then four cards in order with D2's card texts and hint; the error state with the server's sentence; the shell's fifth pill "Branding" and `/branding` route;
  - the name dialog: Save blocked until changed; the 422 sentence inside the dialog; Reset shown only when not default, moves focus to Save, and Save stores it;
  - the image dialog: a chosen file's bytes are read once and the same bytes are sent; a refused file never previews and drops every pending change; Save waits for `img.decode()` (stubbed); a decode result for an earlier choice, or after Reset, is ignored; a decode rejection → "This PNG can't be shown by a browser."; a bare 413 → "This file is over the server's upload limit."; after Save, the card shows the saved value and `applyBranding` ran with the answer's `public`.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement**, following `SuperuserSettings.svelte` and `EditLimitsDialog.svelte` (`ready`, `aria-disabled` Save, `closeDisabled={busy}`). jsdom has no `img.decode`: tests stub `HTMLImageElement.prototype.decode`.

- [ ] **Step 4: Run** vitest, svelte-check and the gate. Expected: green.

- [ ] **Step 5: Shots** at 1280: the page (default and branded), the logo dialog with a chosen file and with advice, the icon dialog. Then the per-task loop.

---

### Task 10: The Colours dialog, preview and download

**Files:**
- Create: `frontend/src/components/superuser/EditColoursDialog.svelte`, `frontend/src/lib/themeFile.ts`
- Modify: `frontend/src/pages/superuser/SuperuserBranding.svelte` (the Colours card's pencil and download)
- Test: `src/tests/EditColoursDialog.svelte.test.ts`, `src/tests/themeFile.test.ts`, `src/tests/SuperuserBranding.svelte.test.ts`

**Interfaces:**
- Consumes: `PanelColours`, `ThemeCheck`, `checkTheme`, `saveTheme`, `applyBranding`.
- Produces: `themeFileText(colours: PanelColours): string` (the header comment from D9 verbatim, then each heading as a comment and every variable with its current value: the change in use, else the default); `downloadTheme(colours)` (a `Blob` download named `theme.css`, no panel address).

- [ ] **Step 1: Write the failing tests:**
  - `themeFileText`: the D9 header comment; 73 lines in order under their headings; changes in use applied; a dead stored value written as the default;
  - the card: "default", or "3 colours changed:" with the names, and the saved warnings; Download builds the file in the browser;
  - the dialog: choosing reads the bytes once and sends them to the check and to Save; Save blocked until the check answers, and when `blocked` is set (showing that sentence); problems listed with "and 10 more"; warnings listed; a refused choice drops every pending change and the preview returns to the saved colours; a late check answer (for an earlier choice, or after Reset) is ignored; Reset removes every change on Save; a bare 413 → the proxy sentence;
  - the preview box: `inert`; holds the real `Button`s and `StatusBadge`s; declares all 73 merged values with `style.setProperty` (the 4 `var()` defaults declared again); never inserts the raw file.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** The preview's sample follows `dialogs.html`: a header strip with the logo and a pill, a card with text and a link, the two buttons, two badges.

- [ ] **Step 4: Run** vitest, svelte-check and the gate. Expected: green.

- [ ] **Step 5: Shots** at 1280: the card changed and with a warning, the dialog with a checked file and its preview, the dialog with problems. Then the per-task loop.

---

## After the last task

- Whole-branch review (fresh Opus + Fable) of `aed0056..HEAD`, then the fix pass.
- The Safari pass, one step at a time, from §5 of the spec, with one step on a production build (the filled head, no flash) and the Safari tab-icon note (D6).
- Cleanup: spec rev for any decision the pass changes, backlog, dev rows listed in the ledger deleted with the user's yes, workspace deleted.
