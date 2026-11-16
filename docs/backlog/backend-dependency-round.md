---
worth: yes
where: backend/constraints.txt:1
added: 2026-11-16
---
# the backend pins hold nh3 and others below their current releases

`backend/constraints.txt` (fix/ci-green, 2026-11-16) pins the dev venv's versions so CI and the image stop drifting. That also holds the HTML sanitizer `nh3` at 0.3.4 (0.3.7 is out) and every other package (SQLAlchemy 2.0.49 vs 2.1.x, FastAPI, Starlette…) where they were.

Do one deliberate round before the public beta: check the nh3 changelog and ammonia RUSTSEC advisories, bump, run the suite in Linux (`python:3.13`), and re-decide the two outputs that change:
- markdown-it-py 4.3.0 links a bare `https://[::1]/x` (`backend/tests/test_markdown.py:334`, today kept plain);
- nh3 0.3.7 writes `title="&lt;/a&gt;"` for a title holding `</a>` (`backend/tests/test_markdown.py:350`; harmless, the test expects the old text).
The CI step "Installed versions equal backend/constraints.txt" fails until the file matches the new set.
