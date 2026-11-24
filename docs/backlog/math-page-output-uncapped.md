---
worth: no
where: backend/mathion/markdown.py
added: 2026-11-24
---
# one text's total MathML is not capped

Each formula's MathML is capped (60 000 characters, math round 2026-11-24), but one Markdown text is not: 170 formulas of 590 `∑` each (100 KB of Markdown) render to 10.7 MB of HTML, each formula under the cap. Owner's call 2026-11-24: per formula only — only admins write this text and no real page looks like that.
