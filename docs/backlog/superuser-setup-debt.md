# Superuser Set up: deferred work

Minors from the per-task reviews and the whole-branch review, by task, plus the spec's follow-ups.

## Spec follow-up

- **The installer calls the panel link "optional"** (spec non-goals). `cli/cmd/install.go:242` ends its next steps with "(optional) superuser panel URL: …". With Set up, the panel is where a fresh site gets its email, name, first course and sign-in rules, so the link is the next step, not an option. Fix in a CLI release: drop "(optional)" and say the panel walks through setting up.

## Task 1 (storage and the migration)

- **A site with a course but no settings row gets no kept marks** (Opus r1 M1, Fable r1 M1). The migration's two `UPDATE`s match nothing, and `get_row` later creates the row with both marks false, so the Dashboard would show the Site name and Sign-in lines on an established site. Unreachable in practice: the settings migration always inserts the row and no code deletes it. Fix if it ever shows: insert a defaults row before the `UPDATE`s when a course exists, with a test.
- **Two migration tests are looser than they look** (Opus r1 M2, M3). No case has a branding row still named "Mathion", so dropping `<> 'Mathion'` passes; and the step check is tested only by refusing 5, so `BETWEEN 1 AND 3` passes. Fix: a no-course case with a "Mathion" row expecting `(False, False)`; accept step 4 and refuse step 0.
- **`test_fresh_database_turns_wizard_on` has no settings row** (Fable r1 M2), so it is "no row, no course", not a real fresh install (that one is `test_upgrade_without_course_turns_wizard_on`). Fix: rename it or add a comment.
- **The model's kept marks use `server_default="false"`, the migration `sa.false()`** (Fable r1 M3). Equal on Postgres and to the drift gate; `create_all` would emit `DEFAULT 'false'`. Fix: `sa.false()` in the model.
