# Superuser Panel — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver token-gated `/superuser/{token}` access, an authenticated panel shell, a system-stats dashboard, an interim bootstrap CLI, synchronous login-PIN email delivery, and a PIN-delivery-aware login screen.

**Architecture:** A dedicated `superuser_panel_tokens` table holds one active hashed panel token. A `require_superuser_panel` FastAPI dependency validates the token **first** (inline, via the `auth.validate_session` service function — never `Depends(require_superuser)`) so failure codes never leak the route (token→404, no-session→401, non-superuser→404). A `python -m mathion.superuser` argparse shim over pure service functions makes the panel reachable without email. The `/api/auth/request-pin` endpoint gains synchronous login-PIN email via a **one-shot mailer built from settings** (not the shared `app.state.mailer`), and a public `GET /api/auth/config` drives a delivery-aware `Login.svelte`.

**Tech Stack:** Backend — FastAPI, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), Alembic, Pydantic v2, SQLite (dev). Frontend — Svelte 5 runes, Vite, Vitest (`mount`/`unmount`/`flushSync` from `svelte`, no `@testing-library`).

## Global Constraints

*Every task's requirements implicitly include this section.*

- **Backend commands run via the venv**, never bare: `backend/.venv/bin/pytest`, `backend/.venv/bin/alembic`, `backend/.venv/bin/python`. Run backend commands from the `backend/` directory.
- **Frontend**: Svelte 5 runes only. **No new JS/CSS dependencies.** Tests use `mount`/`unmount`/`flushSync` from `svelte`; **never** `@testing-library`. Frontend tests live flat in `frontend/src/tests/` and import components via relative `../pages/...` / `../components/...` paths. Run frontend tests via `npm test -- <path>` (the `test` script is `TZ=Europe/Copenhagen vitest run`), not bare `vitest`, so the fixed timezone applies.
- **Commit trailer** — end every commit message with exactly:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Do not stage** the pre-existing untracked files `docs/superpowers/plans/2026-06-04-evaluations-write-surface.md`, `docs/superpowers/specs/2026-06-04-evaluations-write-surface-design.md`, `run-dashboards-smoke.sh`. Stage only the files each task lists.
- **Token generation**: `secrets.token_urlsafe(32)`. Store only its hash via `mathion.auth.hash_token` (sha256 salted with `settings.secret_key`) — plaintext is returned once by the activator, never persisted.
- **Panel guard order (load-bearing)**: (1) token → **404**; (2) valid token but no session → **401**; (3) valid token, authenticated, but not superuser → **404** (deliberately NOT 403). The dependency validates the token itself, then resolves the user **inline** by calling `auth.validate_session(db, session_token)` — **never** `Depends(get_current_user)` / `Depends(require_superuser)` (FastAPI resolves declared sub-dependencies before the body, which would surface 401/403 ahead of the token check).
- **Inactivity window** = 30 min (1800 s). **Bump throttle** = 5 min (300 s). Datetime comparisons use `datetime.now(timezone.utc)` and replicate the SQLite naive-datetime handling in `auth.py:150-153` for any **Python-side** subtraction.
- **`send_pin_enabled` formula** (exact): `settings.debug or settings.email_mode in ("smtp", "file")`.
- **Login-PIN send**: builds a one-shot mailer via `build_mailer_from_settings(settings)` (NOT `app.state.mailer`); sends only when `request_pin` returned a **non-`None`** PIN **and** `not settings.debug` **and** the built mailer is not `None`; the endpoint response stays **uniform** `{"message": "PIN sent"}` regardless of outcome; send failures are logged server-side (never the raw PIN); the raw PIN is never persisted or logged.
- **Migration** `down_revision = "4e17d3637814"` (confirm it is still head at implementation time via `backend/.venv/bin/alembic heads`).
- **Two-step login success copy must be delivery-neutral** — no "sent to {email}" / "to your inbox" wording.

---

## File Structure

**Backend**
- `backend/mathion/models_auth.py` — add `SuperuserPanelToken` (Task 1).
- `backend/alembic/versions/<rev>_add_superuser_panel_token.py` — migration (Task 1).
- `backend/mathion/superuser/__init__.py` — package marker (Task 2).
- `backend/mathion/superuser/service.py` — panel-token service + bootstrap logic (Tasks 2 & 7).
- `backend/mathion/superuser/__main__.py` — argparse shim (Task 7).
- `backend/mathion/api/superuser.py` — `require_superuser_panel` + `GET /api/superuser/{token}/stats` (Task 3).
- `backend/mathion/schemas.py` — `SuperuserStatsResponse` (Task 3), `AuthConfigResponse` (Task 4).
- `backend/mathion/api/auth.py` — `GET /config` (Task 4), login-PIN send in `/request-pin` (Task 5), logout hook (Task 6).
- `backend/mathion/notifications/templates.py` — `build_login_pin_message` (Task 5).
- `backend/mathion/notifications/mailer.py` — extend `_allowed_kinds` (Task 5).
- `backend/mathion/main.py` — wire `superuser_router` (Task 3), `_panel_cache_headers` + `_spa_fallback` no-store (Task 11).

**Frontend**
- `frontend/src/lib/superuser.ts` — `getSuperuserStats` (Task 8).
- `frontend/src/pages/superuser/SuperuserDashboard.svelte` (Task 8).
- `frontend/src/pages/superuser/SuperuserShell.svelte` (Task 9).
- `frontend/src/routes.ts` + `frontend/src/App.svelte` — register `SuperuserShell`, suppress `AppHeader` on `/superuser/…` (Task 9).
- `frontend/src/lib/auth.svelte.ts` — `getAuthConfig` (Task 10).
- `frontend/src/pages/Login.svelte` — delivery-aware login (Task 10).
- `frontend/index.html` — `<meta name="referrer" content="no-referrer">` (Task 11).

---

## Task Dependency Order

1 → 2 → 3; then 4, 5, 6, 7 (each depends on 1–2). Frontend 8 → 9; 10 and 11 independent. Recommended sequence: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11.

---

### Task 1: `SuperuserPanelToken` model + migration

**Files:**
- Modify: `backend/mathion/models_auth.py` (add class after `Session`)
- Create: `backend/alembic/versions/<rev>_add_superuser_panel_token.py`
- Test: `backend/tests/test_superuser_model.py`

**Interfaces:**
- Produces: `mathion.models_auth.SuperuserPanelToken` with columns `id: int`, `token_hash: str` (String(64), unique, indexed), `created_at: datetime` (tz, server-default now), `last_active_at: datetime` (tz, server-default now).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_superuser_model.py`:

```python
def test_superuser_panel_token_roundtrip(db):
    from mathion.models_auth import SuperuserPanelToken

    row = SuperuserPanelToken(token_hash="a" * 64)
    db.add(row)
    db.commit()
    db.refresh(row)

    assert row.id is not None
    assert row.token_hash == "a" * 64
    assert row.created_at is not None
    assert row.last_active_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_model.py -v`
Expected: FAIL — `ImportError: cannot import name 'SuperuserPanelToken'`.

- [ ] **Step 3: Add the model**

In `backend/mathion/models_auth.py`, add after the `Session` class (all needed imports — `String`, `DateTime`, `Integer`, `func`, `Mapped`, `mapped_column` — are already at the top of the file):

```python
class SuperuserPanelToken(Base):
    __tablename__ = "superuser_panel_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_model.py -v`
Expected: PASS. (Tests build tables from the models via `Base.metadata.create_all`, so this passes independent of the migration.)

- [ ] **Step 5: Generate the migration**

Run: `cd backend && .venv/bin/alembic heads`
Expected: prints `4e17d3637814 (head)`. If it prints a different head, use that value as `down_revision` in the next step and note the discrepancy in the task report.

Run: `cd backend && .venv/bin/alembic revision --autogenerate -m "add superuser panel token"`

Open the generated file. Verify it matches the following shape (autogenerate should produce this from the model diff); edit to match exactly if it differs (esp. keep `down_revision = '4e17d3637814'`, the `server_default`, and the unique index):

```python
"""add superuser panel token

Revision ID: <generated>
Revises: 4e17d3637814
Create Date: <generated>

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '<generated>'
down_revision: Union[str, Sequence[str], None] = '4e17d3637814'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'superuser_panel_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_active_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_superuser_panel_tokens_token_hash'), 'superuser_panel_tokens', ['token_hash'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_superuser_panel_tokens_token_hash'), table_name='superuser_panel_tokens')
    op.drop_table('superuser_panel_tokens')
```

- [ ] **Step 6: Verify the migration applies**

