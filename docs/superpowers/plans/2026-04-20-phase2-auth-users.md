# Phase 2: Auth + Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user management, passwordless PIN authentication, session handling, and role-based access control to all existing API endpoints.

**Architecture:** User/Session/PIN models in SQLAlchemy. Auth middleware as a FastAPI dependency that validates session cookies, checks `is_disabled`, and provides the current user. PIN-based login flow with hashed PINs and rate limiting. Existing endpoints protected by role checks. StudentEnrollment model for version-scoped access.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.x, Pydantic v2, hashlib (SHA-256 for PINs/tokens), secrets (token generation), pytest, httpx

**Spec:** `docs/superpowers/specs/2026-04-19-mathion-platform-design.md` (Sections 2 and 3)

**Existing code:** 77 passing tests, 8 models, ~20 API endpoints. Venv at `backend/.venv`.

---

## File Structure

### New files
- `backend/mathion/models_auth.py` — User, Session, PIN, StudentEnrollment models
- `backend/mathion/auth.py` — Auth service (PIN generation/verification, session creation, hashing)
- `backend/mathion/dependencies.py` — FastAPI dependencies (get_current_user, require_admin, require_superuser)
- `backend/mathion/api/auth.py` — Login/logout/profile endpoints
- `backend/mathion/api/enrollment.py` — Student enrollment endpoints
- `backend/tests/test_auth.py` — Auth flow tests
- `backend/tests/test_enrollment.py` — Enrollment tests
- `backend/tests/test_access_control.py` — Role-based access tests

### Modified files
- `backend/mathion/models.py` — Import models_auth to register with Base, update CourseAdmin FK
- `backend/mathion/config.py` — Add secret_key setting
- `backend/mathion/main.py` — Register new routers
- `backend/tests/conftest.py` — Add auth helper fixtures

---

### Task 1: User Model

**Files:**
- Create: `backend/mathion/models_auth.py`
- Modify: `backend/mathion/models.py` (import registration)
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Write failing test for User model**

Create `backend/tests/test_auth.py`:

```python
from mathion.models_auth import User


def test_create_user(db):
    user = User(email="student@example.com", full_name="Alice Smith")
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.id is not None
    assert user.email == "student@example.com"
    assert user.full_name == "Alice Smith"
    assert user.is_superuser is False
    assert user.is_disabled is False
    assert user.photo_url is None


def test_user_email_unique(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    u1 = User(email="alice@example.com")
    u2 = User(email="alice@example.com")
    db.add(u1)
    db.commit()
    db.add(u2)
    with pytest.raises(IntegrityError):
        db.commit()


def test_create_superuser(db):
    user = User(email="admin@example.com", full_name="Admin", is_superuser=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    assert user.is_superuser is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/pytest tests/test_auth.py -v
```

Expected: FAIL — `ImportError: cannot import name 'User'`

- [ ] **Step 3: Implement User model**

Create `backend/mathion/models_auth.py`:

```python
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mathion.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
```

Add import at the bottom of `backend/mathion/models.py` to register with Base:

```python
from mathion.models_auth import User  # noqa: F401 — register model with Base
```

- [ ] **Step 4: Run tests**

```bash
.venv/bin/pytest tests/test_auth.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/mathion/models_auth.py backend/mathion/models.py backend/tests/test_auth.py
git commit -m "feat: add User model"
```

---

### Task 2: Session and PIN Models

**Files:**
- Modify: `backend/mathion/models_auth.py`
- Modify: `backend/tests/test_auth.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_auth.py`:

```python
from datetime import datetime, timedelta, timezone

from mathion.models_auth import LoginPIN, Session, User


def test_create_session(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    session = Session(
        user_id=user.id,
        token_hash="abc123hashed",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    assert session.id is not None
    assert session.user_id == user.id
    assert session.created_at is not None
    assert session.last_active_at is not None


def test_create_pin(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    pin = LoginPIN(
        user_id=user.id,
        pin_hash="hashed_pin_value",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(pin)
    db.commit()
    db.refresh(pin)

    assert pin.id is not None
    assert pin.is_used is False


def test_cascade_delete_user_deletes_sessions(db):
    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    session = Session(
        user_id=user.id,
        token_hash="abc",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(session)
    db.commit()

    db.delete(user)
    db.commit()
    assert db.query(Session).count() == 0
```

