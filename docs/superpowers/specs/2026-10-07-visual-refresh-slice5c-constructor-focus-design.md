# Visual refresh — Slice 5c: a calmer course constructor (focus by depth)

**Status:** draft, rev 1. Written 2026-10-07 for the user's review.
**Branch:** `feat/visual-refresh-slice5-authoring`. It stays local: no push, no merge. 5c lands on top of 5b. 5b works correctly, but its look is reworked here.

**Authority:**
- The decisions below were made with the user on 2026-10-07.
- The approved mockup is `.superpowers/sdd/2026-10-07-visual-refresh-slice5b-item-editor-modal/probe/constructor-v3.html`. Its earlier rounds are `focus-mockup.html` and `constructor-v2.html` in the same folder.
- Where this spec and the 5a/5b specs disagree, this spec wins for the version editor.

## Why

After 5b, the user opened the constructor in the browser. Their verdict: "the whole visual experience is horrible", and "the whole course constructor is now a mess of elements, which makes orientation super difficult".

The screenshots show the causes:
- **Everything sits in one nested column.** Version info, blocks, block fields, sequences, sequence fields, items and delete rows are stacked three levels deep, all with similar visual weight.
- **Every row carries ↑ ↓ + ✎ 🗑,** and filled "+" buttons appear at several levels.
- **Slugs and B1/S1 codes appear on every row.**
- **Permanent "Delete this… — remove its items first" rows.**
- **The item modal names its place only as "S1 · item 1 of 2".**

The 5a/5b gate pinned the CSS against the written spec, but nobody looked at the real screen per task. That is why this slipped through. See §Process.

## Decisions (the user's, 2026-10-07)

- **D1 — Focus by depth.** The deepest open container is near-white, and each level further out is one shade darker. When a child closes, its parent becomes the light one again. When an item is open, the item modal's dark backdrop is the next step of the same rule. *(This is the user's own idea.)*
- **D2 — Background only (variant A).** Text and controls outside the focus keep full contrast and stay clickable. Fading them (variant B) was rejected.
- **D3 — Shading and decluttering ship together** in one slice.
- **D4 — Controls only at the focus level.**
  - Rows inside the open (white) container show their controls.
  - Rows in the darker area outside show their title only.
  - To act on something outside, open it first. Clicking its title switches the focus there.
- **D5 — No slugs, no position codes** (B1, S1) in the constructor rows. Order is visible from position.
- **D6 — Delete moves into the open node's header.**
  - The open block or sequence gets its own trash in its header, next to ↑ ↓.
  - While it still has children, the trash is disabled, and its tooltip gives the reason ("Remove its sequences first" / "Remove its items first").
  - The permanent delete rows are removed.
- **D7 — Blocks and sequences have only a title.**
  - Block **Info is removed from every screen,** constructor and student view alike.
  - The database column, its existing text and the API field stay untouched, so this is reversible and no self-hosted install loses data. A later cleanup may drop the column.
- **D8 — The title is edited inline in the header.**
  - ✎ in the open node's header turns its title into a field in place.
  - Enter or ✓ saves; Esc or ✕ cancels.
  - There is no settings modal for blocks or sequences.
- **D9 — "+ Add block" / "+ Add sequence" are inline title rows** at their focus level: type the title, press Enter.
  - *Amended by the user, 2026-10-08 (during T3):*
    - Every "+ Add …" line sits **after** the list it adds to, because new children appear at the end.
    - **"+ Add block" is visible at every depth,** not only when nothing is open. This is the one exception to D4.
    - "+ Add item" is the same kind of quiet text line as the other two.
- **D10 — Everything about items happens in modals.**
  - **"+ Add item"** opens a **New item** modal:
    - four type choices: Page, Video, Quiz, Interactive app (compact pills, as before 5c; the user, 2026-10-08);
    - a Title field;
    - the one extra field the backend requires for that type: Video → a URL field; Page, Quiz and App → nothing more.
    - *Amended by the user, 2026-10-08 (during T4):* a Page asks only for its title. It is created with the starter content "# Title" (the backend requires content), and the content is written in the item editor right after.
  - **Create** goes straight into the new item's editor modal, which is 5b's modal as it is.
  - Editing an item stays as in 5b.
- **D11 — The item modal's context line names the path:** "Vectors › Linear combinations · item 1 of 2".
- **D12 — Version settings open in a modal.** They are Label, Info (markdown) and Max quiz attempts, opened from ✎ next to the course title in the page heading. That's three fields, one of them markdown, so a modal with one footer Save fits better than inline rows. *(This was my proposal; the user kept it in the v3 mockup without objection.)*

## The screen

### Focus levels

