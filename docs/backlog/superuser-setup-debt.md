# Superuser Set up: deferred work

Minors from the per-task reviews and the whole-branch review, by task.

## Task 7 (the Set up page, All set and step 1)

- **After a half-save, Save and continue can look live and do nothing** (Opus r2 M1, Fable r2 M1). Email saved off, "step 1 saved" failed; the person turns Send email on, types, turns it off: the form is changed but not ready, the button isn't blocked (`due`) and the click returns silently. Fix: `canSave={(form?.ready ?? false) || (due && !changed)}` and the handler's gate the same; pin it.

## Task 8 (step 2 Site name and logo, step 4 Sign-in rules and limits)

- **A refused logo can't be dropped inside step 2** (Opus r1 M4, Fable r1 M1). Name saved, then the logo refused (a proxy 413): the re-read marks step 2 done, so the skip button goes, and Save and continue always retries the same logo. The way out is another PNG, or Back / a list click and "Discard". Fix: a "Remove" beside the chosen file's name (`logo = new LogoPick('logo', logo.saved)`; then only "step 2 saved" is sent). Not the Reset the Task 8 ruling left out.
- **A stale logo sentence hides a newer "step 2 saved" failure** (Opus r1 M1, Fable r1 M2). `sendSaved` clears only `name.error`, and the logo's error shows first. Fix: clear both errors at the top of `onSave`.
- **"The site is still called Mathion." flashes after a rename** (Opus r1 M2). The rebuilt form is unchanged, so the reason shows during "step 2 saved", and after a failure until the re-read lands. Fix: `!done && !changed && !due` (step 1 has the same shape).
- **Step 4 shows one error line for two forms, and only the first failing check** (Fable r1 M3). Acceptable (the dialogs do the same; the sentences differ); a copy decision if wanted.
- **The step boilerplate is in three copies** (Fable r1 M4): tracker, registry, onHold, keepAlive and the moveError effect in StepEmail, StepSite and StepSignIn. A helper in `lib/setup.ts` after Task 9, if at all.
- **Comment nit** (Opus r1): `StepSignIn.svelte`'s comment calls a Segmented option a button; it is a radio.
- **Test harness** (Fable r1 M5): the decode stub is installed for every test, and `choose()` spins a fixed three ticks for FileReader; loop until `decodes` grows (bounded).
- **Test gaps** (Opus r1, Fable r1). Not pinned: step 4's half-save re-read (GET /setup and the tick, so the hold check isn't vacuous); "step saved" failing then a retry that sends only saved, in both steps (step 4: never a second keep-sign-in); keep-sign-in failing then resent; a valid sign-in change with invalid limits sends nothing; a limits-only change; a Segmented change in the sign-in body; a name save failing first (no re-read, retry sends name then logo); a done step 2 with a changed name; a decode rejection's sentence; the move error clearing the logo or limits error; Discard resetting a chosen logo and both step 4 forms; noteEdit from the Choose click and a Segmented change; a fresh load and its error state per step; a 401/404 on a step save; step 2's saving hold against a re-read; the pills and list waiting during step 4's sequence.

## Task 9 (step 3 First course and its admin)

- **Enter in a field drops focus to the page when the note or the 409 done view replaces the fields** (Opus r1 M2, Fable r1 M1). A keyboard user who pressed Enter loses their place; the note is announced (role status), but Continue is reached only by tabbing from the top. Fix: `focusAfter` the footer's Continue (or the card heading). Same family as Task 6's "Keep drops focus". Emptying every field on a done step (the form turns into the done view) drops focus the same way (Opus r2, Fable r3 M1).
- **Continue on the note can be a silent no-op** (Opus r1 M3, Fable r1 M2). After "step 3 saved" answered, another tab's "go to step 3" makes the newest state name step 3; Continue then sets the same card. The list still works. Fix: fall through to sending "step 3 saved" when `cardAfterOwn(setup.state) === 3`.
- **Courses' note close button is unpinned** (Opus r1 M4): `NoteStrip`'s `onClose` is now optional and no Courses test clicks it. Fix: one assertion.
- **Nits** (Fable r1 M4): `savedOk` could be a plain `let`; `canSave` could read `mode === 'save' ? form.ready : true`.
- **Test gaps** (Opus r1, Fable r1). Not pinned: `setup.saving` around the create (pills, list and Back wait; a re-read during POST /courses held); a 409 whose re-read fails or lands stale; a 401/404 on POST /courses; a list click after a failed "step 3 saved"; the failed-saved re-read (GET /setup and the tick asserted); Discard on step 3 (empties the fields and `slugEdited`); noteEdit from the step 3 fields; the no-admin line hidden when the step is done; a failed Back or list click on the done view; Discard on a done step with typed values; emptied fields on a done step turning into the done view (not dirty); the 409 done view's Continue; a failed Continue whose re-read finds the course gone; CommandText alone (no command, command not in the text); NoteStrip with no `onClose`; the component-level "You are its admin." and disabled-admin done views.
- **A stale error over an empty form after the course goes** (Fable r3 M2). Done view, a failed Continue, then its re-read finds the only course deleted: the form shows empty with the old sentence, Save blocked until typing (which clears it). Rare; consistent with D3's newest error. Fix if wanted: clear `form.error` when `done` turns false under the done view.
- **`slugEdited` outlives the done view** (Fable r3 M3, nit). Type a name, edit the address, empty all three on a done step; if the course later goes, the returning form's address no longer follows the name. Fix: reset the form when the done view replaces an emptied one.

## Whole-branch review (003df4f..c6bfd2b; Opus + Fable both 0 Critical / 0 Important)

- **Step 1 drops a passed test's answer on save** (Fable M3). `StepEmail.svelte` rebuilds the form after the save, so a green "test passed" goes; seen only when "step 1 saved" then fails. Fix: carry `result` over to the new form.
