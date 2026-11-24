---
worth: yes
where: backend/mathion/markdown.py:509
added: 2026-11-20
---
# asset URL rewrite reaches text that only looks like an image src

`resolve_asset_urls` is a plain string replace on the rendered HTML. With `pic.png` in the pool, `![p](pic.png) and $\text{src="pic.png"}$` shows `src="/assets/5/pic.png"` in the formula and its annotation; the same happens in a code span (old) and in a broken formula's error source. No injection (the replacement is a validated asset name). Fix: rewrite image tokens before rendering, not the HTML string.
