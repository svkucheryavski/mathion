# Session Handoff — Teacher Monitoring Slice A

**Date saved:** 2026-05-29
**Branch:** `teacher-monitoring-slice-a` (17 commits ahead of `main`)
**Last commit:** `0c34144 docs(plan): teacher monitoring slice A — 14-task TDD plan`
**Status:** Spec + plan complete. Ready to begin T1 (Backend helpers).

---

## What we did this session

1. **Brainstormed the spec** for the Teacher Monitoring Surface (Slice A: unblock + landing page) at
   `docs/superpowers/specs/2026-05-29-teacher-monitoring-slice-a-design.md`.

2. **Revised it 17 times** through repeated self-review + Codex round-by-round second-opinion review.
   The user runs Codex prompts in their terminal (paste-back workflow because `codex exec` hangs from
   the Bash tool on Codex v0.129/0.130).

3. **Codex round 16 returned plan-ready: YES** with only a non-blocking minor (wording precision about
   which malformed-percent inputs reach `Login.svelte` vs. get sanitized by `URLSearchParams`).
   Rev 17 fixed the minor.

4. **Wrote the 14-task implementation plan** at
   `docs/superpowers/plans/2026-05-29-teacher-monitoring-slice-a.md` (commit `0c34144`).
   Plan is TDD-ordered with exact code, exact commands, expected output per step, and self-reviewed
   against rev 17 for coverage / placeholders / type consistency / scope.

5. **Asked the user how to execute** the plan: subagent-driven (one fresh subagent per task) vs.
   inline execution (single conversation). User's response: they need to restart / move computers.

---

## What's next when you resume

**Step 1 — Re-orient on the new machine:**
- Confirm working dir: `/Users/svkucheryavski/Documents/Developing/mathion` (or wherever the repo
  was restored — adjust paths).
