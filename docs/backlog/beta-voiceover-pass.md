---
worth: yes
added: 2026-11-12
---
# Screen-reader and keyboard checks for the beta VoiceOver pass

These were parked from the superuser panel slices and the visual-refresh slices for the single VoiceOver pass at beta.

## Users and Courses

- An info `NoteStrip` inserted together with its text may not be announced by every screen reader (a status region announces changes, not its own insertion); for the VoiceOver pass at beta (Opus r1).
- After a course delete, focus returns to the trash of a row the reload removes; focus the heading or New course instead (Opus r1).
- The dialogs' error sentence is described on the form, not tied to its field (no `aria-invalid`); for the VoiceOver pass at beta (Opus r1).
- The blocked trash's reason is only in `title`; `aria-label` "Delete <name>" names it and a keyboard user sees no tooltip; put the reason in the label when blocked (Fable r1).
- After a confirmed strip, focus is lost: Disable and Enable swap buttons, and a deleted row goes away; focus the heading or the row's next button (both lanes r1, as Task 6's delete).
- `.u-count` is not a live region, so a screen reader does not hear the new count after a search or pill; for the VoiceOver pass at beta (Fable r1).
- The chips' hover list is in `title` only, so a sighted keyboard user can't open it; the chips are plain spans (both lanes; beta a11y pass).
- VoiceOver may read a chip's `title` and its hidden list twice; check in the VoiceOver pass at beta (Opus).

## Branding

- **The file line's change from "checking…" to "N colours" isn't announced** (Fable r1 M1). A screen-reader user isn't told when the check answers and Save is ready; the blocked sentence is (role=status). Fix: `aria-live="polite"` on `.ec-file`. For the VoiceOver pass at beta.

## Settings

- **Edit email focus:** opened with email off, focus lands on × instead of
  the switch (Mail server is disabled).
- **Edit email a11y:**
  - The answer's `role="status"` region is created already filled, so a
    screen reader may not announce it. Keep an empty live region mounted.
  - The visible "Encryption" and "Longest sign-in" captions aren't tied to
    their radiogroups (`{uid}-enc` is unused); use `aria-labelledby`.

## Slice 4 (student)

- The file input's accessible name is the wrapping label's text (the picked filename once one is
  chosen); verify with a screen reader before adding an `aria-label`.

## Slice 5a (authoring)

- **The heading link's purpose is only in its `title`** — a screen reader hears "link, Applied Linear
  Algebra"; "Back to versions" is a description only, and `v{id}` sits outside the `<h1>`. Spec choice.
- **The item type is not announced.** `ItemMark` is `aria-hidden`, so a screen reader hears the item title
  but not its type (the old emoji was `aria-hidden` too). A visually-hidden type word would fix it.

## Slice 5b (item editor)

- **AssetSidebar: the disabled trash's reason is hidden from assistive tech** — `aria-label="Delete …"`
  overrides the `title`. Fix: when referenced, `aria-label={`${inUseReason}: ${a.filename}`}`.
- **Hand-off to T3a: plain mode drops `ariaLabel` / `ariaDescribedby`** — the `pre` has no accessible
  name. PageBody should label its wrapper (visible label or `aria-labelledby`).
- **PageBody: plain / readOnly branches have no accessible name** (the T2 hand-off was not applied here).
  Fix: `role="group" aria-label="Content"` on a wrapper, or carry `ariaLabel` onto MarkdownEditor's `pre`.

## Slice 5c (constructor)

- **The panel's label dangles while renaming.** The heading + toggle are
  swapped for the input, so `role=region aria-labelledby={headerId}` points at
  a missing element for the duration. Keep the heading and put the input in it.
