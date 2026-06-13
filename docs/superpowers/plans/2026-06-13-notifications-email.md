# Notifications (Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the dormant `notification_log` table by shipping a background email dispatcher inside FastAPI lifespan, render+deliver plain-text emails for the four highest-value events (`evaluation_received`, `run_enrolled`, `run_teacher_assigned`, `mini_project_published`), gate the roster Add endpoints with a top-level-`error_code` 409 on Draft runs, and surface the gate in the Roster tab UI.

**Architecture:** Pluggable `Mailer` ABC (`SMTPMailer`/`FileMailer`/`MemoryMailer`) selected by `MATHION_EMAIL_MODE`. A sync `tick(db, mailer, *, now)` runs inside `asyncio.to_thread` from a FastAPI lifespan-launched async loop, with per-row commits, classify-based retry, and SMTP connection reuse across a tick. A `fcntl.flock` advisory lock on a configured absolute path prevents multi-worker double-send. Trigger-side fixes relocate one `NotificationLogEntry` insert into a first-enrollment branch, remove a dead bulk-notify loop, and add MP-published row inserts under a refetch-with-FOR-UPDATE-and-populate-existing row lock to dedup concurrent admin clicks.

**Tech Stack:** Python 3.14, FastAPI lifespan, SQLAlchemy 2.0.49 (`Session.refresh`-alternative `populate_existing` pattern), Pydantic v2 `field_validator`, Alembic `batch_alter_table`, smtplib (sync), Svelte 5 (no JS deps, mount/unmount/flushSync test pattern), pytest + pytest-asyncio (added for one async test).

**Source spec:** `docs/superpowers/specs/2026-06-12-notifications-email-design.md` (rev 15, 1778 lines). The plan tasks reference spec sections (§) for verbatim long code blocks; implementer should keep the spec open while working.

**Branch:** `notifications-email` (feature branch on `main` checkout — not a worktree).

---

## Phase 0 — Foundation (config + schema)

These tasks add config keys and the schema columns the rest of the slice depends on. No app behavior changes yet; existing tests must continue passing after each task.

### Task 1: Config additions

Add 9 new env-keyed settings to `Settings` plus 2 Pydantic v2 `field_validator`s (one for `base_url`, one for `dispatcher_lock_path`).

**Files:**
- Modify: `backend/mathion/config.py` — add 9 new fields + 2 validators
- Create: `backend/tests/test_notifications_config.py` (~16 tests)

**Spec reference:** §10 lines 904-1015 (full settings table + both validator bodies + test case list).

- [ ] **Step 1.1: Write the failing tests for base_url validator**

Create `backend/tests/test_notifications_config.py`:

```python
import pytest
from pydantic import ValidationError
from mathion.config import Settings


@pytest.mark.parametrize("bad_url,reason", [
    ("javascript:alert(1)",                       "non-http scheme"),
    ("http:///",                                  "empty netloc"),
    ("file:///etc/passwd",                        "non-http scheme"),
    ("http://example.com\r\nX-Inject:1",          "CRLF control chars"),
    ("http://example.com\x00",                    "NUL byte"),
    ("http://example.com /path",                  "embedded space"),
    ("http://example.com\t",                      "TAB"),
    ("https://mathion.example.com@attacker.com",  "userinfo phishing form"),
    ("http://user:pass@example.com",              "userinfo bare"),
    ("http://example.com:bad",                    "invalid port"),
    ("http://example.com:99999",                  "port out of range"),
    ("http://example.com?utm=x",                  "query string"),
    ("http://example.com#frag",                   "fragment"),
    ("http://example.com/admin",                  "path-prefix"),
])
def test_base_url_rejects_bad(bad_url, reason):
    with pytest.raises(ValidationError):
        Settings(base_url=bad_url)


@pytest.mark.parametrize("good_url,expected", [
    ("http://example.com/",       "http://example.com"),
    ("http://example.com",        "http://example.com"),
    ("https://example.com",       "https://example.com"),
    ("http://example.com:8080",   "http://example.com:8080"),
])
def test_base_url_accepts_good(good_url, expected):
    s = Settings(base_url=good_url)
    assert s.base_url == expected


@pytest.mark.parametrize("bad_path", ["./mathion.lock", "mathion.lock"])
def test_dispatcher_lock_path_rejects_relative(bad_path):
    with pytest.raises(ValidationError):
        Settings(dispatcher_lock_path=bad_path)


@pytest.mark.parametrize("good_path", [
    "/tmp/mathion.dispatcher.lock",
    "/var/run/mathion/dispatcher.lock",
])
def test_dispatcher_lock_path_accepts_absolute(good_path):
    s = Settings(dispatcher_lock_path=good_path)
    assert s.dispatcher_lock_path == good_path
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_config.py -v
```

Expected: ALL FAIL — `base_url`, `dispatcher_lock_path`, and the new validators don't exist yet.

- [ ] **Step 1.3: Add the 9 settings + 2 validators**

Open `backend/mathion/config.py`. At module top add:

```python
from pathlib import Path
from urllib.parse import urlparse
from pydantic import field_validator
```

