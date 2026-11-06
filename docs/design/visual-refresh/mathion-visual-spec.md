# Mathion — visual spec

Direction: **precise tool**. Dense, gridded, quiet. Steel blue on cool near-white,
IBM Plex Sans for text and IBM Plex Mono for every numeral. 13–14px base, 5px radii,
1px hairlines. No gradients, no shadows beyond a 1px card lift, no emoji.

Reference screens live in `Mathion Look and Feel.dc.html`:

| id | screen |
|---|---|
| 2a | Sign in — PIN step |
| 2b | Your courses |
| 2c | Sequence player |
| 2d | Run dashboard — Progress |
| 3a | Versions |
| 3b | Version editor |
| 3c | Item editor — page (modal) |
| 3e | Item editor — video (modal) |
| 3f | Item editor — quiz (modal) |
| 9a | Run · Submissions |
| 9b | Submission thread |
| 9c | Mini-project — student |
| 9d | Loading, empty and error states |
| 10a | Run · Overview |
| 10b | Run · Roster |
| 10c | Run · Groups |
| 10d | Run · Teachers |
| 10e | Runs list |
| 10f | Import roster — paste |
| 10g | Import roster — result |
| 10h | Interactive app |
| 10i | Run · Assets |
| 10j | Run · Mini-projects |
| 10k | New run (modal) |
| 10l | Publish conflicts (modal) |
| 10m | Mini-project editor (modal) |

The canvas holds only current work — the first card is a visual-system reference (logo
sizes, palette, status badges, item-type marks), everything after it is a screen to
build. Earlier logo and palette exploration has been removed.

---

## 1. Tokens

Replace `src/styles/base.css` with `handoff/base.css`. It keeps every existing
variable name (`--bg`, `--text`, `--muted`, `--border`, `--primary`, `--primary-text`,
the `--status-*` pairs, the space scale) so nothing breaks, and adds the rest.

One submission status changes: `needs revision` deepens from `#fef3c7 / #92400e` to
`#FDECC8 / #7A4E0B`. Every other `--status-*` pair is untouched. The four version
lifecycle pairs all change — see §3.

Fonts to add to `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Contrast rule

`--muted` (#5A616E) is the floor for anything a user reads: counts, dates, slugs,
help text, table metadata, inactive nav. `--faint` and `--placeholder` are for
disabled glyphs, carets and input placeholders only. The old #999/#aaa greys fail AA.

The one exception is `--dimmed` (#6B7280) in the disabled-row treatment (§4,
Disabled rows) — deliberately one step lighter at 4.83:1, still AA, and used nowhere
else.

---

## 2. Logo

Two overlapping peaks: the front one `--primary`, the one behind `--gold`. Round caps
and joins, no fill. Same geometry at every size — only the box and stroke change.

```html
<svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true">
  <path d="M10.15 21.8 18.25 10.2 28.05 21.8" stroke="#E8A317" stroke-width="3.2"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M3.95 21.7 10.85 12 19.25 21.7" stroke="#3F5C77" stroke-width="3.2"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