- **Screen readers read "plus Add block".** Wrap the glyph: `<span aria-hidden="true">+</span> Add block`, and the same for sequence and item.
- **The attempts error is not announced (r1).** The `<small>` is linked via `aria-describedby`, but nothing moves focus to it or makes it a live region, so a screen reader hears nothing on Save. Focus the attempts input on a validation error.
- **The label error isn't announced either (r1, Fable).** It is the same gap as the attempts error (see §T5). Fix both together by focusing the first invalid field.
- **Heading / region names carry the progress phrase** (both lanes): the header button's aria-label is
  also the `<h2>` name and, via `aria-labelledby`, the panel region name ("1. Vectors, 2 of 3 items
  completed, quiz score 50%, region"). Alternative: `aria-describedby` to a hidden span keeps the
  heading short. Kept because it is informative and the sr-only span form mis-announced in Chrome.

## Slice 5d (quiz editor)

- **VoiceOver (Safari) does not speak "Saved" after an inline save** — found in the Safari pass 2026-10-09.
  The save itself succeeds (PATCH 200). "Answer moved to position 2 of 2" IS spoken, so the live region works;
  "Saved" is missed even on a fresh quiz modal (not only on a repeat). Likely cause: the save closes the field
  (the focused input is removed) and focus jumps back to the answer button in the same moment, and VoiceOver
  reads the new focus at length and drops the polite message. Candidate fix: announce "Saved" after the
  focus move has settled (a short delay, or `role="status"` with the update in a later task), then re-test
  with VoiceOver. Also still unverified: whether a repeated identical message is re-read (`say()` clears and
  sets it in a microtask, likely coalesced by WebKit) (T2, Fable M3). User: not a priority now.
- `cutName` can split a surrogate pair at the cut (Opus M5).
- The "Edit answer" title repeats the button's accessible name for screen readers.

## Slice 6a (teacher run pages)

- **Safari pass with the user (2026-10-11) — done.** OK: the Teaching list and the course runs list, the run frame at a laptop width and at about 1000px, Progress (sideways scroll inside its card, sticky Student/Group columns), Submissions, the dirty-grade guard, Groups, Teachers, Mini-projects, Assets (upload, bulk strip, Replace and Delete confirms), and the old bookmarks (signed in, and signed out through login with one `?next=`). Changed on the user's word: one page width `--page-max` 1140px (`57c5864`), Submissions' CSV as a text button (`577f45f`), plain delete confirms as one-line rows under their row plus semi-bold deadline labels (`c626192`). P19 kept (no `<h2>` on Progress/Submissions). Spec rev 5 records these.
  - Not done: VoiceOver on the confirm groups ("Delete X?, group" before Cancel) — skipped by the user; the naming is pinned by tests.
  - Expected, not findings: the grading side panel still looks unstyled (DashboardSidePanel is 6c); Submissions sorting not checkable with one group (unchanged in 6a, covered by tests).
  - Dev setup note: the dev backend needs `MATHION_ASSET_PATH` (run-debug.sh sets `$HOME/mathion-assets`); without it uploads fail with "Failed to write asset file". The handler hides the real error behind that message.
- Round 2: the DangerConfirm group and its button are announced with the same words ("Force delete, group" … "Force delete, button"); a name like "Confirm force delete" would read better. Cosmetic.
- The tabpanel has no `tabindex="0"`; the ARIA tabs pattern suggests one when a panel may open on non-focusable content (Progress or Submissions while loading). Optional.
- Pre-existing: the out-of-scope cell is `<span aria-label="No data">—</span>` with no role, which screen readers may not announce; visually-hidden text would be robust.
- `RunListPage` actions header uses `<th aria-label>` where the tabs use a visually-hidden span.
- The Mini-projects and Assets single-row delete confirms are named "Delete this mini-project?" / "Delete this asset?", not after their row (the three new labels are); pass `label="Delete {name}?"` if wanted.
- Every InlineConfirm with a warning is now a group named by it, including the confirms outside 6a (Unpublish, MiniProjectModal publish, discard prompts); the MiniProjectModal publish group's name is its whole two-sentence warning. Keep in mind for 6b/6c.

## Slice 6b (teacher modals)

- **List semantics in Safari.** `.pc-emails { list-style: none }` makes VoiceOver drop "list, N items". Fix: `role="list"` on the `<ul>`.
- **Switch's accessible name rests on `<label for>`.** Its subtree is an empty `aria-hidden` span. Browsers honour it; the VoiceOver pass should confirm "Groups enabled, switch, off". If not, add an optional `labelledby` prop.
- **Step marker list semantics in Safari.** `<ol class="ri-steps">` with `list-style: none` loses "list, 2 items" in VoiceOver. Fix: `role="list"` (same family as Task 1's `.pc-emails`).
- **The drawn "·" is read aloud** (both lanes). `.mpm-box-list li::before { content: '· ' }` enters the accessible name, so VoiceOver says "middle dot" before each bullet (and in the inputs' `aria-describedby` text); `list-style: none` also drops list semantics in Safari. Fix: `content: '· ' / ''` and `role="list"`. Check in the Safari pass; Task 5 touches the box.
- **The drawn "·" is read aloud from the moment the editor opens** (raises Task 4's minor). With the box up front, every field with an unmet precondition is described as "middle dot Hard deadline must be set". Same fix: `content: '· ' / ''` and `role="list"`. Check FIRST in the 6b browser pass.
- **Observation:** with no live region, nothing announces the box appearing or going while typing (the spec's choice); each field's description and Publish's title carry the reasons. If VoiceOver finds the disabled Publish too silent, add `aria-describedby` from Publish to the box heading.
- the drawn "·" in the precondition box (Task 4/5 minors; ready fix: `content: '· ' / ''` + `role="list"`);
- `role="list"` on the step marker and on `.pc-emails`;
- the Switch's name from `<label for>` ("Groups enabled, switch, off"; else add a `labelledby` prop);
- whether the disabled Publish is too silent without a description;
- Done's description from the summary ("Done, button, 1 added, 1 failed") and the import tiles' "Valid" / "Will skip" names;
- how "Import roster, button" sounds as the import opens from the empty-roster link.

## Slice 6c (overview, roster, side panel)

- **No success announcement after an add.** The row just clears, with focus back in the e-mail field. Collect for the VoiceOver pass at beta.
- **The row group select is natively `disabled` while its request runs.** Since Polish 3 F8 focus comes back to it when the request lands, but it is on `<body>` meanwhile. Check what VoiceOver announces in the VoiceOver pass at beta.
- **The feedback-file error is not in the attach button's `aria-describedby`.** "Only PDF files accepted." is announced once (role=alert). When focus returns to "attach PDF", the error isn't read again. Fix: give the `<p>` an id and add it to the describedby while the error shows, as the Score and Feedback fields do. Check in the VoiceOver pass at beta.
- **A busy Publish has no reason `title`** (R44 asks for one); the visible "Publishing…" covers sighted users.
- **The Version row's disabled ✎ has no `aria-label`,** so its name is the reason sentence. Fix: `aria-label="Edit the version"`, or check it in the VoiceOver pass at beta.

## Polish 1 (confirms)

- Each question group is named by its text ("Delete block "Vectors"? This cannot be undone., group") before its buttons; the key question reads its bold lead and the warning as one name (R52).
- A busy confirm announces busy (`aria-busy`), and Cancel is announced as unavailable while it runs.

## Polish 2 (named items)

- The 404 announces itself on load (ErrorState's `role="alert"`): check it reads once, title then message, and does not repeat on re-render.
- Nothing announces that an authored link opens a new tab. A visually hidden "(opens in a new tab)" added by `externalLinks` is the candidate.
- For the beta VoiceOver pass: `aria-current` on the strip's current ItemIcon (Fable recommendation).
