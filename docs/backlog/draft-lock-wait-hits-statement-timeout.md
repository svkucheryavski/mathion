---
worth: later
where: backend/mathion/database.py:24
added: 2026-11-24
---
# a save waiting on the draft lock gets a 500 after 30 s

Every draft write takes the per-version advisory lock (ns 4) first. Publish, duplicate and
copy-from-version hold it across their whole run, including file copies. A save on the same
version waits inside `pg_advisory_xact_lock`, and that wait counts against the 30 s
`statement_timeout`. So a publish or copy that runs longer than 30 s gives the waiting author
a 500 instead of a wait or a clear "try again". Reaching it takes a very large asset set or a
slow disk. Surfaced in the beta gate round's whole-branch review (Fable minor 4).

The unknown that settles the value: how long a save should wait. One answer is a
`lock_timeout` on the lock call with a 409 "the course is being published, try again"; the
other is to keep the long holds short (copy files outside the lock).
