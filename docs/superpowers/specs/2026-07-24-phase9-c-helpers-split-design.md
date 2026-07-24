# Phase 9-C — `helpers.py` God-Module Split (Design)

**Status:** Draft for review
**Date:** 2026-07-24
**Scope:** Backend-only, pure refactor. No behavior change.

## Goal

`backend/mathion/api/helpers.py` has grown into a 686-line god-module holding 28 functions
across at least six unrelated responsibilities, imported by 35 files (21 production + 14
test). Split it into six focused, feature-named modules that match the codebase's existing
per-feature module convention, and **delete `helpers.py`** entirely. This is a
behavior-preserving reorganization: every function keeps its exact signature, body, and
semantics; only its home module and the import sites change.

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
  or message is altered. (The one deliberate exception is *none* — this is a pure move.)
- **No opportunistic fixes.** Any latent issue noticed during the move is left as-is (or
  filed separately); this slice does not change what the code does.
- **No new behavior tests.** The existing suite is the regression net (see Testing).
- **No further decomposition** of the six target modules, and no touching of any other
  file except its `import` lines.
- **No function renames.** Names are preserved so importers change only the *source
  module*, not the imported symbol.
- **No permanent compatibility shim.** The transitional re-export in `helpers.py` (see
  Migration) is removed in the final task; `helpers.py` does not survive.

## Architecture — the six modules

All modules live under `backend/mathion/api/`. Each carries only the imports its functions
need, and preserves the existing pattern of **function-body imports** for models and sibling
`api` modules (that pattern is what keeps the import graph acyclic — it is retained
verbatim, not "cleaned up").

| Module | Functions (verbatim from `helpers.py`) | Module-level names | Responsibility |
|---|---|---|---|
| `text_utils.py` | `slugify`, `bump_content_updated_at`, `to_utc_aware` | `_NON_SLUG` (private regex) | pure string / datetime helpers; no DB session |
| `lookups.py` | `get_or_404`, `get_or_create_user`, `get_newest_published_version` | `INT4_MAX` | generic fetch / fetch-or-create + the int4 order-column bound |
| `authz.py` | `require_course_admin`, `require_course_admin_for_run`, `require_run_admin_or_teacher`, `is_run_admin_or_teacher`, `has_run_teacher_on_course`, `has_run_pinned_to_version` | — | authorization gates (raising) + read-only UI predicates |
| `roster_ops.py` | `enroll_user_in_run`, `remove_run_student`, `find_student_active_conflicts`, `make_already_active_409_body` | `STUDENT_ALREADY_ACTIVE_ERROR_CODE` | shared enrollment/roster mutations + active-conflict logic |
| `asset_render.py` | `render_with_assets`, `sync_asset_references`, `sync_script_reference`, `render_with_run_assets`, `sync_run_asset_references` | — | markdown asset-reference render/sync (course + run assets) |
| `submission_files.py` | `build_submission_filename`, `build_feedback_filename`, `submission_storage_dir`, `run_asset_storage_dir`, `mini_project_visible_to_student`, `get_submitter_group`, `has_submissions` | — | submission/run file paths + submission-domain reads/visibility |

Total: 28 functions + 2 public constants (`INT4_MAX`, `STUDENT_ALREADY_ACTIVE_ERROR_CODE`)
+ 1 private (`_NON_SLUG`).

### Dependency graph

The only helper→helper call across module boundaries is
`authz.require_course_admin_for_run`, which calls `lookups.get_or_404` (and same-module
`require_course_admin`). Therefore:

- **`authz` depends on `lookups`.** Every other module is independent of the others.
- **Extraction order constraint:** `lookups` must be extracted **before** `authz`, so that
  when `authz.require_course_admin_for_run` needs `get_or_404`, it imports it from the real
  `lookups` module (never from `helpers`), avoiding any transient `helpers ↔ authz` cycle.
- Recommended order: `text_utils` → `lookups` → `authz` → `roster_ops` → `asset_render` →
  `submission_files` (the last three are mutually independent and may be reordered).

No module imports another `api` module at load time except through the pre-existing
function-body imports (e.g. `roster_ops.enroll_user_in_run` imports
`mathion.api.enrollment._enroll_user` and `mathion.api.advisory` inside the function body;
`asset_render.sync_script_reference` imports `mathion.api.assets._asset_dir` inside the
body). These are preserved exactly, so no new import cycle is possible.

