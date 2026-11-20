---
worth: yes
where: backend/mathion/api/asset_render.py:9
added: 2026-11-20
---
# missing-asset message shows percent-encoded names decoded

A percent-encoded valid name in the 422 missing-asset message is shown decoded, so `p%69c.png` reads as `pic.png`, and two spellings of one name can repeat. Contrived input; the save still fails correctly. Fix: dedupe, and keep the encoded spelling when decoding changes ASCII letters. Found in the maths Task 4 review.
