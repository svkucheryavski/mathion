---
worth: yes
where: backend/mathion/api/versions.py:228
added: 2026-11-20
---
# publish and a version-info PATCH take locks in opposite order

Publish rebuilds version-info asset references before its version-row update, while a version PATCH of `info_md` does the reverse. Both edits on one draft at once can deadlock and return 500 on one of them; a retry works. Pre-existing. Not "take the version row first in publish": question and item edits lock their rows and touch the version row last (`content_updated_at`), as publish does, so that would add a deadlock. The odd one out is `update_version`: it assigns `version.info_md` before rendering, so autoflush writes the version row before the info's asset references. Fix (owner 2026-11-24): render and sync the references first, assign the version fields after, in `update_version` and publish.
