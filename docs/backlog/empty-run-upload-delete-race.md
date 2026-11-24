---
worth: yes
where: backend/mathion/api/run_assets.py:95
added: 2026-11-24
---
# upload racing a forced run delete in a run with no mini-projects

Upload and `delete_run` serialise on the run's mini-project advisory locks, so in a run with no mini-projects neither takes a lock. An upload that inserts its asset while a forced run delete is running can make the delete end in a foreign-key 500; a retry works. The same is true on main; found by Fable in the math backlog round's whole-branch review. Fix: both take one lock for the run itself (for example a row lock on the run, or an advisory lock in its own namespace) before their mini-project locks.
