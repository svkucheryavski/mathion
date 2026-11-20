---
worth: yes
where: backend/mathion/api/versions.py:331
added: 2026-11-20
---
# publish and reorders write rows in different orders

Publish's item render loop selects items with no ORDER BY, so stale items flush in heap order and can deadlock against `reorder_items` (ascending ids). One of two near-simultaneous requests returns 500; a retry works. Pre-existing, a bit more reachable since every formula item is stale once. Fix: `.order_by(Item.id)`.

Same class (Codex, whole-branch review of the maths branch): publish flushes stale block rows 1 → 2 (`versions.py:353`), while a block reorder payload `[{"id":2,…},{"id":1,…}]` writes them 2 → 1 (`blocks.py:228`), so the two can deadlock too. Fix: iterate reorder entries sorted by id, keeping their order values, with a reverse-payload test.
