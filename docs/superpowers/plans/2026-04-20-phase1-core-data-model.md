# Phase 1: Core Data Model + API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the project from scratch and build the foundational data model (Course through AnswerOption) with CRUD API endpoints and a content JSON delivery endpoint.

**Architecture:** Monorepo with `backend/` directory containing a FastAPI application. SQLAlchemy 2.x declarative models with sync sessions. Alembic for migrations. Pydantic v2 for request/response schemas. SQLite in-memory for tests, PostgreSQL for production.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.x (sync), Pydantic v2, Alembic, pytest, httpx, uvicorn

**Spec:** `docs/superpowers/specs/2026-04-19-mathion-platform-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/mathion/__init__.py`
- Create: `backend/mathion/main.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git init
```

- [ ] **Step 2: Create `.gitignore`**

Create `.gitignore`:

```gitignore
__pycache__/
*.py[cod]
*.egg-info/
dist/
build/
.eggs/
*.egg
.venv/
venv/
.env
*.db
*.sqlite3
.pytest_cache/
.mypy_cache/
htmlcov/
.coverage
node_modules/
```

- [ ] **Step 3: Create `backend/pyproject.toml`**

```toml
[project]
name = "mathion"
version = "0.1.0"
description = "Lightweight open-source LMS"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.30.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "psycopg2-binary>=2.9.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
    "pytest-cov>=5.0.0",
]

[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

- [ ] **Step 4: Create `backend/mathion/__init__.py`**

```python
```

(Empty file.)

- [ ] **Step 5: Create `backend/mathion/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="Mathion", version="0.1.0")


@app.get("/health")
def health_check():
    return {"status": "ok"}
```

- [ ] **Step 6: Create `backend/tests/__init__.py` and `backend/tests/conftest.py`**

`backend/tests/__init__.py`:

```python
```

(Empty file.)

`backend/tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient

from mathion.main import app


@pytest.fixture
def client():
    return TestClient(app)
```

- [ ] **Step 7: Create virtual environment and install dependencies**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

- [ ] **Step 8: Write and run a smoke test**

Create `backend/tests/test_health.py`:

```python
def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

Run:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
pytest tests/test_health.py -v
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add .gitignore backend/pyproject.toml backend/mathion/ backend/tests/
git commit -m "feat: scaffold backend project with FastAPI and pytest"
```

---

### Task 2: Database Setup

**Files:**
- Create: `backend/mathion/config.py`
- Create: `backend/mathion/database.py`
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_database.py`

- [ ] **Step 1: Create `backend/mathion/config.py`**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./mathion.db"
    asset_path: str = "/data/mathion/assets"
    max_file_size: int = 20 * 1024 * 1024  # 20MB
    max_course_size: int = 500 * 1024 * 1024  # 500MB

    model_config = {"env_prefix": "MATHION_"}


settings = Settings()
```

- [ ] **Step 2: Create `backend/mathion/database.py`**

```python
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from mathion.config import settings

engine = create_engine(settings.database_url, echo=False)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def enable_sqlite_fk(engine):
    """Enable foreign key enforcement for SQLite."""
    if "sqlite" in str(engine.url):

        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()


enable_sqlite_fk(engine)
```

- [ ] **Step 3: Update `backend/tests/conftest.py` with test database**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from mathion.database import Base, get_db
from mathion.main import app

test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(test_engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestSession = sessionmaker(bind=test_engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db():
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Write database connection test**

Create `backend/tests/test_database.py`:

```python
from mathion.database import Base


def test_tables_created(db):
    """Verify that the test database is set up and Base metadata works."""
    assert db.bind is not None
    # At this point no models exist, so just verify the session is alive
    result = db.execute(db.bind.dialect.do_ping(db.bind))
```

Actually, simpler:

```python
from sqlalchemy import text


def test_database_connection(db):
    result = db.execute(text("SELECT 1"))
    assert result.scalar() == 1
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/mathion/config.py backend/mathion/database.py backend/tests/
git commit -m "feat: add database setup with SQLAlchemy and test configuration"
```

---

### Task 3: Course and CourseAdmin Models

**Files:**
- Create: `backend/mathion/models.py`
- Create: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/__init__.py`
- Create: `backend/mathion/api/courses.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_courses.py`

- [ ] **Step 1: Write failing test for Course model**

Create `backend/tests/test_courses.py`:

```python
from mathion.models import Course


def test_create_course(db):
    course = Course(slug="applied-statistics", name="Applied Statistics", description="A course on stats")
    db.add(course)
    db.commit()
    db.refresh(course)

    assert course.id is not None
    assert course.slug == "applied-statistics"
    assert course.name == "Applied Statistics"
    assert course.description == "A course on stats"


def test_course_slug_unique(db):
    import pytest
    from sqlalchemy.exc import IntegrityError

    c1 = Course(slug="stats", name="Stats 1", description="")
    c2 = Course(slug="stats", name="Stats 2", description="")
    db.add(c1)
    db.commit()
    db.add(c2)
    with pytest.raises(IntegrityError):
        db.commit()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
pytest tests/test_courses.py -v
```

Expected: FAIL — `ImportError: cannot import name 'Course'`

- [ ] **Step 3: Implement Course model**

