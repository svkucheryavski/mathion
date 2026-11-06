# Superuser panel: Branding — design

**Status:** rev 13, 2026-11-06.
- Rev 1 came from the brainstorm.
- Rev 2 folded in the builder check: the header without a logo (user's), Reset waits for Save, and the downloaded theme's header comment (mine). The user approved rev 2.
- Rev 3 folds in spec review round 1, three lanes (`.superpowers/sdd/2026-11-05-superuser-branding/spec-r1-opus-backend.md`, `spec-r1-opus-frontend.md`, `spec-r1-fable.md`). No user decision changed. New or changed:
  - **D3:** the name rule refuses every character an email header can't carry; escaping;
  - **D4:** the logo hugs its width (up to the box), pixel caps, no flash, a broken image falls back;
  - **D5/D6:** a fuller PNG check; the default tab icon as committed files; `/favicon.ico`;
  - **D8/D9:** the real counts (72 of 95), a generated list in the backend, a download built in the browser;
  - **D10:** a check before Save, a closed value grammar, cycles, only real changes stored, more contrast pairs, an honest preview;
  - **D11:** one footer in the app shell, and which pages leave it out;
  - **D13:** public files under `/api/branding/`, versions as content hashes, the filled page never cached, the theme winning by specificity, the dev server;
  - **D15:** the CLI's confirm and an old image.
- Rev 4 folds in spec review round 2, two lanes (`spec-r2-opus.md`, `spec-r2-fable.md`), and the user's principle that the school owns how its branding looks (§2). New or changed:
  - **D3:** the inline-data escaping written out; a name needs a visible character;
  - **D6:** the default icon ships inside the Python package;
  - **D9/D10:** an upload replaces the stored set, and the downloaded file and the check say so; a file matching the defaults; parser edges; the bytes read once;
  - **D11:** the footer while loading and on the not-found page;
  - **D13:** no default `logo.png`; the head fill's markers and its production check; one never-failing branding read;
  - **D15:** reset colours by default, `--all` for everything.
- Rev 5 folds in spec review round 3, two lanes (`spec-r3-opus.md`, `spec-r3-fable.md`), and the user's explicit OK for the footer's new-tab link (D11). New or changed:
  - **D3:** direction marks allowed, a tab becomes a space, a second sentence for hidden characters;
  - **D4/D6:** the size minimums and the square rule become advice (§2); the image dialogs read the bytes once and run the full PNG check;
  - **D8/D9:** the download's family headings come from a hand-kept map;
  - **D10:** a wider value grammar (hue units, clamping, any-case names, comma alpha); `var()` equality; a stored reference whose target is gone; a file matching the saved colours; contrast blending and added pairs;
  - **D13:** the icon links in each state and their addresses; caching by hand; uploads as multipart; the last good branding kept in memory; the logo preloaded; how the panel and the dev server get new values;
  - **D15:** the CLI captures the command's error output; the reset is printed, not only logged.
- Rev 6 folds in spec review round 4, two lanes (`spec-r4-opus.md`, `spec-r4-fable.md`). No user decision changed. New or changed:
  - **D11:** the footer layout is one column for the whole shell, so short pages don't scroll;
  - **D10:** the colour forms written out exactly, as browsers take them; a refused choice drops every pending change;
  - **D13/D14:** what a save answers; the theme text kept in memory; `icon: null`; the dev fallback never leaves the page blank;
  - smaller wording in D3, D4, D5, D6, D9 and D15.
- Rev 7 folds in spec review round 5, two lanes (`spec-r5-opus.md`, `spec-r5-fable.md`), both with no Critical or Important findings. Minor changes: the PNG check walks every chunk; the stored form's spacing; Reset makes a running check stale; the comparisons use the changes in use; the filled head tags are marked; the default icon links in the app; no `overflow` on the shell; one `/api/auth/config` request; §5 gains a short signed-in page.
- Rev 8 folds in the confirming round 6, two lanes (`spec-r6-opus.md`, `spec-r6-fable.md`), both with no Critical or Important findings. Minor changes: "the changes in use" everywhere; the app's own head tags marked too; no top-level `await`, one shared config request; late image decodes ignored; Save waits for the check; the dialog checks the pixel caps before the preview.
- Rev 9 folds in the confirming round 7, two lanes (`spec-r7-opus.md`, `spec-r7-fable.md`), both with no Critical or Important findings. Minor changes: the image dialogs' Save waits for the decode; Reset and an upload clear the whole stored set; the sign-in page keeps its own config request.
- Rev 10 folds in the confirming round 8 (`spec-r8-opus.md`: nothing found; `spec-r8-fable.md`: one Minor): where the shared startup request lives.
- Rev 11 folds in the confirming round 9 (`spec-r9-opus.md`, `spec-r9-fable.md`, the same one Minor): the startup request is made on every page, and awaited only when the inline data is missing.
- Rev 12 folds in the confirming round 10 (`spec-r10-opus.md`, `spec-r10-fable.md`, one Minor each): the fallback waits for the theme link before mounting; which sign-in tests stay.
- Rev 13 (user's, 2026-11-06, during Task 1): the default tab icon is the user's own drawing (D6).

**Builds on:**
- `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (the panel's Settings page, its cards and Edit dialogs, and §7, the decisions noted for this project);
- `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (panel pages, dialogs, D25 errors);
- `docs/superpowers/specs/2026-07-11-superuser-panel-slice-1-design.md` (panel access and shell).

**Source of the requirement:** platform spec §8, `docs/superpowers/specs/2026-04-19-mathion-platform-design.md:554`, and the superuser panel roadmap (Users, Courses, Settings, Branding, Setup checklist).

**Mockups:** `.superpowers/brainstorm/35964-1793901736/content/` (`where.html`: the page; `dialogs.html`: the Logo and Colours dialogs). Where a mockup and this text differ (for example its "3 of 70 colours changed"), the text wins.

Decisions are marked **(user's)** when the user chose them, and **(mine)** when they are my call, open to change.

## 1. Why

A school that installs Mathion wants its students and teachers to see their school's site, not a stock install. The first things people notice are the name and the logo (user's), then the colours. Today all three are fixed in the code: the drawn logo and "Mathion" wordmark (`components/ui/Logo.svelte`, `lib/branding.ts`), the tab title (`frontend/index.html`), the email text (`notifications/templates.py`), and the colours (`styles/theme-default.css`).

## 2. Goals, non-goals, anti-goals

**Goals.** From a new **Branding** page in the superuser panel, the superuser can set:
- the **site name**;
- the **logo** (one PNG holding the logo and the name);
- the **tab icon** (a PNG, square recommended);
- the **colours** (a `.css` file of colour variables).

Each has a Mathion default that is always there underneath, and each can be reset to it. Every page but the item player also gets a "Powered by Mathion" line linking to https://mathion.org (D11).

**The school owns how its branding looks** (user's: "If a school wants to use their logo and colors it is their job to make them looking nice"). Mathion refuses only what would break the site: an unsafe file, a name that would stop email, an image big enough to stall browsers, a layout that would break. Everything else is advice that never blocks a save: the readability warning, the logo and icon size hints, a non-square icon. A school's theme recolours the default Mathion lockup too.

**Non-goals:**
- fonts, sizes, spacing, corner radii, shadows and other non-colour variables (D8);
- a dark mode;
- branding per course or per run;
- custom email templates or a custom footer text;
- SVG uploads (D5);
- removing or changing the "Powered by Mathion" line;
- a web app manifest (the phone home screen uses D6's icon and D3's name through head tags).

**Anti-goals** (would make this a failure even if it works):
- an upload that leaves the site unusable with no way back;
- a theme that makes students' browsers fetch anything from another server;
- the default Mathion look (colours, logo or tab icon) flashing before the school's on each page load;
- a layout that breaks at 400 px phone width because of a branding change;
- a branding value that stops email from going out (sign-in PINs included).

## 3. Decisions

### The page

- **D1. A Branding pill and page** (user's, mockup A). `/superuser/{token}/branding`, a fifth pill after Settings. It needs `'branding'` in `PanelPage` (`frontend/src/lib/superuser.ts`), a route in `src/routes.ts`, and the panel shell's page list and URL check. Four cards, in this order: Site name, Logo, Tab icon, Colours.
  - **While it loads:** a skeleton. **If loading fails:** the panel's error state with the server's sentence (D25). The guard's 401 and 404 go to the shell, as on the other pages.
- **D2. Cards show; one pencil edits** (the panel's rule: one Edit dialog per row). Each card shows its current value and has one pencil. The pencil opens one Edit dialog. Uploads, the fields and **Reset to default** are inside the dialog, never on the card. The dialogs follow the Settings dialogs:
  - Save is blocked until something changes;
  - the server's sentence shows inside the dialog;
  - Esc or Cancel closes without saving;
  - while Save runs, Cancel and Esc wait.

  After a save, the card shows the saved value, and the superuser's own panel shows the change at once (D14).
- **Reset to default waits for Save** (mine, from the builder check). In a dialog, Reset to default is a change like choosing a file: the preview shows the default, and Save stores it. Cancel undoes it, so it needs no confirm dialog. It's shown only when the saved item isn't the default. The last of Reset and a chosen file wins. When Reset is pressed, focus moves to Save, so it doesn't fall out of the dialog.
- **The cards** (as drawn in `where.html`):
  - **Site name:** the name, with the hint "Used for the tab title, emails and the logo's alt text. The header shows your logo, or Mathion's when you haven't uploaded one."
  - **Logo:** the logo at its real header size, with "your upload, W × H px" or "default".
  - **Tab icon:** the icon at 32 px and 16 px, with "your upload" or "default: the Mathion mark".
  - **Colours:** "default", or "N colours changed:" followed by the changed names, and D10's contrast warning when it applies. Below it, a **Download the current theme** button (D9). It's a plain download, not an edit, so it sits on the card.

### Site name

- **D3. The site name** (user's, from 2026-11-04). Plain text, default "Mathion". It's never drawn as text on the page: with a logo the logo carries the name, and without one the default Mathion lockup shows (D4). It's used only where an image can't go:
  - the browser tab title (instead of `<title>Mathion</title>`);
  - the logo's alt text;
  - the name under the icon when the site is saved to a phone's home screen (`apple-mobile-web-app-title`);
  - every email. Three builders send email, and all of them use it:
    - the notification templates (`notifications/templates.py`): the sign-off "— <name>" (today "— Mathion") and the admin note's "on <name>". Their subjects name the run or the course, not Mathion, and stay as they are. The dispatcher reads the name once per tick and passes it down to the render context (a `site_name` field defaulting to "Mathion", so tests that run a batch directly still work), not once per message;
    - the PIN email (`build_login_pin_message`): "Your <name> sign-in PIN" in the subject and the body;
    - the test email (`api/superuser_settings.py`): "Test email from <name>", and the body's "your <name> server" and "Email from <name> reaches this inbox."

    Every builder reads the name through one branding read that never fails (D13), so a database hiccup can't drop a notification or a PIN email.

  "Mathion" stays in the footer (D11), in server log and error messages, and in the `mathion` CLI. The sign-in page's "Ask the person who runs this Mathion for one." (`Login.svelte`) becomes "…runs this site…".
  - **Rules** (mine, tightened from review). A tab becomes a space; then, after trimming and Unicode NFC, 1 to 60 code points.
    - It's refused when it splits into more than one line (`splitlines()`, which also catches U+2028, U+2029 and U+0085). Python's email headers refuse line breaks of every kind, so such a name would stop every email, sign-in PINs included. Sentence: "The site name must be 1 to 60 characters on one line."
    - It's refused when it holds another character in the categories Cc, Zl or Zp, or a bidirectional embedding, override or isolate (U+202A–U+202E, U+2066–U+2069), which could reorder the text after the name in an email, or has no visible character at all (it needs at least one letter, number, symbol or punctuation mark, so a name of only zero-width spaces is refused). Sentence: "The site name has a hidden control character; type it again."
    - The direction marks U+200E and U+200F are allowed: they can't reorder what follows, and right-to-left names need them. Accented letters and emoji are fine.
  - **Escaping** (mine, from review). Wherever the name goes into HTML (the title, alt text, a meta tag) it's escaped with `html.escape(quote=True)`. In inline data (D13) it's JSON in which every less-than sign, greater-than sign and ampersand is written as its JSON Unicode escape (a backslash, then `u003c`, `u003e` or `u0026`). Plain `json.dumps` isn't enough: it leaves `</script>` as it is. So names like `</title><script>…` and `</script><script>…` are shown as text.
  - **Reset to default** sets it back to "Mathion".

### Logo and tab icon

- **D4. The logo** (user's). One PNG holding the logo and the name. It replaces the drawn mark and the "Mathion" wordmark everywhere they appear: the app header (`AppHeader.svelte`), the sign-in page (`Login.svelte`) and the panel shell (`SuperuserShell.svelte`).
  - **Size on the page** (the user's "fixed box, scaled to fit, never stretched", refined from review). The image is 20 px tall and as wide as its shape needs, up to 160 px, in the header and the panel shell. On the sign-in page it's 28 px tall, up to 224 px wide. It's left-aligned, and a wider logo shrinks to fit the width (`object-fit: contain`). In CSS that's `height: 20px; width: auto; max-width: 160px` (28 and 224 on the sign-in page): the `width` and `height` attributes (below) only give the shape, so the box isn't always the full 160 px. The user's own `logo.png` (838 × 174) shows as about 96 × 20. Hugging the width keeps room for the student's name in the 400 px header, and the name there gets an ellipsis when it's too long.
  - **No flash, no jump.** The page knows the logo's version, width and height before the app draws (D13), and the head preloads the logo. The `<img>` gets `width` and `height`, so its space is kept while it loads. If it fails to load, the default lockup shows instead of a broken image.
  - **Any size within limits** (mine; the user wanted it "to match a given size", and agreed to advice instead of a rule). The dialog recommends "at least 56 px tall so it stays sharp, also on the sign-in page".
    - **Advice, never blocking (§2):** a logo under 56 px tall gets "This logo is N px tall, so it may look soft (56 px or more recommended)." A logo wider than 8:1 gets "This logo is very wide, so it will show less than 20 px tall."
    - **Refused, for memory:** a logo over 4096 px on a side or 4 million pixels in all, which would cost every student's browser memory on every page ("The logo can be at most 4096 px on a side and 4 million pixels in all.").
  - **Default:** today's drawn mark plus the "Mathion" wordmark (user's, from the builder check). With no logo uploaded, the header, the sign-in page and the panel show this default even when a site name is set. The site name never replaces the wordmark. So `PRODUCT_NAME` (now in `lib/branding.svelte.ts`) stays "Mathion" for the wordmark, and the site name is a separate value. The default lockup keeps following the theme's colours (`--primary`, `--gold`, `--text`), as today, so it stays readable on a school's header colours (mine).
- **D5. PNG only, checked** (mine). An SVG can carry scripts that run on the site's own address if someone opens the file directly, so it's refused. The server checks, without decoding and with no new package:
  - the PNG signature;
  - an `IHDR` chunk first, 13 bytes long, with a valid CRC, a valid bit depth and colour type, and the width and height read from it, each at least 1 (PNG's own rule);
  - every chunk after it walked by its length, each with a valid CRC, up to an `IEND` chunk (so a truncated file is refused); bytes after `IEND` are ignored, as browsers ignore them;
  - no `CgBI` chunk (Apple's variant, which browsers can't show). Apple puts it before `IHDR`, so "`IHDR` first" already refuses it; no separate test path is needed.

  Up to 1 MB. Sentences: "The logo must be a PNG file." and "The logo can be at most 1 MB."
  - **The upload** is multipart (`python-multipart` is already a dependency). The server reads at most 1 MB + 1 byte before any check, and answers a refusal with its sentence and the panel's usual 4xx code, never 413, so a bare 413 always means the proxy (D10).
  - **One save per item.** Each card's Save goes to one endpoint that takes either the file part or `reset=true`, never both (the name takes the name or `reset=true`).
  - The files are served as `image/png` with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, whatever was uploaded.
  - **In the browser** (mine, from review), as for the theme (D10): the dialog reads the file's bytes once, when it's chosen, and sends those same bytes on Save. It runs D5's whole check on them at once (CRC-32 is a few lines of own code), with D4's or D6's pixel caps, so a refused file never reaches the preview. D5 doesn't decode the image data, so the preview image failing to decode (`img.decode()` rejecting; a partly corrupt PNG can still fire `load`) is a refusal too: "This PNG can't be shown by a browser." As for the colours check, Save stays blocked until the decode for the chosen file has answered, and a decode result for an earlier choice, or one still running when Reset is pressed, is ignored. A refused choice drops every pending change in the dialog (a chosen file or Reset): the preview shows the saved item, and Save is blocked again. The server checks again on Save. A proxy's bare 413 shows "This file is over the server's upload limit."
- **D6. The tab icon** (user's: "better to have possibility to replace it as well"). A separate PNG, because a wide logo doesn't fit a square tab.
  - **Rules** (mine, made advice by §2): D5's checks; at most 1024 px on a side and up to 1 MB, for memory ("The tab icon can be at most 1024 px on a side."; the logo's 4-million-pixel rule can't be reached here). The rest is advice that never blocks: shorter side under 180 px, "This icon is N px, so it may look soft in tabs and on phones (180 px or more recommended)." (N is the shorter side); not square, "This icon isn't square, so tabs and phones will squeeze it." Other sentences follow D5's pattern.
  - **Default** (user's, 2026-11-06): the user's own drawing, the two peaks (gold behind, steel blue in front) on a white square (`backend/branding-defaults/icon.svg`). It's an SVG for browsers that take one, and PNGs at 32 and 180 px, made once from the SVG while building this. Mathion has no tab icon today, so browsers show their blank default.
    - **It ships inside the Python package** (mine, from review). The image installs only the `mathion` package's Python files (no package data) and the built frontend, so loose image files next to the code would be missing in production while tests pass. The source files are committed in the repo (for example `backend/branding-defaults/`), and a generated, committed module (for example `mathion/branding_defaults.py`) holds their bytes. A test fails when the module and the files differ, as for `theme_vars.py` (D8).
  - **Where it's used:** the tab icon (`<link rel="icon">`), the phone home-screen icon (`apple-touch-icon`), and `/favicon.ico`, which today returns the app's page as HTML. It now returns the uploaded icon, or the 32 px default. Which links the head carries in each state is in D13.
  - Safari keeps tab icons a long time, so a changed icon may show there later than D14 says (noted for the Safari pass).
- **The Edit logo and Edit tab icon dialogs** (as drawn in `dialogs.html`): the image at its real sizes inside dashed boxes on the page's `--surface` colour (the header and sign-in sizes for the logo; 32 px and 16 px for the icon, on a light and a dark strip, since iOS fills a transparent icon's background). Then a **Choose a PNG…** button with the chosen file's name and size, the hint, and the footer **Reset to default**, Cancel, Save. A chosen file previews at once, before Save. A second chosen file replaces the first.

### Colours

- **D7. A theme file that overrides colour variables** (user's). The default theme (`styles/theme-default.css`) is always loaded. The uploaded colours are loaded after it and win (D13), so any variable they leave out keeps its default. A file that only sets `--bg` changes the page background, along with `--focus-page`, which the default defines as `var(--bg)`.
- **D8. Colours only** (mine; the user asked "what do you think?" and agreed). The default theme has 95 variables today. Only the colours can be overridden: the 68 whose default is a colour, plus the 4 whose default is another colour variable (`--focus-0`, `--focus-page`, `--cancel-hover`, `--cancel-press`). That makes 72 today; the toast colour below adds one. Examples: `--bg`, `--surface`, `--text`, `--primary`, the borders, the status and state badges, the heat map. Sizes, spacing, radii, fonts and shadows (`--focus-shadow` too) stay Mathion's, because they were tuned screen by screen and checked down to 400 px phone width.
  - **One source of truth** (mine, from review). The app's image doesn't hold `theme-default.css`, only the built frontend, so the server can't read it at runtime. A generated, committed backend module (for example `mathion/theme_vars.py`) lists the 73 names in the file's order, with each default value and its family heading. A backend test re-derives the names, order and defaults from `theme-default.css` and fails when they differ, so a new colour variable can't silently fall out of the list.
  - **Family headings** come from a small hand-kept map in the generator, from each section comment in `theme-default.css` (`--- surfaces ---`, `--- accent ---`, …) to the download's heading ("Page and surfaces", "Primary", …). The generator fails when a colour sits under a section with no map entry.
  - **One colour moves into the theme:** the info toast's `#0a7ea4` (`Toast.svelte`) is the only UI colour written outside `theme-default.css`. It becomes the theme variable `--toast-info`, in a new `--- toast ---` section, so a school theme reaches it too. That makes 96 variables and 73 overridable colours; the counts below use those.
- **D9. Download the current theme** (mine). The Colours card's button downloads a `.css` file holding every overridable variable with its current value: the saved change where there is one, the default otherwise. This is the starting file, so nobody has to guess names.
  - **Built in the browser** (mine, from review), from data the page already has, as a file download. The panel's Branding read carries what it needs: the 73 names in order, their defaults, their family headings, the stored changes in use, and the contrast warnings for the saved colours (shown on the card). A stored value left out after a release (D10) is written with Mathion's default, as in the stylesheet, so the school's own download always uploads cleanly. A link to a panel address would put the panel token in the download history, and an expired link would save an error page as `theme.css`.
  - **No developer comments** (mine, from the builder check). `theme-default.css`'s comments are the team's design notes ("D50", "Don't 'fix' it"), not help for a school. The download has one short header comment instead: "Mathion colours. Change the values you want and upload the whole file on the Branding page. A line left at Mathion's value changes nothing; a line you delete goes back to Mathion's colour. Only colours can be changed here." The variables follow the default file's order, under short family headings ("Page and surfaces", "Text", "Borders", "Primary", …), so a school sees which colours go together.
- **D10. The upload is checked before Save; only real changes are kept** (mine, from the brainstorm and review).
  - **A check that saves nothing.** When a file is chosen, the dialog sends it to a panel check endpoint (panel guard and CSRF, like Settings). The endpoint runs the same parser as Save and answers with:
    - the accepted changes;
    - the problems, each with its line: the first 20, and "and N more" when there are more;
    - D10's contrast warnings and other advice.

    The preview and the warnings come from that answer. The dialog reads the file's bytes once, when it's chosen, and sends those same bytes to the check and to Save, so a file edited on disk in between can't make them disagree. Save stays blocked until the check for the chosen file has answered. A check answer for an earlier choice, or one still running when Reset is pressed, is ignored. A refused choice drops every pending change in the dialog (a chosen file or Reset): the preview goes back to the saved colours, and Save is blocked again. A proxy's bare 413 shows the Settings slice's "This file is over the server's upload limit." The upload is multipart, and the server reads at most 64 KB + 1 byte before parsing (D5).
  - **An upload replaces the stored set** (mine, from review). The file says the whole theme: a colour it leaves out, or sets to Mathion's value, goes back to Mathion's. When that would undo a colour saved earlier, the check warns, without blocking: "This file puts back Mathion's colour for `--primary`, which is changed now."
  - **The file's shape.** UTF-8 text, up to 64 KB. A byte-order mark is removed first, and Windows line endings are fine. Comments are replaced by a space plus as many line breaks as they spanned, so they still separate what's around them and line numbers stay true; an unclosed `/*` is refused ("Line 7: a comment isn't closed."). An optional `@charset "utf-8";` may come first. Then exactly one `:root { … }` block of `--name: value;` declarations, where the last semicolon is optional.
  - **The value grammar** (closed; a value must match it whole). It takes everyday colour-picker output (§2), but only in the forms every browser takes, including older Safari on school iPads. A form a browser drops would blank that colour everywhere while the check stayed silent, so it's refused:
    - a hex colour with 3, 4, 6 or 8 digits;
    - **comma form:** `rgb(` or `rgba(` with three numbers or three percentages (not mixed), then an optional alpha; `hsl(` or `hsla(` with a hue, then two percentages, then an optional alpha;
    - **space form:** `rgb(` with three numbers or three percentages (not mixed), then an optional `/ alpha`; `hsl(` with a hue, then two percentages, then an optional `/ alpha`;
    - **parts:** a hue is a number, or a number with `deg`, `turn`, `rad` or `grad`, never a percentage. An alpha is a number or a percentage. Numbers are written as CSS writes them (an optional sign, a leading-dot fraction like `.5`, an exponent). Mixed separators (`rgb(1, 2 3)`) are refused. A number out of range is clamped for comparing and for contrast, as browsers clamp it;
    - a name from CSS's fixed table of named colours, or `transparent`, in any case (`White` is stored as `white`). `currentcolor`, `inherit`, `initial`, `unset`, `revert` and system colours are refused;
    - `var(--name)` of another overridable colour, with no fallback.

    `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`, `color()` and `none` are refused: the contrast check would need conversion code for each. A value is refused outright if it holds `\`, a quote, `{`, `}`, `;`, `@`, `<`, `url(`, `expression(` or any non-ASCII character. Accepted values are stored in a canonical form: the text as written, lowercased; runs of whitespace become one space; no space just inside `(` or `)` or before `,`; one space after `,` and around `/`. So `rgba(63, 92, 119, 0.5)`, `rgb(63 92 119 / .5)`, `hsl(210deg 30% 36%)` and `var(--x)` (from `var( --x )`). The space form keeps its spaces.
  - **When two values are the same colour.** Two literal values are the same when their parsed red, green and blue (rounded to 8 bits) and alpha (to three decimals) are equal, so `#fff` equals `#ffffff` and `white`. A `var()` value equals only the same `var()` text. So a literal written for one of the 4 `var()` defaults is always a change: it pins that colour, which is what the school wrote.
  - **Problems** (nothing is saved, and each names its line; a name or value echoed in a problem is cut at 40 characters with "…"):
    - a name that isn't a theme variable, as the name set or inside `var()`: "Line 4: `--backgroud` isn't a theme variable.";
    - a name that isn't a colour: "Line 4: `--radius` isn't a colour, so it can't be changed here.";
    - a value outside the grammar: "Line 5: `url(…)` isn't a colour. Use a hex colour, rgb(), hsl() (like `hsl(210deg 30% 36%)`), a colour name or var(--another-colour).";
    - a reference to a theme variable that isn't a colour: "Line 5: `--radius` isn't a colour, so it can't be referred to here.";
    - anything else (another rule or selector, `@import`, `@font-face`, a declaration ending in `!important`, a second `:root` block): "Line 9: only colour variables inside one `:root { }` are allowed." This is checked before the value grammar, so `!important` gets this sentence;
    - a name set twice: "Line 12: `--bg` is set twice.";
    - a reference that loops, through the upload or the defaults: "Line 3: `--surface` refers back to itself through `--focus-0`." (the default has `--focus-0: var(--surface)`). The browser would blank every card's background;
    - not UTF-8: "The theme file must be UTF-8 text."; over 64 KB: "The theme file can be at most 64 KB."; no colours at all (an empty file or an empty `:root {}`): "The theme file sets no colours."
  - **Only real changes are stored.** A value equal to the default (the same colour, as above) is dropped. So a school that re-uploads the full download with three colours changed stores three, the card says "3 colours changed", and later Mathion colour fixes still reach the other 70.
  - **After a release.** Stored names that a later release removes are ignored. A stored `var()` whose target is no longer an overridable colour, or that now loops, is left out when the stylesheet is written and when the card counts changes, and logged once; otherwise it would blank that colour everywhere. "The stored changes in use" means the set without these. Everywhere else in this spec, "saved" or "stored" colours means the changes in use: the check's comparisons, whether Reset is offered (D2), and whether the page has a theme link and version (D13). So the dialog, the card and the page agree. Writing is the exception: Reset, an upload and `mathion branding reset` replace the whole stored set, left-out entries included, so nothing dead stays behind.
  - **A file that matches Mathion's colours** (for example the unchanged download of an unbranded site) is accepted. With saved changes, it works as Reset, and the check says so with one sentence, in place of the per-colour "puts back" warnings: "This file matches Mathion's colours, so saving it removes your changes." With none, Save stays blocked: "This file matches Mathion's colours." (this sentence wins over the next one).
  - **A file that matches the saved colours** (for example the school's own download, unchanged) changes nothing, so Save stays blocked: "This file matches the saved colours."
  - **The stylesheet is the server's own.** The server writes it from the stored changes in canonical form, as `:root:root { … }` (D13). The uploaded text is never stored or served, so no other server is ever contacted because of a theme. It's served as `text/css; charset=utf-8` with `X-Content-Type-Options: nosniff`.
  - **Preview** (as drawn in `dialogs.html`, made honest by review). Once a file is checked, the dialog shows a small sample in the new colours:
    - a header strip with the logo and a pill;
    - a card with text and a link;
    - the real primary and secondary `Button`;
    - two real `StatusBadge`s.

    The sample sits in a box that declares the full merged set (the defaults plus the accepted changes, the 4 `var()` colours declared again there), applied with `style.setProperty`. It never applies the raw file. The box is `inert`, so keyboard users don't tab through sample buttons that do nothing.
  - **Readable colours** (mine; pairs widened from review). When the merged colours put text on a background with a contrast below 4.5:1, the dialog warns and names the pair, but still lets the superuser save. Example: "Text may be hard to read: `--muted` on `--surface` is 3.1:1 (4.5:1 recommended)." The warning stays on the Colours card after Save. The checked pairs:
    - `--text`, `--text-2` and `--muted` on `--bg` and on `--surface`;
    - `--primary` on `--surface` and on `--bg` (links and secondary buttons);
    - `--primary-text` on `--primary`, `--primary-press`, `--danger` and `--success`;
    - the toast's text on its backgrounds;
    - each status and state badge's text on its background;
    - `--gold-text` on `--gold-soft`;
    - `--danger` on `--surface`.

    The builder may add pairs that pass 4.5:1 on the defaults; a test checks that the default colours give no warning. Contrast is WCAG's, with `var()` resolved through the merged set. A translucent text colour is blended over the pair's background; a translucent background over `--bg`; a translucent `--bg` over white.
  - **Reset to default** removes every stored change.
  - **Where it applies** (user's): everywhere, including the sign-in page and the superuser panel.

### Footer

- **D11. "Powered by Mathion"** (user's). A thin line at the bottom of every page: "Powered by Mathion", where "Mathion" links to https://mathion.org. It's there whatever the branding is.
  - **One footer, in the app shell** (mine, from review). `App.svelte` draws it once, after the page. The whole shell (header, page, footer) is one column at least as tall as the window (`min-height: 100dvh`, with `100vh` as the fallback, so on iOS Safari the footer isn't hidden under the toolbar), and the page area takes the space that's left (`flex: 1`). So on a short page the footer sits at the window's bottom with no scrolling, and on a long page it comes after the content. Inside, the page area is plain block layout, so pages keep their own centring (`margin: 0 auto`). Neither the column nor the page area sets `overflow`: the window stays the scroller, so sticky table headers and the player's scroll padding keep working.
  - **Where it's left out** (mine): the whole item player route. Its bottom bar is fixed and see-through, and the footer would show between its arrows. It's also hidden while the session is still loading (the spinner alone). The sign-in page, the superuser panel and the not-found page have it.
  - **The link opens in a new tab** (user's, as the one exception to the same-tab rule, 2026-11-05), with `rel="noopener noreferrer"`, so a student doesn't lose their place in a course by following it.
  - It must fit at 400 px phone width on student screens.

### Serving, storage and timing

- **D12. Stored in the database** (mine). The name, the two images (each at most 1 MB, with their width and height) and the stored colour changes live in the database, apart from the Settings row, so the frequent Settings reads never load images. A backup and restore (`cli/cmd/backup.go`, which holds the database) carries the branding with no extra step.
  - Each card's save writes only its own values, under a row lock, like Settings' locked row. The image bytes are kept where locking and reading the small row doesn't load them (their own table, or deferred columns), so a name save never pulls 2 MB.
  - The public reads load the name, the image sizes and the content hashes, never the image bytes, except when serving the image itself.
  - Each change is logged with the superuser's id and what changed (the item, not the content).
- **D13. Public files, cached by content; the page never cached** (mine, from review). The sign-in page shows the branding too, so the browser gets it from public addresses that need no sign-in.
  - **Addresses** under `/api/branding/` (not under `/api/superuser/`, whose responses are never cached, and before the app's `/api/…` not-found catch-all; the dev server's proxy forwards `/api`):
    - `logo.png` and `icon.png` answer the uploaded image, or 404 when none is uploaded. The default logo is the drawn lockup, not a file, and the inline data says `logo: null`.
    - `icon-default.svg` (as `image/svg+xml`; it's Mathion's own file, not an upload), `icon-default-32.png` and `icon-default-180.png` always answer. All the image files share one code path: `nosniff`, and the version and `ETag` rules below.
    - `theme.css` answers an empty stylesheet when no changes are in use, and the page then has no theme link at all, saving a request on unbranded sites.
    - `/favicon.ico` answers the uploaded icon, or the 32 px default. It's registered whether or not the built frontend exists, before the SPA fallback, so tests without a build reach it.
  - **The icon links in each state** (mine, from review). Firefox and Chrome prefer an SVG icon when one is offered, so the default's SVG link must go when an icon is uploaded:
    - **no upload:** `<link rel="icon" type="image/svg+xml">` to `icon-default.svg`, `<link rel="icon" type="image/png" sizes="32x32">` to `icon-default-32.png`, and `<link rel="apple-touch-icon">` to `icon-default-180.png`;
    - **an upload:** only `<link rel="icon" type="image/png">` and `<link rel="apple-touch-icon">`, both to `icon.png`.
  - **Versions are content hashes.** Each file's version is a short hash of the exact bytes served; the theme's is taken from the text the server writes, on each read. With `?v=<that hash>`, the answer is cached for a year as immutable. Without it, or with an old one, it's `no-cache` with an `ETag`, so a revalidation costs a 304. The bytes come from the database, not files, so the endpoints compare `If-None-Match` themselves and answer `HEAD`. A restore or a release that changes the bytes changes the hash, so nobody keeps an old logo.
  - **The page's head is filled by the server.** When the server sends the app's page (the SPA fallback, `/` and `/index.html` alike), it fills in, escaped (D3):
    - the title;
    - the icon links (above) and `apple-mobile-web-app-title`;
    - `<link rel="preload" as="image">` for the logo, when one is uploaded;
    - the theme stylesheet link, when changes are in use, placed just before `</head>`, after the built CSS;
    - every filled tag carries a `data-branding` attribute, so the app (the panel after a save, the dev fallback) finds and replaces exactly those. The tags the app writes itself carry it too;
    - an inline `<script type="application/json" id="branding">` with the name, the logo's version, width and height (`logo: null` when none), the uploaded icon's version (`icon: null` when none, so the app knows which link set D13 uses), and the theme's version (`null` when no changes are in use).

    The app reads that data synchronously at startup (`lib/branding.svelte.ts`, which replaces `lib/branding.ts`; its importers and tests move with it), so the right logo, title and colours are there from the first frame. The page itself is sent with `Cache-Control: no-cache` and no file-based `ETag` or `Last-Modified`. Panel addresses keep their `no-store`.
  - **Markers, so the fill can't miss silently** (mine, from review). `frontend/index.html` carries explicit markers where the server fills in. The server reads the built page once, at import, next to the existing check for the built frontend (so the backend tests, which don't run the app's startup hooks, see it), and checks the markers there; if they're missing, it logs a warning and sends the page unfilled. Each request fills that kept copy.
    - **Tests:** a backend test fills the tracked `frontend/index.html` with Vite's two tags appended (a module script and a stylesheet link, as the build writes them), so the markers are checked on every run, CI included, where `dist/` doesn't exist. A second test fills the real built `dist/index.html` when it exists.
    - The Safari pass includes one step on a production build, since the dev server never runs the fill.
  - **The theme wins by specificity.** The written stylesheet uses `:root:root`, so it beats the default `:root` wherever the links end up.
  - **One branding read that never fails** (mine, from review). It opens its own short database session, with every error caught around the whole read, so a failure never aborts the caller's transaction (the dispatcher's batch, the PIN send). On a failure it answers the last branding it read successfully, kept in memory (the name, the image sizes, the hashes and the written theme text: a few KB), and logs once per outage (the first failure after a success, or after startup). So during a short outage `theme.css` is still served. The images aren't kept in memory: an image address that can't read its bytes answers 304 when the browser's `ETag` matches the kept hash, else 503 with `no-store` (never 404, never the year-long cache), and a browser that already has the image keeps showing it. With none yet, for example when the table is missing because a fresh install starts the app before migrating, it answers the defaults ("Mathion", no logo, the default icon, no theme). Settings' `load()` handles only a missing table, so this one is wider. The page fill, `/api/auth/config`, the `/api/branding/` files and the three email builders (D3) all use it.
  - **The dev server** (Vite) serves its own `index.html`, so the head is never filled there. When the inline data is missing or can't be parsed, `main.ts` awaits the same values from `/api/auth/config` before mounting the app, in an `async` start function (a top-level `await` fails the build at Vite's default target), then adds the title, the icon links and the theme link itself, and waits for the theme link's `load` or `error` before mounting, as D14 does, so even the dev server doesn't flash Mathion's colours. On every page, filled or not, `main.ts` makes one `/api/auth/config` request at startup and hands the answer to the upload limit (`loadUploadLimit`), so Settings' upload limit keeps working as today; the inline data doesn't carry it. `main.ts` awaits that request before mounting only when the inline data is missing or can't be parsed. `getAuthConfig()` itself stays unmemoised. The sign-in page keeps its own request when it mounts, so it sees settings saved since the page loaded (for example the email switch), and its config tests stay as they are (its "runs this Mathion" test changes with D3's wording). `lib/branding.svelte.ts` itself never fetches when imported, so component tests don't fetch. Links the app writes to the default icon files carry no `?v=` (the app doesn't know their hashes); a revalidation costs a 304, and only the app's own fallback and the panel after an icon Reset do this. If that read fails, the app mounts with the defaults; it never stays blank. This fallback isn't limited to dev: it also covers a production page sent unfilled because its markers were missing. This keeps the Safari passes on the dev server honest (mine; no Vite plugin).
  - `/api/auth/config` also carries the name, the versions, and the logo's width and height, for the dev server.
- **D14. When a change shows** (mine). For everyone, on their next page load (the page is never cached, D13). Pages already open keep the old look until reloaded. Safari may keep an old tab icon longer (D6).
  - **The superuser's own panel shows the change at once after Save.** Each save commits first, then answers the whole Branding read, as Settings' saves do: the cards' data, the stored changes and the contrast warnings, and the public branding (the name, the versions, the logo's width and height). So the cards and the download never show values from before the save. `lib/branding.svelte.ts` is a reactive store, so the panel shell's logo follows it, and the panel sets the title and adds, swaps or removes the icon and theme links itself. A new theme link is added before the old one is removed (on its `load` or `error`), so the panel doesn't flash Mathion's colours.

### Recovery

- **D15. A way back from the server** (mine). If a theme makes even the panel hard to use, `mathion branding reset` on the server removes the colour changes. Only colours can lock the panel, so the name, logo and icon stay; `mathion branding reset --all` puts every item back to its default. It runs `python -m mathion.superuser branding-reset` (with `--all` when given) in the app container with `compose exec -T`. The command prints what it reset; that printed line is the record (it runs in its own process, so nothing reaches `docker compose logs app`).
  - **The confirm prompt is in Go**, before the command runs (`compose exec -T` has no terminal), as `reconcile.go` does. It names what goes ("This removes the colour changes." or "This resets the site name, logo, tab icon and colours."). `--yes` skips it.
  - **It captures the command's error output** (mine, from review). `mathion superuser` runs through `Runner.Run`, which passes the error output straight to the terminal and can't read it. This command runs through `Runner.Stream`, which returns a typed `compose.ExitError` with the captured error output.
  - **Against an older image** (between the CLI release and the image update), Python's argument parser exits with code 2 and "invalid choice". On that exit code and text, the CLI prints: "This server's Mathion is too old for branding reset: run `mathion update` first." On any other error, it prints the captured error output; that's where Docker Compose's "not running" message arrives when the app isn't running.
  - The man page (`deploy/man/mathion.1`) and the README gain the command.
  - **Release order:** like the Settings slice, this ships as a `mathion` CLI release after the image (`docs/release-notes/settings-release-order.md`). Until then, the release note names the way back by hand: `docker compose exec -T app python -m mathion.superuser branding-reset`. The release itself is the user's step.

## 4. Constraints

- **No new packages**, in Python, Go or JavaScript. PNG checks, CSS parsing and contrast are small own code.
- **Svelte 5** for the frontend; component tests use `mount`/`unmount`/`flushSync`.
- **Same-tab rule:** everything in Mathion opens in the same tab; edits open modal dialogs. The footer link to mathion.org is the one deliberate exception (D11).
- **One Edit dialog per row** (the panel's rule).
- **400 px phone width** matters for student screens: the header logo, the sign-in page and the footer must fit.
- **Panel writes and checks** go through the panel guard and CSRF, like Settings.
- **Safety:**
  - an uploaded file is never served with a type the browser could run;
  - the theme stylesheet is always written by the server from checked values;
  - every branding value placed in HTML is escaped (D3).

## 5. Inputs a person will meet (for the plan's Review Focus)

- **Name:**
  - an empty name;
  - a name with a line break, or a U+2028 line separator, pasted from a document;
  - a 61-character name;
  - a name with emoji or accented letters (allowed; must survive an email subject);
  - names like `</title><script>alert(1)</script>` and `</script><script>alert(1)</script>` (shown as text, in the title and in the inline data);
  - a name of only zero-width spaces (refused, with the hidden-character sentence);
  - a right-to-left name holding U+200F, pasted from a document (allowed);
  - a name with a tab in it (the tab becomes a space).
- **Logo:**
  - a JPEG renamed to `.png`;
  - an SVG;
  - a 5 MB photo;
  - a 2000 × 400 PNG (scaled down);
  - a 600 × 16 PNG (accepted, with the soft and the very-wide notes);
  - a 5000 × 5000 PNG under 1 MB (refused);
  - a 1600 × 100 banner (shows under 20 px tall, the dialog says so);
  - a transparent PNG on a coloured header;
  - a PNG with a broken chunk CRC, and one the browser can't decode (both refused before Save);
  - a PNG with bytes after `IEND` (accepted);
  - a crafted PNG with width 0 (refused);
  - a logo re-exported on disk while the dialog is open (the chosen bytes are what's saved);
  - a logo just under 1 MB behind a proxy with a 1 MB limit (the proxy's 413 sentence).
- **Tab icon:**
  - a wide PNG (accepted, with the not-square note);
  - a 16 × 16 PNG (accepted, with the soft note);
  - a 512 × 512 PNG;
  - a 2048 × 2048 PNG (refused);
  - an icon uploaded: the tab shows it in Firefox and Chrome (no SVG link left);
  - `/favicon.ico` with and without an upload.
- **Theme:**
  - a file with only `--bg`;
  - a typo (`--backgroud`);
  - `--radius: 12px`;
  - `--bg: url(https://…)`;
  - `--primary: hsl(210deg 30% 36%)`, `rgba(63, 92, 119, 0.5)` and `White` (all accepted);
  - `--primary: oklch(…)` (refused, the sentence names the accepted forms);
  - `rgb(50%, 0, 0)` and `hsl(210, 30, 36)` (refused: browsers drop them);
  - `rgb(63 92 119 / .5)` (accepted, and its spaces survive into the written stylesheet);
  - `--primary: var(--backgroud)` (the "isn't a theme variable" sentence);
  - Reset pressed while a check is still running (the late answer is ignored);
  - `--primary: var(--radius)` (the "can't be referred to" sentence);
  - `--primary: #3f5c77 !important` (the `:root` sentence);
  - `--cancel-hover` set to the colour its `var()` default resolves to (stored, as a change);
  - a stored `--primary: var(--x)` after a release removes `--x` (left out, not blank);
  - a file with 30 problems (the first 20, "and 10 more");
  - a whole stylesheet copied from another site, with selectors and `@import`;
  - a file with Windows line endings or a byte-order mark;
  - `--primary: var(--danger)`;
  - `--surface: var(--focus-0)` (a loop through a default);
  - the full download re-uploaded with three colours changed (stores three);
  - the unchanged download uploaded with saved changes ("matches the saved colours") and on an unbranded site ("matches Mathion's colours"); Save stays blocked either way;
  - a second file refused after a first was accepted (nothing stays pending);
  - Mathion's default colours uploaded with and without saved changes;
  - a later upload that leaves out a colour changed earlier (it goes back, with a warning);
  - a file edited on disk after it was chosen (the chosen bytes are what's checked and saved);
  - a file that makes `--muted` on `--surface` 2:1;
  - a light `--primary` with a light `--primary-text`;
  - an empty file.
- **Recovery:** a theme where `--text` equals `--bg`; then `mathion branding reset`; the same command against an older image.
- **Timing:** two superusers saving different cards at the same moment; a student page open during a change; a restore of an older backup (the hashes change, nobody keeps the newer logo); a short database outage while pages load (the last good name and colours, not Mathion's; the logo only from the browser's cache).
- **Short pages:** the sign-in page, and a short page with the header (a course list with one course, or the not-found page while signed in), at 400 px and on a laptop: the footer at the bottom, no scrolling. A teaching Progress table's sticky headers still stick.
- **Backup:** a backup taken with branding, restored on a fresh install.
- **Dev and production:** the Vite dev server shows the branding (D13); a production build shows it from the first frame, with the filled head.

## 6. What's left to the builder

- The table's shape (D12).
- How the server fills the page's head (D13), within its rules.
- How `theme_vars.py` is generated (D8), within its test.
- How the preview is laid out, within D10's content.
- The contrast code (WCAG relative luminance), within D10's rules.
- How the default tab icon PNGs are made once from the SVG (D6).
- Whether the image answers skip the app's gzip (for example with `Content-Encoding: identity`); either is fine.

## 7. Out of scope, noted for later

- The **Setup checklist** page, the roadmap's next panel page.
- Fonts and a dark mode, if a school asks.