Inside the `Settings` class, add the 9 new fields (consult spec §10 lines 909-922 for the full table — `email_mode`, `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `email_from`, `email_outbox`, `base_url`, `dispatcher_lock_path`). For example:

```python
email_mode: str = "disabled"           # smtp | file | memory | disabled
smtp_host: str = ""
smtp_port: int = 587
smtp_username: str = ""
smtp_password: str = ""
email_from: str = "noreply@mathion.local"
email_outbox: str = "/tmp/mathion-outbox"
base_url: str = "http://localhost:8000"
dispatcher_lock_path: str = "/tmp/mathion.dispatcher.lock"
```

Then add both validators verbatim from spec §10 lines 935-1005 (`_validate_base_url` and `_validate_dispatcher_lock_path`).

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_config.py -v
```

Expected: 16 PASS.

- [ ] **Step 1.5: Run the full backend test suite to verify no regressions**

```bash
backend/.venv/bin/pytest backend/tests/ -x -q
```

Expected: existing tests still pass (the new settings are unused so far).

- [ ] **Step 1.6: Commit**

```bash
git add backend/mathion/config.py backend/tests/test_notifications_config.py
git commit -m "feat(config): add notification dispatcher settings + base_url/lock_path validators

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extend NotificationLogEntry model with 3 new columns

Add `retry_count`, `next_attempt_at`, `error` `mapped_column` declarations so SQLAlchemy can read/write the dispatcher's state.

**Files:**
- Modify: `backend/mathion/models_auth.py` (NotificationLogEntry class)
- Test: covered by Task 3 migration tests (model changes verified via the migration round-trip)

**Spec reference:** §3 lines 104-118 (column types + state machine table).

- [ ] **Step 2.1: Locate the NotificationLogEntry class**

```bash
grep -n "class NotificationLogEntry" backend/mathion/models_auth.py
```

Open the file at that line. The current class has `id`, `user_id`, `kind`, `payload`, `created_at`, `sent_at` per spec verification at lines 94-105 of models_auth.py.

- [ ] **Step 2.2: Add the 3 new mapped columns**

Append to the class body (preserve `mapped_column` import if needed at the top of the file):

```python
retry_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
error: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
```

If the imports `Integer`, `String`, `DateTime`, `mapped_column`, `Mapped`, `datetime` are not already present in the file, add the missing ones. The existing class likely already imports `mapped_column` and `Mapped`; check `sent_at`'s declaration for the existing pattern.

- [ ] **Step 2.3: Run the existing test suite to confirm no regressions**

```bash
backend/.venv/bin/pytest backend/tests/ -x -q
```

Expected: PASS. The autouse `setup_db` fixture at `conftest.py:64` re-creates the schema each session from `Base.metadata`, so the new columns appear on the test DB automatically.

- [ ] **Step 2.4: Commit**

```bash
git add backend/mathion/models_auth.py
git commit -m "feat(models): add retry_count/next_attempt_at/error to NotificationLogEntry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Alembic migration + isolated migration tests

Create the Alembic revision that adds the 3 columns + backfills existing rows' `sent_at`. Then write tests that exercise upgrade/downgrade against a `tmp_path` Alembic-managed DB (isolated from the autouse `setup_db` fixture).

**Files:**
- Create: `backend/alembic/versions/<rev>_notification_dispatcher_columns.py`
- Create: `backend/tests/test_notifications_migration.py` (~6 tests)

**Spec reference:** §3 lines 71-102 (full migration body) + §12 lines 1198-1295 (test isolation recipe).

- [ ] **Step 3.1: Generate the migration scaffold**

```bash
cd backend && .venv/bin/alembic revision -m "notification_dispatcher_columns"
```

This creates `backend/alembic/versions/<rev>_notification_dispatcher_columns.py` with `revision` and `down_revision` strings auto-filled. **Record both strings** — they'll be embedded in the migration test (`PRIOR_REV` and `THIS_REV`).

- [ ] **Step 3.2: Fill in upgrade/downgrade**

Replace the auto-generated body with the verbatim code from spec §3 lines 73-96:

```python
def upgrade():
    with op.batch_alter_table('notification_log') as batch_op:
        batch_op.add_column(
            sa.Column('retry_count', sa.Integer, nullable=False, server_default='0'))
        batch_op.add_column(
            sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column('error', sa.String(length=500), nullable=True))

    op.execute("UPDATE notification_log SET sent_at = CURRENT_TIMESTAMP "
               "WHERE sent_at IS NULL")

def downgrade():
    with op.batch_alter_table('notification_log') as batch_op:
        batch_op.drop_column('error')
        batch_op.drop_column('next_attempt_at')
        batch_op.drop_column('retry_count')
```

- [ ] **Step 3.3: Write the migration tests (isolated from autouse fixture)**

Create `backend/tests/test_notifications_migration.py`. Replace `PRIOR_REV` and `THIS_REV` strings with the actual values from step 3.1:

```python
"""Migration round-trip tests for notification_dispatcher_columns.

CRITICAL: this file opts out of the autouse `setup_db` fixture from
backend/tests/conftest.py:64. That fixture creates the FULL post-migration
schema via Base.metadata.create_all, which would defeat any test that
asserts pre-upgrade column absence. We override at module scope.
"""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from mathion.config import settings
from mathion.notifications.dispatcher import tick
from mathion.notifications.mailer import MemoryMailer


# Resolve alembic.ini cwd-independently. Pytest runs from `backend/` (per
# backend/pyproject.toml testpaths = ["tests"]), so `Config("backend/alembic.ini")`
# would resolve to `backend/backend/alembic.ini` and FileNotFoundError.
ALEMBIC_INI = str(Path(__file__).resolve().parent.parent / "alembic.ini")

PRIOR_REV = "<down_revision from your migration file>"
THIS_REV  = "<revision from your migration file>"


@pytest.fixture(autouse=True)
def setup_db():
    """Override the parent conftest's autouse fixture. Pytest resolves
    nearest-scope autouse, so this no-op wins for tests in this file."""
    yield


def _make_alembic_cfg(db_url: str) -> Config:
    cfg = Config(ALEMBIC_INI)
    # set_main_option is vestigial here — env.py:28 unconditionally overwrites
    # `sqlalchemy.url` with `settings.database_url` for BOTH online and offline
    # migration paths. The monkeypatch in each test is what redirects the
    # migration to the tmp DB.
    return cfg


def test_upgrade_backfills_sent_at(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/migration_test.db"
    monkeypatch.setattr(settings, "database_url", db_url)

    cfg = _make_alembic_cfg(db_url)
    command.upgrade(cfg, PRIOR_REV)

    tmp_engine = create_engine(db_url)
    # Seed a pre-upgrade row with sent_at=NULL
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at, sent_at) "
                          "VALUES (1, 'evaluation_received', '{}', CURRENT_TIMESTAMP, NULL)"))

    command.upgrade(cfg, THIS_REV)

    with tmp_engine.begin() as conn:
        row = conn.execute(text("SELECT sent_at FROM notification_log")).fetchone()
        assert row.sent_at is not None


def test_upgrade_new_rows_default_correctly(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/defaults_test.db"
    monkeypatch.setattr(settings, "database_url", db_url)

    cfg = _make_alembic_cfg(db_url)
    command.upgrade(cfg, THIS_REV)

    tmp_engine = create_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at) "
                          "VALUES (1, 'run_enrolled', '{}', CURRENT_TIMESTAMP)"))
        row = conn.execute(text("SELECT retry_count, next_attempt_at, error FROM notification_log")).fetchone()
        assert row.retry_count == 0
        assert row.next_attempt_at is None
        assert row.error is None


def test_downgrade_drops_columns(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/downgrade_test.db"
    monkeypatch.setattr(settings, "database_url", db_url)

    cfg = _make_alembic_cfg(db_url)
    command.upgrade(cfg, THIS_REV)
    command.downgrade(cfg, PRIOR_REV)

    tmp_engine = create_engine(db_url)
    with tmp_engine.begin() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(notification_log)"))}
        assert "retry_count" not in cols
        assert "next_attempt_at" not in cols
        assert "error" not in cols


def test_downgrade_preserves_backfill(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/preserve_test.db"
    monkeypatch.setattr(settings, "database_url", db_url)

    cfg = _make_alembic_cfg(db_url)
    command.upgrade(cfg, PRIOR_REV)
    tmp_engine = create_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at, sent_at) "
                          "VALUES (1, 'evaluation_received', '{}', CURRENT_TIMESTAMP, NULL)"))
    command.upgrade(cfg, THIS_REV)
    command.downgrade(cfg, PRIOR_REV)
    with tmp_engine.begin() as conn:
        row = conn.execute(text("SELECT sent_at FROM notification_log")).fetchone()
        assert row.sent_at is not None  # backfill survives downgrade


def test_migration_uses_batch_alter_table():
    # Source-level assertion to lock in the SQLite-safe convention.
    versions_dir = Path(__file__).resolve().parent.parent / "alembic" / "versions"
    files = list(versions_dir.glob("*notification_dispatcher_columns*"))
    assert len(files) == 1
    source = files[0].read_text()
    assert "with op.batch_alter_table" in source


def test_dispatcher_filters_backfilled_rows(tmp_path, monkeypatch):
    """Safety net test: backfilled rows have sent_at IS NOT NULL after upgrade
    and the dispatcher's `sent_at.is_(None)` clause excludes them. This makes
    the SQLite naive-vs-aware timestamp asymmetry benign per §3 note."""
    db_url = f"sqlite:///{tmp_path}/dispatch_test.db"
    monkeypatch.setattr(settings, "database_url", db_url)

    cfg = _make_alembic_cfg(db_url)
    command.upgrade(cfg, PRIOR_REV)
    tmp_engine = create_engine(db_url)
    with tmp_engine.begin() as conn:
        conn.execute(text("INSERT INTO notification_log (user_id, kind, payload, created_at, sent_at) "
                          "VALUES (1, 'run_enrolled', '{}', CURRENT_TIMESTAMP, NULL)"))
    command.upgrade(cfg, THIS_REV)

    LocalSession = sessionmaker(bind=tmp_engine)
    with LocalSession() as db:
        mailer = MemoryMailer()
        processed = tick(db, mailer, now=datetime.now(timezone.utc))
        assert processed == 0
        assert len(mailer.sent) == 0
```

- [ ] **Step 3.4: Run the migration tests to verify they fail correctly**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_migration.py -v
```

Expected: the 5 first tests should PASS (migration body is correct). `test_dispatcher_filters_backfilled_rows` will FAIL because `tick` and `MemoryMailer` don't exist yet — leave it failing; subsequent tasks will fix it.

- [ ] **Step 3.5: Commit**

```bash
git add backend/alembic/versions/*notification_dispatcher_columns* backend/tests/test_notifications_migration.py
git commit -m "feat(migration): add notification_dispatcher_columns + isolated round-trip tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — Mailer abstraction

### Task 4: errors.py — classify(exc) → 'transient' | 'permanent'

Smallest module first. No dependencies on the rest of the slice.

**Files:**
- Create: `backend/mathion/notifications/__init__.py` (empty for now)
- Create: `backend/mathion/notifications/errors.py`
- Create: `backend/tests/test_notifications_errors.py` (~22 parametrized cases)

**Spec reference:** §11 lines 985-1027 (full classify() body) + §12 lines 1075-1131 (test cases).

- [ ] **Step 4.1: Write the failing tests**

Create `backend/tests/test_notifications_errors.py`:

```python
import socket
import smtplib

import pytest

from mathion.notifications.errors import classify


@pytest.mark.parametrize("exc", [
    ConnectionRefusedError("refused"),
    TimeoutError("timed out"),
    socket.gaierror("no DNS"),
    smtplib.SMTPServerDisconnected("disconnected"),
    smtplib.SMTPResponseException(421, "service not available"),
    smtplib.SMTPResponseException(450, "mailbox busy"),
    smtplib.SMTPResponseException(451, "local error"),
    smtplib.SMTPResponseException(452, "insufficient storage"),
    smtplib.SMTPHeloError(421, "..."),
    smtplib.SMTPConnectError(450, "..."),
    smtplib.SMTPSenderRefused(450, b"...", "from@x"),
    smtplib.SMTPRecipientsRefused({"a@x": (450, b"greylist"), "b@x": (451, b"overload")}),
    smtplib.SMTPRecipientsRefused({"a@x": (-1, b"malformed reply")}),
])
def test_classify_transient(exc):
    assert classify(exc) == 'transient'


@pytest.mark.parametrize("exc", [
    smtplib.SMTPResponseException(500, "syntax error"),
    smtplib.SMTPResponseException(535, "auth failed"),
    smtplib.SMTPResponseException(550, "mailbox unavailable"),
    smtplib.SMTPResponseException(551, "user not local"),
    smtplib.SMTPResponseException(553, "mailbox name not allowed"),
    smtplib.SMTPHeloError(500, "..."),
    smtplib.SMTPConnectError(550, "..."),
    smtplib.SMTPSenderRefused(550, b"...", "from@x"),
    smtplib.SMTPRecipientsRefused({"a@x": (550, b"no such user")}),
    smtplib.SMTPRecipientsRefused({"a@x": (450, b"greylist"), "b@x": (550, b"no such user")}),
    smtplib.SMTPRecipientsRefused({}),  # empty dict → permanent (defensive)
    KeyError("missing payload key"),
    ValueError("empty email"),
    LookupError("referent missing"),
    Exception("unknown"),
])
def test_classify_permanent(exc):
    assert classify(exc) == 'permanent'
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_errors.py -v
```

Expected: `ModuleNotFoundError: No module named 'mathion.notifications'`.

- [ ] **Step 4.3: Create the package + errors.py**

```bash
mkdir -p backend/mathion/notifications
touch backend/mathion/notifications/__init__.py
```

Create `backend/mathion/notifications/errors.py` with the verbatim body from spec §11 lines 985-1027:

```python
import smtplib, socket

TRANSIENT_EXCS = (
    ConnectionRefusedError, TimeoutError, socket.gaierror,
    smtplib.SMTPServerDisconnected,
)

def classify(exc: BaseException) -> str:
    """RFC 5321: 4xx = transient (retry), 5xx = permanent (don't retry)."""
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        if not exc.recipients:
            return 'permanent'
        codes = [code for code, _msg in exc.recipients.values()]
        return 'permanent' if any(500 <= c <= 599 for c in codes) else 'transient'
    if isinstance(exc, smtplib.SMTPResponseException):
        code = exc.smtp_code
        return 'transient' if 400 <= code <= 499 else 'permanent'
    if isinstance(exc, TRANSIENT_EXCS):
        return 'transient'
    return 'permanent'
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_errors.py -v
```

Expected: 27 PASS.

- [ ] **Step 4.5: Commit**

```bash
git add backend/mathion/notifications/ backend/tests/test_notifications_errors.py
git commit -m "feat(notifications): add classify() for transient/permanent SMTP errors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mailer ABC + MemoryMailer

Smallest mailer first. MemoryMailer is the test-only stand-in.

**Files:**
- Create: `backend/mathion/notifications/mailer.py` (Mailer ABC + MemoryMailer only this task)
- Create: `backend/tests/test_notifications_mailer.py` (start with MemoryMailer tests)

**Spec reference:** §4 lines 135-153 (Mailer ABC) + lines 219-227 (MemoryMailer).

- [ ] **Step 5.1: Write the failing test**

Create `backend/tests/test_notifications_mailer.py`:

```python
from email.message import EmailMessage

from mathion.notifications.mailer import MemoryMailer


def test_memory_mailer_send_appends():
    m = MemoryMailer()
    msg = EmailMessage()
    msg["Subject"] = "test"
    with m.session():
        m.send(msg)
        m.send(msg)
    assert len(m.sent) == 2


def test_memory_mailer_session_is_noop():
    m = MemoryMailer()
    with m.session():
        pass  # should not raise
    assert m.sent == []
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: `ModuleNotFoundError` or `ImportError: cannot import name 'MemoryMailer'`.

- [ ] **Step 5.3: Create mailer.py with the ABC + MemoryMailer**

```python
from abc import ABC, abstractmethod
from contextlib import contextmanager, AbstractContextManager
from email.message import EmailMessage
from pathlib import Path
import functools, smtplib, uuid, datetime as dt


class Mailer(ABC):
    @abstractmethod
    def session(self) -> AbstractContextManager[None]:
        """Return a context manager scoping one batch of sends."""
        ...

    @abstractmethod
    def send(self, msg: EmailMessage) -> None: ...


class MemoryMailer(Mailer):
    def __init__(self):
        self.sent: list[EmailMessage] = []

    @contextmanager
    def session(self):
        yield

    def send(self, msg):
        self.sent.append(msg)
```

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: 2 PASS.

- [ ] **Step 5.5: Commit**

```bash
git add backend/mathion/notifications/mailer.py backend/tests/test_notifications_mailer.py
git commit -m "feat(notifications): add Mailer ABC + MemoryMailer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: FileMailer with TEMPLATES-derived allow-list

**Files:**
- Modify: `backend/mathion/notifications/mailer.py` (add FileMailer)
- Modify: `backend/tests/test_notifications_mailer.py` (add ~6 tests)

**Spec reference:** §4 lines 177-215 (FileMailer body — includes the `@classmethod @functools.cache` `_allowed_kinds()` derivation).

- [ ] **Step 6.1: Write the failing tests**

Append to `backend/tests/test_notifications_mailer.py`:

```python
from email.message import EmailMessage
from pathlib import Path
import pytest

from mathion.notifications.mailer import FileMailer


def _make_msg(kind: str | None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = "Test"
    msg["To"] = "a@example.com"
    msg["From"] = "noreply@mathion.local"
    msg.set_content("hi")
    if kind is not None:
        msg["X-Mathion-Kind"] = kind
    return msg


def test_filemailer_creates_outbox(tmp_path):
    fm = FileMailer(tmp_path / "outbox")
    assert (tmp_path / "outbox").is_dir()


def test_filemailer_rejects_non_dir(tmp_path):
    (tmp_path / "file_not_dir").write_text("oops")
    with pytest.raises(RuntimeError):
        FileMailer(tmp_path / "file_not_dir")


def test_filemailer_send_writes_eml(tmp_path):
    fm = FileMailer(tmp_path)
    msg = _make_msg("run_enrolled")
    with fm.session():
        fm.send(msg)
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert "run_enrolled" in files[0].name


def test_filemailer_traversal_kind_maps_to_unknown(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg("../../tmp/evil"))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert (tmp_path.parent / "tmp" / "evil").exists() is False


@pytest.mark.parametrize("kind", ["/etc/passwd", "foo\\bar"])
def test_filemailer_slash_backslash_kind_unknown(tmp_path, kind):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg(kind))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert "unknown" in files[0].name


def test_filemailer_missing_header_maps_to_unknown(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg(None))
    files = list(tmp_path.glob("*.eml"))
    assert len(files) == 1
    assert "unknown" in files[0].name


def test_filemailer_atomic_rename(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg("run_enrolled"))
    # No .tmp leftover after rename
    assert list(tmp_path.glob("*.tmp")) == []


def test_filemailer_uuid_disambiguates_same_timestamp(tmp_path):
    fm = FileMailer(tmp_path)
    with fm.session():
        fm.send(_make_msg("run_enrolled"))
        fm.send(_make_msg("run_enrolled"))
    assert len(list(tmp_path.glob("*.eml"))) == 2
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: 8 new tests FAIL with `ImportError: cannot import name 'FileMailer'`.

- [ ] **Step 6.3: Add FileMailer to mailer.py**

Append after `MemoryMailer`:

```python
class FileMailer(Mailer):
    def __init__(self, outbox_dir: Path):
        if outbox_dir.exists() and not outbox_dir.is_dir():
            raise RuntimeError(f"MATHION_EMAIL_OUTBOX={outbox_dir} exists but is not a directory")
        outbox_dir.mkdir(parents=True, exist_ok=True)
        self.outbox = outbox_dir

    @contextmanager
    def session(self):
        yield

    @classmethod
    @functools.cache
    def _allowed_kinds(cls) -> frozenset[str]:
        # Lazy import: templates.py does not import mailer.py, so this is not a
        # cycle break — it minimizes mailer.py's import-time graph so the module
        # loads early in `build_mailer_from_settings` without dragging
        # templates.py's transitive deps along.
        from .templates import TEMPLATES
        return frozenset(TEMPLATES.keys())

    def send(self, msg):
        ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S")
        raw_kind = msg.get("X-Mathion-Kind", "unknown")
        kind = raw_kind if raw_kind in self._allowed_kinds() else "unknown"
        path = self.outbox / f"{ts}-{kind}-{uuid.uuid4().hex[:8]}.eml"
        tmp = path.with_suffix(".eml.tmp")
        tmp.write_bytes(bytes(msg))
        tmp.rename(path)
```

- [ ] **Step 6.4: Run tests to verify they pass**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: all PASS. (The `_allowed_kinds()` import of `TEMPLATES` will fail-fast if `templates.py` doesn't exist — Task 7 creates it. For now, the tests that hit the allow-list use `"run_enrolled"` which is one of the spec's kinds; if `templates.py` doesn't exist yet, this will ImportError. Defer this task's "tests pass" check OR provide a stub TEMPLATES dict now — see step 6.5.)

- [ ] **Step 6.5: If tests fail due to missing templates module, add a stub**

If step 6.4 fails with `ImportError: cannot import name 'TEMPLATES'`, create a minimal stub at `backend/mathion/notifications/templates.py`:

```python
# Stub — full implementation lands in Task 7.
TEMPLATES = {
    "evaluation_received": None,
    "run_enrolled": None,
    "run_teacher_assigned": None,
    "mini_project_published": None,
}
```

Re-run step 6.4. Task 7 will replace this stub.

- [ ] **Step 6.6: Commit**

```bash
git add backend/mathion/notifications/mailer.py backend/mathion/notifications/templates.py backend/tests/test_notifications_mailer.py
git commit -m "feat(notifications): add FileMailer with TEMPLATES-derived kind allow-list

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: SMTPMailer (persistent connection per session)

**Files:**
- Modify: `backend/mathion/notifications/mailer.py` (add SMTPMailer)
- Modify: `backend/tests/test_notifications_mailer.py` (~4 tests using mocks)

**Spec reference:** §4 lines 155-176 (SMTPMailer body).

- [ ] **Step 7.1: Write the failing tests**

Append to `backend/tests/test_notifications_mailer.py`:

```python
from unittest.mock import MagicMock, patch

from mathion.notifications.mailer import SMTPMailer


def test_smtp_session_opens_connection_starttls_auth():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        sm = SMTPMailer("host", 587, "user", "pw")
        with sm.session():
            pass
        MockSMTP.assert_called_once_with("host", 587, timeout=30)
        mock_conn.starttls.assert_called_once()
        mock_conn.login.assert_called_once_with("user", "pw")
        mock_conn.quit.assert_called_once()


def test_smtp_send_without_session_raises():
    sm = SMTPMailer("host", 587, "user", "pw")
    msg = EmailMessage()
    msg["Subject"] = "x"
    with pytest.raises(AssertionError):
        sm.send(msg)


def test_smtp_reuses_connection_across_sends():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        sm = SMTPMailer("host", 587, "user", "pw")
        with sm.session():
            for _ in range(5):
                msg = EmailMessage()
                msg["Subject"] = "x"
                sm.send(msg)
        assert MockSMTP.call_count == 1
        assert mock_conn.send_message.call_count == 5


def test_smtp_propagates_recipients_refused():
    with patch("mathion.notifications.mailer.smtplib.SMTP") as MockSMTP:
        mock_conn = MockSMTP.return_value
        mock_conn.send_message.side_effect = smtplib.SMTPRecipientsRefused(
            {"x@x": (550, b"no such user")}
        )
        sm = SMTPMailer("host", 587, "user", "pw")
        with sm.session():
            with pytest.raises(smtplib.SMTPRecipientsRefused):
                msg = EmailMessage()
                msg["Subject"] = "x"
                sm.send(msg)
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: 4 new tests FAIL with `ImportError: cannot import name 'SMTPMailer'`.

- [ ] **Step 7.3: Add SMTPMailer to mailer.py**

```python
class SMTPMailer(Mailer):
    def __init__(self, host, port, username, password):
        self.host, self.port = host, port
        self.username, self.password = username, password
        self._smtp: smtplib.SMTP | None = None

    @contextmanager
    def session(self):
        self._smtp = smtplib.SMTP(self.host, self.port, timeout=30)
        try:
            self._smtp.starttls()
            self._smtp.login(self.username, self.password)
            yield
        finally:
            try:
                self._smtp.quit()
            except Exception:
                pass
            self._smtp = None

    def send(self, msg):
        assert self._smtp is not None, "SMTPMailer.send called outside session()"
        self._smtp.send_message(msg)
```

- [ ] **Step 7.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: all PASS.

- [ ] **Step 7.5: Commit**

```bash
git add backend/mathion/notifications/mailer.py backend/tests/test_notifications_mailer.py
git commit -m "feat(notifications): add SMTPMailer with per-tick connection reuse

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: build_mailer_from_settings + factory tests

**Files:**
- Modify: `backend/mathion/notifications/mailer.py` (add factory)
- Modify: `backend/tests/test_notifications_mailer.py` (~5 tests)
- Modify: `backend/mathion/notifications/__init__.py` (re-export)

**Spec reference:** §4 lines 218-228.

- [ ] **Step 8.1: Write the failing tests**

Append to `backend/tests/test_notifications_mailer.py`:

```python
from mathion.notifications.mailer import build_mailer_from_settings


def _settings(**kwargs):
    """Minimal settings stub with the fields the factory reads."""
    from types import SimpleNamespace
    defaults = dict(email_mode="disabled", smtp_host="", smtp_port=587,
                    smtp_username="", smtp_password="", email_outbox="/tmp/x")
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_factory_disabled_returns_none():
    assert build_mailer_from_settings(_settings(email_mode="disabled")) is None


def test_factory_memory():
    assert isinstance(build_mailer_from_settings(_settings(email_mode="memory")), MemoryMailer)


def test_factory_file(tmp_path):
    s = _settings(email_mode="file", email_outbox=str(tmp_path / "ob"))
    assert isinstance(build_mailer_from_settings(s), FileMailer)


def test_factory_smtp_missing_config_raises():
    with pytest.raises(RuntimeError):
        build_mailer_from_settings(_settings(email_mode="smtp"))


def test_factory_smtp_full_config():
    s = _settings(email_mode="smtp", smtp_host="h", smtp_username="u", smtp_password="p")
    assert isinstance(build_mailer_from_settings(s), SMTPMailer)


def test_factory_unknown_mode_raises():
    with pytest.raises(RuntimeError):
        build_mailer_from_settings(_settings(email_mode="bogus"))
```

- [ ] **Step 8.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: 6 new tests FAIL with `ImportError: cannot import name 'build_mailer_from_settings'`.

- [ ] **Step 8.3: Add the factory to mailer.py**

```python
def build_mailer_from_settings(s) -> Mailer | None:
    if s.email_mode == 'disabled':
        return None
    if s.email_mode == 'smtp':
        if not s.smtp_host or not s.smtp_username or not s.smtp_password:
            raise RuntimeError(
                "MATHION_SMTP_HOST, MATHION_SMTP_USERNAME, and MATHION_SMTP_PASSWORD "
                "required when MATHION_EMAIL_MODE=smtp")
        return SMTPMailer(s.smtp_host, s.smtp_port, s.smtp_username, s.smtp_password)
    if s.email_mode == 'file':
        return FileMailer(Path(s.email_outbox))
    if s.email_mode == 'memory':
        return MemoryMailer()
    raise RuntimeError(f"Unknown MATHION_EMAIL_MODE={s.email_mode!r}")
```

- [ ] **Step 8.4: Update `backend/mathion/notifications/__init__.py`**

```python
from .mailer import Mailer, MemoryMailer, FileMailer, SMTPMailer, build_mailer_from_settings
```

- [ ] **Step 8.5: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_mailer.py -v
```

Expected: all PASS.

- [ ] **Step 8.6: Commit**

```bash
git add backend/mathion/notifications/mailer.py backend/mathion/notifications/__init__.py backend/tests/test_notifications_mailer.py
git commit -m "feat(notifications): add build_mailer_from_settings factory + re-exports

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Templates

### Task 9: templates.py — RenderContext + 4 templates + render()

Replace the Task 6 stub with the full templates module.

**Files:**
- Modify: `backend/mathion/notifications/templates.py` (full body)
- Create: `backend/tests/test_notifications_templates.py` (~14 tests)

**Spec reference:** §6.2 lines 540-632 (full templates code).

- [ ] **Step 9.1: Write the failing tests**

Create `backend/tests/test_notifications_templates.py`:

```python
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from mathion.notifications.templates import (
    TEMPLATES, RenderContext, render, _name, _run_url,
)


def _ctx(**overrides):
    user = SimpleNamespace(full_name="Alice", email="alice@example.com")
    course = SimpleNamespace(slug="calc-101")
    version = SimpleNamespace(course=course)
    run = SimpleNamespace(id=42, title="Spring 2026", version=version)
    mp = SimpleNamespace(block=SimpleNamespace(title="Block 3"), id=7)
    sub = SimpleNamespace(id=99)
    base = dict(user=user, run=run, base_url="http://localhost:8000", mp=mp, sub=sub)
    base.update(overrides)
    return RenderContext(**base)


def test_name_uses_full_name():
    user = SimpleNamespace(full_name="Bob", email="b@x")
    assert _name(user) == "Bob"


def test_name_falls_back_to_email():
    user = SimpleNamespace(full_name=None, email="b@x")
    assert _name(user) == "b@x"


def test_run_url_no_query():
    ctx = _ctx()
    url = _run_url(ctx)
    assert url == "http://localhost:8000/courses/calc-101/runs/42"
    assert "?" not in url and "#" not in url


def test_course_slug_property_derives_live():
    ctx = _ctx()
    assert ctx.course_slug == "calc-101"
    ctx.run.version.course.slug = "new-slug"
    assert ctx.course_slug == "new-slug"


def test_run_url_handles_trailing_slash_already_stripped():
    ctx = _ctx(base_url="http://localhost:8000")
    assert _run_url(ctx) == "http://localhost:8000/courses/calc-101/runs/42"


@pytest.mark.parametrize("kind", [
    "evaluation_received", "run_enrolled",
    "run_teacher_assigned", "mini_project_published",
])
def test_each_kind_renders(kind):
    ctx = _ctx()
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Block 3 Project"):
        subject, body = render(kind, ctx)
        assert "Alice" in body
        assert "http://localhost:8000/courses/calc-101/runs/42" in body
        assert subject and not subject.endswith("\n")


def test_evaluation_received_uses_mp_title_helper():
    ctx = _ctx()
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Special MP Title"):
        subject, body = render("evaluation_received", ctx)
        assert "Special MP Title" in body


def test_render_unknown_kind_raises():
    with pytest.raises(KeyError):
        render("not_a_real_kind", _ctx())


def test_templates_dict_has_4_keys():
    assert set(TEMPLATES.keys()) == {
        "evaluation_received", "run_enrolled",
        "run_teacher_assigned", "mini_project_published",
    }
```

- [ ] **Step 9.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_templates.py -v
```

Expected: tests FAIL with `ImportError`s for `RenderContext`, `render`, `_name`, `_run_url`.

- [ ] **Step 9.3: Replace templates.py stub with full body**

Replace `backend/mathion/notifications/templates.py` with the verbatim spec §6.2 body (lines 540-632 in the spec):

```python
from dataclasses import dataclass
from typing import Optional, Callable

from email.message import EmailMessage

from mathion.config import settings
from mathion.models import Run, MiniProject
from mathion.models_auth import User
from mathion.models import Submission


@dataclass
class RenderContext:
    user: User
    run: Run
    base_url: str
    mp: Optional[MiniProject] = None
    sub: Optional[Submission] = None

    @property
    def course_slug(self) -> str:
        return self.run.version.course.slug


def _name(u) -> str:
    return u.full_name or u.email


def _run_url(ctx) -> str:
    return f"{ctx.base_url}/courses/{ctx.course_slug}/runs/{ctx.run.id}"


def _evaluation_received(ctx):
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
        raise KeyError(f"unknown notification kind: {kind!r}")
    return TEMPLATES[kind](ctx)


def _build_email_message(subject, body, ctx, *, kind: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = ctx.user.email
    msg["Subject"] = subject
    msg["X-Mathion-Kind"] = kind
    msg.set_content(body)
    return msg
```

- [ ] **Step 9.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_templates.py -v
```

Expected: PASS.

- [ ] **Step 9.5: Clear the FileMailer `_allowed_kinds.cache_clear()` (if test_notifications_mailer tests fail)**

The cached frozenset from Task 6 step 6.5 stub now sees a different (real) TEMPLATES. Re-running the mailer tests should still pass since `_allowed_kinds()` is called lazily. If it doesn't, add a setup in test_notifications_mailer.py that calls `FileMailer._allowed_kinds.cache_clear()` at module top.

- [ ] **Step 9.6: Commit**

```bash
git add backend/mathion/notifications/templates.py backend/tests/test_notifications_templates.py
git commit -m "feat(notifications): RenderContext, 4 templates, render(), _build_email_message

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: _build_render_context (eager-loading helper)

This is the bridge between a `NotificationLogEntry` row and a `RenderContext`. Lives in `dispatcher.py` per spec §2 (not `templates.py`).

**Files:**
- Create: `backend/mathion/notifications/dispatcher.py` (start with this helper only)
- Modify: `backend/tests/test_notifications_dispatcher.py` (start the file with ~4 tests for this helper)

**Spec reference:** §6.1 lines 465-540 (full _build_render_context skeleton).

- [ ] **Step 10.1: Write the failing tests**

Create `backend/tests/test_notifications_dispatcher.py`:

```python
import pytest

from mathion.notifications.dispatcher import _build_render_context
from mathion.models_auth import NotificationLogEntry

# These tests use the existing autouse `setup_db` + `db` fixtures from
# backend/tests/conftest.py to get a clean schema + session per test.
# Seed helpers from conftest will need to provide a published run, a user
# enrolled in it, an MP, and (optionally) a submission — use existing helpers
# like seed_run_with_groups + the `client` fixture for HTTP-level setup.


def test_build_render_context_run_enrolled(db, seeded_run):
    user = seeded_run["student_user"]
    run = seeded_run["run"]
    entry = NotificationLogEntry(
        user_id=user.id, kind="run_enrolled",
        payload={"run_id": run.id},
    )
    db.add(entry); db.flush()
    ctx = _build_render_context(db, entry)
    assert ctx.user.id == user.id
    assert ctx.run.id == run.id
    assert ctx.mp is None
    assert ctx.sub is None


def test_build_render_context_missing_run_raises(db, seeded_user):
    entry = NotificationLogEntry(
        user_id=seeded_user.id, kind="run_enrolled",
        payload={"run_id": 999999},  # nonexistent
    )
    db.add(entry); db.flush()
    with pytest.raises(LookupError, match="referent missing"):
        _build_render_context(db, entry)


def test_build_render_context_missing_user_raises(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=999999, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
    )
    db.add(entry); db.flush()
    with pytest.raises(LookupError, match="referent missing"):
        _build_render_context(db, entry)


def test_build_render_context_evaluation_received_loads_mp_sub(db, seeded_run_with_eval):
    user = seeded_run_with_eval["student_user"]
    entry = NotificationLogEntry(
        user_id=user.id, kind="evaluation_received",
        payload={
            "run_id": seeded_run_with_eval["run"].id,
            "mini_project_id": seeded_run_with_eval["mp"].id,
            "submission_id": seeded_run_with_eval["submission"].id,
        },
    )
    db.add(entry); db.flush()
    ctx = _build_render_context(db, entry)
    assert ctx.mp is not None and ctx.sub is not None
```

(Use fixtures consistent with existing conftest patterns; if `seeded_run`, `seeded_user`, `seeded_run_with_eval` don't exist, this task implies adding them — see Task 22 conftest changes.)

- [ ] **Step 10.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_dispatcher.py -v
```

Expected: FAIL with `ImportError: cannot import name '_build_render_context'`.

- [ ] **Step 10.3: Create dispatcher.py with just _build_render_context**

Create `backend/mathion/notifications/dispatcher.py`. Embed the imports and the `_build_render_context` helper. Per spec §6.1, the helper performs the pinned lookup order (Run → User → MP → Submission), uses `joinedload(Run.version).joinedload(CourseVersion.course)` to avoid N+1 SELECTs, and raises `LookupError("referent missing: ...")` with the kind-specific substring (`run`, `user`, `mp`, `submission`) so error messages are deterministic.

```python
import asyncio, logging, smtplib
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError, PendingRollbackError, NoResultFound
from sqlalchemy.orm import joinedload

from mathion.config import settings
from mathion.database import SessionLocal
from mathion.models import Run, CourseVersion, MiniProject, Submission
from mathion.models_auth import User, NotificationLogEntry

from .errors import classify
from .templates import render, _build_email_message, RenderContext


logger = logging.getLogger("mathion.notifications")


def _build_render_context(db, row: NotificationLogEntry) -> RenderContext:
    payload = row.payload or {}

    run_id = payload.get("run_id")
    if run_id is None:
        raise LookupError(f"referent missing: payload run_id absent for row id={row.id}")
    run = db.execute(
        select(Run)
        .where(Run.id == run_id)
        .options(joinedload(Run.version).joinedload(CourseVersion.course))
    ).scalars().first()
    if run is None:
        raise LookupError(f"referent missing: run id={run_id}")

    user = db.get(User, row.user_id)
    if user is None:
        raise LookupError(f"referent missing: user id={row.user_id}")

    mp = None
    if "mini_project_id" in payload:
        mp = db.get(MiniProject, payload["mini_project_id"])
        if mp is None:
            raise LookupError(f"referent missing: mp id={payload['mini_project_id']}")

    sub = None
    if "submission_id" in payload:
        sub = db.get(Submission, payload["submission_id"])
        if sub is None:
            raise LookupError(f"referent missing: submission id={payload['submission_id']}")

    return RenderContext(user=user, run=run, base_url=settings.base_url, mp=mp, sub=sub)
```

- [ ] **Step 10.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_dispatcher.py -v
```

Expected: PASS (if the seeded_* fixtures exist; otherwise this task surfaces the need for Task 22 fixtures earlier).

- [ ] **Step 10.5: Commit**

```bash
git add backend/mathion/notifications/dispatcher.py backend/tests/test_notifications_dispatcher.py
git commit -m "feat(notifications): _build_render_context with eager-loaded Run→Version→Course

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Dispatcher core

### Task 11: tick() — success path

Implement the `tick(db, mailer, *, now) -> int` happy path: claim batch, render, send, stamp `sent_at`, commit per row, return count.

**Files:**
- Modify: `backend/mathion/notifications/dispatcher.py`
- Modify: `backend/tests/test_notifications_dispatcher.py` (~6 tests)

**Spec reference:** §5 lines 271-380 (full tick body — embed verbatim).

- [ ] **Step 11.1: Write the failing tests**

Append to `backend/tests/test_notifications_dispatcher.py`:

```python
from datetime import datetime, timezone, timedelta

from mathion.notifications.dispatcher import tick, BATCH_SIZE
from mathion.notifications.mailer import MemoryMailer


def test_tick_returns_zero_on_empty(db):
    assert tick(db, MemoryMailer(), now=datetime.now(timezone.utc)) == 0


def test_tick_single_row_happy_path(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 1
    db.refresh(entry)
    assert entry.sent_at is not None
    assert len(mailer.sent) == 1


def test_tick_batch_size_capped(db, seeded_run):
    student = seeded_run["student_user"]
    for _ in range(BATCH_SIZE + 10):
        db.add(NotificationLogEntry(
            user_id=student.id, kind="run_enrolled",
            payload={"run_id": seeded_run["run"].id}))
    db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == BATCH_SIZE


def test_tick_orders_by_created_at_then_id(db, seeded_run):
    # Insert 3 rows; tick should process them in created_at-ascending then id-ascending order
    ids = []
    for i in range(3):
        e = NotificationLogEntry(
            user_id=seeded_run["student_user"].id, kind="run_enrolled",
            payload={"run_id": seeded_run["run"].id})
        db.add(e); db.commit(); ids.append(e.id)
    mailer = MemoryMailer()
    tick(db, mailer, now=datetime.now(timezone.utc))
    # MemoryMailer.sent preserves order
    assert len(mailer.sent) == 3


def test_tick_skips_already_sent(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        sent_at=datetime.now(timezone.utc),  # already delivered
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0
    assert len(mailer.sent) == 0


def test_tick_skips_errored(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        error="permanently failed",
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0


def test_tick_skips_backoff_future(db, seeded_run):
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        next_attempt_at=future,
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=datetime.now(timezone.utc)) == 0


def test_tick_backoff_boundary_inclusive(db, seeded_run):
    now = datetime.now(timezone.utc)
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        next_attempt_at=now,  # exactly now → INCLUSIVE
    )
    db.add(entry); db.commit()
    mailer = MemoryMailer()
    assert tick(db, mailer, now=now) == 1
```

- [ ] **Step 11.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_dispatcher.py::test_tick -v
```

Expected: FAIL — `tick` and `BATCH_SIZE` don't exist yet.

- [ ] **Step 11.3: Add tick() to dispatcher.py**

Append the `tick` function from spec §5 lines 271-379 verbatim (the full body including session_cm handling, success+error branches, redaction, commit-on-failure handling). Add module-level constants:

```python
BATCH_SIZE = 20
MAX_ATTEMPTS = 5
BACKOFF_SECONDS = [300, 1800, 7200, 21600]
```

See spec §5 lines 271-379 for the verbatim `tick` body.

- [ ] **Step 11.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_dispatcher.py -v
```

Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add backend/mathion/notifications/dispatcher.py backend/tests/test_notifications_dispatcher.py
git commit -m "feat(notifications): tick() success path with batch claim + per-row commit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: tick() — error path (classify, retry, redaction)

The error branch is already in the tick body from Task 11. This task adds the FAILURE-PATH tests.

**Files:**
- Modify: `backend/tests/test_notifications_dispatcher.py` (~10 tests)

**Spec reference:** §5 lines 327-379 (error branch in tick) + §12 lines 1135-1155 (test cases).

- [ ] **Step 12.1: Write the failing tests**

Append:

```python
from unittest.mock import MagicMock
import smtplib
import logging


class _RaisingMailer(MemoryMailer):
    def __init__(self, exc): super().__init__(); self.exc = exc
    def send(self, msg): raise self.exc


def test_transient_failure_1st_retry(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    now = datetime.now(timezone.utc)
    tick(db, _RaisingMailer(ConnectionRefusedError("nope")), now=now)
    db.refresh(entry)
    assert entry.retry_count == 1
    assert entry.next_attempt_at == now + timedelta(seconds=300)
    assert entry.error is None


def test_transient_exhausted_attempts(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id},
        retry_count=4)
    db.add(entry); db.commit()
    tick(db, _RaisingMailer(ConnectionRefusedError("nope")), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.retry_count == 5
    assert entry.next_attempt_at is None
    assert entry.error and entry.error.startswith("max attempts:")


def test_permanent_failure_smtp_550(db, seeded_run):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    tick(db, _RaisingMailer(smtplib.SMTPResponseException(550, "no mailbox")),
         now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.retry_count == 1
    assert entry.next_attempt_at is None
    assert entry.error and "no mailbox" in entry.error
    assert not entry.error.startswith("max attempts:")


def test_smtp_auth_error_redacted(db, seeded_run, caplog):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    sensitive = smtplib.SMTPAuthenticationError(
        535, b"535 5.7.8 Authentication credentials invalid for user@example.com")
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    tick(db, _RaisingMailer(sensitive), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.error == "SMTP authentication failed (see operator logs)"
    assert "user@example.com" not in (entry.error or "")
    # Full exception is in the logs for the operator
    has_full_exc = any(
        r.exc_info and r.exc_info[1] is sensitive for r in caplog.records
    )
    assert has_full_exc


def test_per_row_containment(db, seeded_run):
    # Insert 3 rows: first OK, middle raises, third OK.
    e1 = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                              payload={"run_id": seeded_run["run"].id})
    e2 = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                              payload={"run_id": seeded_run["run"].id})
    e3 = NotificationLogEntry(user_id=seeded_run["student_user"].id, kind="run_enrolled",
                              payload={"run_id": seeded_run["run"].id})
    db.add_all([e1, e2, e3]); db.commit()

    class _SometimesFail(MemoryMailer):
        def __init__(self): super().__init__(); self.calls = 0
        def send(self, msg):
            self.calls += 1
            if self.calls == 2:
                raise ConnectionRefusedError("boom")
            self.sent.append(msg)

    tick(db, _SometimesFail(), now=datetime.now(timezone.utc))
    db.refresh(e1); db.refresh(e2); db.refresh(e3)
    assert e1.sent_at is not None
    assert e2.sent_at is None and e2.retry_count == 1
    assert e3.sent_at is not None


def test_render_keyerror_classifies_permanent(db, seeded_run):
    # Drop a required payload key to force KeyError in render
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="evaluation_received",
        payload={"run_id": seeded_run["run"].id})  # missing mini_project_id
    db.add(entry); db.commit()
    tick(db, MemoryMailer(), now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert entry.error is not None
    assert entry.next_attempt_at is None
```

- [ ] **Step 12.2: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_dispatcher.py -v
```

Expected: PASS (the error path is already in the tick body from Task 11).

- [ ] **Step 12.3: Commit**

```bash
git add backend/tests/test_notifications_dispatcher.py
git commit -m "test(notifications): error-path tests for retry, redaction, containment

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: tick() — session-acquire failure handling

Verify the "session __enter__ fails → log warning, return 0 without touching row state" behavior — the SMTP-config wedge.

**Files:**
- Modify: `backend/tests/test_notifications_dispatcher.py` (~2 tests)

**Spec reference:** §5 lines 302-313 (session-acquire wedge logic).

- [ ] **Step 13.1: Write the tests**

```python
class _WedgedMailer(MemoryMailer):
    @staticmethod
    def session(): raise NotImplementedError  # placeholder

    def __init__(self, exc):
        super().__init__()
        self.exc = exc

    def session(self):
        class _CM:
            def __init__(self, exc): self.exc = exc
            def __enter__(self): raise self.exc
            def __exit__(self, *a): return False
        return _CM(self.exc)


def test_session_acquire_wedge_no_row_state_change(db, seeded_run, caplog):
    entry = NotificationLogEntry(
        user_id=seeded_run["student_user"].id, kind="run_enrolled",
        payload={"run_id": seeded_run["run"].id})
    db.add(entry); db.commit()
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    rc = tick(db, _WedgedMailer(ConnectionRefusedError("smtp down")),
              now=datetime.now(timezone.utc))
    db.refresh(entry)
    assert rc == 0
    assert entry.retry_count == 0
    assert entry.sent_at is None
    assert entry.error is None
    assert any("failed to acquire mailer session" in r.getMessage()
               for r in caplog.records)


def test_session_acquire_wedge_zero_rows_returns_0_no_log(db, caplog):
    caplog.set_level(logging.WARNING, logger="mathion.notifications")
    rc = tick(db, _WedgedMailer(ConnectionRefusedError("smtp down")),
              now=datetime.now(timezone.utc))
    assert rc == 0
    # No wedge log when there are no rows to wedge on
    assert not any("failed to acquire" in r.getMessage() for r in caplog.records)
```

- [ ] **Step 13.2: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_dispatcher.py -v
```

Expected: PASS.

- [ ] **Step 13.3: Commit**

```bash
git add backend/tests/test_notifications_dispatcher.py
git commit -m "test(notifications): session-acquire wedge keeps rows untouched

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: acquire_singleton_lock() with fd-leak guard

**Files:**
- Modify: `backend/mathion/notifications/dispatcher.py` (add helper)
- Create: `backend/tests/test_notifications_lock.py` (~6 tests)

**Spec reference:** §5 lines 392-440 (acquire_singleton_lock body) + §12 lines 1146-1170 (test cases).

- [ ] **Step 14.1: Write the failing tests**

Create `backend/tests/test_notifications_lock.py`:

```python
import builtins
import fcntl
import unittest.mock

import pytest

from mathion.config import settings
from mathion.notifications.dispatcher import acquire_singleton_lock


def _patch_lock_path(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "dispatcher_lock_path", str(tmp_path / "dispatcher.lock"))


def test_acquire_returns_fd(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    fd = acquire_singleton_lock(settings)
    assert fd is not None
    fd.close()


def test_second_acquire_raises(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    fd = acquire_singleton_lock(settings)
    try:
        with pytest.raises(RuntimeError, match="Another Mathion dispatcher"):
            acquire_singleton_lock(settings)
    finally:
        fd.close()


def test_close_releases_lock(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    fd = acquire_singleton_lock(settings)
    fd.close()
    # Re-acquiring after close should succeed.
    fd2 = acquire_singleton_lock(settings)
    fd2.close()


def test_acquire_uses_configured_path(tmp_path, monkeypatch):
    target = tmp_path / "custom.lock"
    monkeypatch.setattr(settings, "dispatcher_lock_path", str(target))
    fd = acquire_singleton_lock(settings)
    try:
        assert target.exists()
    finally:
        fd.close()


def test_non_blocking_error_closes_fd(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)

    real_open = builtins.open
    captured = {}
    def wrapped_open(path, mode, *args, **kwargs):
        f = real_open(path, mode, *args, **kwargs)
        captured["fd"] = f
        captured["close_spy"] = unittest.mock.Mock(wraps=f.close)
        f.close = captured["close_spy"]
        return f
    monkeypatch.setattr(builtins, "open", wrapped_open)
    monkeypatch.setattr(fcntl, "flock",
                        unittest.mock.Mock(side_effect=OSError("simulated EBADF")))
    with pytest.raises(OSError, match="simulated EBADF"):
        acquire_singleton_lock(settings)
    captured["close_spy"].assert_called_once()
```

- [ ] **Step 14.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_lock.py -v
```

Expected: FAIL — `acquire_singleton_lock` doesn't exist.

- [ ] **Step 14.3: Add acquire_singleton_lock to dispatcher.py**

Append to `backend/mathion/notifications/dispatcher.py` (spec §5 lines 397-440):

```python
import fcntl
from pathlib import Path


def acquire_singleton_lock(settings):
    """Fail loud if another process holds the lock.

    Returns the open fd; caller releases it explicitly (more reliable than
    atexit, which may not fire on SIGKILL/OOM — kernel cleanup releases the
    flock there). The try/finally + success flag guards against fd leaks if
    fcntl.flock raises ANY exception other than BlockingIOError (e.g. OSError
    from stale NFS, EBADF, EINTR on uncommon kernels)."""
    lock_path = Path(settings.dispatcher_lock_path)
    fd = open(lock_path, "w")
    success = False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(
                f"Another Mathion dispatcher process holds the lock at "
                f"{lock_path}. Set MATHION_DISPATCHER_LOCK_PATH per-process or "
                f"run uvicorn with a single worker."
            ) from exc
        success = True
        return fd
    finally:
        if not success:
            fd.close()
```

- [ ] **Step 14.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_lock.py -v
```

Expected: PASS.

- [ ] **Step 14.5: Commit**

```bash
git add backend/mathion/notifications/dispatcher.py backend/tests/test_notifications_lock.py
git commit -m "feat(notifications): acquire_singleton_lock with fd-leak guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: run_forever() async loop

**Files:**
- Modify: `backend/mathion/notifications/dispatcher.py` (add run_forever + constants)

**Spec reference:** §5 lines 382-400 (run_forever body).

- [ ] **Step 15.1: Add the constants + run_forever**

Append to `dispatcher.py`:

```python
SHUTDOWN_TIMEOUT_SECONDS = 30
TICK_SLEEP_SECONDS = 30


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

- [ ] **Step 15.2: Update __init__.py**

Add to `backend/mathion/notifications/__init__.py`:

```python
from .dispatcher import tick, run_forever, acquire_singleton_lock, SHUTDOWN_TIMEOUT_SECONDS
```

- [ ] **Step 15.3: Quick smoke test**

```bash
backend/.venv/bin/python -c "from mathion.notifications import tick, run_forever, acquire_singleton_lock; print('ok')"
```

Expected: `ok`.

- [ ] **Step 15.4: Commit**

```bash
git add backend/mathion/notifications/dispatcher.py backend/mathion/notifications/__init__.py
git commit -m "feat(notifications): run_forever async loop with asyncio.to_thread

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Lifespan integration

### Task 16: FastAPI lifespan wires mailer + lock + dispatcher

**Files:**
- Modify: `backend/mathion/main.py`
- Modify: `backend/tests/test_notifications_lock.py` (+1 lifespan-disabled test)
- Create: `backend/tests/test_notifications_lifespan.py` (~2 tests including async mid-batch shutdown)

**Spec reference:** §5 lines 442-470 + §12 lines 1131-1133 (lifespan-refuses-on-lock-held), 1136-1145 (mid-batch shutdown).

- [ ] **Step 16.1: Pin pytest-asyncio in backend/pyproject.toml**

Open `backend/pyproject.toml`. Add to the dev dependencies group:

```toml
pytest-asyncio = ">=0.23"
```

Run `cd backend && .venv/bin/pip install -e ".[dev]"` (or your project's install command) to install it.

- [ ] **Step 16.2: Write the failing lifespan tests**

Add to `test_notifications_lock.py`:

```python
from fastapi.testclient import TestClient

def test_lifespan_refuses_when_lock_held(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "email_mode", "memory")
    fd = acquire_singleton_lock(settings)
    try:
        from mathion.main import app
        with pytest.raises(RuntimeError, match="Another Mathion dispatcher"):
            with TestClient(app):
                pass
    finally:
        fd.close()


def test_lifespan_disabled_mode_no_lock(tmp_path, monkeypatch):
    _patch_lock_path(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "email_mode", "disabled")
    from mathion.main import app
    with TestClient(app):
        pass
    assert not (tmp_path / "dispatcher.lock").exists()
    assert app.state.lock_fd is None
    assert app.state.mailer is None
```

Create `backend/tests/test_notifications_lifespan.py`:

```python
import asyncio
import logging
from datetime import datetime, timezone

import pytest

from mathion.config import settings
from mathion.main import app
from mathion.notifications.mailer import MemoryMailer
from mathion.models_auth import NotificationLogEntry


class _SlowMailer(MemoryMailer):
    """MemoryMailer that sleeps 2s on each send to force a mid-batch shutdown."""
    def send(self, msg):
        import time
        time.sleep(2)
        self.sent.append(msg)


@pytest.mark.asyncio
async def test_lifespan_shutdown_with_inflight_tick(db, seeded_run, tmp_path, monkeypatch, caplog):
    """Verify the §5 task.cancel() + asyncio.wait_for drain logic."""
    monkeypatch.setattr(settings, "dispatcher_lock_path", str(tmp_path / "shutdown.lock"))
    monkeypatch.setattr(settings, "email_mode", "memory")

    student = seeded_run["student_user"]
    run = seeded_run["run"]
    for _ in range(20):
        db.add(NotificationLogEntry(
            user_id=student.id, kind="run_enrolled",
            payload={"run_id": run.id}))
    db.commit()

    caplog.set_level(logging.ERROR, logger="asyncio")

    # Patch the mailer factory to return a slow MemoryMailer
    monkeypatch.setattr(
        "mathion.notifications.mailer.build_mailer_from_settings",
        lambda s: _SlowMailer())

    from mathion.main import lifespan
    async with lifespan(app):
        # Wait for at least one send
        for _ in range(50):
            if hasattr(app.state, "mailer") and len(app.state.mailer.sent) > 0:
                break
            await asyncio.sleep(0.1)
        # Trigger shutdown — lifespan __aexit__ will set shutdown event + drain
    # After exit, no "Task was destroyed but it is pending"
    leaked = [r for r in caplog.records
              if "Task was destroyed but it is pending" in r.getMessage()]
    assert not leaked, "asyncio leaked a pending task at shutdown"
```

- [ ] **Step 16.3: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_lock.py backend/tests/test_notifications_lifespan.py -v
```

Expected: FAIL — lifespan changes not in main.py yet.

- [ ] **Step 16.4: Wire the lifespan in main.py**

Open `backend/mathion/main.py`. Add at the top:

```python
import asyncio
from contextlib import asynccontextmanager

from mathion.notifications import (
    build_mailer_from_settings, run_forever,
    acquire_singleton_lock, SHUTDOWN_TIMEOUT_SECONDS,
)
```

Replace (or add) the FastAPI `app = FastAPI(...)` declaration to use `lifespan`:

```python
@asynccontextmanager
async def lifespan(app):
    app.state.shutdown = asyncio.Event()
    app.state.mailer = None
    app.state.lock_fd = None
    task = None

    if settings.email_mode != "disabled":
        app.state.lock_fd = acquire_singleton_lock(settings)
        from mathion.notifications.mailer import build_mailer_from_settings
        app.state.mailer = build_mailer_from_settings(settings)
        task = asyncio.create_task(run_forever(app))

    try:
        yield
    finally:
        app.state.shutdown.set()
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=SHUTDOWN_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=5)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass
        if app.state.lock_fd is not None:
            app.state.lock_fd.close()
            app.state.lock_fd = None


app = FastAPI(lifespan=lifespan)
```

- [ ] **Step 16.5: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_lock.py backend/tests/test_notifications_lifespan.py -v
```

Expected: PASS.

- [ ] **Step 16.6: Commit**

```bash
git add backend/pyproject.toml backend/mathion/main.py backend/tests/test_notifications_lock.py backend/tests/test_notifications_lifespan.py
git commit -m "feat(notifications): wire lifespan-launched dispatcher + lock acquire

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Trigger-side fixes

### Task 17: enroll_user_in_run — relocate log insert to else-branch

**Files:**
- Modify: `backend/mathion/api/helpers.py`
- Create: `backend/tests/test_notifications_triggers.py` (~3 tests for this trigger; expand in later tasks)

**Spec reference:** §7.1 lines 658-680.

- [ ] **Step 17.1: Locate the current insert site**

```bash
grep -n "NotificationLogEntry.*run_enrolled\|kind=\"run_enrolled\"" backend/mathion/api/helpers.py
```

Open the file. The current `enroll_user_in_run` has an unconditional `db.add(NotificationLogEntry(kind="run_enrolled", ...))` that fires on group moves too.

- [ ] **Step 17.2: Write the failing tests**

Create `backend/tests/test_notifications_triggers.py`:

```python
from sqlalchemy import select

from mathion.api.helpers import enroll_user_in_run
from mathion.models_auth import NotificationLogEntry


def test_first_enrollment_writes_log_row(db, seeded_run, seeded_user):
    enroll_user_in_run(db, seeded_user, seeded_run["run"], group_id=None)
    db.commit()
    rows = db.execute(
        select(NotificationLogEntry).where(NotificationLogEntry.kind == "run_enrolled")
    ).scalars().all()
    assert len(rows) == 1


def test_group_move_does_not_write_log_row(db, seeded_run_with_group, seeded_enrolled_user):
    """A user already enrolled, then moved to a new group → no new log row."""
    enroll_user_in_run(db, seeded_enrolled_user, seeded_run_with_group["run"],
                       group_id=seeded_run_with_group["group_b"].id)
    db.commit()
    rows = db.execute(
        select(NotificationLogEntry).where(NotificationLogEntry.kind == "run_enrolled")
    ).scalars().all()
    assert len(rows) == 1  # ONLY the original enrollment row


def test_group_unassign_does_not_write_log_row(db, seeded_run_with_group, seeded_enrolled_user):
    enroll_user_in_run(db, seeded_enrolled_user, seeded_run_with_group["run"], group_id=None)
    db.commit()
    rows = db.execute(
        select(NotificationLogEntry).where(NotificationLogEntry.kind == "run_enrolled")
    ).scalars().all()
    assert len(rows) == 1
```

- [ ] **Step 17.3: Run tests to verify they fail (or shows wrong count)**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_triggers.py -v
```

Expected: The `group_move` and `group_unassign` tests fail with 2 log rows instead of 1.

- [ ] **Step 17.4: Move the insert into the else-branch**

Open `backend/mathion/api/helpers.py`. Find the `enroll_user_in_run` function. The structure should look like:

```python
def enroll_user_in_run(db, user, run, group_id):
    rs = db.execute(
        select(RunStudent)
        .where(RunStudent.run_id == run.id, RunStudent.user_id == user.id)
    ).scalar_one_or_none()
    if rs:
        rs.group_id = group_id
        # NO NotificationLogEntry insert here — this is the group-move branch.
    else:
        db.add(RunStudent(run_id=run.id, user_id=user.id, group_id=group_id))
        db.add(NotificationLogEntry(
            user_id=user.id, kind="run_enrolled",
            payload={"run_id": run.id},
        ))
```

Move the existing `NotificationLogEntry` insert from the function-body level into the `else` branch only.

- [ ] **Step 17.5: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_triggers.py -v
```

Expected: PASS.

- [ ] **Step 17.6: Commit**

```bash
git add backend/mathion/api/helpers.py backend/tests/test_notifications_triggers.py
git commit -m "fix(api): relocate run_enrolled NotificationLogEntry to first-enrollment branch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: publish_run — remove bulk-notify loop + dead course_slug lookup

**Files:**
- Modify: `backend/mathion/api/runs.py`

**Spec reference:** §7.2 lines 682-688.

- [ ] **Step 18.1: Locate the loop**

```bash
grep -n "run_published\|course_slug = run.version.course.slug" backend/mathion/api/runs.py
```

Find the `publish_run` function and the per-student loop that inserts `NotificationLogEntry(kind="run_published", ...)` (per spec, currently lines 220-232).

- [ ] **Step 18.2: Delete the loop AND the dead course_slug lookup**

Remove the entire loop and the (now dead) `course_slug = run.version.course.slug` lookup at line ~218. Replace with no-op (the publish endpoint's other side-effects — setting `is_published=True` and `published_at`, plus the audit-log row — remain unchanged).

- [ ] **Step 18.3: Run the existing run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_runs.py -v
```

Expected: tests pass EXCEPT for `test_publish_writes_run_published_notification_per_student`. That test will be deleted in Task 24.

- [ ] **Step 18.4: Commit**

```bash
git add backend/mathion/api/runs.py
git commit -m "fix(api): remove per-student run_published notify loop from publish_run

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: publish_mini_project — transition guard with refetch+lock

**Files:**
- Modify: `backend/mathion/api/mini_projects.py`
- Modify: `backend/tests/test_notifications_triggers.py` (~5 tests)

**Spec reference:** §7.3 lines 688-770.

- [ ] **Step 19.1: Write the failing tests**

Append to `backend/tests/test_notifications_triggers.py`:

```python
from sqlalchemy.exc import NoResultFound


def test_mp_publish_writes_per_student(db, seeded_run_with_students_and_draft_mp):
    """First publish: each non-disabled-group student gets a log row."""
    fixture = seeded_run_with_students_and_draft_mp
    mp = fixture["mp"]
    # Simulate calling publish endpoint logic; or use TestClient to POST publish
    # ... (test exercises the publish_mini_project endpoint)
    rows = db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()
    assert len(rows) == len(fixture["roster_excluding_disabled"])


def test_mp_publish_excludes_disabled_group_students(db, seeded_run_with_disabled_group_and_draft_mp):
    fixture = seeded_run_with_disabled_group_and_draft_mp
    # ... publish MP ...
    rows = db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()
    student_ids = {r.user_id for r in rows}
    # Disabled-group students are NOT in the recipient set
    for s in fixture["disabled_group_students"]:
        assert s.id not in student_ids


def test_mp_republish_is_idempotent(db, seeded_run_with_published_mp):
    """Re-publishing an already-published MP: no new log rows AND endpoint returns success."""
    before_ids = {r.id for r in db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()}
    before_count = len(before_ids)
    # POST publish endpoint again
    # ...
    after_ids = {r.id for r in db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()}
    assert len(after_ids) == before_count  # set-equality test catches buggy delete+reinsert
    assert after_ids == before_ids


def test_mp_publish_no_students_writes_zero_rows(db, seeded_run_no_students):
    fixture = seeded_run_no_students
    # publish the draft MP
    # ...
    rows = db.execute(
        select(NotificationLogEntry).where(
            NotificationLogEntry.kind == "mini_project_published"
        )
    ).scalars().all()
    assert len(rows) == 0


def test_mp_publish_deleted_mp_returns_404(client, seeded_run_with_draft_mp, db):
    """If MP is deleted between get_or_404 and refetch, return 404 not 500."""
    fixture = seeded_run_with_draft_mp
    mp_id = fixture["mp"].id
    # Pre-publish: hand-delete the MP from another session
    db.delete(fixture["mp"]); db.commit()
    # Now POST publish — refetch will raise NoResultFound, endpoint returns 404
    response = client.post(f"/api/runs/{fixture['run'].id}/mini_projects/{mp_id}/publish")
    assert response.status_code == 404
    assert response.json()["detail"] == "MiniProject not found"
```

- [ ] **Step 19.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_triggers.py -v
```

Expected: FAIL — the publish path doesn't yet write notification rows.

- [ ] **Step 19.3: Modify publish_mini_project**

Open `backend/mathion/api/mini_projects.py`. Find `publish_mini_project` (around line 258-296). Following spec §7.3 exactly:

1. Add imports at module top:
   ```python
   from sqlalchemy import select
   from sqlalchemy.exc import NoResultFound
   from mathion.models import RunStudent, Group
   from mathion.models_auth import NotificationLogEntry
   ```
2. After the existing permission + transition-state validation block (lines ~280-292), BEFORE `mp.is_published = True; db.commit()`, insert:

```python
mp_id = mp.id  # capture before reassignment for refactor-safety
try:
    mp = db.execute(
        select(MiniProject)
        .where(MiniProject.id == mp_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()
except NoResultFound:
    raise HTTPException(status_code=404, detail="MiniProject not found")

was_published = mp.is_published
mp.is_published = True

if not was_published:
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

db.commit()  # SINGLE commit; relocated from line 294
```

3. Remove the previous standalone `db.commit()` that came right after `mp.is_published = True` — there must be exactly ONE commit at the end of this block, so the publish flip + the notification inserts live in the same transaction.

- [ ] **Step 19.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_notifications_triggers.py backend/tests/test_mini_projects.py -v
```

Expected: PASS.

- [ ] **Step 19.5: Commit**

```bash
git add backend/mathion/api/mini_projects.py backend/tests/test_notifications_triggers.py
git commit -m "feat(api): publish_mini_project emits mini_project_published on transition

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Publish-gate API

### Task 20: 409 publish-gate on add_student + add_students_batch

**Files:**
- Modify: `backend/mathion/api/run_roster.py`
- Create: `backend/tests/test_run_roster_publish_gate.py` (~6 tests)

**Spec reference:** §8 lines 743-805.

- [ ] **Step 20.1: Write the failing tests**

Create `backend/tests/test_run_roster_publish_gate.py`:

```python
def test_add_student_returns_409_on_draft(client, seeded_draft_run, admin_session):
    r = client.post(
        f"/api/runs/{seeded_draft_run['run'].id}/students",
        json={"email": "anyone@example.com"},
        cookies=admin_session,
    )
    assert r.status_code == 409
    body = r.json()
    assert body["detail"] == "Cannot add students to an unpublished run"
    assert body["error_code"] == "run_unpublished"  # TOP-LEVEL


def test_add_student_status_unchanged_on_published(client, seeded_published_run, admin_session):
    r = client.post(
        f"/api/runs/{seeded_published_run['run'].id}/students",
        json={"email": "anyone@example.com"},
        cookies=admin_session,
    )
    assert r.status_code == 200  # or whatever the existing happy-path code is


def test_batch_add_returns_whole_call_409(client, seeded_draft_run, admin_session):
    r = client.post(
        f"/api/runs/{seeded_draft_run['run'].id}/students/batch",
        json={"rows": [{"email": "a@x"}, {"email": "b@x"}]},
        cookies=admin_session,
    )
    assert r.status_code == 409
    assert r.json()["error_code"] == "run_unpublished"


def test_constant_parity():
    from mathion.api.run_roster import RUN_UNPUBLISHED_ERROR_CODE
    assert RUN_UNPUBLISHED_ERROR_CODE == "run_unpublished"


def test_openapi_documents_409(client):
    schema = client.get("/openapi.json").json()
    path = schema["paths"]["/api/runs/{run_id}/students"]["post"]
    assert "409" in path["responses"]
    assert (path["responses"]["409"]["content"]["application/json"]["example"]
            == {"detail": "Cannot add students to an unpublished run",
                "error_code": "run_unpublished"})


def test_patch_group_move_still_works_on_draft(client, seeded_draft_run_with_student, admin_session):
    """Move endpoint is NOT gated — see §8 'Endpoints NOT gated'."""
    fixture = seeded_draft_run_with_student
    r = client.patch(
        f"/api/runs/{fixture['run'].id}/students/{fixture['student'].id}",
        json={"group_id": None},
        cookies=admin_session,
    )
    assert r.status_code == 200
```

- [ ] **Step 20.2: Run tests to verify they fail**

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_publish_gate.py -v
```

Expected: FAIL — gate not in place.

- [ ] **Step 20.3: Add the gate to run_roster.py**

Open `backend/mathion/api/run_roster.py`. At the top, add:

```python
from fastapi.responses import JSONResponse

RUN_UNPUBLISHED_ERROR_CODE = "run_unpublished"
```

In `add_student` (after the auth dependency check and BEFORE per-row group/capacity validation), add:

```python
if not run.is_published:
    return JSONResponse(
        status_code=409,
        content={"detail": "Cannot add students to an unpublished run",
                 "error_code": RUN_UNPUBLISHED_ERROR_CODE})
```

Same in `add_students_batch` (top of handler, BEFORE the per-row loop).

Decorate both endpoints with the OpenAPI 409 response:

```python
@router.post(
    "/api/runs/{run_id}/students",
    responses={409: {
        "description": "Run is not published",
        "content": {"application/json": {"example": {
            "detail": "Cannot add students to an unpublished run",
            "error_code": "run_unpublished"}}}}})
```

Same for the batch endpoint.

- [ ] **Step 20.4: Run tests**

```bash
backend/.venv/bin/pytest backend/tests/test_run_roster_publish_gate.py -v
```

Expected: PASS.

- [ ] **Step 20.5: Commit**

```bash
git add backend/mathion/api/run_roster.py backend/tests/test_run_roster_publish_gate.py
git commit -m "feat(api): 409 publish-gate on add_student + add_students_batch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Frontend

### Task 21: Export ActiveTab type from RunDetailPage

**Files:**
- Modify: `frontend/src/pages/runs/RunDetailPage.svelte` (line 30)

**Spec reference:** §2 line 62.

- [ ] **Step 21.1: Open the file**

```bash
sed -n '28,32p' frontend/src/pages/runs/RunDetailPage.svelte
```

Find the existing `type ActiveTab = …` declaration at line 30.

- [ ] **Step 21.2: Add the `export` keyword**

Change `type ActiveTab = '…' | …;` to `export type ActiveTab = '…' | …;`.

- [ ] **Step 21.3: Run svelte-check**

```bash
cd frontend && npm run check
```

Expected: 0 errors.

- [ ] **Step 21.4: Commit**

```bash
git add frontend/src/pages/runs/RunDetailPage.svelte
git commit -m "feat(frontend): export ActiveTab type from RunDetailPage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: RUN_UNPUBLISHED_ERROR_CODE in runRoster.ts

**Files:**
- Modify: `frontend/src/lib/runRoster.ts`

**Spec reference:** §2 line 65.

- [ ] **Step 22.1: Add the constant**

Append to `frontend/src/lib/runRoster.ts`:

```typescript
export const RUN_UNPUBLISHED_ERROR_CODE = 'run_unpublished';
```

Do NOT widen `BulkRosterErrorCode` (that union is for per-row 207 errors, not whole-call 409).

- [ ] **Step 22.2: Run check**

```bash
cd frontend && npm run check
```

Expected: 0 errors.

- [ ] **Step 22.3: Commit**

```bash
git add frontend/src/lib/runRoster.ts
git commit -m "feat(frontend): export RUN_UNPUBLISHED_ERROR_CODE constant

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: RunRosterTab — banner + control gating + 409 handling

**Files:**
- Modify: `frontend/src/components/runs/RunRosterTab.svelte`
- Create: `frontend/src/tests/RunRosterTab.draft-gate.svelte.test.ts` (~6 tests)

**Spec reference:** §2 line 63 + §9 lines 836-920.

- [ ] **Step 23.1: Write the failing tests**

Use the mount/unmount/flushSync pattern (NOT @testing-library/svelte). Create `frontend/src/tests/RunRosterTab.draft-gate.svelte.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import { RUN_UNPUBLISHED_ERROR_CODE } from '../lib/runRoster';

let target: HTMLDivElement | null = null;
let component: unknown = null;

afterEach(() => { if (component) { unmount(component); component = null; } target = null; });

function mountTab(props: Partial<Parameters<typeof RunRosterTab>[0]['props']> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const defaults = {
    runId: 1, runIsPublished: false, courseSlug: 'calc-101',
    onNavigateToTab: () => {}, /* other required props */
  };
  component = mount(RunRosterTab, { target, props: { ...defaults, ...props } });
  flushSync();
}