Create `backend/mathion/models.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mathion.database import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    admins: Mapped[list["CourseAdmin"]] = relationship(back_populates="course", cascade="all, delete-orphan")
    versions: Mapped[list["CourseVersion"]] = relationship(back_populates="course", cascade="all, delete-orphan")


class CourseAdmin(Base):
    __tablename__ = "course_admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)  # FK to users table added in Phase 2

    course: Mapped["Course"] = relationship(back_populates="admins")
```

Note: `CourseVersion` relationship is forward-declared — we implement it in Task 4. For now, remove the `versions` line and add it in Task 4.

Updated `Course` for now (without versions relationship):

```python
class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    admins: Mapped[list["CourseAdmin"]] = relationship(back_populates="course", cascade="all, delete-orphan")
```

- [ ] **Step 4: Run model test to verify it passes**

```bash
pytest tests/test_courses.py::test_create_course tests/test_courses.py::test_course_slug_unique -v
```

Expected: PASS

- [ ] **Step 5: Write failing test for Course API**

Add to `backend/tests/test_courses.py`:

```python
def test_api_create_course(client):
    response = client.post("/api/courses", json={
        "slug": "applied-statistics",
        "name": "Applied Statistics",
        "description": "Learn stats",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["slug"] == "applied-statistics"
    assert data["name"] == "Applied Statistics"
    assert data["id"] is not None


def test_api_create_course_duplicate_slug(client):
    client.post("/api/courses", json={"slug": "stats", "name": "S1", "description": ""})
    response = client.post("/api/courses", json={"slug": "stats", "name": "S2", "description": ""})
    assert response.status_code == 409


def test_api_list_courses(client):
    client.post("/api/courses", json={"slug": "c1", "name": "Course 1", "description": ""})
    client.post("/api/courses", json={"slug": "c2", "name": "Course 2", "description": ""})
    response = client.get("/api/courses")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_api_get_course(client):
    create_resp = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": "Desc"})
    course_id = create_resp.json()["id"]
    response = client.get(f"/api/courses/{course_id}")
    assert response.status_code == 200
    assert response.json()["slug"] == "stats"


def test_api_get_course_not_found(client):
    response = client.get("/api/courses/999")
    assert response.status_code == 404


def test_api_update_course(client):
    create_resp = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""})
    course_id = create_resp.json()["id"]
    response = client.patch(f"/api/courses/{course_id}", json={"name": "Applied Statistics"})
    assert response.status_code == 200
    assert response.json()["name"] == "Applied Statistics"
    assert response.json()["slug"] == "stats"  # unchanged


def test_api_delete_course(client):
    create_resp = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""})
    course_id = create_resp.json()["id"]
    response = client.delete(f"/api/courses/{course_id}")
    assert response.status_code == 204
    response = client.get(f"/api/courses/{course_id}")
    assert response.status_code == 404
```

- [ ] **Step 6: Run to verify tests fail**

```bash
pytest tests/test_courses.py -v
```

