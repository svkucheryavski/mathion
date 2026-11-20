---
worth: yes
where: frontend/src/lib/extractAssetRefs.ts:1
added: 2026-11-20
---
# frontend extractAssetRefs.ts no longer mirrors the backend

Its header says it mirrors `extract_asset_filenames` in `backend/mathion/markdown.py`, but the backend now scans markdown-it tokens (code spans, reference links, formulas), not a regex. So the run-assets used/orphan badge can disagree with the backend. The backend delete guard stays correct. Found in the maths Task 4 and Task 6 reviews. Fix: have the backend report usage, or port the token rules.
