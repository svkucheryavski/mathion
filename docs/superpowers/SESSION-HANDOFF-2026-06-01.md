# Session Handoff — Teacher Dashboards (T2 awaiting codex R2)

**Date saved:** 2026-06-01
**Branch:** `teacher-dashboards` (12 commits ahead of `main`)
**Last commit:** `6c8dfb0 test(dashboards): T2 R1 fix — assert method GET + signal identity directly`
**Status:** T1 complete. T2 implementation done (commit `0043f3a`) + R1 fix done (`6c8dfb0`). **Pending: user runs codex R2 paste-back, then explicit OK to mark T2 complete and dispatch T3.**

> **NB:** This is a different feature branch from the previous slice. `teacher-monitoring-slice-a` was a different work-stream (covered by `SESSION-HANDOFF-2026-05-29.md`); the current branch is `teacher-dashboards`, started after that work merged to main.

---

## Where we are

**Plan:** `docs/superpowers/plans/2026-05-31-teacher-dashboards.md` (8 TDD tasks)
**Spec:** `docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md` (rev 12 converged)

| Task | Status | Notes |
|---|---|---|
| T1 — backend drilldown endpoint + MP title + tests | ✅ complete | passed 6 review rounds (codex R1 through R6); 30/30 tests pass |
| T2 — `lib/dashboards.ts` wire module + tests | ⏳ awaiting codex R2 | implementer DONE; spec reviewer ✅; codex R1 returned REVISE; R1 fix landed (`6c8dfb0`); codex R2 paste-back script is pending user execution |
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

### Step 1 — Re-orient on the new machine

- Working dir: `/Users/svkucheryavski/Documents/Developing/mathion` (adjust if restored elsewhere).
- `git status` → should show `teacher-dashboards`, clean.
- `git log -1 --oneline` → should be `6c8dfb0 test(dashboards): T2 R1 fix...`.
- `git log --oneline main..HEAD | wc -l` → should be 12.

### Step 2 — Run the pending codex R2 paste-back

The R2 script (3814 bytes) lived at `/tmp/codex-dashboards-T2-r2.sh` and will NOT survive restart. Recreate it from the appendix at the bottom of this file, then run:

```
bash /tmp/codex-dashboards-T2-r2.sh
```

Paste codex's output back into the session. The expected verdict is PASS (R1 fix was small and surgical), but if codex returns REVISE, apply the findings as a new commit + re-run codex R3.

### Step 3 — After codex PASS

