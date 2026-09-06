---
worth: yes
where: frontend/src/components/items/PageItem.svelte:77
added: 2026-09-05
---
# h4/h5/h6 and blockquote render badly in student page content

`.content` styles only `h1`/`h2`/`h3`. All of `h4 h5 h6 blockquote` are in `_ALLOWED_TAGS`
(`backend/mathion/markdown.py:12,15`) and the CommonMark renderer emits them, so a teacher can
put them in page content today.

Verified in Chromium against real `render_markdown` output:

- `#### x` → 13px/600 with `margin: 0` (`base.css:19` + `reset.css:5`), jammed flush against the
  paragraphs above and below — no visual break at all.
- `##### x` → renders *smaller than body copy*, also `margin: 0`.
- `> quote` → only the UA `margin: 1em 40px`; no rule, no border, no recede. Reads as an
  accidentally-indented paragraph.

Pre-existing, not introduced by the Slice-3 visual refresh. Left out of Slice-3 T5 deliberately:
spec §2 scopes PageItem to *retargeting the existing rules*, and the vendored handoff has no
artboard for these levels, so picking sizes/margins/quote treatment is new design work rather than
a port. The h1–h3 scale and the `--surface-2` treatment `pre`/`code` already use are the obvious
starting points.

Not reachable and therefore NOT part of this item: `table/thead/tbody/tr/th/td`. `_md` is built as
`MarkdownIt("commonmark", {"html": False})` (`markdown.py:7`), which disables the table rule *and*
blocks raw HTML, and every `content_html`/`info_html` producer routes through `render_markdown`
(`api/blocks.py:89,182`; `api/asset_render.py:22,24,180,182`). `img` is already safe via
`reset.css:9`. Definition lists are impossible (`dl/dt/dd` not in the allow-list).

Related: [[bare-urls-not-autolinked-in-markdown]] — the same authored-markdown surface.
