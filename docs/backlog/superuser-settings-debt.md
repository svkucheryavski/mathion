# Superuser Settings: deferred minors

Minor findings from the per-task review lanes of the Settings slice
(`docs/superpowers/plans/2026-11-04-superuser-settings.md`), kept for later.

## Task 1 (data, copy and seal)

- A 0 or negative MATHION_MAX_FILE_SIZE / MATHION_MAX_COURSE_SIZE silently
  becomes 1 MB with no printed line.
- The "MATHION_MAX_COURSE_SIZE is below the largest file" line doesn't show
  the old value.
- A password is copied (sealed) even when the username is empty; harmless
  (the mailer only logs in with a username), but it's kept.
- The `rerun` migration-test fixture has no try/finally: a failed upgrade
  leaves the test schema one revision back for the rest of the session.
- alembic `env.py` builds `Settings()`, so D2a ("no value in .env can make
  the migration fail") only fully holds once Tasks 2 and 3 drop the old keys
  from `Settings`.
- Never `asdict(SiteSettingsView)` into a response: the view carries the
  sealed password.
- `int()` accepts forms like "1_000" and " +5 "; the copy takes them.
- A username the copy drops (over 254 characters or not valid UTF-8)
  leaves email on with no login, and the password stays sealed. A dropped
  host is already copied as off; a dropped username should be too.
- After `_text` drops an over-long host or From, the next line says "is
  empty" / "is not set", which contradicts "is not copied".
- The "not a number" line for a byte limit prints the default in bytes
  (20971520), not in MB. Every note also echoes the whole raw value, so a
  5000-digit size prints a 5000-character line.
- A MATHION_SECRET_KEY that isn't valid UTF-8, with a password set, still
  makes the migration raise in `_seal_v1`. No such install can sign anyone
  in today (`hash_token` encodes the same key), but the D2a wording covers it.
- `load()`'s `begin_nested()` flushes the caller's pending changes and costs
  two round trips per call; Task 2's readers should call it before they
  stage writes.
- Test gaps:
  - no test pins "only UndefinedTable is swallowed" (an UndefinedColumn case);
  - `test_copy_smtp_without_from_keeps_sending` doesn't check the cert box
    or the two D10a times;
  - no migration test with a password over 32 bytes (a multi-block seal);
  - no test that flips a nonce byte.
