# Phase 7c — Teacher Progress Dashboard

**Date:** 2026-05-01
**Status:** Approved for implementation planning
**Phase:** 7c (builds on 7a/7b)
**Parent specs:**
- `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` (sections 6, 7 — runs, mini-projects, dashboard)
- `docs/superpowers/specs/2026-04-25-phase7a-runs-teachers-groups-design.md` (runs, groups, roster)
- `docs/superpowers/specs/2026-04-27-phase7b-mini-projects-design.md` (mini-projects, submissions, evaluations)

## Goal

Add the teacher progress dashboard: two backend endpoints that let an admin or run teacher see, for one run at a time, (a) every student's coverage and quiz performance broken down by sequence, and (b) every mini-project's per-group submission/evaluation state. Plus a one-time redefinition of how quiz scoring is computed so the new dashboard percentages reflect option-level partial credit instead of the existing whole-question all-or-nothing rule.

Phase 7c ships standalone backend functionality. No frontend, no scheduled notifications, no CSV export endpoints (CSV is a frontend concern; see Non-Goals).

## Non-Goals

- **CSV export endpoints.** Each dashboard table is exported to CSV by the frontend at render time. Backend ships JSON only. Justification: locale-dependent delimiter (`,` vs `;`), decimal separator (`.` vs `,`), encoding/BOM, header language, and filename are all frontend concerns; the backend should not own them. If Phase 9's "teacher summary" email ever needs server-side CSV, it can build one from the same query.
- **Bulk roster operations** (bulk delete, bulk move, CSV-file upload). Deferred to Phase 7d. Phase 7a's `POST /api/runs/{id}/students/batch` already covers structured-row paste.
- **Frontend.** No UI in this phase.
- **Server-side pagination, caching, or ETag.** A typical run is bounded (≤40 groups × ≤10 students × ~20 sequences = a few thousand cells max, ~120KB raw JSON / ~25KB gzipped). On-demand SQL aggregation is fast enough; gzip middleware handles wire size; frontend handles display chunking.
- **Cross-run aggregation** (e.g., "compare 2024 cohort to 2025"). Each dashboard call is scoped to one run.
- **Free-pace student progress view for admins.** Master spec mentions admins monitor free-pace students; that's a separate admin-area feature, not part of the run-scoped teacher dashboard.
- **Scheduled "teacher summary" emails** (master spec §7) — deferred to Phase 9 (needs scheduler).

## Architecture

```
mathion/api/
  ├── dashboard.py          NEW. Two endpoints — progress + mini-projects.
  ├── runs.py               (existing — no changes)
  ├── mini_projects.py      (existing — no changes)
  └── helpers.py            (existing — reuse get_or_404, require_run_admin_or_teacher)

mathion/
  └── quiz.py               MODIFIED. evaluate_question returns (correct_picks, total_correct)
                            instead of bool — option-level scoring.

mathion/api/
  └── quiz.py               MODIFIED. Submit handler uses new scorer signature; semantics
                            of last_score_correct and last_score_total change to option-level.

mathion/schemas.py          NEW Pydantic response models.

mathion/main.py             Register the new router. Add GZipMiddleware if absent.

alembic/versions/
  └── <ts>_phase7c_recompute_quiz_scores.py   Data-only migration. No schema change.
```

No new ORM models, no new tables, no new columns. The migration recomputes existing `last_score_correct` / `last_score_total` columns under the new definition; it does not alter the schema.

## Decisions Already Fixed by Master Spec

These come from `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` §6 (lines 481–493) and are not open for re-litigation here.

| Decision | Source |
|---|---|
| Teacher dashboard is part of run management view | line 481 |
| Dashboard sections: completion overview, quiz summary, mini-project status | lines 484–486 |
| Mini-project status: per-block summary — groups submitted, evaluated, pending | line 486 |
| Auth: teachers exist only on runs (RunTeacher); admin operates at course level | section 5.3 |
| Run sizes bounded: 1–10 students per group, runs typically ≤40 groups → ≤200 students | line 438 + project context |