- [ ] **Step 2: Run to verify fails**

- [ ] **Step 3: Implement Session and LoginPIN models**

Add to `backend/mathion/models_auth.py`:

```python
class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="sessions")


class LoginPIN(Base):
    __tablename__ = "login_pins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    pin_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship()
```

Add `sessions` relationship to User:

```python
class User(Base):
    # ... existing fields ...
    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")
```

Also add to `backend/mathion/models.py` import:

```python
from mathion.models_auth import User, Session, LoginPIN  # noqa: F401
```

- [ ] **Step 4: Run all tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: add Session and LoginPIN models"
```

---

### Task 3: Auth Service

**Files:**
- Create: `backend/mathion/auth.py`
- Modify: `backend/mathion/config.py`
- Create: `backend/tests/test_auth_service.py`

- [ ] **Step 1: Write failing tests for auth service**

Create `backend/tests/test_auth_service.py`:

```python
from datetime import datetime, timedelta, timezone

from mathion.auth import hash_token, generate_pin, generate_session_token, verify_pin_hash
from mathion.models_auth import LoginPIN, Session, User


def test_hash_token_deterministic():
    assert hash_token("abc123") == hash_token("abc123")


def test_hash_token_different_inputs():
    assert hash_token("abc") != hash_token("xyz")


def test_generate_pin_is_6_digits():
    pin = generate_pin()
    assert len(pin) == 6
    assert pin.isdigit()


def test_generate_session_token_length():
    token = generate_session_token()
    assert len(token) >= 43  # 32 bytes base64 = 43 chars


def test_verify_pin_hash():
    pin = "123456"
    hashed = hash_token(pin)
    assert verify_pin_hash(pin, hashed) is True
    assert verify_pin_hash("654321", hashed) is False


def test_request_pin_creates_pin(db):
    from mathion.auth import request_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    result = request_pin(db, "alice@example.com")
    assert result is not None  # Returns the raw PIN (for testing/email sending)
    assert len(result) == 6

    pins = db.query(LoginPIN).filter_by(user_id=user.id).all()
    assert len(pins) == 1
    assert pins[0].is_used is False


def test_request_pin_unknown_email_returns_none(db):
    from mathion.auth import request_pin

    result = request_pin(db, "nobody@example.com")
    assert result is None  # No PIN created, but no error either


def test_verify_pin_success(db):
    from mathion.auth import request_pin, verify_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    session_token = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    assert session_token is not None

    # PIN should be marked as used
    pin = db.query(LoginPIN).first()
    assert pin.is_used is True

    # Session should exist
    sessions = db.query(Session).filter_by(user_id=user.id).all()
    assert len(sessions) == 1


def test_verify_pin_wrong_pin(db):
    from mathion.auth import request_pin, verify_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    request_pin(db, "alice@example.com")
    session_token = verify_pin(db, "alice@example.com", "000000", duration_days=7)
    assert session_token is None


def test_verify_pin_expired(db):
    from mathion.auth import hash_token, verify_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    # Create an already-expired PIN
    pin = LoginPIN(
        user_id=user.id,
        pin_hash=hash_token("123456"),
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db.add(pin)
    db.commit()

    result = verify_pin(db, "alice@example.com", "123456", duration_days=7)
    assert result is None


def test_verify_pin_already_used(db):
    from mathion.auth import request_pin, verify_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    verify_pin(db, "alice@example.com", raw_pin, duration_days=7)

    # Second use should fail
    result = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    assert result is None


def test_validate_session_token(db):
    from mathion.auth import request_pin, verify_pin, validate_session

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    token = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)
    assert token is not None

    found_user = validate_session(db, token)
    assert found_user is not None
    assert found_user.id == user.id


