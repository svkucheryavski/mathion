---
worth: yes
where: backend/mathion/latex_mathml.py:968
added: 2026-11-20
---
# fractions and scripts do not track TeX's text/script style

The converter has no style tracking beyond `parser.display`, so:
- fraction parts in text style are spaced like display (inline `\frac{a+b}{c}`, `\tfrac`, fractions in scripts); TeX sets them in script style, tight;
- `\frac`/`\tfrac` parts and script arguments do not clear `parser.display`, so display `\frac{\left(\lim_n a\right)}{2}` grows its brackets (pdflatex does not);
- the `\over` numerator is sized as display (`\left(\lim_n c\right)\over b` grows).

Owner item before beta (maths Task 3b deferral); needs its own small round.
