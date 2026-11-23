---
worth: yes
where: backend/mathion/api/assets.py:79
added: 2026-11-22
---
# asset upload commits its row before the file is on disk

`upload_asset` commits the Asset row, then writes the file, and deletes the row again if the disk write
fails. In that gap the row is visible. The OLX import runner (Task 9) retries a lost upload, gets 409,
lists the assets, sees the row with the right size and marks the file done; if the first request's disk
write then fails, the row is gone and Retry skips the file for good.

Not silent: a linked file makes the build refuse ("These files are linked from the course but are not in
the draft: …", nothing built, Delete offered); an unlinked one gets the "was not uploaded" report line. It
needs a disk-write failure at the same moment as a proxy timeout. Smallest fix: flush the row (for the
unique-name 409), write the file, then commit, rolling back on write failure. The same order also fixes a
process killed between commit and write, which today leaves a row with no file for good; a commit that
fails after the write leaves only an orphan file, which the next upload of that name overwrites. Surfaced by Codex on Task 9
of the OLX import (2026-11-22); the owner chose the backlog over fixing it inside Task 9.
