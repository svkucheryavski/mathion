---
worth: later
where: backend/mathion/latex_mathml.py:1262
added: 2026-11-20
---
# a script after a multi-atom \bm argument goes on the whole group

`\bm{a x_i}^2`, `\bm{ab}^2` and `\bm{\textstyle x_i}^2` put the superscript on the whole bold group, while LaTeX's bm puts it on the last atom: a superscript a little further right in rare bold input. Fixing it means reworking the reviewed limits-through-style walk. Unknown that settles it: the owner's call, fix before beta or leave (maths Task 3 ruling).
