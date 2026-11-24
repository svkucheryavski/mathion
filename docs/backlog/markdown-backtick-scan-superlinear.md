---
worth: yes
where: backend/mathion/markdown.py:255
added: 2026-11-24
---
# many backtick runs make a save scan in about length^1.5 time

`_in_code` rescans the backtick runs for each unmatched run, so a text full of backtick runs renders in roughly length^1.5 time: about 0.5 s at 100 KB and 4 s at 400 KB (measured by Codex in the math backlog round, Task 2). Real texts are far smaller, but a save holds its locks while it renders. This is the backtick half of the old `math-hostile-markdown-saves-slowly` item, which was dropped as unreproduced and is now reproduced. Fix: one pass over the runs (match each opening run to the next run of the same length) instead of a rescan per run.