## Migration approach — strangler with transitional re-export

Chosen for always-green, per-task reviewability over a single big-bang diff.

### Extraction tasks (one per module, in dependency order)

For each target module M:
1. Create `backend/mathion/api/M.py` and **move** its functions/constants there verbatim,
   with exactly the imports they use.
2. In `helpers.py`, replace the moved definitions with a **re-export**:
   `from mathion.api.M import <every public name that moved>`. This keeps `helpers.py`'s
   public surface byte-identical, so all 35 importers — whether they do
   `from mathion.api.helpers import X` or `from mathion.api import helpers` then
   `helpers.X` — keep working untouched.
3. Run the full suite → **green**. Commit.

The re-export must list **every** public name that moved (functions **and** the two
constants). `_NON_SLUG` is private and imported by no one, so it moves silently with
`slugify` and is not re-exported.

After the six extraction tasks, `helpers.py` is a pure re-export shim and every real
definition lives in its focused module.

### Final task — repoint importers and delete `helpers.py`

1. Repoint all 35 importers from `mathion.api.helpers` to the specific new modules. Handle
   both import styles: rewrite `from mathion.api.helpers import A, B` into per-module
   `from mathion.api.<mod> import ...` lines, and rewrite `from mathion.api import helpers`
   / `helpers.X` usages to import and call the specific modules.
2. Delete `backend/mathion/api/helpers.py`.
3. Grep-confirm **zero** residual references to `api.helpers` / `import helpers` across
   `backend/`.
4. Run the full suite → **green**.

This task may be split (e.g. production importers vs test importers) at plan time if the
single diff is too large to review comfortably; the ordering (repoint → delete → grep →
green) is unchanged.

## Testing strategy

This is a behavior-preserving move, so the safety net is the **existing** suite (currently
1160 passed / 1 skipped), not new tests.

- Each extraction task gates on **full suite green** — because the re-export keeps every
  import resolving, a green suite proves the move preserved the public surface and behavior.
- The final task gates on **full suite green + a grep proving zero `api.helpers`
  references + `helpers.py` deleted**.
- No new behavior tests are written (there is no new behavior). Existing unit tests that
  already target these helpers directly — `tests/test_slugify.py`,
  `tests/test_active_constraint_helpers.py` — are repointed to the new modules in the final
  task and continue to serve as unit coverage.
- Every task runs the suite via `backend/.venv` (never bare).

## Risks & mitigations

- **Circular imports during migration** → mitigated by the extraction-order constraint
  (`lookups` before `authz`) and by preserving every existing function-body import verbatim.
- **A missed re-export name** would break importers mid-migration → the full-suite gate on
  each extraction task catches it immediately (import errors fail collection).
- **A missed importer in the final repoint** → the grep-for-zero-`api.helpers` gate plus
  the suite (which fails on an unresolved `helpers` import after deletion) catches it.
- **Import-style variety** (`from ... import X` vs `from mathion.api import helpers`) →
  the final task explicitly handles both.

## Importer inventory (35 files)

**Production (21):** `assets, blocks, content, courses, dashboard, enrollment, evaluations,
groups, items, mini_projects, questions, quiz, run_assets, run_roster, run_teachers, runs,
student_mini_projects, student, submissions, version_clone, versions` (all under
`backend/mathion/api/`).

**Tests (14):** `test_active_constraint_helpers, test_concurrency_batch,
test_concurrency_capacity, test_concurrency_enrollment, test_concurrency_foundations,
test_concurrency_mini_project, test_concurrency_submission, test_notifications_triggers,
test_run_assets, test_run_permissions, test_run_roster, test_slugify, test_teaching,
test_version_clone` (all under `backend/tests/`).

## Success criteria

- `helpers.py` no longer exists; the six modules exist with the exact function/constant
  assignment above.
- Zero references to `mathion.api.helpers` remain anywhere in `backend/`.
- No function's behavior, signature, or message changed (pure move).
- Full suite green (1160 passed / 1 skipped, modulo unrelated drift), verified after every
  task and on the merged result.
- No Alembic migration; no non-import changes to any file outside the six modules.
