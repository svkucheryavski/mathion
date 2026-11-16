---
worth: yes
added: 2026-11-16
---
# frontend tests settle by counting microtask turns

About 80 test files wait with `for (…; i < N; i++) await Promise.resolve()` before asserting. How many turns a stubbed `fetch` reply needs is a Node internal: `Response.json()` takes 8 turns on Node 22 and 4 on Node 26. That is why CI (Node 22) failed 31 tests in 6 files from 2026-11-03 until fix/ci-green pinned Node 26.

A Node or undici update can shift the count again. Replace the fixed loops with helpers that wait until the expected state appears (or flush a macrotask where fake timers allow), starting with the six files that broke: RunProgressTab, RunSubmissionTab, SuperuserCourses, SuperuserSetup, SuperuserShell, SuperuserUsers.
