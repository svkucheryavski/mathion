# Session Handoff — Teacher Dashboards (T2 awaiting explicit user OK)

**Date saved:** 2026-06-01
**Branch:** `teacher-dashboards` (13 commits ahead of `main`, including this doc)
**Last commit:** `5bdeca3 docs: session handoff for machine restart (2026-06-01)`
**Status:** T1 complete. T2 implementation + R1 fix committed (`0043f3a`, `6c8dfb0`). Codex R2 already returned **PASS** earlier in this session (0 Critical, 0 Important, observational Minors). **Pending: explicit user OK to mark T2 complete and dispatch T3** — there is no codex round left to run.

> **NB:** This is a different feature branch from the previous slice. `teacher-monitoring-slice-a` was a different work-stream (covered by `SESSION-HANDOFF-2026-05-29.md`); the current branch is `teacher-dashboards`, started after that work merged to main.

---

## Where we are

**Plan:** `docs/superpowers/plans/2026-05-31-teacher-dashboards.md` (8 TDD tasks)
**Spec:** `docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md` (rev 12 converged)

| Task | Status | Notes |
|---|---|---|
| T1 — backend drilldown endpoint + MP title + tests | ✅ complete | passed 6 review rounds (codex R1 through R6); 30/30 tests pass |
| T2 — `lib/dashboards.ts` wire module + tests | ⏳ awaiting explicit user OK | implementer DONE (`0043f3a`); spec reviewer ✅; codex R1 returned REVISE; R1 fix landed (`6c8dfb0`); codex R2 returned **PASS** — 0 Critical, 0 Important, observational Minors only; 8/8 tests pass, 0 type errors |
| T3 — `lib/csvWrite.ts` + tests | pending | |
| T4 — `StatusBadge.svelte` + CSS variables | pending | |
| T5 — `RunProgressTab.svelte` + ~22 tests | pending | |
| T6 — `RunSubmissionTab.svelte` + ~16 tests | pending | |
| T7 — `DashboardSidePanel` + `RunDetailPage` tab registration | pending | |
| T8 — seed script + manual smoke + cleanup | pending | |

### Commits on branch (12, oldest first)

```
40d4c6d docs(spec): teacher dashboards design (rev 12 converged)
c26e627 docs(plan): teacher dashboards — 8-task TDD plan
a42aba5 docs(plan): T1 schemas align to spec §5.1 wire shape
e4287d9 feat(backend): add drilldown endpoint + mini-project title field (dashboards T1)
afa4abc feat(backend): T1 R1 fix — rename schemas, real CourseAdmin test, test cleanups
1d9c04f docs(spec): T1 R2 fix — clarify §5.1 query-budget wording
1a85373 docs(spec+plan): T1 R3 fix — scrub stale helper-name references
3b15675 docs(spec+plan): T1 R4 fix — align helper contract with implementation
8cbc274 docs(spec+plan): T1 R5 fix — sibling helper + Pydantic class renames
ba6efc3 docs(plan): T2 interfaces + mock bodies align to spec §6.1
0043f3a feat(frontend): add lib/dashboards.ts wire module + tests (dashboards T2)
6c8dfb0 test(dashboards): T2 R1 fix — assert method GET + signal identity directly
```

---

## What's next when you resume

### Step 1 — Re-orient

- Working dir: `/Users/svkucheryavski/Documents/Developing/mathion`.
- `git status` → should show `teacher-dashboards`, clean.
- `git log -1 --oneline` → should be `5bdeca3 docs: session handoff...` (or later if the handoff doc itself got updated).
- `git log --oneline main..HEAD | wc -l` → should be 13.

### Step 2 — On user's explicit OK, mark T2 complete and dispatch T3

Codex R2 has already returned PASS. The only remaining gate is the strict-review-no-shortcuts memory: wait for the user to say "ok mark T2 done" (or equivalent) before doing the next two actions.