Expected: FAIL on API tests (404 — routes don't exist yet)

- [ ] **Step 7: Implement schemas**

Create `backend/mathion/schemas.py`:

```python
from pydantic import BaseModel, Field


class CourseCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class CourseResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str

    model_config = {"from_attributes": True}
```

- [ ] **Step 8: Implement Course API**

Create `backend/mathion/api/__init__.py`:

```python
```

(Empty file.)

Create `backend/mathion/api/courses.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Course
from mathion.schemas import CourseCreate, CourseResponse, CourseUpdate

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.post("", status_code=201, response_model=CourseResponse)
def create_course(data: CourseCreate, db: Session = Depends(get_db)):
    course = Course(slug=data.slug, name=data.name, description=data.description)
    db.add(course)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Course with this slug already exists")
    db.refresh(course)
    return course


@router.get("", response_model=list[CourseResponse])
def list_courses(db: Session = Depends(get_db)):
    courses = db.execute(select(Course)).scalars().all()
    return courses


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(course_id: int, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.patch("/{course_id}", response_model=CourseResponse)
def update_course(course_id: int, data: CourseUpdate, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=204)
def delete_course(course_id: int, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    db.delete(course)
    db.commit()
```

- [ ] **Step 9: Register router in main.py**

Update `backend/mathion/main.py`:

```python
from fastapi import FastAPI

from mathion.api.courses import router as courses_router

app = FastAPI(title="Mathion", version="0.1.0")
app.include_router(courses_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
```

- [ ] **Step 10: Run all tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/mathion/models.py backend/mathion/schemas.py backend/mathion/api/ backend/mathion/main.py backend/tests/test_courses.py
git commit -m "feat: add Course model with CRUD API endpoints"
```

---

### Task 4: CourseVersion Model and State Machine

**Files:**
- Modify: `backend/mathion/models.py`
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/versions.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_versions.py`

- [ ] **Step 1: Write failing test for CourseVersion model**

Create `backend/tests/test_versions.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError

from mathion.models import Course, CourseVersion


def _make_course(db, slug="test-course"):
    course = Course(slug=slug, name="Test", description="")
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def test_create_version(db):
    course = _make_course(db)
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)

    assert version.id is not None
    assert version.state == "created"
    assert version.course_id == course.id
    assert version.created_at is not None
    assert version.published_at is None
    assert version.archived_at is None
    assert version.max_quiz_attempts == 3
    assert version.is_disabled is False


def test_version_belongs_to_course(db):
    course = _make_course(db)
    v1 = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    v2 = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add_all([v1, v2])
    db.commit()

    db.refresh(course)
    assert len(course.versions) == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_versions.py -v
```

Expected: FAIL — `ImportError: cannot import name 'CourseVersion'`

- [ ] **Step 3: Implement CourseVersion model**

Add to `backend/mathion/models.py`:

```python
from sqlalchemy import Boolean

# Add to existing imports at top, then add after CourseAdmin class:

class CourseVersion(Base):
    __tablename__ = "course_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    is_disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    info_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    info_html: Mapped[str] = mapped_column(Text, nullable=False, default="")
    max_quiz_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    content_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="versions")
```

Also add to `Course` class:

```python
    versions: Mapped[list["CourseVersion"]] = relationship(back_populates="course", cascade="all, delete-orphan")
```

- [ ] **Step 4: Run model tests to verify they pass**

```bash
pytest tests/test_versions.py -v
```

Expected: PASS

- [ ] **Step 5: Write failing test for state transitions**

Add to `backend/tests/test_versions.py`:

```python
from datetime import datetime, timezone


def test_api_create_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    response = client.post(f"/api/courses/{course['id']}/versions", json={
        "info_md": "Course info",
        "max_quiz_attempts": 5,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["state"] == "created"
    assert data["max_quiz_attempts"] == 5
    assert data["is_disabled"] is False


def test_api_publish_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = client.post(f"/api/versions/{version['id']}/publish")
    assert response.status_code == 200
    assert response.json()["state"] == "published"
    assert response.json()["published_at"] is not None


def test_api_archive_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    client.post(f"/api/versions/{version['id']}/publish")
    response = client.post(f"/api/versions/{version['id']}/archive")
    assert response.status_code == 200
    assert response.json()["state"] == "archived"
    assert response.json()["archived_at"] is not None


def test_api_revert_published_to_created(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    client.post(f"/api/versions/{version['id']}/publish")
    response = client.post(f"/api/versions/{version['id']}/revert")
    assert response.status_code == 200
    assert response.json()["state"] == "created"


def test_api_cannot_archive_created(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = client.post(f"/api/versions/{version['id']}/archive")
    assert response.status_code == 409


def test_api_cannot_revert_archived(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    client.post(f"/api/versions/{version['id']}/publish")
    client.post(f"/api/versions/{version['id']}/archive")
    response = client.post(f"/api/versions/{version['id']}/revert")
    assert response.status_code == 409


def test_api_delete_created_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = client.delete(f"/api/versions/{version['id']}")
    assert response.status_code == 204


def test_api_cannot_delete_published_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    client.post(f"/api/versions/{version['id']}/publish")
    response = client.delete(f"/api/versions/{version['id']}")
    assert response.status_code == 409


def test_api_list_versions(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "Stats", "description": ""}).json()
    client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "v1"})
    client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "v2"})
    response = client.get(f"/api/courses/{course['id']}/versions")
    assert response.status_code == 200
    assert len(response.json()) == 2
```

- [ ] **Step 6: Run to verify tests fail**

```bash
pytest tests/test_versions.py -v -k "api"
```

Expected: FAIL — routes don't exist

- [ ] **Step 7: Implement version schemas**

Add to `backend/mathion/schemas.py`:

```python
from datetime import datetime


class VersionCreate(BaseModel):
    info_md: str = ""
    max_quiz_attempts: int = Field(default=3, ge=1, le=10)


class VersionResponse(BaseModel):
    id: int
    course_id: int
    state: str
    is_disabled: bool
    info_md: str
    info_html: str
    max_quiz_attempts: int
    created_at: datetime
    published_at: datetime | None
    archived_at: datetime | None

    model_config = {"from_attributes": True}
```

- [ ] **Step 8: Implement version API**

Create `backend/mathion/api/versions.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Course, CourseVersion
from mathion.schemas import VersionCreate, VersionResponse

router = APIRouter(tags=["versions"])


@router.post("/api/courses/{course_id}/versions", status_code=201, response_model=VersionResponse)
def create_version(course_id: int, data: VersionCreate, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    version = CourseVersion(
        course_id=course_id,
        info_md=data.info_md,
        info_html="",  # Rendered in Phase 4
        max_quiz_attempts=data.max_quiz_attempts,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


@router.get("/api/courses/{course_id}/versions", response_model=list[VersionResponse])
def list_versions(course_id: int, db: Session = Depends(get_db)):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    versions = db.execute(
        select(CourseVersion).where(CourseVersion.course_id == course_id)
    ).scalars().all()
    return versions


@router.post("/api/versions/{version_id}/publish", response_model=VersionResponse)
def publish_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "created":
        raise HTTPException(status_code=409, detail=f"Cannot publish version in '{version.state}' state")
    version.state = "published"
    version.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/archive", response_model=VersionResponse)
def archive_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot archive version in '{version.state}' state")
    version.state = "archived"
    version.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(version)
    return version


@router.post("/api/versions/{version_id}/revert", response_model=VersionResponse)
def revert_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "published":
        raise HTTPException(status_code=409, detail=f"Cannot revert version in '{version.state}' state")
    # TODO Phase 2: check zero students assigned AND zero runs
    version.state = "created"
    version.published_at = None
    db.commit()
    db.refresh(version)
    return version


@router.delete("/api/versions/{version_id}", status_code=204)
def delete_version(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only delete versions in 'created' state")
    db.delete(version)
    db.commit()
```

- [ ] **Step 9: Register router in main.py**

Update `backend/mathion/main.py`:

```python
from fastapi import FastAPI

from mathion.api.courses import router as courses_router
from mathion.api.versions import router as versions_router

app = FastAPI(title="Mathion", version="0.1.0")
app.include_router(courses_router)
app.include_router(versions_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
```

- [ ] **Step 10: Run all tests**

```bash
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/
git commit -m "feat: add CourseVersion model with state machine and CRUD API"
```

---

### Task 5: Block and Sequence Models

**Files:**
- Modify: `backend/mathion/models.py`
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/blocks.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_blocks.py`

- [ ] **Step 1: Write failing test for Block and Sequence models**

Create `backend/tests/test_blocks.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError

from mathion.models import Block, Course, CourseVersion, Sequence


def _make_version(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def test_create_block(db):
    version = _make_version(db)
    block = Block(version_id=version.id, title="Descriptive Stats", slug="descriptive-stats", order=1, info="Goals")
    db.add(block)
    db.commit()
    db.refresh(block)
    assert block.id is not None
    assert block.title == "Descriptive Stats"
    assert block.slug == "descriptive-stats"
    assert block.order == 1


def test_block_max_8_enforced_by_api(db):
    """Max 8 blocks is enforced at API level, not model level."""
    version = _make_version(db)
    for i in range(10):
        db.add(Block(version_id=version.id, title=f"B{i}", slug=f"b{i}", order=i + 1, info=""))
    db.commit()
    # Model allows it — API will enforce the limit
    assert db.query(Block).filter_by(version_id=version.id).count() == 10


def test_create_sequence(db):
    version = _make_version(db)
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="Quantiles", slug="quantiles", order=1)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    assert seq.id is not None
    assert seq.block_id == block.id


def test_cascade_delete_version_deletes_blocks(db):
    version = _make_version(db)
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()

    db.delete(version)
    db.commit()
    assert db.query(Block).count() == 0
    assert db.query(Sequence).count() == 0
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_blocks.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement Block and Sequence models**

Add to `backend/mathion/models.py`:

```python
class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    info: Mapped[str] = mapped_column(Text, nullable=False, default="")

    version: Mapped["CourseVersion"] = relationship(back_populates="blocks")
    sequences: Mapped[list["Sequence"]] = relationship(back_populates="block", cascade="all, delete-orphan", order_by="Sequence.order")
```

Add `blocks` relationship to `CourseVersion`:

```python
    blocks: Mapped[list["Block"]] = relationship(back_populates="version", cascade="all, delete-orphan", order_by="Block.order")
```

```python
class Sequence(Base):
    __tablename__ = "sequences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    block_id: Mapped[int] = mapped_column(ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)

    block: Mapped["Block"] = relationship(back_populates="sequences")
    items: Mapped[list["Item"]] = relationship(back_populates="sequence", cascade="all, delete-orphan", order_by="Item.order")
```

- [ ] **Step 4: Run model tests**

```bash
pytest tests/test_blocks.py -v
```

Expected: PASS

- [ ] **Step 5: Write failing test for Block API**

Add to `backend/tests/test_blocks.py`:

```python
def test_api_create_block(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    response = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Descriptive Stats",
        "slug": "descriptive-stats",
        "info": "Learning goals",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Descriptive Stats"
    assert data["order"] == 1  # auto-assigned


def test_api_max_8_blocks(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    for i in range(8):
        resp = client.post(f"/api/versions/{version['id']}/blocks", json={
            "title": f"Block {i+1}", "slug": f"block-{i+1}", "info": "",
        })
        assert resp.status_code == 201
    resp = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Block 9", "slug": "block-9", "info": "",
    })
    assert resp.status_code == 409


def test_api_cannot_add_block_to_published_version(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    client.post(f"/api/versions/{version['id']}/publish")
    response = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "New Block", "slug": "new-block", "info": "",
    })
    assert response.status_code == 409


def test_api_create_sequence(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    response = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Quantiles",
        "slug": "quantiles",
    })
    assert response.status_code == 201
    assert response.json()["title"] == "Quantiles"
    assert response.json()["order"] == 1


def test_api_max_8_sequences(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    for i in range(8):
        resp = client.post(f"/api/blocks/{block['id']}/sequences", json={
            "title": f"Seq {i+1}", "slug": f"seq-{i+1}",
        })
        assert resp.status_code == 201
    resp = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Seq 9", "slug": "seq-9",
    })
    assert resp.status_code == 409
```

- [ ] **Step 6: Run to verify fails**

```bash
pytest tests/test_blocks.py -v -k "api"
```

Expected: FAIL — routes don't exist

- [ ] **Step 7: Implement block/sequence schemas**

Add to `backend/mathion/schemas.py`:

```python
class BlockCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    info: str = ""


class BlockResponse(BaseModel):
    id: int
    version_id: int
    title: str
    slug: str
    order: int
    info: str

    model_config = {"from_attributes": True}


class SequenceCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class SequenceResponse(BaseModel):
    id: int
    block_id: int
    title: str
    slug: str
    order: int

    model_config = {"from_attributes": True}
```

- [ ] **Step 8: Implement block/sequence API**

Create `backend/mathion/api/blocks.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Block, CourseVersion, Sequence
from mathion.schemas import BlockCreate, BlockResponse, SequenceCreate, SequenceResponse

router = APIRouter(tags=["blocks"])

MAX_BLOCKS = 8
MAX_SEQUENCES = 8


@router.post("/api/versions/{version_id}/blocks", status_code=201, response_model=BlockResponse)
def create_block(version_id: int, data: BlockCreate, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add blocks to versions in 'created' state")

    count = db.scalar(select(func.count()).where(Block.version_id == version_id))
    if count >= MAX_BLOCKS:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_BLOCKS} blocks per version")

    next_order = (db.scalar(select(func.max(Block.order)).where(Block.version_id == version_id)) or 0) + 1
    block = Block(version_id=version_id, title=data.title, slug=data.slug, order=next_order, info=data.info)
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.get("/api/versions/{version_id}/blocks", response_model=list[BlockResponse])
def list_blocks(version_id: int, db: Session = Depends(get_db)):
    blocks = db.execute(
        select(Block).where(Block.version_id == version_id).order_by(Block.order)
    ).scalars().all()
    return blocks


@router.post("/api/blocks/{block_id}/sequences", status_code=201, response_model=SequenceResponse)
def create_sequence(block_id: int, data: SequenceCreate, db: Session = Depends(get_db)):
    block = db.get(Block, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")

    version = db.get(CourseVersion, block.version_id)
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add sequences to versions in 'created' state")

    count = db.scalar(select(func.count()).where(Sequence.block_id == block_id))
    if count >= MAX_SEQUENCES:
        raise HTTPException(status_code=409, detail=f"Maximum {MAX_SEQUENCES} sequences per block")

    next_order = (db.scalar(select(func.max(Sequence.order)).where(Sequence.block_id == block_id)) or 0) + 1
    seq = Sequence(block_id=block_id, title=data.title, slug=data.slug, order=next_order)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    return seq


@router.get("/api/blocks/{block_id}/sequences", response_model=list[SequenceResponse])
def list_sequences(block_id: int, db: Session = Depends(get_db)):
    sequences = db.execute(
        select(Sequence).where(Sequence.block_id == block_id).order_by(Sequence.order)
    ).scalars().all()
    return sequences
```

- [ ] **Step 9: Register router in main.py**

Add to `backend/mathion/main.py`:

```python
from mathion.api.blocks import router as blocks_router
# ...
app.include_router(blocks_router)
```

- [ ] **Step 10: Run all tests**

```bash
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/
git commit -m "feat: add Block and Sequence models with CRUD API"
```

---

### Task 6: Item Model (All Types)

**Files:**
- Modify: `backend/mathion/models.py`
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/items.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_items.py`

- [ ] **Step 1: Write failing test for Item model**

Create `backend/tests/test_items.py`:

```python
from mathion.models import Block, Course, CourseVersion, Item, Sequence


def _make_sequence(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    db.refresh(seq)
    return seq


def test_create_static_page(db):
    seq = _make_sequence(db)
    item = Item(
        sequence_id=seq.id, title="Introduction", slug="introduction",
        order=1, type="static_page", content_md="# Hello", content_html="<h1>Hello</h1>",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.id is not None
    assert item.type == "static_page"
    assert item.content_md == "# Hello"


def test_create_video(db):
    seq = _make_sequence(db)
    item = Item(
        sequence_id=seq.id, title="Lecture", slug="lecture",
        order=1, type="video", video_url="https://youtube.com/watch?v=abc",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.type == "video"
    assert item.video_url == "https://youtube.com/watch?v=abc"


def test_create_quiz(db):
    seq = _make_sequence(db)
    item = Item(
        sequence_id=seq.id, title="Quiz 1", slug="quiz-1",
        order=1, type="quiz",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.type == "quiz"


def test_create_interactive_app(db):
    seq = _make_sequence(db)
    item = Item(
        sequence_id=seq.id, title="Simulation", slug="simulation",
        order=1, type="interactive_app", script_url="https://example.com/app.js",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    assert item.type == "interactive_app"
    assert item.script_url == "https://example.com/app.js"
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_items.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement Item model**

Add to `backend/mathion/models.py`:

```python
class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sequence_id: Mapped[int] = mapped_column(ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # static_page, video, quiz, interactive_app

    # static_page fields
    content_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    # video fields
    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # interactive_app fields
    script_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    sequence: Mapped["Sequence"] = relationship(back_populates="items")
    questions: Mapped[list["Question"]] = relationship(back_populates="item", cascade="all, delete-orphan", order_by="Question.order")
```

- [ ] **Step 4: Run model tests**

```bash
pytest tests/test_items.py -v
```

Expected: PASS

- [ ] **Step 5: Write failing test for Item API**

Add to `backend/tests/test_items.py`:

```python
def _setup_sequence(client):
    course = client.post("/api/courses", json={"slug": "stats", "name": "S", "description": ""}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "B1", "slug": "b1", "info": "",
    }).json()
    seq = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "S1", "slug": "s1",
    }).json()
    return seq, version


def test_api_create_static_page(client):
    seq, version = _setup_sequence(client)
    response = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Intro", "slug": "intro", "type": "static_page",
        "content_md": "# Hello",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["type"] == "static_page"
    assert data["content_md"] == "# Hello"
    assert data["order"] == 1


def test_api_create_video(client):
    seq, version = _setup_sequence(client)
    response = client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Lecture", "slug": "lecture", "type": "video",
        "video_url": "https://youtube.com/watch?v=abc",
    })
    assert response.status_code == 201
    assert response.json()["type"] == "video"


def test_api_list_items(client):
    seq, version = _setup_sequence(client)
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I1", "slug": "i1", "type": "static_page", "content_md": "a",
    })
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "I2", "slug": "i2", "type": "video", "video_url": "https://example.com",
    })
    response = client.get(f"/api/sequences/{seq['id']}/items")
    assert response.status_code == 200
    assert len(response.json()) == 2
```

- [ ] **Step 6: Run to verify fails**

```bash
pytest tests/test_items.py -v -k "api"
```

Expected: FAIL

- [ ] **Step 7: Implement item schemas**

Add to `backend/mathion/schemas.py`:

```python
from typing import Literal


class ItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    type: Literal["static_page", "video", "quiz", "interactive_app"]
    content_md: str | None = None
    video_url: str | None = None
    script_url: str | None = None


class ItemResponse(BaseModel):
    id: int
    sequence_id: int
    title: str
    slug: str
    order: int
    type: str
    content_md: str | None
    content_html: str | None
    video_url: str | None
    script_url: str | None

    model_config = {"from_attributes": True}
```

- [ ] **Step 8: Implement item API**

Create `backend/mathion/api/items.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.database import get_db
from mathion.models import Block, CourseVersion, Item, Sequence
from mathion.schemas import ItemCreate, ItemResponse

router = APIRouter(tags=["items"])


def _get_version_for_sequence(db: Session, sequence_id: int) -> CourseVersion:
    seq = db.get(Sequence, sequence_id)
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    block = db.get(Block, seq.block_id)
    return db.get(CourseVersion, block.version_id)


@router.post("/api/sequences/{sequence_id}/items", status_code=201, response_model=ItemResponse)
def create_item(sequence_id: int, data: ItemCreate, db: Session = Depends(get_db)):
    version = _get_version_for_sequence(db, sequence_id)
    if version.state != "created":
        raise HTTPException(status_code=409, detail="Can only add items to versions in 'created' state")

    next_order = (db.scalar(select(func.max(Item.order)).where(Item.sequence_id == sequence_id)) or 0) + 1
    item = Item(
        sequence_id=sequence_id,
        title=data.title,
        slug=data.slug,
        order=next_order,
        type=data.type,
        content_md=data.content_md,
        content_html="",  # Rendered in Phase 4
        video_url=data.video_url,
        script_url=data.script_url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/api/sequences/{sequence_id}/items", response_model=list[ItemResponse])
def list_items(sequence_id: int, db: Session = Depends(get_db)):
    items = db.execute(
        select(Item).where(Item.sequence_id == sequence_id).order_by(Item.order)
    ).scalars().all()
    return items
```

- [ ] **Step 9: Register router in main.py**

Add to `backend/mathion/main.py`:

```python
from mathion.api.items import router as items_router
# ...
app.include_router(items_router)
```

- [ ] **Step 10: Run all tests**

```bash
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 11: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/
git commit -m "feat: add Item model (all types) with API"
```

---

### Task 7: Question and AnswerOption Models

**Files:**
- Modify: `backend/mathion/models.py`
- Modify: `backend/mathion/schemas.py`
- Create: `backend/mathion/api/questions.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_questions.py`

- [ ] **Step 1: Write failing test for Question and AnswerOption models**

Create `backend/tests/test_questions.py`:

```python
from mathion.models import AnswerOption, Block, Course, CourseVersion, Item, Question, Sequence


def _make_quiz_item(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    item = Item(sequence_id=seq.id, title="Quiz", slug="quiz", order=1, type="quiz")
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_create_single_choice_question(db):
    item = _make_quiz_item(db)
    q = Question(
        item_id=item.id, text_md="What is 2+2?", text_html="<p>What is 2+2?</p>",
        type="single_choice", order=1,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    assert q.id is not None
    assert q.type == "single_choice"


def test_create_answer_options(db):
    item = _make_quiz_item(db)
    q = Question(
        item_id=item.id, text_md="What is 2+2?", text_html="<p>What is 2+2?</p>",
        type="single_choice", order=1,
    )
    db.add(q)
    db.commit()

    opts = [
        AnswerOption(question_id=q.id, text="3", is_correct=False, order=1),
        AnswerOption(question_id=q.id, text="4", is_correct=True, order=2),
        AnswerOption(question_id=q.id, text="5", is_correct=False, order=3),
    ]
    db.add_all(opts)
    db.commit()

    db.refresh(q)
    assert len(q.options) == 3
    correct = [o for o in q.options if o.is_correct]
    assert len(correct) == 1
    assert correct[0].text == "4"


def test_create_numeric_question(db):
    item = _make_quiz_item(db)
    q = Question(
        item_id=item.id, text_md="Calculate sqrt(4)", text_html="<p>Calculate sqrt(4)</p>",
        type="numeric_answer", order=1, correct_numeric=2.0, precision=0,
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    assert q.correct_numeric == 2.0
    assert q.precision == 0


def test_create_text_question(db):
    item = _make_quiz_item(db)
    q = Question(
        item_id=item.id, text_md="Chemical formula of ethanol?", text_html="<p>Chemical formula of ethanol?</p>",
        type="text_answer", order=1, correct_text="C2H5OH",
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    assert q.correct_text == "C2H5OH"


def test_cascade_delete_item_deletes_questions(db):
    item = _make_quiz_item(db)
    q = Question(item_id=item.id, text_md="Q", text_html="Q", type="single_choice", order=1)
    db.add(q)
    db.commit()
    opt = AnswerOption(question_id=q.id, text="A", is_correct=True, order=1)
    db.add(opt)
    db.commit()

    db.delete(item)
    db.commit()
    assert db.query(Question).count() == 0
    assert db.query(AnswerOption).count() == 0
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_questions.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement Question and AnswerOption models**

Add to `backend/mathion/models.py`:

```python
from sqlalchemy import Boolean, Float


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    text_md: Mapped[str] = mapped_column(Text, nullable=False)
    text_html: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # single_choice, multiple_choice, numeric_answer, text_answer
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    explanation_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    explanation_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    # numeric_answer fields
    correct_numeric: Mapped[float | None] = mapped_column(Float, nullable=True)
    precision: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # text_answer fields
    correct_text: Mapped[str | None] = mapped_column(String(500), nullable=True)

    item: Mapped["Item"] = relationship(back_populates="questions")
    options: Mapped[list["AnswerOption"]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="AnswerOption.order")


class AnswerOption(Base):
    __tablename__ = "answer_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)

    question: Mapped["Question"] = relationship(back_populates="options")
```

- [ ] **Step 4: Run model tests**

```bash
pytest tests/test_questions.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

Question/AnswerOption CRUD API will be built as part of the quiz form builder in Phase 5. For now, the models are sufficient.

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/
git commit -m "feat: add Question and AnswerOption models"
```

---

### Task 8: Content JSON Delivery Endpoint

**Files:**
- Create: `backend/mathion/api/content.py`
- Modify: `backend/mathion/main.py`
- Create: `backend/tests/test_content.py`

- [ ] **Step 1: Write failing test for content JSON endpoint**

Create `backend/tests/test_content.py`:

```python
def _build_course(client):
    """Create a course with one block, one sequence, two items (static page + quiz with questions)."""
    course = client.post("/api/courses", json={"slug": "stats", "name": "Applied Statistics", "description": "Desc"}).json()
    version = client.post(f"/api/courses/{course['id']}/versions", json={"info_md": "Welcome"}).json()
    block = client.post(f"/api/versions/{version['id']}/blocks", json={
        "title": "Descriptive Stats", "slug": "descriptive-stats", "info": "Goals",
    }).json()
    seq = client.post(f"/api/blocks/{block['id']}/sequences", json={
        "title": "Quantiles", "slug": "quantiles",
    }).json()
    client.post(f"/api/sequences/{seq['id']}/items", json={
        "title": "Introduction", "slug": "intro", "type": "static_page",
        "content_md": "# Intro",
    })
    # Quiz item must be added directly to DB since quiz question API is not yet built
    return course, version


def test_content_json_structure(client, db):
    from mathion.models import AnswerOption, Item, Question

    course, version = _build_course(client)

    # Add quiz item and questions directly
    items_resp = client.get(f"/api/sequences/{1}/items")  # hacky, but we know the seq ID
    # Better: get the sequence ID from block listing
    blocks = client.get(f"/api/versions/{version['id']}/blocks").json()
    block_id = blocks[0]["id"]
    seqs = client.get(f"/api/blocks/{block_id}/sequences").json()
    seq_id = seqs[0]["id"]

    # Add a quiz via direct model creation
    quiz_item = Item(sequence_id=seq_id, title="Quiz 1", slug="quiz-1", order=2, type="quiz")
    db.add(quiz_item)
    db.commit()
    db.refresh(quiz_item)

    q = Question(item_id=quiz_item.id, text_md="2+2?", text_html="<p>2+2?</p>", type="single_choice", order=1)
    db.add(q)
    db.commit()
    db.refresh(q)

    db.add_all([
        AnswerOption(question_id=q.id, text="3", is_correct=False, order=1),
        AnswerOption(question_id=q.id, text="4", is_correct=True, order=2),
    ])
    db.commit()

    response = client.get(f"/api/versions/{version['id']}/content")
    assert response.status_code == 200
    data = response.json()

    # Check top-level structure
    assert data["course"]["slug"] == "stats"
    assert data["course"]["name"] == "Applied Statistics"
    assert data["version"]["id"] == version["id"]

    # Check blocks
    assert len(data["blocks"]) == 1
    block = data["blocks"][0]
    assert block["title"] == "Descriptive Stats"
    assert block["slug"] == "descriptive-stats"

    # Check sequences
    assert len(block["sequences"]) == 1
    seq = block["sequences"][0]
    assert seq["title"] == "Quantiles"

    # Check items
    assert len(seq["items"]) == 2
    static = seq["items"][0]
    assert static["type"] == "static_page"
    assert static["title"] == "Introduction"

    quiz = seq["items"][1]
    assert quiz["type"] == "quiz"
    assert len(quiz["questions"]) == 1

    # Check quiz options do NOT contain is_correct
    question = quiz["questions"][0]
    assert question["text_html"] == "<p>2+2?</p>"
    assert len(question["options"]) == 2
    for opt in question["options"]:
        assert "is_correct" not in opt


def test_content_json_404_for_nonexistent_version(client):
    response = client.get("/api/versions/999/content")
    assert response.status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_content.py -v
```

Expected: FAIL — route doesn't exist

- [ ] **Step 3: Implement content JSON endpoint**

Create `backend/mathion/api/content.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from mathion.database import get_db
from mathion.models import Block, CourseVersion

router = APIRouter(tags=["content"])


@router.get("/api/versions/{version_id}/content")
def get_content_json(version_id: int, db: Session = Depends(get_db)):
    version = db.get(CourseVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    # Eager load the full tree
    blocks = (
        db.query(Block)
        .filter(Block.version_id == version_id)
        .options(
            joinedload(Block.sequences)
            .joinedload("items")
            .joinedload("questions")
            .joinedload("options")
        )
        .order_by(Block.order)
        .all()
    )

    return {
        "course": {
            "name": version.course.name,
            "slug": version.course.slug,
        },
        "version": {
            "id": version.id,
            "state": version.state,
            "info_html": version.info_html,
            "max_quiz_attempts": version.max_quiz_attempts,
        },
        "blocks": [
            {
                "id": block.id,
                "title": block.title,
                "slug": block.slug,
                "order": block.order,
                "info": block.info,
                "sequences": sorted(
                    [
                        {
                            "id": seq.id,
                            "title": seq.title,
                            "slug": seq.slug,
                            "order": seq.order,
                            "items": sorted(
                                [_serialize_item(item) for item in seq.items],
                                key=lambda x: x["order"],
                            ),
                        }
                        for seq in block.sequences
                    ],
                    key=lambda x: x["order"],
                ),
            }
            for block in blocks
        ],
    }


def _serialize_item(item):
    result = {
        "id": item.id,
        "title": item.title,
        "slug": item.slug,
        "order": item.order,
        "type": item.type,
    }

    if item.type == "static_page":
        result["content_html"] = item.content_html or ""
    elif item.type == "video":
        result["video_url"] = item.video_url
    elif item.type == "interactive_app":
        result["script_url"] = item.script_url
    elif item.type == "quiz":
        result["questions"] = [
            {
                "id": q.id,
                "text_html": q.text_html,
                "type": q.type,
                "order": q.order,
                "options": [
                    {"id": o.id, "text": o.text, "order": o.order}
                    for o in sorted(q.options, key=lambda o: o.order)
                ]
                if q.type in ("single_choice", "multiple_choice")
                else [],
            }
            for q in sorted(item.questions, key=lambda q: q.order)
        ]

    return result
```

Note: quiz questions never include `is_correct`, `correct_numeric`, `correct_text`, or explanations. Those are served only through the evaluation and reveal endpoints (Phase 5).

- [ ] **Step 4: Register router in main.py**

Add to `backend/mathion/main.py`:

```python
from mathion.api.content import router as content_router
# ...
app.include_router(content_router)
```

- [ ] **Step 5: Run all tests**

```bash
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/
git commit -m "feat: add content JSON delivery endpoint"
```

---

### Task 9: Alembic Setup and Initial Migration

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/` (auto-generated migration)

- [ ] **Step 1: Initialize Alembic**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
source .venv/bin/activate
alembic init alembic
```

- [ ] **Step 2: Configure `alembic/env.py`**

Replace the contents of `backend/alembic/env.py`:

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from mathion.config import settings
from mathion.database import Base
from mathion.models import (  # noqa: F401 — ensure all models are registered
    AnswerOption,
    Block,
    Course,
    CourseAdmin,
    CourseVersion,
    Item,
    Question,
    Sequence,
)

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 3: Generate initial migration**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
alembic revision --autogenerate -m "initial schema"
```

- [ ] **Step 4: Review the generated migration file**

Inspect the generated file in `backend/alembic/versions/` and verify it creates all tables: `courses`, `course_admins`, `course_versions`, `blocks`, `sequences`, `items`, `questions`, `answer_options`.

- [ ] **Step 5: Test migration against a fresh SQLite database**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
MATHION_DATABASE_URL=sqlite:///./test_migration.db alembic upgrade head
rm test_migration.db
```

Expected: migration runs without errors.

- [ ] **Step 6: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add backend/alembic.ini backend/alembic/
git commit -m "feat: add Alembic setup with initial migration"
```

---

## Summary

After completing all 9 tasks, Phase 1 delivers:

- **Project structure:** FastAPI app with pytest, SQLAlchemy, Alembic
- **Models:** Course, CourseAdmin, CourseVersion (with state machine), Block, Sequence, Item (4 types), Question (4 types), AnswerOption
- **API endpoints:**
  - Course CRUD (`/api/courses`)
  - Version CRUD + state transitions (`/api/courses/{id}/versions`, `/api/versions/{id}/publish|archive|revert`)
  - Block CRUD with max-8 limit (`/api/versions/{id}/blocks`)
  - Sequence CRUD with max-8 limit (`/api/blocks/{id}/sequences`)
  - Item CRUD (`/api/sequences/{id}/items`)
  - Content JSON delivery (`/api/versions/{id}/content`)
- **Tests:** model tests + API integration tests for all endpoints
- **Migration:** Alembic initial schema

**Not included (deferred to later phases):**
- Authentication and authorization (Phase 2)
- Markdown rendering (Phase 4)
- Quiz question CRUD API (Phase 5)
- Quiz evaluation (Phase 5)
- Asset management (Phase 6)
