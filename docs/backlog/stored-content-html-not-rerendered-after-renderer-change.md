---
worth: yes
where: backend/mathion/api/content.py:203
added: 2026-09-05
---
# already-published pages keep HTML from the old renderer

`content_html` is rendered once and stored: on item create/update (`api/items.py:96,214`), on
publish (`api/versions.py:334`, which re-renders every item in the version), and on clone
(`api/version_clone.py:143`). `api/content.py:203` serves the stored string verbatim and never
re-renders. So a change to `render_markdown` reaches existing content only when something happens
to re-render it.

Surfaced by the Slice-3 T5 `<ol start>` fix: `_ALLOWED_ATTRS` gained `"ol": {"start"}` so a list
resuming at 3 keeps `<ol start="3">`. Verified by execution that the old policy stored `<ol>` and
the new one emits `<ol start="3">`. T5 also split `list-style` by list type, so `<ol>` renders
decimals instead of bullets — and that CSS applies to **already-stored** markup immediately. An
already-published page whose author wrote "3. 4. 5." after a paragraph therefore renders "1. 2. 3.".
Wrong content in a maths derivation, not merely unstyled markup.

**A first version of this item argued published versions are immutable, so a backfill would rewrite
frozen snapshots. That was wrong** — codex disproved it and the correction is worth recording,
because the wrong version made the problem look smaller than it is:

- `_ITEM_EDITABLE_PUBLISHED = {"title", "content_md", "video_url", "script_url"}` (`api/items.py:21`)
  — `content_md` **is** editable while a version is published, and editing it regenerates
  `content_html` (`api/items.py:204-214`).
- Only `archived` versions are actually frozen (`api/items.py:121`).

So stored `content_html` is already treated as a regenerable artifact, not a sealed snapshot, and
re-rendering a published item breaks no guarantee the code makes today.

What is still genuinely open is the **scope of a backfill**, not whether one is permissible: a
blanket "re-render every item" sweeps in every other `render_markdown` change since each version
was published, not just this one, and archived versions are edit-locked so a migration would have
to decide whether to touch them at all. A narrowly targeted pass — only items whose stored
`content_html` contains an `<ol>` that the current renderer would emit with a `start` — has a much
smaller blast radius and is the obvious candidate. Needs an endpoint-level regression test seeded
with pre-change stored HTML.

**Disposition (2026-09-06):** raised again by codex at the Slice-3 close-out as an Important that
should not be deferred, and the reasoning is accepted — before T5 a resuming list rendered as
bullets (visibly broken), whereas now it renders "1. 2. 3." (plausible and wrong), which is the
worse failure. Measured on the dev database at that point: 0 of 12 items carry a stored `<ol>` at
all, so nothing is affected there. Scheduled as its OWN branch immediately after Slice 3 rather
than appended to the close-out: a re-render pass over stored course content is a backend data
change with its own archived-version decision, and it deserves its own review loop.

The same exposure applies to [[bare-urls-not-autolinked-in-markdown]] if that one is ever done —
it is a property of the stored-HTML design, not of either individual fix.
