# Visual refresh — Polish 2: named items

**Status:** rev 12 (2026-10-22), approved; all six tasks done, Safari pass.
- Rev 2 folded in spec review round 1, the user's decisions D56–D58 and the D54 amendment.
- Rev 3 folded in round 2 (`spec-r2-*.md`).
- Rev 4 folded in round 3 (`spec-r3-*.md`) and the user's decision D59.
- Rev 5 folds in the round-4 minors (`spec-r4-*.md`; no Critical or Important findings in round 4).
- Rev 6 adds the user's decision D60 (the ring colour follows the element), made at Task 1's look review.
- Rev 7 adds D61 (Progress grid cells ring near-black), from Task 1's review round 1.
- Rev 8 adds the user's decision D62 (the player strip as tabs), made at Task 2's look review.
- Rev 9 adds D63 (headings take relative margins), made at Task 3's look review.
- Rev 10 adds D64 (no new package for bare URLs: an own markdown-it rule), made at Task 6's start, D65 (a bare address holds only URL characters; its text is exactly as typed), made at Task 6's commit OK, and D66 (an address that runs into a letter stays plain), from Task 6's review round 3.
- Rev 11 widens D66 to every inline seam (emphasis, code, math right after an address), from the whole-branch review.
- Rev 12 adds D67 (no focus ring on the video and app frames), from the Safari pass.

**Branch:** `feat/visual-refresh-polish2-named-items`, cut from the Polish 1 tip `ba8ace4`. It stays local: no push, no merge.
**Workspace:** `.superpowers/sdd/2026-10-17-visual-refresh-polish2-named-items/` (`decisions.md`, the mock-ups `page-ground-mock.html` and `content-scale-mock.html`, the review rounds `spec-r1-*.md` and `spec-r2-*.md`).

## Goal

Earlier slices deferred six named items "to the end". Polish 2 closes them:
- a keyboard focus ring people can see, also in High Contrast;
- reduced motion;
- a page ground that reads as depth;
- one style for the content teachers write, with links that look like links and open safely;
- a styled 404 page;
- clickable bare URLs.

