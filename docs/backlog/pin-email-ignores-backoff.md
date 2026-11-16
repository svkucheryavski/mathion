---
worth: no
where: backend/mathion/api/auth.py:76
added: 2026-11-15
---
# the PIN email ignores the queue's back-off

Each "Send PIN" tries the mail server again, even while the queue is waiting
out a back-off after a failure on the server's side. Won't fix (user,
2026-11-15): a PIN is needed now, and skipping it during the wait could lock
people out after the server recovers; the 3-per-hour PIN limit caps the tries.