## Phase 7c Extensions to the Master Spec

These decisions go beyond the master spec but are consistent with it.

| Extension | Why |
|---|---|
| **Two endpoints, not three.** `/dashboard/progress` returns coverage *and* quiz tables in one payload. `/dashboard/mini-projects` is its own endpoint. | The two student×sequence tables share row/column structure and are aggregated from the same `UserItemState ⨝ Item ⨝ Sequence` join — splitting them would duplicate setup. The mini-project section has a different shape (MPs × groups) and is genuinely separate. |
| **Column unit is sequence, not block.** Master spec says "columns for each block's progress"; we use sequences instead. | Sequences are the natural progress unit (typically 3–4 per block). A block-level cell is too coarse: a teacher needs to see "Anna stalled at Block 1 / Sequence 2 (Estimation)," not just "Anna's at 60% on Block 1." Block grouping is preserved as visual column-group headers in the response (`block_id`, `block_order`, `block_title` per sequence). |
| **Per-student rows, not per-group.** Master spec ambiguous ("each student/group"). We choose per-student. | `UserItemState` is per-user; aggregating to group rows server-side throws away the most actionable data ("who specifically is falling behind"). Group rollup is trivial in the frontend (`group_by(group_id)`). `group_id`/`group_name` are included on every student row to make this cheap. |
| **No CSV endpoints.** Backend ships JSON; frontend produces CSVs at render time. | See Non-Goals. |
| **Quiz cells contain `{correct: int, total: int}`, frontend formats.** | Server doesn't decide decimal places, percent symbol, or "—" rendering. |
| **Quiz cells use option-level partial credit with strict subtraction.** Phase 5's existing whole-question all-or-nothing rule is replaced by `max(0, correct_picks − incorrect_picks)` over the correct options of each multi-choice question. Single-choice / numeric / text remain effectively unchanged (1 correct "answer" each). | Whole-question scoring punishes a student who knows 80% of a multi-choice with a 0%. Option-level partial credit closes that gap. The strict-subtraction rule prevents the "select all options" exploit. The existing `last_score_correct` and `last_score_total` columns are reused under the new semantics — no schema change, just a one-time recompute migration. |
| **No `?sort=` parameter for v1.** Stable backend orders: sequences by `(block.order, sequence.order)`; students by `RunStudent.created_at`; mini-projects by `block.order`; groups within MP by `Group.id`. | Frontend handles user-driven sort/filter. Stable backend order keeps the response cacheable client-side. |
| **No backend-computed `is_overdue` / `is_late_for_dashboard`.** Submission `is_late` (Phase 7b) is reused; "overdue" is derived in the frontend from current time + `hard_deadline` + status. | Avoids server-time vs client-time coupling and gives the frontend control of "stale by N hours" thresholds. |

## Quiz Scoring Redefinition (Phase 5 Patch)

This is the prerequisite that lands before either dashboard endpoint. It is a behavior change to a Phase 5 feature, but contained: the public surface affected is `POST /api/items/{item_id}/submit`'s response numbers and the corresponding `UserItemState.last_score_*` columns.

### New `evaluate_question` signature

```python
def evaluate_question(...) -> tuple[int, int]:
    """Returns (correct_picks_after_subtraction, total_correct_options)."""
```

Per-type rules:

| Question type | `total_correct` | `correct_picks` rule |
|---|---|---|
| `single_choice` | 1 | 1 if student picked the correct option, else 0 |
| `multiple_choice` | `N` = count of `is_correct=True` options | `max(0, picks_in_correct_set − picks_in_incorrect_set)` |
| `numeric_answer` | 1 | 1 if student value within precision tolerance, else 0 |
| `text_answer` | 1 | 1 if normalized text matches, else 0 |

For `single_choice` / `numeric_answer` / `text_answer` this is the existing bool rule lifted to `(0|1, 1)` — no behavior change. Only `multiple_choice` actually changes. A question with zero correct options (data error) returns `(0, 0)` and contributes nothing — logged at WARNING.

