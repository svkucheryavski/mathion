# Superuser panel: Set up — design

**Status:** rev 18, 2026-11-10 (rev 12 APPROVED by the user; rev 13 adds the user's skip rule; revs 14–16 its review; rev 17 the whole-branch review's tab mark; rev 18 the minors round).
- Rev 1 came from the brainstorm.
- Rev 2 folds in the builder check: step 3 shows New course's own admin note (D8, mine); a course needs an admin to count (D8, mine); the wizard ends by itself once every step is done (D5a, user's).
- Rev 3 folds in spec review round 1, three lanes (`.superpowers/sdd/2026-11-06-superuser-setup/spec-r1-opus-backend.md`, `spec-r1-opus-frontend.md`, `spec-r1-fable.md`), and two user decisions:
  - **D9 (user's):** upgraded sites count Sign-in and limits as done; on a new site the step saves unchanged, and the Dashboard line gets "Keep these values";
  - **D6 (user's):** Email is done after a passing test or a real send with the saved settings; a not-done line says why.

  Mine, from the reviews:
  - **D2:** the redirect waits for the first state read, once per shell mount;
  - **D3:** a step left with unsaved changes asks first, and focus moves to the new step;
  - **D4/D5:** steps are "passed" when saved or skipped, and the wizard ends only when all four are passed;
  - **D5a:** "over" is stored before a read answers, and late writes are ignored;
  - **D7/D9:** what a half-saved step does;
  - **D8:** the note shows before All set, the note when you are the admin, and a course with no admin;
  - **D10:** a missing table means over, and a restore brings its own state back;
  - **D13:** one copy of the state, in the shell;
  - **§5 and §6:** more inputs and the storage rules.
- Rev 4 folds in spec review round 2, two lanes (`spec-r2-opus.md`, `spec-r2-fable.md`). No user decision changed. Mine, from the reviews:
  - **D2:** the redirect happens once per browser tab, and only while the address is still the panel's own;
  - **D3:** the app's existing unsaved-changes guard; Enter; a not-done step with nothing changed;
  - **D4/D13:** a done step counts as passed; a "step saved" write; every write answers the whole state; the shell re-reads on every page change;
  - **D6:** where the last successful send is written and cleared; the reason speaks only of the saved settings;
  - **D7:** the Dashboard line says the site is still called Mathion;
  - **D8:** the full note when you are the admin, also on Courses; the note stays until Continue; a disabled admin counts;
  - **D9/D12:** "Keep these values" works whatever the wizard's state; the Settings saves mark it kept themselves;
  - **§2:** D9 is the one deliberate difference from the dialogs.
- Rev 5 folds in the confirming round 3, two lanes (`spec-r3-opus.md`, `spec-r3-fable.md`). No user decision changed. Mine, from the reviews:
  - **D3a (new):** the step card stays while it holds an error, typed values or step 3's note; answers arrive in order; the link is kept alive while typing; focus;
  - **D2:** the tab mark is cleared on Sign out and on an expired link; only the mount's read redirects; a failed state read shows an error, not a missing card;
  - **D5a:** a read that finds all four passed ends the wizard too;
  - **D6:** the send record is cleared on every email save with changed values; a stuck queue is not done;
  - **D7/D9:** each part is sent only when it changed; the browser checks whole numbers only; an unchanged step 4 sends the "keep" write;
  - **D8:** a 409 re-reads; "you are already its admin";
  - **D12:** "Keep these values" shows whenever the line does.
- Rev 6 folds in the confirming round 4, two lanes (`spec-r4-opus.md`, `spec-r4-fable.md`), and one user decision:
  - **D3a (user's):** typed values keep the link alive for at most 2 hours after the last edit.

  Mine, from the reviews:
  - **D2:** the tab mark is written only when the redirect is made; after a good read, a failed read keeps the last good state;
  - **D3a:** answers to this tab's own actions always apply; D8's done view wins over a held card; no read starts while a wizard write runs; a sleeping laptop;
  - **D1:** the state the shell holds when `/setup` is entered decides;
  - **D6:** a failed test newer than the last send makes Email not done;
  - **D8:** when "step 3 saved" is sent; the "on its way" note says when Email isn't done yet (on Courses too);
  - **D13:** what the Set up page keeps.
- Rev 7 folds in the confirming round 5, two lanes (`spec-r5-opus.md`, `spec-r5-fable.md`). No user decision changed. Mine, from the reviews:
  - **D3a/D8:** the answer to step 3's automatic "step saved" never moves the card; the note stays until Continue, and Continue sends nothing when that write succeeded;
  - **D3a:** a failed "go to" or "skip" keeps the step and shows the error in the card;
  - **D1:** `/setup` entered before the first read waits for it, and an "over" answer then opens the Dashboard;
  - **D8:** a held step-3 form creates what was typed, even when another tab made a course meanwhile;
  - **§5:** a sign-in that expires on `/setup` comes back to the same step.
- Rev 8 folds in the confirming round 6, two lanes (`spec-r6-opus.md`, `spec-r6-fable.md`), both 0 Critical and 0 Important. Mine, from the reviews:
  - **D5a:** a late "step saved" or Continue write also answers 200 with the current state, never 404 or 409;
  - **D8:** Continue waits while the automatic "step 3 saved" runs; the done view names the admin when email is off or the account is disabled;
  - **D2:** the tab mark is written whenever the mount's read answers "on", not only when it redirects;
  - **§5:** accepted: typing after the 2-hour cap, and a sign-in session that ends while typing, lose the typed values.

  And one user decision:
  - **D6 (user's):** email off is never a way to run a site (a PIN from the console for every student makes no sense), so the Email line stays on the Dashboard until email works; there is no "keep email off".
- Rev 9 folds in the confirming round 7, two lanes (`spec-r7-opus.md`, `spec-r7-fable.md`), both 0 Critical and 0 Important. No user decision changed. Mine, from the reviews:
  - **D8/D13:** the done view's sentence uses the Courses rule for "email isn't set up" and names the admin; the read carries the course address, the admin's name and email, the disabled flag and the PIN minutes;
  - **D3a/D8:** the page sends one wizard write at a time, so the list waits too while "step 3 saved" runs;
  - **D2:** the tab mark holds the link's token, so a new link pasted into an old tab lands on Set up;
  - **§5:** the "Keep these values" case is the one that can happen (step 4 skipped, wizard over).
- Rev 10 folds in the confirming round 8, two lanes (`spec-r8-opus.md`, `spec-r8-fable.md`), both 0 Critical and 0 Important. No user decision changed. Mine, from the reviews:
  - **D8:** the done view says "You are its admin." for your own course, and puts the disabled sentence before the sign-in one, as Courses does; Continue or a list click leaves the note, a re-read never does;
  - **§5:** an upgraded site *with a course* never needs "Keep these values"; pressing it while the wizard is on is listed.
- Rev 11 folds in the confirming round 9, two lanes (`spec-r9-opus.md`, `spec-r9-fable.md`), both 0 Critical and 0 Important. No user decision changed. Mine, from the reviews:
  - **D3a/D5a:** they now say what D8 says: Continue or a list click leaves step 3's note; a list click after the wizard is over shows All set;
  - **D8:** the done view's disabled sentence drops the note's "No email sent:" opening.
- Rev 12 folds in the confirming round 10 (`spec-r10-opus.md`, `spec-r10-fable.md`), both 0 Critical and 0 Important, one shared wording minor: **D3a:** when leaving step 3's note shows All set, Continue goes by the newest state, a list click by its "go to" answer.
- Rev 13 adds one user decision, made while reviewing the plan:
  - **D4a (user's): skipping a step means "use the defaults".** A skipped Site name and logo, or a skipped Sign-in rules and limits, counts as done: the site keeps its defaults and the Dashboard lists it no more. Email and First course have no default, so they stay listed until done (D6: the server isn't ready without email; D8: a site with no course can't be used). D7 gets a "kept" mark like D9's; the migration sets both on a site with a course (D10).
- Rev 14 folds in the narrow round 11 on D4a (`spec-r11-opus.md`, `spec-r11-fable.md`; 0 Critical, Fable 1 Important). Mine, from the reviews:
  - **D3/D4a:** on steps 2 and 4 the skip button reads "Keep the defaults", since that skip is never reminded;
  - **D4/D4a:** D4a moves below D4's rules; a skip saves none of the step's values;
  - **D7:** the Branding page's Reset to default counts, and only the name and the logo set the mark, never the tab icon or the colours;
  - **D10:** the migration also marks Site name kept when the name was already changed;
  - **D5a:** a late write sets no kept mark either;
  - **D12:** the Site name line can only show while the wizard is on, so it needs no keep action.
- Rev 15 folds in the narrow round 12 (`spec-r12-opus.md`, `spec-r12-fable.md`), both 0 Critical and 0 Important. Mine, from the reviews:
  - **D3/D4a:** a done step shows no skip button; step 4's reads "Keep these values" (true whatever the values are), step 2's "Keep the defaults";
  - **D4a, D7, D9:** the skip keeps the values shown, which are Mathion's on a new install; D7 and D9 name the button by its role.
- Rev 16 folds in the narrow round 13 (`spec-r13-opus.md`, `spec-r13-fable.md`), both 0 Critical and 0 Important. Mine, from the reviews: D3 and D4 name the skip button by its role; the D13 write behind the Dashboard's "Keep these values" is called the keep-sign-in write, apart from step 4's skip button of the same label, which sends the skip write.
- Rev 16 also folds in the narrow rounds 14 and 15 (`spec-r14-*`, `spec-r15-*`, all 0 Critical and 0 Important): §6 names the keep-sign-in write and D9's mark; D3 and D3a say "the skip button".
- Rev 17 (whole-branch review, Fable M2, from the user's "yes" to fixing it): D2's mark is also written by any later answer that says the wizard is on, once the mount's read has decided (Try again, a page change), so a tab whose first read failed is redirected to Set up once at most; nothing writes it once the expired-link view shows, even a read still in flight.
- Rev 18 (the minors round, 2026-11-10): D6's send record is written once per run of healthy sends, not on every send, and never for a developer outbox; D13's read loads the settings once.

**Builds on:**
- `docs/superpowers/specs/2026-11-04-superuser-settings-design.md` (the Email, File limits and Sign-in cards and their Edit dialogs; D5, Save blocked until something changes; D8, the stored password; D9a, the card's test; D9d, the stuck queue; D2, the copy from `.env`; D2c, the developer modes);
- `docs/superpowers/specs/2026-11-05-superuser-branding-design.md` (the site name and the logo, D3 and D4–D5);
- `docs/superpowers/specs/2026-11-03-superuser-users-courses-design.md` (New course, D8; the admin note, D5a; half-saves, D24; panel errors, D25);
- `docs/superpowers/specs/2026-07-11-superuser-panel-slice-1-design.md` (panel access, the shell, the Dashboard).

**Source of the requirement:** platform spec §8, `docs/superpowers/specs/2026-04-19-mathion-platform-design.md:554` ("Setup checklist (shown on first login until completed): configure SMTP, test email delivery, create first course"), and the superuser panel roadmap (Users, Courses, Settings, Branding, Setup checklist). This is the last panel page before the beta.

**Mockup:** `.superpowers/brainstorm/45677-1793993092/content/wizard-layout.html` (option A is the chosen layout; the Dashboard card at the bottom). Where the mockup and this text differ, the text wins. For example, the logo is PNG only (Branding D5), not "PNG or SVG".

Decisions are marked **(user's)** when the user chose them, and **(mine)** when they are my call, open to change.

## 1. Why

Today a new install opens on a panel with five pages and no hint of what must happen before anyone can use the site. Email is off, the site is called "Mathion", there is no course, and the limits are defaults nobody has looked at. The person installing (often a teacher, who will also be the first course's admin) has to know to visit Settings, Branding and Courses in the right order.

The Set up page walks that person through the four things a site needs, once, and the Dashboard keeps listing whatever was left undone.

## 2. Goals, non-goals, anti-goals

**Goals:**
- a step-by-step wizard on its own panel page, shown on a new install (user's);
- four steps, in this order: Email, Site name and logo, First course and its admin, Sign-in rules and limits (user's);
- every step can be skipped and done later (user's);
- the wizard runs once per site; once it's over it never comes back (user's);
- a "Finish setting up" card on the Dashboard lists the steps not done, on new and upgraded sites alike (user's).

**Non-goals:**
- the tab icon and the colours (they stay on Branding only; user's);
- new settings of any kind: every step saves through an existing endpoint. The only new stored facts are the wizard's own state, D6's record of a real send, and the "kept" marks of D7 and D9;
- any new email to the new course's admin: New course already queues its "you are an admin" email when email is set up, and step 3 uses exactly that (D8);
- a wizard for upgraded sites that already have a course (user's);
- changes to the `mathion` CLI or its install messages. The install text calls the panel link "optional" (`cli/cmd/install.go:242`), though a site can't get a course without it; that line goes to the backlog. Whenever the panel is first opened, the wizard is there (§5).

**Anti-goals** (a failure even if it works):
- a second form for the same setting that behaves differently from the one on Settings, Branding or Courses. The one deliberate difference is D9's unchanged save (user's);
- a wizard that traps the superuser: every pill keeps working while it's on;
- a wizard that comes back after it's over, or that appears on an established site after an update;
- a Dashboard card that nags about a step that is actually done, or a line nobody can clear honestly;
- typed values lost without a question.

## 3. Decisions

### The page

- **D1. A Set up pill and page** (user's, option A of the mockup).
  - **Route:** a new route, `/superuser/:token/setup`, is added beside the panel's five (`frontend/src/routes.ts`). An unknown segment shows the app's not-found page today, so the route is needed.
  - **Pill:** while the wizard is on, a "Set up" pill comes first in the nav, before Dashboard (`PanelPage` in `frontend/src/lib/superuser.ts` gains `'setup'`).
  - **Once the wizard is over,** the pill is gone. The state the shell holds when `/setup` is entered decides (mine): if it says over (a bookmark, a reload), the address is replaced with the panel's own and the Dashboard shows; if it says on, the page opens, and an "over" answer that comes later shows the All set card (D5a). If `/setup` is entered before the first read has answered (a bookmark, a reload, a direct open, Try again), the shell shows only its bar until it does, and that answer decides as above: over replaces the address with the panel's own and the Dashboard shows; on opens the page. D2's "only while the address is the panel's own" limits the redirect to `/setup`, not this move away from it.
  - **An expired link on `/setup`** shows the shell's expired-link state, like the other pages. So the shell's page list keeps a Set up entry with its label whether or not the pill shows (the expired view reads it).
- **D2. Where the panel opens** (mine, from the user's "on first panel sign-in").
  - **On the panel's own address** (`/superuser/{token}`, the one `activate` prints), the shell shows only its bar until the first state read answers (D13). If the wizard is on, it then replaces the address with `/setup`. Otherwise, it shows the Dashboard.
  - **This happens once per browser tab and link** (mine, from review). Only the read the shell starts when it mounts can redirect, and only if the address is still the panel's own when it answers. A `sessionStorage` mark is written whenever the mount's read, or any later answer, says that the wizard is on, whether or not it redirects (a read that fails, answers 401 or 404, or answers over writes nothing; a later answer is one after the mount's read has decided, such as Try again or a page change's read, rev 17; once the expired-link view shows, nothing writes it), so reloading the Dashboard in the same tab stays on the Dashboard, even in a tab first opened on another panel page, while a new tab or the next day's open lands on Set up again. Sign out and the expired-link view clear the mark, so a new link opened in the same tab lands on Set up. The mark holds the link's token, and a mark for another token counts as none, so a new link from `activate` pasted into an idle old tab (which never saw the old link expire) lands on Set up too.
    - A fresh install's first open goes through sign-in and comes back by an in-app navigation, which mounts the shell, so it counts.
    - A pill click never redirects, and neither does a pill clicked while the read is still running.
  - **If the state read fails before any read has succeeded,** the shell shows the Dashboard with no pill and no redirect. Where the Finish setting up card goes, the Dashboard shows the panel's error state with "Try again", so a fresh site never looks finished; the stat cards show as usual. On `/setup` the same error state takes the step card's place.
  - **After a good read,** a failed read (a network drop, a server restart during an update) keeps the last good state and changes nothing on screen; the next read or write catches up. A 401 or 404 still goes to the shell's handler.
- **D3. The layout** (user's, as drawn).
  - **On the page:** the heading "Set up your site"; on the left, the four steps as a list; on the right, the current step's card. The card holds:
    - the step's title and a one-line note on what it's for;
    - the step's fields (D6–D9);
    - a footer with **Back** (absent on step 1), the skip button (**Skip for now**; **Keep the defaults** on step 2 and **Keep these values** on step 4, D4a; absent on a done step) and **Save and continue**.
  - **Marks in the list** (mine):
    - a tick when done;
    - the current step;
    - a dashed circle when passed but not done (skipped, or saved without getting done);
    - a plain number when not reached yet.

    Any step in the list can be clicked to go to it.
  - **Unsaved changes** (mine; anti-goal). Leaving a step whose fields differ from what was loaded asks first:
    - a pill click, a reload or a closed tab: through the app's existing guard (`DirtyGuard` and the dirty registry, `frontend/src/lib/dirtyRegistry.svelte.ts`), which also makes the browser ask on reload;
    - Back, the skip button or a click in the list (the address stays `/setup`, so the guard doesn't see them): the page asks itself, with the same confirm;
    - Sign out, which navigates past the guard today: it asks first too.
  - **While a save runs,** Back, the skip button, the list and the pills wait, as the dialogs' Cancel does (mine).
  - **Keys and focus** (mine). Enter in a field is Save and continue when that is usable, as in the dialogs. Esc does nothing on the page. When the page first shows a step, and whenever the step changes, focus moves to the step card's heading.
  - **Nothing changed** (mine). A step that isn't done, with nothing changed, has Save and continue blocked (`aria-disabled`, as the dialogs' Save is). The skip button stays usable. Two exceptions: step 4 (D9), and a step whose own save succeeded but whose "step saved" write failed (the error shows, and Save and continue retries only that write).
- **D3a. The card the person is working on stays** (mine, from review). An answer from the server never takes away something the person is looking at or typing:
  - **While the step card shows a save error, has unsaved changes, or shows step 3's note,** an answer that says the wizard is over, or that the step is another one (another tab moved it), leaves the card as it is. The All set card, or the other step, comes with the person's next Save and continue, skip button, Back, Continue or list click. So when the first of two saves completes the last step and the second fails, the error and the typed values stay.
  - **The person's own moves always apply.** After the person confirms leaving a step (D3), the page resets the form, then sends the write. The answer to this tab's own "go to", "skip", "step saved" or Continue always applies; the hold above is only for re-reads and for answers that arrive while the card is busy.
    - **One exception, step 3's note:** the "step 3 saved" write goes out by itself while the note shows (D8), so its answer updates the stored state and the list's marks but never the card. Only the note's Continue, or a click in the list (once "step 3 saved" has answered), moves on; a re-read or a write's answer never does. Continue then shows the step the newest state names; a list click shows the clicked step. Either shows the All set card instead when the newest state says over: for Continue, which sends nothing when "step 3 saved" succeeded (D8), that is the newest state the shell holds; for a list click, it is the "go to" answer (a late one answers 200 with the over state, D5a).
    - **A failed "go to" or "skip"** keeps the step on screen (its form already reset), shows the error in the card, and pressing the same button again retries. The page never moves on its own after such a failure.
  - **One exception, D8's 409:** when step 3's save answers 409 and the re-read finds step 3 done, the done view replaces the form even though the card holds an error and typed values (or the All set card, if the wizard is now over). Otherwise the person would change the address and make a second course.
  - **Answers in order:** each read or write carries a counter; an answer older than one already applied is dropped. No read starts while a wizard write is running; it waits for the write's answer, which carries the whole state anyway.
  - **The link stays alive while typing, for at most 2 hours** (user's). The panel link expires after 30 minutes without a request (Slice 1). While a step has unsaved changes, the shell re-reads the state every 4 minutes (the server bumps the link only when more than 5 minutes have passed, so this keeps it well inside 30), for at most 2 hours after the last edit. So a person who goes to ask IT for the mail password comes back to their typed values, and a tab abandoned on a shared computer still expires.
  - **A sleeping laptop** stops the timer, so the link can expire while the lid is closed; the expired view then shows and the typed values are gone, as on Settings. Accepted (§5).
- **D4. Skip and come back** (user's). A step is **passed** (mine) when it was skipped, when it was saved, or when it's done (D6–D9), wherever it was done.
  - The skip button (D4a names it per step) saves none of the step's values and marks the step skipped.
  - A step's successful save, or Continue on a done step, marks it saved. This goes through the wizard's own "step saved" write, sent after the step's own saves succeed (D13).
  - **Where the wizard goes next** after either: the first step after this one that isn't passed. If every later step is passed, it wraps to the first step that isn't passed.
  - **Stored on the server** (mine): the step the superuser is on, and which steps are passed. So leaving through a pill, signing out, or opening the panel from another browser comes back to the same step.
- **D4a. A skip keeps the defaults** (user's). Each step that has defaults keeps them when skipped, and the skip counts as accepting them:
  - **Site name and logo** (D7) and **Sign-in rules and limits** (D9): the skip marks the step kept, so it's done. The site keeps the name "Mathion" and the Mathion logo, or the sign-in and limit values shown (Mathion's on a new install; an upgraded unused install shows the values copied from `.env`), and the Dashboard doesn't list it.
  - **Email** (D6) has no default: a site isn't ready while email doesn't work. A skip leaves it passed but not done, and the Dashboard keeps listing it.
  - **First course** (D8) has no default: a site with no course can't be used. A skip leaves it passed but not done, and the Dashboard keeps listing it.
  - **The button says so** (mine, from review): that skip is never reminded, so on step 2 the skip button reads **Keep the defaults** (a step 2 that isn't done still has the default name and logo), and on step 4 **Keep these values** (the Dashboard's own words, true whatever the values are). It sends the same skip write. Steps 1 and 3 keep "Skip for now".
  - **A done step has no skip button,** on every step: Continue already passes it, and a skip there would say nothing true.
- **D5. The end** (mine). When the last step that isn't passed gets saved or skipped, the page shows an "All set" card in place of the step card. Jumping to step 4 first and pressing Save and continue doesn't end the wizard: it moves on to the steps not passed. The All set card:
  - says "Your site is set up." when every step is done;
  - otherwise says "Set up is over. These steps are left, and the Dashboard lists them until they're done:" followed by the steps not done;
  - has one button, "Go to the Dashboard".

  The wizard is over from the moment the All set card shows, and that is stored on the server. Reloading then lands on the Dashboard, and the pill is gone. On the All set card the step list shows its marks but can't be clicked.
- **D5a. Done everywhere ends it** (user's, from the builder check). The wizard is also over the moment all four steps are done, wherever they were done:
  - on Settings, Branding and Courses, without ever opening Set up;
  - by a step's save that completes the last missing one;
  - by an email test or a real send recorded in the background (D6).

  "Over" is stored by the first read or wizard write that finds it so. A step that later becomes undone (say, the only course is deleted) brings back its Dashboard line, never the wizard (D10).
  - **How it's stored** (mine, from review). The state read and every wizard write (D13) check the done rules and the passed marks. When they find the wizard on and all four steps done, or all four passed (D4), they store "over" with one conditional update, and only then answer. So the next panel open lands on the Dashboard.
  - **Late writes:** a "go to step n", "skip", "step n saved" or Continue write that arrives after the wizard is over (a second tab, a held step-3 form, a retried step-4 limits save) changes nothing, the kept marks included. It answers 200 with the current state, never 404 or 409: the panel reads a 404 as an expired link (Users/Courses D25), and a 409 would make D8's Continue retry for ever.
  - **The page finding it over:** if the Set up page re-reads and finds the wizard over (ended by D5a or by another tab), it shows the All set card with D5's matching text. Two exceptions:
    - step 3's admin note is shown first (D8), and its Continue, or a list click, leads to All set;
    - a card that holds an error, typed values or a note stays until the person's next action (D3a). A step with two saves (D7, D9) re-reads only after the whole sequence.

### The steps

Every step uses the same fields, checks, sentences and endpoint as the matching card or dialog elsewhere in the panel (anti-goal: no second form). How the forms are shared is the builder's (§6). Whatever the dialogs got from `Modal` the step does itself:
- Save waits while busy (`aria-disabled`);
- each step's form starts from freshly read values when the step opens.

Errors follow Users/Courses D25: the server's sentence shows inside the step card, and a 401 or 404 goes to the shell. Each step shows a skeleton while its values load, and the panel's error state with "Try again" if they don't load (mine).

A step that is already done shows its form filled with the saved values. When nothing has changed, **Continue** replaces Save and continue (mine). A step that isn't done shows the current values (the defaults on a new install). A step whose save covers two endpoints follows Users/Courses D24 when the first save succeeds and the second fails (mine):
- what saved stays saved and becomes the step's new starting point;
- the error shows;
- Save and continue retries only the rest.

- **D6. Email** (user's: the mail server plus a test email). The Edit email dialog's fields and its "Send a test email" (Settings D7–D9). Saving doesn't need a passing test (Settings D9a, unchanged).
  - **Done** (user's, from review) when email is on, the saved password can be read on this server (Settings D8; or there is no login), sending isn't failing (Settings D9d), and either:
    - the card's test of the saved settings passed (Settings D9a, `card_test_ok`); or
    - a real message has gone out with the saved settings since they were saved, and the card's test isn't a failure newer than that send (mine, from review: a password the provider rotated fails its test at once, while the queue may not notice for a while).

    For the second case, the settings row stores the time of a successful send with the saved settings (mine, from review):
    - **Written** in the queue's sent branch (`_record` in `notifications/dispatcher.py`) and in the PIN email's success outcome (`record_send_outcome`), on the fresh locked row, whether or not a failure was stored. A developer outbox is no mail server, so neither its sends nor its failures are recorded (rev 18).
    - **Skipped** when the settings changed since the tick read them (`_fresh_row`); that is what "since they were saved" means. Also not rewritten, and the row not locked, when a send is already recorded, no failure is stored and no failed test is newer than it: a burst of sends writes nothing (rev 18). A tick that sends some messages and then meets a Settings D9c failure records the failure, not the send.
    - **Cleared** on every email save whose fingerprint changed (`new_fp != old_fp` in `save_email`), whether the card's test is then cleared or replaced by the latest test. An off save, or an on save with nothing changed, leaves it. So a move to a new provider whose test failed is not done.
  - **Not done says why** (user's), in the step card and on the Dashboard line. The reason speaks only of the saved settings, so the step hides it while its form differs from them; a test of typed values then shows only its own answer. The reasons, first match wins:
    - "Email is off.";
    - "The saved password can't be read on this server.";
    - "Sending is failing: see Settings." (Settings D9d's stuck queue; mine, from review: a red Email card and a done step would contradict);
    - "The last test failed." (the card's test failed);
    - "Not tested yet: send a test email." (otherwise).
  - **After a test answers,** the shell re-reads the state, even if the person has already left step 1, so the tick and the reason follow the test.
  - **A developer mode** (Settings D2c): the step shows only "Email goes to a developer outbox (set on the server)." and **Continue**. It counts as done.
  - **Leaving email off** is allowed for now: skip the step (on a new install, email is already off, so there's nothing to save). The step is then passed but not done.
  - **Email off is never a final state** (user's): a site can't run on a PIN from the console for every student. So the Dashboard's Email line stays until email works, and there is no way to dismiss it. That line is honest, not nagging: the step really isn't done.
- **D7. Site name and logo** (user's: colours stay on Branding). The Edit site name dialog's field and hint (Branding D3) and the logo upload of the Logo dialog (Branding D4–D5), with all its checks. The logo is optional.
  - **Done** when the saved site name isn't the default "Mathion", or once the step is marked **kept** (D4a, user's). Not done says "The site is still called Mathion." in the step and on the Dashboard line. These all mark it kept:
    - this step's skip button (Keep the defaults), or its save (the "step 2 saved" write, so a save of the logo alone counts too);
    - any save of the site name or the logo on the Branding page, Reset to default included (its endpoints set the mark themselves, as D9's do). A save of the tab icon or the colours doesn't set it;
    - the migration, on a site that already has a course, or whose saved name already isn't "Mathion" (D10).
  - **Save and continue** waits for a chosen logo's checks and decode, as the dialog's Save does. Then it saves the name first and the logo second, through the existing Branding endpoints, each only when it changed. Two saves, so the half-save rule above applies; a refused logo (a 422 or a proxy 413) leaves the name saved.
  - **After a save,** the header shows the new name and logo at once, as the Branding page does.
- **D8. First course and its admin** (user's). New course's three fields: Course name, Address (filled from the name, Users/Courses D13), Admin's email (required). The person installing is often the admin and types their own email (user's).
  - **Done** when a course with at least one admin exists. A disabled admin counts (mine): the Courses page already shows that case.
  - **After Save** (mine), the step doesn't move on at once. It shows the same note the Courses page shows after New course (Users/Courses D5a, `adminNote()` in `frontend/src/lib/superuser.ts`):
    - the email is on its way (when the Email step isn't done, the note adds D6's reason after it, for example "Not tested yet: send a test email.", so the superuser doesn't assume the admin was told; mine, from review, and the same on Courses); or
    - the account is disabled; or
    - email isn't set up, and how the admin signs in (the sign-in address, the `mathion pin` command, how long the PIN lasts).

    The footer is then only **Continue**, and the list ticks step 3. "Step 3 saved" is sent as soon as the course is made, while the note shows; if that write fails, the note stays, its error shows, and Continue retries it. When it succeeded, Continue sends nothing and only moves the card (D3a). While that write runs, Continue and the step list wait (`aria-disabled`), as Save does: the page sends one wizard write at a time, so the server's step and the step on screen can't cross. The server decides which note, exactly as on Courses. The note sits in the step card in the Courses page's note look (`NoteStrip`), the command as code.
  - **The note stays until the person moves on** (mine), even when a re-read says step 3 is done or the wizard is over (D3a). Continue or a list click moves on (the list after "step 3 saved" has answered); a re-read or a write's answer never does.
  - **A 409** (the address is taken, say by a colleague in another tab) shows the server's sentence and re-reads the state, as the Courses page reloads its list. If step 3 is now done, the done view replaces the form, so no second course gets made by mistake.
  - **When the admin is you** (mine, from review). The page knows it by comparing the admin's email with the signed-in superuser's, lower-cased. The note is then, in full, with no email, PIN or disabled sentence: "<course> is created; you are its admin. You'll find it on the Courses page of the main site." `adminNote()` changes, so the Courses page gets the same note, for an assign: "You are now the admin of <course>. You'll find it on the Courses page of the main site."; and for an assign that changes nothing: "You are already its admin; nothing changed." When the signed-in user isn't known to the page, the usual note shows.

  - **When it's already done,** the step shows "A course exists: <name>." and **Continue**, not the form. The name is the course with an admin that has the lowest id; the state read supplies it. The done view names that course's admin ("<who> is its admin.", or "You are its admin." when the admin is you, compared as above). When email isn't set up (the Courses page's rule, `email_set_up_in`: a developer outbox counts as set up), or that admin's account is disabled, it adds the Courses note's matching sentence for that admin, disabled first as `_admin_email_outcome` orders them (a disabled account can't take a PIN): that the account is disabled ("This account is disabled. Enable it on the Users page so they can sign in.", without the note's "No email sent:" opening, which is true only when the admin is assigned); or else where they sign in, the `mathion pin` command and how long the PIN lasts. So a reload after the note doesn't lose the sign-in instructions. The state read supplies what that needs (D13). When the admin is you, no sentence is added. More courses are made on the Courses page. A step-3 form held by D3a (typed values, while another tab made a course with a different address, so no 409) still creates what was typed when Save and continue is pressed: that is what the person asked for. The note then shows as usual.
  - **A course with no admin** doesn't count. If courses exist but none has an admin, the form opens with "<name> has no admin: give it one on the Courses page, or create another course here." (<name> is the one with the lowest id), so the person doesn't type the same name into a 409.
- **D9. Sign-in rules and limits** (user's). The Edit sign-in dialog's four values and the Edit file limits dialog's two values in one card, filled with the saved values (Mathion's defaults on a new install).
  - **Save and continue works with nothing changed** (user's), unlike the two dialogs, whose Save stays blocked until something changes (Settings D5, unchanged).
  - **Saving:** the browser checks whole numbers as the dialogs do ("Type a whole number."); the ranges are the server's, as on Settings. The save then runs the sign-in save, then the limits save, each only when it changed. With nothing changed, it sends only the keep-sign-in write (D13), which marks the step **kept**. Then the "step saved" write. A limits refusal after the sign-in save is the half-save rule above.
  - **Done** once the step is marked kept. These all mark it:
    - this step's save, or its skip button (Keep these values; D4a, user's);
    - any save of the Sign-in or File limits card on Settings, so also the step's own saves. The server's save endpoints set the mark themselves. One card is enough on purpose: the step is one step, and its mark says someone looked at these values;
    - the Dashboard line's "Keep these values" (D12, user's);
    - the migration, on a site that already has a course (D10, user's: the owner of an established site already chose these values in `.env`).

### Once per site

- **D10. Who gets the wizard** (user's: once per site; only new installs).
  - **A new install** gets it. The migration that adds this page's storage turns the wizard on when no course exists (mine). A fresh install migrates an empty database, so it's on.
  - **An upgraded site with a course** is over from the start, and both Site name and logo (D7) and Sign-in and limits (D9) are marked kept. A site whose saved name already isn't "Mathion" gets the Site name mark too, with or without a course. There's no pill and no wizard, only the Dashboard card for what's really not done.
  - **A site upgraded with no course** (an unused install) gets the wizard, which is what it needs.
  - **A missing table or a missing row** means over (mine). `mathion install` starts the app before migrating, and the test suite truncates tables. So a reader never shows a wizard nobody turned on, and nothing fails before the migration.
  - **The same for everyone:** every superuser sees the same wizard while it's on; it isn't per person. When it's over, it's over for all.
  - **Nothing turns it back on,** and deleting every course later doesn't either. Only the migration ever turns it on; every write either moves it along or ends it.
- **D11. Restore** (mine). The wizard's state is in the database, so a restored backup brings its own state back. A backup taken mid-setup brings the wizard back, which is accepted.

### The Dashboard

- **D12. The "Finish setting up" card** (user's, as drawn). On the Dashboard, above the stat cards, whenever at least one step isn't done, whether the wizard is on, over, or never ran:
  - the title "Finish setting up" and "<n> of 4 done";
  - one line per step not done, in step order, each with a "Do it now" link. The links go to the regular pages, which always exist after the pill is gone: Email and Sign-in and limits to Settings, Site name and logo to Branding, First course to Courses (user's). A link navigates in the same tab to the page, not into its dialog (mine);
  - the Email line adds D6's reason;
  - the First course line adds "<name> has no admin" when courses exist but none has an admin;
  - the Site name line adds D7's reason;
  - the Sign-in and limits line adds "(Mathion's defaults are in use)" when all six values (the four sign-in values and the two limits) are still the defaults (mine). Whenever the line shows, it has a second action, **Keep these values** (user's), which marks the step kept (D9) whatever the wizard's state: it isn't one of the wizard's writes. The line then goes away.

  A passed step 2 is always done (D4a), so the Site name line can only show while the wizard is on; the wizard's Keep the defaults or the Branding page clears it, and it needs no keep action of its own. The card is gone when every step is done. "Done" is worked out by the server at each read from the rules in D6–D9, so a step done on another page is never listed (anti-goal).
- **D13. One read, one copy** (mine).
  - **The read:** one panel endpoint answers:
    - whether the wizard is on, and the step it's on;
    - each step's passed and done state;
    - D6's and D7's reasons;
    - D8's course (the first with an admin): its name and its sign-in address (built from its slug and the site address, as Courses builds `sign_in_url`), its admin's name and email, and whether that account is disabled; and, separately, the name of the first course without an admin;
    - whether email is set up (the Courses rule, `email_set_up_in`, on the read's one settings view) and the saved PIN minutes, for D8's done view;
    - whether all six sign-in and limit values are the defaults.
  - **One copy, in the shell:** the shell holds the state and passes it down; the Dashboard and the Set up page don't keep copies of their own. The Set up page keeps only which step it shows (D3a) and the form's values. Every panel page is the same shell, so a pill click doesn't remount it. So the shell reads the state on mount and again on every panel page change; D2's redirect still happens only once. It also re-reads after each step save, test answer and keep-sign-in write.
  - **The All set card stays on screen** after the state says over. The shell drops the pill only once the person leaves the Set up page.
  - **Errors:** the read's 401 and 404 go through the shell's existing handler, once.
  - **Writes:** each step's save goes through its own existing endpoint. The wizard's own writes are new panel endpoints with the CSRF header:
    - "go to step n";
    - "skip step n" (for steps 2 and 4, it also sets that step's kept mark, D4a);
    - "step n saved" (after a step's saves succeed, or Continue; for step 2, it also sets the kept mark, D7).

    Each is a conditional update that applies only while the wizard is on, and each answers the whole state, as the read does, so no second read is needed. The keep-sign-in write, behind the Dashboard's "Keep these values", is a separate write that sets D9's mark whatever the wizard's state. Step 4's skip button, labelled the same, sends the skip write instead, which moves the wizard on (D4a).

## 4. Constraints

- **No new packages,** backend or frontend. Svelte 5 runes; no JS or CSS dependencies.
- **Postgres only.** The migration runs on an existing install with data, and on an empty database (D10).
- **Panel calls** go through the token guard like the other panel endpoints, with the CSRF header on writes, and their query strings are redacted in the access log.
- **No state answer is a 404** (D5a); a 404 is the guard's alone.
- **UI patterns:** same tab; plain sentences, never she or he; the panel's existing components (`PanelHead`, `Button`, the confirm pattern; `Modal` stays in the dialogs). The panel is laptop-only, so no 400 px rule.
- **Tests:** Vitest with mount/unmount/flushSync, no testing-library; `npm test`; backend tests via `backend/.venv`. `backend/tests/conftest.py` also truncates the new table, so every test, the first included, starts with the wizard over (D10's missing row). The visual-refresh gate's expected count and pinned dialog classes change with any new or moved owned files.

## 5. Inputs a person will meet (for the plan's Review Focus)

- **A fresh install:** the first panel open, through sign-in, lands on Set up at step 1, with email off, the name "Mathion", no course and the defaults.
- **An operator who opens the panel days after installing:** the wizard is still there, at step 1.
- **Reloading the Dashboard** while the wizard is on: it stays on the Dashboard in the same tab; a new tab lands on Set up (D2).
- **An update of an established site** with courses:
  - no pill and no redirect;
  - Sign-in and limits is done;
  - Email is done if a test passed or a message has gone out since the update. Until then, its line says "Not tested yet: send a test email.";
  - Site name and logo is done, even if the name is still "Mathion" (D10).
- **An update of an unused install** (no course): the wizard appears.
- **Leaving mid-wizard** through a pill, a sign-out, or an expired token: the next open lands on the same step. A sign-in that expires while on `/setup` goes through Login and comes back to `/setup` (`superuser_return_path`), so it lands on the same step too. Leaving with typed values asks first (D3); a long pause while typing doesn't expire the link (D3a).
- **The state read fails** while the stats load: the Dashboard shows an error with Try again where the card goes (D2). A later read failing while a step holds typed values changes nothing.
- **A tab left with typed values:** the link stays alive for 2 hours after the last keystroke, then expires (D3a). A laptop asleep for over 30 minutes comes back to the expired view. Accepted: after the cap the form still looks live, and typing that starts more than 30 minutes after the last request is lost at the next request, which shows the expired view.
- **The sign-in session ends** (its absolute expiry) while a step holds typed values: the next read's 401 goes to Login without asking, and the typed values are lost. Accepted: rare, and the same as on Settings.
- **The provider rotates the password** on an established site: the next test of the saved settings fails, and Email is not done at once.
- **Jumping to step 4 first** and saving: the wizard moves on to steps 1–3, not to All set.
- **Two superusers, or two tabs,** on the Set up page: one skips step 2 while the other saves it, or one tab ends the wizard. Nothing saved is lost, the late write changes nothing, and the other tab shows All set on its next read.
- **Email:**
  - saved but the test fails, or saved without a test: the step is passed, not done, and says why;
  - a test answering after the person has moved to step 2: the list's tick follows;
  - a restore onto a server with another secret key: Email is not done ("The saved password can't be read on this server.").
- **Site name and logo:** the name saves but the logo is refused (too big for the proxy): the name stays, the error shows, and retrying sends only the logo.
- **Sign-in and limits:**
  - the step saved unchanged: done;
  - the limits refused after sign-in saved, when that completed the last step: sign-in stays saved and the step is kept, the limits error and the typed values stay on screen (D3a), and retrying sends only the limits;
  - step 4 skipped: the step is done and the Dashboard doesn't list it (D4a). (An upgraded site with a course never shows the line either: D10 marks the step kept.)
  - "Keep these values" pressed on the Dashboard while the wizard is on (step 4 not reached yet): step 4 is kept, so done and passed (D4); the list shows its tick on the next read, and if it was the last step not passed, the wizard ends (D5a).
- **A course:**
  - made on the Courses page while the wizard is on: step 3 shows it as done;
  - one with no admin (made with `POST /api/courses`, or its admin removed): step 3 names it and offers the form;
  - the superuser makes themself the admin: the note says "you are its admin" and no PIN command;
  - a course whose only admin is disabled: step 3 is done.
- **The last missing step done by step 3's save:** the admin note shows, then Continue leads to All set.
- **A dev install** (`MATHION_EMAIL_MODE=file`): the Email step counts as done.
- **A healthy upgraded site:** the first PIN or notification that goes out after the update marks Email done.
- **A move to a new mail provider** whose test failed, saved anyway: Email is not done ("The last test failed."), even though the old server sent mail.
- **A stuck queue** (the provider's password changed): Email is not done ("Sending is failing: see Settings.").
- **Two tabs making the first course** with the same address: the second gets the 409 sentence, then the done view.
- **A test of typed, unsaved values** that passes: the step shows the test's answer, not "Not tested yet".
- **Skipping every step:** the All set card lists Email and First course, the wizard is over, and the Dashboard lists those two (D4a).
- **Step 2 skipped**, so the name stays "Mathion": the step is done, and the Dashboard doesn't list it (D4a).
- **A logo saved alone** in step 2, the name left "Mathion": the step is done.
- **Email left off:** the Dashboard keeps the Email line until email works; it can't be dismissed (D6).
- **Deleting the only course** after setup: the Dashboard lists First course again; the wizard doesn't come back.
- **Everything done on the regular pages** while the wizard is on: the next panel open lands on the Dashboard, with no pill and no card (D5a).
- **A restore of a backup taken mid-setup:** the wizard comes back at the stored step (D11).

## 6. What's left to the builder

- **The storage.** My suggestion:
  - a one-row table (`site_setup`, id 1) holding whether the wizard is on, the step it's on, and which steps are passed;
  - the "kept" marks of D7 and D9 and D6's send record on `site_settings`, beside the other email and sign-in values. The keep-sign-in write (the Dashboard's Keep these values, and step 4's unchanged save; D9, D13) writes D9's mark through the settings row (`get_row`), whatever the wizard's state.

  Whatever the shape:
  - the model's default is "over";
  - the wizard's writes are conditional updates that never insert a row and never turn the wizard on.
- **The endpoint shapes:** the state read (D13) and the wizard's writes. Last write wins between tabs, within D5a's rule that nothing moves the wizard after it's over.
- **The state read uses the database's current values,** not a process-wide cache: `branding.read_in(db)` for the name, not the cached `load_branding()`.
- **How the forms are shared** between the Settings, Branding and Courses dialogs and the steps, as long as the fields, checks and sentences are the same ones.