def test_validate_session_invalid_token(db):
    from mathion.auth import validate_session

    result = validate_session(db, "invalid_token_here")
    assert result is None


def test_validate_session_disabled_user(db):
    from mathion.auth import request_pin, verify_pin, validate_session

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    raw_pin = request_pin(db, "alice@example.com")
    token = verify_pin(db, "alice@example.com", raw_pin, duration_days=7)

    # Disable the user
    user.is_disabled = True
    db.commit()

    result = validate_session(db, token)
    assert result is None

    # Session should be deleted
    assert db.query(Session).count() == 0


def test_invalidate_all_sessions(db):
    from mathion.auth import invalidate_all_sessions

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()

    # Create multiple sessions
    for i in range(3):
        s = Session(
            user_id=user.id,
            token_hash=f"hash_{i}",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.add(s)
    db.commit()
    assert db.query(Session).count() == 3

    invalidate_all_sessions(db, user.id)
    assert db.query(Session).count() == 0
```

- [ ] **Step 2: Run to verify fails**

- [ ] **Step 3: Update config**

Add to `backend/mathion/config.py`:

```python
class Settings(BaseSettings):
    # ... existing fields ...
    secret_key: str = "dev-secret-key-change-in-production"
    pin_expiry_minutes: int = 10
    max_pin_requests_per_hour: int = 3
    max_pin_failures_per_hour: int = 5
```

- [ ] **Step 4: Implement auth service**

Create `backend/mathion/auth.py`:

```python
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from mathion.config import settings
from mathion.models_auth import LoginPIN, Session, User


def hash_token(value: str) -> str:
    """Hash a token or PIN using SHA-256 with the app secret as salt."""
    salted = f"{settings.secret_key}:{value}"
    return hashlib.sha256(salted.encode()).hexdigest()


def verify_pin_hash(raw_pin: str, pin_hash: str) -> bool:
    return hash_token(raw_pin) == pin_hash


def generate_pin() -> str:
    """Generate a 6-digit PIN."""
    return f"{secrets.randbelow(1000000):06d}"


def generate_session_token() -> str:
    """Generate a cryptographically random session token."""
    return secrets.token_urlsafe(32)


def request_pin(db: DBSession, email: str) -> str | None:
    """Create a login PIN for the given email. Returns raw PIN or None if user not found."""
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.is_disabled:
        return None

    raw_pin = generate_pin()
    pin = LoginPIN(
        user_id=user.id,
        pin_hash=hash_token(raw_pin),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.pin_expiry_minutes),
    )
    db.add(pin)
    db.commit()
    return raw_pin


def verify_pin(db: DBSession, email: str, raw_pin: str, duration_days: int) -> str | None:
    """Verify a PIN and create a session. Returns session token or None."""
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or user.is_disabled:
        return None

    # Find valid, unused PIN
    pin = db.execute(
        select(LoginPIN)
        .where(
            LoginPIN.user_id == user.id,
            LoginPIN.is_used == False,  # noqa: E712
            LoginPIN.expires_at > datetime.now(timezone.utc),
        )
        .order_by(LoginPIN.created_at.desc())
    ).scalar_one_or_none()

    if not pin or not verify_pin_hash(raw_pin, pin.pin_hash):
        return None

    # Mark PIN as used
    pin.is_used = True

    # Create session
    raw_token = generate_session_token()
    session = Session(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=duration_days),
    )
    db.add(session)
    db.commit()
    return raw_token


def validate_session(db: DBSession, raw_token: str) -> User | None:
    """Validate a session token. Returns the user or None."""
    token_hash = hash_token(raw_token)
    session = db.execute(
        select(Session).where(
            Session.token_hash == token_hash,
            Session.expires_at > datetime.now(timezone.utc),
        )
    ).scalar_one_or_none()

    if not session:
        return None

    user = db.get(User, session.user_id)
    if not user or user.is_disabled:
        # Destroy session for disabled users
        db.delete(session)
        db.commit()
        return None

    return user


