---
worth: yes
where: backend/mathion/latex_mathml.py:1403
added: 2026-11-20
---
# typeset formula output has no size cap

MathML can be 40-100 times the source size: `$` + `∑`×2000 + `$` gives about 214 KB, and a 2000-character `=:` chain gives 74 KB. `content_md` has no length cap, so a 100 KB page of such formulas stores and sends several MB of HTML (render time stays under 0.4 s). Only a course admin can do it. Fix: raise "formula too long" (an error box) once a formula's output passes about 60 KB. Found by both whole-branch reviewers of the maths branch.
