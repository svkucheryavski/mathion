# Phase 9-C — `helpers.py` God-Module Split (Design)

**Status:** Draft for review (rev 3 — after Opus review rounds 1–2)
**Date:** 2026-07-24
**Scope:** Backend-only, pure refactor. No behavior change.

## Goal

`backend/mathion/api/helpers.py` has grown into a 686-line god-module holding 28 functions
across at least six unrelated responsibilities, imported by **36 files** (21 production
`api/` modules + 1 dev seed script + 14 test modules). Split it into six focused,
feature-named modules that match the codebase's existing per-feature module convention, and
**delete `helpers.py`** entirely. This is a behavior-preserving reorganization: every
function keeps its exact signature, body, and semantics; only its home module and the import
sites change.

## Motivation

- The module mixes pure string utils, generic DB lookups, authorization gates, roster
  mutations, markdown asset rendering, and submission file helpers — nothing binds them
  together except "shared".
- A focused module can be held in context at once and reviewed in isolation; a 686-line
  grab-bag cannot.
- The codebase already uses 25 focused per-feature modules alongside `helpers.py`; this
  split brings the shared utilities in line with that house style.

## Non-Goals

- **No behavior change.** No function's logic, signature, return type, error, status code,
  or message is altered.
- **No opportunistic fixes.** Any latent issue noticed during the move is left as-is (or
  filed separately); this slice does not change what the code does. The **one** carve-out to
  this pure-move guarantee is a purely-cosmetic edit *inside* the moved code: dropping the
  stale `helpers.py:NNN` line numbers in the two docstrings that move into `asset_render.py`
  (they would otherwise cite a deleted file; see Migration). No moved *code* is altered.
- **No new behavior tests.** The existing suite is the regression net (see Testing).
- **No further decomposition** of the six target modules, and no non-`import` changes to any
  file *outside* the six modules. Stale `helpers.py:NNN` references that live in files this
  slice does NOT edit (`run_assets.py`, `test_dashboard_item_drilldown.py`) are knowingly
  left alone (out of scope).
- **No function renames.** Names are preserved so importers change only the *source
  module*, not the imported symbol.
- **No permanent compatibility shim.** The transitional re-export in `helpers.py` (see
  Migration) is removed in the final task; `helpers.py` does not survive.

## Architecture — the six modules

All modules live under `backend/mathion/api/`. Each module carries **verbatim** every
module-level import its moved functions reference in `helpers.py`, and **preserves each
function's existing import *placement* verbatim** — most functions import models/sibling-`api`
modules inside their bodies (a pattern that keeps the load-time graph acyclic; retained
as-is, not "cleaned up"), with one exception noted below.

The table's *Module-level names it must carry* column lists only the **notable /
feature-specific** module-level names. The ubiquitous ones — `Session` (evaluated at **load
time** via `db: Session` annotations, since `helpers.py` has no
`from __future__ import annotations`), `select`, and `HTTPException` — additionally travel
with any function that uses them and are not repeated per row.

| Module | Functions (verbatim from `helpers.py`) | Module-level names it must carry | Responsibility |
|---|---|---|---|
| `text_utils.py` | `slugify`, `bump_content_updated_at`, `to_utc_aware` | `_NON_SLUG` (private regex); `re`, `datetime`/`timezone` | pure string / datetime helpers; no DB session |
| `lookups.py` | `get_or_404`, `get_or_create_user`, `get_newest_published_version` | `INT4_MAX`; `Base` (runtime annotation on `get_or_404`); `IntegrityError` (`get_or_create_user`) | generic fetch / fetch-or-create + the int4 order-column bound |
| `authz.py` | `require_course_admin`, `require_course_admin_for_run`, `require_run_admin_or_teacher`, `is_run_admin_or_teacher`, `has_run_teacher_on_course`, `has_run_pinned_to_version` | `from mathion.api.lookups import get_or_404` (the one new load-time api-import — see Dependency graph); `TYPE_CHECKING` `User` | authorization gates (raising) + read-only UI predicates |
| `roster_ops.py` | `enroll_user_in_run`, `remove_run_student`, `find_student_active_conflicts`, `make_already_active_409_body` | `STUDENT_ALREADY_ACTIVE_ERROR_CODE`; **module-level `from mathion.models import CourseVersion, Run, RunStudent`** (uniquely required — see note) | shared enrollment/roster mutations + active-conflict logic |
| `asset_render.py` | `render_with_assets`, `sync_asset_references`, `sync_script_reference`, `render_with_run_assets`, `sync_run_asset_references` | `os` | markdown asset-reference render/sync (course + run assets) |
| `submission_files.py` | `build_submission_filename`, `build_feedback_filename`, `submission_storage_dir`, `run_asset_storage_dir`, `mini_project_visible_to_student`, `get_submitter_group`, `has_submissions` | `os`, `settings`, `sanitize_filename` | **the shared run/submission helper module** (owned explicitly): submission/feedback filename + run-tree path builders, plus the submission-domain reads (`has_submissions`, `get_submitter_group`) and the pure visibility predicate |

