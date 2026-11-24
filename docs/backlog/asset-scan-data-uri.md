---
worth: yes
where: backend/mathion/markdown.py:490
added: 2026-11-20
---
# asset scan treats a data: URI as an asset name

`_SKIP_PREFIXES` has no `data:`, so `![a](data:image/png;base64,AAAA)` is treated as an asset name and the save fails with 422 (upper-case schemes were fixed in the maths Task 4: the backend lower-cases). The frontend mirror is gone since the math backlog round: the Assets tab reads the server's `referenced_by`. Fix: add `data:` to `_SKIP_PREFIXES`.