- Check the branch: `git status` → should be `teacher-monitoring-slice-a`, clean.
- Verify the last commit: `git log -1 --oneline` → should be `0c34144`.
- If memory directory was not restored, this handoff doc + the CLAUDE.md auto-memory section
  (re-injected from the user's prior memory) re-establishes context.

**Step 2 — Choose execution mode** (the open question from the prior session):

| Option | Description |
|---|---|
| **Subagent-Driven (recommended)** | Dispatch a fresh subagent per task (uses `superpowers:subagent-driven-development`). Best for keeping the main context lean across 14 tasks and matching the user's standing per-task review preference. |
| **Inline execution** | Execute tasks in the same conversation using `superpowers:executing-plans`. Keeps everything in one thread but the context window grows. |

Reproduce the choice with `AskUserQuestion`.

**Step 3 — Start Task 1: Backend helpers.**

T1 implements two SQL helpers in `backend/mathion/api/helpers.py`:
- `has_run_teacher_on_course(db, user, course_id) -> bool`
- `has_run_pinned_to_version(db, user, version_id) -> bool`

with 13 unit tests in a new file `backend/tests/test_teaching.py`.

Detailed steps with exact code are at
`docs/superpowers/plans/2026-05-29-teacher-monitoring-slice-a.md` → "## Task 1".

Per the user's standing per-task review preference, after T1 lands:
- Spawn 5 Opus reviewers in parallel via `Agent` (subagent_type: general-purpose) — find a Critical/Important
  before committing.
- Generate a Codex script template at `/tmp/codex-teacher-monitoring-T1.sh` so the user can paste it into
  their terminal and run a second-opinion review. Use the rev-* script header verbatim — no `--model` flag,
  ChatGPT account default, sandbox read-only, `model_reasoning_effort=high`, `project_doc="./CLAUDE.md"`.
- Apply all Critical / Important findings as a new commit before moving to T2.

---

## Standing preferences (also in user's auto-memory)

- **Always invoke pytest/alembic/python via `backend/.venv/`** — never bare commands.
- **Feature branches on `main` checkout, NOT worktrees.** Skip `superpowers:using-git-worktrees`.
- **Strict per-task review loop:** After every plan task — reviewer (5 parallel Opus agents) + Codex
  (user runs script in terminal, pastes results). Fix all Critical/Important before proceeding.
- **Codex: always `model_reasoning_effort=high`.** Never downgrade for speed.
- **Codex script template:** Copy the header verbatim from `/tmp/codex-*-rev16.sh` or earlier
  `/tmp/codex-runmgmt-*.sh`. No `--model` flag. ChatGPT account default.
- **Self-review proposals 2-3 times before presenting** to catch pushback issues upfront.
- **Frontend: Svelte 5 runes, no JS/CSS deps, modular.** Design later.
- **Discussion style: multiple-choice brainstorming, design before code.**

---

## How to restore the work on a new machine

**Option A — clone from a remote (no remote currently configured):**

```bash
# If you set up a remote on GitHub / GitLab / wherever:
cd ~/Documents/Developing
git clone <remote-url> mathion
cd mathion
git checkout teacher-monitoring-slice-a
```

To add a remote on this current machine BEFORE moving, run (replace URL):

```bash
git -C /Users/svkucheryavski/Documents/Developing/mathion remote add origin git@github.com:<you>/mathion.git
git -C /Users/svkucheryavski/Documents/Developing/mathion push -u origin teacher-monitoring-slice-a
git -C /Users/svkucheryavski/Documents/Developing/mathion push origin main
```

**Option B — copy the whole repo directory:**

```bash
# On the source machine:
cd ~/Documents/Developing
tar czf mathion-snapshot-2026-05-29.tar.gz mathion/
# Copy the tarball to the new machine via scp / external drive / sync.
# On the new machine:
cd ~/Documents/Developing  # or wherever you want it
tar xzf mathion-snapshot-2026-05-29.tar.gz
cd mathion
git status   # confirm branch + clean tree
```

**Option C — restore the Claude auto-memory directory too** (optional, preserves chat-level context):

```bash
# On the source machine:
cp -R ~/.claude/projects/-Users-svkucheryavski-Documents-Developing-mathion ~/claude-memory-backup/
# Move to the new machine, then restore:
mkdir -p ~/.claude/projects/
cp -R ~/claude-memory-backup/-Users-svkucheryavski-Documents-Developing-mathion \
      ~/.claude/projects/
```

(If the working directory path differs on the new machine, rename the memory folder to match the new path,
substituting `-` for `/`.)

**Backend Python env will NOT transfer** — recreate `backend/.venv` on the new machine:

```bash
cd ~/Documents/Developing/mathion/backend
python3 -m venv .venv
.venv/bin/pip install -e .   # or whatever the project's install command is
```

**Frontend node_modules will NOT transfer** — `cd frontend && npm install` on the new machine.

---

## Quick re-entry prompt for the new session

Paste this when you start the next session, after re-orienting:

> Resume the teacher-monitoring slice-A work. We finished the spec (rev 17, plan-ready)
> and the 14-task plan at `docs/superpowers/plans/2026-05-29-teacher-monitoring-slice-a.md`.
> The next decision is execution mode — subagent-driven or inline. After that, start T1
> (Backend helpers). See `docs/superpowers/SESSION-HANDOFF-2026-05-29.md` for full context.

---

## Verification checklist for the new machine

Before resuming, confirm:

- [ ] `git -C <repo> log -1 --oneline` shows `0c34144 docs(plan): teacher monitoring slice A — 14-task TDD plan`
- [ ] `git -C <repo> status` shows working tree clean on branch `teacher-monitoring-slice-a`
- [ ] `docs/superpowers/specs/2026-05-29-teacher-monitoring-slice-a-design.md` exists (~1280 lines, rev 17)
- [ ] `docs/superpowers/plans/2026-05-29-teacher-monitoring-slice-a.md` exists (~3100 lines)
- [ ] `backend/.venv/bin/pytest --version` works (recreate `.venv` if not)
- [ ] `cd frontend && npm test --silent --run 2>&1 | tail -5` reports passing baseline (run `npm install` if not)