### Caller change in `mathion/api/quiz.py:submit_quiz`

```python
score_correct = 0
score_total = 0
for q in questions:
    picks, total = evaluate_question(...)
    score_correct += picks
    score_total += total
last_score_correct = score_correct
last_score_total = score_total
```

`QuizSubmitResponse.score_correct` and `score_total` keep their field names; their *meaning* now sums correct option-picks and correct options per quiz item.

### Migration: recompute existing rows

`alembic/versions/<ts>_phase7c_recompute_quiz_scores.py` — pure-Python data migration:

1. Iterate `UserItemState` rows where `last_answers IS NOT NULL`, in batches of 500.
2. For each, look up the quiz item's questions and (for choice types) `AnswerOption.is_correct`.
3. Replay each `q_id → answer` through the new `evaluate_question`. Sum `last_score_correct` and `last_score_total` over all questions.
4. `UPDATE` the row.
5. Skip + WARN-log rows where the referenced item is no longer a `quiz`, the question list has changed, or `last_answers` references unknown question IDs.
6. INFO-log a "recomputed N rows, skipped M rows" summary at the end.

Down-migration applies the *old* whole-question rule via a small private helper retained for that purpose.

## Endpoint: GET /api/runs/{run_id}/dashboard/progress

### Contract

```
Auth: admin of the course OR teacher of the run
        (require_run_admin_or_teacher)
Path:  run_id (int)
Query: none
Response: 200 OK, application/json
Errors: 404 Run not found · 403 Not admin/teacher of this run
```

### Response shape

```json
{
  "run": {
    "id": 17,
    "title": "Spring 2026 — Group A",
    "groups_enabled": true,
    "version_is_disabled": false
  },
  "sequences": [
    {
      "block_id": 4,
      "block_order": 1,
      "block_title": "Linear regression",
      "sequence_id": 12,
      "sequence_order": 1,
      "sequence_title": "Estimation",
      "total_items": 5,
      "has_quiz_items": true
    }
  ],
  "students": [
    {
      "user_id": 88,
      "email": "alice@example.com",
      "full_name": "Alice Smith",
      "user_is_disabled": false,
      "group_id": 9,
      "group_name": "Group A",
      "group_is_disabled": false,
      "coverage": [
        { "sequence_id": 12, "covered": 4, "total": 5 }
      ],
      "quizzes": [
        { "sequence_id": 12, "correct": 6, "total": 8 }
      ]
    }
  ]
}
```

### Cell conventions

- `coverage`: always `{covered: int ≥ 0, total: int ≥ 0}`. If a sequence has zero items, both are `0` (frontend renders "—").
- `quizzes`: `{correct: int, total: int}` if the sequence has at least one quiz item, otherwise `{correct: null, total: null}`. Null distinguishes "no quiz here" from "haven't tried yet" (`{correct: 0, total: 8}`).
- One entry per sequence in both arrays, aligned by `sequence_id` and in the same order as the top-level `sequences` list.

### Sort orders

- Sequences: `(block.order, sequence.order)`.
- Students: `RunStudent.created_at` (matches `GET /api/runs/{id}/students` from Phase 7a).

### Computation strategy (no N+1)

Three queries, joined in Python:

1. **Sequences metadata.** SQL: sequences + block joined for the run's pinned version, with `COUNT(items)` and `BOOL_OR(item.type = 'quiz')` per sequence. Yields the `sequences` array directly.
2. **Quiz max-score per sequence.** Per-question max is `1` for `numeric_answer`/`text_answer`/`single_choice` and `count(correct AnswerOptions)` for `multiple_choice`. CTE rolls up to per-sequence quiz max for the denominator. Pure SQL — no per-quiz-item Python loop.
3. **Per-(user, sequence) aggregates.** SQL: `RunStudent CROSS JOIN sequences LEFT JOIN UserItemState ⨝ Item` grouped by `(user_id, sequence_id)`, producing `covered = SUM(CASE WHEN is_covered THEN 1 ELSE 0 END)` and `quiz_correct = SUM(COALESCE(last_score_correct, 0) WHERE i.type = 'quiz')`. Joins `User`, `Group` for the per-row fields.

