# Notifications (Email) — Design

**Status:** draft rev 15
**Date:** 2026-06-12
**Branch:** `notifications-email`
**Predecessor:** evaluations-write-surface (merged 2026-06-06, `b83ccec`)
**Spec change log:** rev 1 → 15 evolution under §17 at the end of this document. Implementers can skim it for context but should read §1 Scope onward as the load-bearing material. §16 is an operator runbook.

## 1. Scope

Activate the dormant `notification_log` table by shipping a background dispatcher that reads unsent rows, renders plain-text emails, and delivers them via a pluggable `Mailer`. Closes the teaching loop for the four highest-value email events: students learn when a new mini-project is published, when they have a new evaluation, and when they are enrolled in a run; teachers learn when they are assigned to a run.

Out of scope (see §15): in-app notification center, HTML email, user opt-out preferences, multi-worker dispatcher, `new_submission_received` teacher event, PIN-email migration, admin retry UI.

### 1.1 In-scope event kinds (4)

The slice covers four event kinds after the rules in §7 + §8 are in place:

| Kind | Recipient | Trigger site |
| --- | --- | --- |
| `evaluation_received` | each group member of evaluated submission | existing: `evaluations.py:138-149`, `submissions.py:197-214` (auto-accept) |
| `run_enrolled` | the enrolled student | existing: `helpers.py:202-210` (after the trigger-side fix in §7.1) |
| `run_teacher_assigned` | the assigned teacher | existing: `run_teachers.py:47-51` |
| `mini_project_published` | each student on the run roster (excluding disabled groups) | **new** in this slice: `mini_projects.py` publish path (see §7.3) |

`run_published` is **dropped** (see §8): the new publish-gate (§8) makes pre-publish enrollment impossible, so the publish-time bulk-notify loop in `runs.py:220-232` is removed entirely.

## 2. Files touched

