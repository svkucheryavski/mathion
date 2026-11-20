---
worth: yes
where: backend/mathion/markdown.py:254
added: 2026-11-20
---
# hostile Markdown shapes make a save slow

Two contrived shapes found in the maths typesetting reviews (Task 4) take seconds to render:
- an unclosed `$$` line followed by a paragraph-interrupting line, repeated: `"$$x\n# h\n"*4000`, 3.7-5.8 s at 32 KB;
- `_in_code` measured about O(L^1.5) on hostile backtick runs, 0.69 s at 102 KB (the input was not recorded; a later review could not reproduce it).

No real text has these shapes, and saves run in the threadpool, so the result is a slow save, not a blocked server. Fixes: stop the `$$` scan at a later line holding an unescaped `$`; index backtick runs once (bisect) in `_in_code`.