Polish 1 (confirms) is done. Polish 3 (triage of the reviewers' minors) follows.

## Scope

**In:**
- the focus ring and reduced motion (D48, D49);
- the page ground and the reading sheets (D50, D56);
- authored content at two scales, with its links (D51, D52, D57, D58, D59);
- the 404 page (D53);
- bare URLs linkified (D54, D55).

**Not in** (Polish 3 candidates; Task 1 adds the new ones to the Polish 3 list in `docs/backlog/polish1-confirms-debt.md`):
- the error banners' `--status-rejected-*` pinks beside the danger panel;
- the VersionsPage create form's silent discard on Cancel and links;
- the reviewers' minors from every slice;
- the existing per-component forced-colors rules, the seven `:focus { outline: none }` heading rules and the hidden inputs' `box-shadow: none` rules. They stay, even where the new global rules make them redundant or no-ops;
- focus not obscured in the Progress and Submissions grids (WCAG 2.4.11: a cell scrolled under the sticky columns or header);
- three fields that carry `aria-invalid` but have no error border (the VersionEditPage and BlockAccordion create fields, the AccordionHeader title field);
- internal links in authored content do a full page reload. There is no router link interception, so a mid-quiz click on an internal link still loses unsubmitted answers. Routing same-origin links through `navigate()` is the candidate fix.

## Decisions

All of these are the user's, made in the brainstorm on 2026-10-17 and 2026-10-18.

- **D48 — Focus ring: a ring on controls, and fields keep theirs.**
  - Buttons, links, icon buttons, checkboxes, cards, accordion headers and the strip icons show `outline: 2px solid var(--primary); outline-offset: 2px`. This is the Polish 1 confirm ring.
  - Text fields (text-entry `input`, `textarea`, `select`) keep today's intended look: a `--primary` border with the soft halo.
  - In High Contrast (`forced-colors: active`) every focusable control gets an outline.
  - This is a deliberate departure from the design handoff (`docs/design/visual-refresh/base.css:132`), whose halo measures 1.16:1 against `--surface`.
- **D60 — The ring colour follows the element** (user, at Task 1's look review).
  - Header nav links ("Authoring", "Teaching"): dark amber `--gold-text` (#7A5410). The logo gold `--gold` (#E8A317) is 2.17:1 on white, below the 3:1 a focus indicator needs.
  - Gray buttons: dark gray `--muted` (#5A616E). These are the InlineConfirm and DangerConfirm Cancel buttons and the ghost Buttons ("Logout", "Collapse all").
  - Red elements: crimson `--danger` (#C8102E). These are the danger and danger-off Buttons, the red InlineConfirm and DangerConfirm buttons and the trash IconButtons.
  - Everything else: steel blue `--primary`.
- **D61 — Progress grid cells ring near-black** (user, after Task 1's review round 1). A cell's ring is drawn inset on its own heat fill, where `--primary` is 2.38:1 on `--heat-4`. Every cell, empty or filled, rings in `--heat-fg` (#16181D, the cell text colour): 6.05:1 or more.
- **D49 — Reduced motion: the knob jumps and the spinners keep turning.**
  - Under `prefers-reduced-motion: reduce`, the Switch knob moves without its 0.12s slide.
  - The four spinners (Button, InlineConfirm, DangerConfirm, Spinner) keep rotating. They are the only sign that something is busy, which is essential motion.
- **D50 — The page ground is a clear tint, `#F2F3F6`.** The user chose it from a three-way mock-up (`page-ground-mock.html`).
  - Every page shares the editor's existing `--focus-page` shade.
  - White cards and the white header read as steps above it.
- **D56 — A white sheet behind reading content.** The player's content area (page content, quiz, video, app) and the mini-project page sit on a white card, so their grey tints read as before on the new ground.
- **D62 — The player strip as tabs** (user, at Task 2's look review, after the variant overlay `strip-variants.html`).
  - The strip stands on the sheet. The other marks float 6px above the sheet's edge (the gap was 20px).
  - The current item is a white tab, 32px wide (the others stay 22px). Its 2px `--border` runs on top, left and right, none at the bottom, and it lies over the sheet's top edge, so tab and sheet read as one shape.
  - Both sheets (the player and the mini-project page) get a 2px border.
  - Done items are pale gray (`--border` fill, `--border-strong` edge, `--muted` glyph, about 5:1). Not-done items are steel blue (`--primary` fill, white glyph), like the main buttons.
  - Only in the player strip. The teacher breakdown keeps blue = done; the course rows and the editor keep the shared look.
- **D63 — Headings take relative margins** (user, at Task 3's look review). One rule, `margin: 1em 0 .5em`, for all six levels and both scales, so the space follows each heading's own size. A paragraph's bottom margin collapses into the next heading's top margin; between two headings the gap is the second one's 1em.
- **D67 — No focus ring on the video and app frames** (user, at the Safari pass: "Drop the frame ring"). CSS has no hook for a focused frame: Safari showed no ring with `:focus-visible`, `:focus` or `:focus-within` on the `<iframe>` (checked on screen, twice, after a reload), and in Chrome a focused frame matches only `:focus-within`, so Task 1's inset `:focus-visible` rule never drew in Chrome or Safari. Chrome could ring a frame through `:focus-within`; the user chose no ring over a Chrome-only one. The rule is removed from `VideoFrame.svelte` and `InteractiveFrame.svelte`, and a gate row keeps any frame focus rule out. When Tab enters a video, focus lands on the embedded player's own controls, which draw their own focus; an app frame shows whatever focus its page draws. A first answer ("Ring on any focus") rested on the wrong premise that `:focus` would match. For the beta keyboard pass.
- **D64 — No new package for bare URLs** (user, at Task 6's start: "Do not install any additional packages, the amount of external dependencies must be limited", then "Own small rule"). D54's behaviour stands, built as a small markdown-it core rule in `markdown.py` on the markdown-it-py already installed. `linkify-it-py` is not added and `pyproject.toml` does not change.
- **D65 — A bare address holds only URL characters, shown as typed** (user, at Task 6's commit OK: "Do not allow spaces and other strange symbols which usually are not used in URL"). Only the characters RFC 3986 allows in a URL belong to a bare address: letters A–Z, digits, `-._~:/?#[]@!$&'()*+,;=` and `%`. The address ends at anything else (a space, `|`, `{`, `^`, `\`, a letter such as `é` or `п`), and an address that starts with such a letter is not linked. The link text is the address exactly as typed: `%20` is not shown as a space and an `xn--` host is not shown as look-alike letters.
- **D66 — An address that runs into a letter stays plain** (user, after Task 6's review round 3: "Leave it plain"). When the character right after a bare address is a letter, digit or combining mark (`https://bücher.de`, `https://x.org/café`, a Kelvin sign, also written as an entity such as `&uuml;` or an escape such as `\_`), or by emphasis, code or math (`#object.__init__`, `files/__pycache__/x`), the whole address stays plain text, up to the next space, including any address inside it: a cut link to `https://b` would open another site. Other non-URL characters (`|`, `^`, `{`, quotes, brackets) still end the address, and the part before them is linked, so `„https://x.org“` and `«https://x.org»` work.
- **D51 — One shared style for authored content, on every surface.**
  - It applies wherever teachers write markdown: page content, quiz prompts, explanations, course and version info, mini-project assignments, and the editor's preview and question cards.
  - Smaller surfaces use a compact scale.
- **D52 — The build is one global stylesheet plus a class.**
  - `styles/content.css` defines `.prose` (the page scale) and `.prose.compact`. Rev 1 said `.md`; that name is IconButton's default size class, so rev 2 renamed it.
  - Each surface keeps its own element, binding and attachments, and adds the class.
  - The scattered per-surface `:global` content rules go.
- **D57 — Links in authored content are always underlined:** a thin underline at a 2px offset, in `--primary`. App chrome links do not change.
- **D58 — External links in authored content open in a new tab** with `rel="noopener noreferrer"`, on every surface. Links inside Mathion stay in the tab.
- **D59 — Links to Mathion's own files open in a new tab** (decided after round 3). These are same-origin `/assets/…` and `/api/…` links, such as a teacher's PDF, and they open like external links, so a student mid-quiz keeps unsubmitted answers. Links to Mathion pages (a course, a sequence) stay in the tab.
- **D53 — The 404 page uses ErrorState, and its button names the place.**
  - The card reads "Page not found" with one line and one secondary button.
  - The button reads "Back to courses" or "Back to teaching", whichever is the person's start page. Signed out, it reads "Sign in".
- **D54 — Linkify only full URLs (amended after round 1):** only text starting with `http://` or `https://` becomes a link.
  - `www.` addresses, bare domains (`example.org`), file-like names (`numpy.py`), e-mail addresses, `ftp:` and `//` addresses all stay plain text.
- **D55 — Stored HTML changes only on the next save.**
  - Existing content gets links when it is next edited, published or cloned.
  - There is no backfill or migration, because no real courses exist yet (pre-beta).

## Cascade facts this spec relies on

Checked in `frontend/dist/_app/index-*.css` on the Polish 1 tip.
- **Global CSS is last in the bundle.** `main.ts:9` imports `app.css` after `App.svelte`, so reset, theme, base (and content.css, imported after base) are the last ~4 KB of the single chunk: `:root` at byte 132409 of 135155, and the last `.svelte-` rule ends before it. **At equal specificity, a global rule wins over a component rule.**
- **Svelte 5 scoping.** A component's selector gets its hash once, on the first compound. Later compounds get `:where(.svelte-h)`. So:
  - `.input` → `.input.svelte-h` is (0,2,0);
  - `.input.error` → (0,3,0);
  - `.x[aria-invalid='true']` → (0,3,0);
  - `.create input` → `.create.svelte-h input:where(.svelte-h)` is (0,2,1);
  - a bare element rule, `textarea:focus-visible` → `textarea.svelte-h:focus-visible`, is (0,2,1).
- **So a scoped override of the global field rule must be (0,3,0) or more**: a class plus `:focus-visible` (`.x:focus-visible` → `.x.svelte-h:focus-visible`), or a compound. At (0,2,1) it ties the field rule and loses, because the global rule comes later.

## Focus ring and reduced motion (Task 1)

### The global rules
- **Today.** `base.css:22-26` is the only focus indicator for most controls: `:focus-visible { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }`.
  - The halo (`#EAEFF4`) measures 1.16:1 against `--surface`.
  - Forced-colors mode drops `box-shadow` and keeps `outline: none`, so these controls show no indicator at all (backlog `global-focus-ring-invisible-in-forced-colors.md`).
- **New rules.** In `base.css` they replace the old one, in this order:
  ```css
  :focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; }
  :is(input:not([type=checkbox], [type=radio], [type=file], [type=range], [type=color], [type=button], [type=submit], [type=reset]), textarea, select):focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-soft);
  }
  /* Focus parking spots: headings and panels that script focuses after an action. */
  [tabindex="-1"]:focus-visible { outline: none; }
  @media (forced-colors: active) {
    :focus-visible:not([tabindex="-1"]) { outline: 2px solid Highlight !important; }
  }
  ```
- **The field rule** covers text entry only.
  - Native checkboxes, radios and the rest take the ring. Visible checkboxes that change: the DangerConfirm acknowledgement (`DangerConfirm.svelte:76`), the roster selection boxes (`RunRosterTab.svelte:781`, `:808`) and the assets boxes (`RunAssetsTab.svelte:731`, `:754`).
  - The hidden radios and checkboxes (quiz options, Login, the type pickers, the mini-project `.drop`) are `opacity: 0`. They draw their ring on the label, so nothing changes for them. Their `input:focus-visible { box-shadow: none }` rules become no-ops and stay (see Scope).
  - Its specificity is (0,2,1). By the cascade facts above, it wins over every scoped field rule up to (0,2,1), including ties such as `VersionsPage`'s `.create input`. It loses to scoped rules of (0,3,0) and up: two classes, or a class plus an attribute. That covers the error states, `.input.error` (`Input.svelte:38`) and the class-plus-`[aria-invalid='true']` rules, so their red border stays on focus.
  - Three fields carry `aria-invalid` with no error border at all: the VersionEditPage and BlockAccordion create fields and the AccordionHeader title field. They turn blue on focus as any field does. This predates Polish 2; the audit notes it, and it goes to the Polish 3 list.
  - **Two error rules are single-class** and would turn blue on focus: `NewRunModal.svelte:229` `.nr-invalid` and `MiniProjectModal.svelte:752` `.mpm-invalid`. `MiniProjectModal.focusFirstError()` (`:303`) focuses exactly that field after a failed submit. Both become compound, `.nr-input.nr-invalid` and `.mpm-input.mpm-invalid` (0,3,0), with gate rows.
- **The field audit.** Task 1 lists every field from dist: its class, its border rule, that rule's specificity, and whether the field turns blue on focus. A field needs its own scoped `.x:focus-visible { border-color: var(--primary); }` (at least (0,3,0), see Cascade facts), placed before its error rules, only where a (0,3,0)+ rule sets its rest border. The table is expected to be mostly "no rule needed".
  - The files with text fields: BlockAccordion (`input.add-input`), MarkdownEditor, MiniProjectModal, NewRunModal, RosterImportModal, RunProgressTab, RunRosterTab, RunSubmissionTab, RunTeachersTab (`.t-input`), `ui/Input`, VersionEditPage, VersionsPage, DashboardSidePanel, and the files whose fields already have their own focus rule (InlineInput, InlineName, KeyAnswer, NewQuestionModal, ItemEditorModal, NewItemModal, VersionSettingsModal, VideoBody).
  - AssetSidebar and AppBody have only file inputs.
  - **MarkdownEditor.** Its textarea has no class, `border: 0`, and sits flush inside `.md-card { overflow: hidden }`. Two rules:
    - **The card shows the focus:** `.md-card:has(textarea:focus-visible) { border-color: var(--primary); }` (0,3,1). It uses `:has()` rather than `:focus-within`, so a focused Write/Preview tab does not also turn the card blue.
    - **The halo goes, and High Contrast gets an inset outline:** `.md-card textarea:focus-visible { box-shadow: none; outline-offset: -2px; }`. It compiles to (0,3,1), so it beats the field rule; a bare `textarea:focus-visible` would tie and lose.
      - The halo would otherwise be clipped, and its top would paint over the tab bar.
      - In normal mode the outline is `none`, so the offset changes nothing there. In forced colors the global outline is drawn inside the clip, where the card's border colour is overridden.
  - The audit flags any other text field that sits flush against an `overflow` clip, which gets the same `outline-offset: -2px`.
- **Parking spots.** Script moves focus to `tabindex="-1"` targets after an action. These now show no ring in either mode. That matches the seven `:focus { outline: none }` heading rules that already do this on purpose: the six run-tab `h2:focus` rules (RunTeachersTab, RunOverviewTab ×2, RunGroupsTab, RunMiniProjectsTab, RunAssetsTab) and `RunListPage.svelte:216` `h1:focus`. The targets:
  - the VersionsPage `<h1>` (`VersionsPage.svelte:286`), the fallback after a confirm's Cancel or withdraw;
  - the side panel's title and Evaluation heading (`DashboardSidePanel.svelte:689`, `:714`);
  - the modal panel (`Modal.svelte:157`), the last-resort target when nothing inside is tabbable;
  - the run-tab and run-list headings.

  No roving-tabindex widget exists. AccordionHeader's `tabindex={-1}` chevron is `aria-hidden` and never focused. So no real control loses its ring.
- **Why `!important` in forced colors.** Eight components set `outline: none` in their own scoped `:focus-visible` rules: ItemEditorModal, NewItemModal, VersionSettingsModal, VideoBody, InlineInput, KeyAnswer, NewQuestionModal and InlineName. A scoped rule beats a global one, so without `!important` those controls would stay invisible in High Contrast.
  - The forced-colors rule sets only `outline` (width, style, colour), never `outline-offset`. Components that draw an inset ring with a negative offset keep it.
  - The 16 existing per-component `@media (forced-colors: active)` blocks become partly redundant. They stay, out of scope.

### Own rings: the cascade is per property
An own `:focus-visible` rule replaces the global ring only for the properties it sets. A rule that draws its ring with `box-shadow` and does not set `outline` now gets the global outline as well.
- **SequenceLink and MiniProjectLink.** `.row:focus-visible { box-shadow: inset 0 0 0 2px var(--primary); }` (`SequenceLink.svelte:51-53`, `MiniProjectLink.svelte:82-84`) sets no `outline`.
  - Without a fix, the course page would show an inset ring plus an outset outline, clipped by `BlockGroup .block { overflow: hidden }` and painted over the neighbouring rows.
  - Both rules gain `outline: none`.
  - Their forced-colors rules keep `outline-offset: -2px`, so the global rule then draws an inset Highlight ring.
- **Already safe.** The other box-shadow rings sit on labels (`label:has(input:focus-visible)` in Login, the quiz options, the pickers, `.drop`, `.sp-seg-opt`), where the outline lands on the hidden input. The Button, InlineConfirm and DangerConfirm rings set `outline` themselves.
- **The own-ring files**, for the record:
  - SequenceLink, MiniProjectLink and Login;
  - the four quiz question components;
  - ItemTypePicker, QuestionTypePicker, ChoiceRow, ChoiceAnswers;
  - QuestionCard `.qexpl-add`, DashboardSidePanel `.sp-seg-opt`, the MiniProjectDetailPage `.drop`;
  - InlineConfirm, DangerConfirm, and Button `.secondary` (D44) and `.danger`;
  - the field rules (InlineInput and others).

  ItemIcon has no rule and takes the global ring.
- **Button's halo.** Button `.primary` and `.ghost` have no own focus rule. They now take the global ring, which retires the Polish 1 spec's note that they keep the halo "until Polish 2" (`2026-10-14-visual-refresh-polish1-confirms-design.md:207`). No gate row pins that halo today.

### Ring colour (D60)
- **Mechanism.** The global ring reads `var(--ring, var(--primary))`. A coloured element sets `--ring` in its resting rule, never in a new `:focus-visible` selector, so the Polish 1 guards ("fills only an enabled, idle button") stay exact. The three own outline rules (InlineConfirm `.ic-btn`, DangerConfirm `.dc-btn`, Button `.danger`) read the same variable. Button `.secondary` stays `var(--primary)`.
- **Who sets it:**
  - AppHeader `.links a`: `--ring: var(--gold-text)`;
  - Button `.ghost`: `--ring: var(--muted)`; Button `.danger` and `.danger-off`: `--ring: var(--danger)`;
  - IconButton `.danger` (trash): `--ring: var(--danger)`;
  - InlineConfirm `.danger`: `--ring: var(--danger)`; `.cancel`: `--ring: var(--muted)`;
  - DangerConfirm `.dc-force`: `--ring: var(--danger)`; `.dc-cancel`: `--ring: var(--muted)`;
  - RunProgressTab `.cell-btn`: `--ring: var(--heat-fg)` (D61).
- **A guard.** The gate counts the `--ring` declarations in dist (ten), so a container that sets it, recolouring every ring inside, fails the gate.
- **A blocked or busy control keeps its kind's colour.** The ring names what the control does (a delete stays red), not its momentary look.
- **No new token.** `--ring` is a per-element property, not a theme token, so `:root` does not change.
- **High Contrast** is unaffected: the forced-colors rule sets the whole `outline` shorthand with `!important`.

### High Contrast: a clipped hidden radio
DashboardSidePanel's evaluation control hides its radio with `clip: rect(0 0 0 0)` (`DashboardSidePanel.svelte:1064-1074`) and draws the ring on the label as a box-shadow, with no forced-colors rule. `clip` clips the outline too, so in High Contrast nothing shows. It gains:
```css
@media (forced-colors: active) {
  .sp-seg-opt:has(.sp-radio:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }
}
```

### Inset rings where a control is flush against a clip
A control that fills its container, or sits flush against an `overflow` clip, uses `outline-offset: -2px` on `:focus-visible`, as SequenceLink already does. Named:
- RunProgressTab `.seg-btn` (inside `.seg { overflow: hidden }`, `RunProgressTab.svelte:426`);
- the MarkdownEditor Write/Preview tab buttons (flush at the top of `.md-card`) and its textarea (above);
- the Progress grid `.cell-btn` and its header `th button`s (inside `.table-scroll`);
- RunSubmissionTab's header sort buttons and `status-cell-btn`;
- the iframes in `VideoFrame.svelte:12` and `InteractiveFrame.svelte:33`, clipped by the player's `.video-card` and `.app-card` (`VideoItem.svelte:75`, `InteractiveAppItem.svelte:113`). The editor's item previews share these frames. Safari has no CSS hook for a focused frame and Chrome only `:focus-within`; the user chose no ring over a Chrome-only one (D67), so these get no rule at all.

The plan confirms each one in the built page before adding the rule.

### The tight places
These are checked in the Safari pass:
- the 22px `ItemIcon` squares in the sequence strip. At their 6px gap, a 2px ring at a 2px offset leaves 2px clear of the neighbour;
- IconButton `primary` (filled), whose ring sits off the fill.

### Reduced motion
- `Switch.svelte` gets: `@media (prefers-reduced-motion: reduce) { .knob { transition: none; } }`.
- No other rule changes. Nothing in the app scrolls smoothly; the only scroll `behavior` used is `'instant'` (`VersionEditPage.svelte:232`).

### Comments that go stale
They are updated in the same commit. They cite base.css's `outline: none`, "the global glow" or "the halo":
- `SequenceLink.svelte:54`, `MiniProjectLink.svelte:85`, `Login.svelte:138`;
- `TextQuestion.svelte:88`, `:124`, `NumericQuestion.svelte:90`, `:126`;
- `ItemIcon.svelte:31`, BlockGroup's `.acc` comment, `Switch.svelte:49`;
- the quiz and `.drop` `input:focus-visible { box-shadow: none }` comments (`SingleChoiceQuestion.svelte:220` and the others), which now say the rule is a no-op kept for Polish 3;
- gate comments `:188-189`, `:299-300`, `:626-628`, `:2208-2211`.

### Gate rows that change
- **(b4) hashless freeze** (`visual-refresh-gate.sh:524-…`):
  - `:focus-visible` is re-pinned (hash `1684b043` moves);
  - new rows for the field rule, the `[tabindex="-1"]` rule and the forced-colors rule, each in `WANT_FULL` and `WANT_ORDER` in document order;
  - the comment block explains the change, as it has for every earlier move.
- **T8a inventory:** `FOCUS` at gate `:2207` gains `outline:none`. Rows `:2230` and `:2298` follow.
- **New rows:**
  - the Switch reduced-motion rule;
  - the `.sp-seg-opt` forced-colors rule;
  - each inset `outline-offset:-2px` rule;
  - the MarkdownEditor's two rules;
  - the two compound error rules;
  - each field focus rule that the audit adds;
  - D60: each `--ring` declaration above, and the three own outline rules re-pinned to `var(--ring,var(--primary))`.
- **`EXPECTED_CHECKS`** (`gate:91`) moves by the rows added.

## The page ground and the reading sheets (Task 2)

### Tokens (`theme-default.css`)
- `--bg: #F2F3F6`, was `#FBFBFC`.
- `--focus-page: var(--bg)`. It is kept so the 5c focus-by-depth names still read. Its comment notes that a theme which changes `--bg` must keep it below `--focus-1` and `--focus-2`, which stay literals.
- `--disabled-bg: #FBFBFC` is new and holds today's disabled fill.
- `--surface-3` keeps `#FCFCFD`. Its comment becomes "a near-white tint inside a white surface".
  - decisions.md asked that `--surface-3` sit darker than the page. That is not needed, because every one of its seven uses is inside a white surface, never on the ground:
    - the modal foot (`Modal.svelte:251`);
    - the CourseCard footer (`:108`);
    - SubmissionCards (`:122`);
    - AssetSidebar (`:419`);
    - the App and Video bodies (`AppBody.svelte:317`, `VideoBody.svelte:196`);
    - the mini-project file rows (`MiniProjectDetailPage.svelte:711`).

### Disabled controls
- **Fills move to `--disabled-bg`.** Otherwise disabled controls would darken and blend into the ground:
  - `Button.svelte:70`, `:78`;
  - `IconButton.svelte:213`, `:220`;
  - `InlineConfirm.svelte:149` (`.cancel[aria-disabled="true"]`);
  - `DangerConfirm.svelte:156`;
  - `QuestionTypePicker.svelte:48`;
  - `MiniProjectDetailPage.svelte:695`.
- **Ghost and borderless controls stay transparent when disabled.** Their enabled look has no fill, so a `--disabled-bg` tile would make the disabled one look raised:
  - Button: `.btn.ghost:disabled, .btn.ghost.blocked { background: transparent; border-color: transparent; }`;
  - IconButton: `.icon-btn.borderless:disabled, .icon-btn.borderless.blocked { background: transparent; border-color: transparent; }`.

  Both come after the disabled rules they override.
- **On the ground,** a disabled bordered control is faint: `#FBFBFC` on `#F2F3F6` is about 1.06:1, with a `--border-faint` edge. The text (`--faint`) is the real cue, as today. The Safari pass checks the player's footer and the editor bars.

### The reading sheets (D56)
- **The player.** `SequencePlayer.svelte`'s `main.content` becomes the sheet:
  ```css
  .content { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px 20px; min-height: 200px; }
  ```
  D62 (rev 8) made the border 2px on both sheets; see §The player strip.
  - The padding is reference artboard 2c's card (`padding:16px 20px 20px`, the card the player comment at `:303-332` already measures).
  - The crumbs, the strip and the footer stay on the ground.
  - Video and interactive apps render inside the sheet too.
  - The 652px measure on PageItem and QuizItem is unchanged. On a wide window the sheet is wider than the text; the Safari pass judges the balance.
- **The strip and footer lose their rules.** `.strip { border-bottom }` and `footer { border-top }` separated them from content that had no box. Each would now run parallel to the sheet's edge, 20px and 24px away: two pairs of hairlines. Both borders go:
  - `.strip`: `padding: 0` (was `0 0 14px`), and `margin-bottom: 20px` stays;
  - `footer`: `padding-top` goes, and `margin-top: 24px` stays.
- **The mini-project page.** A new `div.sheet` in the loaded branch wraps everything from the title row down: header, assignment, the group and submit cards, and the history.
  - The breadcrumb moves out of `<header>` to sit above the sheet, on the ground, as the player's crumbs do.
  - The sheet takes the same declarations as the player's.
  - The cards inside (assignment, group, submit, history entries) keep their own white fill and border. On the sheet they read as bordered sections. The Safari pass asks whether they read as sections or as clutter.
  - Loading and error states stay on the ground, as on the player.
- **What the sheets fix.** These fills and lines would otherwise be lighter than, or fade into, the new ground:
  - `--surface-2` (`#F5F6F9`, 1.03:1 on the ground): code chips and blocks, the explanation panel `.exp`, the result card `.result`, the locked and neutral quiz options, the disabled T3 fields;
  - `--border-faint` and `--border`: the quiz separators and option borders;
  - the neutral StatusPill ("Not submitted") next to the mini-project `<h1>`.

  On the white sheet each reads as it did before.

### The player strip (D62)
- **ItemMark** takes an `inStrip` prop (default false) that adds the class `in-strip`; ItemIcon, which renders only in the player strip, passes it. Not `strip`: that class is SequencePlayer's dist-unique gate anchor.
  ```css
  .item-mark.in-strip.current { width: 32px; height: 31px; border-width: 2px 2px 0; border-radius: var(--radius) var(--radius) 0 0; padding-bottom: 2px; }
  @media (forced-colors: none) {
    .item-mark.in-strip.covered { background: var(--border); color: var(--muted); border-color: var(--border-strong); }
    .item-mark.in-strip.not-yet { background: var(--primary); color: var(--primary-text); border-color: var(--primary); }
    .item-mark.in-strip.current { background: var(--surface); color: var(--primary); border-color: var(--border); }
  }
  ```
  - The colours sit under `forced-colors: none`: the `in-strip` rules out-specify ItemMark's High Contrast block and would otherwise replace its solid done fill. In High Contrast the tab shape (three-sided border) still shows.
- **ItemIcon** carries the strip spacing on its button: `.icon { …; margin-bottom: 6px; }` and `.icon.current { margin-bottom: -2px; }`. On the mark, the margin would grow the inline-flex button and leave the focus ring lopsided, with its bottom stroke across the tab's joint (Task 2 review round 1).
- **SequencePlayer:** `.strip { …; padding: 0 0 0 12px; margin-bottom: 0; align-items: flex-end; position: relative; z-index: 1; }`. The 12px inset keeps a tab off the sheet's rounded corner; z-index lifts the tab over the sheet's border. `.counter` gets `align-self: center`. `.content` and the mini-project `.sheet` take `border: 2px solid var(--border)`.
- **Known limit:** when a long sequence wraps the strip on a phone, a current item on an upper row cannot touch the sheet and reads as a white button. Sequences hold 3–8 items in practice.
- **Gate:** the ItemMark inventory in section (i) gains the five rules; the (m) `.strip`, `.counter` and `.content` rows and the `.sheet` row change in place; the ItemIcon inventory gains `margin-bottom:6px` and an `.icon.current` rule; the ItemMark and ItemIcon markup pins gain `class:in-strip` and `inStrip`. `EXPECTED_CHECKS` is unchanged (2279).

### Other changes on the ground
- **FilterPills, pressed** (`FilterPills.svelte:35`) gets `border-color: var(--primary)`. Its `--primary-soft` fill and border are 1.04:1 on the ground, so the selected pill would read weaker than the white ones. FilterPills appears on the Teaching page and in RunAssetsTab (`:670`).
- **The Toast** (`Toast.svelte:19`) uses `--bg` as its text colour. It switches to `--primary-text` (`#FFFFFF`), the "text on a dark fill" token.
- **Two rules become redundant:**
  - `VersionsPage.svelte:384` `:global(body):has(.page) { background: var(--focus-page); }` goes. Its `GLOBAL_ALLOW` entry `('…VersionsPage.svelte', 'body')` (`gate:491`) goes too.
  - In `VersionEditPage.svelte:800-802`, only the d0 rule `:global(body):has(.canvas.d0) { background: var(--focus-page); }` goes. The d1 and d2 rules stay, so its `GLOBAL_ALLOW` entry stays. The R3 comment at `:797-799` and the comment at `:763` are reworded.
- **Comments that go stale:** `QuizItem.svelte:249`, `:268-269` (they reason about `--bg`), and `BlockGroup.svelte:130` ("inherits `--bg` (#FBFBFC)").

### Contrast on the ground
- **Text:**
  - `--muted` `#5A616E` is 5.62:1;
  - `--danger` is 5.30:1;
  - the `--status-*-fg` colours are 6.5:1 and up;
  - body text is far higher;
  - the new ring (`--primary`) is 6.29:1.
- **Exempt:** `--placeholder` (2.37:1) and `--faint` (1.77:1) appear only inside white fields or on disabled and decorative marks. `--ordinal` (2.52:1) is decorative by design.
- **Fills** are covered by the sheets and the FilterPills fix above.

### Gate rows that change
- **(b4):** the `:root` hash `a066ce4c` moves once more, with the usual note in the comment: `--bg` changed, `--focus-page` aliased, `--disabled-bg` added, the `--surface-3` comment changed.
- **The `var(--bg)` disabled rows** flip to `--disabled-bg`: `gate:3636`, `:3700`, `:4973`, `:4978`, `:5176`. New rows for the three recipes without one: Button `:disabled`, QuestionTypePicker and DangerConfirm.
- **SequencePlayer's (m) exact inventory** (`gate:2716-2723`) changes three rows:
  - `.strip` (no `padding-bottom`, no `border-bottom`);
  - `.content` (`:2720`, the sheet);
  - `footer` (no `padding-top`, no `border-top`).
- **New rows:**
  - the two transparent ghost and borderless rules;
  - the Toast colour;
  - the FilterPills pressed border;
  - the mini-project `.sheet`.
- **The mini-project page is not in the markup scanner's set** (`gate:1360-1402`). Its new `div.sheet` and moved breadcrumb are pinned by jsdom tests and a `d` row for `.sheet`.
- **The `body:has` rows:**
  - `gate:3759` (the VersionsPage `chk`) goes, and so does its paired `none` at `:3760`, which would otherwise pass vacuously (gate rule `:28-29`);
  - `gate:3852` (the d0 `chk`) goes;
  - `gate:4405` counts 2 `body:has(.canvas.d[12])` rules instead of 3, and its token alternation becomes `--focus-(1|2)`.
- **A `none` row** checks that no `body:has(…)` rule sets `--focus-page`.

## Authored content (Tasks 3 and 4)

### `styles/content.css`
- **The file.** A new global stylesheet, imported in `app.css` after `base.css`. Every rule is scoped under `.prose`; there are no bare element rules. No component uses the class `prose` today, and a gate row keeps it that way outside the content surfaces. Being global, content.css is last in the bundle, so no component rule out-orders a `.prose` rule at equal specificity.
- **Surface typography moves to the container.** Each surface keeps its own `font-size`, `line-height` and `color` on its box, not on `p`. Two surfaces keep theirs on `p` today, and Task 3 moves them:
  - `PageItem.svelte:81` `line-height: 1.6` moves onto `.content`;
  - `MiniProjectDetailPage.svelte:664` `font-size: 14px; line-height: 1.65; color: var(--text-2)` moves onto `.assignment-html`.

  Lists, quotes and headings on those surfaces then inherit the same metrics. That is intended, and the screenshots show it. Code blocks are the exception: `.prose pre` sets its own line-height of 1.5.
- **The rules:**
  ```css
  .prose { overflow-wrap: anywhere; }

  /* Headings. Weight 600 comes from reset.css. */
  .prose :is(h1, h2, h3, h4, h5, h6) { color: var(--text); line-height: 1.3; }
  .prose h1 { font-size: 1.5em; letter-spacing: -.015em; }
  .prose h2 { font-size: 1.143em; }   /* 16px on the 14px page */
  .prose h3 { font-size: 1em; }
  .prose h4 { font-size: 1em; color: var(--text-3); }
  .prose h5 { font-size: max(12px, .93em); color: var(--muted); }
  .prose h6 { font-size: max(12px, .86em); color: var(--muted); letter-spacing: .02em; }
  .prose.compact h1 { font-size: 1.15em; }
  .prose.compact h2 { font-size: 1.05em; }

  /* Spacing. Every margin is set by element, not by position, so nested blocks
     (a quote in a list item, a code block in a quote) never keep browser margins.
     :where() keeps these at (0,1,0) and the compact ones at (0,2,0); the
     first/last-child rules come last at (0,2,0) and win by order. */
  .prose :where(p, ul, ol, pre, blockquote, hr, div.math) { margin: 0 0 var(--space-3); }
  .prose :where(h1, h2, h3, h4, h5, h6) { margin: 1em 0 .5em; }   /* D63: relative to each heading's size, both scales */
  .prose.compact :where(p, ul, ol, pre, blockquote, hr, div.math) { margin: 0 0 var(--space-2); }
  .prose > :first-child,
  .prose :where(li, blockquote) > :first-child { margin-top: 0; }
  .prose > :last-child,
  .prose :where(li, blockquote) > :last-child { margin-bottom: 0; }
  /* A loose list (items wrapped in <p>) keeps a gap between items, since each item's last <p> is zeroed above. */
  .prose :where(ul, ol):has(> li > p) > li + li { margin-top: var(--space-2); }

  /* Lists and quotes. */
  .prose :where(ul, ol) { padding-inline-start: var(--space-4); }
  .prose ul > li { list-style: disc; }
  .prose ol > li { list-style: decimal; }
  .prose blockquote { border-inline-start: 3px solid var(--focus-line-strong); padding: 2px 0; padding-inline-start: 12px; color: var(--muted); }
  .prose hr { border: 0; border-top: 1px solid var(--border-strong); }

  /* Code: the fill plus a hairline, so it reads on white, on the ground and on --surface-2 panels. */
  .prose code { font-size: .93em; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); padding: 2px 4px; border-radius: var(--radius); }
  .prose pre { font-size: .93em; line-height: 1.5; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); padding: var(--control-pad-textarea); border-radius: var(--radius); overflow-x: auto; max-width: 100%; }
  .prose pre code { font-size: inherit; padding: 0; background: none; box-shadow: none; }

  /* Links (D57). App chrome links keep base.css's no-underline style. */
  .prose a { color: var(--primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .prose a:hover { text-decoration-thickness: 2px; }
  ```
- **What the scale gives:**
  - On the 14px page, h1–h3 come out at today's 21/16/14px (`PageItem.svelte:82-85`).
  - No heading falls below 12px on any surface. That includes the 13px explanation and the 12.5px editor explanation, where h5 and h6 hit the floor.
  - On the compact scale h2 and h3 differ by less than 1px. h3 and h4 differ only in colour on both scales. That is the approved mock-up (`content-scale-mock.html`). Task 4 shows the user all six levels on a compact surface before approval.
- **Muted surfaces.** Course info, version info and the editor explanation render their body in `--muted`.
  - There a quote has the same colour as the body. Its bar (`--focus-line-strong`, about 1.6:1 on the ground and 1.8:1 on white) and its 15px indent are the cues. The bar is decorative, not a 1.4.11 graphic: the indent alone already marks the quote.
  - h5 and h6 have the same colour as the body and keep their weight.
  - h4 (`--text-3`) is darker than the body, as a heading should be.
- **Code in a `--surface-2` panel** (the explanation `.exp`, the editor `.qexpl`): the fill matches the panel, and the hairline draws the box. In forced colors the hairline goes, and the mono font remains.
- **Math.** The frontend has no math CSS; the backend emits `span.math` and `div.math block`. `div.math` joins the spacing list, so display math no longer sits flush on the next paragraph. `span.math` is untouched.
- **Images** keep reset.css's `img { max-width: 100%; height: auto; }`. content.css does not repeat it.

### Who gets which scale
| Surface | File | Element | Class | Task |
|---|---|---|---|---|
| Page content | `items/PageItem.svelte:35` | `div.content` | `prose` | 3 |
| Mini-project assignment | `pages/MiniProjectDetailPage.svelte:504-506` | `div.assignment-html` | `prose` | 3 |
| Quiz prompts | `items/quiz/{SingleChoice,MultiChoice,Numeric,Text}Question.svelte:20/26` | `div.text` | `prose compact` | 4 |
| Explanation | `items/QuizItem.svelte:169` | `div.exp` | `prose compact` | 4 |
| Course info | `pages/CourseView.svelte:89`, `:94` | `div.info` | `prose compact` | 4 |
| Version info | `pages/editor/VersionEditPage.svelte:633` | `div.vinfo` | `prose compact` | 4 |
| Editor question card | `editor/quiz/QuestionCard.svelte:83`, `:129` | `div.qtext`, `div.qexpl-body` | `prose compact` | 4 |
| Editor preview | `editor/MarkdownEditor.svelte:327` | `div.preview` | from the host's new `variant` prop | 4 |

### The editor preview
`MarkdownEditor` gets `variant?: 'page' | 'prompt' | 'explanation'`, defaulting to `'page'`. The variant sets both the class and the text metrics, so the preview matches the student view in type size, colour and spacing. Line breaks differ, because the preview is narrower than the 652px measure.
- **`'page'`** (`prose`, 14px / 1.6 / `--text-2`, PageItem's): used by `PageBody` and the `MiniProjectModal` assignment. The assignment's line-height is 1.65, a difference of 0.05 that is accepted.
- **`'prompt'`** (`prose compact`, 14.5px / 1.6 / `--text-2`, the quiz prompt's): used by `NewQuestionModal` and `QuestionTextModal`.
- **`'explanation'`** (`prose compact`, 13px / `--text-2`, QuizItem `.exp`'s): used by `ExplanationModal`.
- Today's `.preview { font-size: 13px; color: var(--text) }` (`:373`) keeps only its padding and `min-height`; `.preview.err` keeps its danger colour.
- Under D55 the preview renders live while the student view shows stored HTML. A comparison uses freshly saved content.

### External links (D58)
- **One attachment.** `frontend/src/lib/externalLinks.ts` exports `externalLinks(html: string)`, an attachment factory like today's `newTabLinks`. Passing the HTML makes the attachment run again when the content changes.
- **The test is by origin, not by prefix, plus Mathion's file paths (D59):**
  ```ts
  const u = new URL(href, document.baseURI);
  const web = u.protocol === 'http:' || u.protocol === 'https:';
  const external = web && u.origin !== location.origin;
  const file = web && u.origin === location.origin && /^\/(assets|api)\//.test(u.pathname);
  const newTab = external || file;
  ```
  - A new-tab link gets `target="_blank"` and `rel="noopener noreferrer"`. That covers external links (D58) and Mathion's own files (D59): course assets at `/assets/{version_id}/…` (the renderer's rewrite, `markdown.py:85-86`) and run assets at `/api/runs/{id}/assets/…`.
  - Everything else is left alone and stays in the tab (D58):
    - a Mathion page, relative or absolute (a teacher may paste one from the address bar, and D54 now links it);
    - `#…`, `mailto:` and `tel:`.
  - The `URL` parser lowercases the scheme, so `HTTPS://X.ORG` (the renderer keeps scheme case) is caught. A `//host` href resolves to the page's scheme and takes the same test. An href that fails to parse is left alone.
  - The backend sanitiser already adds `rel`; the attachment sets it again as defence in depth, as `rewriteExternalLinks` does today.
- **Where it goes:** every authored-content surface in the table, in the same task and edit that adds the surface's class. That way the markup scanner's rows for each surface change once.
- **What it replaces:**
  - `lib/newTabLinks.ts`. Today it sets `target` on every link in QuestionCard, internal ones too. Internal links in the editor now stay in the tab, where DirtyGuard covers unsaved work.
  - `rewriteExternalLinks` in `lib/studentMiniProjects.ts:137`, with its `$effect`, `assignmentEl` and `bind:this` in MiniProjectDetailPage (`:46`, `:183-190`, `:505`). Nothing else uses them. `data-testid` stays. The F8/L1/M7 trust comment (`studentMiniProjects.ts:130-136`) moves to `externalLinks.ts`, reworded for D59: it says same-origin asset URLs are untouched, and now they open in a new tab. The header comment at `studentMiniProjects.ts:8` is updated.
  - The tests move to `externalLinks`: `studentMiniProjects.test.ts:233-287` (and its import at `:6`), `MiniProjectDetailPage.svelte.test.ts:669`, `:680-700` (and the comment at `:961`), `QuizOverview.svelte.test.ts:106` and `QuizModals.svelte.test.ts:45`. The D6.12 re-render test (`:680-700`) keeps running against the attachment; it is the only test that shows the rewrite follows a content change.
  - **Two assertions reverse under D59:** `MiniProjectDetailPage.svelte.test.ts:672-674` (D6.11: a `/api/runs/1/assets/x.png` link has no `target`) and `studentMiniProjects.test.ts:261-268` ("leaves /api/runs/... same-origin asset links unchanged"). Both now expect `target="_blank"`, and the titles change with them.
- **Why on student surfaces.** Quiz answers are in-memory `$state` (`QuizItem.svelte:16`). A student who follows an external link in a prompt mid-quiz would lose unsubmitted answers if the link replaced the tab. Internal links still reload the page (see Scope).
- **Tests:**
  - unit tests. New tab: `https://` and `http://` to another origin, `HTTPS://`, `//host`, `/assets/12/notes.pdf`, `/api/runs/3/assets/data.csv`, and the same two as same-origin absolute URLs. Same tab: a same-origin absolute page URL, a relative page path (`/courses/x`), `#…`, `mailto:`, `tel:`, an unparseable href;
  - same-origin hrefs in tests are built from `location.origin` (jsdom's is `http://localhost:3000`), never a hard-coded host;
  - one test per surface that an external link gets `target="_blank"` and a same-origin page link does not.
- **The markup scanner.** It is fail-closed on attribute types (`gate:1408`, `:1895`), and its header says `{@attach}` reds on purpose (`gate:1216-1218`). Six of the surfaces are in its set: PageItem, QuizItem, and the four question components (`gate:1360-1402`).
  - Those six files get a per-file `attachOn` carve-out, in the manner of the existing `hiddenOn` and `styleOn`. It is keyed by the element's signature with its new class (for example `attachOn: { "div:content.prose": "{@attach externalLinks(item.content_html)}" }`; `div:exp.prose.compact`, `div:text.prose.compact`), pinned to the exact source, and required exactly once.
  - The scanner gets an `AttachTag` branch before the attribute-type check (`gate:1895`) and a `seenAttach` counter. `AttachTag` is allowed only where `attachOn` names it.
  - A negative test shows that any other attachment, or the same one on another element, still reds.
  - QuestionCard, CourseView, VersionEditPage, MarkdownEditor and MiniProjectDetailPage are not scanned. Their class and attachment are pinned by jsdom tests and `d` rows.

### What goes and what stays
- **Go:**
  - Each surface's `:global` rules for `p`, `ul`, `ol`, `li`, `code`, `pre`, `pre code`, `a`, `img`, the headings and `p:last-child`, which content.css now covers. That includes:
    - `PageItem.svelte:81-119`, after its line-height moves;
    - the quiz prompts' `p` rules;
    - `MiniProjectDetailPage.svelte:664-670`, after its typography moves;
    - `QuestionCard.svelte:160-163`, including its `font-size: inherit` heading rule.
  - The `:global(pre)` overflow rules, which `.prose pre` covers: `SingleChoiceQuestion.svelte:129`, `MultiChoiceQuestion.svelte:141`, `QuizItem.svelte:300`, `TextQuestion.svelte:91`, `NumericQuestion.svelte:93`.
  - The 5c `.vinfo` backlog bullet (`docs/backlog/slice5c-constructor-polish-debt.md:66`), which is now moot.
- **Stay:** rules that are not content structure:
  - the `pre:focus-visible` rings (`TextQuestion.svelte:92`, `NumericQuestion.svelte:94`);
  - the legend's own `max-width: 100%` (`SingleChoiceQuestion.svelte:108`), which is on the legend, not on `pre`;
  - each surface's own `font-size`, `line-height`, `color` and `text-wrap`, on its box;
  - `overflow-wrap` on surfaces where the box itself needs it.
- **Spacing changes.** The surfaces had their own paragraph spacing: 10px, `space-2`, `space-3` and 6px. One style means one spacing per scale. The screenshots in Tasks 3 and 4 show each surface before and after. A surface keeps a different spacing only by a ruling recorded in the ledger.

### Gate rows that change
- **(b4):** content.css joins the reviewed global files.
  - Every rule gets a hashless row in `WANT_FULL` and `WANT_ORDER`, in document order, with selectors copied from dist. esbuild minifies them, for example `.prose :where(p,ul,ol,pre,blockquote,hr,div.math)`.
  - A row pins that the first/last-child rules come after the compact rules.
- **T3 (a) inventory** (`gate:277-301`, and `:288` where `pre` goes): the exact rule sets lose `.text p`, `.text p:last-child` and `.text pre` per component. The `dd` rows at `:178-179` follow.
- **T3 (b) `WANT_GLOBAL`** (`gate:337-338`) shrinks to `.text :global(pre:focus-visible)`.
- **(f) cumulative** (`gate:764-773`): it requires at least 4 `.text p` / `p:last-child` pairs and is rewritten for the class.
- **The choice-prompt inventory** (`gate:2878-2880`) and **QuizItem `.exp`** (`gate:3181-3184`).
- **The (g2) TARGETS** (`gate:983-986`): page content `p`, list padding, `ul>li`, `ol>li`.
- **PageItem's block** (`gate:1082-1135`, the `p` line-height rows `:1111-1112`) and **the mini-project assignment rows** (`gate:3560-3566`).
- **Markup SIG:** `div:content[class="content"]` (`gate:1574`), `div:exp[class="exp"]` (`:1551`) and `div:text[class="text"]` (`:1562`, `:1613`, `:1617`, `:1621`) gain the class and the `attachOn` carve-out, once.
- **`GLOBAL_ALLOW`** loses 31 entries: PageItem 12, MiniProjectDetailPage 8, QuestionCard 4, SingleChoice and MultiChoice 3 each, QuizItem 1. The plan re-counts them from the source.
- **New rows:**
  - one per surface, pinning its class (`prose` or `prose compact`);
  - the moved container typography (`.content` line-height, `.assignment-html` metrics);
  - the preview's three variants;
  - the loose-list rule `.prose :where(ul,ol):has(>li>p)>li+li` (0,1,4), pinned with a Task 3 screenshot;
  - three **source checks**. The gate's `none()` helper (`gate:147`) greps only the CSS bundle, so these are custom source greps in the style of `gate:4529-4536`:
    - no `.svelte` file outside the content surfaces renders the class `prose`;
    - nothing under `frontend/src` mentions `newTabLinks` or `rewriteExternalLinks` any more. The check is limited to `src`, so it does not match its own pattern in the gate script, and the docs keep their history;
    - limited to the content-surface files, no rule re-declares a content element. Its payload is anchored on exactly `:global\((p|ul|ol|li|code|pre|blockquote|hr|h[1-6])\)`, so `pre:focus-visible` and the confirms' `:global(code)` do not match.
- **The Slice-5d emoji scan** (`gate:4526-4527`) names `src/lib/newTabLinks.ts`. Opening a missing file fails the check, so the entry becomes `src/lib/externalLinks.ts` in Task 4, when `newTabLinks.ts` is deleted.
- **`EXPECTED_CHECKS`** moves by the net count.

## The 404 page (Task 5)

- **`NotFound.svelte`** renders in the shared page column:
  ```svelte
  <div class="page">
    <ErrorState variant="page" title="Page not found" message="The address may be mistyped, or the page has moved." action={back} />
  </div>
  ```
  - The `back` snippet is a `Button variant="secondary"` that calls `navigate(target)`. This matches the other page ErrorStates. Today's plain link is lost, and with it cmd-click.
- **Target and label:**
  - signed in: `defaultLandingPath(session.user)`. `/teaching` reads "Back to teaching", and anything else reads "Back to courses";
  - signed out (`session.user === null`): `/login`, labelled "Sign in". `defaultLandingPath(null)` returns `/courses`, so NotFound branches on `session.user === null` itself.
- **Header.** Signed out there is no AppHeader, as today (`App.svelte:64`). One edge: an unmatched `/superuser/...` path also renders NotFound without the header, even when signed in. The button still works, and a test pins it.
- **Announcement.** ErrorState's root is `role="alert"` (`ErrorState.svelte:27`), so the 404 announces on load. It goes on the list for the beta VoiceOver pass.
- **Tests:**
  - the three labels and targets;
  - the ErrorState `<h1>`;
  - an unknown path rendering NotFound through `App.svelte:74`;
  - an unknown `/superuser/...` path.

## Bare URLs (Task 6, backend)

- **No new dependency (D64).** `pyproject.toml` does not change. The renderer gains a small core rule on the markdown-it-py already installed; `linkify-it-py` is not used.
- **The rule** (`backend/mathion/markdown.py`), registered with `_md.core.ruler.before("text_join", "bare_url", …)`:
  - It runs before `text_join`, where markdown-it's own linkify rule runs. A backslash escape is still a separate `text_special` token there, so `http\://example.com/` never forms an address and stays plain.
  - It scans only `text` tokens inside inline content, and skips everything between `link_open` and `link_close`. Code spans, code blocks and math are other token types and are never touched; an authored `[text](url)` or `<url>` stays one link.
  - The match is `(?<!\w)[Hh][Tt][Tt][Pp][Ss]?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+`: only URL characters (D65), one character class, linear, with no nested quantifiers. The scheme's case is spelled out, not matched with `re.IGNORECASE`, which would let the Kelvin sign, a long s and a dotted I stand in for k, s and i.
  - Trimming, in one pass from the end: trailing `.,;:!?'*_~` leave the link; a closing `)` or `]` leaves it only while it has no partner inside the address, so `https://en.wikipedia.org/wiki/Function_(mathematics)` keeps its `)` and `(see https://x.org)` loses the outer one.
  - An address with nothing after `://` is not linked.
  - An address followed directly by a letter, digit (Unicode `\w`) or combining mark is not linked at all (D66), and nothing up to the next space is linked either. The next character may sit in the next token (an entity or escape is a separate `text_special` token here), so the rule looks into it and carries the plain stretch across such tokens. An opening delimiter or an atom right after the address (emphasis or strikethrough opening, code, math, an image, a link) also counts as glued. Closing delimiters are looked past and the token after them decides, so `**https://x.org**` links and `*https://x.org/caf*é` stays plain. A line break, a space entity or link text ends the stretch. The check runs after the match, not as a lookahead, so the regex never backs off to a shorter address.
  - The link is `link_open` (`href` = the address with its scheme lowercased, through `md.normalizeLink` and `md.validateLink`), a `text` token with the address exactly as typed (D65: not through `md.normalizeLinkText`, which would decode `%20` and `xn--` hosts), and `link_close` — the same tokens an autolink makes.
  - With no `linkify` machinery, `www.` addresses, bare domains, `ftp:`, `//host`, `mailto:` and plain e-mail addresses are never matched.
  - An authored `[text](mailto:…)` or `<mailto:a@b.org>` still works, because it is a markdown link. So does the CommonMark autolink `<a@b.org>`: it is written on purpose, and it is not a D54 violation.
- **Output and sanitising.**
  - Links come out as `<a href="…">…</a>`. They pass `nh3` with the existing `_ALLOWED_TAGS` and `_ALLOWED_ATTRS`, and the `_URL_SCHEMES = {http, https, mailto}` filter.
  - On every surface the frontend treats them like an authored `[text](url)`, through `externalLinks`.
- **Linked**, each pinned by a test:
  - `https://example.org/path?q=1`;
  - `http://example.org`;
  - a URL with parentheses (`https://en.wikipedia.org/wiki/Function_(mathematics)`), also when wrapped in `(see … )`;
  - trailing punctuation: "see https://x.org." links without the full stop;
  - `<a@b.org>` (a CommonMark autolink).
- **Not linked**, each pinned by a test:
  - a URL inside inline code or a code block;
  - inside math (`$…$`, `$$…$$`);
  - an existing `[text](url)` or `<url>` (it stays one link);
  - the escaped form `http\://example.com/`;
  - `www.example.org`;
  - bare domains (`example.org`);
  - `numpy.py`;
  - e-mail addresses (`a@b.org`) and typed `mailto:a@b.org`;
  - `ftp://files.example.org/x` and `//cdn.example.org/x`.
- **Stored HTML (D55).** No migration. Publish and clone both re-render (`versions.py:318-350`, `version_clone.py:143`).
- **Tests:**
  - `backend/tests/test_markdown.py` covers each case above;
  - `backend/tests/test_items.py` gets one API-level test: saving page content with a bare URL stores a link.

## Testing CSS tasks

jsdom computes neither layout nor the cascade, so for Tasks 1–4:
- **The gate row is the red/green.** Each row is written first and run against the old dist (red), then the CSS changes (green). Hashes are derived from dist, never hand-written.
- **Cheap jsdom tests pin what jsdom can see:**
  - the class on each surface (`.text.prose.compact`, `.content.prose`);
  - the preview `variant` → class and metrics class;
  - the mini-project `div.sheet` and the moved breadcrumb.

`externalLinks`, the 404 page and the backend are TDD in the usual sense.

## Backlog lifecycle
Each task deletes or closes the notes it resolves:
- Task 1: `global-focus-ring-invisible-in-forced-colors.md`;
- Task 2: `page-background-reads-gray-against-header.md`;
- Task 3: `page-content-h4-h6-and-blockquote-unstyled.md`;
- Task 4: the `.vinfo` bullet in `slice5c-constructor-polish-debt.md:66`;
- Task 6: `bare-urls-not-autolinked-in-markdown.md` and `stored-content-html-not-rerendered-after-renderer-change.md`. The second notes that stored HTML picks up the renderer on the next save, publish or clone.

Task 1 also adds the new Polish 3 items from Scope to the Polish 3 list: 2.4.11 in the grids, the three `aria-invalid` fields without an error border, internal-link reloads, and the no-op rules.

## Process

Six tasks, each run as in Polish 1:
1. TDD (for CSS tasks, the gate row first; see above);
2. vitest (`TZ=Europe/Copenhagen`), svelte-check and the gate (absolute `TMPDIR`); for Task 6 also `backend/.venv` pytest;
3. screenshots or a look check;
4. the user's OK;
5. Opus and Fable review lanes on the uncommitted diff, re-run after every fix until clean;
6. commit with exact paths and the trailer;
7. a ledger line;
8. wait for "go".

The tasks:
1. **Focus ring and reduced motion:** the `base.css` rules, the field audit, the two compound error rules, the MarkdownEditor rules, the SequenceLink and MiniProjectLink fix, the inset rings, the side-panel forced-colors rule, Switch, the (b4) re-freeze.
   - Screenshots: a Tab-focused primary Button, a ghost Button, an IconButton, a CourseCard, a SequenceLink row, an accordion header, the strip icons, the DangerConfirm checkbox, a Progress segment, the Login field, an invalid NewRunModal field, and the MarkdownEditor.
2. **The page ground and the sheets:** the tokens, `--disabled-bg` and the transparent ghost rules, the player sheet (with the strip and footer rules gone) and the mini-project sheet, FilterPills, the Toast, the two `body:has` removals.
   - Screenshots: a course list, a course view, the player (top and bottom edges) with a page that has code and with a submitted quiz, the mini-project page, Teaching with a pressed filter, the versions page, a disabled Button and IconButton on the ground.
3. **Authored content, page scale, and external links:** `content.css`, `externalLinks`, PageItem and the mini-project assignment (with the typography moves and the old link effect removed).
   - Screenshots: a page with h1–h6, a quote, a quote nested in a list item, a loose and a nested list, code, a link and an `hr`, before and after.
4. **Authored content, compact surfaces:** the quiz prompts (Single and Multi as one step, Numeric and Text as another), the explanation, course and version info, the editor's question cards, the preview's `variant`, each with `externalLinks`; `newTabLinks` removed.
   - Screenshots: each surface with all six heading levels, a quote and code, including the editor explanation and course info.
5. **The 404 page:** ErrorState, the labels, the tests.
6. **Bare URLs:** the own core rule (D64), the tests, the backlog notes.

Then a whole-branch review (fresh Opus and Fable), and a Safari pass, one step at a time.

## Carried to the Safari pass
- **The focus ring (Tab, or ⌥Tab in Safari):**
  - the header, a course card, a SequenceLink row (one ring only), the strip icons (the 22px squares, on a wrapped line), a primary and a ghost Button, an IconButton, a filled IconButton, an accordion header;
  - the DangerConfirm checkbox and a roster checkbox;
  - the Progress tab's segments, a heat cell next to the sticky columns, the MarkdownEditor Write/Preview tabs;
  - a video or app iframe in the player (done: no ring is possible, D67);
  - text fields turn the border blue with the halo: Login's e-mail and PIN, the VersionsPage create field, the roster search, the MarkdownEditor card;
  - an invalid field stays red when focused (MiniProjectModal after a failed save, mocked);
  - after a keyboard Cancel, the VersionsPage `<h1>` and the side-panel title show no ring.
- **Mouse-only flows show no ring.** Script focus after a mouse action can match `:focus-visible` in Safari, and the old halo hid it:
  - close a modal with ✕;
  - rename a title and click away;
  - cancel a confirm with the mouse;
  - open the side panel by clicking a cell.

  If rings appear, the finding goes to the plan as a follow-up ruling.
- **High Contrast.** Use Chrome's DevTools forced-colors emulation if it is practical. Include the side panel's Evaluation control and the MarkdownEditor textarea. Otherwise note it for the beta pass.
- **Reduced motion.** With macOS "Reduce motion" on, the Switch knob jumps.
- **The page ground:**
  - every screen family: Login, course list, course view, player, mini-project page, Teaching, a run's tabs (Overview, Roster, Progress, Submissions, Assets), the editor, the versions page, the superuser page and the 404 page;
  - the player sheet with a page, a quiz (explanation panel, result card, locked options), a video and an app. No doubled hairlines at its top and bottom. On a wide window, does the sheet look balanced beside the 652px text?
  - the mini-project sheet with its cards and the "Not submitted" pill: do the inner cards read as sections or as clutter?
  - both sheets at 320px: nothing scrolls the page sideways;
  - the filter pills, pressed, on Teaching and on the Assets tab;
  - disabled controls: the player's Previous on the first item, the editor bars.
- **Authored content:**
  - a page and a quiz prompt with every heading level, a quote (its bar ends with its text), nested and loose lists, code and an `hr`;
  - all six levels on the editor explanation and on course info;
  - a quote on course info, on the ground: its bar is visible;
  - links are underlined and readable on the muted surfaces;
  - the editor preview matches the student view in type size, colour and spacing, using freshly saved content.
- **External links:**
  - a link in a quiz prompt mid-quiz opens in a new tab, and the answers stay;
  - a link in the editor preview opens in a new tab;
  - a link pasted from Mathion's own address bar stays in the tab;
  - a linked course file (a PDF) in a quiz prompt opens in a new tab, and the answers stay (D59).
- **404:** a typed bad URL, signed in and signed out, and a nested one (`/courses/x/y/z`).
- **Bare URLs:** a page body with a pasted URL, after a save. The link opens in a new tab; a URL inside code and a `www.` address stay plain.

No VoiceOver steps. The beta VoiceOver list gains the 404's `role="alert"` and the fact that nothing announces a new tab (a visually hidden "(opens in a new tab)" from `externalLinks` is the candidate).