it('banner visible when draft', () => {
  mountTab({ runIsPublished: false });
  expect(target!.querySelector('#roster-draft-publish-hint')).toBeTruthy();
});

it('banner absent when published', () => {
  mountTab({ runIsPublished: true });
  expect(target!.querySelector('#roster-draft-publish-hint')).toBeFalsy();
});

it('add button disabled when draft', () => {
  mountTab({ runIsPublished: false });
  const btn = target!.querySelector('button[aria-label="Add student"]') as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
});

it('add button enabled when published', () => {
  mountTab({ runIsPublished: true });
  const btn = target!.querySelector('button[aria-label="Add student"]') as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
});

it('error_code constant is the exact literal', () => {
  expect(RUN_UNPUBLISHED_ERROR_CODE).toBe('run_unpublished');
});

it('move action remains enabled on draft (regression for §8)', () => {
  mountTab({ runIsPublished: false /* with seeded student */ });
  const moveBtn = target!.querySelector('button[aria-label="Move student"]') as HTMLButtonElement | null;
  if (moveBtn) expect(moveBtn.disabled).toBe(false);
});
```

- [ ] **Step 23.2: Run tests to verify they fail**

```bash
cd frontend && npm test -- RunRosterTab.draft-gate
```

Expected: FAIL — banner, gating logic not in place.

- [ ] **Step 23.3: Modify RunRosterTab.svelte**

Per spec §2 line 63 + §9 lines 836-920:

1. Add new props: `runIsPublished: boolean`, `courseSlug: string`, `onNavigateToTab: (tab: ActiveTab) => void`.
2. Import the type: `import type { ActiveTab } from '../../pages/runs/RunDetailPage.svelte';`.
3. Import the constant: `import { RUN_UNPUBLISHED_ERROR_CODE } from '../../lib/runRoster';`.
4. Render the banner at top of `.roster-tab`:

```svelte
{#if !runIsPublished}
  <div id="roster-draft-publish-hint" class="banner" role="status">
    Publish this run before adding students.
    <button onclick={() => onNavigateToTab('overview')}>Publish on Overview</button>
  </div>
{/if}
```

5. Mark Add + Import buttons + empty-state CTA `disabled={!runIsPublished}` with `aria-describedby="roster-draft-publish-hint"`.
6. In `submitAdd`, early-return if `!runIsPublished`.
7. In the catch block of `submitAdd`'s fetch, handle 409 by checking `e.errorCode === RUN_UNPUBLISHED_ERROR_CODE` and routing the message into the existing `addError` channel.
8. Copy the `.banner` CSS scoped block from `RunMiniProjectsTab.svelte:340-346`.

- [ ] **Step 23.4: Pass the prop from RunDetailPage**

In `RunDetailPage.svelte`, find the `<RunRosterTab ... />` usage and add:

```svelte
<RunRosterTab
  runIsPublished={run.is_published}
  courseSlug={courseSlug}
  onNavigateToTab={(t) => activeTab = t}
  ... />
```

- [ ] **Step 23.5: Run tests**

```bash
cd frontend && npm test -- RunRosterTab.draft-gate && npm run check
```

Expected: PASS + 0 svelte-check errors.

- [ ] **Step 23.6: Commit**

```bash
git add frontend/src/components/runs/RunRosterTab.svelte frontend/src/pages/runs/RunDetailPage.svelte frontend/src/tests/RunRosterTab.draft-gate.svelte.test.ts
git commit -m "feat(frontend): Draft-state banner + control gating in RunRosterTab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: RosterImportModal — 409 submitError handling

**Files:**
- Modify: `frontend/src/components/runs/RosterImportModal.svelte`
- Create: `frontend/src/tests/RosterImportModal.unpublished.svelte.test.ts` (~1 test)

**Spec reference:** §2 line 64.

- [ ] **Step 24.1: Write the failing test**

Create `frontend/src/tests/RosterImportModal.unpublished.svelte.test.ts`:

```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RosterImportModal from '../components/runs/RosterImportModal.svelte';
import { RUN_UNPUBLISHED_ERROR_CODE } from '../lib/runRoster';

let target: HTMLDivElement | null = null;
let component: unknown = null;

afterEach(() => { if (component) { unmount(component); component = null; } target = null; });

it('submit-step 409 surfaces via submitError slot with role=alert', async () => {
  target = document.createElement('div');
  document.body.appendChild(target);

  // Mock batchAddRunStudents to reject with a 409 ApiError
  const mockBatch = vi.fn().mockRejectedValue({
    status: 409,
    errorCode: RUN_UNPUBLISHED_ERROR_CODE,
    displayMessage: 'Cannot add students to an unpublished run',
  });

  component = mount(RosterImportModal, {
    target,
    props: {
      runId: 1,
      onClose: () => {},
      batchAddRunStudents: mockBatch,
      // ...other required props
    },
  });
  flushSync();

  // Simulate paste + submit
  const textarea = target!.querySelector('textarea')!;
  textarea.value = 'a@example.com';
  textarea.dispatchEvent(new Event('input'));
  flushSync();

  const submitBtn = target!.querySelector('button[aria-label="Import"]') as HTMLButtonElement;
  submitBtn.click();
  await Promise.resolve();
  flushSync();

  const errorEl = target!.querySelector('p.error[role="alert"]');
  expect(errorEl).toBeTruthy();
  expect(errorEl!.textContent).toContain('Cannot add students');
});
```

- [ ] **Step 24.2: Modify RosterImportModal.svelte**

Add a new `let submitError = $state<string | null>(null);`. In the submit-path catch, set `submitError = e.displayMessage ?? e.detail`. Render `{#if submitError}<p class="error" role="alert">{submitError}</p>{/if}` above `.modal-actions`. Clear `submitError` on `onTextInput`. Do NOT add `role="alert"` to the existing `parsed.error` slot.

- [ ] **Step 24.3: Run tests**

```bash
cd frontend && npm test -- RosterImportModal.unpublished && npm run check
```

Expected: PASS.

- [ ] **Step 24.4: Commit**

```bash
git add frontend/src/components/runs/RosterImportModal.svelte frontend/src/tests/RosterImportModal.unpublished.svelte.test.ts
git commit -m "feat(frontend): RosterImportModal 409 surfaces via separate submitError slot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8 — Test fixture updates

### Task 25: conftest.py — env-set + autouse pytest_configure

Move existing mathion imports BELOW the env-set, add `MATHION_EMAIL_MODE=disabled`, add `pytest_configure` belt-and-suspenders.

**Files:**
- Modify: `backend/tests/conftest.py`

**Spec reference:** §12 lines 1296-1316.

- [ ] **Step 25.1: Apply the recipe**

Open `backend/tests/conftest.py`. The current first ~13 lines have mathion imports starting at line 9. Restructure to:

```python
# ---- MUST RUN BEFORE any mathion.* import — Settings() in config.py:29
# is constructed at import time and snapshots MATHION_EMAIL_MODE.
import os
os.environ.setdefault("MATHION_EMAIL_MODE", "disabled")

# ---- Safe now: existing mathion imports relocated here.
from mathion.config import settings
from mathion.database import Base
from mathion.main import app
from mathion.models_auth import User
from mathion.auth import auth_helpers  # preserve exact import list from previous file


def pytest_configure(config):
    assert settings.email_mode == "disabled", (
        f"Test conftest race: settings.email_mode is {settings.email_mode!r} but "
        "the disable_dispatcher_loop recipe expects 'disabled'. Some plugin "
        "imported mathion.config before the os.environ.setdefault block."
    )

# Remainder of conftest unchanged.
```

- [ ] **Step 25.2: Run the full suite**

```bash
backend/.venv/bin/pytest backend/tests/ -x -q
```

Expected: everything still passes (the disabled mode is the test default).

- [ ] **Step 25.3: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(conftest): env-set MATHION_EMAIL_MODE before mathion imports + pytest_configure assert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: conftest seed_run_with_groups — publish-before-add

**Files:**
- Modify: `backend/tests/conftest.py` (the `seed_run_with_groups` fixture)

**Spec reference:** §2 line 53.

- [ ] **Step 26.1: Locate the fixture**

```bash
grep -n "def seed_run_with_groups" backend/tests/conftest.py
```

- [ ] **Step 26.2: Add publish step before student adds**

The fixture currently adds students to a draft run. Per spec, add a teacher (line ~230 of the fixture already does this) BEFORE the publish call, then add the publish step. Existing students-add code runs against the published run.

The change: add `client.post(f"/api/runs/{run.id}/publish", ...)` after teacher-assign and before any `/students` POST.

- [ ] **Step 26.3: Run the full suite to surface dependent tests**

```bash
backend/.venv/bin/pytest backend/tests/ -x -q
```

Expected: tests in `test_mini_project_notifications.py`, `test_run_render.py`, `test_evaluations.py`, `test_mini_projects.py`, `test_run_assets.py`, `test_run_roster.py`, `test_submissions.py`, `test_runs.py`, `test_groups.py` should pass (they were already exercising published-state behavior; the fixture change makes that explicit).

- [ ] **Step 26.4: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(conftest): seed_run_with_groups publishes run before adding students

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: Existing test files — _make_run rename + publish-then-add

**Files:**
- Modify: `backend/tests/test_run_roster.py` (rename `_make_run` → `_make_published_run`, add `_make_draft_run` for new 409-gate tests)
- Modify: `backend/tests/test_run_roster_bulk.py` (same pattern)
- Modify: `backend/tests/test_teaching.py::test_student_count_multiple` (publish before adding students)
- Modify: `backend/tests/test_runs.py::test_publish_with_groups_enabled_unassigned_student_409` (rewrite along unpublish/republish workflow)
- Delete: `backend/tests/test_runs.py::test_publish_writes_run_published_notification_per_student`

**Spec reference:** §2 lines 54-59.

- [ ] **Step 27.1: test_run_roster.py rename + add draft helper**

```bash
sed -n '1,10p' backend/tests/test_run_roster.py
```

Rename `_make_run` to `_make_published_run`. Add at the top of the helper: a teacher POST, then a publish POST. Add a new `_make_draft_run` (no teacher, no publish) for the new 409-gate tests in Task 20.

Find every callsite of `_make_run` in this file (`grep -n _make_run`) and rename to `_make_published_run`.

- [ ] **Step 27.2: test_run_roster_bulk.py — same**

Rename `_make_run` → `_make_published_run` and update `_add_student` to assume the run is already published. Rename all callsites.

- [ ] **Step 27.3: test_teaching.py — explicit publish in test_student_count_multiple**

Find the test and add a publish call after teacher assignment, before the `_add_student` calls.

- [ ] **Step 27.4: Rewrite test_publish_with_groups_enabled_unassigned_student_409**

The current test posts `/students` against an unpublished run, which the new gate breaks. Rewrite to:
1. Create groups-enabled run.
2. Add teacher.
3. Publish.
4. POST student with `group_id=None` (passes the gate; `add_student` allows this).
5. POST `/api/runs/<id>/unpublish` (`runs.py:239-248`).
6. POST `/api/runs/<id>/publish` → assert 409 with the existing `"unassigned > 0"` message (`runs.py:192-199`).

- [ ] **Step 27.5: Delete test_publish_writes_run_published_notification_per_student**

```bash
grep -n "test_publish_writes_run_published_notification_per_student" backend/tests/test_runs.py
```

Delete the function entirely (current lines ~179-189 per spec §2). The `run_published` event is no longer emitted (Task 18 removed the loop).

- [ ] **Step 27.6: test_run_notifications.py updates**

Open `backend/tests/test_run_notifications.py`. Remove every assertion that expects a `run_published` log row. Add new assertions for `run_enrolled` (post-publish add) and `mini_project_published` (after publish_mini_project).

- [ ] **Step 27.7: Run the full suite**

```bash
backend/.venv/bin/pytest backend/tests/ -x -q
```

Expected: PASS.

- [ ] **Step 27.8: Commit**

```bash
git add backend/tests/test_run_roster.py backend/tests/test_run_roster_bulk.py backend/tests/test_teaching.py backend/tests/test_runs.py backend/tests/test_run_notifications.py
git commit -m "test: rename _make_run → _make_published_run, drop run_published assertions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9 — Manual smoke walkthrough

### Task 28: Run the §13 manual smoke walkthrough end-to-end

This task is operator-driven, not test-code. It verifies the slice works against a real (file-mode) email outbox.

**Spec reference:** §13 lines 1336-1383.

- [ ] **Step 28.1: Set env vars + start the app**

```bash
export MATHION_EMAIL_MODE=file
export MATHION_EMAIL_OUTBOX=/tmp/mathion-outbox/
export MATHION_BASE_URL=http://localhost:8000
cd backend && .venv/bin/uvicorn mathion.main:app --reload
```

Verify `/tmp/mathion-outbox/` was created AND `/tmp/mathion.dispatcher.lock` exists. They should be SEPARATE paths (lock NOT inside outbox).

- [ ] **Step 28.2: Verify multi-worker rejection**

In a SECOND terminal, attempt to start uvicorn again with the same config. It must fail loud with "Another Mathion dispatcher process holds the lock at /tmp/mathion.dispatcher.lock".

- [ ] **Step 28.3: Walk through steps 3-12 from spec §13**

Follow spec §13 lines 1338-1383 verbatim. Key acceptance checks:
- Step 3: draft run with `groups_enabled=true`; banner visible; controls disabled
- Step 4: cURL 409 with TOP-LEVEL `error_code`
- Step 4.5: assign teacher
- Step 5: publish; banner disappears
- Step 6: enroll student → `.eml` arrives with bare run URL (no `?tab=`)
- Step 7: group move → NO new `.eml`
- Step 8: assign 2nd teacher → `.eml`
- Step 8.5: create MP (draft)
- Step 9: publish MP → 1 `.eml` per roster student; re-publish → NO new `.eml`
- Step 10: submit + evaluate → `.eml` per group member
- Step 11: per-row backoff test (real SMTP rejecting a recipient)
- Step 12: SMTP-config wedge (port=1 → wedge log on every tick, no row state change)

- [ ] **Step 28.4: Document any deviations**

If any step doesn't work as written, file an issue with the deviation. Otherwise, commit a sentinel file or update the plan checklist.

- [ ] **Step 28.5: Commit checklist**

```bash
git add docs/superpowers/plans/2026-06-13-notifications-email.md
git commit -m "chore: mark notifications-email smoke walkthrough complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 10 — Final cleanup

### Task 29: Final test-suite green + svelte-check + merge readiness

- [ ] **Step 29.1: Run the full backend suite**

```bash
backend/.venv/bin/pytest backend/tests/ -v
```

Expected: ALL ~95 new tests + existing suite PASS.

- [ ] **Step 29.2: Run frontend tests + svelte-check**

```bash
cd frontend && npm test && npm run check
```

Expected: ALL ~7 new tests + existing tests PASS; svelte-check reports 0 errors.

- [ ] **Step 29.3: Verify smoke walkthrough one more time (sanity)**

Re-run §13 steps 3-9 quickly. Both `.eml` files in the outbox AND log lines (no `dispatcher tick failed` accumulating).

- [ ] **Step 29.4: Use finishing-a-development-branch skill to merge or PR**

Invoke `superpowers:finishing-a-development-branch` — the skill will detect environment (normal repo, not a worktree), present the 4-option menu, and handle merge-to-main or PR creation per user choice.

---

## Spec-coverage self-review

Tasks → spec sections mapping:

| Spec § | Coverage |
|---|---|
| §1 Scope | Validated by Task 28 smoke |
| §2 Files touched | All listed files modified across T1-T27 |
| §3 Migration | T2 (model) + T3 (alembic + tests) |
| §4 Mailer | T5 (ABC + Memory) + T6 (File) + T7 (SMTP) + T8 (factory) |
| §5 Dispatcher | T10 (_build_render_context) + T11 (tick happy) + T12 (tick error) + T13 (wedge) + T14 (lock) + T15 (run_forever) + T16 (lifespan) |
| §6.1 Payload contracts | T10 |
| §6.2 Templates | T9 |
| §6.3 _build_email_message | T9 |
| §7.1 enroll_user_in_run | T17 |
| §7.2 publish_run | T18 |
| §7.3 publish_mini_project | T19 |
| §8 Publish-gate | T20 |
| §9 UI affordance | T21 (export ActiveTab) + T22 (constant) + T23 (banner + gate) + T24 (modal) |
| §10 Config | T1 |
| §11 Retry + classify | T4 (errors) + T11/T12 (dispatcher branches) |
| §12 Test plan | Distributed across T1-T27 |
| §13 Manual smoke | T28 |
| §14 Caveats | Documented in spec; smoke surfaces them |
| §15 Out of scope | N/A |
| §16 Runbook | Operator-facing; verified by T28 |

**No spec requirement left unmapped.** Self-review complete.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-13-notifications-email.md`.