| Open | Focus (white) | One shade darker | Two shades darker |
|---|---|---|---|
| nothing | the page (version) | — | — |
| a block | that block's panel | the page | — |
| a sequence | that sequence's panel | its block's panel | the page |
| an item | the modal | the existing backdrop over all of the above | |

- **Expansion stays URL-driven** (`/blocks/:b`, `/blocks/:b/sequences/:s`, `/…/items/:i`), as 5a/5b built it. At most one block and one sequence are open, so there is always exactly one focus path.
- **Shades are new theme tokens** in `theme-default.css`: `--focus-0` (= `--surface`), `--focus-1` and `--focus-2`. *Amended by the user, 2026-10-08 (T5):* with nothing open the page itself is `--focus-page` (#F2F3F6, a half-step under `--focus-1`), so the white block rows stand out from it. Inside an open (white) container, its focus-level rows (sequence rows of the open block, item rows of the open sequence) are tinted `--focus-row` (#F4F5F8) for the same reason. Starting values come from the mockup (`#eef0f3`, `#e1e4e9`) and are tuned in the browser pass with the user.
- **Panel borders** use a translucent line, so they stay visible on every shade. The focus panel gets a slightly stronger border and a soft shadow.
- **There is no dark theme today,** so none is designed here.

### Rows

- **Block and sequence rows** show the title only.
  - At focus level they add ↑ ↓ and › (open).
  - Outside the focus they show the title, and clicking it opens that node.
- **Item rows** (always at focus level when visible) show the type mark, the title and, for a quiz, "· N questions", followed by ↑ ↓ ✎ 🗑.
- **"+ Add …"** is one quiet text line ("+ Add block", "+ Add sequence", "+ Add item") at the bottom of the focus container. It replaces the filled "+" icon buttons.

### Open node header (block or sequence)

The header reads: title, then ✎ ↑ ↓ 🗑, then ⌄ (collapse). Rules for the controls:
- ↑ ↓ are disabled at the ends of the list, with the existing 5a tooltip wording.
- The trash follows D6.
- The ✎ field (D8):
  - It is required, with a maximum of 200 characters.
  - On save it sends one PATCH and reloads the tree, as the old InlineField did.
  - While the field is open, it counts as unsaved for the navigation guard, as today.
  - A save error shows under the field.
  - Moving focus away leaves the field open: no auto-save, no auto-cancel (the old InlineField had no blur handler).

### Permission states

These come from `versionPermissions`; the rules don't change.

| Version | Title ✎ (blocks, sequences) | ↑ ↓ / + Add / 🗑 | Version settings ✎ | Items |
|---|---|---|---|---|
| created | yes | yes | editable modal | full (5b) |
| published | yes (text fields) | hidden | read-only modal | 5b rules (text yes, structure no) |
| archived | hidden | hidden | read-only modal | read-only (5b) |
| disabled | hidden | hidden | read-only modal | 5b D6 (plain source + note) |

**Controls the permissions don't allow are hidden, not shown disabled.** That removes the grey noise. Controls that are allowed but blocked by the current state keep the disabled look with a reason tooltip. Examples are ↑ at the top of a list, a trash on a non-empty node, and anything while a request is in flight. The 5a banner "This version is disabled — editing is not allowed. Enable it first." stays.

### New item modal (D10)

- **Frame:** the 5b `Modal` frame.
- **Header:** "New item" with the context "Vectors › Linear combinations · will be item N of N", and ×.
- **Body:**
  - The type cards come first. Page is selected by default. The control is one radio group with real `<input type="radio">`, styled as compact pills (mark + name on one line, as before 5c; the user, 2026-10-08), keyboard-reachable.
  - Then Title, then, for Video only, "Video URL", required, `http(s)://`. A Page sends `content_md: "# <title>"`.
  - A server error on a field the modal doesn't show goes to the alert line, never silently onto a hidden field.
- **Footer:** Cancel and Create.
  - Create is disabled until the required fields are filled.
  - It shows the loading state while posting.
  - Server errors map to the fields (`mapCreateError`, as today).
- **On success:** navigate (push) to the new item's route. The New item modal is not a route, so Back can't reopen it, and the push lets the item's × return to the sequence (5b D7). The 5b editor modal opens. Close focus follows 5b D18 (the new item's ✎).
- **Close:** ×, Esc or Cancel. If anything was typed, the discard prompt appears (the DirtyRegistry, as for other modals).

### Version settings modal (D12)

- **Header:** "Version settings" and ×.
- **Fields:**
  - Label (plain input);
  - Info (a plain monospace textarea; R2 of the plan);
  - Max quiz attempts (number, 1–10).
