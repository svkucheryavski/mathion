# Asset panel: newest first, search, own scrolling — design

Status: approved by the owner 2026-11-27 (short design, small change).

## Why

In the item editor the asset panel lists every course asset. With many assets the panel grows very
tall, the text area stretches to the same height, and the whole modal becomes one long scroll. The
owner wants the text and the asset list to scroll independently, and the list to stay short.

## What changes

The asset panel (`frontend/src/components/editor/AssetSidebar.svelte`) sits inside every Markdown
editor with assets: the item editor, quiz question and explanation editors, and the mini-project
editor (run assets). The change applies to all of them.

- **Newest first.** The list is sorted by `uploaded_at`, newest first; equal times (an Open edX import
  uploads all files at once) fall back to the higher `id` first. The server already sends
  `uploaded_at` on both course and run assets; `AssetItem` gains the field. No server change.
- **Search field** at the top of the panel, under the title. No visible label; the placeholder reads
  `Find an asset` and the same words are its accessible name. It filters while typing: the file name
  contains the text, ignoring letter case and surrounding spaces. No server call.
- **Empty search:** the 6 newest assets, then a muted line `N more, type to find them` when there
  are more than 6. (Owner, 2026-11-27: 6, not 8 — rows are about 47.5px, and 8 left the editor
  window scrolling on a 1440×900 screen.)
- **While typing:** every match, newest first. No match: `No assets match`.
- **Own scrolling.** The list has a maximum height of six and a half rows (312px; the cut row shows
  that more matches scroll, since macOS hides scrollbars) and scrolls inside it. With more assets
  than the cap, the rows area keeps the list's full room (312px), so the panel does not jump while searching. The text
  area keeps its own scrollbar and matches the panel's height or its own, whichever is taller, so
  neither can grow without limit. Stacked layout (below 880px): the same list maximum height.
- **Escape** in a non-empty search field clears it and stays in the field; the editor modal stays
  open. In an empty field Escape behaves as today.
- Unchanged: insert on click, upload (button and drop), delete with its question, the `used` badge,
  the cursor hint, errors and progress lines.

## Approaches considered

1. **Client-side filter over the full list (chosen).** The server already returns the whole list; a
   course has at most a few hundred assets, cheap to filter in the browser.
2. Server-side search and paging: more endpoints and requests for no gain at this size. Rejected.
3. Only cap the list height, no search: still a long scroll to find one file. Rejected.

## Builder's calls (marked as mine)

- After an upload finishes, the search clears so the new file shows at the top of the list. Rule: a
  reload that brings an asset id the panel has not seen before clears the search (covers the panel's
  own drop zone and drops onto the text area; a reload after a save brings no new id and keeps it).
- Focus repair after a delete (`refocusAfterDelete`) works on the rows on screen (the shown slice),
  not the full list; a row hidden by the cap or the filter is never a focus target.
- A row that leaves the screen (search, or a new upload pushing it past the 6) closes its idle delete
  question, moving focus on if it was inside, as a reload without the row does today. A busy delete
  on a hidden row still finishes, and its error line still shows.
- The search field stays usable while the panel is disabled (a save is running): it changes no data.
- No visible clear (×) button (`type="text"`, not `search`, so WebKit adds none); Escape or deleting
  the text clears it.
- 400px phone width is not a target (authoring is laptop-only).

## Not in scope

Thumbnail size, the run assets tab (`RunAssetsTab.svelte`, a separate page), sorting choices.
