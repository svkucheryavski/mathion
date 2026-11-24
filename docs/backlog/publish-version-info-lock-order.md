---
worth: yes
where: backend/mathion/api/versions.py:228
added: 2026-11-20
---
# publish and a version-info PATCH take locks in opposite order

Publish rebuilds version-info asset references before its version-row update, while a version PATCH of `info_md` does the reverse. Both edits on one draft at once can deadlock and return 500 on one of them; a retry works. Pre-existing. Fix: take the version row first in publish.