Total: 28 functions + 2 public constants (`INT4_MAX`, `STUDENT_ALREADY_ACTIVE_ERROR_CODE`)
+ 1 private (`_NON_SLUG`).

**Import-placement note (the one exception to "function-body imports"):**
`find_student_active_conflicts` is the *only* function that reads models
(`CourseVersion`, `Run`, `RunStudent`) as **module-level** names — it has no body import and
relies on `helpers.py:14`. Therefore `roster_ops.py` must carry
`from mathion.models import CourseVersion, Run, RunStudent` at module scope. Do **not**
convert it to a body import — that would be a non-verbatim change and violate the pure-move
guarantee. (This is cycle-safe: `mathion.models` imports no `mathion.api` module.)

**Naming note:** `submission_files.py` honestly names ~4 of its 7 members (the file/path
builders); it is explicitly the *shared run/submission helpers* module, not a scoping
mistake. The other five module names do not collide misleadingly with existing modules
(`enrollment.py` / `run_roster.py` / `assets.py` / `run_assets.py` / `submissions.py`).
`text_utils` and `lookups` (which hosts the otherwise-homeless `INT4_MAX`) skew slightly
from a strict reading of their contents; accepted under the fixed 6-module count.

### Dependency graph

The only helper→helper call across a module boundary is
`authz.require_course_admin_for_run`, which calls `lookups.get_or_404` (its sibling call to
`require_course_admin` is same-module). Its body is kept verbatim, so `get_or_404` must
resolve as a bare name — therefore **`authz.py` adds one new module-level import
`from mathion.api.lookups import get_or_404`.** This is the single new *load-time*
`api`→`api` edge introduced by the split, and it is acyclic: `lookups` imports no `api`
module at load time (its only imports are stdlib/sqlalchemy/fastapi + `mathion.database.Base`),
so loading `authz` never triggers loading `helpers` or `authz` back. Consequences:

- **Extraction order:** `lookups` must be extracted **before** `authz`, so `authz`'s new
  import targets the real `lookups` module (never the transitional `helpers` re-export),
  precluding any transient `helpers ↔ authz` load cycle.
- Recommended order: `text_utils` → `lookups` → `authz` → `roster_ops` → `asset_render` →
  `submission_files` (the last three are mutually independent and may be reordered).

Every *other* cross-module reference is a pre-existing **function-body** (runtime) import,
preserved verbatim, so it adds no load-time edge:
`roster_ops.enroll_user_in_run` → `mathion.api.enrollment._enroll_user` +
`mathion.api.advisory`; `asset_render.sync_script_reference` →
`mathion.api.assets._asset_dir`. These reverse edges are what guarantee no shim loop:
because `roster_ops`/`asset_render` reach `enrollment`/`advisory`/`assets` **only** through
function-body imports, loading the six new modules never load-imports those `api` modules —
so it never re-enters `helpers` — **even though** `enrollment.py:6` and `assets.py:10` do
import `helpers` at module level (they are among the 36 importers, and are repointed in the
final task). Aside from the one `authz`→`lookups` module-level edge, no new module imports
another `api` module at load time.

## Migration approach — strangler with transitional re-export

Chosen for always-green, per-task reviewability over a single big-bang diff.

### Extraction tasks (one per module, in dependency order)

