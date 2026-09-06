---
worth: later
where: backend/mathion/markdown.py:7
added: 2026-09-04
---
# bare URLs in authored markdown render as plain text

`_md = MarkdownIt("commonmark", {"html": False})` runs the CommonMark preset, which has no `linkify`.
Autolinking a bare URL is a GFM extension, so an author who pastes `https://example.org/…` into a
question prompt, page body, or explanation gets unclickable text. Surfaced in Slice-3 T3's browser pass
(2026-09-04), where a seeded prompt's URL rendered flat; the frontend is not involved — it renders
whatever `text_html` the backend hands it.

`later`, not `yes`: the unknown is whether authors are expected to write explicit `[text](url)` links.
Flipping `linkify` on is a one-line change plus the `linkify-it-py` dependency, but it re-renders every
markdown body already in the database, and it will also catch strings authors did not mean as links
(bare domains inside code prose, `foo.py` style filenames). That makes it a content-behavior decision
about what authors are promised, not a config tweak. Settling it means asking whether any real course
content relies on either behavior.