**New backend:**
- `backend/mathion/notifications/__init__.py` — public re-exports (`Mailer`, `build_mailer_from_settings`, `tick`, `run_forever`).
- `backend/mathion/notifications/mailer.py` (~120 lines) — `Mailer` ABC + `SMTPMailer` (persistent connection per tick), `FileMailer`, `MemoryMailer` + `build_mailer_from_settings()`.
- `backend/mathion/notifications/dispatcher.py` (~220 lines) — `tick(db, mailer, *, now)` (unit-testable, sync), `_build_render_context(db, row) -> RenderContext` (eager-load helper, see §6.1 code skeleton), `run_forever(app)` async loop wrapping ticks in `asyncio.to_thread`, startup `acquire_singleton_lock(settings)` advisory-lock helper.
- `backend/mathion/notifications/templates.py` (~90 lines) — `RenderContext` dataclass (with `course_slug` `@property`) + `TEMPLATES` dict + `render(kind, ctx)` + `_run_url(ctx)` + `_name(user)` + `_build_email_message(subject, body, ctx, *, kind)`. (No `_safe_header` helper — `EmailMessage` default policy already raises on CR/LF; see §6.2 NOTE.)
- `backend/mathion/notifications/errors.py` (~25 lines) — `classify(exc) -> 'transient' | 'permanent'` (tuple-based dispatch).
- `backend/alembic/versions/<rev>_notification_dispatcher_columns.py` — schema migration (uses `op.batch_alter_table` per repo convention).
- `backend/tests/test_notifications_mailer.py` (~140 lines, ~12 tests).
- `backend/tests/test_notifications_errors.py` (~80 lines, ~16 table cases — includes 4xx-vs-5xx routing for SMTPHeloError/SMTPConnectError).
- `backend/tests/test_notifications_templates.py` (~140 lines, ~14 tests including payload-key + 4 kinds + `course_slug` `@property` derivation + EmailMessage-raises-on-CRLF).
- `backend/tests/test_notifications_dispatcher.py` (~250 lines, ~20 tests including at-least-once recovery, batch atomicity, refetch-doesn't-trust-payload, selective skip, all backoff boundaries, commit-failure handling).
- `backend/tests/test_notifications_migration.py` (~70 lines, ~5 tests including downgrade backfill persistence).
- `backend/tests/test_notifications_lock.py` (~120 lines, ~6 tests — includes non-`BlockingIOError` fd-leak regression).

**Modified backend:**
- `backend/mathion/config.py` — 9 new env-keyed settings (see §10).
- `backend/mathion/main.py` — FastAPI `lifespan` context manager added: constructs `mailer`, acquires advisory lock, starts `dispatcher.run_forever()` unless mode=`disabled`; on shutdown sets event + awaits with timeout.
- `backend/mathion/models_auth.py` — extend `NotificationLogEntry` with 3 new mapped columns (`retry_count`, `next_attempt_at`, `error`).
- `backend/mathion/api/helpers.py` — `enroll_user_in_run` trigger-side fix: move `NotificationLogEntry(kind="run_enrolled")` insert into `else` branch (first-enrollment only). See §7.1.
- `backend/mathion/api/runs.py` — delete the per-student `run_published` insert loop in `publish_run` (current lines `220-232`) AND the now-dead `course_slug = run.version.course.slug` lookup at line `218`. See §7.2.
- `backend/mathion/api/mini_projects.py` — at the MP publish path, insert `NotificationLogEntry(kind="mini_project_published")` rows for every roster member (excluding disabled groups). See §7.3.
- `backend/mathion/api/run_roster.py` — add publish-gate 409 to `add_student` + `add_students_batch`. See §8.
- Test churn (much larger than rev 1 estimate):
  - `backend/tests/conftest.py::seed_run_with_groups` — rewrite to publish-before-add (used by 10 test files: `test_mini_project_notifications.py`, `test_run_render.py`, `test_evaluations.py`, `test_mini_projects.py`, `test_run_assets.py`, `test_run_roster.py`, `test_submissions.py`, `test_runs.py`, `test_groups.py`, plus conftest itself).
  - `backend/tests/test_run_roster.py::_make_run` (line 1-9) — rename to `_make_published_run` and append a publish call; ~17 student-POST sites become publish-then-add. Optional `_make_draft_run` kept for new 409-gate tests.
  - `backend/tests/test_run_roster_bulk.py::_make_run` (line 4-12) and `_add_student` (line 15-19) — same pattern; ~20+ call sites.
  - `backend/tests/test_teaching.py::test_student_count_multiple` — publish before adding students.
  - `backend/tests/test_runs.py::test_publish_with_groups_enabled_unassigned_student_409` (current line ~116-124) — broken by the new gate (its setup posts to `/students` on an unpublished run). **Rewrite (do NOT delete)** along the real admin workflow: create groups-enabled run → add teacher → publish → POST student with `group_id=None` (passes gate: run is published; `add_student` allows `group_id=None`) → `POST /api/runs/<id>/unpublish` (`runs.py:239-248`) → `POST /api/runs/<id>/publish` → assert 409 with the existing `"unassigned > 0"` violation message from `runs.py:192-199`. The path is reachable in production through this unpublish/republish cycle, so deletion would drop real coverage; ORM-bypass insertion is wrong too (it skips the canonical workflow).
  - `backend/tests/test_run_teachers.py::_make_run` — file does NOT POST to `/students`; no rename needed (R3 dropped from audit).
  - Plus targeted updates to `backend/tests/test_run_notifications.py` (remove `run_published` expectations, add `run_enrolled`/`mini_project_published` post-publish), and deletion of `backend/tests/test_runs.py::test_publish_writes_run_published_notification_per_student` (line ~179-189).

**Modified frontend:**
- `frontend/src/pages/runs/RunDetailPage.svelte` — **add `export` keyword** to the existing `type ActiveTab = '…' | '…' | …;` declaration at line 30 so the union becomes `export type ActiveTab = …` (follows the precedent set by `DashboardSidePanel.svelte:36`'s `export type PanelTarget`, imported as a type by `tests/DashboardSidePanel.svelte.test.ts:5`). Then pass `runIsPublished={run.is_published}`, `courseSlug={courseSlug}`, and `onNavigateToTab={(t) => activeTab = t}` to `RunRosterTab` (matching the runtime callback shape at `RunMiniProjectsTab.svelte:209`; note `RunMiniProjectsTab.svelte:35` types its own local prop with a narrower 5-element inline union — the type pattern is new to RunRosterTab in this slice, not copied from MP tab. A follow-up cleanup slice may migrate `RunMiniProjectsTab.svelte` to the same `ActiveTab` import for consistency, out of scope here).
- `frontend/src/components/runs/RunRosterTab.svelte` — accept new props `runIsPublished: boolean`, `courseSlug: string`, `onNavigateToTab: (tab: ActiveTab) => void` (importing the `ActiveTab` type from `RunDetailPage.svelte` via `import type { ActiveTab } from '../../pages/runs/RunDetailPage.svelte';`); render top-of-tab `.banner` element (no `.banner-info` variant — see §9 rationale for visual consistency with the MP tab) with `id="roster-draft-publish-hint"` (prefix avoids future `id=` collision if both tabs ever render concurrently) and scoped CSS copied from `RunMiniProjectsTab.svelte:340-346`; mark Add + Import buttons + empty-state Import CTA `disabled={!runIsPublished}` with `aria-describedby="roster-draft-publish-hint"`; guard `submitAdd` early-return on `!runIsPublished`; reuse the existing `addError` state to also receive run-state 409 message (no new `inlineError` state); handle 409 with `e.errorCode === RUN_UNPUBLISHED_ERROR_CODE`.
- `frontend/src/components/runs/RosterImportModal.svelte` — handle 409 from `batchAddRunStudents` in the submit path with a NEW `submitError: string | null` state (do NOT overwrite `parsed.error`, which is the channel for client-side preview parse errors at line 168). On submit-step `ApiError`, set `submitError = e.displayMessage` (or `e.detail` for the 409 with `errorCode === RUN_UNPUBLISHED_ERROR_CODE`); render `submitError` in a NEW `<p class="error" role="alert">…</p>` placed above the `.modal-actions` row. `parsed.error` remains rendered in its existing slot with NO `role` attribute (else every parse error during typing would fire a screen-reader alert — UX regression). Clear `submitError` on the next `onTextInput` or on submit retry.
- `frontend/src/lib/runRoster.ts` — add a new top-level constant `export const RUN_UNPUBLISHED_ERROR_CODE = 'run_unpublished'` for the whole-call 409 sentinel. **Do NOT** widen `BulkRosterErrorCode` (which is the per-row error union returned in the 207 batch result `results[i].error_code` field); `run_unpublished` is a whole-call error semantically distinct from per-row errors and lives in its own constant. `ApiError.errorCode` (already surfaced via `api.ts:46`'s `body.error_code`) is the read site.
- `frontend/src/tests/RunRosterTab.draft-gate.svelte.test.ts` (new, ~6 tests) — banner visible, buttons disabled, 409 inline error, empty-state CTA disabled, regression that move/delete remain enabled, `RUN_UNPUBLISHED_ERROR_CODE` literal matches `"run_unpublished"`.
- `frontend/src/tests/RosterImportModal.unpublished.svelte.test.ts` (new, ~1 test) — submit-step 409 surfaced via the new `submitError` state slot with `role="alert"`; preview-error `parsed.error` slot remains alert-free.

## 3. Database migration

Single Alembic revision adds 3 nullable columns + 1 backfill `UPDATE`. Uses `op.batch_alter_table` for SQLite safety. (NOTE: existing migrations in `backend/alembic/versions/` are mixed — some use `batch_alter_table`, others use bare `op.add_column` / `op.drop_column` — verified at `9959211d…:24,152`. This slice's migration adopts the batch pattern because the `add_column` operations are nullable-with-server-default and the downgrade needs `drop_column` on SQLite, which `batch_alter_table` makes safe.)

```python
def upgrade():
    with op.batch_alter_table('notification_log') as batch_op:
        batch_op.add_column(
            sa.Column('retry_count', sa.Integer, nullable=False, server_default='0'))
        batch_op.add_column(
            sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column('error', sa.String(length=500), nullable=True))

    # Backfill: stamp every existing pre-slice row as already-sent so the new
    # dispatcher does not retroactively email old dev/test entries.
    # PRECONDITION: stop the app before running this migration. In-flight
    # unsent rows will be marked as already-sent and never delivered.
    op.execute("UPDATE notification_log SET sent_at = CURRENT_TIMESTAMP "
               "WHERE sent_at IS NULL")

def downgrade():
    with op.batch_alter_table('notification_log') as batch_op:
        batch_op.drop_column('error')
        batch_op.drop_column('next_attempt_at')
        batch_op.drop_column('retry_count')
    # Backfill is intentionally NOT reversed (sent_at stamps persist).
```

`NotificationLogEntry` in `backend/mathion/models_auth.py` is extended with the matching `mapped_column` declarations so SQLAlchemy can read/write the new state.

**Timestamp portability note.** `sent_at` is `DateTime(timezone=True)`. On Postgres, `CURRENT_TIMESTAMP` returns a `timestamptz` value — fully timezone-aware, correct. On SQLite, `CURRENT_TIMESTAMP` returns the text `"YYYY-MM-DD HH:MM:SS"` (naive UTC, no TZ suffix); SQLAlchemy's `DateTime(timezone=True)` adapter accepts it on read. Backfilled rows are filtered out by the dispatcher's `sent_at.is_(None)` clause (§5) so the naive-vs-aware discrepancy is benign for the slice. If a future feature reads `sent_at` from backfilled rows for arithmetic against `datetime.now(timezone.utc)`, add an explicit `replace(tzinfo=timezone.utc)` at the read site.

**Migration idempotency.** Alembic wraps `op.execute` in a single transaction per upgrade; if the UPDATE fails mid-run, the column-add operations also roll back on Postgres. On SQLite, `batch_alter_table` is implemented as a table-copy that may NOT be in the surrounding transaction. If partial failure occurs on SQLite (rare on a stopped app), the recovery is: drop the three added columns manually (`ALTER TABLE notification_log DROP COLUMN error;` etc.) and re-run `alembic upgrade head`. Documented constraint, not a code-level guard.

Final `notification_log` row shape:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | int | PK |
| `user_id` | int FK | recipient |
| `kind` | varchar(40) | event kind |
| `payload` | JSON | trigger-time IDs (see §6.1 contract table) |
| `created_at` | timestamptz | row insert time |
| `sent_at` | timestamptz, null | non-null = delivered (or pre-slice backfill) |
| `retry_count` | int default 0 | incremented per attempt |
| `next_attempt_at` | timestamptz, null | backoff target; null + sent_at null = ready now |
| `error` | varchar(500), null | non-null = permanently failed; no further auto-retry |

(`last_attempt_at` was dropped in rev 2 — no code path reads it; redundant with `next_attempt_at` minus `BACKOFF_SECONDS[idx]`. Re-add when a real debugging need surfaces.)

**State machine:**

| State | sent_at | error | retry_count | next_attempt_at |
| --- | --- | --- | --- | --- |
| Pre-slice backfill | NOW@migration | null | 0 | null |
| Ready (never tried) | null | null | 0 | null |
| Ready (awaiting backoff) | null | null | ≥1 | future |
| Delivered | now | null | n/a | n/a |
| Permanently failed (early) | null | <msg> | ≥1 | null |
| Permanently failed (exhausted) | null | "max attempts: …" | 5 | null |

## 4. Mailer abstraction

`backend/mathion/notifications/mailer.py`:

```python
from abc import ABC, abstractmethod
from contextlib import contextmanager, AbstractContextManager
from email.message import EmailMessage
from pathlib import Path
import functools, smtplib, uuid, datetime as dt

class Mailer(ABC):
    @abstractmethod
    def session(self) -> AbstractContextManager[None]:
        """Return a context manager scoping one batch of sends. SMTPMailer
        reuses a single SMTP connection across the with-block; File/Memory
        mailers no-op. The base does NOT stack @contextmanager + @abstractmethod
        — that pairing wraps a non-generator body and would raise TypeError
        the first time the abstract is invoked. Concrete subclasses provide
        their own @contextmanager generators."""
        ...
    @abstractmethod
    def send(self, msg: EmailMessage) -> None: ...

class SMTPMailer(Mailer):
    def __init__(self, host, port, username, password):
        self.host, self.port = host, port
        self.username, self.password = username, password
        self._smtp: smtplib.SMTP | None = None

    @contextmanager
    def session(self):
        self._smtp = smtplib.SMTP(self.host, self.port, timeout=30)
        try:
            self._smtp.starttls()  # STARTTLS is required; no plaintext path
            self._smtp.login(self.username, self.password)
            yield
        finally:
            try: self._smtp.quit()
            except Exception: pass
            self._smtp = None

    def send(self, msg):
        assert self._smtp is not None, "SMTPMailer.send() must be called inside session()"
        self._smtp.send_message(msg)

class FileMailer(Mailer):
    def __init__(self, outbox_dir: Path):
        if outbox_dir.exists() and not outbox_dir.is_dir():
            raise RuntimeError(f"MATHION_EMAIL_OUTBOX={outbox_dir} exists but is not a directory")
        outbox_dir.mkdir(parents=True, exist_ok=True)
        self.outbox = outbox_dir

    @contextmanager
    def session(self):
        yield  # no batch state to acquire

    # Allow-list of recognized kinds; everything else stamps "unknown" in the
    # filename. Defense-in-depth: even though `kind` originates from server-
    # controlled trigger sites (TEMPLATES keys), `Path / kind` does NOT reject
    # `..` or `/` and a bad future trigger or test fixture writing kind="../x"
    # would write outside the outbox. The allow-list closes that vector.
    #
    # MUST be derived from `TEMPLATES.keys()` (templates.py), NOT a hand-kept
    # literal. Maintenance footgun: a future engineer adding a 5th kind would
    # update TEMPLATES, the dispatcher would happily render+send, and FileMailer
    # would silently stamp "unknown" in the filename — a confusing "file ended
    # up wrong-named" debugging session. Keep ONE source of truth.
    @classmethod
    @functools.cache  # 4-key frozenset; build once per process
    def _allowed_kinds(cls) -> frozenset[str]:
        # Lazy import (not a textual cycle — templates.py does not import
        # mailer.py — but it minimizes mailer.py's import-time graph so the
        # module loads early in `build_mailer_from_settings` without dragging
        # the templates.py transitive deps (mathion.config, mathion.api.*,
        # SQLAlchemy entity graph) along).
        from .templates import TEMPLATES
        return frozenset(TEMPLATES.keys())

    def send(self, msg):
        ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S")
        raw_kind = msg.get("X-Mathion-Kind", "unknown")
        kind = raw_kind if raw_kind in self._allowed_kinds() else "unknown"
        path = self.outbox / f"{ts}-{kind}-{uuid.uuid4().hex[:8]}.eml"
        tmp = path.with_suffix(".eml.tmp")
        tmp.write_bytes(bytes(msg))
        tmp.rename(path)  # atomic publish

class MemoryMailer(Mailer):
    def __init__(self):
        self.sent: list[EmailMessage] = []

    @contextmanager
    def session(self):
        yield

    def send(self, msg):
        self.sent.append(msg)

def build_mailer_from_settings(s) -> Mailer | None:
    if s.email_mode == 'disabled': return None
    if s.email_mode == 'smtp':
        if not s.smtp_host or not s.smtp_username or not s.smtp_password:
            raise RuntimeError("MATHION_SMTP_HOST, MATHION_SMTP_USERNAME, and MATHION_SMTP_PASSWORD required when MATHION_EMAIL_MODE=smtp")
        return SMTPMailer(s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password)
    if s.email_mode == 'file':
        return FileMailer(Path(s.email_outbox))
    if s.email_mode == 'memory':
        return MemoryMailer()
    raise RuntimeError(f"Unknown MATHION_EMAIL_MODE={s.email_mode!r}")
```

Notes:
- `session()` is the connection-reuse hook flagged by R1. Dispatcher wraps its per-tick loop in `with mailer.session():` so one SMTP TCP+TLS+AUTH covers up to `BATCH_SIZE` rows instead of opening 20 separate connections.
- STARTTLS is hard-coded; we don't ship a plaintext SMTP path. Dev/test uses `file` or `memory` mode.
- `Reply-To` header dropped from the slice (no UX hook today). Add later if needed.
- `FileMailer.send` reads the kind from a custom `X-Mathion-Kind` header set in `_build_email_message` (see §6.3).

## 5. Dispatcher

`backend/mathion/notifications/dispatcher.py`:

```python
import asyncio, logging, smtplib
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError, PendingRollbackError

from mathion.database import SessionLocal
from mathion.models_auth import NotificationLogEntry
from .errors import classify
from .templates import render, _build_email_message, RenderContext
# _build_render_context is defined locally in this module (see §6.1 skeleton).

logger = logging.getLogger("mathion.notifications")

BATCH_SIZE = 20                                # inlined (was env var in rev 1)
MAX_ATTEMPTS = 5                               # inlined
BACKOFF_SECONDS = [300, 1800, 7200, 21600]     # inlined: 5m, 30m, 2h, 6h (4 entries == MAX_ATTEMPTS - 1)

def tick(db, mailer, *, now: datetime) -> int:
    """Run one dispatch tick. Returns rows processed. Each row's success-path
    and error-path commit are wrapped in separate try blocks with explicit
    rollback on commit failure, so a poisoned session never blocks the batch."""
    rows = db.execute(
        select(NotificationLogEntry)
        .where(NotificationLogEntry.sent_at.is_(None))
        .where(NotificationLogEntry.error.is_(None))
        .where((NotificationLogEntry.next_attempt_at.is_(None)) |
               (NotificationLogEntry.next_attempt_at <= now))
        .order_by(NotificationLogEntry.created_at.asc(),
                  NotificationLogEntry.id.asc())  # PK tie-breaker for stable ordering
        .limit(BATCH_SIZE)
    ).scalars().all()

    if not rows:
        return 0

    # Acquire SMTP session for the whole batch. If acquisition itself fails
    # (server down, AUTH error, network unreachable), log structured warning
    # and return without touching row state — these failures are infrastructure-
    # level, not per-message, so they should NOT consume per-row retry budget.
    # The dispatcher loop will retry on next tick at its normal cadence.
    #
    # Defensive __exit__ call: SMTPMailer.session() today is a @contextmanager
    # generator whose try/finally cleans up on __enter__ failure (the exception
    # unwinds through the generator). But the Mailer.session() ABC is typed
    # AbstractContextManager[None] — a future class-based Mailer subclass with
    # an __enter__ that raises mid-init would NOT have Python call __exit__ on
    # it (the `with`-statement contract). Explicit __exit__ here is the belt-
    # and-suspenders for that future case.
    session_cm = mailer.session()
    try:
        session_cm.__enter__()
    except Exception as session_exc:
        try:
            session_cm.__exit__(type(session_exc), session_exc, session_exc.__traceback__)
        except Exception:
            logger.exception("notifications: session __exit__ raised during acquire-failure cleanup")
        logger.warning("notifications: failed to acquire mailer session (%s rows queued): %s",
                       len(rows), session_exc)
        return 0

    processed = 0
    try:
        for row in rows:
            processed += 1
            send_exc: BaseException | None = None
            try:
                ctx = _build_render_context(db, row)
                subject, body = render(row.kind, ctx)
                msg = _build_email_message(subject, body, ctx, kind=row.kind)
                mailer.send(msg)
            except Exception as exc:
                send_exc = exc

            if send_exc is None:
                # Success branch — stamp sent_at + commit; on commit failure
                # rollback and treat as transient (row stays unsent, retried next tick).
                row.sent_at = now
                try:
                    db.commit()
                except SQLAlchemyError as cexc:
                    logger.exception("commit failed after successful send (will retry): id=%s", row.id)
                    db.rollback()
                    # We can't un-send the email; on next tick we re-claim and re-send (at-least-once).
                    # Leave row's in-memory state to be expired by the rollback.
                continue

            # Error branch — failure path. Increment counters separately.
            db.rollback()                       # clear any partial in-memory state
            row_db = db.get(NotificationLogEntry, row.id)
            if row_db is None: continue          # row was deleted; skip
            row_db.retry_count = (row_db.retry_count or 0) + 1

            kind = classify(send_exc)
            exhausted = row_db.retry_count >= MAX_ATTEMPTS
            if kind == 'permanent' or exhausted:
                # Redact SMTPAuthenticationError messages — some servers echo
                # the username (or worse, parts of the password) in the 535
                # response body. Operator gets the full exception via
                # logger.exception below; the DB just gets a safe sentinel.
                if isinstance(send_exc, smtplib.SMTPAuthenticationError):
                    error_msg = "SMTP authentication failed (see operator logs)"
                else:
                    error_msg = str(send_exc)[:500]
                if exhausted and kind != 'permanent':
                    row_db.error = f"max attempts: {error_msg[:480]}"
                else:
                    row_db.error = error_msg
                row_db.next_attempt_at = None
                logger.warning("notification id=%s flagged permanently: %s",
                               row_db.id, row_db.error)
                # Full exception for operator (logs only, never DB).
                logger.exception("notification id=%s permanent-error detail", row_db.id, exc_info=send_exc)
            else:
                idx = min(row_db.retry_count - 1, len(BACKOFF_SECONDS) - 1)
                row_db.next_attempt_at = now + timedelta(seconds=BACKOFF_SECONDS[idx])
            try:
                db.commit()
            except SQLAlchemyError:
                logger.exception("commit failed updating retry state: id=%s", row_db.id)
                db.rollback()
    finally:
        try:
            session_cm.__exit__(None, None, None)
        except Exception:
            logger.exception("notifications: session close raised (ignored)")
    return processed


SHUTDOWN_TIMEOUT_SECONDS = 30  # how long to wait for an in-flight tick on shutdown
TICK_SLEEP_SECONDS = 30        # module constant; not env-tunable in slice 1 (per YAGNI rev 5)

async def run_forever(app):
    """Lifespan-launched loop. Wraps the sync tick() in asyncio.to_thread so
    smtplib does not block the FastAPI event loop."""
    shutdown: asyncio.Event = app.state.shutdown
    while not shutdown.is_set():
        try:
            def _do_tick():
                with SessionLocal() as db:
                    return tick(db, app.state.mailer,
                                now=datetime.now(timezone.utc))
            await asyncio.to_thread(_do_tick)
        except Exception:
            logger.exception("dispatcher tick failed; continuing")
        try:
            await asyncio.wait_for(shutdown.wait(), timeout=TICK_SLEEP_SECONDS)
        except asyncio.TimeoutError:
            pass
```

**Multi-worker advisory lock** (`acquire_singleton_lock`):

```python
import fcntl  # POSIX-only — Mathion supports macOS + Linux deployments

def acquire_singleton_lock(settings):
    """Fail loud if another process holds the lock. Prevents silent double-send
    under `uvicorn --workers 2`. Returns the open fd so caller can release it
    explicitly in lifespan finally (more reliable than atexit, which may not
    fire on SIGKILL / OOM / `kill -9` — kernel cleanup releases the lock there).

    The try/finally + success flag guards against the fd leak that would occur
    if `fcntl.flock` raised ANY exception other than BlockingIOError (e.g.
    OSError from a stale NFS mount, EBADF, EINTR on uncommon kernels). Without
    the flag, only the BlockingIOError branch closes the fd."""
    lock_path = Path(settings.dispatcher_lock_path)  # absolute by default: /tmp/mathion.dispatcher.lock
    fd = open(lock_path, "w")
    success = False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(
                f"Another Mathion dispatcher process holds {lock_path}. "
                "Mathion does not support multi-worker dispatchers yet. "
                "Run with --workers 1 or stop the other process.")
        success = True
        return fd
    finally:
        if not success:
            fd.close()  # closes on BlockingIOError path AND any other exception
```

Lifespan wire-up (updated for explicit lock release):

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.settings = settings
    app.state.shutdown = asyncio.Event()
    app.state.mailer = build_mailer_from_settings(settings)
    app.state.lock_fd = None
    if app.state.mailer is not None:
        app.state.lock_fd = acquire_singleton_lock(settings)
        task = asyncio.create_task(run_forever(app))
    else:
        task = None
    try:
        yield
    finally:
        app.state.shutdown.set()
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=SHUTDOWN_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                task.cancel()
                # Drain the cancelled task so its CancelledError is consumed and
                # asyncio does not emit "Task was destroyed but it is pending"
                # at loop close. asyncio.to_thread cannot interrupt the wrapped
                # sync tick (the thread runs to completion regardless), but the
                # await pumps the event loop once so the cancellation lands.
                try:
                    await asyncio.wait_for(task, timeout=5)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass
        if app.state.lock_fd is not None:
            app.state.lock_fd.close()  # explicit release; atexit fallback for SIGKILL

app = FastAPI(..., lifespan=lifespan)
```

## 6. Templates

### 6.1 Payload-key contract per kind

Existing trigger sites write these keys (verified against current source). The dispatcher MUST read exactly these keys; mismatch silently fails (KeyError → permanent → emails never sent).

| Kind | Required payload keys |
| --- | --- |
| `evaluation_received` | `run_id`, `mini_project_id`, `submission_id` |
| `run_enrolled` | `run_id`, `course_slug`, `title` |
| `run_teacher_assigned` | `run_id`, `title` |
| `mini_project_published` (new) | `run_id`, `mini_project_id` |

`_build_render_context` extracts these and re-fetches User/Run/MiniProject/Submission by ID. **Titles in the payload are ignored** — fresh values are read from the entities (covers admin-edited titles between trigger and send).

**Eager-load on the Run fetch.** The `RenderContext.course_slug` `@property` walks `run.version.course.slug`; both relationships are lazy by default in `models.py` (`Run.version` is `Mapped["CourseVersion"]` at `models.py:205`; `CourseVersion.course` is `Mapped["Course"]` at `models.py:53`). Without eager-load, a 20-row tick triggers 60 extra SELECTs per dispatch (3 lazy hops × 20 rows). `_build_render_context` MUST use `select(Run).options(joinedload(Run.version).joinedload(CourseVersion.course)).where(Run.id == payload["run_id"])` (or the equivalent `selectinload`) so the chain is loaded in one query. Same pattern applied to the MP fetch: prescribe `joinedload(MiniProject.block)` on the MP `select` (the template needs `mp.block.order` and `mp.block` is lazy-default). The `_build_render_context` body in `dispatcher.py` SHOULD be tested with a sqlalchemy `event.listen('before_cursor_execute')` counter to assert the per-row query count stays at 4 (Run+version+course, User, MP+block, Submission) or fewer — see §12.

**Lookup order (pinned).** `_build_render_context` calls `db.get` (or eager-loaded select) in this fixed order: (1) Run, (2) User, (3) MiniProject if `mini_project_id` in payload, (4) Submission if `submission_id` in payload. The first missing referent raises `LookupError(f"referent missing: {kind}:{id}")` — the test plan's "deleted referent" tests assert the exact substring based on this order.

**`_build_render_context` skeleton** (lives in `dispatcher.py`):

```python
# dispatcher.py — imports for _build_render_context
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from mathion.config import settings
from mathion.models import Run, CourseVersion, MiniProject, Submission
from mathion.models_auth import User, NotificationLogEntry
from .templates import RenderContext  # dataclass defined in templates.py (§6.2)

def _build_render_context(db, row: NotificationLogEntry) -> "RenderContext":
    payload = row.payload or {}
    if "run_id" not in payload:
        raise KeyError(f"payload missing run_id for kind={row.kind!r}")

    # (1) Run — eager-load the version+course chain so the @property doesn't fan out.
    run = db.execute(
        select(Run)
        .options(joinedload(Run.version).joinedload(CourseVersion.course))
        .where(Run.id == payload["run_id"])
    ).scalar_one_or_none()
    if run is None:
        raise LookupError(f"referent missing: run:{payload['run_id']}")

    # (2) User — the recipient.
    user = db.get(User, row.user_id)
    if user is None:
        raise LookupError(f"referent missing: user:{row.user_id}")

    # (3) MiniProject if present in payload.
    mp = None
    if "mini_project_id" in payload:
        mp = db.execute(
            select(MiniProject)
            .options(joinedload(MiniProject.block))
            .where(MiniProject.id == payload["mini_project_id"])
        ).scalar_one_or_none()
        if mp is None:
            raise LookupError(f"referent missing: mini_project:{payload['mini_project_id']}")

    # (4) Submission if present in payload.
    sub = None
    if "submission_id" in payload:
        sub = db.get(Submission, payload["submission_id"])
        if sub is None:
            raise LookupError(f"referent missing: submission:{payload['submission_id']}")

    return RenderContext(user=user, run=run, base_url=settings.base_url, mp=mp, sub=sub)
```

The `RenderContext` does not store `course_slug` or `email_from` — `course_slug` is derived as a `@property` (see §6.2), and `email_from` is read in `_build_email_message` directly from `mathion.config.settings.email_from` (see §6.3 imports).

If any required key is missing → `KeyError` → classified permanent → `error` set, row flagged.
If a referenced entity (run, MP, submission) has been deleted → `db.get()` returns None → `_build_render_context` raises `LookupError("referent missing: <table>:<id>")` → classified permanent.

`course_slug` is derived from the entity graph (`run.version.course.slug`), NOT from the payload, so all 4 kinds get a valid slug even though `run_teacher_assigned` and `mini_project_published` payloads don't carry it. It is exposed on `RenderContext` as a `@property` (see §6.2) rather than a denormalized field, eliminating the chance for the cached slug to drift from `run.version.course.slug` mid-render.

### 6.2 Templates (4 plain-text, no HTML, no Jinja)

```python
from dataclasses import dataclass
from typing import Optional, Callable

@dataclass
class RenderContext:
    user: User
    run: Run
    base_url: str
    mp: Optional[MiniProject] = None
    sub: Optional[Submission] = None

    @property
    def course_slug(self) -> str:
        # Derived; not denormalized into the dataclass. `run.version.course`
        # is already loaded by `_build_render_context` because it joined the
        # entity graph to derive the slug, so this is O(1) attribute access.
        return self.run.version.course.slug

def _name(u: User) -> str:
    return u.full_name or u.email

# NOTE on header sanitization: Python's email.message.EmailMessage under the
# default EmailPolicy raises ValueError on CR/LF in header values (header
# injection protection is built into the stdlib since Python 3.6). When a
# malformed run-title hits `msg["Subject"] = ...`, the ValueError propagates
# out of _build_email_message and is classified `permanent` per §11 — the
# row is flagged with an explicit error message and never re-sent. No bespoke
# _safe_header sanitizer is needed.

def _run_url(ctx: RenderContext) -> str:
    # NOTE: bare run URL only. The frontend `RunDetailPage` currently does NOT
    # parse `?tab=…` or `?mp=…` query strings (verified by reading the page
    # source); deep-link parsing is deferred to a future slice. Including the
    # query strings here would ship broken links. Update this helper when
    # deep-link parsing lands in RunDetailPage.
    return f"{ctx.base_url}/courses/{ctx.course_slug}/runs/{ctx.run.id}"

def _evaluation_received(ctx):
    # Inline `mini_project_title` call: was a 1-line `_mp_title` helper; the
    # indirection added no value at a single call site (rev 4 added it for
    # in-app/email label parity; rev 5 inlined per YAGNI review).
    from mathion.api.mini_projects import mini_project_title
    subject = f"New evaluation in {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'Your submission to "{mini_project_title(ctx.mp.block)}" has been evaluated.\n\n'
        f"View it: {_run_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body

def _run_enrolled(ctx):
    subject = f"You've been enrolled in {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'You\'ve been enrolled in "{ctx.run.title}".\n\n'
        f"Open it: {_run_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body

def _run_teacher_assigned(ctx):
    subject = f"You're teaching {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'You\'ve been assigned as a teacher on "{ctx.run.title}".\n\n'
        f"Open it: {_run_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body

def _mini_project_published(ctx):
    from mathion.api.mini_projects import mini_project_title
    subject = f"New mini-project in {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'A new mini-project "{mini_project_title(ctx.mp.block)}" is available in "{ctx.run.title}".\n\n'
        f"Open it: {_run_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body

TEMPLATES: dict[str, Callable[[RenderContext], tuple[str, str]]] = {
    "evaluation_received":     _evaluation_received,
    "run_enrolled":            _run_enrolled,
    "run_teacher_assigned":    _run_teacher_assigned,
    "mini_project_published":  _mini_project_published,
}

def render(kind, ctx):
    if kind not in TEMPLATES:
        raise KeyError(f"unknown notification kind: {kind!r}")  # → permanent
    return TEMPLATES[kind](ctx)
```

### 6.3 `_build_email_message`

Lives in `templates.py` alongside `render`. Imports `settings` directly (the `email_from` is config-resolved at send time, not threaded through `RenderContext`):

```python
# templates.py — top-of-module imports for _build_email_message
from email.message import EmailMessage
from mathion.config import settings

def _build_email_message(subject, body, ctx, *, kind):
    if not ctx.user.email:
        raise ValueError("recipient has no email")  # → permanent
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = ctx.user.email
    msg["Subject"] = subject  # EmailMessage default policy raises ValueError on CR/LF → permanent
    msg["X-Mathion-Kind"] = kind  # FileMailer reads this to name the .eml file
    msg.set_content(body, charset="utf-8")
    return msg
```

## 7. Trigger-side fixes

### 7.1 `helpers.enroll_user_in_run` — log only on first enrollment

Currently the `NotificationLogEntry(kind="run_enrolled")` insert sits after the `if/else` so it fires on both first enrollment AND group reassignment. With the dispatcher live, group moves would email the student `"you've been enrolled"` every time.

Fix: move the insert into the `else` (new RunStudent) branch only.

```python
# After
if rs:
    rs.group_id = group_id
else:
    rs = RunStudent(run_id=run.id, user_id=user.id, group_id=group_id)
    db.add(rs)
    db.flush()
    db.add(NotificationLogEntry(
        user_id=user.id, kind="run_enrolled",
        payload={"run_id": run.id, "course_slug": version.course.slug, "title": run.title},
    ))
return rs
```

The unassign path (`group_id=None` on an existing RunStudent) hits `if rs:` only — no log row, as desired.

### 7.2 `runs.py:publish_run` — remove the bulk-notify loop AND the dead course_slug lookup

The new publish-gate (§8) makes pre-publish enrollment impossible going forward. The loop at `runs.py:220-232` becomes a permanent no-op for any post-slice run. Delete:
- The `course_slug = run.version.course.slug` lookup at line `218` (only used by the loop).
- The `for rs in students: db.add(NotificationLogEntry(kind="run_published", ...))` loop.

`test_runs.py::test_publish_writes_run_published_notification_per_student` is deleted.

### 7.3 `mini_projects.py:publish_mini_project` — emit `mini_project_published` (transition-guarded at insert site)

At the MP publish path (the endpoint that flips `mp.is_published` to true), the trigger fires **only on the transition** from unpublished to published. Re-publishing an already-published MP must continue to be a no-op for the endpoint contract — the existing publish endpoint is idempotent and **this slice does not change that**. The transition guard lives at the notification insert site, NOT on the endpoint.

Implementation (snapshot the prior state BEFORE the flip, then only insert notification rows when transitioning). The existing `publish_mini_project` at `mini_projects.py:258-296` ends with `mp.is_published = True; db.commit()` at lines 293-294. The implementer MUST relocate the `db.commit()` to AFTER the notification-insert loop so the publish-state flip and the notification inserts live in ONE transaction (a rollback discards both):

```python
# Inside publish_mini_project, after permission checks (after the existing
# transition-state validation block at ~mini_projects.py:280-292).
#
# Re-fetch the MP with a row-level lock so concurrent publishes serialize.
# Without this, two admins clicking Publish simultaneously each see
# was_published=False, each insert N notification rows, and both commits
# succeed (no UniqueConstraint on (kind, user_id, payload) in notification_log
# — verified at models_auth.py:94-104). Result: 2N duplicate emails. The
# row-level lock makes the second transaction wait, see was_published=True
# after the first commit, and skip the notification-insert branch.
#
# CRITICAL: the `mp` returned by `get_or_404` at mini_projects.py:264 is now
# in the session's identity map with `is_published=False` cached. Bare
# `db.execute(select(...).with_for_update()).scalar_one()` returns the cached
# instance with stale attributes (SQLAlchemy 2.x identity-map semantics). The
# `.execution_options(populate_existing=True)` directive overrides this:
# SA re-reads the row from the DB AND overwrites the cached instance's column
# attributes with the fresh values. FOR UPDATE is emitted under the hood, so
# the lock is held until the surrounding transaction commits.
#
# `.scalar_one()` raises `sqlalchemy.exc.NoResultFound` (public, documented
# subclass of InvalidRequestError) if the row was deleted between get_or_404
# and this query — clean 404 path instead of a SQLAlchemy-raw 500.
#
# (SQLite hides the dedup race because SQLAlchemy strips FOR UPDATE on SQLite
# and DB-level write serialization masks it; Postgres production would see
# the duplicate emails without this. Imports: `from sqlalchemy import select`
# and `from sqlalchemy.exc import NoResultFound`.)
mp_id = mp.id  # capture before the reassignment for refactor-safety
try:
    mp = db.execute(
        select(MiniProject)
        .where(MiniProject.id == mp_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()
except NoResultFound:
    raise HTTPException(status_code=404, detail="MiniProject not found")
was_published = mp.is_published    # snapshot BEFORE the flip (under lock, fresh from DB)
mp.is_published = True              # idempotent: no-op when already true
# IMPORTANT: do NOT commit here. The existing `db.commit()` on the line
# right after `mp.is_published = True` MUST be deleted and replaced with
# a single `db.commit()` at the end of the new block (below). This keeps
# the publish flip + notification inserts atomic.

if not was_published:  # only on the unpublished -> published transition
    roster = db.execute(
        select(RunStudent)
        .where(RunStudent.run_id == mp.run_id)
        .where(
            (RunStudent.group_id.is_(None)) |
            (~RunStudent.group_id.in_(
                select(Group.id).where(Group.run_id == mp.run_id, Group.is_disabled.is_(True))))
        )
    ).scalars().all()

    for rs in roster:
        db.add(NotificationLogEntry(
            user_id=rs.user_id, kind="mini_project_published",
            payload={"run_id": mp.run_id, "mini_project_id": mp.id},
        ))

db.commit()  # SINGLE commit for the publish flip + the notification rows
```

Exclude disabled-group students because they cannot interact with the run; emailing them would be misleading. Students with `group_id=None` (ungrouped) ARE included — they can still see published MPs in their roster view per existing Phase 7b semantics.

The notification inserts live inside the same transaction as the publish-state flip, so a publish rollback discards the notification rows too.

**No publish-endpoint behavior change.** Re-publishing an already-published MP returns the same 200/204 it returns today (the endpoint's idempotency contract is preserved) — only the notification side-effect is suppressed via `was_published`. This was a deliberate rev 3 → rev 4 change: an earlier draft added a 409 on re-publish, but that altered the endpoint contract beyond the notifications scope of this slice.

## 8. Publish-gate (new 409 with top-level error_code)

Two new gates in `backend/mathion/api/run_roster.py`. The 409 body uses a **top-level** `error_code` field plus the standard string `detail` — this matches what `frontend/src/lib/api.ts:46` actually reads (`new ApiError(res.status, body.detail ?? res.statusText, body.error_code)`). Since `HTTPException(detail={dict})` serializes to `{"detail": {dict}}` (nested) — which does NOT match `body.error_code` at top level — we must return a `JSONResponse` directly:

```python
from fastapi.responses import JSONResponse

# add_student — placed AFTER auth (require_run_admin_or_teacher) and BEFORE
# group/capacity checks so the run-state error wins over per-row errors.
if not run.is_published:
    return JSONResponse(
        status_code=409,
        content={"detail": "Cannot add students to an unpublished run",
                 "error_code": "run_unpublished"})

# add_students_batch — same gate at top of handler, BEFORE the per-row loop.
# Returns 409 for the WHOLE batch (vs per-row 207 mixed-result): the run-state
# applies uniformly to all rows; no partial enrollment is performed.
if not run.is_published:
    return JSONResponse(
        status_code=409,
        content={"detail": "Cannot add students to an unpublished run",
                 "error_code": "run_unpublished"})
```

Notes:
- Returning `JSONResponse` from a handler typed with `response_model=RunStudentResponse` works in FastAPI (the JSONResponse bypasses `response_model`).
- `error_code: "run_unpublished"` is a NEW whole-call string constant. Backend side: define it once as a Python constant `RUN_UNPUBLISHED_ERROR_CODE = "run_unpublished"` in `backend/mathion/api/run_roster.py` (top of file) and reference that constant in both `JSONResponse` bodies — no string literals scattered across the file. Frontend side: define `export const RUN_UNPUBLISHED_ERROR_CODE = "run_unpublished"` in `frontend/src/lib/runRoster.ts`. **Do NOT** add the value to `BulkRosterErrorCode`: that union is the per-row error code returned in the 207 batch-result `results[i].error_code` field (e.g. `"duplicate"`, `"capacity"`); `run_unpublished` is a whole-call HTTP-level error semantically distinct from per-row failures.
- Wire shape: `{"detail": "Cannot add students…", "error_code": "run_unpublished"}` — at TOP LEVEL of body. `ApiError.errorCode === RUN_UNPUBLISHED_ERROR_CODE` is the frontend match (after `api.ts:46` already reads `body.error_code` into `ApiError.errorCode`).
- **OpenAPI 409 docs:** decorate both endpoints with `responses={409: {"description": "Run is not published", "content": {"application/json": {"example": {"detail": "Cannot add students to an unpublished run", "error_code": "run_unpublished"}}}}}` so the schema reflects the gate. NOTE: Mathion's `backend/mathion/api/` does NOT currently use the `responses=` decorator anywhere (verified by `grep -rn "responses=" backend/mathion/api/`); this slice introduces the pattern. The OpenAPI test in §12 is the contract that prevents this decoration from being silently dropped in a future refactor.

**Endpoints NOT gated** (cleanup on existing roster during a temporary unpublish is supported):
- `PATCH /api/runs/{run_id}/students/{user_id}` — single group reassignment
- `DELETE /api/runs/{run_id}/students/{user_id}` — single removal
- `POST /api/runs/{run_id}/students/bulk-move`
- `POST /api/runs/{run_id}/students/bulk-delete`

## 9. UI affordance (Draft-run Roster tab)

`frontend/src/components/runs/RunRosterTab.svelte` accepts three new props:
- `runIsPublished: boolean` — threaded from `RunDetailPage.svelte` as `runIsPublished={run.is_published}`.
- `courseSlug: string` — already present at `RunDetailPage.svelte:32`; passed down so the banner's nav target can be constructed if needed (also useful for future deep-link work).
- `onNavigateToTab: (tab: ActiveTab) => void` — callback to switch the active tab. `ActiveTab` is the union type at `RunDetailPage.svelte:30` (to be turned into `export type` per §2 frontend task); imported by RunRosterTab as `import type { ActiveTab } from '../../pages/runs/RunDetailPage.svelte';`. The runtime callback shape mirrors `RunMiniProjectsTab.svelte:209`; the type pattern is new in this slice (MP tab uses a narrower local inline union). Today the banner only ever passes `'overview'` to the callback, but typing against the full `ActiveTab` keeps the door open for future cross-tab links without a prop-type change.

**Banner at top of `.roster-tab`** (above both `.roster-toolbar` and `.add-row`). Two visual options — pick (a) for visual consistency with the adjacent MP tab:

- **(a) Recommended: just `.banner`** (no `.banner-info` variant). Use `<div class="banner" ...>` and copy ONLY the `.banner` rules from `RunMiniProjectsTab.svelte:340-346` into `RunRosterTab.svelte`'s scoped `<style>` block (left-border accent + muted surface; same visual as the MP tab's draft-banner the teacher sees one tab over). The MP tab itself uses `.banner` without `.banner-info`, so this matches.
- **(b) Alternative: `.banner.banner-info`** (Material blue solid). Use `<div class="banner banner-info" ...>` and copy `.banner` rules from `RunMiniProjectsTab.svelte:340-346` AND the `.banner-info` color rules from `RunAssetsTab.svelte:909-913` (which is the only file that defines `.banner-info`; `RunMiniProjectsTab` does NOT). This is visually divergent from the MP-tab banner.

Spec mandates **(a)** for UX consistency. The class string is `class="banner"` only.

```svelte
{#if !runIsPublished}
  <div id="roster-draft-publish-hint" class="banner" role="status"
       data-action="draft-publish-hint">
    Publish this run before adding students. You can still move or remove students already on the roster.
    <button type="button" class="linklike"
            onclick={() => onNavigateToTab('overview')}
            data-action="nav-overview-publish-roster">Publish on Overview</button>
  </div>
{/if}
```

(`id="roster-draft-publish-hint"` — prefixed with `roster-` so the id remains unique if a future refactor renders both Roster and MP tabs concurrently; `aria-describedby` references update accordingly. `data-action="nav-overview-publish-roster"` — distinct from `RunMiniProjectsTab`'s `nav-overview-publish` to avoid selector collisions in tests.)

**Disabled controls** when `!runIsPublished`:
- Add button: native `disabled` attribute (NOT `aria-disabled`), `aria-describedby="roster-draft-publish-hint"`.
- Import roster button (in `.roster-toolbar`): same.
- Empty-state Import roster CTA (when `students.length === 0`): same.
- A11y note: `disabled` + `aria-describedby` pairing is HTML-valid but inconsistently announced across screen readers (VoiceOver/Safari does not announce the description on a disabled button). The banner's `role="status"` (which is `aria-live="polite"`) is the PRIMARY a11y surface for the draft-state hint; the per-button `aria-describedby` is supplementary. Accept this trade-off rather than swap to `aria-disabled="true"` + `pointer-events: none` + onclick early-return (larger pattern change for marginal a11y gain).

**Form submission guard** in `submitAdd`:

```ts
function submitAdd(...) {
  if (!runIsPublished) return;  // belt-and-suspenders; covers Enter-keypress with disabled button
  // ... existing logic
}
```

**409 handling** (race: someone else unpublished between page load and submit). Reuse the existing `addError` state (no new `inlineError` introduced — `addError` already drives the inline `<p class="error">` at the Add row); the rendering surface stays the same. Import the constant from `runRoster.ts` and match on it (no string literal in the component):

```ts
import { RUN_UNPUBLISHED_ERROR_CODE } from '../../lib/runRoster';

} catch (e: unknown) {
  if (e instanceof ApiError && e.status === 409 && e.errorCode === RUN_UNPUBLISHED_ERROR_CODE) {
    addError = e.detail ?? 'Run is no longer published.';
    return;
  }
  throw e;
}
```

The existing `<p class="error">{addError}</p>` line gets `role="alert"` so screen readers announce the run-state change (matches `RunMiniProjectsTab.svelte:214` precedent — verified: `role="alert"` on `.banner-error`). Note: `addError` is also set by the client-side duplicate-email check (`RunRosterTab.svelte:~292` — "X is already enrolled. Edit their group in the table."). That's fine: the dup check fires only on explicit Add-button submit (not during typing), so the alert announces an actionable state change. Both the run-state 409 and the dup-email message land in the same `addError` channel and announce identically.

**`RosterImportModal.svelte` differs** — the existing `<p class="error">{parsed.error}</p>` at line 168 is shared between client-side `parseCsv` preview errors (firing on every debounce while the user types) and submit-time errors. Adding `role="alert"` to that shared `<p>` would announce preview-parse errors aloud during typing — a UX regression. The modal MUST introduce a NEW state:

```ts
let submitError: string | null = $state(null);

// In submitCsv (line ~58-80) catch block:
} catch (e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 409 && e.errorCode === RUN_UNPUBLISHED_ERROR_CODE) {
      submitError = e.detail ?? 'Run is no longer published.';
    } else {
      submitError = e.displayMessage ?? 'Failed to import students.';
    }
    return;
  }
  throw e;
}

// Clear on next input:
function onTextInput(...) {
  submitError = null;
  // ... existing parse logic
}
```

Render `submitError` in a NEW `<p class="error" role="alert">{submitError}</p>` placed above the `.modal-actions` row (so it sits visually distinct from the inline `parsed.error` preview banner). The existing `parsed.error` `<p>` keeps NO `role` attribute (preview is silent for AT users; visible state is unchanged for sighted users).

## 10. Config / env surface

`backend/mathion/config.py` — **9** new settings (rev 1 envisioned 14; rev 2 inlined 5 → 9; rev 3 added `MATHION_DISPATCHER_LOCK_PATH` → 10; rev 5 dropped `MATHION_DISPATCHER_TICK_SECONDS` → 9; the rest are inlined as Python constants):

| Key | Default | Notes |
| --- | --- | --- |
| `MATHION_EMAIL_MODE` | `disabled` | One of `disabled` / `smtp` / `file` / `memory`. |
| `MATHION_SMTP_HOST` | `""` | Required when mode=`smtp`. |
| `MATHION_SMTP_PORT` | `587` | STARTTLS default. |
| `MATHION_SMTP_USERNAME` | `""` | Required when mode=`smtp`. |
| `MATHION_SMTP_PASSWORD` | `""` | Required when mode=`smtp`. Never logged. |
| `MATHION_EMAIL_OUTBOX` | `"./outbox/"` | Used when mode=`file`. Auto-created; fails loud if path exists as a non-directory. |
| `MATHION_EMAIL_FROM` | `"Mathion <noreply@mathion.test>"` | RFC 5322 mailbox. |
| `MATHION_BASE_URL` | `"http://localhost:8000"` | Trailing slash stripped at config-load AND scheme/netloc validated. See validator below. |
| `MATHION_DISPATCHER_LOCK_PATH` | `"/tmp/mathion.dispatcher.lock"` | **Absolute path REQUIRED.** A Pydantic v2 `@field_validator` in `config.py` rejects relative paths at boot (see validator below). Pinning to an absolute path prevents the cwd-relative trap where two uvicorn processes with different cwds each acquire their own lock and silently double-send. Set to a deployment-specific path (e.g. `/var/run/mathion/dispatcher.lock`) in production. |

**Inlined** (in `dispatcher.py` or `mailer.py`): `BATCH_SIZE = 20`, `MAX_ATTEMPTS = 5`, `BACKOFF_SECONDS = [300, 1800, 7200, 21600]`, `TICK_SLEEP_SECONDS = 30`, `STARTTLS = True` (always). **Dropped in rev 5:** `MATHION_DISPATCHER_TICK_SECONDS` (no real reason to tune tick frequency from env in slice 1). **Dropped earlier:** `MATHION_EMAIL_REPLY_TO` (no UX hook this slice).

**Startup validation:**
- `build_mailer_from_settings` raises `RuntimeError` if mode=`smtp` and host/username/password is empty → app refuses to start.
- If `MATHION_EMAIL_OUTBOX` exists as a non-directory → `RuntimeError`.
- If mode != `disabled` → advisory lock is acquired; if held by another process → `RuntimeError` (LOUD failure for `uvicorn --workers 2`).
- If mode == `disabled` → dispatcher loop never starts; mailer is None.

**`MATHION_BASE_URL` validator** (Pydantic v2 `field_validator`). Bare strip-trailing-slash is insufficient: an admin who sets `MATHION_BASE_URL=javascript:alert(1)` or `http://attacker.example.com` would silently ship malicious URLs in every notification email body — phishing risk for students. Validator MUST parse with `urllib.parse.urlparse` and assert (a) scheme in `{"http", "https"}`, (b) netloc non-empty, (c) strip trailing slash. Boot fails loud on malformed input:

```python
from pydantic import field_validator
from urllib.parse import urlparse

class Settings(BaseSettings):
    base_url: str = "http://localhost:8000"
    # ... other fields ...

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, v: str) -> str:
        # Reject CR / LF / NUL / other ASCII control chars AND ANY whitespace
        # BEFORE parsing. `urllib.parse.urlparse` tolerates control chars and
        # whitespace in netloc/path, allowing header-injection-shaped values
        # to reach the email body. `\t`, ` `, `\xa0` (NBSP) all rejected.
        if any(ord(c) < 0x20 or ord(c) == 0x7f or c.isspace() for c in v):
            raise ValueError(
                f"MATHION_BASE_URL contains control or whitespace characters: {v!r}")
        parsed = urlparse(v)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError(
                f"MATHION_BASE_URL scheme must be http or https, got {parsed.scheme!r}")
        if not parsed.netloc:
            raise ValueError(f"MATHION_BASE_URL missing host: {v!r}")
        # Reject userinfo (the `user:pass@host` form). Phishing vector:
        # `https://mathion.example.com@attacker.com` — `parsed.netloc` is
        # `mathion.example.com@attacker.com` (passes the non-empty check),
        # but browsers resolve the host as `attacker.com`. The userinfo
        # form has no legitimate use in a public base URL.
        if parsed.username is not None or parsed.password is not None:
            raise ValueError(
                f"MATHION_BASE_URL must not contain userinfo (user:pass@); got {v!r}")
        # Force `parsed.port` evaluation — raises ValueError on malformed
        # ports like `:bad` or out-of-range integers (urlparse keeps these
        # in netloc and the port property re-parses on access).
        try:
            _ = parsed.port
        except ValueError as exc:
            raise ValueError(f"MATHION_BASE_URL has invalid port: {v!r}") from exc
        # Reject path-prefix URLs. `MATHION_BASE_URL=http://example.com/admin`
        # would produce links like `http://example.com/admin/courses/<slug>/runs/<id>`,
        # which is almost always a config typo. Path-prefix support is a real
        # but separate feature (reverse-proxy mounting) and would need a
        # dedicated design — out of scope this slice. Accept "" and "/" only.
        if parsed.path not in ("", "/"):
            raise ValueError(
                f"MATHION_BASE_URL must not include a path; got path={parsed.path!r}. "
                "If reverse-proxy path-prefix support is needed, see a follow-up slice.")
        # Reject query string and fragment. Both break URL construction in
        # `_run_url` (which appends `/courses/.../runs/...` — concatenating
        # onto `http://example.com?x=y` produces `http://example.com?x=y/courses/...`
        # which routes the path INTO the query string). No legitimate use
        # for either in a base URL.
        if parsed.query:
            raise ValueError(f"MATHION_BASE_URL must not include a query string: {v!r}")
        if parsed.fragment:
            raise ValueError(f"MATHION_BASE_URL must not include a fragment: {v!r}")
        return v.rstrip("/")

    @field_validator("dispatcher_lock_path")
    @classmethod
    def _validate_dispatcher_lock_path(cls, v: str) -> str:
        # Reject relative paths. A relative path (e.g. `./mathion.lock`) is
        # cwd-dependent — two uvicorn processes with different cwds each
        # resolve a DIFFERENT path, each acquires its own lock, and both
        # silently double-send. The whole point of MATHION_DISPATCHER_LOCK_PATH
        # over `/tmp/mathion.dispatcher.lock` is to let deployments pin a
        # known-shared path; admitting relative values defeats that.
        p = Path(v)
        if not p.is_absolute():
            raise ValueError(
                f"MATHION_DISPATCHER_LOCK_PATH must be absolute; got {v!r}. "
                "Use /var/run/mathion/dispatcher.lock or /tmp/mathion.dispatcher.lock.")
        return v
```

Note: requires `from pathlib import Path` at `config.py` module top.

Add unit tests in `test_config.py` (or `test_notifications_templates.py`):
- `Settings(base_url="javascript:alert(1)")` → `ValidationError`.
- `Settings(base_url="http:///")` → `ValidationError` (empty netloc).
- `Settings(base_url="file:///etc/passwd")` → `ValidationError`.
- `Settings(base_url="http://example.com\r\nX-Inject:1")` → `ValidationError` (CR/LF rejected by control-char guard).
- `Settings(base_url="http://example.com\x00")` → `ValidationError` (NUL byte rejected).
- `Settings(base_url="http://example.com /path")` → `ValidationError` (space rejected by whitespace guard).
- `Settings(base_url="http://example.com\t")` → `ValidationError` (TAB rejected).
- `Settings(base_url="https://mathion.example.com@attacker.com")` → `ValidationError` (userinfo rejected — phishing vector).
- `Settings(base_url="http://user:pass@example.com")` → `ValidationError` (userinfo rejected).
- `Settings(base_url="http://example.com:bad")` → `ValidationError` (invalid port rejected — `parsed.port` raises).
- `Settings(base_url="http://example.com:99999")` → `ValidationError` (out-of-range port rejected).
- `Settings(base_url="http://example.com?utm=x")` → `ValidationError` (query string rejected).
- `Settings(base_url="http://example.com#frag")` → `ValidationError` (fragment rejected).
- `Settings(base_url="http://example.com/admin")` → `ValidationError` (path-prefix rejected; see §10 path-prefix note).
- `Settings(base_url="http://example.com/")` → `"http://example.com"` (trailing slash stripped, happy path).
- `Settings(base_url="http://example.com")` → `"http://example.com"` (no path, happy path).
- `Settings(base_url="https://example.com")` → `"https://example.com"` (https happy path).
- `Settings(base_url="http://example.com:8080")` → `"http://example.com:8080"` (port preserved, happy path).
- `Settings(dispatcher_lock_path="./mathion.lock")` → `ValidationError` (relative path rejected — cwd-dependent trap).
- `Settings(dispatcher_lock_path="mathion.lock")` → `ValidationError` (bare relative).
- `Settings(dispatcher_lock_path="/tmp/mathion.dispatcher.lock")` → `"/tmp/mathion.dispatcher.lock"` (absolute happy path).
- `Settings(dispatcher_lock_path="/var/run/mathion/dispatcher.lock")` → `"/var/run/mathion/dispatcher.lock"` (production-style absolute).

## 11. Retry + error model

- `MAX_ATTEMPTS = 5` (inlined).
- Backoff between attempts (cumulative): immediate, then **5m, 30m, 2h, 6h**. Total retry window ≈ 8.5h before give-up.
- Permanent failure → `error = <msg[:500]>`, `next_attempt_at = NULL` (no auto-retry).
- Exhausted retries → `error = "max attempts: <last_msg[:480]>"`, `next_attempt_at = NULL`. The two prefixes are mutually exclusive (separate branches in §5 dispatcher).

`backend/mathion/notifications/errors.py` (flattened to ~25 LOC):

```python
import smtplib, socket

TRANSIENT_EXCS = (
    ConnectionRefusedError, TimeoutError, socket.gaierror,
    smtplib.SMTPServerDisconnected,
)
# Note: smtplib.SMTPHeloError and SMTPConnectError are NOT listed here. Both
# inherit from smtplib.SMTPResponseException, so the isinstance check below
# routes them by their 4xx/5xx response code — a 5xx HELO failure correctly
# classifies permanent. Listing them in TRANSIENT_EXCS would shadow that
# routing but the inheritance order makes the listing dead code regardless.
#
# SMTPSenderRefused and SMTPRecipientsRefused are NOT blanket-permanent.
# SMTPSenderRefused inherits from SMTPResponseException and carries
# smtp_code/smtp_error → routed through the SMTPResponseException branch
# below. SMTPRecipientsRefused inherits directly from SMTPException and
# carries a {recipient: (code, resp)} dict — a 4xx code (e.g. 450 greylist,
# 451 server-overload) must retry. We collapse by "any 5xx → permanent,
# else transient" which matches RFC 5321 semantics for the per-row dispatch
# (we send to ONE recipient per message, so the dict has 0 or 1 entries).

def classify(exc: BaseException) -> str:
    """RFC 5321: 4xx = transient (retry), 5xx = permanent (don't retry)."""
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        # Per-recipient code dict. Empty dict → permanent (defensive; should
        # not happen since smtplib always populates on raise).
        if not exc.recipients:
            return 'permanent'
        codes = [code for code, _msg in exc.recipients.values()]
        # Policy: any 5xx → permanent. All-4xx → transient. Non-4xx-non-5xx
        # codes (smtplib uses `-1` for malformed-reply sentinels; 2xx-other
        # codes are theoretically possible but should not raise here) are
        # neither 4xx nor 5xx, so the "any 5xx" check is False AND the implicit
        # "else transient" path takes over. That's the right default: a
        # malformed-reply sentinel almost certainly means the connection state
        # is degraded; retry on next tick (the SMTP session will reconnect).
        return 'permanent' if any(500 <= c <= 599 for c in codes) else 'transient'
    if isinstance(exc, smtplib.SMTPResponseException):
        # Covers SMTPSenderRefused, SMTPAuthenticationError, SMTPHeloError,
        # SMTPDataError, SMTPConnectError, and bare SMTPResponseException.
        code = exc.smtp_code
        return 'transient' if 400 <= code <= 499 else 'permanent'
    if isinstance(exc, TRANSIENT_EXCS):
        return 'transient'
    return 'permanent'  # KeyError from render, ValueError from empty email, anything unknown
```

**Per-row error containment** is the responsibility of the §5 dispatcher: each row's success-commit and failure-commit are in separate try blocks, with explicit `db.rollback()` between them so a `PendingRollbackError` cannot leak into the next row.

## 12. Test plan

### Backend (~95 new tests)

**`test_notifications_mailer.py`** (~12 tests):
- `MemoryMailer.send` appends to `.sent` (inside session()).
- `MemoryMailer.session()` enters/exits cleanly with no state.
- `FileMailer.send` writes parseable `.eml` to outbox; filename has timestamp + kind + uuid.
- `FileMailer.send` writes 2 distinct files for 2 sends within the same millisecond (uuid disambiguates).
- `FileMailer.send` uses atomic rename (writes `.eml.tmp` first).
- **Defense-in-depth: kind allow-list (path traversal).** `FileMailer.send` called with `X-Mathion-Kind="../../tmp/evil"`: assert `list(self.outbox.iterdir())` has exactly one `.eml` AND `(self.outbox.parent / "tmp" / "evil").exists() is False`. The filename contains `"unknown"`, never the traversal substring.
- **Defense-in-depth: kind allow-list (slash + backslash).** `FileMailer.send` called with `X-Mathion-Kind="/etc/passwd"` (and separately, `"foo\\bar"`): both write a `.eml` inside `self.outbox` with `"unknown"` in the filename.
- **Defense-in-depth: kind allow-list (missing/empty).** Two sub-cases: (a) message with NO `X-Mathion-Kind` header (`msg.get("X-Mathion-Kind", "unknown")` returns the default `"unknown"` because the `.get` call passes `"unknown"` as the default — both branches of the conditional then route to `"unknown"`); (b) message with `X-Mathion-Kind=""` (empty string is not in TEMPLATES.keys(), so also maps to `"unknown"`). Both write a `.eml` named `…-unknown-….eml`.
- **Defense-in-depth: derived from TEMPLATES.** Use `monkeypatch.setitem(TEMPLATES, "future_kind", lambda ctx: ("s","b"))` (pytest's `monkeypatch` auto-reverts the dict mutation in fixture teardown — naked `TEMPLATES["future_kind"] = …` leaks into other tests in the same process and is a footgun). Then call `FileMailer.send` with `X-Mathion-Kind="future_kind"`, assert the filename contains `"future_kind"` (NOT `"unknown"`). Proves the allow-list is derived from `TEMPLATES.keys()`, not a hand-kept frozenset that would drift. NOTE: rev 9 added `@functools.cache` on `_allowed_kinds()`; the test MUST call `FileMailer._allowed_kinds.cache_clear()` immediately after `monkeypatch.setitem` (and again in fixture teardown) so the patched TEMPLATES dict is observed. The cache_clear in teardown is critical: without it, the cached frozenset (including `"future_kind"`) survives into other tests even after monkeypatch reverts the dict.
- `FileMailer` auto-creates outbox dir.
- `FileMailer` fails loud if outbox path exists as a file.
- `SMTPMailer.session()` opens connection + STARTTLS + AUTH; `send()` calls `send_message`; `__exit__` quits cleanly.
- `SMTPMailer.send()` without surrounding `session()` raises `AssertionError`.
- `SMTPMailer` propagates `SMTPRecipientsRefused`, `SMTPConnectError`, `TimeoutError` unchanged.
- `SMTPMailer` reuses connection across multiple `send()` calls in one `session()` (mock verifies one SMTP construction).
- `build_mailer_from_settings` returns the right class per mode; raises on missing SMTP config; raises on unknown mode; returns None for `disabled`.

**`test_notifications_errors.py`** (~16 table cases, parametrized):
- ConnectionRefusedError, TimeoutError, socket.gaierror, SMTPServerDisconnected → 'transient'.
- `SMTPHeloError(421, "...")`, `SMTPConnectError(450, "...")` (4xx codes) → 'transient' (route via the `SMTPResponseException` branch).
- `SMTPHeloError(500, "...")`, `SMTPConnectError(550, "...")` (5xx codes) → 'permanent' (route via the same branch — this is the fix for the rev 4 bug where the dead `TRANSIENT_EXCS` entries shadowed the response-code routing).
- SMTPResponseException(421), (450), (451), (452) → 'transient' (4xx).
- SMTPResponseException(500), (535), (550), (551), (553) → 'permanent' (5xx).
- `SMTPSenderRefused(450, "...", "from@x")` → 'transient' (4xx, routed via SMTPResponseException branch).
- `SMTPSenderRefused(550, "...", "from@x")` → 'permanent' (5xx).
- `SMTPRecipientsRefused({"a@x": (450, "greylist"), "b@x": (451, "overload")})` → 'transient' (all 4xx).
- `SMTPRecipientsRefused({"a@x": (550, "no such user")})` → 'permanent' (any 5xx).
- `SMTPRecipientsRefused({"a@x": (450, "greylist"), "b@x": (550, "no such user")})` → 'permanent' (any 5xx wins).
- `SMTPRecipientsRefused({})` → 'permanent' (defensive — empty dict shouldn't occur from smtplib but defaults to permanent).
- `SMTPRecipientsRefused({"a@x": (-1, "malformed reply")})` → 'transient' (smtplib's `-1` malformed-reply sentinel; not 5xx, so transient — connection state likely degraded, retry on next tick reconnects).
- KeyError, ValueError, LookupError, generic Exception → 'permanent'.

**`test_notifications_templates.py`** (~14 tests):
- Each of the 4 kinds renders subject + body with all placeholders.
- `user.full_name=None` → falls back to `user.email`.
- CRLF in `run.title` → `msg["Subject"] = subject` raises `ValueError` (Python EmailMessage default policy). Classify-table test asserts this classifies `permanent`.
- `mini_project_title(mp.block)` is used in `evaluation_received` and `mini_project_published` template bodies (matches in-app UI label — verified by mocking `mini_project_title` and asserting it's the value rendered into the body).
- `_run_url` returns bare `/courses/{slug}/runs/{id}` (no `?tab=` / `?mp=` query strings — deep-link parsing deferred per §6.2 NOTE).
- `_run_url` does not double-slash when `base_url` already has trailing slash stripped at config-load. **Note**: this is really testing the Pydantic field validator at `config.py`; the spec keeps the test here for convenience but it could equally live in `test_config.py`.
- **NEW: `RenderContext.course_slug` `@property` derives live** — construct a `RenderContext` whose `run.version.course.slug` is `"old-slug"`; mutate the slug to `"new-slug"`; read `ctx.course_slug` → assert `"new-slug"` (proves derivation rather than snapshot field).
- Special chars (`"`, `&`) in titles render cleanly into subject + body.
- `render('unknown_kind', ctx)` raises `KeyError`.
- `mini_project_published` template body contains the result of `mini_project_title(ctx.mp.block)` (NOT raw `mp.id`).

**`test_notifications_dispatcher.py`** (~20 tests, frozen `now`):
- Happy path single row: picked, sent, `sent_at` stamped, `MemoryMailer.sent` length 1.
- Happy path 3 rows in batch: all sent, `MemoryMailer.sent` ordering matches `created_at` ascending then `id` ascending.
- `tick` returns the row count (3 in the happy-path-3-rows test, 0 on empty selection).
- Selective skip: 1 ready + 1 sent + 1 errored → tick processes 1, ready one is the one sent.
- `next_attempt_at` boundary: row with `next_attempt_at == now` IS picked (inclusive); row with `next_attempt_at == now + 1s` is NOT.
- Batch size honored: 30 ready rows → first 20 processed.
- Transient failure on 1st send → retry_count=1, next_attempt_at=now+300s.
- Transient failure on 2nd send → retry_count=2, next_attempt_at=now+1800s.
- Transient failure on 3rd send → retry_count=3, next_attempt_at=now+7200s.
- Transient failure on 4th send → retry_count=4, next_attempt_at=now+21600s.
- Transient failure on 5th send → retry_count=5, error="max attempts: …", next_attempt_at=NULL.
- Permanent failure (SMTPRecipientsRefused) on 1st send → error=str(exc), next_attempt_at=NULL, retry_count=1, NO "max attempts" prefix.
- **SMTP credential redaction**: simulate `mailer.send` raising `smtplib.SMTPAuthenticationError(535, b"535 5.7.8 Authentication credentials invalid for user@example.com")`. Tick. Assert `row.error == "SMTP authentication failed (see operator logs)"` (no username substring leaks into DB). Use pytest's `caplog` fixture with `caplog.set_level(logging.WARNING, logger="mathion.notifications")` — the §5 dispatcher uses `logger = logging.getLogger("mathion.notifications")` at module top; per §14 "Logger configuration" caveat, the canonical name is `mathion.notifications` (not `mathion.notifications.dispatcher` — a prior draft drifted; the live code pin is `mathion.notifications`). Assert at least one record in `caplog.records` has `record.exc_info` populated and `record.exc_info[1]` is the original `SMTPAuthenticationError` instance — the operator-debuggability contract is "full exception is in logs even though DB has the redacted sentinel." Do NOT assert via `caplog.text` substring match for the username: that would couple to log format. Assert object identity on the exception instance.
- Empty `user.email` → row's `error = "recipient has no email"`, permanent.
- Missing payload key (e.g. drop `mini_project_id` from an `evaluation_received` row) → permanent KeyError.
- Deleted referent (MP force-deleted before dispatch) → `error` contains "referent missing".
- Render-time uses fresh DB state, NOT payload (run title): insert row with payload `{"title": "OldName", ...}`, rename run to "NewName", tick → message body contains "NewName".
- Render-time uses fresh DB state, NOT payload (course slug): insert `run_enrolled` row with payload `{"course_slug": "old-slug", ...}`, rename `run.version.course.slug` to "new-slug", tick → message body URL contains `/courses/new-slug/runs/<id>` (the `@property` derives live from the entity graph, not the snapshot in `payload`).
- Per-row error containment: 3 rows, middle one raises → first + third stamp `sent_at`, middle one flagged in error.
- Commit-failure on success path (mock `db.commit` to raise once after `mailer.send` returns): row stays unsent (sent_at IS NULL), `row.error IS NULL`, `row.retry_count == 0` after the rollback. Second tick (with fresh `db.commit` working) re-sends and stamps sent_at (at-least-once promise from §14).
- Session-acquire failure (mock `mailer.session().__enter__` to raise): `tick()` returns 0; NO row's retry_count or next_attempt_at is incremented; structured warning logged (`logger.warning` captured). Verifies the infrastructure-vs-per-message split.
- Process-kill simulation: tick raises mid-batch → uncommitted state lost; next tick picks up unsent rows cleanly (no double-stamp, no poisoned session).
- SMTPMailer session reuse: 5 rows in one tick → mock verifies one `SMTP.__enter__` (mock `mailer.session()`); 5 `send_message` calls.
- **NEW: Lifespan refuses to start when lock is held.** Acquire the dispatcher lock externally (`fd = acquire_singleton_lock(settings)` in the test process), then attempt to enter `with TestClient(app):` — assert `RuntimeError` propagates from lifespan with the "Another Mathion dispatcher process holds…" message. Verifies the §5 `acquire_singleton_lock` failure mode wires through FastAPI lifespan correctly. (Uses `monkeypatch.setattr(settings, 'dispatcher_lock_path', str(tmp_path / 'dispatcher.lock'))` per the §12 lock-tests pattern.)
- **NEW: Lifespan shutdown with mid-batch in-flight tick.** Use `MemoryMailer` subclass that sleeps 2s on `send()`. Insert 20 notification rows. Start the lifespan (`async with lifespan(app):` — the FastAPI `@asynccontextmanager` defined in §5 line ~441 is exposed as `lifespan`), wait until at least one send has begun (poll `len(mailer.sent) > 0` with `await asyncio.sleep(0.1)` between checks so the worker thread can make progress), then trigger shutdown (`app.state.shutdown.set()`). Lifespan must drain or cancel within `SHUTDOWN_TIMEOUT_SECONDS=30`. Assert: (a) lifespan exits cleanly — no `"Task was destroyed but it is pending"` message from the `asyncio` logger; (b) some rows may have `sent_at` stamped, others NULL — at-least-once promise allows that.
  - **Capture mechanism (critical detail):** asyncio's "Task was destroyed but it is pending!" is emitted via `loop.call_exception_handler(...)` → `BaseEventLoop.default_exception_handler` → `logger.error(...)` on the `asyncio` Python logger (verified in CPython 3.14 `asyncio/base_events.py`). It is **NOT** emitted via `warnings.warn`. Use `caplog` scoped to the asyncio logger at ERROR level — `pytest.warns()` / `recwarn` would silently miss it and the assertion would no-op. Concrete pattern:
    ```python
    caplog.set_level(logging.ERROR, logger="asyncio")
    # ... exercise lifespan shutdown ...
    leaked = [r for r in caplog.records
              if "Task was destroyed but it is pending" in r.getMessage()]
    assert not leaked, "asyncio leaked a pending task at shutdown"
    ```
  - **Test runner setup**: this is the only async test in the suite. Add `pytest-asyncio>=0.23` to `backend/pyproject.toml` `[project.optional-dependencies] dev` (or the project's existing dev-deps grouping). Mark the test with `@pytest.mark.asyncio` (preferred — explicit, scoped) rather than enabling auto-mode. The existing conftest's autouse `setup_db` fixture is sync and compatible; the async test will await it as needed.
  - The test exercises the §5 `task.cancel()` + `await asyncio.wait_for(task, timeout=5)` drain logic, currently untested.

**`test_notifications_lock.py`** (~6 tests, NEW):
- All tests use `monkeypatch.setattr(settings, 'dispatcher_lock_path', str(tmp_path / 'dispatcher.lock'))` so pytest-xdist parallelism and any real running app process can't collide on the global `/tmp/mathion.dispatcher.lock`.
- (1) `acquire_singleton_lock(settings)` returns an open fd when no other process holds the lock.
- (2) Second `acquire_singleton_lock` call (in the same process via two fds, OR via a forked subprocess) raises `RuntimeError` with the documented "Another Mathion dispatcher process holds…" message.
- (3) Closing the returned fd releases the lock (third call succeeds).
- (4) `acquire_singleton_lock` opens the file at the configured `dispatcher_lock_path` (default `/tmp/mathion.dispatcher.lock`); honors override (the override is exercised by every other test in this file).
- (5) When `MATHION_EMAIL_MODE=disabled`, the lifespan never calls `acquire_singleton_lock` (assertion: `(tmp_path / 'dispatcher.lock').exists() is False` after `with TestClient(app):` — and `app.state.lock_fd is None` AND `app.state.mailer is None` as direct verification).
- (6) **non-`BlockingIOError` fd-leak regression test** — proves rev 4's try/finally + success-flag rewrite is exercised. Recommended pattern (Mock-based, no raw-fd manipulation):

    ```python
    def test_acquire_singleton_lock_closes_fd_on_non_blocking_error(monkeypatch, tmp_path):
        monkeypatch.setattr(settings, 'dispatcher_lock_path', str(tmp_path / 'dispatcher.lock'))

        # Capture the file object so we can assert close() was called.
        real_open = builtins.open
        captured = {}
        def wrapped_open(path, mode, *args, **kwargs):
            f = real_open(path, mode, *args, **kwargs)
            captured['fd'] = f
            captured['close_spy'] = unittest.mock.Mock(wraps=f.close)
            f.close = captured['close_spy']
            return f
        monkeypatch.setattr(builtins, 'open', wrapped_open)

        monkeypatch.setattr(fcntl, 'flock',
                            unittest.mock.Mock(side_effect=OSError("simulated EBADF")))

        with pytest.raises(OSError, match="simulated EBADF"):
            acquire_singleton_lock(settings)

        captured['close_spy'].assert_called_once()
    ```

    The `.close` spy is the contract being tested: rev 4's try/finally + success-flag rewrite guarantees the file is closed on ANY exception from `fcntl.flock`, not just `BlockingIOError`.

**`test_notifications_migration.py`** (~6 tests):

**Critical test-isolation requirement.** The autouse `setup_db` fixture at `backend/tests/conftest.py:64` calls `Base.metadata.create_all(engine)` against the test DB — which means by the time any test runs, the schema already includes the post-upgrade columns. A migration test that imports the autouse fixture would NOT exercise pre-upgrade schema, defeating the entire test. Implementer MUST:

1. **Opt out of the autouse fixture** in this file: at the top of `test_notifications_migration.py`, override with a no-op autouse fixture for this module (`@pytest.fixture(autouse=True) def setup_db(): yield`) — pytest resolves nearest-scope autouse, so a module-level override wins over the parent conftest's.

2. **Patch `settings.database_url` BEFORE invoking Alembic, NOT just `alembic_cfg.set_main_option`.** `backend/alembic/env.py:28` reads `settings.database_url` and **overwrites** whatever URL is set on the Alembic config object — so calling `alembic_cfg.set_main_option("sqlalchemy.url", db_url)` alone has no effect. The migration will run against the global conftest DB. The implementer MUST also monkeypatch the settings singleton:

   ```python
   from datetime import datetime, timezone
   from pathlib import Path

   from alembic import command
   from alembic.config import Config
   from sqlalchemy import create_engine
   from sqlalchemy.orm import sessionmaker

   from mathion.config import settings
   from mathion.notifications.dispatcher import tick
   from mathion.notifications.mailer import MemoryMailer

   # Resolve alembic.ini cwd-independently. Pytest's cwd is `backend/` (per
   # backend/pyproject.toml `testpaths = ["tests"]`), so a literal
   # `Config("backend/alembic.ini")` would resolve to `backend/backend/alembic.ini`
   # and FileNotFoundError. Anchoring to __file__ survives any future
   # restructure of where tests run from.
   ALEMBIC_INI = str(Path(__file__).resolve().parent.parent / "alembic.ini")

   def test_migration_backfill(tmp_path, monkeypatch):
       db_url = f"sqlite:///{tmp_path}/migration_test.db"

       # CRITICAL: patch the live `settings` singleton BEFORE alembic.command.*.
       # backend/alembic/env.py:28 unconditionally runs
       # `config.set_main_option("sqlalchemy.url", settings.database_url)` at
       # module-import time, BEFORE the offline/online code paths branch — so
       # whatever URL we set on `alembic_cfg` below is overwritten. The only
       # way to redirect the migration to our tmp DB is to mutate the
       # singleton's attribute. The conftest's MATHION_EMAIL_MODE setup already
       # constructed the singleton (per §12 conftest changes), so this is a
       # mutation of an existing instance — not a re-construction.
       monkeypatch.setattr(settings, "database_url", db_url)

       alembic_cfg = Config(ALEMBIC_INI)
       # NOTE: env.py:28 overwrites sqlalchemy.url for both online AND offline
       # migration paths (the unconditional set_main_option runs before
       # is_offline_mode is checked). So we do NOT need to call
       # `alembic_cfg.set_main_option(...)` here — the monkeypatch alone is
       # what makes the redirection work. Leaving the recipe minimal.

       # Pin BOTH revisions explicitly. "head" would run all pending migrations
       # if another slice's migration also exists in versions/. Use the actual
       # revision identifier of THIS slice's migration file.
       PRIOR_REV = "<this migration's down_revision>"     # determined when file is created
       THIS_REV  = "<this migration's revision>"          # the new file's revision identifier

       command.upgrade(alembic_cfg, PRIOR_REV)
       # ... seed pre-upgrade rows into notification_log via raw SQL ...

       command.upgrade(alembic_cfg, THIS_REV)             # run ONLY this slice's migration

       # For tests that need the dispatcher: construct a NEW Session bound to
       # the tmp DB. The global `SessionLocal` from `mathion.database` is bound
       # at module import-time to the conftest DB engine and does NOT pick up
       # the settings.database_url monkeypatch — the engine binding is frozen.
       # `tick(db, mailer, *, now)` accepts any sync Session, so the local
       # sessionmaker is sufficient.
       tmp_engine = create_engine(db_url)
       LocalSession = sessionmaker(bind=tmp_engine)
       with LocalSession() as db:
           mailer = MemoryMailer()
           processed = tick(db, mailer, now=datetime.now(timezone.utc))
           assert processed == 0
           assert len(mailer.sent) == 0
   ```

3. **Discovering the revision identifiers**: the new migration file's `revision = "..."` and `down_revision = "..."` lines are at the top of every Alembic migration. The implementer sets them when creating the migration via `alembic revision -m "notification_dispatcher_columns"`; both strings are then known at spec-implementation time. The test must hard-code them so a future migration added by another slice doesn't accidentally chain into this test's `command.upgrade` call.

The implementer should NOT skip this isolation step "because the tests pass anyway" — they will pass falsely (asserting the post-upgrade schema matches the post-upgrade expectation because the autouse fixture set it up that way), giving zero coverage of the migration itself.

Tests:
- After upgrade, existing rows have `sent_at = NOW()`.
- After upgrade, new rows (inserted via raw SQL bypass to verify DB default not ORM default) have `retry_count=0`, `next_attempt_at NULL`, `error NULL`.
- Downgrade drops the 3 columns.
- Downgrade preserves `sent_at` backfill (insert row pre-upgrade with sent_at=NULL, upgrade, downgrade, assert sent_at IS NOT NULL).
- Migration uses `batch_alter_table` (verified by inspecting migration file source for `with op.batch_alter_table`).
- **Dispatcher filters out backfilled rows.** Insert a pre-upgrade row with `sent_at=NULL`. Run upgrade. Construct `MemoryMailer`, call `tick(db, mailer, now=datetime.now(timezone.utc))`. Assert `tick()` returns 0 AND `len(mailer.sent) == 0` — the row's `sent_at` was stamped non-NULL by the backfill `UPDATE` and the dispatcher's `sent_at.is_(None)` clause excludes it. This is the safety net that makes the SQLite naive-vs-aware timestamp asymmetry benign (per §3 note).

**Publish-gate / trigger-side fix tests** (~18 tests across `test_run_roster.py` + new file):
- `add_student` returns 409 with TOP-LEVEL `error_code="run_unpublished"` (parse `response.json()`, assert `body["error_code"] == "run_unpublished"` AND `body["detail"]` is the message string — NOT nested under `body["detail"]["error_code"]`). The literal `"run_unpublished"` is the CONTRACT between backend and frontend; this assertion is the wire-shape contract test.
- **NEW: backend↔frontend constant parity** — backend `RUN_UNPUBLISHED_ERROR_CODE` constant (from `run_roster.py`) `== "run_unpublished"` exactly (a frontend mirror test reads `RUN_UNPUBLISHED_ERROR_CODE` from `runRoster.ts` and asserts the same literal). If either side ever renames the constant, CI catches it.
- **NEW: OpenAPI 409 schema** — `client.get('/openapi.json')`; navigate to `paths["/api/runs/{run_id}/students"]["post"]["responses"]["409"]`; assert it exists, that the example matches the spec'd top-level wire shape (`{"detail": "Cannot add students to an unpublished run", "error_code": "run_unpublished"}`); same assertion for `/students/batch`. Guards against the `responses={409: ...}` decorator being silently removed in a refactor.
- `add_students_batch` returns 409 (whole-batch, not per-row 207) on unpublished run. Verify 0 RunStudent and 0 NotificationLogEntry rows after.
- `PATCH /api/runs/{rid}/students/{uid}` (group move) still 200 on unpublished run.
- `DELETE /api/runs/{rid}/students/{uid}` still 204 on unpublished run.
- `bulk-move` still 207 on unpublished run AND writes 0 `run_enrolled` log rows.
- `bulk-delete` still 207 on unpublished run AND writes 0 log rows.
- `enroll_user_in_run` on NEW RunStudent writes `run_enrolled` log row.
- `enroll_user_in_run` on EXISTING RunStudent with new `group_id` (move) does NOT write log row.
- `enroll_user_in_run` on EXISTING RunStudent with `group_id=None` (unassign) does NOT write log row.
- `publish_run` writes 0 `run_published` log rows (loop removed).
- Existing `test_publish_writes_run_published_notification_per_student` deleted; verify no lingering reference.
- MP publish writes `mini_project_published` log row per student (excluding disabled-group students).
- MP publish with no students writes 0 rows.
- MP publish on a run with one disabled group + one enabled group only writes log rows for the enabled-group students + ungrouped students.
- MP re-publish on an ALREADY published MP: endpoint returns its normal idempotent success status (no 409 introduced by this slice — §7.3); 0 NEW `mini_project_published` rows written. **Rigorous assertion**: capture `before_ids = set(db.execute(select(NotificationLogEntry.id).where(NotificationLogEntry.kind=='mini_project_published')).scalars())` AND `before_count = len(before_ids)` BEFORE the re-publish call; re-publish; capture `after_ids` / `after_count`; assert `after_count == before_count` AND `after_ids == before_ids` (set-equality, not just count). The set-equality catches a buggy delete+reinsert that would happen to land the same count; the count alone would pass falsely.
- **Concurrent MP publish dedup** (`.with_for_update()` regression): simulate two transactions calling `publish_mini_project` on the same draft MP. Either via two `Session()` instances OR via `threading.Thread` with engine-level connection pool. Assert: after both commit, `notification_log` contains exactly `len(roster)` `mini_project_published` rows (not `2*len(roster)`). One of the two endpoint calls returns its normal success status without writing log rows (the second-to-commit one sees `was_published=True` under the row lock). On SQLite this test may run in serialized mode (single writer) and the lock behavior is effectively SERIALIZABLE; on Postgres the test exercises the actual `SELECT ... FOR UPDATE` semantics. Document the SQLite caveat in the test docstring.
- MP publish rolled back (transaction rollback): no notification log rows persist.

**Existing-test audit** (cataloged):
- `backend/tests/conftest.py::seed_run_with_groups` — rewrite to publish-then-enroll. The fixture already adds a teacher (line 230) before the publish call (line 235), so publish-time `teacher_count > 0` is satisfied. Used by 10 dependent test files.
- `backend/tests/test_run_roster.py::_make_run` → rename `_make_published_run`. Must add a teacher (`POST /api/runs/{rid}/teachers`) before publishing (publish endpoint enforces `teacher_count > 0` at `runs.py:189`); without this, ~17 student-POST sites would fail at the publish step. Also add `_make_draft_run` (no publish, no teacher) for new 409-gate tests.
- `backend/tests/test_run_roster_bulk.py::_make_run`, `_add_student` — same publish-with-teacher pattern.
- `backend/tests/test_teaching.py::test_student_count_multiple` — explicit publish + teacher before enroll.
- `backend/tests/test_run_notifications.py` — flip order, drop `run_published` expectations, add `run_enrolled` and `mini_project_published` post-publish.
- `backend/tests/test_runs.py::test_publish_with_groups_enabled_unassigned_student_409` — the test posts to `/students` on an unpublished run (broken by the new gate). **Rewrite along the canonical unpublish/republish workflow** (see §2 file-touched detail above): the publish-time unassigned-students 409 path at `runs.py:192-199` IS reachable in production via `publish → add student with group_id=None → unpublish (runs.py:239-248) → republish`. Deletion would drop real coverage; ORM-bypass would skip the canonical workflow.
- `backend/tests/test_run_teachers.py::_make_run` is NOT in this audit (R3 verified the file never POSTs to `/students` — was incorrectly listed in rev 2).

**Files verified to NOT need edits** (cataloged so the auditor can confirm every POST-to-/students hit was considered, not just the changed ones):
- `backend/tests/test_run_permissions.py` — GET-only, no /students POSTs.
- `backend/tests/test_dashboard_item_drilldown.py` — GET-only.
- `backend/tests/test_groups.py` — **partially covered by fixture rewrite, no `_make_run` edit needed.** Verified at `backend/tests/test_groups.py:10` this file defines its own `_make_run` helper, BUT that helper's downstream tests only POST to `/groups` (NOT `/students`). The `/students` POSTs at lines 95-101 belong to tests that consume `seed_run_with_groups` from the parent conftest — once the fixture is rewritten to publish-before-add (the §12 conftest change above), those tests are covered. So: (a) the `_make_run` helper here does NOT need a publish-with-teacher amendment (no `/students` POSTs route through it), (b) the `seed_run_with_groups`-fixture tests inherit the fix. Implementer should still verify by running the suite after the fixture rewrite. (Codex external review flagged this as an audit miss; R12 verification narrowed the actual scope.)

### Frontend (~7 new tests)

**Test pattern (mandatory):** all new component tests use `import { mount, unmount, flushSync } from 'svelte';` — NOT `@testing-library/svelte`. Create a `target` div per test, mount, call `flushSync()` after each state change, query the DOM, `unmount` in `afterEach`. See `frontend/src/tests/RunMiniProjectsTab.svelte.test.ts` for the canonical helper template (`mountMpTab`, defaults builder, `flushSync()` after props change).

**Verification step (mandatory):** after the `export type ActiveTab` change at `RunDetailPage.svelte:30` lands AND the new `import type { ActiveTab }` lines are added to `RunRosterTab.svelte`, run `npm --prefix frontend run check` (svelte-check). It MUST report 0 errors. svelte-check catches type-import resolution failures that runtime tests can't see.

In `frontend/src/tests/RunRosterTab.draft-gate.svelte.test.ts`:
- Banner visible when `runIsPublished=false`; not visible when `runIsPublished=true`.
- Add button has native `disabled` attribute when `runIsPublished=false`.
- Import buttons (toolbar + empty-state CTA) disabled when `runIsPublished=false`.
- `submitAdd` early-returns on Enter-keypress when `runIsPublished=false` (no fetch fires).
- 409 with `error_code=run_unpublished` from add path → inline error rendered with `role="alert"`, message shown.
- Move + delete actions remain enabled on Draft (regression guard for §8).

In `frontend/src/tests/RosterImportModal.unpublished.svelte.test.ts`:
- Submit-step 409 with `error_code=run_unpublished` rendered inline with `role="alert"`.

(Preview-step 409 test from rev 1 dropped: preview is client-side `parseCsv` with no network call.)

### Conftest changes

- `backend/tests/conftest.py`:
  - Rewrite `seed_run_with_groups` to publish-before-enroll. (Existing fixture already adds a teacher before publish, so no new step needed.)
  - Add fixture `memory_mailer()` with explicit function-scope and `return` (not `yield`):

    ```python
    @pytest.fixture  # default scope='function' — a fresh MemoryMailer per test
    def memory_mailer():
        return MemoryMailer()
    ```

    Function scope is essential — module/session scope would let one test's `.sent` list leak into another's assertions. Tests pass the fixture directly to `tick(db, mailer, now=...)`; there is no FastAPI `Depends` to override since the dispatcher takes the mailer as a positional argument. No teardown needed (no SMTP connection, no file handle).
  - **`disable_dispatcher_loop` mechanism** (top-of-conftest, not a fixture): the existing `backend/tests/conftest.py:9-13` currently performs FIVE mathion imports — `mathion.config`, `mathion.database`, `mathion.main`, `mathion.models_auth`, `mathion.auth`. `mathion.config` is the FIRST to land at line 9, and `config.py:29` constructs the `Settings()` singleton at module-import time. Implementer MUST:
    1. **Relocate** the existing five mathion import lines below the env block. (A mechanical "add lines at the top" without moving the existing imports leaves the singleton already-constructed before the env var is set — the race the recipe is meant to close.)
    2. **Add** `os.environ.setdefault('MATHION_EMAIL_MODE', 'disabled')` as the FIRST non-future statements at the top of the file.
    3. **Add** a `pytest_configure(config)` hook (also at conftest top, after the env block but before fixtures) that re-reads `settings.email_mode` and asserts `settings.email_mode == 'disabled'` — fail loud if any race or plugin loader sneaks an earlier mathion import in. This guards against future contributors reordering imports or adding pytest plugins that import application modules during collection.

    Concrete pattern at the top of `conftest.py`:

    ```python
    # ---- MUST RUN BEFORE any mathion.* import — Settings() in config.py:29
    # is constructed at import time and snapshots MATHION_EMAIL_MODE.
    import os
    os.environ.setdefault('MATHION_EMAIL_MODE', 'disabled')

    # ---- Safe now: existing mathion imports moved here (was lines 9-13).
    from mathion.config import settings
    from mathion.database import Base
    from mathion.main import app
    from mathion.models_auth import User
    from mathion.auth import auth_helpers  # etc. — exact import list preserved

    def pytest_configure(config):
        # Belt-and-suspenders: if any prior plugin auto-import landed before
        # the env block, this fails the run early instead of silently leaking
        # SMTP attempts.
        assert settings.email_mode == 'disabled', (
            f"Test conftest race: settings.email_mode is {settings.email_mode!r} but "
            "the disable_dispatcher_loop recipe expects 'disabled'. Some plugin "
            "imported mathion.config before the os.environ.setdefault block. "
            "Move imports or remove the offending plugin.")
    ```

    The `client` fixture (using `TestClient(app)`) triggers `lifespan` which sees `mode=disabled` and skips both `build_mailer_from_settings` and `acquire_singleton_lock`. Individual dispatcher tests construct their own `MemoryMailer` and call `tick()` directly with frozen now; they never go through `TestClient`/lifespan. This avoids:
    1. Real SMTP attempts during tests.
    2. The advisory lock being held across the test session (each test run would otherwise need to acquire+release).
    3. The async loop running concurrently with tests.

## 13. Manual smoke walkthrough

With `MATHION_EMAIL_MODE=file`, `MATHION_EMAIL_OUTBOX=/tmp/mathion-outbox/`, `MATHION_BASE_URL=http://localhost:8000`:

1. Start server. Verify `/tmp/mathion-outbox/` was created (FileMailer outbox) and `/tmp/mathion.dispatcher.lock` exists (singleton-dispatcher lock at the §10-configured `MATHION_DISPATCHER_LOCK_PATH`). The lock file and the outbox are SEPARATE paths — the lock is never written inside the outbox.
2. Try to start a second uvicorn process. **Verify** it refuses to start with the multi-worker error message.
3. Log in as admin. Create a Draft run on calc-101 with `groups_enabled=true` (required by `publish_mini_project` precondition at `mini_projects.py:76`; without this, step 8.5 MP-creation 409s). Open Roster tab. **Verify** the "Publish this run before adding students" banner appears at top of `.roster-tab`, Add + Import buttons + empty-state CTA are disabled, and the banner contains a "Publish on Overview" link.
4. POST `/api/runs/<id>/students` bypassing UI (so the gate fires on the backend, not the frontend). The endpoint requires `require_run_admin_or_teacher`, so the request needs the admin's `session_token` cookie:
   - Easiest: open DevTools → Network on the admin browser, right-click the failing UI request → "Copy as cURL". This preserves `session_token` AND the JSON body.
   - Manual: read the cookie value (`document.cookie` in console), then `curl -X POST http://localhost:8000/api/runs/<id>/students -b "session_token=<value>" -H "Content-Type: application/json" -d '{"email": "anyone@example.com"}'`.
   
   **Verify** HTTP 409 with body exactly `{"detail": "Cannot add students to an unpublished run", "error_code": "run_unpublished"}` — TOP-LEVEL `error_code`, not nested under `detail` (this matches `frontend/src/lib/api.ts:46`'s read site `body.error_code`; see §8).
4.5. **Assign a teacher BEFORE publishing.** Open the Teachers tab. POST `/api/runs/<id>/teachers` (or use the UI) to assign one teacher. **Required:** `publish_run` enforces `teacher_count > 0` at `runs.py:186` — publishing without a teacher 409s with `"At least one teacher must be assigned"`. **Verify** the teacher appears in the list. (Note: this is a manual smoke step, but the `RunTeacher` row insert triggers `run_teacher_assigned` — step 8 below verifies the `.eml` arrives. Since the run is still unpublished, the dispatcher's `_build_render_context` does NOT suppress this — `run_teacher_assigned` is not gated on `run.is_published`, only `run_enrolled` is per §6.2.)
5. Publish the run. Verify the banner disappears, controls re-enable, and a `.eml` for the previously-assigned teacher appears in `/tmp/mathion-outbox/` if it hadn't already (the teacher-assigned event from step 4.5 may have already been dispatched by an earlier tick depending on timing — be patient or wait one 30s tick).
6. Add a student via UI. **Verify** a `.eml` appears in `/tmp/mathion-outbox/` with subject "You've been enrolled in <run title>", body link is exactly `http://localhost:8000/courses/calc-101/runs/<id>` (no `?tab=…` or `?mp=…` query strings — deep-link parsing is deferred to a future slice).
7. Move the same student to a different group. **Verify** no new `.eml` appears (trigger-side fix from §7.1; helper unaffected by group move).
8. Assign a SECOND teacher to the run (the first was already assigned in step 4.5 to satisfy `publish_run`'s `teacher_count > 0` precondition). **Verify** a new `.eml` arrives addressed to this second teacher with subject "You're teaching <run title>".
8.5. **Create a mini-project on the run.** Switch to the Mini-projects tab. Click "Create mini-project". Fill required fields per `publish_mini_project` precondition (`mini_projects.py:271-274`): pick a block, write a short assignment markdown body, set `hard_deadline = today + 30 days`, set `resubmission_deadline = today + 45 days`, Save. **Verify** the MP appears as Draft in the list. (No notification fires on creation — only on publish.)
9. Publish the mini-project just created. **Verify** a `.eml` per roster student with subject "New mini-project in <run title>". (Bulk import of 200 students → 200 emails trickle out at `BATCH_SIZE=20` per 30-sec tick; full drain ≈ 5 minutes.) **Verify** also that clicking Publish a second time on the same MP does NOT generate new `.eml` files (the `was_published` snapshot guard fires; §7.3).
10. As a student, submit a mini-project file. Switch to teacher. Write an evaluation. **Verify** a `.eml` per group member with subject "New evaluation in <run title>".
11. **Per-row backoff test.** Point at a real SMTP server that ACCEPTS the session (STARTTLS + AUTH succeed) but REJECTS a specific recipient — e.g., a local fake-SMTP like `aiosmtpd` with a controller that returns `550 mailbox unavailable` for `bad@example.com`. Trigger a new event whose recipient is `bad@example.com`. **Verify** row's `error` is set (permanent for 5xx) OR `retry_count` increments and `next_attempt_at` is populated (transient for 4xx). The point of this step is to exercise the per-row retry/error path AFTER the session is successfully acquired.
12. **SMTP-config wedge test.** Set `MATHION_EMAIL_MODE=smtp`, `MATHION_SMTP_HOST=localhost`, `MATHION_SMTP_PORT=1` (port 1 → `ConnectionRefusedError` at `mailer.session().__enter__()`). Restart app. Trigger a new event so a row is queued (the dispatcher's early `if not rows: return 0` returns 0 silently when no rows are ready — without a queued row, the wedge log doesn't fire). **Verify** dispatcher logs `notifications: failed to acquire mailer session (... rows queued): ...` on each tick AND row state is unchanged (no `retry_count` increment, no `error` flag) — this is the infrastructure-vs-per-message split from §5 + §14 "SMTP-config wedge." Admin recovers by fixing config and restarting.

## 14. Known caveats (documented)

- **At-least-once delivery.** If the process is killed *after* `mailer.send()` returns but *before* the success-path `db.commit()` stamps `sent_at`, the row is re-claimed on next tick (or next app start) and sent again. The alternative (pre-stamp / at-most-once) would silently drop emails on any crash. Per-row commit failure is treated identically (row stays unsent, retried). Mid-batch crashes can re-send up to `BATCH_SIZE - 1` extra emails on the next tick (other unstamped rows in the killed batch).
- **Single-process dispatcher, advisory-lock enforced.** The lifespan acquires an exclusive `flock` on the file at `MATHION_DISPATCHER_LOCK_PATH` (default `/tmp/mathion.dispatcher.lock` per §10). The lock lives OUTSIDE the outbox dir on purpose: tying it to the outbox would mean two processes with different `MATHION_EMAIL_OUTBOX` settings could each acquire their own lock and silently double-send (the cwd-relative trap §10 calls out). A second uvicorn worker holding the same lock-path config refuses to start. When Mathion moves to multi-worker or Postgres, replace the lock with `SELECT … FOR UPDATE SKIP LOCKED` on the claim query.
- **Shutdown timeout 30s.** On `app.state.shutdown.set()`, the lifespan awaits the dispatcher task with a 30-second timeout. If a mid-flight tick blocks longer, the task is cancelled. (In-flight SMTP sends may still leak a duplicate on the next start per the at-least-once rule.)
- **Admin manual recovery races with the dispatcher.** The recovery SQL — `UPDATE notification_log SET error=NULL, retry_count=0, next_attempt_at=NULL WHERE id=…` — must be run with the dispatcher stopped (`MATHION_EMAIL_MODE=disabled` and restart, or wait for an idle tick window). Concurrent recovery + dispatcher claim can silently overwrite each other. Documented constraint, not a code-level guard.
- **Migration backfill must run with the app down.** The backfill `UPDATE notification_log SET sent_at = NOW()` marks any in-flight unsent rows as already-sent. Stop the app before running the migration.
- **Mail-server burst.** A 200-student MP publish queues 200 rows; the dispatcher drains at `BATCH_SIZE=20` per tick (30s) → 5-minute drain. Consider this for sender-reputation rules at your SMTP provider.
- **SMTP-config wedge.** If `MATHION_SMTP_HOST` is unreachable, `MATHION_SMTP_PASSWORD` is wrong, or any other condition prevents `mailer.session().__enter__()` from succeeding, the dispatcher logs a structured warning on every tick and processes 0 rows — but does NOT increment any row's `retry_count` or set `error`, because the failure is infrastructure-level (the same wrong config would fail all rows identically, immediately burning the entire retry budget within minutes). The wedge is loud in logs and silent in DB; admin recovers by fixing the env vars and restarting. Configuration is validated at startup (host + username + password all non-empty when `mode=smtp`), so a missing field fails the app boot rather than entering this wedge state.
- **Email URL strategy.** Email links use the bare run URL `{base_url}/courses/{slug}/runs/{id}` (no `?tab=` / `?mp=` query strings). `RunDetailPage` does not currently parse those query strings; a future slice can add deep-link parsing, after which the URL helper in `templates.py:_run_url` can be updated to include the relevant query strings.
- **MP title consistency.** Email subjects/bodies use `mini_project_title(mp.block)` (e.g., "Mini project for Block 3") for parity with the in-app UI label that the recipient sees after clicking the link.
- **Orphan `notification_log` rows after Run / MP delete.** `NotificationLogEntry` has a `user_id` FK with `ON DELETE CASCADE` (verified at `models_auth.py:98`) — when a user is deleted, their queued rows are removed. There is no equivalent cascade on `payload["run_id"]` or `payload["mini_project_id"]` (the payload is JSON, not an FK column). If a Run or MiniProject is deleted while a notification row is unsent, the dispatcher's `_build_render_context` raises `LookupError("referent missing: …")`, classifies it `permanent`, and stamps the row's `error` field. The row stays in the DB forever, never delivered. This is a documented limitation, not a bug — out-of-scope items §15 lists "Notification log GC" as deferred. Admin can manually `DELETE FROM notification_log WHERE error LIKE 'referent missing:%'` to clean up.
- **Recipient address resolved at send time, not trigger time.** `_build_render_context` (§6.1) does `db.get(User, row.user_id)` and `_build_email_message` reads `ctx.user.email` at render time. If a user changes their email between an event firing and the dispatcher draining the row (typically seconds to minutes; up to 8h under retry), the email goes to the NEW address. This is acceptable for the slice (the email metadata — "evaluation received" etc. — is not sensitive by itself). Revisit when notification preferences and per-event verification land.
- **Course slug rename behavior.** The `RenderContext.course_slug` `@property` derives from `run.version.course.slug` at render time. A rename between trigger and dispatch IS reflected. Even within a single tick: SQLAlchemy's `expire_on_commit=True` (the default `SessionLocal` setting in Mathion) expires all attributes on the `course` instance after each row's success-commit, so the next row's render re-fetches the slug. The only window where a rename would NOT be seen is "within the same row's render→send→commit boundary," which is microseconds and not a real operational concern. (If a future change sets `expire_on_commit=False` on `SessionLocal`, this caveat needs to be revisited.)
- **`asyncio.to_thread` shutdown semantics.** If a sync `mailer.send` is blocking inside `asyncio.to_thread` when `SHUTDOWN_TIMEOUT_SECONDS` expires, the lifespan cancels the task and the cancel+drain runs — but the underlying thread keeps executing until the SMTP call returns. `asyncio.to_thread` uses the default `ThreadPoolExecutor`, whose worker threads are **NOT** daemon threads in CPython 3.14 (verified at `concurrent/futures/thread.py:34`); `asyncio.runners.Runner.close()` joins the default executor at shutdown (`asyncio/runners.py:74`). So a hung in-flight SMTP call **does** delay process exit until the SMTP timeout fires (the §4 `smtplib.SMTP(host, port, timeout=30)` constructor sets a 30s socket timeout, so worst-case the process waits ~30s after `SHUTDOWN_TIMEOUT_SECONDS` for the hung thread to error out and join). Operators relying on quick `SIGTERM`-to-exit should size their orchestration grace period accordingly (`uvicorn --timeout-graceful-shutdown 60` or higher). If the row hadn't committed `sent_at` before the cancel, the at-least-once rule re-sends on next start (§14 first bullet).
- **Logger configuration.** §5 uses `logger = logging.getLogger("mathion.notifications")`. Mathion relies on uvicorn's default root logger for output; `logger.warning` and `logger.exception` propagate to stderr at uvicorn's configured level. If a production deploy reconfigures logging (custom root handler, `dictConfig`, or `--log-level error`), ensure the `mathion.notifications` logger remains at `WARNING` or below — otherwise the §13 step 12 wedge log AND the per-row permanent-failure logs will be silently dropped. There is NO dedicated handler attached in slice 1.

## 15. Out of scope (deferred)

- **User opt-out preferences** — no `UserNotificationPreference` table. Everyone qualifying for an event gets the email.
- **HTML email** — plain-text only.
- **In-app notification center** — separate slice.
- **Multi-worker dispatcher** — advisory lock enforces single-process today (see §14).
- **`new_submission_received` teacher event** — defer.
- **PIN-email migration** — login PIN currently logs to console via `MATHION_DEBUG`. Defer (auth-path risk + sync/async UX design needed).
- **Admin "retry failed" UI** — manual SQL only this slice (see §14).
- **Notification log GC** — no auto-pruning of old `sent_at IS NOT NULL` rows.

## 16. Operator runbook

Quick reference for the operator running Mathion with the notifications dispatcher live. All commands assume `MATHION_EMAIL_MODE=smtp` (or `file`) and a running uvicorn process.

**Is the dispatcher alive?**

Tail the logger output and look for warning/error entries from the `mathion.notifications` logger:

```bash
# Production (systemd unit / managed log path):
tail -f /var/log/mathion/uvicorn.log | grep -E 'mathion\.notifications|dispatcher'

# Dev / foreground uvicorn (logs go to stdout, not a file):
#   1. Run uvicorn with structured logging visible, e.g.
#      `uvicorn mathion.main:app --log-level info 2>&1 | tee /tmp/mathion.log`
#   2. Tail the captured file:
#      `tail -f /tmp/mathion.log | grep -E 'mathion\.notifications|dispatcher'`
# Or just watch the uvicorn process stdout directly.
```

The dispatcher is silent on the happy path (no log per successful send). Three signs of life (use any combination):

1. **No `"dispatcher tick failed; continuing"`** lines accumulating (means the tick is running but throwing).
2. **`sent_at IS NOT NULL` count strictly increases** as new events fire. Run this twice with a known event triggered in between (e.g., publish a draft MP). **Wait at least one tick cycle (~30-60s; TICK_SLEEP_SECONDS=30 plus SMTP latency)** between the two count reads — running the SQL back-to-back may show no change even when the dispatcher is healthy:
   ```sql
   SELECT COUNT(*) FROM notification_log WHERE sent_at IS NOT NULL;
   ```
   The "ready and waiting" count can sit at zero in steady state (no events firing), so it alone is NOT a sound liveness signal — but a strictly-increasing sent count after a known trigger IS.
3. **Lock file is held by the running uvicorn PID** — see "Lock file location" below. If uvicorn is up but nothing holds the lock, the dispatcher never started (likely `MATHION_EMAIL_MODE=disabled` or a crashed lifespan task).

If you see `"dispatcher tick failed; continuing"` repeating: read the exception traceback in the next log line, check whether `MATHION_EMAIL_MODE != disabled`, verify SMTP config matches the destination server.

**Count queued vs failed rows**

```sql
-- Queued (ready or backing off)
SELECT COUNT(*) FROM notification_log
 WHERE sent_at IS NULL AND error IS NULL;

-- Backing off (not ready yet)
SELECT COUNT(*) FROM notification_log
 WHERE sent_at IS NULL AND error IS NULL AND next_attempt_at > CURRENT_TIMESTAMP;

-- Permanently failed
SELECT COUNT(*) FROM notification_log WHERE error IS NOT NULL;

-- Failed with specific error message (e.g. orphaned referent)
SELECT id, kind, error FROM notification_log WHERE error LIKE 'referent missing:%';
```

**Retry a failed row** (e.g. transient outage flagged it permanent in error):

```sql
-- Reset one row by id.
UPDATE notification_log
   SET error = NULL, retry_count = 0, next_attempt_at = NULL
 WHERE id = <id>;
```

⚠ Run this with the dispatcher stopped (`MATHION_EMAIL_MODE=disabled` + restart) per §14 "Admin manual recovery races with the dispatcher."

**Stop / start the dispatcher**

- **Stop:** set `MATHION_EMAIL_MODE=disabled`, restart the app. The lifespan sees `mode=disabled` and skips both `build_mailer_from_settings` and `acquire_singleton_lock`. Queued rows accumulate; no send attempts. Restart with the original mode to drain.
- **Start:** set `MATHION_EMAIL_MODE=smtp` (or `file`), restart. Lifespan acquires the singleton lock and starts `run_forever`.

**Cleanup orphaned rows** (per §14 caveats):

```sql
-- Delete rows whose referent was hard-deleted (no auto-GC in slice 1).
DELETE FROM notification_log WHERE error LIKE 'referent missing:%';
```

**Force-drain a backed-off row** (e.g. for testing):

⚠ This UPDATE is RACY against a live dispatcher: the dispatcher's claim SELECT and the operator's UPDATE both run without coordination, so the row may be claimed AND drained in the same tick — the result is "row sends one tick earlier than its backoff said," which is benign for force-drain semantics. But if the operator wants to **inspect** the row before letting it send (e.g. patch the payload), stop the dispatcher first per "Stop / start the dispatcher" below. Mirror the §14 admin-manual-recovery warning.

```sql
UPDATE notification_log
   SET next_attempt_at = NULL
 WHERE sent_at IS NULL AND error IS NULL AND id = <id>;
```

**Lock file location**

Default `/tmp/mathion.dispatcher.lock` (set via `MATHION_DISPATCHER_LOCK_PATH`; see §10). On macOS `/tmp` is symlinked to `/private/tmp`. To verify the dispatcher holds it:

```bash
fuser /tmp/mathion.dispatcher.lock  # Linux
lsof /tmp/mathion.dispatcher.lock   # macOS
```

## 17. Spec change log (rev 1 → 15)

For implementer reference. Each entry summarizes what the corresponding review round changed in the spec.

### Rev 14 → Rev 15

Thirteenth-round Opus verification of rev 14. The R12+R13 reviewers had focused on the env.py-override mechanic — rev 14 fixed that. R13 then asked itself "what's the third-time-wrong wrinkle?" and found it:

Bug-class:
1. **§12 `Config("backend/alembic.ini")` → `ALEMBIC_INI` cwd-independent path.** Pytest runs from `backend/` (per `backend/pyproject.toml` `testpaths = ["tests"]`), so `Config("backend/alembic.ini")` would resolve to `backend/backend/alembic.ini` and `FileNotFoundError` on first run. Implementer would then "fix" it by hand — potentially in a way that bypasses the env.py-override workaround (e.g. by setting `MATHION_DATABASE_URL` env-var, missing the singleton-mutation requirement). Rev 15 uses `Path(__file__).resolve().parent.parent / "alembic.ini"` for cwd-independence.

Implementer-readiness:
2. **§12 recipe imports completed.** Rev 14 used `datetime.now(timezone.utc)` and `Path(...)` but omitted `from datetime import datetime, timezone` and `from pathlib import Path` from the import block. Copy-paste of the recipe would `NameError`. Rev 15 adds both imports plus moves the `from sqlalchemy.orm import sessionmaker` to the module-top import block (was previously inside the function body).
3. **§12 misleading `set_main_option` "belt-and-suspenders" comment removed.** R13 verified that env.py:28 overwrites for BOTH online AND offline migration paths (the `set_main_option` runs unconditionally before `is_offline_mode` is checked). Rev 15 drops the `set_main_option` call entirely as vestigial; the monkeypatch is the load-bearing fix. Recipe is more minimal and the rationale is no longer factually wrong.
4. **§12 `engine` → `tmp_engine` rename** in the recipe. Visual de-collision with the `mathion.database.engine` module-global; readability nit but improves the recipe's at-a-glance correctness.

### Rev 13 → Rev 14

Second external Codex review (R2) verified all 10 prior R1 findings as fixed but flagged 2 fresh Importants in the rev 12 migration-test isolation recipe + 2 Minors.

Bug-class:
1. **§12 migration test isolation recipe completed.** Rev 12 prescribed `alembic_cfg.set_main_option("sqlalchemy.url", db_url)` to point Alembic at the tmp DB, but `backend/alembic/env.py:28` reads `settings.database_url` and **overwrites** whatever URL is set on the config object. Test would run against the global conftest DB, defeating isolation. Rev 14 fix: implementer MUST also `monkeypatch.setattr(settings, "database_url", db_url)` BEFORE invoking `command.upgrade`. Full code recipe added including the necessary `sessionmaker(bind=engine)` for the dispatcher-filter test (the global `SessionLocal` from `mathion.database` is bound at import-time and doesn't pick up the monkeypatch).

2. **§12 `command.upgrade(..., "head")` → pinned revisions.** `"head"` runs ALL pending migrations; if another concurrent slice adds a migration, the test would silently exercise both. Rev 14 fix: spec mandates pinning BOTH the prior revision (this migration's `down_revision`) and this migration's own `revision` identifier explicitly. Code recipe shows `PRIOR_REV` and `THIS_REV` placeholders the implementer fills in when creating the migration file.

Minor:
3. **§11 `SMTPRecipientsRefused` non-4xx/non-5xx policy made explicit.** smtplib's `getreply()` can produce `-1` for malformed-reply sentinels. Current "any 5xx → permanent, else transient" routes those transient — correct default (degraded connection, retry reconnects), but rev 14 adds the explicit comment AND a test case for `(-1, "malformed reply")`.

4. **§17 rev 11→12 changelog item 5 annotated `[SUPERSEDED by rev 13]`.** The text described rev 12's over-corrected `_make_run`-edit prescription; rev 13 narrowed it. Without the annotation, an implementer reading the changelog could follow the rev 12 text and waste effort. Mirror of the prior §16/§17 stale-reference annotations.

### Rev 12 → Rev 13

Twelfth-round Opus verification of rev 12. 0 Criticals; one Important — rev 12's `test_groups.py` audit overstated the scope. Codex flagged the original "all POSTs route through `seed_run_with_groups`" claim as an audit miss; rev 12 over-corrected by prescribing `_make_run` edits AND per-test audits. R12 verified that `_make_run` in that file routes only to `/groups`, not `/students`; the `/students` POSTs at lines 95-101 belong to tests consuming `seed_run_with_groups` from parent conftest. Rev 13 narrows the prescription: no `_make_run` edit needed in `test_groups.py`; the fixture rewrite already covers all `/students` POSTs in that file.

### Rev 11 → Rev 12

External Codex review (model_reasoning_effort=high, sandbox read-only). Pattern shift: the 10 internal rounds had calibrated on the spec's own claims; Codex verified line-by-line against the actual codebase + library source and surfaced bug-class defects the internal loop missed. 2 Criticals + 6 Importants + 2 Minors applied.

Bug-class:
1. **§11 classify() — SMTPSenderRefused and SMTPRecipientsRefused removed from `PERMANENT_EXCS`.** `SMTPSenderRefused` inherits from `SMTPResponseException` → routes via the 4xx/5xx code branch (a 450 greylisting now retries; previously was permanently dropped). `SMTPRecipientsRefused` carries a per-recipient `{recipient: (code, resp)}` dict — new branch collapses "any 5xx → permanent, else transient." Test parametrization extended with 6 new cases covering both classes at 4xx and 5xx, plus empty-dict defensive.
2. **§10 MATHION_BASE_URL validator hardened.** Added rejection of: ASCII whitespace (`\t`, ` `, `\xa0`), userinfo (`user:pass@host` — the `https://mathion.example.com@attacker.com` phishing form browser-resolves to `attacker.com`), invalid port (forces `parsed.port` evaluation which raises `ValueError` on `:bad` or out-of-range), query string (breaks `_run_url`'s path concatenation), fragment. Test list extended with 10 new cases.

Implementation-readiness:
3. **§14 asyncio.to_thread shutdown caveat corrected.** Prior text claimed default-executor threads are daemon → process exit unblocked. **Wrong** for CPython 3.14 (verified at `concurrent/futures/thread.py:34` + `asyncio/runners.py:74`): threads are non-daemon and `Runner.close()` joins them. Updated to describe the actual behavior (process exit delayed up to the SMTP socket timeout ≈30s after `SHUTDOWN_TIMEOUT_SECONDS`), with operator guidance to size orchestration grace period (`uvicorn --timeout-graceful-shutdown 60` or higher).
4. **§13 smoke walkthrough step order fixed.** Prior steps 3-5 published the run BEFORE assigning a teacher, but `publish_run` enforces `teacher_count > 0` at `runs.py:186` — the smoke as written cannot pass. Added step 4.5 (teacher-assign before publish) and updated step 8 (assign a SECOND teacher, since 4.5 already covered the first). Step 3 also pins `groups_enabled=true` on the run (`mini_projects.py:76` enforces this for MP creation, blocking step 8.5).
5. **§12 test_groups.py audit corrected.** [SUPERSEDED by rev 13 — see "Rev 12 → Rev 13" entry above.] Prior claim "all POSTs go through `seed_run_with_groups`" was an audit miss. Rev 12 over-corrected: prescribed `_make_run` edit + per-test audit. R12 verification (rev 13) narrowed: `_make_run` only POSTs to `/groups`, not `/students` — no edit needed. The fixture rewrite alone covers all `/students` POSTs in that file.
6. **§12 migration test isolation prescribed.** The autouse `setup_db` fixture at `backend/tests/conftest.py:64` calls `Base.metadata.create_all(engine)` → migration tests as previously specified would assert post-upgrade schema against a DB that ALREADY has the post-upgrade schema, passing falsely with zero migration coverage. Spec now mandates: (a) opt out of autouse in this file; (b) create a separate Alembic-managed DB per test via `tmp_path`; (c) bind `SessionLocal` to the tmp DB for the dispatcher-filter test.
7. **§10 dispatcher_lock_path Pydantic validator added.** Rejects relative paths at boot (the cwd-relative trap). Concrete code snippet + 4 test cases (`./mathion.lock`, bare relative, absolute happy paths).
8. **§3 alembic claim softened.** Prior text "every prior migration follows this pattern [batch_alter_table]" was wrong — `9959211d…:24,152` uses bare `op.add_column`/`op.drop_column`. Reframed: this slice ADOPTS batch for its specific needs, not because the repo universally does.

Minors:
9. **§12 FileMailer no-header test text corrected.** Prior bullet said "`.get()` returns `None`" but the spec code at §4 uses `msg.get("X-Mathion-Kind", "unknown")` (with default). Both branches route to `"unknown"`; the bullet now describes the actual behavior.
10. **§12 SMTP credential redaction caplog logger name pinned to `"mathion.notifications"`.** Prior text alternated between `mathion.notifications.dispatcher` and "module-level logger" — verified the §5 module sets `logger = logging.getLogger("mathion.notifications")`, so that's the canonical name. Aligned with §14 "Logger configuration" caveat.

### Rev 10 → Rev 11

Tenth-round Opus verification of rev 10. Verified the §7.3 SQLAlchemy API swap (refresh→select+populate_existing+scalar_one) end-to-end against SA 2.0.49 source: identity-map override ✅, NoResultFound raise path ✅, import path ✅, Postgres FOR UPDATE emission ✅, identity-equal reassignment ✅. But caught 1 fresh rev-10-introduced Critical + 1 Important.

Bug-class fix:
1. **§12 mid-batch-shutdown test capture mechanism corrected.** Rev 10 specified `pytest.warns()` / `recwarn` to catch the `"Task was destroyed but it is pending!"` warning, claiming asyncio emits it via `warnings.warn` from `BaseEventLoop.__del__`. **Wrong**: verified in CPython 3.14 source (`asyncio/tasks.py:115-124` + `asyncio/base_events.py:1838-1886`) that the message is emitted via `loop.call_exception_handler(...)` → `BaseEventLoop.default_exception_handler` → `logger.error(...)` on the `asyncio` Python logger. `pytest.warns()` / `recwarn` only catch the `warnings` module — they would silently miss the message and the assertion would no-op (test passes even when the §5 cancel/drain regression is present). Rev 11 switches the capture pattern to `caplog.set_level(logging.ERROR, logger="asyncio")` plus `assert not any("Task was destroyed but it is pending" in r.getMessage() for r in caplog.records)`.

Refactor-safety / important:
2. **§7.3 `mp_id = mp.id` captured to a local before the refetch.** Today `select(MiniProject).where(MiniProject.id == mp.id)` evaluates `mp.id` before the reassignment, so it works. But if a future edit splits the build/execute or moves the `select(...)` into a helper, a stale-reference bug becomes possible. Cheap belt-and-suspenders that matches the §10 single-source-of-truth principle for important values.

Also: the §17 changelog entry for rev 9→10 propagated the wrong `warnings.warn` rationale — left intact for historical accuracy but the live spec text in §12 + the rev 10→11 changelog entry above record the correct mechanism.

### Rev 9 → Rev 10

Ninth-round Opus verification of rev 9. Caught 1 Critical introduced BY rev 9 (the ObjectDeletedError handler caught the wrong exception class) + 2 Importants. User opted to fix all 3.

Bug-class fix:
1. **§7.3 exception class corrected and approach simplified.** Rev 9 caught `sqlalchemy.orm.exc.ObjectDeletedError` from `db.refresh(mp, with_for_update=True)`, but `Session.refresh()` actually raises `sqlalchemy.exc.InvalidRequestError` with message `"Could not refresh instance '%s'"` when the row was deleted (verified against SA 2.0.49 source — `ObjectDeletedError` is raised from `load_scalar_attributes` in `loading.py:1686`, a different code path). The rev 9 except clause as written would never fire and the operator would still see a 500 on the deleted-row race. **Rev 10 switches the entire approach**: use `db.execute(select(MiniProject).where(...).with_for_update().execution_options(populate_existing=True)).scalar_one()` instead of `db.refresh()`. This (a) achieves the same identity-map-overriding refresh (R7's `populate_existing=True` alternative), (b) raises `sqlalchemy.exc.NoResultFound` — a public, documented, unambiguous exception class — when the row is missing, with no substring-matching required on InvalidRequestError messages. Catch is now `except NoResultFound: raise HTTPException(404, "MiniProject not found")`.

Test plan / runbook:
2. **§12 mid-batch-shutdown test specifies async runner setup.** Rev 9 added the test but didn't pin `pytest-asyncio` or specify whether to use `@pytest.mark.asyncio` vs auto-mode. Rev 10 prescribes `pytest-asyncio>=0.23` added to `backend/pyproject.toml` dev deps, `@pytest.mark.asyncio` decorator (explicit, scoped — not auto-mode), `recwarn`/`pytest.warns()` for the "Task was destroyed" assertion (NOT caplog — asyncio emits via `warnings.warn`, not logging), and `await asyncio.sleep(0.1)` between mailer.sent polls so the worker thread yields.
3. **§16 liveness signal #2 adds "wait one tick" hint.** Operator running the SQL back-to-back may see no change even when dispatcher is healthy (TICK_SLEEP_SECONDS=30 + SMTP latency). Reframed: "wait at least one tick cycle (~30-60s)" between count reads.

Detail-string consistency:
4. **§7.3 404 detail string `"MiniProject not found"`** matches `get_or_404`'s convention (verified at `backend/mathion/api/helpers.py`); rev 9 had `"Mini-project not found"` (hyphenated). Frontend / existing test assertions on the 404 message stay aligned.

### Rev 8 → Rev 9

Eighth-round Opus review (rev 8 verification + net-new defects with adversarial fresh-eyes). 0 fresh Criticals (the rev 8 `db.refresh(mp, with_for_update=True)` fix was verified correct against SQLAlchemy 2.x source). 10 Importants and ~10 Minors. User opted to apply all 10 Importants.

Spec-accuracy / framing:
1. **§4 lazy-import rationale corrected** (lines 201-204): templates.py does NOT textually import mailer.py (verified by reading the §6.2 import block) — there is no cycle. Restated as "minimize mailer.py's import-time graph" with the actual reason (avoid pulling templates.py's transitive `mathion.config + mathion.api.* + SQLAlchemy entity graph` deps during eager mailer construction in `build_mailer_from_settings`).
2. **§4 `_allowed_kinds()` memoized with `@functools.cache`** so the frozenset is constructed once per process instead of once per `send()` call. Negligible perf gain (4-key frozenset is ~µs), but expresses intent. Added `import functools` to §4 imports. **Test pattern impact**: the §12 derived-from-TEMPLATES test must call `FileMailer._allowed_kinds.cache_clear()` after `monkeypatch.setitem` AND in teardown, else the cached frozenset (with `"future_kind"`) survives into other tests.
3. **§12 TEMPLATES mutation uses `monkeypatch.setitem(TEMPLATES, "future_kind", fn)`** instead of naked dict mutation. Pytest auto-reverts; naked `TEMPLATES["future_kind"] = …` is a well-known module-state leak footgun.
4. **§8 OpenAPI 409 rationale claim corrected**: the spec said "existing endpoints under run_roster.py use the same `responses=` pattern" but `grep -rn "responses=" backend/mathion/api/` returns nothing. Reframed: this slice INTRODUCES the pattern; the OpenAPI test in §12 is the lock-in mechanism against silent decoration drops in refactors.
5. **§16 dispatcher-alive runbook reworked**: prior count-trend signal ("second count must be < first") had false-positive failure modes at steady-state zero or steady-state non-zero. Replaced with three independent signals: (a) no `"dispatcher tick failed; continuing"` log lines accumulating, (b) `sent_at IS NOT NULL` count strictly increases after a known triggered event, (c) lock file held by uvicorn PID.
6. **Header rev bump** `Status: draft rev 7` → `draft rev 9` and `Spec change log: rev 1 → 8` → `rev 1 → 9` (rev 8 forgot to bump the header).

Correctness / operational:
7. **§7.3 `ObjectDeletedError` handler added**. `db.refresh(mp, with_for_update=True)` raises `sqlalchemy.orm.exc.ObjectDeletedError` if the MP was deleted between `get_or_404` (mini_projects.py:264) and the refresh. Without the handler, the operator sees a SQLAlchemy-raw 500; with it, the endpoint returns a clean 404. Race window is tiny but real — would surface once-a-year-style production-only crashes.
8. **§14 "Course slug rename behavior" caveat rewritten**: prior text was factually wrong (claimed mid-tick renames would NOT be reflected). SQLAlchemy's `expire_on_commit=True` (default `SessionLocal` setting) expires attributes after each row's success-commit, so the next row's render re-fetches the fresh slug. Updated caveat states the actual behavior and notes the dependency on `expire_on_commit=True` for future-refactor durability.
9. **§10 `MATHION_BASE_URL` rejects path-prefix URLs**. Prior validator silently accepted `MATHION_BASE_URL=http://example.com/admin` and `_run_url` would produce `http://example.com/admin/courses/<slug>/runs/<id>` — almost always a config typo (operator pasted a specific admin route as the base). Validator now requires `parsed.path in ("", "/")`. If reverse-proxy path-prefix support is needed it gets a dedicated slice. Test cases added.

Test plan gaps:
10. **§12 new test: "Lifespan refuses to start when lock is held."** Acquires the lock externally then enters `with TestClient(app):` and asserts `RuntimeError` propagates. Verifies the §5 `acquire_singleton_lock` failure mode actually wires through FastAPI lifespan.
11. **§12 new test: "Lifespan shutdown with mid-batch in-flight tick."** Uses a sleep-injected `MemoryMailer` subclass, waits for at least one send to begin, triggers `app.state.shutdown.set()`, asserts the lifespan drains/cancels within `SHUTDOWN_TIMEOUT_SECONDS=30` and no `"Task was destroyed but it is pending"` warning appears in caplog. Exercises the §5 cancel+drain logic, currently untested.

### Rev 7 → Rev 8

Seventh-round Opus review (rev 7 verification + runbook + cross-spec consistency). Surfaced 1 fresh Critical (the rev 7 concurrency fix didn't actually work on Postgres) plus ~10 Importants. User opted to apply C1 + key Importants before Codex.

Bug-class verification fix:
1. **C1: `db.refresh(mp, with_for_update=True)` replaces `db.execute(select(...).with_for_update()).scalar_one()`** at §7.3. Rev 7 fix was incorrect: `mp` was already loaded by `get_or_404` at `mini_projects.py:264` and was sitting in the session identity map with `is_published=False` cached. SQLAlchemy 2.x's `Session.execute()` returns the cached instance with stale attributes when the row's PK is already identity-mapped — even though FOR UPDATE is emitted at the DB. Both Tx A and Tx B would still observe `was_published=False` and the dedup hole would remain open on Postgres. (SQLite hides this because SQLAlchemy strips FOR UPDATE on SQLite and DB-level write serialization masks the race.) `db.refresh(mp, with_for_update=True)` is the canonical single-call form that re-reads under lock AND repopulates the cached instance's attributes.

Bug-class Importants:
2. **`_FILEMAILER_ALLOWED_KINDS` → `_allowed_kinds()` classmethod derived from `TEMPLATES.keys()`** at §4. Hand-kept frozenset was a maintenance footgun: a future engineer adding a 5th kind would update TEMPLATES, dispatcher would render+send, but FileMailer would silently stamp `"unknown"` in the filename — confusing debugging session. Single source of truth (TEMPLATES). Lazy import inside the classmethod breaks the mailer.py → templates.py import cycle. New §12 test mutates TEMPLATES at runtime and asserts a new key is recognized.
3. **`MATHION_BASE_URL` CRLF / control-char guard** in §10 validator. `urllib.parse.urlparse` tolerates `http://example.com\r\nX-Inject:1` (routes the trailing junk into `path` or `fragment`). Without an explicit ASCII control-char check BEFORE `urlparse`, a header-injection-shaped value would pass validation and ship into email bodies. Added `if any(ord(c) < 0x20 or ord(c) == 0x7f for c in v): raise ValueError(...)` plus three new test cases (`\r\n`, `\x00`, happy-path trailing-slash strip).
4. **FileMailer kind allow-list test split** at §12 from one conflated bullet into 3 explicit sub-bullets (path traversal `../../tmp/evil`, slash/backslash, missing/empty header) plus a new **derived-from-TEMPLATES** test that mutates `TEMPLATES` at runtime and verifies the added key is recognized in filenames.
5. **SMTP credential redaction test capture pattern** at §12 made concrete: pytest `caplog` with explicit logger name + assertion on `record.exc_info[1] is original_exc` (object identity), NOT `caplog.text` substring match (would couple to log format).
6. **Test count corrected** ~88 → ~95 reflecting the new tests added in rev 6, rev 7, and rev 8.

Cross-spec / runbook Importants:
7. **§16 dispatcher-alive runbook usable in dev**: prior text assumed `/var/log/mathion/uvicorn.log` exists. Dev runs uvicorn in foreground; logs go to stdout. Added dev-mode tail-tee pattern and a behavioral signal-of-life query (count of ready-to-send rows over a 30s window — must trend down or rows must transition to `sent_at IS NOT NULL`).
8. **§16 force-drain race warning** added: the UPDATE is racy against a live dispatcher (claim SELECT and operator UPDATE uncoordinated). Benign for force-drain semantics (row sends one tick earlier than its backoff said); operators who want to inspect/patch before send should stop the dispatcher first. Mirrors the §14 admin-manual-recovery wedge warning.
9. **Stale §16 references in historical changelog** entries (rev 5→6 item §10 parenthetical + rev 4→5 item 17) now annotated with the "section number changed at rev 7" note. Two historical entries reference the spec change log as §16 because that's what it was numbered at the time; rev 7 inserted §16 Operator runbook and the change log shifted to §17.
10. **Rev 6→7 changelog item 9 framed accurately**: prior framing implied "naive vs aware asymmetry → backfill safety net," conflating the assertion with the mechanism. Reframed as "backfilled rows excluded by claim clause" (the actual test contract) plus a separate note that the same safety net incidentally makes the naive-vs-aware concern moot.

### Rev 6 → Rev 7

Sixth-round Opus review (rev 6 verification + net-new defects retry). 2 verification Importants + 3 net-new Criticals + ~10 net-new Importants. The net-new lens (security/concurrency/operational) had been under-examined for 5 prior rounds; R6 surfaced real issues. User opted to apply ALL findings including a new §16 Operator runbook.

Bug-class verification fixes:
1. **`RenderContext` import uncommented** in `_build_render_context` skeleton (§6.1) AND added to §5 dispatcher.py import block. Rev 6 left the import commented; as-written the skeleton would `NameError`.
2. **`RunVersion` → `CourseVersion` in §17 rev 4→5 historical entry** (rev 6 fixed the §6.1 occurrence but left this changelog reference).

Net-new Criticals:
3. **`FileMailer` X-Mathion-Kind path-traversal defense-in-depth.** `Path / kind` doesn't reject `..` or `/`. Today `kind` comes from server-controlled trigger sites, but a buggy future trigger or test seeding could write outside the outbox. Fix: allow-list `_FILEMAILER_ALLOWED_KINDS` in `FileMailer.send`; unknown kinds map to `"unknown"` (§4).
4. **`MATHION_BASE_URL` Pydantic `field_validator`.** Bare strip-trailing-slash was insufficient: `MATHION_BASE_URL=javascript:alert(1)` or attacker-controlled hosts would silently ship phishing URLs in every notification body. Validator requires `urllib.parse.urlparse(v).scheme in {"http","https"}` and non-empty netloc, fails boot on malformed input. Test added for `javascript:`, empty-netloc, and `file://` (§10).
5. **`publish_mini_project` row-level lock** via `.with_for_update()` on the MP re-fetch. Without it, two concurrent publish clicks both snapshot `was_published=False`, both insert N rows → 2N duplicate emails (no UniqueConstraint on (kind, user_id, payload) in `notification_log`). Concurrent-publish dedup regression test added with set-equality assertion (§7.3 + §12).

Net-new Importants applied:
6. **Defensive `__exit__` on session-acquire failure** in dispatcher (§5). Today `SMTPMailer.session()` is a `@contextmanager` generator whose `finally:` cleans up — but the `Mailer.session()` ABC is typed `AbstractContextManager[None]`; a future class-based subclass with an `__enter__` that raises mid-init would NOT have Python call `__exit__`. Explicit `__exit__` in the except branch covers it.
7. **SMTP credential leak prevention** in `error` column. `SMTPAuthenticationError` `__str__` can echo username/password fragments from the server's 535 response. Dispatcher now redacts to `"SMTP authentication failed (see operator logs)"` and logs the full exception via `logger.exception` (operator can debug; DB cannot leak). Test added (§5 + §12).
8. **Recipient address resolved at send time, not trigger time** — added as §14 caveat. User email changes between trigger and dispatch deliver to the new address.
9. **Backfilled rows excluded by dispatcher claim clause** — added a §12 `test_notifications_migration.py` test asserting that after the migration's `UPDATE notification_log SET sent_at = NOW() WHERE sent_at IS NULL` backfill runs, the dispatcher's `sent_at.is_(None)` claim clause excludes those rows (so old dev/test data isn't retroactively emailed). The naive-vs-aware timestamp asymmetry on SQLite is a related but separate concern that the same backfill safety net makes benign (it doesn't matter what timezone form the backfilled `sent_at` is in, because the dispatcher never re-claims a row with non-NULL `sent_at`).
10. **Migration partial-failure idempotency** — added recovery procedure in §3.
11. **Course slug rename behavior** — added §14 caveat (in-tick caching).
12. **`asyncio.to_thread` shutdown semantics** — added §14 caveat (daemon-thread default lets process exit cleanly even if a SMTP send is mid-flight).
13. **Logger configuration** — added §14 caveat ("ensure `mathion.notifications` stays at WARNING or below if you reconfigure root logging").
14. **Re-publish idempotency test rigor** — assertion strengthened from "count unchanged" to "set of ids unchanged" (catches buggy delete+reinsert that would land same count) (§12).
15. **§13 smoke step 8.5 MP creation** — explicit step between teacher-assign (step 8) and publish-MP (step 9), with the required fields per `publish_mini_project` preconditions. Step 9 also adds the "re-publish does NOT generate new `.eml`" verification.

New §16 Operator runbook:
16. Added §16 with operator quick-reference: how to tell the dispatcher is alive, count queued/failed rows, retry a failed row, stop/start the dispatcher, cleanup orphaned rows, lock file location.

### Rev 5 → Rev 6

Fifth-round Opus review (rev 5 verification + implementer-readiness + net-new defects). 0 fresh bug-class Criticals; rev 5's 7 R4-fixes all landed cleanly. The readiness reviewer found 7 Blockers + ~11 Importants that would force the implementer to ask follow-up questions before starting work. Rev 6 fixes those:

1. **`RunVersion` → `CourseVersion`** in §6.1 eager-load directive (the SQLAlchemy model class is `CourseVersion`, defined at `models.py:37`; `RunVersion` does not exist).
2. **§2 line 34 `_safe_header` orphan removed** — rev 5 deleted the helper from §6.2 but left the deliverable line in §2; implementer would have shipped dead code.
3. **`_build_render_context` defined** — added to §2 dispatcher.py file-touched bullet (~220 lines, was ~180) AND added a full code skeleton at the end of §6.1 showing imports (`CourseVersion`, `joinedload`, `settings`, etc.), the eager-load query, the pinned lookup order (Run → User → MP → Submission), the `LookupError("referent missing: …")` substrings, and the `RenderContext(...)` construction with `base_url=settings.base_url`.
4. **`_build_email_message` imports** — §6.3 now shows `from mathion.config import settings` at the templates.py module top so `settings.email_from` resolves; alternative of threading `email_from` through `RenderContext` is rejected (config is read at send time, not at row insert).
5. **§13 step 4 curl auth** — operator can't bypass the UI without `session_token`. Step now describes DevTools "Copy as cURL" or manual cookie-copy.
6. **§7.3 commit ordering pinned** — the existing `mp.is_published = True; db.commit()` at `mini_projects.py:293-294` must have the `db.commit()` RELOCATED to AFTER the notification-insert loop, so publish flip + notification rows live in one transaction (a rollback discards both). Spec snippet shows the exact placement.
7. **`memory_mailer` fixture decorator pinned** — `@pytest.fixture` (no explicit scope → default `function` scope) shown verbatim. Module/session scope would leak `.sent` lists between tests.

Importants:
- §9 banner CSS pointer: rev 5 incorrectly told the implementer to copy `.banner-info` from `RunMiniProjectsTab.svelte:340-346`, but that block defines only `.banner` (NOT `.banner-info`). Rev 6 prescribes option (a): use `class="banner"` only (no `.banner-info` variant) and copy from MP tab — visual consistency with the adjacent MP draft-banner the teacher sees one tab over. Option (b) requires copying `.banner-info` from `RunAssetsTab.svelte:909-913` separately and is visually divergent.
- §5 dispatcher.py code block now shows the full import list (`SessionLocal`, `NotificationLogEntry`, `classify`, `render`, `_build_email_message`).
- §6.1 `mp.block` eager-load: prescribe `joinedload(MiniProject.block)` explicitly (rev 5 said "verify"; rev 6 pins it).
- §9 `addError` claim corrected: the channel IS shared with the client-side duplicate-email check (`RunRosterTab.svelte:~292`), and that's fine — the dup check fires only on Add-button submit, not during typing, so `role="alert"` announces an actionable state.
- §10 env table count corrected: 8 → 9. Real count is 9 (rev 1=14 → rev 2=9 → rev 3=10 (`MATHION_DISPATCHER_LOCK_PATH`) → rev 5=9 (drop `MATHION_DISPATCHER_TICK_SECONDS`)). §2 count and §17 rev-1→2 parenthetical updated for consistency. (NOTE: this changelog entry was written when the spec change log was §16; rev 7 inserted the Operator runbook as §16 and the change log became §17. Reference updated here to point to the current section number.)
- §12 lock test #6 fd-leak recipe: rev 5 used `os.fstat(fd_int)` against `fd` returned from `open()`, but `open()` returns a `TextIOWrapper` (not an int) and `close()` releases the underlying fd before `os.fstat` can see it. Rev 6 prescribes a Mock-wrapped `.close` spy pattern with a full code snippet.
- §13 step 11 rewrite: rev 5 said "port=1 → ConnectionRefusedError → retry_count increments" but the `SMTPMailer.session()` opens the SMTP connection at `__enter__` time, so port=1 falls into the wedge state (session-acquire fail, return 0, no row state change) — contradicting the assertion. Rev 6 splits: step 11 tests per-row retry (real SMTP server that rejects a specific recipient), step 12 tests the wedge (port=1, observe wedge log).
- §14 caveats: added orphan-rows-on-Run/MP-delete note. `NotificationLogEntry` cascades on user delete (`models_auth.py:98`) but the run/MP references in `payload` JSON have no FK cascade, so deleting a Run or MP leaves rows marked permanent `LookupError`. Documented, not fixed (notification log GC is out of scope per §15).

### Rev 4 → Rev 5

Fourth-round Opus review (frontend / test plan / backend-concurrency / YAGNI lenses) caught 7 bug-class Criticals + ~15 bug-class Importants. User opted to hold all prior locked scope decisions (keep `mini_project_published`, `FileMailer`, advisory lock, `Mailer.session()` ABC).

Bug-class fixes:
1. Lifespan adds `await asyncio.wait_for(task, timeout=5); except (TimeoutError, CancelledError): pass` after `task.cancel()` so the cancelled dispatcher task drains its `CancelledError` cleanly (else `asyncio` emits "Task was destroyed but it is pending" at shutdown — backend C1).
2. §2 + §9 require an explicit `export` keyword change at `RunDetailPage.svelte:30` so `RunRosterTab.svelte`'s `import type { ActiveTab }` resolves (frontend C1).
3. `RosterImportModal.svelte` gets a new `submitError: string | null` state separate from `parsed.error` so `role="alert"` on the submit-step 409 doesn't fire on every preview-parse error during typing (frontend C2).
4. §2 + §12 rewrite `test_publish_with_groups_enabled_unassigned_student_409` along the real publish → add-without-group → unpublish → republish workflow (instead of deleting — the path IS reachable via the existing `unpublish_run` endpoint at `runs.py:239-248`; deletion would drop coverage of the `unassigned > 0` violation at `runs.py:192-199` — test C1).
5. §12 conftest recipe extended: env-set MUST precede all 5 current mathion imports (`mathion.config` is the first at `conftest.py:9`, not `mathion.main`); existing imports relocated below env block; new `pytest_configure` hook asserts `settings.email_mode == 'disabled'` to fail loud on race (test C2 + backend I5).
6. §12 lock tests 1-4 take a `monkeypatch.setattr(settings, 'dispatcher_lock_path', str(tmp_path / 'dispatcher.lock'))` so pytest-xdist parallelism doesn't collide on `/tmp/mathion.dispatcher.lock`; test #5 (disabled-mode-no-lock) likewise uses `tmp_path` (test C3).
7. New 6th lock test in `test_notifications_lock.py`: mock `fcntl.flock` to raise `OSError`, assert `acquire_singleton_lock(settings)` re-raises AND closes the open fd — proves rev 4's try/finally + success-flag fix is exercised (test C4).

Bug-class Importants:
8. `Mailer.session()` ABC drops `@contextmanager` from the base (`@abstractmethod` on a `...` body is sound; the stacked decorator wraps a non-generator body) and types the return as `AbstractContextManager[None]` (backend I2).
9. `classify()` removes `SMTPHeloError` + `SMTPConnectError` from `TRANSIENT_EXCS` (shadowed by `SMTPResponseException` branch); test plan parametrizes those exceptions with explicit 4xx vs 5xx codes (backend I3).
10. `_build_render_context` spec now mandates eager-load on the entity chain (`joinedload(Run.version).joinedload(CourseVersion.course)`) so the 20-row tick doesn't fan out to 60 extra SELECTs per render (backend I4). (Note: rev 5 originally wrote `RunVersion`, which does not exist as a class — rev 6 fixed the typo to `CourseVersion`; see rev 5 → 6 item 1.)
11. Frontend cleanup: spec calls out `RunMiniProjectsTab.svelte:35`'s narrower local union explicitly so "matches the existing pattern" is type-correctly framed; `@testing-library/svelte` ban added to §12 frontend test section; banner CSS source-pointer points to `RunMiniProjectsTab.svelte:340-346` for visual consistency with the adjacent draft-banner; `id="draft-publish-hint"` prefixed to `roster-draft-publish-hint`; svelte-check verification step added; a11y note that `role="status"` banner is the primary surface for the draft hint (frontend I1-I7).
12. Test plan: adds `RenderContext.course_slug` `@property` derivation test, backend↔frontend `RUN_UNPUBLISHED_ERROR_CODE` contract test, OpenAPI 409 schema test, "files verified to NOT need edits" audit cleanup; test counts reconciled (~88 backend + ~7 frontend); `memory_mailer` returns (not yields); `_build_render_context` spec pins lookup order so error-substring tests are deterministic; mutation test extended to course-slug rename (test I1-I9).

Non-conflicting YAGNI trims accepted:
13. `_safe_header` + `_HEADER_BAD_CHARS` deleted; Python's `EmailMessage` already raises on CR/LF in headers under the default policy, and the `\x00\x0b\x0c` paranoia has no real threat model — the resulting exception classifies permanent per §11 (YAGNI I7).
14. `_mp_title` helper inlined at the single call site in `_mini_project_published` (YAGNI I8).
15. `MATHION_DISPATCHER_TICK_SECONDS` env var dropped → inlined as `TICK_SLEEP_SECONDS = 30` module constant (YAGNI I10).
16. §9 banner-pointer paragraph trimmed to one sentence (YAGNI I12).
17. Rev 1→5 changelogs moved to this footer (was §16 at rev 5; rev 7 inserted §16 Operator runbook so this is now §17) so the implementer reaches §1 Scope at the top of the document (YAGNI I13).

### Rev 3 → Rev 4

Third-round Opus review caught 2 Criticals + several Importants introduced by rev 3 edits.

1. `onNavigateToTab` prop type pinned to a single `ActiveTab` union (imported from `RunDetailPage.svelte:30`) — was `'overview'|'roster'|'groups'|...` (invalid TS `...` literal) and `(tab: string) => void` in different places of the spec.
2. §7.3 publish endpoint stays **idempotent** — transition guard moves OFF the publish endpoint and ONTO the notification insert (`was_published = mp.is_published` snapshot taken before the flip; notifications fire only when `not was_published`). No new 409 on publish.
3. `.banner-info` source pointer corrected: copy from `RunAssetsTab.svelte:899-913` (the file that actually defines `.banner-info`) — rev 3 incorrectly cited `RunMiniProjectsTab.svelte:340-362`. (Rev 5 revised this to `RunMiniProjectsTab.svelte:340-346` for `.banner` base + visual consistency with the adjacent draft-banner; see rev 5 item 11.)
4. Frontend constant split: `BulkRosterErrorCode` (per-row union) is left UNCHANGED; `run_unpublished` (whole-call error) gets a separate top-level export `RUN_UNPUBLISHED_ERROR_CODE = "run_unpublished"` in `runRoster.ts` — rev 3 conflated per-row and whole-call error namespaces.
5. `acquire_singleton_lock` rewritten with `try/finally` + success flag to plug the fd leak on non-`BlockingIOError` exceptions (e.g. `OSError` from underlying syscalls).
6. §13 smoke step 4 wire shape corrected to top-level `{"detail": "Cannot add students…", "error_code": "run_unpublished"}` (was still showing the rev 2 nested shape that rev 3 §8 already discarded).
7. §13 smoke step 1 + §14 lock-path wording corrected: lock lives at `/tmp/mathion.dispatcher.lock` per §10, NOT `<outbox>/.dispatcher.lock`.
8. §8 adds explicit `responses={409: {...}}` OpenAPI decorator requirement for `add_student` + `add_students_batch`.
9. `RenderContext.course_slug` removed (denormalization YAGNI); replaced by a `@property` deriving from `run.version.course.slug` at render time.
10. `disable_dispatcher_loop` conftest recipe pinned to a concrete `os.environ.setdefault('MATHION_EMAIL_MODE', 'disabled')` at the top of `conftest.py` BEFORE any `mathion.*` import lands (the import constructs the `Settings()` singleton). `Mailer.session()` ABC kept (the no-op cost is one method per impl; collapsing it would require the dispatcher to branch on mailer type — net complexity worse).

### Rev 2 → Rev 3

Second-round Opus review pass closed all R1 Criticals cleanly but surfaced 8 fresh Criticals and ~20 Importants.

1. 409 wire shape changed from `HTTPException(detail={dict})` to `JSONResponse` with top-level `error_code` + string `detail` (matches what `api.ts:46` actually reads).
2. Email template URLs drop the `?tab=` / `?mp=` query strings because `RunDetailPage` doesn't parse them — use bare run URL.
3. `mini_project_published` trigger guarded by `if not mp.is_published` transition check + publish endpoint idempotency 409. (Rev 4 moved this guard OFF the endpoint and ONTO the notification insert; see rev 4 item 2.)
4. `_make_published_run` rewrite adds a teacher before publish (`runs.py:189` requires `teacher_count > 0`).
5. `courseSlug: string` added to `RunRosterTab` props.
6. `test_publish_with_groups_enabled_unassigned_student_409` added to test audit. (Rev 5 changed the recommended treatment from "delete or ORM-bypass" to "rewrite along the unpublish/republish workflow"; see rev 5 item 4.)
7. `mailer.session()` acquire-failure caught in `tick()` with structured warning + return 0 (prevents infinite log-spam tight loop on SMTP-config wedge).
8. Advisory lock path pinned to absolute default `/tmp/mathion.dispatcher.lock` via new env `MATHION_DISPATCHER_LOCK_PATH`.

Importants: `_mp_title` uses `mini_project_title(mp.block)` for UX consistency with in-app labels (rev 5 inlined this helper); `_safe_header` strip set extended to also remove `\x00`, `\x0b`, `\x0c` (rev 5 deleted `_safe_header` entirely); `_acquire_singleton_lock` validates SMTP password too; lock fd released in lifespan finally (not just atexit); "Publish on Overview" link replaced with `onNavigateToTab('overview')` callback; RunRosterTab copies `.banner` CSS into its own scoped `<style>` block (Svelte scoping); reuse existing `addError` state instead of new `inlineError`; test plan grows: unit tests for `_safe_header`, `_mp_title`, `_run_url`, 4 advisory-lock tests, commit-failure-success-path test asserts `error IS NULL` and `retry_count == 0`, `disable_dispatcher_loop` fixture spec'd; `test_run_teachers.py::_make_run` dropped from audit (file never POSTs students); `data-action="nav-overview-publish-roster"` to avoid collision with MP tab's identical selector. Out-of-scope hardening: a separate slice will add `?tab=` / `?mp=` deep-link parsing in `RunDetailPage`, which would let email URLs land on the relevant tab.

### Rev 1 → Rev 2

5 parallel Opus reviewers (backend correctness, concurrency, test plan, frontend/UX, YAGNI) caught convergent issues.

Critical fixes: `NotificationLogEntry` model declarations for new columns; `MiniProject` has no `title` — use `block.title`; frontend route is `/courses/:slug/runs/:id` not `/runs/:id`, RenderContext gains `course_slug`; migration uses `op.batch_alter_table` (SQLite-safe); `tick()` separates success-commit and error-commit with explicit rollback; `mailer.send` wrapped in `asyncio.to_thread` (sync SMTP no longer blocks the event loop); SMTP connection reused across a tick; shutdown timeout; explicit payload-key contract per kind (`mini_project_id`, not `mp_id`); `RunRosterTab` receives a `runIsPublished: boolean` prop (component had no `run` prop); backend 409 returns `error_code: 'run_unpublished'`; preview-step 409 test dropped (preview is client-side parseCsv); subject header sanitization (strip CRLF — rev 5 deleted this in favor of relying on `EmailMessage` default policy); `BACKOFF_SECONDS` is a Python constant (single source of truth); startup advisory-lock to prevent multi-worker double-send.

Scope changes: **`mini_project_published` pulled into scope** as a 4th event kind; `last_attempt_at` column dropped (unread by any code path); 5 env vars inlined (`BATCH_SIZE`, `BACKOFF_SECONDS`, `MAX_ATTEMPTS`, `STARTTLS`, drop `REPLY_TO`) → env surface 14 → 9. (Subsequent revs: rev 3 added `MATHION_DISPATCHER_LOCK_PATH` → 10; rev 5 dropped `MATHION_DISPATCHER_TICK_SECONDS` → 9, the current count.)

Important fixes: test-audit scope expanded to `conftest.seed_run_with_groups` (10 dependents) + `_make_run` helpers; `.banner` style reused (no `[i]` prefix); `role="alert"` on inline 409; `aria-describedby` on disabled buttons; `submitAdd` guard hardened against Enter-keypress; `classify()` flattened to ~10 LOC; `_build_email_message` specified; missing-referent behavior specified; permanent-vs-exhausted error prefix logic separated; structured logging on permanent failure; `order_by` tie-breaker.