1. Wait for explicit user OK ("ok mark T2 done" or equivalent) — **do NOT mark T2 complete unilaterally** per the `strict-review-no-shortcuts` memory.
2. `TaskUpdate` T2 (#17) to `completed`.
3. `TaskUpdate` T3 (#18) to `in_progress`.
4. Dispatch T3 implementer subagent for `frontend/src/lib/csvWrite.ts` + tests (plan lines 753-1031). Spec §6.7 is source of truth. **Pre-check plan vs. spec for divergence** (same pattern as T2 — commit `ba6efc3` pre-aligned the plan; do the same for T3 if needed).

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
> (`0043f3a`, `6c8dfb0`). The pending codex R2 paste-back script needs to be recreated
> from the appendix in `docs/superpowers/SESSION-HANDOFF-2026-06-01.md` and run; after
> codex returns PASS and I give explicit OK, mark T2 complete and dispatch T3.

---

## Verification checklist for the new machine

- [ ] `git -C <repo> log -1 --oneline` shows `6c8dfb0 test(dashboards): T2 R1 fix...`
- [ ] `git -C <repo> log --oneline main..HEAD | wc -l` returns `12`
- [ ] `git -C <repo> status` shows working tree clean on `teacher-dashboards`
- [ ] `docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md` exists
- [ ] `docs/superpowers/plans/2026-05-31-teacher-dashboards.md` exists
- [ ] `backend/.venv/bin/pytest backend/tests/test_dashboard_item_drilldown.py backend/tests/test_dashboard_mini_projects.py -q 2>&1 | tail -3` shows 30 passed
- [ ] `npm test -- src/tests/dashboards.test.ts 2>&1 | tail -3` from repo root shows 8 passed
- [ ] `npm run check 2>&1 | tail -3` shows 0 ERRORS
- [ ] T2 R2 codex script recreated from appendix below and ready to paste

---

## Appendix — pending codex R2 paste-back script

Save the block below as `/tmp/codex-dashboards-T2-r2.sh`, then `chmod +x` and run.

```bash
#!/bin/bash
codex exec \
  --sandbox read-only \
  -c model_reasoning_effort=high \
  -c project_doc="./CLAUDE.md" \
  - <<'PROMPT'
You are doing **round-2 review of T2** (frontend wire module `lib/dashboards.ts`) for the Teacher Dashboards implementation on the mathion project. Round 1 you returned 1 Important: the 3 URL+signal tests didn't assert `init.method === 'GET'` or `init.signal === ctrl.signal` directly. Your job: verify the fix landed cleanly and nothing else slipped in.

## Round 1 finding

> "Test surface misses the spec's method assertion. Spec §13 requires URL + method + signal-threading tests (docs/.../design.md:1623-1625), but the three tests only assert URL substring and `signal` via `objectContaining` (frontend/src/tests/dashboards.test.ts:25-28, 36-39, 47-50). Prefer capturing the actual second fetch arg and asserting `init.method === 'GET'` and `init.signal === ctrl.signal`."

## R1 fix commit

- **Commit:** `6c8dfb0` on branch `teacher-dashboards`
- **What changed:** `git diff 0043f3a..6c8dfb0` — test file only, 15+/12-, no code changes
- **Reported fixes:** The 3 tests in the `'wire URL + signal threading'` describe block now capture `(f.mock.calls as unknown[][])[0][0]` as the URL and `[0][1]` as the `RequestInit`, then assert URL via `toContain`, `init.method === 'GET'` via strict equality, and `init.signal === ctrl.signal` via identity. The previous `expect(f).toHaveBeenCalledWith(..., objectContaining({ signal: ctrl.signal }))` pattern was dropped. Cast pattern matches `runGroups.test.ts:21`.

## Your re-review questions

### Verification of your round-1 finding

1. **Method + signal-identity assertions.** Read `frontend/src/tests/dashboards.test.ts` lines 19-55 (the `'wire URL + signal threading'` describe block). For each of the 3 tests, confirm:
   - `init.method` is asserted with strict equality (`.toBe('GET')`), not loose matching
   - `init.signal` is asserted with identity (`.toBe(ctrl.signal)`), not via `objectContaining`
   - URL is asserted with `.toContain(...)` substring match (unchanged from R1)
   - The mock-call indexing matches the project pattern at `runGroups.test.ts:21`

2. **Spec §13 coverage.** Does the fix now satisfy "URL + method + signal-threading (one test)" per spec line 1623-1625? Cite anything still missing.

### Anything new

3. **R1 fix scope.** Run `git diff 0043f3a..6c8dfb0 --stat`. Should show only `frontend/src/tests/dashboards.test.ts` changed. Confirm.

4. **Test count.** Still exactly 8 tests? No tests added or removed?

5. **TypeScript strictness.** The R1 fix uses `as RequestInit` cast. Is this acceptable per project conventions (the prior `runGroups.test.ts:21` uses similar casts)? Any type-safety concern?

6. **Other test groups intact.** Read the response-shape conformance describe block (lines ~57-130 ish) AND the constants describe block (lines ~135 onward). Confirm these were NOT modified by R1 fix.

7. **Commit message.** Run `git log -1 6c8dfb0`. Does the message include the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer per project convention?

### Sanity

8. Run `npm test -- src/tests/dashboards.test.ts 2>&1 | tail -5` from the repo root. Should be 8 passing (or report sandbox-blocked).
9. Run `npm run check 2>&1 | tail -5`. Should be 0 errors (warnings OK if pre-existing in unrelated files).
10. Run `git log --oneline main..HEAD` to confirm only the expected T1 + T2 commits are on the branch.

## Output format

```
## Findings

### Critical (blocks T2 completion)
<numbered list or "None">

### Important (should fix before T2 completion)
<numbered list or "None">

### Minor / Notes
<terse>

## Verdict
PASS  (T2 ready to mark complete)
  -- or --
REVISE  (specific issues above must be addressed)
```

Be specific. Cite file:line references. Read-only.
PROMPT
```

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