Python step: align per-student `coverage` and `quizzes` arrays to the `sequences` order.

### Edge cases

| Scenario | Behavior |
|---|---|
| Run with `groups_enabled=false` | Students appear with `group_id: null`, `group_name: null`. |
| Disabled `Group` | Group appears with `group_is_disabled: true`. Members appear normally. |
| Disabled `User` | Student appears with `user_is_disabled: true`. Their existing `UserItemState` data is shown. |
| Disabled `CourseVersion` | 200 OK — admins/teachers can read historical data on disabled-version runs (Phase 7b cleanup). `version_is_disabled: true` flagged for frontend banner. |
| Run with zero students | `students: []`. Sequences populated. |
| Sequence with zero items | Appears in `sequences` with `total_items: 0`, `has_quiz_items: false`. Each student's cell is `{covered: 0, total: 0}` and `{correct: null, total: null}`. |
| Student in group, group later disabled | Snapshot reflects current state — group flagged disabled, member still visible. |
| Run unpublished | 200 OK — admin/teacher preview. Coverage/quiz cells reflect whatever progress students have managed (typically zero, since unpublished runs aren't student-visible). |

## Endpoint: GET /api/runs/{run_id}/dashboard/mini-projects

### Contract

```
Auth: admin of the course OR teacher of the run
Path:  run_id (int)
Query: none
Response: 200 OK, application/json
Errors: 404 Run not found · 403 Not admin/teacher of this run
```

### Response shape

```json
{
  "run": {
    "id": 17,
    "title": "Spring 2026 — Group A",
    "groups_enabled": true
  },
  "mini_projects": [
    {
      "id": 31,
      "block_id": 4,
      "block_order": 1,
      "block_title": "Linear regression",
      "is_published": true,
      "first_submitted_at": "2026-04-12T08:00:00Z",
      "soft_deadline": "2026-05-15T23:59:59Z",
      "hard_deadline": "2026-05-22T23:59:59Z",
      "resubmission_deadline": "2026-05-29T23:59:59Z",

      "counts": {
        "total_groups": 8,
        "not_submitted": 2,
        "awaiting_eval": 3,
        "needs_revision": 1,
        "accepted": 1,
        "rejected": 1
      },

      "groups": [
        {
          "group_id": 9,
          "group_name": "Group A",
          "group_is_disabled": false,
          "status": "accepted",
          "latest_submission": {
            "id": 412,
            "submission_number": 1,
            "submitted_at": "2026-04-12T08:00:00Z",
            "submitted_by": { "user_id": 88, "full_name": "Alice Smith" },
            "is_late": false,
            "is_resubmission": false,
            "file_size": 184320
          },
          "latest_evaluation": {
            "id": 95,
            "evaluated_at": "2026-04-14T17:30:00Z",
            "evaluated_by": { "user_id": 12, "full_name": "Prof. Ivanov" },
            "result": "accepted",
            "score": 88,
            "feedback_text": "Solid work.",
            "has_feedback_file": false
          }
        }
      ]
    }
  ]
}
```

### Status enum

| `status` | Condition |
|---|---|
| `not_submitted` | Group has no submission rows. |
| `awaiting_eval` | Latest submission has no evaluation. |
| `needs_revision` | Latest evaluation `result ∈ {major_revision, minor_revision}`. |
| `accepted` | Latest evaluation `result = accepted` (manually or auto-accepted). |
| `rejected` | Latest evaluation `result = rejected`. |

**Auto-accept detection** (frontend-derived): `latest_submission.is_resubmission == True AND latest_evaluation.result == "accepted"`. Per spec, every resubmission after `major_revision`/`minor_revision` is auto-accepted (no manual override path); `rejected` resets the submission counter so the next attempt has `is_resubmission=False`. The auto-accept Evaluation row reuses the *prior* evaluator's `user_id` (`evaluated_by=prev_evaluator`, set in `submissions.py:185-188`) and has `feedback_text=null`, `feedback_file=null`.

The dashboard backend deliberately does NOT compute `is_overdue` — frontend has deadlines and clock and derives it.

### Sort orders

- Mini-projects: by `block.order`.
- Groups within an MP: by `Group.id` ascending.

### Computation strategy (no N+1)

Two queries:

1. **Skeleton.** SQL: `MiniProject ⨝ Block ⨝ Run ⨝ Group` for the run, ordered by `block.order` then `group.id`. Yields the cartesian product of MPs × Groups (≤10 × ≤40 = ≤400 rows). Each row gets a placeholder status.
2. **Latest submission + evaluation per (mp, group).** SQL: `ROW_NUMBER() OVER (PARTITION BY mp_id, group_id ORDER BY submission_number DESC)` filtered to `rn=1`, joined left to `Evaluation` and to `User` for `submitted_by`/`evaluated_by` names.

Python: marry the two; derive each MP's `counts` from its `groups[]`.

### Edge cases

| Scenario | Behavior |
|---|---|
| Run with `groups_enabled=false` | `mini_projects: []` (MPs require `groups_enabled` per Phase 7b). |
| MP with `is_published=false` | Included with `is_published: false` flag. All groups `not_submitted` (students can't submit on unpublished MPs). |
| Disabled group | `group_is_disabled: true`. Latest submission/evaluation still visible. |
| Disabled user as `submitted_by` or `evaluated_by` | `full_name` still appears (User row preserved regardless of `is_disabled`). |
| Run unpublished | Endpoint still 200s — admin/teacher preview. |
| Auto-accepted resubmission | `latest_submission.is_resubmission: true`, `latest_evaluation.result: accepted`, `evaluated_by` is the original revision-requester, `feedback_text: null`, `has_feedback_file: false`. Frontend derives "Auto-accepted resubmission." |

## Error Handling

Both endpoints:

| Status | Trigger |
|---|---|
| `200 OK` | Success — including unpublished run, disabled version, zero students, zero MPs |
| `403 Forbidden` | Caller not admin/teacher of this run |
| `404 Not Found` | `run_id` doesn't exist (matches Phase 7a/7b 404-vs-403 pattern) |

No 409s, no 422s — pure read endpoints with no query params.

**Quiz scorer:**
- Malformed `last_answers` → `(0, max_for_question)`. Same defensive behavior as existing scorer.
- Question with zero correct options → `(0, 0)`. WARNING log: `Question {q_id} has no correct options`.

**Migration:**
- Each row is independent; bad rows logged + skipped, rest proceeds.
- Skipped reasons: missing question, item type changed, `last_answers` references deleted q_id.
- Final INFO log: `recomputed N rows, skipped M rows`.

## Testing Strategy

Test files added:

```
tests/
  ├── test_quiz_evaluate_question.py     REWRITTEN: (int, int) tuples, all 4 q types,
  │                                       all multi-choice partial-credit cases.
  ├── test_quiz_submit.py                MODIFIED: new last_score_* semantics.
  ├── test_migration_phase7c.py          NEW: fixture under old rule, upgrade, assert recomputed.
  ├── test_dashboard_progress.py         NEW.
  └── test_dashboard_mini_projects.py    NEW.
```

### `evaluate_question` unit tests

| Case | Type | Setup | Expected `(picks, total)` |
|---|---|---|---|
| Single choice, correct | `single_choice` | 1 correct, picks it | `(1, 1)` |
| Single choice, wrong | `single_choice` | 1 correct, picks wrong | `(0, 1)` |
| Single choice, no answer | `single_choice` | empty list | `(0, 1)` |
| Multi exact match | `multiple_choice` | 2 of 4, picks both | `(2, 2)` |
| Multi one of two | `multiple_choice` | 2 of 4, 1 right + 0 wrong | `(1, 2)` |
| Multi mixed | `multiple_choice` | 2 of 4, 1 right + 1 wrong | `(0, 2)` |
| Multi select all | `multiple_choice` | 2 of 4, picks all 4 | `(0, 2)` (exploit fix) |
| Multi no answer | `multiple_choice` | empty | `(0, 2)` |
| Numeric in tolerance | `numeric_answer` | precision 2, 3.14 vs 3.14 | `(1, 1)` |
| Numeric out of tolerance | `numeric_answer` | precision 2, 3.14 vs 3.20 | `(0, 1)` |
| Text match (case-insensitive) | `text_answer` | "Hello" vs "hello" | `(1, 1)` |
| Text mismatch | `text_answer` | "Hello" vs "world" | `(0, 1)` |
| Question, zero correct options | (data error) | malformed | `(0, 0)` |

### `/dashboard/progress` tests

- 200 — admin of course
- 200 — teacher of run
- 403 — student in run
- 403 — random authenticated user
- 404 — nonexistent run
- Response shape: keys, sequence ordering by `(block.order, sequence.order)`, student ordering by `RunStudent.created_at`
- Coverage cell math: covered some/all/none items; verify counts
- Quiz cell math: sequence with quiz + non-quiz items, student attempted some quizzes; verify `correct/total` reflects strict-subtraction rule
- Quiz cell null: sequence with no quiz items
- Empty sequence: zero items
- `groups_enabled=false`: nulls on `group_id`/`group_name`
- Disabled group: flag visible
- Disabled user: flag visible, data still served
- Disabled version: 200 OK, `version_is_disabled: true`
- Zero students: `students: []`

### `/dashboard/mini-projects` tests

- 200/403/404 access matrix
- Skeleton: 3 MPs × 4 groups → 3 entries × 4 group sub-entries
- Status: `not_submitted` (no submission row)
- Status: `awaiting_eval` (submission, no eval)
- Status: `needs_revision` (latest eval `major_revision`)
- Status: `accepted` manual (`is_resubmission: false`)
- Status: `accepted` auto (`is_resubmission: true`, evaluator = original revision-requester)
- Status: `rejected`
- Counts at MP header match `groups[]` aggregation
- Disabled group: flag visible
- `groups_enabled=false`: `mini_projects: []`
- Unpublished MP: included with `is_published: false`

### Migration test

- Fixture: SQL inserts simulating old whole-question scoring on multiple students × items.
- Run `alembic upgrade head`.
- Assert `last_score_correct` / `last_score_total` match new option-level rule.
- Assert `last_answers IS NULL` rows untouched.
- Assert non-quiz items skipped.

**Test count budget:** ~50 new tests across the four files. Project baseline 444 → expect ~490–500 after Phase 7c.

## What This Phase Does NOT Change

- `attempt_count`, `last_visited_at`, `last_answers`, `is_covered`, `time_spent` — untouched.
- `max_quiz_attempts` semantics — untouched.
- Reveal-after-max-attempts behavior — untouched.
- Quiz item structure (Question, AnswerOption) — untouched.
- Mini-project, Submission, Evaluation schemas — untouched.
- Phase 7a roster and Phase 7b mini-project endpoints — untouched.
- Notifications — untouched (Phase 9).
- Frontend — does not exist yet.

## Implementation Sequencing

1. New `evaluate_question` signature + tests.
2. Update `submit_quiz` caller in `mathion/api/quiz.py`.
3. Migration script + test.
4. Run migration on dev DB.
5. New `dashboard.py` router skeleton + auth gate.
6. `/dashboard/progress` query + tests.
7. `/dashboard/mini-projects` query + tests.
8. Wire router in `main.py`. Add `GZipMiddleware` if absent.
9. Full-suite regression run.

## Phase 7d (deferred from 7c)

Bulk roster operations: bulk delete, bulk move, CSV-file upload (server-side parse delegating to existing batch logic). Independent of the dashboard; can be planned and shipped after 7c without re-litigating any 7c decisions.
