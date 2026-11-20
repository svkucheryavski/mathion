---
worth: yes
where: backend/mathion/markdown.py
added: 2026-11-20
---
# image alt text drops a formula

`![a $x$ b](p.png)` renders with alt "a  b": the formula token has no plain-text form in the alt. Found in the maths Task 4 review. Fix: use the formula's source (or its annotation text) in the alt.