| context | box | stroke-width |
|---|---|---|
| app header, beside the 14px wordmark | 26px wide | 3.6 |
| login card, beside the 15px wordmark | 28px | 4 |
| marketing | 56px | 3.2 |
| reversed on `--primary` (not the tab icon: that's `backend/branding-defaults/icon.svg`, Branding D6) | 24px on a 40px #3F5C77 tile, radius 9 | 3.2, front `#fff`, back `rgba(255,255,255,.55)` |

**Header geometry is exact.** The mark's viewBox is cropped to its ink —
`viewBox="0 0 32 23.6"` (the source art is 32×32; strokes bottom out at
21.8 + half of 3.6) — so the box carries no dead space below the strokes. The span is
26 × 19.2px and is nudged `translateY(-4.35px)` inside a `align-items: center`
lockup, which lands the stroke ends on the wordmark baseline while the wordmark itself
stays on the same line as the nav pills. Full snippet at the foot of `base.css`.

Below ~17px the two peaks merge; use the one-ink form (both paths `--primary`, the
back one at 72% opacity) rather than shrinking the pair.

**Gold appears exactly twice on any screen** — in the mark, and on the nav pill saying
where you are. It is chrome, never state.

---

## 3. Colour of state

Neutral states are grey. A draft is not a caution and a disabled version is not an
error, so `created`, `archived` and `disabled` all sit in the grey scale. That leaves
four hues, each meaning exactly one thing:

| hue | meaning | states |
|---|---|---|
| blue | waiting | awaiting evaluation |
| green | done | published, accepted |
| amber | act on this | needs revision |
| red | refused | rejected |

Version lifecycle pairs (all four change from today's values):

| state | background | text |
|---|---|---|
| created | `#F0F1F4` | `#3D4350` |
| published | `#D1FAE5` | `#065F46` (same green as *accepted*) |
| archived | `#E9EBEF` | `#5A616E` |
| disabled | `#F0F1F4` | `#6B7280` |

`needs revision` is the only amber in the product and must not be confused with the
gold chrome in §2.

---

## 4. Components

### AppHeader
44px, `--surface` background, 1px `--border` bottom. Brand = the 22px mark +
"Mathion" 14px/600. Nav items are pills: **active** `--gold-text` 500 on `--gold-soft`,
radius 4, padding 4px 10px; inactive `--muted`, no background. User email 12.5px
`--muted` on the right.

### Button (`ui/Button.svelte`)
Three variants, all radius `--radius`, font 13px, weight 500 for primary:

| variant | background | border | color | padding |
|---|---|---|---|---|
| primary | `--primary` | none | `--primary-text` | `--btn-pad` 4px 10px |
| secondary | `--surface` | 1px `--border-strong` | `--text-3` | `--btn-pad` 4px 10px |
| ghost | none | none | `--muted` | `--btn-pad-sm` 4px 9px |

These paddings are final. The whole control set was tightened after review — buttons
lost 3px vertically and 2px horizontally, fields went 34px → `--control-h` 30px
(28px in table rows), textareas and markdown blocks to 8px/10px, and every field
VALUE to 13px while labels stay 12.5px. Do not reintroduce roomier defaults.

Disabled: `--faint` text, `--border-faint` border, `--bg` background, and a `title`
giving the reason. Danger actions use `--danger` text, never a red fill.

A destructive button that is present but not yet armed — Force delete before its
"I understand" box is ticked (10i, 10j) — is the one exception to grey disabling. It
keeps the red family and only drops saturation: `--danger-off-bg` #FFFAFA background,
`--danger-off-border` #F2D9D9, `--danger-off-text` #C99B9B, with the reason in
`title`. Greying it would let an operator stop reading it as dangerous.

### Icon button
24px square in table/accordion/modal rows, 28px for page-level actions. Radius
`--radius`, 1px `--border-strong`, `--surface` background, 12–14px SVG at
`stroke-width: 1.6`, `stroke: currentColor`, `viewBox="0 0 16 16"`. Every one carries
a `title`.

Glyphs: pencil = open/edit, overlapping rects = duplicate, circle-slash = disable,
circle-check = enable, trash = delete (`--danger`), plus = create, arrow up/down =
reorder, chevron = expand/collapse (borderless, `--muted`), × = close/cancel.

**Keep the slot count fixed per row.** An action the state forbids renders disabled
rather than disappearing, so the column stays aligned: `border: 1px solid
var(--border-faint); background: var(--bg); color: var(--faint)`, reason in the
tooltip. Version rows always show four: Open · Duplicate · Disable/Enable · Delete.

### Inline field editing (3b, 3c)
Fields that are read far more often than they are changed render as text, not inputs:
a three-column grid — label `--muted` 12.5px / value `--text` 13px / 54px action
slot holding a pencil. Clicking the pencil turns that row into an input and the slot
into ✕ then ✓, so **the ✓ lands exactly where the pencil was**. Each field commits on
its own.

This replaces the version editor's panel-level Save/Discard, and with it the
version-level dirty state — which is why "+ New block" and Publish are no longer
gated in 3b. The item editor (3c/3e/3f) keeps its own Save/Discard because it edits a
document, not a field.

Section panels (Version info, Blocks) are foldable by a borderless chevron beside the
heading, and sit in `--surface` cards with 16px/18px padding.

### Disabled rows
A disabled version dims as a whole row rather than being struck through: the version
number, its label and any co-occurring lifecycle badge all take `--dimmed`, and the
badge fills drop to `--state-disabled-bg`. Action glyphs keep their normal treatment
except those the state forbids.

Do not lighten `--dimmed` further to strengthen the effect — reduce what else competes
instead.

### Collapsed forms (3a)
Create and duplicate forms start closed. A `+` icon button on the section heading
opens the new-version form and becomes `×`; Duplicate opens an inline row beneath the
version it copies.

### Item editor modal (3c, 3e, 3f)
Opening an item no longer routes to a page — it opens a modal over the version editor:

- 920px wide, `max-height: 600px`, radius `--radius-lg`, 1px `--border-strong`,
  `box-shadow: 0 16px 44px rgba(20,24,35,.22)`.
- Backdrop `rgba(22,24,29,.34)` over the page, page content at `filter: blur(1px)`.
- Header: 22px type tile, item name 15px/600, mono context ("static page · S1 · item 1
  of 3"), then delete and close glyphs.
- Body scrolls. **Every direct child needs `flex: 0 0 auto`** — without it the flex
  column crushes cards instead of scrolling.
- Footer is sticky: dirty state left in mono `#92400E`, then Discard and Save.
- Escape and × close it; closing dirty must prompt. Trap focus while open.

Per type: **page** (3c) = markdown pane with an asset sidebar; **video** (3e) = title
and URL rows plus the resolved embed, no editor pane; **quiz** (3f) = questions as
their own accordion (mono `Q1` badge, type on the right, reorder/delete glyphs), the
open one showing its markdown and options with the correct one marked.

Type names are shown human-readable — "single choice", not `single_choice`.

### ItemIcon (`course/ItemIcon.svelte`) — replaces the emoji
22px rounded square (radius 5) carrying a 11px SVG mark, `viewBox="0 0 16 16"`,
`stroke-width: 1.6` (1.9 for the check), `stroke: currentColor`.

| type | mark |
|---|---|
| page | three horizontal lines, last one short |
| video | filled play triangle |
| quiz | check mark |
| interactive app | three vertical slider tracks with offset knobs |
| mini-project | flag on a pole |

States: **covered** = `--primary` fill, white mark; **current** = `--primary-soft`
fill, 1.5px `--primary` border, `--primary` mark; **not started** = `--surface` fill,
1px `--border-strong`, `--muted` mark.

### Sequence chain (2c)
The items of a sequence render as one row of ItemIcons, 6px gap, no connectors and no
per-item title — the sequence heading above already names it. Item count sits right as
mono 11.5px `--muted`.

This holds one row to ~24 items and wraps cleanly past that. Do not reintroduce
connector lines or the expanded title pill — both reflow the row as the student moves
through the sequence.

### CourseCard (2b)
1px `--border-strong`, radius `--radius`. Title 14.5px/600, then a 4px progress bar
(`--border-soft` track, `--primary` fill), then mono "14/22 items" and a `--primary`
"Continue →". Admin actions live in a footer strip (`--surface-3`, 1px `--border-soft`
top, 12px `--muted`) so they do not compete with Continue.

### Accordions (3b)
Block header: `--surface-2` strip, mono code badge (`B1`) 11px/500 `--primary` on
`--primary-soft` radius 3, title 14px/600, action glyphs right. Sequence header: same
on `--surface`, 13.5px title. Item rows: ItemIcon + 13px title + mono slug, indented,
`--border-soft` separators.

Nesting is carried by indentation, the code badges and the header tints — not by
nested boxes. Reorder arrows follow the existing conditional rendering: no up on the
first child, no down on the last (render disabled to keep alignment).

### Teacher avatar (10d)
A `--avatar` (28px) circle leads each teacher row, before the name/email column:
`--avatar-bg` fill, 1px `--border-strong` ring. With a photo on file it holds the
image, `object-fit: cover`. With none it holds a **drawn** silhouette — inline SVG in
`--avatar-fig`, never an image request — so a missing photo cannot render a broken
tile. No initials fallback: an invited teacher has no name yet.

### Confirm-then-act destructive flows (10i, 10j)
Deleting something with dependents never opens a second dialog. The confirm expands
in place as a `--status-rejected-bg` panel with a 3px `--danger` left rule, stating
the concrete consequence ("referenced by 2 mini-projects", "will remove all
submissions and evaluations"), an "I understand" checkbox, then Force delete and
Cancel. Force delete stays in its unarmed tint until the box is ticked. When the
operator lacks the right, the button renders disabled with the reason in `title`
rather than being hidden.

### Precondition banners (10j, 10m)
A screen whose action is blocked by another screen's state says so inline, not on
submit: `--surface-2` with a 3px `--primary` left rule for information ("Mini-projects
require groups"), `--status-needs-revision-bg` with a `--gold` rule for a list of
things to fix before publishing. Each line names the blocker and links to where it is
resolved.

### Tables (2d)
Header `--surface-2`, 12px/600 `--text-3`. Student and Group columns sticky, 1px
`--border-soft` between rows. Block-grouped column headers span their sequences in a
mono 10.5px uppercase `--muted` row above the sequence names. All cell values mono
11.5px.

**Heatmap:** replace the `hsl(120 * ratio)` sweep in `cellInlineStyle` with the five
`--heat-*` steps (0 / ≤25 / ≤50 / ≤75 / >75%), text always `--heat-fg`. One hue is
colour-blind safe, and low coverage stops reading as an alarm. Add a 0% → 100% legend
beside the filters.

---

## 5. Copy and interaction changes

Not pure styling — these touch markup or state:

1. **VersionsPage `<h1>`** — drop "Edit ·"; the active Authoring nav and the version
   list already say what the page is.
2. **VersionEditPage heading** — lead with the version *label*, with `v7` beside it in
   mono `--muted`, not the reverse. The course name in that heading links back to the
   version list, replacing the back button. Needs a fallback when a version has no
   label.
3. **Create and duplicate forms start collapsed** (§4, Collapsed forms).
4. **Row actions become icon buttons**, four fixed slots per version row.
5. **Version info edits per field**, removing the version-level dirty state (§4,
   Inline field editing).
6. **Item editing opens a modal**, not a route (§4, Item editor modal).
7. **Item type labels** are carried by the ItemIcon, not text — remove "page"/"video"
   strings from the player.
8. **No emoji anywhere.** They render inconsistently and cannot take the accent colour.

---

## 6. Applying this

| file | reference |
|---|---|
| `styles/base.css` | — (drop in `handoff/base.css`) |
| `chrome/AppHeader.svelte` | any screen |
| `pages/Login.svelte` | 2a |
| `pages/CourseList.svelte`, `course/CourseCard.svelte` | 2b |
| `pages/SequencePlayer.svelte`, `course/ItemIcon.svelte` | 2c |
| `runs/RunProgressTab.svelte` | 2d |
| `pages/editor/VersionsPage.svelte` | 3a |
| `pages/editor/VersionEditPage.svelte` + accordions | 3b |
| `pages/editor/ItemEditPage.svelte` → modal | 3c (page), 3e (video), 3f (quiz) |
| `runs/RunSubmissionsTab.svelte`, `runs/SubmissionThread.svelte` | 9a, 9b |
| `pages/MiniProject.svelte` (student) | 9c |
| loading / empty / error states, all tabs | 9d |
| `runs/RunOverviewTab.svelte` | 10a |
| `runs/RunRosterTab.svelte` | 10b, 10f, 10g |
| `runs/RunGroupsTab.svelte` | 10c |
| `runs/RunTeachersTab.svelte` | 10d |
| `pages/RunsList.svelte` | 10e |
| `course/InteractiveApp.svelte` | 10h |
| `runs/RunAssetsTab.svelte` | 10i |
| `runs/RunMiniProjectsTab.svelte` | 10j |
| `runs/NewRunModal.svelte` | 10k |
| `runs/PublishConflictsModal.svelte` | 10l |
| `runs/MiniProjectModal.svelte` | 10m |
