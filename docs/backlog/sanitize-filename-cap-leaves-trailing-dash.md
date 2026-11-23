---
worth: yes
where: backend/mathion/assets.py:55
added: 2026-11-22
---
# sanitize_filename's 255 cap can leave a trailing dash before the extension

`sanitize_filename` strips edge dashes first and caps the name at 255 afterwards, so the cut can land right
after a dash: `"a" * 250 + "-b.png"` becomes `"a" * 250 + "-.png"`. The result is ugly and not idempotent —
cleaning it again gives `"a" * 250 + ".png"`. Ordinary uploads with very long names get the odd name;
nothing breaks. Found in OLX import Task 6 review, where the import works around it with
`olx.files.clean_name` (sanitize until stable). Fix: `base[:keep].rstrip("-") or "file"`, add a test for
idempotence, then `clean_name` can become a plain call.