For each target module M:
1. Create `backend/mathion/api/M.py` and **move** its functions/constants there verbatim,
   carrying every module-level import each moved function references in `helpers.py` (the
   table's *Module-level names* column highlights the notable ones; `Session`/`select`/
   `HTTPException` travel with any function that uses them). Body imports travel inside their
   functions unchanged. Drop the `helpers.py:NNN` line-reference inside a *moved docstring*
   (affects `render_with_run_assets` and `sync_run_asset_references`, whose docstrings
   cross-reference functions that now live in the same `asset_render.py`).
2. In `helpers.py`, replace the moved definitions with a **re-export**:
   `from mathion.api.M import <every public name that moved>`. This keeps `helpers.py`'s
   public surface byte-identical, so all 36 importers keep working untouched.
3. Run the full suite → **green**. Commit.

The re-export must list **every** public name that moved (functions **and** the two
constants). `_NON_SLUG` is private and imported by no one, so it moves silently with
`slugify` and is not re-exported.

After the six extraction tasks, `helpers.py` is a pure re-export shim and every real
definition lives in its focused module.

### Final task — repoint importers and delete `helpers.py`

1. Repoint every importer from `mathion.api.helpers` to the specific new module(s). The
   **only** import style present in the codebase is `from mathion.api.helpers import <names>`
   (grep-confirmed: there are zero `from mathion.api import helpers` / `helpers.X`
   module-object uses). The two real subtleties:
   - **Preserve each import's LOCATION.** 7 sites import inside a function body, not at
     module top: `version_clone.py:107`, `content.py:109` (its *only* helpers reference),
     `test_version_clone.py:137`, `test_run_assets.py:351`, `test_run_assets.py:398`,
     `test_run_roster.py:285`, `test_run_roster.py:295`. A top-of-file-only sweep misses
     them. Body imports stay in the body; module-level stay module-level.
   - **Split multi-name lines across target modules.** A parenthesized import such as
     `from mathion.api.helpers import (get_or_404, slugify, require_course_admin, INT4_MAX)`
     becomes **three** per-module lines
     (`from mathion.api.lookups import get_or_404, INT4_MAX`,
     `from mathion.api.text_utils import slugify`,
     `from mathion.api.authz import require_course_admin`). The marquee error-prone cases are
     `mini_projects.py` (9 names spanning 5 of the 6 modules) and `items.py` / `runs.py`
     (8 names / 4 modules).
   - **Constant routing:** `INT4_MAX` → `lookups` (consumers: `blocks`, `items`,
     `questions`); `STUDENT_ALREADY_ACTIVE_ERROR_CODE` → `roster_ops` (consumers:
     `run_roster`, `tests/test_active_constraint_helpers`). `tests/test_bounded_type_inputs.py`
     defines its *own* local `INT4_MAX` and is not an importer — leave it.
2. Delete `backend/mathion/api/helpers.py`.
3. Grep-confirm **zero** residual references to `api.helpers` / `import helpers` across the
   whole `backend/` tree (not just `mathion/` + `tests/`).
4. Run the full suite → **green**. Additionally, import-check the one importer the suite does
   **not** cover (see Testing): `backend/.venv/bin/python -c "import scripts.seed_teaching_dashboards_smoke"`
   (run from `backend/`) must succeed.

This task may be split for reviewability (e.g. production+script importers, then test
importers) — but if split, **only the final sub-task deletes `helpers.py`, runs the grep,
and the script import-check**; earlier sub-tasks end with `helpers.py` still a re-export shim
and the suite green (deleting it while any importer still points at it would red the suite).

## Testing strategy

This is a behavior-preserving move, so the safety net is the **existing** suite (currently
1160 passed / 1 skipped), not new tests.

- Each extraction task gates on **full suite green** — the re-export keeps every import
  resolving, so green proves the move preserved the public surface and behavior. Because
  `helpers.py` has no `from __future__ import annotations`, every annotation is evaluated at
  module load and `tests/conftest.py` imports the full app graph, so any missing module-level
  import surfaces as a collection-time ImportError, not a silent break.
