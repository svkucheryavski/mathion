---
worth: yes
added: 2026-11-23
---
# OLX import: one golden contract test across browser and server

Each seam of the import is pinned by hand-copied literals on both sides: the frontend tests build blobs and plans themselves, and the backend `CHECK` body and `fixture_files()` are Python twins of what the reader makes. No test passes real reader output to the real schema, or a real check answer to the real runner, so a drift between the two sides (the shared blob-key bug the whole-branch review found was one) passes every test.

One golden test over the committed fixture tar would close it: `readExport(fixture tar, [sine-demo.js])` equals a committed `olx-course.body.json`; posting that JSON to `/check` equals a committed `olx-course.check.json`; `uploadAll` over the check's uploads with the reader's own blobs and a stub fetch sends exactly the planned targets with the right bytes; and the body from `assembleBuildBody` builds with 200. A second fixture with `static/app:sine-demo.js` and a static/app name twin is the blob-key regression. Suggested by Fable in the whole-branch review (2026-11-23).