Run: `cd backend && .venv/bin/alembic upgrade head`
Expected: applies cleanly, no error. (Optional sanity: `.venv/bin/alembic downgrade -1` then `.venv/bin/alembic upgrade head` round-trips cleanly.)

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/models_auth.py backend/alembic/versions/*_add_superuser_panel_token.py backend/tests/test_superuser_model.py
git commit -m "feat(superuser): add SuperuserPanelToken model + migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Panel-token service (mint / validate / destroy_active)

**Files:**
- Create: `backend/mathion/superuser/__init__.py` (empty package marker)
- Create: `backend/mathion/superuser/service.py`
- Test: `backend/tests/test_superuser_service.py`

**Interfaces:**
- Consumes: `mathion.models_auth.SuperuserPanelToken` (Task 1); `mathion.auth.hash_token`.
- Produces:
  - `mint(db) -> str` — delete any existing token row then insert a fresh one, **one commit**; returns the raw (plaintext) token.
  - `validate(db, token: str) -> SuperuserPanelToken` — raises `HTTPException(404)` on absent/expired (deleting an expired row first); bumps `last_active_at` (throttled 5 min); returns the token row.
  - `destroy_active(db) -> None` — delete all token rows, commit.
  - Module constants `PANEL_INACTIVITY_SECONDS = 1800`, `PANEL_BUMP_THROTTLE_SECONDS = 300`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_superuser_service.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from mathion.auth import hash_token
from mathion.models_auth import SuperuserPanelToken
from mathion.superuser import service as panel_service


def _token_count(db):
    return db.scalar(select(func.count()).select_from(SuperuserPanelToken))


def test_mint_stores_only_hash(db):
    raw = panel_service.mint(db)
    row = db.execute(select(SuperuserPanelToken)).scalar_one()
    assert row.token_hash != raw
    assert row.token_hash == hash_token(raw)
    assert len(row.token_hash) == 64


def test_validate_accepts_fresh_token(db):
    raw = panel_service.mint(db)
    row = panel_service.validate(db, raw)
    assert row.token_hash == hash_token(raw)


def test_validate_rejects_absent_token(db):
    with pytest.raises(HTTPException) as exc:
        panel_service.validate(db, "nope")
    assert exc.value.status_code == 404


def test_mint_replaces_previous_token(db):
    old = panel_service.mint(db)
    new = panel_service.mint(db)
    assert _token_count(db) == 1
    with pytest.raises(HTTPException) as exc:
        panel_service.validate(db, old)
    assert exc.value.status_code == 404
    assert panel_service.validate(db, new).token_hash == hash_token(new)


def test_validate_expires_and_deletes_stale_token(db):
    raw = panel_service.mint(db)
    row = db.execute(select(SuperuserPanelToken)).scalar_one()
    row.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=31)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        panel_service.validate(db, raw)
    assert exc.value.status_code == 404
    assert _token_count(db) == 0


def test_validate_bump_is_throttled(db):
    raw = panel_service.mint(db)
    row = db.execute(select(SuperuserPanelToken)).scalar_one()
    # 10 min ago -> inside window, older than the 5-min throttle -> first validate bumps.
    row.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db.commit()
    panel_service.validate(db, raw)
    db.refresh(row)
    bumped = row.last_active_at
    # Second validate within the throttle window -> no re-write.
    panel_service.validate(db, raw)
    db.refresh(row)
    assert row.last_active_at == bumped


def test_destroy_active_removes_token(db):
    panel_service.mint(db)
    panel_service.destroy_active(db)
    assert _token_count(db) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mathion.superuser'`.

- [ ] **Step 3: Create the package + service**

Create `backend/mathion/superuser/__init__.py` (empty file).

Create `backend/mathion/superuser/service.py`:

```python
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from mathion.auth import hash_token
from mathion.models_auth import SuperuserPanelToken

PANEL_INACTIVITY_SECONDS = 30 * 60  # 1800 — sliding inactivity window
PANEL_BUMP_THROTTLE_SECONDS = 5 * 60  # 300 — at most one last_active_at write per interval


def mint(db: DBSession) -> str:
    """Replace the active panel token (delete-then-insert, single transaction).

    Returns the raw URL-safe token; only its hash is stored.
    """
    db.execute(delete(SuperuserPanelToken))
    raw = secrets.token_urlsafe(32)
    db.add(SuperuserPanelToken(token_hash=hash_token(raw)))
    db.commit()
    return raw


def destroy_active(db: DBSession) -> None:
    """Delete the active panel token (no-op if none)."""
    db.execute(delete(SuperuserPanelToken))
    db.commit()


def validate(db: DBSession, token: str) -> SuperuserPanelToken:
    """Return the token row, or raise 404 on absent/expired.

    Enforces the 30-min sliding inactivity window (deleting an expired row) and
    bumps last_active_at at most once per 5 min.
    """
    row = db.execute(
        select(SuperuserPanelToken).where(SuperuserPanelToken.token_hash == hash_token(token))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not Found")

    now = datetime.now(timezone.utc)
    last_active = row.last_active_at
    if last_active is not None and last_active.tzinfo is None:
        # SQLite may store naive datetimes; treat as UTC (mirrors auth.py:150-153).
        last_active = last_active.replace(tzinfo=timezone.utc)

    if last_active is None or (now - last_active).total_seconds() > PANEL_INACTIVITY_SECONDS:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=404, detail="Not Found")

    if (now - last_active).total_seconds() > PANEL_BUMP_THROTTLE_SECONDS:
        row.last_active_at = now
        db.commit()

    return row
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_service.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/superuser/__init__.py backend/mathion/superuser/service.py backend/tests/test_superuser_service.py
git commit -m "feat(superuser): panel-token service (mint/validate/destroy_active)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `require_superuser_panel` dependency + `GET /api/superuser/{token}/stats`

**Files:**
- Create: `backend/mathion/api/superuser.py`
- Modify: `backend/mathion/schemas.py` (add `SuperuserStatsResponse`)
- Modify: `backend/mathion/main.py` (import + `include_router` before the `/api/{rest:path}` catch-all)
- Test: `backend/tests/test_superuser_api.py`

**Interfaces:**
- Consumes: `panel_service.mint` / `panel_service.validate` (Task 2); `mathion.auth.validate_session`; `mathion.models` (`Asset`, `Course`, `RunAsset`, `Submission`); `mathion.models_auth` (`Session`, `User`).
- Produces: `require_superuser_panel(token, session_token, db) -> User`; `GET /api/superuser/{token}/stats` → `SuperuserStatsResponse`; `router` exported as `superuser_router` in `main.py`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_superuser_api.py`:

```python
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from mathion.models_auth import Session as UserSession, User
from mathion.superuser import service as panel_service


def _seed_storage(db, *, asset=None, run_asset=None, submission=None):
    """Build a Course->Version->Block+Run->Group->MiniProject chain and add
    Asset / RunAsset / Submission rows only for the sizes passed (each may be None)."""
    from mathion.models import (
        Asset, Block, Course, CourseVersion, Group, MiniProject, Run, RunAsset, Submission,
    )

    course = Course(slug="stg", name="Storage")
    db.add(course)
    db.flush()
    version = CourseVersion(course_id=course.id)
    db.add(version)
    db.flush()
    block = Block(version_id=version.id, title="B", slug="b", order=1)
    run = Run(version_id=version.id, title="R", start_date=date(2026, 1, 1), end_date=date(2026, 6, 1))
    db.add_all([block, run])
    db.flush()
    group = Group(run_id=run.id, name="G1")
    student = User(email="stg-student@example.com")
    db.add_all([group, student])
    db.flush()
    mp = MiniProject(run_id=run.id, block_id=block.id, assignment_md="x", assignment_html="x")
    db.add(mp)
    db.flush()

    if asset is not None:
        db.add(Asset(version_id=version.id, filename="a.bin", file_size=asset, mime_type="text/plain"))
    if run_asset is not None:
        db.add(RunAsset(run_id=run.id, filename="r.bin", file_size=run_asset, mime_type="text/plain"))
    if submission is not None:
        db.add(Submission(
            mini_project_id=mp.id, group_id=group.id, submitted_by=student.id,
            file_path="x", submission_number=1, file_size=submission,
        ))
    db.commit()


def test_two_factor_matrix(admin_client, auth_client, client, db):
    token = panel_service.mint(db)
    # valid token + superuser session -> 200
    assert admin_client.get(f"/api/superuser/{token}/stats").status_code == 200
    # valid token + no session -> 401
    assert client.get(f"/api/superuser/{token}/stats").status_code == 401
    # valid token + non-superuser session -> 404 (NOT 403)
    assert auth_client.get(f"/api/superuser/{token}/stats").status_code == 404
    # bad token + superuser session -> 404
    assert admin_client.get("/api/superuser/bogus/stats").status_code == 404


def test_counts(admin_client, db):
    from mathion.models import Course

    for i in range(3):
        db.add(User(email=f"u{i}@example.com"))
    for i in range(2):
        db.add(Course(slug=f"c{i}", name=f"C{i}"))
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    # +1 user: admin_client's superuser fixture (admin@example.com).
    assert data["total_users"] == 4
    assert data["total_courses"] == 2


def test_storage_sums_three_registries(admin_client, db):
    _seed_storage(db, asset=100, run_asset=20, submission=3)
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["storage_bytes"] == 123


def test_submission_only_storage_is_nonzero(admin_client, db):
    _seed_storage(db, submission=7)
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["storage_bytes"] == 7


def test_empty_db_storage_is_zero(admin_client, db):
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["storage_bytes"] == 0


def test_active_windows_and_distinct(admin_client, db):
    now = datetime.now(timezone.utc)
    u1, u2, u3 = User(email="w1@example.com"), User(email="w2@example.com"), User(email="w3@example.com")
    db.add_all([u1, u2, u3])
    db.flush()
    exp = now + timedelta(days=7)
    db.add_all([
        UserSession(user_id=u1.id, token_hash="h1", expires_at=exp,
                    last_active_at=now - timedelta(hours=24) + timedelta(seconds=1)),  # inside 24h
        UserSession(user_id=u1.id, token_hash="h1b", expires_at=exp,
                    last_active_at=now - timedelta(minutes=1)),                          # dup for u1
        UserSession(user_id=u2.id, token_hash="h2", expires_at=exp,
                    last_active_at=now - timedelta(hours=25)),                           # outside 24h, inside 7d
        UserSession(user_id=u3.id, token_hash="h3", expires_at=exp,
                    last_active_at=now - timedelta(days=8)),                             # outside 7d
    ])
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    # admin_client's own session (~now) contributes one active user in both windows.
    assert data["active_users_24h"] == 2   # {u1 (deduped), admin}
    assert data["active_users_7d"] == 3    # {u1, u2, admin}


def test_expired_but_recently_active_session_counts(admin_client, db):
    now = datetime.now(timezone.utc)
    u = User(email="exp@example.com")
    db.add(u)
    db.flush()
    db.add(UserSession(user_id=u.id, token_hash="hx",
                       expires_at=now - timedelta(days=1),          # already expired
                       last_active_at=now - timedelta(hours=1)))    # but active in 24h
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["active_users_24h"] == 2   # admin + u


def test_disabled_user_session_not_excluded(admin_client, db):
    now = datetime.now(timezone.utc)
    u = User(email="dis@example.com", is_disabled=True)
    db.add(u)
    db.flush()
    db.add(UserSession(user_id=u.id, token_hash="hd", expires_at=now + timedelta(days=7),
                       last_active_at=now - timedelta(hours=1)))
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["active_users_24h"] == 2   # admin + disabled u


def test_stats_sets_no_store_and_no_referrer_headers(admin_client, db):
    token = panel_service.mint(db)
    resp = admin_client.get(f"/api/superuser/{token}/stats")
    assert resp.headers["Cache-Control"] == "no-store"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_api.py -v`
Expected: FAIL — all cases 404 (route not registered) / `ImportError` for `SuperuserStatsResponse`.

- [ ] **Step 3: Add the response schema**

In `backend/mathion/schemas.py`, add (plain `BaseModel`, built field-by-field in the handler — matches the `QuizSubmitResponse` style, no `model_config`):

```python
class SuperuserStatsResponse(BaseModel):
    total_users: int
    total_courses: int
    storage_bytes: int
    active_users_24h: int
    active_users_7d: int
```

- [ ] **Step 4: Create the router + dependency**

Create `backend/mathion/api/superuser.py`:

```python
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.auth import validate_session
from mathion.database import get_db
from mathion.models import Asset, Course, RunAsset, Submission
from mathion.models_auth import Session as UserSession, User
from mathion.schemas import SuperuserStatsResponse
from mathion.superuser import service as panel_service

router = APIRouter(tags=["superuser"])

_ACTIVE_24H = timedelta(hours=24)
_ACTIVE_7D = timedelta(days=7)


def require_superuser_panel(
    token: str,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
) -> User:
    # 1. token first -> 404 on bad/expired (also bumps last_active_at).
    panel_service.validate(db, token)
    # 2. session presence -> 401.
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = validate_session(db, session_token)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    # 3. role -> 404 (deliberately NOT 403, so normal users cannot tell the route exists).
    if not user.is_superuser:
        raise HTTPException(status_code=404, detail="Not Found")
    return user


def _count_active_since(db: Session, since: datetime) -> int:
    # SQLite drops tzinfo uniformly on store and on bind, so both the stored
    # last_active_at and this tz-aware `since` compare as naive UTC strings.
    return db.scalar(
        select(func.count(func.distinct(UserSession.user_id))).where(
            UserSession.last_active_at >= since
        )
    )


@router.get("/api/superuser/{token}/stats", response_model=SuperuserStatsResponse)
def get_superuser_stats(
    token: str,
    response: Response,
    _user: User = Depends(require_superuser_panel),
    db: Session = Depends(get_db),
) -> SuperuserStatsResponse:
    total_users = db.scalar(select(func.count()).select_from(User))
    total_courses = db.scalar(select(func.count()).select_from(Course))
    asset_bytes = db.scalar(select(func.coalesce(func.sum(Asset.file_size), 0)))
    run_asset_bytes = db.scalar(select(func.coalesce(func.sum(RunAsset.file_size), 0)))
    submission_bytes = db.scalar(select(func.coalesce(func.sum(Submission.file_size), 0)))
    now = datetime.now(timezone.utc)

    # Defense-in-depth (primary protection is document-level, Task 11).
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"

    return SuperuserStatsResponse(
        total_users=total_users,
        total_courses=total_courses,
        storage_bytes=asset_bytes + run_asset_bytes + submission_bytes,
        active_users_24h=_count_active_since(db, now - _ACTIVE_24H),
        active_users_7d=_count_active_since(db, now - _ACTIVE_7D),
    )
```

- [ ] **Step 5: Wire the router into main.py**

In `backend/mathion/main.py`, add to the router imports (with the other `from mathion.api.<module> import router as <name>_router` lines near the top):

```python
from mathion.api.superuser import router as superuser_router
```

And in the `include_router` block (lines ~72–93), add — it must be **before** the `/api/{rest:path}` catch-all at ~line 109, so being inside this block is sufficient:

```python
app.include_router(superuser_router)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_api.py -v`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/api/superuser.py backend/mathion/schemas.py backend/mathion/main.py backend/tests/test_superuser_api.py
git commit -m "feat(superuser): require_superuser_panel dependency + stats endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Public `GET /api/auth/config`

**Files:**
- Modify: `backend/mathion/schemas.py` (add `AuthConfigResponse`)
- Modify: `backend/mathion/api/auth.py` (add `GET /config`)
- Test: `backend/tests/test_auth_config.py`

**Interfaces:**
- Consumes: `mathion.config.settings` (already imported in `api/auth.py`).
- Produces: `GET /api/auth/config` → `AuthConfigResponse{ send_pin_enabled: bool }`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_auth_config.py`:

```python
import pytest

from mathion.config import settings


@pytest.mark.parametrize(
    "debug,email_mode,expected",
    [
        (False, "smtp", True),
        (False, "file", True),
        (False, "memory", False),   # one-shot MemoryMailer delivers nowhere retrievable
        (False, "disabled", False),
        (True, "smtp", True),
        (True, "file", True),
        (True, "memory", True),     # console print
        (True, "disabled", True),   # console print
    ],
)
def test_config_matrix(client, monkeypatch, debug, email_mode, expected):
    monkeypatch.setattr(settings, "debug", debug)
    monkeypatch.setattr(settings, "email_mode", email_mode)
    resp = client.get("/api/auth/config")
    assert resp.status_code == 200
    assert resp.json() == {"send_pin_enabled": expected}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_auth_config.py -v`
Expected: FAIL — 404 (route not defined).

- [ ] **Step 3: Add the schema**

In `backend/mathion/schemas.py`:

```python
class AuthConfigResponse(BaseModel):
    send_pin_enabled: bool
```

- [ ] **Step 4: Add the endpoint**

In `backend/mathion/api/auth.py`, add `AuthConfigResponse` to the `from mathion.schemas import (...)` line, and add the handler (router prefix is `/api/auth`, so `/config` → `/api/auth/config`):

```python
@router.get("/config", response_model=AuthConfigResponse)
def api_auth_config() -> AuthConfigResponse:
    # True whenever "Send PIN" yields a retrievable PIN: debug (console print) or
    # a delivering mailer (smtp inbox / file .eml outbox). Excludes the one-shot
    # `memory` sink and `disabled`. Public, no auth, no CSRF (GET).
    return AuthConfigResponse(
        send_pin_enabled=settings.debug or settings.email_mode in ("smtp", "file")
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_auth_config.py -v`
Expected: PASS (8 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/schemas.py backend/mathion/api/auth.py backend/tests/test_auth_config.py
git commit -m "feat(auth): public GET /api/auth/config exposing send_pin_enabled

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Synchronous login-PIN email delivery

**Files:**
- Modify: `backend/mathion/notifications/templates.py` (add `build_login_pin_message` + `LOGIN_PIN_KIND`)
- Modify: `backend/mathion/notifications/mailer.py` (extend `FileMailer._allowed_kinds`)
- Modify: `backend/mathion/api/auth.py` (`/request-pin` send)
- Test: `backend/tests/test_login_pin_delivery.py`

**Interfaces:**
- Consumes: `mathion.auth.request_pin` (returns raw PIN or `None`); `mathion.notifications.mailer.build_mailer_from_settings`.
- Produces: `mathion.notifications.templates.build_login_pin_message(email: str, pin: str) -> EmailMessage`; `LOGIN_PIN_KIND = "login_pin"`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_login_pin_delivery.py`:

```python
import re

from sqlalchemy import func, select

import mathion.api.auth as auth_api
from mathion.auth import verify_pin
from mathion.config import settings
from mathion.models_auth import NotificationLogEntry, User
from mathion.notifications.mailer import MemoryMailer


def _make_user(db, email="real@example.com"):
    u = User(email=email)
    db.add(u)
    db.commit()
    return u


def test_debug_console_no_email(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", True)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)
    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200
    assert mailer.sent == []


def test_sends_exactly_one_login_pin(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)

    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"message": "PIN sent"}
    assert len(mailer.sent) == 1
    msg = mailer.sent[0]
    assert msg["To"] == "real@example.com"
    assert msg["X-Mathion-Kind"] == "login_pin"

    pin = re.search(r"\b(\d{6})\b", msg.get_content()).group(1)
    assert verify_pin(db, "real@example.com", pin, duration_days=1) is not None

    # Raw PIN never persisted to the notification log.
    assert db.scalar(select(func.count()).select_from(NotificationLogEntry)) == 0


def test_no_mailer_sends_nothing(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "disabled")
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: None)
    resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    assert resp.status_code == 200


def test_unknown_email_sends_nothing(client, db, monkeypatch):
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")
    mailer = MemoryMailer()
    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: mailer)
    resp = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"})
    assert resp.status_code == 200
    assert mailer.sent == []


def test_send_failure_stays_uniform(client, db, monkeypatch):
    _make_user(db)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "email_mode", "smtp")

    class BoomMailer(MemoryMailer):
        def send(self, msg):
            raise RuntimeError("SMTP down")

    monkeypatch.setattr(auth_api, "build_mailer_from_settings", lambda s: BoomMailer())
    fail_resp = client.post("/api/auth/request-pin", json={"email": "real@example.com"})
    unknown_resp = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"})
    assert fail_resp.status_code == 200
    assert fail_resp.json() == unknown_resp.json() == {"message": "PIN sent"}


def test_request_pin_still_200_under_lifespanless_client(client, db):
    # Regression guard for the removed app.state.mailer read: default email
    # mode is "disabled", no debug -> no send, no AttributeError.
    resp = client.post("/api/auth/request-pin", json={"email": "whoever@example.com"})
    assert resp.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_login_pin_delivery.py -v`
Expected: FAIL — `test_sends_exactly_one_login_pin` (nothing sent; `build_login_pin_message` missing / endpoint doesn't send).

- [ ] **Step 3: Add the message builder**

In `backend/mathion/notifications/templates.py`, add (standalone — NOT added to `TEMPLATES`, NOT routed through `_build_email_message`; `settings` and `EmailMessage` are already imported there):

```python
LOGIN_PIN_KIND = "login_pin"


def build_login_pin_message(email: str, pin: str) -> EmailMessage:
    """Standalone login-PIN email. Not a TEMPLATES entry (those are
    RenderContext -> (subject, body) callables). The raw PIN lives only in this
    in-memory message — never persisted or logged."""
    if not email:
        raise ValueError("recipient has no email")
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = email  # EmailMessage default policy rejects CR/LF-injected headers
    msg["Subject"] = "Your Mathion sign-in PIN"
    msg["X-Mathion-Kind"] = LOGIN_PIN_KIND
    msg.set_content(
        f"Your Mathion sign-in PIN is {pin}. "
        f"It expires in {settings.pin_expiry_minutes} minutes.",
        charset="utf-8",
    )
    return msg
```

- [ ] **Step 4: Extend `_allowed_kinds`**

In `backend/mathion/notifications/mailer.py`, change the `FileMailer._allowed_kinds` body so file-mode names the `.eml` `login_pin` rather than `unknown`:

```python
    @classmethod
    @functools.cache
    def _allowed_kinds(cls) -> frozenset[str]:
        from .templates import TEMPLATES
        return frozenset(TEMPLATES.keys()) | {"login_pin"}
```

- [ ] **Step 5: Send in `/request-pin`**

In `backend/mathion/api/auth.py`:

Add near the top (module-level):

```python
import logging
```

Add to the imports:

```python
from mathion.notifications.mailer import build_mailer_from_settings
from mathion.notifications.templates import build_login_pin_message
```

Add after the imports (module level):

```python
logger = logging.getLogger(__name__)
```

Replace the body of `api_request_pin` with:

```python
@router.post("/request-pin")
def api_request_pin(request: Request, data: PinRequestSchema, db: Session = Depends(get_db)):
    _require_csrf(request)
    raw_pin = request_pin(db, data.email)
    # Send only for a real, enabled, non-rate-limited user (request_pin returned
    # a PIN) and only when debug is off. Response stays uniform regardless.
    if raw_pin is not None and not settings.debug:
        mailer = build_mailer_from_settings(settings)  # one-shot; NOT app.state.mailer
        if mailer is not None:
            try:
                msg = build_login_pin_message(data.email.strip().lower(), raw_pin)
                with mailer.session():
                    mailer.send(msg)
            except Exception:
                logger.exception("login PIN email send failed")  # static message; never the raw PIN
    return {"message": "PIN sent"}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_login_pin_delivery.py -v`
Expected: PASS (6 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/notifications/templates.py backend/mathion/notifications/mailer.py backend/mathion/api/auth.py backend/tests/test_login_pin_delivery.py
git commit -m "feat(auth): synchronous login-PIN email via one-shot mailer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Logout hook — destroy the panel token for superuser sessions only

**Files:**
- Modify: `backend/mathion/api/auth.py` (`logout`)
- Test: `backend/tests/test_superuser_logout.py`

**Interfaces:**
- Consumes: `mathion.auth.validate_session`; `panel_service.destroy_active` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_superuser_logout.py`:

```python
from sqlalchemy import func, select

from mathion.models_auth import SuperuserPanelToken
from mathion.superuser import service as panel_service


def _token_count(db):
    return db.scalar(select(func.count()).select_from(SuperuserPanelToken))


def test_superuser_logout_destroys_panel_token(admin_client, db):
    panel_service.mint(db)
    assert _token_count(db) == 1
    resp = admin_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert _token_count(db) == 0


def test_non_superuser_logout_leaves_panel_token(auth_client, db):
    panel_service.mint(db)
    resp = auth_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert _token_count(db) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_logout.py -v`
Expected: FAIL — `test_superuser_logout_destroys_panel_token` (token still present; hook not wired).

- [ ] **Step 3: Wire the hook**

In `backend/mathion/api/auth.py`:

Add `validate_session` to the `from mathion.auth import (...)` line (so it reads `destroy_session, request_pin, validate_session, verify_pin`), and add the import:

```python
from mathion.superuser import service as panel_service
```

Replace the `logout` body with:

```python
@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
):
    _require_csrf(request)
    if session_token:
        # Resolve the user BEFORE destroying the session, so only a superuser's
        # logout tears down the shared panel token (a normal user's must not).
        user = validate_session(db, session_token)
        if user is not None and user.is_superuser:
            panel_service.destroy_active(db)
        destroy_session(db, session_token)
    response.delete_cookie("session_token")
    return {"message": "Logged out"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_logout.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/api/auth.py backend/tests/test_superuser_logout.py
git commit -m "feat(superuser): superuser logout destroys the active panel token

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Bootstrap service functions + `python -m mathion.superuser` shim

**Files:**
- Modify: `backend/mathion/superuser/service.py` (add bootstrap functions + result dataclasses)
- Create: `backend/mathion/superuser/__main__.py`
- Test: `backend/tests/test_superuser_cli.py`

**Interfaces:**
- Consumes: `mathion.auth.request_pin`; `mathion.config.settings`; `panel_service.mint` (Task 2).
- Produces:
  - `create_or_promote_superuser(db, email) -> User`
  - `issue_bootstrap_pin(db, email) -> PinIssued | UnknownUser | DisabledUser | RateLimited`
  - `activate_panel(db) -> ActivateResult(token, url, has_superuser)`
  - result dataclasses `PinIssued(pin)`, `UnknownUser()`, `DisabledUser()`, `RateLimited()`, `ActivateResult(token, url, has_superuser)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_superuser_cli.py`:

```python
import pytest

from mathion.auth import verify_pin
from mathion.models_auth import User
from mathion.superuser import service as panel_service
from mathion.superuser.service import (
    ActivateResult, DisabledUser, PinIssued, RateLimited, UnknownUser,
    activate_panel, create_or_promote_superuser, issue_bootstrap_pin,
)


def test_create_new_superuser(db):
    user = create_or_promote_superuser(db, "New.Admin@Example.com  ")
    assert user.email == "new.admin@example.com"      # normalized
    assert user.is_superuser is True


def test_promote_existing_user(db):
    db.add(User(email="u@example.com"))
    db.commit()
    user = create_or_promote_superuser(db, "u@example.com")
    assert user.is_superuser is True


def test_reenables_disabled_user(db):
    db.add(User(email="d@example.com", is_disabled=True))
    db.commit()
    user = create_or_promote_superuser(db, "d@example.com")
    assert user.is_superuser is True
    assert user.is_disabled is False


def test_mixed_case_email_collapses_to_one_row(db):
    create_or_promote_superuser(db, "Case@Example.com")
    create_or_promote_superuser(db, "case@example.com")
    rows = db.query(User).filter(User.email == "case@example.com").all()
    assert len(rows) == 1


@pytest.mark.parametrize("bad", ["", "   ", "a" * 255 + "@x.com"])
def test_rejects_empty_or_oversized_email(db, bad):
    with pytest.raises(ValueError):
        create_or_promote_superuser(db, bad)


def test_issue_pin_for_known_user(db):
    create_or_promote_superuser(db, "p@example.com")
    result = issue_bootstrap_pin(db, "p@example.com")
    assert isinstance(result, PinIssued)
    assert verify_pin(db, "p@example.com", result.pin, duration_days=1) is not None


def test_issue_pin_unknown_user(db):
    assert isinstance(issue_bootstrap_pin(db, "ghost@example.com"), UnknownUser)


def test_issue_pin_disabled_user(db):
    db.add(User(email="off@example.com", is_disabled=True))
    db.commit()
    assert isinstance(issue_bootstrap_pin(db, "off@example.com"), DisabledUser)


def test_issue_pin_rate_limited(db):
    create_or_promote_superuser(db, "rl@example.com")
    for _ in range(3):   # settings.max_pin_requests_per_hour default is 3
        issue_bootstrap_pin(db, "rl@example.com")
    assert isinstance(issue_bootstrap_pin(db, "rl@example.com"), RateLimited)


def test_activate_no_superuser_warns(db):
    result = activate_panel(db)
    assert isinstance(result, ActivateResult)
    assert result.has_superuser is False
    assert result.url.endswith(f"/superuser/{result.token}")


def test_activate_reports_superuser_and_supersedes(db):
    create_or_promote_superuser(db, "s@example.com")
    first = activate_panel(db)
    second = activate_panel(db)
    assert second.has_superuser is True
    # first token is superseded
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        panel_service.validate(db, first.token)
    assert panel_service.validate(db, second.token) is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_cli.py -v`
Expected: FAIL — `ImportError` (functions/dataclasses not defined).

- [ ] **Step 3: Add bootstrap logic to service.py**

Append to `backend/mathion/superuser/service.py` (extend the existing imports so the module also imports `exists` from sqlalchemy, and `request_pin`, `settings`, `User`):

```python
from dataclasses import dataclass

from sqlalchemy import delete, exists, select  # extend existing import
from mathion.auth import hash_token, request_pin  # extend existing import
from mathion.config import settings
from mathion.models_auth import SuperuserPanelToken, User  # extend existing import


@dataclass
class PinIssued:
    pin: str


@dataclass
class UnknownUser:
    pass


@dataclass
class DisabledUser:
    pass


@dataclass
class RateLimited:
    pass


@dataclass
class ActivateResult:
    token: str
    url: str
    has_superuser: bool


def create_or_promote_superuser(db: DBSession, email: str) -> User:
    normalized = email.strip().lower()
    if not normalized:
        raise ValueError("email must not be empty")
    if len(normalized) > 254:
        raise ValueError("email must be at most 254 characters")
    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    if user is None:
        user = User(email=normalized, is_superuser=True)
        db.add(user)
    else:
        user.is_superuser = True
        user.is_disabled = False  # a bootstrap command must yield a usable superuser
    db.commit()
    db.refresh(user)
    return user


def issue_bootstrap_pin(db: DBSession, email: str) -> "PinIssued | UnknownUser | DisabledUser | RateLimited":
    normalized = email.strip().lower()
    raw = request_pin(db, normalized)
    if raw is not None:
        return PinIssued(pin=raw)
    # Disambiguate request_pin's None: unknown / disabled / rate-limited.
    user = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
    if user is None:
        return UnknownUser()
    if user.is_disabled:
        return DisabledUser()
    return RateLimited()


def activate_panel(db: DBSession) -> ActivateResult:
    raw = mint(db)
    has_superuser = bool(db.scalar(select(exists().where(User.is_superuser == True))))  # noqa: E712
    url = f"{settings.base_url}/superuser/{raw}"
    return ActivateResult(token=raw, url=url, has_superuser=has_superuser)
```

> When merging imports, the top of `service.py` should end up with a single `from sqlalchemy import delete, exists, select`, a single `from mathion.auth import hash_token, request_pin`, and `from mathion.models_auth import SuperuserPanelToken, User` — do not leave duplicate import lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_superuser_cli.py -v`
Expected: PASS (all cases).

- [ ] **Step 5: Create the CLI shim**

Create `backend/mathion/superuser/__main__.py` (thin: opens `SessionLocal`, parses args, formats results — no business logic):

```python
import argparse

from mathion.database import SessionLocal
from mathion.superuser.service import (
    DisabledUser, PinIssued, RateLimited, UnknownUser,
    activate_panel, create_or_promote_superuser, issue_bootstrap_pin,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m mathion.superuser")
    sub = parser.add_subparsers(dest="command", required=True)
    p_create = sub.add_parser("create-superuser")
    p_create.add_argument("email")
    p_pin = sub.add_parser("pin")
    p_pin.add_argument("email")
    sub.add_parser("activate")
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        if args.command == "create-superuser":
            try:
                user = create_or_promote_superuser(db, args.email)
            except ValueError as e:
                print(f"error: {e}")
                return 1
            print(f"{user.email} is a superuser.")
            return 0

        if args.command == "pin":
            result = issue_bootstrap_pin(db, args.email)
            if isinstance(result, PinIssued):
                print(f"PIN: {result.pin}")
            elif isinstance(result, UnknownUser):
                print("unknown email")
            elif isinstance(result, DisabledUser):
                print("user is disabled")
            elif isinstance(result, RateLimited):
                print(
                    "rate-limited: try again later — bootstrap can trip the 3/hr cap "
                    "(PINs expire in 10 min); wait an hour, raise "
                    "MATHION_MAX_PIN_REQUESTS_PER_HOUR, or clear rate_limit_entries"
                )
            return 0

        if args.command == "activate":
            result = activate_panel(db)
            if not result.has_superuser:
                print(
                    "warning: no superuser accounts exist — run create-superuser first, "
                    "or this URL will 404"
                )
            print(result.url)
            return 0

        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
```

> Design note (surface in review): spec §6 mentions an "already a superuser (no change)" message. Since `create_or_promote_superuser` returns only `User` (its spec'd signature) and §9 asserts DB state rather than copy, the shim prints one idempotent success line (`"{email} is a superuser."`), truthful for create/promote/re-enable/no-op alike. Distinct "no change" messaging would be a trivial follow-up if desired.

- [ ] **Step 6: Verify the shim loads**

Run: `cd backend && .venv/bin/python -m mathion.superuser --help`
Expected: prints usage listing `create-superuser`, `pin`, `activate`. (The shim targets the configured `MATHION_DATABASE_URL`; do not run the mutating verbs against the dev DB here.)

- [ ] **Step 7: Commit**

```bash
git add backend/mathion/superuser/service.py backend/mathion/superuser/__main__.py backend/tests/test_superuser_cli.py
git commit -m "feat(superuser): interim bootstrap CLI (create-superuser/pin/activate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `lib/superuser.ts` + `SuperuserDashboard.svelte`

**Files:**
- Create: `frontend/src/lib/superuser.ts`
- Create: `frontend/src/pages/superuser/SuperuserDashboard.svelte`
- Test: `frontend/src/tests/SuperuserDashboard.svelte.test.ts`

**Interfaces:**
- Consumes: `api` (`frontend/src/lib/api.ts`); `ApiError`; `formatFileSize` (`lib/format.ts`); `navigate`, `currentRoute` (`lib/router.svelte`).
- Produces: `getSuperuserStats(token: string): Promise<SuperuserStats>` (type `SuperuserStats = { total_users; total_courses; storage_bytes; active_users_24h; active_users_7d }`, all `number`); `SuperuserDashboard` component taking a `token: string` prop.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/SuperuserDashboard.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserDashboard from '../pages/superuser/SuperuserDashboard.svelte';
import * as router from '../lib/router.svelte';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => jsonResponse(status, body));
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
const ZEROS = { total_users: 0, total_courses: 0, storage_bytes: 0, active_users_24h: 0, active_users_7d: 0 };

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  sessionStorage.clear();
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

it('fetches and renders five stat cards with formatted storage', async () => {
  vi.stubGlobal('fetch', mockFetch(200, {
    total_users: 3, total_courses: 2, storage_bytes: 1500, active_users_24h: 1, active_users_7d: 2,
  }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok' } });
  await settle();
  const text = target.textContent ?? '';
  expect(text).toContain('3');
  expect(text).toContain('2');
  expect(text).toContain('1.5 kB');   // formatFileSize(1500)
});

it('threads the token into the stats URL and skips the global auth redirect', async () => {
  const f = mockFetch(200, ZEROS);
  vi.stubGlobal('fetch', f);
  component = mount(SuperuserDashboard, { target, props: { token: 'abc' } });
  await settle();
  expect(String(f.mock.calls[0][0])).toBe('/api/superuser/abc/stats');
});

it('renders a panel-specific expired state on 404 (not generic NotFound)', async () => {
  vi.stubGlobal('fetch', mockFetch(404, { detail: 'Not Found' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'bad' } });
  await settle();
  expect(target.textContent ?? '').toMatch(/not valid or has expired/i);
});

it('on 401 stashes the panel path in sessionStorage and navigates to /login', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  router.currentRoute.path = '/superuser/tok401';
  vi.stubGlobal('fetch', mockFetch(401, { detail: 'Not authenticated' }));
  component = mount(SuperuserDashboard, { target, props: { token: 'tok401' } });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBe('/superuser/tok401');
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
  // token never placed in the navigation URL
  expect(String(navSpy.mock.calls[0][0])).toBe('/login');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/tests/SuperuserDashboard.svelte.test.ts`
Expected: FAIL — cannot resolve `../pages/superuser/SuperuserDashboard.svelte`.

- [ ] **Step 3: Create the stats wrapper**

Create `frontend/src/lib/superuser.ts`:

```ts
import { api } from './api';

export type SuperuserStats = {
  total_users: number;
  total_courses: number;
  storage_bytes: number;
  active_users_24h: number;
  active_users_7d: number;
};

export function getSuperuserStats(token: string): Promise<SuperuserStats> {
  // skipAuthRedirect: the dashboard handles 401/404 itself (does not hand the
  // 401 to the app-wide onUnauthorized redirect).
  return api.get<SuperuserStats>(`/api/superuser/${token}/stats`, { skipAuthRedirect: true });
}
```

- [ ] **Step 4: Create the dashboard**

Create `frontend/src/pages/superuser/SuperuserDashboard.svelte`:

```svelte
<script lang="ts">
  import { ApiError } from '../../lib/api';
  import { getSuperuserStats, type SuperuserStats } from '../../lib/superuser';
  import { formatFileSize } from '../../lib/format';
  import { navigate, currentRoute } from '../../lib/router.svelte';

  let { token }: { token: string } = $props();

  let stats = $state<SuperuserStats | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');

  async function load(): Promise<void> {
    const t = token; // track the prop so this effect re-runs if the token changes
    loading = true;
    error = '';
    notFound = false;
    try {
      stats = await getSuperuserStats(t);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        notFound = true;
      } else if (err instanceof ApiError && err.status === 401) {
        sessionStorage.setItem('superuser_return_path', currentRoute.path);
        void navigate('/login', { replace: true, force: true });
      } else {
        error = err instanceof ApiError ? err.displayMessage : 'Could not load stats.';
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="dashboard">
  {#if loading}
    <p>Loading…</p>
  {:else if notFound}
    <p class="panel-error">This panel link is not valid or has expired — re-run <code>activate</code> to mint a new one.</p>
  {:else if error}
    <p class="panel-error">{error}</p>
  {:else if stats}
    <div class="cards">
      <div class="card"><span class="label">Users</span><span class="value">{stats.total_users}</span></div>
      <div class="card"><span class="label">Courses</span><span class="value">{stats.total_courses}</span></div>
      <div class="card"><span class="label">Storage</span><span class="value">{formatFileSize(stats.storage_bytes)}</span></div>
      <div class="card"><span class="label">Active 24h</span><span class="value">{stats.active_users_24h}</span></div>
      <div class="card"><span class="label">Active 7d</span><span class="value">{stats.active_users_7d}</span></div>
    </div>
  {/if}
</div>

<style>
  .cards { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  .card {
    display: flex; flex-direction: column; gap: var(--space-1);
    padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius);
    min-width: 140px;
  }
  .label { color: var(--muted); font-size: 0.85rem; }
  .value { font-size: 1.5rem; font-weight: 600; }
  .panel-error { color: var(--muted); }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/SuperuserDashboard.svelte.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/superuser.ts frontend/src/pages/superuser/SuperuserDashboard.svelte frontend/src/tests/SuperuserDashboard.svelte.test.ts
git commit -m "feat(superuser): stats dashboard + typed stats wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `SuperuserShell.svelte` + route registration + `AppHeader` suppression

**Files:**
- Create: `frontend/src/pages/superuser/SuperuserShell.svelte`
- Modify: `frontend/src/routes.ts` (register route)
- Modify: `frontend/src/App.svelte` (add to `componentMap`; extend `AppHeader` condition)
- Test: `frontend/src/tests/SuperuserShell.svelte.test.ts`

**Interfaces:**
- Consumes: `logout` (`lib/auth.svelte`); `navigate` (`lib/router.svelte`); `SuperuserDashboard` (Task 8).
- Produces: `SuperuserShell` component (route component for `/superuser/:token`), taking a `token: string` prop.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/SuperuserShell.svelte.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SuperuserShell from '../pages/superuser/SuperuserShell.svelte';
import App from '../App.svelte';
import * as router from '../lib/router.svelte';
import { session } from '../stores/session.svelte';

vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function dispatchFetch() {
  return vi.fn(async (url: string) => {
    const s = String(url);
    if (s.includes('/api/superuser/')) {
      return jsonResponse(200, { total_users: 0, total_courses: 0, storage_bytes: 0, active_users_24h: 0, active_users_7d: 0 });
    }
    return jsonResponse(200, []);
  });
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
function buttonByText(t: HTMLElement, text: string): HTMLButtonElement | null {
  return (Array.from(t.querySelectorAll('button')) as HTMLButtonElement[])
    .find((b) => (b.textContent ?? '').trim() === text) ?? null;
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  session.user = null;
  session.loading = false;
  router.currentRoute.path = '/';
  router.currentRoute.search = '';
  router.currentRoute.hash = '';
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

it('renders nav + sign-out and mounts the dashboard', async () => {
  vi.stubGlobal('fetch', dispatchFetch());
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  expect(target.textContent ?? '').toContain('Dashboard');
  expect(buttonByText(target, 'Sign out')).not.toBeNull();
});

it('sign-out logs out then navigates to /login (not the panel path)', async () => {
  const auth = await import('../lib/auth.svelte');
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  vi.stubGlobal('fetch', dispatchFetch());
  component = mount(SuperuserShell, { target, props: { token: 'tok' } });
  await settle();
  buttonByText(target, 'Sign out')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
  expect(auth.logout).toHaveBeenCalled();
  expect(navSpy).toHaveBeenCalledWith('/login', { replace: true, force: true });
});

it('suppresses AppHeader on /superuser paths but shows it on /courses', async () => {
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  vi.stubGlobal('fetch', dispatchFetch());
  session.user = {
    id: 1, email: 'z@x.com', full_name: 'ZED_HEADER_NAME', is_superuser: true,
    is_disabled: false, photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  session.loading = false;

  // On a panel path, AppHeader (which renders the display name) is suppressed.
  router.currentRoute.path = '/superuser/tok';
  component = mount(App, { target });
  await settle();
  expect(target.textContent ?? '').not.toContain('ZED_HEADER_NAME');
  unmount(component); component = null;
  navSpy.mockClear();

  // On /courses, AppHeader renders the display name.
  router.currentRoute.path = '/courses';
  component = mount(App, { target });
  await settle();
  expect(target.textContent ?? '').toContain('ZED_HEADER_NAME');
});
```

> The suppression test relies on `AppHeader` rendering `session.user.full_name` (verified: `displayName = session.user?.full_name ?? session.user?.email ?? ''`). If `AppHeader` markup does not surface the name for any reason, substitute another AppHeader-only string after reading `frontend/src/components/chrome/AppHeader.svelte`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/tests/SuperuserShell.svelte.test.ts`
Expected: FAIL — cannot resolve `SuperuserShell.svelte`; suppression test fails (AppHeader not yet excluded).

- [ ] **Step 3: Create the shell**

Create `frontend/src/pages/superuser/SuperuserShell.svelte`:

```svelte
<script lang="ts">
  import { logout } from '../../lib/auth.svelte';
  import { navigate } from '../../lib/router.svelte';
  import SuperuserDashboard from './SuperuserDashboard.svelte';

  let { token }: { token: string } = $props();

  async function onSignOut(): Promise<void> {
    await logout();
    // Do NOT return to the panel path — the backend logout hook has destroyed
    // the token, so that path now 404s. replace: true drops the dead token URL.
    void navigate('/login', { replace: true, force: true });
  }
</script>

<div class="superuser">
  <header class="su-header">
    <span class="su-brand">Superuser Panel</span>
    <nav class="su-nav"><span class="su-nav-item active">Dashboard</span></nav>
    <button type="button" class="su-signout" onclick={onSignOut}>Sign out</button>
  </header>
  <main class="su-main">
    <SuperuserDashboard {token} />
  </main>
</div>

<style>
  .su-header {
    display: flex; align-items: center; gap: var(--space-4);
    padding: var(--space-3); border-bottom: 1px solid var(--border);
  }
  .su-brand { font-weight: 600; }
  .su-nav { flex: 1; }
  .su-main { padding: var(--space-4); }
</style>
```

- [ ] **Step 4: Register the route**

In `frontend/src/routes.ts`, add to the `routes` array (auth: false so App's guard does not pre-empt and encode the token into `?next=`):

```ts
  { path: '/superuser/:token', component: 'SuperuserShell', auth: false },
```

- [ ] **Step 5: Wire into App.svelte**

In `frontend/src/App.svelte`:

Add the import (with the other page imports):

```svelte
  import SuperuserShell from './pages/superuser/SuperuserShell.svelte';
```

Add to `componentMap`:

```ts
    SuperuserShell: SuperuserShell as Component<Record<string, string>>,
```

Extend the `AppHeader` condition (currently `{#if !session.loading && session.user && currentRoute.path !== '/login'}`) to also exclude panel paths:

```svelte
{#if !session.loading && session.user && currentRoute.path !== '/login' && !currentRoute.path.startsWith('/superuser')}
  <AppHeader />
{/if}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/SuperuserShell.svelte.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/superuser/SuperuserShell.svelte frontend/src/routes.ts frontend/src/App.svelte frontend/src/tests/SuperuserShell.svelte.test.ts
git commit -m "feat(superuser): panel shell + route + AppHeader suppression

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: PIN-delivery-aware `Login.svelte` + `getAuthConfig`

**Files:**
- Modify: `frontend/src/lib/auth.svelte.ts` (add `getAuthConfig`)
- Modify: `frontend/src/pages/Login.svelte` (delivery-aware login + return-path capture)
- Test: `frontend/src/tests/Login.svelte.test.ts`

**Interfaces:**
- Consumes: `api` (`lib/api.ts`); `requestPin`, `verifyPin` (`lib/auth.svelte`); `navigate`, `safeNext`, `defaultLandingPath` (`lib/router.svelte`); `Spinner`, `Input`, `Button`, `FormRow` components.
- Produces: `getAuthConfig(): Promise<{ send_pin_enabled: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/Login.svelte.test.ts` (if a Login test already exists, add these cases and update any assertion tied to the old "sent to {email}" copy):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Login from '../pages/Login.svelte';
import * as router from '../lib/router.svelte';

const FAKE_USER = {
  id: 1, email: 'a@b.com', full_name: 'A', is_superuser: false,
  is_disabled: false, photo_url: null, has_course_admin: false, has_run_teacher: false,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}
function setValue(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function buttonByText(t: HTMLElement, text: string): HTMLButtonElement | null {
  return (Array.from(t.querySelectorAll('button')) as HTMLButtonElement[])
    .find((b) => (b.textContent ?? '').trim() === text) ?? null;
}
function submitForm(t: HTMLElement) {
  t.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
}

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
  sessionStorage.clear();
  history.replaceState(null, '', '/login');
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(target);
  vi.restoreAllMocks();
});

it('renders neither form until config resolves (render-gate) and fires no request-pin', async () => {
  const f = vi.fn((url: string) => {
    if (String(url).includes('/api/auth/config')) return new Promise(() => {}); // never resolves
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  expect(target.querySelector('form')).toBeNull();
  expect(f.mock.calls.some((c) => String(c[0]).includes('/request-pin'))).toBe(false);
});

it('send_pin_enabled=false: direct email+PIN entry submits to verify-pin, never request-pin', async () => {
  vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  const f = vi.fn((url: string) => {
    const s = String(url);
    if (s.includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: false }));
    if (s.includes('/verify-pin')) return Promise.resolve(jsonResponse(200, { user: FAKE_USER }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  setValue(target.querySelector('input[name="pin"]')!, '123456');
  await settle();
  submitForm(target);
  await settle();
  const urls = f.mock.calls.map((c) => String(c[0]));
  expect(urls.some((u) => u.includes('/verify-pin'))).toBe(true);
  expect(urls.some((u) => u.includes('/request-pin'))).toBe(false);
});

it('send_pin_enabled=true: two-step flow shows delivery-neutral copy', async () => {
  const f = vi.fn((url: string) => {
    const s = String(url);
    if (s.includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: true }));
    if (s.includes('/request-pin')) return Promise.resolve(jsonResponse(200, { message: 'PIN sent' }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  await settle();
  submitForm(target);
  await settle();
  const text = target.textContent ?? '';
  expect(text).not.toMatch(/sent to a@b\.com/i);
  expect(text).not.toMatch(/to your inbox/i);
  expect(text).toMatch(/a 6-digit PIN has been sent|check your email/i);
});

it('config-fetch failure resolves to two-step and enables submit', async () => {
  const f = vi.fn((url: string) => {
    if (String(url).includes('/api/auth/config')) return Promise.reject(new TypeError('network'));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  const emailInput = target.querySelector('input[name="email"]') as HTMLInputElement;
  expect(emailInput).not.toBeNull();
  setValue(emailInput, 'a@b.com');
  await settle();
  expect(buttonByText(target, 'Send PIN')?.disabled).toBe(false);
});

it('captures + clears superuser_return_path on mount and navigates there after verify', async () => {
  sessionStorage.setItem('superuser_return_path', '/superuser/tok');
  const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve());
  const f = vi.fn((url: string) => {
    const s = String(url);
    if (s.includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: false }));
    if (s.includes('/verify-pin')) return Promise.resolve(jsonResponse(200, { user: FAKE_USER }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBeNull(); // cleared on mount
  setValue(target.querySelector('input[name="email"]')!, 'a@b.com');
  setValue(target.querySelector('input[name="pin"]')!, '123456');
  await settle();
  submitForm(target);
  await settle();
  expect(navSpy).toHaveBeenCalledWith('/superuser/tok', { replace: true });
});

it('a stale return path from a prior mount does not survive to a later login', async () => {
  sessionStorage.setItem('superuser_return_path', '/superuser/stale');
  const f = vi.fn((url: string) => {
    if (String(url).includes('/api/auth/config')) return Promise.resolve(jsonResponse(200, { send_pin_enabled: true }));
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', f);
  component = mount(Login, { target });
  await settle();
  unmount(component); component = null;
  component = mount(Login, { target });
  await settle();
  expect(sessionStorage.getItem('superuser_return_path')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/tests/Login.svelte.test.ts`
Expected: FAIL — `getAuthConfig` not exported / render-gate & direct-entry not implemented.

- [ ] **Step 3: Add `getAuthConfig`**

In `frontend/src/lib/auth.svelte.ts`, add:

```ts
export async function getAuthConfig(): Promise<{ send_pin_enabled: boolean }> {
  // Public endpoint; never 401s, so no skipAuthRedirect needed.
  return api.get<{ send_pin_enabled: boolean }>('/api/auth/config');
}
```

- [ ] **Step 4: Rewrite Login.svelte**

Replace the entire contents of `frontend/src/pages/Login.svelte` with:

```svelte
<script lang="ts">
  import { requestPin, verifyPin, getAuthConfig } from '../lib/auth.svelte';
  import { ApiError } from '../lib/api';
  import { navigate, safeNext, defaultLandingPath } from '../lib/router.svelte';
  import type { User } from '../lib/types';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import FormRow from '../components/ui/FormRow.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  // Capture + clear the superuser return path SYNCHRONOUSLY at init, before any
  // await — bounds the key's lifetime to this Login mount so an abandoned panel
  // redirect can't hijack a later ordinary login.
  const returnPath: string | null = (() => {
    const p = sessionStorage.getItem('superuser_return_path');
    if (p !== null) sessionStorage.removeItem('superuser_return_path');
    return p;
  })();

  type Step = 'email' | 'pin';
  let step = $state<Step>('email');
  let email = $state('');
  let pin = $state('');
  let duration = $state<1 | 7 | 30>(7);
  let busy = $state(false);
  let error = $state('');
  // undefined until GET /api/auth/config resolves — render-gate.
  let sendPinEnabled = $state<boolean | undefined>(undefined);

  $effect(() => {
    void loadConfig();
  });

  async function loadConfig(): Promise<void> {
    try {
      const cfg = await getAuthConfig();
      sendPinEnabled = cfg.send_pin_enabled;
    } catch {
      // Network/5xx — resolve into the standard two-step flow (no infinite
      // spinner; submit re-enables). Production-normal path.
      sendPinEnabled = true;
    }
  }

  function afterLogin(user: User): void {
    if (returnPath !== null) {
      void navigate(returnPath, { replace: true });   // precedence over ?next=
      return;
    }
    const rawNext = new URLSearchParams(location.search).get('next');
    const fallback = defaultLandingPath(user);
    const dest = (rawNext === null || rawNext === '/')
      ? fallback
      : safeNext(rawNext, location.origin, fallback);
    void navigate(dest, { replace: true });
  }

  async function onSubmitEmail(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (sendPinEnabled === undefined) return; // belt-and-suspenders: no request-pin before config lands
    error = '';
    busy = true;
    try {
      await requestPin(email.trim());
      step = 'pin';
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not send PIN. Try again.';
    } finally {
      busy = false;
    }
  }

  async function onSubmitPin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const user = await verifyPin(email.trim(), pin.trim(), duration);
      afterLogin(user);
    } catch (err: unknown) {
      error = err instanceof ApiError ? err.displayMessage : 'Could not verify PIN.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <h1>Sign in</h1>

  {#if sendPinEnabled === undefined}
    <div class="loading"><Spinner /></div>
  {:else if sendPinEnabled === false}
    <p class="subtitle">Email delivery isn't configured — enter your email and the PIN shown in the server terminal.</p>
    <form onsubmit={onSubmitPin}>
      <FormRow label="Email">
        <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
      </FormRow>
      <FormRow label="PIN" error={error}>
        <Input type="text" bind:value={pin} autocomplete="one-time-code" name="pin" />
      </FormRow>
      <FormRow label="Stay signed in for">
        <select bind:value={duration}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </FormRow>
      <Button type="submit" loading={busy} disabled={!email || pin.length !== 6 || busy}>Sign in</Button>
    </form>
  {:else if step === 'email'}
    <form onsubmit={onSubmitEmail}>
      <FormRow label="Email" error={error}>
        <Input type="email" bind:value={email} autocomplete="email" autofocus name="email" />
      </FormRow>
      <Button type="submit" loading={busy} disabled={!email || busy}>Send PIN</Button>
    </form>
  {:else}
    <p class="subtitle">If <strong>{email}</strong> is registered, a 6-digit PIN has been sent — check your email (or the server console/outbox in a dev deployment).</p>
    <form onsubmit={onSubmitPin}>
      <FormRow label="PIN" error={error}>
        <Input type="text" bind:value={pin} autocomplete="one-time-code" autofocus name="pin" />
      </FormRow>
      <FormRow label="Stay signed in for">
        <select bind:value={duration}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </FormRow>
      <div class="actions">
        <Button type="submit" loading={busy} disabled={pin.length !== 6 || busy}>Sign in</Button>
        <Button variant="ghost" onclick={() => { step = 'email'; pin = ''; error = ''; }}>Back</Button>
      </div>
    </form>
  {/if}
</div>

<style>
  .login { max-width: 360px; margin: var(--space-6) auto; padding: var(--space-3); }
  .subtitle { color: var(--muted); margin-bottom: var(--space-3); }
  .actions { display: flex; gap: var(--space-2); }
  .loading { display: flex; justify-content: center; padding: var(--space-4); }
  select {
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
  }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/tests/Login.svelte.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/auth.svelte.ts frontend/src/pages/Login.svelte frontend/src/tests/Login.svelte.test.ts
git commit -m "feat(auth): PIN-delivery-aware login + return-path capture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Document-level token protection (`index.html` meta + SPA `no-store`)

**Files:**
- Modify: `frontend/index.html` (add referrer meta)
- Modify: `backend/mathion/main.py` (`_panel_cache_headers` helper + `_spa_fallback` headers)
- Test: `backend/tests/test_spa_document_headers.py`, `frontend/src/tests/indexHtml.test.ts`

**Interfaces:**
- Produces: `mathion.main._panel_cache_headers(full_path: str) -> dict[str, str] | None` (module-level, importable).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_spa_document_headers.py`:

```python
from mathion.main import _panel_cache_headers


def test_panel_paths_get_no_store():
    assert _panel_cache_headers("superuser/abc123") == {"Cache-Control": "no-store"}
    assert _panel_cache_headers("superuser") == {"Cache-Control": "no-store"}


def test_non_panel_paths_get_no_headers():
    assert _panel_cache_headers("courses") is None
    assert _panel_cache_headers("") is None
    assert _panel_cache_headers("superuserfoo") is None  # not a panel path
```

Create `frontend/src/tests/indexHtml.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

it('sets a no-referrer meta so the panel token never leaks via Referer', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
  expect(html).toContain('<meta name="referrer" content="no-referrer">');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_spa_document_headers.py -v`
Expected: FAIL — `ImportError: cannot import name '_panel_cache_headers'`.

Run: `cd frontend && npm test -- src/tests/indexHtml.test.ts`
Expected: FAIL — meta tag not present.

- [ ] **Step 3: Add the backend helper + apply headers**

In `backend/mathion/main.py`, add a module-level helper (outside the `if _frontend_dist.is_dir():` block, so it is always importable):

```python
def _panel_cache_headers(full_path: str) -> dict[str, str] | None:
    """no-store for superuser panel document responses (the token is in the URL)."""
    if full_path == "superuser" or full_path.startswith("superuser/"):
        return {"Cache-Control": "no-store"}
    return None
```

Then in `_spa_fallback`, thread the headers into both `FileResponse` returns:

```python
    def _spa_fallback(full_path: str) -> FileResponse:
        candidate = _frontend_dist / full_path
        try:
            candidate = candidate.resolve()
            candidate.relative_to(_frontend_dist.resolve())
        except ValueError:
            raise HTTPException(status_code=404)
        headers = _panel_cache_headers(full_path)
        if candidate.is_file():
            return FileResponse(candidate, headers=headers)
        return FileResponse(_frontend_dist / "index.html", headers=headers)
```

- [ ] **Step 4: Add the meta tag**

In `frontend/index.html`, add inside `<head>` (place it near the top of `<head>`, before other meta/link tags):

```html
    <meta name="referrer" content="no-referrer">
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_spa_document_headers.py -v`
Expected: PASS (2 passed).

Run: `cd frontend && npm test -- src/tests/indexHtml.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/mathion/main.py backend/tests/test_spa_document_headers.py frontend/index.html frontend/src/tests/indexHtml.test.ts
git commit -m "feat(superuser): document-level token protection (no-referrer + no-store)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Backend suite**: `cd backend && .venv/bin/pytest -q` → all pass.
- [ ] **Frontend suite**: `cd frontend && npm test` → all pass. (Runs `TZ=Europe/Copenhagen vitest run`.)
- [ ] **Manual bootstrap smoke** (deferred — record as a manual step, not a blocker): with a fresh dev DB and `MATHION_EMAIL_MODE=disabled`, no `MATHION_DEBUG`: `python -m mathion.superuser create-superuser you@example.com` → `python -m mathion.superuser activate` (copy URL) → open URL → direct-entry login → `python -m mathion.superuser pin you@example.com` → enter PIN → panel renders stats.
