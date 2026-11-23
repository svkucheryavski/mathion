---
worth: no
where: backend/mathion/latex_mathml.py:1262
added: 2026-11-20
---
# a script after a multi-atom \bm argument goes on the whole group

`\bm{a x_i}^2`, `\bm{ab}^2` and `\bm{\textstyle x_i}^2` put the superscript on the whole bold group, while LaTeX's bm puts it on the last atom: a superscript a little further right in rare bold input. Fixing it means reworking the reviewed limits-through-style walk. Decided not to fix (owner, 2026-11-23, confirming the maths Task 3b ruling): the shift is small and rare, and the fix would rework reviewed code shared by every \bm, \displaystyle and limits case.