def invalidate_all_sessions(db: DBSession, user_id: int) -> None:
    """Delete all sessions for a user."""
    sessions = db.execute(select(Session).where(Session.user_id == user_id)).scalars().all()
    for s in sessions:
        db.delete(s)
    db.commit()


def destroy_session(db: DBSession, raw_token: str) -> None:
    """Delete a specific session (logout)."""
    token_hash = hash_token(raw_token)
    session = db.execute(
        select(Session).where(Session.token_hash == token_hash)
    ).scalar_one_or_none()
    if session:
        db.delete(session)
        db.commit()
```

- [ ] **Step 5: Run all tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add auth service with PIN login and session management"
```

---

### Task 4: Auth Dependencies (Middleware)

**Files:**
- Create: `backend/mathion/dependencies.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Implement auth dependencies**

Create `backend/mathion/dependencies.py`:

```python
from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from mathion.auth import validate_session
from mathion.database import get_db
from mathion.models_auth import User


def get_current_user(
    request: Request,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the session from the cookie. Returns the current user or raises 401."""
    # Check CSRF header
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("X-Requested-With") != "mathion":
            raise HTTPException(status_code=403, detail="Missing CSRF header")

    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = validate_session(db, session_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return user


def get_optional_user(
    request: Request,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
) -> User | None:
    """Like get_current_user but returns None instead of raising for unauthenticated requests."""
    if not session_token:
        return None
    return validate_session(db, session_token)


def require_superuser(user: User = Depends(get_current_user)) -> User:
    """Require the current user to be a superuser."""
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser access required")
    return user
```

- [ ] **Step 2: Update conftest.py with auth helper fixtures**

Add to `backend/tests/conftest.py`:

```python
from mathion.models_auth import User
from mathion.auth import request_pin, verify_pin


@pytest.fixture
def test_user(db):
    """Create a regular test user."""
    user = User(email="test@example.com", full_name="Test User")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def superuser(db):
    """Create a superuser."""
    user = User(email="admin@example.com", full_name="Admin", is_superuser=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def auth_client(client, db, test_user):
    """Return a TestClient with a valid session cookie for test_user."""
    raw_pin = request_pin(db, test_user.email)
    token = verify_pin(db, test_user.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)
    return client


@pytest.fixture
def admin_client(client, db, superuser):
    """Return a TestClient with a valid session cookie for superuser."""
    raw_pin = request_pin(db, superuser.email)
    token = verify_pin(db, superuser.email, raw_pin, duration_days=7)
    client.cookies.set("session_token", token)
    return client
```

- [ ] **Step 3: Run all tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "feat: add auth dependencies and test fixtures"
```

---

### Task 5: Login/Logout/Profile API Endpoints

**Files:**
- Create: `backend/mathion/api/auth.py`
- Modify: `backend/mathion/main.py`
- Modify: `backend/tests/test_auth.py`

- [ ] **Step 1: Write failing tests for auth API**

Add to `backend/tests/test_auth.py`:

```python
def test_api_request_pin(client, db):
    user = User(email="alice@example.com", full_name="Alice")
    db.add(user)
    db.commit()

    response = client.post("/api/auth/request-pin", json={"email": "alice@example.com"},
                           headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["message"] == "PIN sent"


def test_api_request_pin_unknown_email(client):
    response = client.post("/api/auth/request-pin", json={"email": "nobody@example.com"},
                           headers={"X-Requested-With": "mathion"})
    # Same response to prevent enumeration
    assert response.status_code == 200
    assert response.json()["message"] == "PIN sent"


def test_api_verify_pin_and_login(client, db):
    from mathion.auth import request_pin as _request_pin

    user = User(email="alice@example.com", full_name="Alice")
    db.add(user)
    db.commit()

    raw_pin = _request_pin(db, "alice@example.com")
    response = client.post("/api/auth/verify-pin", json={
        "email": "alice@example.com",
        "pin": raw_pin,
        "duration_days": 7,
    }, headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == "alice@example.com"
    assert "session_token" in response.cookies


def test_api_verify_pin_wrong(client, db):
    from mathion.auth import request_pin as _request_pin

    user = User(email="alice@example.com")
    db.add(user)
    db.commit()
    _request_pin(db, "alice@example.com")

    response = client.post("/api/auth/verify-pin", json={
        "email": "alice@example.com",
        "pin": "000000",
        "duration_days": 7,
    }, headers={"X-Requested-With": "mathion"})
    assert response.status_code == 401


def test_api_get_profile(auth_client, test_user):
    response = auth_client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == test_user.email


def test_api_get_profile_unauthenticated(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_api_logout(auth_client, db):
    from mathion.models_auth import Session

    response = auth_client.post("/api/auth/logout", headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert db.query(Session).count() == 0


def test_api_update_profile(auth_client):
    response = auth_client.patch("/api/auth/me", json={"full_name": "New Name"},
                                 headers={"X-Requested-With": "mathion"})
    assert response.status_code == 200
    assert response.json()["full_name"] == "New Name"
```

- [ ] **Step 2: Implement auth schemas**

Add to `backend/mathion/schemas.py`:

```python
class PinRequestSchema(BaseModel):
    email: str = Field(min_length=1, max_length=254)


class PinVerifySchema(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    duration_days: int = Field(ge=1, le=30)


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    is_superuser: bool
    is_disabled: bool
    photo_url: str | None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
```

- [ ] **Step 3: Implement auth API endpoints**

Create `backend/mathion/api/auth.py`:

```python
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from mathion.auth import destroy_session, request_pin, verify_pin
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models_auth import User
from mathion.schemas import PinRequestSchema, PinVerifySchema, UserResponse, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/request-pin")
def api_request_pin(data: PinRequestSchema, db: Session = Depends(get_db)):
    request_pin(db, data.email)
    # Always return success to prevent email enumeration
    return {"message": "PIN sent"}


@router.post("/verify-pin")
def api_verify_pin(data: PinVerifySchema, response: Response, db: Session = Depends(get_db)):
    token = verify_pin(db, data.email, data.pin, data.duration_days)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid or expired PIN")

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=data.duration_days * 86400,
    )

    from sqlalchemy import select
    from mathion.models_auth import User as UserModel
    user = db.execute(select(UserModel).where(UserModel.email == data.email)).scalar_one()

    return {"user": UserResponse.model_validate(user)}


@router.get("/me", response_model=UserResponse)
def get_profile(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserResponse)
def update_profile(data: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/logout")
def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias="session_token"),
    db: Session = Depends(get_db),
):
    if session_token:
        destroy_session(db, session_token)
    response.delete_cookie("session_token")
    return {"message": "Logged out"}
```

- [ ] **Step 4: Register router in main.py**

Add to `backend/mathion/main.py`:

```python
from mathion.api.auth import router as auth_router
app.include_router(auth_router)
```

- [ ] **Step 5: Run all tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add login/logout/profile API endpoints"
```

---

### Task 6: StudentEnrollment Model and Enrollment Endpoints

**Files:**
- Modify: `backend/mathion/models_auth.py`
- Create: `backend/mathion/api/enrollment.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_enrollment.py`

- [ ] **Step 1: Write failing tests for StudentEnrollment**

Create `backend/tests/test_enrollment.py`:

```python
from mathion.models import Course, CourseVersion
from mathion.models_auth import StudentEnrollment, User


def _make_published_version(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="published", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)
    return course, version


def test_create_enrollment(db):
    course, version = _make_published_version(db)
    user = User(email="student@example.com")
    db.add(user)
    db.commit()

    enrollment = StudentEnrollment(user_id=user.id, version_id=version.id, is_active=True)
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)

    assert enrollment.id is not None
    assert enrollment.is_active is True


def test_one_active_enrollment_per_course(db):
    """Re-enrolling in a newer version deactivates the old enrollment."""
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()

    v1 = CourseVersion(course_id=course.id, state="published", info_md="v1", info_html="")
    db.add(v1)
    db.commit()

    v2 = CourseVersion(course_id=course.id, state="published", info_md="v2", info_html="")
    db.add(v2)
    db.commit()

    user = User(email="student@example.com")
    db.add(user)
    db.commit()

    e1 = StudentEnrollment(user_id=user.id, version_id=v1.id, is_active=True)
    db.add(e1)
    db.commit()

    # Deactivate old, create new
    e1.is_active = False
    e2 = StudentEnrollment(user_id=user.id, version_id=v2.id, is_active=True)
    db.add(e2)
    db.commit()

    active = db.query(StudentEnrollment).filter_by(user_id=user.id, is_active=True).all()
    assert len(active) == 1
    assert active[0].version_id == v2.id
```

- [ ] **Step 2: Implement StudentEnrollment model**

Add to `backend/mathion/models_auth.py`:

```python
class StudentEnrollment(Base):
    __tablename__ = "student_enrollments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped["User"] = relationship()
```

Update the import in `models.py`:

```python
from mathion.models_auth import User, Session, LoginPIN, StudentEnrollment  # noqa: F401
```

- [ ] **Step 3: Run tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add StudentEnrollment model"
```

- [ ] **Step 4: Write and implement enrollment API**

Create `backend/mathion/api/enrollment.py` with endpoints for:
- `POST /api/courses/{course_id}/enroll` — Admin enrolls a student by email (creates User if needed, creates StudentEnrollment on newest published version)
- `POST /api/courses/{course_id}/enroll-batch` — Admin enrolls multiple students from a list of emails
- `GET /api/courses/{course_id}/students` — List enrolled students
- `DELETE /api/courses/{course_id}/students/{user_id}` — Remove student enrollment

Each endpoint should verify the requesting user is a course admin (check CourseAdmin table) or superuser.

- [ ] **Step 5: Run all tests, commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add enrollment API endpoints"
```

---

### Task 7: Protect Existing Endpoints with Auth

**Files:**
- Modify: `backend/mathion/api/courses.py`
- Modify: `backend/mathion/api/versions.py`
- Modify: `backend/mathion/api/blocks.py`
- Modify: `backend/mathion/api/items.py`
- Modify: `backend/mathion/api/content.py`
- Create: `backend/tests/test_access_control.py`

- [ ] **Step 1: Define access rules**

| Endpoint | Who can access |
|----------|----------------|
| Course CRUD | Superuser only (create/delete), course admin (update) |
| Version CRUD | Course admin |
| Block/Sequence/Item CRUD | Course admin |
| Content JSON | Enrolled student, course admin, or run teacher (for that version) |
| Publish/Archive/Revert | Course admin |
| Disable/Enable | Course admin |

- [ ] **Step 2: Add auth to course endpoints**

Modify each endpoint in `courses.py` to accept `user: User = Depends(get_current_user)` or `user: User = Depends(require_superuser)` as appropriate.

Create a helper function in `backend/mathion/api/helpers.py`:

```python
from mathion.models import CourseAdmin


def require_course_admin(db: Session, user: User, course_id: int) -> None:
    """Verify the user is a course admin or superuser. Raises 403 if not."""
    if user.is_superuser:
        return
    admin = db.execute(
        select(CourseAdmin).where(
            CourseAdmin.course_id == course_id,
            CourseAdmin.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=403, detail="Course admin access required")
```

- [ ] **Step 3: Add auth to all remaining endpoints**

Apply the same pattern to versions.py, blocks.py, items.py. For content.py, verify the user is either a course admin or has an active StudentEnrollment for that version.

- [ ] **Step 4: Update existing tests**

All existing tests use the `client` fixture (unauthenticated). They will break because endpoints now require auth. Update them to use either `auth_client` or `admin_client` fixtures. Content tests should use enrolled student fixtures.

This is the most labor-intensive step — every existing test that calls a protected endpoint needs to be updated.

- [ ] **Step 5: Write access control tests**

Create `backend/tests/test_access_control.py`:

```python
def test_unauthenticated_cannot_create_course(client):
    response = client.post("/api/courses", json={"slug": "test", "name": "Test", "description": ""},
                           headers={"X-Requested-With": "mathion"})
    assert response.status_code == 401


def test_regular_user_cannot_create_course(auth_client):
    response = auth_client.post("/api/courses", json={"slug": "test", "name": "Test", "description": ""},
                                headers={"X-Requested-With": "mathion"})
    assert response.status_code == 403


def test_superuser_can_create_course(admin_client):
    response = admin_client.post("/api/courses", json={"slug": "test", "name": "Test", "description": ""},
                                 headers={"X-Requested-With": "mathion"})
    assert response.status_code == 201


def test_enrolled_student_can_access_content(client, db):
    # Set up: create user, course, version, enrollment, session
    # Verify: student can GET content JSON
    pass  # Full implementation in the task


def test_non_enrolled_user_cannot_access_content(auth_client, db):
    # Set up: create course and version (published)
    # Verify: authenticated but non-enrolled user gets 403
    pass  # Full implementation in the task
```

- [ ] **Step 6: Run all tests**

```bash
.venv/bin/pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat: add role-based access control to all endpoints"
```

---

### Task 8: Update CourseAdmin FK and Revert Guard

**Files:**
- Modify: `backend/mathion/models.py`
- Modify: `backend/mathion/api/versions.py`
- Modify: `backend/tests/test_versions.py`

- [ ] **Step 1: Update CourseAdmin to have proper FK to users table**

Change `CourseAdmin.user_id` from plain Integer to a proper ForeignKey:

```python
user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
```

Add relationship:
```python
user: Mapped["User"] = relationship()
```

- [ ] **Step 2: Add revert guard**

In `versions.py` `revert_version()`, add check:

```python
from mathion.models_auth import StudentEnrollment

# Check zero students
student_count = db.scalar(
    select(func.count()).where(StudentEnrollment.version_id == version_id, StudentEnrollment.is_active == True)
)
if student_count > 0:
    raise HTTPException(status_code=409, detail="Cannot revert: version has enrolled students")

# TODO Phase 7: also check zero runs
```

- [ ] **Step 3: Test and commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/
git commit -m "feat: add CourseAdmin FK and revert guard"
```

---

### Task 9: Alembic Migration

**Files:**
- Generate: `backend/alembic/versions/` (new migration)

- [ ] **Step 1: Generate migration**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/alembic revision --autogenerate -m "add users sessions pins enrollments"
```

- [ ] **Step 2: Review and test migration**

```bash
MATHION_DATABASE_URL=sqlite:///./test_migration.db .venv/bin/alembic upgrade head
rm -f test_migration.db
```

- [ ] **Step 3: Run full test suite and commit**

```bash
.venv/bin/pytest tests/ -v
git add backend/alembic/
git commit -m "feat: add migration for auth models"
```

---

## Summary

After completing all 9 tasks, Phase 2 delivers:

- **Models:** User, Session, LoginPIN, StudentEnrollment (+ CourseAdmin FK update)
- **Auth service:** PIN generation/verification, session creation/validation/destruction, hashing
- **Auth middleware:** Session cookie validation, CSRF header check, is_disabled enforcement
- **API endpoints:** request-pin, verify-pin, logout, get/update profile, enroll student, batch enroll, list/remove students
- **Access control:** All existing endpoints protected by role (superuser, course admin, enrolled student)
- **Revert guard:** Published→created blocked if students enrolled

**Not included (deferred):**
- Rate limiting on PIN requests (needs a counter table or cache — Phase 8 or later)
- Photo upload (Phase 6 with asset management)
- Run-based enrollment (Phase 7)
- Email sending for PINs/enrollment notifications (Phase 9)
