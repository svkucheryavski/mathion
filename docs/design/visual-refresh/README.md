# Handoff: Mathion visual refresh

## Overview
A complete visual system for Mathion — a learning management system with course
authoring, versioned course content, student sequence playback, and teacher-side run
management (roster, groups, progress, submissions, mini-projects, assets).

The refresh is styling and interaction pattern only. No feature was added or removed:
every screen here corresponds to a component that already exists in the Svelte
frontend. Where a pattern changes markup or state (an editor becoming a modal, forms
starting collapsed, per-field editing), it is called out explicitly in
`mathion-visual-spec.md` §5.

## About the design files
The files in this bundle are **design references created in HTML** — prototypes
showing intended look and behaviour, not production code to copy. The task is to
recreate them in the existing Svelte 5 codebase using its established patterns:
`src/components/`, `src/pages/`, `src/styles/base.css`, the `ui/` primitives
(`Button.svelte`, `FocusTrap.svelte`, …). Do not port the HTML.

`reference-screens.dc.html` opens in a browser and holds all 26 screens on one
scrollable canvas, each labelled with the id used throughout the spec (2a, 3b, 10i…).
Open it side by side with the spec.

## Fidelity
**High-fidelity.** Final colours, typography, spacing, radii and control metrics.
Recreate the UI to these values. Every number in the spec is deliberate — the control
scale in particular was tightened across three review passes, so do not substitute
roomier defaults from a component library.

## Where to start
1. Drop `base.css` over `src/styles/base.css`. It keeps every existing variable name,
   so nothing breaks on the first commit, and adds the new tokens.
2. Add the two IBM Plex font links to `index.html` (snippet in spec §1).
3. Work component by component down the file map in spec §6. `AppHeader` and
   `ui/Button.svelte` first — they appear on every screen.
4. Replace the item-type emoji with `ItemIcon` (spec §4). This is the single most
   visible change.

## The design in one paragraph
Steel blue `#3F5C77` on a cool near-white `#FBFBFC`. IBM Plex Sans for text, IBM Plex
Mono for every numeral — counts, dates, ratios, version numbers, slugs. 13–14px base,
5px radii, 1px hairlines, no gradients and no shadow beyond a 1px card lift. Gold
`#E8A317` appears only twice: in the logo's back peak, and as the pale
`#FDF3D9` pill marking the active nav item. Neutral states are grey, so a warm colour
always means "act on this". Contrast floor is 4.5:1 with `--muted` `#5A616E` as the
lightest readable text; `--faint` is for disabled glyphs and separators only.

## Reference screens
| id | screen | source component |
|---|---|---|
| 2a | Sign in — PIN step | `pages/Login.svelte` |
| 2b | Your courses | `pages/CourseList.svelte`, `course/CourseCard.svelte` |
| 2c | Sequence player | `pages/SequencePlayer.svelte`, `course/ItemIcon.svelte` |
| 2d | Run dashboard — Progress | `runs/RunProgressTab.svelte` |
| 3a | Versions | `pages/editor/VersionsPage.svelte` |
| 3b | Version editor | `pages/editor/VersionEditPage.svelte` + accordions |
| 3c | Item editor — page (modal) | `pages/editor/ItemEditPage.svelte` → modal |
| 3e | Item editor — video (modal) | same |
| 3f | Item editor — quiz (modal) | same |
| 9a | Run · Submissions | `runs/RunSubmissionsTab.svelte` |
| 9b | Submission thread | `runs/SubmissionThread.svelte` |
| 9c | Mini-project — student | `pages/MiniProject.svelte` |
| 9d | Loading, empty and error states | all tabs |
| 10a | Run · Overview | `runs/RunOverviewTab.svelte` |
| 10b | Run · Roster | `runs/RunRosterTab.svelte` |
| 10c | Run · Groups | `runs/RunGroupsTab.svelte` |
| 10d | Run · Teachers | `runs/RunTeachersTab.svelte` |
| 10e | Runs list | `pages/RunsList.svelte` |
| 10f | Import roster — paste | `runs/RunRosterTab.svelte` |
| 10g | Import roster — result | `runs/RunRosterTab.svelte` |
| 10h | Interactive app | `course/InteractiveApp.svelte` |
| 10i | Run · Assets | `runs/RunAssetsTab.svelte` |
| 10j | Run · Mini-projects | `runs/RunMiniProjectsTab.svelte` |
| 10k | New run (modal) | `runs/NewRunModal.svelte` |
| 10l | Publish conflicts (modal) | `runs/PublishConflictsModal.svelte` |
| 10m | Mini-project editor (modal) | `runs/MiniProjectModal.svelte` |

The first card on the canvas is a visual-system reference — logo at four sizes, the
palette, all eight status badges, the coverage ramp, and the five item-type marks.

## Design tokens, components, behaviour
All of it is in **`mathion-visual-spec.md`**, which is the authoritative document:

- §1 Tokens — the full variable set and the contrast rule
- §2 Logo — geometry, sizes, the exact header lockup
- §3 Colour of state — which hue is allowed to mean what
- §4 Components — AppHeader, Button, icon buttons, inline field editing, disabled rows,
  collapsed forms, item editor modal, ItemIcon, sequence chain, CourseCard, accordions,
  teacher avatar, destructive confirm flows, precondition banners, tables
- §5 Copy and interaction changes — the eight items that touch markup or state
- §6 File map — every component to the screen id that shows it

## Assets
No image assets. Every icon is inline SVG defined in the spec (item-type marks, action
glyphs, the avatar silhouette). The logo is two SVG paths — full source at the foot of
`base.css`. Fonts are IBM Plex Sans and IBM Plex Mono from Google Fonts.

`image-slot.js` and `support.js` are only there so `reference-screens.dc.html` opens
correctly. Neither belongs in the app.

## Files in this bundle
| file | what it is |
|---|---|
| `mathion-visual-spec.md` | the spec — read this |
| `base.css` | drop-in replacement for `src/styles/base.css` |
| `reference-screens.dc.html` | all 26 screens, one canvas, open in a browser |
| `image-slot.js`, `support.js` | runtime for the reference canvas only |