When the OK comes:
1. `TaskUpdate` T2 (#17) to `completed`.
2. `TaskUpdate` T3 (#18) to `in_progress`.
3. Dispatch T3 implementer subagent for `frontend/src/lib/csvWrite.ts` + tests (plan lines 753-1031). Spec §6.7 is source of truth. **Pre-check plan vs. spec for divergence** (same pattern as T2 — commit `ba6efc3` pre-aligned the plan; do the same for T3 if needed).

### Subsequent tasks

T3 → T4 → T5 → T6 → T7 → T8, each going through:
- Implementer subagent (sonnet for mechanical tasks)
- Spec-compliance reviewer subagent
- Codex paste-back (user runs from terminal)
- Apply all Critical / Important findings
- Re-review until clean
- Wait for explicit user OK
- Mark complete + dispatch next

---

## Standing preferences (also in auto-memory)

- **`backend/.venv/bin/pytest` etc.** — never bare commands.
- **Feature branch on `main` checkout**, NOT worktrees.
- **Strict per-task review loop**: reviewer + codex parallel, fix all Critical/Important, re-review.
- **No shortcuts on review rounds**: after ANY fix touching code or spec text in response to Important/Critical, dispatch the matching reviewer again. NEVER skip a review round on "mechanical / literal text application" reasoning. Wait for explicit user confirmation before marking a task complete and dispatching the next.
- **Codex: `model_reasoning_effort=high`** always. ChatGPT account default. No `--model` flag. Sandbox read-only. `project_doc="./CLAUDE.md"`.
- **Codex via paste-back**: `codex exec` hangs from Bash on v0.129/0.130. Give the user a script in `/tmp/codex-*.sh` to run in their terminal.
- **Codex script header**: copy verbatim from previous task's script (e.g., `/tmp/codex-dashboards-T2-r2.sh` in the appendix).
- **Frontend: Svelte 5 runes**, no JS/CSS deps, modular.
- **Svelte test pattern**: `mount/unmount/flushSync from svelte`, NOT `@testing-library/svelte`. For wire modules (TS-only), use the `vi.stubGlobal('fetch', mockFetch(status, body))` pattern with the plain-object mock from `frontend/src/tests/runGroups.test.ts:10-12`.
- **Discussion**: multiple-choice brainstorming, design before code.

---

## How to restore the work on a new machine

### Option A — clone from remote (NOT YET CONFIGURED)

```bash
git -C ~/Documents/Developing/mathion remote add origin git@github.com:<you>/mathion.git
git -C ~/Documents/Developing/mathion push -u origin teacher-dashboards
git -C ~/Documents/Developing/mathion push origin main
```

After moving:

```bash
cd ~/Documents/Developing
git clone <remote-url> mathion
cd mathion
git checkout teacher-dashboards
```

### Option B — tarball

```bash
# Source machine:
cd ~/Documents/Developing
tar czf mathion-snapshot-2026-06-01.tar.gz mathion/
# Copy to new machine, then:
cd ~/Documents/Developing
tar xzf mathion-snapshot-2026-06-01.tar.gz
cd mathion
git status   # confirm teacher-dashboards, clean
```

### Option C — also copy Claude auto-memory (preserves chat-level context)

```bash
# Source:
cp -R ~/.claude/projects/-Users-svkucheryavski-Documents-Developing-mathion ~/claude-memory-backup/
# New machine:
mkdir -p ~/.claude/projects/
cp -R ~/claude-memory-backup/-Users-svkucheryavski-Documents-Developing-mathion ~/.claude/projects/
```

(Rename the memory folder if the new working-directory path differs — substitute `-` for `/`.)

### Recreate envs on new machine

```bash
# Backend:
cd ~/Documents/Developing/mathion/backend
python3 -m venv .venv
.venv/bin/pip install -e .   # or whatever the project install command is

# Frontend:
cd ~/Documents/Developing/mathion/frontend
npm install
```

---

## Quick re-entry prompt for the next session

> Resume the teacher-dashboards work. T1 complete; T2 implementation + R1 fix are committed
> (`0043f3a`, `6c8dfb0`); codex R2 already returned PASS. I will give the explicit OK to
> mark T2 complete and dispatch T3 in this session. See
> `docs/superpowers/SESSION-HANDOFF-2026-06-01.md` for full state.

---

## Verification checklist for the new machine

- [ ] `git -C <repo> log -1 --oneline` shows `5bdeca3 docs: session handoff...` (or later)
- [ ] `git -C <repo> log --oneline main..HEAD | wc -l` returns `13` (or more if the handoff doc was updated)
- [ ] `git -C <repo> status` shows working tree clean on `teacher-dashboards`
- [ ] `docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md` exists
- [ ] `docs/superpowers/plans/2026-05-31-teacher-dashboards.md` exists
- [ ] `backend/.venv/bin/pytest backend/tests/test_dashboard_item_drilldown.py backend/tests/test_dashboard_mini_projects.py -q 2>&1 | tail -3` shows 30 passed
- [ ] `npm test -- src/tests/dashboards.test.ts 2>&1 | tail -3` from repo root shows 8 passed
- [ ] `npm run check 2>&1 | tail -3` shows 0 ERRORS

---

## Codex R2 result (already received)

Codex R2 returned **PASS** on the T2 R1 fix earlier in this session — verbatim:

```
## Findings
### Critical (blocks T2 completion)  None
### Important (should fix before T2 completion)  None
### Minor / Notes
- Round-1 finding is fixed cleanly. The three URL tests capture `url` and `init`, then assert
  URL via `.toContain(...)`, method via `expect(init.method).toBe('GET')`, and signal identity
  via `expect(init.signal).toBe(ctrl.signal)`: `frontend/src/tests/dashboards.test.ts:25-29`, `:37-41`, `:49-53`.
- Mock-call indexing matches the existing project pattern at `frontend/src/tests/runGroups.test.ts:21`.
- Spec §13 coverage is now satisfied for URL + method + signal-threading per
  `docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md:1623-1625`; nothing missing.
- `git diff 0043f3a..6c8dfb0 --stat` shows only `frontend/src/tests/dashboards.test.ts` changed (27 lines).
- Test count remains exactly 8 in `frontend/src/tests/dashboards.test.ts`.
- The `as RequestInit` cast is acceptable; consistent with nearby test conventions; no type-safety concern.
- Response-shape tests and constants tests are untouched by the R1 diff.
- Commit `6c8dfb0` includes `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Verdict
PASS  (T2 ready to mark complete)
```

No further codex round is pending for T2. The handoff exists only because the strict-review-no-shortcuts memory requires explicit user OK before marking the task complete and dispatching T3.

---

## Memory entries written during this session

The auto-memory directory (`~/.claude/projects/-Users-svkucheryavski-Documents-Developing-mathion/memory/`) has these load-bearing entries added or revised in this session — they survive between sessions if the memory dir is copied (Option C above):

- **`feedback_strict_review_no_shortcuts.md`** — NEW this session. Sharpens the per-task review loop: after ANY fix in response to a reviewer's Important/Critical finding, dispatch the matching reviewer again. NEVER skip a review round on "the fix is mechanical / literal text application" reasoning. Wait for explicit user confirmation before marking a task complete.

The other relevant entries (already established in prior sessions):

- `feedback_review_loop_per_task.md` — general per-task review-loop convention
- `feedback_codex_high_effort.md`, `feedback_codex_via_paste.md`, `feedback_codex_script_template.md`
- `feedback_git_workflow.md`, `feedback_use_venv.md`
- `feedback_frontend_stack.md`, `feedback_svelte_test_pattern.md`
- `feedback_self_review_proposals.md`, `feedback_discussion_style.md`
- `project_mathion_status.md`, `project_admin_vs_teacher_roles.md`
- `user_background.md`