- **Coverage gap — the one file the suite does not protect:** `pyproject.toml` sets
  `testpaths = ["tests"]`, so `scripts/seed_teaching_dashboards_smoke.py` is never imported by
  pytest. A missed/incorrect repoint there passes the suite. Its safety net is therefore the
  step-3 backend-wide grep **plus** the explicit `python -c "import ..."` import-check in the
  final task. (This script is live: `run-dashboards-smoke.sh` runs it via
  `python -m scripts.seed_teaching_dashboards_smoke`.)
- **No additional tooling is warranted** (YAGNI): the project has no ruff/flake8 config and
  no CI lint step, so an import-linter, F401 dead-import gate, or `import mathion.main` smoke
  would be new tooling, not a minimal guard — and the green suite already is an app-import
  smoke. The only thing a green suite cannot see is a *harmless* leftover unused import
  (cosmetic, not breakage).
- Existing unit tests that already target these helpers directly — `tests/test_slugify.py`,
  `tests/test_active_constraint_helpers.py` — are repointed in the final task and continue to
  serve as unit coverage. The functions with no direct unit coverage —
  `build_submission_filename` / `build_feedback_filename` (sole consumers of the module-level
  `sanitize_filename` import) and `bump_content_updated_at` — are each exercised end-to-end:
  the filename builders on the submission/feedback upload paths that `test_submissions.py` /
  `test_evaluations.py` drive with real PDFs, and `bump_content_updated_at` via its 6
  content-write call sites (its only module-level deps `datetime`/`timezone` are the same
  import line the directly-tested `to_utc_aware` uses). A dropped import reds the suite.
- Every task runs the suite via `backend/.venv` (never bare).

## Risks & mitigations

- **Circular imports during migration** → mitigated by the extraction-order constraint
  (`lookups` before `authz`) and by preserving every existing function-body import verbatim.
  The one new load-time edge (`authz`→`lookups`) is acyclic by construction.
- **A missed re-export name** breaks importers mid-migration → the full-suite gate on each
  extraction task catches it (import errors fail collection).
- **A missed importer in the final repoint** → the grep-for-zero-`api.helpers` gate catches
  it for the whole `backend/` tree; the seed script additionally gets an explicit
  import-check because the suite does not cover it.
- **Import LOCATION, not style, is the real variety** → only `from mathion.api.helpers import
  <names>` exists (no module-object style), but 7 sites are function-body imports; the final
  task enumerates them so the repoint is exhaustive by design, not just by the grep backstop.

## Importer inventory (36 files)

**Production `api/` modules (21):** `assets, blocks, content, courses, dashboard, enrollment,
evaluations, groups, items, mini_projects, questions, quiz, run_assets, run_roster,
run_teachers, runs, student_mini_projects, student, submissions, version_clone, versions`
(under `backend/mathion/api/`). Note `content.py` and `version_clone.py` import helpers
inside a function body.

**Scripts (1):** `backend/scripts/seed_teaching_dashboards_smoke.py` (imports
`submission_storage_dir`, `build_submission_filename`, `build_feedback_filename` →
`submission_files`). **Not collected by pytest** — see Testing.

**Tests (14):** `test_active_constraint_helpers, test_concurrency_batch,
test_concurrency_capacity, test_concurrency_enrollment, test_concurrency_foundations,
test_concurrency_mini_project, test_concurrency_submission, test_notifications_triggers,
test_run_assets, test_run_permissions, test_run_roster, test_slugify, test_teaching,
test_version_clone` (under `backend/tests/`). Function-body import sites:
`test_version_clone.py:137`, `test_run_assets.py:351`/`:398`, `test_run_roster.py:285`/`:295`.

## Success criteria

- `helpers.py` no longer exists; the six modules exist with the exact function/constant
  assignment above.
- Zero references to `mathion.api.helpers` remain anywhere in `backend/` (grep-verified).
- No function's behavior, signature, or message changed (pure move).
- Full suite green (1160 passed / 1 skipped, modulo unrelated drift), verified after every
  task and on the merged result; the seed script import-checks clean.
- No Alembic migration; no non-import changes to any file outside the six modules. Within the
  six new modules, the only non-verbatim edit is the two dropped docstring line-numbers (the
  Non-Goals carve-out).