- **Footer:** Discard and Save. Save sends one PATCH with the changed fields.
- **When not editable:** the same modal, read-only, with no footer.
- **The heading** keeps the course name and label. *Amended by the user, 2026-10-08 (T5):* the id and the attempt limit are quiet chips, then the state badge last: `[v11] [max 3 quiz attempts] [created]` (not mono text). Non-empty version info shows under the heading as muted rendered text (the sanitized `info_html`, as CourseView), before the blocks. The title line is a step smaller (h1 18px) and the content below it a step larger (info, block/sequence/item titles, "+ Add …" lines and empty notes +1px).

### Student view

- `BlockGroup` stops rendering `info_html`, along with the empty-strip guard that went with it.
- Version info in `CourseView` is unchanged: it's version info, not block info.

## Versions page follow-up (the user's, 2026-10-08, after T5)

The course page's versions list is brought in line with the version page. This supersedes the Versions header in the Slice-5a spec (`h2` + `.count` + `+` with `aria-expanded`).
- **Page shade and rows.** The page takes `--focus-page`. Each version is a separate boxed row, 6px apart, like the block rows. The duplicate form is a matching white box.
- **Heading.** The course name is 18px, as on the version page. The count is a chip ("2 versions"). The visible Versions row is gone, and its `h2` stays for screen readers only.
- **"+ Add version".** A quiet line under the list, like "+ Add block", opens the create form in its place. The form has Cancel, and Escape cancels too. The empty state has no button of its own.
- **Rows.** The label is the row title (block-title size). Clicking it opens the version, like the pencil. A `v{id}` chip follows it.

## What is removed

- **`VersionMetaForm` as an inline card.** It is replaced by the version settings modal.
- **The "Blocks" card head** with its collapse chevron and filled "+". The blocks list is now the page body.
- **AccordionHeader:** the slug, the `B1`/`S1` badge and the controls outside the focus.
- **Block and sequence bodies:** the inline Title/Info field rows, the create forms (replaced by D9 rows and the D10 modal) and the delete footers.
- **The block Info field** in the constructor and the student view (D7).
- **`InlineField`** (component and tests). After T5 nothing imports it, so it was deleted (the user's call, 2026-10-08).

## Out of scope

- **Quiz `Q1` numbers inside the item modal.** They stay, because save messages name questions by number ("Question 1: …").
- **Previous/next item navigation** inside the modal.
- **Drag-and-drop reordering.**
- **Dropping the `blocks.info` column.**
- **The 5b backlog minors,** unless a 5c task touches that code anyway. The 5b T6 resync-baseline question stays open for the user.

## Process (changed after 5b)

- **The user judges the look.** Every task that changes what's on screen ends with screenshots of the affected states (taken with agent-browser on the dev server), shown to the user as an overlay before the task is committed. A task isn't complete without the user's OK on its screenshots.
- **The gate is lighter.**
  - The 5a constructor sections (k-info, u, v, w, x, y, z) are rewritten for the new markup.
  - New checks keep only the rules that protect quality across the codebase: tokens instead of literals (Constraint 11 style), no emoji, no rem font sizes, the forced-colors scope, and focus rings.
  - They no longer pin every padding value, because pixel pins made changes expensive without telling anyone whether the screen works.
- **Two review lanes** (Opus and Fable) on the uncommitted diff, the same as 5b.
- **The 5b browser checks carry into 5c's browser pass:** the 5a Back freeze, the mouse-Save/⌘S focus, the T5b footer-Discard vs × prompt, the label baseline, and the quiz key move.

## Testing

- **Focus depth.** For each URL state (none / block / sequence / item), the expected panels carry the focus class or token and the others don't. Clicking a dimmed title navigates to that node.
- **Controls.** Outside the focus, rows have no ↑ ↓ ✎ 🗑. At the focus, they follow the permission table. The table's four states are each tested.
- **Inline title.** Enter saves (one PATCH, tree reload), Esc cancels without a request, an error shows under the field, and an open field is guard-dirty.
- **Add rows** for block and sequence: Enter creates, Esc cancels, and errors show.
- **New item modal.**
  - Per type, the right extra field is shown and required (Page: none; it sends the "# Title" starter).
  - Create posts the right body and pushes the item route.
  - The editor modal opens on the new item.
  - Cancel with typed input prompts.
- **Version settings.** The editable modal sends one PATCH with only the changed fields. The read-only modal has no footer.
- **Block info** isn't rendered in BlockGroup, and the constructor never sends `info`.
- **Delete in the header** is disabled with the reason while the node has children, and enabled when it's empty.
- **Every existing 5a/5b behaviour test** that still applies keeps passing: the D7 close latch, D9 delete, D18 focus, the quiz save.
